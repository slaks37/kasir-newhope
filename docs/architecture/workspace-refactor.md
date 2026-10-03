# Workspace architecture refactor — implementation record

## Audit baseline (2026-10-01)

The brief covers routing, performance, subscriptions and business identity together. This file records actual evidence and remaining acceptance gates, not a claim that every phase is complete.

- `POSContext.tsx`: 3,574 lines; one broad context with mutable financial, operational and UI state.
- Initial main chunk: 726.56 kB (187.01 kB gzip); chart chunk: 364.07 kB (107.44 kB gzip); blog storage: 454.17 kB (130.91 kB gzip). Baseline production build passed.
- Financial queue and financial hydration use independent 10s timers; operational refresh uses 6s; reports uses 15s; brief uses 30s. Focus listeners exist independently.
- `useServerReport` calls the all-page transaction reader on every refresh. 50,000 rows could require about 100 requests at page size 500, before summary requests.
- App hash auth state and POS activeTab are separate; authenticated workspace can remain at `/#login`.
- Existing server `internal.merchants.id` is already a stable UUID business identity, but client caches and operational selection infer identity from `${owner}_${sector}`. Reports resolve ownership from outlet parents; operational sync selects first merchant by sector.
- Supabase project API confirms `ap-south-1` (Mumbai), PostgreSQL 17.6. The production deployment lookup inspected during the Oct 1 audit reports Vercel `iad1`, commit `4973ab8`; end-to-end latency remains unmeasured. Pool limits and regions remain unchanged.
- Browser startup/idle request counts, long tasks, React commits and storage write frequency have not yet been measured. No invented before/after latency or request figures.

## Domain design and compatibility boundary

Use `internal.tenants.id` for subscription/account scope and `internal.merchants.id` as canonical **business_id**, retaining the existing financial merchant foreign keys rather than copying the ledger into a competing business table. Sector remains a business attribute. `internal.outlets.merchant_id` links outlets to businesses. Subscription capacity remains tenant-wide active outlets.

Keep explicit aliases from legacy `${owner}_${sector}` keys to existing business UUIDs. Ambiguous legacy keys must be held for review, not assigned to a second same-sector business. Existing transaction/client IDs, cash commands, local keys and recovery snapshots must not be rewritten or removed until mapping and server acknowledgments are proven. New businesses use unique server-issued IDs; same-sector businesses must never fall back to an arbitrary first merchant.

Before enabling same-sector creation, every operational, financial, AI, staff, subscription and legacy-reader scope must accept and validate the explicit selected business. Partial deployment of a switcher without those scope guards is unsafe.

## Implementation sequence

1. Capture audit/baseline and domain compatibility design.
2. URL-based routing, auth guards, requested-route restoration and legacy hash compatibility.
3. Business directory/switcher, tenant-wide outlet capacity and purchase-first full-capacity UX.
4. Route/module code splitting and selective context subscriptions.
5. Coordinated visibility-aware refresh, bounded paginated reports and explicit export-only history scans.
6. Incremental operational hydration and persistence checkpointing.
7. Canonical business alias migration, isolated same-sector acceptance tests, then production rollout.

## Safety gates

Financial durability, pending/refund/void recovery, server ledger authority, idempotency, tenant/outlet RBAC and original snapshots are mandatory. Performance changes must not erase financial queues or mark a partial report page as the complete financial total. Inactive routes must unsubscribe their refresh jobs. Unmeasured targets remain targets, not guarantees.

## Implemented locally through 2026-10-03 (not deployed)

- Real path routing with auth guards and safe `returnTo`; known legacy hashes normalize to paths. Public landing/auth do not mount POSProvider. Removed the delayed signup hash mutation that could race route restoration.
- Workspace, domain pages and optional modals load lazily. Header, Sidebar, catalog, cart and reports use field-selective subscriptions with stable action proxies. Sidebar also subscribes to attendance logs because its staff badge derives from that collection.
- One resource scheduler serializes refresh, merges event types in a debounce, pauses hidden reads and retains domain invalidations arriving during a running snapshot. Auth-owner generation prevents a new login joining a previous owner's in-flight read.
- Operational GET accepts route-specific `kinds` and a revision fingerprint. Unchanged responses omit the payload. Unloaded collections cannot be mistaken for an empty server baseline; pending kinds stay included across routes. Fingerprints are checkpointed only after backup, durable persistence and consumer hydration succeed.
- Automatic recent transaction hydration fetches one bounded page. Reports fetch authoritative backend summaries and one page, with explicit load-more/export. Search is debounced; stale pagination failures cannot overwrite a newer refresh.
- Capacity purchases take priority over stale onboarding hints. Add-outlet preserves the current paid plan/cycle and existing add-ons; upgrade selects Pro. Changing checkout intent remounts that form. Neither action buys or charges anything without checkout.
- `/businesses` displays canonical merchant UUIDs, active/deferred outlets and account-wide capacity. It supports guarded selection and idempotent Add Business; Add Outlet purchases capacity first when full. Bootstrap verifies membership/subscription before mounting the business store. Switching remounts the UUID namespace, cancels outgoing hydration and persists the complete outgoing cart draft. Same-sector businesses have independent catalogs and queues.
- Operational scope resolution validates an explicit business UUID or legacy external ref against authenticated ownership, sector and active status. Old clients may resolve an exact owner-sector alias or one unambiguous business. Ambiguous, inactive and foreign selections fail closed instead of selecting the first merchant.
- Legacy void commands without `voidedAt` now use one server event timestamp for transaction void metadata and its compensating cash entry. They no longer backdate only one side to the original sale date. No existing production ledger rows were altered.

