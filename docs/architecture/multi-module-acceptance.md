# Multi-module acceptance continuation — Draft PR 27

Baseline: PR27 commit `452ff06`; verification repair `8b75cd7`. The existing registry, native sector screens, authentication boundary, canonical financial/inventory ledgers and immutable offline outboxes are extended in place. Both rollout flags remain `0`. No production migration, deployment, Auth configuration or payment activation was performed.

The cashier/register continuation is specified and tested in [cashier-financial-acceptance.md](cashier-financial-acceptance.md): scoped outlet revenue, physical shared/dedicated drawers, cashier-owned closing, immutable variance review, cost redaction and durable close recovery. This adds purpose-specific POS capabilities without granting CASHIER management reports.

## Acceptance matrix

“Operational in staging” below means the listed synthetic workflow and authorization assertions pass. It does not mean production rollout, external Auth/provider acceptance, or untested sector features are ready.

| Priority | Acceptance | Status | Evidence / remaining gate |
|---|---|---|---|
| 1 | Repeatable canonical database verification | Operational locally | 10 checks, all 8 BI cards, 312 paid sales unchanged after fixture replay; no missing file/check is skipped |
| 2 | PostgreSQL17 actual service logins, RLS, 0063/0064 replay | Operational on actual PostgreSQL17 | Separate `svc_pos`, `svc_internal`, `svc_billing` and `svc_ai` NOBYPASSRLS logins; 0063–0067 replay twice preserves membership IDs/scopes; the complete HTTP acceptance and AI guard pass using actual service logins on commit 4d71f88; [PG17 evidence](https://github.com/slaks37/kasir-newhope/actions/runs/40281066446/job/121434255040) |
| 3 | Tenant/merchant/outlet/module state, inventory, drafts, offline queues and attribution | Operational in isolated staging for Retail + Barber | Exact tuple and authenticated actor; scoped operational namespaces and cache keys; shared module catalog with revision conflict checks; authoritative outlet stock; immutable financial module attribution; old queues/rows never reassigned |
| 4 | Multi-outlet receiving/transfer/checkout/refund/report/switching | Operational in local isolated staging for listed workflows | Source/destination authorization, stock row locks, atomic debit/credit, oversell review, canonical refund restoration, module/outlet reports; browser transfer and cashier checkout/recovery exercised |
| 5 | Independently authenticated staff and server RBAC | Server authorization operational in isolated staging; hosted identity-provider acceptance still required | Separate verifier principals for CASHIER/MANAGER/ADMIN/OWNER/KAPSTER; spoofed owner headers ignored; outlet membership revocation revalidated before receipt replay; local PIN profile changes cannot create staff authority; scoped read-only subscription bootstrap does not provision staff tenants or expose invoices |
| 6 | Barber + Retail under one merchant; shared purchase/finance attribution | Operational API and browser form in isolated staging | Same product IDs stay separate between modules; catalog shared explicitly across outlets within a module; receiving can contain both modules; optional cash purchase requires exact per-module allocation and separate command-bound approvals, atomically posting to the existing cash ledger; missing approval/allocation mismatch rolls everything back; browser recorded one Rp1,000 purchase as Retail Rp600 + Barber Rp400 and refreshed each module report |
| 7 | Canonical ledgers, subscriptions, identities, DOKU, offline guarantees | Operational regression checks pass locally | Full npm run verify exits 0, including DB, typecheck, build, runtime and all regression groups. No replacement financial/stock ledger, provider, subscription identity, or automatic legacy mapping; DOKU checks remain synthetic provider regressions |
| 8 | Two tenants, multiple merchants, two modules, outlets/staff/network interruption/replay/recovery | Local HTTP/client and actual PostgreSQL17 acceptance pass | `workspace-acceptance.ts` runs the same HTTP workflows with PGlite and actual PostgreSQL17 `svc_pos`; client tests cover tuple caches, expiring leases, immutable outboxes, profiles, offline baseline recovery |

## Implemented contract

- Assignment `workspace_version=1` retains the existing singleton/native pilot. Version 2 is explicit opt-in, additionally requiring both flags, an active subscription, purchased features, module assignment and current membership. No assignment is upgraded automatically. Version 2 activation is limited to Retail and Barber until the other three sector workflows receive equivalent acceptance.
- Operational state belongs to `WORKSPACE:<merchant>:<outlet>:<module>` under its canonical tenant. Sector is verified adapter metadata only. The shared commercial catalog belongs explicitly to merchant + module; only merchant/tenant catalog managers can change it. Outlet balances and all operational/draft records remain separate. Concurrent catalog edits require the current catalog revision.
- Cashier identity is projected from the verified authenticated user, never browser role/name/PIN fields. Credential-free rosters are server owned. KAPSTER is restricted to Barber, WASHER to Carwash and CHEF/BARISTA to F&B. Every server command rechecks membership, subscription and entitlement, including retries of a previously recorded receipt.
- Existing `pos.transactions`, payments, items, refunds, cash ledger, stock movements/balances and commissions retain their identities. New rows carry explicit, immutable module attribution. Historical rows remain unattributed; sector is never retroactively relabeled as a verified module.
- The shared purchase form retains the original command when transport fails; approval renewal can replace tokens only, never the saved scope, stock quantities, allocations, amount or receipt identity. Each confirmation dialog displays the module and amount. Exact server ACK validation precedes outbox removal.
- Stock receiving, adjustment and transfer use the existing append-only inventory ledger. Receipts store command identity/results only. Catalog JSON stock is ignored. Shared purchase cash allocations total exactly the supplied invoice amount; inventory-only receiving explicitly returns `financialRecorded=false` and does not pretend a supplier payment occurred.
- Financial and operational queues include tenant, merchant, outlet, module and actor. The immutable sale scope is checked on replay. A lost response after commit retains the command; exact replay confirms one canonical sale. Oversells are retained for review rather than acknowledged as successful sales. No legacy queue is moved into a v2 workspace.
- Turning rollout flags off denies explicit v2 APIs and preserves rejection of legacy sector APIs. Disabled assignments cannot silently reopen legacy access. Unassigned/v1 compatibility remains covered by the baseline suite.
- Offline UI uses an actor/outlet-bound cached grant with expiry bounded by the last verified subscription, module entitlement and 24-hour lease. It is never server authority. Online authorization denial revokes its cached grant. All server writes revalidate current access.

## Browser evidence

Loopback-only `workspace-fixture.ts --isolated` uses fresh in-memory data and two separate synthetic identities. No real Auth/provider or production data is involved.

Observed: owner transfer decreased source stock and increased the other outlet; separate CASHIER workspace exposed cashier pages; Retail cart survived switching to Barber and back; Barber services remained sellable without inventing stock; offline cash checkout survived reload as “Keuangan · 1 menunggu”; restoration produced exactly one completed cashier transaction and stock 6 → 5. Captured browser metrics reported no unhandled errors. Shared purchase form used two separate module approvals, increased Retail stock 15 → 16, and showed Rp600 in the Retail report and Rp400 in Barber. Reports and payment provenance use explicit module/outlet parameters. Screenshots are local evidence under `build/module-rehearsal/` (ignored, not published).

## Still missing / rollout blocks

- Equivalent v2 operational acceptance for F&B, Laundry and Carwash, including their ingredient/BOM and domain-specific lifecycle cases. Those version 2 grants fail closed; their existing version 1 foundation is preserved.
- Canonical recipe/bundle/raw-material commands, booking conflict/scheduling rules, and full module-specific commission/payroll acceptance. Unsupported v2 stock/bundle writes are rejected. V2 labor/AI grants are filtered on server and offline leases; legacy AI snapshot access is refused for v2 merchants. These are not claimed as supported workflows.
- Staff invitation/account provisioning and membership administration UI, plus real hosted staff sign-in/sign-out, token refresh/revocation, password recovery and physical multi-device acceptance using the configured identity provider. Existing authenticated staff with active canonical memberships can use the implemented workspace; local PIN profiles cannot provision authenticated accounts. Synthetic verified principals and browser fixture sessions are not hosted Auth evidence.
- Production preflight/reconciliation for legacy unattributed rows and identity FKs, controlled rollout approval, production operational acceptance and provider/payment acceptance. No production action is authorized in this task.

## Reproduce

- `npm run db:verify`: fresh embedded canonical database, repeat fixture/health seed twice.
- `npm run test:modules`: existing five-module baseline plus explicit v2 HTTP workflows and scoped client recovery tests.
- `npm run verify`: database verification, lint, build, runtime and the complete regression suite.
- GitHub job **PostgreSQL17 module roles, isolation and replay**: guarded disposable `postgres:17` service, real service-role sessions, migration replay, complete HTTP workflows and uploaded bounded JSON evidence.
- `node --import tsx scripts/dev/workspace-fixture.ts --isolated`: two loopback browser sessions; fails any outbound non-loopback request.

## Final local verification

`npm run verify` completed with exit code 0 on 26 October 2026 after the shared purchase UI, rollback guards, scoped reconciliation and unsupported-feature gates. This includes all existing regression groups, plus v2 HTTP tests executed under `SET LOCAL ROLE svc_pos`. The real PostgreSQL17 job uses independent network logins instead of role impersonation. The two real PostgreSQL17 jobs passed on application commit `4d71f88`: [module/service-role acceptance](https://github.com/slaks37/kasir-newhope/actions/runs/40281066446/job/121434255040) and [security/rollback rehearsal](https://github.com/slaks37/kasir-newhope/actions/runs/40281066446/job/121434254718). [Full CI](https://github.com/slaks37/kasir-newhope/actions/runs/40281066435/job/121434254679) checks the same product gate and committed API bundles. Later documentation-only revisions do not change this tested application code.
