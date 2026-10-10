-- Separate audience and credentials from the read-only POS connector.
CREATE SCHEMA IF NOT EXISTS blog_mcp_private;
REVOKE ALL ON SCHEMA blog_mcp_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE blog_mcp_private.connections (
  id uuid PRIMARY KEY,
  owner_ref text NOT NULL,
  client_id text NOT NULL CHECK (client_id='newhope-blog-chatgpt'),
  resource text NOT NULL,
  scope text NOT NULL CHECK (scope='blog:write'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
  revoked_at timestamptz,
  rate_window timestamptz NOT NULL DEFAULT now(),
  rate_count integer NOT NULL DEFAULT 0
);
CREATE INDEX blog_mcp_connections_owner ON blog_mcp_private.connections(owner_ref,created_at);
CREATE TABLE blog_mcp_private.credentials (
  hash text PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES blog_mcp_private.connections(id),
  kind text NOT NULL CHECK (kind IN ('code','access','refresh')),
  redirect_uri text,
  challenge text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX blog_mcp_credentials_connection ON blog_mcp_private.credentials(connection_id);
CREATE TABLE blog_mcp_private.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES blog_mcp_private.connections(id),
  event text NOT NULL,
  tool text,
  slug text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blog_mcp_audit_time ON blog_mcp_private.audit(connection_id,created_at DESC);
ALTER TABLE blog_mcp_private.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_mcp_private.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_mcp_private.audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA blog_mcp_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA blog_mcp_private FROM PUBLIC,anon,authenticated,service_role;
-- Trusted server PostgreSQL connection only. No browser/Data API access.
