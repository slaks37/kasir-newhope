#!/usr/bin/env node
/**
 * =============================================================================
 * NIGHTLY MERCHANT HEALTH JOB  (SaaS provider back-office)
 * =============================================================================
 * Computes one `merchant_health_logs` row per merchant per day: revenue,
 * activity, feature adoption, subscription state and an explainable churn score.
 *
 * MUST run against the READ REPLICA, never the primary. Scanning every
 * merchant's transactions is exactly the workload that makes a cashier's
 * checkout hang mid-service.
 *
 * Schedule (after the merchant-facing insight job at 01:00):
 *     30 1 * * *  cd /srv/new-hope-pos && ANALYTICS_DATABASE_URL=... /usr/bin/node scripts/batch/merchant-health.mjs >> /var/log/nhpos-health.log 2>&1
 *
 * Usage:
 *     node scripts/batch/merchant-health.mjs                # live (needs ANALYTICS_DATABASE_URL + pg)
 *     node scripts/batch/merchant-health.mjs --dry-run      # built-in demo merchants
 *     node scripts/batch/merchant-health.mjs --input data.json
 * =============================================================================
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

/* -------------------------------------------------------------------------- */
/* CHURN MODEL — mirrors compute_churn_risk() in 0004 and src/lib/internal/churn.ts */
/* -------------------------------------------------------------------------- */

const WEIGHTS = { recency: 0.4, activity: 0.2, trend: 0.15, billing: 0.15, adoption: 0.05, support: 0.05 };

const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

function billingRisk(status) {
  if (status === 'EXPIRED' || status === 'CANCELED') return { v: 1, why: 'Langganan tidak aktif' };
  if (status === 'PAST_DUE') return { v: 0.7, why: 'Pembayaran menunggak' };
  if (status === 'TRIAL') return { v: 0.3, why: 'Masih trial' };
  return { v: 0, why: 'Langganan aktif' };
}

function bandFor(score) {
  if (score >= 0.7) return 'CRITICAL';
  if (score >= 0.45) return 'AT_RISK';
  if (score >= 0.25) return 'WATCH';
  return 'HEALTHY';
}

export function computeChurnRisk(m) {
  const recency = clamp01(Math.max(m.daysSinceLastTxn || 0, 0) / 14);
  const activity = 1 - clamp01(Math.min(Math.max(m.activeDaysLast7 || 0, 0), 7) / 7);
  const trend = clamp01(Math.max(-(m.revenueTrendPct || 0), 0) / 50);
  const billing = billingRisk(m.subscriptionStatus);
  const adoption = 1 - clamp01(Math.min(Math.max(m.distinctFeatures || 0, 0), 5) / 5);
  const support = clamp01(Math.max(m.supportTickets || 0, 0) / 3);

  const parts = [
    { factor: 'RECENCY', raw: recency, w: WEIGHTS.recency, detail: `Transaksi terakhir ${m.daysSinceLastTxn} hari lalu` },
    { factor: 'ACTIVITY', raw: activity, w: WEIGHTS.activity, detail: `${m.activeDaysLast7}/7 hari ada aktivitas` },
    { factor: 'REVENUE_TREND', raw: trend, w: WEIGHTS.trend, detail: `Tren omzet ${Math.round(m.revenueTrendPct || 0)}%` },
    { factor: 'BILLING', raw: billing.v, w: WEIGHTS.billing, detail: billing.why },
    { factor: 'ADOPTION', raw: adoption, w: WEIGHTS.adoption, detail: `${m.distinctFeatures} fitur dipakai` },
    { factor: 'SUPPORT', raw: support, w: WEIGHTS.support, detail: `${m.supportTickets} tiket support` },
  ];

  const score = Math.min(1, Math.round(parts.reduce((s, p) => s + p.raw * p.w, 0) * 100) / 100);
  const reasons = parts
    .map((p) => ({ factor: p.factor, contribution: Math.round(p.raw * p.w * 100) / 100, detail: p.detail }))
    .filter((r) => r.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);

  return { score, band: bandFor(score), reasons };
}

/* -------------------------------------------------------------------------- */
/* EXTRACT (read replica)                                                     */
/* -------------------------------------------------------------------------- */

