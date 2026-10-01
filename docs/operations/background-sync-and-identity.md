# Automatic background synchronization

Production release: `ac619380a73fc72b6dd5c0b83365aaca88b8192b`, deployed to main on 2026-10-01.

Normal synchronization is silent. Operational refresh runs on a completion-based timer, and financial refresh runs every 10 seconds while online. Focus, visibility, connectivity and outlet changes also trigger retries. Requests have bounded timeouts. Pending writes remain durable; a manual button is not required.

The header only surfaces offline/error states or recovery decisions. The single **Kesehatan data & pemulihan** center is available in the tools menu. Operational backups are collapsed and grouped by record instead of displaying repeated raw snapshots. Financial recovery conflicts remain explicit and are never automatically resolved by choosing a version.

## Production reconciliation

Applied cloud migrations:

- `20261001135859_tenant_identity_archive`: private recovery snapshots and canonical identity marker.
- `20261001140148_shared_settings_sector_guard`: back up and tombstone wrong-sector settings, enforce sector/store-mode consistency.
- `20261001140939_reconcile_duplicate_owner_identity`: guarded reconciliation after compatible readers were deployed.

Two empty legacy signup identities (Gasolina and Gota Brew) were archived, not deleted. Each owner now has one canonical active tenant. Original trial dates, existing active yearly Plus entitlement, outlet allowance, membership roles/PINs and AI balances were preserved. Admin and entitlement readers exclude archived identities.

The admin subscription report also resolves expired legacy trial IDs to the effective lifetime Free plan, with one allowed outlet and zero add-ons. This is a read/report correction, not a mutation of subscription or financial history; the existing owner-only/10-product enforcement remains in the billing service.

Reloading the production POS without clicking sync automatically repaired the FNB settings to `storeMode=FNB`, `storeName=New Hope Cafe & Resto`, revision 6, and projected the same name into the merchant table. The live recovery center showed zero financial pending operations and zero operational pending/conflicting operations. Three ambiguous legacy financial versions and unclaimed older sources remain protected for owner review.

Before and after reconciliation, financial ledger checksums were identical:

- 5 transactions, total Rp269,000.
- Transactions: `edb8c35a8ba4214f534dafcca8c8ac12`.
- Transaction items: `7f3250bd762a2f32afbae7b0f8d6c08d`.
- Cash ledger: `da8d2e54a821fa35ff5373b7209ecba7`.

## Verification

Passed lint, production build, sync regression suite, financial-cloud integration suite, subscriptions integration suite and canonical-identity migration tests. Tests cover background retry, slow hydration, preserved grouped backups, migration rollback guards and ledger invariance. No production test sale, payment or paid AI request was created.

Production deployment `dpl_8UhavhQFtgM2riH1vWWXvXieXgaF` was READY with `kasir.newhope.space` and `admin.newhope.space` aliases (Vite build approximately 33 seconds). Runtime observability was not independently audited; verification used browser UI and read-only database checks.
