# Local verification — 26 October 2026 (Asia/Jakarta)

- `npm run verify`: exit 0. Includes both TypeScript configurations, source hygiene, SPA/service/API build, runtime, financial, sync, offline, subscription, identity, security/RLS, AI/intelligence, client support and other existing repository regression scripts, followed by the new module integration suite.
- Final UI/date adjustment: lint and production build repeated successfully; targeted module/API suite repeated.
- `test-module-build.mjs`: five dashboards, four operational screens and retail inventory are separate dynamic entries outside initial app/workspace static import graphs.
- Public landing inline bootstrap: 6,484 bytes, below the existing 12,000-byte gate. No gate was relaxed.
- Synthetic API regression verifies assignment+entitlement intersection, expiration, owner/member permissions, cross-merchant/outlet denial, disabled pilot rejection on legacy endpoints (including catalog/status), permitted operational writes after entitlement restoration, no ledger row for denied sale, canonical net revenue after refund/retry, malformed legacy stock as UNKNOWN, operational namespace dedupe, migration replay, browser denial and scoped service RLS.
- `npm run db:verify`: migration application succeeds; old seed fails `relation "plans" does not exist`. Running the unchanged baseline script with both new migrations excluded reproduces the same failure. This command is not reported as passing.
- Screenshot `fnb-kds-ready-synthetic.png`: actual local React KDS using a disposable PGlite database and simulated local test identity. Ticket SYNTHETIC-01 changed PREPARING → READY; scoped API read returned revision 2 and status READY; reload retained READY. No real order/payment/customer was used.
- Browser also verified Retail-specific navigation and explicit Retail → Laundry switching to `/overview`, followed by the Laundry production workflow.

These results are local software evidence. Hosted CI, real production database roles, mobile/scanner performance, qualified-route offline grants and the full multi-module product acceptance remain unverified or incomplete as described in the audit. No live migration or production deployment was executed.