const HEALTH_SQL = `
WITH windowed AS (
  SELECT t.tenant_id                                   AS merchant_id,
         COUNT(*)                                      AS txn_count,
         COALESCE(SUM(t.total_amount), 0)              AS revenue,
         MAX(t.created_at)                             AS last_txn_at,
         COUNT(DISTINCT t.created_at::date)            AS active_days,
         COUNT(DISTINCT t.cashier_user_id)             AS active_cashiers
    FROM transactions t
   WHERE t.created_at >= CURRENT_DATE - INTERVAL '30 days'
     AND t.payment_status = 'COMPLETED'
   GROUP BY t.tenant_id
),
recent AS (
  SELECT t.tenant_id AS merchant_id,
         COALESCE(SUM(t.total_amount) FILTER (WHERE t.created_at >= CURRENT_DATE - INTERVAL '7 days'), 0)  AS rev_7d,
         COALESCE(SUM(t.total_amount) FILTER (WHERE t.created_at <  CURRENT_DATE - INTERVAL '7 days'), 0)  AS rev_prior
    FROM transactions t
   WHERE t.created_at >= CURRENT_DATE - INTERVAL '30 days'
     AND t.payment_status = 'COMPLETED'
   GROUP BY t.tenant_id
),
today AS (
  SELECT t.tenant_id AS merchant_id,
         COUNT(*)                          AS txn_today,
         COALESCE(SUM(t.total_amount), 0)  AS revenue_today,
         COUNT(DISTINCT t.cashier_user_id) AS cashiers_today
    FROM transactions t
   WHERE t.created_at::date = CURRENT_DATE
     AND t.payment_status = 'COMPLETED'
   GROUP BY t.tenant_id
),
features AS (
  SELECT f.merchant_id,
         COUNT(DISTINCT f.feature_key) AS distinct_features,
         jsonb_object_agg(f.feature_key, f.uses) AS payload
    FROM (
      SELECT merchant_id, feature_key, COUNT(*) AS uses
        FROM feature_usage_events
       WHERE occurred_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY merchant_id, feature_key
    ) f
   GROUP BY f.merchant_id
)
SELECT te.id                                    AS merchant_id,
       te.id                                    AS tenant_id,
       COALESCE(td.revenue_today, 0)            AS daily_revenue,
       COALESCE(td.txn_today, 0)                AS daily_transaction_count,
       COALESCE(td.cashiers_today, 0)           AS active_cashiers_count,
       w.last_txn_at,
       COALESCE(w.active_days, 0)               AS active_days_30,
       COALESCE(r.rev_7d, 0)                    AS rev_7d,
       COALESCE(r.rev_prior, 0)                 AS rev_prior,
       COALESCE(fe.distinct_features, 0)        AS distinct_features,
       COALESCE(fe.payload, '{}'::jsonb)        AS feature_payload,
       s.status                                 AS subscription_status,
       COALESCE(p.price_idr, 0)                 AS mrr_idr
  FROM tenants te
  LEFT JOIN windowed w  ON w.merchant_id  = te.id
  LEFT JOIN recent   r  ON r.merchant_id  = te.id
  LEFT JOIN today    td ON td.merchant_id = te.id
  LEFT JOIN features fe ON fe.merchant_id = te.id
  LEFT JOIN subscriptions s ON s.tenant_id = te.id
  LEFT JOIN plans p ON p.id = s.plan_id;
`;

const UPSERT_SQL = `
INSERT INTO merchant_health_logs
  (id, merchant_id, tenant_id, log_date, daily_revenue, daily_transaction_count,
   active_cashiers_count, login_status, last_activity_at, days_since_last_txn,
   active_days_last_7, revenue_trend_pct, feature_usage_payload,
   distinct_features_used, support_tickets_count, subscription_status, mrr_idr,
   contract_mrr_idr, churn_risk_score, churn_risk_reasons, created_at, updated_at)
VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20::jsonb,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (merchant_id, log_date) DO UPDATE SET
  daily_revenue           = EXCLUDED.daily_revenue,
  daily_transaction_count = EXCLUDED.daily_transaction_count,
  active_cashiers_count   = EXCLUDED.active_cashiers_count,
  login_status            = EXCLUDED.login_status,
  last_activity_at        = EXCLUDED.last_activity_at,
  days_since_last_txn     = EXCLUDED.days_since_last_txn,
  active_days_last_7      = EXCLUDED.active_days_last_7,
  revenue_trend_pct       = EXCLUDED.revenue_trend_pct,
  feature_usage_payload   = EXCLUDED.feature_usage_payload,
  distinct_features_used  = EXCLUDED.distinct_features_used,
  support_tickets_count   = EXCLUDED.support_tickets_count,
  subscription_status     = EXCLUDED.subscription_status,
  mrr_idr                 = EXCLUDED.mrr_idr,
  contract_mrr_idr        = EXCLUDED.contract_mrr_idr,
  churn_risk_score        = EXCLUDED.churn_risk_score,
  churn_risk_reasons      = EXCLUDED.churn_risk_reasons,
  updated_at              = CURRENT_TIMESTAMP;
`;

