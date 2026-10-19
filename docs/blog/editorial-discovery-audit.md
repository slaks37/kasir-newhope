# SEO and editorial maintenance — 19 October 2026

Based on main a427fb8. This branch also preserves the SEO-only outage/lastmod patch already deployed separately, so merging main later will not regress it. No migration, configuration, payment, identity or editorial record changes.

## Read-only duplicate checks

Use the existing authenticated REST surface:

`POST /api/v1/blog-automation/duplicate-check`

Or the existing API-key/OAuth MCP tool `check_duplicate` (readOnlyHint=true). Existing access controls remain in force. No new external AI service or additional authorization scope.

Example JSON body:

```json
{"title":"Cara menghitung HPP kopi susu","keyword":"HPP kopi susu","category":"Kuliner & F&B","sourceUrls":["https://publisher.example/news/article"]}
```

The result contains candidateTitle, candidateKeyword, matches (title, slug, canonical URL, classification, indicators and explanation), archive.complete/count, classification and explanation. Titles and slugs use Unicode/case/punctuation normalization. Title-token Jaccard >=0.65 with at least three shared terms marks near duplicates; >=0.4 with two shared terms marks topic overlap. Keyword Jaccard >=0.6 with two shared terms requires category or shared title evidence. Category alone cannot mark a duplicate. Matching stored source URLs (ignoring fragments/tracking parameters) require review, rather than implying exact duplicated text.

A single SQL statement reads every published metadata record in a consistent statement snapshot. There is no RSS 30-item cap and no offset drift. Drafts never enter this result; authorized draft access remains the existing list/get tools. Query/acquisition/metadata parsing failure yields INCONCLUSIVE and archive.complete=false, never UNIQUE. UNIQUE means no configured rule matched, not a guarantee of semantic originality. No Indonesian stemming or AI semantic classifier is claimed. At much larger archive sizes, consider incremental retrieval under a repeatable snapshot.

## Other corrections

- Preserve 503/no-store/Retry-After=300 on blog/RSS/sitemap database failures and stored article-only lastmod.
- Replace three homepage links to removed seeded posts with active category links, without editing articles.
- Redirect public blog trailing-slash variants with 308 before the exact API allowlist; retain query strings.
- Explicit Twitter title and description metadata.
- Stable secondary ID order for authorized list_posts pagination.

## Checks

`npm run test:blog-seo`: injected missing/forbidden/offline database errors, empty sitemap, XML parser validation, exact stored dates, 237 published records, draft exclusion, title/slug/keyword/source similarity, failure classification, authenticated REST/MCP, unchanged record count, server metadata and trailing slash redirects.

`npm run test:blog-mcp`: existing OAuth integration plus duplicate tool visibility/read-only annotation and authenticated invocation.

`npm run verify`: lint/typecheck, build, runtime, full existing unit and integration chain. The first run exposed the previous seven-tool assertion after adding the eighth tool; the assertion and integration coverage were updated. Sandbox localhost restrictions require running the isolated listener tests with the permitted execution profile.

## Search Console

Browser inventory attempt returned `js execution timed out; kernel reset, rerun your request` after 30 seconds. No further retry, inspection request, or indexing claim. Verification token existence does not prove property ownership/access.

Two URLs verified from the previous release's production-smoke evidence (not inferred from titles):

- https://kasir.newhope.space/blog/cara-menghitung-hpp-menu-kafe-per-porsi-contoh-lengkap-kopi-susu
- https://kasir.newhope.space/blog/cara-menentukan-harga-laundry-kiloan-yang-tetap-untung

Select the verified property covering each URL. For each: URL Inspection → paste exact URL → Test Live URL → check fetch success, indexing allowed, rendered content and canonical → Request Indexing. Compare Google's selected canonical in the indexed result. Check Sitemaps last read/status, submitting /blog/sitemap.xml for a /blog/ URL-prefix property or /sitemap.xml for the site property. Domain properties require DNS ownership verification; URL-prefix properties support their configured verification methods. Submission does not guarantee indexing.

Field Core Web Vitals, first publication timestamps versus stored created_at, and Google-selected canonical require independent evidence. Synthetic viewport tests are not physical-device or field-performance evidence.
