-- Transactional trigger test: all synthetic rows are rolled back in a subtransaction.
DO $test$
DECLARE
  test_user uuid := pg_catalog.gen_random_uuid();
  spoofed_tenant uuid := pg_catalog.gen_random_uuid();
  created_tenant uuid;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (test_user, test_user::text || '@example.invalid',
      jsonb_build_object('store_name','Signup verification test','full_name','Test owner',
        'business_sector','RETAIL','tenant_id',spoofed_tenant,'role','SUPERADMIN'));
    IF EXISTS(SELECT 1 FROM internal.tenants WHERE owner_user_ref=test_user::text) THEN
      RAISE EXCEPTION 'Unverified user was provisioned';
    END IF;
    UPDATE auth.users SET email_confirmed_at=now() WHERE id=test_user;
    SELECT id INTO STRICT created_tenant FROM internal.tenants WHERE owner_user_ref=test_user::text;
    IF created_tenant=spoofed_tenant THEN RAISE EXCEPTION 'Untrusted tenant accepted'; END IF;
    IF NOT EXISTS(SELECT 1 FROM internal.memberships WHERE user_id=test_user AND tenant_id=created_tenant
      AND role='OWNER' AND pin<>'1234') THEN RAISE EXCEPTION 'Owner membership missing/unsafe'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pos.tenants WHERE id=created_tenant) THEN RAISE EXCEPTION 'POS tenant missing'; END IF;
    IF NOT EXISTS(SELECT 1 FROM billing.subscriptions WHERE tenant_id=created_tenant
      AND status='TRIAL' AND trial_ends_at-trial_started_at=interval '45 days') THEN
      RAISE EXCEPTION 'Trial mismatch';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM ai.merchant_ai_credits WHERE tenant_id=created_tenant AND balance=50) THEN
      RAISE EXCEPTION 'AI credits missing';
    END IF;
    UPDATE auth.users SET email_confirmed_at=now() WHERE id=test_user;
    IF (SELECT count(*) FROM internal.tenants WHERE owner_user_ref=test_user::text)<>1 THEN
      RAISE EXCEPTION 'Duplicate onboarding';
    END IF;
    RAISE SQLSTATE 'ZX001' USING MESSAGE='test_passed_rollback_fixture';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=test_user) THEN RAISE EXCEPTION 'Fixture rollback failed'; END IF;
END;
$test$;
