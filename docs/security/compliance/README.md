# New Hope security and legal remediation review package

Read [risk register](risk-register.md), [test evidence](test-evidence.md) and [production readiness](production-readiness.md) first. Draft domain PRs: [database14](https://github.com/slaks37/kasir-newhope/pull/14), [financial15](https://github.com/slaks37/kasir-newhope/pull/15), [privacy16](https://github.com/slaks37/kasir-newhope/pull/16), [AI17](https://github.com/slaks37/kasir-newhope/pull/17), [payments18](https://github.com/slaks37/kasir-newhope/pull/18). Related domain documents arrive in their own PRs; relative links resolve in the combined validation branch/after integration.

Production database inspection was read-only. No production SQL, historical data purge, payment account/adapter activation or application deployment was performed. Both Agnes AI and DeepSeek remain supported and named as third-party AI providers. Legal templates/company contacts/registration/tax/retention/provider terms require actual owner/counsel approval; no identity or approval was fabricated.

- Database evidence/dependencies/rollback: [release plan](database-release.md), [catalog](evidence/database-catalog-2026-10-12.json), [captured rollback](rollback-browser-roles.sql).
- Native PostgreSQL17 CI migration/rollback gate: [scope, reproduction and remaining managed staging prerequisites](postgres17-rehearsal.md).
- PIN/grants/offline safeguards: [financial release](financial-release.md).
- Notices/request intake: `/privacy`, `/terms`, `/support`, Settings → Privasi & Permintaan Data; [rights operations](privacy-rights-runbook.md).
- Legal templates: [inventory/retention](data-inventory-retention.md), [DPA](dpa-template.md), [incident playbook](incident-response.md), [subprocessors](subprocessors.md).
- Agnes/DeepSeek data/consent/retention gates: [AI governance](ai-governance.md), [read-only n8n definition review](n8n-flow-review.md).
- Merchant settlement, DOKU separation, pricing/marketing/tax audit: [payment controls](payment-controls.md).

Unmet release prerequisites are checklist gates, not silently completed work. In particular Supabase leaked-password protection is unavailable on the current Free plan; no paid upgrade occurred. Real staging, public verified privacy contact, final legal terms and actual licensed merchant-provider certification must be resolved before their affected production features are released.
