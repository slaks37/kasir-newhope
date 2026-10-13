# Merchant payments and consumer transparency — review/staging only

## Two independent payment systems

DOKU remains the existing **New Hope SaaS subscription** integration, with its own billing invoices, webhook signatures, amount/currency checks and idempotency. This change does not route POS merchant receipts into billing, activate subscriptions from merchant PSP events, or add custody balances. Existing mocked DOKU tests are regression evidence; they are not live sandbox certification.

POS payments are merchant receipts: new sync/tender writes are `CASHIER_RECORDED` regardless of a browser-supplied verification claim. Existing rows become `LEGACY_UNVERIFIED` when the additive metadata default is applied, never retroactively `PROVIDER_VERIFIED`. Amounts, order status and cash movements are unchanged. The owner report separates these origins; printed/WhatsApp receipts identify commercial records and warn that a POS status is separate from provider verification. `PAID` is the POS ledger status, not proof of settlement.

Cashiers must inspect their **merchant-owned provider application**, not a customer's screenshot. Static QRIS amount matching cannot uniquely identify an order. Customer payments and settlement remain in the merchant's approved account with a licensed provider. New Hope records receipts and does not represent itself as a licensed payment provider.

## Adapter and exception design

`services/pos/paymentReconciliation.ts` is a server-only integration boundary, **not a configured/live PSP webhook**. A provider-specific adapter must authenticate original bounded raw bytes, the official signature protocol, timestamp window and merchant account before normalization. Its tenant/merchant/provider binding comes from approved server configuration, never request body. No made-up generic signature is presented as an actual PSP protocol. Tests use an expressly fictional HMAC fixture.

A private account requires merchant-direct settlement, recorded owner approval and licensing review reference; inactive by default. The presence of a reference is not regulatory verification. Backend-created links must identify both provider payment and exact order, with tenant/merchant/account checks. An amount-only event is an immutable exception. Correct account, IDR currency, exact amount, existing non-cash payment, order reference and eligible ledger state are required before marking verification metadata. It never creates a payment, moves money, marks a pending order paid, reverses refunds, or changes SaaS subscription state.

An account lock serializes delivery; `(account, provider event)` is unique and a normalized hash makes exact retries idempotent. Reusing an event ID with changed contents fails closed. Providers reusing a payment ID across lifecycle updates need a distinct authenticated **delivery event ID**, not the payment ID as event key. Malformed, oversized, unsigned/stale or wrong-account deliveries fail before financial updates. Missing linkage, unsuccessful status, currency/amount mismatch or closed/refunded ledger state create an immutable exception. Raw provider payloads and personal fields are not persisted.

Operational follow-up: persist rejected/conflicting delivery diagnostics without secrets in the reviewed provider adapter; separate authenticated settlement/reconciliation reports from payment-success confirmation; verify fees/net settlement in the merchant's provider account. A successful payment webhook alone is not a bank settlement statement. A designated owner reviews each exception against the provider's authoritative portal and records a new correction decision with financial approval where needed. Do not edit/delete immutable evidence. An adapter, onboarding/provisioning endpoint, exception-resolution UI, secret rotation and live provider sandbox certification still require a selected provider and owner approval.

