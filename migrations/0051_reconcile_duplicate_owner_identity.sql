-- Run after canonical-identity readers are deployed. No financial ledger updates.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$
DECLARE pair record; old_merchant uuid; new_merchant uuid; old_outlet uuid; new_outlet uuid;
BEGIN
  FOR pair IN
    SELECT old.id source_id,canonical.id canonical_id,old.owner_user_ref owner_ref
    FROM internal.tenants old JOIN internal.tenants canonical
      ON canonical.owner_user_ref=old.owner_user_ref AND canonical.id<>old.id
    WHERE old.merged_into IS NULL AND canonical.merged_into IS NULL
      AND old.external_ref IS NULL AND canonical.external_ref=old.owner_user_ref
      AND old.name=canonical.name AND old.owner_user_ref IS NOT NULL
      AND (SELECT count(*) FROM internal.tenants t WHERE t.owner_user_ref=old.owner_user_ref AND t.merged_into IS NULL)=2
  LOOP
    PERFORM id FROM internal.tenants WHERE id IN (pair.source_id,pair.canonical_id) ORDER BY id FOR UPDATE;
    -- Only redundant empty signup identities are eligible. Any ambiguity aborts atomically.
    IF EXISTS(SELECT 1 FROM pos.transactions WHERE tenant_id=pair.source_id)
       OR EXISTS(SELECT 1 FROM pos.cash_ledger WHERE tenant_id=pair.source_id)
       OR EXISTS(SELECT 1 FROM pos.inventory_transactions WHERE tenant_id=pair.source_id)
       OR EXISTS(SELECT 1 FROM pos.products WHERE tenant_id=pair.source_id)
       OR EXISTS(SELECT 1 FROM pos.shared_state_records WHERE tenant_id=pair.source_id)
       OR EXISTS(SELECT 1 FROM billing.invoices WHERE tenant_id=pair.source_id)
       OR EXISTS(SELECT 1 FROM billing.subscriptions WHERE tenant_id=pair.source_id AND (plan_id<>'plan-free' OR status<>'TRIAL'))
       OR EXISTS(SELECT 1 FROM internal.memberships WHERE tenant_id=pair.source_id AND (user_id::text<>pair.owner_ref OR role<>'OWNER'))
       OR (SELECT count(*) FROM internal.merchants WHERE tenant_id=pair.source_id)<>1
       OR (SELECT count(*) FROM internal.merchants WHERE tenant_id=pair.canonical_id)<>1
       OR (SELECT count(*) FROM internal.outlets WHERE tenant_id=pair.source_id)<>1
       OR (SELECT count(*) FROM internal.outlets WHERE tenant_id=pair.canonical_id)<>1
    THEN RAISE EXCEPTION 'DUPLICATE_TENANT_REQUIRES_MANUAL_REVIEW'; END IF;
    SELECT id INTO old_merchant FROM internal.merchants WHERE tenant_id=pair.source_id;
    SELECT id INTO new_merchant FROM internal.merchants WHERE tenant_id=pair.canonical_id;
    IF (SELECT business_sector FROM internal.merchants WHERE id=old_merchant)
       IS DISTINCT FROM (SELECT business_sector FROM internal.merchants WHERE id=new_merchant)
    THEN RAISE EXCEPTION 'DUPLICATE_TENANT_SECTOR_MISMATCH'; END IF;
    SELECT id INTO old_outlet FROM internal.outlets WHERE tenant_id=pair.source_id;
    SELECT id INTO new_outlet FROM internal.outlets WHERE tenant_id=pair.canonical_id;
    IF EXISTS(SELECT 1 FROM ai.merchant_ai_credits WHERE merchant_id=pair.canonical_id)
       AND EXISTS(SELECT 1 FROM ai.merchant_ai_credits WHERE merchant_id=pair.source_id)
    THEN RAISE EXCEPTION 'DUPLICATE_AI_WALLET_REQUIRES_REVIEW'; END IF;
    INSERT INTO internal.tenant_identity_recovery(source_id,canonical_id,reason,snapshot)
    SELECT pair.source_id,pair.canonical_id,'EMPTY_SIGNUP_DUPLICATE',jsonb_build_object(
      'tenant',to_jsonb(t),'canonical',to_jsonb(c),
      'subscriptions',(SELECT jsonb_agg(to_jsonb(s)) FROM billing.subscriptions s WHERE s.tenant_id IN (pair.source_id,pair.canonical_id)),
      'memberships',(SELECT jsonb_agg(to_jsonb(m)) FROM internal.memberships m WHERE m.tenant_id=pair.source_id),
      'credits',(SELECT jsonb_agg(to_jsonb(w)) FROM ai.merchant_ai_credits w WHERE w.tenant_id=pair.source_id),
      'merchants',(SELECT jsonb_agg(to_jsonb(m)) FROM internal.merchants m WHERE m.tenant_id=pair.source_id),
      'outlets',(SELECT jsonb_agg(to_jsonb(o)) FROM internal.outlets o WHERE o.tenant_id=pair.source_id))
    FROM internal.tenants t JOIN internal.tenants c ON c.id=pair.canonical_id WHERE t.id=pair.source_id
    ON CONFLICT(source_id) DO NOTHING;
    -- Keep legacy membership FK valid; no products, stock, receipts or amounts are moved.
    INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref,is_active)
    SELECT t.id,t.name,m.business_sector,t.owner_user_ref,t.is_active FROM internal.tenants t
    JOIN internal.merchants m ON m.id=new_merchant WHERE t.id=pair.canonical_id
    ON CONFLICT(id) DO NOTHING;
    UPDATE internal.memberships SET tenant_id=pair.canonical_id,
      merchant_id=CASE WHEN merchant_id=old_merchant THEN new_merchant ELSE merchant_id END,
      outlet_id=CASE WHEN outlet_id=old_outlet THEN new_outlet ELSE outlet_id END
      WHERE tenant_id=pair.source_id;
    UPDATE ai.merchant_ai_credits SET tenant_id=pair.canonical_id,merchant_id=pair.canonical_id WHERE merchant_id=pair.source_id;
    -- Reuse original trial dates only when canonical has no subscription; never replace paid access.
    UPDATE billing.subscriptions SET tenant_id=pair.canonical_id WHERE tenant_id=pair.source_id
      AND NOT EXISTS(SELECT 1 FROM billing.subscriptions WHERE tenant_id=pair.canonical_id);
    UPDATE internal.tenants canonical SET created_at=least(canonical.created_at,original.created_at),
      business_sector=m.business_sector,owner_user_id=COALESCE(canonical.owner_user_id,original.owner_user_id)
      FROM internal.tenants original,internal.merchants m
      WHERE canonical.id=pair.canonical_id AND original.id=pair.source_id AND m.id=new_merchant;
    UPDATE internal.tenants SET merged_into=pair.canonical_id,is_active=false WHERE id=pair.source_id;
    UPDATE pos.tenants SET is_active=false WHERE id=pair.source_id;
    UPDATE internal.merchants SET is_active=false WHERE tenant_id=pair.source_id;
    UPDATE internal.outlets SET is_active=false WHERE tenant_id=pair.source_id;
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_canonical_owner ON internal.tenants(owner_user_ref)
  WHERE owner_user_ref IS NOT NULL AND merged_into IS NULL;
-- All admin directory consumers share the same archive filter, including totals.
DO $$ DECLARE definition text; BEGIN
  SELECT pg_get_viewdef('contract.merchant_directory'::regclass,true) INTO definition;
  IF position('merged_into' in definition)=0 THEN
    EXECUTE 'CREATE OR REPLACE VIEW contract.merchant_directory AS SELECT d.* FROM ('||
      rtrim(definition,E';\n ')||') d JOIN internal.tenants identity ON identity.id=d.tenant_id WHERE identity.merged_into IS NULL';
  END IF;
END $$;