const DAY_MS = 86_400_000;

export function toHealthRow(raw, today = new Date()) {
  const last = raw.last_txn_at ? new Date(raw.last_txn_at) : null;
  const daysSince = last ? Math.floor((today.getTime() - last.getTime()) / DAY_MS) : 999;

  // 7-day average vs the prior 23-day average, expressed as a percentage.
  const avg7 = Number(raw.rev_7d || 0) / 7;
  const avgPrior = Number(raw.rev_prior || 0) / 23;
  const trendPct = avgPrior > 0 ? ((avg7 - avgPrior) / avgPrior) * 100 : 0;

  const activeDays7 = Math.min(Number(raw.active_days_30 || 0), 7);

  const risk = computeChurnRisk({
    daysSinceLastTxn: daysSince,
    activeDaysLast7: activeDays7,
    revenueTrendPct: trendPct,
    subscriptionStatus: raw.subscription_status,
    distinctFeatures: Number(raw.distinct_features || 0),
    supportTickets: Number(raw.support_tickets || 0),
  });

  const logDate = today.toISOString().slice(0, 10);
  return {
    id: `mhl-${raw.merchant_id}-${logDate}`,
    merchant_id: raw.merchant_id,
    tenant_id: raw.tenant_id || raw.merchant_id,
    log_date: logDate,
    daily_revenue: Number(raw.daily_revenue || 0),
    daily_transaction_count: Number(raw.daily_transaction_count || 0),
    active_cashiers_count: Number(raw.active_cashiers_count || 0),
    login_status: daysSince <= 1,
    last_activity_at: last ? last.toISOString() : null,
    days_since_last_txn: Math.min(daysSince, 999),
    active_days_last_7: activeDays7,
    revenue_trend_pct: Math.round(trendPct * 100) / 100,
    feature_usage_payload: raw.feature_payload || {},
    distinct_features_used: Number(raw.distinct_features || 0),
    support_tickets_count: Number(raw.support_tickets || 0),
    subscription_status: raw.subscription_status || null,
    // RECOGNISED MRR — only what is actually being collected today.
    mrr_idr: raw.subscription_status === 'ACTIVE' ? Number(raw.mrr_idr || 0) : 0,
    // CONTRACT MRR — plan value regardless of payment state. "MRR at risk" must
    // use this: a PAST_DUE merchant is exactly the revenue a CSM can still save,
    // and scoring it as zero makes the urgency metric read 0 precisely when
    // things are worst.
    contract_mrr_idr:
      raw.subscription_status && raw.subscription_status !== 'CANCELED'
        ? Number(raw.mrr_idr || 0)
        : 0,
    churn_risk_score: risk.score,
    churn_risk_reasons: risk.reasons,
    _band: risk.band,
  };
}

/* -------------------------------------------------------------------------- */

