# Neon database and Auth migration pilot

Status: **isolated experiment; not approved for production cutover**.
Owner requested a separate branch first, with eventual Neon Auth, a separate
`kasir-newhope` project, Free plan, Indonesia if offered otherwise Singapore.
No Indonesian region was offered. The Vercel-managed organization rejects direct
Neon project creation, so the new project was provisioned through the existing
Vercel Marketplace installation. No paid upgrade was selected.

## Targets and isolation

| Item | Value |
| --- | --- |
| Git branch | `codex/neon-auth-migration` |
| Base revision | `a427fb83fda6509bb7b18fb8c0b7155ecc3f2e49` |
| Neon organization | `org-steep-mountain-74992881` |
| New project | `steep-sea-66546931` (`kasir-newhope`) |
| Region | `aws-ap-southeast-1` (Singapore) |
| Empty default branch | `br-falling-butterfly-az989m86` (`main`) |
| Experiment branch | `br-morning-darkness-azwfti4c` (`migration-neon-auth`) |
| Database | `neondb` |
| Source / experiment PostgreSQL | Supabase 17 / Neon 18.6 |
| Neon compute | 0.25 CU, Free-plan suspend policy |
| Restore history | 6 hours; not an independent backup |

The existing `forever-in-love` Neon project is unrelated and was not changed.
The production Supabase project remains `fqxrhumsgigcgjtlbfuo`.
The experiment contains repository DDL and synthetic accounts only. It is **not
a restore of the current production schema/data**. Production schema drift,
platform functions and owners must be compared against an actual schema dump.
The Marketplace form defaults to PostgreSQL18; migration/version compatibility
must be checked against a full PostgreSQL17 source dump before cutover.

During provisioning a Vercel project connection added prefixed
`kasirnewhope_*` variables for preview/production. This connection was removed.
All 32 original environment IDs/keys/targets were verified intact, no additional
integration variables remained, and the application's original `DATABASE_URL`
was not replaced. There was no production deployment or database cutover.
Automatic Vercel deployment is disabled for this exact experimental Git branch
in `vercel.json`, so its draft PR cannot silently inherit production-backed
preview credentials. Other branches retain their previous deployment behavior.

## Implemented in this branch

- Default authentication remains Supabase. Neon requires explicit browser and
  server flags and an isolated pilot environment. Production is rejected by
  `neonPilotConfig`; the local development authentication bypass is disabled
  when Neon is selected.
- The official Auth-only Neon adapter keeps the existing POS auth callsites.
  It does not enable browser SQL or the Data API.
- Server JWT verification requires EdDSA signature, branch-bound JWKS, exact
  issuer/audience, subject/id agreement, email verification and expiry/max age.
  Live provider verification/banned state is checked in the database on access.
- An issuer+subject binding maps provider identity to canonical app UUID.
  New verified accounts cannot claim imported UUIDs or matching-email users.
  Reviewed old-account binding is a separate cutover operation; email matching
  alone is never an ownership proof.
- Idempotent server onboarding creates the user-owned tenant, merchant, one or
  two named outlets, membership, trial and policy-defined AI credits. Body IDs,
  roles and entitlement claims are ignored. Imported/staff identities never
  receive a new trial or tenant through this path.
- Financial PIN enrollment requires fresh Neon password proof of the exact
  bound owner, with provider session cleanup. Existing PIN hashing, rate limit,
  90-second command grants, audit and offline financial restrictions remain.
- Neon database connections verify certificates and hostnames; URL options
  cannot override verification. Migration scripts use direct endpoints.
- Device-only offline snapshots retain a last verified workspace for 24 hours
  while the browser reports offline. Their bearer token is replaced by an
  invalid placeholder, so snapshots cannot authorize cloud financial actions.
  This new auth snapshot needs browser/device testing before promotion.
- The OTP verification panel is available only when Neon is selected. SMTP
  delivery and full recovery are pending. Supabase recovery links are explicitly
  rejected for pilot Neon accounts rather than reported as a completed reset.

Agnes AI and DeepSeek remain the third-party AI providers. DOKU subscription
logic is retained. No provider was replaced with Neon AI Gateway, no real
payment was initiated, and no customer data was sent to an AI provider.

## Reproducible tests

Create the ignored `.env.neon-staging.local` through a secure credential channel.
Never commit it, paste credentials into issues, or overwrite the production env.
The target guard checks both fixed project/branch IDs and the experiment host;
it never falls back to `DATABASE_URL` or to a default branch.

