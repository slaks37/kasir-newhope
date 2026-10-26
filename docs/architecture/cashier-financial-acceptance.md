# Cashier and physical register financial operations

Continuation of Draft PR27 application baseline `de524c2`. Applies to explicitly enrolled Retail + Barber v2 workspaces after migration 0068. Both rollout flags remain `0`; no production database, Auth, payment configuration or deployment is changed.

## Access contract

Cashier visibility is an operational POS capability, not the `reports` entitlement. Server membership, active identity, outlet, subscription and module entitlements are revalidated on every read, write and replay. Owner/manager status from a browser is ignored.

| Capability | CASHIER | MANAGER | ADMIN / OWNER |
|---|---|---|---|
| outlet_revenue.read | Assigned outlet and authorized modules | Authorized outlet/module scope | Authorized outlet/module scope |
| shift.read / shift_history.read | Same authorized outlet, including other operators | Authorized outlet/module scope | Authorized outlet/module scope |
| shift.open / shift.close | Own register shift only; cannot take an occupied drawer | Authorized registers and operators | Authorized registers and operators |
| shift_variance.submit | Own closed shift, including a new explanation after rejection | Authorized shift | Authorized shift |
| shift_variance.approve | Denied | Append approve/reject decision | Append approve/reject decision |
| register.configure | Denied | Denied | Explicit physical register/module mapping |
| company reports / COGS / profit | Denied | Existing report permission + entitlement | Existing report permission + entitlement |
| refund / void / debit/reversal approval | Denied | Existing explicit financial authorization | Existing explicit financial authorization |

Operational transaction history omits `recognizedCOGS` and item `unitCost` for CASHIER. The sell-side product projection supplies no real purchase cost. Canonical checkout still snapshots the server's actual product cost; redaction does not change ledgers, profitability calculations or manager reports.

## Financial definitions and physical identity

- Outlet daily gross sales, receivable total, refunds and canonical net revenue are separate fields. The day is `[00:00, next 00:00)` in Asia/Jakarta. Net revenue follows the existing canonical sale-date/refund attribution; a later return can change that sale date's net revenue. It never rewrites a previously closed shift snapshot.
- Payment receipts are shown by method, separately from canonical net revenue. Digital receipts expose provider-verified and unverified amounts separately; a manual PAID entry is not represented as provider verification. Pending orders and this actor/device's unsynced/review queues are separate indicators.
- A register lists its participating modules explicitly. One module can use a dedicated physical register; Retail + Barber can share a different explicitly configured register. Sector does not establish drawer ownership. A shared drawer requires current access to every participating module before its full balance can be read or closed.
- Only OWNER/ADMIN can configure the physical register; CASHIER cannot invent a dedicated drawer merely by entering a module. Register ID and shift ID bind new sales and cash movements to the existing canonical records. A configured register requires an explicit shift on a new sale. Opening float is appended once, not once per module. Expected cash is the exact sum of the bound canonical cash ledger; gross cash receipts, cash refunds, voids, cash in/out, opening float, actual count and variance remain distinct.
- Shift totals cover the complete register shift, including overnight operation. Daily revenue uses calendar-day boundaries independently. Shared-register aggregation visits each authorized module once; the single opening ledger entry is counted once.
- Register/shift writes and close serialize using register then shift row locks. A unique index allows one open explicit shift per physical register. New tender writes also synchronize with close. Closed shifts reject UPDATE, DELETE and TRUNCATE; module, operator and physical shift identity cannot be changed.
- Close requires the displayed server snapshot version. A changed ledger requires a recount. The original close command, actual count and explanation are persisted before transport; exact lost-ACK replay confirms the same immutable close. Changed close commands conflict instead of changing history.
- A nonzero variance requires an explanation. Manager rejection/approval and cashier resubmission append immutable review events. Accepting an explanation never changes money. Any subsequent management correction is a separate, reasoned canonical cash event, with the existing approval requirements for cash-out/reversal; the original variance remains unchanged.
- Legacy rows and shifts are not assigned to a guessed register or rewritten. Code requires the complete new schema and register RLS policies before granting v2 access. Migration replay order is 0063 through 0068; browser fixtures replay the same final order.

