# Existing-account migration to Neon and Better Auth

This procedure prepares a reviewed import; it does not change production. The
source is Supabase project `fqxrhumsgigcgjtlbfuo`. UUIDs remain application IDs,
including internal memberships, paid subscription terms, wallet balances,
business/outlet IDs and offline business aliases. A matching email is never an
account-linking proof and cannot claim another UUID or tenant.

## Current staging receipt, 14 October 2026

After the 125-table source restore passed reconciliation, the isolated restored
child `br-curly-truth-aze21ktf` received the additive auth schema and one reviewed
source-metadata import. Seven identities were imported: two existing canonical
profiles and five explicitly evidenced same-source-UUID profiles. The immutable
batch is `39b2db02-9cd6-498f-99d4-cffeeafc6408`; source encrypted sanitized capture
SHA-256 is `8ea8095f142e34637890b9dea51be1e6fa50659291ebd89fb476d77eb0b053a8`.
The owned-business fingerprint remained
`b671d0507eef0b0c4821e4dea50a86381faddb5ca148036e35ecde0e23daac77`.
There are seven native verified users and bindings, zero native credentials,
sessions or enrolled TOTP factors, and no messages sent. This is metadata readiness,
not completed customer login acceptance.

The immutable batch's original `reviewer_ref`,
`OWNER_REVIEW_EXPLICIT_SOURCE_UUID_CANDIDATES_20261014`, identifies the agent's
technical review of source UUID evidence under the owner's general instruction
to prepare migration. It **does not record the owner reviewing/approving every
row**, a legal approval, or approval to cut over production. The misleading
prefix is preserved as historical evidence rather than rewritten. Future plans
use `AGENT_REVIEW_VERIFIED_SOURCE_UUID_CANDIDATES_*`. The separate clarification
receipt records this meaning; final owner mapping/cutover approval is still a gate.

Three source identities remain blocked: two lack same-UUID application ownership
evidence; one collides with an existing different-UUID canonical email. The private
exception file preserves exact IDs for owner review and is not committed. Neither
an email match nor the general migration request authorizes ownership reassignment.
These exceptions, recovery delivery and admin MFA still prevent full cutover.

The owner-supplied support mailbox is absent from the source Auth capture. It can
be used for a new isolated preview delivery test after explicit send authorization;
it must not silently claim a restored merchant or platform role.

## Credential and recovery strategy

The approved source metadata contains UUID, email, source email-verification
state, active state and display name only. The importer rejects extra fields,
including hashes, passwords, tokens, caller roles and MFA secrets. It creates a
native Better Auth identity with the same UUID and an explicit reviewed binding;
it creates no credential, active session or TOTP secret. Existing source users
set a new password through the native 15-minute single-use reset flow. Better
Auth 1.7.7 creates its native hashed credential after successful reset and revokes
all previous native sessions. Old Supabase access/refresh tokens are not accepted
in Better Auth mode. No fallback silently restores Supabase login after cutover.

Verification is inherited only from an audited source record. An unverified
source email still requires a native verification link before app access. A
suspended source account remains inactive. Platform administrators/support must
enroll and prove a new authenticator before protected mutations; resetting a
password or using a backup code confers no fresh TOTP assurance. Source MFA
secrets and backup codes are not transferable. Prepare owner-verified recovery
and an enrolled backup platform administrator before stopping the old provider.

The client provisions an owner tenant only when the authenticated identity API
returns `needsOnboarding=true`. Imported owners, platform users and existing
staff can sign in without acquiring a new tenant. Restored staff memberships
remain records; the current merchant directory is owner-scoped and this migration
does not add staff merchant authority. Staff-device and PIN operation must be
rehearsed separately for every existing supported staff flow before cutover.

## Reviewed import

1. Capture an encrypted consistent source backup and its SHA-256 receipt. Verify
   backup decryption, restore completeness and foreign keys on an isolated child.
   Export only the allowlisted metadata from the same capture. Do not print it.
2. Save a mode-600 ignored JSON manifest. Exact fields:

   ```json
   {
     "version": 1,
     "sourceProject": "fqxrhumsgigcgjtlbfuo",
     "backupRef": "encrypted-snapshot-sha256-or-reviewed-ref",
     "reviewerRef": "owner-approved-review-ticket",
     "users": [
       {"id": "source-uuid", "email": "source-email", "emailVerified": true,
        "isActive": true, "name": "source-display-name"}
     ]
   }
   ```

