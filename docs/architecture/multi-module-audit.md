# Multi-module architecture — 26 October 2026

This is the original foundation audit. The implemented continuation, current workflow evidence and remaining rollout gates are tracked in [multi-module-acceptance.md](multi-module-acceptance.md); the unchecked items below describe the foundation snapshot, not a claim that no subsequent implementation exists.

Base: `a427fb83fda6509bb7b18fb8c0b7155ecc3f2e49` on GitHub main. Work is isolated from SONRI in a separate clone/branch. No production mutations authorized or executed.

## Observed architecture

React/Vite Workspace already lazy-loads major tabs. POSContext is 3,018 lines, InventoryManager 2,451, Workspace 466. POSDomains uses selected subscriptions; refreshCoordinator coalesces reads. BusinessDirectory/verifiedSelection validate tenant/merchant/outlet identity. Business switches run guards and remount POSProvider; same-sector merchants have disjoint UUID namespaces. Financial outbox and durable receipt outcomes already protect canonical writes. Existing server report endpoints paginate transactions and read contract.merchant_revenue.

Five sector presets exist. KDS, laundry pipeline, carwash queue and barber booking screens already implement different interactions, but TableManager statically imports all of them and combines generic layout with operational workflows. businessSector/storeMode still determine cache namespaces, catalog semantics, checkout defaults and lifecycle behavior. enabledModules is editable UI configuration, not purchased business-module entitlement. A local cashier profile is not an independently authenticated server principal.

## Database audit

Read-only Neon catalog inspection of project steep-sea-66546931 / default main br-falling-butterfly-az989m86 found internal 25, pos 59, billing 6, ai 7, neon_auth 9, public 1 base tables. This verifies schema presence, not which database the live deployment uses. No customer records or credentials were read. Runtime production connection and migration receipts remain unverified.

Reviewed migration history through 0062 plus the timestamped business-scoped operational-state migration. 0009 creates service schemas/contracts; 0015 hierarchy; 0026 composite ownership FKs; 0030 sector contexts; 0031 jobs; 0032 independent sales/payment/service/commission lifecycles; 0034 real bays/vehicles/chairs; 0043 shared state; 0044 canonical net revenue/refunds; 0052 sector settings guard; 0053 indexes/timeouts; 0054 durable outcomes; 0055 versions; 0059 server financial approvals; 0060 privacy; 0061 consent; 0062 payment provenance.

Neon catalog confirms shared_state_records PK remains (tenant_id,scope,kind,record_id), with BUSINESS:merchant UUID namespace constraint and RLS. Legacy sector namespace is permitted only for exact owner_sector aliases by trigger. Merchant ID must always be verified; sector alone is not identity. Many older internal/POS tables (including transactions and sector contexts) lack RLS; API ownership and restricted role privileges are material boundaries. This refactor does not claim universal RLS hardening.

## Target ownership

| Domain | Owner | Shared consumers |
|---|---|---|
| identity, hierarchy, membership, module assignments | internal | authorized service contracts |
| subscriptions, purchased entitlements | billing | module access resolver |
| sales, payments, refunds, cash, customer IDs, stock ledger | existing POS | module adapters, reporting contracts |
| F&B tables/KDS/recipes | F&B adapter over existing POS tables | scoped reports |
| retail SKU/variants/receiving | retail adapter over existing inventory | scoped reports |
| laundry production/racks | laundry adapter over existing contexts/jobs | scoped reports |
| carwash vehicles/bays | carwash adapter over existing contexts/resources | scoped reports |
| barber bookings/chairs/commission | barber adapter over existing contexts | scoped reports |
| aggregates and AI context | contract + authorized report service | authorized owner/AI |

One modular monolith; no duplicate ledgers, customer identities or speculative schema moves. Module ID, sector, permission, entitlement and rollout are separate values. Assignment references tenant/merchant with composite FKs; outlet overrides can narrow availability. Additional sector adapters must prove module/outlet cache and command isolation before enabling mixed-sector operation within one merchant.

## Incremental checklist

- [x] Audit current main, all migration filenames, actual Neon catalog, existing operations and offline boundaries.
- [x] Registry/manifests, strict scoped routes and lazy operational entry points.
- [x] Server-authoritative assignment/entitlement/permission resolver with default-off rollout.
- [x] Additive, RLS-protected assignment migration with no automatic merchant activation.
- [x] Working sector-native pilot using existing operations and finance infrastructure.
- [x] Bounded consolidated owner report through canonical revenue contract.
- [x] Regression, migration/authorization tests and build; branch prepared for draft PR review.
- [ ] Mixed-sector merchant operational adapters and per-module financial attribution.
- [ ] Independent cashier sessions, merchant-member workspace bootstrap, audited cross-tenant superadmin scope.
- [ ] Full purchase/receiving/transfer/returns UX; physical scanner tests; all resource scheduling and notification delivery acceptance.

The last items are release blockers for the complete product vision. A tested foundation or existing operational screen is not proof of completion of every sector requirement.

