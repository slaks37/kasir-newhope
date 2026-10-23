# Full Neon clean launch — 22 October 2026

Owner decision: old users, merchants, outlets, POS transactions and subscriptions are development data. Do not import them. Preserve the old Supabase project and encrypted backup. Preserve real public blog content and its URLs. No real DOKU payments.

Baseline: production `d480cf841c4010ac23e2af2c9f8aeeaabdaa29e9`, including the deployed SEO fixes. This branch adds selected Full Neon changes to that exact baseline. Its review base is `codex/neon-auth-migration`, currently at the same SHA. It does not merge PR #21, #23 or #24, or change `main`.

## Targets

| Resource | Clean production target | Isolated staging |
|---|---|---|
| Neon project | `steep-sea-66546931` | same project |
| Branch | `br-falling-butterfly-az989m86` (`main`) | `br-morning-darkness-azwfti4c` |
| Business DB | `neondb` — clean schema bootstrapped | **new** `newhope_full_neon_staging` |
| Managed Auth DB | existing managed `neondb` | existing managed `neondb`, read through separate restricted pool |
| Public bucket | `blog-media` | `full-neon-public-media` |
| Private bucket | `business-files` | `full-neon-business-files` |
| Runtime SQL login | `newhope_clean_runtime` (production provisioned; restricted role verification PASS) | `newhope_clean_runtime` |

The staging branch's previous database and fixtures are untouched. Production is never pointed to this fixture branch. New business DB bootstrap refuses any populated business catalog and applies schema atomically. It excludes historical example admin/blog seeds. Only canonical plan configuration and preserved public blog content are seeded; no user or financial imports.

## Implemented and exercised

- Official managed Neon Auth SDK. Its Supabase-shaped compatibility adapter calls managed Neon endpoints; it is not Supabase Auth. Cookie credentials are explicitly included. The application-hosted Better Auth handler returns 404 in Neon mode.
- Full Neon login exposes the existing managed Google OAuth action. Its requested app callback is `/login`; a narrowly scoped same-origin landing bridge also forwards root-return session verifiers to the session-aware app shell. Provider failures surface in the UI. Initial analytics is suppressed for OAuth codes/session verifiers and the SDK callback route, before the SDK exchanges/removes those parameters. SDK tests exercise the actual installed adapter with synthetic provider success and denial.
- Signed EdDSA bearer validation, exact managed branch/JWKS binding, live verified/unbanned identity lookup, canonical UUID preservation and collision rejection. JWT role/MFA metadata cannot grant privileges. No automatic admin email linking in clean mode.
- Verified server onboarding creates one owner tenant, merchant, outlet and 45-day trial atomically, protected against replay. Pricing, Free plan policy, POS authorization and immutable financial ledgers retain the baseline rules.
- Managed password reset/verification UI. No screenshot, browser callback, or local profile authorizes a business API.
- Managed Neon does not currently support MFA. Application admin TOTP step-up therefore protects verified managed identities without running another Auth server: AES-GCM factor encryption, opaque proof bound to bearer+subject, ten-minute expiry, TOTP counter replay prevention, durable rate limiting, single-use recovery codes and mandatory audit.
- Private file upload/list/download/delete with server-derived tenant keys, UUID idempotency, canonical base64/size/type validation, five-minute presigned downloads, audit and server-side ownership. HTML/SVG are rejected. A failed metadata commit may leave an inaccessible private object; retry uses the deterministic digest key. Never run unreviewed orphan deletion.
- Public blog uploads use the selected branch's public bucket. 137 source articles and 134 referenced public images were copied to staging; authenticated and anonymous bytes/hash checks passed. No source Storage reference remains in that copied content. Source count/max-update was rechecked after the copy: 137, `2026-10-22 02:01:10.342461+00`.
- Offline reload restores only a prior verified profile and matching workspace within the existing 24-hour/plan boundary. It creates no Auth session and stores no bearer/password/admin proof in that profile. Reconnect reloads and revalidates managed Auth before sync; outbox bytes are retained.
- Remote runtime bootstrap/DDL remains disabled. Runtime uses verified TLS, bounded pools, eight-second statement timeout, no SQL ownership/DDL/BYPASSRLS and no session-token/password-column access in managed Auth.
- Full Neon rejects legacy Supabase runtime configuration and external gateways. DOKU requires explicit enablement generally and is forbidden by the Full Neon manifest. Free trial remains available.
- Clean schema manifest now includes the AI cache/wallet and multi-business operational namespace artifacts. Reviewed outer transaction wrappers are removed so a late bootstrap failure rolls back every file. Clean-only analytics foreign keys bind the actual merchant and its tenant; populated ambiguous rows abort rather than being remapped.
- Merchant-health now uses canonical refund/void-aware revenue, real UUIDs and schema columns, bounded batches, an advisory lock and atomic daily upserts. It does not infer paid MRR from manual subscription status. Native staging exercised non-empty merchant transactions and replay; all three cron handlers returned HTTP 200 (billing email remained dry-run).
- Maintenance flag prevents business DB pools opening and disables all three cron jobs. It provides a fail-closed recovery deployment preserving Neon state after new writes.

