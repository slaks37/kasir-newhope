/**
 * Server-rendered public blog: /blog, /blog/:slug, /sitemap.xml, /rss.xml.
 *
 * Search engines get complete HTML (title, canonical, Open Graph, JSON-LD and
 * the article body) without running the SPA. Every page uses the same layers:
 * site header → page header (breadcrumb, H1, lead, meta) → content → footer.
 */
import { BLOG_CATEGORIES, categoryFromSlug, categorySlug } from '../lib/blog/categories';
import { renderArticle } from '../lib/blog/markdown';
import type { FaqItem } from '../lib/blog/articleInput';

export const GTM_ID = 'GTM-WD7T7WSF';
export const BLOG_NAME = 'Blog New Hope POS';
export const BLOG_PAGE_SIZE = 12;

export type PublicPost = {
  id: string; slug: string; title: string; excerpt: string; content: string; category: string;
  coverImage: string; author: { name: string; role: string; avatar: string };
  readingTimeMinutes: number; tags: string[]; isFeatured: boolean;
  mediaEmbeds: Array<{ type?: string; url?: string; caption?: string }>;
  seo: { metaTitle?: string; metaDescription?: string; metaKeywords?: string[]; coverAlt?: string; faq?: FaqItem[] };
  createdAt: string; updatedAt: string;
};

export function siteUrl(): string {
  const raw = process.env.PUBLIC_SITE_URL || process.env.PUBLIC_APP_URL || 'https://kasir.newhope.space';
  return raw.replace(/\/+$/, '');
}

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
const date = (iso: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(iso));
const postUrl = (slug: string) => `${siteUrl()}/blog/${slug}`;
const DEFAULT_IMAGE = '/retail-store.jpg';
const image = (post: PublicPost) => post.coverImage || DEFAULT_IMAGE;
const absolute = (url: string) => (url.startsWith('http') ? url : siteUrl() + url);

