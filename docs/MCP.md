# New Hope POS MCP (read-only)

## Status

Implemented with a default-off server switch. The production migration was
applied on 2026-09-28. Production endpoint smoke testing and real ChatGPT/Claude
OAuth acceptance are separate checks; do not claim either client is connected
until its owner completes consent and a tool call succeeds.
No production data is sent by installing this code. Each owner explicitly grants
one business to one connection in the browser before any connector can read it.

## Tools and plan access

`business_info`, `list_products`, `low_stock`, `sales_summary`,
`list_transactions`. There are no writes, SQL execution, arbitrary URL fetches,
payment actions, customer contacts, staff fields, or provider API keys.
Arguments cannot override the connection's business or owner. Current ownership,
business activity and existing AI entitlement are checked on every tool call.
Active trial/paid accounts are eligible; Free, expired trial and suspended
subscriptions are denied. This deliberately preserves the existing Free AI rule.
MCP does not call DeepSeek/Agnes and does not spend POS AI wallet credits. The AI
client's own plan/usage policies still apply. Reads are synchronized database
data, not unsynced device data. Untracked stock is null, not a fabricated zero.

## Operator rollout and acceptance

1. Review and apply only `supabase/migrations/20260928135919_mcp_readonly_connections.sql`
   to the intended database using the project's reviewed migration workflow.
   Do not blindly push unrelated pending migrations. The `mcp_private` schema is
   private, has RLS and no anon/authenticated grants. Server DATABASE_URL must
   have private-schema access; never expose it to the frontend/Data API.
2. Set `MCP_PUBLIC_ORIGIN=https://kasir.newhope.space` on the production server.
   Set `MCP_ENABLED=true` only after migration and review. This is a kill switch.
   Rebuild/deploy: `npm run build` generates `api/_mcp_bundle.js` via postbuild.
3. Endpoint: `https://kasir.newhope.space/api/mcp`. Consent UI `/mcp/connect`;
   owner management `/mcp/connections`, linked from POS Settings. The consent UI
   requires an existing owner session (login POS in another tab if needed).
4. In ChatGPT's custom MCP/plugin setup, use the endpoint and OAuth. In Claude's
   custom connector setup, use the same endpoint and OAuth. Account/workspace
   availability varies. Predefined public client IDs are `chatgpt` and `claude`;
   no client secret is required. Restricted DCR accepts only allowed callbacks
   with `token_endpoint_auth_method=none`. It does not accept arbitrary clients.
5. Default callbacks are `https://chatgpt.com/connector_platform_oauth_redirect`
   and `https://claude.ai/api/mcp/auth_callback`. Copy the exact callback from
   each client's management screen. If it differs, add the exact HTTPS URI to
   `MCP_CHATGPT_REDIRECT_URIS` or `MCP_CLAUDE_REDIRECT_URIS` (comma-separated).
   Do not use wildcards. Never approve an unfamiliar callback.
6. With a synthetic eligible owner, test discovery, sign-in, deny, approve,
   each of five tools, refresh, and revoke in BOTH real clients. Test cross-owner
   denial, expired trial/Free and an empty business. Never use a real customer's
   account for acceptance testing without their consent.

Rollback: set MCP_ENABLED=false and redeploy. Existing POS functions are unchanged.
Do not delete credentials/audit tables to disable access.

## Security and operational model

- OAuth authorization code + S256 PKCE; exact registered redirect validation;
  resource/audience bound to connection; issuer and state returned on callbacks.
- Own opaque MCP credentials, never Supabase JWT passthrough. Secrets are random
  256-bit values stored only as SHA-256 hashes; codes expire in 5 minutes, access
  tokens in at most 1 hour, connections/refresh in 30 days. Refresh rotation is
  atomic; replay revokes the connection. Owner revocation affects all its tokens.
- No automatic consent. POST owner endpoints require same-origin plus verified
  Supabase bearer identity; client-side role labels are not trusted.
- 60 protocol requests/minute/connection, 10 new connections/hour/owner;
  atomic database counters/locks work across serverless instances. Configure
  platform edge rate limits for public registration/token endpoints before a
  public launch to protect unauthenticated traffic and database connections.
- At most 50 rows/page; bounded offset; sales intervals <=93 days. Summary sums
  paid completed order totals incl. tax/service, not profit or net settlement.
- Audit contains event/tool/connection metadata, never tokens, prompts, raw
  customer data or tool results. Owner sees 30 recent events and 100 connections.
- Browser/Data API roles cannot access MCP private tables. Do not grant those
  roles direct access to resolve an error. Backend DB credentials remain server-only.
- Public metadata exposes only endpoint/capability details, not business data.
  Streamable HTTP JSON response mode; GET SSE is unsupported (405). Legacy SSE,
  dynamic arbitrary clients and CIMD are intentionally not implemented.
- Plan retention/cleanup of expired credential hashes and old audit records with
  the operator before enabling at scale. Preserve replay evidence while a grant
  is valid. No automatic destructive cleanup is bundled with this feature.

## Verification

`npm run test:mcp` uses synthetic records in in-memory PGlite and loopback HTTP.
`npm run lint`; `npm run build`. These do not constitute real-client acceptance.

Design references checked 2026-09-28:
- https://developers.openai.com/plugins/build/auth
- https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