function demoData() {
  const day = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
  return [
    { merchant_id: 'tenant-warung-sehat', last_txn_at: day(0), active_days_30: 26, rev_7d: 14_000_000, rev_prior: 42_000_000, daily_revenue: 2_100_000, daily_transaction_count: 41, active_cashiers_count: 2, distinct_features: 6, subscription_status: 'ACTIVE', mrr_idr: 349_000, feature_payload: { 'ai.digest': 22, 'pos.checkout': 900 } },
    { merchant_id: 'tenant-kopi-senja', last_txn_at: day(9), active_days_30: 4, rev_7d: 300_000, rev_prior: 9_000_000, daily_revenue: 0, daily_transaction_count: 0, active_cashiers_count: 0, distinct_features: 2, subscription_status: 'PAST_DUE', mrr_idr: 349_000, support_tickets: 2, feature_payload: { 'pos.checkout': 40 } },
    { merchant_id: 'tenant-laundry-bersih', last_txn_at: day(21), active_days_30: 1, rev_7d: 0, rev_prior: 1_200_000, daily_revenue: 0, daily_transaction_count: 0, active_cashiers_count: 0, distinct_features: 1, subscription_status: 'EXPIRED', mrr_idr: 149_000, support_tickets: 3, feature_payload: {} },
    { merchant_id: 'tenant-barber-rapi', last_txn_at: day(1), active_days_30: 18, rev_7d: 6_000_000, rev_prior: 17_000_000, daily_revenue: 850_000, daily_transaction_count: 17, active_cashiers_count: 1, distinct_features: 4, subscription_status: 'TRIAL', mrr_idr: 0, feature_payload: { 'pos.checkout': 300 } },
  ];
}

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const inputIdx = args.indexOf('--input');
  const inputFile = inputIdx >= 0 ? args[inputIdx + 1] : null;
  const startedAt = Date.now();

  const dbUrl = process.env.ANALYTICS_DATABASE_URL || process.env.DATABASE_URL;
  let pg = null;
  if (!dryRun && dbUrl) {
    try {
      pg = (await import('pg')).default;
    } catch {
      log('WARN  `pg` is not installed — falling back to DRY-RUN.');
    }
  }
  const live = Boolean(pg && dbUrl && !dryRun);

  log(`MODE: ${live ? 'LIVE (read replica -> merchant_health_logs)' : 'DRY-RUN (no database writes)'}`);
  if (live && !process.env.ANALYTICS_DATABASE_URL) {
    log('WARN  ANALYTICS_DATABASE_URL not set — using DATABASE_URL. Point this at the REPLICA, not the primary.');
  }

  if (!live) {
    const raws = inputFile ? JSON.parse(readFileSync(inputFile, 'utf8')) : demoData();
    const rows = raws.map((r) => toHealthRow(r));
    rows.sort((a, b) => b.churn_risk_score - a.churn_risk_score);

    console.log('\nMERCHANT HEALTH — ' + rows[0].log_date);
    console.log('-'.repeat(96));
    for (const r of rows) {
      console.log(
        `${r._band.padEnd(9)} ${String(r.churn_risk_score).padStart(4)}  ${r.merchant_id.padEnd(26)} ` +
          `${r.days_since_last_txn}d idle | tren ${String(r.revenue_trend_pct).padStart(7)}% | ` +
          `${r.subscription_status ?? '-'} | MRR ${r.mrr_idr}`
      );
      console.log(`          alasan: ${r.churn_risk_reasons.slice(0, 3).map((x) => `${x.factor}(+${x.contribution})`).join(', ')}`);
    }
    console.log('-'.repeat(96));
    const atRisk = rows.filter((r) => r.churn_risk_score >= 0.45);
    const mrrAtRisk = atRisk.reduce((s, r) => s + r.contract_mrr_idr, 0);
    const mrrRecognised = rows.reduce((s, r) => s + r.mrr_idr, 0);
    console.log(
      `${rows.length} merchant | at-risk: ${atRisk.length} | ` +
        `MRR berjalan: Rp ${mrrRecognised.toLocaleString('id-ID')} | ` +
        `MRR berisiko (nilai kontrak): Rp ${mrrAtRisk.toLocaleString('id-ID')}`
    );
    log(`Done in ${Date.now() - startedAt} ms — 0 rows written (dry run).`);
    return;
  }

  const client = new pg.Client({ connectionString: dbUrl });
  const runId = `run-health-${Date.now()}`;
  await client.connect();
  try {
    await client.query(
      `INSERT INTO batch_job_runs (id, job_name, started_at, status) VALUES ($1, 'merchant-health', CURRENT_TIMESTAMP, 'SUCCESS')`,
      [runId]
    );

    const { rows: raws } = await client.query(HEALTH_SQL);
    const rows = raws.map((r) => toHealthRow(r));

    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(UPSERT_SQL, [
        r.id, r.merchant_id, r.tenant_id, r.log_date, r.daily_revenue,
        r.daily_transaction_count, r.active_cashiers_count, r.login_status,
        r.last_activity_at, r.days_since_last_txn, r.active_days_last_7,
        r.revenue_trend_pct, JSON.stringify(r.feature_usage_payload),
        r.distinct_features_used, r.support_tickets_count, r.subscription_status,
        r.mrr_idr, r.contract_mrr_idr, r.churn_risk_score, JSON.stringify(r.churn_risk_reasons),
      ]);
    }
    await client.query(
      `UPDATE batch_job_runs SET finished_at = CURRENT_TIMESTAMP, status = 'SUCCESS', insights_written = $2, duration_ms = $3 WHERE id = $1`,
      [runId, rows.length, Date.now() - startedAt]
    );
    await client.query('COMMIT');
    log(`Done in ${Date.now() - startedAt} ms — ${rows.length} health row(s) upserted.`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
    try {
      await client.query(
        `UPDATE batch_job_runs SET finished_at = CURRENT_TIMESTAMP, status = 'FAILED', duration_ms = $2, error_text = $3 WHERE id = $1`,
        [runId, Date.now() - startedAt, String(err && err.message ? err.message : err)]
      );
    } catch { /* best effort */ }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  log('FATAL', err && err.stack ? err.stack : err);
  process.exit(1);
});
