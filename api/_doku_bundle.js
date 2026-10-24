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

// services/shared/neonAuthDatabase.ts
import pg from "pg";

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

// services/shared/neonAuthDatabase.ts
var pool;
function neonAuthDatabase() {
  if (!pool) {
    const t = fullNeonConfig(), url = new URL(process.env.NEON_AUTH_DATABASE_URL || process.env.DATABASE_URL || "");
    if (url.hostname.replace("-pooler", "") !== t.host || url.pathname !== "/neondb" || url.username !== "newhope_clean_runtime") throw Error("MANAGED_AUTH_DATABASE_BINDING_REQUIRED");
    pool = new pg.Pool({ ...databaseTransport(url.href), max: 2, connectionTimeoutMillis: 5e3, statement_timeout: 8e3 });
  }
  return { query: async (sql, p) => {
    const r = await pool.query(sql, p);
    return { rows: r.rows, rowCount: r.rowCount || 0 };
  } };
}

// services/shared/neonAuth.ts
import { createRemoteJWKSet, jwtVerify, errors } from "jose";

// services/shared/db.ts
import fs2 from "node:fs";
import pg2 from "pg";

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

// services/shared/db.ts
pg2.types.setTypeParser(1700, (v) => v === null ? null : Number(v));
pg2.types.setTypeParser(20, (v) => v === null ? null : Number(v));
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
  const pool2 = new pg2.Pool({
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

// services/shared/neonPilot.ts
function neonPilotConfig(env = process.env) {
  if (env.FULL_NEON_CLEAN_START === "1") {
    const c = fullNeonConfig(env);
    return { authUrl: c.authUrl, jwksUrl: c.jwksUrl, issuer: c.issuer };
  }
  if (env.NEON_MIGRATION_PILOT !== "1" || env.VERCEL_ENV === "production" || env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && env.APP_ENV !== "staging")
    throw new Error("NEON_PILOT_PRODUCTION_CUTOVER_BLOCKED");
  const base = new URL(env.NEON_AUTH_BASE_URL || "");
  if (base.protocol !== "https:" || !/(?:^|\.)neon\.(?:tech|build)$/.test(base.hostname) || base.username || base.password)
    throw new Error("INVALID_NEON_AUTH_CONFIGURATION");
  const authUrl = base.href.replace(/\/$/, "");
  const jwksUrl = authUrl + "/.well-known/jwks.json";
  if (env.NEON_AUTH_JWKS_URL && env.NEON_AUTH_JWKS_URL !== jwksUrl) throw new Error("NEON_JWKS_BRANCH_MISMATCH");
  return { authUrl, jwksUrl, issuer: base.origin };
}

// services/shared/neonAuth.ts
var NeonAuthUnavailableError = class extends Error {
};
var verifier;
var opening;
async function verifyNeonToken(token, config = neonPilotConfig(), key) {
  if (!key) {
    if (verifier?.url !== config.jwksUrl) verifier = { url: config.jwksUrl, key: createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 5e3, cooldownDuration: 3e4 }) };
    key = verifier.key;
  }
  try {
    const { payload: p } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.issuer,
      algorithms: ["EdDSA"],
      requiredClaims: ["sub", "exp", "iat"],
      maxTokenAge: "15m",
      clockTolerance: 5
    });
    if (!p.sub || p.id !== p.sub || typeof p.email !== "string" || p.emailVerified !== true || p.banned === true) return null;
    return { subject: p.sub, email: p.email, isEmailVerified: true, aal: "aal1" };
  } catch (e) {
    if (e instanceof errors.JOSEError && !(e instanceof errors.JWKSTimeout)) return null;
    throw new NeonAuthUnavailableError("NEON_AUTH_UNAVAILABLE");
  }
}
async function bindNeonIdentity(db, p, issuer, provider = "neon", authDb) {
  if (!p.isEmailVerified || !p.email) return null;
  if (provider === "better-auth" && !authDb) throw new NeonAuthUnavailableError("BETTER_AUTH_IDENTITY_AUTH_DATABASE_REQUIRED");
  const email = p.email;
  return db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [issuer + ":" + p.subject]);
    const live = (await (authDb || c).query(provider === "better-auth" ? 'SELECT id,email,"emailVerified",NOT "isActive" AS banned FROM newhope_auth."user" WHERE id=$1' : 'SELECT id,email,"emailVerified",banned FROM neon_auth."user" WHERE id::text=$1', [p.subject])).rows[0];
    if (!live || !live.emailVerified || live.banned || live.email.toLowerCase() !== email.toLowerCase()) return null;
    const binding = (await c.query(`SELECT b.canonical_user_id,b.is_active,u.is_active AS canonical_active
      FROM internal.auth_identity_bindings b JOIN internal.users u ON u.id=b.canonical_user_id
      WHERE b.provider=$3 AND b.issuer=$1 AND b.provider_subject=$2`, [issuer, p.subject, provider])).rows[0];
    if (binding) return binding.is_active && binding.canonical_active ? { ...p, subject: binding.canonical_user_id } : null;
    const exists = (await c.query("SELECT 1 FROM internal.users WHERE id::text=$1 OR lower(email)=lower($2)", [p.subject, p.email])).rows.length;
    if (exists) return null;
    await c.query(`INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,$2,'Pemilik Toko',true)`, [p.subject, email.toLowerCase()]);
    await c.query(`INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,verification_ref)
      VALUES($3,$1,$2::text,$2::uuid,'NEW_VERIFIED_ACCOUNT')`, [issuer, p.subject, provider]);
    return p;
  });
}
async function authenticateNeonBearer(token) {
  let config;
  try {
    config = neonPilotConfig();
  } catch {
    throw new NeonAuthUnavailableError("NEON_CONFIG_UNAVAILABLE");
  }
  const p = await verifyNeonToken(token, config);
  if (!p) return null;
  try {
    opening ??= connectDb({ schema: "internal", max: 2 }).catch((e) => {
      opening = void 0;
      throw e;
    });
    return await bindNeonIdentity(await opening, p, config.issuer, "neon", process.env.FULL_NEON_CLEAN_START === "1" ? neonAuthDatabase() : void 0);
  } catch {
    throw new NeonAuthUnavailableError("NEON_IDENTITY_UNAVAILABLE");
  }
}

