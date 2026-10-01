-- Prepare before deploying readers. Archives are private and never financial ledgers.
ALTER TABLE internal.tenants ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES internal.tenants(id);
CREATE TABLE IF NOT EXISTS internal.tenant_identity_recovery (
  source_id uuid PRIMARY KEY REFERENCES internal.tenants(id),
  canonical_id uuid NOT NULL REFERENCES internal.tenants(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  snapshot jsonb NOT NULL
);
ALTER TABLE internal.tenant_identity_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.tenant_identity_recovery FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','svc_pos','svc_billing','svc_ai','svc_internal'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON internal.tenant_identity_recovery FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
COMMENT ON COLUMN internal.tenants.merged_into IS 'Archived duplicate owner identity; retain original IDs and historical references';
