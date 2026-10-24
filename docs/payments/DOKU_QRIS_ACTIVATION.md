# DOKU subscription commercial release — 24 October 2026

## Decision and preserved production

**BLOCKED_EXTERNAL for commercial launch.** Code and mock acceptance are not a real DOKU payment. No production migration, environment change, promotion, channel activation, credential reset, or live transaction is authorized by this patch. Full Neon signup, managed Auth, Storage, trial45, prices and merchant POS remain unchanged. Existing production recovery reference: `050347828c54857a506a630b708d5cd9b9002224`, deployment `dpl_3rmFrZpteS3RRgpcGRVqK6ugPGTM` in Singapore. Reconfirm this before any release; do not overwrite newer production.

PR26 remains based on Full Neon PR25. Selected payment safeguards were ported from the older payment work; no whole PR21/23/24 merge and no Supabase runtime restoration.

## Findings and implemented fixes

| Severity | Root cause | Fix and evidence |
| --- | --- | --- |
| P1 | Billing history and direct verify exposed legacy mixed-channel payment links | One server policy freezes integration, channel scope, acceptance, revision and expiry. Legacy links are suppressed; historical quotes/amounts remain. QRIS regression and independent F1 cover history/API/callbacks. |
| P1 | Concurrent receipts or late refunds could erase holds or reuse a provider reference | Global reference lock, invoice/tenant locks, atomic event+entitlement transaction. Refund/reversal suspends the current affected paid revision for review, preserving paid history and dates; FAILED attempts cannot undo SUCCESS. Independent A1–A5 and shared-reference tests. |
| P2 | Per-request inquiry and three-second polling could storm DOKU | Durable database-clock lease, sixty-second cooldown across instances, initial local observation, bounded three delayed browser polls; provider timeout retains lease. F2, skew, concurrency and timeout tests. |
| P2 | ORDER_EXPIRED locally reusable; retry returned the old invoice | Provider terminal state closes payment action; one replacement per tenant/revision under concurrent retry; old invoice preserved; late conflicting receipt held. F3 and delayed-notification tests. |
| P1 | Payment activation tied to global Full Neon guard and environment presence | Payment-only readiness gate; durable operator acceptance matching credential fingerprint, API, exact method set, verified webhook, time and pilot tenants. Runtime can SELECT but cannot write acceptance. OFF short-circuits without acceptance reads; Auth/POS/trial do not depend on payment configuration. |
| P2 | Checkout expiry and returned method scope insufficiently validated | Official signed request; echoed invoice/amount/currency/methods, official URL and calendar-valid future UTC+7 expiry required. Contract transport tests. |
| P2 | Client fallback quotes, ACTIVE subscription or redirect could imply payment success | Server quote required, exact PAID+APPLIED invoice only, scoped persisted retry key, single-flight buttons, explicit Indonesian pending/expired/review/unavailable states. Trial has a separate success label. |
| Release | PR26 originally had stale committed serverless bundles | Rebuild all generated API bundles; CI rejects any source/bundle drift. |

## Provider evidence and limits

- Authenticated production brand matched the account owner. Owner screenshots show checked Checkout-display methods: BRI, BNI, Permata, DOKU VA, CIMB, Danamon, BSI, Maybank, BJB, Sinarmas, BNC, BTN; DOKU Wallet; Alfa Group and Indomaret; Akulaku. **These are display selections, not independent ACTIVE/API/settlement acceptance. QRIS was not visible.**
- Settings panel intermittently renders an empty embedded frame in the automated session. No provider setting was saved.
- Read-only signed GET to the official status endpoint for a deliberately nonexistent synthetic invoice returned HTTP404 `data_not_found` at 2026-10-24T00:44:38Z. No order was created. This is not Checkout/channel acceptance or a successful transaction.
- Owner-supplied credential was stored only in an ignored mode600 local file. Because its secret was supplied in chat, **equivalent owner-managed rotation is required before live activation**. No credential value or fingerprint is published here. Do not automatically rotate/reset the account credential.
- Production Vercel metadata audit at 2026-10-24T00:37:53Z showed CLIENT_ID, SECRET_KEY, API_URL and payment flag names present. Values were not exported. Allowed channels, activation approval, release scope, acceptance ID and pilot tenant names were absent. Variable-name presence does not verify the currently deployed snapshot or correct credential values.
- DOKU support recommended SOFTWARE STORES. Actual MCC/merchant approval and QRIS ACTIVE remain provider gates. No QRIS sandbox simulator or fabricated receipt is required/claimed.

