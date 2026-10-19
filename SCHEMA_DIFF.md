# Schema comparison — 15 October 2026

All five Neon branches and the Supabase source were queried read-only.
Machine-readable relation, column/type, role/extension and grant summaries are
in [recovery inventory](docs/migrations/evidence/recovery-inventory-2026-10-15.json).
Column defaults, function/view/policy bodies are represented by hashes in the
reusable inventory query; no credential values or customer records are emitted.

| Neon branch | Source relations missing | Source columns missing | Changed matching column types |
| --- | ---: | ---: | ---: |
| main | 183 | 2,093 | 0 |
| migration-neon-auth | 44 | 409 | 0 |
| migration-better-auth-mfa | 44 | 409 | 0 |
| migration-full-restore-2026-10-13 | 0 | 0 | 0 |
| pr21-clean-restore-2026-10-15 | 0 | 0 | 0 |

Zero changed matching types does not mean compatible when relations/columns
are missing. Source relations include 125 tables, 53 views and five sequences.
Neon `main` contains only managed Auth tables.

Clean baseline reconciliation verified all 466 source constraints, accepting
only the explicitly tested PG17→18 array-coercion deparser rewrite. PG18
catalogued NOT NULL constraints are counted separately. Inventory index totals
include constraint-backed indexes; the 109 restored extra indexes exclude them.

Corrective `neon/migrations/0008_restored_runtime_compat.sql` adds four tables
and a wallet reconciliation view to the clean baseline. Including nine managed
Auth tables, the clean branch now has 138 tables and 54 scoped views. No source
column is removed or changed. The runtime dependency audit finds all 79 static
fully-qualified references. `pos.sync_receipts.outcomes` is still absent in the
source-shaped restore; the runtime's explicit legacy replay path handles it.
This is documented compatibility, not an assertion that arbitrary schema drift
is safe. Dynamic SQL and business constraints are covered separately by tests.

Roles/ownership differ intentionally: Supabase managed roles/extensions are not
copied as privileged LOGINs. The runtime/Auth roles on the full rehearsal branch
passed real LOGIN access and denial tests; those roles were not silently granted
to the clean business-only branch. No claim of full app readiness is made for
that branch before reviewed native-auth schema/role provisioning.
