import { randomUUID } from 'node:crypto';
import type { Db } from '../shared/db';
import { computeChurnRisk } from '../../src/lib/internal/churn';

// The production enum deliberately records terminal outcomes only. An unfinished
// attempt is never labelled SUCCESS; failures roll back health rows first.
export type BatchOutcome = 'SUCCESS' | 'FAILED' | 'SKIPPED';
export async function recordHealthOutcome(db: Db, runId: string, started: Date, status: BatchOutcome, written = 0, errorCode: string | null = null) {
  if (!['SUCCESS', 'FAILED', 'SKIPPED'].includes(status)) throw new Error('INVALID_BATCH_OUTCOME');
  if ((status !== 'SUCCESS' && written !== 0) || !Number.isInteger(written) || written < 0) throw new Error('INVALID_BATCH_COUNT');
  // INSERT only: a finished attempt cannot later be rewritten to another state.
  await db.query(`INSERT INTO ai.batch_job_runs(id,job_name,started_at,finished_at,status,insights_written,duration_ms,error_text)
    VALUES($1,'merchant-health',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6)`,
  [runId,started.toISOString(),status,written,Math.max(0,Date.now()-started.getTime()),errorCode]);
}

export const healthSourceSql = `
WITH revenue AS (
  SELECT tenant_id,merchant_id,COUNT(*) FILTER(WHERE created_at >= $1::date)::int AS daily_transaction_count,
    COALESCE(SUM(total_amount) FILTER(WHERE created_at >= $1::date),0) AS daily_revenue,
    MAX(created_at) AS last_txn_at,
    COUNT(DISTINCT (created_at AT TIME ZONE 'UTC')::date) FILTER(WHERE created_at >= $1::date-interval '6 days')::int AS active_days_last_7,
    COALESCE(SUM(total_amount) FILTER(WHERE created_at >= $1::date-interval '6 days'),0) AS rev_7d,
    COALESCE(SUM(total_amount) FILTER(WHERE created_at < $1::date-interval '6 days'),0) AS rev_prior
  FROM contract.merchant_revenue WHERE created_at >= $1::date-interval '29 days' AND created_at < $1::date+interval '1 day'
  GROUP BY tenant_id,merchant_id
), features AS (
  SELECT tenant_id,merchant_id,COUNT(DISTINCT feature_key)::int AS distinct_features
  FROM internal.feature_usage_events WHERE occurred_at >= $1::date-interval '29 days' AND occurred_at < $1::date+interval '1 day'
  GROUP BY tenant_id,merchant_id
)
SELECT m.id AS merchant_id,m.tenant_id,r.daily_transaction_count,r.daily_revenue,r.active_days_last_7,r.rev_7d,r.rev_prior,COALESCE(f.distinct_features,0) AS distinct_features,
  s.status AS subscription_status,COALESCE(s.recurring_amount,p.price_idr,0) AS contract_value,
  (SELECT MAX(x.created_at) FROM contract.merchant_revenue x WHERE x.tenant_id=m.tenant_id AND x.merchant_id=m.id AND x.created_at < $1::date+interval '1 day') AS last_activity_at
FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
LEFT JOIN revenue r ON r.tenant_id=m.tenant_id AND r.merchant_id=m.id
LEFT JOIN features f ON f.tenant_id=m.tenant_id AND f.merchant_id=m.id
LEFT JOIN billing.subscriptions s ON s.tenant_id=m.tenant_id LEFT JOIN billing.plans p ON p.id=s.plan_id
WHERE t.merged_into IS NULL AND t.is_active AND m.is_active ORDER BY m.id`;

export async function runMerchantHealth(db: Db, options: { dryRun?: boolean; now?: Date } = {}) {
  const started = options.now ?? new Date();
  const day = started.toISOString().slice(0,10);
  const runId = randomUUID();
  try {
    return await db.tx(async tx => {
      if (options.dryRun) await tx.exec('SET TRANSACTION READ ONLY');
      // Transaction lock works through transaction poolers and is released on
      // both COMMIT and ROLLBACK, including a killed worker.
      if (!options.dryRun) {
        const lock = (await tx.query("SELECT pg_try_advisory_xact_lock(18441,731) AS acquired")).rows[0];
        if (!lock.acquired) {
          await recordHealthOutcome(tx,runId,started,'SKIPPED');
          return { runId, evaluated: 0, written: 0, skipped: true };
        }
      }
      const rows = (await tx.query(healthSourceSql,[day])).rows;
      for (const row of rows) {
        const days = row.last_activity_at ? Math.min(999,Math.max(0,Math.floor((started.getTime()-new Date(row.last_activity_at).getTime())/86400000))) : 999;
        const prior = Number(row.rev_prior ?? 0)/23;
        const trend = prior > 0 ? ((Number(row.rev_7d ?? 0)/7-prior)/prior)*100 : 0;
        const score = computeChurnRisk({daysSinceLastTxn:days,activeDaysLast7:Number(row.active_days_last_7 ?? 0),revenueTrendPct:trend,
          subscriptionStatus:row.subscription_status,distinctFeatures:Number(row.distinct_features),supportTickets:0});
        if (options.dryRun) continue;
        await tx.query(`INSERT INTO internal.merchant_health_logs(id,merchant_id,tenant_id,log_date,daily_revenue,daily_transaction_count,
          login_status,last_activity_at,days_since_last_txn,active_days_last_7,revenue_trend_pct,distinct_features_used,
          subscription_status,mrr_idr,contract_mrr_idr,churn_risk_score,churn_risk_reasons)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
          ON CONFLICT(merchant_id,log_date) DO UPDATE SET daily_revenue=EXCLUDED.daily_revenue,daily_transaction_count=EXCLUDED.daily_transaction_count,
          login_status=EXCLUDED.login_status,last_activity_at=EXCLUDED.last_activity_at,days_since_last_txn=EXCLUDED.days_since_last_txn,
          active_days_last_7=EXCLUDED.active_days_last_7,revenue_trend_pct=EXCLUDED.revenue_trend_pct,distinct_features_used=EXCLUDED.distinct_features_used,
          subscription_status=EXCLUDED.subscription_status,mrr_idr=EXCLUDED.mrr_idr,contract_mrr_idr=EXCLUDED.contract_mrr_idr,
          churn_risk_score=EXCLUDED.churn_risk_score,churn_risk_reasons=EXCLUDED.churn_risk_reasons,updated_at=CURRENT_TIMESTAMP`,
          [randomUUID(),row.merchant_id,row.tenant_id,day,Number(row.daily_revenue ?? 0),Number(row.daily_transaction_count ?? 0),days<=1,row.last_activity_at,
          days,Number(row.active_days_last_7 ?? 0),Math.round(trend*100)/100,Number(row.distinct_features),row.subscription_status,
          row.subscription_status==='ACTIVE'?Number(row.contract_value):0,row.subscription_status && row.subscription_status!=='CANCELED'?Number(row.contract_value):0,score.score,JSON.stringify(score.reasons)]);
      }
      if (!options.dryRun) await recordHealthOutcome(tx,runId,started,'SUCCESS',rows.length);
      return { runId, evaluated: rows.length, written: options.dryRun?0:rows.length, skipped: false };
    });
  } catch (error: any) {
    if (!options.dryRun) {
      // Store only SQLSTATE, never SQL details/parameters or credential URLs.
      try { await recordHealthOutcome(db,runId,started,'FAILED',0,/^[0-9A-Z]{5}$/.test(error?.code)?error.code:'HEALTH_EXECUTION_FAILED'); }
      catch { console.error('[cron/merchant-health] failure history unavailable', {runId}); }
    }
    throw error;
  }
}