## Exact flow and channel policy

Authenticated owner → authoritative server quote → persistent invoice with UUID, revision, unique provider invoice number, frozen plan/period/outlets/channels → signed POST `/checkout/v1/payment` → validated `response.payment.url` → browser Checkout → signed raw-byte notification → durable atomic payment event, invoice and subscription → authoritative UI read. The redirect never settles an invoice.

Default product mode is `dynamic_qris_checkout`, allowing exactly `QRIS`. `checkout` prepares the documented VA subset in `dokuSubscriptionPolicy.ts`; an independent acceptance and explicit owner-approved method scope are still mandatory. VA BRI has a synthetic end-to-end acceptance regression (including missing reference and duplicate receipt); this does not verify the live channel. Other dashboard selections are not silently enabled. Maybank, Sinarmas, wallet, retail and PayLater are not claimed as tested fallback integrations. Select one documented VA for a separate controlled acceptance if QRIS is pending; no fallback auto-switch.

Notification: **https://kasir.newhope.space/api/v1/webhooks/doku** (public HTTPS POST, exact target, raw body, no application JWT).
Browser return: **https://kasir.newhope.space/subscription?invoice=SERVER_INVOICE_UUID**.
Checkout POST: **https://api.doku.com/checkout/v1/payment**.
Read-only inquiry: **https://api.doku.com/orders/v1/status/PROVIDER_INVOICE_NUMBER**. Wait at least60 seconds after customer payment completion; webhook is primary. An initial status observation primes the durable cooldown. Local polling does not itself imply payment completion.

Replay protection validates timestamp (maximum13h old, including the documented12h provider retry window), exact signed raw bytes, client ID, target and single header values; stored content digest detects changed-payload event-key reuse. Financial holds cannot be cleared through PAYMENT_NOTE. Complimentary GRANT_PLAN remains distinct from paid provider evidence.

Recovery function `recoverPendingPayments` is bounded and uses the same durable lease; it creates no charge. The existing authenticated billing-reminders cron calls it only when `DOKU_RECONCILIATION_ENABLED=1` (default OFF). It filters current approved scope before LIMIT, so legacy holds cannot starve valid invoices. No new cron or schedule change is introduced. The existing daily schedule is a daily unattended safety net, not a promise of immediate recovery: the first run primes the lease and a subsequent permitted run inquires. Customer callback/status checks recover sooner. Keep reconciliation enabled when pausing new Checkout. Operator must monitor unresolved REVIEW/UNAVAILABLE events; no automatic refund or manual mark-paid bypass exists.

## Release configuration (prepare, do not apply to production)

Apply additive `migrations/0064_doku_release_acceptance.sql` using the migration role after reviewed backup/schema acceptance. It adds no customer seed, rewrites no invoice and revokes runtime write access to acceptance. Keep this table and all payment events on rollback.

| Variable | Pilot candidate value / requirement |
| --- | --- |
| FULL_NEON_CLEAN_START / FULL_NEON_TARGET / AUTH_PROVIDER | Existing `1` / `production` / `neon` |
| DOKU_PAYMENTS_ENABLED | `0` until explicitly approved pilot activation |
| DOKU_API_URL | `https://api.doku.com` |
| DOKU_CLIENT_ID / DOKU_SECRET_KEY | Owner-rotated, independently verified existing production account credential; encrypted/sensitive server-only |
| DOKU_ALLOWED_CHANNELS | Exact approved methods; `QRIS` only if ACTIVE and accepted |
| DOKU_SUBSCRIPTION_PAYMENT_MODE | `dynamic_qris_checkout` for QRIS; separately approved `checkout` for VA fallback |
| DOKU_ACTIVATION_APPROVED | `0` until specific owner approval, then `1` for the reviewed pilot |
| DOKU_RECONCILIATION_ENABLED | `0` initially; `1` only for approved existing-invoice recovery, including during a Checkout pause |
| DOKU_RELEASE_SCOPE | `pilot`; never default to public |
| DOKU_CHECKOUT_PILOT_TENANTS | Exact approved UUIDs, no wildcard |
| DOKU_ACCEPTANCE_ID | Unexpired, unrevoked operator-created acceptance row with credential/channel/API binding and evidence references |
| PUBLIC_APP_URL | `https://kasir.newhope.space` |

