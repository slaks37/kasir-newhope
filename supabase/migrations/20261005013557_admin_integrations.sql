-- Central platform settings: server-only; no browser policies or credential storage.
CREATE TABLE IF NOT EXISTS internal.platform_integrations (
  key text PRIMARY KEY CHECK (key = 'mcp'),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Auth/internal IDs differ between historical installations (varchar vs UUID).
  -- The verified admin reference is also retained in internal_access_log.
  updated_by text
);
ALTER TABLE internal.platform_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.platform_integrations FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON internal.platform_integrations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON internal.platform_integrations FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
    GRANT SELECT, INSERT, UPDATE ON internal.platform_integrations TO svc_internal;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='internal' AND tablename='platform_integrations' AND policyname='internal_mcp_settings') THEN
      CREATE POLICY internal_mcp_settings ON internal.platform_integrations
        TO svc_internal USING (key = 'mcp') WITH CHECK (key = 'mcp');
    END IF;
  END IF;
END $$;
COMMENT ON TABLE internal.platform_integrations IS 'Global MCP pause switch; audited Superadmin management. Secrets remain in server environment.';