const STYLE = `
:root{--bg:#fafaf7;--surface:#fff;--ink:#1c1917;--muted:#57534e;--soft:#78716c;--line:#e7e5e4;--brand:#f5b82e;--brand-ink:#78350f;--brand-soft:#fef3c7;--radius:14px;--max:1120px;--read:720px;color-scheme:light}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 "Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}img{max-width:100%;height:auto;display:block}
.wrap{max-width:var(--max);margin:0 auto;padding:0 20px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:12px;background:#fff;padding:8px 12px;z-index:10}
.site-header{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.site-header .wrap{display:flex;align-items:center;gap:16px;height:64px}
.brand{white-space:nowrap;display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;letter-spacing:-.01em}
.brand-mark{width:32px;height:32px;border-radius:9px;background:var(--brand);display:grid;place-items:center;font-size:15px;color:#1c1917}
.brand small{display:block;font-weight:600;color:var(--soft);font-size:12px;line-height:1.2}
.site-nav{margin-left:auto;display:flex;align-items:center;gap:6px}
.site-nav a{text-decoration:none;font-weight:600;font-size:14px;padding:8px 12px;border-radius:10px;color:var(--muted)}
.site-nav a:hover{background:#f5f5f4;color:var(--ink)}
.btn{white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--brand);color:#1c1917!important;font-weight:800;border-radius:11px;padding:10px 16px;text-decoration:none;font-size:14px}
.btn:hover{filter:brightness(.96)}
.page-header{padding:44px 0 24px}
.eyebrow{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--brand-ink);background:var(--brand-soft);padding:4px 10px;border-radius:999px;text-decoration:none}
h1{font-size:clamp(30px,4.4vw,46px);line-height:1.12;letter-spacing:-.02em;margin:14px 0 12px}
.lead{font-size:18px;color:var(--muted);max-width:680px;margin:0}
.chips{display:flex;gap:8px;overflow-x:auto;padding:4px 0 20px;scrollbar-width:none}
.chip{flex:none;text-decoration:none;font-size:14px;font-weight:600;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted)}
.chip[aria-current=page]{background:var(--ink);border-color:var(--ink);color:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;padding-bottom:36px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;text-decoration:none;transition:box-shadow .15s,transform .15s}
.card:hover{box-shadow:0 10px 30px rgba(28,25,23,.08);transform:translateY(-2px)}
.card img{aspect-ratio:16/9;object-fit:cover;width:100%;background:#f5f5f4}
.card-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:8px;flex:1}
.card h2,.card h3{font-size:18px;line-height:1.35;margin:0;letter-spacing:-.01em}
.card p{margin:0;color:var(--muted);font-size:15px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.meta{font-size:13px;color:var(--soft);display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.cat{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--brand-ink)}
.feature{display:grid;grid-template-columns:1.25fr 1fr;margin-bottom:26px}
.feature img{aspect-ratio:auto;height:100%;min-height:280px}
.feature .card-body{padding:28px;justify-content:center}.feature h2{font-size:26px}
.pager{display:flex;justify-content:center;gap:10px;padding:0 0 48px}
.empty{padding:40px;text-align:center;color:var(--muted);background:var(--surface);border:1px dashed var(--line);border-radius:var(--radius);margin-bottom:48px}
.crumbs{font-size:14px;color:var(--soft);display:flex;gap:6px;flex-wrap:wrap}.crumbs a{text-decoration:none;color:var(--muted)}.crumbs a:hover{text-decoration:underline}
.byline{display:flex;align-items:center;gap:12px;margin-top:20px}.byline img,.avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;background:var(--brand-soft);display:grid;place-items:center;font-weight:800;color:var(--brand-ink)}
.byline strong{display:block;font-size:15px}
.cover{margin:8px 0 34px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line)}
.cover img{width:100%;aspect-ratio:16/8;object-fit:cover}
.layout{display:grid;grid-template-columns:minmax(0,var(--read)) 260px;gap:56px;justify-content:center;padding-bottom:40px}
.toc{position:sticky;top:88px;align-self:start;font-size:14px;border-left:2px solid var(--line);padding-left:16px}
.toc strong{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);margin-bottom:8px}
.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:8px}.toc a{text-decoration:none;color:var(--muted)}.toc a:hover{color:var(--ink)}.toc .h3{padding-left:12px}
.prose{font-size:18px;line-height:1.75}
.prose h2{font-size:27px;line-height:1.25;letter-spacing:-.015em;margin:44px 0 12px;scroll-margin-top:84px}
.prose h3{font-size:21px;line-height:1.3;margin:30px 0 8px;scroll-margin-top:84px}.prose h4{font-size:18px;margin:24px 0 6px}
.prose p{margin:0 0 18px}.prose ul,.prose ol{margin:0 0 20px;padding-left:24px}.prose li{margin:6px 0}
.prose a{color:#92400e;text-decoration:underline;text-underline-offset:3px}
.prose blockquote{margin:24px 0;padding:14px 20px;border-left:4px solid var(--brand);background:var(--brand-soft);border-radius:0 10px 10px 0;color:#44403c}
.prose blockquote p:last-child{margin:0}
.prose hr{border:0;border-top:1px solid var(--line);margin:36px 0}
.prose code{background:#f5f5f4;padding:2px 6px;border-radius:6px;font-size:.9em}
.prose pre{background:#1c1917;color:#fafaf9;padding:16px;border-radius:10px;overflow:auto;font-size:14px}
.prose figure{margin:28px 0}.prose figure img{border-radius:10px}.prose figcaption{font-size:14px;color:var(--soft);margin-top:8px;text-align:center}
.table-wrap{overflow-x:auto;margin:0 0 22px;border:1px solid var(--line);border-radius:10px}
.prose table{border-collapse:collapse;width:100%;font-size:15px}.prose th,.prose td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.prose th{background:#f5f5f4;font-weight:700}
.video{position:relative;aspect-ratio:16/9;margin:28px 0;border-radius:10px;overflow:hidden;background:#000}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.section{margin-top:44px;padding-top:28px;border-top:1px solid var(--line)}
.section>h2{font-size:24px;margin:0 0 14px}
.faq details{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:14px 18px;margin-bottom:10px}
.faq summary{font-weight:700;cursor:pointer}.faq details p{margin:10px 0 0;color:var(--muted)}
.author-box{display:flex;gap:16px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.tags{display:flex;flex-wrap:wrap;gap:8px}.tags span{font-size:13px;background:#f5f5f4;border-radius:999px;padding:5px 12px;color:var(--muted)}
.cta{background:#1c1917;color:#fafaf9;border-radius:var(--radius);padding:28px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cta h2{margin:0 0 6px;font-size:22px}.cta p{margin:0;color:#d6d3d1}
.related{padding:12px 0 56px}.related>h2{font-size:24px;margin:0 0 18px}
.site-footer{border-top:1px solid var(--line);background:var(--surface);padding:28px 0;font-size:14px;color:var(--soft)}
.site-footer .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between}.site-footer a{color:var(--muted);text-decoration:none;margin-right:16px}
@media (max-width:960px){.grid{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:minmax(0,1fr)}.toc{display:none}.feature{grid-template-columns:1fr}.feature img{min-height:0;aspect-ratio:16/9}}
@media (max-width:640px){.wrap{padding:0 16px}.grid{grid-template-columns:1fr}.site-nav a:not(.btn){display:none}.brand small{display:none}.wide{display:none}.brand{font-size:15px}.page-header{padding:28px 0 16px}.prose{font-size:17px}.prose h2{font-size:23px}.cover img{aspect-ratio:16/9}}
`;

