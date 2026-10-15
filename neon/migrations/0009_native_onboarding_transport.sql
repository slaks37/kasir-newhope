-- Isolated Neon corrective migration. No ownership or financial reassignment.
-- Only server-verified NEW native accounts with one merchant are eligible.
-- Imported identities, existing aliases and ambiguous multi-business owners
-- remain unchanged. Apply via the reviewed staging runner, never bootstrap.
DO $$ DECLARE candidate record; BEGIN
 IF to_regclass('internal.auth_identity_bindings') IS NULL THEN RETURN; END IF;
 FOR candidate IN
  SELECT DISTINCT m.id,t.owner_user_ref||'_'||m.business_sector AS alias
  FROM internal.merchants m
  JOIN internal.tenants t ON t.id=m.tenant_id
  JOIN internal.users u ON u.id=t.owner_user_id AND u.id::text=t.owner_user_ref
  JOIN internal.auth_identity_bindings b ON b.canonical_user_id=u.id
  WHERE b.provider IN ('better-auth','neon') AND b.verification_ref='NEW_VERIFIED_ACCOUNT'
   AND b.is_active AND u.is_active AND NOT u.is_platform_user AND u.platform_role IS NULL
   AND t.is_active AND t.merged_into IS NULL AND m.is_active AND m.external_ref IS NULL
   AND m.business_sector IN ('FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP')
   AND (SELECT count(*) FROM internal.merchants all_m WHERE all_m.tenant_id=t.id)=1
 LOOP
  IF EXISTS(SELECT 1 FROM internal.merchants other WHERE other.external_ref=candidate.alias AND other.id<>candidate.id) THEN
   RAISE EXCEPTION 'NATIVE_ONBOARDING_TRANSPORT_CONFLICT';
  END IF;
  IF EXISTS(SELECT 1 FROM pos.shared_state_records s WHERE s.merchant_id=candidate.id AND s.scope LIKE 'BUSINESS:%') THEN
   RAISE EXCEPTION 'NATIVE_ONBOARDING_STATE_NAMESPACE_REVIEW_REQUIRED';
  END IF;
  UPDATE internal.merchants SET external_ref=candidate.alias WHERE id=candidate.id AND external_ref IS NULL;
 END LOOP;
END $$;
