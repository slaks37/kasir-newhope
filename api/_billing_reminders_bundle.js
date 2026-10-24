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
  if (env.FULL_NEON_CLEAN_START !== "1" || env.AUTH_PROVIDER !== "neon" || env.STORAGE_PROVIDER !== "neon" || env.NEON_PROJECT_ID !== "steep-sea-66546931" || env.NEON_BRANCH_ID !== target.branchId || env.NEON_DB_PHASE1 === "1" || !["0", "1"].includes(env.DOKU_PAYMENTS_ENABLED || "")) throw Error("FULL_NEON_CONFIGURATION_MISMATCH");
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
var hybridExternalWritesBlocked = (env = process.env) => env.NEON_DB_PHASE1 === "1" && env.HYBRID_STAGING === "1";

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
  const pool2 = new pg.Pool({
    .../(?:^|\.)neon\.(?:tech|build)$/.test(new URL(connectionString).hostname) ? databaseTransport(connectionString) : { connectionString, ssl: konfigurasiSsl(connectionString) },
    // Kecil dengan sengaja. Di pengembangan, keempat service berbagi satu
    // batas koneksi di db-server; pool besar per service akan menghabiskannya
    // dan membuat service yang menyala terakhir gagal tersambung.
    ...databasePoolLimits(opts.max ?? Number(process.env.PGPOOL_MAX || 4))
  });
  void opts.schema;
  pool2.on("error", (err) => {
    console.error("[db] koneksi idle bermasalah:", err.message);
  });
  await waitForDatabase(async () => {
    const probe = await pool2.connect();
    probe.release();
  }).catch(async (error) => {
    await pool2.end().catch(() => {
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
      const client = await pool2.connect();
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
      await pool2.end();
    }
  });
  return wrap(pool2);
}

