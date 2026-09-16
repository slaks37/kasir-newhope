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

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const now = new Date();

  // If DATABASE_URL is configured, attempt to query the billing table
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      const tenantId = req.query?.tenantId || req.headers['x-tenant-id'] || 'tenant-default';
      
      const resSub = await pool.query(
        `SELECT s.*, i.payment_status, i.paid_at 
         FROM billing.subscriptions s
         LEFT JOIN billing.invoices i ON i.subscription_id = s.id AND i.payment_status = 'PAID'
         WHERE s.tenant_id = $1 OR s.id = $1
         ORDER BY s.updated_at DESC LIMIT 1`,
        [tenantId]
      );
      await pool.end();

      if (resSub.rows.length > 0) {
        const sub = resSub.rows[0];
        const isPaid = sub.status === 'ACTIVE' || sub.payment_status === 'PAID';
        return sendJson(res, 200, {
          ok: true,
          subscription: {
            id: sub.id,
            tenantId: sub.tenant_id,
            planId: sub.plan_id || 'plan-plus-monthly',
            status: isPaid ? 'ACTIVE' : 'PENDING_PAYMENT',
            accessMode: isPaid ? 'FULL' : 'RESTRICTED',
            currentPeriodStart: sub.current_period_start || now.toISOString(),
            currentPeriodEnd: sub.current_period_end || now.toISOString(),
          },
          daysLeft: isPaid ? 30 : 0,
          invoices: [],
        });
      }
    } catch (dbErr: any) {
      console.warn('Status DB lookup fallback:', dbErr?.message);
    }
  }

  // Unpaid / Pending state by default for paid plan onboarding
  return sendJson(res, 200, {
    ok: true,
    subscription: {
      id: 'sub-pending',
      tenantId: req.query?.tenantId || 'tenant-default',
      planId: req.query?.planId || 'plan-plus-monthly',
      status: 'PENDING_PAYMENT',
      accessMode: 'RESTRICTED',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: now.toISOString(),
    },
    daysLeft: 0,
    invoices: [],
  });
}
