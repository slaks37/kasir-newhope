function sendJson(res: any, status: number, data: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');
    res.setHeader('Content-Type', 'application/json');
  } catch {}

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      const tenantId = req.query?.tenantId || req.headers['x-tenant-id'] || 'tenant-default';
      const { rows } = await pool.query(
        `SELECT o.*, m.business_sector 
         FROM internal.outlets o 
         LEFT JOIN internal.merchants m ON m.id = o.merchant_id 
         WHERE o.tenant_id = $1 
         ORDER BY o.created_at`,
        [tenantId]
      );
      await pool.end();
      return sendJson(res, 200, { ok: true, rows });
    } catch (err: any) {
      console.warn('Outlets DB fallback:', err.message);
    }
  }

  return sendJson(res, 200, { ok: true, rows: [] });
}
