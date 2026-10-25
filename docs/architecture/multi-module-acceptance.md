# Multi-module acceptance continuation — PR 27

Both rollout flags stay disabled. No production migration/deployment is authorized. Every status requires actual workflow and authorization evidence.

| Priority | Acceptance | Current status | Evidence |
|---|---|---|---|
| 1 | Repeatable canonical database bootstrap, no missing migration/card skipped | Fully operational locally | 10 checks, 8 BI cards, 312 paid sales unchanged after fixture replay |
| 2 | PostgreSQL 17, actual service logins, RLS, 0063/0064 replay | Running isolated CI | Dedicated PostgreSQL17 job with actual svc_pos / svc_billing / svc_internal logins, no BYPASSRLS |
| 3 | Tenant/merchant/outlet/module scope for state/catalog/drafts/outboxes/financial attribution | Pending | PR27 intentionally blocks broad activation |
| 4 | Multi-outlet sale, stock transfer, refund/report and switching | Pending | Requires exact outlet ownership |
| 5 | Independent authenticated role sessions and server RBAC | Pending | Module API roles exist; native workspaces remain owner-only |
| 6 | Barber + Retail in one merchant with separate operational records and correct shared ledger attribution | Pending | Requires explicit module identity |
| 7 | Existing canonical ledgers/subscriptions/DOKU/offline regressions preserved | Pending rerun | No new financial ledger/provider |
| 8 | Two modules, two merchants, multiple outlets/staff, interruption/replay/recovery | Pending | Synthetic isolated fixtures only |