## Evidence and limits

See `evidence/staging-2026-10-22.json`. `npm run verify` exercises lint/typecheck, isolated migration bootstrap, build, runtime recovery and the complete regression suite, including Full Neon and the actual installed SDK with mocked transport. Native staging tests additionally exercised PostgreSQL, restricted-role denials, cash sale replay, inventory deduction, billing trial, private S3 signed/unsigned access and rollback. Native business fixtures were rolled back.

Fresh source DB/auth backup was encrypted at source and decrypted privately to validate scope/integrity: 165 tables including Auth; ciphertext SHA-256 `e8544709d6b7991c231567bbf88910c01ccda3e86a9b7e5a4da39ebfc3571db3`, existing public-key fingerprint `dfee9e320c8de8e0e02c90ae8451d43486628152`. Backup, private key, records and private credentials are excluded from Git. This is local verification, not a claim of newly accepted independent escrow/restore.

The latest native staging scenario duration is recorded in the evidence JSON (including the additional non-empty cron assertions). This is neither launch downtime nor alias propagation measurement. There is no measured production cutover timing yet. Do not publish an estimated downtime as a measured result.

Hosted Google sign-in, exact-UUID onboarding, logout/relogin and owner-device admin MFA are **PASS**. Real managed email verification/reset and a new credential-account session are **PASS** by owner completion plus authoritative metadata. Safari login/reload is **PASS by owner-device attestation**, with automated inspection unavailable. Immutable production acceptance remains pending. Anonymous-token/JWKS inspection is not authenticated-user acceptance; anonymous tokens use a different issuer/lifetime and must never authorize business APIs.

## Open external gates

1. **Release acceptance — managed email.** Owner saved main SMTP; read-only config confirmed custom Resend (`smtp.resend.com`, 465, username `resend`, sender `auth@kasir.newhope.space`). Official CLI authorization completed using the dedicated Keychain profile. Staging now has equivalent custom SMTP and mandatory OTP verification, with signup and signin verification delivery enabled. No additional email was sent in this setup step. Managed email verification passed. One authorized reset was delivered at 07:07:20Z; the owner completed the reset and login. Read-only metadata confirms the credential updated at 07:10:04Z and a new session at 07:13:50Z on the verified credential-only account. Exact UUID onboarding remains one tenant/merchant/outlet/trial45, without platform privilege. Inbox versus spam was not specified. See the session revocation limits below; previous Supabase/self-hosted tests are not used as acceptance.
2. **Google OAuth — hosted owner acceptance and publication PASS.** Created the owner-approved Web OAuth client in dedicated project `new-hope-512409`, verified without a billing account. Credentials are only in ignored mode-0600 local storage and managed Neon settings. Both exact branch callbacks below are registered, and readback confirms standard/custom Google credentials on main and staging. Branding uses the live application, privacy and terms URLs plus `newhope.space`. With explicit owner approval, the OAuth app is now In production. Verification Center states data-access verification is not required for its three basic identity scopes; branding is separately not displayed to users. Hosted owner Google sign-in, callback exchange, reload, logout/relogin and exact UUID onboarding passed on Preview `9f61a5e`; these do not prove public OAuth availability or email-password recovery.
3. **Staging owner admin — PASS.** After actual signed Google login and exact-UUID verification, the owner explicitly approved the first staging Superadmin grant. It produced one durable grant audit, and the owner completed TOTP enrollment plus recovery-code acknowledgement. No email-only linking or dummy admin seed. Production has a separate identity/admin/MFA acceptance gate; the staging grant does not authorize a production grant.
4. **Resolved — unused elevated roles.** After explicit owner approval, deleted only the newly-created unused `newhope_full_runtime` roles on main and staging. The application uses the restricted SQL-created `newhope_clean_runtime` replacement. No old role or data was deleted.
5. **Release engineer — production gates.** Automatic approval review rejected production business bootstrap while lint/provider gates were open. Do not bypass this. Once staging, provider and hosted gates are PASS, recheck those facts and execute the authorized reviewed production preparation. Clean main schema/runtime preparation is now executed; live-domain cutover has not occurred.

