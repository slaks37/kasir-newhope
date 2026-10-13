# Database access remediation — review required

Evidence captured 12 October 2026, project fqxrhumsgigcgjtlbfuo, base 90321d8.
No production DDL, grants, policies or customer records changed by this audit.

## Confirmed and bounded findings

- 127 relations inspected in public/pos/internal/billing/ai; 48 tables/views had browser SELECT grants with no table RLS. See catalog JSON for the exact list.
- Read-only SET ROLE anon and authenticated both returned counts: 11 tenants, 3 memberships, 1 customer, 8 payments. This proves database-role isolation fails; it does NOT prove remote access or exfiltration.
- REST Accept-Profile probes with limit=0 returned PGRST106 for each private schema. The API explicitly reports only public and graphql_public exposed. Public legacy tables use RLS with no browser policy and return no rows. No incident is asserted.
- ai.merchant_targets is a postgres-owned view with browser grants and no security_invoker option. Other compatibility views have mixed invoker settings, mostly revoked browser grants. Owner-run contract views are intentionally backend interfaces; blindly changing them would break service dependencies.
- Browser grants also appear in current postgres default ACLs, including contract (outside the original five-schema list). New objects can inherit unsafe permissions.
- service_role/postgres bypass RLS. Service connections use DATABASE_URL; services/shared/db.ts documents that a shared login also shares privileges. Production per-service credentials must be owner verified; schema arguments do not change roles.
- Security advisors confirm leaked-password protection disabled. No-policy RLS on backend-only tables is intentional deny-by-default, not a reason to add permissive policies.

## Dependency assessment

src/lib/supabase.ts uses Auth only, not PostgREST/Realtime/Storage.
POS sync/finance/reports, billing/DOKU, AI and admin use server pg connections.
Known svc_pos/svc_billing/svc_ai/svc_internal and service_role ACLs remain in place.
PUBLIC function EXECUTE removal preserves previously effective helper execution
for known backend roles, including Supabase Auth provisioning dependencies.
Existing RLS and contract view semantics are unchanged. Unknown integrations,
ETL/n8n and custom database logins require staging verification before release.
Never put anon/authenticated credentials in DATABASE_URL.

## Staging and release sequence

1. Owner records actual DATABASE_URL role per service and all SQL/REST consumers. Export current schema/grants/default ACLs; verify backup restoration. Do not copy customer data into tests.
2. Run node --import tsx scripts/dev/test-security-database.ts (isolated PostgreSQL), existing browser-RLS, financial-cloud, signup and billing tests; run npm run verify.
3. Apply the reviewed migration to a staging clone/schema under the same migration owner as production. Check no browser role inherits another role and no unexpected PUBLIC relation ACLs (migration aborts on drift). Test ALL five sectors, owner signup, outlet changes, offline sale/reconnect, cash, approved refunds/voids, reports, AI, DOKU sandbox and n8n/blog publication with actual backend logins.
4. Inspect pg_default_acl for other creators, especially supabase_admin. This migration changes defaults only for its executing owner. Owner-controlled Supabase auto-grant defaults and schema exposure settings need a separate dashboard/owner review; no managed-role impersonation.
5. Review snapshot and authorize production SQL explicitly. Apply in a maintenance window and record actor, UTC/WIB time, SQL checksum, backup, before/after grants. No automatic production db push or automatic app merge in this remediation.
6. Re-run advisors and catalog queries. anon/authenticated must have no table, column, sequence or function privileges in the six business schemas. Test read denial, write denial and guessed tenant/outlet IDs with two synthetic staging identities. Test real production read-only HTTP authentication boundaries and backend health, never customer test writes.
7. Future SQL-created objects need explicit service grants and matching RLS policies when exposed. The global implicit PUBLIC function EXECUTE default is revoked for the migration owner. Grant only reviewed functions to their required server roles.

## Rollback

docs/security/compliance/rollback-browser-roles.sql restores captured browser
ACLs and default ACLs in reverse order and removes temporary backend helper
grants. It does not invent GRANT ALL to schemas, remove data, disable RLS or
touch objects created after the snapshot. It intentionally reopens the prior
vulnerability: owner approval and incident assessment required. Prefer a
narrow, reviewed compatibility grant. Preserve the protected snapshot until the
release observation window closes. Do not reapply a snapshot blindly.

## Required dashboard action

Dashboard verified 12 October 2026: the project organization is FREE;
Authentication → Sign In / Providers → Email → Prevent use of leaked passwords
is disabled, and the UI states this is only available on Pro plan and above.
The Attack Protection page also shows DISABLED. No settings were saved and no
paid plan was purchased. Once a supported plan is owner-approved, enable this
Email-provider switch and save; if unavailable,
owner must approve a supported plan or document the residual risk; do not claim
enabled from a SQL change. Verify with security advisors after the action.
Do not change OAuth redirects, email verification or password policy silently.

Sources: [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api),
[password security](https://supabase.com/docs/guides/auth/password-security).
