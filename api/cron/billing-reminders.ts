import pg from 'pg';
import { Resend } from 'resend';

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
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED_CRON' });
  }

  const startedAt = Date.now();
  const runId = `cron-billing-${Date.now()}`;
  const db = getPool();

  try {
    await db.query(
      `INSERT INTO batch_job_runs (id, job_name, started_at, status)
       VALUES ($1, 'billing-reminders', CURRENT_TIMESTAMP, 'RUNNING')
       ON CONFLICT (id) DO NOTHING`,
      [runId]
    );

    const { rows: subscriptions } = await db.query(`
      SELECT s.id, s.tenant_id, s.status, s.current_period_end, p.name as plan_name, t.name as merchant_name
        FROM billing.subscriptions s
        JOIN billing.saas_plans p ON s.plan_id = p.id
        JOIN internal.tenants t ON t.id = s.tenant_id
       WHERE s.status IN ('ACTIVE', 'TRIAL')
         AND s.current_period_end >= NOW() + INTERVAL '2 days'
         AND s.current_period_end < NOW() + INTERVAL '3 days'
    `);

    let sentCount = 0;
    if (process.env.RESEND_API_KEY && subscriptions.length > 0) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      for (const sub of subscriptions) {
        try {
          await resend.emails.send({
            from: 'billing@newhopepos.id',
            to: 'stefen.maxy.academy@gmail.com', // Notification recipient
            subject: `Pemberitahuan Tagihan H-3: ${sub.merchant_name} (${sub.plan_name})`,
            html: `<p>Masa aktif langganan ${sub.merchant_name} (${sub.plan_name}) akan berakhir pada ${new Date(sub.current_period_end).toLocaleDateString('id-ID')}.</p>`,
          });
          sentCount++;
        } catch (mailErr) {
          console.error('[cron/billing-reminders] email send error:', mailErr);
        }
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
      [runId, durationMs, subscriptions.length]
    );

    return res.status(200).json({
      ok: true,
      job: 'billing-reminders',
      runId,
      expiringCount: subscriptions.length,
      emailsSent: sentCount,
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

    console.error('[cron/billing-reminders] error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', runId });
  }
}
