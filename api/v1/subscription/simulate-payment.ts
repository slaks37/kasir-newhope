type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const { planId, tenantId } = req.body ?? {};
  const tId = tenantId || 'usr-1_FNB';
  const targetPlan = planId || 'plan-pro-monthly';

  const db = getPool();
  try {
    // 1. Ensure tenant
    await db.query(
      `INSERT INTO pos.tenants (id, name, business_sector, is_active)
       VALUES (legacy_uuid($1), 'New Hope Store', 'FNB', true)
       ON CONFLICT (id) DO NOTHING`,
      [tId]
    );

    // 2. Upgrade subscription
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);

    await db.query(
      `INSERT INTO billing.subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end)
       VALUES (legacy_uuid($1), legacy_uuid($2), $3, 'ACTIVE', CURRENT_TIMESTAMP, $4)
       ON CONFLICT (id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = 'ACTIVE',
         current_period_end = EXCLUDED.current_period_end`,
      [`sub-${tId}`, tId, targetPlan, nextMonth.toISOString()]
    );

    return res.status(200).json({
      ok: true,
      message: 'Pembayaran simulasi berhasil! Paket langganan Anda aktif.',
      subscription: {
        planId: targetPlan,
        status: 'ACTIVE',
        currentPeriodEnd: nextMonth.toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[API Simulate Payment Error]:', err);
    return res.status(500).json({ ok: false, error: 'PAYMENT_FAILED', detail: err.message });
  }
}
