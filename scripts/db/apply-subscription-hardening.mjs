import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to database. Applying subscription schema hardening...');

  await client.query(`
    -- 1. billing.subscriptions columns
    ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS billing_cycle varchar(8) NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('MONTHLY','YEARLY'));
    ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS extra_outlets integer NOT NULL DEFAULT 0 CHECK (extra_outlets BETWEEN 0 AND 100);
    ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS recurring_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (recurring_amount >= 0);
    ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
    ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
    ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
    ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS has_used_trial boolean NOT NULL DEFAULT true;

    -- Backfill trial dates for existing rows
    UPDATE billing.subscriptions
    SET trial_started_at = COALESCE(trial_started_at, created_at),
        trial_ends_at = COALESCE(trial_ends_at, current_period_end),
        has_used_trial = true
    WHERE trial_started_at IS NULL;

    -- 2. billing.invoices columns
    ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS invoice_number text;
    ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS quote jsonb;
    ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS checkout_key uuid;
    ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'PENDING';
    ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS reconciliation_note text;
    CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_key ON billing.invoices(tenant_id,checkout_key);
    CREATE UNIQUE INDEX IF NOT EXISTS billing_invoice_number ON billing.invoices(invoice_number);

    -- 3. billing.payment_events
    CREATE TABLE IF NOT EXISTS billing.payment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_key text NOT NULL UNIQUE,
      invoice_number text,
      gateway_reference text,
      amount numeric(12,2),
      currency text,
      outcome text NOT NULL,
      reason text,
      payload jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- 4. internal.support_actions
    CREATE TABLE IF NOT EXISTS internal.support_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
      internal_user_id uuid NOT NULL REFERENCES internal.internal_users(id),
      action text NOT NULL,
      reason text NOT NULL CHECK(length(trim(reason)) >= 10),
      before_state jsonb,
      after_state jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- 5. contract.subscription_operations view
    CREATE OR REPLACE VIEW contract.subscription_operations AS
    SELECT s.*, t.is_active AS tenant_active, t.created_at AS tenant_created_at
    FROM billing.subscriptions s
    JOIN internal.tenants t ON t.id = s.tenant_id;

    -- 6. billing.reminder_deliveries
    CREATE TABLE IF NOT EXISTS billing.reminder_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subscription_id uuid NOT NULL REFERENCES billing.subscriptions(id),
      period_end timestamptz NOT NULL,
      kind text NOT NULL CHECK(kind IN ('H3','H1')),
      state text NOT NULL CHECK(state IN ('SENDING','SENT','FAILED','REVIEW')),
      payload jsonb NOT NULL,
      first_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_attempt_at timestamptz NOT NULL DEFAULT now(),
      provider_id text,
      error_code text,
      UNIQUE(subscription_id,period_end,kind)
    );

    -- 7. Update custom_signup to 15 days trial
    CREATE OR REPLACE FUNCTION public.custom_signup(
      user_email TEXT,
      user_password TEXT,
      store_name TEXT DEFAULT 'Toko Baru',
      full_name TEXT DEFAULT 'Pemilik Toko',
      sector TEXT DEFAULT 'FNB'
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, auth, internal, billing, ai, extensions
    AS $$
    DECLARE
      new_user_id UUID;
      existing_user UUID;
      new_tenant_id UUID;
      user_full_name TEXT;
      user_store_name TEXT;
      user_sector TEXT;
    BEGIN
      user_email := lower(trim(user_email));
      user_full_name := COALESCE(nullif(trim(full_name), ''), 'Pemilik Toko');
      user_store_name := COALESCE(nullif(trim(store_name), ''), 'Toko Baru');
      user_sector := upper(COALESCE(nullif(trim(sector), ''), 'FNB'));

      SELECT id INTO existing_user FROM auth.users WHERE email = user_email;
      IF existing_user IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Email sudah terdaftar. Silakan login.');
      END IF;

      new_user_id := gen_random_uuid();
      new_tenant_id := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
      )
      VALUES (
        '00000000-0000-0000-0000-000000000000',
        new_user_id,
        'authenticated',
        'authenticated',
        user_email,
        crypt(user_password, gen_salt('bf')),
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', user_full_name, 'store_name', user_store_name, 'tenant_id', new_tenant_id),
        NOW(),
        NOW(),
        '', '', '', ''
      );

      INSERT INTO internal.tenants (id, name, is_active, owner_user_ref)
      VALUES (new_tenant_id, user_store_name, true, new_user_id::text);

      INSERT INTO internal.merchants (id, tenant_id, name, business_sector, is_active)
      VALUES (new_tenant_id, new_tenant_id, user_store_name, user_sector, true);

      INSERT INTO internal.outlets (id, tenant_id, merchant_id, name, is_active)
      VALUES (gen_random_uuid(), new_tenant_id, new_tenant_id, user_store_name || ' (Cabang Utama)', true);

      INSERT INTO internal.users (id, email, full_name, is_active)
      VALUES (new_user_id, user_email, user_full_name, true)
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name;

      INSERT INTO internal.memberships (id, user_id, tenant_id, merchant_id, role, pin, is_active)
      VALUES (gen_random_uuid(), new_user_id, new_tenant_id, new_tenant_id, 'OWNER', '1234', true);

      -- Free trial: tepat 15 hari
      INSERT INTO billing.subscriptions (
        id, tenant_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, grace_period_end,
        trial_started_at, trial_ends_at, has_used_trial
      )
      VALUES (
        gen_random_uuid(), 
        new_tenant_id, 
        'plan-free', 
        'TRIAL', 
        'MONTHLY',
        NOW(), 
        NOW() + INTERVAL '15 days',
        NOW() + INTERVAL '29 days',
        NOW(),
        NOW() + INTERVAL '15 days',
        true
      )
      ON CONFLICT (tenant_id) DO NOTHING;

      INSERT INTO ai.merchant_ai_credits (merchant_id, tenant_id, balance, monthly_grant, used_this_month, period_reset_at)
      VALUES (
        new_tenant_id,
        new_tenant_id,
        50,
        50,
        0,
        (date_trunc('month', NOW()) + INTERVAL '1 month')
      )
      ON CONFLICT (merchant_id) DO NOTHING;

      RETURN jsonb_build_object(
        'ok', true, 
        'user_id', new_user_id, 
        'tenant_id', new_tenant_id,
        'email', user_email
      );
    END;
    $$;
  `);

  console.log('✓ Subscription hardening successfully applied to Supabase database!');
  await client.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
