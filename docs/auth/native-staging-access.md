# Native staging access proposal (not activated)

The current branch Preview redirects an unauthenticated native preflight to Vercel SSO before app CORS (HTTP302). No protection bypass credential belongs in an APK/IPA.

A verified parent domain `newhope.space` is already attached to the existing `kasir-newhope` project. Read-only DNS inspection of `auth-staging.newhope.space` reports Vercel nameservers, an existing wildcard-compatible A route, no conflicts and no misconfiguration. No production domain or DNS record has been changed.

The concrete proposal is to attach `auth-staging.newhope.space` only to Preview branch `codex/neon-auth-cross-platform` on project `prj_pgXrNyqfggZUHT3nFhSFkEzok6HU`, then set that branch's public `VITE_NATIVE_API_ORIGIN=https://auth-staging.newhope.space`. The project's existing policy excludes custom domains from Vercel SSO, so this makes the staging application API publicly reachable. Application authentication, exact native CORS, server RBAC/RLS, DB rate limits and disabled native financial writes remain enforced. This exposure needs owner approval before attaching the alias.

The auth issuer, Google callback and `NEWHOPE_AUTH_URL` remain on the existing canonical branch Preview origin. Native HTTP auth calls remap only that exact `/api/auth/*` surface to the approved native API origin; no credentials follow redirects or another origin. Google OAuth still opens the canonical origin in the system browser, using the existing authorized Vercel session for staging. No callback changes, new identity issuer, financial actor rewrites, copied secrets to another branch, or production rollout are needed. Staff password/MFA API tests do not require Vercel SSO through the new alias; Google browser tests still require a staging tester authorized for the canonical Preview.

Before claiming mobile acceptance: verify anonymous access is denied by the application, credentialed sessions/MFA/revocation and cross-tenant rejection; build the real native client against the alias; execute app/provider workflows on an emulator/device. Native financial checkout remains disabled. Physical Android/iOS validation remains a separate gate.
