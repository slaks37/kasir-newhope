# PR35 staging module pilot

This maintenance operation is authorized by the owner's PR35 Release Blocker Resolution request. It is **not** self-service subscription activation or a staff invitation endpoint.

`staging-module-grant.ts` generates a pinned Neon connector request using the same target as the Preview build guard in `scripts/release/isolated-acceptance-target.mjs`. The current QA project is `raspy-paper-14687954`, branch `br-bold-flower-a12o0elg`, database `neondb`. Never submit its SQL through a connection with a default branch. Direct maintenance connections must pass `assertStagingGrantConnection`; no runtime DATABASE_URL fallback is supported.

1. Use a merchant named `QA Staging …` and a single outlet named `QA …` created through the verified owner's QA browser session. Record trial expiry, retained-outlet usage, open shifts and queued browser changes. Finish syncing or preserve unresolved queues before changing the QA route. Scope the grant to the new QA merchant.
2. Build a manifest with exact owner/tenant/merchant/outlet UUIDs, a unique `pr35-qa-*` reference and an absolute expiry no more than 48 hours ahead or the subscription end, whichever comes first. Keep identifiers in private working files.
3. Call `stagingModuleGrantRequest(manifest)` and execute the returned **complete scoped request**. This dry run locks and validates the scope but writes nothing. Review `stagingModuleGrantSql(manifest).digest` and the exact manifest.
4. Call `stagingModuleGrantRequest(manifest, reviewedDigest)` through the same connector. A mismatching digest refuses generation. One atomic statement locks tenant/user/merchant/outlet/subscription, checks QA names, retained quota, valid paid/trial period and closed shifts, then inserts five v2 assignments, five explicit outlet grants, five expiring entitlements and one audit event. No users, tenants, memberships, sessions, MFA proofs, invoices or outlets are created.
5. Repeat the identical request. It validates all grant rows without extending expiry or duplicating audit events. Different expiry under the same reference, disabled rows or partial state fail closed. Existing unreviewed grants are never overwritten.
6. Open the explicit `/app/<merchant>/<outlet>/<module>/<page>` routes. Each of `fnb`, `retail`, `laundry`, `carwash`, `barber` uses its own catalog/stock/jobs. Legacy routes for this enrolled QA merchant must deny with `EXPLICIT_WORKSPACE_REQUIRED`; the original merchant remains on its existing path.
7. Reconcile hosted writes against Neon by tenant, merchant, outlet, module, command/receipt ID. Never classify synthetic-role fixtures as real staff sessions.

Rollback/expiry: disable the pilot's `billing.module_entitlements.enabled` by exact tenant/merchant/reference; keep v2 and legacy guards in place. Preserve all audit, receipt, inventory, job, refund, payroll and outbox evidence. Do not convert the QA merchant back into shared legacy writes. Renew only through a separately reviewed manifest after reconciling the old run; this helper deliberately refuses overwriting existing grants.

Tests: `npm run test:modules` and PostgreSQL17/18 module CI exercise dry run, wrong owner/QA scope, expiry, subscription, retained outlet limit, idempotency, reference reuse, drift, one audit event and target pinning. These are synthetic databases, not hosted acceptance.
