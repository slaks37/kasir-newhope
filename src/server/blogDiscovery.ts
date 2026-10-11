/** IndexNow advertises public blog changes to participating search engines.
 * Acceptance is a crawl hint, not proof of indexing. Sitemaps remain the Google path.
 * This publicly served verification key authorizes URL hints only, not CMS access.
 */
export const BLOG_INDEXNOW_KEY = 'eda153f3ef2fb48e8fcc2454402be848';
export const BLOG_INDEXNOW_PATH = `/blog/${BLOG_INDEXNOW_KEY}.txt`;
const ORIGIN = 'https://kasir.newhope.space';

export async function notifyBlogDiscovery(slugs: string[], send: typeof fetch = fetch) {
  if (process.env.VERCEL_ENV !== 'production' || (process.env.PUBLIC_SITE_URL && process.env.PUBLIC_SITE_URL.replace(/\/+$/, '') !== ORIGIN))
    return { accepted: false, status: 'skipped' };
  const urls = [...new Set(slugs)].filter(slug => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)).map(slug => `${ORIGIN}/blog/${slug}`);
  if (!urls.length) return { accepted: false, status: 'skipped' };
  try {
    const response = await send('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'kasir.newhope.space', key: BLOG_INDEXNOW_KEY, keyLocation: ORIGIN + BLOG_INDEXNOW_PATH, urlList: urls }),
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    const accepted = response.status === 200 || response.status === 202;
    console.info('[blog-discovery]', accepted ? 'accepted' : 'failed', response.status, urls.length);
    return { accepted, status: response.status };
  } catch {
    console.warn('[blog-discovery] notification failed; publication preserved');
    return { accepted: false, status: 'unavailable' };
  }
}