3. Run plan-only `scripts/neon/identity-stage-auth.mjs --env PRIVATE_RESTORE_ENV`
   after the source reconciliation receipt is PASS for this exact child. Review
   its missing-file hashes, then use `--apply` for additive auth/identity schema.
   Apply reviewed additive `neon/migrations/0006_identity_import_audit.sql` and
   `0007_identity_canonical_create_evidence.sql` using
   the migrator, with application/auth runtime denied access to its audit tables.
4. Run plan-only with the explicitly approved isolated branch environment:

   ```sh
   node scripts/neon/identity-import.mjs --env .env.better-auth-staging.local \
     --input build/neon/identity-source-manifest.json \
     --out build/neon/identity-review-plan.json
   ```

   The receipt contains source hash, target canonical snapshot hash, business
   fingerprint, canonical issuer and count, without customer names or addresses.
   Both input and review files must be mode 600. No identity write occurs.
   `scripts/neon/identity-source-review.mjs` derives safe candidates and private
   exceptions from the same encrypted capture; it is not target-side approval.
5. Review source provenance, canonical UUID/email/active-state mapping, issuer,
   user count, billing/wallet fingerprint and endpoint against the target manifest.
   Unknown canonical UUIDs, email mismatches, case-fold collisions and any native
   account/binding collision block the entire batch. Do not resolve them by email
   ownership heuristics; escalate each exception for independent owner proof.
   A source UUID missing from `internal.users` can be explicitly listed in the
   optional manifest `canonicalCreateIds` array only after review. It must be a
   verified, active source identity with an existing restored same-UUID owner
   reference/POS identifier and no different-UUID email collision. The reviewed
   plan lists each canonical creation and hashes its UUID evidence. Application
   profiles are minimal: no platform role, tenant, membership, trial or wallet is
   created. Source UUIDs lacking evidence and collisions remain blocked.
6. Apply the reviewed receipt:

   ```sh
   node scripts/neon/identity-import.mjs --env .env.better-auth-staging.local \
     --input build/neon/identity-source-manifest.json \
     --review build/neon/identity-review-plan.json --apply
   ```

   The import rechecks plan/target under a serializable transaction and advisory
   lock. It records immutable batch/item evidence and source-provenance references.
   An unchanged retry is safe; a revoked batch cannot be reapplied automatically.
   No customer email is sent by either command. Review audit batches with the
   migrator; never expose a public linking endpoint or secret migration override.

## Reversible staging rollback

Use the recorded batch ID and review reference, after stopping test traffic:

```sh
node scripts/neon/identity-import.mjs --env .env.better-auth-staging.local \
  --revoke-batch REVIEWED_BATCH_UUID --reviewer REVIEW_TICKET \
  --reason 'Approved rollback reason' --apply
```

This disables only imported native identities and bindings, revokes their native
sessions and outstanding reset entries, and appends an immutable revocation.
It does not delete source/canonical users, POS transactions, memberships,
subscriptions, wallet history or migration evidence. Do not change the old Auth
provider or production aliases as part of a staging rollback. Production rollback
after new Neon writes requires the reviewed write-freeze/delta-replay runbook;
pointing production back at a stale source can lose transactions.

## Evidence and release gates

- `node --import tsx scripts/dev/test-identity-import.ts`: manifest secret-field
  rejection, duplicate/type checks, approved sender/recipient/HTTPS path checks.
- `node --import tsx scripts/neon/identity-rehearsal.mjs`: real Neon synthetic
  import through the reviewed API, reset-to-native credentials, immutable audit,
  old-session denial, account collisions, existing owner/platform/staff scope,
  new signup and reversible batch revoke. Credentials/tokens are never printed.
- `build/neon/identity-import-rehearsal.json`: sanitized per-run results. A
  synthetic PASS is not proof of a successful customer import or real delivery.
- `scripts/neon/identity-audit.mjs --env PRIVATE_RESTORE_ENV`: read-only sanitized
  batch and count report; no account addresses, names, credentials or link tokens.

Cutover gates: complete consistent source restore and verified identity count;
review all mapping exceptions; owner-approved HTTPS email recovery delivery and
native link completion; second administrator enrolled; supported staff workflows
and offline aliases verified; production-capable target manifest and separate
roles approved; reconciliation and rollback after Neon writes rehearsed. Keep the
production cutover switch blocked until these are demonstrated.

Sources checked: pinned local Better Auth 1.7.7 native password routes and
[official password options](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/email-password.mdx).
