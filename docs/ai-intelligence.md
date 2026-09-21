# New Hope Intelligence — implementation and rollout notes

Updated: 2026-09-21. The AI implementation and private database migration are deployed; daily cron activation and signed-in live-provider verification remain pending as detailed below.

## User story and boundaries

Owner opens Overview / AI Copilot → deterministic device analysis, or explicitly opts into a paid question → verified server session → owner-scoped database aggregates → atomic member credit reservation → DeepSeek → answer / draft for owner review.

Free forever after the 45-day trial remains **without AI**. Zero-token analytics below means no provider tokens for an AI-entitled account, not an exception to the Free-plan restriction.

## Implemented in this slice

| Capability | Implemented | Boundary |
| --- | --- | --- |
| Daily brief / revenue diagnostics | Previous complete WIB day vs at least four comparable weekdays; transaction/basket decomposition; month-end run-rate scenario after seven complete days | Arithmetic decomposition, not proof of causes; device data is labelled |
| Demand forecast | Seven-day forecast, weekday vs daily baseline selected with rolling historical MAE | Needs history; no weather, promotions, opening-day calendar or stockout correction; interval is indicative |
| Procurement | Product / recipe unit-aware additional-quantity drafts using upper forecast bound | Supplier, incoming orders, MOQ and lead time need confirmation; no PO is sent |
| Menu / margin / pricing | Historical-cost coverage, contribution after discount, menu quadrants, price / volume-loss what-if | Missing historical HPP is not replaced by current catalog cost; simulation is not elasticity prediction |
| POS upsell / promo ideas | Basket association and eligible product suggestions; margin-aware promo drafts | User clicks to add; variant/required-modifier items excluded; no automatic discount or promo activation |
| Customer intelligence | Observed purchase segmentation; 12-month run-rate scenario with minimum history | Not calibrated net CLV or churn probability; customer details remain out of the DeepSeek context |
| Workforce / anomaly review | Valid-hour productivity and evidence-based flags; sector summaries | No automatic staffing decisions or fraud accusations; cashier hours are not total crew capacity |
| Group BI | Owner-scoped outlet revenue, 30 complete WIB days vs previous 30 | Only entitled businesses owned by the verified account; not a full BI warehouse |
| Recommendation journal | Draft → owner approval → manually recorded completion → seven-day observational comparison | Stored per business in this browser; not a tamper-proof central approval log; no external action execution |
| Paid reasoning | Opt-in DeepSeek analysis / draft action plan using an allowlisted aggregate context | Owner review still required; no agent tools or unattended execution |

The larger requested roadmap is **not complete**. Durable server-side approval/execution, actual supplier/CRM integrations, calibrated prediction models, and the SaaS command center remain later phases. Existing calendar and other heuristic cards are not presented as trained models.

## Cost control and privacy

- The member is the verified login subject; a browser-supplied `merchantId` cannot select the wallet. Business ownership is checked independently.
- One persistent wallet is shared across businesses of that member. The existing default grant is retained: **30 credits per month, reset at the WIB month boundary**. One successful paid response consumes one credit, with a 2,000-character question limit, 1,200 output-token cap and 30-second provider timeout. Credits are application units, not a currency spend cap or exact provider-token count.
- Atomic reservation prevents concurrent requests from overspending. Provider errors/empty answers refund in the same allowance period; an old-period refund cannot inflate a new grant.
- If multiple historical wallets exist for a member, paid calls fail closed with `AI_MEMBER_WALLET_MERGE_REQUIRED`. No balance is merged, deleted or overwritten automatically. Deterministic answers continue; unresolved audit writes emit an operational error.
- Paid calls require `allowLlm: true` and consent `deepseek-aggregate-member-v1`. Unknown questions without consent never call DeepSeek. Paid calls require database aggregates, not device fallback.
- The model receives a pseudonymous member hash, the typed question (common phone/email patterns redacted), and an explicit allowlist of numerical business aggregates. It does **not** receive customer/staff records, raw transactions, product/store names, business IDs, or client insight cards. The typed question can still contain arbitrary names; the UI warns against entering personal data. The redactor is not a general-purpose DLP system.
- Only the approved DeepSeek endpoint is allowed; redirects fail. Credentials stay server-side. Requests/answers are not sent to another provider.
- New audit rows carry business scope even though the wallet is shared. Legacy rows with no business scope remain preserved and are excluded from business-specific audit results.
- Device, database, and mixed answers have distinct source badges. Local data can be incomplete or altered; it is not server-verified evidence.
- Add-on purchase settlement is not implemented here. The old false-success top-up UI has been removed. Existing reset logic replaces the monthly wallet balance; a purchased-credit carry-over policy and payment-backed, idempotent top-up must be completed before offering paid add-ons.

