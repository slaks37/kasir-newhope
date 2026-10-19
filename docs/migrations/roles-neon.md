# Neon database credentials and role rollout

The migration owner connection is kept in the ignored, mode-0600 restore file. It must never be used by Vercel runtime. The application and native Better Auth use separate LOGIN credentials, each inheriting only one new NOLOGIN privilege group:

| Connection | LOGIN / privilege group | Approved dependency |
| --- | --- | --- |
| App `DATABASE_URL` | `newhope_runtime_login` / `newhope_runtime` | Existing POS, billing/DOKU, AI, admin, SSR blog and both MCP schemas. Existing cross-schema transactions require a single backend role. |
| `BETTER_AUTH_DATABASE_URL` | `newhope_auth_runtime_login` / `newhope_auth_runtime` | Seven operational Better Auth tables; read-only canonical user/identity binding lookup. No financial/AI/blog access. |
| CLI migration/restore only | Existing Neon migration owner, private owner URL | Schema restore, additive migrations, reviewed identity imports, verified media substitution and rollback. Never injected into frontend/runtime. |

`newhope_migrator` is an optional NOLOGIN schema-creation privilege group. It receives no ownership transfer or automatic membership of `neondb_owner`; altering existing objects still requires the separately controlled migration owner. A role name alone is not an ownership boundary.

## Dependency review

`api/_runtime.ts` passes one Db to billing, admin and sync handlers. Separate assistant/batch/MCP handlers also call `connectDb`. POS onboarding creates internal users/tenants/merchants/outlets and billing records in one transaction; AI consumes entitlements from billing and internal schemas. Native auth binding checks use the native auth pool, then the application Db writes canonical identity bindings. Owner recovery email lookup needs read-only `internal.auth_identity_bindings` and `internal.users` from the auth pool. The auth role does not need ledger tables or app DDL.

Migration `0005_runtime_roles.sql` adds explicit current-object grants and policies only to tables already using RLS. It does not enable/disable RLS, transfer ownership, alter source grants, or grant BYPASSRLS. Existing immutable financial ledgers/audits get SELECT+INSERT rather than UPDATE/DELETE; triggers remain installed. The AI credit ledger permits only SELECT for the application; reviewed owner trigger/functions append its facts, and direct INSERT/UPDATE/DELETE/TRUNCATE is revoked from the newly introduced app group on reapply. ACL rollback journal and migration history are excluded. App role has no native-auth table grants; password hashes, recovery secrets, session tokens and provider access tokens stay in the separate auth pool.

Backend grants permit multiple tenants because the current server intentionally serves multiple tenants and Superadmin reporting. Tenant/outlet authorization is enforced by server handlers and their negative authorization tests. This does not claim tenant-specific SQL isolation or service-specific processes that the current deployment does not provide. No Neon Data API/browser SQL credentials are enabled.

## Execution order

1. Restore into a fresh non-default child pinned in `neon/targets/full-restore.json`; verify source accounting before modifying target records.
2. Bootstrap native Better Auth schema and additive identity audit migrations using migration owner. Imported legacy credentials are not copied.
3. Apply `0005` as migration owner. Run `node scripts/neon/roles-provision.mjs` to create dedicated LOGIN names with **SQL**, explicit NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB/NOREPLICATION, then grant exactly one privilege group. Neon Console/CLI/API creation automatically grants `neon_superuser` membership; the migration owner cannot strip those managed flags safely. Do not use those interfaces to create runtime roles. Save credentials to an ignored mode-0600 file without printing passwords; the script refuses unsafe existing attributes/memberships or implicit password rotation. [Official role behavior](https://neon.com/docs/manage/roles).
4. Run `node scripts/neon/roles-rehearse.mjs`. It executes SQL access tests under role groups, rolls changes back, and reapplies. Admin-authenticated `SET LOCAL ROLE` cannot prove rejection of `SET ROLE` back to owner; the actual LOGIN tests must separately verify that denial.
5. Run `node scripts/neon/roles-login-verify.mjs` with the dedicated credentials; retest native signup/verification/MFA, owner recovery, five-sector onboarding, foreign tenant/outlet denial, PIN approvals, immutable finance, billing, blog upload and MCP before deployment.
6. Run `node --import tsx scripts/neon/rehearse-restricted-runtime.ts` against the restored child using actual app/auth LOGINs. It verifies native HTTP auth, five-sector/two-outlet onboarding, foreign outlet and financial approval denials, TOTP/login/logout/reset, local mail capture and unchanged preexisting core rows. Sign-in throttling is respected by waiting `Retry-After`; it is never disabled or bypassed. This creates synthetic fixtures; keep this child a rehearsal environment and restore a clean candidate at the final freeze.
7. In hosted Preview require `NEON_RUNTIME_ROLES_REQUIRED=1`; configure pooled application/auth URLs pinned to the same child. Runtime migration/DDL failures must be repaired in a reviewed migration, never by granting owner/BYPASSRLS to the app. After reviewed additive dependency migrations run `node scripts/neon/roles-apply.mjs`, then repeat actual LOGIN/RPC checks.

## Rollback

Stop the isolated staging app first. Execute `scripts/neon/roles-rollback.sql` against the pinned target using the private migration owner. It removes only named policies and grants for the new privilege groups; it preserves application/auth rows, prior roles/grants, RLS flags and ownership. Reapplying `0005` restores the reviewed grants. Do not make an owner credential the production fallback. Role passwords should be revoked separately if the branch will not be reused.

Future migrations receive no automatic broad default grants. Reapply/update the reviewed object inventory and rerun actual SQL and API authorization checks before serving new tables/functions.

Verification on 2026-10-14: actual LOGIN tests rejected 16 application and 9 auth-role SQL actions, including owner/other-role escalation and forged AI ledger mutation. App blog CRUD and auth rate-limit CRUD succeeded inside transactions that were rolled back. The earlier complete relation inventory test rejected 177 app relations each under `anon` and `authenticated`, with grants/policies rollback/reapply tested. External email is deliberately not covered by local capture. Bounded evidence: `docs/migrations/evidence/neon-roles-storage-2026-10-14.json`.
