# PR35 release gates and non-production rehearsal

PR35 remains Draft. No merge, production deploy, production migration or real DOKU activation is authorized by this runbook.

## Auth and staff handoff

Use the release staging `/register` in a separate browser profile with an unused approved mailbox. Owner enters password and accepts terms directly, opens the actual verification email and signs in. Verify Better Auth user/email status, consumed registration intent, canonical mapping, one tenant/trial and explicit first outlet. Confirm a repeated request does not duplicate ownership. Do not create an authenticated fixture or forge email verification.

For Google, select the reviewed owner account; confirm canonical workspace and refresh, then exercise logout and confirm protected routes deny. Start a fresh login before MFA enrollment (five-minute session freshness window). Owner privately stores TOTP key and recovery codes, verifies TOTP, and tests one recovery code. Recovery must not count as fresh financial/admin TOTP. Reusing recovery or OAuth state must fail. Owner completes any credential-entry steps directly.

Staff invitation uses normal owner UI with recent TOTP, exact outlet/module assignment and a real allowlisted mailbox. Accept through the real mail, register as STAFF, log in independently, and verify cashier/manager grants. Check read/write denial across tenant, outlet and module, active-session revocation, and removal of membership. Preserve historical cashier PINs and actor IDs. No direct membership inserts to simulate this gate.

## DOKU matrix

Checkout stays OFF. Existing local suites (`test:doku-client`, `test:subscriptions`, PostgreSQL payment rehearsal) use intercepted provider responses; they establish implementation behavior only.

| Case | Required result | Real-provider gate |
|---|---|---|
| Channel/client eligibility and endpoint | Exact approved QRIS channel, credentials, merchant, API base | DOKU Care confirms settings and minimum IDR pilot amount |
| Signature | Raw-body independent HMAC, exact request ID/path/time, duplicate headers and invalid signatures rejected | Provider signed callback captured and verified privately |
| Inquiry | Authenticated authoritative order/payment, exact account/currency/amount | DOKU inquiry for the separately approved pilot |
| Webhook replay | Exact replay acknowledged once; changed body under same key rejected/quarantined | Resend original provider notification; no second financial effect |
| Ordering/race | Inquiry/webhook arrival order converges to one authoritative invoice state | Compare both records to settled payment |
| Reconciliation | Foreign tenant/order/account/amount/currency never activates invoice | Approved pilot with exact mappings |
| Subscription | Paid state grants entitlement once; duplicate callback cannot renew twice | Real invoice, settlement and exactly one subscription transition |
| Failure recovery | Timeout/unknown result triggers inquiry, no blind new charge; invalid/stale data quarantined | Provider failure scenario agreed with DOKU |
| Approval binding | Missing/expired/revoked approval, wrong credential fingerprint or tenant fails closed | Owner + provider evidence in exact pilot acceptance record |

Provider action: merchant admin submits the prepared sanitized DOKU Care package for blank QR Payment and HTTP Notifications frames, requests channel authorization, notification URL/settings, inquiry capability and minimum amount. Only then prepare one invoice with exact tenant, amount and expiry for separate payment approval. No nominal-only matching or manual PAID edit.

## Production read-only binding audit

Record active production alias → deployment SHA and compare deployed configuration metadata with project env updated timestamps. Report declarations separately from runtime proof. Public health is not proof of database, role or Auth identity continuity. Never print connection strings, tokens, signing keys or mailbox links.

Before promotion, an authorized production operator must privately record runtime project/branch/endpoint/database, `current_user`, server version, applied migration identifiers and Auth issuer/provider, and demonstrate a known existing canonical owner resolves without ID/ownership changes. Do not infer bindings from a dashboard's database label. The candidate Better Auth production guard stays intact until this evidence and provider rollout are approved.

## Backup, restore, migrations and rollback

1. Capture approved change window, writer inventory/freeze, active sessions/outboxes, baseline row counts and business fingerprint. Verify Neon capacity and restore-window policy; retain relevant branches until dependency audits and deletion approvals are complete.
2. Take encrypted full logical backup and appropriate Neon snapshot/PITR restore point. Verify key custody and expiry privately. Preserve globals, schema, role grants, function owners, forced RLS/policies and identity mappings. Never put backup contents or credentials in PR artifacts.
3. Restore to a **non-production** target with writers disabled and provider/email/payment side effects OFF. Reconcile all financial/stock/job/payroll tables, sequences, identity bindings and role/ACL metadata. Prove restricted roles, negative tenant checks and known canonical identity continuity. A restore of synthetic CI data does not prove a production backup was restored.
4. Rehearse forward migrations 0076–0079 on the restored copy. Check additive schema, old/new application compatibility, replay, planned locks/timeouts and actual PostgreSQL version. Production migrations require a separate approved gate; none are executed here.
5. Session continuity: compare old/new issuer/cookie host/domain, verified subject mapping and signing configuration privately. Do not silently switch Supabase/legacy identities. Demonstrate login, refresh, logout/revocation and staff membership continuity against the restored data. Restrict provider egress to the rehearsal environment.
6. Rollback first pauses new writes and provider processing; preserve outboxes and acknowledgement evidence. Restore prior application flags/build only when backward compatible. Revoke only the reviewed identity batch if needed; never guess mappings. Prefer forward repair over dropping financial schema. A database point-in-time restore needs a reviewed reconciliation plan for writes since the restore point and idempotent payment replay.

CI `security-postgres17.yml` runs actual disposable PostgreSQL17/18 migrations, role/RLS/workflow replay, encrypted synthetic backup/restore and identity rollback. Inspect its uploaded evidence for the exact PR head. This satisfies non-production simulation only; real production restore remains BLOCKED until performed and reconciled.

## Neon capacity monitor

Prepared monitor workflow must be introduced on `main` only as an approved narrow change. Use a dedicated least-privileged monitoring credential via Actions secret; do not reuse DB owner or production Auth credentials. Verify manual dispatch and threshold alert, no branch creation/deletion and no paid activation. Keep unresolved historical deployment-dependent branches. Capture current branch count; do not assume historical 5/10 remains current.

## Native acceptance

Android emulator restart/outbox tests, iOS simulator compilation and synthetic secure-vault models are separate evidence. Foundation CI intentionally uses `https://unconfigured.invalid`; those artifacts cannot prove staging login. Existing PR29/PR30 public staging profiles also cannot certify PR35.

Build explicit PR35 native assets only with reviewed public issuer/API origin/offline verification key matching the release Preview and an approved reachable API boundary. No embedded Vercel bypass or server secret. On physical Android and iPhone independently test real Google/password login and MFA, secure-vault persistence after kill/restart, device lock/unlock, expired/revoked sessions, offline restart, queued original intent/exact acknowledgement, reconnect retries and duplicate prevention. Check scanner/printer on intended hardware. Owner supplies signing/team/keystore access privately; verify signed archive/install and distribution separately. Do not claim store readiness from unsigned simulator/debug artifacts.