Callbacks:

```text
Production Google redirect:
https://ep-twilight-moon-azqj69l8.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth/callback/google
Staging Google redirect:
https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth/callback/google
Application password reset:
https://kasir.newhope.space/reset-password
```

## Reviewed launch sequence — preparation underway; promotion conditional

1. Complete external Auth/MFA gates and exact-commit CI/Preview acceptance. Refresh production deployment metadata; abort if the baseline changed unexpectedly.
2. Recheck source public-content count/hash against the encrypted snapshot. Refresh/review only public-content delta if it changed; never overwrite newer destination rows. Old dummy business data is not a migration gate.
3. Prepare clean main using `scripts/full-neon/bootstrap.mjs production`, then SQL-only runtime provisioning and `seed-config.ts production`, with the explicit owner clean-start approval marker. Scripts refuse populated/wrong targets. Copy reviewed public articles/media into production buckets using the verified manifest. Keep all old data and deployments.
4. Verify main runtime role grants/denials, TLS/pooling, empty business/account/financial counts, canonical plan catalog, managed Auth settings, public/private storage, no fixture imports, exact frontend/server environment and three cron targets. Preserve server blog API credentials so n8n continues through the same domain. No Supabase signup trigger handoff is required: no new business runtime uses Supabase Auth.
5. Stage an immutable production deployment with `--prod --skip-domain` only after the previous gates pass. Verify its URL with production-equivalent Auth, callback origin, cash/idempotency/inventory/isolation, file operations, trial/Free and blog/SEO. Keep DOKU OFF. Any launch smoke account requires an explicit reviewed owner/test-account policy; do not silently seed a public production fixture.
6. Briefly coordinate the public blog writer during the final content fingerprint/copy. The sole active New Hope n8n workflow discovered (`LY2WqUqboTtPgBSE`) uses the application RSS/validation/publish/cover HTTP APIs, not Supabase nodes; the other named repair workflow is inactive. Never claim this discovers unconnected external systems. Preserve API credentials; source DB connection is selected solely by the new deployment.
7. Promote that exact verified immutable deployment to `kasir.newhope.space`; measure actual promotion/HTTP acceptance, then verify public signup, managed session, fresh tenant/trial, real owner MFA and all three scheduled job targets. No payment tests or DOKU activation.

## Rollback

**Before any new Neon account/business write:** the prior immutable `d480cf8` deployment retains its original environment and Supabase data. Return the domain to it if needed, keeping all new Neon resources and evidence.

**After new Neon writes or registrations:** do not alias back to Supabase or restore an old snapshot over populated Neon. Those users/UUIDs, dependent products/outlets, ledgers, outbox ACKs and storage objects do not exist in the old system. Keep Neon Auth/DB/Storage intact. Deploy the verified Full Neon build with `FULL_NEON_MAINTENANCE=1` and the same resource bindings; all app business pools and crons fail closed. Snapshot/export new Neon state, preserve queues, identify dependent write closure and roll forward a tested correction on Neon. If moving data back is ever required, it needs a separately reviewed delta+identity recovery procedure and owner approval. No destructive reset, blind ledger replay, automatic charge/refund or production identity remapping.

