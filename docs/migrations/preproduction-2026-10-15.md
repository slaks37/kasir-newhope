# PR21 pre-production decision — 15 October 2026

**NO-GO production. Existing staging engineering remains verified.** Work stays
on the same draft PR21. Production DB, application deployment/env, payments and
customer identities are unchanged. The only production-domain change is the
**exact single DMARC TXT record explicitly approved by the owner in this chat**.

## Automatically completed under the owner's authorizations

- Read-only credential-free business capture at `2026-10-15T10:16:16.489064Z`,
  SHA256 `a331d4bd7248758aba167f657e37d56d89f5ef35b980f08b935df2561719dcf2`.
  New isolated child `br-wandering-snow-azcqie4c`, pinned by
  `neon/targets/fresh-candidate.json`: 125 business tables/2,576 rows restored;
  all baseline fingerprints, 466 constraints and five sequences reconciled.
  Corrective 0008 preserved all original rows/eight AI wallets and passed reapply.
- Prepared empty native auth/audit schema and separate restricted app/auth LOGINs.
  Actual login tests: ten allowed reads, 25 denied operations, verified client
  TLS, rollback-only synthetic writes. No production runtime configuration changed.
  The clean child remains outside the application's runtime/cutover allowlist.
- Copied all 65 current public JPEG objects/5,674,590 bytes to this child; full
  SHA256 readback and anonymous-write denial passed. Exact media replacement on
  65 articles, reference rollback, full baseline reconciliation after rollback and
  reviewed reapply passed. Source media and production URLs are unchanged.
- After explicit owner authorization, imported seven native identity mappings
  supported by source UUID/canonical/tenant evidence (two existing profiles,
  five explicitly reviewed same-source-UUID profiles). Business digest unchanged;
  no password, session or MFA credential imported; no messages sent to customers.
- Three unproven source identities now remain **separate and inactive** on both
  staging children, with zero active binding/new authority. Immutable review
  cases and DB activation/binding guards require verified ownership evidence
  before release. The collision's existing canonical owner, one tenant, four
  merchants and six outlets were not reassigned. No mapping was guessed by email.
  Native auth provider/audit UUID history is included in the private owner report.
- Owner-approved DMARC TXT `_dmarc.kasir.newhope.space` = `v=DMARC1; p=none`, TTL300,
  verified in DNS UI, authoritative DNS and public resolver. Existing A/CNAME/MX
  records unchanged. Resend outbound DKIM/SPF/feedback MX verified, tracking off;
  failed inbound receiving MX is separate from outbound delivery.
- Dedicated domain-restricted `sending_access` key stored privately and installed
  only on this PR branch Preview. Domain-management GET returns HTTP401
  `restricted_api_key`, an expected permission denial, not proof of invalid sending
  credentials. Public Preview stays `AUTH_EMAIL_ENABLED=0`.
- Explicitly approved separate owner test account: exactly one verification and
  one reset email to `stefen@newsystem.space` from `auth@kasir.newhope.space`.
  Resend reports both **delivered**. Real native sender/handler ran in an isolated
  operator process with the same staging origin/DB/config; no public mail flag
  was enabled. Existing authenticated Vercel browser tested the hosted HTTPS
  verification and reset callback/form. Backend reset, spent-token denial,
  old-session revocation and fresh TOTP enrollment passed; test sessions revoked.
  Password/MFA were generated for this isolated test, not owner device enrollment.
  React intentionally clears reset tokens from history after capturing them in
  component memory; a cleared URL is not a callback failure. Owner confirms **one message in inbox and one in spam** (latest correction,
  superseding an earlier both-inbox reply). Reception is proven; clean inbox
  deliverability is not. Do not send another message without authorization.
- After the owner's explicit full-backup authorization, captured a separate
  **source-encrypted logical recovery archive of every visible non-system schema**
  at `2026-10-15T10:43:44.718189Z`: 165 tables/3,055 rows, including 27 auth tables.
  SHA256 `377c2db8f659de17a817c38daebfdac4b86dcc4c4c5a8185677889f266f3f136`;
  RSA public-key fingerprint `dfee9e320c8de8e0e02c90ae8451d43486628152`.
  Uploaded ciphertext to the connected owner's private Drive folder; verified
  owner-only permissions, no public sharing, download and exact checksum match.
  Private key was not uploaded. No new paid resource/subscription was created.
- Offline memory-only PostgreSQL recovery drill from the downloaded ciphertext:
  all 165 table payloads roundtripped exactly; all 27 auth tables/164 rows restored
  with native types/generated columns and 110 PK/unique/check/FK constraints;
  all column values reconciled after PostgreSQL timestamp/type normalization;
  ciphertext tampering rejected. No plaintext archive persisted, source write,
  outbound auth call or restored live session endpoint occurred.