// services/shared/betterAuth.ts
import { betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { PostgresDialect } from "kysely";
import pg3 from "pg";
import { randomUUID } from "node:crypto";

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
  const database = new URL(databaseUrl), app = new URL(env.BETTER_AUTH_URL || "");
  if (database.hostname.replace("-pooler", "") !== target.host) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  if (database.pathname !== "/neondb" || !["postgres:", "postgresql:"].includes(database.protocol)) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  for (const value of [env.DATABASE_URL, env.BETTER_AUTH_DATABASE_URL, env.NEON_STAGING_DATABASE_URL].filter(Boolean)) {
    const u = new URL(value);
    if (u.hostname.replace("-pooler", "") !== database.hostname.replace("-pooler", "") || u.pathname !== "/neondb" || !["postgres:", "postgresql:"].includes(u.protocol) || u.port && u.port !== "5432" || u.hash || [...u.searchParams.keys()].some((k) => !["sslmode", "channel_binding", "application_name"].includes(k))) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
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
    if (application.username !== "newhope_runtime_login" || database.username !== "newhope_auth_runtime_login" || application.href === database.href) throw Error("BETTER_AUTH_LEAST_PRIVILEGE_REQUIRED");
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
    advanced: { database: { generateId: () => randomUUID() }, useSecureCookies: config.baseUrl.startsWith("https://") },
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

// services/shared/betterAuthPrincipal.ts
var BetterAuthUnavailableError = class extends Error {
};
var opening2;
async function authenticateBetterBearer(token) {
  try {
    const config = betterAuthPilotConfig(), { auth, pool: pool2 } = getBetterAuthRuntime();
    const session = await auth.api.getSession({ headers: new Headers({ authorization: "Bearer " + token }), query: { disableCookieCache: true } });
    if (!session?.user.emailVerified || !session.user.isActive) return null;
    opening2 ??= connectDb({ schema: "internal", max: 2 }).catch((e) => {
      opening2 = void 0;
      throw e;
    });
    const p = await bindNeonIdentity(await opening2, { subject: session.user.id, email: session.user.email, isEmailVerified: true, aal: "aal1" }, config.baseUrl, "better-auth", pool2);
    if (!p) return null;
    if (session.user.twoFactorEnabled) {
      const proof = (await pool2.query("SELECT verified_at FROM newhope_auth.mfa_session_proofs WHERE session_id=$1 AND user_id=$2", [session.session.id, session.user.id])).rows[0];
      if (proof) {
        p.aal = "aal2";
        p.mfaVerifiedAt = new Date(proof.verified_at).getTime() / 1e3;
      }
    }
    return p;
  } catch (e) {
    if (e?.status === "UNAUTHORIZED") return null;
    throw new BetterAuthUnavailableError("BETTER_AUTH_UNAVAILABLE");
  }
}

// services/shared/auth.ts
var LOCAL_BYPASS = () => (!process.env.AUTH_PROVIDER || process.env.AUTH_PROVIDER === "supabase") && process.env.NODE_ENV !== "production" && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === "1";
function firstHeader(value) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}
function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return { url, apiKey };
}
var AuthUnavailableError = class extends Error {
  constructor() {
    super("AUTH_UNAVAILABLE");
  }
};
async function authenticateBearer(req) {
  const authorization = firstHeader(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return LOCAL_BYPASS() ? { subject: "local-development", isEmailVerified: true } : null;
  }
  if (process.env.AUTH_PROVIDER === "better-auth") {
    try {
      return await authenticateBetterBearer(match[1]);
    } catch (e) {
      if (e instanceof BetterAuthUnavailableError) throw new AuthUnavailableError();
      throw e;
    }
  }
  if (process.env.AUTH_PROVIDER === "neon") {
    try {
      return await authenticateNeonBearer(match[1]);
    } catch (e) {
      if (e instanceof NeonAuthUnavailableError) throw new AuthUnavailableError();
      throw e;
    }
  }
  if (process.env.AUTH_PROVIDER && process.env.AUTH_PROVIDER !== "supabase") throw new AuthUnavailableError();
  if (process.env.NEON_DB_PHASE1 === "1") {
    try {
      hybridPhase1Config();
    } catch {
      throw new AuthUnavailableError();
    }
  }
  const { url, apiKey } = supabaseConfig();
  if (!url || !apiKey) {
    return LOCAL_BYPASS() ? { subject: "local-development", isEmailVerified: true } : null;
  }
  let upstream;
  try {
    upstream = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${match[1]}`, apikey: apiKey },
      signal: AbortSignal.timeout(5e3)
    });
  } catch {
    throw new AuthUnavailableError();
  }
  if (upstream.status >= 500 || upstream.status === 429) throw new AuthUnavailableError();
  if (!upstream.ok) return null;
  try {
    const user = await upstream.json();
    if (typeof user.id !== "string" || !user.id) return null;
    const isEmailVerified = Boolean(user.email_confirmed_at || user.confirmed_at);
    const claims = JSON.parse(Buffer.from(match[1].split(".")[1], "base64url").toString("utf8"));
    if (claims.sub !== user.id || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1e3) return null;
    const times = Array.isArray(claims.amr) ? claims.amr.filter((a) => a.method === "totp" && Number.isFinite(a.timestamp) && a.timestamp <= Date.now() / 1e3 + 30).map((a) => a.timestamp) : [];
    return {
      subject: user.id,
      sourceCreatedAt: typeof user.created_at === "string" ? user.created_at : void 0,
      email: typeof user.email === "string" ? user.email : void 0,
      isEmailVerified,
      aal: claims.aal === "aal2" ? "aal2" : "aal1",
      mfaVerifiedAt: times.length ? Math.max(...times) : void 0
    };
  } catch {
    return null;
  }
}
function trustedPrincipal(req) {
  const subject = firstHeader(req.headers["x-auth-sub"]);
  const isEmailVerified = firstHeader(req.headers["x-auth-email-verified"]) === "true";
  if (subject) return { subject, sourceCreatedAt: firstHeader(req.headers["x-auth-source-created-at"]) || void 0, email: firstHeader(req.headers["x-auth-email"]) || void 0, isEmailVerified };
  return LOCAL_BYPASS() ? { subject: "local-development", isEmailVerified: true } : null;
}
async function tenantForPrincipal(db, principal) {
  const { rows } = await db.query(
    `SELECT id FROM internal.tenants WHERE (owner_user_ref = $1 OR external_ref = $1) AND merged_into IS NULL
     ORDER BY (external_ref = $1) DESC NULLS LAST, created_at ASC, id LIMIT 1`,
    [principal.subject]
  );
  if (rows[0]?.id) return rows[0].id;
  if (principal.subject === "local-development" && LOCAL_BYPASS()) {
    const res = await db.query(
      `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Lokal', 'local-development', 'local-development', true)
       ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    return res.rows[0]?.id ?? null;
  }
  return null;
}

