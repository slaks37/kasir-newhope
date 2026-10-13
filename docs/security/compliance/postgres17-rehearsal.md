# Native PostgreSQL17 migration rehearsal

This validation branch builds on the integrated five-domain candidate `5be2d893e52f342aee114fadc3cde4fbf9ddacce`. Production main was still `90321d8` on 13 October 2026; PRs 14–18 were open drafts, and the production migration registry contained none of this package's five migrations. The connected Supabase project had no development branches. All of those checks were read-only.

The new CI job starts a disposable `postgres:17` service. It uses no repository secrets, Supabase project credentials or customer data. The actual PostgreSQL patch version, CI revision, baseline and migration SHA256 hashes, checks and timestamps are recorded in `postgres17-security-evidence` (30-day artifact retention). A failed run is not a signoff. The result file is `build/security-rehearsal/postgres17.json` and is intentionally not committed as fabricated evidence.

## What the gate proves

- Requires native PostgreSQL17 and an empty database before any DDL. Dedicated environment variables and strict loopback/port/database/login checks reject remote production endpoints, connection overrides and accidental `DATABASE_URL` fallback. The fixed password belongs only to the disposable test container.
- Bootstraps the repository's existing schema through migration 0058; applies the five reviewed Supabase migrations exactly once, in release order. Each local 0059–0062 mirror must match its corresponding Supabase SQL byte-for-byte.
- Exercises synthetic unsafe browser relation, column, sequence, helper and future-default ACLs in all six business schemas. Direct read/write/sequence denials and effective function/column privilege checks cover the full resulting repository schema.
- Compares fingerprints of every preexisting base-table column value, existing RLS flags and effective relation/helper privileges for known backend roles before and after migrations. Extra payment metadata is additive; existing values are not rewritten.
- Uses two synthetic tenant/merchant identities to test own-tenant positives, unset/foreign reads and foreign inserts for credentials, privacy requests, provider consent and merchant payment accounts. This is database-policy evidence, not a claim of independent Supabase cloud identities or outlet enforcement at the database layer. Existing HTTP tests exercise action/outlet authorization separately.
- Tests immutable UPDATE, DELETE and TRUNCATE denial for financial, privacy, notice, consent and reconciliation evidence even as `service_role`.
- Refuses ACL reapplication while an original snapshot exists, restores captured original relation/column/sequence/function/default privileges, checks new evidence tables stay private, then reapplies protection. The temporary reopened permissions occur only inside the disposable container.

## Run locally when Docker is available

```sh
docker run --rm --name newhope-security-rehearsal -p 127.0.0.1:55432:5432 \
  -e POSTGRES_DB=newhope_security_rehearsal -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=rehearsal-only postgres:17
```

After the container reports ready, in another terminal at this checkout:

```sh
node scripts/dev/test-rehearsal-target.mjs
NEW_HOPE_REHEARSAL_CONFIRM=DISPOSABLE_POSTGRES17 \
NEW_HOPE_REHEARSAL_DATABASE_URL=postgres://postgres:rehearsal-only@127.0.0.1:55432/newhope_security_rehearsal \
node scripts/dev/rehearse-security-postgres17.mjs
```

Stop and discard this explicitly named disposable container after review. The test intentionally refuses rerunning on its populated database; create a fresh disposable container instead. Never adapt the target guard to accept the production project.

## Remaining managed staging gates

Native PostgreSQL17 is stronger version evidence than PGlite but does not reproduce managed Supabase Auth/PostgREST/Realtime/Storage, `supabase_admin` defaults, actual production schema drift, platform extensions, backup restoration, real TLS/CA validation, backend credentials or licensed PSP behavior. Run the [production readiness checklist](production-readiness.md) with a separately approved matching managed staging environment before production SQL or deployment. Do not treat CI passing as owner/legal approval or permission to upgrade a paid plan.

Supabase documents branching as isolated, data-less preview environments and currently requires Pro for that feature: [deployment guidance](https://supabase.com/docs/guides/deployment), [branching](https://supabase.com/docs/guides/deployment/branching). No branch, project, paid upgrade, production migration or application deployment was created by this continuation. Agnes AI and DeepSeek remain unchanged.
