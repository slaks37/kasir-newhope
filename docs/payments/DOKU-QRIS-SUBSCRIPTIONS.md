# New Hope subscription QRIS release

Scope: New Hope SaaS subscriptions only. No merchant-to-retail-customer payment processing, production deployment, database cutover, new Auth provider, or channel activation is included. Supabase Auth/Storage remain in place. This branch starts from `a427fb83fda6509bb7b18fb8c0b7155ecc3f2e49`; it does not merge PR #21 or #23 or the separately deployed SEO patch.

## Status and evidence

**PARTIAL: application implementation ready for isolated validation; live QRIS acceptance remains unverified.** A Checkout URL is not payment proof. Mock success is not DOKU Sandbox or production success. See `scripts/dev/test-qris-subscriptions.ts` for the failure matrix and `scripts/payments/verify-qris-preview.ts` for native Neon tests. The implementation uses existing `billing.invoices`, `billing.subscriptions`, and `billing.payment_events`; no new production schema migration is required.

Initial findings against the base:

| Defect | Fix / code |
| --- | --- |
| Status inquiry substituted local amount/currency and did not check echoed invoice/reference | `services/billing/recovery.ts`: require provider amount, invoice, reference, currency and approved channel before fulfillment |
| Outbound Checkout omitted channel restriction even though incoming notifications were checked | `services/billing/routes.ts`: send configured `payment.payment_method_types`; QRIS release configuration uses `QRIS` |
| UI treated an already ACTIVE subscription as proof a renewal was paid | `src/lib/subscriptionPayment.ts` and `SubscriptionPaymentPage.tsx`: exact invoice PAID + APPLIED required |
| Checkout request key regenerated on each attempt/reload | Owner-scoped browser retry intent plus database tenant lock; different keys reuse one open payable invoice per subscription revision |
| Legacy fragment callback with invoice query was not recognized by workspace router | Use `/subscription?invoice=UUID`; test router resolution and auth return-path preservation |
| No mandatory payment activation guard; dashboard Business ID could reach gateway | `DOKU_PAYMENTS_ENABLED=1` required before provisioning/invoicing; reject `BSN-*` |
| Quote failure generated local fallback prices and trial could activate locally | Fail closed on quote/trial server failure; retain existing server trial policy |
| Gateway URL accepted without trusted host/environment check | `api/_doku.ts` and client helper enforce HTTPS official Checkout hosts |
| Replayed REVIEW receipt was always returned as DUPLICATE, which inquiry could mistake for applied | `services/billing/engine.ts`: retain previous non-applied outcome; response re-reads invoice ledger |
| Failure/expiry observations were not displayed | Serialized subscription-invoice status derives authenticated attempt/local deadline; never changes POS payment enum |
| Refund/reversal could be swallowed by paid-invoice duplicate handling | Persist REVIEW and hold for operator; do not invent a refund or revoke entitlements automatically |
| Base HTTP dependency lock contained known vulnerabilities | Compatible patch lock updates; audit must be rerun on final HEAD |

## Existing rules preserved

`src/config/saasPlans.ts` and `src/config/subscriptionPolicy.ts` remain authoritative and unchanged. Trial is 45 days, once per account. The existing two-outlet paid product is named **Tier Plus**, not Basic, in this repository; Pro includes four outlets. Plus monthly Rp99,000; Pro monthly Rp299,000. Annual totals, discounts, add-ons, proration, revision checks and renewal dates are calculated by the existing policy. Do not rename a plan or change prices as part of QRIS activation. Static marketing estimates never authorize a charge.

## Dynamic QRIS priority and DOKU confirmation

Owner update received 20 October 2026: DOKU recommends MCC **SOFTWARE STORES**, and activated QRIS services include Dynamic QRIS. This records the provider recommendation reported by the owner; it does **not** prove that the account's MCC was saved, risk/PTEN approval completed, QRIS is ACTIVE, or any API credentials/product were provisioned. Do not invent a numeric MCC or modify account settings.