```sh
# ONLY once, on the empty experiment application schemas:
node scripts/neon/bootstrap.mjs

# New synthetic .invalid accounts and synthetic cash only on this branch:
node --import tsx scripts/neon/rehearse.mjs

# No remote account/credential needed:
npm run test:neon-pilot
npm run lint
npm run build
npm test
```

The live rehearsal uses a deliberately marked synthetic email-verification
fixture in this isolated branch. That is not evidence of SMTP delivery, real
email ownership or end-user recovery. It never changes existing customer users.
Auth JWTs already issued may remain usable for their documented 15-minute
lifetime after cookie logout. Immediate session revocation requires a separate
approved design before production financial use.

Evidence: `build/neon/bootstrap.json` and `build/neon/rehearsal.json` (ignored;
no passwords, bearer tokens, cookies or connection strings). Native PostgreSQL17
security rehearsal remains in the repository CI; the Neon experiment separately
tests the managed PostgreSQL18 runtime.

## Production blockers and verification plan

1. **MFA**: Managed Neon Auth still lists MFA as coming soon. The application
   preserves `MFA_REQUIRED` and never upgrades Neon principals to `aal2`.
   Admin/blog editorial OAuth and privileged support cannot migrate until a
   verified equivalent exists. Consider self-managed Better Auth on Neon with
   its two-factor plugin as a separate architectural decision; it is not the
   same product as Managed Neon Auth and needs its own operating/SMTP duties.
2. **Existing identities**: password hashes and existing Supabase sessions do
   not transfer using the documented Managed Auth migration. Require recovery
   or OAuth reauthentication, with proof of both old owner and new identity,
   issuer/sub mapping, uniqueness checks and auditable owner approval. Preserve
   canonical UUIDs, memberships, tenant/outlet IDs, financial audit actor refs,
   billing subscriptions and trial-used flags. Never make a second trial.
3. **Recovery and email**: configure production SMTP, OTP verification, password
   reset, email changes, deliverability, callbacks and trusted-domain allowlists.
   Test wrong/expired/replayed OTPs and cross-account/session attempts. Browser
   cookie behavior, Safari ITP, OAuth redirects, session restore, offline reload,
   multi-device sync and wallet/plan continuity need full browser verification.
4. **Schema fidelity**: export the actual current PostgreSQL schema with direct
   credentials, compare every relation/column/type/default/constraint/index/view,
   trigger/function/search_path/extension and role dependency. The repository
   replay is only a first portability check. Do not import `auth`, `storage`,
   managed roles or legacy password-writing RPCs blindly. Port the confirmed
   signup trigger behavior to verified server onboarding, not user metadata.
5. **Least privilege**: define dedicated runtime roles for POS/billing/AI/admin
   and a migrator. Restore without Supabase owners/ACLs only after capturing
   reviewed ACLs, then apply explicit grants/RLS. Removing ACLs is not a security
   policy. Repeat own/foreign/unset tenant and outlet read/write tests under
   actual runtime roles, including views/functions and pooled transactions.
6. **Storage/support/batch**: blog media and support/reset/reminder adapters
   still use Supabase-specific APIs. Inventory object paths/buckets, email
   recipient lookups, n8n, cron, MCP OAuth, DOKU callbacks and every writer.
   These are not migrated merely by changing `DATABASE_URL`.
7. **Payment/data continuity**: rehearse DOKU duplicate/late webhook delivery,
   event idempotency and invoice status across the writer freeze. Preserve
   original payload hashes and exception evidence. No nominal-only QRIS matching.
8. **Legal/operations**: assess Singapore processing/transfers, Neon DPA,
   subprocessors, deletion/export and retention, incident response, access
   ownership, backup restore, quotas, cold starts and peak POS latency. Update
   owner-approved notices/subprocessor register before real data processing.
   Company identifiers and legal approval still require owner/counsel review.

