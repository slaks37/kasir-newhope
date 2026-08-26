/** Adapter Vercel: semua route hanya meneruskan ke gateway kanonik. */
export async function proxyToGateway(req: any, res: any): Promise<void> {
  const base = (process.env.GATEWAY_URL || '').replace(/\/$/, '');
  if (!base) {
    res.status(503).json({ ok: false, error: 'GATEWAY_NOT_CONFIGURED' });
    return;
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers || {})) {
    const normalized = name.toLowerCase();
    if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(normalized)) continue;
    if (typeof value === 'string') headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(', ');
  }

  let requestUrl = req.url || '/';
  // Jika Vercel memotong /api dari req.url pada catch-all, pastikan prefix /api tetap ada
  if (!requestUrl.startsWith('/api')) {
    requestUrl = `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`;
  }

  try {
    const response = await fetch(`${base}${requestUrl}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(35_000),
    });
    response.headers.forEach((value, name) => {
      if (!['connection', 'content-encoding', 'transfer-encoding'].includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    });
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.status(502).json({ ok: false, error: 'GATEWAY_UNAVAILABLE' });
  }
}

