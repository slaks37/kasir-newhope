# Multi-module acceptance continuation — Draft PR 27

Baseline: PR27 commit `452ff06`; verification repair `8b75cd7`. The existing registry, native sector screens, authentication boundary, canonical financial/inventory ledgers and immutable offline outboxes are extended in place. Both rollout flags remain `0`. No production migration, deployment, Auth configuration or payment activation was performed.

## Acceptance matrix

“Operational in staging” below means the listed synthetic workflow and authorization assertions pass. It does not mean production rollout, external Auth/provider acceptance, or untested sector features are ready.

| Priority | Acceptance | Status | Evidence / remaining gate |
|---|---|---|---|
| 1 | Repeatable canonical database verification | Operational locally | 10 checks, all 8 BI cards, 312 paid sales unchanged after fixture replay; no missing file/check is skipped |
| 2 | PostgreSQL17 actual service logins, RLS, 0063/0064 replay | Verified for `8b75cd7`; expanded rehearsal pending latest CI | Separate `svc_pos`, `svc_internal`, `svc_billing` NOBYPASSRLS logins; 0063–0066 replay twice preserves membership IDs/scopes; current job also replays 0067 and runs the complete HTTP acceptance below |
| 3 | Tenant/merchant/outlet/module state, inventory, drafts, offline queues and attribution | Operational in local isolated staging for Retail + Barber; latest real-role CI required | Exact tuple and authenticated actor; scoped operational namespaces and cache keys; shared module catalog with revision conflict checks; authoritative outlet stock; immutable financial module attribution; old queues/rows never reassigned |
| 4 | Multi-outlet receiving/transfer/checkout/refund/report/switching | Operational in local isolated staging for listed workflows | Source/destination authorization, stock row locks, atomic debit/credit, oversell review, canonical refund restoration, module/outlet reports; browser transfer and cashier checkout/recovery exercised |
| 5 | Independently authenticated staff and server RBAC | Server authorization operational in isolated staging; hosted identity-provider acceptance still required | Separate verifier principals for CASHIER/MANAGER/ADMIN/OWNER/KAPSTER; spoofed owner headers ignored; outlet membership revocation revalidated before receipt replay; local PIN profile changes cannot create staff authority; scoped read-only subscription bootstrap does not provision staff tenants or expose invoices |
| 6 | Barber + Retail under one merchant; shared purchase/finance attribution | Operational API in isolated staging; shared purchase form still missing | Same product IDs stay separate between modules; catalog shared explicitly across outlets within a module; receiving can contain both modules; optional cash purchase requires exact per-module allocation and separate command-bound approvals, atomically posting to the existing cash ledger; missing approval/allocation mismatch rolls everything back |
| 7 | Canonical ledgers, subscriptions, identities, DOKU, offline guarantees | Existing financial suite passes; final full suite pending latest revision | No replacement financial/stock ledger, provider, subscription identity, or automatic legacy mapping; existing DOKU tests remain mocked provider regressions |
| 8 | Two tenants, multiple merchants, two modules, outlets/staff/network interruption/replay/recovery | Local HTTP and client acceptance pass; expanded PostgreSQL17 CI pending | `workspace-acceptance.ts` runs the same HTTP workflows with PGlite and actual PostgreSQL17 `svc_pos`; client tests cover tuple caches, expiring leases, immutable outboxes, profiles, offline baseline recovery |

## Implemented contract

- Assignment `workspace_version=1` retains the existing singleton/native pilot. Version 2 is explicit opt-in, additionally requiring both flags, an active subscription, purchased features, module assignment and current membership. No assignment is upgraded automatically. Version 2 activation is limited to Retail and Barber until the other three sector workflows receive equivalent acceptance.
- Operational state belongs to `WORKSPACE:<merchant>:<outlet>:<module>` under its canonical tenant. Sector is verified adapter metadata only. The shared commercial catalog belongs explicitly to merchant + module; only merchant/tenant catalog managers can change it. Outlet balances and all operational/draft records remain separate. Concurrent catalog edits require the current catalog revision.
- Cashier identity is projected from the verified authenticated user, never browser role/name/PIN fields. Credential-free rosters are server owned. KAPSTER is restricted to Barber, WASHER to Carwash and CHEF/BARISTA to F&B. Every server command rechecks membership, subscription and entitlement, including retries of a previously recorded receipt.
- Existing `pos.transactions`, payments, items, refunds, cash ledger, stock movements/balances and commissions retain their identities. New rows carry explicit, immutable module attribution. Historical rows remain unattributed; sector is never retroactively relabeled as a verified module.
- Stock receiving, adjustment and transfer use the existing append-only inventory ledger. Receipts store command identity/results only. Catalog JSON stock is ignored. Shared purchase cash allocations total exactly the supplied invoice amount; inventory-only receiving explicitly returns `financialRecorded=false` and does not pretend a supplier payment occurred.
- Financial and operational queues include tenant, merchant, outlet, module and actor. The immutable sale scope is checked on replay. A lost response after commit retains the command; exact replay confirms one canonical sale. Oversells are retained for review rather than acknowledged as successful sales. No legacy queue is moved into a v2 workspace.
- Offline UI uses an actor/outlet-bound cached grant with expiry bounded by the last verified subscription, module entitlement and 24-hour lease. It is never server authority. Online authorization denial revokes its cached grant. All server writes revalidate current access.

## Browser evidence

Loopback-only `workspace-fixture.ts --isolated` uses fresh in-memory data and two separate synthetic identities. No real Auth/provider or production data is involved.

Observed: owner transfer decreased source stock and increased the other outlet; separate CASHIER workspace exposed cashier pages; Retail cart survived switching to Barber and back; Barber services remained sellable without inventing stock; offline cash checkout survived reload as “Keuangan · 1 menunggu”; restoration produced exactly one completed cashier transaction and stock 6 → 5. Captured browser metrics reported no unhandled errors. Screenshots are local evidence under `build/module-rehearsal/` (ignored, not published).

## Still missing / rollout blocks

- A shared purchase UI with multiple module allocations and approval renewal; the tested API is available only behind the disabled rollout.
- Equivalent v2 operational acceptance for F&B, Laundry and Carwash, including their ingredient/BOM and domain-specific lifecycle cases. Those version 2 grants fail closed; their existing version 1 foundation is preserved.
- Canonical recipe/bundle/raw-material commands, booking conflict/scheduling rules, and full module-specific commission/payroll acceptance. Unsupported v2 stock/bundle writes are rejected; these are not claimed as supported workflows.
- Real hosted staff sign-in/sign-out, token refresh/revocation, password recovery and physical multi-device acceptance using the configured identity provider. Synthetic verified principals and browser fixture sessions are not hosted Auth evidence.
- Production preflight/reconciliation for legacy unattributed rows and identity FKs, controlled rollout approval, production operational acceptance and provider/payment acceptance. No production action is authorized in this task.

## Reproduce

- `npm run db:verify`: fresh embedded canonical database, repeat fixture/health seed twice.
- `npm run test:modules`: existing five-module baseline plus explicit v2 HTTP workflows and scoped client recovery tests.
- `npm run verify`: database verification, lint, build, runtime and the complete regression suite.
- GitHub job **PostgreSQL17 module roles, isolation and replay**: guarded disposable `postgres:17` service, real service-role sessions, migration replay, complete HTTP workflows and uploaded bounded JSON evidence.
- `node --import tsx scripts/dev/workspace-fixture.ts --isolated`: two loopback browser sessions; fails any outbound non-loopback request.
