# Online-first migration — verification record

## Implemented

- Authenticated owner ID scopes client storage, business IDs and all server sync calls. Selecting another cashier profile no longer changes the store identity.
- Operational records (products, categories, tables, customers, orders, shifts, staff, local role profiles, stock items/logs, bookings, KDS, payroll and other POS collections) use an owner/sector-scoped server store. A per-record durable outbox survives reloads; accepted writes have revisions and an admin-visible audit event. Polling runs every six seconds, on focus and after reconnect.
- Stale edits receive a conflict instead of overwriting another device. The owner can keep the server version (with a local recovery copy) or explicitly rebase the local edit. One unresolved conflict holds the batch for review.
- Catalog writes use explicit versioned product mutations and tombstones; the legacy full-snapshot endpoint no longer retires omitted products. Product metadata is mirrored into `pos.products`. Stock is **not** overwritten in the normalized ledger by catalog sync.
- Migration `0043_shared_pos_state.sql` / Supabase `20260930121546_shared_pos_state.sql` creates dedicated storage with RLS, tenant/merchant policy and `svc_pos`-only access. The handler sets transaction-local scope before reading/writing.
- Financial transactions still use the idempotent normalized ledger, not an order UI snapshot. Admin revenue/profit come from that ledger. The trial outlet cap and queued Carwash sales remain unchanged.
- A sale for an inventory-linked product now prepares a primary stock location when a new outlet has none, and writes stock movement against the transaction's outlet. Voids restore stock to that original outlet, including when submitted from another active branch.
- Receipt and return receipt printing use an isolated iframe with loaded styles/images/fonts and surfaced browser errors. Chrome print preview rendered a 30-line fixture through the footer.
- The cloud outlet gate now blocks a new checkout while outlet capacity cannot be verified or the active outlet has not been selected. Pending Carwash sales remain in their original queue; entitlement rejection pauses automatic retries until the outlet changes.
- A completed sale, void, or payment of a previously held order first persists its financial event to the durable outbox. A full/corrupt browser store now fails visibly instead of reporting success or overwriting recoverable queue bytes. Paying a held order also submits the normalized transaction for admin reporting.

## Remaining limitations and decisions

- Local cashier profiles are an owner-authenticated kiosk role mechanism, not independently authenticated employee accounts. A real employee membership model would need separate Auth identities and server-side role enforcement.
- Operational changes propagate on polling rather than live push. A conflict needs human resolution; it cannot be silently auto-merged.
- Stock quantities shown in the client can still conflict across simultaneous devices; the normalized inventory ledger remains authoritative. Reconciliation/hydration of per-outlet inventory balances is a separate step before claiming fully accurate live stock.
- Old cashier-specific storage and transaction queues are preserved. They are not automatically reassigned to an owner; recovery requires reviewing their identity and business scope.
- F&B and Laundry occupy both trial outlet slots. Carwash stays deferred and its two queued sales must not be sent as another branch or discarded. They can sync only after an outlet slot is freed or capacity is upgraded.
- Production acceptance is still pending: the last read-only check found zero normalized transactions and zero shared operational records. This matches the deferred Carwash outlet, not proof that a two-device sale has reached admin. A real sale on an active outlet and a second-device readback must be verified before claiming cloud-first completion.
- Successful checkouts can still be queued locally during a transient server failure; the UI must distinguish cloud-confirmed from pending for a strict online-first guarantee. Operational collections still use local cache and full-state polling, and customer/attendance/payroll retain separate legacy mirror writes. These are follow-up migration steps, not solved by adding a load balancer.
- Epson TM-T82 Bluetooth on Windows + Chrome has **not** been physically tested; the owner has no printer available yet. Browser print preview does not prove driver, pairing or physical output.

## Checks

`npm run lint`, `npm run test:subscriptions`, `node --import tsx scripts/dev/test-shared-state-client.ts`, `node --import tsx scripts/dev/test-sync-boundary.ts`, `npm run build`.

Browser-only synthetic print fixture: `scripts/dev/receipt-print-fixture.html`. It contains no client credentials and performs no backend writes.
