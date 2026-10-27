# Canonical identity migration

Authentication provider IDs are credentials, not application ownership. `internal.users.id` remains the canonical historical UUID. Tenant owner references, staff memberships, outlet/module grants, receipts, shifts and immutable financial actor references are never rewritten to a new provider ID.

`internal.auth_identity_bindings` maps the exact tuple `(better-auth, HTTPS issuer, provider subject)` to one existing canonical UUID. Provider subjects may be opaque strings. Both forward and reverse mappings are unique within an issuer. An unmapped identity is denied even when its verified email equals a historical owner's or staff member's email. A change of sector cannot create ownership. Disabled bindings and inactive canonical users are denied in both directions.

The mapping table has RLS and no browser/service-wide grants. `svc_internal` receives SELECT only; it cannot create, repoint or delete bindings. Migration evidence is immutable. Only activation state can change on an existing binding. The separate auth runtime may execute a narrow verified-new-signup enrollment RPC; it must not receive generic mapping writes.

## Reviewed existing-account mapping

1. Obtain a credential-free source identity inventory, its SHA256, and independent proof tying each destination provider subject to the historical canonical account. Email equality is insufficient. Do not export passwords, hashes, MFA secrets, OAuth tokens or sessions.
2. Construct `IdentityMigrationManifest` with version, provider, issuer, source snapshot digest, reviewer reference, writer-freeze reference, and explicit mappings containing provider subject, canonical UUID and evidence reference. Unexpected fields are rejected. Canonical users must already exist and be active. Existing/conflicting mappings require independent review; planning never overwrites them.
3. Run `planAuthIdentityMigration` using an isolated maintenance connection. Inspect its manifest, target and business fingerprints. Fingerprints cover every column of every application table in `internal`, `pos`, `billing`, `ai`, `public` and the private MCP schemas, including current module grants, memberships and all ledger actor columns. Only SHA256 row digests leave the database. Auth-registry audit tables and migration bookkeeping are excluded. Missing PR27 baseline tables or oversized snapshots fail closed; the bounded rehearsal refuses sampling.
4. During an explicitly approved frozen staging/cutover window, call `applyAuthIdentityMigration` with the reviewed plan. The owner-only transaction locks application tables in SHARE mode with NOWAIT, recomputes fingerprints, refuses drift, adds mappings and immutable batch evidence, then confirms business rows are unchanged. Repeating the exact successful batch is a no-op. No production apply is authorized by this document.
5. Test independent owner/staff provider sessions against their existing merchants, outlets and modules. Confirm staff stay staff and historical cashiers/actors remain unchanged. Confirm unreviewed identities, foreign issuers, revoked memberships and denied roles fail closed. Provider login alone is not migration acceptance.

## New accounts

`enrollNewAuthIdentity` is a maintenance-only API. Its caller must independently validate an actual server-owned new-signup intent and live verified credentials; the reference parameter alone is not proof and must never be accepted from a public request. The normal runtime uses its narrowly scoped enrollment RPC, which verifies the live auth user and consumes an unconsumed registration intent. A new canonical UUID is generated independently of the provider ID. Existing-email collisions require reviewed migration and cannot be enrolled. Enrollment creates only the canonical user and binding; it creates no tenant, membership, merchant, outlet or owner role.

## Rollback

Keep the old production provider until hosted staging, migration and rollback gates pass. Reverting the selected runtime provider preserves the new registry and all evidence. `revokeAuthIdentityMigration` disables only the mappings in the reviewed batch and appends immutable revocation evidence; it does not modify business records or unrelated new accounts. Provider sessions must also be revoked through the auth provider. A revoked migration cannot be reapplied silently. Do not delete mappings, audit rows, native pending transactions or canonical users to make rollback succeed.

The local identity test uses disposable synthetic PGlite fixtures. It verifies migration replay, differing provider/canonical IDs, owner/staff continuity, two modules, drift rejection, service-role denial, reviewed rollback and unchanged financial actors. It does not establish hosted provider, external email, Google OAuth or physical-device acceptance.
