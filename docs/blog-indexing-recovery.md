# Blog indexing recovery — 19 October 2026

## Evidence and limits

Owner screenshots show two articles in `Crawled - currently not indexed`, last crawled12October, and a validation failed13October. A sitemap.xml example is also present; an XML sitemap does not need to appear as a search result. These screenshots do not establish a site-wide indexing halt or a specific canonical/content-quality problem.

Read-only Search Console browser access and public HTTP diagnostics could not execute: automatic approval review repeatedly failed with `Selected model is at capacity`. This is a service-capacity failure, not a safety rejection. It was not bypassed with cookies, alternate authenticated APIs or another execution route. Live Google-selected canonical, fetch results and validation details remain unverified.

## Concrete code defects fixed

1. Missing/forbidden blog tables previously produced a successful empty sitemap, and a successful empty blog index. A temporary database failure must not advertise that published articles disappeared. Database failures now return503 with `Cache-Control:no-store` and `Retry-After:300`. A genuinely empty database still returns a valid200 sitemap.
2. Homepage/blog/category sitemap entries inherited the newest article timestamp and a fabricated2026-10-01 fallback. Their actual modification times are not tracked. Those unsupported lastmod values are removed; articles retain their stored updatedAt. URLs and original content are preserved.

These fixes address crawler-facing reliability and sitemap accuracy; they do not prove the cause of Google's decision on the two affected articles or guarantee indexing.

## Validation

- `npm run build`: PASS (SPA, diagnostics, landing/legal and generated API bundles).
- `npm run lint`: PASS (hygiene and both TypeScript configurations).
- `npm run test:blog-seo`: PASS. Registered production route handlers exercised without network/listeners: missing table, insufficient privilege and connection-failure codes each return503/retry/no-store across blog and both sitemaps; true empty store remains valid; article dates preserved and collection dates omitted.
- New regression is part of the normal admin-security test chain.
- Full HTTP regression, GitHub CI and hosted verification for this change are not claimed until their actual executions complete.

## Remaining execution

After review-service access is restored: inspect the two URLs in Search Console (Google-selected canonical, page fetch, indexing allowed and crawl result), run Live Test, inspect the failed validation log, and verify production HTTP200/self-canonical/indexable HTML with complete article body. Check Sitemaps status and last read. Correct demonstrated issues; do not rewrite content or redirect URLs on a guess.

Push to existing PR21 and verify exact-commit CI/Preview. Production changes require a concrete reviewed SEO release decision; do not merge/promote the hybrid database migration to solve an indexing issue. If release isolation is needed, use only the reviewed SEO patch on the current production base with original Supabase config, no Better Auth activation or database cutover.

Once applicable corrections are live and verified, request inspection/indexing for the two article URLs only, and submit/verify sitemap via the Sitemaps report. Do not promise that a live-test pass, sitemap submission or validation request forces Google to index a URL. Do not attempt to index sitemap.xml as a content page.

Sources: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap and https://support.google.com/webmasters/answer/7440203?hl=en
