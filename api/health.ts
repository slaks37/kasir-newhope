export default function handler(req: any, res: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
  } catch {}

  const data = {
    ok: true,
    status: 'healthy',
    runtime: 'vercel-serverless',
    timestamp: new Date().toISOString(),
  };

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(200).json(data);
  }
  res.statusCode = 200;
  return res.end(JSON.stringify(data));
}