The acceptance row requires credential and webhook verification timestamps, owner approval reference and SHA256 of a private provider evidence package. PILOT also freezes tenant UUIDs. PUBLIC additionally requires a genuine verified live-payment timestamp and explicit public-release approval. Mock/SANDBOX acceptance cannot authorize production. Runtime SELECT-only cannot self-approve. Future-dated acceptance evidence is rejected. Migration alone does not insert an approval row.

For Preview use the existing isolated Full Neon staging branch/database/storage and **synthetic signing keys only**, sandbox API and payment flag0. Do not send live credentials to Preview. Non-production mock tests may seed SANDBOX evidence only in an isolated fixture database. Never copy those rows into production.

## Controlled live acceptance — requires separate owner approval

1. Owner/DOKU: confirm exact ACTIVE channel, Checkout capability, merchant/MCC, settlement/refund procedure and credential rotation. Record evidence privately. Configure channel-specific notification URL only after showing exact old/new setting and rollback to owner.
2. Engineer: verify reviewed exact source, full CI, native PG security/concurrency, staging Preview; apply additive schema via approved deployment procedure. Stage immutable production candidate with flag0, inspect notification routing and absence of Auth requirement. No automatic promotion from this PR.
3. Owner: approve exact pilot tenant, existing plan, billing cycle, server-calculated amount, maximum spend, payment channel and target deployment. Use existing catalog price; do not lower production pricing to manufacture a cheap test. A plan-plus monthly quote may be Rp99.000 before legitimate credit/add-ons; final authoritative quote controls.
4. Engineer: record PILOT acceptance bound to rotated credentials and approved scope. Enable only that tenant on the reviewed candidate after authorization. Other tenants must receive403; no other payment routes are opened.
5. Owner completes the payment on DOKU. Engineer never operates a live payment button without applicable authorization. Track invoice number and private provider reference, not screenshots as settlement proof.
6. Verify independently: correct provider SUCCESS, signed public POST persisted with2xx, exactly one APPLIED event and one subscription revision, exact amount/currency/channel/tenant/plan/period/outlets, refresh/login access, provider dashboard/inquiry agreement and expected settlement. Repeated receipt cannot extend twice.
7. If any mismatch, keep commercial NO-GO, pause new Checkout, preserve invoices/events and route to reconciliation. Do not fabricate PAID, charge again, or automatically refund. Public rollout requires a second explicit approval after genuine pilot acceptance.

## Recovery and rollback

- Pause new Checkout (`DOKU_PAYMENTS_ENABLED=0`) through an approved new deployment; leave signing credential, approved method scope, public webhook and reconciliation available for already-issued orders. Disabling Checkout must not lose late receipts.
- Preserve main Neon, Auth, Storage, append-only events, invoice history, trial state and all post-release business writes. Do not reset/drop environments or revert to Supabase.
- Keep0064; rolling back application code must not remove receipt history/acceptance. Prefer a payment-disabled Full Neon fix-forward build. Reconfirm production SHA before using the recorded0503478 deployment; reverting to an older serverless handler after live invoices exist requires a compatibility review and reconciliation worker.
- For refund/reversal, system holds the affected current paid subscription for human review. Owner/provider handles actual refund/settlement; record outcome as new evidence, never edit paid history.

## Reproducible validation

`npm run verify` runs lint/typechecks, complete migrations, build, runtime and regression suites, including DOKU contract/QRIS/adversarial/durable-acceptance tests. `.github/workflows/security-postgres17.yml` additionally creates a separate disposable loopback PG17 payment database and runs real multi-connection races. Provider transport is mocked; no real financial operation occurs.

`node --import tsx scripts/payments/browser-fixture.ts` serves loopback-only PGlite/actual billing UI with synthetic Auth and mock Checkout. Use the browser controls against the printed URL. Fixture endpoints are not imported by production, and the banner explicitly identifies synthetic data. Browser callback can be checked via `/subscription?invoice=FIXTURE_UUID`; only a synthetic signed delivery changes fixture status. There is no claim that the fabricated hosted URL is a legitimate provider order.

## Official contracts

- [Checkout backend and UTC+7 expiry](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration)
- [Supported exact method tokens](https://developers.doku.com/accept-payments/doku-checkout/configuration/supported-payment-methods)
- [Non-SNAP HMAC signature](https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-component-from-request-header)
- [Notification configuration](https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url)
- [Notification retries and FAILED attempt semantics](https://developers.doku.com/get-started-with-doku-api/notification/best-practice)
- [Official inquiry and sixty-second timing](https://developers.doku.com/get-started-with-doku-api/check-status-api/non-snap)
- [QRIS activation](https://docs.doku.com/accept-payments/no-integration-products/qris)
