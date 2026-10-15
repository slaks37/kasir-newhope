> **Phase 1 terbaru:** [hybrid database-only readiness](hybrid-phase1.md). Auth dan Storage tetap Supabase; full GoTrue recovery bukan gate Phase 1. Bukti dan gate migrasi Auth di bawah tetap berlaku untuk Phase 2. Produksi tetap NO-GO.

# Full Neon migration release runbook

> Status terbaru dan instruksi operator: [keputusan rilis 15 Oktober 2026](release-decision-2026-10-15.md). Bagian sebelumnya adalah bukti historis; izin email/DMARC/backup yang telah diberikan tidak perlu diminta ulang. Full service recovery, key custody, tiga claimant dan checkpoint cutover tetap belum diterima.

Prepared 14 October 2026 (Asia/Jakarta). **Staging preparation only; production
has not switched.** Source is Supabase `fqxrhumsgigcgjtlbfuo`. Target is the
Singapore Free project `steep-sea-66546931`, isolated child
`br-curly-truth-aze21ktf`; never the empty root or another project's database.
Draft PR #21 is the review boundary.

## Recovery addendum — 15 October 2026

See [recovery validation](recovery-2026-10-15.md) and the repository-root
`MIGRATION_AUDIT.md`, `DATABASE_RECONCILIATION.md` and `SCHEMA_DIFF.md`.
The interrupted local safeguards were recovered. Generic remote runtime DDL,
remote demo bootstrap/seeding and generic migration replay on a populated import
with pending historical files are blocked. Do not backfill applied markers or
checksums to make that rejection disappear. Use the reviewed corrective path.

Clean branch `br-mute-hat-azuw3aag` / `pr21-clean-restore-2026-10-15` proves the
credential-free baseline restore and idempotent 0008 correction without synthetic
customers or new financial records. It is **not** a final frozen capture and has
no customer native-auth import or cutover approval. It is deliberately absent
from the runtime/cutover target allowlist. Preserve it for independent review.

To repeat its reviewed, non-production checks, use private scoped env inputs
with `NEON_RESTORE_TARGET=clean-rehearsal`. `restore-catalog.mjs` still requires
the exact reviewed encrypted backup SHA and refuses populated targets. Never
reapply it to a branch that is already restored. `reconcile-catalog.mjs` is
read-only; `source-runtime-upgrade.mjs` verifies that original rows are unchanged
and tests reapplication inside its transaction. A new final snapshot requires a
separately reviewed target and backup, not a change to this rehearsal manifest.

Local full verification and actual staging SQL/HTTP/MFA/storage results are
recorded in recovery receipts. Hosted checks must identify the pushed commit
exactly. Real reset-email delivery, three identity exceptions, independent
backup acceptance, final offline/provider delta and production approval remain
open gates. Existing source credentials, production env and domains stay intact.

Hosted acceptance additionally found that native initial stores need the
server-derived canonical owner/sector transport alias while a source-shaped
catalog lacks multi-business namespaces. New onboarding now supplies it.
`0009_native_onboarding_transport.sql` repairs only NEW verified native accounts
with one merchant, no existing alias and no BUSINESS namespace data; collisions
abort. Its staging runner proves original source merchants and financial rows
are unchanged and reapplication is idempotent. Do not use it to reconcile
ownership of imported accounts.

Establish authorized Vercel access before asserting Preview application JSON.
A 200 SSO HTML page is not an API success. Native browser transport forwards the
signed bearer without repeating the remote session/identity/bootstrap chain
for each request. Server live-session, ownership and MFA checks stay mandatory.

## Evidence and acceptance gates

