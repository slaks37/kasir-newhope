// src/server/merchantHealthHandler.ts
import { timingSafeEqual } from "node:crypto";

// services/shared/cron.ts
function isCronJobEnabled(job) {
  const configured = process.env.CRON_ENABLED_JOBS;
  if (configured === void 0) return true;
  return configured.split(",").map((value) => value.trim()).filter(Boolean).includes(job);
}

// services/shared/db.ts
import fs from "node:fs";
import pg from "pg";

// services/shared/poolConfig.ts
function serverlessConnectionString(connectionString, vercel = process.env.VERCEL) {
  if (vercel !== "1") return connectionString;
  try {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname) || url.port !== "5432") return connectionString;
    url.port = "6543";
    return url.toString();
  } catch {
    return connectionString;
  }
}
function databasePoolLimits(max, vercel = process.env.VERCEL) {
  return {
    // Each warm function owns a pool; keep the per-instance budget small.
    max: vercel === "1" ? Math.min(Math.max(1, max), 2) : max,
    idleTimeoutMillis: vercel === "1" ? 5e3 : 3e4,
    connectionTimeoutMillis: 1e4
  };
}
function statementTimeoutMs(raw = process.env.DB_STATEMENT_TIMEOUT_MS) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1e3 && value <= 12e4 ? value : 8e3;
}

// services/shared/databaseStartup.ts
async function waitForDatabase(probe, vercel = process.env.VERCEL, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const attempts = vercel === "1" ? 1 : 15;
  let cause;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await probe();
      return;
    } catch (error) {
      cause = error;
    }
    if (attempt + 1 < attempts) await sleep(Math.min(250 * 2 ** attempt, 3e3));
  }
  throw Object.assign(new Error(`Database tidak bisa dihubungi setelah ${attempts} percobaan`), { cause });
}

