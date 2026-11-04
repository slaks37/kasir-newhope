# Growth Milestone 2 — durable product integration

Scope: PR #23 only, development/Preview. Supabase Auth/Storage and canonical UUIDs remain authoritative. PR #21 is neither merged nor deployed. No real payment, outreach, provider AI, production schema or production environment change is authorized by this release.

## Implemented flow

1. Explicit source installation `growth/source/001_outbox.sql` creates an invoker-only, private transactional outbox. Capture covers tenant/business setup, outlets, catalog products, canonical paid POS transactions and subscription/invoice lifecycle changes. Per-resource milestones prevent updating/retrying the same sale from inventing repeat usage. Rows without an unambiguous, active UUID owner are skipped rather than assigned by email.
2. Authenticated first-party `/api/v1/sync/growth/session` records signup from the server-verified Supabase account creation date, with an immutable source/subject dedupe key. Signup is account-scoped and can be captured before a tenant exists; every business event still requires a tenant. The frontend retries on navigation/reconnection. This is not an Auth trigger replacement. Successful report summaries record feature adoption durably on the source; financial data and report contents are not sent to CRM.
3. Source outbox capture has **no network dependency on Growth**. A local outbox insert is part of the business transaction: if that insert fails, the business transaction rolls back. This is the explicit durability tradeoff; do not claim zero overhead or silently swallow capture failures. Disabling source capture is a reviewed operational escape hatch. Existing requests with capture disabled do not need Growth migrations.
4. `drainOutbox` leases up to 500 rows with `FOR UPDATE SKIP LOCKED`; lease expiry recovers a terminated worker. Target receipt+projection commit precedes source ACK. A crash between them is replay-safe. Payload fingerprints reject conflicting reuse. Exponential backoff caps at one hour; eight failed attempts quarantine the event. Superadmin can inspect minimized dead-letter metadata and explicitly requeue after repair.
5. Only verified server signals contribute to product scoring. Repeated usage requires distinct successful transaction resources on separate WIB days. Weights/reasons remain visible. Signup estimates are distinguished from linked authoritative billing trial dates/status. PQL remains an explainable rule, not a statistically validated propensity model.

## Identity and consent

- Superadmin issues a random, one-time, 24-hour private invitation for one CRM lead. Only the SHA256 hash is stored. The manual share link puts the token in a URL fragment, never an application query string or automatic outbound message.
- The recipient signs in to their existing Supabase account and reauthenticates within ten minutes, supplies their tenant UUID, and explicitly consents to product analytics version `growth-product-analytics-v1`. The server independently verifies Supabase, email verification and current active tenant ownership. Browser-supplied subject, email matching, user metadata and CRM stage cannot authorize a link.
- Claiming an invitation does **not** activate a link. A Superadmin with existing fresh MFA must review and confirm the exact Supabase UUID and tenant. Ownership is rechecked against the source immediately before approval. Conflicts fail closed. Only matching subject+tenant events can be attributed; other tenant/account records remain separate. No Auth identity is merged, no merchant permission changes and no CRM operator receives merchant access.
- Source tenant owner/deactivation/merge changes revoke stale Growth links during outbox processing and invalidate the old owner's billing proof; they never assign a replacement owner automatically. Business authorization continues to use the authoritative owner on every request.
- Withdrawal at `/settings?growthConsent=manage` revokes the Growth link and communication/AI consents. Current opt-out prevents subsequent personal attribution. It does not disable the user's business account or revoke a legitimate merchant entitlement.
- Contact retention: 180-day review queue, Superadmin-confirmed anonymization of contact fields and freeform CRM activity/recommendation/review text. Source business/billing rows are never deleted. Minimal unlinked analytics expire after 30 days, linked analytics after 180 days, delivered outbox transport after 30 days. The worker performs these TTL operations. Receipts/audit and aggregate billing history are retained for integrity review; legal retention and erasure exceptions still need release-owner review. This is an implemented engineering policy, not a statutory-compliance assertion.

## Verified revenue semantics

The source emits an allowlisted subscription image; it does not copy invoice/customer payloads. Paid proof requires an invoice with PAID + APPLIED + paid_at, positive IDR amount, and a matching provider payment event with APPLIED/VERIFIED, same invoice, reference, amount and currency. The invoice quote must match the subscription's current plan, billing cycle, period and recurring amount. Legacy/manual PAID rows and POS cash sales are not subscription-payment proof.

