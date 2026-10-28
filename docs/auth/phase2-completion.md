# Phase 2 continuation and acceptance

Baseline inspected on 2026-10-28: PR27 `12e3d11070f7fa803a8f2e9796f6f5027bcc7474`, PR28 `f6a4bdc2844cd82b9db9504811d4641b45fb584b`, PR29 `03121ae9c5e84b0a0134fb9f782a383c24ada2ea`. This follow-up is stacked on PR29. The agreed four phases are retained.

| Phase | Status |
|---|---|
| 1 | COMPLETED within the PR28 documented scope; existing Capacitor, SQLite and verification are retained |
| 2 | PARTIAL; the new staff contracts and rehearsal are implemented, but the hosted/provider/device/storage gates below remain |
| 3 | NOT ACCEPTED and not started here; native financial gate stays closed |
| 4 | NOT ACCEPTED; no signing, store publication or production activation |

## Exact gap and acceptance matrix

| Phase 2 requirement | Existing evidence / new implementation | Remaining gate |
|---|---|---|
| Hosted web auth | PR29 recorded real Google/password/verification/reset/TOTP/backup recovery/revocation and offline browser recovery; the same Better Auth engine is retained | Follow-up branch hosted regression is NOT RUN until a correctly isolated Preview is configured |
| Staff invitations | New owner/delegated-admin UI and private service API; 24-hour random one-use email token, SHA256-only persistence, verified recipient, current inviter authority, idempotency and delivery failure handling | Real email/browser acceptance on the follow-up Preview is NOT RUN; tests capture email locally |
| Staff administration | Explicit merchant/outlet/module assignments, activation/deactivation, role edits, bounded ADMIN delegation, status review, CAS and immutable audit | Hosted staff operations remain unaccepted with both module rollout flags0 |
| Role isolation | CASHIER/MANAGER/ADMIN/OWNER/ACCOUNTANT/STAFF and Barber KAPSTER tested; OWNER membership never changes tenant ownership; ACCOUNTANT gets read-only report permissions | BARISTA/CHEF/WASHER invitations fail closed because their module v2 workflows are not accepted in the existing foundation |
| Native auth | PR29 configured staging APK/simulator builds and protocol contracts exist; foundation Android/iOS CI is retained here | Installed Google/password/MFA/PKCE/deep-link/restart/user-switch acceptance needs devices/emulators with actual authorized provider sessions |
| Identity migration | Reviewed digest-bound existing-account mapping retained; differing-ID tests preserved; new staff never repoint existing mappings or historical actors | Frozen production-source inventory/review is not authorized and is not read or copied |
| Backup/restore | New PG17 CI rehearsal uses pg_dump17, authenticated encryption, wrong-key/tamper rejection, restore to a new disposable DB and full row/sequence/RLS/helper owner/ACL comparison | Inspect the generated `postgres17-auth-backup-evidence`; it is synthetic CI evidence, not production key escrow or hosted provider restore acceptance |
| Provider rollback | Rehearsal checks explicit mapping revocation, forced reauthentication, wrong-batch failure and preserved business/financial fingerprints | Actual hosted alternate-provider rollback remains pending; legacy production provider is retained |
| Zero Supabase target | Auth graphs remain isolated; Neon media upload now rejects before loading the legacy Storage SDK or using credentials | Replacement object store, live approved object inventory, URL mappings/redirects, complete backend release-graph/env removal and hosted verification remain unfinished |

Tests must be reported separately: local synthetic HTTP/SQL, actual PG17 service LOGINs, hosted provider/browser, emulator SQLite and physical devices. A green native build is never recorded as installed authentication acceptance. CI evidence for this follow-up is linked in its Draft PR; check the run SHA before using its artifacts.

## Staff account contract

Migration0072 adds private, forced-RLS invitation/assignment/audit tables and optional managed-membership metadata. Existing memberships default to unmanaged and are not rewritten. The new svc_staff NOLOGIN group has no auth credentials, PIN, tenant ownership or financial ledger authority. Every API operation assumes that role in one transaction; an application LOGIN missing its explicit role grant fails closed. The staging provisioning helper includes the role for a fresh empty rehearsal only; existing logins/configuration are not changed by this PR.

The actual active canonical tenant owner may invite and manage staff. ADMIN needs an explicit can_manage_staff delegation and an ADMIN assignment covering every affected outlet/module. Delegated ADMIN cannot grant ADMIN/OWNER, delegate administration, edit itself, or edit another scope. Every mutation requires session-bound TOTP within five minutes, including invitation revocation. User metadata and supplied principal headers do not authorize access.

The recipient signs in or registers through existing Better Auth flows, verifies the exact invited email and explicitly accepts. An invitation does not auto-link a historical identity by email. Existing canonical-email collisions and existing legacy memberships require migration review. The invitation token is kept only in a short-lived browser session during login, removed from the URL, never returned to the inviter and cleared on acceptance. The API rechecks current inviter permission, canonical user activation, tenant activation, expiration and one-use consumption under a row lock.

