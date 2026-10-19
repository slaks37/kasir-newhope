# Neon PostgreSQL + self-managed Better Auth MFA pilot

Status: isolated staging candidate, **not a production cutover**. Owner selected
Better Auth on Neon with native MFA on 2026-10-13. Supabase remains the default.
The initial repository-schema rehearsal used synthetic `.invalid` accounts.
Full preparation now also includes a credential-free source business snapshot
restored into a separate child; see [data restore](data-restore.md) and the
[full cutover runbook](full-cutover-runbook.md). Production passwords, sessions
and MFA secrets are not migrated, and production remains on Supabase.

## Targets

| Item | Value |
| --- | --- |
| Git branch / draft PR | `codex/neon-auth-migration` / #21 |
| Production base revision | `a427fb83fda6509bb7b18fb8c0b7155ecc3f2e49` |
| Neon project | `steep-sea-66546931` / `kasir-newhope` |
| Organization | `org-steep-mountain-74992881`, Vercel: slaks37's projects |
| Plan / region | Free / Singapore `aws-ap-southeast-1`; Indonesia not offered |
| Empty root branch | `br-falling-butterfly-az989m86` / `main` |
| Active isolated MFA branch | `br-icy-dust-azqi5vlc` / `migration-better-auth-mfa` |
| Database / version | `neondb` / PostgreSQL 18.6; source Supabase is 17 |
| Self-managed auth schema | `newhope_auth`; no Managed Auth provisioning here |
| Compute / restore history | 0.25 CU / six hours; not an independent backup |

The unrelated `forever-in-love` project is untouched. Automatic Vercel deployment
is disabled for this exact Git branch. No production env is changed for this pilot.
The temporary Marketplace connection created during initial provisioning was
removed; all 32 original Vercel env IDs/keys/targets were verified preserved.
A separate historical Managed Auth child (`br-morning-darkness-azwfti4c`) and its
bounded evidence remain for comparison; its frontend SDK has been removed from
this candidate because required admin MFA needs self-managed Better Auth.

## Implementation and boundaries

- Pinned Better Auth **1.7.7**, hosted on app `/api/auth/*`, using Neon PostgreSQL,
  native email/password, native TOTP and database-backed rate limiting. Runtime
  queries explicitly qualify the auth schema. No runtime schema auto-migration.
- Verified email required before server identity binding/onboarding. `isActive`
  is a server-only field. Native password hashing and encrypted MFA secrets;
  no custom authentication protocol or plaintext financial PIN.
- Signed session bearer from the native bearer plugin with `requireSignature`.
  Every private API rechecks the live session/user in the DB; unsigned, tampered,
  expired, revoked, unverified or disabled identities confer no authority.
  Cookie cache is disabled. Logout/reset revoke sessions immediately.
- Native MFA login challenge gives no usable app bearer until TOTP succeeds.
  A server hook records success against the exact issued session, including
  enrollment session rotation. Client metadata and backup codes cannot create
  a fresh TOTP timestamp. Trusted-device bypass is disabled. Changing existing
  MFA/backup-code settings also requires server TOTP proof within ten minutes.
- Existing admin/support guards retain `aal2` and ten-minute freshness. Financial
  PIN enrollment uses native fresh password verification of the bound owner;
  existing scrypt PIN hashes, lockout, 90-second command grants, immutable audit,
  amount/action/reference binding and idempotency remain enforced by POS services.
- Issuer+provider+subject maps to canonical application UUIDs; matching email
  alone cannot claim an imported tenant. Existing UUIDs, memberships, paid terms,
  wallets and offline namespaces require a reviewed migration binding.
- Idempotent server onboarding creates only new verified accounts' tenant,
  merchant, named outlets, OWNER membership, 45-day trial and policy AI credits.
  Request role/tenant/entitlement IDs cannot assign authority.