## Acceptance matrix

The synthetic HTTP workflows run as `svc_pos`; PostgreSQL17 CI runs them through independent NOSUPERUSER/NOBYPASSRLS network logins, including a second connection for concurrent close. Browser sessions use synthetic independent identities, not hosted identity-provider evidence.

| # | Required workflow | Implemented acceptance |
|---|---|---|
| 1 | Cashier opens, sells and closes own shift | Actual HTTP opening/retail/barber checkout/close; verified actor name; one opening event |
| 2 | Other cashier reads closed same-outlet shift | Read succeeds; another operator's close/edit is forbidden; history paginates |
| 3 | Equivalent cashier module permissions see same outlet day | Identical per-module daily results for two independent principals |
| 4 | Cross outlet/merchant/tenant/module access | Denied API requests and registered-cash/register RLS probes; shared drawer rejects incomplete module access |
| 5 | No cashier COGS/profit/company report | Existing report-denial assertions retained; transaction costs omitted and sell-side costs redacted |
| 6 | Expected cash equals canonical ledger | Fixture: opening 1000 + cash 250 - refund 40 - cash-out 20 + cash-in 30 = 1220 |
| 7 | Refund, QRIS, cards and cash-out classification | Separate cash refund/debit totals, QRIS/card receipts and unverified digital amounts |
| 8 | Cash variance and manager review | Actual 1215 vs expected 1220, -5 variance; reject, resubmit and approve; ledger unchanged by decisions |
| 9 | Replay/offline/concurrent close | Two connection close race; immutable command conflict; lost response after commit; durable retry; recount on changed drawer |
| 10 | One shared drawer, separate Retail/Barber revenue | Same physical shift from either module; one opening; module revenue remains separate; dedicated register stays separate |
| 11 | Historical immutability and audit | Closed UPDATE/DELETE and review-event mutation rejected; exactly one close audit; explicit later cash correction preserves original variance |
| 12 | Revoked/expired access | Membership revocation blocks even a previous close receipt; expired module prevents shared-drawer access |
| Extra | Overnight and date boundary | Controlled-clock synthetic shift crosses WIB midnight: shift has both sales; each calendar day has only its own sale |

## Browser acceptance

Disposable loopback fixture: two independent cashiers assigned to the same outlet and an explicitly shared Retail + Barber register. Observed Retail Rp10,000 + Barber Rp10,000 as two attributed sales and exactly one expected drawer balance Rp20,000. Operator entered Rp19,950 with an explanation; server-confirmed immutable history retained variance -Rp50 and a SUBMIT review event. A second independent cashier saw the same Rp20,000 outlet revenue and the first cashier's closed history without edit controls. Local screenshots are under ignored `build/cashier-rehearsal/`.

## Reproduce and rollout boundaries

- `npm run test:cashier`: real database/HTTP authorization and workflow assertions plus close outbox/recovery tests.
- `npm run verify`: complete existing database, financial, subscription, security, offline, DOKU synthetic, build/runtime and new cashier regression suites.
- PostgreSQL17 module rehearsal replays 0063–0068 twice, then runs existing workspace acceptance and the dedicated cashier acceptance, including concurrent requests on separate service connections. The existing security/rollback PostgreSQL17 workflow is also required.
- `node --import tsx scripts/dev/workspace-fixture.ts --isolated`: owner and two independent cashier browser sessions with outbound non-loopback requests rejected.

Ready only for isolated staging acceptance after the recorded checks pass. Hosted staff onboarding/login/refresh/recovery, physical multi-device acceptance, physical register assignment and production rollout remain gates from the previous matrix. A device cannot know another disconnected device's unsent sales: a new sale arriving for a closed explicit shift is retained for review and rejected from that frozen shift, rather than silently changing history or being reassigned. These limits do not authorize production activation.
