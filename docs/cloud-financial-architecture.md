# Cloud financial source of truth

## Authoritative records

Authenticated devices write stable commands through the POS API. PostgreSQL
`pos.transactions` and successful `pos.payments` record sales; immutable
`pos.transaction_refunds` / `pos.transaction_refund_items` record returns;
`pos.cash_ledger` records signed cash events and compensating reversals.
Voids retain their transaction and activity audit. Operational shared JSON cannot
override financial values or be used as the revenue ledger.

`contract.merchant_revenue` is the single recognition rule used by POS reports,
admin totals and the server AI adapter. It requires a completed/settled sale
covered by successful payments, sums split tenders once, excludes void/cancel,
and subtracts immutable refunds. Reporting attributes net revenue to the original
sale date; cash events use their actual event timestamps. Product quantities and
HPP support three decimal places (e.g. laundry kg).

## Device reads and writes

- Login → owned tenant/merchant → active outlet → shared/cloud readiness → POS.
- `GET /api/v1/reports/summary` and `/reports/transactions` validate ownership,
  merchant, outlet, calendar dates and IANA timezone. Summary reads use a
  repeatable-read snapshot. Historical deactivated outlets remain reportable.
- Reports/overview/exports read server aggregates, never local order sums.
  Recent receipts are a bounded cache; detailed reports use server pagination.
- Device transactions/refunds/manual cash are durably queued before sending,
  and removed only after a successful server acknowledgment. UUID command IDs
  and server uniqueness/row locks protect retries across devices.
- Shared operational data uses per-record revisions, retains local conflicts,
  and stores only whitelisted non-financial order metadata.
- Header distinguishes cloud readiness, pending commands, failure and last
  successful read/write. Server read failures are not displayed as a zero sale.
- Automatic refresh and focus/online/financial-update events fetch server data;
  propagation is polling-based, not an instantaneous push guarantee.

## One-time legacy recovery

Before replacing the receipt cache, capture exact original owner/sector-scoped
orders, cash movements and retired financial outbox bytes. Import through the
same durable API outbox; persist ACK checkpoints. Never erase original snapshots.
Competing/malformed versions remain visible for recovery, not guessed or dropped.
Legacy non-UUID outlet references require the owner to confirm their actual
origin; the currently selected outlet is never silently substituted.

The original laptop/browser must open the deployed app while logged into the
same owner account. A server cannot recover localStorage from an unopened device.
Other owners' sources remain untouched. F&B and Laundry keep their active trial
slots; Carwash remains deferred as explicitly requested, including pending sales.

## Security and deployment

Browser roles have no access to private financial contracts/ledgers. POS writes
are tenant/merchant scoped with RLS; admin/AI retain derived contract-only reads
without gaining raw POS grants. Existing private service contract views are
owner-executed in the unexposed contract schema, with HTTP ownership/RBAC required.
The migration is additive, preserves view dependants and financial audit, and
does not expand billing permissions.

Apply migration 0044 before deploying the new API/client. Bundles are generated
with `npm run build` and tracked according to this repository's existing layout.

## Verification

`npm run test:financial-cloud` runs an isolated PostgreSQL engine and real local
HTTP API: Device A sale Rp55,000 → server → Device B read → Admin equality;
retry/no duplicate, ownership/outlet/date/timezone isolation, partial/full refund,
void audit, immutable cash, split-tender completion, decimal quantities, shared
shift/tender totals, original-method mixed cash refunds and service/browser grants.
This is automated device simulation, not two physical devices.

Also run lint/build, sync, subscriptions and intelligence suites. Production
verification uses existing owner data; do not create fake financial test events.
Physical Epson TM-T82 printing remains untested because no printer was available.
The advanced AI workspace still explicitly labels its device-based operational
prototypes/drafts; official financial reports and overview brief are server-backed.
