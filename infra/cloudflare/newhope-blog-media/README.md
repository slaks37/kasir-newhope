# New Hope production blog media Worker

This is the tracked source for the currently deployed read-only R2 media gateway.
The Vercel app stays on Vercel, DNS stays unchanged, and R2 production remains private.

- Worker: https://newhope-blog-media.stefenlaksana-sl.workers.dev
- Bucket binding: `BLOG_BUCKET` → `newhope-blog-production`
- Allowed methods: GET, HEAD
- Allowed paths: `/automation/generated/<uuid>.jpg` and `/<admin-id>/<uuid>.jpg`
- R2 `r2.dev` production endpoint: disabled; do not turn it on.

## Recovery and deployment

From this directory, deploy only with the correct Cloudflare account:

```sh
npx wrangler whoami
npx wrangler deploy
```

Never expose S3 credentials in this Worker. Application uploads use authenticated server-side R2 S3 credentials set only on Vercel Production.

## Production environment variables

Set `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`, plus new **production bucket-scoped** `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Do not reuse the staging credentials, log secrets, or put them in the repository.

## Acceptance gates

1. PUT a disposable valid JPEG through the authenticated application R2 adapter using a fresh UUID object key.
2. Verify object metadata using authenticated S3 HEAD (image/jpeg, immutable cache policy).
3. Verify public Worker GET/HEAD 200 with HTTPS and matching SHA-256; verify 404 missing paths, 405 writes.
4. Verify blog cover and Open Graph URL; regression-test existing legacy image URLs.
5. Only then merge/deploy PR #31; configure the active n8n workflow separately after backup, reconciliation and verified production credentials.
6. Keep production rollout blocked when any real HTTPS, write, or audit test is unverified.

Use `docs/blog/automation-r2-review.md` for the end-to-end n8n and rollback matrix.
