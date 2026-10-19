import { blogViewTrackingEnabled } from '../../services/shared/blogAnalytics';
/**
 * Public blog pages and the article automation surface.
 *
 *   GET  /blog, /blog/:slug, /sitemap.xml, /rss.xml          server-rendered, cacheable
 *   /api/v1/blog-automation/*                                REST for scripts/n8n/Zapier
 *   POST /api/v1/blog-automation/mcp                         MCP (JSON-RPC over HTTP)
 *
 * Automation authenticates with an API key from BLOG_API_KEYS (comma-separated),
 * never with a user session. Without the variable the surface answers 503.
 * Every write goes through checkArticle(): structure, length, metadata and
 * product-claim rules. Articles that pass are published immediately unless the
 * caller sends publish:false. Deleting only unpublishes.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type express from 'express';
import type { Db } from '../../services/shared/db';
import { ARTICLE_RULES, checkArticle, type ArticleInput, type ArticleRecord } from '../lib/blog/articleInput';
import { BLOG_CATEGORIES, categoryFromSlug } from '../lib/blog/categories';
import { generatedBlogCover } from '../lib/blog/covers';
import { BLOG_INDEXNOW_KEY, BLOG_INDEXNOW_PATH, notifyBlogDiscovery } from './blogDiscovery';
import { CoverError, createCoverImporter } from './blogCover';
import { BLOG_PAGE_SIZE, renderBlogIndex, renderBlogPost, renderNotFound, renderRss, renderSitemap, siteUrl, type PublicPost } from './blogPages';

const COLUMNS = `id, slug, title, excerpt, content, category, cover_image, author_name, author_role, author_avatar,
  reading_time_minutes, tags, media_embeds, seo, is_published, is_featured, created_at, updated_at`;
const PAGE_CACHE = 'public, max-age=0, s-maxage=60, must-revalidate';

const parseJson = (value: unknown, fallback: any) => {
  if (value && typeof value === 'object') return value;
  try { return typeof value === 'string' ? JSON.parse(value) : fallback; } catch { return fallback; }
};
export function rowToPublicPost(r: any): PublicPost & { isPublished: boolean } {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : new Date(0).toISOString());
  return {
    id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt || '', content: r.content || '', category: r.category,
    coverImage: r.cover_image || '', author: { name: r.author_name || 'Tim Editorial New Hope POS', role: r.author_role || 'Editor', avatar: r.author_avatar || '' },
    readingTimeMinutes: Number(r.reading_time_minutes || 5), tags: Array.isArray(r.tags) ? r.tags : [], isFeatured: Boolean(r.is_featured),
    mediaEmbeds: parseJson(r.media_embeds, []), seo: parseJson(r.seo, {}), isPublished: Boolean(r.is_published),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

const isMissingStore = (error: unknown) => ['42P01', '42501'].includes(String((error as { code?: string })?.code));

async function publishedPosts(db: Db): Promise<PublicPost[]> {
  const { rows } = await db.query(`SELECT id, slug, title, excerpt, category, cover_image, author_name, reading_time_minutes, created_at, updated_at FROM public.blog_posts WHERE is_published = true ORDER BY created_at DESC, id DESC`);
  return rows.map(rowToPublicPost);
}

export function registerBlogRoutes(app: express.Express, getDb: () => Promise<Db>, coverImporter = createCoverImporter()): void {
  const page = (fn: (req: express.Request, res: express.Response, db: Db) => Promise<unknown>) =>
    async (req: express.Request, res: express.Response) => {
      try { await fn(req, res, await getDb()); }
      catch (error) {
        console.error(`[blog] ${req.method} ${req.path}:`, (error as Error).message, (error as { code?: string }).code ?? '');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Retry-After', '300');
        res.status(503).type('html').send(renderNotFound().replace('Artikel tidak ditemukan', 'Blog sedang tidak tersedia'));
      }
    };

  app.get('/blog', page(async (req, res, db) => {
    const scalar = (value: unknown) => value === undefined || typeof value === 'string';
    const rawPage = String(req.query.halaman || '1'), categorySlug = String(req.query.kategori || '');
    const pageNumber = Number(rawPage), category = categorySlug ? categoryFromSlug(categorySlug) : null;
    if (!['halaman','kategori','q','urut'].every(k => scalar(req.query[k])) || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(pageNumber) || (categorySlug && !category)) {
      res.setHeader('Cache-Control', 'no-store'); return res.status(404).type('html').send(renderNotFound());
    }
    const search = String(req.query.q || '').trim().slice(0,120);
    const sort = req.query.urut === 'terlama' ? 'terlama' : 'terbaru';
    // Parameters prevent injection; escape LIKE wildcards so a search is literal.
    const pattern = search ? '%' + search.replace(/[\\%_]/g, '\\$&') + '%' : null;
    const where = `is_published = true AND ($1::text IS NULL OR category = $1)
      AND ($2::text IS NULL OR title ILIKE $2 OR excerpt ILIKE $2 OR array_to_string(tags, ' ') ILIKE $2)`;
    const params = [category, pattern];
    const total = Number((await db.query(`SELECT count(*)::int n FROM public.blog_posts WHERE ${where}`, params)).rows[0].n);
    if (pageNumber > Math.max(1, Math.ceil(total / BLOG_PAGE_SIZE))) {
      res.setHeader('Cache-Control', 'no-store'); return res.status(404).type('html').send(renderNotFound());
    }
    const direction = sort === 'terlama' ? 'ASC' : 'DESC'; // whitelist, never query text
    const rows = (await db.query(`SELECT ${COLUMNS.replace('content, ', '')} FROM public.blog_posts WHERE ${where}
      ORDER BY created_at ${direction}, id ${direction} LIMIT $3 OFFSET $4`, [...params, BLOG_PAGE_SIZE, (pageNumber-1)*BLOG_PAGE_SIZE])).rows;
    const result = renderBlogIndex(rows.map(rowToPublicPost), { category: categorySlug, page: pageNumber, search, sort, total });
    // Publication must appear on the index immediately, not after a day of SWR.
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status).type('html').send(result.html);
  }));

  app.get(BLOG_INDEXNOW_PATH, (_req, res) => { res.type('text/plain').send(BLOG_INDEXNOW_KEY); });

  app.get(['/sitemap.xml', '/blog/sitemap.xml'], page(async (req, res, db) => {
    const posts = await publishedPosts(db);
    res.setHeader('Cache-Control', PAGE_CACHE);
    res.type('application/xml').send(renderSitemap(posts, req.path === '/blog/sitemap.xml'));
  }));

  app.get('/blog/:slug', page(async (req, res, db) => {
    const slug = String(req.params.slug).toLowerCase();
    if (slug !== req.params.slug) return res.redirect(301, `/blog/${slug}`);
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM public.blog_posts WHERE slug = $1 AND is_published = true`, [slug]);
    if (!rows.length) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).type('html').send(renderNotFound()); }
    const post = rowToPublicPost(rows[0]);
    const related = (await db.query(`SELECT ${COLUMNS} FROM public.blog_posts WHERE is_published = true AND slug <> $1
      ORDER BY (category = $2) DESC, created_at DESC LIMIT 3`, [slug, post.category])).rows.map(rowToPublicPost);
    if (req.method !== 'HEAD' && blogViewTrackingEnabled()) void db.query('UPDATE public.blog_posts SET view_count = view_count + 1 WHERE id = $1', [post.id]).catch(() => {});
    res.setHeader('Cache-Control', PAGE_CACHE);
    res.type('html').send(renderBlogPost(post, related));
  }));

  app.get('/rss.xml', page(async (_req, res, db) => {
    res.setHeader('Cache-Control', PAGE_CACHE);
    res.type('application/rss+xml').send(renderRss(await publishedPosts(db)));
  }));

  registerBlogAutomation(app, getDb, coverImporter);
}

/* -------------------------------------------------------------------------- */
/* Automation: REST + MCP                                                      */
/* -------------------------------------------------------------------------- */

