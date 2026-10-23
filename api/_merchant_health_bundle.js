// src/server/merchantHealthHandler.ts
import { randomUUID, timingSafeEqual } from "node:crypto";

// services/shared/fullNeon.ts
var fullNeonTargets = {
  production: { branchId: "br-falling-butterfly-az989m86", host: "ep-twilight-moon-azqj69l8.c-3.ap-southeast-1.aws.neon.tech", database: "neondb", authUrl: "https://ep-twilight-moon-azqj69l8.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth", publicBucket: "blog-media", privateBucket: "business-files" },
  staging: { branchId: "br-morning-darkness-azwfti4c", host: "ep-flat-recipe-azti3hh0.c-3.ap-southeast-1.aws.neon.tech", database: "newhope_full_neon_staging", authUrl: "https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth", publicBucket: "full-neon-public-media", privateBucket: "full-neon-business-files" }
};
function fullNeonConfig(env = process.env) {
  const selection = env.FULL_NEON_TARGET;
  if (selection !== "production" && selection !== "staging") throw Error("FULL_NEON_TARGET_REQUIRED");
  const target = fullNeonTargets[selection];
  if (["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "GATEWAY_URL"].some((k) => env[k]?.trim())) throw Error("FULL_NEON_LEGACY_RUNTIME_CONFIGURATION_FORBIDDEN");
  if (selection === "production" && (env.APP_URL !== "https://kasir.newhope.space" || env.NEON_AUTH_EMAIL_READY !== "1" || env.NEON_AUTH_GOOGLE_READY !== "1" || !env.ADMIN_MFA_ENCRYPTION_KEY)) throw Error("FULL_NEON_PRODUCTION_AUTH_ACCEPTANCE_REQUIRED");
  if (env.FULL_NEON_CLEAN_START !== "1" || env.AUTH_PROVIDER !== "neon" || env.STORAGE_PROVIDER !== "neon" || env.NEON_PROJECT_ID !== "steep-sea-66546931" || env.NEON_BRANCH_ID !== target.branchId || env.NEON_DB_PHASE1 === "1" || env.DOKU_PAYMENTS_ENABLED !== "0") throw Error("FULL_NEON_CONFIGURATION_MISMATCH");
  if (env.NEON_AUTH_BASE_URL !== target.authUrl || env.NEON_AUTH_JWKS_URL && env.NEON_AUTH_JWKS_URL !== target.authUrl + "/.well-known/jwks.json") throw Error("FULL_NEON_AUTH_BRANCH_MISMATCH");
  if (env.VERCEL_ENV === "production" && selection !== "production") throw Error("FULL_NEON_STAGING_CANNOT_SERVE_PRODUCTION");
  return { ...target, issuer: new URL(target.authUrl).origin, jwksUrl: target.authUrl + "/.well-known/jwks.json" };
}
function assertFullNeonDatabase(connectionString, env = process.env) {
  const t = fullNeonConfig(env), u = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(u.protocol) || u.hostname.replace("-pooler", "") !== t.host || u.pathname !== "/" + t.database || u.username !== "newhope_clean_runtime" || u.hash || u.port && u.port !== "5432" || [...u.searchParams.keys()].some((k) => !["sslmode", "channel_binding", "application_name"].includes(k))) throw Error("FULL_NEON_DATABASE_ROLE_OR_ENDPOINT_MISMATCH");
}
var fullNeonMaintenance = (env = process.env) => env.FULL_NEON_CLEAN_START === "1" && env.FULL_NEON_MAINTENANCE === "1";

// services/shared/db.ts
import fs2 from "node:fs";

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
  capture: "build/neon/source-business-release-2026-10-19.pgp.b64",
  ciphertextSha256: "91df2933285ecb71d1a15e5f4a92c7f45012f6eeec842fe4329439aa6e7235d6",
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
  if (env.FULL_NEON_CLEAN_START === "1") {
    assertFullNeonDatabase(connectionString, env);
    return;
  }
  const url = new URL(connectionString), neon = /(?:^|\.)neon\.(?:tech|build)$/.test(url.hostname);
  if (env.NEON_DB_PHASE1 !== "1") {
    if (neon && (!env.AUTH_PROVIDER || env.AUTH_PROVIDER === "supabase") && (env.VERCEL === "1" || env.VERCEL_ENV === "production")) throw Error("HYBRID_EXPLICIT_MODE_REQUIRED");
    return;
  }
  const { target } = hybridPhase1Config(env);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.replace("-pooler", "") !== target.host || url.pathname !== "/" + target.database || decodeURIComponent(url.username) !== "newhope_runtime_login" || url.hash || url.port && url.port !== "5432" || [...url.searchParams.keys()].some((k) => !["sslmode", "channel_binding", "application_name"].includes(k))) throw Error("HYBRID_DATABASE_ROLE_OR_ENDPOINT_MISMATCH");
}