## Data and runtime

`businessBrain.ts`, `periods.ts`, `reportAggregates.ts` and `insights.ts` are shared deterministic code. Naive legacy ISO timestamps are interpreted as WIB consistently across browser/server hosts. Only paid completed sales at or before the snapshot time feed sales metrics; voids remain separate. Cache fingerprints include inputs and clock changes.

The server adapter reads verified owner-scoped private contract views for transactions, historical line costs, catalog/stock balances and targets. It refuses a truncated history over 50,000 transactions instead of silently returning partial totals. Customer, staff, recipe and ingredient-stock domains are not yet available in the central adapter; those analyses use the labelled device snapshot.

Both scheduled and CLI summaries use `computeDailyBrief` and the same engines. The private cache stores derived documents, or `SKIPPED` / `UNAVAILABLE` status, never invented zero-valued success data. Cron processes at most 25 oldest cache entries per run. With more than 25 businesses, the current daily schedule does not refresh every business every day; partitioning / additional capacity is a rollout requirement.

CLI usage (requires a deliberately selected database, even for dry-run):

```sh
node scripts/batch/daily-insights.mjs --help
node scripts/batch/daily-insights.mjs --dry-run --business <business-ref> --limit 1
```

Dry-run uses read-only transactions and writes no cache, wallet, business or provider data. Normal CLI runs write only derived cache/status documents. The old `--input`, `--window`, and `--lead-time` overrides are rejected so the CLI cannot silently diverge from the app.

## Production rollout status

- GitHub `main` at `e7efea6` deployed successfully on Vercel (`dpl_CwohtDXyj1RexhviNkM6661EucAX`, Production, READY) at `https://kasir.newhope.space`.
- Supabase project `fqxrhumsgigcgjtlbfuo` received migration `20260920140212` (`business_intelligence_private_cache_and_member_wallet`). Preflight found no orphan identities or duplicate member wallets. Eight wallet rows, total balance 508, and four audit rows were preserved; audit foreign-key deletion remains `SET NULL`.
- Postflight confirmed cache RLS, private catalog grants, and no access for `anon` / `authenticated`. Security Advisor had no errors or new warnings; the pre-existing leaked-password-protection warning remains.
- Public production checks returned HTTP 200 for the site, and 401 for unauthenticated assistant credits, group, daily brief, query and daily cron requests.
- `CRON_ENABLED_JOBS=daily-insights` was saved for Vercel Production. The allowlist is checked after authentication and before any database connection in all three cron handlers. An unset allowlist preserves legacy behavior; a defined empty list disables all jobs. This limits activation to the approved AI summary, not merchant-health or billing-reminders.
- Creating `CRON_SECRET` requires the user to finish credential entry in Vercel. Its form is prepared but the secret has **not** been saved by the agent. After the user saves it, deploy the allowlist change and verify a daily-insights run. The configured schedule is 01:00 UTC (08:00 WIB); execution precision depends on the Vercel plan.
- Signed-in production owner / multi-business checks and a live DeepSeek call are still pending. Provider variables exist, but their presence does not establish working credentials or billing. `PGSSLROOTCERT` is still absent, so verified database TLS remains a follow-up; no existing encryption settings were weakened.

### Deployment checklist for subsequent environments

Do not run the full demo bootstrap against a live database; it includes synthetic seed data. Before rollout, take the normal database backup and inspect the intended project/branch, current schema and advisor findings. Follow the existing reviewed maintenance-SQL workflow:

