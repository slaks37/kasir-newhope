# Financial authorization release — draft, not deployed

Confirmed: privileged void/refund and drawer mutations previously trusted local/browser authorization. Owner bootstrap PIN was 1234. Local profiles are not independently verified cloud identities. No historical actor claims are relabelled as verified.

Change: server owner identity + salted scrypt PIN; durable five-failure/15-minute lockout and 60 attempts/window; hashed 256-bit grants expire in 90 seconds and bind tenant, merchant, outlet, cloud actor, action, transaction/event reference and exact command. Audit records approver, actor, server time, reason, reference and hash. Exact consumed-command retries are idempotent; rotation revokes all grants. Initial enrollment and rotation require fresh Supabase password verification for the same confirmed owner. Password/PIN/auth tokens are never written to audit. OAuth-only owners must establish a password using account recovery first; independent cloud manager delegation is not implemented.

Ordinary offline sales/cash-in remain queued. Void/refund/cash-out/reversal require online server approval, and local financial/inventory state changes only after server acknowledgement. An uncertain network response requires reconciliation before retry; no offline financial authorization is granted. Historical pending privileged commands are rejected until reviewed/reapproved; do not silently discard their history.

## Staging and deployment order

1. Review database ACL PR separately; verify actual service connection roles and backend dependencies.
2. Snapshot schema/grants (not customer data in this repository). Apply the additive Supabase migration `20261012092414_server_financial_approvals.sql` to staging, once. Local `migrations/0059_...` is the same migration for bootstrap, not an additional production application.
3. Test service-role access/RLS plus anon/authenticated denial; exercise five sectors, tenant/outlet negatives, void/refund/drawer actions, no-grant/tampered/expired/replay requests and durable lockout. Verify enrollment contacts only the configured Supabase Auth HTTPS endpoint.
4. Enroll a staging owner's strong PIN through Settings → users → PIN finansial server pemilik. Test fresh password failure and OAuth recovery flow. Train owners about changed offline behavior before release.
5. Deploy server and client atomically only after schema exists. Verify online sale/approved void/refund/cash events and offline ordinary sales on two devices; compare stock/revenue and immutable audit. Inspect logs for absence of passwords/PINs/tokens.

## Rollback

Do not redeploy a vulnerable pre-approval server as rollback. Disable privileged commands at the gateway if the new authorization service fails; ordinary sale paths stay available. Keep credential/grant/audit tables and immutable audit trigger. A fixes-only previous secure build may be redeployed. Any removal of tables requires an explicit reviewed export/retention plan; never DROP financial audit during rollback. Changing PIN revokes grants but does not delete audit. No production SQL or data mutation was performed by this task.

## Evidence

Isolated PGlite + HTTP regression exercises existing five-sector POS, billing/subscription, multiple outlets, inventory, reports, exact replays, immutable financial audit, stolen/tampered/expired grants and persisted five-failure lockout. Unit tests verify random-salted scrypt, weak-PIN rejection and command hashes. These are isolated tests, not evidence of staging deployment, Supabase connection-role parity, or independent local cashier identity. Production readiness remains gated on those checks.