- Browser UI supports login, email links, reset, TOTP enrollment/local QR,
  recovery-code display and admin step-up. Offline snapshot expires after 24h
  and holds an unusable placeholder bearer, never offline financial authorization.
  Auth fetches bypass the POS fetch wrapper to prevent recursive restoration.
  Concurrent restoration is coalesced; initial events wait for verified results.
- Support and billing-reminder owner lookup use canonical Better Auth bindings
  in this mode, never an email join to Supabase Auth. DOKU, Agnes AI and DeepSeek
  integrations retain their existing business boundaries and default behavior.
- Email callbacks require explicitly enabled Resend, an owner-approved verified
  sender and HTTPS origin. URLs are confined to `/api/auth/*`, reset/verification
  expire after 15 minutes, idempotency keys omit token plaintext. Synthetic tests
  inject a local mail sink; no emails are sent to customers.

## Reproducible staging preparation

Save secrets in ignored mode-600 `.env.better-auth-staging.local`, never commit or
print them. `scripts/neon/better-target.mjs` rejects all other projects, branches,
endpoints and databases before connecting; direct URL for DDL, verified TLS.
Server `betterAuthPilotConfig` also rejects Vercel production, default/root branch,
missing application DB, split auth/app targets and pg URL host overrides,
unsafe origin, weak secret and a Supabase fallback. These guards must not be removed
to deploy this experimental code into production.

Required private env names:

```
NEON_PROJECT_ID
NEON_BRANCH_ID
NEON_STAGING_HOST
NEON_STAGING_DATABASE_URL
DATABASE_URL                  # same isolated target at runtime
AUTH_PROVIDER=better-auth
VITE_AUTH_PROVIDER=better-auth
BETTER_AUTH_MIGRATION_PILOT=1
BETTER_AUTH_URL                # exact app origin, HTTPS for hosted staging
VITE_BETTER_AUTH_URL           # same app origin; no server secrets in VITE vars
BETTER_AUTH_SECRET             # >=48 random characters, stable for this branch
```

Real email staging additionally needs `AUTH_EMAIL_ENABLED=1`, `AUTH_EMAIL_FROM`,
`RESEND_API_KEY`, approved DNS/domain/sender and a real delivery/recovery test.
Do not copy production DOKU/AI/blog credentials into the synthetic harness.

1. `node scripts/neon/bootstrap-better-auth.mjs`: requires empty application
   schemas, applies reviewed repository migrations and least privilege in per-file
   transactions; records file hashes/TLS evidence in ignored `build/neon`.
2. `node --import tsx scripts/neon/better-auth-schema.ts`: generates SQL through
   the official migration API. Review `0002_better_auth_core.sql`. The pinned
   version/options produce the committed core schema; no writes by default.
3. After review, `...better-auth-schema.ts --apply`: refuses existing auth objects,
   applies core, `0003_better_auth_evidence.sql` and the additive provider CHECK
   expansion `0004_better_auth_identity_provider.sql` in one transaction.
   Browser roles have no schema/table/sequence/function rights. Owner runtime is
   deliberate for the rehearsal; split least-privilege deployment roles are a gate.
4. `node --import tsx scripts/neon/rehearse-better-auth.mjs`: synthetic actual HTTP
   flows, TLS, tenant/outlet/PIN negatives and actual browser-role SQL denials.
5. `node --import tsx scripts/neon/browser-pilot.mjs`: local loopback UI harness,
   private synthetic credential fixture, injected mail capture, real Neon DB.
   This developer harness is not deployed and has no production email keys.

Never rerun bootstrap against a populated branch. Do not reset either child/root
or delete synthetic audit records simply to obtain a green test. For another
rehearsal branch, review target guards and explicitly select the new child first.

## Evidence and practical limits

