# Invite-only beta release lanes

Beta does not depend on DOKU activation. Keep the currently approved DATABASE_URL,
Supabase Auth/Storage, pricing and tenant/POS policies. No migration is required.
Do not deploy this PR wholesale over current production: prepare a small release
patch on the exact live SHA and retain the deployed SEO changes. PR21 and PR23
remain independent; this document does not authorize their merge or promotion.

| Lane | Gates | Production action |
| --- | --- | --- |
| BETA_ACCESS | BETA_ACCESS_MODE=invite_only, private BETA_ALLOWED_SUBJECTS (verified Supabase UUIDs); disable public Supabase signup under explicit approval; invite only approved users | Eligible for controlled release after owner approves exact SHA/config; no paid flow needed |
| MANUAL_EXTERNAL_PAYMENT | MANUAL_EXTERNAL_PAYMENTS_ENABLED=1, private MANUAL_PAYMENT_PILOT_TENANTS and MANUAL_DOKU_BRAND_ID; real Payment Link service capability, runtime write permissions and operator acceptance | OFF until separately approved; no GRANT_PLAN-to-paid conversion |
| AUTOMATED_DOKU_CHECKOUT | DOKU_PAYMENTS_ENABLED=1 AND private DOKU_CHECKOUT_PILOT_TENANTS; QRIS ACTIVE/product/credential/notification/inquiry verification and controlled payment approval | OFF; an empty/malformed/wildcard pilot list rejects every tenant |

Beta gate runs after trusted authentication and before business runtime/DB access
in native Vercel, shared serverless APIs and gateway. Unknown subjects cannot
self-invite via email, user_metadata, tenant IDs or forged headers. Admin routes
retain their separate role/MFA guards. Malformed beta configuration fails closed;
unset/open preserves existing deployments until an approved beta configuration.
Public blog, plan catalog and authenticated provider notification surfaces remain
available. A gate is not a Supabase signup setting: disable public new-user
registration separately before calling this an invite-only launch. Auth identities
are not migrated. Verify existing direct browser database grants remain denied.

The existing new-account trial lasts 45 days from canonical signup/tenant creation.
Existing trials are not reset; complimentary grants are not payments. AI usage
continues using existing quotas and approved providers; this release activates no
new paid AI service. Removing an allowlist UUID stops server access but does not
delete that user's cached offline data; rollback must retain/reconcile pending POS
writes rather than clear browser storage.

## Manual Payment Link SOP (private operator workflow)

DOKU documents Payment Link as a dashboard no-integration product. Its availability
for New Hope and the actual active methods remain unverified. Do not create/share
a real link until owner payment approval; do not activate channels or assume QRIS
works before ACTIVE. Official guides:

- https://docs.doku.com/accept-payments/no-integration-products/payment-link/create-payment-link
- https://docs.doku.com/accept-payments/no-integration-products/payment-link/manage-payment-link

1. Superadmin with fresh MFA calls the existing support route
   `POST /api/admin/tenants/<verified tenant UUID>/support` with
   `action=ISSUE_EXTERNAL_QUOTE`, a reason (10–2000 characters), existing planId,
   billingCycle and extraOutlets. Backend pricing produces one outstanding quote,
   24-hour deadline, frozen period/revision and reference `NHM-<quoteId>`. Retries
   reuse an outstanding matching quote; a conflicting selection is rejected.
2. On the correct production DOKU Brand, create a **Single Payment Link**, fixed
   IDR amount, no partial payment, one full payment, the same order reference and
   expiry no later than the quote deadline. Preserve its private provider ID.
   Confirm customer/tenant ownership using the application account, never email
   similarity alone. Share only after explicit payment approval.
3. Operator reads the authenticated provider transaction detail/report. Require
   final **Paid**, matching Brand, order/reference, exact amount/currency, unique
   provider receipt, time and absence of refund/reversal. A customer screenshot,
   redirect, link creation or Partially Paid is insufficient. Export evidence to
   approved private storage; compute SHA-256; never attach records to GitHub.
4. The same MFA-protected route accepts `action=VERIFY_EXTERNAL_PAYMENT`, quoteId,
   reason and proof fields: brandId, invoiceNumber (`NHM-<quoteId>`), reference,
   amount, currency=IDR, status=PAID, paidAt, evidenceId (private opaque reference),
   evidenceSha256, confirmation=PROVIDER_DASHBOARD_PAID_VERIFIED. This is an
   explicit audited human attestation, not automatic provider verification.
   Never place credentials, full report, payer PII or tokenized URLs in proof.
5. Invoice, unique receipt, entitlement/revision and mandatory support audit commit
   together. Audit/DB failure rolls everything back. Tenant lock + database-wide
   provider receipt lock/unique event prevent concurrent/different-tenant reuse.
   Modified proof for an existing receipt conflicts. Expired quotes stop for
   reconciliation; stale revision/outstanding financial conflict records REVIEW
   without fulfillment. An already-paid receipt cannot pay another invoice.
6. Verify the PAID/APPLIED invoice, exactly one revision and correct period against
   provider evidence. Reconcile daily by Brand/reference/order/tenant/amount/status;
   escalate missing, partial, refunded, stale or duplicate receipts. Keep grants
   separate: GRANT_PLAN is complimentary and creates no paid invoice. No automatic
   refund, clawback, charge or outreach exists in this workflow.

Manual and automated payment creation are mutually exclusive in this pilot. Their
release decisions are independent from beta. Provider notifications on already
opened orders continue to be processed; pausing new checkout does not delete debt
or settle a refund. Internal runtime roles must already support invoice/event
inserts, subscription updates and audit inserts; test actual role permissions
before manual activation. No grants/credentials/schema were changed here.

## Testing and release/rollback

`npm run test:beta` checks both native gates and malformed config before DB.
`npm run test:subscriptions` covers trial/RBAC/MFA, financial atomicity, manual
receipt concurrency/replay/stale revision/complimentary isolation, QRIS pilot API
rejection and existing QRIS regressions. Run lint/build and affected financial,
tenant-isolation/security suites; browser fixtures explicitly allow their one
synthetic tenant. No live provider operation is part of these tests.

Stage a production build only after owner approves target/config, with `vercel
--prod --skip-domain`, smoke that exact staging deployment, then promote its ID
under the separate final approval. Do not promote a Preview as a tested production
build: that rebuilds with different environment values. Preserve exact production
base, patch hash, environment key diff, signup-setting baseline and rollback ID.
No production deploy/flag/credential/signup/entitlement is authorized by this file.

Rollback must retain invite/payment restrictions; blindly returning to a prior
build that lacks gates can reopen access. Pause payment/manual creation and keep
signed receipt processing; preserve all invoices/events/audits/new POS writes.
Use a previously staged gated fallback or forward fix. Do not restore an old DB,
delete customer data, reset a trial, replay charges or auto-refund.