export class BlogApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) { super(code); }
}

const digest = (value: string) => createHash('sha256').update(value).digest();
function apiKeyValid(req: express.Request): boolean {
  // Legacy Make publisher keys and a separately rotatable n8n key.
  // Keep existing Make credentials valid when introducing the n8n integration.
  const configured = [
    ...String(process.env.BLOG_API_KEYS || '').split(','),
    String(process.env.BLOG_N8N_API_KEY || ''),
  ].map(k => k.trim()).filter(k => k.length >= 24);
  if (!configured.length) throw new BlogApiError(503, 'BLOG_API_NOT_CONFIGURED');
  const header = String(req.headers.authorization || '');
  const presented = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || String(req.headers['x-api-key'] || '').trim();
  if (!presented) return false;
  const given = digest(presented);
  return configured.some(key => timingSafeEqual(digest(key), given));
}

const writeWindow = new Map<string, { count: number; resetAt: number }>();
export const BLOG_WRITES_PER_HOUR = 120;
function allowWrite(req: express.Request) {
  const key = createHash('sha256').update(String(req.headers.authorization || req.headers['x-api-key'] || '')).digest('hex').slice(0, 16);
  const now = Date.now(), entry = writeWindow.get(key);
  if (!entry || entry.resetAt < now) { writeWindow.set(key, { count: 1, resetAt: now + 3_600_000 }); return; }
  if (++entry.count > BLOG_WRITES_PER_HOUR) throw new BlogApiError(429, 'BLOG_WRITE_RATE_LIMITED');
}