Neon branch quota is currently 10/10. No old branch was deleted, no paid plan/resource was created. Cleanup is a later reviewed operation after launch/backup acceptance.

**Current recommendation: NO-GO for public promotion until the explicit external and hosted gates above pass. Passing mock/native staging tests alone is not production acceptance.**

Agent tooling was inspected and linked without overwriting environments; see [TOOLING.md](TOOLING.md).

### Hosted Google callback repair

The authorized owner test completed Google provider authentication and created one verified managed identity. The observed return reached the static root landing with a session verifier, so browser-session exchange and onboarding were not accepted. The landing now forwards only that opaque verifier to `/login`, drops unrelated callback parameters, and sends no referrer. The built-artifact regression verifies same-origin routing and inert marketing/untrusted redirect parameters. Full `npm run verify` passed after this fix. Updated Preview `9f61a5e` passed actual owner Google sign-in, removal of the verifier query, workspace reload and logout/relogin. Read-only exact-UUID checks confirm one binding, tenant, merchant, outlet, OWNER membership and trial45 after repeated login, with no platform admin grants. See `evidence/hosted-auth-2026-10-23.json`.

### Managed admin entry repair

The admin shell previously required a legacy browser identity hint before attempting `/api/admin/me`, and offered only password login. Managed Neon mode now restores the server-authorized session without that hint and offers Google sign-in with a same-origin `/admin` callback. A browser hint, OAuth success or a merchant-side ADMIN label grants no platform privilege. Server membership and MFA remain mandatory. New client transport tests cover Google denial, legacy-mode refusal, absent hints, membership denial, MFA preservation and absent sessions; targeted lint/typecheck/build, admin security and Full Neon tests passed. The owner explicitly approved the exact new staging UUID, the audited grant was applied, and hosted Google admin login reached mandatory MFA. Owner-device TOTP enrollment, recovery-code acknowledgement and the Superadmin dashboard passed; read-only verification confirmed the verified factor and audit without reading credentials.

### Email signup session repair

A real authorized email signup created one managed staging user and one delivered verification email, but the installed `SupabaseAuthAdapter.signUp` then requested a session and reported `Failed to retrieve user session`. An unverified user intentionally has no session. The regression reproduces that exact error using the installed SDK and synthetic transport. Full Neon signup now calls the official managed native `signUp.email` method, classifies only a successful matching unverified user response as awaiting confirmation, and returns no authenticated profile or token. Provider/malformed/network failures remain failures; verified responses require a matching real signed-session result. Signup is never retried and verification is never resent automatically. The callback targets `/login`, and the Neon-only message supports either the existing link or code. Business/role/verification metadata cannot override native identity fields. No real signup/email was repeated during the fix.

Targeted lint/typecheck/build, cloud-signup, installed SDK, Full Neon security and admin-security tests passed. A local loopback test initially hit sandbox `EPERM`; the affected tests passed with the permitted local-server execution. Actual email verification, password reset and a new credential-account session are now verified by owner completion and authoritative metadata; the original OTP expired and exactly one owner-approved replacement was delivered. Official verification semantics: https://neon.com/docs/auth/guides/email-verification .

### Verification form recipient and input repair

The hosted form reported `Invalid OTP`. Privacy-preserving inspection found its independent helper email did not match the approved recipient and the entered code was nonnumeric. No OTP or alternate recipient was read or published. The login and recovery helper now share a controlled email, show the destination explicitly, invalidate codes when it changes, reject nonnumeric input before any request and normalize surrounding whitespace. Provider rejection and expiry show actionable messages without exposing raw details. An in-flight guard prevents duplicate submissions; there is no automatic retry or resend. Actual installed SDK transport tests confirm the official email-verification type/path/body/cookies and rejection behavior. Real-component rendering and a browser fixture confirm recipient synchronization, stale-code invalidation, disabled invalid submission and one explicit synthetic verify without a send.

