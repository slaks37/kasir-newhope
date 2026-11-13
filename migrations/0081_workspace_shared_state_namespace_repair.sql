-- Restore the Workspace v2 shared-state guard after an older bootstrap applied
-- the legacy business namespace migration after 0067. The existing trigger
-- already references this function. No operational rows are rewritten.
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_state_business_namespace;
ALTER TABLE pos.shared_state_records ADD CONSTRAINT shared_state_business_namespace CHECK (
 (module_id IS NULL AND outlet_id IS NULL AND ((scope='GLOBAL' AND merchant_id IS NULL) OR (merchant_id IS NOT NULL AND (scope IN('FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP') OR scope='BUSINESS:'||merchant_id::text)))) OR
 (module_id IS NOT NULL AND outlet_id IS NOT NULL AND merchant_id IS NOT NULL AND scope='WORKSPACE:'||merchant_id::text||':'||outlet_id::text||':'||module_id)
);
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_settings_sector_mode;
ALTER TABLE pos.shared_state_records ADD CONSTRAINT shared_settings_sector_mode CHECK(module_id IS NOT NULL OR kind<>'store_settings' OR deleted OR scope='GLOBAL' OR scope LIKE 'BUSINESS:%' OR value->>'storeMode' IS NULL OR value->>'storeMode'=CASE WHEN scope='FNB' THEN 'FNB' WHEN scope='RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END);
CREATE OR REPLACE FUNCTION pos.validate_shared_business_namespace() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE business record; expected_mode text; domain_sector text;
BEGIN
 IF NEW.module_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM internal.outlets o WHERE o.id=NEW.outlet_id AND o.merchant_id=NEW.merchant_id AND o.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'WORKSPACE_OUTLET_MISMATCH' USING ERRCODE='23514'; END IF;
  SELECT sector INTO domain_sector FROM internal.module_definitions WHERE id=NEW.module_id;
  IF domain_sector IS NULL OR NEW.scope<>'WORKSPACE:'||NEW.merchant_id::text||':'||NEW.outlet_id::text||':'||NEW.module_id THEN RAISE EXCEPTION 'WORKSPACE_NAMESPACE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NOT NEW.deleted AND (NEW.value->>'moduleId' IS DISTINCT FROM NEW.module_id OR COALESCE(NEW.value->>'outletId',NEW.value->>'branchId') IS DISTINCT FROM NEW.outlet_id::text OR NEW.value->>'businessSector' IS NOT NULL AND NEW.value->>'businessSector'<>domain_sector) THEN RAISE EXCEPTION 'WORKSPACE_PAYLOAD_MISMATCH' USING ERRCODE='23514'; END IF;
  expected_mode:=CASE domain_sector WHEN 'FNB' THEN 'FNB' WHEN 'RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END;
  IF NEW.kind='store_settings' AND NOT NEW.deleted AND NEW.value->>'storeMode' IS NOT NULL AND NEW.value->>'storeMode'<>expected_mode THEN RAISE EXCEPTION 'WORKSPACE_STORE_MODE_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.scope='GLOBAL' THEN RETURN NEW; END IF;
 SELECT m.business_sector,m.external_ref,t.owner_user_ref INTO business FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id WHERE m.id=NEW.merchant_id AND m.tenant_id=NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NAMESPACE_NOT_OWNED' USING ERRCODE='23514'; END IF;
 IF NEW.scope<>'BUSINESS:'||NEW.merchant_id::text AND (NEW.scope<>business.business_sector OR business.external_ref IS DISTINCT FROM business.owner_user_ref||'_'||business.business_sector) THEN RAISE EXCEPTION 'BUSINESS_NAMESPACE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NOT NEW.deleted AND (NEW.value->>'businessSector' IS NOT NULL AND NEW.value->>'businessSector'<>business.business_sector OR NEW.value->>'sector' IS NOT NULL AND NEW.value->>'sector'<>business.business_sector) THEN RAISE EXCEPTION 'BUSINESS_SECTOR_MISMATCH' USING ERRCODE='23514'; END IF;
 expected_mode:=CASE business.business_sector WHEN 'FNB' THEN 'FNB' WHEN 'RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END;
 IF NEW.kind='store_settings' AND NOT NEW.deleted AND NEW.value->>'storeMode' IS NOT NULL AND NEW.value->>'storeMode'<>expected_mode THEN RAISE EXCEPTION 'BUSINESS_STORE_MODE_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pos.validate_shared_business_namespace() FROM PUBLIC,anon,authenticated;
