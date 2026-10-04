# Online-first — implementation and verification boundaries

Reviewed 2026-10-04. This replaces the old progress summary; historical trial capacities and empty-production observations are not current account facts.

## Sources of truth

| Domain | Authority | Device role |
|---|---|---|
| Sales, void, refund | Normalized server transactions and compensating records | Durable idempotent outbox and recovery snapshot |
| Cash movements | Server cash ledger | Temporary pending commands |
| Revenue and reports | Server reporting / canonical contract views | Render server result; never sum operational orders as revenue |
| Product, category, table, customer metadata | Scoped versioned shared state, domain projection | Cache and one active pending operation per scoped record |
| Identity / outlet / plan | Verified server membership, directory, canonical entitlement policy | Selection hint and bounded offline bootstrap |

## Implemented paths

- Startup verifies authentication, account/business identity, plan and active outlet before mounting the selected POS namespace.
- Business switching cancels outgoing hydration. Owner/business/sector identity scopes cache and pending records; another cashier profile does not become another account owner.
- Automatic background refresh handles relevant modules, focus and reconnect through the existing coordinator. Sync Center is the single user-facing inspection surface; routine successful sync does not need a manual button.
- Wrong-sector operational records are quarantined with recoverable data. Conflicting operations are handled per record, not by rolling back an unrelated whole batch. New edits replace the pending operation for that scoped record.
- Financial queues remain separate internally and are never automatically discarded. Legacy records with uncertain owner/outlet or different financial versions remain blocked for explicit review.
- Catalog projections do not overwrite normalized stock balances. Product photos travel through the existing versioned product field with payload limits.
- Server reporting and admin share financial sources. Displayed capacity comes from one account policy; business count and active/licensed outlet count are distinct.
- Connection probes fail promptly in serverless rather than using local startup backoff. Admin request deadlines do not retry writes whose server outcome may be unknown.

## Real limitations — do not advertise as completed

- Client stock displays still need authoritative per-outlet balance hydration and concurrent-device reconciliation. Ledger correctness alone does not prove every displayed quantity is current.
- Cashier role profiles are owner-authenticated kiosk roles, not independently authenticated employee memberships.
- Same-sector multi-business provisioning depends on the corresponding server migration/capability. A disabled capability must not be bypassed in the UI.
- Unknown legacy financial ownership cannot be repaired by guessing, deleting browser storage, or changing transaction outlet IDs.
- Automatic sync is polling/event-triggered, not a guarantee of instant push delivery or successful transmission while offline.
- Physical Epson TM-T82 Bluetooth printing on Windows/Chrome remains untested. Browser print preview cannot prove pairing, driver, or hardware output.
- Isolated two-device tests are regression evidence, not a substitute for a consented real-device production acceptance test.

## Verification

`npm run verify` exercises workspace/hydration, durable outboxes, conflict quarantine, financial/server reporting, subscription/admin policy, support, product images, DOKU, AI, MCP and build/cron entrypoints.

Production data repair must be scoped, backed up and separately verified. The 2026-10-04 legacy layout repair retained wrong-sector operational snapshots and did not alter financial ledger data. No further production data cleanup is implied by this document.
