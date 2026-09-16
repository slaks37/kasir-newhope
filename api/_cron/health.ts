import pg from 'pg';

type VercelRequest = any;
type VercelResponse = any;

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = getPool();

  try {
    const { rows: latestRuns } = await db.query(`
      SELECT DISTINCT ON (job_name)
        id, job_name, started_at, finished_at, status, duration_ms, insights_written, error_message
      FROM batch_job_runs
      ORDER BY job_name, started_at DESC
    `);

    const { rows: failedLast7d } = await db.query(`
      SELECT job_name, COUNT(*)::int as failure_count
      FROM batch_job_runs
      WHERE status = 'FAILED' AND started_at >= NOW() - INTERVAL '7 days'
      GROUP BY job_name
    `);

    const expectedJobs = ['daily-insights', 'merchant-health', 'billing-reminders'];
    const now = Date.now();
    const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000; // 26 hours

    const jobReports = expectedJobs.map((jobName) => {
      const latest = latestRuns.find((r) => r.job_name === jobName);
      const failures = failedLast7d.find((f) => f.job_name === jobName)?.failure_count || 0;

      const lastSuccessTime = latest?.status === 'SUCCESS' && latest?.finished_at
        ? new Date(latest.finished_at).getTime()
        : null;

      const isStale = lastSuccessTime ? (now - lastSuccessTime) > STALE_THRESHOLD_MS : true;
      const missedRun = !latest || isStale;

      return {
        jobName,
        status: latest?.status || 'NEVER_RUN',
        lastStartedAt: latest?.started_at || null,
        lastFinishedAt: latest?.finished_at || null,
        lastDurationMs: latest?.duration_ms || 0,
        itemsWritten: latest?.insights_written || 0,
        // Detail asli tetap berada di batch_job_runs untuk operator; endpoint
        // publik tidak boleh membocorkan nama tabel/constraint Postgres.
        lastError: latest?.error_message ? 'JOB_FAILED' : null,
        failedRunsLast7d: failures,
        isStale,
        missedRun,
      };
    });

    const isSystemHealthy = jobReports.every((j) => !j.isStale && j.status !== 'FAILED');

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      isSystemHealthy,
      jobs: jobReports,
    });
  } catch (error: any) {
    console.error('[cron/health] error:', error);
    return res.status(500).json({ ok: false, error: 'HEALTH_CHECK_FAILED' });
  }
}
