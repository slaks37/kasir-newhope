# Actual source data migration rehearsal

This is an encrypted, credential-free logical migration of the **actual Supabase
application catalog and business rows**, not a repository-schema-only fixture.
Production Supabase and the existing synthetic Neon pilot remain unchanged.

## Reviewed scope and destination

- Source: Supabase `fqxrhumsgigcgjtlbfuo`, PostgreSQL 17.6.
- Target: Neon `steep-sea-66546931`, Singapore, PostgreSQL 18.6,
  child `br-curly-truth-aze21ktf` from empty root `br-falling-butterfly-az989m86`.
- Direct host: `ep-plain-dream-azghoyf7.c-3.ap-southeast-1.aws.neon.tech`.
- Application schemas: `public`, `pos`, `internal`, `billing`, `ai`, `contract`,
  `mcp_private`, `blog_mcp_private`. Supabase managed auth/storage/vault/realtime
  engines are not installed in Neon; Better Auth and object storage are separate.
- The child is private staging, not a production branch or production cutover.

`neon/targets/full-restore.json` pins the destination. All scripts require matching
project, branch, database and hostname plus verified TLS. A direct hostname is
used even when the private connection URL was supplied with the pooler suffix.
Populated application schemas are rejected before any DDL. No script resets,
truncates or drops an existing database or silently falls back to another target.

## Snapshot and privacy controls

`source-export.sql` executes one read-only PostgreSQL statement, so its catalog,
identity metadata and all application rows use the same MVCC snapshot. The
server encrypts the entire customer-bearing result with an RSA4096 OpenPGP public
key, AES256 and compression before returning it through MCP. The tool output
contains only ciphertext and byte counts. The matching private key is never sent
to Supabase, Neon, chat or logs. The ignored local key directory is mode0700 and
key files, encrypted snapshots and reviewed identity manifests are mode0600.
Decryption and row reconciliation occur in local process memory. No decrypted
full customer snapshot is written to disk or committed.

Automatic approval review rejected the first proposed export because it included
full auth/session/MFA archives and credential material. The approved alternative
omits password hashes, PINs/PIN hashes, approval token hashes, MCP credential rows,
Supabase auth sessions/tokens/MFA secrets, and storage engine metadata. Only
credential-free auth UUID/email/verified/active/name metadata is retained for a
separately reviewed identity import. No sensitive-export rejection is bypassed.

The database backup is therefore **not an independent full-source rollback
backup**. Owner-controlled Supabase backup/PITR plus independently stored backup
key/ciphertext escrow remain a production cutover prerequisite. Six-hour Neon
history and a private-key file beside a local snapshot are not durable escrow.

## Actual preservation and intentional credential resets

The source capture contains 125 application tables, 53 views, 22 functions,
466 constraints, 109 non-constraint indexes, 23 triggers, 38 RLS policies,
6 enums and 5 sequences. It contains 2,537 business rows, including tenant/outlet
configuration, POS receipts/items/payments/cash ledger, shared state, paid terms,
AI balances, blog posts and audit history. Identity audit counts are public;
customer emails, names, hashes, tokens and UUID mappings are not.

The restore creates schema/enum/sequence/function/table structures from the
actual catalog, imports raw PostgreSQL JSON strings to preserve numeric
precision, then installs constraints, indexes, views, triggers, RLS policies and
sequence states in one transaction. Immutable-ledger and operational triggers
are installed only after historical rows are loaded. Source unsafe ACL/default
ACL grants are kept as evidence, never blindly reinstated. Browser roles are
revoked, and Better Auth runtime roles are applied separately after reconciliation.

- Legacy PIN-bearing rows get an impossible nonnumeric `!RESET!` marker (17 rows
  including nullable legacy admin password fields). PIN/default-password defaults
  are not restored. Owner-controlled server-side PIN setup is required; no default
  `1234` or approval is created.
- Financial PIN credentials/approval grants and MCP token rows remain empty.
- Credential-free MCP connection metadata preserves audit foreign keys; imported
  connections are explicitly revoked, requiring reconnection.
- Supabase-style `auth.uid/role/jwt` helpers return NULL/empty claims and have no
  PUBLIC execute grant. They support preserved legacy policy definitions while
  failing closed; they do not implement an authentication provider.
- Existing source audit/ACL history is preserved for evidence. Source OIDs and
  Supabase ACL rollback scripts must never be used as Neon role rollback commands.

## Repeatable procedure

Install isolated backup tooling without altering application dependencies:

```sh
npm install --prefix build/neon-tools --no-package-lock --ignore-scripts openpgp@6.3.2
node scripts/neon/backup-keygen.mjs
```

The key generator refuses to overwrite existing keys. Keep the private key in an
owner-approved separate backup escrow before scheduling production migration.

For a direct source export, prepare the private mode0600
`.env.supabase-source.local` from `scripts/neon/source-connection.example`. The
connection must belong to the confirmed source project and use direct or session
pooling, a read-only role and verified TLS. It never uses a transaction pooler or
changes production grants. The script sets default transaction read-only and
begins a repeatable-read read-only transaction. If unavailable, MCP can run the
same reviewed SQL with **only the public key** substituted and persist only the
encrypted response under `build/neon/`.

```sh
node scripts/neon/backup-source.mjs
node scripts/neon/backup-inspect.mjs PRIVATE_ENCRYPTED_CAPTURE_PATH
node scripts/neon/source-identity-manifest.mjs
```

Current reviewed fully sanitized capture is `build/neon/source-2026-10-13-v3.pgp.b64`; its SHA256
is recorded in source snapshot/restore/reconciliation evidence. The scripts'
current default is deliberately pinned to this retained rehearsal capture.
Before a new rehearsal, update that reviewed capture path and review its scope;
never silently select the newest filename.

