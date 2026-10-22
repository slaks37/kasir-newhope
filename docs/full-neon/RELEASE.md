# Full Neon clean launch — 22 October 2026

Owner decision: old users, merchants, outlets, POS transactions and subscriptions are development data. Do not import them. Preserve the old Supabase project and encrypted backup. Preserve real public blog content and its URLs. No real DOKU payments.

Baseline: production `d480cf841c4010ac23e2af2c9f8aeeaabdaa29e9`, including the deployed SEO fixes. This branch adds selected Full Neon changes to that exact baseline. Its review base is `codex/neon-auth-migration`, currently at the same SHA. It does not merge PR #21, #23 or #24, or change `main`.

## Targets

| Resource | Clean production target | Isolated staging |
|---|---|---|
| Neon project | `steep-sea-66546931` | same project |
| Branch | `br-falling-butterfly-az989m86` (`main`) | `br-morning-darkness-azwfti4c` |
| Business DB | `neondb` — not yet bootstrapped | **new** `newhope_full_neon_staging` |
| Managed Auth DB | existing managed `neondb` | existing managed `neondb`, read through separate restricted pool |
| Public bucket | `blog-media` | `full-neon-public-media` |
| Private bucket | `business-files` | `full-neon-business-files` |
| Runtime SQL login | `newhope_clean_runtime` (production not yet provisioned) | `newhope_clean_runtime` |

The staging branch's previous database and fixtures are untouched. Production is never pointed to this fixture branch. New business DB bootstrap refuses any populated business catalog and applies schema atomically. It excludes historical example admin/blog seeds. Only canonical plan configuration and preserved public blog content are seeded; no user or financial imports.

## Implemented and exercised

- Official managed Neon Auth SDK. Its Supabase-shaped compatibility adapter calls managed Neon endpoints; it is not Supabase Auth. Cookie credentials are explicitly included. The application-hosted Better Auth handler returns 404 in Neon mode.
- Full Neon login exposes the existing managed Google OAuth action. Its app callback lands on `/login`; provider failures surface in the UI. Initial analytics is suppressed for OAuth codes/session verifiers and the SDK callback route, before the SDK exchanges/removes those parameters. SDK tests exercise the actual installed adapter with synthetic provider success and denial.
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

Authenticated hosted public signup, real email delivery/reset, Google callback, owner-device MFA, Safari cross-site session behavior and immutable production acceptance are **not yet PASS**. Anonymous-token/JWKS inspection is not authenticated-user acceptance; anonymous tokens use a different issuer/lifetime and must never authorize business APIs.

## Open external gates

1. **Release acceptance — managed email.** Owner saved main SMTP; read-only config confirmed custom Resend (`smtp.resend.com`, 465, username `resend`, sender `auth@kasir.newhope.space`). Official CLI authorization completed using the dedicated Keychain profile. Staging now has equivalent custom SMTP and mandatory OTP verification, with signup and signin verification delivery enabled. No additional email was sent in this setup step. Actual managed email delivery/HTTPS reset and session acceptance still require testing; previous Supabase/self-hosted results do not establish this.
2. **Google OAuth — configured; hosted/public acceptance pending.** Created the owner-approved Web OAuth client in dedicated project `new-hope-512409`, verified without a billing account. Credentials are only in ignored mode-0600 local storage and managed Neon settings. Both exact branch callbacks below are registered, and readback confirms standard/custom Google credentials on main and staging. Branding uses the live application, privacy and terms URLs plus `newhope.space`. The OAuth app remains Testing with one owner test user; public publication/Google verification when required and actual hosted sign-in/session acceptance are still open. Credential presence is not a successful login.
3. **Owner — first admin identity.** Register/verify the new managed account, prove the exact new UUID, then authorize its explicit admin binding. No email-only claim or dummy admin seed. Complete TOTP and save recovery codes on the owner's device before public admin use.
4. **Resolved — unused elevated roles.** After explicit owner approval, deleted only the newly-created unused `newhope_full_runtime` roles on main and staging. The application uses the restricted SQL-created `newhope_clean_runtime` replacement. No old role or data was deleted.
5. **Release engineer — production gates.** Automatic approval review rejected production business bootstrap while lint/provider gates were open. Do not bypass this. Once staging, provider and hosted gates are PASS, recheck those facts and execute the authorized reviewed production preparation. No production DB/env/deployment cutover has occurred.

Callbacks:

```text
Production Google redirect:
https://ep-twilight-moon-azqj69l8.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth/callback/google
Staging Google redirect:
https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth/callback/google
Application password reset:
https://kasir.newhope.space/reset-password
```

## Reviewed launch sequence — conditional, not executed

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