// services/billing/reminders.ts
import { randomUUID } from "node:crypto";
async function runBillingReminders(db, deps, options = {}) {
  const now = options.now || /* @__PURE__ */ new Date();
  const dryRun = options.dryRun !== false;
  const { rows } = await db.query(`SELECT s.id,s.current_period_end,s.status,s.revision,
    t.owner_user_ref,t.name AS merchant_name,p.name AS plan_name,
    CASE WHEN s.current_period_end <= $1::timestamptz+interval '1 day' THEN 'H1' ELSE 'H3' END AS kind
    FROM billing.subscriptions s JOIN billing.plans p ON p.id=s.plan_id
    JOIN internal.tenants t ON t.id=s.tenant_id
    WHERE t.is_active AND s.status IN ('ACTIVE','TRIAL','TRIALING')
    AND ((s.current_period_end > $1::timestamptz AND s.current_period_end <= $1::timestamptz+interval '1 day')
      OR (s.current_period_end > $1::timestamptz+interval '2 days' AND s.current_period_end <= $1::timestamptz+interval '3 days'))
    ORDER BY s.current_period_end,s.id LIMIT 1001`, [now.toISOString()]);
  if (rows.length > 1e3) throw new Error("REMINDER_BATCH_TOO_LARGE");
  const result = { dryRun, candidates: rows.length, accepted: 0, skipped: 0, unverifiedOwners: 0, failed: 0, review: 0 };
  if (dryRun) return result;
  if (!options.from || !options.appUrl || new URL(options.appUrl).protocol !== "https:") {
    throw new Error("REMINDER_SENDER_AND_HTTPS_APP_URL_REQUIRED");
  }
  for (const sub of rows) {
    try {
      const email = await deps.verifiedOwnerEmail(sub.owner_user_ref);
      if (!email) {
        result.skipped++;
        result.unverifiedOwners++;
        continue;
      }
      const end = new Date(sub.current_period_end).toISOString();
      const payload = {
        from: options.from,
        to: email,
        subject: `Pengingat masa aktif ${sub.kind === "H3" ? "H-3" : "H-1"} New Hope POS`,
        // Plain text avoids injecting merchant-controlled HTML.
        text: `Halo ${sub.merchant_name},

Masa aktif ${sub.plan_name} berakhir pada ${new Date(end).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB.
Periksa langganan Anda di ${options.appUrl.replace(/\/$/, "")}/#settings.

Email ini adalah pengingat, bukan bukti pembayaran.
Tim New Hope POS`
      };
      const claim = await db.tx(async (c) => {
        const inserted = await c.query(
          `INSERT INTO billing.reminder_deliveries
          (id,subscription_id,period_end,kind,state,payload,first_attempt_at,last_attempt_at)
          SELECT $1,s.id,$3,$4,'SENDING',$5::jsonb,$6,$6 FROM billing.subscriptions s
          JOIN internal.tenants t ON t.id=s.tenant_id
          WHERE s.id=$2 AND s.current_period_end=$3 AND s.revision=$7 AND t.is_active
          AND t.owner_user_ref=$8 AND s.status IN ('ACTIVE','TRIAL','TRIALING')
          ON CONFLICT(subscription_id,period_end,kind) DO NOTHING RETURNING *`,
          [randomUUID(), sub.id, end, sub.kind, JSON.stringify(payload), now.toISOString(), sub.revision, sub.owner_user_ref]
        );
        if (inserted.rows[0]) return inserted.rows[0];
        const existing = (await c.query(`SELECT * FROM billing.reminder_deliveries
          WHERE subscription_id=$1 AND period_end=$2 AND kind=$3 FOR UPDATE`, [sub.id, end, sub.kind])).rows[0];
        if (!existing || existing.state === "SENT") return null;
        if (existing.state === "REVIEW") {
          result.review++;
          return null;
        }
        if (existing.state === "SENDING" && now.getTime() - Date.parse(existing.last_attempt_at) < 10 * 6e4) return null;
        if (now.getTime() - Date.parse(existing.first_attempt_at) >= 23 * 60 * 6e4 || existing.payload.to !== email) {
          await c.query("UPDATE billing.reminder_deliveries SET state='REVIEW',error_code='RETRY_WINDOW_OR_RECIPIENT_CHANGED' WHERE id=$1", [existing.id]);
          result.review++;
          return null;
        }
        const current = await c.query(`SELECT s.id FROM billing.subscriptions s JOIN internal.tenants t ON t.id=s.tenant_id
          WHERE s.id=$1 AND s.current_period_end=$2 AND s.revision=$3 AND s.status IN ('ACTIVE','TRIAL','TRIALING')
          AND t.is_active AND t.owner_user_ref=$4`, [sub.id, end, sub.revision, sub.owner_user_ref]);
        if (!current.rowCount) return null;
        await c.query("UPDATE billing.reminder_deliveries SET state='SENDING',last_attempt_at=$2 WHERE id=$1", [existing.id, now.toISOString()]);
        return existing;
      });
      if (!claim) {
        result.skipped++;
        continue;
      }
      try {
        const id = await deps.send(claim.payload, `billing-reminder/${claim.id}`);
        if (!id) throw new Error("MISSING_PROVIDER_ID");
        await db.query("UPDATE billing.reminder_deliveries SET state='SENT',provider_id=$2,error_code=NULL WHERE id=$1", [claim.id, id]);
        result.accepted++;
      } catch {
        await db.query("UPDATE billing.reminder_deliveries SET state='FAILED',error_code='DELIVERY_NOT_CONFIRMED' WHERE id=$1 AND state<>'SENT'", [claim.id]);
        result.failed++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}

// services/billing/reminderProvider.ts
import { createClient } from "@supabase/supabase-js";
import { Resend as Resend2 } from "resend";

// services/shared/neonAuthDatabase.ts
import pg2 from "pg";
var pool;
function neonAuthDatabase() {
  if (!pool) {
    const t = fullNeonConfig(), url = new URL(process.env.NEON_AUTH_DATABASE_URL || process.env.DATABASE_URL || "");
    if (url.hostname.replace("-pooler", "") !== t.host || url.pathname !== "/neondb" || url.username !== "newhope_clean_runtime") throw Error("MANAGED_AUTH_DATABASE_BINDING_REQUIRED");
    pool = new pg2.Pool({ ...databaseTransport(url.href), max: 2, connectionTimeoutMillis: 5e3, statement_timeout: 8e3 });
  }
  return { query: async (sql, p) => {
    const r = await pool.query(sql, p);
    return { rows: r.rows, rowCount: r.rowCount || 0 };
  } };
}
async function managedOwnerIdentity(subject) {
  if (!/^[0-9a-f-]{36}$/i.test(subject)) return null;
  const row = (await neonAuthDatabase().query('SELECT id,email,"emailVerified",banned FROM neon_auth."user" WHERE id::text=$1', [subject])).rows[0];
  return row && !row.banned ? { email: row.email, verified: row.emailVerified === true } : null;
}

// services/shared/betterAuth.ts
import { betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { PostgresDialect } from "kysely";
import pg3 from "pg";
import { randomUUID as randomUUID2 } from "node:crypto";

// neon/targets/full-restore.json
var full_restore_default = {
  projectId: "steep-sea-66546931",
  branchId: "br-curly-truth-aze21ktf",
  parentId: "br-falling-butterfly-az989m86",
  host: "ep-plain-dream-azghoyf7.c-3.ap-southeast-1.aws.neon.tech",
  database: "neondb",
  region: "aws-ap-southeast-1",
  default: false,
  purpose: "isolated full source restore and production-candidate rehearsal"
};

// services/shared/neonTargets.ts
var neonMigrationTargets = [
  { projectId: "steep-sea-66546931", branchId: "br-icy-dust-azqi5vlc", host: "ep-damp-pine-azrnsoge.c-3.ap-southeast-1.aws.neon.tech", database: "neondb", purpose: "synthetic" },
  { ...full_restore_default, purpose: "restore" }
];
function verifiedNeonTarget(env) {
  const target = neonMigrationTargets.find((t) => t.projectId === env.NEON_PROJECT_ID && t.branchId === env.NEON_BRANCH_ID);
  if (!target) throw Error("BETTER_AUTH_STAGING_BRANCH_MISMATCH");
  return target;
}

// services/shared/betterAuthPilot.ts
function betterAuthPilotConfig(env = process.env) {
  const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && env.APP_ENV !== "staging";
  if (env.BETTER_AUTH_MIGRATION_PILOT !== "1" || production && env.NEON_PRODUCTION_CUTOVER_APPROVED !== "1") throw Error("BETTER_AUTH_PRODUCTION_CUTOVER_BLOCKED");
  const target = verifiedNeonTarget(env);
  if (production && !["cutover-approved"].includes(target.purpose)) throw Error("BETTER_AUTH_PRODUCTION_CUTOVER_BLOCKED");
  if (!env.DATABASE_URL) throw Error("BETTER_AUTH_APPLICATION_DATABASE_REQUIRED");
  const databaseUrl = env.BETTER_AUTH_DATABASE_URL || env.DATABASE_URL || env.NEON_STAGING_DATABASE_URL || "";
  const database2 = new URL(databaseUrl), app = new URL(env.BETTER_AUTH_URL || "");
  if (database2.hostname.replace("-pooler", "") !== target.host) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  if (database2.pathname !== "/neondb" || !["postgres:", "postgresql:"].includes(database2.protocol)) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  for (const value of [env.DATABASE_URL, env.BETTER_AUTH_DATABASE_URL, env.NEON_STAGING_DATABASE_URL].filter(Boolean)) {
    const u = new URL(value);
    if (u.hostname.replace("-pooler", "") !== database2.hostname.replace("-pooler", "") || u.pathname !== "/neondb" || !["postgres:", "postgresql:"].includes(u.protocol) || u.port && u.port !== "5432" || u.hash || [...u.searchParams.keys()].some((k) => !["sslmode", "channel_binding", "application_name"].includes(k))) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  }
  if (app.username || app.password || app.pathname !== "/" || app.search || app.hash) throw Error("INVALID_BETTER_AUTH_ORIGIN");
  if (app.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["127.0.0.1", "localhost"].includes(app.hostname))) throw Error("BETTER_AUTH_HTTPS_REQUIRED");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 48) throw Error("BETTER_AUTH_SECRET_REQUIRED");
  const allowedOrigins = [.../* @__PURE__ */ new Set([app.origin, ...(env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)])];
  for (const origin of allowedOrigins) {
    const u = new URL(origin);
    if (u.origin !== origin || u.username || u.password || u.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["127.0.0.1", "localhost"].includes(u.hostname))) throw Error("INVALID_BETTER_AUTH_ORIGIN");
  }
  if (production) {
    const application = new URL(env.DATABASE_URL);
    if (application.username !== "newhope_runtime_login" || database2.username !== "newhope_auth_runtime_login" || application.href === database2.href) throw Error("BETTER_AUTH_LEAST_PRIVILEGE_REQUIRED");
    if (app.origin !== "https://kasir.newhope.space" || allowedOrigins.length !== 2 || !allowedOrigins.includes("https://admin.newhope.space") || allowedOrigins.some((s) => !["https://kasir.newhope.space", "https://admin.newhope.space"].includes(s))) throw Error("BETTER_AUTH_PRODUCTION_ORIGIN_MISMATCH");
    if (env.STORAGE_PROVIDER !== "neon" || env.AUTH_EMAIL_ENABLED !== "1") throw Error("BETTER_AUTH_PRODUCTION_DEPENDENCIES_REQUIRED");
  }
  return { databaseUrl, baseUrl: app.origin, secret: env.BETTER_AUTH_SECRET, allowedOrigins };
}

// services/shared/betterAuthEmail.ts
import { createHash } from "node:crypto";
import { Resend } from "resend";

// services/shared/authReturnUrl.ts
function authReturnUrl(kind, value, baseUrl, allowedOrigins = [baseUrl]) {
  const path = kind === "RESET" ? "/reset-password" : "/login";
  if (value === void 0 || value === null || value === "") return baseUrl + path;
  if (typeof value !== "string") throw Error("AUTH_CALLBACK_REJECTED");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("AUTH_CALLBACK_REJECTED");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== path || !allowedOrigins.includes(url.origin) || url.href !== url.origin + path) throw Error("AUTH_CALLBACK_REJECTED");
  return url.href;
}

