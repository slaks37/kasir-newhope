# Product / CTO audit — 2026-10-04

Scope: public website and onboarding, merchant workspace/POS, admin/support, API, database lifecycle, scheduled jobs, regression checks, and repository statements. This is a source-backed engineering review, **not certification that every production workflow works**.

Baseline inspected: `3c6de32`. Subsequent changes in this audit require their own successful test and deployment evidence. A local fix is not automatically a production fix.

Integration checkpoint: GitHub main advanced to `54dd124` during the audit. Its 17 stabilization commits are retained, including unified billing handlers, stock edge-case corrections, statement timeouts, paged state/version triggers, offline service worker, public-content corrections, slimmer Auth client, admin identity linking and deployment-order compatibility. DOKU origin validation and the second scheduler had overlapping fixes; the merge keeps one implementation. The existing `.github/workflows/ci.yml` is reused rather than adding a competing QA workflow. Read its [QA report](../qa/2026-10-04-qa-report.md) and [release runbook](../operations/runbook-2026-10-stabilization.md) alongside this addendum; their measurements are not newly measured production latency in this audit.

## End-to-end map (existing architecture retained)

| Stage | Implementation | Contract |
|---|---|---|
| Public routes / login / reset | `src/App.tsx`, `src/lib/navigation/routes.ts`, `workspaceRouter.ts` | Deep links restored; guarded routes require authenticated identity |
| Auth restoration | `AuthContext.tsx`, `sessionLifecycle.ts`, `authenticatedFetch.ts` | Supabase session and live auth events; late initial state cannot replace a newer identity |
| Account and plan | `TenantContext.tsx`, billing engine, `accountSubscription.ts` | Account policy shared by billing/admin/support, not inferred from a business display name |
| Business selection | `WorkspaceBusinessContext.tsx`, `businessDirectory.ts`, `selection.ts` | Server-owned business IDs; local selection is only a hint; reject foreign parent/outlet |
| Outlet readiness | `OutletSetupGate`, server sync/billing capacity checks | Active outlet plus entitlement before new checkout; deferred branches retain history |
| State / caching | Existing POS Context, domain selectors/selected store, `WorkspaceCache`, `refreshCoordinator` | No added Redux/Zustand/React Query; existing read coalescing is session/scope-aware |
| Products/categories | `sharedState.ts`, module kinds, scope validation, server shared-state projection | Versioned scoped records; normalized tables do not independently claim ownership |
| Storage | Auth session, workspace selection/cache, cart drafts, durable operational/financial outboxes, recovery snapshots | Never clear all localStorage; never silently delete financial pending records |
| Sync startup | Verified business provider mounts selected namespace; module-aware coordinator | Preserve pending edits, cancel obsolete hydration, quarantine wrong scope, per-record ACK/conflict |
| Finance / reports | `services/pos/sync.ts`, financial/report handlers, canonical contract views | Normalized server ledger, idempotent financial commands, timezone/scope validation |
| Admin | Separate admin application; verified JWT, internal membership/capabilities, MFA, audited writes | No fake direct-login session; support cannot read or arbitrarily replace owner passwords |
| RLS / database | SQL migrations, transaction-local scope, runtime role grants | `schema` parameter is not an authorization boundary; verify actual deployed role/grants |

## Confirmed root causes and changes

### Unbounded-looking load states

`services/shared/db.ts` previously used the same 15-attempt exponential startup loop for local orchestration and Vercel. Each probe also had a 10-second connection timeout. During failure, an HTTP request could spend far longer waiting than a user reasonably expects. This is a demonstrated failure path, not proof it explains every healthy-production latency report.

The runtime now performs one bounded probe in Vercel; local orchestration retains retries. Rejected pools are closed. Admin requests bound response decoding as well as fetch time, return actionable timeout messages, and **do not replay writes**. Initial auth restoration times out visibly, preserves storage, and still lets a later live auth event recover safely.

### Repeated account-level reporting work

The subscription directory performed separate per-account subqueries for first transaction, last transaction, outlets, paid invoice and business search. It now groups each fact source once across the selected account set, retaining the canonical TypeScript entitlement policy. Deterministic ordering uses account ID as a tie-breaker. Business children are still fetched in a single page-scoped query, not joined into duplicate subscription rows.

The existing 10,000-account safety ceiling remains. This is not a claim of unlimited-scale reporting: database-paginated cohort aggregation and measured query plans are still required before exceeding it.

### Migration changes and history were not reliably atomic

Several maintenance SQL artifacts contain standalone `BEGIN`/`COMMIT`. The runner also opened a transaction, but an artifact's `COMMIT` could commit schema changes before the runner inserted its migration-history row.

The runner now removes the supported standalone outer wrapper and owns the transaction, including the history insert. Unknown line-based transaction layouts fail closed. Tests cover schema failure and a failed history insert after successful DDL; both must roll back. This helper is for reviewed repository SQL, not a general SQL parser. No production schema migration is automatically executed by this audit.

