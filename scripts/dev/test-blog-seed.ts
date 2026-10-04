// Seeded blog posts carry no placeholder videos or claims about features that do not exist. Isolated PGlite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const pg = new PGlite();
try {
  for (const file of ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql', ...fs.readdirSync('migrations').filter(f => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql').sort().map(f => 'migrations/' + f)])
    await pg.exec(fs.readFileSync(file, 'utf8'));
  const posts = async () => (await pg.query<{ id: string; excerpt: string; content: string; media_embeds: unknown; seo: unknown }>('SELECT id, excerpt, content, media_embeds, seo FROM public.blog_posts ORDER BY id')).rows;
  const all = JSON.stringify(await posts());
  assert.ok((await posts()).length >= 3, 'Seed posts exist');
  for (const forbidden of ['dQw4w9WgXcQ', '@tiktok/video/', 'Keunggulan QRIS Dinamis di New Hope POS', 'otomatis cair H+1', 'rekonsiliasi instan'])
    assert.ok(!all.includes(forbidden), `Seed still contains: ${forbidden}`);
  assert.match((await posts()).find(p => p.id === 'blog-3')!.content, /QRIS statis milik toko/);

  // Admin-edited posts are left alone, and the Supabase copy is safe to re-run.
  const edited = 'Konten hasil edit admin: Keunggulan QRIS Dinamis di New Hope POS (versi admin).';
  await pg.query(`UPDATE public.blog_posts SET content = $1 WHERE id = 'blog-3'`, [edited]);
  const supabaseCopy = fs.readFileSync('supabase/migrations/20261004090400_blog_seed_corrections.sql', 'utf8');
  assert.equal(supabaseCopy, fs.readFileSync('migrations/0056_blog_seed_corrections.sql', 'utf8'), 'Supabase migration mirrors 0056');
  await pg.exec(supabaseCopy);
  await pg.exec(supabaseCopy);
  assert.equal((await posts()).find(p => p.id === 'blog-3')!.content.includes('versi admin'), true, 'Edited content is not overwritten');

  // Environments without the blog table skip it.
  const bare = new PGlite();
  await bare.exec(supabaseCopy);
  await bare.close();
  console.log('PASS: blog seed has no placeholder videos or dynamic-QRIS claims; correction keeps admin edits, is idempotent and skips databases without the blog table');
} finally { await pg.close(); }
