# Test evidence — 12 October 2026

No tests here use production customer data or real provider payments/LLM calls. Domain commits were tested independently, then merged in an isolated validation checkout. All commands below completed with exit 0; assertions intentionally simulate errors/denials and log them, which is not a failing suite.

| Domain / commit tested | Command / evidence | Negative checks and limits |
|---|---|---|
| DB PR14, 1852d54 | `npm run verify` on the branch before the final expanded fixture; `npm run lint` and `npm run test:security-database` on final test source | 72 synthetic role read/write/function/sequence denials, column ACL/default cleanup, preserved backend helpers, captured rollback. Full repository schema: 129 relations deny anon/authenticated; no remaining relation/column grants. Read-only production baseline is separate catalog evidence, not proof migration is applied. |
| Financial PR15, 79f5241 | Full `npm run verify`, then `npm run test:financial-cloud` after adding immutable TRUNCATE trigger | Default/weak PIN, random salted scrypt, fresh password proof, bad password/PIN durable lockout, missing/wrong action/hash/tenant/outlet/actor/stolen/expired grant, exact retry, audit UPDATE/DELETE/TRUNCATE denial, foreign void preserves stock. Auth replies simulated. |
| Privacy PR16, c447fe6 | Full `npm run verify`, final expanded `test-privacy-controls.ts` | Anonymous/foreign request denial, exact retry/conflict, ten/day durable quota, terms acknowledgement/version, immutable events/ack, owner support/MFA/justification, specified merchant only, no operational data deletion/export; static pages/prices/tax distinction. Actual rights fulfilment and counsel signoff are outstanding. |
| AI PR17, b23ec1f | Full `npm run verify`, final expanded `test-brain-db.ts` | Absent/client-only/server-revoked consent, foreign business, expired-trial withdrawal, both real provider selections with mocked wire, aggregate/context isolation, email/phone/NIK/bank/card/token/password patterns absent from transport/audit, query hashes and actual provider, outage credit refund, immutable consent. Arbitrary prose/name scrubbing is not guaranteed. |
| Payments PR18, 0760c1a | Full `npm run verify`, final targeted `test-payment-provenance.ts` and lint after stricter event validation | Forged browser verification, signed raw fixture/stale/unsigned/wrong-account, absent explicit order/payment link, nominal ambiguity, foreign order, amount/currency mismatch, event replay/conflict, immutable exceptions, owner/foreign/anonymous report boundary, no custody/cash manufacture or DOKU activation. Fictional signing fixture is not actual provider certification. |
| Combined validation, e98cd38 | Full `npm run verify` and `git diff --exit-code -- api/` | All above regression suites together. Actual combined repository schema **140 relations** denies both browser roles. Existing five-sector financial, billing/DOKU, offline shell/sync/replay, multi-outlet, admin MFA/RBAC, blog/MCP and agent discoverability tests pass. API bundles match combined sources. No real Supabase17 staging/provider deployment claimed. |

The combined validation branch is `codex/security-integration-validation` (base 90321d8), with domain merge order financial → privacy → AI → payments → database. Two shared-file conflicts were resolved by retaining **both** financial approval and payment reconciliation tests and **both** package script additions. Source merges were reviewed and API bundles regenerated; the resulting API tree is clean. Domain PRs are still separately reviewable; do not lose one domain's negative checks during merge/rebase.

## Hosted CI

- Financial: [run38266122698](https://github.com/slaks37/kasir-newhope/actions/runs/38266122698), SUCCESS; draft preview success is not production release.
- Privacy: [run38269271166](https://github.com/slaks37/kasir-newhope/actions/runs/38269271166), SUCCESS.
- AI: [run38269538204](https://github.com/slaks37/kasir-newhope/actions/runs/38269538204), SUCCESS.
- Payments: [run38270150833](https://github.com/slaks37/kasir-newhope/actions/runs/38270150833), SUCCESS.
- DB code: [run38270746362](https://github.com/slaks37/kasir-newhope/actions/runs/38270746362), SUCCESS. Documentation-only evidence updates will trigger another run which must be rechecked before reporting current branch CI. Prior failure38269602486 identified TypeScript unknown result-row types and was fixed with typed query rows.

CI uses Node22/Linux and isolated PostgreSQL fixtures; local run used Node24/macOS. PGlite is PG18/WASM while production catalog is PG17.6.1.155. Matching real staging role/Auth/network/provider behavior is mandatory before production. Migration checksums and staged signoffs belong to the operator release record, not a claim that production is remediated.

## Reproduce

Fetch `codex/security-integration-validation`, use clean installed dependencies (`npm ci`), then run `npm run verify`. Confirm `git diff --exit-code -- api/` and run the staging checklist from [production readiness](production-readiness.md) against actual synthetic Auth owners and service logins. Never point these fixture scripts at production, apply both mirrored migration paths, or treat simulated PSP/LLM responses as real integration success.
