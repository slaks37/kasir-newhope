BEGIN;
SET lock_timeout='5s';
SET statement_timeout='30s';
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS free_selection jsonb;
ALTER TABLE billing.subscriptions DROP CONSTRAINT IF EXISTS free_selection_shape;
ALTER TABLE billing.subscriptions ADD CONSTRAINT free_selection_shape CHECK (
  free_selection IS NULL OR COALESCE(CASE WHEN jsonb_typeof(free_selection->'productIds')='array' THEN
    jsonb_array_length(free_selection->'productIds')<=10
    AND jsonb_typeof(free_selection->'branchId')='string'
    AND length(free_selection->>'branchId') BETWEEN 1 AND 160
    AND (free_selection->>'sector') IN ('FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH')
    AND octet_length(free_selection::text)<=8192
  ELSE false END, false)
);
CREATE OR REPLACE VIEW contract.free_plan_entitlements AS
SELECT t.id AS tenant_id,t.owner_user_ref,(t.is_active AND a.is_active) AS is_active,
 a.status,a.plan_id,a.current_period_end,a.free_selection
FROM internal.tenants t
JOIN LATERAL (
  SELECT s.status,s.plan_id,s.current_period_end,s.free_selection,owner_t.is_active
  FROM internal.tenants owner_t JOIN billing.subscriptions s ON s.tenant_id=owner_t.id
  WHERE (t.owner_user_ref IS NOT NULL AND owner_t.owner_user_ref=t.owner_user_ref)
     OR (t.owner_user_ref IS NULL AND owner_t.id=t.id)
  ORDER BY owner_t.created_at,owner_t.id LIMIT 1
) a ON true;
REVOKE ALL ON contract.free_plan_entitlements FROM PUBLIC;
DO $$ DECLARE target_role text; BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('REVOKE ALL ON contract.free_plan_entitlements FROM %I',target_role);
    END IF;
  END LOOP;
  FOREACH target_role IN ARRAY ARRAY['service_role','svc_pos','svc_ai','svc_billing','svc_internal'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('GRANT SELECT ON contract.free_plan_entitlements TO %I',target_role);
    END IF;
  END LOOP;
END $$;
COMMIT;
