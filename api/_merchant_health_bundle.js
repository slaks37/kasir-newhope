// neon/targets/hybrid-staging.json
var hybrid_staging_default = {
  projectId: "steep-sea-66546931",
  branchId: "br-weathered-tooth-azbwi2zz",
  host: "ep-ancient-bar-azuss0by.c-3.ap-southeast-1.aws.neon.tech",
  database: "neondb",
  default: false,
  purpose: "hybrid-staging",
  capture: "build/neon/source-recovery-drive-readback.pgp.b64",
  ciphertextSha256: "377c2db8f659de17a817c38daebfdac4b86dcc4c4c5a8185677889f266f3f136",
  authProvider: "supabase",
  storageProvider: "supabase",
  sourceProject: "fqxrhumsgigcgjtlbfuo",
  productionEligible: false
};

// neon/targets/prelaunch-rehearsal.json
var prelaunch_rehearsal_default = {
  projectId: "steep-sea-66546931",
  branchId: "br-orange-union-azwj2z2e",
  parentBranch: "br-plain-snow-azjwwq6u",
  host: "ep-long-glade-azcugn8m.c-3.ap-southeast-1.aws.neon.tech",
  database: "neondb",
  sourceProject: "fqxrhumsgigcgjtlbfuo",
  default: false,
  productionEligible: false,
  purpose: "Synthetic prelaunch rehearsal child; clean candidate must remain unchanged"
};

// neon/targets/hybrid-candidate.json
var hybrid_candidate_default = {
  projectId: "steep-sea-66546931",
  branchId: "br-plain-snow-azjwwq6u",
  host: "ep-mute-rice-az97uhq3.c-3.ap-southeast-1.aws.neon.tech",
  default: false,
  productionEligible: false,
  database: "neondb",
  sourceProject: "fqxrhumsgigcgjtlbfuo",
  purpose: "Prelaunch hybrid business-only clean candidate; no Better Auth or identity remapping",
  capture: "build/neon/source-business-prelaunch-2026-10-16.pgp.b64",
  ciphertextSha256: "9693057f6a384874b0c5b5dc544176aec298c6d8fb249704b37a0dfcefc8df6f",
  sourceFrozen: false
};

// services/shared/hybridPhase1.ts
function hybridPhase1Config(env = process.env) {
  if (env.HYBRID_REHEARSAL_TARGET && env.HYBRID_REHEARSAL_TARGET !== "prelaunch-rehearsal") throw Error("HYBRID_REHEARSAL_TARGET_INVALID");
  if (env.HYBRID_REHEARSAL_TARGET && env.HYBRID_STAGING !== "1") throw Error("HYBRID_REHEARSAL_STAGING_REQUIRED");
  if (env.HYBRID_RELEASE_TARGET && env.HYBRID_RELEASE_TARGET !== "hybrid-candidate") throw Error("HYBRID_RELEASE_TARGET_INVALID");
  if (env.HYBRID_RELEASE_TARGET && env.HYBRID_REHEARSAL_TARGET) throw Error("HYBRID_TARGET_FLAGS_CONFLICT");
  const target = env.HYBRID_RELEASE_TARGET === "hybrid-candidate" ? hybrid_candidate_default : env.HYBRID_REHEARSAL_TARGET === "prelaunch-rehearsal" ? prelaunch_rehearsal_default : hybrid_staging_default;
  if (env.HYBRID_RELEASE_TARGET && !target.productionEligible) throw Error("HYBRID_RELEASE_TARGET_NOT_APPROVED");
  if (env.NEON_DB_PHASE1 !== "1") throw Error("HYBRID_EXPLICIT_MODE_REQUIRED");
  if (env.AUTH_PROVIDER !== "supabase" || env.STORAGE_PROVIDER !== "supabase" || env.VITE_AUTH_PROVIDER !== "supabase" || env.BETTER_AUTH_MIGRATION_PILOT === "1" || env.NEON_MIGRATION_PILOT === "1") throw Error("HYBRID_PROVIDER_MISMATCH");
  const source = "https://" + target.sourceProject + ".supabase.co";
  if (env.SUPABASE_URL !== source || env.VITE_SUPABASE_URL !== source) throw Error("HYBRID_SOURCE_AUTH_MISMATCH");
  if (env.NEON_PROJECT_ID !== target.projectId || env.NEON_BRANCH_ID !== target.branchId) throw Error("HYBRID_BRANCH_MISMATCH");
  if ((env.VERCEL_ENV === "production" || env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && env.APP_ENV !== "staging") && !target.productionEligible) throw Error("HYBRID_PRODUCTION_TARGET_NOT_APPROVED");
  return { target, source, staging: env.HYBRID_STAGING === "1" };
}
function assertHybridDatabase(connectionString, env = process.env) {
  const url = new URL(connectionString), neon = /(?:^|\.)neon\.(?:tech|build)$/.test(url.hostname);
  if (env.NEON_DB_PHASE1 !== "1") {
    if (neon && (!env.AUTH_PROVIDER || env.AUTH_PROVIDER === "supabase") && (env.VERCEL === "1" || env.VERCEL_ENV === "production")) throw Error("HYBRID_EXPLICIT_MODE_REQUIRED");
    return;
  }
  const { target } = hybridPhase1Config(env);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.replace("-pooler", "") !== target.host || url.pathname !== "/" + target.database || decodeURIComponent(url.username) !== "newhope_runtime_login" || url.hash || url.port && url.port !== "5432" || [...url.searchParams.keys()].some((k) => !["sslmode", "channel_binding", "application_name"].includes(k))) throw Error("HYBRID_DATABASE_ROLE_OR_ENDPOINT_MISMATCH");
}