[Bank Indonesia QRIS guidance](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/default.aspx) and [PBI 10/2025](https://peraturan.bpk.go.id/Details/342569/peraturan-bi-no-10-tahun-2025) are legal-review sources. Counsel must verify actual PSP authorization, New Hope's role, outsourcing/partnership obligations, applicable dates and contracts. No compliance certificate is asserted.

## Staging, rollback and production verification

1. Inspect backend `DATABASE_URL` role and TLS trust, backups and migration state. Apply `20261013033222_merchant_payment_provenance.sql` to isolated staging **before** new writers. `migrations/0062_...` is identical local bootstrap SQL; apply one path once. New private tables have tenant-scoped service RLS; existing business RLS is unchanged.
2. Run `npm run verify`, signed-fixture payment tests, two-cloud-owner report negative tests, all five-sector sales/refunds/offline reconnect and existing subscription/DOKU tests. Both tenant and outlet scopes must deny guessed references.
3. With a selected licensed provider, approve merchant-owned settlement/account binding and its official adapter. Test wrong signature/credentials/time/account, duplicate/conflicting/out-of-order delivery, wrong currency/amount, nominal-only ambiguity, refund/void state, provider outage and secret rotation against **that provider's sandbox**. The fixture is insufficient for production approval.
4. Production requires reviewed migration, owner-approved rollout, server/browser compatibility and exact release SHA. Verify read-only account/report health; do not manufacture real orders or payment events as smoke tests. Observe exceptions and reconcile bank settlement separately. No production accounts, provider links, webhook or SQL were activated here.
5. Rollback app to a secure compatible build, keep metadata/evidence tables and historical origin distinctions, and disable only an unapproved reconciliation adapter if it exists. Do not erase evidence or restore a client-controlled verified flag. Old writers leave `LEGACY_UNVERIFIED`; they cannot assert verification. A destructive schema rollback is inappropriate after evidence exists; unused additive tables can remain until counsel/retention review.

## Landing and subscription claim review

Reviewed `src/components/home/HomePage.tsx`, `src/config/saasPlans.ts`, `src/components/payment/SubscriptionPaymentPage.tsx`, billing engine/webhooks and POS receipt/sector settings against repository behavior. This is code evidence, not proof of production activation or merchant hardware compatibility.

| Claim | Evidence and qualification |
|---|---|
| 45-day trial | Once per owner, 2 active outlets, limited AI quota; Free afterwards selects 10 products/1 outlet/owner only/no AI. Legal notice in privacy PR states these restrictions. |
| Tier Plus/Pro | Plus Rp99,000/month or Rp950,400 paid yearly, 2 outlets; Pro Rp299,000/month or Rp2,978,040 yearly, 4 outlets. Extra outlet Rp79,200/month or Rp760,320 yearly. Verify actual invoice before payment and keep notices synchronized with plan configuration. |
| Renewal / saved card | Server verifies period invoice; code does not establish automatic card debit. Do not advertise auto-debit or a provider recurring mandate unless actually configured and separately accepted. |
| Refund / cancellation | Owner/counsel must approve final commercial time limits, proration and exceptions. Draft terms offer request intake, preserve mandatory consumer rights and explicitly mark undecided terms; no invented guarantee or blanket exclusion. |
| QRIS | Landing already says “catat” and directs provider-app confirmation; merchant owns QRIS/account, settlement/fees follow PSP, no New Hope custody. New checkout explains nominal ambiguity. |
| Offline | Cash sales on a device that has loaded/cache-stored the app; cloud/QRIS/provider AI require internet. Financial approval PR requires online server authority for privileged void/refund/cash-out. Unsupported cold-start/new-device offline is not promised. |
| Five sectors | FNB/RETAIL/LAUNDRY/CARWASH/BARBERSHOP workflows and financial regression exist; country/municipal tax treatment still needs accountant review. |
| AI | Both Agnes AI and DeepSeek preserved; optional generative suggestions, server consent/minimization in AI PR; no guaranteed profit, execution or zero-retention claim. |
| WhatsApp / printing | User-assisted wa.me and OS printer driver; not automated messaging or certified receipt-printer integration. No messages were sent in this audit. |
| Invoice / tax | POS receipt and subscription commercial invoice are **not official Faktur Pajak**. Tax label/rate is business/sector configurable; do not hard-code one universal PPN/PBJT/PPh rule or claim automatic e-Faktur issuance. Merchant/accountant verifies PKP status, local rules and issuance obligations. |

Final company identity, registration numbers, service contact, pricing taxes/fees, marketing approvals, refund policy and tax treatment require owner/legal/accounting verification before public release. The privacy PR provides draft `/privacy`, `/terms`, `/support`; placeholders are a release gate, not completed legal approval.
