-- Expand/contract: keep the old PK and exact owner_sector namespaces readable
-- by existing clients. A second business has a disjoint, merchant-UUID scope.
-- Financial tables, IDs, queues, grants and RLS policies are not changed.
ALTER TABLE pos.shared_state_records ADD COLUMN IF NOT EXISTS scope_recovery_snapshot jsonb;
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_state_scope;
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_state_business_namespace;
ALTER TABLE pos.shared_state_records ADD CONSTRAINT shared_state_business_namespace CHECK (
  (scope='GLOBAL' AND merchant_id IS NULL) OR
  (merchant_id IS NOT NULL AND (scope IN ('FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP') OR scope='BUSINESS:'||merchant_id::text))
);
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_settings_sector_mode;
ALTER TABLE pos.shared_state_records ADD CONSTRAINT shared_settings_sector_mode CHECK (
  kind<>'store_settings' OR deleted OR scope='GLOBAL' OR scope LIKE 'BUSINESS:%' OR value->>'storeMode' IS NULL OR
  value->>'storeMode'=CASE WHEN scope='FNB' THEN 'FNB' WHEN scope='RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END
);

-- Capture the full old operational row before changing its namespace. No
-- sector/name inference: only the existing merchant FK and exact owner alias.
UPDATE pos.shared_state_records r SET scope_recovery_snapshot=COALESCE(r.scope_recovery_snapshot,to_jsonb(r)),
  scope='BUSINESS:'||r.merchant_id::text
FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
WHERE r.merchant_id=m.id AND r.tenant_id=m.tenant_id AND r.scope<>'GLOBAL'
  AND r.scope NOT LIKE 'BUSINESS:%' AND m.external_ref IS DISTINCT FROM t.owner_user_ref||'_'||m.business_sector;

CREATE OR REPLACE FUNCTION pos.validate_shared_business_namespace() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE business record; expected_mode text;
BEGIN
  IF NEW.scope='GLOBAL' THEN RETURN NEW; END IF;
  SELECT m.business_sector,m.external_ref,t.owner_user_ref INTO business
  FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
  WHERE m.id=NEW.merchant_id AND m.tenant_id=NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NAMESPACE_NOT_OWNED' USING ERRCODE='23514'; END IF;
  IF NEW.scope<>'BUSINESS:'||NEW.merchant_id::text AND
    (NEW.scope<>business.business_sector OR business.external_ref IS DISTINCT FROM business.owner_user_ref||'_'||business.business_sector)
    THEN RAISE EXCEPTION 'BUSINESS_NAMESPACE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NOT NEW.deleted AND (NEW.value->>'businessSector' IS NOT NULL AND NEW.value->>'businessSector'<>business.business_sector OR
    NEW.value->>'sector' IS NOT NULL AND NEW.value->>'sector'<>business.business_sector)
    THEN RAISE EXCEPTION 'BUSINESS_SECTOR_MISMATCH' USING ERRCODE='23514'; END IF;
  expected_mode:=CASE business.business_sector WHEN 'FNB' THEN 'FNB' WHEN 'RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END;
  IF NEW.kind='store_settings' AND NOT NEW.deleted AND NEW.value->>'storeMode' IS NOT NULL AND NEW.value->>'storeMode'<>expected_mode
    THEN RAISE EXCEPTION 'BUSINESS_STORE_MODE_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pos.validate_shared_business_namespace() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS shared_business_namespace_guard ON pos.shared_state_records;
CREATE TRIGGER shared_business_namespace_guard BEFORE INSERT OR UPDATE ON pos.shared_state_records
  FOR EACH ROW EXECUTE FUNCTION pos.validate_shared_business_namespace();
COMMENT ON COLUMN pos.shared_state_records.scope_recovery_snapshot IS 'Exact pre-namespace operational row; retained for recovery, never financial ledger data';
