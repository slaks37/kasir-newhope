import pg from 'pg';

type VercelRequest = any;
type VercelResponse = any;

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Authorization check for Vercel Cron
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED_CRON' });
  }

  const startedAt = Date.now();
  const runId = `cron-insights-${Date.now()}`;
  const db = getPool();

  try {
    // Record run start
    await db.query(
      `INSERT INTO batch_job_runs (id, job_name, started_at, status)
       VALUES ($1, 'daily-insights', CURRENT_TIMESTAMP, 'RUNNING')
       ON CONFLICT (id) DO NOTHING`,
      [runId]
    );

    // Fetch all active merchants
    const { rows: merchants } = await db.query(
      `SELECT DISTINCT tenant_id as id FROM pos.transactions WHERE created_at >= NOW() - INTERVAL '30 days'`
    );

    let totalWritten = 0;

    for (const m of merchants) {
      const merchantId = m.id;
      // Get low stock count
      const { rows: lowStockRows } = await db.query(
        `SELECT COUNT(*)::int as count FROM pos.products WHERE tenant_id = $1 AND stock <= min_stock_alert AND is_available = TRUE`,
        [merchantId]
      );
      const lowStockCount = lowStockRows[0]?.count || 0;

      // Get 7-day revenue trend
      const { rows: revRows } = await db.query(
        `SELECT COALESCE(SUM(total_amount), 0)::numeric as rev
           FROM pos.transactions
          WHERE tenant_id = $1 AND order_status IN ('COMPLETED', 'SETTLED', 'PAID')
            AND created_at >= NOW() - INTERVAL '7 days'`,
        [merchantId]
      );
      const weekRev = Number(revRows[0]?.rev || 0);

      const insights: any[] = [];
      const today = new Date().toISOString().split('T')[0];

      if (lowStockCount > 0) {
        insights.push({
          id: `ins_stock_${merchantId}_${today}`,
          tenant_id: merchantId,
          merchant_id: merchantId,
          insight_date: today,
          category: 'INVENTORY',
          severity: 'HIGH',
          title: `${lowStockCount} Produk Menipis / Di Bawah Batas Minimum`,
          summary: `Ada ${lowStockCount} item yang perlu segera di-restok untuk mencegah kehilangan potensi penjualan.`,
          recommendation: 'Buka menu Manajemen Stok & lakukan Purchase Order ke supplier.',
          metrics: { lowStockCount },
        });
      }

      if (weekRev > 0) {
        insights.push({
          id: `ins_rev_${merchantId}_${today}`,
          tenant_id: merchantId,
          merchant_id: merchantId,
          insight_date: today,
          category: 'SALES',
          severity: 'INFO',
          title: 'Performa Omzet 7 Hari Terakhir',
          summary: `Akumulasi omzet 7 hari terakhir tercatat sebesar Rp ${weekRev.toLocaleString('id-ID')}.`,
          recommendation: 'Pertahankan rotasi menu terlaris dan berikan apresiasi kepada staf kasir.',
          metrics: { weekRevenue: weekRev },
        });
      }

      for (const ins of insights) {
        await db.query(
          `INSERT INTO daily_merchant_insights
             (id, tenant_id, merchant_id, insight_date, category, severity, title, summary, recommendation, metrics)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             summary = EXCLUDED.summary,
             recommendation = EXCLUDED.recommendation,
             metrics = EXCLUDED.metrics,
             updated_at = CURRENT_TIMESTAMP`,
          [ins.id, ins.tenant_id, ins.merchant_id, ins.insight_date, ins.category, ins.severity, ins.title, ins.summary, ins.recommendation, JSON.stringify(ins.metrics)]
        );
        totalWritten++;
      }
    }

    const durationMs = Date.now() - startedAt;

    await db.query(
      `UPDATE batch_job_runs
          SET finished_at = CURRENT_TIMESTAMP,
              status = 'SUCCESS',
              duration_ms = $2,
              insights_written = $3
        WHERE id = $1`,
      [runId, durationMs, totalWritten]
    );

    return res.status(200).json({
      ok: true,
      job: 'daily-insights',
      runId,
      merchantsProcessed: merchants.length,
      insightsWritten: totalWritten,
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

    console.error('[cron/daily-insights] error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', runId });
  }
}
