# Production rollout — 13 October 2026

Owner explicitly requested **"terapkan di produksi"**. Target: Supabase `fqxrhumsgigcgjtlbfuo` (new hope kasir, PostgreSQL17, Mumbai) and Vercel `kasir-newhope`, project `prj_pgXrNyqfggZUHT3nFhSFkEzok6HU`, team `team_SCDxbr7VMTFUyI60ki7xaNmg`, primary domain `kasir.newhope.space`. Release [PR20](https://github.com/slaks37/kasir-newhope/pull/20) integrates domain PRs 14–18 and native rehearsal PR19 into one application release. This is technical release authorization, not a fabricated counsel approval or payment-provider license.

## Applied database migrations

The management migration API assigned the following actual UTC versions. Repository filenames and test/runbook references are aligned to that registry. **SQL bodies and their reviewed checksums are unchanged**; local bootstrap mirrors 0059–0062 remain byte-identical. Do not apply either mirror again to production.

| Actual registry version | Name | Reviewed SQL SHA256 |
|---|---|---|
| 20261013033203 | browser_role_least_privilege | e419bde474f6f4a7f376c7bb2cd73f294c3db839605213ed4561a38f69bc380d |
| 20261013033208 | server_financial_approvals | 09b5e05af399a4a34c1ee23f4f9d0d04753e343d9adc1c5d6db8a68d676bd860 |
| 20261013033214 | privacy_request_workflow | 7a44782039463aa9c4e59892f4b4a3cc4a601e22f77c6f5fd2227a32207e0c0c |
| 20261013033217 | ai_provider_consent_records | c7d6f11a96d90a69753fd5394e36a359203228bdae7c4147c49fb9500e266beb |
| 20261013033222 | merchant_payment_provenance | f628a42629f53b382584414b4ab78e2449edd91b8d1f2702dd27917236a65294 |

All five returned success. Before mutation, schema, relation/column/default grants, policies, views, functions and constraints were captured to an access-restricted local JSON snapshot outside Git. This is **schema/ACL recovery evidence, not a full physical/customer-data backup or proof of managed backup restoration**. The protected rollback snapshot contains 1,630 captured statements. Do not restore insecure browser access without a narrow reviewed need. Existing RLS/view semantics and known backend helper access were preserved; no customer data was copied into CI.

Production read-only verification after application of SQL:

- 344 real SELECT probes were denied for anon/authenticated across 172 business relations in all six schemas. Effective residual browser relation/column, function and sequence privileges: **zero**.
- Transaction and payment row counts/totals, cash ledger totals and refund counts/totals matched the pre-migration aggregates. No financial amount/status backfill or deletion was performed. Historical payments remain unverified; no row was relabelled provider-verified.
- Active merchant payment-provider accounts: **zero**. No custodial flow, provider adapter activation, provider charge or customer test transaction was introduced.
- Existing public plans, blog and health endpoints returned HTTP200 before and after database changes. A pooled production connection was observed as postgres; Vercel sensitive DATABASE_URL could not be decrypted, and per-service/TLS hardening is not claimed complete.

## Application and remaining operational checks

Merge/release only the final integrated candidate after its product CI and native PostgreSQL17 checks complete successfully. Record the final Git SHA, Vercel production deployment/READY and read-only route/authorization checks in the release receipt. A preview deployment is not that receipt.

After the new server/client are live, the owner must configure a strong financial PIN using fresh password verification in **Settings → users → PIN finansial server pemilik** before void/refund/cash-out/reversal. Ordinary offline sales remain supported; privileged offline approval is not granted. Never silently discard historical queued commands.

Operator details supplied by owner: **New System**, **Graha Suryamas Blok K4**, **stefen@newsystem.space**. Counsel approval, legal form/registration, city/postcode, mailbox handling and final commercial terms remain review items. Legal pages retain these markers. No external email was sent.

Agnes AI and DeepSeek routes and production keys are retained. Provider contracts/retention/regions and external n8n/ChatGPT operational review remain bounded governance items. DOKU subscription stays isolated. Managed Supabase Auth/API staging, trusted TLS/role separation and full backup restoration assurance remain follow-up work; native PostgreSQL17 CI is not represented as managed staging parity. Supabase Free leaked-password protection limitation remains; no paid plan upgrade was made. Do not describe this release as complete regulatory compliance.