function document(opts: { title: string; description: string; canonical: string; image?: string; type?: 'website' | 'article'; jsonLd: unknown[]; body: string; robots?: string; extraHead?: string }) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta name="robots" content="${opts.robots || 'index,follow,max-image-preview:large'}">
<meta property="og:site_name" content="New Hope POS">
<meta property="og:locale" content="id_ID">
<meta property="og:type" content="${opts.type || 'website'}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta property="og:image" content="${esc(absolute(opts.image || DEFAULT_IMAGE))}">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${BLOG_NAME}" href="${siteUrl()}/rss.xml">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#F5B82E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
${opts.extraHead || ''}
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');</script>
${opts.jsonLd.map(item => `<script type="application/ld+json">${json(item)}</script>`).join('\n')}
<style>${STYLE}</style>
</head>
<body>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<a class="skip" href="#konten">Lewati ke konten</a>
<header class="site-header"><div class="wrap">
  <a class="brand" href="/blog"><span class="brand-mark" aria-hidden="true">NH</span><span>${BLOG_NAME}<small>Panduan usaha & kasir untuk UMKM</small></span></a>
  <nav class="site-nav" aria-label="Navigasi utama"><a href="/">Beranda</a><a href="/blog">Artikel</a><a href="/login">Masuk</a><a class="btn" href="/register">Coba gratis<span class="wide"> 45 hari</span></a></nav>
</div></header>
<main id="konten">${opts.body}</main>
<footer class="site-footer"><div class="wrap">
  <div><a href="/">New Hope POS</a><a href="/blog">Blog</a><a href="/rss.xml">RSS</a></div>
  <div>© ${new Date().getFullYear()} New Hope POS · Aplikasi kasir untuk UMKM Indonesia</div>
</div></footer>
</body>
</html>`;
}

function card(post: PublicPost, heading: 'h2' | 'h3' = 'h2', featured = false) {
  return `<a class="card${featured ? ' feature' : ''}" href="/blog/${esc(post.slug)}">
  <img src="${esc(image(post))}" alt="${esc(post.seo.coverAlt || post.title)}" loading="${featured ? 'eager' : 'lazy'}" decoding="async" width="640" height="360" onerror="this.onerror=null;this.src='${DEFAULT_IMAGE}'">
  <div class="card-body">
    <span class="cat">${esc(post.category)}</span>
    <${heading}>${esc(post.title)}</${heading}>
    <p>${esc(post.excerpt)}</p>
    <div class="meta"><time datetime="${esc(post.createdAt)}">${date(post.createdAt)}</time><span aria-hidden="true">·</span><span>${post.readingTimeMinutes} menit baca</span></div>
  </div>
