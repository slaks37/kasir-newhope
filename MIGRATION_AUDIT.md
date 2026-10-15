# New Hope migration recovery audit — 15 October 2026

PR: [#21](https://github.com/slaks37/kasir-newhope/pull/21), branch
`codex/neon-auth-migration`. Existing work at `73ed3be` was recovered; no new PR,
production database mutation, production env change or authentication cutover.

## Architecture and verified boundaries

- GitHub `main` and the latest production deployment both identify
  `a427fb83fda6509bb7b18fb8c0b7155ecc3f2e49`. Production remains on the existing
  Supabase authentication code. Neon database provisioning does not replace it.
- Supabase source `fqxrhumsgigcgjtlbfuo` was queried read-only. It has 125 scoped
  business tables on PostgreSQL 17.6.1.155. Neon Singapore runs PostgreSQL 18.6.
- Vercel has separate branch-scoped Preview application/auth database secrets
  for this PR. Production Secrets are write-only: their actual connection values
  were unavailable. Neon marks its empty root as the Vercel production branch;
  that control-plane label **does not prove the active application's DB URL**.
  Production connectivity/functional cutover is not claimed verified.
- Native APIs, POS sync, billing/DOKU, admin, AI and MCP share the server database
  boundary. Auth uses a separate restricted LOGIN. Merchant health can have an
  explicit analytics URL. Source media is still needed until approved storage
  cutover; 39 public blog objects have verified Neon copies.
- The full-Neon Preview uses self-managed Better Auth 1.7.7 on the app host,
  native sessions in `newhope_auth`, explicit canonical UUID bindings and fresh
  TOTP proofs. Managed `neon_auth` tables are a separate pilot. No customer
  password, OAuth token, session or MFA secret was imported during recovery.

## Root causes and fixes

| Defect | Recovery |
| --- | --- |
| Empty Neon root and different rehearsal datasets were treated as possible complete migrations | Inventory every branch; preserve Supabase as authoritative; execute a separate clean snapshot restore. |
| Remote runtime could replay old bootstrap SQL against an imported catalog | `getDb` migrates embedded PGlite only; explicit remote `runMigrations` is rejected before DDL. Missing hosted DB URL fails closed. |
| Restored registry has 12 markers despite a much fuller catalog | Generic remote migrator rejects **any pending history** on populated catalogs, even with the first three bootstrap markers present. Reviewed corrective scripts remain the path for restores. Local incremental migrations retain their separate behavior. |
| Demo harness accepted `--live`; API seeder could follow remote env | Live bootstrap is rejected; API/auth/database demo seed targets must all be loopback and non-production. |
| Migration client and cron health lacked verified Neon TLS | Shared verified transport; explicit direct staging migration URL; reject URL query overrides of host/role/database. |
| Invalid pool values could defeat bounded budgets | Invalid values fall back to four locally/two on Vercel; local cap 20. Six actual pooled staging requests used at most two clients and cleared transaction-local state. |
| `db:verify` seeded obsolete unqualified tables after schema separation | Replace legacy demo/BI harness with disposable PG18 catalog verification: 70 migrations, all markers, 18 required relations, 198 FKs and 48 executable views, zero demo financial rows. Business regression remains in `npm test`. |

Hosted acceptance found two additional defects. Native onboarding omitted the
canonical owner/sector transport alias needed by a source-shaped catalog; new
stores now receive it from the server. Reviewed corrective 0009 repairs only
unambiguous NEW native single-merchant accounts, aborts on namespace/conflict
risks, and leaves imported identities and financial records unchanged.

The native browser request wrapper also repeated remote session/identity
resolution before every business API request, exhausting its timeout budget.
Native requests now attach the signed origin-scoped bearer directly. The API
still verifies live sessions, tenant ownership and MFA. Supabase's existing
session lookup behavior remains unchanged.

Historical migration SQL was not rewritten. No new grants were issued to make
runtime access the migration registry: its `42501` denial is expected and tested.
No automatic retry of financial mutations was added.

## Validation and release boundary

See [recovery results](docs/migrations/recovery-2026-10-15.md),
[reconciliation](DATABASE_RECONCILIATION.md), [schema diff](SCHEMA_DIFF.md),
and the [cutover runbook](docs/migrations/full-cutover-runbook.md).
Local results are distinct from exact-commit hosted CI/Preview acceptance.
Production remains NO-GO until the runbook's owner gates are actually satisfied.
