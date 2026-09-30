# Online-first migration — work in progress

Status: local implementation checkpoint, not a completed migration or production release.

## Verified in this checkpoint

- Store storage keys, business IDs and synchronization targets use the authenticated owner, not the selected local cashier profile. Switching local roles no longer reloads another store's collections.
- Native POS handler permits authenticated catalog GET and attendance/payroll POST, with explicit method checks. Anonymous/forged-principal tests reject before DB access.
- Catalog GET no longer references the nonexistent `pos.categories` table. Categories derive from product category names with matching IDs. Reads and snapshot retirement are merchant-scoped, not tenant-wide.
- New remote products no longer receive fabricated stock of 100. Inventory-ledger hydration is still needed; zero here is a conservative fallback, not verified stock.
- Receipt and return receipt printing use an isolated iframe, load styles/images/fonts, and surface errors. Print dialog initiation is not proof of physical printing.
- Chrome print-preview test with 30 synthetic line items includes the end-of-receipt text beyond the clipped source modal. No payment or physical print was performed.
- User's intended setup: Epson TM-T82, Bluetooth, Windows + Chrome. User currently has no printer available and deferred hardware testing.

## Not complete — do not claim full synchronization

- Most operational collections still live in localStorage. Need authenticated shared persistence and hydration for orders, CRM, users/roles, shifts, stock, workflows and settings.
- Current catalog writer still uses legacy full snapshots. Merchant-scoped retirement preserves delete behavior, but continuous polling/pushing is NOT safe until revision checks and explicit deletion tombstones replace the snapshot protocol.
- Need durable acknowledged mutations, cross-device conflict handling, offline recovery, and transactional audit events for every accepted change.
- Local PIN role switching is an owner-authenticated kiosk mechanism; it is not separate authenticated employee membership authorization.
- Existing legacy data under cashier-specific keys must be retained and recovered deliberately. Do not purge old caches or pending transaction queues.
- Normalized sales ingestion remains required for financial/admin reports; a shared UI snapshot must never substitute for the transaction ledger.
- Two real pending Carwash sales still need the owner to select which trial outlet to defer, or upgrade. Do not silently disable an outlet or discard the sales.
- Physical Bluetooth/driver test, logo print verification on the actual printer, and production push/deployment verification remain outstanding.

## Checks

Run `npm run lint`, `npm run test:subscriptions`, `node --import tsx scripts/dev/test-sync-boundary.ts`, and `npm run build`.

Browser-only synthetic print fixture: `scripts/dev/receipt-print-fixture.html` served by Vite. It contains no client credentials and performs no backend writes.

The earlier attempted production expansion of `svc_billing` write grants was rejected and was not applied. Business provisioning now uses existing `svc_pos` permissions; do not reintroduce broader billing grants as a workaround.
