# Neon-backed authentication migration

Stacked on Draft PR28 `f6a4bdc2844cd82b9db9504811d4641b45fb584b`. Capacitor projects, SQLite journal, module/outlet isolation and canonical ledgers are retained. Native financial checkout stays disabled. Production activation is blocked in code, and default auth selection remains the existing provider until migration and rollback acceptance pass.

## Decision and current managed implementation

On 2026-10-27 the existing managed Neon Auth staging branch was inspected read-only. Email/password, verified-email requirements, Google provider and SMTP configuration exist; secrets were redacted by the connector. This configuration is not evidence that its login workflows passed.

The current [Managed Auth roadmap](https://github.com/neondatabase/website/blob/main/content/docs/auth/roadmap.md) still lists MFA as pending and describes limits for a separate frontend/backend. Its [plugin matrix](https://github.com/neondatabase/website/blob/main/content/docs/auth/guides/plugins.md) does not expose TOTP. New Hope requires session-bound MFA and independent mobile clients. The implemented alternative is self-managed **Better Auth 1.7.14 backed by Neon PostgreSQL**, hosted at the existing app's `/api/auth/*`; no new auth SaaS or financial identity is introduced. [Better Auth Google](https://better-auth.com/docs/authentication/google), [TOTP](https://better-auth.com/docs/plugins/2fa), [signed bearer](https://better-auth.com/docs/plugins/bearer).

## Runtime contract

- Browser/PWA use HttpOnly secure cookies, live database sessions and same-origin auth. Session renewal headers propagate back to the client. Native uses signed opaque bearer credentials in the existing Keystore/Keychain adapter. No browser token persistence is introduced by the Neon adapter.
- Client types, lifecycle, signup/recovery, admin MFA, support/reminders and owner PIN reauthentication select the configured provider explicitly. A Neon outage never falls back to Supabase or demo login. The legacy adapter preserves production session compatibility and rollback; the SDK remains installed for legacy Auth and existing Supabase Storage. This PR does not claim all Supabase products were removed.
- Neon web/native build aliases exclude legacy Auth modules. `check-neon-auth-bundle.mjs` rejects SDK/endpoint signatures. Legacy-mode regression remains part of `npm run verify`.
- Every API request validates a live session, active verified provider user, active explicit canonical mapping and existing business/membership authorization. A bearer cannot silently downgrade to another cookie session. Cookie-authenticated writes require an exact trusted Origin. Failed/revoked sessions return 401; dependency outages return 503.
- Official TOTP and recovery codes are available to merchant/staff accounts. Only successful official TOTP produces recent `aal2`; recovery codes provide login recovery at `aal1`. Password login, Google login, user metadata and trusted-device cookies do not manufacture step-up evidence. Changing MFA requires recent TOTP. Google-only owners may authorize PIN enrollment with verified Google identity plus fresh session-bound TOTP; password accounts retain password reauthentication.
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
| Email/password and verification | Real Better Auth + isolated SQL and captured email | Real sender/inbox/HTTPS login pending |
| Google OAuth | Official provider, exact callback, no auto-link; configured managed branch audited | New self-managed provider credentials/callback and real Google session pending |
| MFA and recovery codes | Actual TOTP/backup-code engine, session proofs, fresh admin checks and negative tests | Hosted enrollment/login/recovery pending |
| Session refresh/revocation/reset | Live sessions, cookie/native renewal, reset revokes sessions; isolated SQL tests | Hosted cross-device revocation pending |
| Historical owner and independent staff | Explicit differing-ID mappings; full business fingerprints unchanged; queue actor IDs canonical | Reviewed source mapping, user acceptance and writer-freeze snapshot pending |
| Browser/PWA | Provider-neutral client and Neon bundle checks | Real HTTPS UI/provider sessions pending |
| Android/iOS | Preserved Capacitor/secure storage, S256 handoff and native state tests | Native build CI and actual hosted app sessions pending |
| Rollback | Legacy runtime retained, revoked mapping refuses Neon access, no actor rewrites | Hosted alternate-provider rollback rehearsal pending |

`npm run test:neon-auth` exercises the real self-managed auth engine with isolated PostgreSQL-compatible storage, and separately labels mocked client/provider responses. It does not establish hosted Google, email delivery or physical mobile acceptance. Existing full verification and PG17/native CI remain required.

Before production approval: real provider tests on web and mobile; reviewed identity mapping plus immutable business/ledger fingerprint; verified backup and restore with private key escrow; migration rehearsal on a frozen source snapshot; rollback to the original provider with existing accounts/queues intact; email/provider/domain/privacy review; explicit owner approval. A passing Preview build or synthetic fixture cannot waive these gates. Neither rollout flag is enabled and no production auth is removed here.
