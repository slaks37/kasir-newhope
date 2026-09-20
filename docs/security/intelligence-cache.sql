-- Additive backend-only cache. Leaves legacy insights and financial rows intact.
CREATE TABLE IF NOT EXISTS ai.business_intelligence_cache (
  merchant_id uuid PRIMARY KEY REFERENCES internal.merchants(id) ON DELETE CASCADE,
  algorithm_version text NOT NULL,
  generated_at timestamptz NOT NULL,
  document jsonb NOT NULL,
  CONSTRAINT intelligence_cache_object CHECK(jsonb_typeof(document)='object')
);
ALTER TABLE ai.business_intelligence_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai.business_intelligence_cache FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON ai.business_intelligence_cache FROM %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['service_role','svc_ai'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON ai.business_intelligence_cache TO %I',r);
      EXECUTE format('DROP POLICY IF EXISTS intelligence_backend_%I ON ai.business_intelligence_cache',r);
      EXECUTE format('CREATE POLICY intelligence_backend_%I ON ai.business_intelligence_cache TO %I USING(true) WITH CHECK(true)',r,r);
    END IF;
  END LOOP;
END $$;

-- Backend-only read model preserves the actual merchant_id (the legacy
-- contract.catalog calls tenant_id "merchant_id"). No browser grant, no
-- customer/staff fields. Intentionally a private cross-service contract view.
CREATE OR REPLACE VIEW contract.intelligence_catalog WITH (security_barrier=true) AS
  SELECT p.id,p.merchant_id,p.sku,p.name,p.category_name,p.price,p.cost_price,
    COALESCE(b.stock,0) AS stock,COALESCE(b.min_stock_alert,0) AS min_stock_alert,
    COALESCE(i.base_unit,'pcs') AS unit,p.is_available
  FROM pos.products p LEFT JOIN pos.inventory_items i ON i.id=p.inventory_item_id
  LEFT JOIN LATERAL (
    SELECT sum(current_stock) AS stock,sum(min_stock_alert) AS min_stock_alert
    FROM pos.inventory_balances WHERE inventory_item_id=p.inventory_item_id AND merchant_id=p.merchant_id
  ) b ON true;
REVOKE ALL ON contract.intelligence_catalog FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON contract.intelligence_catalog FROM %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['service_role','svc_ai'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON contract.intelligence_catalog TO %I',r);
    END IF;
  END LOOP;
END $$;
