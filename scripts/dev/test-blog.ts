// Server-rendered blog, article rules, automation API and MCP. Isolated PGlite; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import type { Db } from '../../services/shared/db';
import { registerBlogRoutes } from '../../src/server/blogRoutes';
import { renderArticle } from '../../src/lib/blog/markdown';
import { checkArticle } from '../../src/lib/blog/articleInput';
import { isPublicApi } from '../../api/_runtime';

const pg = new PGlite();
const wrap = (runner: any): Db => ({ query: async (sql, params) => { const r = await runner.query(sql, params); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; },
  exec: async sql => { await runner.exec(sql); }, tx: async fn => pg.transaction(c => fn(wrap(c))), close: () => pg.close() });
const db = wrap(pg);
for (const file of ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql', ...fs.readdirSync('migrations').filter(f => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql').sort().map(f => 'migrations/' + f)])
  await pg.exec(fs.readFileSync(file, 'utf8'));
await pg.exec(fs.readFileSync('supabase/migrations/20261005090000_blog_posts_store.sql', 'utf8')); // idempotent on top of 0057

const KEY = 'test-blog-key-0123456789abcdef';
process.env.PUBLIC_SITE_URL = 'https://kasir.example';
const app = express(); app.use(express.json());
registerBlogRoutes(app, async () => db);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const get = async (path: string) => { const r = await fetch(base + path, { redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', text: await r.text() }; };
const call = async (method: string, path: string, body?: unknown, key: string | null = KEY) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: r.status === 202 ? null : await r.json() as any };
};
const paragraph = (topic: string) => `${topic} membantu pemilik usaha melihat angka harian dengan jelas. Catat setiap transaksi, bandingkan dengan stok fisik, lalu tinjau selisihnya setiap akhir shift supaya kebocoran cepat terlihat dan bisa diperbaiki sebelum menjadi kerugian besar bagi usaha kecil yang sedang tumbuh.`;
const body = ['Pembukaan singkat tentang pentingnya pencatatan.', '## Mengapa pencatatan harian penting', ...Array(6).fill(paragraph('Pencatatan harian')),
  '## Langkah menghitung HPP', '- Catat bahan baku\n- Hitung per porsi\n- Bandingkan dengan harga jual', ...Array(6).fill(paragraph('Menghitung HPP')),
  '## Kesalahan yang sering terjadi', '| Kesalahan | Akibat |\n|---|---|\n| Tidak mencatat retur | Stok selisih |', ...Array(6).fill(paragraph('Menghindari kesalahan'))].join('\n\n');
const article = (over: Record<string, unknown> = {}) => ({ title: 'Cara Menghitung HPP Kopi Susu untuk Kedai Kecil', excerpt: 'Panduan langkah demi langkah menghitung HPP kopi susu per gelas, lengkap dengan contoh tabel dan kesalahan yang sering terjadi di kedai kecil.',
  content: '# Cara Menghitung HPP Kopi Susu untuk Kedai Kecil\n\n' + body, category: 'Kuliner & F&B', tags: ['HPP', 'Kedai Kopi'], coverImage: 'https://images.example/kopi.jpg',
  seo: { focusKeyword: 'HPP' }, faq: [{ question: 'Berapa HPP ideal kopi susu?', answer: 'Umumnya 30–40% dari harga jual, tergantung bahan dan porsi yang dipakai.' }], ...over });

try {
  // Markdown: one H1 per page, safe output, structure preserved.
  const r = renderArticle('# Judul Sama\n\n<script>x()</script>\n\n## Bagian **Satu**\n\n- a\n- b\n\n[jahat](javascript:alert(1)) [baik](https://contoh.id)\n\n![](http://insecure/x.png)', 'Judul Sama');
  assert.ok(!r.html.includes('<h1') && !r.html.includes('<script') && !r.html.includes('javascript:') && !r.html.includes('insecure'));
  assert.match(r.html, /<h2 id="bagian-satu">Bagian <strong>Satu<\/strong><\/h2>/);
  assert.match(r.html, /<ul>\n<li>a<\/li>/);
  assert.match(r.html, /href="https:\/\/contoh\.id" rel="noopener nofollow" target="_blank"/);

  // Article rules.
  assert.equal(checkArticle(article()).ok, true, JSON.stringify(checkArticle(article()).errors));
  assert.ok(checkArticle(article({ content: '## a\n\nterlalu pendek' })).errors.some(e => e.includes('terlalu tipis')));
  assert.ok(checkArticle(article({ content: body + '\n\nDana penjualan cair H+1 otomatis.' })).errors.some(e => e.includes('H+1')));
  assert.ok(checkArticle(article({ category: 'Gosip' })).errors.some(e => e.startsWith('category')));

  // Public pages.
  let page = await get('/blog');
  assert.equal(page.status, 200); assert.match(page.type, /text\/html/); assert.match(page.cache, /s-maxage=300/);
  assert.match(page.text, /<link rel="canonical" href="https:\/\/kasir\.example\/blog">/);
  assert.match(page.text, /GTM-WD7T7WSF/); assert.match(page.text, /"@type":"Blog"/);
  assert.equal((page.text.match(/<h1/g) || []).length, 1);
  page = await get('/blog/cara-membuka-kafe-modal-10-juta-sukses');
  assert.equal(page.status, 200);
  assert.equal((page.text.match(/<h1/g) || []).length, 1, 'Seed article repeats its title in content; the page still has one H1');
  assert.match(page.text, /"@type":"BlogPosting"/); assert.match(page.text, /"@type":"BreadcrumbList"/);
  assert.match(page.text, /<title>[^<|]+\| Blog New Hope POS<\/title>/, 'One brand suffix, old "Blog Harapan Baru" suffixes removed');
  assert.ok(!page.text.includes('**'), 'Markdown is rendered, not printed');
  assert.equal((await get('/blog/tidak-ada')).status, 404);
  assert.equal((await get('/blog/Cara-Membuka-Kafe-Modal-10-Juta-Sukses')).status, 301);
  assert.equal((await get('/blog?kategori=tidak-ada')).status, 404);
  assert.match((await get('/blog?kategori=kuliner-fnb')).text, /Panduan Lengkap: Cara Membuka Kafe/);
  let sitemap = await get('/sitemap.xml');
  assert.match(sitemap.type, /xml/); assert.match(sitemap.text, /<loc>https:\/\/kasir\.example\/blog\/cara-membuka-kafe-modal-10-juta-sukses<\/loc>/);
  assert.match((await get('/rss.xml')).text, /<rss version="2.0"/);

  // Automation API: fail closed without configuration, then key-authenticated.
  delete process.env.BLOG_API_KEYS;
  assert.equal((await call('GET', '/api/v1/blog-automation/guide')).status, 503);
  process.env.BLOG_API_KEYS = 'short, ' + KEY;
  assert.equal((await call('GET', '/api/v1/blog-automation/guide', undefined, null)).status, 401);
  assert.equal((await call('GET', '/api/v1/blog-automation/guide', undefined, 'short')).status, 401, 'Keys shorter than 24 characters are ignored');
  assert.deepEqual((await call('GET', '/api/v1/blog-automation/guide')).body.categories.length, 7);
  const rejected = await call('POST', '/api/v1/blog-automation/posts', article({ content: 'pendek' }));
  assert.equal(rejected.status, 422); assert.ok(rejected.body.details.errors.length);
  const created = await call('POST', '/api/v1/blog-automation/posts', article());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual([created.body.post.slug, created.body.post.isPublished], ['cara-menghitung-hpp-kopi-susu-untuk-kedai-kecil', true]);
  assert.equal((await call('POST', '/api/v1/blog-automation/posts', article())).body.error, 'SLUG_ALREADY_EXISTS');
  assert.equal((await call('POST', '/api/v1/blog-automation/posts', article({ slug: 'lain' }))).body.error, 'TITLE_ALREADY_EXISTS');
  page = await get('/blog/cara-menghitung-hpp-kopi-susu-untuk-kedai-kecil');
  assert.equal(page.status, 200);
  assert.match(page.text, /"@type":"FAQPage"/); assert.match(page.text, /<div class="table-wrap"><table>/); assert.match(page.text, /Daftar isi/);
  assert.match((await get('/sitemap.xml')).text, /cara-menghitung-hpp-kopi-susu-untuk-kedai-kecil/);
  const updated = await call('PUT', '/api/v1/blog-automation/posts/cara-menghitung-hpp-kopi-susu-untuk-kedai-kecil', article({ title: 'Cara Menghitung HPP Kopi Susu: Contoh Lengkap per Gelas' }));
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.post.slug, 'cara-menghitung-hpp-kopi-susu-untuk-kedai-kecil', 'Update keeps the URL unless a new slug is sent');
  assert.equal((await call('DELETE', '/api/v1/blog-automation/posts/cara-menghitung-hpp-kopi-susu-untuk-kedai-kecil')).body.post.isPublished, false);
  assert.equal((await get('/blog/cara-menghitung-hpp-kopi-susu-untuk-kedai-kecil')).status, 404);
  assert.equal((await call('GET', '/api/v1/blog-automation/posts?status=draft')).body.posts.length, 1);

  // MCP.
  const rpc = (method: string, params?: unknown, key: string | null = KEY) => call('POST', '/api/v1/blog-automation/mcp', { jsonrpc: '2.0', id: 1, method, params }, key);
  assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18' })).body.result.serverInfo.name, 'newhope-blog');
  assert.equal((await rpc('tools/list', undefined, 'wrong-key-wrong-key-wrong-key')).status, 401);
  assert.ok((await rpc('tools/list')).body.result.tools.some((t: any) => t.name === 'create_post'));
  const invalid = await rpc('tools/call', { name: 'validate_article', arguments: article({ content: 'pendek' }) });
  assert.equal(invalid.body.result.structuredContent.ok, false);
  const viaMcp = await rpc('tools/call', { name: 'create_post', arguments: article({ title: 'Checklist Buka Toko Kelontong Modern di Lingkungan Perumahan', slug: undefined, category: 'Ritel & Minimarket' }) });
  assert.equal(viaMcp.body.result.isError, undefined, JSON.stringify(viaMcp.body));
  assert.equal((await get('/blog/checklist-buka-toko-kelontong-modern-di-lingkungan-perumahan')).status, 200);
  assert.equal((await rpc('tools/call', { name: 'create_post', arguments: article({ title: 'Checklist Buka Toko Kelontong Modern di Lingkungan Perumahan' }) })).body.result.isError, true);

  // Browsers never reach the table directly; the Vercel boundary exposes exactly these paths.
  const grants = (await db.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='blog_posts' AND grantee IN ('anon','authenticated')`)).rows[0].n;
  assert.equal(grants, 0);
  for (const [path, method, expected] of [['/blog', 'GET', true], ['/blog/a-b', 'GET', true], ['/blog/a/b', 'GET', false], ['/sitemap.xml', 'GET', true], ['/blog', 'POST', false], ['/api/v1/blog-automation/mcp', 'POST', true]] as const)
    assert.equal(isPublicApi(path, method), expected, `${method} ${path}`);
  console.log('PASS: server-rendered blog (one H1, canonical, JSON-LD, GTM, sitemap/RSS), safe Markdown, article rules, key-authenticated REST and MCP publishing, browser access denied');
} finally { server.close(); await pg.close(); }