const summary = (p: ReturnType<typeof rowToPublicPost>) => ({
  slug: p.slug, title: p.title, category: p.category, excerpt: p.excerpt, coverImage: p.coverImage, isPublished: p.isPublished, isFeatured: p.isFeatured,
  url: `${siteUrl()}/blog/${p.slug}`, readingTimeMinutes: p.readingTimeMinutes, createdAt: p.createdAt, updatedAt: p.updatedAt,
});
const full = (p: ReturnType<typeof rowToPublicPost>) => ({ ...summary(p), content: p.content, tags: p.tags, coverImage: p.coverImage, author: p.author, seo: p.seo });

export function createBlogAutomation(getDb: () => Promise<Db>) {
  async function listPosts(args: { status?: string; limit?: number; offset?: number; category?: string }) {
    const db = await getDb();
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200), offset = Math.max(Number(args.offset) || 0, 0);
    const status = args.status === 'draft' ? false : args.status === 'all' ? null : true;
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM public.blog_posts
      WHERE ($1::boolean IS NULL OR is_published = $1) AND ($2::text IS NULL OR category = $2)
      ORDER BY created_at DESC LIMIT $3 OFFSET $4`, [status, args.category || null, limit, offset]);
    return { posts: rows.map(rowToPublicPost).map(summary), limit, offset };
  }

  async function getPost(slug: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM public.blog_posts WHERE slug = $1`, [String(slug || '')]);
    if (!rows.length) throw new BlogApiError(404, 'POST_NOT_FOUND');
    return { post: full(rowToPublicPost(rows[0])) };
  }

  function validate(input: ArticleInput) {
    const check = checkArticle(input);
    return { ok: check.ok, errors: check.errors, warnings: check.warnings, stats: check.stats, slug: check.record?.slug };
  }

  async function save(input: ArticleInput, mode: 'create' | 'update', pathSlug?: string) {
    const check = checkArticle(mode === 'update' ? { ...input, slug: input.slug ?? pathSlug } : input);
    if (!check.ok || !check.record) throw new BlogApiError(422, 'ARTICLE_REJECTED', { errors: check.errors, warnings: check.warnings, stats: check.stats });
    const record: ArticleRecord = check.record;
    const db = await getDb();
    const changedSlugs: string[] = [];
    const result = await db.tx(async c => {
      const existing = mode === 'update'
        ? (await c.query('SELECT id, seo, slug, is_published FROM public.blog_posts WHERE slug = $1 FOR UPDATE', [pathSlug])).rows[0]
        : undefined;
      if (mode === 'update' && !existing) throw new BlogApiError(404, 'POST_NOT_FOUND');
      const clash = (await c.query(`SELECT slug FROM public.blog_posts WHERE (slug = $1 OR lower(title) = lower($2)) AND ($3::text IS NULL OR id <> $3) LIMIT 1`,
        [record.slug, record.title, existing?.id ?? null])).rows[0];
      if (clash) throw new BlogApiError(409, clash.slug === record.slug ? 'SLUG_ALREADY_EXISTS' : 'TITLE_ALREADY_EXISTS', { slug: clash.slug });
      if (!record.coverImage) {
        record.coverImage = siteUrl() + generatedBlogCover(record.title);
        record.seo.coverGenerated = true;
        record.seo.coverAlt = 'Ilustrasi AI: ' + record.title;
      } else record.seo.coverGenerated = record.seo.coverGenerated === true || /\/blog\/covers\/(hpp-ingredients|cash-reconciliation)-ai\.jpg$/.test(record.coverImage) || /\/blog-media\/automation\/generated\//.test(record.coverImage);
      const seo = { ...parseJson(existing?.seo, {}), ...record.seo, canonicalUrl: `${siteUrl()}/blog/${record.slug}`, ogImage: record.coverImage, source: 'automation' };
      const values = [record.slug, record.title, record.excerpt, record.content, record.category, record.coverImage || null,
        record.author.name, record.author.role, record.author.avatar || null, record.readingTimeMinutes, record.tags,
        JSON.stringify(seo), record.isPublished, record.isFeatured];
      const { rows } = existing
        ? await c.query(`UPDATE public.blog_posts SET slug=$1,title=$2,excerpt=$3,content=$4,category=$5,cover_image=$6,author_name=$7,author_role=$8,
            author_avatar=$9,reading_time_minutes=$10,tags=$11,seo=$12::jsonb,is_published=$13,is_featured=$14,updated_at=CURRENT_TIMESTAMP
            WHERE id=$15 RETURNING ${COLUMNS}`, [...values, existing.id])
        : await c.query(`INSERT INTO public.blog_posts (id,slug,title,excerpt,content,category,cover_image,author_name,author_role,author_avatar,
            reading_time_minutes,tags,seo,is_published,is_featured,media_embeds) VALUES ($15,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,'[]'::jsonb)
            RETURNING ${COLUMNS}`, [...values, 'blog-' + randomUUID()]);
      if (existing?.is_published) changedSlugs.push(existing.slug);
      if (record.isPublished) changedSlugs.push(record.slug);
      console.info('[blog-automation]', existing ? 'UPDATED' : 'CREATED', record.slug, record.isPublished ? 'published' : 'draft');
      return { post: summary(rowToPublicPost(rows[0])), warnings: check.warnings, stats: check.stats };
    });
    await notifyBlogDiscovery(changedSlugs);
    return result;
  }

  async function unpublish(slug: string) {
    const db = await getDb();
    const { rows } = await db.query(`UPDATE public.blog_posts SET is_published = false, updated_at = CURRENT_TIMESTAMP WHERE slug = $1 RETURNING ${COLUMNS}`, [String(slug || '')]);
    if (!rows.length) throw new BlogApiError(404, 'POST_NOT_FOUND');
    await notifyBlogDiscovery([rows[0].slug]);
    return { post: summary(rowToPublicPost(rows[0])) };
  }

  const guide = () => ({
    categories: BLOG_CATEGORIES, rules: ARTICLE_RULES,
    format: {
      content: 'Markdown. Jangan tulis judul (# ...) di content; judul memakai field title. Struktur: paragraf pembuka → beberapa bagian ## (H2) dengan ### (H3) bila perlu → penutup. Gunakan daftar, tabel, dan > kutipan untuk poin penting.',
      required: ['title', 'excerpt', 'content', 'category'],
      optional: ['slug', 'tags', 'coverImage (kosong: ilustrasi AI dari pustaka sampul)', 'coverAlt', 'author{name,role,avatar}', 'seo{metaTitle,metaDescription,focusKeyword,keywords[]}', 'faq[{question,answer}]', 'sources[{title,url,publisher,publishedAt}]', 'sourceRequired + sourceFeed (wajib untuk automation berita)', 'isFeatured', 'publish (default true)'],
    },
  });

  return { listPosts, getPost, validate, create: (input: ArticleInput) => save(input, 'create'), update: (slug: string, input: ArticleInput) => save(input, 'update', slug), unpublish, guide };
}

