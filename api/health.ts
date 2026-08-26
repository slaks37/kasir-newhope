import { isDokuConfigured } from './_doku';

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    status: 'healthy',
    runtime: 'vercel-serverless',
    dokuConfigured: isDokuConfigured(),
    timestamp: new Date().toISOString(),
  });
}