1. Apply `docs/security/intelligence-cache.sql` and `docs/security/intelligence-wallet.sql` to a staging copy first, then verify using the runtime database role. These files are also included by the local bootstrap/migrator.
2. The cache has RLS and no browser grants. `contract.intelligence_catalog` is an intentionally owner-evaluated private cross-service view: `PUBLIC`, `anon` and `authenticated` have no access; only backend roles can read it. Do not expose the `contract`/`ai` schemas or add browser grants. Verify grants and Supabase advisors in the actual target before production.
3. Wallet SQL preserves rows and balances, adds audit `business_id`, and replaces only legacy identity FKs with canonical `internal.tenants` FKs. It aborts transactionally if a legacy identity is unresolved. Reconcile exceptions deliberately; do not erase wallets to make it pass.
4. Configure server-only `DATABASE_URL`, `DEEPSEEK_API_KEY`, and `CRON_SECRET`, plus existing Supabase session verification (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Optional `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` retain the existing provider contract; base URL must be DeepSeek. Never put the model secret in a `VITE_` variable. Use `PGSSLROOTCERT` with the existing database client for verified database TLS in production.
5. Build both new serverless bundles and deploy API + UI together after SQL compatibility checks. The new API excludes direct browser top-up and rejects forged trusted-principal headers. Keep the previous app revision available for rollback; additive SQL can remain, and balances/logs must not be discarded.
6. Test two owners, multiple businesses for one owner, an expired trial / Free account, exhausted credits, provider failure/refund, and a real owner-scoped outlet dataset. Make a deliberately approved small live model call to verify provider credentials/billing, then inspect audit/ledger and runtime logs. These signed-in live checks have **not** happened in this rollout.

Read-only wallet preflight (run only on the intended database; results contain private IDs):

```sql
-- Multiple wallets that would need manual member reconciliation.
SELECT t.owner_user_ref, count(*) AS wallets,
       array_agg(w.merchant_id ORDER BY w.merchant_id) AS wallet_ids
FROM ai.merchant_ai_credits w
JOIN internal.tenants t ON t.id = w.merchant_id
GROUP BY t.owner_user_ref HAVING count(*) > 1;

-- Identity mismatch counts; the maintenance SQL checks all four relationships.
SELECT 'credits.merchant_id' AS field, count(*) AS unresolved
FROM ai.merchant_ai_credits w LEFT JOIN internal.tenants t ON t.id=w.merchant_id
WHERE w.merchant_id IS NOT NULL AND t.id IS NULL
UNION ALL
SELECT 'credits.tenant_id', count(*)
FROM ai.merchant_ai_credits w LEFT JOIN internal.tenants t ON t.id=w.tenant_id
WHERE w.tenant_id IS NOT NULL AND t.id IS NULL
UNION ALL
SELECT 'logs.merchant_id', count(*)
FROM ai.ai_query_logs w LEFT JOIN internal.tenants t ON t.id=w.merchant_id
WHERE w.merchant_id IS NOT NULL AND t.id IS NULL
UNION ALL
SELECT 'logs.tenant_id', count(*)
FROM ai.ai_query_logs w LEFT JOIN internal.tenants t ON t.id=w.tenant_id
WHERE w.tenant_id IS NOT NULL AND t.id IS NULL;
```

## Verification evidence

Run `npm run lint`, `npm run test:intelligence`, and `npm run build` from this checkout. The test suite uses synthetic fixtures and an isolated in-memory PostgreSQL implementation; no production credentials or model calls are needed.

| Boundary | Evidence captured |
| --- | --- |
| Calculation / dates | Exact money, HPP coverage, unpaid/future exclusion, cache refresh, forecast/backtest, procurement, price simulation; identical results under UTC, Los Angeles, Jakarta and Auckland host timezones |
| API → database | Full migration/schema fixture, real adapter queries with nonempty sales/catalog, cross-owner denial and private-view role checks |
| Member quota / paid boundary | Shared member wallet, 35 concurrent attempts with only 30 debits, ledger reconciliation, mocked provider request inspection, missing-consent denial, failure refund, period-boundary refund, ambiguous-wallet preservation, business-scoped audit |
| Session / plan boundary | Forged trusted-header denial; expired 45-day trial blocks AI; Free hides the panel |
| Intent regression | 47/47 recognised intents, 6/6 intended fall-throughs, no reported problems |
| Browser | Actual IntelligencePanel in a synthetic dev-only harness: price scenario rendered, draft save/approval/completion, mandatory completion note, early seven-day measurement denied, Free panel hidden; no captured console warnings/errors |
| Deployment / database | Production deployment READY, private SQL migration applied with balances/logs preserved, unauthenticated production API guards verified |
| Cron activation / live provider | Allowlist regression tests pass (disabled jobs never connect to a database); production secret entry and signed-in live DeepSeek test remain pending |

The browser harness is `scripts/dev/intelligence-preview.html`; it is not a production entry point. It uses synthetic data and does not contact a database or model. Full signed-in production UI → API → live provider verification remains the rollout step, not something the isolated tests can establish.

Production build succeeds with the existing large-chunk warning (main bundle approximately 552 kB before gzip). This is not a build failure; bundle splitting remains a performance follow-up.