Restore only to a separately provisioned empty child whose reviewed public
manifest and private environment match. The following already ran successfully;
**do not rerun the restore against its now-populated child**:

```sh
node scripts/neon/restore-catalog.mjs --reviewed-sha256 8ea8095f142e34637890b9dea51be1e6fa50659291ebd89fb476d77eb0b053a8
node scripts/neon/reconcile-catalog.mjs
```

The original v2 baseline reconciliation completed before additive identity, media and runtime changes. That historical evidence is retained; it must not be relabeled as v3 or post-upgrade byte equality.

The final v3 capture additionally removes two nested historical PIN fields in
`internal.tenant_identity_recovery.snapshot.memberships[].pin`. Its separate
redaction evidence proves exactly those two fields changed, all other recovery
data stayed equal, and the private recursive credential-key scan returned zero.
The target received this explicit redaction only after baseline reconciliation.
Earlier encrypted captures were retained mode0600 as superseded evidence; owner
secure disposal/escrow policy must resolve them before sharing a backup.

Reconciliation compares every original table's row count and canonical SHA256
fingerprint after explicitly projecting out only intentionally removed secrets
and revoked timestamps. It validates relation/RLS flags, constraint definitions,
sequence state, zero active copied credentials and independent financial totals.
PostgreSQL18 renders eleven constant-varchar-array checks differently from 17;
only that specific rewrite is accepted, and each allowed value, an invalid value
and NULL are evaluated against both expressions to prove identical behavior.

Reconcile **before** identity provisioning, URL rewrites or other migrations.
Later intentional additive/rewrite changes need their own before/after evidence;
a baseline fingerprint mismatch must not be hidden by updating expected counts.

## Fidelity limits and cutover gates

The catalog exporter supports ordinary non-partitioned tables, enums, sequences,
functions, views, indexes, constraints, triggers and RLS/policies. It refuses
partition/inheritance, domain/range/standalone composite types, generated columns,
materialized views and invalid indexes. No such unsupported objects occurred in
this source capture. It is not a complete native `pg_dump` implementation;
large-object/extension state, managed auth/storage/realtime/vault internals,
publication/event-trigger/default ACL installation and independent source-role
restore are outside the imported runtime. The source schema also lacked current runtime dependencies despite repository migrations existing. `0008_restored_runtime_compat.sql` adds only the missing AI ledger/top-up helper, derived state versions and Smart Labor projection tables. Explicit `MIGRATION_OPENING` entries use existing wallet balances, never add a monthly allowance or reset usage/periods. This additive upgrade has its own all-original-table and wallet preservation evidence and an idempotent-reapply check. Reapply the reviewed role inventory afterwards; runtime can read AI ledger but must not insert directly.

A future source change adding one of
those objects requires review and a native backup path.

Production cutover must use a newly captured snapshot while one authoritative
writer is frozen or a separately tested change-capture process is active. Live
source continued writing during this rehearsal; this capture is not a final
cutover snapshot. Disable staging mail/customer notifications, payment provider
calls, subscriptions/AI batch jobs, schedulers and financial writes until cutover
operator checks pass. Do not copy live session/MFA/approval grants into staging.

Existing identities must be reconciled by authoritative source UUID evidence,
not matching email alone. Eight of ten source auth UUIDs lacked an internal UUID
profile in the original capture, including one email collision. The reviewed
identity importer owns canonical provisioning and exceptions. Preserve paid
terms, wallet balances, UUID-based owner/offline aliases and audit history.

Complete email HTTPS, MFA/recovery, PIN reset, five-sector POS/offline replay,
DOKU callback idempotency/provenance, media read/write rollback, role separation,
provider secrets, operational monitoring and independent source backup tests
before owner approves the final maintenance window.

## Actual runtime schema drift and additive evidence

A metadata-only comparison with the existing synthetic repository-schema child
found two missing columns on preexisting source tables:
`pos.shared_state_records.scope_recovery_snapshot` (migration archive only, no
current runtime dependency) and `pos.sync_receipts.outcomes` (current runtime
has explicit legacy-schema/replay fallback). They are not blindly backfilled or
reinterpreted. In particular, historic receipt rejection/renumbering outcomes
cannot be invented from an accepted-row count.

The current source's missing operational dependencies were remedied by the
narrow `0008_restored_runtime_compat.sql`: AI credit ledger/reconciliation/top-up
function, shared-state version table/trigger, attendance and payroll projections.
All 79 statically discoverable fully-qualified runtime relation dependencies
then existed in the restored candidate. Dynamic SQL/column semantics still rely
on actual API/integration checks; this audit is not presented as a SQL parser.
The admin bundle query now uses its existing product `category_name`, avoiding
an invented `pos.categories` table and the old silently empty error fallback.

The candidate had **15** wallets when compatibility upgrade ran: **8 original
source wallets and 7 synthetic native API test wallets** created during staging
rehearsals. All 15 pre-upgrade wallet rows and every column value across all
125 preexisting application tables were identical before/after upgrade. Derived
15 `MIGRATION_OPENING` entries exactly matched those current balances, with zero
reconciliation differences, and 32 shared-version groups represented current
staging records. Reapplying the migration created no duplicate entries, grants,
period resets or usage resets. These counts must not be substituted for the
source capture's 2,537 rows/8 wallets, or the original source-restore counts.

The final production candidate must be created from a fresh frozen source
capture and **must not include synthetic test accounts/tenants/outlets or rows**
from this rehearsal child. Keep this child for evidence and integration tests.
Never remove suspected customer records to make staging counts look like source.
