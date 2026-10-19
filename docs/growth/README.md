# New Hope Growth Engine — internal MVP

Growth is a modular domain in the existing admin application, not another publishing, billing or authentication system. This feature branch starts at main `a427fb8`, independently of migration PR #21. Do not merge or promote PR #21 to deploy this feature.

## Delivered boundaries

- CRM: validated leads, assigned operators, filters/pagination, versioned edits, Kanban, activity history/tasks, opt-out, atomic JSON import (100 rows), formula-safe CSV export (1000 rows).
- Analytics: stored lead-stage snapshot, sources/sectors, UTC weekly acquisition, verified-event scores, trial setup/health and next steps. Trial analytics use 45 days; they do not change the authoritative subscription or entitlements.
- Copilot: deterministic discovery/demo/follow-up drafts. Optional existing Agnes/DeepSeek adapter transmits only sector and outlet count after per-lead consent and a separate deployment flag. Eight-second cancellation, three requests/operator/minute, bounded JSON validation and safe fallback. No outbound messaging or automatic publishing.
- Content: calls the existing authorized blog API; rule-based pain-point/product mapping. No duplicated publisher or invented traffic/ranking/attribution.
- Partners: profiles, codes and manual lead attribution; no commissions or liabilities.
- Security: existing verified Supabase membership/MFA guards plus explicit workspace CRM operator grants, immediate revocation, optimistic edit conflicts, audit trail, RLS and composite workspace foreign keys.
- Telemetry: optional best-effort server hooks after successful business setup and accepted POS sync. Hook failures never change a sale response. Unlinked UUIDs remain separate from CRM identities. This is telemetry, not the financial audit ledger.

## Explicitly incomplete / not activated

- Live subscription-led MRR/churn, acquisition-cost inputs, paid cohorts, automatic signup/outlet/catalog/report/repeat-use adapters, durable serverless telemetry delivery and complete verified CRM-to-Auth linkage.
- Identity requests are PENDING review only; no endpoint silently approves a link, merges UUIDs or grants merchant access. Validate ownership in a dedicated recovery workflow before activating links.
- Provider-backed AI is not enabled on the hosted review Preview; its failure and malformed output paths are tested with synthetic providers. Local rules work without provider access.
- Website/n8n/Sheets intake, automatic referral-link attribution, authorized support feeds and outbound communications need separately scoped integration credentials and acceptance. Nothing sends email/WhatsApp or activates a workflow.
- Retention controls currently comprise access restriction, opt-out, audited export and manual review. No automatic deletion, statutory-compliance claim, predictive churn model or production scale benchmark.
- Content attribution, MRR, CAC, trial-to-paid conversion and paid retention cohorts display **Data belum tersedia**. Manual PAID stages are never treated as payment evidence.

## Database and rollout

`growth/migrations/001_core.sql` is additive, explicit and rerunnable. It is intentionally outside the existing business migration directory, so request startup and the PR #21 migration runner do not execute it. Tables live in the private `growth` schema. Browser roles receive no access. The application sets the workspace with transaction-local `set_config`, compatible with pooled Neon PostgreSQL; deployment credentials remain server-only.

Two separate references are supported: `DATABASE_URL` for existing verified internal membership/audit, and `GROWTH_DATABASE_URL` for Growth persistence. No queries read merchant books to score a lead. Prefer a separate restricted runtime role/database. Required grants are documented in `scripts/growth/provision-preview.mjs`; production grants and deployment remain a separate review.

The isolated review environment uses a new database `newhope_growth_preview` on the existing non-production rehearsal branch `br-orange-union-azwj2z2e`. It does not modify `neondb`, the clean migration candidate, source Supabase or production. No extra branch or paid resource was created. Runtime role has NOINHERIT, NOBYPASSRLS, no schema ownership, no POS transaction permission and no private source table privileges. Client-to-pooler TLS certificate verification is enabled in the Growth pool; backend pg_stat_ssl reports false behind the Neon proxy and does not establish pooler-to-compute encryption; pool max 3, connect/statement timeouts 5 seconds.

`GROWTH_ENGINE_ENABLED=1` enables only development/Preview. The server additionally refuses Growth in `VERCEL_ENV=production`, even if the flag is accidentally enabled. Supabase Auth/Storage remain unchanged; no Better Auth code is introduced. `GROWTH_CAPTURE_ENABLED` and `GROWTH_AI_ENABLED` are independent, off on the hosted review Preview. Enabling production requires a reviewed change after migration/privacy/acceptance gates; do not bypass this guard.

Hosted Preview variables are branch-specific to `codex/growth-engine`. It uses a dedicated database with six synthetic leads, and existing staging internal UUID bindings copied without remapping or role promotion. Fixture activities use an explicitly synthetic actor, not a claimed human action. No fake Supabase account is created. DOKU credentials, external gateway and blog automation keys are empty for this Preview. Production environments and PR #21 Preview are untouched.

## Local verification, no external credentials

```sh
npm ci
npm run test:growth
npx playwright install --with-deps chromium --only-shell
npm run test:growth:browser
npm run verify
```

The browser test starts a loopback-only synthetic Auth fixture, React/Vite and PostgreSQL/PGlite. It traverses the actual existing admin guard and actual Growth SQL/API. It is a software acceptance test, not proof of live Supabase login, real prospect consent, provider AI, production scale or production release acceptance. Its fixture verifier is confined to `scripts/` and never imported by the application.

`build/growth-browser/` contains desktop/mobile/Kanban PNGs and `result.json`. GitHub's Growth browser workflow uploads only synthetic screenshots/results, never environment files, logs, secrets or business records. Complete existing CI remains enabled.

For the already-provisioned isolated cloud Preview, `scripts/growth/verify-preview.ts` checks runtime TLS, least privilege, catalog bootstrap, actual PostgreSQL persistence and synthetic metrics using the ignored mode-600 `.env.growth-preview.local`. Do not post this file or its values in GitHub.

## Rollback and production gate

1. Disable the Preview-only feature flag or roll back the feature deployment. POS, billing and Auth continue independently.
2. Preserve Growth database and audit records; additive migration rollback is feature disable + retained data, not DROP or DELETE.
3. No changes to business records, UUIDs, source writers, signup triggers, billing, DOKU or Supabase Storage require reversal for this MVP.
4. Before production: finish PR #21 hybrid acceptance, preserve the separately approved SEO-only production patch absent from main, review contact retention/privacy, accept live admin/MFA Preview access, approve any provider payloads, implement durable event adapters and verified identity/subscription mappings needed for live PLG metrics. Rebase and reverify against the accepted hybrid release; never deploy this main-based branch as a database cutover.

Recommendation: review the working internal MVP in isolated Preview. **NO-GO for production activation** until the listed gates are accepted. Advanced PLG/RevOps integrations are explicitly not represented as finished.
