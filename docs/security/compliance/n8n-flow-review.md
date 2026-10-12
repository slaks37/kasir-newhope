# External n8n definition review — read-only, 12 October 2026

Focused connector search “New Hope” returned two accessible workflows. Metadata provenance is in [sanitized evidence](evidence/n8n-flow-definitions-2026-10-12.json). No flow was edited, paused, published, run or retried; no credentials or execution/customer payloads were exported. Existing Agnes/DeepSeek routes remain unchanged. Scope is these two saved definitions, not all n8n/Make/ChatGPT accounts, past executions or instance settings.

| Flow | Observed state/version | AI data flow |
|---|---|---|
| New Hope — Problem Intelligence Blog (FIXED / SAFE TEST) | Active; published equals draft `0817e423-e92e-4260-9400-93d14b432fcb`; hourly WIB schedule | Sheets RSS-source configuration → HTTPS RSS → fresh title/description/URL/time signals + public blog titles → Agnes `agnes-2.5-flash` chat completions. The prompt builder removes raw RSS XML/evidence/feed URL from model input. Article title/excerpt + conceptual illustration instructions → Agnes image model and bounded image retries. |
| New Hope — Repair Repeated Blog Covers | Inactive; no published version; draft `fb082561-779d-4d82-becb-69e5aea2e7fd` | Published blog titles/excerpts from authenticated blog API → conceptual image prompt → Agnes generation/retries → blog cover storage with slug/expected-cover guard. It stays inactive; no repair performed in this audit. |

The reviewed graph contains no POS tenant/customer/staff/order query node or private ledger API call. This is static-definition evidence, not a guarantee sheet rows, historic input, private feed content or another workflow never contain personal data. DeepSeek is not present in these two editorial graphs; repository business analysis still supports both Agnes and DeepSeek. No provider was removed.

Network sinks are official Agnes text/image endpoints, New Hope blog validation/publishing/cover API, public New Hope RSS and configured external feeds. Credentials are assigned managed credential references; no hard-coded credential values appeared in reviewed model-request parameters. Source/news input is untrusted. Existing freshness/evidence/duplicate/claim/structure checks limit publication but do not prove resistance to all prompt injection. System rules explicitly forbid dynamic QRIS/automatic paid detection/guaranteed profit/MDR claims and invented quotes; covers are labelled conceptual AI illustrations, not event photographs.

Residual checks before claiming complete external AI governance:

- RSS filtering checks HTTPS only. Feed target allowlist, ownership, redirect behavior/private-address exclusion and maximum download size must be staged; a malicious configurable feed could expose the workflow runner to SSRF or private source data. Check who can edit the source sheet/credentials; do not put POS/private support content in feeds or hints.
- Workflow settings do not explicitly state `saveDataSuccessExecution`, `saveDataErrorExecution`, pruning or global retention. Actual instance defaults, backups, execution history, Google Sheets audit storage and credential access must be verified. Do not infer zero retention from an omitted setting.
- Verify AI/API processing terms, regions, retention/training, downstream subprocessors and permitted editorial inputs. Publicly available news can contain personal data; editorial basis/licensing/source attribution still needs review. Do not reuse merchant-analysis consent as a blanket editorial legal basis.
- Live publishing request-key replay is explicitly a residual workflow concern; source/duplicate checks do not make lost acknowledgement safe to retry. Review durable idempotency before changing automation; this audit did not run or alter live publication.
- ChatGPT connector and any other account/flow execution payloads remain unverified. No sensitive payload inspection or message sending was performed. Define scope/permissions/retention separately.

This is an additional read-only definition assessment to the repository audit. It does not certify the production runner, provider contracts, execution-log retention, source-sheet contents or editorial publication rights.
