# Full Neon deployment configuration (no secrets)

Use branch-scoped Preview variables for `codex/full-neon-clean-launch`. Never repoint an existing staging fixture branch or change production variables before the release gates in `RELEASE.md` pass. All secret values come from ignored mode-0600 local files or the approved platform secret store; never from this document.

| Variable | Staging | Production candidate |
|---|---|---|
| `FULL_NEON_CLEAN_START` | `1` | `1` |
| `FULL_NEON_TARGET` | `staging` | `production` |
| `AUTH_PROVIDER`, `VITE_AUTH_PROVIDER` | `neon` | `neon` |
| `STORAGE_PROVIDER` | `neon` | `neon` |
| `NEON_PROJECT_ID` | `steep-sea-66546931` | same |
| `NEON_BRANCH_ID` | `br-morning-darkness-azwfti4c` | `br-falling-butterfly-az989m86` |
| `DATABASE_URL` (sensitive) | pooled restricted `newhope_clean_runtime`, DB `newhope_full_neon_staging` | pooled restricted `newhope_clean_runtime`, DB `neondb` |
| `NEON_AUTH_DATABASE_URL` (sensitive) | same branch/role, **DB `neondb`**; only selected identity columns readable | same branch/role/DB as production business target, still only selected Auth columns |
| `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` | staging managed URL in release runbook | production managed URL in release runbook |
| `NEON_AUTH_JWKS_URL` | managed URL + `/.well-known/jwks.json` | same construction |
| `NEON_AUTH_EMAIL_READY`, `NEON_AUTH_GOOGLE_READY` | `0` until actually verified | `1` only after real provider acceptance |
| `ADMIN_MFA_ENCRYPTION_KEY` (sensitive) | independent 32-byte base64 key | independent production key with private recovery custody |
| `AWS_ENDPOINT_URL_S3` | exact staging branch Storage endpoint | exact main branch Storage endpoint |
| `AWS_REGION` | `ap-southeast-1` | `ap-southeast-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (sensitive) | staging-only branch credential | main-only branch credential |
| `APP_URL`, `PUBLIC_APP_URL` | exact verified Preview origin (platform `VERCEL_URL` accepted only for staging MFA origin) | `https://kasir.newhope.space` |
| `PGPOOL_MAX` | `2` | `2` |
| `DB_STATEMENT_TIMEOUT_MS` | `8000` | `8000` |
| `DOKU_PAYMENTS_ENABLED` | **`0`** | **`0`** |
| `BILLING_REMINDERS_ENABLED` | `0` | keep disabled until the separate email/provider acceptance |
| `CRON_ENABLED_JOBS` | empty for Preview; test only isolated jobs | reviewed three-job allowlist after acceptance |
| `FULL_NEON_MAINTENANCE` | normally `0`; `1` for fail-closed rehearsal | `1` only for emergency compatible recovery deployment |

Clear from the new deployment: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GATEWAY_URL`. Full Neon fails closed if these are populated. Set legacy hybrid/pilot flags to `0`: `NEON_DB_PHASE1`, `VITE_NEON_DB_PHASE1`, `HYBRID_STAGING`, `VITE_HYBRID_STAGING`, `NEON_MIGRATION_PILOT`, `BETTER_AUTH_MIGRATION_PILOT`. Do not configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_DATABASE_URL` or an application-hosted Auth URL for the new runtime.

Preserve non-secret public canonical URLs and reviewed server-only blog automation/API credentials. Keep existing integrations' credentials private and separate; an environment presence check is not a successful provider transaction. There is no request to rotate settlement/payment credentials or activate paid AI.

Node is `24.x` in package engines, CI and Vercel; functions remain `sin1`. Production Auth must trust only reviewed production origin(s), require verified email, disable localhost, and use custom SMTP and own Google keys. Staging gets only its exact Preview/local origins. Do not add wildcard trusted origins.

Do not put owner DB URLs, backup plaintext, OAuth secrets, storage secrets, MFA keys, reset tokens, recovery codes or customer rows in GitHub, deployment logs, URLs or shell arguments. Presigned object URLs are short-lived bearer links; deliver only after server ownership/audit succeeds.
