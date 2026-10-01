-- Operational-only repair. Preserve primary IDs referenced by financial ledgers.
ALTER TABLE pos.products ADD COLUMN IF NOT EXISTS sync_quarantined boolean NOT NULL DEFAULT false;
ALTER TABLE pos.products ADD COLUMN IF NOT EXISTS sync_recovery_snapshot jsonb;
ALTER TABLE pos.shared_state_records ADD COLUMN IF NOT EXISTS recovery_value jsonb;
ALTER TABLE pos.shared_state_records ADD COLUMN IF NOT EXISTS quarantine_reason text;

-- Only provable sector/merchant mismatches, never names or financial order JSON.
WITH wrong AS (
  SELECT p.id FROM pos.products p JOIN internal.merchants m ON m.id=p.merchant_id AND m.tenant_id=p.tenant_id
  WHERE p.business_sector IS DISTINCT FROM m.business_sector OR
    CASE WHEN p.external_ref ~ '^prod-ld-[0-9]+$' THEN 'LAUNDRY'
         WHEN p.external_ref ~ '^prod-fnb-[0-9]+$' THEN 'FNB'
         WHEN p.external_ref ~ '^prod-rt-[0-9]+$' THEN 'RETAIL'
         WHEN p.external_ref ~ '^prod-cw-[0-9]+$' THEN 'CARWASH'
         WHEN p.external_ref ~ '^prod-bb-[0-9]+$' THEN 'BARBERSHOP'
         ELSE m.business_sector END IS DISTINCT FROM m.business_sector
)
UPDATE pos.products p SET sync_recovery_snapshot=COALESCE(p.sync_recovery_snapshot,to_jsonb(p)),
  sync_quarantined=true,is_available=false FROM wrong WHERE wrong.id=p.id;

WITH wrong AS (
 SELECT r.tenant_id,r.scope,r.kind,r.record_id FROM pos.shared_state_records r
 JOIN internal.merchants m ON m.id=r.merchant_id AND m.tenant_id=r.tenant_id
 WHERE NOT r.deleted AND r.kind IN ('products','store_settings','inventory_logs','stock_items','categories','tables','customers','bookings','held_orders')
 AND (r.scope<>m.business_sector OR
   (r.value->>'businessSector' IN ('FNB','LAUNDRY','RETAIL','CARWASH','BARBERSHOP') AND r.value->>'businessSector'<>r.scope) OR
   (r.value->>'sector' IN ('FNB','LAUNDRY','RETAIL','CARWASH','BARBERSHOP') AND r.value->>'sector'<>r.scope) OR
   (r.kind='products' AND CASE WHEN r.record_id ~ '^prod-ld-[0-9]+$' THEN 'LAUNDRY'
     WHEN r.record_id ~ '^prod-fnb-[0-9]+$' THEN 'FNB' WHEN r.record_id ~ '^prod-rt-[0-9]+$' THEN 'RETAIL'
     WHEN r.record_id ~ '^prod-cw-[0-9]+$' THEN 'CARWASH' WHEN r.record_id ~ '^prod-bb-[0-9]+$' THEN 'BARBERSHOP' ELSE r.scope END<>r.scope))
)
UPDATE pos.shared_state_records r SET recovery_value=COALESCE(r.recovery_value,r.value),value=null,deleted=true,
  quarantine_reason='WRONG_OPERATIONAL_SCOPE',revision=r.revision+1,updated_at=now()
FROM wrong WHERE (r.tenant_id,r.scope,r.kind,r.record_id)=(wrong.tenant_id,wrong.scope,wrong.kind,wrong.record_id);

-- Keep the old arbiter until the versioned API is deployed (0047 finalizes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_merchant_external_ref ON pos.products(tenant_id,merchant_id,external_ref)
  WHERE external_ref IS NOT NULL AND NOT sync_quarantined;
COMMENT ON COLUMN pos.products.sync_recovery_snapshot IS 'Original wrong-scope operational projection; never prune financial references';
COMMENT ON COLUMN pos.shared_state_records.recovery_value IS 'Backed-up wrong-scope operational value before tombstoning';

-- Catalog is an operational projection; historical product-sales reports keep
-- their ledger references. Preserve the existing view definition and grants.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_viewdef('contract.catalog'::regclass,true) INTO definition;
  IF position('sync_quarantined' in definition)=0 THEN
    EXECUTE 'CREATE OR REPLACE VIEW contract.catalog AS SELECT c.* FROM (' ||
      rtrim(definition,E';\n ') || ') c JOIN pos.products q ON q.id=c.product_id WHERE NOT q.sync_quarantined';
  END IF;
END $$;