## Implemented foundation

Module contracts/manifests and an immutable registry live in `src/platform/modules` and `src/modules/*`. A deliberately small route catalog serves public auth guards without pulling workspace metadata into the landing bootstrap. Every scoped route names a canonical merchant, outlet, module and page. Invalid/foreign routes deny access; choosing a different owned route requires an explicit selection. The existing business switcher leaves the old qualified merchant URL after a successful explicit switch.

The shell resolves server assignments before mounting operational stores. New module navigation intersects purchased feature keys, verified role permissions, and the existing local role restriction. Local PIN override cannot bypass a module gate. Specialized workflows hydrate only their sector collections; direct barber entry also loads the actual staff roster and service catalog, and booking rejects nonexistent staff instead of inventing a default ID. Specialized workflows lazy-load directly; TableManager also stops eagerly importing all four sector screens. Each dashboard uses PostgreSQL aggregates rather than downloading transaction histories. Recent legacy and UUID snapshots for the same operational ID count once.

`0063_module_assignments.sql` adds definitions, merchant assignments, narrowing outlet overrides and separate expiring billing entitlements. Definitions are seeded; no business assignment or paid entitlement is created. RLS, composite hierarchy FKs and least-privilege grants protect the new tables. Enabling an assignment requires `guard_legacy_apis=true`; a disabled enrolled assignment cannot silently fall back to legacy API authorization. Existing unassigned merchants retain their current behavior when rollout is enabled elsewhere.

Core legacy operational state reads/writes, catalog/status reads, transaction sync, finance and financial reports check pilot entitlements inside their database transaction. Rejected sales produce no ledger row. An already committed batch receipt may still reconcile its original acknowledgment after revocation; it cannot create a new sale. Existing owner-only native operational APIs still reject independent member sessions rather than pretending the full staff workspace is ready.

`0064_membership_tenant_reference.sql` repairs a live-catalog-confirmed inconsistency: internal.memberships.tenant_id still referenced pos.tenants, despite composite merchant/outlet FKs targeting internal. The isolated membership fixture failed on this constraint before repair. The migration first rejects missing platform tenant mappings, adds and validates the correct internal FK, then removes the obsolete FK. It does not rewrite IDs, memberships or financial data.

Consolidated reporting groups the existing canonical net-sales contract by tenant-owned merchant/outlet/sector, bounds periods to at most 91 calendar dates, and pages at 50 groups. Only the actual tenant owner gets group visibility; a merchant OWNER membership does not imply tenant ownership. Historical sector attribution is explicitly labeled and `moduleId` remains null. Revenue is never multiplied by joining assignments. The legacy sync-status revenue also now reads this canonical contract instead of summing unpaid/void/refunded transaction face values. Dedicated mixed-module financial attribution remains unfinished.

## Delivery and release limits

| Capability | Status |
|---|---|
| Registry, page contracts, strict scoped routes, lazy entries | Implemented |
| Default-off assignment, entitlement and permission resolver | Implemented and isolated API tested |
| Existing F&B KDS / laundry pipeline / carwash queue / barber booking entry points | Adapted; not a claim of all sector acceptance criteria |
| Retail inventory/SKU entry point and stock aggregate | Adapted; full PO/receiving/transfer/return vertical slice unfinished |
| Native operational/financial/report API entitlement guards for enrolled pilot merchants | Implemented and denial-tested |
| Independent membership role resolution on module API | Implemented; full member directory/bootstrap/native-write support unfinished |
| Tenant-owner consolidated net revenue | Implemented; historical sector attribution only |
| Mixed-sector modules within one merchant | Assignments model supports it; legacy adapters deliberately reject it |
| Multiple outlets within one module pilot | Deliberately rejected until per-outlet legacy operational/cache ownership is proven |
| Qualified module routes offline | Requires online grant verification; legacy initialized-workspace offline support retained |
| Module-aware AI and audited superadmin aggregate scope | Unfinished; no AI write authority added |
| Real module purchase/upgrade workflow | Unfinished; operator-approved expiring pilot grants only, no pricing/payment changes |

The native pilot requires exactly one outlet ever registered for its merchant, including inactive outlets. One active outlet does not prove that old unscoped records never belonged to another branch. No compatibility adapter is activated based solely on sector. Do not remove this check until historical outlet ownership and durable per-module queues are validated.

The complete multi-module operating-system vision is **not complete**. This draft is a working, tested foundation with sector-native adapters. Dashboards disclose actual missing workflow features. Remaining sector resource integrations, advanced inventory workflows, physical scanner/mobile acceptance, full cashier identity separation and per-module offline grants are release blockers for broader rollout.

## Validation and reproduction

