-- Remote migration: verified_auth_business_onboarding.
-- Auth API owns passwords/email verification. This private trigger only provisions
-- business records from a verified auth.users row; it is never an RPC endpoint.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION internal.provision_verified_auth_business()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tenant_id uuid := pg_catalog.gen_random_uuid();
  business_name text;
  owner_name text;
  business_sector text;
BEGIN
  IF NEW.email IS NULL OR NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.email_confirmed_at IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  -- Existing users/invited staff must never receive a second tenant or new role.
  IF EXISTS (SELECT 1 FROM internal.tenants t WHERE t.owner_user_ref = NEW.id::text)
     OR EXISTS (SELECT 1 FROM internal.memberships m WHERE m.user_id = NEW.id)
  THEN RETURN NEW; END IF;

  -- Metadata is used ONLY for display fields, never IDs, roles or entitlements.
  business_name := left(coalesce(nullif(btrim(NEW.raw_user_meta_data->>'store_name'), ''), 'Toko Baru'), 100);
  owner_name := left(coalesce(nullif(btrim(NEW.raw_user_meta_data->>'full_name'), ''), 'Pemilik Toko'), 150);
  business_sector := coalesce(NEW.raw_user_meta_data->>'business_sector', 'FNB');
  IF business_sector NOT IN ('FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH') THEN business_sector := 'FNB'; END IF;

  INSERT INTO internal.users (id, email, full_name, is_active)
  VALUES (NEW.id, lower(NEW.email), owner_name, true);
  INSERT INTO internal.tenants (id, name, business_sector, owner_user_ref, owner_user_id, is_active)
  VALUES (tenant_id, business_name, business_sector, NEW.id::text, NEW.id, true);
  -- Legacy membership FK still targets pos.tenants; keep the same generated ID.
  INSERT INTO pos.tenants (id, name, business_sector, owner_user_ref, is_active)
  VALUES (tenant_id, business_name, business_sector, NEW.id::text, true);
  INSERT INTO internal.merchants (id, tenant_id, name, business_sector, is_active)
  VALUES (tenant_id, tenant_id, business_name, business_sector, true);
  INSERT INTO internal.outlets (id, tenant_id, merchant_id, name, is_active)
  VALUES (pg_catalog.gen_random_uuid(), tenant_id, tenant_id, business_name || ' (Cabang Utama)', true);
  INSERT INTO internal.memberships (id, user_id, tenant_id, merchant_id, role, pin, is_active)
  VALUES (pg_catalog.gen_random_uuid(), NEW.id, tenant_id, tenant_id, 'OWNER',
    pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'), true);
  -- No shared default PIN: owner uses email login and configures a PIN separately.
  INSERT INTO billing.subscriptions (id, tenant_id, plan_id, status, current_period_start,
    current_period_end, grace_period_end, trial_started_at, trial_ends_at, has_used_trial)
  VALUES (pg_catalog.gen_random_uuid(), tenant_id, 'plan-free', 'TRIAL', now(),
    now() + interval '45 days', now() + interval '59 days', now(), now() + interval '45 days', true);
  INSERT INTO ai.merchant_ai_credits (merchant_id, tenant_id, balance, monthly_grant, used_this_month, period_reset_at)
  VALUES (tenant_id, tenant_id, 50, 50, 0, date_trunc('month', now()) + interval '1 month');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION internal.provision_verified_auth_business() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER provision_verified_auth_business
AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION internal.provision_verified_auth_business();

-- Replace the old password-writing RPC, including for trusted callers. Old
-- frontend versions already fall back to auth.signUp on RPC failure.
CREATE OR REPLACE FUNCTION public.custom_signup(user_email text, user_password text, store_name text, full_name text, sector text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Use Supabase Auth signUp and verify your email.' USING ERRCODE = '0A000';
END;
$$;
REVOKE ALL ON FUNCTION public.custom_signup(text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