Committed receipt: `docs/migrations/evidence/better-auth-mfa-rehearsal-2026-10-13.json`.
Actual HTTP tests cover mail-link verification with local capture, unsigned/tampered
bearer rejection, two tenants/outlets, role/ID forgery, PIN enrollment fresh proof,
weak PIN/wrong owner rejection, immutable command binding and exact retry, wrong/
expired TOTP, mandatory MFA login, challenge replay denial, ten-minute step-up,
password-reset token reuse and immediate old-session revocation. Persistent login
throttle rejects forged IP headers; explicit foreign browser Origins are rejected. **306** actual
SQL statements denied as `anon`/`authenticated`, including the auth schema.

Browser evidence covers verified fixture login -> canonical identity -> onboarding
-> business/subscription/report APIs -> rendered cashier, and session restoration
on reload. Admin MFA UI is checked as a synthetic support identity. API MFA proof
is independent of screenshots. QR enrollment/reset email delivery, every device,
AI brief, production settlement, full customer import and post-cutover rollback
are not established by these checks. The test harness omits real third-party keys.

Local validation includes lint, build, runtime race tests, production/target guards,
and complete POS/DOKU/offline/tenant/privacy/AI regression. CI results must be read
for the exact final commit; earlier green runs do not establish this candidate.

## Risk register and cutover gates

### Additional retest on 13 October 2026

The `better-auth-mfa-retest-2026-10-13.json` receipt repeats the live isolated
HTTP authorization, PIN, TOTP, logout/reset and 306 browser-role SQL denials.
`better-auth-continuity-2026-10-13.json` additionally proves onboarding of Retail,
Carwash and Barbershop with two outlets, complementing F&B/Laundry in the first
rehearsal. Exact tenant/merchant/outlet/membership, paid subscription and AI-wallet
fingerprints are unchanged after an explicitly seeded canonical binding; email
collision alone is rejected. This is a synthetic restored-owner fixture, **not a
customer import or an implementation of dual-identity ownership verification**.

Native backup-code login is now exposed in the login UI. Actual HTTP checks prove
single use, logout revocation, no fresh admin TOTP proof and no MFA-disable bypass.
The recovery endpoint uses the same persistent five-attempt/minute throttle as
TOTP. Browser retesting caught a successful MFA redirect to the marketing page
at `/app`; the login helper now lets the existing auth route guard preserve the
requested workspace path. Registration validation matches the native 12–128
character password boundary in Better Auth mode.

Run `node --import tsx scripts/neon/rehearse-better-continuity.mjs` after the core
rehearsal. It uses only synthetic `.invalid` accounts, honors a bounded native
`Retry-After` once, writes a sanitized receipt under ignored `build/neon`, and
retains fixtures/audit records. Run HTTP rehearsals and browser sign-in tests
sequentially: they share the persistent loopback-IP auth throttle. Never erase
rate-limit rows or disable protection to make tests pass.

For browser second-factor testing, first start `browser-pilot.mjs` with a fresh
fixture, then run `prepare-browser-second-factor.mjs`. The latter refuses nonlocal
origins and nonsynthetic accounts, enables native TOTP through HTTP and saves
secrets only in ignored mode-600 fixtures. No external mail or customer account
changes occur. Reset email token consumption/revocation is proven through HTTP
with a local mail sink; real inbox delivery and HTTPS reset UI remain release gates.

Read-only Resend inspection found sending DKIM/SPF verified for
`kasir.newhope.space`; the separate receiving MX fails. This is not evidence of
successful authentication email delivery. The pilot env has no enabled mailer,
approved sender or Resend key and currently uses a loopback HTTP origin. No DNS,
email-provider credentials or production settings were changed during retesting.