Official references checked 2026-10-13:
[Managed Auth roadmap](https://neon.com/docs/auth/roadmap),
[Supabase Auth migration](https://neon.com/docs/auth/migrate/from-supabase),
[database migration](https://neon.com/docs/import/migrate-from-supabase),
[JWT verification](https://neon.com/docs/auth/guides/plugins/jwt),
[secure connections](https://neon.com/docs/connect/connect-securely),
[Auth production checklist](https://neon.com/docs/auth/production-checklist).

## Proposed future migration and rollback

This is a plan, **not permission to execute production changes**.

1. Capture schema/ACL metadata and independently restorable encrypted backups.
   Test restore and exact row/sequence/FK/ledger/wallet/subscription fingerprints
   in an isolated target, with approved anonymization for testing.
2. Use direct source/target URLs for pg_dump/pg_restore (PG18 tools can read the
   PG17 source); use pooled URLs at runtime. Review SQL and platform dependencies
   before restore. Reapply least privilege and verify all constraints/data.
3. Approve identity mapping, recovery/MFA, storage and writer changes. Create a
   concrete deployment candidate against the target and collect test evidence.
4. For a separately approved cutover, freeze all writers including n8n, cron,
   DOKU webhooks and old clients. Preserve/queue webhook payloads and offline
   outboxes; snapshot outstanding events; apply final delta and reconcile totals.
   Only then switch database **and** authentication configuration atomically.
5. Verify old/foreign tokens denied, existing accounts retain ownership and
   trial/paid terms, new signup creates one tenant only, refunds/void/PIN/MFA,
   five sectors, offline replay, DOKU and editorial automation. Reconcile data
   fingerprints and watch provider/query errors before releasing the freeze.

Pilot rollback: stop the experimental runtime and revert its Git branch; leave
the isolated branch/bindings/evidence in place for review. The additive binding
table must not be dropped while any identity/audit references depend on it.
No production setting needs rollback because no cutover took place.

## Risk register and bounded evidence (2026-10-13)

| Severity | Classification | Evidence / business impact | Release condition |
| --- | --- | --- | --- |
| P0 | Confirmed compatibility gap | Managed Auth lacks MFA; admin/support/editorial access would lose the existing second factor | Admin remains denied; equivalent MFA must be implemented and tested |
| P0 | Confirmed migration gap | Existing password hashes/sessions do not transfer; automatic email linking could steal tenant ownership | Dual-identity proof and reviewed canonical bindings; negative tests |
| P0 | Potential exposure | Owner credential used by pilot runtime; schema replay is not current production fidelity | Full schema/ACL dependency review, separate roles, native restore rehearsal |
| P1 | Confirmed incomplete flow | Neon recovery and browser/offline/OAuth flows have no full browser evidence yet | Real SMTP and browser/device test evidence before promotion |
| P1 | Confirmed platform behavior | A logged-out cookie is revoked but an already minted JWT may last 15 minutes | Documented session revocation/fresh-proof policy and financial tests |
| P1 | Confirmed remaining dependencies | Media/support/reminder adapters still call Supabase-specific services | Inventory and port those adapters; preserve batch and n8n behavior |
| P1 | Legal verification | Future Singapore processing, DPA/subprocessors, retention and incident duties | Owner/counsel review before real-data import |
| P1 | Potential continuity loss | Switching back after target writes without replay loses payments/offline sales | Writer freeze, event queues, reconciliation and proven rollback |

Actual live Neon evidence is committed at
`docs/migrations/evidence/neon-rehearsal-2026-10-13.json`:
verified client TLS, real signup/signin/JWKS/cookie restore/logout with synthetic
verification fixtures, own/foreign scope and PIN tests, changed-command denial,
exact-retry debit protection, and **292 real browser-role statement denials**.
The main branch contains **zero application objects** (read-only verification).
Production still reports READY deployment
`dpl_C1ha9fGGy6dZKqhvSQcYVfz8e14R`, revision
`a427fb83fda6509bb7b18fb8c0b7155ecc3f2e49`.

Local validation: complete `npm test` passed (isolated engine/mocked providers,
including POS, five sectors, DOKU, offline replay, tenant/outlet isolation and
privacy/AI controls); default and Neon-selected builds passed; lint and
Neon JWT/identity/production-guard tests passed. The dependency lock receives
compatible security patches; the final `npm audit` reports zero advisories.
These results do not establish real SMTP, production DOKU settlement,
production schema/data equivalence or a completed auth migration.

Before the first target write, a future cutover rollback can restore the previous
deployment/environment while keeping the writer freeze. **After target writes,
switching the URL back is not safe**: first capture and reconcile new transactions,
webhooks, invoices, grants, notices and offline outboxes into the authoritative
source, then verify totals and only resume one writer. Never operate two primary
writers and never delete retained transaction/audit records during rollback.