// services/shared/betterAuthEmail.ts
function authEmailPayload(mail, env = process.env) {
  const origin = new URL(mail.baseUrl), link = new URL(mail.url);
  if (origin.origin !== mail.baseUrl || link.origin !== mail.baseUrl || (mail.kind === "RESET" ? !/^\/api\/auth\/reset-password\/[^/]+$/.test(link.pathname) : link.pathname !== "/api/auth/verify-email")) throw Error("AUTH_EMAIL_URL_REJECTED");
  if (link.protocol !== "https:") throw Error("AUTH_EMAIL_HTTPS_REQUIRED");
  const callbacks = link.searchParams.getAll("callbackURL");
  if (callbacks.length !== 1) throw Error("AUTH_CALLBACK_REJECTED");
  authReturnUrl(mail.kind, callbacks[0], mail.baseUrl, [mail.baseUrl, ...(env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(mail.email)) throw Error("AUTH_EMAIL_RECIPIENT_REJECTED");
  if (env.AUTH_EMAIL_ENABLED !== "1" || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM || !env.AUTH_EMAIL_VERIFIED_DOMAIN)
    throw Error("AUTH_EMAIL_PROVIDER_NOT_CONFIGURED");
  const sender = env.AUTH_EMAIL_FROM.match(/^(?:[^<>\r\n]+<)?([^<>\s@,;]+@[^<>\s@,;]+)(?:>)?$/)?.[1];
  if (!sender || sender.split("@")[1].toLowerCase() !== env.AUTH_EMAIL_VERIFIED_DOMAIN.toLowerCase()) throw Error("AUTH_EMAIL_SENDER_REJECTED");
  if (env.VERCEL_ENV === "preview" || env.APP_ENV === "staging") {
    const allowed = (env.AUTH_EMAIL_ALLOWED_RECIPIENTS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(mail.email.toLowerCase())) throw Error("AUTH_EMAIL_STAGING_RECIPIENT_NOT_APPROVED");
  }
  const text = mail.kind === "RESET" ? "Atur password New Hope Anda" : "Verifikasi email New Hope Anda";
  const safeUrl = mail.url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const key = createHash("sha256").update(mail.kind + ":" + mail.email + ":" + mail.url).digest("hex");
  return { payload: {
    from: env.AUTH_EMAIL_FROM,
    to: mail.email,
    replyTo: "stefen@newsystem.space",
    subject: text,
    text: text + ". Buka tautan ini (berlaku 15 menit): " + mail.url + "\nJika Anda tidak meminta ini, abaikan email dan hubungi dukungan.",
    html: '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' + text + "</title></head><body><h1>" + text + '</h1><p>Tautan berlaku 15 menit.</p><p><a href="' + safeUrl + '">' + text + "</a></p><p>Jika Anda tidak meminta ini, abaikan email dan hubungi stefen@newsystem.space.</p></body></html>"
  }, idempotencyKey: "newhope-auth-" + key };
}
async function sendBetterAuthEmail(mail) {
  const { payload, idempotencyKey } = authEmailPayload(mail);
  const response = await new Resend(process.env.RESEND_API_KEY).emails.send(payload, { idempotencyKey });
  if (response.error || !response.data?.id) throw Error("AUTH_EMAIL_DELIVERY_FAILED");
}

// services/shared/betterAuth.ts
function createBetterAuthRuntime(config = betterAuthPilotConfig(), sendEmail = sendBetterAuthEmail) {
  const pool2 = new pg3.Pool({ ...databaseTransport(config.databaseUrl), ...databasePoolLimits(2) });
  const auth = betterAuth({
    appName: "New Hope POS",
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret: config.secret,
    database: { dialect: new PostgresDialect({ pool: pool2 }), type: "postgres", schemaName: "newhope_auth" },
    trustedOrigins: config.allowedOrigins || [config.baseUrl],
    telemetry: { enabled: false },
    logger: { disabled: true },
    advanced: { database: { generateId: () => randomUUID2() }, useSecureCookies: config.baseUrl.startsWith("https://") },
    user: { additionalFields: { isActive: { type: "boolean", defaultValue: true, required: true, input: false } } },
    session: { expiresIn: 3600, updateAge: 900, cookieCache: { enabled: false }, freshAge: 3600 },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendEmail({ kind: "RESET", email: user.email, url, baseUrl: config.baseUrl })
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 900,
      sendVerificationEmail: async ({ user, url }) => sendEmail({ kind: "VERIFY", email: user.email, url, baseUrl: config.baseUrl })
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/send-verification-email": { window: 3600, max: 3 }
      }
    },
    plugins: [bearer({ requireSignature: true }), twoFactor({
      issuer: "New Hope POS",
      skipVerificationOnEnable: false,
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 }
    })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (["/request-password-reset", "/sign-up/email", "/send-verification-email"].includes(ctx.path) && ctx.body) {
          const reset = ctx.path === "/request-password-reset", field = reset ? "redirectTo" : "callbackURL";
          try {
            ctx.body[field] = authReturnUrl(reset ? "RESET" : "VERIFY", ctx.body[field], config.baseUrl, config.allowedOrigins);
          } catch {
            throw new APIError("BAD_REQUEST", { message: "Tautan kembali autentikasi tidak valid.", code: "AUTH_CALLBACK_REJECTED" });
          }
        }
        if (ctx.path.startsWith("/two-factor/") && ctx.body) ctx.body.trustDevice = false;
        if (["/two-factor/enable", "/two-factor/disable", "/two-factor/generate-backup-codes"].includes(ctx.path)) {
          const current = await auth.api.getSession({ headers: ctx.headers || new Headers(), query: { disableCookieCache: true } });
          if (current?.user.twoFactorEnabled) {
            const fresh = (await pool2.query(`SELECT 1 FROM newhope_auth.mfa_session_proofs
              WHERE session_id=$1 AND user_id=$2 AND verified_at>now()-interval '10 minutes' AND verified_at<=now()+interval '30 seconds'`, [current.session.id, current.user.id])).rowCount;
            if (!fresh) throw new APIError("FORBIDDEN", { message: "Verifikasi ulang autentikator sebelum mengubah MFA.", code: "REAUTH_REQUIRED" });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/two-factor/verify-totp" || ctx.context.returned instanceof APIError) return;
        const result = ctx.context.returned;
        if (!result?.token || !result.user?.id) return;
        const fresh = ctx.context.newSession;
        const sessionToken = fresh?.session.token || result.token;
        const userId = fresh?.user.id || result.user.id;
        await pool2.query(`INSERT INTO newhope_auth.mfa_session_proofs(session_id,user_id,verified_at)
          SELECT id,"userId",now() FROM newhope_auth.session WHERE token=$1 AND "userId"=$2 AND "expiresAt">now()
          ON CONFLICT(session_id) DO UPDATE SET verified_at=EXCLUDED.verified_at`, [sessionToken, userId]);
      })
    }
  });
  return { auth, pool: pool2, close: () => pool2.end() };
}
var runtime;
function getBetterAuthRuntime() {
  return runtime ??= createBetterAuthRuntime();
}