### Two schedulers could bypass the same rollout controls

GitHub scheduled daily CLI jobs independently of Vercel's authenticated handlers and deployment allowlist. Vercel remains the scheduling authority. GitHub batch execution is now manual/dry-run, with no email provider key passed. Merchant-health's dry run uses its built-in fixture, not a live health diagnosis. Unset `CRON_ENABLED_JOBS` still has legacy allow-all semantics; production must configure the explicit approved list.

### Documentation overstated/contradicted the product

README claimed admin had no authentication, prohibited transaction pooling universally, and treated local service layout as the production topology. The online-first progress page described batch-wide conflict blocking and stale trial/empty-database observations as current facts. These statements were replaced with implementation contracts and explicit limitations.

The previous verified fixes remain relevant: canonical account capacity separates `4 businesses` from `2 of 8 licensed outlets`; legacy Laundry layout records in FNB were backed up/quarantined without financial changes; product photo input was added. Repeating destructive cleanup is not part of this audit.

### DOKU configuration silently selected production

The full regression gate exposed an existing failed DOKU test: `getDokuApiUrl` interpreted any value containing `sandbox` as sandbox and every other value, including invalid URLs, as production. It now accepts only the complete approved production/sandbox origins and rejects invalid configuration before outbound payment requests. Tests cover lookalike hosts, embedded credentials, HTTP, paths and query strings. All payment HTTP is mocked; no checkout or payment is created by this audit.

## Regression gates

`npm run verify` provides one reproducible entrypoint for lint, building native API bundles, runtime failure handling, all existing `npm test` suites and the production build. This retains new main coverage for stock edge cases, service worker, signup, identity, deployment order and notifications as well as workspace/sync/financial/subscription/admin/AI/MCP tests. The GitHub workflow runs without production secrets and checks bundle/source parity. Production deployment approval/branch protection is a separate configuration, not guaranteed by a workflow file.

New regression coverage includes serverless/local startup budgets, no mutation replay on timeout, stale auth restoration after a newer event, migration rollback on DDL/history failure, supported migration-file formats, and absence of the second scheduled GitHub writer.

Local verification on 2026-10-04: the complete `npm run verify` chain exited 0 after the DOKU fix. This includes lint/type-check, isolated regression suites, Vite/service/native-handler build and deployed-bundle cron contract checks. Financial tests deliberately simulate full browser storage, denied access and provider failures; their expected error logs are not production incidents. No real email, provider payment, or database repair was performed in this audit pass.

Post-merge verification also exited 0 against `54dd124` plus this addendum: both frontend and Node TypeScript configurations, new runtime regressions, the complete expanded `npm test`, and production build. The integrated build retains the slimmer Auth-only browser client (shared UI chunk approximately 304 kB before gzip). This is a local build measurement, not a production page-load benchmark.

## Remaining release risks and acceptance work

1. **Inventory consistency:** client-visible stock still needs authoritative per-outlet balance hydration and concurrent-device reconciliation. Do not advertise all stock as live/server-confirmed yet.
2. **Staff identity:** kiosk profiles are not independent employee Auth accounts. A membership migration needs explicit server-side permissions and session revocation tests.
3. **Database TLS:** fallback encryption currently does not verify server certificates without `PGSSLROOTCERT`. Configure/validate the actual CA before removing fallback; do not break production by guessing certificates.
4. **Capacity/identity migrations:** same-sector multi-business creation stays capability-gated until the corresponding production migration and ownership tests pass. Never reinterpret an existing business ID to bypass the gate.
5. **Large datasets:** subscription directory has a safety ceiling; financial/AI adapters also refuse truncated histories. Measure production query plans and cardinalities before lifting limits. A load balancer does not repair incorrect scope or duplicated aggregation.
6. **Recovery:** unknown owner/outlet or conflicting historical financial copies require review. Automatic sync must not guess the winning financial version.
7. **Hardware/providers:** physical thermal printing and separately authorized live DOKU/provider checks remain acceptance work. The owner cancelled the real reset-email test; no reset email or password change is authorized by this general audit.
8. **Production evidence:** fixture success does not establish cross-device behavior under every real membership, deployment or network condition. Record concrete checks separately; do not replace failed data fetches with invented zero values.

## Operational rules

- Keep one verified owner → tenant → business → outlet identity chain.
- Preserve financial ledger, outbox and recovery snapshots during repairs.
- Treat timeout after a write as an unknown outcome; reconcile before repeating.
- Back up and scope any wrong-sector operational repair before removing active wrong-scope records.
- Never put service keys into browser environment variables, docs, test fixtures or logs.
- Never use seed/reset or blanket RLS disabling as a production repair.
- Keep older rollout documents as dated evidence; use current code/tests and this limitations register for current claims.
