# Database reconciliation — 15 October 2026

Authoritative writer remains Supabase `fqxrhumsgigcgjtlbfuo`. Selection is based
on the existing production code, source catalog and record fingerprints, never
the largest table count. Vercel's production DB Secret could not be decrypted;
the exact active production endpoint remains an operator verification gate.

Read-only inventory snapshots are timestamped in
[`recovery-inventory-2026-10-15.json`](docs/migrations/evidence/recovery-inventory-2026-10-15.json).
Re-run [`scripts/neon/inventory.sql`](scripts/neon/inventory.sql) for a new window.
Counts below are snapshots, not current promises; rehearsal tests append fixtures.

| Database | Tables | POS sales | Internal tenants | Billing subscriptions | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Supabase source | 125 | 8 | 11 | 10 | Authoritative; not frozen |
| Neon `main` | 9 | absent | absent | absent | Ineligible |
| `migration-neon-auth` | 103 | 0 | 10 | 10 | Incomplete synthetic pilot |
| `migration-better-auth-mfa` | 114 | 0 | 41 | 39 | Fixture-bearing auth pilot |
| `migration-full-restore-2026-10-13` | 150 | 8 | 23 | 22 | Runtime rehearsal only; additional test rows |
| `pr21-clean-restore-2026-10-15` | 138 | 8 | 11 | 10 | Clean business restore plus corrective 0008; no identity import |

## Clean restore proof

New isolated branch `br-mute-hat-azuw3aag` was created from the business-empty
Neon root. The existing encrypted credential-free capture was restored in one
transaction: 125 tables, 2,537 rows, 53 views, 22 functions, 466 constraints,
109 non-constraint indexes, 23 triggers, 38 policies and five sequence states.
Restored credentials are reset and source ACLs are not blindly reinstated.

Strict reconciliation passed for every baseline table's complete row set,
constraints, RLS flags and sequence states. Corrective `0008` was then applied
twice: all original table fingerprints and eight wallets stayed unchanged,
eight derived opening entries reconcile, and 32 shared-state version groups
match. There are no new synthetic customers or financial operations in this
clean branch, no native customer auth import and no cutover allowlist entry.

A separate live read-only comparison of source vs clean branch matched complete
row/identity fingerprints for all eight critical tables: 8 sales, 8 payments,
11 cash entries, 10 subscriptions, and zero invoices/refunds/payment events/
webhook logs. Financial values and idempotency fields are part of those hashes;
row totals alone were not used. No conflicting records were overwritten.

This restores an earlier snapshot, not a final frozen export. Even when critical
financial hashes match, unrelated source changes, later offline queues/provider
callbacks and independent backup acceptance remain separate release gates.

## Identity and rollback limits

Read-only re-review found seven UUID-evidenced candidates and three exceptions:
two lack canonical UUID ownership evidence; one has a different-UUID email
collision. No exception was guessed, activated, reassigned or imported.
Private identity records and keys remain ignored; receipts contain counts only.

The scoped backup is not an independent full-source/authentication rollback
backup. Owner backup/restore acceptance and private key escrow remain open.
Rollback after any target write requires reconciliation of acknowledged events,
not an environment-only reversal. See [data rollback](docs/migrations/data-rollback.md).