| Gate | Evidence / acceptance condition |
| --- | --- |
| Source fidelity | 125 tables, 2,537 scoped business rows, 53 views, 22 functions, 466 constraints, 109 indexes, 23 triggers, 38 policies and five sequences restored and reconciled. See [data restore](data-restore.md). Explicit credential projections and the two historical nested PIN redactions are documented separately. |
| Source schema drift | Current application dependencies must be checked against the actual catalog; add only reviewed missing objects, then re-run dependent HTTP flows and least-privilege grants. A successful snapshot restore alone does not establish compatibility. |
| Identity | Seven source accounts have reviewed UUID evidence (two existing profiles plus five canonical creations). Three exceptions remain blocked: two lack UUID ownership evidence and one has a different-UUID email collision. See [identity cutover](identity-cutover.md). Resolve each with verified ownership, never email matching. |
| Authorization | Actual separate LOGIN credentials, verified TLS, no owner/BYPASSRLS/DDL access, browser-role denials, tenant/outlet/PIN/MFA negative tests. See [roles](roles-neon.md). |
| Storage | 39 public blog objects copied (3,428,274 bytes), byte SHA256 and public GET verified, anonymous PUT denied. Exact reference rewrites must pass rollback and reapply. See [storage](storage-neon.md). |
| Recovery | Passwords, sessions, OAuth tokens and MFA secrets are not imported. Native reset links expire after 15 minutes; MFA is enrolled again. Actual HTTPS email delivery/reset must be accepted by the owner. See [email](identity-email-readiness.md). |
| Independent backup | Owner-created, independently restorable source backup and private recovery credentials with a documented restore test. A scoped credential-free snapshot and Neon history are not a complete authentication backup. |
| Protected HTTPS staging | Final commit deployed as a protected Vercel Preview on the migration branch, using only the isolated target's credentials. Prove browser → API → database → response. |
| Business regression | Five sectors, tenant/outlet scope, offline replay, financial approvals, subscription terms, DOKU webhook signature/idempotency and Agnes/DeepSeek routing/consent. No real provider charge is used to test migration. |
| Capacity | Measure target database/compute/storage footprint, connection concurrency, API latency and cold starts. Free-plan suitability must be evaluated with the actual workload; no automatic paid upgrade. |
| Legal review | New System, Graha Suryamas Blok K4 and stefen@newsystem.space are owner-supplied. Registration, complete address, cross-border disclosures, contracts and legal approval remain owner/counsel verification items. |

An unmet gate is a blocker, not implied approval. Keep the three identity
exceptions private and inactive until evidence is reviewed. Do not mark the
whole migration ready merely because CI or one login passes.

## Candidate deployment

Use `AUTH_PROVIDER=better-auth`, `STORAGE_PROVIDER=neon`, a stable HTTPS issuer,
the target branch IDs and separate `DATABASE_URL` / `BETTER_AUTH_DATABASE_URL`.
Application LOGIN is `newhope_runtime_login`; native auth LOGIN is
`newhope_auth_runtime_login`. Migration-owner credentials stay outside runtime.

For staging, use branch-scoped Preview env variables only. Auth mail is disabled
until explicit owner authorization. When enabled, allow only the approved test
recipient. Keep Vercel protection enabled. Never replace the production
`kasir.newhope.space` or `admin.newhope.space` alias while testing.

For a later approved release, canonical issuer is `https://kasir.newhope.space`,
with `https://admin.newhope.space` as the exact additional trusted origin.
Frontend allowed origins must contain these same two hosts. Keep native session
signing/encryption secret stable. Production requires
`NEON_PRODUCTION_CUTOVER_APPROVED=1` in addition to the migration flag and
restricted roles; this flag is currently absent from production. Neither current
rehearsal child is eligible for production, even with that flag: both retain
synthetic fixtures/audits. Provision a clean final-snapshot child and add its
verified resource manifest as `cutover-approved` only during the separately
reviewed release. The root/default branch remains ineligible.

Import source identities into that clean child using the **production canonical
issuer from the start**. Staging-issuer bindings are not portable simply by
changing an env variable; copying them unchanged makes native login collide with
existing canonical UUIDs. Do not adopt existing staging users or migrate test
fixtures into production. Rehearse the final clean import with exact UUID and
business fingerprints before promotion.

