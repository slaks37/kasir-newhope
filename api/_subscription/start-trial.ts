import { Pool } from 'pg';
import { authenticateBearer } from '../../services/shared/auth';
import { TRIAL_DAYS, TRIAL_PLAN_ID, findSaaSPlan } from '../../src/config/saasPlans';
import { ownedSubscription } from './free-plan';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  // If DATABASE_URL is not set (e.g. local dev / embedded PGlite), return a valid trial response
  if (!process.env.DATABASE_URL) {
    const now = new Date();
    const end = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
    return res.status(200).json({
      ok: true,
      subscription: {
        id: 'sub-trial',
        tenantId: req.body?.tenantId || 'tenant-default',
        planId: TRIAL_PLAN_ID,
        status: 'TRIAL',
        accessMode: 'FULL',
        billingCycle: 'MONTHLY',
        extraOutlets: 0,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: end.toISOString(),
        hasUsedTrial: true,
        plan: findSaaSPlan(TRIAL_PLAN_ID),
      },
    });
  }

  const principal = await authenticateBearer(req);
  if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });

  // Ensure tenant and subscription exist in database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  let c: import('pg').PoolClient | undefined;
  try {
    c = await pool.connect();
    await c.query('BEGIN');

    // 1. Ensure tenant exists
    const tRes = await c.query(
      `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Utama', $1, $1, true)
       ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [principal.subject]
    );
    const tenantId = tRes.rows[0]?.id;

    // 2. Ensure subscription exists
    if (tenantId) {
      await c.query(
        `INSERT INTO billing.subscriptions
         (id, tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end, grace_period_end, trial_started_at, trial_ends_at, has_used_trial)
         VALUES (uuidv7(), $1, $2, 'TRIAL', 'MONTHLY', now(), now() + interval '45 days', now() + interval '59 days', now(), now() + interval '45 days', true)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, TRIAL_PLAN_ID]
      );
    }
    await c.query('COMMIT');
  } catch (err: any) {
    await c?.query('ROLLBACK').catch(() => {});
    console.warn('Could not auto-provision trial in database:', err?.message);
  } finally {
    c?.release();
    await pool.end().catch(() => {});
  }

  return ownedSubscription({ ...req, method: 'GET', headers: req.headers }, res);
}
