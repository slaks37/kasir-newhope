import assert from 'node:assert/strict';
import { BLOG_INDEXNOW_KEY, BLOG_INDEXNOW_PATH, notifyBlogDiscovery } from '../../src/server/blogDiscovery';
let sent: any[] = [];
const originalSite = process.env.PUBLIC_SITE_URL, originalEnv = process.env.VERCEL_ENV;
process.env.PUBLIC_SITE_URL = 'https://kasir.newhope.space';
process.env.VERCEL_ENV = 'production';
const send = (async (url: string, opts: RequestInit) => {
  assert.equal(url, 'https://api.indexnow.org/indexnow');
  assert.equal(opts.redirect, 'error'); assert.ok(opts.signal);
  sent.push(JSON.parse(String(opts.body)));
  return new Response('', { status: 202 });
}) as typeof fetch;
try {
  assert.equal((await notifyBlogDiscovery(['artikel-baru', 'artikel-baru', '../api/admin', 'https://evil.example'], send)).accepted, true);
  assert.deepEqual(sent[0].urlList, ['https://kasir.newhope.space/blog/artikel-baru']);
  assert.equal(sent[0].keyLocation, 'https://kasir.newhope.space' + BLOG_INDEXNOW_PATH);
  assert.equal(sent[0].key, BLOG_INDEXNOW_KEY);
  assert.equal((await notifyBlogDiscovery(['artikel-baru'], (async () => { throw new Error('offline'); }) as typeof fetch)).status, 'unavailable');
  assert.equal((await notifyBlogDiscovery(['artikel-baru'], (async () => new Response('', {status: 429})) as typeof fetch)).accepted, false);
  process.env.VERCEL_ENV = 'preview';
  await notifyBlogDiscovery(['artikel-baru'], send);
  process.env.VERCEL_ENV = 'production'; process.env.PUBLIC_SITE_URL = 'https://other.example';
  await notifyBlogDiscovery(['artikel-baru'], send);
  assert.equal(sent.length, 1, 'Previews and unrelated domains never send production URLs');
  console.log('PASS: IndexNow validates owned URLs, deduplicates, skips previews and tolerates unavailable services');
} finally {
  if (originalSite === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = originalSite;
  if (originalEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = originalEnv;
}