// services/shared/betterAuthOwner.ts
async function betterOwnerIdentity(subject) {
  if (!/^[0-9a-f-]{36}$/i.test(subject)) return null;
  const { pool: pool2 } = getBetterAuthRuntime();
  const row = (await pool2.query(`SELECT u.email,u."emailVerified" AS verified
    FROM internal.auth_identity_bindings b
    JOIN internal.users c ON c.id=b.canonical_user_id AND c.is_active
    JOIN newhope_auth."user" u ON u.id=b.provider_subject AND u."isActive"
    WHERE b.provider='better-auth' AND b.issuer=$1 AND b.canonical_user_id=$2 AND b.is_active`, [betterAuthPilotConfig().baseUrl, subject])).rows[0];
  return row ? { email: row.email, verified: row.verified === true } : null;
}

// services/billing/reminderProvider.ts
function createReminderProvider() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const better = process.env.AUTH_PROVIDER === "better-auth", neon = process.env.AUTH_PROVIDER === "neon";
  if (!better && !neon && (!url || !key) || !process.env.RESEND_API_KEY) throw new Error("REMINDER_PROVIDER_NOT_CONFIGURED");
  const auth = !better && !neon ? createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5e3) }) }
  }) : null;
  const resend = new Resend2(process.env.RESEND_API_KEY);
  return {
    async verifiedOwnerEmail(subject) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject || "")) return null;
      if (neon) {
        const u = await managedOwnerIdentity(subject);
        return u?.verified ? u.email : null;
      }
      if (better) {
        const u = await betterOwnerIdentity(subject);
        return u?.verified ? u.email : null;
      }
      const { data, error } = await auth.auth.admin.getUserById(subject);
      if (error) {
        if (error.status === 404) return null;
        throw new Error("OWNER_LOOKUP_FAILED");
      }
      const user = data.user;
      if (user?.deleted_at || user?.banned_until && Date.parse(user.banned_until) > Date.now()) return null;
      return user?.id === subject && user.email_confirmed_at && user.email ? user.email : null;
    },
    async send(mail, idempotencyKey) {
      if (hybridExternalWritesBlocked() || process.env.FULL_NEON_CLEAN_START === "1" && process.env.FULL_NEON_TARGET !== "production") throw Error("STAGING_EMAIL_BLOCKED");
      const { data, error } = await resend.emails.send(mail, { idempotencyKey });
      if (error || !data?.id) throw new Error("EMAIL_PROVIDER_REJECTED");
      return data.id;
    }
  };
}

// services/shared/cron.ts
function isCronJobEnabled(job) {
  if (fullNeonMaintenance()) return false;
  const configured = process.env.CRON_ENABLED_JOBS;
  if (configured === void 0) return true;
  return configured.split(",").map((value) => value.trim()).filter(Boolean).includes(job);
}

// services/billing/recovery.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// api/_doku.ts
import crypto from "node:crypto";

// services/billing/dokuChannelEvidence.ts
function dokuChannelEvidence(body) {
  const raw = body?.channel?.id;
  const providerChannel = typeof raw === "string" && /^[A-Z0-9_]{1,100}$/.test(raw) ? raw : "";
  if (providerChannel === "QRIS_DOKU") {
    if (body?.service?.id !== "QRIS" || body?.acquirer?.id !== "DOKU") return { channel: "", providerChannel, issue: "QRIS_CHANNEL_IDENTITY_MISMATCH" };
    return { channel: "QRIS", providerChannel };
  }
  if (providerChannel === "QRIS" && (body?.service?.id !== void 0 && body.service.id !== "QRIS" || body?.acquirer?.id !== void 0 && body.acquirer.id !== "DOKU")) {
    return { channel: "", providerChannel, issue: "QRIS_CHANNEL_IDENTITY_MISMATCH" };
  }
  return { channel: providerChannel, providerChannel };
}
function dokuPaymentReference(body) {
  const evidence = dokuChannelEvidence(body);
  if (evidence.issue) return void 0;
  const approval = evidence.channel === "QRIS" ? body?.emoney_payment?.approval_code : void 0;
  const ref = approval ?? body?.transaction?.original_request_id ?? body?.transaction?.reference_id;
  return typeof ref === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(ref) ? ref : void 0;
}