The Supabase/Postgres review drove owner/merchant validation rather than broader database grants; the React review drove selective dependencies, lazy boundaries and request coordination. A local, capability-gated business namespace migration has been implemented and tested with `svc_pos`, but has not been applied to production. No dependency installation, production data change, push or deploy was performed.

## Continuation — 2026-10-03

- Cart, catalog/customer, inventory and labor state/actions are extracted into domain hooks. All UI consumers subscribe to exact fields; the compatibility facade remains for orchestration. Booking/KDS/table/settings/users and financial commands still need further decomposition: this is not a claim that the entire monolith is eliminated.
- Deferred cache/roster loading cannot overwrite unopened modules with empty arrays. Completed financial migration scans cache only after durable ACK; changed ACK bytes invalidate the fast path. Originals and incomplete migrations remain available.
- Operational cache/outbox/recovery keys use the selected canonical business UUID. Exact server-declared legacy aliases are retained; new same-sector businesses cannot import another business's legacy partition.
- Existing merchants with no external ref use their existing UUID as transport, without inserting a UUID-as-alias duplicate, renaming the business from a stale sale, or changing ledger IDs. Financial, logo, catalog, AI wallet and MCP boundaries support that identity. Credit remains account-wide rather than creating a wallet per transport ref.
- Attendance/payroll now project from accepted shared-state revisions inside the per-record savepoint. Competing 5-second client writers are removed; legacy unversioned endpoints return an upgrade-required conflict without deleting local data. Paid normalized payroll amounts/history and closed attendance identity cannot be silently overwritten. These projections are operational/admin metadata, not proof of cash payment or financial reporting authority.
- Cash payroll commands must persist before the operational slip is marked paid. A local paid slip blocks immediate duplicate clicks; cross-device payroll disbursement needs a dedicated server-owned command/idempotency contract before claiming complete multi-device payroll safety.
- Offline UI bootstrap caches only previously verified tenant/business/outlet/plan metadata, bounded by 24 hours and the current period end. This is a queue/UI hint, never server authorization or ledger ACK. Per-kind baselines retain server revisions across offline reload; uncached modules block edits. Every delivery is revalidated by the server. Live 401/403 blocks cached workspace access without deleting queues.
- Financial startup reads shift state and one bounded recent transaction page; Reports own their period summaries. The POS no longer calculates all-time reports during startup.
- One header entry and one Sync Center expose separate internal financial/operational lanes. Healthy state is unobtrusive; connection/recovery issues remain inspectable. No financial queue or snapshot is auto-deleted by operational quarantine.

## Measured build evidence

Both builds use the same locally installed Vite 6.4.3/dependencies. Baseline is a clean `git archive` of HEAD `4973ab8ab6c410c57150866057e6331aef374ad9` in a temporary directory. Metrics traverse the Vite manifest's **entire static import closure**, excluding dynamic children until explicitly selected. Gzip sizes sum independently compressed files.

| Main entry static closure | Baseline HEAD | Local refactor |
| --- | ---: | ---: |
| JavaScript bytes | 1,180,729 | 500,778 |
| JavaScript gzip bytes | 317,919 | 146,464 |
| CSS bytes | 181,271 | 143,042 |

This is approximately 58% fewer static JavaScript bytes, not an 84 kB total application or a measured latency improvement. Login, landing and workspace add their selected lazy roots; chart-heavy Reports is larger. Further startup payload reductions and measurement against the brief's render/interaction targets remain required. Repeat measurements using `node scripts/dev/measure-workspace-bundle.mjs [dist-directory]` after a manifest-enabled build.

## Verification evidence and limits

Passed locally: `npm run lint`, `npm run test:workspace`, `npm run test:sync`, `npm run test:financial-cloud`, `npm run test:subscriptions`, and `npm run build`.