// src/server/merchantHealthHandler.ts
import pg from "pg";
import { randomUUID } from "node:crypto";

// services/shared/cron.ts
function isCronJobEnabled(job) {
  const configured = process.env.CRON_ENABLED_JOBS;
  if (configured === void 0) return true;
  return configured.split(",").map((value) => value.trim()).filter(Boolean).includes(job);
}

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
  const budget = Number.isInteger(max) && max > 0 ? Math.min(max, 20) : 4;
  return {
    // Each warm function owns a pool; keep the per-instance budget small.
    max: vercel === "1" ? Math.min(budget, 2) : budget,
    idleTimeoutMillis: vercel === "1" ? 5e3 : 3e4,
    connectionTimeoutMillis: 1e4
  };
}

// services/shared/databaseTls.ts
import fs from "node:fs";
function databaseTransport(connectionString, env = process.env) {
  const url = new URL(connectionString);
  const neon = /(?:^|\.)neon\.(?:tech|build)$/.test(url.hostname);
  if (neon) {
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash || [...url.searchParams.keys()].some((key) => !["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat", "channel_binding", "application_name"].includes(key)))
      throw Error("DATABASE_CONNECTION_OVERRIDE_REJECTED");
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
    return { connectionString: url.href, ssl: { rejectUnauthorized: true } };
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (local || url.searchParams.get("sslmode") === "disable") return { connectionString, ssl: void 0 };
  return { connectionString, ssl: env.PGSSLROOTCERT ? { ca: fs.readFileSync(env.PGSSLROOTCERT, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: false } };
}

// src/server/merchantHealthHandler.ts
var pool = null;
function getPool() {
  if (!pool) {
    assertHybridDatabase(process.env.ANALYTICS_DATABASE_URL || process.env.DATABASE_URL || "");
    pool = new pg.Pool({
      ...databaseTransport(serverlessConnectionString(process.env.ANALYTICS_DATABASE_URL || process.env.DATABASE_URL || "")),
      ...databasePoolLimits(3)
    });
  }
  return pool;
}
async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED_CRON" });
  }
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  if (!isCronJobEnabled("merchant-health")) return res.status(200).json({ ok: true, skipped: true, reason: "JOB_DISABLED" });
  const startedAt = Date.now();
  const runId = `cron-health-${randomUUID()}`;
  const db = getPool();
  try {
    await db.query(
      `INSERT INTO batch_job_runs (id, job_name, started_at, status)
       VALUES ($1, 'merchant-health', CURRENT_TIMESTAMP, 'RUNNING')
       ON CONFLICT (id) DO NOTHING`,
      [runId]
    );
    const { rows: merchants } = await db.query(
      `SELECT t.id, t.name,
              COUNT(tx.id)::int as txn_count_30d,
              COALESCE(SUM(tx.total_amount), 0)::numeric as revenue_30d,
              MAX(tx.created_at) as last_txn_at
         FROM internal.tenants t
         LEFT JOIN pos.transactions tx ON tx.tenant_id = t.id AND tx.created_at >= NOW() - INTERVAL '30 days'
        WHERE t.merged_into IS NULL
        GROUP BY t.id, t.name`
    );
    let logged = 0;
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    for (const m of merchants) {
      const daysSinceLastTxn = m.last_txn_at ? Math.max(0, Math.floor((Date.now() - new Date(m.last_txn_at).getTime()) / (1e3 * 60 * 60 * 24))) : 99;
      let churnScore = 0.1;
      let healthBand = "HEALTHY";
      if (daysSinceLastTxn >= 14) {
        churnScore = 0.85;
        healthBand = "CRITICAL";
      } else if (daysSinceLastTxn >= 7) {
        churnScore = 0.55;
        healthBand = "AT_RISK";
      } else if (daysSinceLastTxn >= 3) {
        churnScore = 0.3;
        healthBand = "WATCH";
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
          JSON.stringify({ daysSinceLastTxn, revenue30d: m.revenue_30d, txnCount: m.txn_count_30d })
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
      job: "merchant-health",
      runId,
      merchantsEvaluated: merchants.length,
      durationMs
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    try {
      await db.query(
        `UPDATE batch_job_runs
            SET finished_at = CURRENT_TIMESTAMP,
                status = 'FAILED',
                duration_ms = $2,
                error_message = $3
          WHERE id = $1`,
        [runId, durationMs, error?.message || "UNKNOWN_ERROR"]
      );
    } catch {
    }
    console.error("[cron/merchant-health] error:", error);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR", runId });
  }
}
export {
  handler as default
};
