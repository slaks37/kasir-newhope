# Moving public media off Supabase

Source inventory on 2026-10-13 found only the public `blog-media` bucket: 39 JPEG objects totaling 3,428,274 bytes, each bounded at 500,000 bytes. Product/receipt images currently use inline data URLs or checked-in static assets rather than separate Supabase Storage buckets. Check this inventory again at the final write freeze; ongoing n8n publishing can add covers after the snapshot.

Official Neon documentation confirms Singapore Object Storage and Free-plan 5 GB/project. The fresh migration child has `blog-media` configured `public_read`. Its `storage:read` + `storage:write` credential is branch-scoped, stored only in the ignored mode-0600 `.env.neon-storage-restore.local`, and is valid for that branch and descendants, never unrelated/root branches. No paid upgrade was provisioned.

`services/shared/objectStorage.ts` uses pinned official `@aws-sdk/client-s3`, SigV4, path-style addressing, verified HTTPS endpoint/branch binding, request timeouts and bounded retries. The blog provider requires `STORAGE_PROVIDER=neon`. A Better Auth migration deployment fails closed when storage is missing; it never silently uploads new images to Supabase. Generated uploads keep UUID keys and immutable cache-control. Provider routes retain existing API-key/superadmin authorization.

## Copy and verification

1. Export read-only `storage.objects` metadata into a private/ignored `build/neon/storage-source-manifest.json`. No source credentials are required to download the currently public JPEG bodies.
2. Run `node --import tsx scripts/neon/storage-migrate.ts`. It pins the target manifest/project/child, validates the allowed public source origin and key, limits downloads to 500 KB, and refuses changed metadata or conflicting existing objects. It does not delete source or overwrite conflicting target objects.
3. Each full original body, authenticated target download and anonymous public target download must have identical SHA-256 and size. Anonymous PUT is tested and must return 403. Success evidence is `build/neon/storage-copy-evidence.json`. `--verify-only` reruns complete verification and refuses missing objects.
4. Reconcile restored database counts/checksums before URL substitution. Run `node --import tsx scripts/neon/storage-rewrite.ts` only after restore and copy verification PASS. It substitutes exact manifest URLs in `public.blog_posts` cover/avatar/content/SEO/media fields, preserves editorial timestamps, rejects any remaining source Storage reference, and records a private rollback snapshot before commit. It does not change production URLs or source data.
5. Test public blog HTML, image downloads, API image import and authenticated editor upload on Preview. Complete a fresh delta inventory at cutover; compare manifest with source object count/bytes and database cover references again.

The old Supabase image URL itself cannot be redirected by Neon. Target app HTML/SEO must refer to the verified new URL before retiring Supabase. Do not delete the old bucket during rollback window. External article-source image URLs and static checked-in assets are preserved.

## Rollback and retention

`node --import tsx scripts/neon/storage-reference-rollback.ts` restores target blog references from the private snapshot. It compares the current editorial fields with the expected relocated snapshot first and refuses collateral changes. Use it while the isolated target remains frozen. URL rewrite refuses to replace an existing rollback snapshot; after an intentional rollback, `--reuse-reviewed-rollback` reapplication additionally requires all original rows to match the saved snapshot exactly. Both rollback of 39 references and exact reapplication passed on 2026-10-14. Copies remain present and source remains intact. Do not rely on Neon object lifecycle/versioning for deletion or backups: current S3 compatibility docs say configuration is stored but expiry/versioning is not enforced. Schedule explicit approved retention cleanup and snapshots outside this preparation.

Current scope contains no private bucket. Future customer uploads need a separate private bucket, server tenant/outlet authorization and expiring presigned URLs; never move private assets into the public blog bucket. Only public object reads are anonymous. Storage secrets stay on the server, never `VITE_*`.

References verified 2026-10-13: [Storage overview](https://neon.com/docs/storage/overview), [Authentication](https://neon.com/docs/storage/authentication), [S3 compatibility](https://neon.com/docs/storage/s3-compatibility). The write-only credential returned 403 for HEAD/LIST in this branch, so readback verification uses explicit read and write scopes; the unused temporary write-only credential was revoked.

Bounded evidence: `docs/migrations/evidence/neon-roles-storage-2026-10-14.json`. All 39 full SHA-256 comparisons and public reads passed; anonymous writes returned 403; 39 restored blog records now reference Neon and no Supabase Storage blog reference remains. The current branch includes synthetic runtime test data and is not a clean final production candidate.