## Remaining gates and the exact missing resource/evidence

| Gate | Verified now | Still missing / concrete action |
|---|---|---|
| Full independent recovery | Encrypted off-source archive, private Drive/readback, offline auth data/constraint restore | Owner imports the local private key into a separate encrypted password-manager escrow and verifies recovery. Full native Supabase/GoTrue/platform-key recovery needs an approved isolated compatible runtime and a native source backup/DB connection. Current machine has no Docker/recovery service; existing unrelated projects were untouched. |
| Three identity recoveries | Separate inactive accounts and immutable holds; no new access; activation attempts denied | Legitimate user reauthenticates at the authoritative source, provides nonce-bound UUID proof privately, and tenant/merchant authority is verified. Only then append evidence/owner scope approval and review exact mapping. Source provider metadata alone cannot prove ownership of the conflicting canonical UUID. |
| Real email | Both delivered, hosted HTTPS callbacks and backend reset/revocation/TOTP passed | Owner reception confirmed: one inbox/one spam. Identify the spam message and privately inspect recipient Authentication-Results before closing deliverability. Owner device/recovery-code custody is not implied by automated TOTP. No further emails authorized. |
| Final source checkpoint | Fresh business source matched its capture; 68 articles and 65 objects copied | No source freeze approved/performed. The later full recovery capture is distinct, not a silent replacement for the earlier candidate. Repeat final DB/media delta capture/reconcile only within an approved single-writer window. |
| Offline POS | Regression suite and server historical receipts | Device-side unsent outboxes/checkpoints unavailable. Device operators must provide durable drain/export receipts; server receipt count does not prove queues empty. |
| DOKU | Signature/idempotency/provenance regression; captured source event/log tables empty | Provider-side retry/event checkpoint and late-event replay evidence unavailable. No real charge/refund/payment was attempted. |
| Integrations/production endpoint | Alias/deployment readback, code tests, restricted staging DB diagnostic | Production DATABASE_URL is write-only. Operator attests current endpoint with the read-only diagnostic; verify provider jobs, n8n/blog, schedulers and final branch storage credentials. No public diagnostic endpoint was added. |
| After-write rollback | Media rollback/reapply and financial/idempotency regression | Full reverse event migration after acknowledged target business writes not demonstrated. Freeze both writers, retain delta/audit and reconcile/replay with compensating entries; never switch DB URL over new writes. |
| Release acceptance | Engineering evidence | Independent backup acceptance and remaining owner/legal/cross-border/maintenance approvals in the master runbook stay open. |

Staging diagnostic confirms client-to-Neon certificate-verified TLS and narrow
roles. `pg_stat_ssl.ssl=false` is recorded as the separate backend observation;
this diagnostic does not establish internal proxy/compute transport attestation.
Production aliases still target `dpl_6drQHcA5rD9dHS58LCrPeB91mg21`, main SHA
`a427fb83fda6509bb7b18fb8c0b7155ecc3f2e49`. Presence of a secret is not endpoint proof.

## Verification and limits

Full local verify covers hygiene/lint, both typechecks, 70 baseline database
migrations, build, security/runtime/regression suites; new hold tests cover
activation/binding denial, immutable case evidence, runtime inability to approve
its own ownership proof and preservation of a different canonical owner.
Staging receipts cover actual restore/reconcile, split logins, seven reviewed
imports/three inactive holds, media rollback and approved real email acceptance.
Intermediate type/harness errors were corrected and affected checks rerun; they
are not reported as a green final result until the final run finishes.

A 23-hour Vercel share bypass was rejected by automatic approval review for
expanding access beyond the email test. It was **not** created or circumvented;
the already-authenticated owner browser supplied the narrower HTTPS test.

The recovery archive is **not a native pg_dump/PITR image or a fully tested
Supabase platform restore**. Three managed/domain types, partitioned realtime,
provider settings/keys, roles, object bytes and GoTrue service recovery have
separate fidelity/runtime limits. Public blob copies are not immutable backup
escrow. No full recovery, MFA-key recovery or independent acceptance is invented.

## Production cutover readiness

**NO-GO.** Fresh candidate and staging technical safeguards are prepared, but the
mandatory external recovery/ownership/device/provider/final-freeze gates remain.
Follow `full-cutover-runbook.md`, `data-rollback.md` and
`independent-backup-recovery.md`. No production cutover is authorized by this work.
