import { SAAS_PLANS } from '../../src/config/saasPlans';

function sendJson(res: any, status: number, data: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');
    res.setHeader('Content-Type', 'application/json');
  } catch {}

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

export default function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 200, {
    ok: true,
    plans: SAAS_PLANS,
  });
}
