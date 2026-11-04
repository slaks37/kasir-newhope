// Public read-only gateway for newhope-blog-production.
// Deploy with wrangler.toml; all writes remain on the authenticated Vercel backend.
addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  const path = url.pathname.slice(1);
  const segments = path.split('/');
  const file = segments[segments.length - 1] || '';
  const uuid = file.slice(0, -4);
  const isUuid = uuid.length === 36
    && [8, 13, 18, 23].every((i) => uuid[i] === '-')
    && [...uuid.replaceAll('-', '')].every((c) => '0123456789abcdef'.includes(c));
  const folderOk = (segments.length === 3 && segments[0] === 'automation' && segments[1] === 'generated')
    || (segments.length === 2 && segments[0].length > 0
      && [...segments[0]].every((c) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.includes(c)));

  if (!folderOk || !isUuid || !file.endsWith('.jpg') || url.search || path.includes('..')) {
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const object = await BLOG_BUCKET.get(path);
    if (!object) {
      return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const headers = new Headers({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ETag: object.httpEtag,
    });
    headers.set('Content-Length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
  } catch (_) {
    return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