Keep existing production DOKU, Agnes, DeepSeek, blog API and webhook secrets
securely configured. Provider secrets are not taken from database exports.
Database-backed MCP/OAuth connections must be reauthorized because their tokens
were intentionally excluded. No new custodial payment flow is introduced.

## Approved switch window

1. Record exact source deployment, final commit, source/target catalog evidence,
   backup receipt, identity review, storage map and approved operator/window.
   Notify merchants through an explicitly approved communication procedure.
2. Drain pending POS sync and provider events. Record outstanding offline
   outboxes and payment exceptions. Disable editorial scheduling, crons and new
   signups for the bounded window; retain unsent drafts/events for replay.
3. Freeze business writers on the authoritative source before the final export.
   Keep signed DOKU callbacks durably retained at the source or a verified queue
   until replay acknowledgement. Never return successful acknowledgement for
   an event that was discarded. Do not assume the provider retries indefinitely.
4. Capture the final credential-free business delta under a consistent snapshot;
   reconcile it into the isolated target while keeping UUIDs, invoice/payment
   IDs and client-event idempotency keys unchanged. Compare transaction, cash,
   refund, subscription, credit-wallet and pending-event totals. No dual writer.
5. Stage the exact production build with approved production env, without moving
   aliases. Test native login/reset/MFA, old/foreign bearer denial, imported
   tenant access and negative authorization against that staged build.
6. Promote only after all gates pass and the owner approves that concrete build.
   Switch database/auth/storage together. Old Supabase sessions become invalid;
   users recover native credentials and enroll MFA again. Safe offline sale
   queues retain canonical UUIDs; offline financial approvals remain denied.
7. Verify both POS/admin hosts, all five sectors, blog/media, owner terms/paid
   entitlements, financial audit, provider callbacks and offline replay. Compare
   totals again, monitor errors, then resume one writer and scheduling.

No source writer freeze, external email, payment charge, source purge, account
disable or alias promotion is performed merely by running a staging test.

## Rollback

Before the first target business write, retain the freeze, restore the previous
Supabase deployment/env, verify native source authentication and resume only one
writer. Keep the Neon rehearsal and audit evidence for review.

**After target writes, an env-only rollback is unsafe.** Freeze both sides,
retain every newly acknowledged transaction, callback, refund, invoice, approval,
privacy notice and offline event. Produce an operator-reviewed reconciliation
ledger keyed by immutable source/client-event/provider IDs. Apply each missing
business event once to the chosen authoritative database, compare counts/totals
and resolve exceptions before reopening. Never restore old balances over newer
payments or delete an audit row to make a test pass.

Identity-batch rollback disables imported native identities/bindings and revokes
sessions using append-only revocation records; it preserves canonical business
UUIDs and retained audits. Storage rollback changes only verified exact URL
substitutions and aborts on post-rewrite drift. Role rollback is performed only
after stopping dependent runtime connections. Source production remains intact
throughout this preparation.

## Required owner actions before release

- Create the independent source backup through the source dashboard/approved
  database administration process, retain credentials privately and record its
  restore acceptance. Do not paste keys or backup contents into chat.
- Review the three identity exceptions with authenticated ownership evidence;
  authorize a mapping only when its source UUID and intended business scope are
  proven. Do not choose by matching email alone.
- Authorize the concrete HTTPS verification/reset test to the named test
  mailbox, confirm delivery and complete the recovery UI test.
- Verify legal identity and processing notices; approve the exact cutover
  deployment and maintenance window after the final delta rehearsal.


## Latest pre-production packet

See [preproduction-2026-10-15.md](preproduction-2026-10-15.md) for the fresh
source candidate, current DNS/email/account findings, private identity review
boundary and open gates. [Independent recovery process](independent-backup-recovery.md)
provides the owner/operator packet. No backup acceptance, identity approval, real
email/MFA acceptance, source freeze or production cutover is established.
