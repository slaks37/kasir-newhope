# Canonical synchronization and operational repair

Header opens one Sync Center. `syncStatusModel` combines the financial and
operational lanes, while keeping their counts and actions distinct. Expected
financial review/outlet holds are amber, not presented as technical failures.
There is no global fixed operational toast or duplicate recovery panel.

## Authority and durability

- PostgreSQL financial tables and cash ledger remain authoritative. Operational
  conflict actions cannot rewrite them or discard financial queues/snapshots.
- `shared_state_records` owns operational revision/deletion state. Products are
  projected in the same transaction. Unversioned catalog POST is retired with
  `VERSIONED_CATALOG_SYNC_REQUIRED`; authenticated legacy GET remains migration-only.
- Active outbox v2 is a map keyed by owner/sector/kind/id. New edits replace the
  previous pending operation. ACK removes only the object actually sent; a newer
  edit keeps its updated base revision. Exact lost-ACK replay does not mutate the
  server revision or create duplicate audit events.
- Hydration replaces the complete remote map, overlays pending edits, respects
  tombstones, and ignores stopped or superseded requests. Truncated snapshots
  fail closed. Durable one-time import markers prevent cache snapshots from
  becoming new edits on every reload. Normalized legacy import is queued before
  the marker is written.

## Scope repair

Explicit sector/business ownership and known preset product IDs are checked on
both client and API. No inference from product names. `prod-ld-12` in an FNB queue
is quarantined before upload. Original outbox/cache bytes are backed up under
`newhope_operational_recovery_v2_<owner>_<sector>` before removing wrong-scope
operational records from active storage. Duplicate older operations are backed
up, not silently lost. A failed backup protects originals and blocks repair.

Migration 0046 adds recovery columns and a merchant-scoped product identity
index while retaining the legacy index for deployment compatibility. Provably
wrong projections are unavailable/quarantined, retaining primary IDs and their
financial references. Shared wrong-scope values are backed up and tombstoned.
Operational catalog readers exclude quarantine; historical financial reports
retain ledger references. No grants are widened. After the new API is READY,
0047 removes only the obsolete tenant-wide product identity index.

Each batch record runs under a PostgreSQL savepoint. Conflicts and policy
rejections are returned per record; unrelated valid operations commit. Full
rollback remains appropriate for infrastructure/transaction failure.

## Verification

`npm run test:sync`, `npm run test:financial-cloud`, `npm run test:subscriptions`,
`npm run lint`, `npm run build`.

Regression coverage includes Laundry-in-FNB, old arrays, duplicate edits,
reload pending, lost ACK, sector switching during hydration, removal of zombie
remote rows, 1 conflict among 61, mixed financial pending/operational conflict,
backup failure, merchant product identity, conflict resolution and byte-equivalent
financial rows during server repair. Tests use isolated local PostgreSQL fixtures;
no fabricated production sales.

Production financial checks before/after 0046: 4 transactions, Rp165,000;
transaction MD5 `9e59eba85c8e373ea8f2ddb94dd8da8f`, item MD5
`3407242bbd1d414cfa1618f55352ab3c`, cash MD5
`dd87a7377e44bc319ce6cf6a8f09a884`, unchanged. Wrong projection count was zero;
the observed contamination was in the device's operational cache/outbox.

Financial reviews are not automatically resolved: unknown outlet origins,
competing historical struk values, and uncertain owner sources remain preserved
for explicit review, independently of operational quarantine.