// services/billing/paymentReadiness.ts
import { createHash as createHash2 } from "node:crypto";

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
function validateDokuPaymentUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DOKU_PAYMENT_URL_INVALID");
  }
  const sandbox = getDokuApiUrl() === "https://api-sandbox.doku.com";
  const hosts = sandbox ? ["sandbox.doku.com"] : ["checkout.doku.com", "jokul.doku.com"];
  if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.includes(url.hostname)) {
    throw new Error("DOKU_PAYMENT_URL_INVALID");
  }
  return url.href;
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
var DOKU_NOTIFICATION_PATH = "/api/v1/webhooks/doku";
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
function generateSignature(clientId, requestId, requestTimestamp, requestTarget, digest, secretKey) {
  const componentSignature = `Client-Id:${clientId}
Request-Id:${requestId}
Request-Timestamp:${requestTimestamp}
Request-Target:${requestTarget}
Digest:${digest}`;
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(componentSignature, "utf8");
  const hmacBase64 = hmac.digest("base64");
  return `HMACSHA256=${hmacBase64}`;
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
async function createDokuCheckout(payload) {
  const clientId = getDokuClientId();
  const secretKey = getDokuSecretKey();
  const apiUrl = getDokuApiUrl();
  if (!clientId || !secretKey) {
    throw new Error("DOKU_CREDENTIALS_NOT_CONFIGURED");
  }
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(payload.order.invoice_number) || !Number.isSafeInteger(payload.order.amount) || payload.order.amount <= 0 || payload.order.amount > 999999999999) {
    throw new Error("DOKU_CHECKOUT_ORDER_INVALID");
  }
  const requestId = payload.order.invoice_number;
  const requestTimestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19) + "Z";
  const requestTarget = "/checkout/v1/payment";
  const digest = generateDigest(payload);
  const signature = generateSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    digest,
    secretKey
  );
  const response = await fetch(`${apiUrl}${requestTarget}`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": requestTimestamp,
      "Signature": signature
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15e3)
  });
  const data = await response.json();
  if (!response.ok || !data.response?.payment?.url) {
    throw new Error(`DOKU_API_ERROR_HTTP_${response.status}`);
  }
  const echoed = data.response.order;
  if (!echoed || echoed.invoice_number !== payload.order.invoice_number || Number(echoed.amount) !== payload.order.amount || echoed.currency !== void 0 && echoed.currency !== (payload.order.currency || "IDR")) {
    throw new Error("DOKU_CHECKOUT_ORDER_MISMATCH");
  }
  const returnedMethods = data.response.payment.payment_method_types, requestedMethods = payload.payment.payment_method_types;
  if (returnedMethods !== void 0 && requestedMethods && (!Array.isArray(returnedMethods) || !returnedMethods.length || returnedMethods.some((method) => !requestedMethods.includes(method)) || requestedMethods.some((method) => !returnedMethods.includes(method))))
    throw new Error("DOKU_CHECKOUT_METHOD_MISMATCH");
  const expiresAt = parseDokuExpiry(data.response.payment.expired_date);
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) throw Error("DOKU_CHECKOUT_EXPIRY_INVALID");
  return {
    paymentUrl: validateDokuPaymentUrl(data.response.payment.url),
    expiresAt,
    rawResponse: data
  };
}
function parseDokuExpiry(value) {
  if (typeof value !== "string" || !/^\d{14}$/.test(value)) return;
  const p = [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(8, 10), value.slice(10, 12), value.slice(12, 14)].map(Number);
  const t = Date.UTC(p[0], p[1] - 1, p[2], p[3] - 7, p[4], p[5]), date = new Date(t);
  if (!Number.isFinite(t) || new Date(t + 7 * 36e5).toISOString().slice(0, 19).replace(/[-:T]/g, "") !== value) return;
  return date.toISOString();
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
function verifyDokuWebhookSignature(headers, rawBody, requestTarget, now = Date.now()) {
  const secretKey = getDokuSecretKey();
  if (!secretKey) return false;
  const getHeader = (key) => {
    const matches = Object.entries(headers).filter(([name]) => name.toLowerCase() === key.toLowerCase());
    if (matches.length !== 1) return "";
    const val = matches[0][1];
    if (Array.isArray(val)) return "";
    return typeof val === "string" ? val : "";
  };
  const clientId = getHeader("Client-Id");
  const requestId = getHeader("Request-Id");
  const requestTimestamp = getHeader("Request-Timestamp");
  const incomingSignature = getHeader("Signature");
  let configuredClientId = "";
  try {
    configuredClientId = getDokuClientId();
  } catch {
    return false;
  }
  if (requestTarget !== DOKU_NOTIFICATION_PATH || !clientId || clientId !== configuredClientId || !requestId || !requestTimestamp || !incomingSignature) {
    return false;
  }
  if (!/^[\x21-\x7e]{1,128}$/.test(requestId) || requestId.includes(",")) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(requestTimestamp)) return false;
  const time = Date.parse(requestTimestamp);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== requestTimestamp.replace(".000Z", "Z")) return false;
  if (time > now + 5 * 6e4 || now - time > 13 * 60 * 6e4) return false;
  const digest = generateDigest(rawBody);
  const expectedSignature = generateSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    digest,
    secretKey
  );
  try {
    const bufA = Buffer.from(incomingSignature, "utf8");
    const bufB = Buffer.from(expectedSignature, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// services/billing/dokuSubscriptionPolicy.ts
var SUPPORTED_SUBSCRIPTION_METHODS = ["QRIS", "VIRTUAL_ACCOUNT_BCA", "VIRTUAL_ACCOUNT_BANK_MANDIRI", "VIRTUAL_ACCOUNT_BANK_SYARIAH_MANDIRI", "VIRTUAL_ACCOUNT_DOKU", "VIRTUAL_ACCOUNT_BRI", "VIRTUAL_ACCOUNT_BNI", "VIRTUAL_ACCOUNT_BANK_PERMATA", "VIRTUAL_ACCOUNT_BANK_CIMB", "VIRTUAL_ACCOUNT_BANK_DANAMON", "VIRTUAL_ACCOUNT_BTN", "VIRTUAL_ACCOUNT_BNC", "VIRTUAL_ACCOUNT_BSS", "VIRTUAL_ACCOUNT_BJB"];
function dokuSubscriptionPolicy() {
  const mode = (process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE || "dynamic_qris_checkout").trim();
  if (mode !== "dynamic_qris_checkout" && mode !== "checkout") throw new Error("DOKU_SUBSCRIPTION_PRODUCT_UNAVAILABLE");
  const methods = getDokuAllowedChannels();
  if (methods.includes("QRIS_DOKU")) throw new Error("DOKU_CHECKOUT_METHOD_INVALID");
  if (methods.some((x) => !SUPPORTED_SUBSCRIPTION_METHODS.includes(x))) throw new Error("DOKU_CHECKOUT_METHOD_UNSUPPORTED");
  if (mode === "dynamic_qris_checkout" && (methods.length !== 1 || methods[0] !== "QRIS")) throw new Error("DOKU_DYNAMIC_QRIS_SCOPE_REQUIRED");
  return { mode, methods, integration: "DOKU_CHECKOUT" };
}

// services/billing/paymentReadiness.ts
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkoutPilotAllowed(tenantId, env = process.env) {
  if (env.DOKU_RELEASE_SCOPE === "public") return true;
  const ids = (env.DOKU_CHECKOUT_PILOT_TENANTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return ids.length > 0 && ids.every((x) => UUID.test(x)) && ids.includes(tenantId.toLowerCase());
}
function dokuCredentialFingerprint() {
  return createHash2("sha256").update(JSON.stringify([getDokuApiUrl(), getDokuClientId(), getDokuSecretKey()])).digest("hex");
}
async function assertDokuReadiness(db, tenantId) {
  if (process.env.DOKU_PAYMENTS_ENABLED !== "1") throw Error("PAYMENTS_PAUSED");
  const policy = dokuSubscriptionPolicy(), api = getDokuApiUrl(), origin = process.env.PUBLIC_APP_URL;
  if (!getDokuClientId() || !getDokuSecretKey() || !process.env.DOKU_API_URL || !origin || new URL(origin).origin !== origin || !origin.startsWith("https://")) throw Error("PAYMENT_CONFIGURATION_INVALID");
  const live = api === "https://api.doku.com", scope = process.env.DOKU_RELEASE_SCOPE || "pilot";
  if (!["pilot", "public"].includes(scope) || !checkoutPilotAllowed(tenantId)) throw Error("CHECKOUT_PILOT_ONLY");
  if (live && (process.env.FULL_NEON_CLEAN_START !== "1" || process.env.FULL_NEON_TARGET !== "production" || process.env.VERCEL_ENV !== "production" || process.env.AUTH_PROVIDER !== "neon" || origin !== "https://kasir.newhope.space" || process.env.DOKU_ACTIVATION_APPROVED !== "1")) throw Error("DOKU_LIVE_APPROVAL_REQUIRED");
  if (!live && (process.env.VERCEL_ENV === "production" || process.env.FULL_NEON_TARGET === "production")) throw Error("DOKU_ENVIRONMENT_MISMATCH");
  const id = process.env.DOKU_ACCEPTANCE_ID;
  if (!id || !UUID.test(id)) throw Error("DOKU_PROVIDER_ACCEPTANCE_REQUIRED");
  const row = (await db.query(`SELECT * FROM billing.doku_release_acceptances WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND approved_at<=clock_timestamp() AND credentials_verified_at<=clock_timestamp() AND webhook_verified_at<=clock_timestamp() AND (live_payment_verified_at IS NULL OR live_payment_verified_at<=clock_timestamp())`, [id])).rows[0];
  if (!row || row.api_url !== api || row.credential_sha256 !== dokuCredentialFingerprint() || !row.credentials_verified_at || !row.webhook_verified_at || policy.methods.length !== row.channels.length || policy.methods.some((x) => !row.channels.includes(x)) || (live ? row.scope !== (scope === "public" ? "PUBLIC" : "PILOT") : row.scope !== "SANDBOX") || live && scope === "pilot" && !row.allowed_tenants.includes(tenantId) || live && scope === "public" && !row.live_payment_verified_at) throw Error("DOKU_PROVIDER_ACCEPTANCE_REQUIRED");
  return { acceptanceId: id, scope: row.scope, methods: policy.methods, mode: policy.mode, integration: policy.integration };
}
async function paymentAvailability(db, tenantId) {
  try {
    const r = await assertDokuReadiness(db, tenantId);
    return { enabled: true, methods: r.methods };
  } catch {
    return { enabled: false, methods: [] };
  }
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
function invoicePaymentUrl(i, currentRevision) {
  if (process.env.DOKU_PAYMENTS_ENABLED?.trim() !== "1" || !checkoutPilotAllowed(i?.tenant_id || "") || !isQrisCheckoutInvoice(i) || i.payment_status !== "PENDING" || i.reconciliation_status !== "PENDING" || providerOrderTerminal(i) || ["PROVIDER_EXPIRED", "RELATED_LATE_PAYMENT_REQUIRES_REVIEW"].includes(i.reconciliation_note) || !Number.isFinite(new Date(i.due_date).getTime()) || new Date(i.due_date).getTime() <= Date.now() || currentRevision !== void 0 && i.quote.revision !== currentRevision) return null;
  try {
    return validateDokuPaymentUrl(i.payment_link_url);
  } catch {
    return null;
  }
}

// services/billing/routes.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// services/billing/recovery.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// services/billing/engine.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// src/config/freePlanPolicy.ts
var FREE_PLAN_ID = "plan-free-lifetime";
var FREE_PRODUCT_LIMIT = 10;
function isFreePlan(sub, now = Date.now()) {
  if (!sub || sub.isActive === false || ["SUSPENDED", "CANCELED", "CANCELLED"].includes(sub.status)) return false;
  if (sub.status === "FREE" || sub.planId === FREE_PLAN_ID) return true;
  const trial = ["TRIAL", "TRIALING"].includes(sub.status) || sub.planId === "plan-free" && ["EXPIRED", "PAST_DUE"].includes(sub.status);
  const end = Date.parse(sub.currentPeriodEnd);
  return trial && Number.isFinite(end) && now >= end;
}
function validateFreeSelection(value) {
  const v = value;
  const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 160;
  if (!v || !Array.isArray(v.productIds) || v.productIds.length > FREE_PRODUCT_LIMIT || !v.productIds.every(validId) || new Set(v.productIds).size !== v.productIds.length || !validId(v.branchId) || !["FNB", "RETAIL", "LAUNDRY", "BARBERSHOP", "CARWASH"].includes(v.sector || "")) throw new Error("INVALID_FREE_SELECTION");
  return { productIds: [...v.productIds], branchId: v.branchId, sector: v.sector };
}

// src/config/saasPlans.ts
var TRIAL_PLAN_ID = "plan-free";
var TRIAL_DAYS = 45;
var TRIAL_READ_ONLY_DAYS = 14;
var DAY_MS = 864e5;
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
function findSaaSPlan(planId) {
  return SAAS_PLANS.find((plan) => plan.id === planId) ?? null;
}
function addBillingPeriod(start, cycle) {
  const end = new Date(start);
  const originalDay = end.getUTCDate();
  const monthsToAdd = cycle === "YEARLY" ? 12 : 1;
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + monthsToAdd);
  const lastDayInTargetMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(originalDay, lastDayInTargetMonth));
  return end;
}

// src/config/subscriptionPolicy.ts
function subscriptionAccess(sub, now = Date.now()) {
  if (isFreePlan(sub, now)) return { accessMode: "FULL", status: "FREE", daysLeft: 0, graceDaysLeft: 0 };
  const end = Date.parse(sub.currentPeriodEnd);
  const grace = sub.gracePeriodEnd ? Date.parse(sub.gracePeriodEnd) : end + 14 * DAY_MS;
  const terminal = ["EXPIRED", "CANCELED", "CANCELLED", "SUSPENDED"].includes(sub.status);
  const accessMode = terminal || !Number.isFinite(end) || now >= grace ? "RESTRICTED" : now >= end ? "READ_ONLY" : "FULL";
  return {
    accessMode,
    status: accessMode === "RESTRICTED" ? "EXPIRED" : accessMode === "READ_ONLY" ? "PAST_DUE" : sub.status === "TRIALING" ? "TRIAL" : sub.status,
    daysLeft: Math.max(0, Math.ceil((end - now) / DAY_MS)),
    graceDaysLeft: Math.max(0, Math.ceil((grace - Math.max(now, end)) / DAY_MS))
  };
}
function lifecycleStage(day) {
  if (day <= 3) return "ACTIVATION";
  if (day <= 10) return "DAILY_OPERATIONS";
  if (day <= 20) return "WORKFLOW";
  if (day <= 30) return "OWNER_INSIGHTS";
  if (day <= 40) return "CONVERSION";
  if (day <= 45) return "FINAL_REMINDER";
  return "FREE";
}
function billingQuote(sub, input, outletCount, now = /* @__PURE__ */ new Date()) {
  const plan = findSaaSPlan(input.planId || input.targetPlanId);
  if (!plan || plan.priceIdr <= 0) throw new Error("INVALID_PAID_PLAN");
  const cycle = input.billingCycle ?? sub.billing_cycle ?? "MONTHLY";
  if (!["MONTHLY", "YEARLY"].includes(cycle)) throw new Error("INVALID_BILLING_CYCLE");
  const extras = Number(input.extraOutlets ?? sub.extra_outlets ?? 0);
  if (!Number.isInteger(extras) || extras < 0 || extras > 100) throw new Error("INVALID_EXTRA_OUTLETS");
  if (outletCount > plan.maxOutlets + extras) throw new Error("OUTLET_LIMIT_BELOW_USAGE");
  const recurringAmount = cycle === "YEARLY" ? ((plan.priceYearlyIdr ?? plan.priceIdr) + extras * (plan.extraOutletYearlyIdr ?? 0)) * 12 : plan.priceIdr + extras * (plan.extraOutletPriceIdr ?? 0);
  const active = sub.status === "ACTIVE" && Date.parse(sub.current_period_end) > now.getTime();
  const same = sub.plan_id === plan.id && sub.billing_cycle === cycle && Number(sub.extra_outlets) === extras;
  const oldEnd = new Date(sub.current_period_end);
  const start = active && same ? oldEnd : now;
  const fraction = active && !same ? Math.max(0, Math.min(1, (oldEnd.getTime() - now.getTime()) / (oldEnd.getTime() - Date.parse(sub.current_period_start)))) : 0;
  const credit = Math.floor(Number(sub.recurring_amount || 0) * fraction);
  if (credit > recurringAmount) throw new Error("CHANGE_AT_RENEWAL_REQUIRED");
  return {
    planId: plan.id,
    planName: plan.name,
    billingCycle: cycle,
    extraOutlets: extras,
    recurringAmount,
    unusedCredit: credit,
    amount: recurringAmount - credit,
    currency: "IDR",
    periodStart: start.toISOString(),
    periodEnd: addBillingPeriod(start, cycle).toISOString(),
    revision: Number(sub.revision || 0),
    maxOutlets: plan.maxOutlets + extras
  };
}

// services/billing/freePlan.ts
var FreePlanAccessError = class extends Error {
};
async function validateFreeBranchSelection(db, ownerId, value) {
  const selection = validateFreeSelection(value);
  const { rows } = await db.query(`SELECT o.tenant_id FROM internal.outlets o
    JOIN internal.tenants t ON t.id=o.tenant_id
    JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    WHERE o.id::text=$1 AND t.owner_user_ref=$2 AND t.is_active AND o.is_active
      AND m.business_sector=$3`, [selection.branchId, ownerId, selection.sector]);
  if (!rows.length) throw new FreePlanAccessError("BRANCH_NOT_OWNED");
  const existing = await db.query(
    `SELECT p.external_ref FROM pos.products p
    JOIN internal.tenants t ON t.id=p.tenant_id WHERE t.owner_user_ref=$1
      AND p.external_ref=ANY($2::text[]) AND p.business_sector=$3
      AND (p.tenant_id<>$4::uuid OR p.outlet_id IS DISTINCT FROM $5::uuid)`,
    [ownerId, selection.productIds, selection.sector, rows[0].tenant_id, selection.branchId]
  );
  if (existing.rows.length) throw new FreePlanAccessError("FREE_PRODUCT_BRANCH_MISMATCH");
  return selection;
}
async function freePlanState(db, tenantId) {
  const { rows } = await db.query("SELECT * FROM contract.free_plan_entitlements WHERE tenant_id=$1", [tenantId]);
  const s = rows[0];
  if (!s || !s.is_active) return { free: false };
  const free = isFreePlan({ status: s.status, planId: s.plan_id, currentPeriodEnd: new Date(s.current_period_end).toISOString() });
  return { free, ownerId: s.owner_user_ref, selection: free && s.free_selection ? validateFreeSelection(s.free_selection) : void 0 };
}

// services/billing/engine.ts
var BillingError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function ensureSubscription(db, tenantId) {
  await db.query(`INSERT INTO billing.subscriptions
    (id,tenant_id,plan_id,status,billing_cycle,current_period_start,current_period_end,grace_period_end,trial_started_at,trial_ends_at,has_used_trial)
    SELECT $1,id,$3,'TRIAL','MONTHLY',created_at,created_at+interval '45 days',created_at+interval '59 days',created_at,created_at+interval '45 days',true
    FROM internal.tenants WHERE id=$2 ON CONFLICT(tenant_id) DO NOTHING`, [randomUUID2(), tenantId, TRIAL_PLAN_ID]);
  const { rows } = await db.query("SELECT * FROM billing.subscriptions WHERE tenant_id=$1", [tenantId]);
  if (!rows[0]) throw new BillingError(404, "TENANT_NOT_FOUND");
  return rows[0];
}
async function activateFreeTrial(db, tenantId) {
  const existing = await ensureSubscription(db, tenantId);
  if (existing.has_used_trial && existing.status !== "TRIAL") {
    throw new BillingError(400, "TRIAL_ALREADY_USED");
  }
  if (existing.status === "TRIAL") {
    return serializeSubscription(existing);
  }
  const { rows } = await db.query(`
    UPDATE billing.subscriptions
    SET plan_id = $2,
        status = 'TRIAL',
        billing_cycle = 'MONTHLY',
        current_period_start = now(),
        current_period_end = now() + interval '45 days',
        grace_period_end = now() + interval '59 days',
        trial_started_at = COALESCE(trial_started_at, now()),
        trial_ends_at = now() + interval '45 days',
        has_used_trial = true,
        revision = revision + 1,
        updated_at = now()
    WHERE tenant_id = $1
    RETURNING *
  `, [tenantId, TRIAL_PLAN_ID]);
  if (!rows[0]) throw new BillingError(400, "TRIAL_ALREADY_USED");
  return serializeSubscription(rows[0]);
}
function serializeSubscription(s) {
  const iso = (x) => new Date(x).toISOString();
  const free = isFreePlan({ status: s.status, planId: s.plan_id, currentPeriodEnd: iso(s.current_period_end) });
  const planId = free ? FREE_PLAN_ID : s.plan_id;
  return {
    id: s.id,
    tenantId: s.tenant_id,
    planId,
    status: free ? "FREE" : s.status,
    plan: findSaaSPlan(planId),
    freeSelection: free ? s.free_selection : void 0,
    currentPeriodStart: iso(s.current_period_start),
    currentPeriodEnd: iso(s.current_period_end),
    gracePeriodEnd: s.grace_period_end ? iso(s.grace_period_end) : void 0,
    billingCycle: s.billing_cycle,
    extraOutlets: free ? 0 : s.extra_outlets,
    trialStartedAt: s.trial_started_at ? iso(s.trial_started_at) : null,
    trialEndsAt: s.trial_ends_at ? iso(s.trial_ends_at) : null,
    hasUsedTrial: Boolean(s.has_used_trial)
  };
}
function invoicePaymentState(i, now = Date.now()) {
  if (i.payment_status === "PAID" || i.payment_status === "REFUNDED") return i.payment_status;
  const observed = String(i.reconciliation_note || "").replace("PROVIDER_", "");
  if (observed === "ORDER_EXPIRED") return "EXPIRED";
  if (["FAILED", "EXPIRED", "CANCELLED"].includes(observed)) return observed;
  if (new Date(i.due_date).getTime() <= now) return "EXPIRED";
  return i.payment_status;
}
function serializeInvoice(i, currentRevision, allowPaymentLink = false) {
  return {
    id: i.id,
    invoiceNumber: i.invoice_number,
    subscriptionId: i.subscription_id,
    tenantId: i.tenant_id,
    amount: Number(i.amount),
    currency: i.currency,
    paymentStatus: invoicePaymentState(i),
    paymentGatewayRef: i.payment_gateway_ref,
    paymentLinkUrl: allowPaymentLink ? invoicePaymentUrl(i, currentRevision) : null,
    paidAt: i.paid_at,
    dueDate: i.due_date,
    createdAt: i.created_at,
    planId: i.quote?.planId,
    planName: i.quote?.planName || "Tagihan legacy",
    billingCycle: i.quote?.billingCycle,
    extraOutlets: i.quote?.extraOutlets,
    reconciliationStatus: i.reconciliation_status
  };
}
async function outletUsage(db, tenantId) {
  const { rows } = await db.query("SELECT count(*)::int AS count FROM internal.outlets WHERE tenant_id=$1 AND is_active", [tenantId]);
  return Number(rows[0].count);
}
async function subscriptionStatus(db, tenantId) {
  const s = await ensureSubscription(db, tenantId);
  const sub = serializeSubscription(s);
  const access = subscriptionAccess(sub);
  const tenant = await db.query("SELECT is_active FROM internal.tenants WHERE id=$1", [tenantId]);
  if (!tenant.rows[0]) throw new BillingError(404, "TENANT_NOT_FOUND");
  if (tenant.rows[0].is_active === false) Object.assign(access, { accessMode: "RESTRICTED", status: "EXPIRED" });
  const invoices = await db.query("SELECT * FROM billing.invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100", [tenantId]);
  const startMs = Date.parse(sub.currentPeriodStart);
  const endMs = Date.parse(sub.currentPeriodEnd);
  const nowMs = Date.now();
  const activeDays = Math.max(0, Math.floor((nowMs - startMs) / DAY_MS));
  const totalPeriodDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS));
  const trialDay = Math.max(1, Math.floor((nowMs - Date.parse(s.trial_started_at || s.created_at)) / DAY_MS) + 1);
  const free = access.status === "FREE";
  const requiresRenewal = !free && (access.accessMode !== "FULL" || access.daysLeft <= 3);
  const retainedOutlets = await outletUsage(db, tenantId);
  const availability = await paymentAvailability(db, tenantId);
  return {
    ok: true,
    subscription: { ...sub, status: access.status, accessMode: access.accessMode, isActive: !!tenant.rows[0]?.is_active },
    plan: sub.plan,
    ...access,
    activeDays,
    totalPeriodDays,
    requiresRenewal,
    renewalDueDate: sub.currentPeriodEnd,
    trialDay,
    lifecycleStage: lifecycleStage(trialDay),
    trialDays: TRIAL_DAYS,
    hasUsedTrial: Boolean(s.has_used_trial),
    outlets: { used: free ? sub.freeSelection ? 1 : 0 : retainedOutlets, retained: retainedOutlets, included: sub.plan?.maxOutlets ?? 2, extra: free ? 0 : Number(s.extra_outlets), limit: free ? 1 : (sub.plan?.maxOutlets ?? 2) + Number(s.extra_outlets) },
    paymentAvailability: availability,
    invoices: invoices.rows.map((i) => serializeInvoice(i, Number(s.revision), availability.enabled))
  };
}
async function createQuote(db, tenantId, input) {
  const s = await ensureSubscription(db, tenantId);
  try {
    return billingQuote(s, input, await outletUsage(db, tenantId));
  } catch (err) {
    throw new BillingError(400, err.message);
  }
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
async function assertTenantWritable(db, tenantId) {
  const free = await freePlanState(db, tenantId);
  if (free.free) {
    if (!free.selection) throw new BillingError(403, "FREE_SELECTION_REQUIRED");
    return;
  }
  const { rows } = await db.query(`SELECT t.is_active,t.created_at,s.status,s.current_period_end,s.grace_period_end
    FROM internal.tenants t LEFT JOIN contract.subscription_operations s ON s.tenant_id=t.id WHERE t.id=$1`, [tenantId]);
  const s = rows[0];
  if (!s) throw new BillingError(403, "TENANT_NOT_FOUND");
  const end = s.current_period_end || new Date(Date.parse(s.created_at) + TRIAL_DAYS * DAY_MS).toISOString();
  const access = subscriptionAccess({ status: s.status || "TRIAL", currentPeriodEnd: new Date(end).toISOString(), gracePeriodEnd: s.grace_period_end ? new Date(s.grace_period_end).toISOString() : void 0 });
  if (!s.is_active || access.accessMode !== "FULL") throw new BillingError(403, "SUBSCRIPTION_READ_ONLY");
}
async function assertOutletCapacity(db, tenantId, excludeId) {
  const free = await freePlanState(db, tenantId);
  if (free.free) {
    if (!excludeId || excludeId !== free.selection?.branchId) throw new BillingError(403, "FREE_BRANCH_LIMIT");
    return;
  }
  await db.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [tenantId]);
  await assertTenantWritable(db, tenantId);
  const { rows } = await db.query("SELECT plan_id,extra_outlets FROM contract.subscription_operations WHERE tenant_id=$1", [tenantId]);
  const limit = (findSaaSPlan(rows[0]?.plan_id)?.maxOutlets ?? 2) + Number(rows[0]?.extra_outlets || 0);
  const used = await db.query("SELECT count(*)::int AS count FROM internal.outlets WHERE tenant_id=$1 AND is_active AND ($2::uuid IS NULL OR id<>$2)", [tenantId, excludeId || null]);
  if (Number(used.rows[0].count) >= limit) throw new BillingError(409, "OUTLET_LIMIT_REACHED");
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

// services/pos/businessScope.ts
var BusinessScopeError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function resolveBusinessScope(db, subject, sector, businessId) {
  if (businessId !== void 0 && (typeof businessId !== "string" || !businessId || businessId.length > 128))
    throw new BusinessScopeError(400, "INVALID_BUSINESS_ID");
  const tenantId = await tenantForPrincipal(db, { subject });
  if (!tenantId) {
    if (businessId !== void 0) throw new BusinessScopeError(403, "BUSINESS_ACCESS_DENIED");
    return null;
  }
  const result = await db.query(`SELECT m.id AS merchant_id,m.name AS business_name,m.external_ref
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE t.id=$1 AND t.owner_user_ref=$2 AND t.is_active AND t.merged_into IS NULL
      AND m.business_sector=$3 AND m.is_active
      AND ($4::text IS NULL OR m.id::text=$4 OR m.external_ref=$4)
    ORDER BY m.id`, [tenantId, subject, sector, businessId ?? null]);
  const rows = result.rows;
  if (businessId !== void 0 && rows.length !== 1) throw new BusinessScopeError(403, "BUSINESS_ACCESS_DENIED");
  const aliases = rows.filter((row) => row.external_ref === `${subject}_${sector}`);
  const selected = businessId !== void 0 ? rows[0] : aliases.length === 1 ? aliases[0] : rows.length === 1 ? rows[0] : null;
  if (!selected) {
    if (rows.length) throw new BusinessScopeError(409, "BUSINESS_SELECTION_REQUIRED");
    return null;
  }
  return {
    tenantId,
    merchantId: selected.merchant_id,
    businessName: selected.business_name,
    transportRef: selected.external_ref || selected.merchant_id,
    legacyAlias: selected.external_ref === `${subject}_${sector}` ? selected.external_ref : null
  };
}

// services/billing/routes.ts
function coordinate(value, limit) {
  if (value === null || value === void 0 || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit && n !== 0 ? n : null;
}
function registerBillingRoutes(app, db, viaGateway = false, checkoutProvider = createDokuCheckout, inquiryProvider = checkDokuOrderStatus, inquiryClock) {
  const run = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (req.path === DOKU_NOTIFICATION_PATH && err instanceof BillingError) console.warn("[doku] NOTIFICATION_REJECTED", err.message);
      if (err instanceof AuthUnavailableError) return res.status(503).json({ ok: false, error: "AUTH_UNAVAILABLE" });
      if (!(err instanceof BillingError)) {
        const diagnostic = err;
        console.error("[billing] INTERNAL_OPERATION_FAILED", { route: req.path, code: diagnostic.code, constraint: diagnostic.constraint, table: diagnostic.table, column: diagnostic.column });
      }
      res.status(err instanceof BillingError ? err.status : 500).json({ ok: false, error: err instanceof BillingError ? err.message : "BILLING_UNAVAILABLE" });
    }
  };
  const tenant = async (req, allowProvision = true) => {
    const principal = viaGateway ? trustedPrincipal(req) : await authenticateBearer(req);
    const allowLocal = process.env.NODE_ENV !== "production" && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === "1";
    if (!principal || principal.subject === "local-development" && !allowLocal) throw new BillingError(401, "AUTHENTICATION_REQUIRED");
    let id = await tenantForPrincipal(db, principal);
    if (!id && allowProvision && principal.subject !== "local-development") {
      const name = principal.email ? principal.email.split("@")[0] : "Toko Utama";
      const res = await db.query(
        `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref, is_active)
         VALUES (uuidv7(), $1, $2, $2, true)
         ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name, principal.subject]
      );
      id = res.rows[0]?.id;
    }
    if (!id) throw new BillingError(403, "TENANT_NOT_PROVISIONED");
    return id;
  };
  app.get("/api/v1/subscription/plans", (_req, res) => res.json({ ok: true, plans: SAAS_PLANS }));
  app.get("/api/v1/subscription/status", run(async (req, res) => res.json(await subscriptionStatus(db, await tenant(req)))));
  app.post("/api/v1/subscription/start-trial", run(async (req, res) => res.json({ ok: true, subscription: await activateFreeTrial(db, await tenant(req)) })));
  app.post("/api/v1/subscription/free-plan", run(async (req, res) => {
    const principal = viaGateway ? trustedPrincipal(req) : await authenticateBearer(req);
    if (!principal || principal.subject === "local-development") throw new BillingError(401, "AUTHENTICATION_REQUIRED");
    res.setHeader("Cache-Control", "no-store");
    const tenantId = await db.tx(async (c) => {
      const { rows } = await c.query(`SELECT s.* FROM billing.subscriptions s JOIN internal.tenants t ON t.id=s.tenant_id
        WHERE t.owner_user_ref=$1 AND t.is_active ORDER BY t.created_at,t.id LIMIT 1 FOR UPDATE OF s`, [principal.subject]);
      const s = rows[0];
      if (!s || !isFreePlan({ status: s.status, planId: s.plan_id, currentPeriodEnd: new Date(s.current_period_end).toISOString() })) throw new BillingError(409, "FREE_PLAN_NOT_ELIGIBLE");
      try {
        const selection = await validateFreeBranchSelection(c, principal.subject, req.body);
        await c.query("UPDATE billing.subscriptions SET free_selection=$2::jsonb,updated_at=now() WHERE id=$1", [s.id, JSON.stringify(selection)]);
      } catch (error) {
        if (error instanceof FreePlanAccessError) throw new BillingError(409, error.message);
        if (error instanceof Error && error.message === "INVALID_FREE_SELECTION") throw new BillingError(400, error.message);
        throw error;
      }
      return s.tenant_id;
    });
    res.json(await subscriptionStatus(db, tenantId));
  }));
  app.get("/api/v1/subscription/outlets", run(async (req, res) => {
    const { rows } = await db.query(`SELECT o.*,m.business_sector FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id WHERE o.tenant_id=$1 ORDER BY o.created_at`, [await tenant(req)]);
    res.json({ ok: true, rows });
  }));
  app.post("/api/v1/subscription/outlets", run(async (req, res) => {
    const tenantId = await tenant(req), b = req.body || {};
    const principal = viaGateway ? trustedPrincipal(req) : await authenticateBearer(req);
    if (!principal || principal.subject === "local-development") throw new BillingError(401, "AUTHENTICATION_REQUIRED");
    const sector = String(b.businessSector || "FNB");
    if (!["FNB", "RETAIL", "LAUNDRY", "BARBERSHOP", "CARWASH"].includes(sector)) throw new BillingError(400, "INVALID_BUSINESS_SECTOR");
    if (!b.name || !String(b.name).trim() || String(b.name).length > 150) throw new BillingError(400, "INVALID_OUTLET_NAME");
    const result = await db.tx(async (c) => {
      await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [tenantId]);
      await assertTenantWritable(c, tenantId);
      let scope;
      try {
        scope = await resolveBusinessScope(c, principal.subject, sector, b.businessId);
      } catch (error) {
        if (error instanceof BusinessScopeError) throw new BillingError(error.status, error.message);
        throw error;
      }
      if (!scope || scope.tenantId !== tenantId) throw new BillingError(409, "BUSINESS_SETUP_REQUIRED");
      const merchant = { id: scope.merchantId };
      const id = /^[0-9a-f-]{36}$/i.test(b.id || "") ? b.id : randomUUID4();
      const existing = (await c.query("SELECT * FROM internal.outlets WHERE id=$1", [id])).rows[0];
      if (existing && (existing.tenant_id !== tenantId || existing.merchant_id !== merchant.id)) throw new BillingError(403, "OUTLET_NOT_OWNED");
      if (b.isActive !== false) await assertOutletCapacity(c, tenantId, id);
      const { rows } = await c.query(
        `INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,address,latitude,longitude,radius_meters,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,
        latitude=excluded.latitude,longitude=excluded.longitude,radius_meters=excluded.radius_meters,is_active=excluded.is_active RETURNING *`,
        [id, tenantId, merchant.id, String(b.name).trim(), String(b.address ?? existing?.address ?? ""), coordinate(b.latitude ?? existing?.latitude, 90), coordinate(b.longitude ?? existing?.longitude, 180), Math.max(1, Number(b.allowedRadiusMeters ?? existing?.radius_meters) || 100), b.isActive !== false]
      );
      return rows[0];
    });
    res.json({ ok: true, outlet: result });
  }));
  app.post("/api/v1/subscription/prorated-upgrade", run(async (req, res) => {
    const quote = await createQuote(db, await tenant(req), req.body || {});
    res.json({ ok: true, ...quote, netProratedAmount: quote.amount, proratedAmountIdr: quote.amount, breakdown: { newPlanPrice: quote.recurringAmount, unusedCredit: quote.unusedCredit, total: quote.amount } });
  }));
  app.post("/api/v1/subscription/checkout", run(async (req, res) => {
    if (process.env.DOKU_PAYMENTS_ENABLED?.trim() !== "1") throw new BillingError(503, "PAYMENTS_PAUSED");
    try {
      dokuSubscriptionPolicy();
      if (!isDokuConfigured()) throw Error("PAYMENT_GATEWAY_NOT_CONFIGURED");
    } catch (e) {
      throw new BillingError(503, e.message);
    }
    const tenantId = await tenant(req, false);
    let policy;
    try {
      policy = await assertDokuReadiness(db, tenantId);
    } catch (e) {
      const code = e.message;
      throw new BillingError(code === "CHECKOUT_PILOT_ONLY" ? 403 : 503, code);
    }
    const key = String(req.body?.requestKey || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new BillingError(400, "CHECKOUT_REQUEST_KEY_REQUIRED");
    let configured = false;
    try {
      configured = isDokuConfigured();
    } catch {
    }
    if (!configured) throw new BillingError(503, "PAYMENT_GATEWAY_NOT_CONFIGURED");
    const allowedChannels = policy.methods;
    const quote = { ...await createQuote(db, tenantId, req.body || {}), allowedChannels, paymentIntegration: policy.integration, paymentMode: policy.mode, releaseAcceptanceId: policy.acceptanceId };
    if (quote.amount <= 0) throw new BillingError(409, "ZERO_CHARGE_REQUIRES_SUPPORT");
    const origin = process.env.PUBLIC_APP_URL;
    if (!origin || !/^https:\/\/[^/?#@]+\/?$/.test(origin)) throw new BillingError(503, "PUBLIC_APP_URL_NOT_CONFIGURED");
    const id = randomUUID4(), invoiceNumber = `NH-${id}`;
    const result = await db.tx(async (c) => {
      await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [tenantId]);
      const current = (await c.query("SELECT revision FROM billing.subscriptions WHERE tenant_id=$1 FOR UPDATE", [tenantId])).rows[0];
      if (Number(current?.revision) !== quote.revision) throw new BillingError(409, "CHECKOUT_QUOTE_CHANGED");
      const held = (await c.query(`SELECT id FROM billing.invoices WHERE tenant_id=$1 AND reconciliation_status='REVIEW'
        AND reconciliation_note=ANY($3::text[])
        AND quote->>'revision'=$2::text LIMIT 1`, [tenantId, quote.revision, FINANCIAL_HOLD_REASONS])).rows[0];
      if (held) throw new BillingError(409, "PAYMENT_REVIEW_REQUIRED");
      const sameKey = (await c.query("SELECT * FROM billing.invoices WHERE tenant_id=$1 AND checkout_key=$2", [tenantId, key])).rows[0];
      if (sameKey?.payment_status === "PAID") return { rowCount: 0, rows: [sameKey] };
      if (sameKey && (providerOrderTerminal(sameKey) || new Date(sameKey.due_date).getTime() <= Date.now())) throw new BillingError(409, "CHECKOUT_EXPIRED");
      if (sameKey && !providerOrderTerminal(sameKey) && new Date(sameKey.due_date).getTime() > Date.now()) return { rowCount: 0, rows: [sameKey] };
      const open = (await c.query(`SELECT * FROM billing.invoices WHERE tenant_id=$1 AND payment_status='PENDING'
        AND reconciliation_note IS DISTINCT FROM 'PROVIDER_ORDER_EXPIRED' AND reconciliation_note IS DISTINCT FROM 'PROVIDER_CANCELLED'
        AND due_date>now() AND quote->>'revision'=$2::text ORDER BY created_at LIMIT 1`, [tenantId, quote.revision])).rows[0];
      if (open) {
        if (open.quote?.planId !== quote.planId || open.quote?.billingCycle !== quote.billingCycle || open.quote?.extraOutlets !== quote.extraOutlets) throw new BillingError(409, "CHECKOUT_PENDING_EXISTS");
        return { rowCount: 0, rows: [open] };
      }
      return c.query(`INSERT INTO billing.invoices(id,subscription_id,tenant_id,amount,currency,due_date,invoice_number,quote,checkout_key)
        SELECT $1,id,tenant_id,$3,'IDR',now()+interval '24 hours',$4,$5::jsonb,$6 FROM billing.subscriptions
        WHERE tenant_id=$2 RETURNING *`, [id, tenantId, quote.amount, invoiceNumber, JSON.stringify(quote), key]);
    });
    if (!result.rowCount) {
      const existing = result.rows[0];
      if (existing?.quote?.planId !== quote.planId || existing?.quote?.billingCycle !== quote.billingCycle || existing?.quote?.extraOutlets !== quote.extraOutlets) throw new BillingError(409, "CHECKOUT_KEY_CONFLICT");
      if (existing.payment_status === "PAID") return res.json({ ok: true, paid: existing.reconciliation_status === "APPLIED", invoice: serializeInvoice(existing), replayed: true });
      if (!isQrisCheckoutInvoice(existing))
        throw new BillingError(409, "CHECKOUT_SCOPE_REVIEW_REQUIRED");
      if (new Date(existing.due_date).getTime() <= Date.now()) throw new BillingError(409, "CHECKOUT_EXPIRED");
      const paymentUrl = invoicePaymentUrl(existing, quote.revision);
      if (!paymentUrl) throw new BillingError(409, "CHECKOUT_IN_PROGRESS_OR_NEEDS_REVIEW");
      return res.json({ ok: true, paymentUrl, invoice: serializeInvoice(existing, quote.revision, true), quote: existing.quote, replayed: true });
    }
    try {
      const checkout = await checkoutProvider({ order: {
        invoice_number: invoiceNumber,
        amount: quote.amount,
        currency: "IDR",
        callback_url: `${origin.replace(/\/$/, "")}/subscription?invoice=${id}`,
        auto_redirect: true,
        line_items: [{ name: `${quote.planName} ${quote.billingCycle} + ${quote.extraOutlets} outlet`, price: quote.amount, quantity: 1 }]
      }, payment: { payment_due_date: 1440, payment_method_types: allowedChannels } });
      await db.query("UPDATE billing.invoices SET payment_link_url=$2 WHERE id=$1", [id, checkout.paymentUrl]);
      if (checkout.expiresAt) await db.query("UPDATE billing.invoices SET due_date=least(due_date,$2::timestamptz) WHERE id=$1", [id, checkout.expiresAt]);
      const fresh = (await db.query("SELECT * FROM billing.invoices WHERE id=$1", [id])).rows[0];
      const current = (await db.query("SELECT revision FROM billing.subscriptions WHERE tenant_id=$1", [tenantId])).rows[0];
      res.json({ ok: true, paid: fresh.payment_status === "PAID" && fresh.reconciliation_status === "APPLIED", paymentUrl: invoicePaymentUrl(fresh, Number(current.revision)), invoice: serializeInvoice(fresh, Number(current.revision), true), quote });
    } catch (err) {
      await db.query("UPDATE billing.invoices SET reconciliation_status='REVIEW',reconciliation_note=coalesce(reconciliation_note,'CHECKOUT_RESPONSE_FAILED') WHERE id=$1 AND payment_status<>'PAID'", [id]);
      throw err;
    }
  }));
  app.get("/api/v1/subscription/verify", run(async (req, res) => {
    const tenantId = await tenant(req);
    const invoiceId = typeof req.query?.invoiceId === "string" ? req.query.invoiceId : void 0;
    const invoiceNumber = typeof req.query?.invoiceNumber === "string" ? req.query.invoiceNumber : void 0;
    let query = "SELECT * FROM billing.invoices WHERE tenant_id=$1";
    const params = [tenantId];
    if (invoiceId) {
      query += " AND id=$2";
      params.push(invoiceId);
    } else if (invoiceNumber) {
      query += " AND invoice_number=$2";
      params.push(invoiceNumber);
    } else {
      query += " ORDER BY created_at DESC LIMIT 1";
    }
    const { rows } = await db.query(query, params);
    const inv = rows[0];
    if (!inv) throw new BillingError(404, "INVOICE_NOT_FOUND");
    if (inv.payment_status !== "PAID" || inv.reconciliation_status !== "APPLIED") {
      let configured = false;
      try {
        configured = isDokuConfigured();
      } catch {
      }
      if (configured) {
        try {
          await reconcileInvoiceByInquiry(db, inv, inquiryProvider, { now: inquiryClock, observeOnly: req.query.inquire !== "1" });
        } catch {
          console.warn("[doku-verify] INQUIRY_UNAVAILABLE");
        }
      }
    }
    const fresh = (await db.query("SELECT * FROM billing.invoices WHERE id=$1 AND tenant_id=$2", [inv.id, tenantId])).rows[0];
    const statusData = await subscriptionStatus(db, tenantId);
    const paid = fresh.payment_status === "PAID" && fresh.reconciliation_status === "APPLIED";
    res.json({
      ok: true,
      paid,
      status: paid ? statusData.subscription.status : "PENDING_PAYMENT",
      invoice: statusData.invoices.find((i) => i.id === fresh.id) || serializeInvoice(fresh, -1),
      subscription: statusData.subscription
    });
  }));
  app.post("/api/v1/subscription/simulate-payment", (_req, res) => res.status(403).json({ ok: false, error: "PAYMENT_SIMULATION_DISABLED" }));
  app.post("/api/v1/webhooks/payment-gateway", (_req, res) => res.status(410).json({ ok: false, error: "USE_SIGNED_DOKU_WEBHOOK" }));
  app.post(DOKU_NOTIFICATION_PATH, run(async (req, res) => {
    if (req.originalUrl !== DOKU_NOTIFICATION_PATH) throw new BillingError(400, "INVALID_NOTIFICATION_TARGET");
    const raw = req.rawBody;
    if (raw && Buffer.byteLength(raw) > 32768) throw new BillingError(413, "NOTIFICATION_TOO_LARGE");
    if (!raw || !verifyDokuWebhookSignature(req.headers, raw, DOKU_NOTIFICATION_PATH)) throw new BillingError(401, "INVALID_WEBHOOK_SIGNATURE");
    let channels;
    try {
      channels = getDokuAllowedChannels();
    } catch {
      throw new BillingError(503, "DOKU_CHANNEL_SCOPE_NOT_CONFIGURED");
    }
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new BillingError(400, "INVALID_NOTIFICATION_JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BillingError(400, "INVALID_NOTIFICATION_BODY");
    const status = String(body?.transaction?.status || "");
    const evidence = dokuChannelEvidence(body), channel = evidence.channel;
    const stableReference = dokuPaymentReference(body);
    const invoice = body?.order?.invoice_number, amount = body?.order?.amount;
    if (typeof invoice !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(invoice) || !["string", "number"].includes(typeof amount) || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)) || !Number.isFinite(Number(amount))) throw new BillingError(400, "INVALID_NOTIFICATION_ORDER");
    const issue = evidence.issue || (!channel || !channels.includes(channel) ? "UNAPPROVED_PAYMENT_CHANNEL" : !stableReference ? channel === "QRIS" ? "QRIS_PAYMENT_REFERENCE_MISSING" : "PAYMENT_REFERENCE_MISSING" : ["REFUNDED", "PARTIAL_REFUNDED"].includes(status) ? "REFUND_REQUIRES_REVIEW" : ["VOIDED", "REVERSED"].includes(status) ? "REVERSAL_REQUIRES_REVIEW" : !["SUCCESS", "FAILED", "PENDING", "EXPIRED", "CANCELLED", "ORDER_EXPIRED"].includes(status) ? "UNKNOWN_PAYMENT_STATUS" : void 0);
    const result = await reconcilePayment(db, {
      eventKey: String(req.headers["request-id"] || ""),
      integration: "DOKU_CHECKOUT",
      invoiceNumber: invoice,
      reference: stableReference || (["QRIS", "QRIS_DOKU"].includes(evidence.providerChannel) ? "missing-qris-reference" : String(req.headers["request-id"] || "")),
      providerChannel: evidence.providerChannel,
      amount: Number(amount),
      currency: body?.order?.currency === void 0 ? "IDR" : String(body.order.currency),
      success: status === "SUCCESS",
      channel,
      validationIssue: issue,
      contentDigest: generateDigest(raw),
      payload: { status, channel, requestTimestamp: req.headers["request-timestamp"] }
    });
    res.json(result);
  }));
  app.all(DOKU_NOTIFICATION_PATH, (_req, res) => res.set("Allow", "POST").status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" }));
}

// src/server/serverlessBoundary.ts
import express from "express";

// src/server/vercelUrl.ts
function normalizeVercelUrl(req) {
  if (!req || typeof req.url !== "string") return;
  try {
    const parsed = new URL(req.url, "http://localhost");
    const customPath = parsed.searchParams.get("__path");
    if (customPath) {
      parsed.searchParams.delete("__path");
      const extraQs = parsed.searchParams.toString();
      if (customPath.includes("?")) {
        req.url = customPath + (extraQs ? `&${extraQs}` : "");
      } else {
        req.url = customPath + (extraQs ? `?${extraQs}` : "");
      }
      req.originalUrl = req.url;
      return;
    }
  } catch {
  }
  if (req.url.includes("[...slug]")) {
    const matched = req.headers?.["x-matched-path"] || req.headers?.["x-forwarded-uri"] || req.headers?.["x-original-url"];
    if (typeof matched === "string" && matched.startsWith("/") && !matched.includes("[...slug]")) {
      const qIdx = req.url.indexOf("?");
      const query = qIdx !== -1 ? req.url.slice(qIdx) : "";
      req.url = matched.includes("?") ? matched : matched + query;
      req.originalUrl = req.url;
    }
  }
}

// src/server/serverlessBoundary.ts
var TRUSTED_IDENTITY_HEADERS = [
  "x-auth-source-created-at",
  "x-auth-sub",
  "x-auth-email",
  "x-auth-email-verified",
  "x-internal-user",
  "x-env-override",
  "x-newhope-gateway-token"
];
function stripIdentityHeaders(req) {
  for (const key of TRUSTED_IDENTITY_HEADERS) delete req.headers[key];
}
function applyPrincipal(req, principal) {
  stripIdentityHeaders(req);
  req.headers["x-auth-sub"] = principal.subject;
  if (principal.sourceCreatedAt) req.headers["x-auth-source-created-at"] = principal.sourceCreatedAt;
  if (principal.email) req.headers["x-auth-email"] = principal.email;
  if (principal.isEmailVerified) req.headers["x-auth-email-verified"] = "true";
}
var MAX_RAW_BODY = 1048576;
async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "utf8");
  if (req.readableEnded || typeof req[Symbol.asyncIterator] !== "function") return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_RAW_BODY) throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 });
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function setParsedBody(req, raw) {
  let parsed = {};
  try {
    parsed = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    parsed = {};
  }
  req.rawBody = raw;
  try {
    Object.defineProperty(req, "body", { value: parsed, writable: true, configurable: true, enumerable: true });
  } catch {
    req.body = parsed;
  }
}
function createServerlessBoundary(options, authenticate = authenticateBearer, connect) {
  const publicRoutes = new Set(options.publicRoutes ?? []);
  const rawBodyRoutes = new Set(options.rawBodyRoutes ?? []);
  let runtime2;
  return async (req, res) => {
    normalizeVercelUrl(req);
    res.setHeader("Cache-Control", "no-store");
    const path = String(req.url || "").split("?")[0].replace(/\/+$/, "");
    if (!Object.hasOwn(options.routes, path)) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!options.routes[path].includes(req.method)) return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    if (publicRoutes.has(path)) {
      stripIdentityHeaders(req);
    } else {
      let principal = null;
      try {
        principal = await authenticate(req);
      } catch (error) {
        if (error instanceof AuthUnavailableError) {
          res.setHeader("Retry-After", "2");
          return res.status(503).json({ ok: false, error: "AUTH_UNAVAILABLE" });
        }
        principal = null;
      }
      if (!principal || principal.subject === "local-development") {
        return res.status(401).json({ ok: false, error: "AUTHENTICATION_REQUIRED" });
      }
      applyPrincipal(req, principal);
    }
    if (rawBodyRoutes.has(path) && req.method === "POST") {
      try {
        const raw = await readRawBody(req);
        if (!raw) return res.status(400).json({ ok: false, error: "RAW_BODY_REQUIRED" });
        setParsedBody(req, raw);
      } catch (error) {
        return res.status(error.status === 413 ? 413 : 400).json({ ok: false, error: "INVALID_REQUEST_BODY" });
      }
    }
    try {
      runtime2 ??= connect().then((db) => {
        const app = express();
        const parse = express.json({ limit: options.bodyLimit });
        app.use((request, response, next) => request.body !== void 0 ? next() : parse(request, response, next));
        options.register(app, db);
        app.use((_request, response) => response.status(404).json({ ok: false, error: "NOT_FOUND" }));
        app.use((error, _request, response, _next) => response.status(error?.type === "entity.too.large" ? 413 : 400).json({ ok: false, error: options.invalidRequestError }));
        return app;
      }).catch((error) => {
        runtime2 = void 0;
        throw error;
      });
      (await runtime2)(req, res);
    } catch (error) {
      const diagnostic = error;
      console.error(`[${options.name}] runtime unavailable`, { name: diagnostic.name, code: diagnostic.code || diagnostic.cause?.code, frames: diagnostic.stack?.split("\n").slice(1, 4) });
      return res.status(503).json({ ok: false, error: options.unavailableError });
    }
  };
}

// src/server/billingHandler.ts
var BILLING_ROUTES = {
  "/api/v1/subscription/plans": ["GET"],
  "/api/v1/subscription/status": ["GET"],
  "/api/v1/subscription/start-trial": ["POST"],
  "/api/v1/subscription/free-plan": ["POST"],
  "/api/v1/subscription/outlets": ["GET", "POST"],
  "/api/v1/subscription/prorated-upgrade": ["POST"],
  "/api/v1/subscription/checkout": ["POST"],
  "/api/v1/subscription/verify": ["GET"],
  [DOKU_NOTIFICATION_PATH]: ["POST"]
};
function createBillingHandler(authenticate = authenticateBearer, connect = () => connectDb({ schema: "billing", max: 2 })) {
  return createServerlessBoundary({
    name: "billing",
    routes: BILLING_ROUTES,
    publicRoutes: ["/api/v1/subscription/plans", DOKU_NOTIFICATION_PATH],
    rawBodyRoutes: [DOKU_NOTIFICATION_PATH],
    bodyLimit: "32kb",
    register: (app, db) => registerBillingRoutes(app, db, true),
    unavailableError: "BILLING_UNAVAILABLE",
    invalidRequestError: "INVALID_REQUEST"
  }, authenticate, connect);
}
var billingHandler_default = createBillingHandler();
export {
  billingHandler_default as default
};
