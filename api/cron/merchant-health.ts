import pg from 'pg';

type VercelRequest = any;
type VercelResponse = any;

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.ANALYTICS_DATABASE_URL || process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED_CRON' });
  }

  const startedAt = Date.now();
  const runId = `cron-health-${Date.now()}`;
  const db = getPool();

  try {
    await db.query(
      `INSERT INTO batch_job_runs (id, job_name, started_at, status)
       VALUES ($1, 'merchant-health', CURRENT_TIMESTAMP, 'RUNNING')
       ON CONFLICT (id) DO NOTHING`,
      [runId]
    );

    // Compute health metrics per merchant
    const { rows: merchants } = await db.query(
      `SELECT t.id, t.name,
              COUNT(tx.id)::int as txn_count_30d,
              COALESCE(SUM(tx.total_amount), 0)::numeric as revenue_30d,
              MAX(tx.created_at) as last_txn_at
         FROM internal.tenants t
         LEFT JOIN pos.transactions tx ON tx.tenant_id = t.id AND tx.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY t.id, t.name`
    );

    let logged = 0;
    const today = new Date().toISOString().split('T')[0];

    for (const m of merchants) {
      const daysSinceLastTxn = m.last_txn_at
        ? Math.max(0, Math.floor((Date.now() - new Date(m.last_txn_at).getTime()) / (1000 * 60 * 60 * 24)))
        : 99;

      let churnScore = 0.1;
      let healthBand = 'HEALTHY';

      if (daysSinceLastTxn >= 14) {
        churnScore = 0.85;
        healthBand = 'CRITICAL';
      } else if (daysSinceLastTxn >= 7) {
        churnScore = 0.55;
        healthBand = 'AT_RISK';
      } else if (daysSinceLastTxn >= 3) {
        churnScore = 0.30;
        healthBand = 'WATCH';
      }

      await db.query(
        `INSERT INTO merchant_health_logs
           (id, tenant_id, merchant_id, log_date, churn_risk_score, health_band,
            days_since_last_txn, revenue_30d, transactions_30d, metrics_summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, log_date) DO UPDATE SET
           churn_risk_score = EXCLUDED.churn_risk_score,
           health_band = EXCLUDED.health_band,
           days_since_last_txn = EXCLUDED.days_since_last_txn,
           revenue_30d = EXCLUDED.revenue_30d,
           transactions_30d = EXCLUDED.transactions_30d,
           metrics_summary = EXCLUDED.metrics_summary,
           updated_at = CURRENT_TIMESTAMP`,
        [
          `health_${m.id}_${today}`,
          m.id,
          m.id,
          today,
          churnScore,
          healthBand,
          daysSinceLastTxn,
          Number(m.revenue_30d),
          m.txn_count_30d,
          JSON.stringify({ daysSinceLastTxn, revenue30d: m.revenue_30d, txnCount: m.txn_count_30d }),
        ]
      );
      logged++;
    }

    const durationMs = Date.now() - startedAt;

    await db.query(
      `UPDATE batch_job_runs
          SET finished_at = CURRENT_TIMESTAMP,
              status = 'SUCCESS',
              duration_ms = $2,
              insights_written = $3
        WHERE id = $1`,
      [runId, durationMs, logged]
    );

    return res.status(200).json({
      ok: true,
      job: 'merchant-health',
      runId,
      merchantsEvaluated: merchants.length,
      durationMs,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;
    try {
      await db.query(
        `UPDATE batch_job_runs
            SET finished_at = CURRENT_TIMESTAMP,
                status = 'FAILED',
                duration_ms = $2,
                error_message = $3
          WHERE id = $1`,
        [runId, durationMs, error?.message || 'UNKNOWN_ERROR']
      );
    } catch {}

    console.error('[cron/merchant-health] error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', runId });
  }
}
