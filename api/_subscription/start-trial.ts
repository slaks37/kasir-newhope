import { randomUUID } from 'crypto';

function sendJson(res: any, status: number, data: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const now = new Date();
  const end = new Date(now.getTime() + 45 * 86_400_000);
  const grace = new Date(now.getTime() + 59 * 86_400_000);

  const tenantId = req.body?.tenantId || req.query?.tenantId || req.headers['x-tenant-id'] || 'tenant-default';

  if (process.env.DATABASE_URL) {
    let pool: any;
    try {
      const { Pool } = await import('pg');
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });

      // Ensure tenant exists
      const tenantCheck = await pool.query('SELECT id, is_active FROM internal.tenants WHERE id = $1', [tenantId]);
      if (tenantCheck.rows.length === 0) {
        await pool.query(
          `INSERT INTO internal.tenants (id, name, is_active) VALUES ($1, 'Tenant User', true) ON CONFLICT (id) DO NOTHING`,
          [tenantId]
        );
      }

      // Check existing subscription
      const subCheck = await pool.query('SELECT * FROM billing.subscriptions WHERE tenant_id = $1', [tenantId]);
      const existing = subCheck.rows[0];

      if (existing && existing.has_used_trial && existing.status !== 'TRIAL' && existing.status !== 'PENDING_PAYMENT') {
        await pool.end();
        return sendJson(res, 400, {
          ok: false,
          error: 'TRIAL_ALREADY_USED',
          message: 'Masa Free Trial 45 Hari hanya berlaku 1 kali per akun toko. Silakan pilih paket Tier Plus atau Pro.',
        });
      }

      const upsertRes = await pool.query(
        `INSERT INTO billing.subscriptions
          (id, tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end, grace_period_end, trial_started_at, trial_ends_at, has_used_trial, extra_outlets, revision, updated_at)
         VALUES
          ($1, $2, 'plan-free', 'TRIAL', 'MONTHLY', $3, $4, $5, $3, $4, true, 0, 1, now())
         ON CONFLICT (tenant_id) DO UPDATE
          SET plan_id = 'plan-free',
              status = 'TRIAL',
              billing_cycle = 'MONTHLY',
              current_period_start = $3,
              current_period_end = $4,
              grace_period_end = $5,
              trial_started_at = COALESCE(billing.subscriptions.trial_started_at, $3),
              trial_ends_at = $4,
              has_used_trial = true,
              revision = billing.subscriptions.revision + 1,
              updated_at = now()
         RETURNING *`,
        [randomUUID(), tenantId, now.toISOString(), end.toISOString(), grace.toISOString()]
      );

      await pool.end();
      const updated = upsertRes.rows[0];

      return sendJson(res, 200, {
        ok: true,
        subscription: {
          id: updated.id,
          tenantId: updated.tenant_id,
          planId: 'plan-free',
          status: 'TRIAL',
          billingCycle: 'MONTHLY',
          extraOutlets: 0,
          currentPeriodStart: updated.current_period_start,
          currentPeriodEnd: updated.current_period_end,
          accessMode: 'FULL',
          hasUsedTrial: true,
        },
      });
    } catch (err: any) {
      if (pool) {
        try { await pool.end(); } catch {}
      }
      console.error('start-trial DB error:', err?.message);
      return sendJson(res, 500, {
        ok: false,
        error: 'TRIAL_ACTIVATION_FAILED',
        message: err?.message || 'Gagal mengaktifkan masa uji coba gratis.',
      });
    }
  }

  // Fallback for offline/local without DB
  return sendJson(res, 200, {
    ok: true,
    subscription: {
      id: `sub-trial-${Date.now()}`,
      tenantId,
      planId: 'plan-free',
      status: 'TRIAL',
      billingCycle: 'MONTHLY',
      extraOutlets: 0,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: end.toISOString(),
      accessMode: 'FULL',
      hasUsedTrial: true,
    },
  });
}