const ARTICLE_SCHEMA = {
  type: 'object', required: ['title', 'excerpt', 'content', 'category'],
  properties: {
    title: { type: 'string', description: `${ARTICLE_RULES.title[0]}–${ARTICLE_RULES.title[1]} karakter` },
    slug: { type: 'string', description: 'Opsional; dibuat dari title bila kosong' },
    excerpt: { type: 'string', description: `Ringkasan ${ARTICLE_RULES.excerpt[0]}–${ARTICLE_RULES.excerpt[1]} karakter (tampil di bawah judul)` },
    content: { type: 'string', description: `Markdown tanpa H1, minimal ${ARTICLE_RULES.minWords} kata dan ${ARTICLE_RULES.minH2} subjudul ##` },
    category: { type: 'string', enum: [...BLOG_CATEGORIES] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: ARTICLE_RULES.maxTags },
    coverImage: { type: 'string', description: 'URL https gambar sampul (1200×600 disarankan)' },
    coverAlt: { type: 'string' },
    coverGenerated: { type: 'boolean', description: 'True bila sampul merupakan ilustrasi AI, bukan foto berita.' },
    sources: { type: 'array', maxItems: 5, items: { type: 'object', required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' }, publisher: { type: 'string' }, publishedAt: { type: 'string' } } } },
    sourceRequired: { type: 'boolean', description: 'Artikel berita: true, wajib sumber cocok dengan sourceFeed.' },
    sourceFeed: { type: 'string', description: 'Feed RSS yang diamati automation; untuk validasi saja, tidak disimpan.' },
    author: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, avatar: { type: 'string' } } },
    seo: { type: 'object', properties: { metaTitle: { type: 'string' }, metaDescription: { type: 'string' }, focusKeyword: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } } },
    faq: { type: 'array', maxItems: ARTICLE_RULES.maxFaq, items: { type: 'object', required: ['question', 'answer'], properties: { question: { type: 'string' }, answer: { type: 'string' } } } },
    isFeatured: { type: 'boolean' },
    publish: { type: 'boolean', description: 'Default true: langsung terbit bila lolos validasi' },
  },
} as const;