// services/shared/db.ts
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
  const budget = Number.isInteger(max) && max > 0 ? Math.min(max, 20) : 4;
  return {
    // Each warm function owns a pool; keep the per-instance budget small.
    max: vercel === "1" ? Math.min(budget, 2) : budget,
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

// services/shared/db.ts
pg.types.setTypeParser(1700, (v) => v === null ? null : Number(v));
pg.types.setTypeParser(20, (v) => v === null ? null : Number(v));
function konfigurasiSsl(connectionString) {
  const url = connectionString.toLowerCase();
  const lokal = url.includes("@127.0.0.1") || url.includes("@localhost") || url.includes("sslmode=disable");
  if (lokal) return void 0;
  if (process.env.PGSSLROOTCERT) {
    return { ca: fs2.readFileSync(process.env.PGSSLROOTCERT, "utf8"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}
async function connectDb(opts) {
  if (fullNeonMaintenance()) throw Error("FULL_NEON_MAINTENANCE");
  const connectionString = serverlessConnectionString(
    opts.connectionString || process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5432/postgres"
  );
  assertHybridDatabase(connectionString);
  if (process.env.AUTH_PROVIDER === "better-auth" && (process.env.NEON_RUNTIME_ROLES_REQUIRED === "1" || process.env.VERCEL_ENV === "production")) {
    const configured = new URL(process.env.DATABASE_URL || ""), actual = new URL(connectionString);
    if (decodeURIComponent(actual.username) !== "newhope_runtime_login" || actual.hostname.replace("-pooler", "") !== configured.hostname.replace("-pooler", "") || actual.pathname !== configured.pathname) throw Error("NEON_APPLICATION_ROLE_REQUIRED");
  }
  const pool = new pg.Pool({
    .../(?:^|\.)neon\.(?:tech|build)$/.test(new URL(connectionString).hostname) ? databaseTransport(connectionString) : { connectionString, ssl: konfigurasiSsl(connectionString) },
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

// services/shared/cron.ts
function isCronJobEnabled(job) {
  if (fullNeonMaintenance()) return false;
  const configured = process.env.CRON_ENABLED_JOBS;
  if (configured === void 0) return true;
  return configured.split(",").map((value) => value.trim()).filter(Boolean).includes(job);
}

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

// src/server/merchantHealthHandler.ts
function createMerchantHealthHandler(connect = () => connectDb({
  schema: "internal",
  max: 2,
  connectionString: process.env.FULL_NEON_CLEAN_START === "1" ? process.env.DATABASE_URL : process.env.ANALYTICS_DATABASE_URL || process.env.DATABASE_URL
})) {
  let opening;
  return async (req, res) => {
    const expected = process.env.CRON_SECRET ? "Bearer " + process.env.CRON_SECRET : "", actual = String(req.headers.authorization || "");
    if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return res.status(401).json({ ok: false, error: "UNAUTHORIZED_CRON" });
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    if (!isCronJobEnabled("merchant-health")) return res.status(200).json({ ok: true, skipped: true, reason: "JOB_DISABLED" });
    const started = Date.now(), runId = randomUUID();
    try {
      opening ??= connect().catch((e) => {
        opening = void 0;
        throw e;
      });
      const db = await opening;
      const outcome = await db.tx(async (c) => {
        if (!(await c.query("SELECT pg_try_advisory_xact_lock(hashtext('newhope:merchant-health')) locked")).rows[0].locked) return { skipped: true };
        const merchants = (await c.query(`SELECT m.id,m.tenant_id,s.status,
      r.last_txn_at,r.daily_revenue,r.daily_transactions,r.active_days,r.rev_7d,r.rev_prior,
      (SELECT count(DISTINCT feature_key)::int FROM internal.feature_usage_events f WHERE f.merchant_id=m.id AND f.occurred_at>=CURRENT_DATE-interval '30 days') features
     FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
     LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id
     LEFT JOIN LATERAL(SELECT max(updated_at) updated_at FROM internal.merchant_health_logs h WHERE h.merchant_id=m.id) h ON true
     LEFT JOIN LATERAL(SELECT max(created_at) last_txn_at,
       coalesce(sum(total_amount) FILTER(WHERE created_at>=CURRENT_DATE),0) daily_revenue,
       count(*) FILTER(WHERE created_at>=CURRENT_DATE)::int daily_transactions,
       count(DISTINCT created_at::date) FILTER(WHERE created_at>=CURRENT_DATE-interval '7 days')::int active_days,
       coalesce(sum(total_amount) FILTER(WHERE created_at>=CURRENT_DATE-interval '7 days'),0) rev_7d,
       coalesce(sum(total_amount) FILTER(WHERE created_at<CURRENT_DATE-interval '7 days'),0) rev_prior
       FROM contract.merchant_revenue x WHERE x.merchant_id=m.id AND x.tenant_id=m.tenant_id AND x.created_at>=CURRENT_DATE-interval '30 days') r ON true
     WHERE t.is_active AND t.merged_into IS NULL AND m.is_active ORDER BY h.updated_at ASC NULLS FIRST,m.id LIMIT 100`)).rows;
        for (const m of merchants) {
          const days = m.last_txn_at ? Math.max(0, Math.min(999, Math.floor((started - new Date(m.last_txn_at).getTime()) / 864e5))) : 999;
          const prior = Number(m.rev_prior) / 23, trend = prior > 0 ? (Number(m.rev_7d) / 7 - prior) / prior * 100 : 0;
          const risk = computeChurnRisk({ daysSinceLastTxn: days, activeDaysLast7: m.active_days, revenueTrendPct: trend, subscriptionStatus: m.status, distinctFeatures: m.features, supportTickets: 0 });
          await c.query(
            `INSERT INTO internal.merchant_health_logs(id,tenant_id,merchant_id,log_date,daily_revenue,daily_transaction_count,last_activity_at,days_since_last_txn,active_days_last_7,revenue_trend_pct,distinct_features_used,subscription_status,churn_risk_score,churn_risk_reasons)
      VALUES($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
      ON CONFLICT(merchant_id,log_date) DO UPDATE SET daily_revenue=EXCLUDED.daily_revenue,daily_transaction_count=EXCLUDED.daily_transaction_count,
       last_activity_at=EXCLUDED.last_activity_at,days_since_last_txn=EXCLUDED.days_since_last_txn,active_days_last_7=EXCLUDED.active_days_last_7,
       revenue_trend_pct=EXCLUDED.revenue_trend_pct,distinct_features_used=EXCLUDED.distinct_features_used,subscription_status=EXCLUDED.subscription_status,
       churn_risk_score=EXCLUDED.churn_risk_score,churn_risk_reasons=EXCLUDED.churn_risk_reasons,updated_at=clock_timestamp()`,
            [randomUUID(), m.tenant_id, m.id, m.daily_revenue, m.daily_transactions, m.last_txn_at, days, m.active_days, Math.max(-9999, Math.min(9999, trend)), m.features, m.status, risk.score, JSON.stringify(risk.reasons)]
          );
        }
        await c.query("INSERT INTO ai.batch_job_runs(id,job_name,started_at,finished_at,status,duration_ms,insights_written) VALUES($1,'merchant-health',$2,clock_timestamp(),'SUCCESS',$3,$4)", [runId, new Date(started).toISOString(), Date.now() - started, merchants.length]);
        return { processed: merchants.length };
      });
      if (outcome.skipped) return res.status(200).json({ ok: true, skipped: true, reason: "ALREADY_RUNNING" });
      return res.status(200).json({ ok: true, job: "merchant-health", runId, merchantsEvaluated: outcome.processed, durationMs: Date.now() - started });
    } catch {
      try {
        const db = await opening;
        if (db) await db.query("INSERT INTO ai.batch_job_runs(id,job_name,started_at,finished_at,status,duration_ms,error_text) VALUES($1,'merchant-health',$2,clock_timestamp(),'FAILED',$3,'MERCHANT_HEALTH_FAILED') ON CONFLICT(id) DO NOTHING", [runId, new Date(started).toISOString(), Date.now() - started]);
      } catch {
      }
      return res.status(503).json({ ok: false, error: "MERCHANT_HEALTH_UNAVAILABLE", runId });
    }
  };
}
var merchantHealthHandler_default = createMerchantHealthHandler();
export {
  createMerchantHealthHandler,
  merchantHealthHandler_default as default
};