</a>`;
}

export function renderBlogIndex(posts: PublicPost[], opts: { category?: string | null; page?: number } = {}): { status: number; html: string } {
  const category = opts.category ? categoryFromSlug(opts.category) : null;
  if (opts.category && !category) return { status: 404, html: renderNotFound() };
  const filtered = category ? posts.filter(p => p.category === category) : posts;
  const pages = Math.max(1, Math.ceil(filtered.length / BLOG_PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page || 1), pages);
  if ((opts.page || 1) > pages && filtered.length) return { status: 404, html: renderNotFound() };
  const slice = filtered.slice((page - 1) * BLOG_PAGE_SIZE, page * BLOG_PAGE_SIZE);
  const featured = page === 1 && !category ? slice[0] : undefined;
  const rest = featured ? slice.slice(1) : slice;
  const query = (p: number) => { const q = new URLSearchParams(); if (category) q.set('kategori', categorySlug(category)); if (p > 1) q.set('halaman', String(p)); const s = q.toString(); return '/blog' + (s ? '?' + s : ''); };
  const title = category ? `${category} — ${BLOG_NAME}` : `${BLOG_NAME}: Panduan Usaha, Kasir & Keuangan UMKM`;
  const description = category
    ? `Artikel ${category.toLowerCase()} untuk pemilik usaha: panduan praktis, contoh hitungan, dan tips operasional dari New Hope POS.`
    : 'Panduan praktis untuk pemilik kafe, laundry, ritel, carwash, dan barbershop: hitung HPP, kelola stok, kasir, dan keuangan usaha.';
  const chips = [`<a class="chip" href="/blog"${!category ? ' aria-current="page"' : ''}>Semua</a>`,
    ...BLOG_CATEGORIES.map(c => `<a class="chip" href="/blog?kategori=${categorySlug(c)}"${c === category ? ' aria-current="page"' : ''}>${esc(c)}</a>`)].join('');
  const body = `<div class="wrap">
  <header class="page-header">
    <span class="eyebrow">${category ? 'Kategori' : 'Blog'}</span>
    <h1>${esc(category || 'Panduan usaha & kasir untuk UMKM')}</h1>
    <p class="lead">${esc(description)}</p>
  </header>
  <nav class="chips" aria-label="Kategori">${chips}</nav>
  ${slice.length === 0 ? `<p class="empty">Belum ada artikel${category ? ' di kategori ini' : ''}.</p>` : ''}
  ${featured ? card(featured, 'h2', true) : ''}
  ${rest.length ? `<section class="grid" aria-label="Daftar artikel">${rest.map(p => card(p)).join('')}</section>` : ''}
  ${pages > 1 ? `<nav class="pager" aria-label="Halaman">${page > 1 ? `<a class="chip" rel="prev" href="${query(page - 1)}">← Sebelumnya</a>` : ''}<span class="chip" aria-current="page">Halaman ${page} dari ${pages}</span>${page < pages ? `<a class="chip" rel="next" href="${query(page + 1)}">Berikutnya →</a>` : ''}</nav>` : ''}