The primary implemented flow is **Dynamic QRIS through DOKU Checkout**. DOKU's QRIS guide explicitly lists hosted Checkout as an integration that generates a transaction-specific QR. The existing Checkout API preserves application invoice numbers and server-calculated amounts and is appropriate while account-specific Direct/SNAP access remains unknown. DOKU generates/displays the QR; New Hope does not fabricate a local QR string or treat display as payment proof.

`DOKU_SUBSCRIPTION_PAYMENT_MODE=dynamic_qris_checkout` is the default and requires exactly `DOKU_ALLOWED_CHANNELS=QRIS`. `checkout` retains the existing hosted Checkout integration with explicitly configured approved methods. There is no automatic fallback to other channels. `direct_dynamic_qris` and unknown product names are rejected before provisioning an invoice/tenant or calling a provider. **Native SNAP QR generation, token exchange, inquiry and notification authentication are not implemented or activated**; they require a separately reviewed adapter and the merchant's actual API product/credentials. No endpoint has been invented.

The documented non-SNAP QRIS notification uses provider channel `QRIS_DOKU`, service `QRIS`, acquirer `DOKU`, and `emoney_payment.approval_code` without `transaction.original_request_id`. After HMAC authentication, the adapter maps this exact combination to Checkout method `QRIS` and preserves the raw provider channel in the allowlisted audit payload. Missing/wrong service/acquirer or payment reference stays REVIEW. The delivery Request-Id is never substituted for a QRIS payment reference. Existing invoices whose quoted scope is `QRIS` retain their scope without rewriting UUIDs, amounts or history.

`additional_info.origin.apiFormat=SNAP` in this documented **HMAC envelope** describes DOKU's processing origin; it is not permission to accept unauthenticated native SNAP headers. Native SNAP and archived WORDS-only callbacks remain rejected. The inquiry adapter handles the same documented identifiers only when actual provider evidence is returned; missing fields never fall back to local payment proof.

References reviewed:

