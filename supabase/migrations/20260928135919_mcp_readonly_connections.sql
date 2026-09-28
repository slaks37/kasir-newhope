-- Private MCP credentials. No browser/Data API grants; tokens are SHA-256 hashes.
CREATE SCHEMA IF NOT EXISTS mcp_private;
REVOKE ALL ON SCHEMA mcp_private FROM PUBLIC, anon, authenticated;
CREATE TABLE mcp_private.connections (
  id uuid PRIMARY KEY,
  owner_ref text NOT NULL,
  business_id text NOT NULL,
  client_id text NOT NULL,
  resource text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
  revoked_at timestamptz,
  rate_window timestamptz NOT NULL DEFAULT now(),
  rate_count integer NOT NULL DEFAULT 0
);
CREATE INDEX mcp_connections_owner ON mcp_private.connections(owner_ref,created_at);
CREATE TABLE mcp_private.credentials (
  hash text PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES mcp_private.connections(id),
  kind text NOT NULL CHECK(kind IN ('code','access','refresh')),
  redirect_uri text,
  challenge text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX mcp_credentials_connection ON mcp_private.credentials(connection_id);
CREATE TABLE mcp_private.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES mcp_private.connections(id),
  event text NOT NULL,
  tool text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_audit_connection_time ON mcp_private.audit(connection_id,created_at DESC);
ALTER TABLE mcp_private.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_private.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_private.audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA mcp_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp_private FROM PUBLIC,anon,authenticated;
-- Application server uses its trusted database connection, never the Data API.