// api/_doku.ts
function isDokuConfigured() {
  const clientId = getDokuClientId();
  const secretKey = getDokuSecretKey();
  return Boolean(clientId && secretKey && !clientId.includes("sandbox_dummy"));
}
function getDokuClientId() {
  return validateDokuBrandClientId(process.env.DOKU_CLIENT_ID || "");
}
function validateDokuBrandClientId(value) {
  const id = value.trim();
  if (/^['"]?BSN-/i.test(id)) throw new Error("DOKU_BRAND_CLIENT_ID_REQUIRED");
  if (id && (id.length > 128 || !/^[\x21-\x7e]+$/.test(id) || /[,"']/.test(id))) throw new Error("DOKU_CLIENT_ID_INVALID");
  return id;
}
function getDokuSecretKey() {
  return (process.env.DOKU_SECRET_KEY || "").trim();
}
var DOKU_API_URLS = /* @__PURE__ */ new Set(["https://api.doku.com", "https://api-sandbox.doku.com"]);
function getDokuApiUrl() {
  const raw = (process.env.DOKU_API_URL || "https://api.doku.com").replace(/["']/g, "").trim().replace(/\/+$/, "");
  if (!DOKU_API_URLS.has(raw)) throw new Error("DOKU_API_URL_NOT_ALLOWED");
  return raw;
}
function getDokuAllowedChannels() {
  const raw = (process.env.DOKU_ALLOWED_CHANNELS || "").replace(/["']/g, "").trim();
  const channels = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (!channels.length || channels.some((x) => !/^[A-Z0-9_]{1,100}$/.test(x))) {
    throw new Error("DOKU_CHANNEL_SCOPE_NOT_CONFIGURED");
  }
  return [...new Set(channels)];
}
function generateDigest(body) {
  const content = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  return crypto.createHash("sha256").update(content).digest("base64");
}
function generateGetSignature(clientId, requestId, requestTimestamp, requestTarget, secretKey) {
  const componentSignature = `Client-Id:${clientId}
Request-Id:${requestId}
Request-Timestamp:${requestTimestamp}
Request-Target:${requestTarget}`;
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(componentSignature, "utf8");
  const hmacBase64 = hmac.digest("base64");
  return `HMACSHA256=${hmacBase64}`;
}
async function checkDokuOrderStatus(invoiceNumber) {
  const clientId = getDokuClientId();
  const secretKey = getDokuSecretKey();
  const apiUrl = getDokuApiUrl();
  if (!clientId || !secretKey) {
    throw new Error("DOKU_CREDENTIALS_NOT_CONFIGURED");
  }
  const requestId = crypto.randomUUID();
  const requestTimestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19) + "Z";
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(invoiceNumber)) throw new Error("DOKU_INVOICE_INVALID");
  const requestTarget = `/orders/v1/status/${encodeURIComponent(invoiceNumber)}`;
  const signature = generateGetSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    secretKey
  );
  const response = await fetch(`${apiUrl}${requestTarget}`, {
    method: "GET",
    redirect: "error",
    headers: {
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": requestTimestamp,
      "Signature": signature
    },
    signal: AbortSignal.timeout(15e3)
  });
  if (!response.ok) {
    if (response.status === 404) {
      return { ok: false, status: "UNKNOWN" };
    }
    throw new Error(`DOKU_STATUS_INQUIRY_HTTP_${response.status}`);
  }
  const data = await response.json();
  const txStatus = String(data?.transaction?.status || data?.order?.status || "").toUpperCase();
  const status = ["SUCCESS", "FAILED", "EXPIRED", "ORDER_EXPIRED", "CANCELLED", "REFUNDED"].includes(txStatus) ? txStatus : ["PENDING", "WAITING", "ORDER_GENERATED"].includes(txStatus) ? "PENDING" : "UNKNOWN";
  const rawAmount = data?.order?.amount;
  const amount = ["string", "number"].includes(typeof rawAmount) && /^\d+(?:\.0{1,2})?$/.test(String(rawAmount)) && Number.isSafeInteger(Number(rawAmount)) ? Number(rawAmount) : void 0;
  return {
    ok: true,
    status,
    invoiceNumber: typeof data?.order?.invoice_number === "string" ? data.order.invoice_number : void 0,
    amount,
    currency: data?.order?.currency === void 0 ? "IDR" : String(data.order.currency),
    transactionId: dokuPaymentReference(data),
    channelId: dokuChannelEvidence(data).channel,
    providerChannelId: dokuChannelEvidence(data).providerChannel,
    validationIssue: dokuChannelEvidence(data).issue,
    rawResponse: data
  };
}

// services/billing/invoicePaymentPolicy.ts
var FINANCIAL_HOLD_REASONS = ["EXTERNAL_CONFLICT_REQUIRES_REVIEW", "PROVIDER_REFERENCE_CONFLICT", "PROVIDER_REFERENCE_REUSED", "REFUND_REQUIRES_REVIEW", "REVERSAL_REQUIRES_REVIEW", "TERMINAL_ORDER_PAYMENT_REQUIRES_REVIEW", "RELATED_LATE_PAYMENT_REQUIRES_REVIEW", "QUOTE_PERIOD_EXPIRED"];
function financialReviewHold(i) {
  return FINANCIAL_HOLD_REASONS.some((reason) => reason === i?.reconciliation_note) ? i.reconciliation_note : void 0;
}
function isQrisCheckoutInvoice(i) {
  try {
    const methods = getDokuAllowedChannels(), frozen = i?.quote?.allowedChannels;
    return i?.quote?.paymentIntegration === "DOKU_CHECKOUT" && Array.isArray(frozen) && frozen.length > 0 && frozen.length === methods.length && frozen.every((x) => methods.includes(x)) && Boolean(process.env.DOKU_ACCEPTANCE_ID) && i.quote.releaseAcceptanceId === process.env.DOKU_ACCEPTANCE_ID;
  } catch {
    return false;
  }
}
function providerOrderTerminal(i) {
  return ["PROVIDER_ORDER_EXPIRED", "PROVIDER_EXPIRED", "PROVIDER_CANCELLED", "TERMINAL_ORDER_PAYMENT_REQUIRES_REVIEW"].includes(i?.reconciliation_note);
}

// src/config/freePlanPolicy.ts
var FREE_PLAN_ID = "plan-free-lifetime";

// src/config/saasPlans.ts
var TRIAL_PLAN_ID = "plan-free";
var TRIAL_DAYS = 45;
var TRIAL_READ_ONLY_DAYS = 14;
var SAAS_PLANS = [
  {
    id: FREE_PLAN_ID,
    name: "Free Selamanya",
    tierLevel: 1,
    billingCycle: "MONTHLY",
    priceIdr: 0,
    currency: "IDR",
    maxOutlets: 1,
    isActive: true,
    productLimit: 10,
    aiQuotaMonthly: 0,
    dashboardAccessLevel: "BASIC",
    features: ["Otomatis setelah trial 45 hari", "10 produk pilihan owner", "1 cabang pilihan owner", "Hanya akun owner", "Tanpa AI", "Data lainnya tetap disimpan"]
  },
  {
    id: TRIAL_PLAN_ID,
    name: "Free Trial 45 Hari",
    tierLevel: 1,
    billingCycle: "MONTHLY",
    priceIdr: 0,
    currency: "IDR",
    maxOutlets: 2,
    isActive: true,
    isTrial: true,
    trialDays: TRIAL_DAYS,
    gracePeriodDays: TRIAL_READ_ONLY_DAYS,
    productLimit: -1,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: "ADVANCED",
    features: [
      "Seluruh fitur Tier Pro selama 45 hari",
      "Hingga 2 outlet",
      "Produk dan pengguna tidak terbatas",
      "Kuota AI trial terbatas",
      "WhatsApp assisted melalui wa.me",
      "Tanpa kartu kredit (berlaku 1x per akun toko)",
      "Setelah trial: Free selamanya dengan 10 produk, 1 cabang, owner saja, tanpa AI"
    ]
  },
  {
    id: "plan-plus-monthly",
    name: "Tier Plus",
    tierLevel: 2,
    billingCycle: "MONTHLY",
    priceIdr: 99e3,
    priceYearlyIdr: 79200,
    annualDiscountPercent: 20,
    currency: "IDR",
    maxOutlets: 2,
    isActive: true,
    productLimit: -1,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: "FULL",
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
    features: [
      "POS, transaksi, QRIS, dan struk",
      "2 outlet termasuk dalam paket",
      "Produk dan kategori tidak terbatas",
      "Inventori dan workflow sektor dasar",
      "Pelanggan, shift, kas, dan laporan omzet",
      "AI Analyst kuota dasar",
      "Support standar"
    ]
  },
  {
    id: "plan-pro-monthly",
    name: "Tier Pro",
    tierLevel: 3,
    billingCycle: "MONTHLY",
    priceIdr: 299e3,
    priceYearlyIdr: 248170,
    annualDiscountPercent: 17,
    currency: "IDR",
    maxOutlets: 4,
    isActive: true,
    productLimit: -1,
    aiQuotaMonthly: 90,
    dashboardAccessLevel: "ADVANCED",
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
    features: [
      "Semua fitur Tier Plus",
      "4 outlet termasuk dalam paket",
      "Inventori multi-location, transfer stok, dan recursive BOM",
      "Smart Labor, absensi, komisi, bonus, dan payroll",
      "Workflow vertikal lengkap untuk tiap sektor",
      "WhatsApp Lifecycle Center",
      "Advanced AI Business Analyst dan laporan lintas outlet",
      "Priority support"
    ]
  }
];
var PAID_SAAS_PLANS = SAAS_PLANS.filter((plan) => plan.priceIdr > 0);

// services/billing/engine.ts
var BillingError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function outletUsage(db, tenantId) {
  const { rows } = await db.query("SELECT count(*)::int AS count FROM internal.outlets WHERE tenant_id=$1 AND is_active", [tenantId]);
  return Number(rows[0].count);
}
async function reconcilePayment(db, notice) {
  if (!notice.eventKey || !notice.invoiceNumber || !notice.reference || !Number.isFinite(notice.amount)) throw new BillingError(400, "INVALID_PAYMENT_NOTICE");
  return db.tx(async (c) => {
    if (notice.integration === "DOKU_CHECKOUT") await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["doku-reference:" + notice.reference]);
    const lookup = await c.query("SELECT tenant_id FROM billing.invoices WHERE invoice_number=$1", [notice.invoiceNumber]);
    if (lookup.rows[0]) await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [lookup.rows[0].tenant_id]);
    const found = await c.query("SELECT * FROM billing.invoices WHERE invoice_number=$1 FOR UPDATE", [notice.invoiceNumber]);
    const inv = found.rows[0];
    let outcome = "REVIEW", reason = "INVOICE_NOT_FOUND";
    let sub;
    if (inv) {
      sub = (await c.query("SELECT * FROM billing.subscriptions WHERE id=$1 FOR UPDATE", [inv.subscription_id])).rows[0];
      const reused = notice.integration === "DOKU_CHECKOUT" && (await c.query("SELECT invoice_number FROM billing.payment_events WHERE gateway_reference=$1 AND outcome='APPLIED' AND invoice_number<>$2 LIMIT 1", [notice.reference, notice.invoiceNumber])).rowCount > 0;
      if (!notice.success && notice.payload?.status === "FAILED" && inv.payment_status === "PAID" && inv.reconciliation_status === "APPLIED") {
        outcome = "DUPLICATE";
        reason = "FAILED_ATTEMPT_IGNORED";
      } else if (notice.validationIssue === "REFUND_REQUIRES_REVIEW" || notice.validationIssue === "REVERSAL_REQUIRES_REVIEW") reason = notice.validationIssue;
      else if (reused) reason = "PROVIDER_REFERENCE_REUSED";
      else if (Number(inv.amount) !== notice.amount || inv.currency !== notice.currency) reason = "AMOUNT_OR_CURRENCY_MISMATCH";
      else if (notice.validationIssue) reason = notice.validationIssue;
      else if (notice.integration === "DOKU_CHECKOUT" && !isQrisCheckoutInvoice(inv)) reason = "LEGACY_INVOICE_NEEDS_REVIEW";
      else if (inv.quote?.allowedChannels && !inv.quote.allowedChannels.includes(notice.channel)) reason = "INVOICE_CHANNEL_MISMATCH";
      else if (financialReviewHold(inv)) reason = financialReviewHold(inv);
      else if (inv.payment_status === "PAID" && inv.reconciliation_status === "APPLIED") {
        if (inv.payment_gateway_ref !== notice.reference) reason = "PROVIDER_REFERENCE_CONFLICT";
        else {
          outcome = "DUPLICATE";
          reason = "ALREADY_APPLIED";
        }
      } else if (!notice.success) {
        outcome = notice.payload?.status === "PENDING" ? "PENDING" : "FAILED";
        reason = "PROVIDER_" + (["FAILED", "PENDING", "EXPIRED", "CANCELLED", "ORDER_EXPIRED"].includes(notice.payload?.status) ? notice.payload.status : "FAILED");
      } else if (!inv.quote) reason = "LEGACY_INVOICE_NEEDS_REVIEW";
      else if (providerOrderTerminal(inv)) reason = "TERMINAL_ORDER_PAYMENT_REQUIRES_REVIEW";
      else if (inv.quote.revision !== Number(sub.revision)) reason = "STALE_SUBSCRIPTION_REVISION";
      else if (Date.parse(inv.quote.periodEnd) <= Date.now()) reason = "QUOTE_PERIOD_EXPIRED";
      else if (await outletUsage(c, inv.tenant_id) > inv.quote.maxOutlets) reason = "OUTLET_LIMIT_BELOW_USAGE";
      else {
        outcome = "APPLIED";
        reason = "VERIFIED";
      }
    }
    const payload = {
      contentDigest: notice.contentDigest || null,
      status: notice.success ? "SUCCESS" : ["FAILED", "PENDING", "EXPIRED", "CANCELLED", "ORDER_EXPIRED", "REFUNDED", "PARTIAL_REFUNDED", "REVERSED", "VOIDED"].includes(notice.payload?.status) ? notice.payload.status : "OTHER",
      channel: (notice.channel || "").slice(0, 100),
      providerChannel: (notice.providerChannel || notice.channel || "").slice(0, 100),
      requestTimestamp: typeof notice.payload?.requestTimestamp === "string" ? notice.payload.requestTimestamp.slice(0, 30) : null
    };
    const event = await c.query(
      `INSERT INTO billing.payment_events(event_key,invoice_number,gateway_reference,amount,currency,outcome,reason,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
      [notice.eventKey, notice.invoiceNumber, notice.reference, notice.amount, notice.currency, outcome, reason, JSON.stringify(payload)]
    );
    if (!event.rowCount) {
      const previous = (await c.query("SELECT invoice_number,amount,currency,payload,outcome,reason FROM billing.payment_events WHERE event_key=$1", [notice.eventKey])).rows[0];
      if (previous.invoice_number !== notice.invoiceNumber || Number(previous.amount) !== notice.amount || previous.currency !== notice.currency || previous.payload?.contentDigest && previous.payload.contentDigest !== notice.contentDigest) throw new BillingError(409, "PAYMENT_EVENT_KEY_CONFLICT");
      return { ok: true, outcome: ["APPLIED", "DUPLICATE"].includes(previous.outcome) ? "DUPLICATE" : previous.outcome, reason: previous.reason, replayed: true };
    }
    if (outcome === "APPLIED") {
      const q = inv.quote;
      await c.query(
        `UPDATE billing.subscriptions SET plan_id=$2,billing_cycle=$3,extra_outlets=$4,recurring_amount=$5,
        status='ACTIVE',current_period_start=$6,current_period_end=$7,grace_period_end=$7::timestamptz+interval '14 days',
        revision=revision+1,cancel_at_period_end=false,canceled_at=NULL,updated_at=now() WHERE id=$1`,
        [sub.id, q.planId, q.billingCycle, q.extraOutlets, q.recurringAmount, q.periodStart, q.periodEnd]
      );
      await c.query(`UPDATE billing.invoices SET payment_status='PAID',paid_at=now(),payment_gateway_ref=$2,
        reconciliation_status='APPLIED',reconciliation_note=$3 WHERE id=$1`, [inv.id, notice.reference, reason]);
    } else if (inv && outcome !== "DUPLICATE" && outcome !== "FAILED" && outcome !== "PENDING") {
      await c.query(`UPDATE billing.invoices SET reconciliation_status=$2,reconciliation_note=$3 WHERE id=$1`, [inv.id, outcome, financialReviewHold(inv) || (providerOrderTerminal(inv) ? notice.success ? "TERMINAL_ORDER_PAYMENT_REQUIRES_REVIEW" : inv.reconciliation_note : reason)]);
      if (inv.payment_status === "PAID" && ["REFUND_REQUIRES_REVIEW", "REVERSAL_REQUIRES_REVIEW"].includes(reason) && inv.quote?.revision === Number(sub.revision) - 1)
        await c.query("UPDATE billing.subscriptions SET status='SUSPENDED',updated_at=now() WHERE id=$1", [sub.id]);
    }
    if (inv && ["FAILED", "PENDING"].includes(outcome) && inv.payment_status !== "PAID" && !providerOrderTerminal(inv)) {
      await c.query("UPDATE billing.invoices SET reconciliation_note=$2 WHERE id=$1", [inv.id, reason]);
    }
    if (inv && notice.success && providerOrderTerminal(inv) && outcome === "REVIEW") {
      await c.query(`UPDATE billing.invoices SET reconciliation_status='REVIEW',reconciliation_note=CASE WHEN reconciliation_note=ANY($4::text[]) THEN reconciliation_note ELSE 'RELATED_LATE_PAYMENT_REQUIRES_REVIEW' END
        WHERE tenant_id=$1 AND payment_status='PENDING' AND id<>$2 AND quote->>'revision'=$3::text`, [inv.tenant_id, inv.id, inv.quote.revision, FINANCIAL_HOLD_REASONS]);
    }
    return { ok: true, outcome, reason };
  });
}

// services/billing/recovery.ts
var INQUIRY_COOLDOWN_MS = 6e4;
async function reconcileInvoiceByInquiry(db, inv, provider = checkDokuOrderStatus, options = {}) {
  if (!isQrisCheckoutInvoice(inv)) return { ok: true, outcome: "UNAVAILABLE" };
  const claimed = await db.tx(async (c) => {
    const fresh = (await c.query("SELECT * FROM billing.invoices WHERE id=$1 FOR UPDATE", [inv.id])).rows[0];
    if (!fresh || !isQrisCheckoutInvoice(fresh) || fresh.payment_status === "PAID" && fresh.reconciliation_status === "APPLIED") return false;
    const last = (await c.query(`SELECT max(created_at) checked_at FROM billing.payment_events
   WHERE invoice_number=$1 AND payload->>'source'='INQUIRY_PROBE'`, [fresh.invoice_number])).rows[0]?.checked_at;
    const now = options.now ? options.now() : new Date((await c.query("SELECT clock_timestamp() AS observed_at")).rows[0].observed_at).getTime();
    const anchor = Math.max(new Date(fresh.created_at).getTime(), last ? new Date(last).getTime() : 0);
    if (last && (options.observeOnly || !Number.isFinite(anchor) || now - anchor < INQUIRY_COOLDOWN_MS)) return false;
    await c.query(`INSERT INTO billing.payment_events(event_key,invoice_number,outcome,reason,payload,created_at)
   VALUES($1,$2,'UNVERIFIED','STATUS_INQUIRY_ATTEMPT','{"source":"INQUIRY_PROBE"}'::jsonb,$3)`, ["probe-" + randomUUID3(), fresh.invoice_number, new Date(now).toISOString()]);
    return Boolean(last);
  });
  if (!claimed) return { ok: true, outcome: "DEFERRED" };
  const inquiry = await provider(inv.invoice_number);
  if (!inquiry.ok || inquiry.status === "UNKNOWN") return { ok: true, outcome: "UNAVAILABLE" };
  let allowed = [];
  try {
    allowed = getDokuAllowedChannels();
  } catch {
  }
  const channel = String(inquiry.channelId || "");
  const issue = inquiry.validationIssue || (inquiry.invoiceNumber !== inv.invoice_number ? "INQUIRY_INVOICE_MISMATCH" : inquiry.amount === void 0 ? "INQUIRY_AMOUNT_MISSING" : !inquiry.transactionId ? "INQUIRY_REFERENCE_MISSING" : !channel || !allowed.includes(channel) ? "UNAPPROVED_PAYMENT_CHANNEL" : inquiry.status === "REFUNDED" ? "REFUND_REQUIRES_REVIEW" : void 0);
  return reconcilePayment(db, {
    eventKey: `inquiry-${generateDigest(JSON.stringify([inv.invoice_number, inquiry.rawResponse])).replace(/[/+=]/g, "")}`,
    integration: "DOKU_CHECKOUT",
    invoiceNumber: inv.invoice_number,
    reference: inquiry.transactionId || "missing",
    amount: inquiry.amount ?? 0,
    currency: inquiry.currency || "",
    success: inquiry.status === "SUCCESS",
    channel,
    providerChannel: inquiry.providerChannelId,
    validationIssue: issue,
    contentDigest: generateDigest(JSON.stringify(inquiry.rawResponse || {})),
    payload: { status: inquiry.status, channel, source: "INQUIRY" }
  });
}
async function recoverPendingPayments(db, options = {}) {
  const limit = Math.min(100, Math.max(1, options.limit || 20)), start = Date.now();
  const invoices = (await db.query(`SELECT i.* FROM billing.invoices i LEFT JOIN (SELECT invoice_number,max(created_at) checked_at FROM billing.payment_events
    WHERE payload->>'source'='INQUIRY_PROBE' GROUP BY invoice_number) probes USING(invoice_number)
  WHERE i.payment_status='PENDING' AND i.quote->>'paymentIntegration'='DOKU_CHECKOUT' AND i.quote->'allowedChannels'=$2::jsonb AND ($3::text IS NULL OR i.quote->>'releaseAcceptanceId'=$3) AND i.created_at>now()-interval '30 days'
  ORDER BY coalesce(probes.checked_at,i.created_at),i.id LIMIT $1`, [limit, JSON.stringify(getDokuAllowedChannels()), process.env.DOKU_ACCEPTANCE_ID || null])).rows;
  const summary = { checked: 0, applied: 0, review: 0, unavailable: 0, deferred: 0 };
  for (const inv of invoices) {
    if (Date.now() - start >= (options.budgetMs ?? 2e4)) {
      summary.deferred++;
      continue;
    }
    summary.checked++;
    try {
      const result = await reconcileInvoiceByInquiry(db, inv, options.provider, { now: options.now });
      if (result.outcome === "APPLIED") summary.applied++;
      else if (result.outcome === "REVIEW") summary.review++;
      else if (result.outcome === "UNAVAILABLE") summary.unavailable++;
      else if (result.outcome === "DEFERRED") summary.deferred++;
    } catch {
      summary.unavailable++;
    }
  }
  return summary;
}
async function runScheduledDokuRecovery(db, options = {}) {
  if (process.env.DOKU_RECONCILIATION_ENABLED !== "1") return { skipped: true, reason: "PAYMENT_RECOVERY_DISABLED" };
  const live = getDokuApiUrl() === "https://api.doku.com";
  if (!isDokuConfigured() || !process.env.DOKU_ACCEPTANCE_ID || (live ? process.env.FULL_NEON_TARGET !== "production" || process.env.VERCEL_ENV !== "production" || process.env.AUTH_PROVIDER !== "neon" : process.env.FULL_NEON_TARGET === "production" || process.env.VERCEL_ENV === "production")) throw Error("PAYMENT_RECOVERY_CONFIGURATION_INVALID");
  return { skipped: false, ...await recoverPendingPayments(db, { limit: 20, budgetMs: 15e3, ...options }) };
}

// src/server/billingRemindersHandler.ts
var database;
var dryProvider = {
  verifiedOwnerEmail: async () => {
    throw new Error("DRY_RUN_MUST_NOT_LOOK_UP_USERS");
  },
  send: async () => {
    throw new Error("DRY_RUN_MUST_NOT_SEND");
  }
};
async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED_CRON" });
  }
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  if (!isCronJobEnabled("billing-reminders")) return res.status(200).json({ ok: true, skipped: true, reason: "JOB_DISABLED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "DATABASE_NOT_CONFIGURED" });
  try {
    const dryRun = process.env.BILLING_REMINDERS_ENABLED !== "1";
    const provider = dryRun ? dryProvider : createReminderProvider();
    database ??= connectDb({ schema: "billing", max: 2 }).catch((err) => {
      database = void 0;
      throw err;
    });
    const db = await database;
    const recovery = await runScheduledDokuRecovery(db);
    const result = await runBillingReminders(db, provider, {
      dryRun,
      from: process.env.BILLING_EMAIL_FROM,
      appUrl: process.env.PUBLIC_APP_URL
    });
    const unhealthy = result.failed || result.review || !recovery.skipped && ("unavailable" in recovery && recovery.unavailable || "review" in recovery && recovery.review);
    return res.status(unhealthy ? 503 : 200).json({ ok: !unhealthy, ...result, paymentRecovery: recovery });
  } catch {
    return res.status(503).json({ ok: false, error: "BILLING_REMINDERS_UNAVAILABLE" });
  }
}
export {
  handler as default
};