Two verification messages have been delivered in this acceptance sequence (initial plus exactly one explicitly approved replacement); exactly one previously approved reset message was subsequently delivered. Authoritative read-only inspection confirms the account was verified at 06:52:50Z, 29 seconds after the replacement send. The later form still displayed Invalid OTP; the exact sequence of prior submissions was not observed, so repeat consumption or a client/provider failure is not asserted as proven. No further verification is needed for this account. The owner subsequently completed reset and login, corroborated by managed credential/session metadata. Do not send a third verification email under the previous approval.

### Hosted password recovery acceptance and limits

The owner completed the HTTPS recovery flow after the single authorized reset email. Only credential metadata timestamps and session counts were read: the credential-only managed account was updated at `2026-10-23T07:10:04.361Z`, and a new active session was created at `07:13:50.018Z`. No password, hash, cookie, reset token, OTP or session bearer was read. A post-login exact-UUID query again found one binding, tenant, merchant, outlet, OWNER membership and trial45, and zero platform privileges. The browser workspace observed separately used the Google owner profile; it is not misattributed as direct visual proof of the email-account session.

No active session predating the credential update remained at inspection. The previous browser session had already been signed out before the reset, so this does **not** prove the reset itself revoked an existing session. No pre-reset JWT was retained for replay. Business API bearer validation currently bounds JWT age to 15 minutes and checks live verified/unbanned identity; it does not query a session revocation record for each bearer. Do not claim immediate revocation of an already issued JWT. Public release acceptance must account for this explicit limit. No additional email is authorized or needed for this acceptance.

### Public content delta — 23 October

A fresh read-only source comparison found 151 published posts versus 137 on staging: 14 new IDs, zero missing IDs and two existing rows changed only in view counts (0→1 and 24→30). All 151 captured source row hashes were compared with the reviewed source payload. The isolated staging copy now contains 151 posts and 148 preserved images. Only the 14 new images were downloaded and hash-verified through authenticated and anonymous access; 134 previously verified mappings were reused after existence checks and exact destination/hash-key validation. Counter-only updates require an explicit reviewed-delta flag and use the maximum of source/target, preserving newer target counters. UUID/slug, content, metadata and timestamp conflicts still abort; there is no blanket upsert or deletion.

An independent read-only comparison reconciled every field of all 151 staged posts against the captured source and asset mapping, with no legacy Supabase Storage references. Source and production writes remained zero. See `evidence/public-delta-2026-10-23.json`. This is a point-in-time public-content snapshot; recheck the final source delta immediately before launch because the existing writer remains active. Dummy business records were not imported.

### Clean main preparation and immutable MFA origin

After exact `870112a` CI/Preview, hosted provider/email/MFA and owner Safari acceptance passed, main was rechecked empty and the previous production-bootstrap rejection was re-evaluated through the approval reviewer. Atomic bootstrap succeeded with 72 migrations and the managed Auth schema preserved. Runtime provisioning uses a separate SQL-only restricted login and independent MFA key. Only the four unchanged canonical packages were seeded. Read-only verification confirms verified TLS, 8s statement/10s idle transaction timeouts, no privileged role flags/DDL, immutable ledger/audit ACLs, selected managed user columns only, and denial of password/session-token columns. Business accounts, transactions and admin seeds remain zero; see `evidence/production-preparation-2026-10-23.json`. Supabase and the live `d480cf8` deployment remain intact.

A real handler reproduction found that MFA on a production immutable Vercel URL was rejected with HTTP 403 before promotion. The handler now accepts only its own platform-injected immutable hostname pinned to the existing project/team, and only in Full Neon production mode. Membership and MFA are still required. Tests reject different deployments/teams, lookalike domains, HTTP, paths, preview-mode production access and missing authentication, with no MFA database reads on denial. Main managed Auth still needs that exact immutable origin registered after deployment; wildcard origins are never used.

Main content preparation now preserves the refreshed point-in-time source snapshot: 154 posts and 151 public media objects. All 151 destination objects passed authenticated and anonymous byte/hash verification on the production bucket. New source changes since the earlier 151-post snapshot were limited to three additional posts and two readership-counter changes, with no missing IDs or content/metadata rewrite. Final public-writer reconciliation is still required immediately before promotion.
