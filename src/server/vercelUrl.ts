/**
 * Normalizes req.url in Vercel serverless environments.
 *
 * When Vercel rewrites wildcard API routes to serverless functions, e.g.:
 *   /api/admin/(.*) -> /api/admin/[...slug]?__path=/api/admin/$1
 * this utility restores req.url and req.originalUrl to the requested path
 * so that Express / sub-routers match the full path (including multi-segment parameters).
 */
export function normalizeVercelUrl(req: any): void {
  if (!req || typeof req.url !== 'string') return;

  // 1. Check if __path query parameter was passed from vercel.json rewrite
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const customPath = parsed.searchParams.get('__path');
    if (customPath) {
      parsed.searchParams.delete('__path');
      const extraQs = parsed.searchParams.toString();
      if (customPath.includes('?')) {
        req.url = customPath + (extraQs ? `&${extraQs}` : '');
      } else {
        req.url = customPath + (extraQs ? `?${extraQs}` : '');
      }
      req.originalUrl = req.url;
      return;
    }
  } catch {
    // ignore parse error
  }

  // 2. If req.url contains [...slug], check x-matched-path or other headers
  if (req.url.includes('[...slug]')) {
    const matched = req.headers?.['x-matched-path'] || req.headers?.['x-forwarded-uri'] || req.headers?.['x-original-url'];
    if (typeof matched === 'string' && matched.startsWith('/') && !matched.includes('[...slug]')) {
      const qIdx = req.url.indexOf('?');
      const query = qIdx !== -1 ? req.url.slice(qIdx) : '';
      req.url = matched.includes('?') ? matched : (matched + query);
      req.originalUrl = req.url;
    }
  }
}
