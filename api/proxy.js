export default async function handler(req, res) {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://fqxrhumsgigcgjtlbfuo.supabase.co';

  // Extract path
  let subpath = '';
  if (req.query && req.query.__match) {
    subpath = Array.isArray(req.query.__match) ? req.query.__match.join('/') : req.query.__match;
  } else {
    subpath = (req.url || '').replace(/^\/api\/proxy\??/, '').replace(/^\/api\/?/, '');
  }

  // Preserve any remaining query parameters
  const queryParams = new URLSearchParams();
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== '__match') {
        if (Array.isArray(value)) {
          value.forEach(v => queryParams.append(key, v));
        } else if (value !== undefined) {
          queryParams.set(key, value);
        }
      }
    }
  }

  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
  const targetPath = subpath.startsWith('/') ? subpath : `/${subpath}`;
  const targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/api${targetPath}${queryString}`;

  try {
    const fetchOptions = {
      method: req.method,
      headers: { ...req.headers },
    };

    // Remove hop-by-hop and host headers
    delete fetchOptions.headers['host'];
    delete fetchOptions.headers['connection'];
    delete fetchOptions.headers['content-length'];

    // Forward body if present
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Forward response headers
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    const responseBuffer = await response.arrayBuffer();
    res.status(response.status).send(Buffer.from(responseBuffer));
  } catch (error) {
    console.error('[Vercel Proxy Error]:', error);
    res.status(502).json({ error: 'Failed to proxy request to Supabase Edge Functions' });
  }
}