</div>`;
  const canonical = siteUrl() + query(page);
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'Blog', name: BLOG_NAME, url: `${siteUrl()}/blog`, description, publisher: { '@type': 'Organization', name: 'New Hope POS', url: siteUrl() },
      blogPost: slice.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: postUrl(p.slug), datePublished: p.createdAt, dateModified: p.updatedAt, image: absolute(image(p)) })) },
    breadcrumbs([{ name: 'Beranda', url: siteUrl() + '/' }, { name: 'Blog', url: `${siteUrl()}/blog` }, ...(category ? [{ name: category, url: canonical }] : [])]),
  ];
  return { status: 200, html: document({ title, description, canonical, jsonLd, body, extraHead: [page > 1 ? `<link rel="prev" href="${siteUrl() + query(page - 1)}">` : '', page < pages ? `<link rel="next" href="${siteUrl() + query(page + 1)}">` : ''].join('') }) };
}

/** Older metadata carried brand suffixes ("| Blog Harapan Baru"); the page adds exactly one. */
export const cleanTitle = (value: string) => value.replace(/\s*[|–—-]\s*(blog\s+harapan\s+baru|warta\s+harapan\s+baru|blog\s+new\s+hope(\s+pos)?|new\s+hope\s+pos)\b.*$/i, '').trim();

const breadcrumbs = (items: Array<{ name: string; url: string }>) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: item.url })) });

function youtubeId(url = '') {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}

export function renderBlogPost(post: PublicPost, related: PublicPost[]): string {
  const article = renderArticle(post.content, post.title);
  const canonical = postUrl(post.slug);
  const title = `${cleanTitle(post.seo.metaTitle || '') || post.title} | ${BLOG_NAME}`;
  const description = post.seo.metaDescription || post.excerpt;
  const faq = (post.seo.faq || []).filter(f => f?.question && f?.answer);
  const toc = article.headings.length >= 3 ? `<aside class="toc" aria-label="Daftar isi"><strong>Daftar isi</strong><ol>${article.headings.map(h => `<li class="h${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}${faq.length ? '<li class="h2"><a href="#faq">Pertanyaan umum</a></li>' : ''}</ol></aside>` : '<aside></aside>';
  const videos = post.mediaEmbeds.map(e => ({ id: youtubeId(e.url), caption: e.caption })).filter(v => v.id)
    .map(v => `<figure><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${v.id}" title="${esc(v.caption || post.title)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ''}</figure>`).join('');
  const initials = post.author.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatar = post.author.avatar ? `<img src="${esc(post.author.avatar)}" alt="" width="44" height="44" loading="lazy">` : `<span class="avatar" aria-hidden="true">${esc(initials)}</span>`;
  const updated = post.updatedAt && new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 86_400_000;
  const body = `<article>
  <div class="wrap">
    <header class="page-header" style="max-width:860px">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/blog">Blog</a><span aria-hidden="true">›</span><a href="/blog?kategori=${categorySlug(post.category)}">${esc(post.category)}</a></nav>
      <h1>${esc(post.title)}</h1>
      <p class="lead">${esc(post.excerpt)}</p>
      <div class="byline">${avatar}<div><strong>${esc(post.author.name)}</strong><span class="meta">${esc(post.author.role)} · <time datetime="${esc(post.createdAt)}">${date(post.createdAt)}</time>${updated ? ` · diperbarui <time datetime="${esc(post.updatedAt)}">${date(post.updatedAt)}</time>` : ''} · ${post.readingTimeMinutes} menit baca</span></div></div>
    </header>
    ${post.coverImage ? `<figure class="cover"><img src="${esc(post.coverImage)}" alt="${esc(post.seo.coverAlt || post.title)}" width="1200" height="600" fetchpriority="high" onerror="this.onerror=null;this.src='${DEFAULT_IMAGE}'"></figure>` : ''}
    <div class="layout">
      <div>
        <div class="prose">${article.html}${videos}</div>
        ${faq.length ? `<section class="section faq" id="faq"><h2>Pertanyaan umum</h2>${faq.map(f => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</section>` : ''}
        ${post.tags.length ? `<div class="section tags" aria-label="Tag">${post.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        <section class="section"><div class="author-box">${avatar}<div><strong>${esc(post.author.name)}</strong><div class="meta">${esc(post.author.role)}</div><p style="margin:8px 0 0;color:var(--muted)">Ditulis untuk ${BLOG_NAME}. Punya pertanyaan tentang usaha Anda? Coba New Hope POS gratis dan hubungi tim kami.</p></div></div></section>
        <section class="section"><div class="cta"><div><h2>Rapikan kasir dan laporan usaha Anda</h2><p>Coba New Hope POS gratis 45 hari, tanpa kartu kredit.</p></div><a class="btn" href="/register">Mulai gratis</a></div></section>
      </div>
      ${toc}
    </div>
  </div>
</article>
${related.length ? `<section class="related"><div class="wrap"><h2>Artikel terkait</h2><div class="grid">${related.map(p => card(p, 'h3')).join('')}</div></div></section>` : ''}`;
  const jsonLd: unknown[] = [
    { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description, image: [absolute(image(post))],
      datePublished: post.createdAt, dateModified: post.updatedAt, inLanguage: 'id-ID', mainEntityOfPage: canonical,
      articleSection: post.category, keywords: (post.seo.metaKeywords || post.tags).join(', '), wordCount: article.words,
      author: { '@type': 'Person', name: post.author.name, jobTitle: post.author.role },
      publisher: { '@type': 'Organization', name: 'New Hope POS', url: siteUrl(), logo: { '@type': 'ImageObject', url: `${siteUrl()}/favicon.svg` } } },
    breadcrumbs([{ name: 'Beranda', url: siteUrl() + '/' }, { name: 'Blog', url: `${siteUrl()}/blog` }, { name: post.category, url: `${siteUrl()}/blog?kategori=${categorySlug(post.category)}` }, { name: post.title, url: canonical }]),
  ];
  if (faq.length) jsonLd.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) });
  return document({ title, description, canonical, image: image(post), type: 'article', jsonLd, body,
    extraHead: `<meta property="article:published_time" content="${esc(post.createdAt)}"><meta property="article:modified_time" content="${esc(post.updatedAt)}"><meta property="article:section" content="${esc(post.category)}">` });
}

export function renderNotFound(): string {
  return document({ title: `Artikel tidak ditemukan | ${BLOG_NAME}`, description: 'Halaman yang Anda cari tidak ada.', canonical: `${siteUrl()}/blog`, robots: 'noindex,follow', jsonLd: [],
    body: `<div class="wrap"><header class="page-header"><span class="eyebrow">404</span><h1>Artikel tidak ditemukan</h1><p class="lead">Artikel mungkin sudah dipindahkan atau belum diterbitkan.</p><p><a class="btn" href="/blog">Lihat semua artikel</a></p></header></div>` });
}

export function renderSitemap(posts: PublicPost[]): string {
  const base = siteUrl();
  const latest = posts.reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), '2026-10-01T00:00:00.000Z');
  const urls = [
    { loc: `${base}/`, lastmod: latest, priority: '1.0' },
    { loc: `${base}/blog`, lastmod: latest, priority: '0.9' },
    ...BLOG_CATEGORIES.filter(c => posts.some(p => p.category === c)).map(c => ({ loc: `${base}/blog?kategori=${categorySlug(c)}`, lastmod: latest, priority: '0.6' })),
    ...posts.map(p => ({ loc: postUrl(p.slug), lastmod: p.updatedAt, priority: '0.8', image: p.coverImage })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod.slice(0, 10)}</lastmod><priority>${u.priority}</priority>${'image' in u && u.image ? `<image:image><image:loc>${esc(absolute(String(u.image)))}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>`;
}

export function renderRss(posts: PublicPost[]): string {
  const base = siteUrl();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${BLOG_NAME}</title><link>${base}/blog</link><description>Panduan usaha, kasir, dan keuangan untuk UMKM Indonesia.</description><language>id</language>
<atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>
${posts.slice(0, 30).map(p => `<item><title>${esc(p.title)}</title><link>${postUrl(p.slug)}</link><guid isPermaLink="true">${postUrl(p.slug)}</guid><pubDate>${new Date(p.createdAt).toUTCString()}</pubDate><category>${esc(p.category)}</category><description>${esc(p.excerpt)}</description></item>`).join('\n')}
</channel></rss>`;
}
