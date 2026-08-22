import 'dotenv/config';
import pg from 'pg';

const sql = `
CREATE OR REPLACE FUNCTION public.custom_signup(
  user_email TEXT,
  user_password TEXT,
  store_name TEXT,
  full_name TEXT,
  sector TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
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
  user_sector := COALESCE(nullif(trim(sector), ''), 'FNB');

  -- Cek apakah email sudah terdaftar di auth.users
  SELECT id INTO existing_user FROM auth.users WHERE lower(email) = user_email LIMIT 1;
  IF existing_user IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email ini sudah terdaftar. Silakan login.');
  END IF;

  -- Buat UUID baru
  new_user_id := gen_random_uuid();
  new_tenant_id := gen_random_uuid();

  -- Insert user baru langsung ke auth.users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, 
    confirmation_token, email_change, email_change_token_new, recovery_token,
    is_super_admin
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
    user_email, crypt(user_password, gen_salt('bf')), NOW(), 
    '{"provider":"email","providers":["email"]}', 
    jsonb_build_object('full_name', user_full_name, 'store_name', user_store_name, 'tenant_id', new_tenant_id), 
    NOW(), NOW(), 
    '', '', '', '',
    false
  );

  -- 1. Insert Tenant (Holding / Akun Billing)
  INSERT INTO internal.tenants (id, name, owner_user_ref, is_active)
  VALUES (new_tenant_id, user_store_name, new_user_id::text, true);

  -- 2. Insert Merchant (Brand / Business Unit)
  INSERT INTO internal.merchants (id, tenant_id, name, business_sector, is_active)
  VALUES (new_tenant_id, new_tenant_id, user_store_name, user_sector, true);

  -- 3. Insert Outlet (Cabang Utama)
  INSERT INTO internal.outlets (id, tenant_id, merchant_id, name, is_active)
  VALUES (gen_random_uuid(), new_tenant_id, new_tenant_id, user_store_name || ' (Cabang Utama)', true);

  -- 4. Insert Global User
  INSERT INTO internal.users (id, email, full_name, is_active)
  VALUES (new_user_id, user_email, user_full_name, true)
  ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name;

  -- 5. Insert Multi-Tenant Membership (Owner Role)
  INSERT INTO internal.memberships (id, user_id, tenant_id, merchant_id, role, pin, is_active)
  VALUES (gen_random_uuid(), new_user_id, new_tenant_id, new_tenant_id, 'OWNER', '1234', true);

  -- Insert Trial Subscription (45 hari)
  INSERT INTO billing.subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end)
  VALUES (
    gen_random_uuid(), 
    new_tenant_id, 
    'plan-free', 
    'TRIAL'::subscription_status_enum, 
    NOW(), 
    NOW() + INTERVAL '45 days'
  );

  -- Insert AI Credits: merchant_id = new_tenant_id, tenant_id = new_tenant_id
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

GRANT EXECUTE ON FUNCTION public.custom_signup(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
`;

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Deploying corrected custom_signup RPC to remote Supabase...');
  await client.query(sql);
  console.log('RPC custom_signup deployed successfully!');

  await client.end();
}

main().catch(console.error);