- MRR: only verified ACTIVE, unexpired first-party subscription coverage; yearly recurring amount / 12. Synthetic data is always excluded.
- Conversion: mature trial cohort beginning after capture/backfill, ended within a 30-day reporting window, with an observed verified paid activation. Denominator/numerator/window are returned.
- Churn: verified paid ACTIVE coverage at the window start versus verified active coverage at the window end. This measures loss of paid entitlement, not predictive churn. Scheduled cancellation alone does not imply immediate churn.
- Missing initial backfill, pending/dead rows, a last worker run older than 15 minutes, missing first-party records, missing denominators or insufficient historical coverage return **Data belum tersedia**. No synthetic fixture or CRM stage becomes live revenue.

## Roles, installation and operation

Existing isolated database: `newhope_growth_preview`, branch `br-orange-union-azwj2z2e`. All fixture records are synthetic and retained; no production/source customer records are imported.

- CRM runtime: internal membership/audit, private Growth tables, minimal canonical owner columns; no POS transaction read.
- Source worker: minimized source outbox/config and minimal owner columns; no POS books or CRM access through this credential.
- POS/billing runtime: business schemas and source producer functions; no Growth CRM or internal administrator memberships.
- All three: NOINHERIT, NOBYPASSRLS, no superuser/ownership; strict client-to-Neon-pooler TLS, bounded connections/timeouts. Backend pg_stat_ssl behind the Neon proxy is not evidence for pooler-to-compute encryption.

`DATABASE_URL` and `GROWTH_DATABASE_URL` retain the CRM runtime. Preview-only `GROWTH_SOURCE_DATABASE_URL` and `GROWTH_BUSINESS_DATABASE_URL` are separate restricted server secrets. `GROWTH_CAPTURE_ENABLED=1` and public UI flag `VITE_GROWTH_ENGINE_ENABLED=1` enable this staging integration. `AUTH_PROVIDER=supabase`, `GROWTH_AI_ENABLED=0`, `DOKU_PAYMENTS_ENABLED=0`. These are only branch-scoped Preview changes; never apply them globally.

Installation is explicit, not request-time. Apply `001_core.sql`, `002_integration.sql` to the CRM target, the source outbox migration to the reviewed business source, then review grants/backfill. The staging-only installer rejects any database/host other than the existing isolated target. Production source role grants must be reviewed against the accepted PR #21 runtime; do not reuse the staging business role policies as an approved production security design.

Worker entry points: `npm run growth:worker`, authenticated `/api/cron/growth`, or Superadmin “Proses antrean Growth”. The new cron endpoint requires constant-time checked `CRON_SECRET`; it remains production-disabled. No fourth Vercel schedule or external scheduler is activated by this PR. A reviewed scheduler invocation and alerting policy are required for unattended release operation; the three existing Vercel jobs remain unchanged. Outbox rows persist while the worker is idle, and metrics become unavailable after the freshness bound.

## Evidence and limits

- `npm run test:growth`: existing security/CRM regression plus new integration groups, using isolated PostgreSQL/PGlite and real HTTP boundaries.
- New PostgreSQL17 CI repeats the new integration suite against a disposable native server, refusing non-loopback/nonempty/wrong-named databases.
- Browser E2E exercises desktop/mobile CRM, persistence, pipeline, fallback, trial, integration coverage, private invitation creation and retention UI. Auth is synthetic in this local fixture. The previously accepted live hosted Superadmin/MFA result remains separate and is not rerun without a reason.
- `scripts/growth/verify-m2-preview.ts` uses actual restricted Neon roles and actual POS/billing/worker SQL with explicitly synthetic business records. It never calls a payment provider or creates Supabase Auth accounts. Six original CRM fixtures remain synthetic; the source integration rehearsal is also synthetic.
- First measured cloud worker batch: 20 events, 0 failed/pending/dead, approximately 6.1 seconds from the local verification host. This is not a production throughput, latency SLO or downtime estimate.

## Integration and rollback

PR #23 remains independent. Before a combined release, review overlap in `services/shared/auth.ts`, sync/billing entry points, generated bundles and package lock; resolve against PR #21 with Supabase Auth selected and Better Auth disabled. Regenerate bundles and repeat combined tests on that exact candidate. Do not deploy this main-based branch as the migration cutover.

Rollback: stop the worker/scheduler, disable Preview feature/capture flags, then disable source `growth_source.config.enabled` under approved operations if needed. Preserve outbox, receipts and business records; do not DROP schemas or replay business transactions. Roll back application code only after capture has been disabled if old runtime roles lack source producer grants. A failed worker requires retrying its outbox, never charging or resending a real payment.

Production activation remains a separate reviewed change: PR #21 release decision, source/target installation/grants, current verified backfill, owner-approved identity confirmations, unattended worker/alerting, privacy/retention acceptance and explicit production deployment approval. None is inferred from synthetic success.
