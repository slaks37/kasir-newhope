-- Versi snapshot shared state per (tenant, merchant, scope, kind), dinaikkan
-- trigger pada setiap INSERT/UPDATE/DELETE. Polling perangkat (tiap ±6 dtk)
-- sebelumnya menghitung md5(string_agg(...)) atas SELURUH baris tenant; kini
-- hanya membaca beberapa baris versi. Data operasional tidak diubah.
CREATE TABLE IF NOT EXISTS pos.shared_state_versions (
  tenant_id    uuid NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
  merchant_key uuid NOT NULL,  -- merchant_id, atau uuid nol untuk scope GLOBAL
  scope        text NOT NULL,
  kind         text NOT NULL,
  version      bigint NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, merchant_key, scope, kind)
);

CREATE OR REPLACE FUNCTION pos.bump_shared_state_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    INSERT INTO pos.shared_state_versions (tenant_id, merchant_key, scope, kind)
    VALUES (OLD.tenant_id, COALESCE(OLD.merchant_id, '00000000-0000-0000-0000-000000000000'::uuid), OLD.scope, OLD.kind)
    ON CONFLICT (tenant_id, merchant_key, scope, kind)
      DO UPDATE SET version = pos.shared_state_versions.version + 1, updated_at = now();
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.merchant_id, NEW.scope, NEW.kind)
       IS DISTINCT FROM (OLD.tenant_id, OLD.merchant_id, OLD.scope, OLD.kind)) THEN
    INSERT INTO pos.shared_state_versions (tenant_id, merchant_key, scope, kind)
    VALUES (NEW.tenant_id, COALESCE(NEW.merchant_id, '00000000-0000-0000-0000-000000000000'::uuid), NEW.scope, NEW.kind)
    ON CONFLICT (tenant_id, merchant_key, scope, kind)
      DO UPDATE SET version = pos.shared_state_versions.version + 1, updated_at = now();
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION pos.bump_shared_state_version() FROM PUBLIC;

DROP TRIGGER IF EXISTS shared_state_version_bump ON pos.shared_state_records;
CREATE TRIGGER shared_state_version_bump
  AFTER INSERT OR UPDATE OR DELETE ON pos.shared_state_records
  FOR EACH ROW EXECUTE FUNCTION pos.bump_shared_state_version();

INSERT INTO pos.shared_state_versions (tenant_id, merchant_key, scope, kind)
SELECT DISTINCT tenant_id, COALESCE(merchant_id, '00000000-0000-0000-0000-000000000000'::uuid), scope, kind
FROM pos.shared_state_records
ON CONFLICT DO NOTHING;

-- Jendela riwayat (newest-first per kind) untuk snapshot perangkat.
CREATE INDEX IF NOT EXISTS idx_shared_state_history
  ON pos.shared_state_records (tenant_id, kind, updated_at DESC);

ALTER TABLE pos.shared_state_versions ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON pos.shared_state_versions FROM %I', r);
    END IF;
  END LOOP;
  REVOKE ALL ON pos.shared_state_versions FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
    GRANT SELECT ON pos.shared_state_versions TO svc_pos;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'pos' AND tablename = 'shared_state_versions'
                   AND policyname = 'shared_state_versions_pos_tenant') THEN
      CREATE POLICY shared_state_versions_pos_tenant ON pos.shared_state_versions FOR SELECT TO svc_pos
        USING (tenant_id::text = current_setting('app.tenant_id', true));
    END IF;
  END IF;
END $$;