- [DOKU QRIS guide: Dynamic QRIS through Checkout](https://docs.doku.com/accept-payments/no-integration-products/qris)
- [Checkout backend request and channel scope](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration)
- [Official non-SNAP QRIS notification sample](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap#qris)
- [Non-SNAP status inquiry](https://developers.doku.com/get-started-with-doku-api/check-status-api/non-snap)
- [QRIS activation and Sandbox limitation](https://docs.doku.com/get-started/manage-business/manage-payment-methods)
- [Notification setup including QRIS](https://docs.doku.com/get-started/manage-business/set-up-integration/webhook-payment-notification)

DOKU's merchant guide says QRIS is unavailable in Sandbox. An API-reference Sandbox URL/example is not evidence this merchant has a working QRIS simulator. All application tests remain mocked. Exact account/product entitlement, credentials, notification schema/configuration, inquiry capability and live success remain unverified.

## Durable payment flow / failure handling

1. Authenticate through the unchanged Supabase boundary; never trust browser tenant IDs or identity headers.
2. Calculate quote server-side, lock tenant, save invoice intent before provider call. Keys are scoped by tenant. Reject a different selection while its payable intent is open; an ambiguous timeout is held for inquiry, not recharged automatically.
3. Send signed request to one of two exact DOKU API origins, with bounded timeout and no HTTP redirect. Stable Request-Id equals invoice number. Validate the echoed invoice and amount before exposing the payment URL; reject missing/mismatched echoes. Restrict returned payment URL to official environment-specific hosts.
4. Hosted Checkout collects payment. Callback only requests invoice verification; it does not grant access.
5. Webhook authenticates original bytes, Client ID, request target, timestamp and constant-time HMAC. Receipt, invoice update, subscription and revision change share one database transaction. Failed transaction returns non-2xx so delivery can be retried.
6. Validate IDR amount, invoice channel scope and subscription revision. Different historic invoices at one revision cannot both grant entitlements; a real second receipt remains REVIEW and needs financial handling, never silently discarded/refunded.
7. Missing notification is recovered by invoice inquiry, either authenticated owner UI or `recoverPendingPayments()` operator/scheduler entry. Full provider response/customer data are not stored or logged; only allowlisted metadata and digest are retained. Bounded worker scans persist an UNVERIFIED inquiry-attempt marker and rotate by least-recent scan so unavailable old invoices cannot indefinitely starve newer ones. These markers contain no amount/reference or payment confirmation.
8. PENDING/FAILED/EXPIRED/CANCELLED observations never activate a subscription. Failed attempts can later succeed. Local due-date expiry is a display/intent deadline, not independent evidence that DOKU did not receive funds. Late success must still be reconciled.
9. Signed refund/reversal observations trigger REVIEW. No automated refund API, automatic cancellation or financial entitlement clawback is supported. A REFUNDED historical invoice displays REFUNDED only when already recorded by an authorized, evidenced process.

Background recovery is implemented but **no production scheduler has been activated**. Run only after approving the exact database/environment:

```sh
DOKU_RECOVERY_CONFIRM=SUBSCRIPTION_STATUS_INQUIRY npm run payments:recover -- --apply
```

Load private database/provider configuration securely beforehand; never paste it in terminal history or GitHub. The command refuses missing approval/config/TLS and outputs aggregate counters. It checks up to 20 unpaid invoices from the last 30 days per run with a 20-second start budget (an in-flight provider request may take another 15 seconds). It does not perform charges/refunds. Before unattended production use, integrate this entry into an approved existing scheduler and alert on REVIEW/unavailable/deferred. No new Vercel cron was added. Older/unscanned invoices require an operator checkpoint.

## Tests and isolated environments

- `npm run verify`: lint + both TypeScript projects, migration bootstrap, SPA/API build, runtime, security, financial, subscription, tenant, offline and other existing regressions.
- `npm run test:subscriptions`: original billing regression and 18 QRIS failure/recovery groups, embedded PostgreSQL, all provider HTTP intercepted.
- `npm run test:qris:browser`: actual React billing components -> loopback authenticated fixture -> isolated PostgreSQL -> signed mock notification; synthetic Auth context. Install Playwright Chromium or set `QRIS_BROWSER_EXECUTABLE` to an installed Chrome binary. No personal browser profile/session is read.
- `node --import tsx scripts/payments/verify-qris-preview.ts`: dedicated existing rehearsal branch/database `newhope_qris_preview`, role `newhope_qris_preview_runtime`, `sslmode=verify-full`; requires the private local env prepared by the explicit bootstrap. No real Auth accounts/payments/customer records.
- `node --import tsx scripts/payments/prepare-qris-preview.mjs`: bootstrap new **empty** synthetic target only; refuses populated targets and existing-role password rotation. Not an application startup path. Uses existing private rehearsal-owner credentials, writes new runtime env mode600. Does not recreate a completed database.

Native staging grants apply only inside this synthetic database: invoice/subscription CRUD, event insert/read, minimal tenant/merchant/outlet/plan/contract access. No inherited role membership, bypassRLS, database ownership, POS ledger or internal administrator access. Do not promote these test grants as an approved PR #21 production-role change. Production grants must be reviewed with that release independently.

Browser/backend fixture control endpoints exist only in an explicitly launched loopback test server. None are registered by application/Vercel code. Hosted Preview retains Supabase Auth, has payments paused, no DOKU credential, and cannot run paid-provider mocks from public requests. Positive provider tests remain local/native isolated evidence.

## Exact activation prerequisites from DOKU / owner

1. Verified production Business/Brand, **SOFTWARE STORES** MCC as recommended by DOKU, compliant name and proof of QRIS **ACTIVE** with DOKU/PTEN acceptance. Recommendation alone does not prove applied category or approval.
2. Confirm this Brand supports Checkout QRIS, correct Brand Client ID and shared key for that product, active `QRIS` channel, compatible non-SNAP signature + notification schema and status-inquiry response including invoice, amount and reference. If DOKU supplies only native SNAP access, keep live disabled and implement/test its separate adapter; do not route native SNAP credentials into the Checkout client.
3. Review exact HTTPS notification URL `https://kasir.newhope.space/api/v1/webhooks/doku` and callbacks. Preserve/export old provider settings privately before any approved change. No routing/configuration change has been performed.
4. Approve one controlled live subscription test: chosen existing plan/period, exact authoritative amount, account, payer, refund/support handling and spend limit. No arbitrary test price or real charge is pre-approved here.
5. Approve release target/environment after integration review with PR #21/#23 and the independently deployed SEO fix. This branch must not replace those deployments wholesale.

Proposed environment diff for later review only:

| Variable | Candidate value / rule |
| --- | --- |
| AUTH_PROVIDER | Keep Supabase; no Better Auth activation |
| DATABASE_URL | Keep the explicitly approved business DB; do not cut over as part of payments |
| DOKU_PAYMENTS_ENABLED | `0` until controlled live-test/release approval; `1` enables Checkout |
| DOKU_API_URL | `https://api.doku.com` only for approved live use; Sandbox uses `https://api-sandbox.doku.com` |
| DOKU_CLIENT_ID / DOKU_SECRET_KEY | Correct private production Checkout Brand credentials; never frontend variables |
| DOKU_ALLOWED_CHANNELS | `QRIS` after this account's activation and contract verification; `QRIS_DOKU` is a received provider channel, not an outbound Checkout method |
| DOKU_SUBSCRIPTION_PAYMENT_MODE | Default `dynamic_qris_checkout`; `checkout` only for an explicitly reviewed alternate hosted Checkout scope; native Direct is unsupported |
| PUBLIC_APP_URL | Exact HTTPS app origin `https://kasir.newhope.space` |
| Supabase Auth/Storage variables | Preserve existing authorized values |

Environment key metadata alone confirms that keys exist; encrypted/sensitive values were not retrieved or proven valid. No production environment changed. Missing `DOKU_PAYMENTS_ENABLED=1` now deliberately pauses Checkout; this fail-closed behavior is part of the reviewed release diff.

## Acceptance, monitoring and rollback

Live **NO-GO** until all account/contract/deployment gates and controlled payment verification pass. Required live evidence: displayed amount/method/expiry, actual QRIS success, signed delivery, matching inquiry, one PAID/APPLIED invoice, one subscription revision/entitlement update, retry no duplicate, history, and provider reconciliation/settlement visibility. Refund readiness must be agreed separately; a mock cannot prove it.

Monitor provider delivery/retry age, unpaid invoices nearing/after due date, REVIEW reasons (especially amount/channel/stale revision/refund), recovery worker unavailable/deferred, webhook 4xx/5xx, and unexpected paid-vs-entitlement mismatches. Never log bodies, keys, signatures, payer PII or tokenized Checkout URLs. Record exact deployment SHA and aggregate outcomes.

Rollback: pause **new** Checkout with the explicit activation flag, preserve and continue receiving authenticated notifications/inquiry for existing intents, export an independent encrypted checkpoint of invoices/events/subscriptions, and reconcile every provider receipt before changing code/database. Do not undo PAID rows, delete invoices/events, replay charges, or blindly restore an older DB after new payments. Because the base code contains the inquiry/UI defects, rollback to that implementation is not safe while paid intents remain; prefer a forward fix with payment creation paused. No financial refund/settlement/channel operation is authorized by this document.

## Updated component readiness

| Component | Implemented and tested | External gate |
| --- | --- | --- |
| Dynamic QRIS via hosted Checkout | QRIS-only default, unique invoice/request reference, authoritative pricing and response echo, trusted URL | Account Checkout QRIS API access and ACTIVE status |
| Payment verification | HMAC original bytes, QRIS_DOKU service/acquirer mapping, stable approval reference, amount/currency/invoice binding, raw-channel audit | Exact merchant notification/inquiry contract and private credentials |
| Entitlements/history | Existing atomic revision/invoice/event transaction; duplicate/late receipts and failed activation regression | Controlled live transaction and operational reconciliation |
| Failure/recovery | Failed/expired/cancelled states, retry intent, timeout hold, delayed notification, bounded durable inquiry rotation | Approved unattended scheduling/alerts; older invoices require operator checkpoint |
| Native Direct/SNAP QRIS | Deliberately unavailable; no guessed API or silent credential fallback | Product provisioning/documentation and separate adapter implementation |
| Production payment activation | OFF; no paid transactions/deployment or environment change | Explicit release and controlled live-test approval |