| Severity | Classification | Issue / business impact | Release condition |
| --- | --- | --- | --- |
| P0 | Confirmed migration gap | No existing customer/auth import; automatic email linking could steal ownership | Dual-identity proof, reviewed canonical bindings, hash/MFA strategy and negative tests |
| P0 | Potential exposure | Rehearsal uses owner DB role; repository DDL is not current production schema fidelity | Actual schema/ACL/dependency dump, split auth/runtime/migration roles, native restore tests |
| P0 | Confirmed continuity gap | Password hashes, Supabase sessions/MFA cannot be assumed portable | Verified recovery/import procedure, MFA re-enrollment and old-token rejection |
| P1 | Confirmed incomplete integration | Real SMTP/DNS, OAuth, hosted cookie/domain behavior not rehearsed | Verified sender, real delivery/reset, browser/device checks with HTTPS |
| P1 | Confirmed dependency | Blog/product media may still use Supabase Storage | Explicit object/media inventory, preserve URLs/access or reviewed storage migration |
| P1 | Potential legal gap | Singapore processing and self-hosted auth alter privacy/subprocessor responsibilities | Owner/counsel approval of notices, DPA/register, retention and incident procedures |
| P1 | Potential data loss | Two writers or switching back after new target writes loses payments/offline events | Writer freeze, durable event queue, totals and proven reconciliation rollback |
| P1 | Potential user lockout | Lost authenticator recovery must not grant admin via password/email alone | Native single-use backup-code tests plus audited support identity-verification procedure |

Before real-data staging/cutover: inventory actual source schemas/ACLs/platform
functions/views/auth/storage; obtain independently restorable encrypted backups;
restore PG17 source into isolated PG18 with checksums, row/sequence/FK/ledger/
wallet/subscription comparisons. Benchmark Free capacity/cold starts and choose
separate runtime credentials. Review notices/retention and legal identity items;
New System, Graha Suryamas Blok K4, stefen@newsystem.space are owner supplied,
remaining registration/location/legal approval must be verified, never fabricated.

Keep signup notices and consent records faithful during identity import; agreement
acknowledgments are not fabricated AI consent. Maintain existing transaction,
privacy, payment and audit retention. Keep settlement merchant-owned through
licensed providers and DOKU subscriptions isolated. No custodial flow is introduced.

## Future cutover and rollback (not authorization)

1. Prepare source backup/restore, ACL/dependency diff, canonical identities and
   verified email/MFA recovery. Build an explicit hosted staging candidate against
   isolated target credentials; prove existing tenant/outlet/paid-term preservation.
2. For a separately approved production cutover, freeze every writer: n8n,
   crons, DOKU callbacks and old clients. Durably retain callbacks/offline outboxes,
   reconcile outstanding events and apply final delta. Switch DB and auth together
   only after test evidence and owner approval of the concrete deployment.
3. Verify old/foreign sessions denied, new signup one tenant, five sectors,
   refund/void/PIN/MFA, offline replay, billing and editorial automation. Reconcile
   fingerprints/totals and monitor errors before lifting the freeze.

Pilot rollback is stop the local pilot and revert its Git changes; isolated schemas
and evidence stay for review. No production rollback is needed because no cutover
occurred. Reverting the provider CHECK requires zero retained Better Auth bindings;
stop dependent writers and review preservation first, never delete bindings just to
make a constraint rollback succeed. Auth schema writes are additive and transactional. Do not drop bindings,
sessions, users or retained audits while another component depends on them.

Before the first target business write, a future production rollback can restore
previous env/deployment under the writer freeze. **After target writes, changing
DATABASE_URL back is unsafe**: capture/reconcile all new transactions, callbacks,
invoices, grants, notices and offline events into the authoritative source; verify
totals before resuming a single writer. Six-hour Neon history is not the backup plan.

Official references checked for Better Auth 1.7.7:
[installation](https://better-auth.com/docs/installation),
[PostgreSQL/schema](https://better-auth.com/docs/adapters/postgresql),
[native MFA](https://better-auth.com/docs/plugins/2fa),
[signed bearer](https://better-auth.com/docs/plugins/bearer),
[hooks](https://better-auth.com/docs/concepts/hooks),
[Neon secure connections](https://neon.com/docs/connect/connect-securely).