// services/shared/db.ts
pg.types.setTypeParser(1700, (v) => v === null ? null : Number(v));
pg.types.setTypeParser(20, (v) => v === null ? null : Number(v));
function konfigurasiSsl(connectionString) {
  const url = connectionString.toLowerCase();
  const lokal = url.includes("@127.0.0.1") || url.includes("@localhost") || url.includes("sslmode=disable");
  if (lokal) return void 0;
  if (process.env.PGSSLROOTCERT) {
    return { ca: fs.readFileSync(process.env.PGSSLROOTCERT, "utf8"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}
async function connectDb(opts) {
  const connectionString = serverlessConnectionString(
    opts.connectionString || process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5432/postgres"
  );
  const pool = new pg.Pool({
    connectionString,
    ssl: konfigurasiSsl(connectionString),
    // Kecil dengan sengaja. Di pengembangan, keempat service berbagi satu
    // batas koneksi di db-server; pool besar per service akan menghabiskannya
    // dan membuat service yang menyala terakhir gagal tersambung.
    ...databasePoolLimits(opts.max ?? Number(process.env.PGPOOL_MAX || 4))
  });
  void opts.schema;
  pool.on("error", (err) => {
    console.error("[db] koneksi idle bermasalah:", err.message);
  });
  await waitForDatabase(async () => {
    const probe = await pool.connect();
    probe.release();
  }).catch(async (error) => {
    await pool.end().catch(() => {
    });
    throw error;
  });
  const wrap = (runner) => ({
    async query(sql, params) {
      const r = await runner.query(sql, params);
      const rows = r?.rows ?? [];
      return { rows, rowCount: r?.rowCount ?? rows.length };
    },
    async exec(sql) {
      await runner.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs()}`);
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
        });
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  });
  return wrap(pool);
}

// services/backoffice/merchantHealth.ts
import { randomUUID } from "node:crypto";

// src/lib/internal/churn.ts
var CHURN_WEIGHTS = {
  recency: 0.4,
  activity: 0.2,
  trend: 0.15,
  billing: 0.15,
  adoption: 0.05,
  support: 0.05
};
var clamp01 = (n) => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};
function billingRisk(status) {
  switch (status) {
    case "EXPIRED":
      return { value: 1, detail: "Langganan sudah kedaluwarsa" };
    case "CANCELED":
      return { value: 1, detail: "Langganan dibatalkan" };
    case "PAST_DUE":
      return { value: 0.7, detail: "Pembayaran menunggak" };
    case "TRIAL":
      return { value: 0.3, detail: "Masih masa trial, belum berkomitmen" };
    default:
      return { value: 0, detail: "Langganan aktif" };
  }
}
function bandFor(score) {
  if (score >= 0.7) return "CRITICAL";
  if (score >= 0.45) return "AT_RISK";
  if (score >= 0.25) return "WATCH";
  return "HEALTHY";
}
function computeChurnRisk(input) {
  const recency = clamp01(Math.max(input.daysSinceLastTxn || 0, 0) / 14);
  const activity = 1 - clamp01(Math.min(Math.max(input.activeDaysLast7 || 0, 0), 7) / 7);
  const trend = clamp01(Math.max(-(input.revenueTrendPct || 0), 0) / 50);
  const billing = billingRisk(input.subscriptionStatus);
  const adoption = 1 - clamp01(Math.min(Math.max(input.distinctFeatures || 0, 0), 5) / 5);
  const support = clamp01(Math.max(input.supportTickets || 0, 0) / 3);
  const parts = [
    {
      factor: "RECENCY",
      weight: CHURN_WEIGHTS.recency,
      raw: recency,
      detail: input.daysSinceLastTxn >= 14 ? `Tidak ada transaksi ${input.daysSinceLastTxn} hari \u2014 sudah lewat ambang 14 hari` : `Transaksi terakhir ${input.daysSinceLastTxn} hari lalu`
    },
    {
      factor: "ACTIVITY",
      weight: CHURN_WEIGHTS.activity,
      raw: activity,
      detail: `Hanya ${input.activeDaysLast7} dari 7 hari terakhir ada aktivitas`
    },
    {
      factor: "REVENUE_TREND",
      weight: CHURN_WEIGHTS.trend,
      raw: trend,
      detail: input.revenueTrendPct < 0 ? `Omzet turun ${Math.abs(Math.round(input.revenueTrendPct))}% dibanding periode sebelumnya` : "Tren omzet stabil atau naik"
    },
    { factor: "BILLING", weight: CHURN_WEIGHTS.billing, raw: billing.value, detail: billing.detail },
    {
      factor: "ADOPTION",
      weight: CHURN_WEIGHTS.adoption,
      raw: adoption,
      detail: `Baru memakai ${input.distinctFeatures} fitur berbeda`
    },
    {
      factor: "SUPPORT",
      weight: CHURN_WEIGHTS.support,
      raw: support,
      detail: `${input.supportTickets} tiket support pada periode ini`
    }
  ];
  const score = Math.min(
    1,
    Math.round(parts.reduce((sum, p) => sum + p.raw * p.weight, 0) * 100) / 100
  );
  const reasons = parts.map((p) => ({
    factor: p.factor,
    weight: p.weight,
    contribution: Math.round(p.raw * p.weight * 100) / 100,
    detail: p.detail
  })).filter((r) => r.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  return { score, band: bandFor(score), reasons };
}

// services/backoffice/merchantHealth.ts
async function recordHealthOutcome(db, runId, started, status, written = 0, errorCode = null) {
  if (!["SUCCESS", "FAILED", "SKIPPED"].includes(status)) throw new Error("INVALID_BATCH_OUTCOME");
  if (status !== "SUCCESS" && written !== 0 || !Number.isInteger(written) || written < 0) throw new Error("INVALID_BATCH_COUNT");
  await db.query(
    `INSERT INTO ai.batch_job_runs(id,job_name,started_at,finished_at,status,insights_written,duration_ms,error_text)
    VALUES($1,'merchant-health',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6)`,
    [runId, started.toISOString(), status, written, Math.max(0, Date.now() - started.getTime()), errorCode]
  );
}
var healthSourceSql = `
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
async function runMerchantHealth(db, options = {}) {
  const started = options.now ?? /* @__PURE__ */ new Date();
  const day = started.toISOString().slice(0, 10);
  const runId = randomUUID();
  try {
    return await db.tx(async (tx) => {
      if (options.dryRun) await tx.exec("SET TRANSACTION READ ONLY");
      if (!options.dryRun) {
        const lock = (await tx.query("SELECT pg_try_advisory_xact_lock(18441,731) AS acquired")).rows[0];
        if (!lock.acquired) {
          await recordHealthOutcome(tx, runId, started, "SKIPPED");
          return { runId, evaluated: 0, written: 0, skipped: true };
        }
      }
      const rows = (await tx.query(healthSourceSql, [day])).rows;
      for (const row of rows) {
        const days = row.last_activity_at ? Math.min(999, Math.max(0, Math.floor((started.getTime() - new Date(row.last_activity_at).getTime()) / 864e5))) : 999;
        const prior = Number(row.rev_prior ?? 0) / 23;
        const trend = prior > 0 ? (Number(row.rev_7d ?? 0) / 7 - prior) / prior * 100 : 0;
        const score = computeChurnRisk({
          daysSinceLastTxn: days,
          activeDaysLast7: Number(row.active_days_last_7 ?? 0),
          revenueTrendPct: trend,
          subscriptionStatus: row.subscription_status,
          distinctFeatures: Number(row.distinct_features),
          supportTickets: 0
        });
        if (options.dryRun) continue;
        await tx.query(
          `INSERT INTO internal.merchant_health_logs(id,merchant_id,tenant_id,log_date,daily_revenue,daily_transaction_count,
          login_status,last_activity_at,days_since_last_txn,active_days_last_7,revenue_trend_pct,distinct_features_used,
          subscription_status,mrr_idr,contract_mrr_idr,churn_risk_score,churn_risk_reasons)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
          ON CONFLICT(merchant_id,log_date) DO UPDATE SET daily_revenue=EXCLUDED.daily_revenue,daily_transaction_count=EXCLUDED.daily_transaction_count,
          login_status=EXCLUDED.login_status,last_activity_at=EXCLUDED.last_activity_at,days_since_last_txn=EXCLUDED.days_since_last_txn,
          active_days_last_7=EXCLUDED.active_days_last_7,revenue_trend_pct=EXCLUDED.revenue_trend_pct,distinct_features_used=EXCLUDED.distinct_features_used,
          subscription_status=EXCLUDED.subscription_status,mrr_idr=EXCLUDED.mrr_idr,contract_mrr_idr=EXCLUDED.contract_mrr_idr,
          churn_risk_score=EXCLUDED.churn_risk_score,churn_risk_reasons=EXCLUDED.churn_risk_reasons,updated_at=CURRENT_TIMESTAMP`,
          [
            randomUUID(),
            row.merchant_id,
            row.tenant_id,
            day,
            Number(row.daily_revenue ?? 0),
            Number(row.daily_transaction_count ?? 0),
            days <= 1,
            row.last_activity_at,
            days,
            Number(row.active_days_last_7 ?? 0),
            Math.round(trend * 100) / 100,
            Number(row.distinct_features),
            row.subscription_status,
            row.subscription_status === "ACTIVE" ? Number(row.contract_value) : 0,
            row.subscription_status && row.subscription_status !== "CANCELED" ? Number(row.contract_value) : 0,
            score.score,
            JSON.stringify(score.reasons)
          ]
        );
      }
      if (!options.dryRun) await recordHealthOutcome(tx, runId, started, "SUCCESS", rows.length);
      return { runId, evaluated: rows.length, written: options.dryRun ? 0 : rows.length, skipped: false };
    });
  } catch (error) {
    if (!options.dryRun) {
      try {
        await recordHealthOutcome(db, runId, started, "FAILED", 0, /^[0-9A-Z]{5}$/.test(error?.code) ? error.code : "HEALTH_EXECUTION_FAILED");
      } catch {
        console.error("[cron/merchant-health] failure history unavailable", { runId });
      }
    }
    throw error;
  }
}

// src/server/merchantHealthHandler.ts
function createMerchantHealthHandler(connect = () => connectDb({ schema: "internal", max: 2 })) {
  let database;
  return async (req, res) => {
    const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
    const actual = String(req.headers.authorization || "");
    if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED_CRON" });
    }
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    if (!isCronJobEnabled("merchant-health")) return res.status(200).json({ ok: true, skipped: true, reason: "JOB_DISABLED" });
    try {
      database ??= connect().catch((error) => {
        database = void 0;
        throw error;
      });
      const result = await runMerchantHealth(await database);
      return res.status(200).json({ ok: true, job: "merchant-health", ...result });
    } catch {
      console.error("[cron/merchant-health] execution failed");
      return res.status(503).json({ ok: false, error: "MERCHANT_HEALTH_UNAVAILABLE" });
    }
  };
}
var merchantHealthHandler_default = createMerchantHealthHandler();
export {
  createMerchantHealthHandler,
  merchantHealthHandler_default as default
};
