# Independent source backup and recovery — operator packet

Status: **PARTIAL RECOVERY VERIFIED, not independently accepted**.

Update after explicit owner authorization: a source-encrypted full visible-schema
archive (165 tables, including 27 auth tables) was uploaded to owner-only Drive
and downloaded with matching SHA256. Offline PostgreSQL restored all 27 auth
tables/164 rows and 110 constraints, plus exact payload roundtrip for all 165
tables. This is actual data recovery evidence, not a native Supabase/GoTrue or
platform-key restore. Private-key escrow and independent acceptance remain open.
See the latest pre-production packet and recovery receipts. The earlier
credential-free business capture remains a distinct artifact.

Original operator procedure and remaining native recovery gates follow. No native full-platform backup, separately accepted key escrow or independently
accepted Supabase auth service restore exists in this evidence set. The
fresh encrypted migration capture deliberately omits authentication credentials,
sessions/MFA, tokens and object bytes. Do not relabel that capture as full backup.

## Exact owner inputs and authorization

For Supabase source `fqxrhumsgigcgjtlbfuo`, the owner has explicitly authorized private DB+auth backup and isolated
verification, without paid new resources. Native administration access and a
compatible full recovery runtime remain missing; authorization is not the blocker. Earlier
automatic approval review rejected the full auth/session/MFA export through the
agent workflow because it contained credential material. The owner subsequently supplied explicit full-backup authorization. The new
read-only source-side encrypted archive was executed under that authorization;
only ciphertext left the database. Full native-platform restore still needs an
approved compatible administration environment;
no passwords, backup URLs or customer archives should be pasted into chat/GitHub.

Supply the administrator privately with: source direct/session connection and CA
(no transaction pooler), an owner-controlled encryption PUBLIC key/fingerprint,
a private off-account/off-project storage destination, retention duration,
restore operator, and an approved isolated Supabase recovery project plus its
cost authorization. Keep private decryption keys in a separate password-manager
or KMS escrow controlled by another custodian. This machine's local key alongside
the capture is not independent escrow. Never reset the production DB password to
obtain access; use an existing approved connection or owner-run backup job.

## Capture, encryption and private storage

1. Record source project, PG version, UTC capture time, backup/PITR coverage,
   encryption public-key fingerprint, job version and operator approval reference.
   Native `pg_dump` must use PG17 or a compatible newer client, verified TLS and
   a read-only connection/transaction. Use one consistent full database dump
   (custom format) so application and auth rows share a snapshot. Include auth
   users, identities, factors, sessions/token tables and all application schemas;
   preserve constraints/triggers/functions/policies/sequences/large objects and
   extension inventory. Inventory each included schema/table before acceptance.
2. Use a private mode0700 working directory on an encrypted temporary volume,
   `umask 077`, no shell tracing, CI uploads or terminal SQL output. Inject DB
   credentials through a mode0600 service/passfile or approved secret manager;
   never command-line URL arguments. Stream the native custom dump to encryption
   with the approved recipient. Example **operator-only shape**, not run here:

   ```sh
   set -o pipefail
   umask 077
   pg_dump --format=custom --no-owner --no-acl --dbname=service=newhope_source \
     | gpg --batch --encrypt --recipient "$BACKUP_RECIPIENT_FINGERPRINT" \
       --output "$PRIVATE_BACKUP_DIR/source-db.dump.gpg.partial"
   ```

   The `newhope_source` service must enforce `sslmode=verify-full`, a known source
   endpoint and read-only defaults. Check BOTH process exits before atomically
   naming the artifact complete. Inspect the encrypted restore catalog privately;
   insufficient permissions or excluded auth/managed objects mean **incomplete**.
   Supplement roles/grants/default ACLs and platform configuration privately;
   role passwords, Supabase encryption-root/Vault/column keys, JWT/OAuth/SMTP and
   webhook configuration need separately escrowed recovery material. No key values
   belong in this document. A dump's successful exit is not proof of auth recovery.
3. Hash ciphertext; upload only ciphertext and a non-PII manifest through the
   owner's approved storage client. Require private access, no public ACL/link,
   encryption at rest, versioning/object lock where approved, restricted restore
   principal and audit logs. Independently download and re-hash; have the second
   custodian demonstrate key recovery. Retain immutable object/version ID and UTC
   receipt privately; commit only sanitized pass/fail and acceptance reference.
4. Back up Storage **bytes** and object metadata separately, retaining bucket/key,
   size, checksum and ACL manifest privately. Native DB backup contains metadata,
   not the actual uploaded bytes. Include Edge Function source/config and cron,
   integrations, DOKU configuration and required keys in separate approved escrow.
   Provider PITR/backup coverage is additional protection, not off-site escrow.

## Isolated restore and acceptance

Use an approved **Supabase-compatible recovery environment**, never the production
source or a Neon business-only child. Match platform/extension/auth versions.
Disable outbound SMTP, SMS, webhooks, payment calls, schedulers, realtime consumers
and public ingress **before** restoring; isolate network access. Do not restore
live sessions into an externally reachable service. Native managed-schema restore
needs Supabase's supported process and a reviewed owner/ACL translation plan;
never run an indiscriminate `pg_restore --clean` over a hosted project.

On a newly provisioned empty compatible recovery database, verify ciphertext hash
and recipient, decrypt privately to the encrypted ephemeral volume, inspect
`pg_restore --list`, and restore with errors fatal. Restore reviewed roles/schema,
then data with the provider-required trigger handling to avoid double encryption,
then reviewed grants/platform keys. Stop on any auth/Vault decryption or managed
schema mismatch. Do not modify production keys or relax source permissions.

Acceptance requires an independent operator to record: full schema/object counts;
per-table counts/checksums; finance totals and immutable IDs; auth user/identity/
MFA/session table completeness; valid FK/sequence states; decryptability of any
Vault/encrypted MFA fields using the separately recovered key; private object-byte
hash equality; and restored application/API authorization behavior. Use a
dedicated recovery canary, never a customer's password/MFA or email, to test auth
without activating copied identities. Confirm outbound attempts remained zero.
Measure RPO/RTO and retain sanitized restore logs, source snapshot/checkpoint,
backup object version/checksum, key fingerprint, isolation proof and independent
operator acceptance signature/reference. Only that evidence closes the backup
gate. Securely dispose of plaintext working files per owner policy after acceptance.

Current missing resources: approved native source connection/export job; complete
auth recovery archive and required platform keys; owner-managed external escrow;
isolated recovery project/access/cost approval; independent operator acceptance.
All remain open. An authorized encrypted all-visible-schema/auth archive and offline native auth
table restore have since run successfully; a complete Supabase service/platform
restore and independent owner/key acceptance have not.

References: [Supabase backups](https://supabase.com/docs/guides/platform/backups),
[Supabase supported restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html),
[PostgreSQL service files](https://www.postgresql.org/docs/17/libpq-pgservice.html).