- `npm run verify`: lint/typecheck, production SPA/API/service builds, runtime checks and full repository regression including `test:modules`.
- `npm run test:modules`: fresh in-memory PGlite engine, all migrations plus namespace repair, synthetic owner/member identities, real HTTP boundaries and canonical transaction/refund services. Covers pre-migration compatibility, no inferred entitlement, expiry, outlet overrides, five manifests, direct URL/API denial, legacy endpoint bypass denial, same-sector siblings, namespace dedupe, service/browser RLS and FK replay.
- Production build additionally runs `scripts/dev/test-module-build.mjs`: five dashboards, four specialized workflows and retail inventory are dynamic entries outside initial app/workspace static graphs. Public landing bootstrap measured 6,484 bytes after separating route metadata. This is bundle inspection, not a measured mobile Core Web Vitals claim.
- Existing service worker intentionally precaches lazy cashier assets for offline use. Lazy execution is verified; avoiding background downloads of every inactive module still needs a separate offline-compatible caching rollout.
- Browser smoke uses the actual React shell and routes with synthetic identity and a disposable local database. F&B ticket PREPARING → READY persisted as server revision 2 and survived reload. Retail → Laundry explicit selection reached the correct Laundry dashboard and production pipeline. This is local synthetic evidence, not production or real-device acceptance.
- `npm run db:verify`: all migrations accepted, then existing legacy seed fails with `relation "plans" does not exist`. The unchanged baseline script excluding both new migrations fails identically. This obsolete health/BI bootstrap seed remains a separate documented failure; full migration/constraint/API tests use the isolated regression harness.

Barber booking now initializes the date in Asia/Jakarta rather than UTC; the regression covers 00:05 WIB crossing the previous UTC calendar date.

## Rollout and rollback

1. Keep `NEW_HOPE_MODULE_WORKSPACES=0` and `VITE_MODULE_WORKSPACES=0` in production. No live credentials, provider activation, pricing or DOKU configuration changed.
2. Before any live migration, confirm the deployed database target, current migration history, backups and recovery plan. Preflight membership mappings with `SELECT count(*) FROM internal.memberships m LEFT JOIN internal.tenants t ON t.id=m.tenant_id WHERE t.id IS NULL`; any nonzero result requires reconciliation, not a guessed mapping.
3. Rehearse 0063/0064 on an isolated staging database under real service credentials. Confirm RLS/grants, offline queues and existing financial reconciliation. Resolve member bootstrap, offline qualified routes and all broader rollout blockers above before offering the complete product.
4. Production schema application, explicit pilot enrollment/entitlement grants and rollout flags each need owner approval. A paid subscription is not an implicit purchase of a new module. Grant references must identify the approved pilot or actual entitlement decision; never fabricate a payment.
5. Roll back application behavior by disabling both flags. Retain assignment/entitlement rows, validated FK repair, canonical ledgers and every client queue. Do not drop new tables or recreate the obsolete POS tenant FK if platform memberships have since been created. No destructive down migration is supplied.

## File inventory for review

Created:

- `docs/architecture/evidence/fnb-kds-ready-synthetic.png`
- `docs/architecture/evidence/verification.md`
- `docs/architecture/multi-module-audit.md`
- `migrations/0063_module_assignments.sql`
- `migrations/0064_membership_tenant_reference.sql`
- `scripts/dev/test-module-build.mjs`
- `scripts/dev/test-modules.ts`
- `services/pos/modules.ts`
- `src/modules/barber/Dashboard.tsx`
- `src/modules/barber/manifest.ts`
- `src/modules/carwash/Dashboard.tsx`
- `src/modules/carwash/manifest.ts`
- `src/modules/fnb/Dashboard.tsx`
- `src/modules/fnb/manifest.ts`
- `src/modules/laundry/Dashboard.tsx`
- `src/modules/laundry/manifest.ts`
- `src/modules/retail/Dashboard.tsx`
- `src/modules/retail/manifest.ts`
- `src/platform/modules/ConsolidatedRevenue.tsx`
- `src/platform/modules/ModuleNavigation.tsx`
- `src/platform/modules/ModuleWorkspaceGate.tsx`
- `src/platform/modules/OperationalDashboard.tsx`
- `src/platform/modules/contracts.ts`
- `src/platform/modules/registry.ts`
- `src/platform/modules/routeCatalog.ts`
- `src/platform/modules/routing.ts`
- `src/platform/modules/screens.tsx`

Changed (including required generated API bundles):

- `.env.example`
- `api/_admin_bundle.js`
- `api/_sync_bundle.js`
- `package.json`
- `services/pos/finance.ts`
- `services/pos/reports.ts`
- `services/pos/sharedState.ts`
- `services/pos/sync.ts`
- `services/shared/schemaFeatures.ts`
- `src/Workspace.tsx`
- `src/components/MobileNavBar.tsx`
- `src/components/Sidebar.tsx`
- `src/components/businesses/MyBusinesses.tsx`
- `src/components/tables/BarbershopBookingView.tsx`
- `src/components/tables/TableManager.tsx`
- `src/context/POSContext.tsx`
- `src/lib/navigation/routes.ts`
- `src/lib/navigation/workspaceRouter.ts`
- `src/lib/reports/client.ts`
- `src/lib/sync/moduleKinds.ts`
- `src/server/syncHandler.ts`
