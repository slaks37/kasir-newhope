# Neon-backed authentication migration

Stacked on Draft PR28 `f6a4bdc2844cd82b9db9504811d4641b45fb584b`. Capacitor projects, SQLite journal, module/outlet isolation and canonical ledgers are retained. Native financial checkout stays disabled. Production activation is blocked in code, and default auth selection remains the existing provider until migration and rollback acceptance pass.

## Decision and current managed implementation

On 2026-10-27 the existing managed Neon Auth staging branch was inspected read-only. Email/password, verified-email requirements, Google provider and SMTP configuration exist; secrets were redacted by the connector. This configuration is not evidence that its login workflows passed.

The current [Managed Auth roadmap](https://github.com/neondatabase/website/blob/main/content/docs/auth/roadmap.md) still lists MFA as pending and describes limits for a separate frontend/backend. Its [plugin matrix](https://github.com/neondatabase/website/blob/main/content/docs/auth/guides/plugins.md) does not expose TOTP. New Hope requires session-bound MFA and independent mobile clients. The implemented alternative is self-managed **Better Auth 1.7.14 backed by Neon PostgreSQL**, hosted at the existing app's `/api/auth/*`; no new auth SaaS or financial identity is introduced. [Better Auth Google](https://better-auth.com/docs/authentication/google), [TOTP](https://better-auth.com/docs/plugins/2fa), [signed bearer](https://better-auth.com/docs/plugins/bearer).

| Mandatory capability | Managed Neon evaluation | Selected implementation |
|---|---|---|
| Google OAuth | Configured in managed staging; configuration does not certify login | Dedicated staging client and official Better Auth callback |
| Email/password and reset | Supported by existing managed configuration | Verified email, password policy, restricted real sender, one-use reset |
| MFA and backup recovery | TOTP remains a managed roadmap gap | Official self-managed TOTP and one-use backup codes; only TOTP grants fresh `aal2` |
| Session revocation | Configuration inspection does not prove cross-client revocation | Authoritative live session lookup, explicit revoke/reset tests |
| Staff and historical identities | Provider IDs do not establish business membership | Reviewed explicit canonical mappings and existing server RBAC |
| Native OAuth/recovery | New Hope requires app-level deep-link and PKCE integration | System browser, sealed MFA state, single-use PKCE handoff; real-device gate retained |

## Runtime contract

- Browser/PWA use HttpOnly secure cookies, live database sessions and same-origin auth. Session renewal headers propagate back to the client. Native uses signed opaque bearer credentials in the existing Keystore/Keychain adapter. No browser token persistence is introduced by the Neon adapter.
- Client types, lifecycle, signup/recovery, admin MFA, support/reminders and owner PIN reauthentication select the configured provider explicitly. A Neon outage never falls back to Supabase or demo login. The legacy adapter preserves production session compatibility and rollback; the SDK remains installed for legacy Auth and existing Supabase Storage. This PR does not claim all Supabase products were removed.
- Neon web/native build aliases exclude legacy Auth modules. `check-neon-auth-bundle.mjs` rejects SDK/endpoint signatures. Legacy-mode regression remains part of `npm run verify`.
- Every API request validates a live session, active verified provider user, active explicit canonical mapping and existing business/membership authorization. A bearer cannot silently downgrade to another cookie session. Cookie-authenticated writes require an exact trusted Origin. Failed/revoked sessions return 401; dependency outages return 503.
- Official TOTP and recovery codes are available to merchant/staff accounts. Only successful official TOTP produces recent `aal2`; recovery codes provide login recovery at `aal1`. Password login, Google login, user metadata and trusted-device cookies do not manufacture step-up evidence. Changing MFA requires recent TOTP. Google-only owners may authorize PIN enrollment with verified Google identity plus fresh session-bound TOTP; password accounts retain password reauthentication.
- Raw provider-token/account-linking APIs are disabled, including noncanonical path variants. Once MFA is enabled, secret retrieval, password changes and session management require recent session-bound TOTP. Explicit bearers cannot fall back to another cookie principal. Logout honors local/global/other-session scopes.
- Native Google uses the system browser, provider state, a random transaction and S256 PKCE. Callback URLs carry a 60-second single-use code, never a session token. Exchange atomically checks the verifier and current session. Native password-MFA pending cookies are purpose-bound, authenticated encrypted short-lived state relayed only to the exact auth endpoint; normal session cookies are never relayed this way.
- Password reset uses one-use HTTPS links and revokes all sessions. Recovery may finish in the system browser; the user then signs into the native app again. Universal/App Link activation from PR28 remains pending, separate from the existing exact custom-scheme callback.

## Identity and database boundary

`internal.auth_identity_bindings` maps provider + exact issuer + arbitrary provider ID to the historical canonical UUID. Both frontend `user.id` and backend principal use that canonical UUID, preserving owner/outlet/module memberships, admin subject bindings, immutable financial actor references and browser/SQLite queue namespaces. Email or sector never claims an existing account.

Existing users require reviewed digest-bound mapping manifests. New verified users can enroll only through a recorded server-created signup intent and a narrowly scoped function; an existing canonical email blocks automatic enrollment. No tenant, subscription, staff membership or ledger row is created by identity enrollment. See [identity migration](identity-migration.md).

Migrations0069/0070 are additive and replay-tested. Auth data has a separate restricted `svc_auth` role, with no ledger access or generic identity mapping writes. Enrollment has a separate NOLOGIN definer role with explicit RLS policies, never runtime role membership. Normal application roles cannot read credentials, sessions, MFA secrets or native handoffs. Runtime role checks reject superuser/BYPASSRLS and incorrect grants.

## Staging configuration

Neon server selection: `AUTH_PROVIDER=neon`, `NEWHOPE_NEON_AUTH_STAGING=1`, `APP_ENV=staging`, exact `NEWHOPE_AUTH_URL` origin, separate `BETTER_AUTH_DATABASE_URL` and 48+ character secret, explicit Neon branch/host. Production environments always reject this migration runtime. Client selection: `VITE_AUTH_PROVIDER=neon` and `VITE_NEWHOPE_AUTH_URL=https://<same-app-origin>/api/auth`. Native also supplies its approved HTTPS API origin. No privileged key may use a VITE prefix.

Google requires dedicated staging credentials and the exact `<auth-origin>/api/auth/callback/google` registered in the provider. Missing provider configuration returns an unavailable error. Verification/reset require an enabled, verified email sender with staging recipient allowlist; provider acceptance alone is not inbox delivery acceptance. Enter secrets only into the ignored private staging environment file or provider settings.

The temporary staging target is an empty database `newhope_auth_pr29` on existing non-production branch `br-plain-snow-azjwwq6u`; production rows were not copied. A schema-only child attempt was rejected by Neon because of legacy web-access roles; those roles were preserved. Historical baseline migrations create their public Platform Root seed; it cannot acquire a new identity by matching email. No source users/passwords/sessions/MFA secrets were imported into this database.

## Acceptance and rollback gates

| Requirement | Implemented / local evidence | Hosted / real-device gate |
|---|---|---|
| Email/password and verification | Actual Better Auth + isolated SQL | PASS real Preview signup, HTTPS verification, password login and reset; Resend reports delivered. Connected inbox search found no matching message, so inbox placement is unverified |
| Google OAuth | Official provider, exact callback, no auto-link | PASS real Google SSO in Preview, exact registered callback, browser HttpOnly session and `/identity` with verified Google provider, canonical UUID and no credential password |
| MFA and recovery | Actual TOTP/backup engine, session proofs and authorization tests | PASS hosted TOTP `aal2`, independent recovery session `aal1`, recovery cannot disable MFA; UI acceptance pending |
| Revocation and reset | Live database sessions; local/global/other-session scope semantics | PASS hosted reset revokes two independent HTTPS sessions, rejects token replay; explicit revoke rejects native-origin signed bearer. Physical cross-device check pending |
| Historical owner and independent staff | Differing-ID mappings; business/ledger fingerprints and canonical actor continuity | Reviewed frozen-source mapping and user acceptance pending |
| Browser/PWA | Provider-neutral client and Neon bundle checks | PASS real Google web sign-in, verified cookie session, trial, business creation, server-owned first Retail outlet and cloud dashboard. PWA installation/offline reauthentication and full native UI gates remain pending |
| Android/iOS | Capacitor/secure storage, S256 handoff, native state tests | Both native CI jobs PASS at `3a92137`; hosted native-origin protocol PASS through protected CLI transport. Installed app sessions blocked by unavailable local device/runtime; not physical-device evidence |
| Rollback | Legacy regression retained, mapping revocation fails closed, no actor rewrites | Hosted alternate-provider rollback rehearsal pending |

Hosted protocol evidence on 2026-10-28 (Asia/Jakarta): Preview `dpl_6sMKFonXurtFdW7DqHZQBniNseV8`, source `3a9213760fc7c9b98e8f7b84199fac212b381855`, with explicitly approved branch-only credentials and the single-recipient email allowlist. Existing Vercel authentication accessed protection; no bypass credential was embedded into a native build. Private response/cookie/fixture files in the original temporary checkout were lost on host restart after testing. Their recorded tool results establish the tests above, but secrets are never reconstructed from logs or committed. Source and approved Preview configuration were restored into a persistent workspace; the hardened runtime and UI were rechecked in Preview `dpl_CNeyxkAzgWScqjX9ew9r1oa3xJUU` at `923f10c3079f1299a99ad9dba1924fa89639f42c`: Google SSO returned to the app and `/identity` verified the browser session. All CI jobs at that source passed, including PG17 roles/migrations/rollback and Android/iOS builds.

`npm run test:neon-auth` exercises the real self-managed auth engine with isolated PostgreSQL-compatible storage, and separately labels mocked client/provider responses. It does not establish hosted Google, email delivery or physical mobile acceptance. Existing full verification and PG17/native CI remain required.

Before production approval: real provider tests on web and mobile; reviewed identity mapping plus immutable business/ledger fingerprint; verified backup and restore with private key escrow; migration rehearsal on a frozen source snapshot; rollback to the original provider with existing accounts/queues intact; email/provider/domain/privacy review; explicit owner approval. A passing Preview build or synthetic fixture cannot waive these gates. Neither rollout flag is enabled and no production auth is removed here.

## Hosted workflow repair

Real Google login also exposed `subscriptions_plan_id_fkey` during first-account subscription bootstrap: the serverless billing entry did not call the canonical catalog initializer used by the billing service and legacy API runtime. The entry now awaits the same initializer before registering routes, and closes a failed startup connection. No foreign key is removed, no alternate plan catalog is introduced, and subscriptions or financial actors are not rewritten. `test-billing-bootstrap.ts` starts with the trial plan absent and verifies authenticated first status, cold replay, one subscription, preservation of a historical plan, and zero ledger writes.

Staging provisioning now imports the same complete migration manifest as `db:verify`, including the established supplemental security SQL and operational-state migration. It previously omitted those files, leaving `contract.free_plan_entitlements` absent. Applying only those existing baseline files to `newhope_auth_pr29` in one transaction preserved fingerprints of 16 protected auth, business and financial tables. The real Google browser session then created a synthetic Retail business and first outlet and loaded its cloud dashboard in Preview `dpl_Cake6LczDPuggqrp8ZpJH6CMmBGg` (`a3b8a97ff708f1722482e6c560c5af356938e0a5`). No sale, refund, transfer or payment was submitted; opening a zero-transaction dashboard does not certify those operational workflows.

## Bounded offline identity recovery

`/api/auth/identity` may issue a device-bound ES256 offline UI receipt only after the same live verified session, canonical mapping and MFA checks. It contains no bearer/refresh token, permissions or fresh MFA evidence. Its lifetime is at most one hour and never beyond the confirmed session expiration. The P-256 signing purpose is separated from session signing; only its public JWK is pinned in the web/native build through `VITE_NEWHOPE_OFFLINE_PUBLIC_KEY`. Generate that public value with `node --import tsx scripts/auth/offline-public-key.ts <ignored-private-staging-env>`; never put a private signing key in a VITE variable.

A cold offline launch verifies the pinned key, signature, issuer, device, canonical actor, session and expiry before opening existing device caches/queues. It exposes `aal1` UI recovery, without an access token or MFA timestamp. The existing business/module/financial offline leases are additionally bounded by the auth deadline. The authenticated fetch boundary refuses dispatch with this recovery state. Online 401/403, explicit account changes, reset and successful logout clear only the receipt/auth state; financial queues remain intact. Cache mutations are serialized and late identity responses cannot restore a logged-out receipt.

Offline mode cannot discover a remote revocation until connectivity returns. The receipt is bounded by device time and is never accepted as server authorization: every online replay still verifies the live session and current tenant/outlet/module permissions. An online provider outage does not fall back to this receipt. Unsupported crypto/storage, a missing key, invalid receipt or expired session requires reconnection. Browser installation, actual cold offline reload/reconnection and device tests remain separate hosted acceptance gates until exercised.

Native HTTP authentication now maps only the canonical auth API surface to the configured native API origin; OAuth browser navigation keeps the existing issuer/callback. The concrete public staging-alias proposal is documented in [native staging access](native-staging-access.md) and is not activated without owner approval.
