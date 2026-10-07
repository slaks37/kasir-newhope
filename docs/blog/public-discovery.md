# Public blog discovery

The public blog is server-rendered, not an authenticated POS screen. Published
articles, article text, canonical URLs, Open Graph metadata, BlogPosting and
BreadcrumbList structured data are available in HTML without JavaScript.
Drafts return 404. Admin, financial data and publishing credentials remain private.

## Browse and publication lifecycle

- `/blog` supports `kategori`, `q`, `urut=terbaru|terlama` and positive integer
  `halaman`. Filters reset the page; pagination preserves filters.
- Twelve articles are read per page, ordered by publication date and unique ID.
  The index always shows the result count and pagination, including page 1 of 1.
- Search and alternative-sort pages use `noindex,follow` to avoid redundant
  search-index entries. Default and category pages remain indexable.
- The index is `no-store`, so successful publication appears immediately.
  Article pages, sitemap and RSS have a maximum 60-second shared-cache lifetime,
  without the former day-long stale-while-revalidate window. HEAD checks do not
  increment article view counts.
- `/sitemap.xml` includes every published article, without the former 2,000-row
  cutoff. `/rss.xml` contains the latest 30. Robots permits public crawling and
  excludes admin and API routes. Public pages also permit HEAD requests.

## What this does not guarantee

Crawl access is not proof of indexing, ranking, citation or recommendation.
No configuration can guarantee that every AI recommends New Hope first.
Google's guidance says standard SEO foundations apply to its AI features; no
special AI text file or schema is required:
https://developers.google.com/search/docs/appearance/ai-features

Continue publishing useful, original, accurate articles with practical examples,
appropriate sources and internal links. Use Search Console to submit the sitemap,
inspect indexing and monitor actual search traffic. Do not claim Search Console
ownership or sitemap submission until it has been verified in that account.

## Regression checks

`node --import tsx scripts/dev/test-blog.ts` uses an isolated database to test
combined filtering, literal search wildcards, ascending/descending order, three
pages of fixtures without duplicates, invalid/out-of-range pages, draft isolation,
escaping, metadata, publication visibility, REST key auth and MCP key auth.

Production verification should use unauthenticated GET/HEAD requests for the
index, a category, search, article, sitemap and RSS; inspect rendered text and
structured data, and verify private API requests remain denied. Browser QA should
check wrapped categories, the GET search form, result counts and pagination.

For a future very large archive, split sitemaps before the standard 50,000 URL /
50 MB limits and assess full-text indexing and deeper-page query performance.