- Workspace regressions cover route guards, unsafe return paths, stable selective subscriptions, focus bursts, mixed event types, mutation during a running read, owner-separated in-flight requests, module hydration and failed-hydration version checkpoints, bounded reports/export, exact legacy mapping, directory tenant/parent validation and checkout intent precedence.
- HTTP/PostgreSQL regressions cover 60/61 partial ACK, merchant-scoped projections, exact replay, cross-sector quarantine with byte-equivalent financial rows, Device A/server/Device B/Admin equality, refund/void/split payments, tenant/outlet authorization and timezone. Canonical same-sector creation, distinct identical product IDs, inactive/foreign denial, exact alias retention, UUID transport without a duplicate merchant and namespace-trigger service-role access are covered.
- Financial HTTP tests use a fresh `new PGlite()` in-memory engine, dependency-injected fixture DB and random loopback server. Remote fetches are explicitly rejected. They do not connect to production. Expected quota/webhook rejection logs are negative tests.
- Browser preview verified `/reports` redirects to `/login?returnTo=%2Freports`, registration retains the requested route, Back/Forward work, and the optional second-outlet checkbox reveals its input. No console errors were recorded for these public flows. Screenshot: `/private/tmp/newhope-routing-2026-10-03.jpg`.
- Authenticated browser fixture: two loopback origins share an isolated PostgreSQL DB and separate localStorage. Alpha/Beta share the same sector/product ID but show separate catalogs. Switching/reloading retains the outgoing cart, not the other business's cart. Device A's first cash sale is visible on B with matching server revenue Rp10,000, HPP Rp3,000 and gross profit Rp7,000. No real payment/provider credentials are used.
- Offline browser fixture: disconnect, reload POS, create a synthetic cash sale, reload again; Sync Center still shows one pending financial transaction and three operational edits. Reconnecting starts delivery without pressing Sync. Proof: `/private/tmp/newhope-offline-reload.jpg`. The fixture keeps the HTML/code reachable to test application state; it does **not** prove a service worker can serve an entirely cold browser with no network.
- Development idle window: 89.158 seconds, 9 API requests, 27 React commits, 173.8ms aggregate Profiler render time, 6 storage writes, zero long tasks/errors. Breakdown: shift 3, recent transaction page 3, directory 1, subscription 1, operational state 1. Toolbar exports at ~54s and ~89s are part of this window. This is a tiny loopback fixture, not production latency or a controlled before/after CPU benchmark.
- Production read-only preflight: Supabase healthy, region `ap-south-1`, PostgreSQL 17.6.1.155. Five active owned/unmerged merchants lack external refs and have no transactions/shared-state rows; code supports their existing UUID instead of creating duplicate merchants. Security Advisor has no ERROR findings; leaked-password protection remains a separate Auth-setting warning. No database region, pool, RLS or grants were widened.

## Remaining mandatory work before full rollout

### Follow-up audit fixes (2026-10-03)

- Removed unowned legacy checkout/tab hints from workspace routing. Payment access now follows the server subscription; a pricing selection only sets form defaults in a versioned, account-scoped, 30-minute session preference. Guest signup carries an explicit `/subscription` return path and claims its preference once. Old unknown storage is ignored, not erased.
- Initial Supabase session restoration can no longer overwrite a newer auth event, and unmounted subscriptions cannot update auth state.
- Token refresh no longer reloads the staff roster from localStorage. Owner metadata updates preserve the owner's PIN; the active cashier is resolved from the current roster rather than a serialized profile. Cloud role/deactivation changes update that active profile. An asynchronous legacy PIN hash cannot replace a newer cloud record or edited record.
- Re-ran workspace/offline, sync and financial-cloud suites successfully, including account-isolated checkout preferences, expired hints, Laundry-in-FNB quarantine, 60/61 partial ACK, lost ACK, two-device/admin financial equality, refunds and voids. TypeScript/hygiene and production build passed.
- Browser fixture verified the full 2/2 outlet capacity routes Add Outlet to Plus plus one extra outlet, and returning to POS remains possible with an active trial. No checkout was submitted and no production data was changed.

Separate Supabase logins for employees still require a server membership/authorization workflow. The existing local cashier/PIN switch is an owner-session workflow and must not be represented as separate employee authentication.

### Rollout gates

1. Stage the coordinated namespace migration and code together; verify rollback/replay using legacy aliases before production rollout. Multi-business creation is capability-gated while the old key is deployed.
2. Finish domain/orchestration decomposition and server-owned payroll disbursement. Operational PAID labels must never be used as the financial source of truth.
3. Bound remaining AI adapter history reads; collect controlled baseline/after render, network, storage and production latency evidence with a representative dataset. Do not relocate regions/increase pools without measurement.
4. Finish browser Add Business/Add Outlet/capacity/add-on and upgrade flows, expired offline metadata, revocation/reconnect, and hardware printing acceptance. Service-worker cold-offline boot is not yet implemented/verified.
5. Coordinate deployment only after the remaining gates pass; current local passing tests/build are not proof of production readiness.