Managed staff receive only explicitly selected outlet/module roles. The parent TENANT/STAFF membership is not a broad workspace grant: module authorization and workspace directory both filter managed assignments. Revocation affects subsequent server requests immediately, retains the canonical identity and historical financial actor projection, and does not create an owner subscription. Remote revocation cannot be discovered offline; existing bounded leases remain, and replay always rechecks live authorization. No queue is deleted by staff administration.

Eligible v2 modules remain the previously accepted Retail/Barber adapters. Inviting staff does not enable a module, grant a subscription entitlement, activate a rollout flag, or enable native checkout. The UI explicitly reports the operational rollout gate after acceptance. OWNER membership is still distinct from owner_user_ref.

Email transport uses the existing verified sender and staging recipient allowlist. Creation is audited before delivery; only a delivered-to-provider invitation becomes SENT. A transport error produces DELIVERY_FAILED and no usable invitation. Ambiguous delivery requires revocation and a fresh invitation; no token is recovered from logs. Resend delivery is separate from inbox placement.

## Synthetic backup/rollback rehearsal

The rehearsal accepts only the existing disposable loopback PG17 target and refuses an existing restore database. It verifies the Docker service owns the approved port, uses the actual PG17 pg_dump/pg_restore tools, preserves role ownership, and restores into a newly created database. Private fixture bytes are deliberately synthetic and are never treated as working provider credentials. Plaintext and the ephemeral AES-256-GCM key stay in process memory; wrong keys and tampering fail before restore. Only bounded hashes/counts/status JSON leave the test. The restore database is cleaned up after the test; no production URL, default DATABASE_URL, live MFA secret or live user snapshot is accepted.

The reviewed fixture mapping uses actual business fingerprints, then verifies restore, explicit revocation, session removal, wrong-batch refusal and refusal to silently reapply a revoked migration. This is not an approved production backup policy. Durable private key escrow, restore ownership, real provider account/session recovery and a frozen-source rollback window still require review.

## Supabase inventory and object migration path

| Surface | Source inventory | Treatment / gap |
|---|---|---|
| Browser legacy Auth | src/lib/supabase.ts, authClient.ts, authRuntime.ts | Legacy production selection retained; Neon web/mobile build graph excludes SDK implementation |
| Native legacy Auth | legacyNativeAuth.ts; lifecycle/status use the provider-neutral adapter despite legacy variable aliases | Native Neon graph check retained; installed sessions still require acceptance |
| Gateway/backend legacy Auth | services/shared/auth.ts, legacyAuthOperations.ts, authProviderOperations.ts | Explicit provider dispatch retained; no Neon-to-legacy auth fallback. Final backend release graph still needs strict elimination of unused legacy code |
| Blog object upload | src/server/blogMedia.ts; legacy blog-media public bucket, JPEG max500KB, author UUID/random UUID object path | Neon now returns BLOG_OBJECT_STORAGE_NOT_CONFIGURED with zero legacy network calls. Legacy SDK is loaded only on the legacy path |
| Product/photo/receipt/profile data | Operational JSON, existing photo helpers, receipt-logo route and historical URL fields | No live object inventory or private records read; classify inline data versus approved public/private objects before migration. Do not add bulk blobs to Postgres |
| Dependency/configuration | @supabase/auth-js and @supabase/supabase-js remain for legacy compatibility; VITE_SUPABASE_*/SUPABASE_* variables and the optional pool remapper remain | Remove from the final target release only after replacement and rollback gates; production variables/resources are untouched |
| SQL/fixtures | supabase/migrations mirrors and legacy compatibility SQL | Migration history is evidence, not a running Supabase service; do not delete or rename it to claim a zero-dependency release |
| Jobs/admin | Provider-neutral auth operations exist; integration/configuration text and generated API bundles retain legacy compatibility | Recheck each final target cron/admin entry with a clean environment and no Supabase endpoint access |

Proposed object backend: S3-compatible storage, with Cloudflare R2 as a candidate requiring owner approval of account/bucket/domain/credentials. Its [official S3 compatibility matrix](https://developers.cloudflare.com/r2/api/s3/api/) must govern the adapter; do not assume every AWS ACL/versioning/locking feature is implemented. No R2 resource or credential is provisioned by this PR.

Migration must inventory only approved source buckets/records; record old URL, exact object key, media type, visibility, size and SHA256 in a private manifest. Copy to immutable destination paths, verify readback hashes and access policy, then produce reviewed old→new URL mappings. Keep old public URLs available or implement verified redirects where the old host is controlled; a new host cannot silently redirect an old Supabase hostname. Private attachments require authenticated delivery and a separate policy. Re-fingerprint before any apply, refuse drift, retain the original object until the rollback window closes, and never delete Supabase objects to make a test pass. Live inventory/copy and final URL cutover are NOT RUN.

## Hosted follow-up deployment boundary

Prior credential-transfer, Google callback and public native API approvals are scoped to codex/neon-auth-cross-platform. They do not authorize sending secrets to this new branch. The concrete next staging step is an isolated empty database for synthetic staff/owner fixtures on the approved non-production Neon branch, a branch-only Preview configuration, a callback registered for its exact Preview origin and restricted test email delivery. Existing PR29 callback/domain/database and all production access must remain intact. Prepare/review that exact destination before requesting approval; do not reuse production credentials or silently migrate the previous staging database.