export const BLOG_MCP_TOOLS = [
  { name: 'blog_guide', description: 'Kategori, aturan kualitas, dan format penulisan artikel. Panggil sebelum menulis.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_posts', description: 'Daftar artikel (judul, slug, URL, status).', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['published', 'draft', 'all'] }, category: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' } } } },
  { name: 'get_post', description: 'Isi lengkap satu artikel berdasarkan slug.', inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } } },
  { name: 'validate_article', description: 'Cek artikel tanpa menyimpan: error yang memblokir, peringatan SEO, jumlah kata/subjudul.', inputSchema: ARTICLE_SCHEMA },
  { name: 'create_post', description: 'Buat artikel baru. Langsung terbit bila lolos validasi (kecuali publish:false).', inputSchema: ARTICLE_SCHEMA },
  { name: 'update_post', description: 'Perbarui artikel berdasarkan slug (seluruh field dikirim ulang).', inputSchema: { ...ARTICLE_SCHEMA, required: ['slug', ...ARTICLE_SCHEMA.required] } },
  { name: 'unpublish_post', description: 'Tarik artikel dari publik (tidak menghapus data).', inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } } },
] as const;

function registerBlogAutomation(app: express.Express, getDb: () => Promise<Db>, importCover: ReturnType<typeof createCoverImporter>) {
  const blog = createBlogAutomation(getDb);
  const api = (write: boolean, fn: (req: express.Request) => Promise<unknown> | unknown, status = 200) =>
    async (req: express.Request, res: express.Response) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (!apiKeyValid(req)) return res.status(401).json({ ok: false, error: 'INVALID_API_KEY' });
        if (write) allowWrite(req);
        res.status(status).json({ ok: true, ...(await fn(req) as object) });
      } catch (error) {
        if (error instanceof CoverError) return res.status(error.status).json({ ok: false, error: error.code });
        if (error instanceof BlogApiError) return res.status(error.status).json({ ok: false, error: error.code, ...(error.details ? { details: error.details } : {}) });
        console.error('[blog-automation]', req.method, req.path, (error as Error).message, (error as { code?: string }).code ?? '');
        res.status(isMissingStore(error) ? 503 : 500).json({ ok: false, error: isMissingStore(error) ? 'BLOG_STORE_UNAVAILABLE' : 'INTERNAL_ERROR' });
      }
    };
  const base = '/api/v1/blog-automation';
  app.get(`${base}/guide`, api(false, () => blog.guide()));
  app.get(`${base}/posts`, api(false, req => blog.listPosts(req.query as any)));
  app.get(`${base}/posts/:slug`, api(false, req => blog.getPost(String(req.params.slug))));
  app.post(`${base}/validate`, api(false, req => blog.validate(req.body || {})));
  app.post(`${base}/covers`, api(true, async req => {
    const input = req.body || {};
    const repairing = input.slug !== undefined;
    // Compare before uploading and atomically before updating: a later manual
    // editorial change wins over this maintenance job.
    const db = repairing ? await getDb() : null;
    if (repairing && (typeof input.slug !== 'string' || typeof input.expectedCover !== 'string' ||
      !/\/blog\/covers\/(hpp-ingredients|cash-reconciliation)-ai\.jpg$/.test(input.expectedCover))) throw new BlogApiError(400, 'INVALID_COVER_REPAIR');
    if (db && !(await db.query('SELECT id FROM public.blog_posts WHERE slug=$1 AND cover_image=$2', [input.slug,input.expectedCover])).rows.length) throw new BlogApiError(409, 'COVER_CHANGED');
    const cover = await importCover(input);
    if (db) {
      const { rows } = await db.query(`UPDATE public.blog_posts SET cover_image=$1,
        seo=COALESCE(seo,'{}'::jsonb) || $2::jsonb, updated_at=CURRENT_TIMESTAMP
        WHERE slug=$3 AND cover_image=$4 RETURNING slug`, [cover.coverImage,JSON.stringify({ ...cover, ogImage: cover.coverImage }),input.slug,input.expectedCover]);
      if (!rows.length) throw new BlogApiError(409, 'COVER_CHANGED');
    }
    return { ...cover, ...(repairing ? { repairedSlug: input.slug } : {}) };
  }, 201));
  app.post(`${base}/posts`, api(true, req => blog.create(req.body || {}), 201));
  app.put(`${base}/posts/:slug`, api(true, req => blog.update(String(req.params.slug), req.body || {})));
  app.delete(`${base}/posts/:slug`, api(true, req => blog.unpublish(String(req.params.slug))));

  // MCP over HTTP (JSON-RPC 2.0, single request per POST). Clients: Claude, n8n MCP node, custom agents.
  app.post(`${base}/mcp`, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body || {};
    const id = body.id ?? null;
    const reply = (payload: object) => res.json({ jsonrpc: '2.0', id, ...payload });
    try {
      if (!apiKeyValid(req)) return res.status(401).json({ jsonrpc: '2.0', id, error: { code: -32001, message: 'INVALID_API_KEY' } });
    } catch (error) {
      return res.status(503).json({ jsonrpc: '2.0', id, error: { code: -32002, message: (error as Error).message } });
    }
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } });
    if (body.method.startsWith('notifications/')) return res.status(202).end();
    if (body.method === 'initialize') return reply({ result: { protocolVersion: String(body.params?.protocolVersion || '2025-06-18'), capabilities: { tools: {} }, serverInfo: { name: 'newhope-blog', version: '1.0.0' },
      instructions: 'Tulis artikel bahasa Indonesia untuk pemilik UMKM. Panggil blog_guide dulu, lalu validate_article, lalu create_post. Jangan menulis klaim fitur yang tidak ada.' } });
    if (body.method === 'ping') return reply({ result: {} });
    if (body.method === 'tools/list') return reply({ result: { tools: BLOG_MCP_TOOLS } });
    if (body.method !== 'tools/call') return reply({ error: { code: -32601, message: 'Method not found' } });
    const name = String(body.params?.name || ''), args = (body.params?.arguments || {}) as Record<string, any>;
    try {
      const write = ['create_post', 'update_post', 'unpublish_post'].includes(name);
      if (write) allowWrite(req);
      const result = name === 'blog_guide' ? blog.guide()
        : name === 'list_posts' ? await blog.listPosts(args)
        : name === 'get_post' ? await blog.getPost(args.slug)
        : name === 'validate_article' ? blog.validate(args)
        : name === 'create_post' ? await blog.create(args)
        : name === 'update_post' ? await blog.update(String(args.slug || ''), args)
        : name === 'unpublish_post' ? await blog.unpublish(args.slug)
        : undefined;
      if (result === undefined) return reply({ error: { code: -32602, message: `Unknown tool: ${name}` } });
      reply({ result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result } });
    } catch (error) {
      const message = error instanceof BlogApiError ? JSON.stringify({ error: error.code, ...(error.details ? { details: error.details } : {}) }, null, 2) : 'INTERNAL_ERROR';
      if (!(error instanceof BlogApiError)) console.error('[blog-mcp]', name, (error as Error).message);
      reply({ result: { content: [{ type: 'text', text: message }], isError: true } });
    }
  });
}
