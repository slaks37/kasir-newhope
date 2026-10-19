// api/_runtime.ts
import express2 from "express";

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

// services/billing/routes.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// services/shared/neonAuth.ts
import { createRemoteJWKSet, jwtVerify, errors } from "jose";

// services/shared/neonPilot.ts
function neonPilotConfig(env = process.env) {
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
    const live = (await (provider === "better-auth" ? authDb : c).query(provider === "better-auth" ? 'SELECT id,email,"emailVerified",NOT "isActive" AS banned FROM newhope_auth."user" WHERE id=$1' : 'SELECT id,email,"emailVerified",banned FROM neon_auth."user" WHERE id::text=$1', [p.subject])).rows[0];
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
    return await bindNeonIdentity(await opening, p, config.issuer);
  } catch {
    throw new NeonAuthUnavailableError("NEON_IDENTITY_UNAVAILABLE");
  }
}
async function reauthenticateNeonOwner(db, email, password, canonicalSubject) {
  const config = neonPilotConfig();
  let response;
  try {
    response = await fetch(config.authUrl + "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: config.issuer },
      body: JSON.stringify({ email, password }),
      redirect: "error",
      signal: AbortSignal.timeout(5e3)
    });
  } catch {
    throw new NeonAuthUnavailableError("NEON_REAUTH_UNAVAILABLE");
  }
  if (response.status >= 500 || response.status === 429) throw new NeonAuthUnavailableError("NEON_REAUTH_UNAVAILABLE");
  if (!response.ok) return false;
  const data = await response.json();
  const cookies = response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
  try {
    if (data.user?.emailVerified !== true || typeof data.user?.id !== "string") return false;
    const binding = (await db.query(`SELECT canonical_user_id FROM internal.auth_identity_bindings
      WHERE provider='neon' AND issuer=$1 AND provider_subject=$2 AND is_active`, [config.issuer, data.user.id])).rows[0];
    return binding?.canonical_user_id === canonicalSubject;
  } finally {
    if (cookies) await fetch(config.authUrl + "/sign-out", {
      method: "POST",
      headers: { cookie: cookies, origin: config.issuer },
      redirect: "error",
      signal: AbortSignal.timeout(5e3)
    }).catch(() => {
    });
  }
}

// services/shared/betterAuth.ts
import { betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { PostgresDialect } from "kysely";
import pg2 from "pg";
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
  const text3 = mail.kind === "RESET" ? "Atur password New Hope Anda" : "Verifikasi email New Hope Anda";
  const safeUrl2 = mail.url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const key = createHash("sha256").update(mail.kind + ":" + mail.email + ":" + mail.url).digest("hex");
  return { payload: {
    from: env.AUTH_EMAIL_FROM,
    to: mail.email,
    replyTo: "stefen@newsystem.space",
    subject: text3,
    text: text3 + ". Buka tautan ini (berlaku 15 menit): " + mail.url + "\nJika Anda tidak meminta ini, abaikan email dan hubungi dukungan.",
    html: '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' + text3 + "</title></head><body><h1>" + text3 + '</h1><p>Tautan berlaku 15 menit.</p><p><a href="' + safeUrl2 + '">' + text3 + "</a></p><p>Jika Anda tidak meminta ini, abaikan email dan hubungi stefen@newsystem.space.</p></body></html>"
  }, idempotencyKey: "newhope-auth-" + key };
}
async function sendBetterAuthEmail(mail) {
  const { payload, idempotencyKey } = authEmailPayload(mail);
  const response = await new Resend(process.env.RESEND_API_KEY).emails.send(payload, { idempotencyKey });
  if (response.error || !response.data?.id) throw Error("AUTH_EMAIL_DELIVERY_FAILED");
}

// services/shared/betterAuth.ts
function createBetterAuthRuntime(config = betterAuthPilotConfig(), sendEmail = sendBetterAuthEmail) {
  const pool = new pg2.Pool({ ...databaseTransport(config.databaseUrl), ...databasePoolLimits(2) });
  const auth = betterAuth({
    appName: "New Hope POS",
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret: config.secret,
    database: { dialect: new PostgresDialect({ pool }), type: "postgres", schemaName: "newhope_auth" },
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
            const fresh = (await pool.query(`SELECT 1 FROM newhope_auth.mfa_session_proofs
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
        await pool.query(`INSERT INTO newhope_auth.mfa_session_proofs(session_id,user_id,verified_at)
          SELECT id,"userId",now() FROM newhope_auth.session WHERE token=$1 AND "userId"=$2 AND "expiresAt">now()
          ON CONFLICT(session_id) DO UPDATE SET verified_at=EXCLUDED.verified_at`, [sessionToken, userId]);
      })
    }
  });
  return { auth, pool, close: () => pool.end() };
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
    const config = betterAuthPilotConfig(), { auth, pool } = getBetterAuthRuntime();
    const session = await auth.api.getSession({ headers: new Headers({ authorization: "Bearer " + token }), query: { disableCookieCache: true } });
    if (!session?.user.emailVerified || !session.user.isActive) return null;
    opening2 ??= connectDb({ schema: "internal", max: 2 }).catch((e) => {
      opening2 = void 0;
      throw e;
    });
    const p = await bindNeonIdentity(await opening2, { subject: session.user.id, email: session.user.email, isEmailVerified: true, aal: "aal1" }, config.baseUrl, "better-auth", pool);
    if (!p) return null;
    if (session.user.twoFactorEnabled) {
      const proof = (await pool.query("SELECT verified_at FROM newhope_auth.mfa_session_proofs WHERE session_id=$1 AND user_id=$2", [session.session.id, session.user.id])).rows[0];
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
async function reauthenticateBetterOwner(token, password, canonicalSubject) {
  const { auth } = getBetterAuthRuntime();
  const headers = new Headers({ authorization: "Bearer " + token });
  const principal = await authenticateBetterBearer(token);
  if (principal?.subject !== canonicalSubject) return false;
  try {
    return (await auth.api.verifyPassword({ headers, body: { password } })).status === true;
  } catch (e) {
    if (["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"].includes(e?.status)) return false;
    throw new BetterAuthUnavailableError("BETTER_AUTH_REAUTH_UNAVAILABLE");
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
async function canAccessBusiness(db, principal, businessId) {
  if (principal.subject === "local-development") return true;
  const { rows } = await db.query(
    `SELECT t.owner_user_ref,t.is_active AS tenant_active,t.merged_into,m.is_active AS merchant_active
       FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE (m.external_ref = $1 OR m.id::text = $1)`,
    [businessId]
  );
  return rows.length === 1 && rows[0].owner_user_ref === principal.subject && rows[0].tenant_active && !rows[0].merged_into && rows[0].merchant_active;
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
function assertFreeScope(state, sector, productRefs) {
  if (!state.free) return;
  if (!state.selection || state.selection.sector !== sector) throw new FreePlanAccessError("FREE_SELECTION_REQUIRED");
  if (productRefs.some((id) => !state.selection.productIds.includes(id))) throw new FreePlanAccessError("FREE_PRODUCT_LOCKED");
}
async function resolveFreeSyncScope(db, ownerId, sector) {
  const { rows } = await db.query(`SELECT e.* FROM contract.free_plan_entitlements e
    JOIN internal.tenants t ON t.id=e.tenant_id WHERE e.owner_user_ref=$1 AND t.merged_into IS NULL
    ORDER BY e.tenant_id LIMIT 1`, [ownerId]);
  const entitlement = rows[0];
  if (!entitlement) return void 0;
  if (!entitlement.is_active) throw new FreePlanAccessError("TENANT_INACTIVE");
  if (!isFreePlan({ status: entitlement.status, planId: entitlement.plan_id, currentPeriodEnd: new Date(entitlement.current_period_end).toISOString() })) return void 0;
  const selection = entitlement.free_selection ? validateFreeSelection(entitlement.free_selection) : void 0;
  assertFreeScope({ free: true, selection }, sector, []);
  const result = await db.query(`SELECT o.tenant_id, o.merchant_id, o.id AS outlet_id
    FROM internal.outlets o JOIN internal.tenants t ON t.id=o.tenant_id
    JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    WHERE o.id::text=$1 AND t.owner_user_ref=$2 AND t.is_active
      AND o.is_active AND m.business_sector=$3`, [selection.branchId, ownerId, sector]);
  if (!result.rows.length) throw new FreePlanAccessError("FREE_BRANCH_UNAVAILABLE");
  return result.rows[0];
}

// services/billing/engine.ts
import { randomUUID as randomUUID2 } from "node:crypto";

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
function manualTierChange(sub, input, outletCount, now = /* @__PURE__ */ new Date()) {
  const active = sub.status === "ACTIVE" && Date.parse(sub.current_period_end) > now.getTime();
  const paid = active && Number(sub.recurring_amount) > 0;
  if (paid && input.billingCycle && input.billingCycle !== sub.billing_cycle) throw new Error("PAID_CYCLE_CHANGE_REQUIRES_CHECKOUT");
  const quote = billingQuote({ ...sub, status: "EXPIRED", recurring_amount: 0 }, input, outletCount, now);
  return {
    ...quote,
    periodStart: active ? new Date(sub.current_period_start).toISOString() : quote.periodStart,
    periodEnd: active ? new Date(sub.current_period_end).toISOString() : quote.periodEnd,
    recurringAmount: active ? Number(sub.recurring_amount || 0) : 0
  };
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
  const iso2 = (x) => new Date(x).toISOString();
  const free = isFreePlan({ status: s.status, planId: s.plan_id, currentPeriodEnd: iso2(s.current_period_end) });
  const planId = free ? FREE_PLAN_ID : s.plan_id;
  return {
    id: s.id,
    tenantId: s.tenant_id,
    planId,
    status: free ? "FREE" : s.status,
    plan: findSaaSPlan(planId),
    freeSelection: free ? s.free_selection : void 0,
    currentPeriodStart: iso2(s.current_period_start),
    currentPeriodEnd: iso2(s.current_period_end),
    gracePeriodEnd: s.grace_period_end ? iso2(s.grace_period_end) : void 0,
    billingCycle: s.billing_cycle,
    extraOutlets: free ? 0 : s.extra_outlets,
    trialStartedAt: s.trial_started_at ? iso2(s.trial_started_at) : null,
    trialEndsAt: s.trial_ends_at ? iso2(s.trial_ends_at) : null,
    hasUsedTrial: Boolean(s.has_used_trial)
  };
}
function serializeInvoice(i) {
  return {
    id: i.id,
    invoiceNumber: i.invoice_number,
    subscriptionId: i.subscription_id,
    tenantId: i.tenant_id,
    amount: Number(i.amount),
    currency: i.currency,
    paymentStatus: i.payment_status,
    paymentGatewayRef: i.payment_gateway_ref,
    paymentLinkUrl: i.payment_link_url,
    paidAt: i.paid_at,
    dueDate: i.due_date,
    createdAt: i.created_at,
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
  const tenant2 = await db.query("SELECT is_active FROM internal.tenants WHERE id=$1", [tenantId]);
  if (!tenant2.rows[0]) throw new BillingError(404, "TENANT_NOT_FOUND");
  if (tenant2.rows[0].is_active === false) Object.assign(access, { accessMode: "RESTRICTED", status: "EXPIRED" });
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
  return {
    ok: true,
    subscription: { ...sub, status: access.status, accessMode: access.accessMode, isActive: !!tenant2.rows[0]?.is_active },
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
    invoices: invoices.rows.map(serializeInvoice)
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
    const lookup = await c.query("SELECT tenant_id FROM billing.invoices WHERE invoice_number=$1", [notice.invoiceNumber]);
    if (lookup.rows[0]) await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [lookup.rows[0].tenant_id]);
    const found = await c.query("SELECT * FROM billing.invoices WHERE invoice_number=$1 FOR UPDATE", [notice.invoiceNumber]);
    const inv = found.rows[0];
    let outcome = "REVIEW", reason = "INVOICE_NOT_FOUND";
    let sub;
    if (inv) {
      sub = (await c.query("SELECT * FROM billing.subscriptions WHERE id=$1 FOR UPDATE", [inv.subscription_id])).rows[0];
      if (inv.payment_status === "PAID" && inv.reconciliation_status === "APPLIED") {
        outcome = "DUPLICATE";
        reason = "ALREADY_APPLIED";
      } else if (Number(inv.amount) !== notice.amount || inv.currency !== notice.currency) reason = "AMOUNT_OR_CURRENCY_MISMATCH";
      else if (notice.validationIssue) reason = notice.validationIssue;
      else if (inv.quote?.allowedChannels && !inv.quote.allowedChannels.includes(notice.channel)) reason = "INVOICE_CHANNEL_MISMATCH";
      else if (!notice.success) {
        outcome = "FAILED";
        reason = "CHECKOUT_ATTEMPT_FAILED";
      } else if (!inv.quote) reason = "LEGACY_INVOICE_NEEDS_REVIEW";
      else if (inv.quote.revision !== Number(sub.revision)) reason = "STALE_SUBSCRIPTION_REVISION";
      else if (await outletUsage(c, inv.tenant_id) > inv.quote.maxOutlets) reason = "OUTLET_LIMIT_BELOW_USAGE";
      else {
        outcome = "APPLIED";
        reason = "VERIFIED";
      }
    }
    const payload = {
      contentDigest: notice.contentDigest || null,
      status: notice.success ? "SUCCESS" : notice.payload?.status === "FAILED" ? "FAILED" : "OTHER",
      channel: (notice.channel || "").slice(0, 100),
      requestTimestamp: typeof notice.payload?.requestTimestamp === "string" ? notice.payload.requestTimestamp.slice(0, 30) : null
    };
    const event = await c.query(
      `INSERT INTO billing.payment_events(event_key,invoice_number,gateway_reference,amount,currency,outcome,reason,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
      [notice.eventKey, notice.invoiceNumber, notice.reference, notice.amount, notice.currency, outcome, reason, JSON.stringify(payload)]
    );
    if (!event.rowCount) {
      const previous = (await c.query("SELECT invoice_number,amount,currency,payload FROM billing.payment_events WHERE event_key=$1", [notice.eventKey])).rows[0];
      if (previous.invoice_number !== notice.invoiceNumber || Number(previous.amount) !== notice.amount || previous.currency !== notice.currency || previous.payload?.contentDigest && previous.payload.contentDigest !== notice.contentDigest) throw new BillingError(409, "PAYMENT_EVENT_KEY_CONFLICT");
      return { ok: true, outcome: "DUPLICATE" };
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
    } else if (inv && outcome !== "DUPLICATE" && outcome !== "FAILED") {
      await c.query(`UPDATE billing.invoices SET reconciliation_status=$2,reconciliation_note=$3 WHERE id=$1`, [inv.id, outcome, reason]);
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

// api/_doku.ts
import crypto from "node:crypto";
function isDokuConfigured() {
  const clientId = getDokuClientId();
  const secretKey = getDokuSecretKey();
  return Boolean(clientId && secretKey && !clientId.includes("sandbox_dummy"));
}
function getDokuClientId() {
  return validateDokuBrandClientId(process.env.DOKU_CLIENT_ID || "");
}
function validateDokuBrandClientId(value) {
  const clientId = value.replace(/["']/g, "").trim();
  if (/^BSN-/i.test(clientId)) throw new Error("DOKU_BRAND_CLIENT_ID_REQUIRED");
  return clientId;
}
function getDokuSecretKey() {
  return (process.env.DOKU_SECRET_KEY || "").replace(/["']/g, "").trim();
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
function generateSignature(clientId, requestId, requestTimestamp, requestTarget, digest3, secretKey) {
  const componentSignature = `Client-Id:${clientId}
Request-Id:${requestId}
Request-Timestamp:${requestTimestamp}
Request-Target:${requestTarget}
Digest:${digest3}`;
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
  const requestId = crypto.randomUUID();
  const requestTimestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19) + "Z";
  const requestTarget = "/checkout/v1/payment";
  const digest3 = generateDigest(payload);
  const signature = generateSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    digest3,
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
  return {
    paymentUrl: data.response.payment.url,
    rawResponse: data
  };
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
  const requestTarget = `/orders/v1/status/${invoiceNumber}`;
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
  const status = txStatus === "SUCCESS" ? "SUCCESS" : ["FAILED", "EXPIRED", "CANCELLED", "ORDER_EXPIRED"].includes(txStatus) ? "FAILED" : ["PENDING", "WAITING", "ORDER_GENERATED"].includes(txStatus) ? "PENDING" : "UNKNOWN";
  return {
    ok: true,
    status,
    transactionId: data?.transaction?.original_request_id || data?.transaction?.reference_id,
    channelId: data?.channel?.id,
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
  if (!clientId || clientId !== getDokuClientId() || !requestId || !requestTimestamp || !incomingSignature) {
    return false;
  }
  if (!/^[\x21-\x7e]{1,128}$/.test(requestId) || requestId.includes(",")) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(requestTimestamp)) return false;
  const time = Date.parse(requestTimestamp);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== requestTimestamp.replace(".000Z", "Z")) return false;
  if (time > now + 5 * 6e4 || now - time > 13 * 60 * 6e4) return false;
  const digest3 = generateDigest(rawBody);
  const expectedSignature = generateSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    digest3,
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

// services/billing/routes.ts
function coordinate(value, limit) {
  if (value === null || value === void 0 || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit && n !== 0 ? n : null;
}
function registerBillingRoutes(app, db, viaGateway = false, checkoutProvider = createDokuCheckout) {
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
  const tenant2 = async (req) => {
    const principal = viaGateway ? trustedPrincipal(req) : await authenticateBearer(req);
    const allowLocal = process.env.NODE_ENV !== "production" && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === "1";
    if (!principal || principal.subject === "local-development" && !allowLocal) throw new BillingError(401, "AUTHENTICATION_REQUIRED");
    let id = await tenantForPrincipal(db, principal);
    if (!id && principal.subject !== "local-development") {
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
  app.get("/api/v1/subscription/status", run(async (req, res) => res.json(await subscriptionStatus(db, await tenant2(req)))));
  app.post("/api/v1/subscription/start-trial", run(async (req, res) => res.json({ ok: true, subscription: await activateFreeTrial(db, await tenant2(req)) })));
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
    const { rows } = await db.query(`SELECT o.*,m.business_sector FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id WHERE o.tenant_id=$1 ORDER BY o.created_at`, [await tenant2(req)]);
    res.json({ ok: true, rows });
  }));
  app.post("/api/v1/subscription/outlets", run(async (req, res) => {
    const tenantId = await tenant2(req), b = req.body || {};
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
      const id = /^[0-9a-f-]{36}$/i.test(b.id || "") ? b.id : randomUUID3();
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
    const quote = await createQuote(db, await tenant2(req), req.body || {});
    res.json({ ok: true, ...quote, netProratedAmount: quote.amount, proratedAmountIdr: quote.amount, breakdown: { newPlanPrice: quote.recurringAmount, unusedCredit: quote.unusedCredit, total: quote.amount } });
  }));
  app.post("/api/v1/subscription/checkout", run(async (req, res) => {
    if (process.env.DOKU_PAYMENTS_ENABLED !== void 0 && process.env.DOKU_PAYMENTS_ENABLED.trim() !== "1") throw new BillingError(503, "PAYMENTS_PAUSED");
    const tenantId = await tenant2(req);
    const key = String(req.body?.requestKey || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new BillingError(400, "CHECKOUT_REQUEST_KEY_REQUIRED");
    let configured = false;
    try {
      configured = isDokuConfigured();
    } catch {
    }
    if (!configured) throw new BillingError(503, "PAYMENT_GATEWAY_NOT_CONFIGURED");
    let allowedChannels;
    try {
      allowedChannels = getDokuAllowedChannels();
    } catch {
      throw new BillingError(503, "DOKU_CHANNEL_SCOPE_NOT_CONFIGURED");
    }
    const quote = { ...await createQuote(db, tenantId, req.body || {}), allowedChannels };
    if (quote.amount <= 0) throw new BillingError(409, "ZERO_CHARGE_REQUIRES_SUPPORT");
    const origin = process.env.PUBLIC_APP_URL;
    if (!origin || !/^https:\/\//.test(origin)) throw new BillingError(503, "PUBLIC_APP_URL_NOT_CONFIGURED");
    const id = randomUUID3(), invoiceNumber = `NH-${id}`;
    const result = await db.query(`INSERT INTO billing.invoices(id,subscription_id,tenant_id,amount,currency,due_date,invoice_number,quote,checkout_key)
      SELECT $1,id,tenant_id,$3,'IDR',now()+interval '24 hours',$4,$5::jsonb,$6 FROM billing.subscriptions
      WHERE tenant_id=$2 ON CONFLICT(tenant_id,checkout_key) DO NOTHING RETURNING *`, [id, tenantId, quote.amount, invoiceNumber, JSON.stringify(quote), key]);
    if (!result.rowCount) {
      const existing = (await db.query("SELECT * FROM billing.invoices WHERE tenant_id=$1 AND checkout_key=$2", [tenantId, key])).rows[0];
      if (existing?.quote?.planId !== quote.planId || existing?.quote?.billingCycle !== quote.billingCycle || existing?.quote?.extraOutlets !== quote.extraOutlets) throw new BillingError(409, "CHECKOUT_KEY_CONFLICT");
      if (!existing.payment_link_url) throw new BillingError(409, "CHECKOUT_IN_PROGRESS_OR_NEEDS_REVIEW");
      return res.json({ ok: true, paymentUrl: existing.payment_link_url, invoice: serializeInvoice(existing), quote: existing.quote, replayed: true });
    }
    try {
      const checkout = await checkoutProvider({ order: {
        invoice_number: invoiceNumber,
        amount: quote.amount,
        currency: "IDR",
        callback_url: `${origin.replace(/\/$/, "")}/#payment?invoice=${id}`,
        auto_redirect: true,
        line_items: [{ name: `${quote.planName} ${quote.billingCycle} + ${quote.extraOutlets} outlet`, price: quote.amount, quantity: 1 }]
      }, payment: { payment_due_date: 1440 } });
      await db.query("UPDATE billing.invoices SET payment_link_url=$2 WHERE id=$1", [id, checkout.paymentUrl]);
      res.json({ ok: true, paymentUrl: checkout.paymentUrl, invoice: serializeInvoice({ ...result.rows[0], payment_link_url: checkout.paymentUrl }), quote });
    } catch (err) {
      await db.query("UPDATE billing.invoices SET reconciliation_status='REVIEW',reconciliation_note='CHECKOUT_RESPONSE_FAILED' WHERE id=$1 AND payment_status<>'PAID'", [id]);
      throw err;
    }
  }));
  app.get("/api/v1/subscription/verify", run(async (req, res) => {
    const tenantId = await tenant2(req);
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
    if (!inv) {
      const statusData = await subscriptionStatus(db, tenantId);
      return res.json({ ok: true, status: statusData.subscription.status, paid: statusData.subscription.status === "ACTIVE" });
    }
    if (inv.payment_status === "PAID") {
      const statusData = await subscriptionStatus(db, tenantId);
      return res.json({ ok: true, paid: true, status: statusData.subscription.status, invoice: serializeInvoice(inv), subscription: statusData.subscription });
    }
    if (isDokuConfigured()) {
      try {
        const inquiry = await checkDokuOrderStatus(inv.invoice_number);
        if (inquiry.ok && inquiry.status === "SUCCESS") {
          let allowedChannels = [];
          try {
            allowedChannels = getDokuAllowedChannels();
          } catch {
          }
          const channel = String(inquiry.channelId || "");
          const issue = !channel || !allowedChannels.includes(channel) ? "UNAPPROVED_PAYMENT_CHANNEL" : void 0;
          const result = await reconcilePayment(db, {
            eventKey: `inquiry-${inv.invoice_number}-${String(inquiry.transactionId || "unknown")}`,
            validationIssue: issue,
            invoiceNumber: inv.invoice_number,
            reference: String(inquiry.transactionId || `inquiry-${Date.now()}`),
            amount: Number(inv.amount),
            currency: inv.currency || "IDR",
            success: true,
            channel,
            contentDigest: generateDigest(JSON.stringify(inquiry.rawResponse || {})),
            payload: { status: "SUCCESS", channel, source: "INQUIRY" }
          });
          const statusData = await subscriptionStatus(db, tenantId);
          const applied = result.outcome === "APPLIED" || result.outcome === "DUPLICATE";
          return res.json({
            ok: true,
            paid: applied,
            reconciled: applied,
            outcome: result.outcome,
            reason: result.reason,
            status: applied ? statusData.subscription.status : "PENDING_PAYMENT",
            subscription: statusData.subscription
          });
        }
      } catch (err) {
        console.warn("[doku-verify] Inquiry check failed:", err.message);
      }
    }
    res.json({ ok: true, paid: false, status: "PENDING_PAYMENT", invoice: serializeInvoice(inv) });
  }));
  app.post("/api/v1/subscription/simulate-payment", (_req, res) => res.status(403).json({ ok: false, error: "PAYMENT_SIMULATION_DISABLED" }));
  app.post("/api/v1/webhooks/payment-gateway", (_req, res) => res.status(410).json({ ok: false, error: "USE_SIGNED_DOKU_WEBHOOK" }));
  app.post(DOKU_NOTIFICATION_PATH, run(async (req, res) => {
    const raw = req.rawBody;
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
    const channel = typeof body?.channel?.id === "string" ? body.channel.id : "";
    const invoice = body?.order?.invoice_number, amount = body?.order?.amount;
    if (typeof invoice !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(invoice) || !["string", "number"].includes(typeof amount) || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)) || !Number.isFinite(Number(amount))) throw new BillingError(400, "INVALID_NOTIFICATION_ORDER");
    const issue = !channel || !channels.includes(channel) ? "UNAPPROVED_PAYMENT_CHANNEL" : !["SUCCESS", "FAILED"].includes(status) ? "UNKNOWN_PAYMENT_STATUS" : void 0;
    const result = await reconcilePayment(db, {
      eventKey: String(req.headers["request-id"] || ""),
      invoiceNumber: invoice,
      reference: String(body?.transaction?.original_request_id || req.headers["request-id"] || "").slice(0, 128),
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

// services/shared/blogAnalytics.ts
function blogViewTrackingEnabled(env = process.env) {
  if (env.BUSINESS_WRITES_PAUSED === "1" || env.NEON_DB_PHASE1 === "1" && env.HYBRID_STAGING === "1") return false;
  return env.BLOG_VIEW_TRACKING_ENABLED === void 0 || env.BLOG_VIEW_TRACKING_ENABLED.trim() === "1";
}

// src/server/adminRoutes.ts
import { randomUUID as randomUUID7 } from "node:crypto";

// src/server/adminSecurity.ts
function adminSecurityError(principal, method, now = Date.now()) {
  if (principal.aal !== "aal2") return "MFA_REQUIRED";
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && (!principal.mfaVerifiedAt || now / 1e3 - principal.mfaVerifiedAt >= 600 || principal.mfaVerifiedAt > now / 1e3 + 30)) return "REAUTH_REQUIRED";
  return null;
}

// src/lib/rbac/environments.ts
var INTERNAL_ROLES = [
  "ROLE_SUPERADMIN",
  "ROLE_INTERNAL_GROWTH",
  "ROLE_INTERNAL_SUPPORT"
];
function isInternalRole(role) {
  return INTERNAL_ROLES.includes(role);
}
var INTERNAL_CAPABILITIES = {
  ROLE_SUPERADMIN: [
    "MANAGE_SUPPORT",
    "VIEW_MERCHANT_HEALTH",
    "VIEW_CHURN_COHORT",
    "VIEW_PLATFORM_REVENUE",
    "VIEW_FEATURE_ADOPTION",
    "VIEW_MERCHANT_DETAIL",
    "MANAGE_SUBSCRIPTION",
    "GRANT_AI_CREDITS",
    "IMPERSONATE_MERCHANT",
    "VIEW_ACCESS_AUDIT",
    "MANAGE_INTEGRATIONS",
    "VIEW_SECTOR_ANALYTICS",
    "VIEW_TRANSACTION_LOG",
    "VIEW_PRODUCT_SALES",
    "VIEW_ACTIVITY_LOG"
  ],
  // Growth works on cohorts and aggregates. Deliberately NOT given
  // VIEW_MERCHANT_DETAIL: analysing retention does not require reading one
  // named merchant's books.
  ROLE_INTERNAL_GROWTH: [
    "VIEW_MERCHANT_HEALTH",
    "VIEW_CHURN_COHORT",
    "VIEW_PLATFORM_REVENUE",
    "VIEW_FEATURE_ADOPTION",
    "VIEW_SECTOR_ANALYTICS"
  ],
  // Support troubleshoots one merchant at a time and may not see money
  // platform-wide or change a subscription.
  ROLE_INTERNAL_SUPPORT: [
    "MANAGE_SUPPORT",
    "VIEW_MERCHANT_HEALTH",
    "VIEW_MERCHANT_DETAIL",
    "VIEW_TRANSACTION_LOG",
    "VIEW_PRODUCT_SALES",
    "VIEW_ACTIVITY_LOG"
  ]
};
function internalCapabilities(role) {
  return INTERNAL_CAPABILITIES[role] || [];
}
function hasInternalCapability(role, cap) {
  if (!isInternalRole(role)) return false;
  return internalCapabilities(role).includes(cap);
}
var AUDITED_CAPABILITIES = [
  "MANAGE_INTEGRATIONS",
  "MANAGE_SUPPORT",
  "VIEW_MERCHANT_DETAIL",
  "IMPERSONATE_MERCHANT",
  "MANAGE_SUBSCRIPTION",
  "GRANT_AI_CREDITS",
  "VIEW_TRANSACTION_LOG",
  "VIEW_PRODUCT_SALES",
  "VIEW_ACTIVITY_LOG"
];
function requiresAudit(cap) {
  return AUDITED_CAPABILITIES.includes(cap);
}

// src/server/blogDiscovery.ts
var BLOG_INDEXNOW_KEY = "eda153f3ef2fb48e8fcc2454402be848";
var BLOG_INDEXNOW_PATH = `/blog/${BLOG_INDEXNOW_KEY}.txt`;
var ORIGIN = "https://kasir.newhope.space";
async function notifyBlogDiscovery(slugs, send = fetch) {
  if (process.env.VERCEL_ENV !== "production" || process.env.PUBLIC_SITE_URL && process.env.PUBLIC_SITE_URL.replace(/\/+$/, "") !== ORIGIN)
    return { accepted: false, status: "skipped" };
  const urls = [...new Set(slugs)].filter((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)).map((slug) => `${ORIGIN}/blog/${slug}`);
  if (!urls.length) return { accepted: false, status: "skipped" };
  try {
    const response = await send("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: "kasir.newhope.space", key: BLOG_INDEXNOW_KEY, keyLocation: ORIGIN + BLOG_INDEXNOW_PATH, urlList: urls }),
      signal: AbortSignal.timeout(5e3),
      redirect: "error"
    });
    const accepted = response.status === 200 || response.status === 202;
    console.info("[blog-discovery]", accepted ? "accepted" : "failed", response.status, urls.length);
    return { accepted, status: response.status };
  } catch {
    console.warn("[blog-discovery] notification failed; publication preserved");
    return { accepted: false, status: "unavailable" };
  }
}

// src/server/blogRoutes.ts
import { createHash as createHash2, randomUUID as randomUUID6, timingSafeEqual } from "node:crypto";

// src/lib/blog/categories.ts
var BLOG_CATEGORIES = [
  "Tips Bisnis & Strategi",
  "Panduan Kasir & POS",
  "FinTech & QRIS",
  "Kuliner & F&B",
  "Laundry & Jasa",
  "Ritel & Minimarket",
  "Kisah Sukses UMKM"
];
var isBlogCategory = (value) => typeof value === "string" && BLOG_CATEGORIES.includes(value);
function slugify(value) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " dan ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96).replace(/-+$/g, "");
}
var CATEGORY_SLUGS = {
  "Tips Bisnis & Strategi": "tips-bisnis",
  "Panduan Kasir & POS": "panduan-kasir",
  "FinTech & QRIS": "fintech-qris",
  "Kuliner & F&B": "kuliner-fnb",
  "Laundry & Jasa": "laundry-jasa",
  "Ritel & Minimarket": "ritel-minimarket",
  "Kisah Sukses UMKM": "kisah-sukses"
};
var categorySlug = (category) => isBlogCategory(category) ? CATEGORY_SLUGS[category] : slugify(category);
var categoryFromSlug = (slug) => BLOG_CATEGORIES.find((category) => categorySlug(category) === slug) ?? null;

// src/lib/blog/markdown.ts
import { Marked } from "marked";
var escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var safeUrl = (href, images = false) => {
  const value = href.trim();
  if (images) return /^https:\/\//i.test(value) ? value : null;
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(value) ? value : null;
};
var plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
function normalizeArticleMarkdown(markdown, title = "") {
  let text3 = String(markdown || "").replace(/\r\n?/g, "\n");
  if (!text3.includes("\n") && text3.includes("\\n")) text3 = text3.replace(/\\n/g, "\n");
  text3 = text3.trim();
  const first = /^#\s+(.+)\n?/.exec(text3);
  if (first && title && similar(first[1], title)) text3 = text3.slice(first[0].length).trim();
  return text3.replace(/^#\s+/gm, "## ");
}
function similar(a, b) {
  const x = slugify(a), y = slugify(b);
  return !!x && !!y && (x === y || y.startsWith(x) || x.startsWith(y));
}
function renderArticle(markdown, title = "") {
  const source = normalizeArticleMarkdown(markdown, title);
  const headings = [];
  const used = /* @__PURE__ */ new Map();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      html({ text: text3 }) {
        return escapeHtml(text3);
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const level = Math.min(Math.max(depth, 2), 4);
        const text3 = plain(inner);
        const base = slugify(text3) || "bagian";
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        const id = n > 1 ? `${base}-${n}` : base;
        if (level === 2 || level === 3) headings.push({ level, text: text3, id });
        return `<h${level} id="${id}">${inner}</h${level}>
`;
      },
      link({ href, title: linkTitle, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        if (!url) return inner;
        const external = /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?kasir\.newhope\.space/i.test(url);
        return `<a href="${escapeHtml(url)}"${linkTitle ? ` title="${escapeHtml(linkTitle)}"` : ""}${external ? ' rel="noopener nofollow" target="_blank"' : ""}>${inner}</a>`;
      },
      image({ href, title: imageTitle, text: text3 }) {
        const url = safeUrl(href, true);
        if (!url) return "";
        const caption = imageTitle || text3;
        return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(text3 || "")}" loading="lazy" decoding="async">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
      },
      table(token) {
        const cell = (c) => this.parser.parseInline(c.tokens);
        const head = token.header.map((c) => `<th>${cell(c)}</th>`).join("");
        const body = token.rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
`;
      }
    }
  });
  const html = marked.parse(source, { async: false });
  const words = plain(html).split(/\s+/).filter(Boolean).length;
  return { html, headings, words };
}
var readingMinutes = (words) => Math.max(1, Math.round(words / 200));

// src/lib/blog/articleInput.ts
var ARTICLE_RULES = {
  title: [20, 100],
  excerpt: [80, 300],
  metaDescription: [70, 170],
  metaTitleMax: 70,
  minWords: 500,
  recommendedWords: 900,
  minH2: 3,
  maxTags: 8,
  maxFaq: 8
};
var FORBIDDEN_CLAIMS = [
  [/cair(?:kan)?\s+(?:otomatis\s+)?h\s*\+\s*1|pencairan\s+h\s*\+\s*1/i, "Klaim pencairan H+1 tidak boleh: dana QRIS mengikuti penyedia milik merchant."],
  [/(?:new hope|kasir)[^.\n]{0,80}(?:deteksi|mendeteksi)[^.\n]{0,40}(?:lunas|paid)\s+otomatis|lunas\s+otomatis[^.\n]{0,60}new hope/i, "Klaim deteksi lunas otomatis tidak boleh: QRIS dinamis belum tersedia."],
  [/tanpa\s+biaya\s+admin|mdr\s*0\s*%/i, "Klaim tanpa biaya admin / MDR 0% tidak boleh dipakai."],
  [/dijamin\s+(?:untung|laris|omzet|omset)|garansi\s+(?:omzet|omset|untung)/i, "Janji hasil usaha yang dijamin tidak boleh dipakai."]
];
var text = (value, max) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
var between = (value, [min, max]) => value.length >= min && value.length <= max;
var httpsUrl = (value) => typeof value === "string" && /^https:\/\/[^\s"'<>]+$/i.test(value.trim()) ? value.trim() : "";
function checkArticle(input) {
  const errors2 = [], warnings = [];
  const title = text(input.title, 160);
  const excerpt = text(input.excerpt, 400);
  const content = typeof input.content === "string" ? input.content : "";
  const slug = slugify(text(input.slug, 120) || title);
  const seoIn = input.seo && typeof input.seo === "object" ? input.seo : {};
  const authorIn = input.author && typeof input.author === "object" ? input.author : {};
  if (!between(title, ARTICLE_RULES.title)) errors2.push(`title harus ${ARTICLE_RULES.title[0]}\u2013${ARTICLE_RULES.title[1]} karakter (sekarang ${title.length}).`);
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors2.push("slug tidak valid: hanya huruf kecil, angka dan tanda hubung.");
  if (!between(excerpt, ARTICLE_RULES.excerpt)) errors2.push(`excerpt harus ${ARTICLE_RULES.excerpt[0]}\u2013${ARTICLE_RULES.excerpt[1]} karakter (sekarang ${excerpt.length}).`);
  if (!isBlogCategory(input.category)) errors2.push(`category harus salah satu dari: ${BLOG_CATEGORIES.join(", ")}.`);
  if (content.length > 12e4) errors2.push("content melebihi 120.000 karakter.");
  const rendered = renderArticle(content, title);
  const h2 = rendered.headings.filter((h) => h.level === 2).length, h3 = rendered.headings.filter((h) => h.level === 3).length;
  if (rendered.words < ARTICLE_RULES.minWords) errors2.push(`content terlalu tipis: ${rendered.words} kata (minimal ${ARTICLE_RULES.minWords}).`);
  else if (rendered.words < ARTICLE_RULES.recommendedWords) warnings.push(`content ${rendered.words} kata; ${ARTICLE_RULES.recommendedWords}+ kata biasanya lebih kompetitif.`);
  if (h2 < ARTICLE_RULES.minH2) errors2.push(`content butuh minimal ${ARTICLE_RULES.minH2} subjudul H2 (## ...), sekarang ${h2}.`);
  if (/^#\s+/m.test(content)) warnings.push("H1 (# ...) di dalam content diubah menjadi H2; judul halaman memakai field title.");
  if (/<\s*(script|iframe|style)/i.test(content)) warnings.push("HTML mentah (script/iframe/style) tidak dirender dan tampil sebagai teks.");
  for (const [pattern, message] of FORBIDDEN_CLAIMS) if (pattern.test(`${title}
${excerpt}
${content}`)) errors2.push(message);
  const metaTitle = text(seoIn.metaTitle, 120) || title;
  if (metaTitle.length > ARTICLE_RULES.metaTitleMax) warnings.push(`seo.metaTitle ${metaTitle.length} karakter; Google biasanya memotong di atas \xB1${ARTICLE_RULES.metaTitleMax}.`);
  let metaDescription = text(seoIn.metaDescription, 300);
  if (!metaDescription) metaDescription = excerpt.length > 160 ? excerpt.slice(0, 157).replace(/\s+\S*$/, "") + "\u2026" : excerpt;
  else if (!between(metaDescription, ARTICLE_RULES.metaDescription)) errors2.push(`seo.metaDescription harus ${ARTICLE_RULES.metaDescription[0]}\u2013${ARTICLE_RULES.metaDescription[1]} karakter.`);
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map((t) => text(t, 40)).filter(Boolean))] : [];
  if (tags.length > ARTICLE_RULES.maxTags) errors2.push(`tags maksimal ${ARTICLE_RULES.maxTags}.`);
  const keywords = Array.isArray(seoIn.keywords) ? [...new Set(seoIn.keywords.map((k) => text(k, 60)).filter(Boolean))].slice(0, 10) : tags;
  const focusKeyword = text(seoIn.focusKeyword, 60);
  if (focusKeyword) {
    const k = focusKeyword.toLowerCase();
    if (!title.toLowerCase().includes(k)) warnings.push("focusKeyword tidak ada di title.");
    if (!rendered.headings.some((h) => h.text.toLowerCase().includes(k))) warnings.push("focusKeyword tidak ada di subjudul mana pun.");
    if (!metaDescription.toLowerCase().includes(k)) warnings.push("focusKeyword tidak ada di meta description.");
  }
  const coverImage = httpsUrl(input.coverImage);
  if (input.coverImage && !coverImage) errors2.push("coverImage harus URL https.");
  if (!coverImage) warnings.push("Tanpa coverImage, dipilih ilustrasi AI dari pustaka sampul editorial.");
  const faqIn = Array.isArray(input.faq) ? input.faq : [];
  if (faqIn.length > ARTICLE_RULES.maxFaq) errors2.push(`faq maksimal ${ARTICLE_RULES.maxFaq} pertanyaan.`);
  const faq = faqIn.slice(0, ARTICLE_RULES.maxFaq).map((item) => ({ question: text(item?.question, 200), answer: text(item?.answer, 800) }));
  if (faq.some((f) => f.question.length < 10 || f.answer.length < 20)) errors2.push("Setiap faq butuh question (\u226510 karakter) dan answer (\u226520 karakter).");
  const avatar = httpsUrl(authorIn.avatar);
  const sources = [];
  if (input.sources !== void 0 && (!Array.isArray(input.sources) || input.sources.length > 5)) errors2.push("sources harus array, maksimal 5 sumber.");
  for (const item of Array.isArray(input.sources) ? input.sources.slice(0, 5) : []) {
    const source = item && typeof item === "object" ? item : {};
    const sourceTitle = text(source.title, 250), url = httpsUrl(source.url);
    let valid = sourceTitle.length >= 10 && Boolean(url);
    if (url) {
      try {
        const parsed = new URL(url);
        valid = valid && !parsed.username && !parsed.password && parsed.pathname !== "/" && parsed.hostname !== "kasir.newhope.space";
      } catch {
        valid = false;
      }
    }
    const publishedAt = text(source.publishedAt, 80);
    if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) valid = false;
    if (input.sourceRequired === true && !publishedAt) valid = false;
    if (!valid) {
      errors2.push("Sumber membutuhkan judul dan URL https artikel (bukan beranda), dengan tanggal valid.");
      continue;
    }
    sources.push({ title: sourceTitle, url, ...publishedAt ? { publishedAt: new Date(publishedAt).toISOString() } : {}, ...text(source.publisher, 100) ? { publisher: text(source.publisher, 100) } : {} });
  }
  if (input.sourceRequired === true && !sources.length) errors2.push("Artikel berbasis berita wajib menyertakan sources.");
  if (input.sourceRequired === true) {
    const feed = typeof input.sourceFeed === "string" ? input.sourceFeed : "";
    if (feed.length > 5e5) errors2.push("sourceFeed melebihi 500.000 karakter.");
    for (const source of sources) {
      const escapedUrl = source.url.replace(/&/g, "&amp;");
      const items = feed.match(/<item>[\s\S]*?<\/item>/g) || [];
      if (!items.some((item) => {
        const observedTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1];
        const observedLink = item.match(/<link>([\s\S]*?)<\/link>/)?.[1];
        const observedDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
        const observedPublisher = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1];
        return observedTitle === source.title.replace(/&/g, "&amp;") && (observedLink === source.url || observedLink === escapedUrl) && (!source.publisher || observedPublisher === source.publisher.replace(/&/g, "&amp;")) && (!source.publishedAt || observedDate && Date.parse(observedDate) === Date.parse(source.publishedAt));
      }))
        errors2.push("Sumber berita tidak cocok dengan judul dan tautan dalam feed yang dibaca.");
    }
  }
  const record = {
    slug,
    title,
    excerpt,
    content: content.trim(),
    category: isBlogCategory(input.category) ? input.category : BLOG_CATEGORIES[0],
    tags,
    coverImage,
    isFeatured: input.isFeatured === true,
    isPublished: input.publish !== false,
    readingTimeMinutes: readingMinutes(rendered.words),
    author: { name: text(authorIn.name, 80) || "Tim Editorial New Hope POS", role: text(authorIn.role, 80) || "Editor", avatar },
    seo: { metaTitle, metaDescription, metaKeywords: keywords, ...focusKeyword ? { focusKeyword } : {}, ...text(input.coverAlt, 160) ? { coverAlt: text(input.coverAlt, 160) } : {}, ...typeof input.coverGenerated === "boolean" ? { coverGenerated: input.coverGenerated } : {}, faq, sources }
  };
  return { ok: errors2.length === 0, errors: errors2, warnings, record: errors2.length ? void 0 : record, stats: { words: rendered.words, h2, h3 } };
}

// src/lib/blog/covers.ts
function generatedBlogCover(title) {
  return /bahan baku|cabai|per porsi|menu|f&b|kopi|kuliner/i.test(title) ? "/blog/covers/hpp-ingredients-ai.jpg" : "/blog/covers/cash-reconciliation-ai.jpg";
}
var GENERATED_COVER_CAPTION = "Ilustrasi dibuat dengan AI; bukan foto kejadian dalam berita.";

// src/server/blogCover.ts
import sharp from "sharp";
import { randomUUID as randomUUID5 } from "node:crypto";

// src/server/blogMedia.ts
import { createClient } from "@supabase/supabase-js";
import { randomUUID as randomUUID4 } from "node:crypto";

// src/lib/blog/photo.ts
var BLOG_PHOTO_MAX_CHARS = 65e4;

// services/shared/objectStorage.ts
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
var BLOG_MEDIA_BUCKET = "blog-media";
function neonStorageConfig(env = process.env) {
  if (env.NEON_PROJECT_ID !== "steep-sea-66546931" || !/^br-[a-z0-9-]+$/.test(env.NEON_BRANCH_ID || "")) throw Error("NEON_STORAGE_BRANCH_REQUIRED");
  const endpoint = new URL(env.AWS_ENDPOINT_URL_S3 || "");
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || !endpoint.hostname.startsWith(env.NEON_BRANCH_ID + ".storage.") || !endpoint.hostname.endsWith(".ap-southeast-1.aws.neon.tech") || env.AWS_REGION !== "ap-southeast-1") throw Error("NEON_STORAGE_ENDPOINT_MISMATCH");
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw Error("NEON_STORAGE_CREDENTIAL_REQUIRED");
  return { endpoint: endpoint.origin, region: env.AWS_REGION, accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, branchId: env.NEON_BRANCH_ID };
}
function objectKey(key) {
  if (!key || key.length > 1024 || /^[/.]|[\\\u0000-\u001f\u007f]/.test(key) || key.split("/").some((p) => !p || p === "." || p === "..")) throw Error("INVALID_OBJECT_KEY");
  return key;
}
function publicObjectUrl(config, bucket, key) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw Error("INVALID_OBJECT_BUCKET");
  return config.endpoint + "/" + bucket + "/" + objectKey(key).split("/").map(encodeURIComponent).join("/");
}
function createNeonObjectStorage(config = neonStorageConfig()) {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });
  return {
    client,
    config,
    async upload(bytes, key, bucket = BLOG_MEDIA_BUCKET, contentType = "image/jpeg") {
      objectKey(key);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }), { abortSignal: AbortSignal.timeout(18e3) });
      return publicObjectUrl(config, bucket, key);
    },
    async download(key, bucket = BLOG_MEDIA_BUCKET) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }), { abortSignal: AbortSignal.timeout(18e3) });
      if (!result.Body) throw Error("NEON_STORAGE_EMPTY_BODY");
      return new Uint8Array(await result.Body.transformToByteArray());
    },
    async exists(key, bucket = BLOG_MEDIA_BUCKET) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(key) }), { abortSignal: AbortSignal.timeout(18e3) });
        return true;
      } catch (e) {
        if (e.$metadata?.httpStatusCode === 404) return false;
        throw e;
      }
    },
    close() {
      client.destroy();
    }
  };
}

// src/server/blogMedia.ts
var BUCKET = "blog-media";
function createBlogMediaProvider() {
  if (process.env.STORAGE_PROVIDER === "neon") {
    let storage;
    return { async upload(bytes, path) {
      if (bytes.length < 100 || bytes.length > 5e5) throw Error("INVALID_BLOG_PHOTO");
      storage ??= createNeonObjectStorage();
      return storage.upload(bytes, objectKey(path));
    } };
  }
  if (process.env.AUTH_PROVIDER === "better-auth") return { async upload() {
    throw Error("BLOG_STORAGE_NOT_CONFIGURED");
  } };
  return { async upload(bytes, path) {
    if (hybridExternalWritesBlocked()) throw Error("HYBRID_STAGING_STORAGE_WRITE_BLOCKED");
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw Error("BLOG_STORAGE_NOT_CONFIGURED");
    const signal = AbortSignal.timeout(18e3);
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal }) } });
    const bucket = await client.storage.getBucket(BUCKET);
    if (bucket.error) {
      if (!/bucket not found/i.test(bucket.error.message)) throw Error("BLOG_STORAGE_UNAVAILABLE");
      const created = await client.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 5e5, allowedMimeTypes: ["image/jpeg"] });
      if (created.error) {
        const existing = await client.storage.getBucket(BUCKET);
        if (existing.error || !existing.data.public) throw Error("BLOG_STORAGE_UNAVAILABLE");
      }
    } else if (!bucket.data.public) throw Error("BLOG_STORAGE_BUCKET_PRIVATE");
    const uploaded = await client.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
    if (uploaded.error) throw Error("BLOG_PHOTO_UPLOAD_FAILED");
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } };
}
function decodeBlogPhoto(value) {
  if (typeof value !== "string" || value.length > BLOG_PHOTO_MAX_CHARS) throw Error("INVALID_BLOG_PHOTO");
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw Error("INVALID_BLOG_PHOTO");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.toString("base64") !== match[1] || bytes.length < 100 || bytes.length > 5e5 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw Error("INVALID_BLOG_PHOTO");
  return bytes;
}
function registerBlogMediaRoutes(app, guard, provider = createBlogMediaProvider()) {
  app.post("/api/admin/blog/media", guard("VIEW_SECTOR_ANALYTICS"), async (req, res) => {
    if (req.internal?.role !== "ROLE_SUPERADMIN") {
      res.status(403).json({ ok: false, error: "CAPABILITY_DENIED" });
      return;
    }
    let bytes;
    try {
      bytes = decodeBlogPhoto(req.body?.photo);
    } catch {
      res.status(400).json({ ok: false, error: "INVALID_BLOG_PHOTO" });
      return;
    }
    try {
      const url = await provider.upload(bytes, `${req.internal.id}/${randomUUID4()}.jpg`);
      res.status(201).json({ ok: true, url });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      res.status(code === "BLOG_STORAGE_NOT_CONFIGURED" ? 503 : 502).json({ ok: false, error: ["BLOG_STORAGE_NOT_CONFIGURED", "BLOG_STORAGE_BUCKET_PRIVATE"].includes(code) ? code : "BLOG_PHOTO_UPLOAD_FAILED" });
    }
  });
}

// src/server/blogCover.ts
var CoverError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
function coverUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new CoverError(400, "INVALID_COVER_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !(url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/agnes-aigc/") || url.hostname === "apihub.agnes-ai.com" && url.pathname.startsWith("/storage/images/") || url.hostname === "platform-outputs.agnes-ai.space" && url.pathname.startsWith("/images/t2i/"))) {
    throw new CoverError(400, "INVALID_COVER_URL");
  }
  return url;
}
function createCoverImporter(provider = createBlogMediaProvider(), fetchImage = fetch) {
  return async (input) => {
    const url = coverUrl(input.imageUrl);
    const response = await fetchImage(url, { redirect: "error", signal: AbortSignal.timeout(2e4) });
    if (!response.ok || !/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get("content-type") || "") || Number(response.headers.get("content-length") || 0) > 8e6 || !response.body) throw new CoverError(422, "COVER_DOWNLOAD_REJECTED");
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      for (; ; ) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 8e6) throw new CoverError(422, "COVER_TOO_LARGE");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    let bytes;
    try {
      bytes = await sharp(Buffer.concat(chunks), { limitInputPixels: 2e7, animated: false }).rotate().resize(1200, 675, { fit: "cover" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    } catch {
      throw new CoverError(422, "INVALID_COVER_IMAGE");
    }
    if (bytes.length > 5e5) throw new CoverError(422, "COVER_TOO_LARGE");
    const coverImage = await provider.upload(bytes, `automation/generated/${randomUUID5()}.jpg`);
    const coverAlt = typeof input.alt === "string" ? input.alt.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 160) : "";
    return { coverImage, coverAlt, coverGenerated: true, coverModel: "agnes-image-2.1-flash" };
  };
}

// src/server/blogPages.ts
var GTM_ID = "GTM-WD7T7WSF";
var BLOG_NAME = "Blog New Hope POS";
var BLOG_PAGE_SIZE = 12;
function siteUrl() {
  const raw = process.env.PUBLIC_SITE_URL || process.env.PUBLIC_APP_URL || "https://kasir.newhope.space";
  return raw.replace(/\/+$/, "");
}
var esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
var date = (iso2) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(iso2));
var timestamp = (iso2) => `${date(iso2)}, ${new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date(iso2)).replace(".", ":")} WIB`;
var postUrl = (slug) => `${siteUrl()}/blog/${slug}`;
var DEFAULT_IMAGE = "/new-hope-logo-mark.png";
var BRAND_IMAGE = "/new-hope-logo-mark.png";
var image = (post) => post.coverImage || generatedBlogCover(post.title);
var absolute = (url) => url.startsWith("http") ? url : siteUrl() + url;
var STYLE = `
:root{--bg:#fafaf7;--surface:#fff;--ink:#1c1917;--muted:#57534e;--soft:#78716c;--line:#e7e5e4;--brand:#f5b82e;--brand-ink:#78350f;--brand-soft:#fef3c7;--radius:14px;--max:1120px;--read:720px;color-scheme:light}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 "Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}img{max-width:100%;height:auto;display:block}
.wrap{max-width:var(--max);margin:0 auto;padding:0 20px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:12px;background:#fff;padding:8px 12px;z-index:10}
.site-header{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.site-header .wrap{display:flex;align-items:center;gap:16px;height:64px}
.brand{white-space:nowrap;display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;letter-spacing:-.01em}
.brand-mark{width:32px;height:32px;border-radius:9px;background:var(--brand);display:grid;place-items:center;font-size:15px;color:#1c1917}
.brand small{display:block;font-weight:600;color:var(--soft);font-size:12px;line-height:1.2}
.site-nav{margin-left:auto;display:flex;align-items:center;gap:6px}
.site-nav a{text-decoration:none;font-weight:600;font-size:14px;padding:8px 12px;border-radius:10px;color:var(--muted)}
.site-nav a:hover{background:#f5f5f4;color:var(--ink)}
.btn{white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--brand);color:#1c1917!important;font-weight:800;border-radius:11px;padding:10px 16px;text-decoration:none;font-size:14px}
.btn:hover{filter:brightness(.96)}
.page-header{padding:44px 0 24px}
.eyebrow{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--brand-ink);background:var(--brand-soft);padding:4px 10px;border-radius:999px;text-decoration:none}
h1{font-size:clamp(30px,4.4vw,46px);line-height:1.12;letter-spacing:-.02em;margin:14px 0 12px}
.lead{font-size:18px;color:var(--muted);max-width:680px;margin:0}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:4px 0 20px}
.filters{display:flex;flex-wrap:wrap;align-items:end;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:20px}
.filters label{display:grid;gap:6px;font-size:13px;font-weight:700}.filters label:first-child{flex:1;min-width:200px}
.filters input,.filters select{font:inherit;font-size:15px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:white;color:var(--ink);width:100%}
.filters button{border:0;cursor:pointer;font:inherit}.results{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:0 0 18px;color:var(--muted);font-size:14px}
a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #b45309;outline-offset:3px}
.card img.brand-cover{object-fit:contain;padding:38px;background:#fff8e5}.chip[aria-disabled=true]{opacity:.45}.pager{flex-wrap:wrap;align-items:center}
.chip{flex:none;text-decoration:none;font-size:14px;font-weight:600;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted)}
.chip[aria-current=page]{background:var(--ink);border-color:var(--ink);color:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;padding-bottom:36px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;text-decoration:none;transition:box-shadow .15s,transform .15s}
.card:hover{box-shadow:0 10px 30px rgba(28,25,23,.08);transform:translateY(-2px)}
.card img{aspect-ratio:16/9;object-fit:cover;width:100%;background:#f5f5f4}
.card-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:8px;flex:1}
.card h2,.card h3{font-size:18px;line-height:1.35;margin:0;letter-spacing:-.01em}
.card p{margin:0;color:var(--muted);font-size:15px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.meta{font-size:13px;color:var(--soft);display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.cat{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--brand-ink)}
.feature{display:grid;grid-template-columns:1.25fr 1fr;margin-bottom:26px}
.feature img{aspect-ratio:auto;height:100%;min-height:280px}
.feature .card-body{padding:28px;justify-content:center}.feature h2{font-size:26px}
.pager{display:flex;justify-content:center;gap:10px;padding:0 0 48px}
.empty{padding:40px;text-align:center;color:var(--muted);background:var(--surface);border:1px dashed var(--line);border-radius:var(--radius);margin-bottom:48px}
.crumbs{font-size:14px;color:var(--soft);display:flex;gap:6px;flex-wrap:wrap}.crumbs a{text-decoration:none;color:var(--muted)}.crumbs a:hover{text-decoration:underline}
.byline{display:flex;align-items:center;gap:12px;margin-top:20px}.byline img,.avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;background:var(--brand-soft);display:grid;place-items:center;font-weight:800;color:var(--brand-ink)}
.byline strong{display:block;font-size:15px}
.cover{margin:8px 0 34px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line)}
.cover img{width:100%;aspect-ratio:16/8;object-fit:cover}
.layout{display:grid;grid-template-columns:minmax(0,var(--read)) 260px;gap:56px;justify-content:center;padding-bottom:40px}
.toc{position:sticky;top:88px;align-self:start;font-size:14px;border-left:2px solid var(--line);padding-left:16px}
.toc strong{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);margin-bottom:8px}
.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:8px}.toc a{text-decoration:none;color:var(--muted)}.toc a:hover{color:var(--ink)}.toc .h3{padding-left:12px}
.prose{font-size:18px;line-height:1.75}
.prose h2{font-size:27px;line-height:1.25;letter-spacing:-.015em;margin:44px 0 12px;scroll-margin-top:84px}
.prose h3{font-size:21px;line-height:1.3;margin:30px 0 8px;scroll-margin-top:84px}.prose h4{font-size:18px;margin:24px 0 6px}
.prose p{margin:0 0 18px}.prose ul,.prose ol{margin:0 0 20px;padding-left:24px}.prose li{margin:6px 0}
.prose a{color:#92400e;text-decoration:underline;text-underline-offset:3px}
.prose blockquote{margin:24px 0;padding:14px 20px;border-left:4px solid var(--brand);background:var(--brand-soft);border-radius:0 10px 10px 0;color:#44403c}
.prose blockquote p:last-child{margin:0}
.prose hr{border:0;border-top:1px solid var(--line);margin:36px 0}
.prose code{background:#f5f5f4;padding:2px 6px;border-radius:6px;font-size:.9em}
.prose pre{background:#1c1917;color:#fafaf9;padding:16px;border-radius:10px;overflow:auto;font-size:14px}
.prose figure{margin:28px 0}.prose figure img{border-radius:10px}.prose figcaption{font-size:14px;color:var(--soft);margin-top:8px;text-align:center}
.table-wrap{overflow-x:auto;margin:0 0 22px;border:1px solid var(--line);border-radius:10px}
.prose table{border-collapse:collapse;width:100%;font-size:15px}.prose th,.prose td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.prose th{background:#f5f5f4;font-weight:700}
.video{position:relative;aspect-ratio:16/9;margin:28px 0;border-radius:10px;overflow:hidden;background:#000}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.section{margin-top:44px;padding-top:28px;border-top:1px solid var(--line)}
.section>h2{font-size:24px;margin:0 0 14px}
.faq details{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:14px 18px;margin-bottom:10px}
.faq summary{font-weight:700;cursor:pointer}.faq details p{margin:10px 0 0;color:var(--muted)}
.author-box{display:flex;gap:16px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.tags{display:flex;flex-wrap:wrap;gap:8px}.tags span{font-size:13px;background:#f5f5f4;border-radius:999px;padding:5px 12px;color:var(--muted)}
.cta{background:#1c1917;color:#fafaf9;border-radius:var(--radius);padding:28px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cta h2{margin:0 0 6px;font-size:22px}.cta p{margin:0;color:#d6d3d1}
.related{padding:12px 0 56px}.related>h2{font-size:24px;margin:0 0 18px}
.site-footer{border-top:1px solid var(--line);background:var(--surface);padding:28px 0;font-size:14px;color:var(--soft)}
.site-footer .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between}.site-footer a{color:var(--muted);text-decoration:none;margin-right:16px}
@media (max-width:960px){.grid{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:minmax(0,1fr)}.toc{display:none}.feature{grid-template-columns:1fr}.feature img{min-height:0;aspect-ratio:16/9}}
@media (max-width:640px){.wrap{padding:0 16px}.grid{grid-template-columns:1fr}.site-nav a:not(.btn){display:none}.brand small{display:none}.wide{display:none}.brand{font-size:15px}.page-header{padding:28px 0 16px}.prose{font-size:17px}.prose h2{font-size:23px}.cover img{aspect-ratio:16/9}}
`;
function document2(opts) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta name="robots" content="${opts.robots || "index,follow,max-image-preview:large"}">
<meta property="og:site_name" content="New Hope POS">
<meta property="og:locale" content="id_ID">
<meta property="og:type" content="${opts.type || "website"}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta property="og:image" content="${esc(absolute(opts.image || BRAND_IMAGE))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(absolute(opts.image || BRAND_IMAGE))}">
<link rel="alternate" type="application/rss+xml" title="${BLOG_NAME}" href="${siteUrl()}/rss.xml">
<link rel="icon" type="image/png" sizes="1024x1024" href="${BRAND_IMAGE}">
<link rel="apple-touch-icon" href="${BRAND_IMAGE}">
<meta name="theme-color" content="#F5B82E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
${opts.extraHead || ""}
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');</script>
${opts.jsonLd.map((item) => `<script type="application/ld+json">${json(item)}</script>`).join("\n")}
<style>${STYLE}</style>
</head>
<body>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<a class="skip" href="#konten">Lewati ke konten</a>
<header class="site-header"><div class="wrap">
  <a class="brand" href="/blog"><img class="brand-mark" src="${BRAND_IMAGE}" alt="" width="32" height="32"><span>${BLOG_NAME}<small>Panduan usaha & kasir untuk UMKM</small></span></a>
  <nav class="site-nav" aria-label="Navigasi utama"><a href="/">Beranda</a><a href="/blog">Artikel</a><a href="/login">Masuk</a><a class="btn" href="/register">Coba gratis<span class="wide"> 45 hari</span></a></nav>
</div></header>
<main id="konten">${opts.body}</main>
<footer class="site-footer"><div class="wrap">
  <div><a href="/">New Hope POS</a><a href="/blog">Blog</a><a href="/rss.xml">RSS</a></div>
  <div>\xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} New Hope POS \xB7 Aplikasi kasir untuk UMKM Indonesia</div>
</div></footer>
</body>
</html>`;
}
function card(post, heading = "h2", featured = false) {
  return `<a class="card${featured ? " feature" : ""}" href="/blog/${esc(post.slug)}">
  <img src="${esc(image(post))}" alt="${esc(post.seo.coverAlt || post.title)}" loading="${featured ? "eager" : "lazy"}" decoding="async" width="640" height="360" onerror="this.onerror=null;this.classList.add('brand-cover');this.src='${DEFAULT_IMAGE}'">
  <div class="card-body">
    <span class="cat">${esc(post.category)}</span>
    <${heading}>${esc(post.title)}</${heading}>
    <p>${esc(post.excerpt)}</p>
    <div class="meta"><time datetime="${esc(post.createdAt)}">${timestamp(post.createdAt)}</time><span aria-hidden="true">\xB7</span><span>${post.readingTimeMinutes} menit baca</span></div>
  </div>
</a>`;
}
function renderBlogIndex(posts, opts = {}) {
  const category = opts.category ? categoryFromSlug(opts.category) : null;
  if (opts.category && !category) return { status: 404, html: renderNotFound() };
  const total = opts.total ?? posts.length;
  const pages = Math.max(1, Math.ceil(total / BLOG_PAGE_SIZE));
  const page2 = opts.page || 1;
  if (!Number.isSafeInteger(page2) || page2 < 1 || page2 > pages) return { status: 404, html: renderNotFound() };
  const slice = posts;
  const search = opts.search || "", sort = opts.sort || "terbaru";
  const query = (p, selected = category) => {
    const q = new URLSearchParams();
    if (selected) q.set("kategori", categorySlug(selected));
    if (search) q.set("q", search);
    if (sort !== "terbaru") q.set("urut", sort);
    if (p > 1) q.set("halaman", String(p));
    const s = q.toString();
    return "/blog" + (s ? "?" + s : "");
  };
  const title = category ? `${category} \u2014 ${BLOG_NAME}` : `${BLOG_NAME}: Panduan Usaha, Kasir & Keuangan UMKM`;
  const description = category ? `Artikel ${category.toLowerCase()} untuk pemilik usaha: panduan praktis, contoh hitungan, dan tips operasional dari New Hope POS.` : "Panduan praktis untuk pemilik kafe, laundry, ritel, carwash, dan barbershop: hitung HPP, kelola stok, kasir, dan keuangan usaha.";
  const chips = [
    `<a class="chip" href="${esc(query(1, null))}"${!category ? ' aria-current="page"' : ""}>Semua kategori</a>`,
    ...BLOG_CATEGORIES.map((c) => `<a class="chip" href="${esc(query(1, c))}"${c === category ? ' aria-current="page"' : ""}>${esc(c)}</a>`)
  ].join("");
  const numbers = Array.from(new Set([1, pages, page2 - 1, page2, page2 + 1].filter((n) => n >= 1 && n <= pages))).sort((a, b) => a - b);
  const pagination = numbers.map((n, i) => `${i && n > numbers[i - 1] + 1 ? '<span aria-hidden="true">\u2026</span>' : ""}<a class="chip" href="${esc(query(n))}" aria-label="Halaman ${n}"${n === page2 ? ' aria-current="page"' : ""}>${n}</a>`).join("");
  const body = `<div class="wrap">
  <header class="page-header">
    <span class="eyebrow">${category ? "Kategori" : "Blog"}</span>
    <h1>${esc(category || "Panduan usaha & kasir untuk UMKM")}</h1>
    <p class="lead">${esc(description)}</p>
  </header>
  <form class="filters" action="/blog" method="get" role="search">
    <label>Cari artikel<input type="search" name="q" value="${esc(search)}" maxlength="120" placeholder="Cari HPP, stok, kasir\u2026"></label>
    <label>Kategori<select name="kategori"><option value="">Semua kategori</option>${BLOG_CATEGORIES.map((c) => `<option value="${categorySlug(c)}"${c === category ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    <label>Urutan<select name="urut"><option value="terbaru"${sort === "terbaru" ? " selected" : ""}>Terbaru</option><option value="terlama"${sort === "terlama" ? " selected" : ""}>Terlama</option></select></label>
    <button class="btn" type="submit">Tampilkan</button><a href="/blog">Reset filter</a>
  </form>
  <nav class="chips" aria-label="Kategori">${chips}</nav>
  <div class="results"><span>${total ? `Menampilkan ${(page2 - 1) * BLOG_PAGE_SIZE + 1}\u2013${(page2 - 1) * BLOG_PAGE_SIZE + slice.length} dari ${total} artikel` : "0 artikel"}${search ? ` untuk \u201C${esc(search)}\u201D` : ""}</span><span>Halaman ${page2} dari ${pages}</span></div>
  ${slice.length === 0 ? '<div class="empty">Tidak ada artikel yang sesuai. Coba kata kunci atau kategori lain.</div>' : ""}
  ${slice.length ? `<section class="grid" aria-label="Daftar artikel">${slice.map((p) => card(p)).join("")}</section>` : ""}
  <nav class="pager" aria-label="Pagination artikel">${page2 > 1 ? `<a class="chip" rel="prev" href="${esc(query(page2 - 1))}">\u2190 Sebelumnya</a>` : '<span class="chip" aria-disabled="true">\u2190 Sebelumnya</span>'}${pagination}${page2 < pages ? `<a class="chip" rel="next" href="${esc(query(page2 + 1))}">Berikutnya \u2192</a>` : '<span class="chip" aria-disabled="true">Berikutnya \u2192</span>'}</nav>
</div>`;
  const canonical2 = siteUrl() + query(page2);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Blog",
      name: BLOG_NAME,
      url: `${siteUrl()}/blog`,
      description,
      publisher: { "@type": "Organization", name: "New Hope POS", url: siteUrl() },
      blogPost: slice.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: postUrl(p.slug), datePublished: p.createdAt, dateModified: p.updatedAt, image: absolute(image(p)) }))
    },
    breadcrumbs([{ name: "Beranda", url: siteUrl() + "/" }, { name: "Blog", url: `${siteUrl()}/blog` }, ...category ? [{ name: category, url: canonical2 }] : []])
  ];
  return { status: 200, html: document2({ title, description, canonical: canonical2, jsonLd, body, robots: search || sort !== "terbaru" ? "noindex,follow" : void 0, extraHead: [page2 > 1 ? `<link rel="prev" href="${esc(siteUrl() + query(page2 - 1))}">` : "", page2 < pages ? `<link rel="next" href="${esc(siteUrl() + query(page2 + 1))}">` : ""].join("") }) };
}
var cleanTitle = (value) => value.replace(/\s*[|–—-]\s*(blog\s+harapan\s+baru|warta\s+harapan\s+baru|blog\s+new\s+hope(\s+pos)?|new\s+hope\s+pos)\b.*$/i, "").trim();
var breadcrumbs = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: item.url }))
});
function youtubeId(url = "") {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}
function renderBlogPost(post, related) {
  const article = renderArticle(post.content, post.title);
  const canonical2 = postUrl(post.slug);
  const title = `${cleanTitle(post.seo.metaTitle || "") || post.title} | ${BLOG_NAME}`;
  const description = post.seo.metaDescription || post.excerpt;
  const faq = (post.seo.faq || []).filter((f) => f?.question && f?.answer);
  const sources = (Array.isArray(post.seo.sources) ? post.seo.sources : []).filter((s) => s?.title && /^https:\/\//i.test(s.url));
  const generated = !post.coverImage || post.seo.coverGenerated === true;
  const toc = article.headings.length >= 3 ? `<aside class="toc" aria-label="Daftar isi"><strong>Daftar isi</strong><ol>${article.headings.map((h) => `<li class="h${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join("")}${faq.length ? '<li class="h2"><a href="#faq">Pertanyaan umum</a></li>' : ""}</ol></aside>` : "<aside></aside>";
  const videos = post.mediaEmbeds.map((e) => ({ id: youtubeId(e.url), caption: e.caption })).filter((v) => v.id).map((v) => `<figure><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${v.id}" title="${esc(v.caption || post.title)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ""}</figure>`).join("");
  const initials = post.author.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const avatar = post.author.avatar ? `<img src="${esc(post.author.avatar)}" alt="" width="44" height="44" loading="lazy">` : `<span class="avatar" aria-hidden="true">${esc(initials)}</span>`;
  const updated = post.updatedAt && new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 864e5;
  const body = `<article>
  <div class="wrap">
    <header class="page-header" style="max-width:860px">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/blog">Blog</a><span aria-hidden="true">\u203A</span><a href="/blog?kategori=${categorySlug(post.category)}">${esc(post.category)}</a></nav>
      <h1>${esc(post.title)}</h1>
      <p class="lead">${esc(post.excerpt)}</p>
      <div class="byline">${avatar}<div><strong>${esc(post.author.name)}</strong><span class="meta">${esc(post.author.role)} \xB7 <time datetime="${esc(post.createdAt)}">${timestamp(post.createdAt)}</time>${updated ? ` \xB7 diperbarui <time datetime="${esc(post.updatedAt)}">${timestamp(post.updatedAt)}</time>` : ""} \xB7 ${post.readingTimeMinutes} menit baca</span></div></div>
    </header>
    <figure class="cover"><img src="${esc(image(post))}" alt="${esc(post.seo.coverAlt || post.title)}" width="1200" height="675" fetchpriority="high" onerror="this.onerror=null;this.src='${DEFAULT_IMAGE}'">${generated ? `<figcaption class="meta">${GENERATED_COVER_CAPTION}</figcaption>` : ""}</figure>
    <div class="layout">
      <div>
        <div class="prose">${article.html}${videos}</div>
        ${sources.length ? `<section class="section prose" aria-label="Sumber berita"><h2>Sumber berita & referensi</h2><p>Berita berikut menjadi pemicu topik. Panduan dan contoh perhitungan di atas merupakan analisis New Hope POS, bukan kutipan langsung dari media.</p><ul>${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>${s.publisher ? ` \u2014 ${esc(s.publisher)}` : ""}${s.publishedAt && Number.isFinite(Date.parse(s.publishedAt)) ? ` \xB7 ${date(s.publishedAt)}` : ""}</li>`).join("")}</ul></section>` : ""}
        ${faq.length ? `<section class="section faq" id="faq"><h2>Pertanyaan umum</h2>${faq.map((f) => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join("")}</section>` : ""}
        ${post.tags.length ? `<div class="section tags" aria-label="Tag">${post.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
        <section class="section"><div class="author-box">${avatar}<div><strong>${esc(post.author.name)}</strong><div class="meta">${esc(post.author.role)}</div><p style="margin:8px 0 0;color:var(--muted)">Ditulis untuk ${BLOG_NAME}. Punya pertanyaan tentang usaha Anda? Coba New Hope POS gratis dan hubungi tim kami.</p></div></div></section>
        <section class="section"><div class="cta"><div><h2>Rapikan kasir dan laporan usaha Anda</h2><p>Coba New Hope POS gratis 45 hari, tanpa kartu kredit.</p></div><a class="btn" href="/register">Mulai gratis</a></div></section>
      </div>
      ${toc}
    </div>
  </div>
</article>
${related.length ? `<section class="related"><div class="wrap"><h2>Artikel terkait</h2><div class="grid">${related.map((p) => card(p, "h3")).join("")}</div></div></section>` : ""}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description,
      image: [absolute(image(post))],
      datePublished: post.createdAt,
      dateModified: post.updatedAt,
      inLanguage: "id-ID",
      mainEntityOfPage: canonical2,
      articleSection: post.category,
      keywords: (post.seo.metaKeywords || post.tags).join(", "),
      wordCount: article.words,
      ...sources.length ? { citation: sources.map((s) => ({ "@type": "CreativeWork", name: s.title, url: s.url, ...s.publishedAt ? { datePublished: s.publishedAt } : {} })) } : {},
      author: { "@type": "Person", name: post.author.name, jobTitle: post.author.role },
      publisher: { "@type": "Organization", name: "New Hope POS", url: siteUrl(), logo: { "@type": "ImageObject", url: `${siteUrl()}${BRAND_IMAGE}` } }
    },
    breadcrumbs([{ name: "Beranda", url: siteUrl() + "/" }, { name: "Blog", url: `${siteUrl()}/blog` }, { name: post.category, url: `${siteUrl()}/blog?kategori=${categorySlug(post.category)}` }, { name: post.title, url: canonical2 }])
  ];
  if (faq.length) jsonLd.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) });
  return document2({
    title,
    description,
    canonical: canonical2,
    image: image(post),
    type: "article",
    jsonLd,
    body,
    extraHead: `<meta property="article:published_time" content="${esc(post.createdAt)}"><meta property="article:modified_time" content="${esc(post.updatedAt)}"><meta property="article:section" content="${esc(post.category)}">`
  });
}
function renderNotFound() {
  return document2({
    title: `Artikel tidak ditemukan | ${BLOG_NAME}`,
    description: "Halaman yang Anda cari tidak ada.",
    canonical: `${siteUrl()}/blog`,
    robots: "noindex,follow",
    jsonLd: [],
    body: `<div class="wrap"><header class="page-header"><span class="eyebrow">404</span><h1>Artikel tidak ditemukan</h1><p class="lead">Artikel mungkin sudah dipindahkan atau belum diterbitkan.</p><p><a class="btn" href="/blog">Lihat semua artikel</a></p></header></div>`
  });
}
function renderSitemap(posts, blogOnly = false) {
  const base = siteUrl();
  const latest = posts.reduce((m, p) => p.updatedAt > m ? p.updatedAt : m, "2026-10-01T00:00:00.000Z");
  const urls = [
    ...!blogOnly ? [
      { loc: `${base}/`, lastmod: latest, priority: "1.0" },
      { loc: `${base}/blog`, lastmod: latest, priority: "0.9" },
      ...BLOG_CATEGORIES.filter((c) => posts.some((p) => p.category === c)).map((c) => ({ loc: `${base}/blog?kategori=${categorySlug(c)}`, lastmod: latest, priority: "0.6" }))
    ] : [],
    ...posts.map((p) => ({ loc: postUrl(p.slug), lastmod: p.updatedAt, priority: "0.8", image: p.coverImage }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${esc(u.lastmod)}</lastmod><priority>${u.priority}</priority>${"image" in u && u.image ? `<image:image><image:loc>${esc(absolute(String(u.image)))}</image:loc></image:image>` : ""}</url>`).join("\n")}
</urlset>`;
}
function renderRss(posts) {
  const base = siteUrl();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${BLOG_NAME}</title><link>${base}/blog</link><description>Panduan usaha, kasir, dan keuangan untuk UMKM Indonesia.</description><language>id</language>
<atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>
${posts.slice(0, 30).map((p) => `<item><title>${esc(p.title)}</title><link>${postUrl(p.slug)}</link><guid isPermaLink="true">${postUrl(p.slug)}</guid><pubDate>${new Date(p.createdAt).toUTCString()}</pubDate><category>${esc(p.category)}</category><description>${esc(p.excerpt)}</description></item>`).join("\n")}
</channel></rss>`;
}

// src/server/blogRoutes.ts
var COLUMNS = `id, slug, title, excerpt, content, category, cover_image, author_name, author_role, author_avatar,
  reading_time_minutes, tags, media_embeds, seo, is_published, is_featured, created_at, updated_at`;
var PAGE_CACHE = "public, max-age=0, s-maxage=60, must-revalidate";
var parseJson = (value, fallback) => {
  if (value && typeof value === "object") return value;
  try {
    return typeof value === "string" ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
function rowToPublicPost(r) {
  const iso2 = (v) => v ? new Date(v).toISOString() : (/* @__PURE__ */ new Date(0)).toISOString();
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt || "",
    content: r.content || "",
    category: r.category,
    coverImage: r.cover_image || "",
    author: { name: r.author_name || "Tim Editorial New Hope POS", role: r.author_role || "Editor", avatar: r.author_avatar || "" },
    readingTimeMinutes: Number(r.reading_time_minutes || 5),
    tags: Array.isArray(r.tags) ? r.tags : [],
    isFeatured: Boolean(r.is_featured),
    mediaEmbeds: parseJson(r.media_embeds, []),
    seo: parseJson(r.seo, {}),
    isPublished: Boolean(r.is_published),
    createdAt: iso2(r.created_at),
    updatedAt: iso2(r.updated_at)
  };
}
var isMissingStore = (error) => ["42P01", "42501"].includes(String(error?.code));
async function publishedPosts(db) {
  const { rows } = await db.query(`SELECT id, slug, title, excerpt, category, cover_image, author_name, reading_time_minutes, created_at, updated_at FROM public.blog_posts WHERE is_published = true ORDER BY created_at DESC, id DESC`);
  return rows.map(rowToPublicPost);
}
function registerBlogRoutes(app, getDb, coverImporter = createCoverImporter()) {
  const page2 = (fn) => async (req, res) => {
    try {
      await fn(req, res, await getDb());
    } catch (error) {
      console.error(`[blog] ${req.method} ${req.path}:`, error.message, error.code ?? "");
      if (isMissingStore(error) && req.path === "/blog") {
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).type("html").send(renderBlogIndex([]).html);
      }
      res.setHeader("Cache-Control", "no-store");
      res.status(503).type("html").send(renderNotFound().replace("Artikel tidak ditemukan", "Blog sedang tidak tersedia"));
    }
  };
  app.get("/blog", page2(async (req, res, db) => {
    const scalar = (value) => value === void 0 || typeof value === "string";
    const rawPage = String(req.query.halaman || "1"), categorySlug2 = String(req.query.kategori || "");
    const pageNumber = Number(rawPage), category = categorySlug2 ? categoryFromSlug(categorySlug2) : null;
    if (!["halaman", "kategori", "q", "urut"].every((k) => scalar(req.query[k])) || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(pageNumber) || categorySlug2 && !category) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).type("html").send(renderNotFound());
    }
    const search = String(req.query.q || "").trim().slice(0, 120);
    const sort = req.query.urut === "terlama" ? "terlama" : "terbaru";
    const pattern = search ? "%" + search.replace(/[\\%_]/g, "\\$&") + "%" : null;
    const where = `is_published = true AND ($1::text IS NULL OR category = $1)
      AND ($2::text IS NULL OR title ILIKE $2 OR excerpt ILIKE $2 OR array_to_string(tags, ' ') ILIKE $2)`;
    const params = [category, pattern];
    const total = Number((await db.query(`SELECT count(*)::int n FROM public.blog_posts WHERE ${where}`, params)).rows[0].n);
    if (pageNumber > Math.max(1, Math.ceil(total / BLOG_PAGE_SIZE))) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).type("html").send(renderNotFound());
    }
    const direction = sort === "terlama" ? "ASC" : "DESC";
    const rows = (await db.query(`SELECT ${COLUMNS.replace("content, ", "")} FROM public.blog_posts WHERE ${where}
      ORDER BY created_at ${direction}, id ${direction} LIMIT $3 OFFSET $4`, [...params, BLOG_PAGE_SIZE, (pageNumber - 1) * BLOG_PAGE_SIZE])).rows;
    const result = renderBlogIndex(rows.map(rowToPublicPost), { category: categorySlug2, page: pageNumber, search, sort, total });
    res.setHeader("Cache-Control", "no-store");
    res.status(result.status).type("html").send(result.html);
  }));
  app.get(BLOG_INDEXNOW_PATH, (_req, res) => {
    res.type("text/plain").send(BLOG_INDEXNOW_KEY);
  });
  app.get(["/sitemap.xml", "/blog/sitemap.xml"], page2(async (req, res, db) => {
    let posts = [];
    try {
      posts = await publishedPosts(db);
    } catch (error) {
      if (!isMissingStore(error)) throw error;
    }
    res.setHeader("Cache-Control", PAGE_CACHE);
    res.type("application/xml").send(renderSitemap(posts, req.path === "/blog/sitemap.xml"));
  }));
  app.get("/blog/:slug", page2(async (req, res, db) => {
    const slug = String(req.params.slug).toLowerCase();
    if (slug !== req.params.slug) return res.redirect(301, `/blog/${slug}`);
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM public.blog_posts WHERE slug = $1 AND is_published = true`, [slug]);
    if (!rows.length) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).type("html").send(renderNotFound());
    }
    const post = rowToPublicPost(rows[0]);
    const related = (await db.query(`SELECT ${COLUMNS} FROM public.blog_posts WHERE is_published = true AND slug <> $1
      ORDER BY (category = $2) DESC, created_at DESC LIMIT 3`, [slug, post.category])).rows.map(rowToPublicPost);
    if (req.method !== "HEAD" && blogViewTrackingEnabled()) void db.query("UPDATE public.blog_posts SET view_count = view_count + 1 WHERE id = $1", [post.id]).catch(() => {
    });
    res.setHeader("Cache-Control", PAGE_CACHE);
    res.type("html").send(renderBlogPost(post, related));
  }));
  app.get("/rss.xml", page2(async (_req, res, db) => {
    res.setHeader("Cache-Control", PAGE_CACHE);
    res.type("application/rss+xml").send(renderRss(await publishedPosts(db)));
  }));
  registerBlogAutomation(app, getDb, coverImporter);
}
var BlogApiError = class extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var digest = (value) => createHash2("sha256").update(value).digest();
function apiKeyValid(req) {
  const configured = [
    ...String(process.env.BLOG_API_KEYS || "").split(","),
    String(process.env.BLOG_N8N_API_KEY || "")
  ].map((k) => k.trim()).filter((k) => k.length >= 24);
  if (!configured.length) throw new BlogApiError(503, "BLOG_API_NOT_CONFIGURED");
  const header = String(req.headers.authorization || "");
  const presented = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || String(req.headers["x-api-key"] || "").trim();
  if (!presented) return false;
  const given = digest(presented);
  return configured.some((key) => timingSafeEqual(digest(key), given));
}
var writeWindow = /* @__PURE__ */ new Map();
var BLOG_WRITES_PER_HOUR = 120;
function allowWrite(req) {
  const key = createHash2("sha256").update(String(req.headers.authorization || req.headers["x-api-key"] || "")).digest("hex").slice(0, 16);
  const now = Date.now(), entry = writeWindow.get(key);
  if (!entry || entry.resetAt < now) {
    writeWindow.set(key, { count: 1, resetAt: now + 36e5 });
    return;
  }
  if (++entry.count > BLOG_WRITES_PER_HOUR) throw new BlogApiError(429, "BLOG_WRITE_RATE_LIMITED");
}
var summary = (p) => ({
  slug: p.slug,
  title: p.title,
  category: p.category,
  excerpt: p.excerpt,
  coverImage: p.coverImage,
  isPublished: p.isPublished,
  isFeatured: p.isFeatured,
  url: `${siteUrl()}/blog/${p.slug}`,
  readingTimeMinutes: p.readingTimeMinutes,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt
});
var full = (p) => ({ ...summary(p), content: p.content, tags: p.tags, coverImage: p.coverImage, author: p.author, seo: p.seo });
function createBlogAutomation(getDb) {
  async function listPosts(args) {
    const db = await getDb();
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200), offset = Math.max(Number(args.offset) || 0, 0);
    const status = args.status === "draft" ? false : args.status === "all" ? null : true;
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM public.blog_posts
      WHERE ($1::boolean IS NULL OR is_published = $1) AND ($2::text IS NULL OR category = $2)
      ORDER BY created_at DESC LIMIT $3 OFFSET $4`, [status, args.category || null, limit, offset]);
    return { posts: rows.map(rowToPublicPost).map(summary), limit, offset };
  }
  async function getPost(slug) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM public.blog_posts WHERE slug = $1`, [String(slug || "")]);
    if (!rows.length) throw new BlogApiError(404, "POST_NOT_FOUND");
    return { post: full(rowToPublicPost(rows[0])) };
  }
  function validate(input) {
    const check = checkArticle(input);
    return { ok: check.ok, errors: check.errors, warnings: check.warnings, stats: check.stats, slug: check.record?.slug };
  }
  async function save(input, mode, pathSlug) {
    const check = checkArticle(mode === "update" ? { ...input, slug: input.slug ?? pathSlug } : input);
    if (!check.ok || !check.record) throw new BlogApiError(422, "ARTICLE_REJECTED", { errors: check.errors, warnings: check.warnings, stats: check.stats });
    const record = check.record;
    const db = await getDb();
    const changedSlugs = [];
    const result = await db.tx(async (c) => {
      const existing = mode === "update" ? (await c.query("SELECT id, seo, slug, is_published FROM public.blog_posts WHERE slug = $1 FOR UPDATE", [pathSlug])).rows[0] : void 0;
      if (mode === "update" && !existing) throw new BlogApiError(404, "POST_NOT_FOUND");
      const clash = (await c.query(
        `SELECT slug FROM public.blog_posts WHERE (slug = $1 OR lower(title) = lower($2)) AND ($3::text IS NULL OR id <> $3) LIMIT 1`,
        [record.slug, record.title, existing?.id ?? null]
      )).rows[0];
      if (clash) throw new BlogApiError(409, clash.slug === record.slug ? "SLUG_ALREADY_EXISTS" : "TITLE_ALREADY_EXISTS", { slug: clash.slug });
      if (!record.coverImage) {
        record.coverImage = siteUrl() + generatedBlogCover(record.title);
        record.seo.coverGenerated = true;
        record.seo.coverAlt = "Ilustrasi AI: " + record.title;
      } else record.seo.coverGenerated = record.seo.coverGenerated === true || /\/blog\/covers\/(hpp-ingredients|cash-reconciliation)-ai\.jpg$/.test(record.coverImage) || /\/blog-media\/automation\/generated\//.test(record.coverImage);
      const seo = { ...parseJson(existing?.seo, {}), ...record.seo, canonicalUrl: `${siteUrl()}/blog/${record.slug}`, ogImage: record.coverImage, source: "automation" };
      const values = [
        record.slug,
        record.title,
        record.excerpt,
        record.content,
        record.category,
        record.coverImage || null,
        record.author.name,
        record.author.role,
        record.author.avatar || null,
        record.readingTimeMinutes,
        record.tags,
        JSON.stringify(seo),
        record.isPublished,
        record.isFeatured
      ];
      const { rows } = existing ? await c.query(`UPDATE public.blog_posts SET slug=$1,title=$2,excerpt=$3,content=$4,category=$5,cover_image=$6,author_name=$7,author_role=$8,
            author_avatar=$9,reading_time_minutes=$10,tags=$11,seo=$12::jsonb,is_published=$13,is_featured=$14,updated_at=CURRENT_TIMESTAMP
            WHERE id=$15 RETURNING ${COLUMNS}`, [...values, existing.id]) : await c.query(`INSERT INTO public.blog_posts (id,slug,title,excerpt,content,category,cover_image,author_name,author_role,author_avatar,
            reading_time_minutes,tags,seo,is_published,is_featured,media_embeds) VALUES ($15,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,'[]'::jsonb)
            RETURNING ${COLUMNS}`, [...values, "blog-" + randomUUID6()]);
      if (existing?.is_published) changedSlugs.push(existing.slug);
      if (record.isPublished) changedSlugs.push(record.slug);
      console.info("[blog-automation]", existing ? "UPDATED" : "CREATED", record.slug, record.isPublished ? "published" : "draft");
      return { post: summary(rowToPublicPost(rows[0])), warnings: check.warnings, stats: check.stats };
    });
    await notifyBlogDiscovery(changedSlugs);
    return result;
  }
  async function unpublish(slug) {
    const db = await getDb();
    const { rows } = await db.query(`UPDATE public.blog_posts SET is_published = false, updated_at = CURRENT_TIMESTAMP WHERE slug = $1 RETURNING ${COLUMNS}`, [String(slug || "")]);
    if (!rows.length) throw new BlogApiError(404, "POST_NOT_FOUND");
    await notifyBlogDiscovery([rows[0].slug]);
    return { post: summary(rowToPublicPost(rows[0])) };
  }
  const guide = () => ({
    categories: BLOG_CATEGORIES,
    rules: ARTICLE_RULES,
    format: {
      content: "Markdown. Jangan tulis judul (# ...) di content; judul memakai field title. Struktur: paragraf pembuka \u2192 beberapa bagian ## (H2) dengan ### (H3) bila perlu \u2192 penutup. Gunakan daftar, tabel, dan > kutipan untuk poin penting.",
      required: ["title", "excerpt", "content", "category"],
      optional: ["slug", "tags", "coverImage (kosong: ilustrasi AI dari pustaka sampul)", "coverAlt", "author{name,role,avatar}", "seo{metaTitle,metaDescription,focusKeyword,keywords[]}", "faq[{question,answer}]", "sources[{title,url,publisher,publishedAt}]", "sourceRequired + sourceFeed (wajib untuk automation berita)", "isFeatured", "publish (default true)"]
    }
  });
  return { listPosts, getPost, validate, create: (input) => save(input, "create"), update: (slug, input) => save(input, "update", slug), unpublish, guide };
}
var ARTICLE_SCHEMA = {
  type: "object",
  required: ["title", "excerpt", "content", "category"],
  properties: {
    title: { type: "string", description: `${ARTICLE_RULES.title[0]}\u2013${ARTICLE_RULES.title[1]} karakter` },
    slug: { type: "string", description: "Opsional; dibuat dari title bila kosong" },
    excerpt: { type: "string", description: `Ringkasan ${ARTICLE_RULES.excerpt[0]}\u2013${ARTICLE_RULES.excerpt[1]} karakter (tampil di bawah judul)` },
    content: { type: "string", description: `Markdown tanpa H1, minimal ${ARTICLE_RULES.minWords} kata dan ${ARTICLE_RULES.minH2} subjudul ##` },
    category: { type: "string", enum: [...BLOG_CATEGORIES] },
    tags: { type: "array", items: { type: "string" }, maxItems: ARTICLE_RULES.maxTags },
    coverImage: { type: "string", description: "URL https gambar sampul (1200\xD7600 disarankan)" },
    coverAlt: { type: "string" },
    coverGenerated: { type: "boolean", description: "True bila sampul merupakan ilustrasi AI, bukan foto berita." },
    sources: { type: "array", maxItems: 5, items: { type: "object", required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" }, publisher: { type: "string" }, publishedAt: { type: "string" } } } },
    sourceRequired: { type: "boolean", description: "Artikel berita: true, wajib sumber cocok dengan sourceFeed." },
    sourceFeed: { type: "string", description: "Feed RSS yang diamati automation; untuk validasi saja, tidak disimpan." },
    author: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, avatar: { type: "string" } } },
    seo: { type: "object", properties: { metaTitle: { type: "string" }, metaDescription: { type: "string" }, focusKeyword: { type: "string" }, keywords: { type: "array", items: { type: "string" } } } },
    faq: { type: "array", maxItems: ARTICLE_RULES.maxFaq, items: { type: "object", required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } },
    isFeatured: { type: "boolean" },
    publish: { type: "boolean", description: "Default true: langsung terbit bila lolos validasi" }
  }
};
var BLOG_MCP_TOOLS = [
  { name: "blog_guide", description: "Kategori, aturan kualitas, dan format penulisan artikel. Panggil sebelum menulis.", inputSchema: { type: "object", properties: {} } },
  { name: "list_posts", description: "Daftar artikel (judul, slug, URL, status).", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["published", "draft", "all"] }, category: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } } } },
  { name: "get_post", description: "Isi lengkap satu artikel berdasarkan slug.", inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } } },
  { name: "validate_article", description: "Cek artikel tanpa menyimpan: error yang memblokir, peringatan SEO, jumlah kata/subjudul.", inputSchema: ARTICLE_SCHEMA },
  { name: "create_post", description: "Buat artikel baru. Langsung terbit bila lolos validasi (kecuali publish:false).", inputSchema: ARTICLE_SCHEMA },
  { name: "update_post", description: "Perbarui artikel berdasarkan slug (seluruh field dikirim ulang).", inputSchema: { ...ARTICLE_SCHEMA, required: ["slug", ...ARTICLE_SCHEMA.required] } },
  { name: "unpublish_post", description: "Tarik artikel dari publik (tidak menghapus data).", inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } } }
];
function registerBlogAutomation(app, getDb, importCover) {
  const blog = createBlogAutomation(getDb);
  const api = (write, fn, status = 200) => async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!apiKeyValid(req)) return res.status(401).json({ ok: false, error: "INVALID_API_KEY" });
      if (write) allowWrite(req);
      res.status(status).json({ ok: true, ...await fn(req) });
    } catch (error) {
      if (error instanceof CoverError) return res.status(error.status).json({ ok: false, error: error.code });
      if (error instanceof BlogApiError) return res.status(error.status).json({ ok: false, error: error.code, ...error.details ? { details: error.details } : {} });
      console.error("[blog-automation]", req.method, req.path, error.message, error.code ?? "");
      res.status(isMissingStore(error) ? 503 : 500).json({ ok: false, error: isMissingStore(error) ? "BLOG_STORE_UNAVAILABLE" : "INTERNAL_ERROR" });
    }
  };
  const base = "/api/v1/blog-automation";
  app.get(`${base}/guide`, api(false, () => blog.guide()));
  app.get(`${base}/posts`, api(false, (req) => blog.listPosts(req.query)));
  app.get(`${base}/posts/:slug`, api(false, (req) => blog.getPost(String(req.params.slug))));
  app.post(`${base}/validate`, api(false, (req) => blog.validate(req.body || {})));
  app.post(`${base}/covers`, api(true, async (req) => {
    const input = req.body || {};
    const repairing = input.slug !== void 0;
    const db = repairing ? await getDb() : null;
    if (repairing && (typeof input.slug !== "string" || typeof input.expectedCover !== "string" || !/\/blog\/covers\/(hpp-ingredients|cash-reconciliation)-ai\.jpg$/.test(input.expectedCover))) throw new BlogApiError(400, "INVALID_COVER_REPAIR");
    if (db && !(await db.query("SELECT id FROM public.blog_posts WHERE slug=$1 AND cover_image=$2", [input.slug, input.expectedCover])).rows.length) throw new BlogApiError(409, "COVER_CHANGED");
    const cover = await importCover(input);
    if (db) {
      const { rows } = await db.query(`UPDATE public.blog_posts SET cover_image=$1,
        seo=COALESCE(seo,'{}'::jsonb) || $2::jsonb, updated_at=CURRENT_TIMESTAMP
        WHERE slug=$3 AND cover_image=$4 RETURNING slug`, [cover.coverImage, JSON.stringify({ ...cover, ogImage: cover.coverImage }), input.slug, input.expectedCover]);
      if (!rows.length) throw new BlogApiError(409, "COVER_CHANGED");
    }
    return { ...cover, ...repairing ? { repairedSlug: input.slug } : {} };
  }, 201));
  app.post(`${base}/posts`, api(true, (req) => blog.create(req.body || {}), 201));
  app.put(`${base}/posts/:slug`, api(true, (req) => blog.update(String(req.params.slug), req.body || {})));
  app.delete(`${base}/posts/:slug`, api(true, (req) => blog.unpublish(String(req.params.slug))));
  app.post(`${base}/mcp`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = req.body || {};
    const id = body.id ?? null;
    const reply = (payload) => res.json({ jsonrpc: "2.0", id, ...payload });
    try {
      if (!apiKeyValid(req)) return res.status(401).json({ jsonrpc: "2.0", id, error: { code: -32001, message: "INVALID_API_KEY" } });
    } catch (error) {
      return res.status(503).json({ jsonrpc: "2.0", id, error: { code: -32002, message: error.message } });
    }
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request" } });
    if (body.method.startsWith("notifications/")) return res.status(202).end();
    if (body.method === "initialize") return reply({ result: {
      protocolVersion: String(body.params?.protocolVersion || "2025-06-18"),
      capabilities: { tools: {} },
      serverInfo: { name: "newhope-blog", version: "1.0.0" },
      instructions: "Tulis artikel bahasa Indonesia untuk pemilik UMKM. Panggil blog_guide dulu, lalu validate_article, lalu create_post. Jangan menulis klaim fitur yang tidak ada."
    } });
    if (body.method === "ping") return reply({ result: {} });
    if (body.method === "tools/list") return reply({ result: { tools: BLOG_MCP_TOOLS } });
    if (body.method !== "tools/call") return reply({ error: { code: -32601, message: "Method not found" } });
    const name = String(body.params?.name || ""), args = body.params?.arguments || {};
    try {
      const write = ["create_post", "update_post", "unpublish_post"].includes(name);
      if (write) allowWrite(req);
      const result = name === "blog_guide" ? blog.guide() : name === "list_posts" ? await blog.listPosts(args) : name === "get_post" ? await blog.getPost(args.slug) : name === "validate_article" ? blog.validate(args) : name === "create_post" ? await blog.create(args) : name === "update_post" ? await blog.update(String(args.slug || ""), args) : name === "unpublish_post" ? await blog.unpublish(args.slug) : void 0;
      if (result === void 0) return reply({ error: { code: -32602, message: `Unknown tool: ${name}` } });
      reply({ result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result } });
    } catch (error) {
      const message = error instanceof BlogApiError ? JSON.stringify({ error: error.code, ...error.details ? { details: error.details } : {} }, null, 2) : "INTERNAL_ERROR";
      if (!(error instanceof BlogApiError)) console.error("[blog-mcp]", name, error.message);
      reply({ result: { content: [{ type: "text", text: message }], isError: true } });
    }
  });
}

// src/server/privacySupport.ts
var STATES = /* @__PURE__ */ new Set(["IDENTITY_CHECK", "LEGAL_HOLD_REVIEW", "IN_PROGRESS", "COMPLETED", "DECLINED"]);
function registerPrivacySupport(app, getDb, guard) {
  app.get("/api/admin/privacy-requests", guard("MANAGE_SUPPORT"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const data = await (await getDb()).tx(async (c) => {
        const offset = Math.max(0, Math.min(1e5, Number(req.query.offset) || 0));
        await c.query("INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,request_id) VALUES(uuidv7(),$1,$2,'VIEW_PRIVACY_REQUESTS','/api/admin/privacy-requests',$3)", [req.internal.id, req.internal.role, req.auditRequestId]);
        return (await c.query("SELECT id,tenant_id,request_type,message,status,created_at FROM internal.privacy_requests WHERE ($2::uuid IS NULL OR tenant_id IN(SELECT tenant_id FROM internal.merchants WHERE id=$2::uuid)) ORDER BY created_at DESC LIMIT 50 OFFSET $1", [Math.floor(offset), req.query.merchantId || null])).rows;
      });
      res.json({ ok: true, requests: data });
    } catch {
      res.status(503).json({ ok: false, error: "PRIVACY_SUPPORT_UNAVAILABLE" });
    }
  });
  app.put("/api/admin/privacy-requests/:id", guard("MANAGE_SUPPORT"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { status, reason } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !STATES.has(status) || typeof reason !== "string" || reason.trim().length < 10 || reason.length > 1e3) return res.status(400).json({ ok: false, error: "INVALID_PRIVACY_REVIEW" });
    try {
      const data = await (await getDb()).tx(async (c) => {
        const row = (await c.query("SELECT * FROM internal.privacy_requests WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id IN(SELECT tenant_id FROM internal.merchants WHERE id=$2::uuid)) FOR UPDATE", [req.params.id, req.query.merchantId || null])).rows[0];
        if (!row) return null;
        await c.query("UPDATE internal.privacy_requests SET status=$2,updated_at=now() WHERE id=$1", [row.id, status]);
        await c.query("INSERT INTO internal.privacy_request_events(request_id,tenant_id,actor_ref,event,reason) VALUES($1,$2,$3,$4,$5)", [row.id, row.tenant_id, req.adminPrincipal.subject, status, reason.trim()]);
        await c.query("INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,request_id) VALUES(uuidv7(),$1,$2,'REVIEW_PRIVACY_REQUEST',$3,$4)", [req.internal.id, req.internal.role, "privacy-request:" + row.id, req.auditRequestId]);
        return { id: row.id, status };
      });
      if (!data) return res.status(404).json({ ok: false, error: "REQUEST_NOT_FOUND" });
      res.json({ ok: true, request: data });
    } catch {
      res.status(503).json({ ok: false, error: "PRIVACY_SUPPORT_UNAVAILABLE" });
    }
  });
}

// src/server/clientSupport.ts
import { createClient as createClient2 } from "@supabase/supabase-js";

// services/shared/betterAuthOwner.ts
async function betterOwnerIdentity(subject) {
  if (!/^[0-9a-f-]{36}$/i.test(subject)) return null;
  const { pool } = getBetterAuthRuntime();
  const row = (await pool.query(`SELECT u.email,u."emailVerified" AS verified
    FROM internal.auth_identity_bindings b
    JOIN internal.users c ON c.id=b.canonical_user_id AND c.is_active
    JOIN newhope_auth."user" u ON u.id=b.provider_subject AND u."isActive"
    WHERE b.provider='better-auth' AND b.issuer=$1 AND b.canonical_user_id=$2 AND b.is_active`, [betterAuthPilotConfig().baseUrl, subject])).rows[0];
  return row ? { email: row.email, verified: row.verified === true } : null;
}

// src/config/accountSubscription.ts
function accountSubscription(tenant2, stored, used, now = Date.now()) {
  const start = new Date(tenant2.created_at).toISOString();
  const end = new Date(Date.parse(start) + TRIAL_DAYS * DAY_MS).toISOString();
  const s = stored || {
    plan_id: TRIAL_PLAN_ID,
    status: "TRIAL",
    current_period_start: start,
    current_period_end: end,
    grace_period_end: new Date(Date.parse(end) + 14 * DAY_MS).toISOString(),
    trial_started_at: start,
    trial_ends_at: end,
    extra_outlets: 0
  };
  const access = subscriptionAccess({
    status: tenant2.is_active ? s.status : "EXPIRED",
    planId: tenant2.is_active ? s.plan_id : void 0,
    currentPeriodEnd: new Date(s.current_period_end).toISOString(),
    gracePeriodEnd: s.grace_period_end ? new Date(s.grace_period_end).toISOString() : void 0
  }, now);
  const planId = access.status === "FREE" ? FREE_PLAN_ID : s.plan_id;
  const plan = findSaaSPlan(planId);
  const included = plan?.maxOutlets ?? null, extra = access.status === "FREE" ? 0 : Number(s.extra_outlets || 0);
  const max = included === null ? null : included + extra;
  const licensedUsed = access.status === "FREE" ? s.free_selection ? 1 : 0 : Number(used);
  return {
    subscription: {
      planId,
      planName: plan?.name || planId,
      billingCycle: s.billing_cycle || null,
      periodStart: s.current_period_start,
      periodEnd: s.current_period_end,
      graceEnd: s.grace_period_end,
      trialStart: s.trial_started_at,
      trialEnd: s.trial_ends_at,
      recurringAmount: s.recurring_amount ?? null,
      ...access
    },
    retainedOutlets: Number(used),
    capacity: { included, extra, used: licensedUsed, max, remaining: max === null ? null : Math.max(0, max - licensedUsed) }
  };
}

// src/server/clientSupport.ts
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SupportError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
function createClientSupportProvider() {
  if (process.env.AUTH_PROVIDER === "better-auth") return {
    configured: process.env.AUTH_EMAIL_ENABLED === "1" && !!process.env.RESEND_API_KEY && !!process.env.AUTH_EMAIL_FROM,
    ownerIdentity: betterOwnerIdentity,
    async ownerEmail(subject) {
      const u = await betterOwnerIdentity(subject);
      return u?.verified ? u.email : null;
    },
    async sendConfirmation(email) {
      if (hybridExternalWritesBlocked()) throw new SupportError(403, "HYBRID_STAGING_EMAIL_BLOCKED");
      await getBetterAuthRuntime().auth.api.sendVerificationEmail({ body: { email, callbackURL: betterAuthPilotConfig().baseUrl + "/login" } });
    },
    async sendReset(email) {
      await getBetterAuthRuntime().auth.api.requestPasswordReset({ body: { email, redirectTo: betterAuthPilotConfig().baseUrl + "/reset-password" } });
    }
  };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth = url && key ? createClient2(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5e3) }) }
  }) : null;
  const identity = async (subject) => {
    if (!auth) throw new SupportError(503, "SUPPORT_AUTH_NOT_CONFIGURED");
    if (!uuid.test(subject)) return null;
    const { data, error } = await auth.auth.admin.getUserById(subject);
    if (error) {
      if (error.status === 404) return null;
      throw new SupportError(502, "OWNER_LOOKUP_FAILED");
    }
    const u = data.user;
    return u?.id === subject && !u.deleted_at && (!u.banned_until || Date.parse(u.banned_until) <= Date.now()) && u.email ? { email: u.email, verified: !!u.email_confirmed_at } : null;
  };
  return {
    configured: !!auth,
    ownerIdentity: identity,
    async ownerEmail(subject) {
      const u = await identity(subject);
      return u?.verified ? u.email : null;
    },
    async sendConfirmation(email) {
      if (hybridExternalWritesBlocked()) throw new SupportError(403, "HYBRID_STAGING_EMAIL_BLOCKED");
      if (!auth) throw new SupportError(503, "SUPPORT_AUTH_NOT_CONFIGURED");
      const destination = new URL("/login", process.env.APP_URL || "https://kasir.newhope.space");
      if (destination.protocol !== "https:") throw new SupportError(503, "SUPPORT_REDIRECT_NOT_CONFIGURED");
      const { error } = await auth.auth.resend({ type: "signup", email, options: { emailRedirectTo: destination.href } });
      if (error) throw new SupportError(error.status === 429 ? 429 : 502, "EMAIL_CONFIRMATION_PROVIDER_REJECTED");
    },
    async sendReset(email) {
      if (hybridExternalWritesBlocked()) throw new SupportError(403, "HYBRID_STAGING_EMAIL_BLOCKED");
      if (!auth) throw new SupportError(503, "SUPPORT_AUTH_NOT_CONFIGURED");
      const destination = new URL("/reset-password", process.env.APP_URL || "https://kasir.newhope.space");
      if (destination.protocol !== "https:") throw new SupportError(503, "SUPPORT_REDIRECT_NOT_CONFIGURED");
      const { error } = await auth.auth.resetPasswordForEmail(email, { redirectTo: destination.href });
      if (error) throw new SupportError(error.status === 429 ? 429 : 502, "PASSWORD_RESET_PROVIDER_REJECTED");
    }
  };
}
function supportStepUpError(principal, now = Date.now()) {
  if (principal?.aal !== "aal2") return "MFA_REQUIRED";
  if (!principal.mfaVerifiedAt || now / 1e3 - principal.mfaVerifiedAt >= 600 || principal.mfaVerifiedAt > now / 1e3 + 30) return "REAUTH_REQUIRED";
  return null;
}
async function tenant(c, id, lock = false) {
  const row = (await c.query(`SELECT id,name,owner_user_ref,is_active,created_at FROM internal.tenants WHERE id=$1 AND merged_into IS NULL${lock ? " FOR UPDATE" : ""}`, [id])).rows[0];
  if (!row) throw new SupportError(404, "CLIENT_NOT_FOUND");
  return row;
}
async function audit(c, req, action, reason, before, after) {
  await c.query(`INSERT INTO internal.support_actions(tenant_id,internal_user_id,action,reason,before_state,after_state,request_id,ip_address,user_agent)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`, [
    req.params.tenantId,
    req.internal.id,
    action,
    reason,
    JSON.stringify(before),
    JSON.stringify(after),
    req.auditRequestId,
    req.ip || null,
    String(req.headers["user-agent"] || "").slice(0, 512)
  ]);
}
function registerClientSupportRoutes(app, getDb, guard, provider = createClientSupportProvider()) {
  const run = (fn) => async (req, res) => {
    try {
      await fn(req, res, await getDb());
    } catch (e) {
      res.status(e instanceof SupportError ? e.status : 500).json({ ok: false, error: e instanceof SupportError ? e.message : "CLIENT_SUPPORT_FAILED" });
    }
  };
  app.get("/api/admin/clients", guard("VIEW_MERCHANT_HEALTH"), run(async (req, res, db) => {
    const allowed = ["ROLE_SUPERADMIN", "ROLE_INTERNAL_SUPPORT"].includes(req.internal.role);
    await db.query(`INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,request_id)
      VALUES(gen_random_uuid(),$1,$2,$3,'/api/admin/clients',$4)`, [req.internal.id, req.internal.role, allowed ? "VIEW_CLIENT_DIRECTORY" : "DENIED_VIEW_CLIENT_DIRECTORY", req.auditRequestId]);
    if (!allowed) throw new SupportError(403, "CAPABILITY_DENIED");
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0)), limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit) || 20)));
    const filter = "t.merged_into IS NULL AND t.owner_user_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND ($1='' OR strpos(lower(t.name),lower($1))>0 OR t.id::text=$1)";
    const result = (await db.query(`WITH matching AS (SELECT t.id,t.name,t.is_active,t.created_at FROM internal.tenants t WHERE ${filter}),
      page AS (SELECT * FROM matching ORDER BY created_at DESC,id LIMIT $2 OFFSET $3),
      details AS (SELECT t.*,to_jsonb(s) subscription_snapshot,
      (SELECT count(*)::int FROM internal.merchants m WHERE m.tenant_id=t.id) business_count,
      (SELECT count(*)::int FROM internal.outlets o WHERE o.tenant_id=t.id AND o.is_active) active_outlet_count
      FROM page t LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id)
      SELECT (SELECT count(*)::int FROM matching) total,
        COALESCE(jsonb_agg(details ORDER BY created_at DESC,id),'[]'::jsonb) rows FROM details`, [search, limit, offset])).rows[0];
    const rows = result.rows.map(({ subscription_snapshot, ...row }) => ({ ...row, ...accountSubscription(row, subscription_snapshot, row.active_outlet_count) }));
    res.json({ ok: true, rows, total: result.total, limit, offset });
  }));
  app.get("/api/admin/clients/:tenantId", guard("MANAGE_SUPPORT"), run(async (req, res, db) => {
    const reason = typeof req.query.justification === "string" ? req.query.justification.trim() : "";
    if (reason.length < 10 || reason.length > 2e3) throw new SupportError(400, "REASON_MINIMUM_10_CHARACTERS");
    const client = await tenant(db, req.params.tenantId);
    const identity = async () => {
      let email2 = null, authStatus2 = "NOT_CONFIGURED";
      if (provider.configured) {
        try {
          if (provider.ownerIdentity) {
            const owner = await provider.ownerIdentity(client.owner_user_ref);
            email2 = owner?.email || null;
            authStatus2 = owner ? owner.verified ? "VERIFIED" : "EMAIL_UNCONFIRMED" : "OWNER_NOT_FOUND";
          } else {
            email2 = await provider.ownerEmail(client.owner_user_ref);
            authStatus2 = email2 ? "VERIFIED" : "OWNER_NOT_VERIFIED";
          }
        } catch {
          authStatus2 = "UNAVAILABLE";
        }
      }
      return { email: email2, authStatus: authStatus2 };
    };
    const [{ email, authStatus }, businesses, outlets, diagnostics, history, billing] = await Promise.all([
      identity(),
      db.query("SELECT id,name,business_sector,is_active FROM internal.merchants WHERE tenant_id=$1 ORDER BY name,id LIMIT 201", [client.id]),
      db.query("SELECT id,merchant_id,name,is_active FROM internal.outlets WHERE tenant_id=$1 ORDER BY name,id LIMIT 201", [client.id]),
      // Read the existing cross-service contract, never widen internal service
      // permissions to raw POS ledgers or operational recovery payloads.
      db.query(`SELECT count(*)::int ledger_records,max(created_at) last_transaction_at
        FROM contract.transaction_log WHERE tenant_id=$1`, [client.id]),
      db.query(`SELECT a.id,a.action,a.reason,a.created_at,a.after_state,u.email operator_email FROM internal.support_actions a
        JOIN internal.internal_users u ON u.id=a.internal_user_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 51`, [client.id]),
      db.query(`SELECT to_jsonb(s) subscription_snapshot,
        (SELECT count(*)::int FROM internal.outlets o WHERE o.tenant_id=t.id AND o.is_active) active_outlets
        FROM internal.tenants t LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id WHERE t.id=$1`, [client.id])
    ]);
    const plan = accountSubscription(client, billing.rows[0].subscription_snapshot, billing.rows[0].active_outlets);
    res.json({
      ok: true,
      client: { ...client, ownerEmail: email, authStatus },
      canEditProfile: req.internal.role === "ROLE_SUPERADMIN",
      ...plan,
      resetStepUpRequired: !!supportStepUpError(req.adminPrincipal),
      resetAvailable: authStatus === "VERIFIED",
      confirmationAvailable: authStatus === "EMAIL_UNCONFIRMED" && !!provider.sendConfirmation,
      diagnostics: diagnostics.rows[0],
      businesses: businesses.rows.slice(0, 200),
      outlets: outlets.rows.slice(0, 200),
      history: history.rows.slice(0, 50),
      truncated: { businesses: businesses.rows.length > 200, outlets: outlets.rows.length > 200, history: history.rows.length > 50 }
    });
  }));
  app.post("/api/admin/clients/:tenantId/actions", guard("MANAGE_SUPPORT"), run(async (req, res, db) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 2e3) throw new SupportError(400, "REASON_MINIMUM_10_CHARACTERS");
    const action = req.body?.action;
    if (!["NOTE", "UPDATE_CLIENT_PROFILE", "RESET_PASSWORD", "RESEND_CONFIRMATION"].includes(action)) throw new SupportError(400, "INVALID_SUPPORT_ACTION");
    if (action === "UPDATE_CLIENT_PROFILE" && req.internal.role !== "ROLE_SUPERADMIN") throw new SupportError(403, "CAPABILITY_DENIED");
    if (!["RESET_PASSWORD", "RESEND_CONFIRMATION"].includes(action)) {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      if (action === "UPDATE_CLIENT_PROFILE" && (name.length < 2 || name.length > 100)) throw new SupportError(400, "INVALID_CLIENT_NAME");
      await db.tx(async (c) => {
        const before = await tenant(c, req.params.tenantId, true);
        if (action === "UPDATE_CLIENT_PROFILE") await c.query("UPDATE internal.tenants SET name=$2,updated_at=now() WHERE id=$1", [before.id, name]);
        await audit(c, req, action, reason, { name: before.name }, { name: action === "UPDATE_CLIENT_PROFILE" ? name : before.name });
      });
      return res.json({ ok: true, message: action === "NOTE" ? "Catatan support tersimpan." : "Nama akun diperbarui; transaksi dan nama outlet tidak diubah." });
    }
    const stepUp = supportStepUpError(req.adminPrincipal);
    if (stepUp) throw new SupportError(403, stepUp);
    if (!provider.configured) throw new SupportError(503, "SUPPORT_AUTH_NOT_CONFIGURED");
    const confirmation = action === "RESEND_CONFIRMATION", prefix = confirmation ? "EMAIL_CONFIRMATION" : "PASSWORD_RESET";
    if (confirmation && (!provider.ownerIdentity || !provider.sendConfirmation)) throw new SupportError(503, "SUPPORT_CONFIRMATION_NOT_CONFIGURED");
    const requestKey = req.body.requestKey;
    if (typeof requestKey !== "string" || !uuid.test(requestKey)) throw new SupportError(400, "INVALID_REQUEST_KEY");
    const prepared = await db.tx(async (c) => {
      const client = await tenant(c, req.params.tenantId, true);
      if (!uuid.test(client.owner_user_ref || "")) throw new SupportError(409, "OWNER_AUTH_NOT_LINKED");
      const old = (await c.query(`SELECT action FROM internal.support_actions WHERE tenant_id=$1
        AND action IN ($3,$4,$5) AND after_state->>'requestKey'=$2 ORDER BY created_at DESC,id DESC`, [client.id, requestKey, prefix + "_REQUESTED", prefix + "_SENT", prefix + "_FAILED"])).rows;
      if (old.length) return { client, replay: true, status: old.some((r) => r.action === prefix + "_SENT") ? "SENT" : old.some((r) => r.action === prefix + "_FAILED") ? "FAILED" : "PENDING" };
      const recent = (await c.query("SELECT 1 FROM internal.support_actions WHERE tenant_id=$1 AND action IN ('PASSWORD_RESET_REQUESTED','EMAIL_CONFIRMATION_REQUESTED') AND created_at>now()-interval '2 minutes' LIMIT 1", [client.id])).rows;
      if (recent.length) throw new SupportError(429, "PASSWORD_RESET_COOLDOWN");
      await audit(c, req, prefix + "_REQUESTED", reason, null, { requestKey, status: "PENDING" });
      return { client, replay: false, status: "PENDING" };
    });
    if (prepared.replay) return res.status(prepared.status === "PENDING" ? 202 : 200).json({ ok: true, replayed: true, status: prepared.status, message: "Permintaan ini sudah tercatat; tidak ada email tambahan yang dikirim. Periksa riwayat support." });
    let accepted = false;
    try {
      if (confirmation) {
        const owner = await provider.ownerIdentity(prepared.client.owner_user_ref);
        if (!owner) throw new SupportError(409, "OWNER_AUTH_NOT_LINKED");
        if (owner.verified) throw new SupportError(409, "OWNER_ALREADY_VERIFIED");
        await provider.sendConfirmation(owner.email);
      } else {
        const email = await provider.ownerEmail(prepared.client.owner_user_ref);
        if (!email) throw new SupportError(409, "OWNER_EMAIL_NOT_VERIFIED");
        await provider.sendReset(email);
      }
      accepted = true;
      await db.tx((c) => audit(c, req, prefix + "_SENT", reason, null, { requestKey, status: "SENT" }));
    } catch (e) {
      if (accepted) throw new SupportError(503, "PASSWORD_RESET_STATUS_UNKNOWN");
      await db.tx((c) => audit(c, req, prefix + "_FAILED", reason, null, { requestKey, status: "FAILED" }));
      throw e instanceof SupportError ? e : new SupportError(502, "PASSWORD_RESET_PROVIDER_REJECTED");
    }
    res.json({ ok: true, status: "SENT", message: confirmation ? "Permintaan konfirmasi diterima oleh layanan Auth. Owner perlu membuka link terbaru di inbox/spam, lalu meminta reset password." : "Permintaan email reset diterima oleh layanan Auth. Owner perlu memeriksa inbox/spam dan memilih kata sandi sendiri." });
  }));
}

// src/server/subscriptionDetail.ts
async function subscriptionDetail(db, tenantId) {
  return db.tx(async (c) => {
    await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tenant2 = (await c.query("SELECT id,name,created_at,is_active FROM internal.tenants WHERE id=$1", [tenantId])).rows[0];
    if (!tenant2) return null;
    const stored = (await c.query("SELECT * FROM billing.subscriptions WHERE tenant_id=$1", [tenantId])).rows[0];
    const outlets = (await c.query("SELECT id,name,is_active FROM internal.outlets WHERE tenant_id=$1 ORDER BY name,id LIMIT 201", [tenantId])).rows;
    const usage = (await c.query("SELECT count(*)::int AS used FROM internal.outlets WHERE tenant_id=$1 AND is_active", [tenantId])).rows[0].used;
    const invoices = (await c.query(`SELECT id,invoice_number,amount,currency,payment_status,reconciliation_status,reconciliation_note,created_at,due_date
      FROM billing.invoices WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101`, [tenantId])).rows;
    const payments = (await c.query(`SELECT e.id,e.invoice_number,e.amount,e.currency,e.outcome,e.reason,e.created_at
      FROM billing.payment_events e WHERE EXISTS(SELECT 1 FROM billing.invoices i WHERE i.tenant_id=$1 AND i.invoice_number=e.invoice_number)
      ORDER BY e.created_at DESC,e.id DESC LIMIT 101`, [tenantId])).rows;
    const support = (await c.query(`SELECT a.id,a.action,a.reason,a.created_at,a.request_id,u.email AS operator_email
      FROM internal.support_actions a JOIN internal.internal_users u ON u.id=a.internal_user_id
      WHERE a.tenant_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 51`, [tenantId])).rows;
    const activity = (await c.query("SELECT min(created_at) AS first_transaction_at,max(created_at) AS last_transaction_at FROM contract.merchant_revenue WHERE tenant_id=$1", [tenantId])).rows[0];
    return {
      tenant: tenant2,
      retrievedAt: (/* @__PURE__ */ new Date()).toISOString(),
      derivedTrial: !stored,
      activity,
      ...accountSubscription(tenant2, stored, usage),
      outlets: outlets.slice(0, 200),
      invoices: invoices.slice(0, 100),
      payments: payments.slice(0, 100),
      support: support.slice(0, 50),
      truncated: { outlets: outlets.length > 200, invoices: invoices.length > 100, payments: payments.length > 100, support: support.length > 50 }
    };
  });
}

// src/server/subscriptionAdminRoutes.ts
function registerSubscriptionAdminRoutes(app, getDb, guard, wrap) {
  app.get("/api/admin/tenants/:tenantId/subscription-detail", guard("VIEW_MERCHANT_DETAIL"), wrap(async (req, res, db) => {
    const detail = await subscriptionDetail(db, req.params.tenantId);
    if (!detail) return res.status(404).json({ ok: false, error: "TENANT_NOT_FOUND" });
    res.json({ ok: true, ...detail });
  }));
  app.get("/api/admin/subscriptions", guard("VIEW_MERCHANT_HEALTH"), wrap(async (req, res, db) => {
    const search = String(req.query.search || "").trim().toLowerCase().slice(0, 100);
    const { rows } = await db.query(`WITH accounts AS MATERIALIZED (
      SELECT id,name,created_at,is_active FROM internal.tenants
      WHERE merged_into IS NULL ORDER BY created_at DESC,id LIMIT 10001
    ), outlet_facts AS (
      SELECT o.tenant_id,count(*)::int AS outlet_count FROM internal.outlets o
      JOIN accounts a ON a.id=o.tenant_id WHERE o.is_active GROUP BY o.tenant_id
    ), revenue_facts AS (
      SELECT r.tenant_id,min(r.created_at) AS first_transaction_at,max(r.created_at) AS last_transaction_at
      FROM contract.merchant_revenue r JOIN accounts a ON a.id=r.tenant_id GROUP BY r.tenant_id
    ), paid_accounts AS (
      SELECT DISTINCT i.tenant_id FROM billing.invoices i JOIN accounts a ON a.id=i.tenant_id
      WHERE i.payment_status='PAID' AND i.reconciliation_status='APPLIED'
    ), matching_businesses AS (
      SELECT DISTINCT m.tenant_id FROM internal.merchants m JOIN accounts a ON a.id=m.tenant_id
      WHERE $1<>'' AND position($1 in lower(m.name))>0
    ) SELECT t.id,t.name,t.created_at,t.is_active,s.id AS subscription_id,s.plan_id,
      s.status,s.current_period_start,s.current_period_end,s.grace_period_end,s.billing_cycle,s.extra_outlets,s.trial_started_at,s.trial_ends_at,to_jsonb(s)->'free_selection' AS free_selection,
      coalesce(o.outlet_count,0)::int AS outlet_count,r.first_transaction_at,r.last_transaction_at,
      p.tenant_id IS NOT NULL AS converted,m.tenant_id IS NOT NULL AS matches_business
      FROM accounts t LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id
      LEFT JOIN outlet_facts o ON o.tenant_id=t.id LEFT JOIN revenue_facts r ON r.tenant_id=t.id
      LEFT JOIN paid_accounts p ON p.tenant_id=t.id LEFT JOIN matching_businesses m ON m.tenant_id=t.id
      ORDER BY t.created_at DESC,t.id`, [search]);
    if (rows.length > 1e4) return res.status(503).json({ ok: false, error: "SUBSCRIPTION_REPORT_REQUIRES_PAGINATED_AGGREGATION" });
    const all = rows.map((r) => {
      const { subscription: access, capacity } = accountSubscription(r, r.subscription_id ? r : null, r.outlet_count);
      const effectivePlanId = access.planId;
      const day = Math.max(1, Math.floor((Date.now() - Date.parse(r.trial_started_at || r.created_at)) / DAY_MS) + 1);
      return {
        ...r,
        outlet_count: capacity.used,
        retained_outlet_count: r.outlet_count,
        plan_id: effectivePlanId,
        extra_outlets: access.status === "FREE" ? 0 : r.extra_outlets,
        status: access.status,
        accessMode: access.accessMode,
        daysLeft: access.daysLeft,
        trialDay: day,
        lifecycleStage: r.converted ? "CONVERTED" : lifecycleStage(day),
        maxOutlets: capacity.max
      };
    });
    const eligible = all.filter((r) => r.trial_started_at || r.plan_id === TRIAL_PLAN_ID || !r.subscription_id);
    const converted = eligible.filter((r) => r.converted).length;
    const summary2 = {
      active: all.filter((r) => r.status === "ACTIVE").length,
      trial: all.filter((r) => r.status === "TRIAL").length,
      expired: all.filter((r) => ["EXPIRED", "PAST_DUE"].includes(r.status)).length,
      trialEntrants: eligible.length,
      activated: eligible.filter((r) => r.first_transaction_at).length,
      converted,
      conversionRate: eligible.length ? Math.round(converted / eligible.length * 1e3) / 10 : 0
    };
    const filtered = all.filter((r) => (!search || r.name.toLowerCase().includes(search) || r.matches_business) && (!req.query.status || r.status === req.query.status));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25)), offset = Math.max(0, Number(req.query.offset) || 0);
    const page2 = filtered.slice(offset, offset + limit);
    const businesses = page2.length ? (await db.query(`SELECT m.id,m.tenant_id,m.name,m.business_sector,m.is_active,
      count(o.id) FILTER(WHERE o.is_active)::int AS active_outlets
      FROM internal.merchants m LEFT JOIN internal.outlets o ON o.merchant_id=m.id AND o.tenant_id=m.tenant_id
      WHERE m.tenant_id=ANY($1::uuid[]) GROUP BY m.id ORDER BY m.name,m.id`, [page2.map((row) => row.id)])).rows : [];
    const byTenant = /* @__PURE__ */ new Map();
    for (const business of businesses) {
      const group = byTenant.get(business.tenant_id) || [];
      group.push(business);
      byTenant.set(business.tenant_id, group);
    }
    res.json({
      ok: true,
      rows: page2.map(({ matches_business, free_selection, ...row }) => ({ ...row, businesses: byTenant.get(row.id) || [] })),
      total: filtered.length,
      limit,
      offset,
      summary: summary2,
      plans: SAAS_PLANS,
      canManage: req.internal.role === "ROLE_SUPERADMIN",
      canSupport: ["ROLE_SUPERADMIN", "ROLE_INTERNAL_SUPPORT"].includes(req.internal.role)
    });
  }));
  app.get("/api/admin/payments", guard("MANAGE_SUBSCRIPTION"), wrap(async (_req, res, db) => {
    const invoices = await db.query(`SELECT i.*,t.name AS tenant_name FROM billing.invoices i JOIN internal.tenants t ON t.id=i.tenant_id ORDER BY i.created_at DESC LIMIT 200`);
    const events = await db.query("SELECT * FROM billing.payment_events ORDER BY created_at DESC LIMIT 200");
    res.json({ ok: true, rows: invoices.rows, events: events.rows });
  }));
  app.get("/api/admin/tenants/:tenantId/support", guard("MANAGE_SUPPORT"), wrap(async (req, res, db) => {
    const { rows } = await db.query(`SELECT a.*,u.email AS operator_email FROM internal.support_actions a
      JOIN internal.internal_users u ON u.id=a.internal_user_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 100`, [req.params.tenantId]);
    res.json({ ok: true, rows });
  }));
  app.post("/api/admin/tenants/:tenantId/support", guard("MANAGE_SUPPORT"), async (req, res) => {
    try {
      const db = await getDb();
      const reason = String(req.body?.reason || "").trim();
      const action = String(req.body?.action || "");
      if (reason.length < 10 || reason.length > 2e3) throw new BillingError(400, "REASON_MINIMUM_10_CHARACTERS");
      if (!["NOTE", "EXTEND_TRIAL", "GRANT_PLAN", "PAYMENT_NOTE"].includes(action)) throw new BillingError(400, "INVALID_SUPPORT_ACTION");
      if (action !== "NOTE" && req.internal.role !== "ROLE_SUPERADMIN") throw new BillingError(403, "CAPABILITY_DENIED");
      const result = await db.tx(async (c) => {
        const tenant2 = await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [req.params.tenantId]);
        if (!tenant2.rowCount) throw new BillingError(404, "TENANT_NOT_FOUND");
        const before = await ensureSubscription(c, req.params.tenantId);
        let invoiceBefore = null, invoiceAfter = null;
        if (action === "EXTEND_TRIAL") {
          const days = Number(req.body.days);
          if (!Number.isInteger(days) || days < 1 || days > 14 || before.plan_id !== TRIAL_PLAN_ID) throw new BillingError(400, "INVALID_TRIAL_EXTENSION");
          await c.query(`UPDATE billing.subscriptions SET current_period_end=greatest(current_period_end,now())+$2*interval '1 day',
            grace_period_end=greatest(current_period_end,now())+($2+14)*interval '1 day',status='TRIAL',revision=revision+1,updated_at=now() WHERE id=$1`, [before.id, days]);
        }
        if (action === "GRANT_PLAN") {
          let q;
          try {
            q = manualTierChange(before, req.body, await outletUsage(c, req.params.tenantId));
          } catch (e) {
            throw new BillingError(400, e.message);
          }
          await c.query(
            `UPDATE billing.subscriptions SET plan_id=$2,billing_cycle=$3,extra_outlets=$4,recurring_amount=$7,
            status='ACTIVE',current_period_start=$5,current_period_end=$6,grace_period_end=$6::timestamptz+interval '14 days',revision=revision+1,updated_at=now() WHERE id=$1`,
            [before.id, q.planId, q.billingCycle, q.extraOutlets, q.periodStart, q.periodEnd, q.recurringAmount]
          );
        }
        if (action === "PAYMENT_NOTE") {
          const invoice = await c.query("SELECT id,reconciliation_note,reconciliation_status,payment_status FROM billing.invoices WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [req.body.invoiceId, req.params.tenantId]);
          if (!invoice.rowCount) throw new BillingError(404, "INVOICE_NOT_FOUND");
          invoiceBefore = invoice.rows[0];
          await c.query("UPDATE billing.invoices SET reconciliation_note=$2 WHERE id=$1", [req.body.invoiceId, reason]);
          invoiceAfter = { ...invoiceBefore, reconciliation_note: reason };
        }
        const after = (await c.query("SELECT * FROM billing.subscriptions WHERE id=$1", [before.id])).rows[0];
        await c.query(`INSERT INTO internal.support_actions(tenant_id,internal_user_id,action,reason,before_state,after_state,request_id,ip_address,user_agent)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`, [
          req.params.tenantId,
          req.internal.id,
          action,
          reason,
          JSON.stringify({ ...before, invoice: invoiceBefore }),
          JSON.stringify({ ...after, invoice: invoiceAfter }),
          req.auditRequestId,
          req.ip || null,
          String(req.headers["user-agent"] || "").slice(0, 512)
        ]);
        return serializeSubscription(after);
      });
      res.json({ ok: true, subscription: result });
    } catch (err) {
      res.status(err instanceof BillingError ? err.status : 500).json({ ok: false, error: err instanceof BillingError ? err.message : "SUPPORT_ACTION_FAILED" });
    }
  });
}

// services/mcp/tools.ts
var MCP_SCOPE = "pos:read";
var annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
var page = { type: "integer", minimum: 0, maximum: 1e4, default: 0 };
var mcpTools = [
  { name: "business_info", description: "Read the business explicitly approved by the owner for this connection.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_products", description: "Read a page of product names, prices and stock. Data is synchronized POS data, not necessarily live device stock.", inputSchema: { type: "object", properties: { offset: page }, additionalProperties: false } },
  { name: "low_stock", description: "Read products at or below their stock alert threshold. Paginated; no customer or staff data.", inputSchema: { type: "object", properties: { offset: page }, additionalProperties: false } },
  { name: "sales_summary", description: "Sum completed, paid sales for a UTC interval (end exclusive, maximum 93 days). Includes taxes and service charges. Not profit or net settlement.", inputSchema: { type: "object", properties: { start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" } }, required: ["start", "end"], additionalProperties: false } },
  { name: "list_transactions", description: "Read a page of transaction IDs, dates, totals and statuses in a UTC interval (maximum 93 days). No customer details, cashier names or payment credentials.", inputSchema: { type: "object", properties: { start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" }, offset: page }, required: ["start", "end"], additionalProperties: false } }
].map((tool) => ({ ...tool, annotations, securitySchemes: [{ type: "oauth2", scopes: [MCP_SCOPE] }] }));

// services/mcp/settings.ts
async function mcpAdminSettings(db) {
  try {
    const row = (await db.query("SELECT enabled,updated_at FROM internal.platform_integrations WHERE key='mcp'")).rows[0];
    return { enabled: row?.enabled !== false, updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null, available: true };
  } catch (error) {
    if (error.code !== "42P01") throw error;
    return { enabled: true, updatedAt: null, available: false };
  }
}

// services/mcp/routes.ts
function mcpConfig() {
  const origin = new URL(process.env.MCP_PUBLIC_ORIGIN || "https://kasir.newhope.space");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("INVALID_MCP_ORIGIN");
  const clients = {
    chatgpt: ["https://chatgpt.com/connector_platform_oauth_redirect", ...(process.env.MCP_CHATGPT_REDIRECT_URIS || "").split(",").filter(Boolean)],
    claude: ["https://claude.ai/api/mcp/auth_callback", ...(process.env.MCP_CLAUDE_REDIRECT_URIS || "").split(",").filter(Boolean)]
  };
  for (const urls of Object.values(clients)) for (const callback of urls) {
    const uri = new URL(callback);
    if (uri.protocol !== "https:" || uri.username || uri.password || uri.hash) throw new Error("INVALID_MCP_CALLBACK");
  }
  return { origin: origin.origin, resource: origin.origin + "/api/mcp", issuer: origin.origin, clients };
}

// src/server/adminIntegrations.ts
function integrationProviders(env = process.env) {
  const configured = (...keys) => keys.every((key) => Boolean(env[key]?.trim()));
  return [
    { id: env.AUTH_PROVIDER === "better-auth" ? "neon" : "supabase", name: env.AUTH_PROVIDER === "better-auth" ? "Neon + Better Auth" : "Supabase", purpose: "Database dan autentikasi akun", configured: configured("DATABASE_URL") && (env.AUTH_PROVIDER === "better-auth" ? configured("BETTER_AUTH_SECRET", "BETTER_AUTH_URL") : configured("SUPABASE_URL", "SUPABASE_ANON_KEY") || configured("VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY")), dashboard: env.AUTH_PROVIDER === "better-auth" ? "https://console.neon.tech/app/projects/steep-sea-66546931" : "https://supabase.com/dashboard/project/fqxrhumsgigcgjtlbfuo", note: "Status berdasarkan konfigurasi server; bukan pemeriksaan uptime." },
    { id: "doku", name: "DOKU", purpose: "Pembayaran langganan", configured: configured("DOKU_CLIENT_ID", "DOKU_SECRET_KEY"), dashboard: "https://dashboard.doku.com/", note: (env.DOKU_API_URL || "https://api.doku.com").includes("api-sandbox") ? "Mode sandbox; bukan pembayaran produksi." : "Endpoint produksi; periksa aktivasi channel di dashboard DOKU." },
    { id: "resend", name: "Resend", purpose: "Email bantuan akun dan billing", configured: configured("RESEND_API_KEY"), dashboard: "https://resend.com/api-keys", note: "Keberadaan kunci tidak memastikan domain pengirim telah diverifikasi." },
    { id: "blog", name: "Blog automation", purpose: "REST API dan MCP penerbitan artikel", configured: String(env.BLOG_API_KEYS || "").split(",").some((key) => key.trim().length >= 24), dashboard: "https://vercel.com/slaks37s-projects/kasir-newhope/settings/environment-variables", note: "Key BLOG_API_KEYS hanya untuk blog. Berbeda dari OAuth read-only data POS; koneksi agen tidak tercatat sebagai koneksi owner MCP." },
    { id: "deepseek", name: "DeepSeek", purpose: "Analisis AI berbayar", configured: configured("DEEPSEEK_API_KEY"), dashboard: "https://platform.deepseek.com/api_keys", note: "Penggunaan mengikuti batas akun dan paket di layanan AI." },
    { id: "agnes", name: "Agnes AI", purpose: "Penyedia AI alternatif", configured: configured("AGNES_API_KEY"), dashboard: "https://apihub.agnes-ai.com/", note: "Status hanya konfigurasi; pilihan model mengikuti layanan AI." }
  ];
}
var INTEGRATION_API_CATALOG = [
  { method: "GET", path: "/api/v1/blog-automation/guide", auth: "Bearer API key blog", purpose: "Panduan otomasi artikel" },
  { method: "POST", path: "/api/v1/blog-automation/validate", auth: "Bearer API key blog", purpose: "Validasi artikel tanpa menyimpan" },
  { method: "POST", path: "/api/v1/blog-automation/posts", auth: "Bearer API key blog; dapat menerbitkan artikel", purpose: "Buat artikel (publish:false untuk draft)" },
  { method: "POST", path: "/api/v1/blog-automation/mcp", auth: "Bearer API key blog; bukan OAuth POS", purpose: "MCP editorial untuk automation agent" },
  { method: "GET", path: "/api/v1/subscription/plans", auth: "Publik", purpose: "Katalog paket" },
  { method: "GET", path: "/api/v1/subscription/status", auth: "Bearer JWT akun owner", purpose: "Langganan dan kapasitas akun" },
  { method: "GET", path: "/api/v1/sync/business", auth: "Bearer JWT akun owner", purpose: "Bisnis dan outlet akun" },
  { method: "GET", path: "/api/v1/reports/summary", auth: "Bearer JWT akun; tenant dan outlet tervalidasi", purpose: "Ringkasan laporan cloud" },
  { method: "GET", path: "/api/admin/integrations", auth: "Bearer JWT Superadmin + MFA", purpose: "Inventaris integrasi dan koneksi" },
  { method: "PUT", path: "/api/admin/integrations/mcp", auth: "Bearer JWT Superadmin + MFA baru", purpose: "Simpan pengaturan layanan MCP" },
  { method: "POST", path: "/api/admin/integrations/mcp/connections/{id}/revoke", auth: "Bearer JWT Superadmin + MFA baru", purpose: "Cabut satu koneksi MCP" }
];
function registerAdminIntegrationRoutes(app, getDb, guard) {
  const route = (fn) => (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    Promise.resolve().then(async () => fn(req, res, await getDb())).catch(next);
  };
  app.get("/api/admin/integrations", guard("MANAGE_INTEGRATIONS"), route(async (req, res, db) => {
    const config = mcpConfig(), setting = await mcpAdminSettings(db);
    const present = (await db.query("SELECT to_regclass('mcp_private.connections') IS NOT NULL AND to_regclass('mcp_private.audit') IS NOT NULL AND to_regclass('mcp_private.credentials') IS NOT NULL AS ready")).rows[0]?.ready === true;
    let connections = [], events = [];
    const offset = Math.max(0, Math.min(1e5, Number(req.query.offset) || 0));
    let total = 0, active = 0;
    if (present) {
      const results = await Promise.all([
        db.query(`SELECT c.id,c.owner_ref,c.business_id,c.client_id,c.created_at,c.expires_at,c.revoked_at,
          COALESCE(m.name,c.business_id) AS business_name,
          EXISTS(SELECT 1 FROM mcp_private.credentials k WHERE k.connection_id=c.id AND k.kind IN ('access','refresh')) AS connected,
          (SELECT max(a.created_at) FROM mcp_private.audit a WHERE a.connection_id=c.id AND a.event='tool_read') AS last_used_at
          FROM mcp_private.connections c LEFT JOIN LATERAL (
            SELECT m.name FROM internal.tenants t JOIN internal.merchants m ON m.tenant_id=t.id
            WHERE t.owner_user_ref=c.owner_ref AND t.merged_into IS NULL AND COALESCE(m.external_ref,m.id::text)=c.business_id
            ORDER BY m.id LIMIT 1
          ) m ON true
          ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET $1`, [offset]),
        db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>now())::int AS active FROM mcp_private.connections"),
        db.query(`SELECT a.event,a.tool,a.created_at,c.client_id,c.business_id FROM mcp_private.audit a JOIN mcp_private.connections c ON c.id=a.connection_id ORDER BY a.created_at DESC,a.id DESC LIMIT 30`)
      ]);
      connections = results[0].rows;
      total = Number(results[1].rows[0]?.total || 0);
      active = Number(results[1].rows[0]?.active || 0);
      events = results[2].rows;
    }
    res.json({ ok: true, mcp: { endpoint: config.resource, enabled: process.env.MCP_ENABLED === "true" && setting.enabled, deploymentEnabled: process.env.MCP_ENABLED === "true", storageReady: present, settingsAvailable: setting.available, updatedAt: setting.updatedAt, clients: Object.entries(config.clients).map(([id, callbacks]) => ({ id, name: id === "chatgpt" ? "ChatGPT" : "Claude", callbacks })), scope: MCP_SCOPE, total, active }, connections, events, offset, hasMore: offset + connections.length < total, providers: integrationProviders(), api: { origin: config.origin, authentication: process.env.AUTH_PROVIDER === "better-auth" ? "Sesi Better Auth tervalidasi server untuk POS/admin; OAuth untuk MCP." : "Bearer JWT Supabase untuk API POS/admin; OAuth untuk MCP.", credentialManagement: "Secret penyedia disimpan di environment server Vercel.", catalog: INTEGRATION_API_CATALOG, environmentSettings: "https://vercel.com/slaks37s-projects/kasir-newhope/settings/environment-variables" } });
  }));
  app.put("/api/admin/integrations/mcp", guard("MANAGE_INTEGRATIONS"), route(async (req, res, db) => {
    if (typeof req.body?.enabled !== "boolean" || Object.keys(req.body).some((key) => !["enabled", "expectedUpdatedAt", "reason"].includes(key))) return res.status(400).json({ ok: false, error: "INVALID_SETTINGS" });
    if (typeof req.body.reason !== "string" || !req.body.reason.trim() || req.body.reason.length > 1e3) return res.status(400).json({ ok: false, error: "REASON_REQUIRED" });
    if (req.body.enabled && process.env.MCP_ENABLED !== "true") return res.status(409).json({ ok: false, error: "MCP_DEPLOYMENT_NOT_ENABLED" });
    if (req.body.enabled && (await db.query("SELECT to_regclass('mcp_private.connections') IS NOT NULL AND to_regclass('mcp_private.audit') IS NOT NULL AND to_regclass('mcp_private.credentials') IS NOT NULL AS ready")).rows[0]?.ready !== true) return res.status(409).json({ ok: false, error: "MCP_STORAGE_NOT_READY" });
    const result = await db.tx(async (cx) => {
      await cx.query("SELECT pg_advisory_xact_lock(hashtext('admin:mcp-settings'))");
      const old = await mcpAdminSettings(cx);
      if (!old.available) return "SETTINGS_MIGRATION_REQUIRED";
      if ((req.body.expectedUpdatedAt || null) !== old.updatedAt) return "SETTINGS_CHANGED";
      const setting = (await cx.query(`INSERT INTO internal.platform_integrations(key,enabled,updated_by) VALUES('mcp',$1,$2) ON CONFLICT(key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp() RETURNING enabled,updated_at`, [req.body.enabled, req.internal.id])).rows[0];
      await cx.query(`INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,justification,request_id) VALUES(gen_random_uuid(),$1,$2,'MCP_SETTINGS_UPDATED','integrations/mcp',$3,$4)`, [req.internal.id, req.internal.role, String(req.body.reason).slice(0, 1e3), req.auditRequestId]);
      return setting;
    });
    if (typeof result === "string") return res.status(409).json({ ok: false, error: result });
    res.json({ ok: true, setting: result });
  }));
  app.post("/api/admin/integrations/mcp/connections/:id/revoke", guard("MANAGE_INTEGRATIONS"), route(async (req, res, db) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id) || typeof req.body?.reason !== "string" || !req.body.reason.trim() || req.body.reason.length > 1e3) return res.status(400).json({ ok: false, error: "CONNECTION_ID_AND_REASON_REQUIRED" });
    const result = await db.tx(async (cx) => {
      const row = (await cx.query("SELECT id,revoked_at FROM mcp_private.connections WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!row) return null;
      if (!row.revoked_at) {
        await cx.query("UPDATE mcp_private.connections SET revoked_at=now() WHERE id=$1", [row.id]);
        await cx.query("INSERT INTO mcp_private.audit(connection_id,event) VALUES($1,'admin_revoked')", [row.id]);
        await cx.query(`INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,justification,request_id) VALUES(gen_random_uuid(),$1,$2,'MCP_CONNECTION_REVOKED',$3,$4,$5)`, [req.internal.id, req.internal.role, "integrations/mcp/" + row.id, String(req.body.reason).slice(0, 1e3), req.auditRequestId]);
      }
      return row;
    });
    if (!result) return res.status(404).json({ ok: false, error: "CONNECTION_NOT_FOUND" });
    res.json({ ok: true });
  }));
}

// src/server/repo.ts
function withSubscription(row) {
  const end = row.current_period_end || new Date(Date.parse(row.joined_at) + TRIAL_DAYS * DAY_MS);
  const state = subscriptionAccess({ status: row.is_active ? row.raw_status || "TRIAL" : "EXPIRED", currentPeriodEnd: new Date(end).toISOString(), gracePeriodEnd: row.grace_period_end ? new Date(row.grace_period_end).toISOString() : void 0 });
  return { ...row, subscription_status: state.status, access_mode: state.accessMode, plan_name: findSaaSPlan(row.plan_id)?.name || "Trial 45 Hari" };
}
var SECTORS = ["FNB", "LAUNDRY", "RETAIL", "CARWASH", "BARBERSHOP"];
var SECTOR_LABEL = {
  FNB: "Kafe, Resto & F&B",
  LAUNDRY: "Laundry Kiloan & Satuan",
  RETAIL: "Ritel, Toko & Minimarket",
  CARWASH: "Cuci Mobil & Motor",
  BARBERSHOP: "Barbershop & Salon"
};
var APP_MODULES = [
  "POS",
  "TABLES",
  "INVENTORY",
  "CUSTOMERS",
  "REPORTS",
  "AI",
  "SETTINGS",
  "SYNC",
  "AUTH"
];
var SEVERITIES = ["INFO", "NOTICE", "WARNING", "CRITICAL"];
function pick(allowed, v) {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanFilter(f = {}) {
  const rawLimit = Number(f.limit);
  const rawOffset = Number(f.offset);
  return {
    sector: pick(SECTORS, f.sector),
    // UUID divalidasi bentuknya lebih dulu. Kalau tidak, id ngawur akan sampai
    // ke Postgres dan meledak sebagai error 500 dengan pesan internal, bukan
    // sebagai 400 yang sopan.
    merchantId: typeof f.merchantId === "string" && UUID_RE.test(f.merchantId) ? f.merchantId : null,
    module: pick(APP_MODULES, f.module),
    severity: pick(SEVERITIES, f.severity),
    search: typeof f.search === "string" && f.search.trim() ? f.search.trim().slice(0, 80) : null,
    from: typeof f.from === "string" && DATE_RE.test(f.from) ? f.from : null,
    to: typeof f.to === "string" && DATE_RE.test(f.to) ? f.to : null,
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50,
    offset: Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0
  };
}
var Where = class {
  constructor() {
    this.parts = [];
    this.params = [];
  }
  add(fragment, value) {
    if (value === null || value === void 0) return this;
    this.params.push(value);
    this.parts.push(fragment(`$${this.params.length}`));
    return this;
  }
  raw(fragment) {
    this.parts.push(fragment);
    return this;
  }
  sql() {
    return this.parts.length ? `WHERE ${this.parts.join(" AND ")}` : "";
  }
  next() {
    return `$${this.params.length + 1}`;
  }
};
async function sectorSummary(db) {
  const { rows } = await db.query(
    `
    SELECT s.sector                                   AS business_sector,
           COALESCE(v.merchant_count, 0)::int         AS merchant_count,
           COALESCE(m.registered_merchants, 0)::int   AS business_unit_count,
           COALESCE(m.active_outlet_count, 0)::int    AS active_outlet_count,
           COALESCE(v.transaction_count, 0)::int      AS transaction_count,
           COALESCE(v.gross_revenue, 0)               AS gross_revenue,
           COALESCE(v.avg_basket, 0)                  AS avg_basket,
           COALESCE(v.total_discount, 0)              AS total_discount,
           v.last_transaction_at,
           COALESCE(m.registered_merchants, 0)::int   AS registered_merchants
      FROM unnest($1::text[]) AS s(sector)
      LEFT JOIN contract.admin_sector_summary v ON v.business_sector = s.sector
      LEFT JOIN (
            SELECT business_sector, COUNT(*) AS registered_merchants,
                   COALESCE(SUM(outlet_count),0) AS active_outlet_count
              FROM contract.merchant_directory GROUP BY business_sector
           ) m ON m.business_sector = s.sector
     ORDER BY COALESCE(v.gross_revenue, 0) DESC, s.sector
    `,
    [SECTORS]
  );
  return rows;
}
async function platformTotals(db) {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM contract.merchant_directory)::int                AS merchants,
      (SELECT COUNT(*) FROM contract.merchant_directory WHERE is_active)::int AS merchants_active,
      (SELECT COUNT(*) FROM contract.merchant_revenue)::int                  AS transactions,
      (SELECT COALESCE(SUM(total_amount), 0) FROM contract.merchant_revenue) AS gross_revenue,
      (SELECT COALESCE(SUM(total_amount-net_tax_amount-cogs_amount),0) FROM contract.merchant_revenue) AS gross_profit,
      (SELECT COUNT(*) FROM contract.admin_activity_log)::int                      AS activity_events,
      (SELECT COUNT(*) FROM contract.admin_activity_log
        WHERE severity IN ('WARNING','CRITICAL'))::int                       AS activity_problems,
      (SELECT COUNT(DISTINCT business_sector) FROM contract.merchant_directory)::int AS sectors_in_use
  `);
  return rows[0];
}
async function dailyRevenue(db, days = 30) {
  const n = Math.min(Math.max(Math.trunc(Number(days) || 30), 1), 180);
  const { rows } = await db.query(
    `SELECT business_sector, sales_date, transaction_count::int, gross_revenue, active_merchants::int
       FROM contract.admin_daily_sector_revenue
      WHERE sales_date >= (CURRENT_DATE - ($1::int - 1))
      ORDER BY sales_date, business_sector`,
    [n]
  );
  return rows;
}
async function merchantDirectory(db, f = {}, financialDetail = true) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `d.business_sector = ${p}`, c.sector);
  w.add((p) => `d.merchant_name ILIKE ${p}`, c.search ? `%${c.search}%` : null);
  const { rows } = await db.query(
    `SELECT d.*, h.churn_risk_score, h.days_since_last_txn,s.status AS raw_status,s.plan_id,s.current_period_end,s.grace_period_end,
       r.transaction_count,r.gross_revenue,r.last_transaction_at,
       (SELECT count(*)::int FROM internal.outlets WHERE merchant_id=d.merchant_id AND is_active) AS outlet_count,
       (SELECT COALESCE(sum(total_amount-net_tax_amount-cogs_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id AND tenant_id=d.tenant_id) AS gross_profit
       FROM contract.merchant_directory d
       LEFT JOIN contract.merchant_health_latest h ON h.merchant_id = d.merchant_id
       LEFT JOIN billing.subscriptions s ON s.tenant_id=d.tenant_id
       LEFT JOIN LATERAL (SELECT count(*)::int AS transaction_count,COALESCE(sum(total_amount),0) AS gross_revenue,max(created_at) AS last_transaction_at
         FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) r ON true
       ${w.sql()}
      ORDER BY d.merchant_name,d.merchant_id
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );
  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.merchant_directory d ${w.sql()}`,
    w.params
  );
  return {
    rows: rows.map(withSubscription).map((r) => financialDetail ? r : {
      merchant_id: r.merchant_id,
      merchant_name: r.merchant_name,
      business_sector: r.business_sector,
      is_active: r.is_active,
      joined_at: r.joined_at,
      subscription_status: r.subscription_status,
      access_mode: r.access_mode,
      plan_name: r.plan_name,
      churn_risk_score: r.churn_risk_score,
      days_since_last_txn: r.days_since_last_txn
    }),
    financialDetail,
    total: cnt[0]?.total ?? 0,
    limit: c.limit,
    offset: c.offset
  };
}
async function merchantDetail(db, merchantId) {
  if (!UUID_RE.test(merchantId)) return null;
  const [profile, bySector, health, topProducts, customerStats] = await Promise.all([
    db.query(`SELECT d.*,s.status AS raw_status,s.plan_id,s.current_period_end,s.grace_period_end,
      (SELECT COALESCE(sum(cogs_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS cogs,
      (SELECT COALESCE(sum(total_amount-net_tax_amount-cogs_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS gross_profit,
      (SELECT COALESCE(sum(net_discount_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS discount_amount,
      (SELECT COALESCE(sum(net_tax_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS tax_amount
      FROM contract.merchant_directory d LEFT JOIN billing.subscriptions s ON s.tenant_id=d.tenant_id WHERE d.merchant_id = $1`, [merchantId]),
    // Satu merchant bisa menjalankan lebih dari satu sektor.
    db.query(
      `SELECT business_sector,
              COUNT(*)::int                     AS transaction_count,
              COALESCE(SUM(total_amount), 0)    AS gross_revenue,
              COALESCE(AVG(total_amount), 0)    AS avg_basket,
              MAX(created_at)                   AS last_transaction_at
         FROM contract.merchant_revenue
        WHERE merchant_id = $1
        GROUP BY business_sector
        ORDER BY gross_revenue DESC`,
      [merchantId]
    ),
    db.query(`SELECT * FROM contract.merchant_health_latest WHERE merchant_id = $1`, [merchantId]),
    db.query(
      `SELECT business_sector, product_name, category_name,
              units_sold_exact AS units_sold, revenue, gross_profit, last_sold_at
         FROM contract.admin_product_sales
        WHERE merchant_id = $1
        ORDER BY revenue DESC
        LIMIT 15`,
      [merchantId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS customer_count
         FROM pos.customers
        WHERE merchant_id = $1 AND archived_at IS NULL`,
      [merchantId]
    ).catch(() => ({ rows: [{ customer_count: 0, total_customer_spent: 0 }] }))
  ]);
  if (!profile.rows.length) return null;
  return {
    profile: {
      ...withSubscription(profile.rows[0]),
      gross_revenue: bySector.rows.reduce((sum, r) => sum + Number(r.gross_revenue), 0),
      transaction_count: bySector.rows.reduce((sum, r) => sum + Number(r.transaction_count), 0),
      customer_count: Number(customerStats.rows[0]?.customer_count || 0)
    },
    sectors: bySector.rows,
    health: health.rows[0] ?? null,
    topProducts: topProducts.rows
  };
}
var TransactionFilterError = class extends Error {
};
function transactionFilter(f) {
  for (const field of ["tenantId", "merchantId", "outletId"]) {
    const value = f[field];
    if (value !== void 0 && value !== "" && (typeof value !== "string" || !UUID_RE.test(value))) {
      throw new TransactionFilterError("INVALID_ID");
    }
  }
  for (const field of ["from", "to"]) {
    const value = f[field];
    if (value === void 0 || value === "") continue;
    if (typeof value !== "string" || !DATE_RE.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new TransactionFilterError("INVALID_DATE");
    }
  }
  if (f.from && f.to && String(f.from) > String(f.to)) throw new TransactionFilterError("INVALID_DATE_RANGE");
  if (f.timezone !== void 0 && f.timezone !== "") {
    if (typeof f.timezone !== "string" || f.timezone.length > 80) throw new TransactionFilterError("INVALID_TIMEZONE");
    try {
      new Intl.DateTimeFormat("en", { timeZone: f.timezone }).format();
    } catch {
      throw new TransactionFilterError("INVALID_TIMEZONE");
    }
  }
  return cleanFilter(f);
}
async function transactionLog(db, f = {}) {
  const c = transactionFilter(f);
  let timezone = typeof f.timezone === "string" && f.timezone ? f.timezone : "Asia/Jakarta";
  if (!f.timezone && c.merchantId) {
    const settings = await db.query("SELECT timezone FROM internal.merchant_settings WHERE merchant_id=$1", [c.merchantId]);
    timezone = settings.rows[0]?.timezone || timezone;
  }
  const w = new Where();
  w.add((p) => `x.business_sector = ${p}`, c.sector);
  w.add((p) => `x.tenant_id = ${p}::uuid`, f.tenantId || null);
  w.add((p) => `x.merchant_id = ${p}::uuid`, c.merchantId);
  w.add((p) => `x.outlet_id = ${p}::uuid`, f.outletId || null);
  w.add((p) => `x.app_module = ${p}`, c.module);
  const zoneParam = w.next();
  w.params.push(timezone);
  w.add((p) => `x.created_at >= (${p}::date::timestamp AT TIME ZONE ${zoneParam})`, c.from);
  w.add((p) => `x.created_at < ((${p}::date + 1)::timestamp AT TIME ZONE ${zoneParam})`, c.to);
  w.add((p) => `(x.invoice_number ILIKE ${p} OR x.merchant_name ILIKE ${p})`, c.search ? `%${c.search}%` : null);
  const { rows: result } = await db.query(
    `WITH filtered AS (
       SELECT x.*, COALESCE(r.total_amount,0) AS revenue_amount,
              COALESCE(r.refund_amount,rf.amount,0) AS refund_amount,
              (r.id IS NOT NULL) AS included_in_revenue
         FROM contract.transaction_log x
         LEFT JOIN contract.merchant_revenue r ON r.id=x.id AND r.tenant_id=x.tenant_id
         LEFT JOIN contract.refund_totals rf ON rf.transaction_id=x.id AND rf.tenant_id=x.tenant_id
         ${w.sql()}
     ), page AS (
       SELECT * FROM filtered ORDER BY created_at DESC,id DESC
       LIMIT ${w.next()} OFFSET $${w.params.length + 2}
     )
     SELECT COUNT(*)::int AS total,
            COALESCE(SUM(total_amount),0) AS audit_amount,
            COALESCE(SUM(revenue_amount),0) AS revenue_amount,
            COUNT(*) FILTER (WHERE included_in_revenue)::int AS revenue_count,
            COUNT(*) FILTER (WHERE order_status IN ('COMPLETED','SETTLED'))::int AS completed_count,
            COUNT(*) FILTER (WHERE order_status IN ('VOID','VOIDED'))::int AS voided_count,
            COUNT(*) FILTER (WHERE order_status IN ('CANCELLED','CANCELED'))::int AS cancelled_count,
            COUNT(*) FILTER (WHERE refund_amount>0 OR order_status='REFUNDED' OR payment_status='REFUNDED')::int AS refunded_count,
            COALESCE(SUM(refund_amount),0) AS refund_amount,
            COALESCE(SUM(total_amount) FILTER (WHERE order_status IN ('VOID','VOIDED','CANCELLED','CANCELED')),0) AS void_cancelled_amount,
            COALESCE((SELECT json_agg(page) FROM page),'[]'::json) AS rows,
            ${zoneParam}::text AS timezone
       FROM filtered`,
    [...w.params, c.limit, c.offset]
  );
  const agg = result[0];
  return {
    rows: agg.rows,
    total: Number(agg.total),
    // Backwards-compatible alias now means valid revenue, never all audit rows.
    sumAmount: Number(agg.revenue_amount),
    revenueAmount: Number(agg.revenue_amount),
    auditAmount: Number(agg.audit_amount),
    refundAmount: Number(agg.refund_amount),
    voidCancelledAmount: Number(agg.void_cancelled_amount),
    counts: {
      revenue: Number(agg.revenue_count),
      completed: Number(agg.completed_count),
      voided: Number(agg.voided_count),
      cancelled: Number(agg.cancelled_count),
      refunded: Number(agg.refunded_count)
    },
    timezone,
    source: "contract.merchant_revenue",
    limit: c.limit,
    offset: c.offset
  };
}
async function transactionDetail(db, id, merchantId = null) {
  if (!UUID_RE.test(id)) return null;
  const head = await db.query(
    `SELECT x.*,COALESCE(r.total_amount,0) AS revenue_amount,COALESCE(r.refund_amount,0) AS refund_amount,
            (r.id IS NOT NULL) AS included_in_revenue
       FROM contract.transaction_log x
       LEFT JOIN contract.merchant_revenue r ON r.id=x.id AND r.tenant_id=x.tenant_id
      WHERE x.id = $1 AND ($2::uuid IS NULL OR x.merchant_id=$2)`,
    [id, merchantId]
  );
  if (!head.rows.length) return null;
  const items = await db.query(
    `SELECT v.product_name,v.variant_name,v.modifier_snapshot,v.category_name,v.business_sector,v.quantity_exact AS quantity,
            v.unit_price,v.unit_cost,v.total_price,v.gross_profit
       FROM contract.transaction_items_detailed v
       WHERE v.transaction_id = $1 ORDER BY v.product_name`,
    [id]
  );
  return { transaction: head.rows[0], items: items.rows };
}
async function productSales(db, f = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `v.business_sector = ${p}`, c.sector);
  w.add((p) => `v.merchant_id = ${p}::uuid`, c.merchantId);
  w.add(
    (p) => `(v.product_name ILIKE ${p} OR v.product_description ILIKE ${p})`,
    c.search ? `%${c.search}%` : null
  );
  const { rows } = await db.query(
    `SELECT v.business_sector, v.merchant_id, v.merchant_name, v.product_name,
            v.product_description, v.category_name, v.units_sold_exact AS units_sold, v.revenue,
            v.cogs, v.gross_profit, v.appeared_in_transactions::int, v.last_sold_at
       FROM contract.admin_product_sales v
       ${w.sql()}
      ORDER BY v.revenue DESC
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );
  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.admin_product_sales v ${w.sql()}`,
    w.params
  );
  return { rows, total: cnt[0]?.total ?? 0, limit: c.limit, offset: c.offset };
}
async function catalog(db, f = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `v.business_sector = ${p}`, c.sector);
  w.add((p) => `v.merchant_id = ${p}::uuid`, c.merchantId);
  w.add(
    (p) => `(v.product_name ILIKE ${p} OR v.description ILIKE ${p} OR v.sku ILIKE ${p})`,
    c.search ? `%${c.search}%` : null
  );
  const { rows } = await db.query(
    `SELECT v.business_sector, v.merchant_id, v.merchant_name, v.product_id,
            v.product_name, v.sku, v.category_name, v.description,
            v.price, v.cost_price, v.margin_pct, v.stock, v.min_stock_alert,
            v.is_low_stock, v.is_available, v.catalog_synced_at,
            v.units_sold::int, v.revenue, v.last_sold_at
       FROM contract.catalog v
       ${w.sql()}
      ORDER BY v.units_sold ASC, v.product_name
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );
  const { rows: agg } = await db.query(
    `SELECT COUNT(*)::int                                        AS total,
            COUNT(*) FILTER (WHERE units_sold = 0)::int          AS never_sold,
            COUNT(*) FILTER (WHERE is_low_stock)::int            AS low_stock,
            COUNT(*) FILTER (WHERE NOT is_available)::int        AS retired
       FROM contract.catalog v ${w.sql()}`,
    w.params
  );
  return {
    rows,
    total: agg[0]?.total ?? 0,
    neverSold: agg[0]?.never_sold ?? 0,
    lowStock: agg[0]?.low_stock ?? 0,
    retired: agg[0]?.retired ?? 0,
    limit: c.limit,
    offset: c.offset
  };
}
async function activityLog(db, f = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `a.business_sector = ${p}`, c.sector);
  w.add((p) => `a.merchant_id = ${p}::uuid`, c.merchantId);
  w.add((p) => `a.app_module = ${p}`, c.module);
  w.add((p) => `a.severity = ${p}`, c.severity);
  w.add((p) => `a.occurred_at >= ${p}::date`, c.from);
  w.add((p) => `a.occurred_at < (${p}::date + 1)`, c.to);
  w.add((p) => `(a.summary ILIKE ${p} OR a.event_type ILIKE ${p})`, c.search ? `%${c.search}%` : null);
  const { rows } = await db.query(
    `SELECT a.id, a.business_sector, a.business_id, a.app_module, a.event_type,
            a.severity, a.actor_name, a.actor_role, a.amount_idr, a.summary,
            a.detail, a.occurred_at, a.transaction_id,
            a.merchant_name, a.merchant_id
       FROM contract.admin_activity_log a
       ${w.sql()}
      ORDER BY a.occurred_at DESC
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );
  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.admin_activity_log a ${w.sql()}`,
    w.params
  );
  return { rows, total: cnt[0]?.total ?? 0, limit: c.limit, offset: c.offset };
}
async function activityBreakdown(db, merchantId = null) {
  const { rows } = await db.query(
    `SELECT business_sector, app_module, event_type, severity,
            count(*)::int AS event_count,count(DISTINCT merchant_id)::int AS merchants_affected,max(occurred_at) AS last_seen_at
       FROM contract.admin_activity_log WHERE ($1::uuid IS NULL OR merchant_id=$1)
       GROUP BY business_sector,app_module,event_type,severity ORDER BY event_count DESC`,
    [merchantId]
  );
  return rows;
}

// src/server/adminRoutes.ts
async function recordAccess(db, who, action, resource, merchantId, justification, ip, req) {
  await db.query(
    `INSERT INTO internal.internal_access_log
    (id,internal_user_id,internal_role,target_id,action,resource,justification,ip_address,request_id,user_agent)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [who.id, who.role, merchantId, action, resource, justification, ip, req.auditRequestId, String(req.headers["user-agent"] || "").slice(0, 512)]
  );
}
function registerAdminRoutes(app, getDb, authenticate = authenticateBearer, supportProvider, blogMediaProvider) {
  registerBlogRoutes(app, getDb);
  app.use("/api/admin", (req, res, next) => {
    const forwarded = String(req.headers["x-request-id"] || "");
    const trusted = process.env.INTERNAL_GATEWAY_TOKEN && req.headers["x-newhope-gateway-token"] === process.env.INTERNAL_GATEWAY_TOKEN;
    req.auditRequestId = trusted && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forwarded) ? forwarded : randomUUID7();
    res.setHeader("X-Request-ID", req.auditRequestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  function guard(capability, enrollmentOnly = false) {
    return async (req, res, next) => {
      try {
        const principal = await authenticate(req);
        if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "AUTHENTICATION_REQUIRED" });
        const db = await getDb();
        let { rows } = await db.query("SELECT id,email,full_name,role FROM internal.internal_users WHERE sso_subject=$1 AND is_active", [principal.subject]);
        if (!rows[0] && principal.email) {
          if (!principal.isEmailVerified) {
            return res.status(403).json({
              ok: false,
              error: "EMAIL_VERIFICATION_REQUIRED",
              detail: "Email akun SSO harus diverifikasi terlebih dahulu sebelum dapat ditautkan ke akun administrator."
            });
          }
          const byEmail = await db.query(
            "SELECT id,email,full_name,role FROM internal.internal_users WHERE LOWER(email)=LOWER($1) AND is_active AND sso_subject IS NULL",
            [principal.email]
          );
          if (byEmail.rows[0] && isInternalRole(byEmail.rows[0].role)) {
            await db.query(
              "UPDATE internal.internal_users SET sso_subject=$1, updated_at=NOW() WHERE id=$2 AND sso_subject IS NULL",
              [principal.subject, byEmail.rows[0].id]
            );
            rows = byEmail.rows;
          } else {
            try {
              const fromPublic = await db.query(
                "SELECT id,email,full_name,role FROM public.admin_users WHERE LOWER(email)=LOWER($1) AND is_active",
                [principal.email]
              );
              if (fromPublic.rows[0] && isInternalRole(fromPublic.rows[0].role)) {
                const inserted = await db.query(
                  `INSERT INTO internal.internal_users (id, email, full_name, role, sso_subject, is_active)
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
                   ON CONFLICT (email) DO NOTHING
                   RETURNING id, email, full_name, role`,
                  [principal.email, fromPublic.rows[0].full_name || "Administrator", fromPublic.rows[0].role, principal.subject]
                );
                rows = inserted.rows;
              }
            } catch (error) {
              if (!["42P01", "42703"].includes(String(error.code))) throw error;
            }
          }
        }
        if (!rows[0] || !isInternalRole(rows[0].role)) {
          return res.status(403).json({
            ok: false,
            error: "INTERNAL_MEMBERSHIP_REQUIRED",
            detail: "Akun terdaftar, namun belum memiliki hak akses Administrator (ROLE_SUPERADMIN) di sistem internal."
          });
        }
        const who = { id: rows[0].id, email: rows[0].email, fullName: rows[0].full_name, role: rows[0].role };
        req.mfaRequired = principal.aal !== "aal2";
        const securityError = adminSecurityError(principal, req.method);
        if (!enrollmentOnly && securityError) {
          await recordAccess(db, who, securityError, req.path, null, null, req.ip || null, req);
          return res.status(403).json({ ok: false, error: securityError, requestId: req.auditRequestId });
        }
        const uuid2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const value of [req.params.merchantId, req.params.tenantId, req.query.merchantId]) {
          if (value !== void 0 && (typeof value !== "string" || !uuid2.test(value))) return res.status(400).json({ ok: false, error: "INVALID_ID" });
        }
        const target = String(req.params.merchantId || req.params.tenantId || req.query.merchantId || "") || null;
        const reason = String(req.headers["x-justification"] || req.body?.reason || req.query.justification || "").trim() || null;
        if (!hasInternalCapability(who.role, capability)) {
          await recordAccess(db, who, "DENIED_" + capability, req.path, target, reason, req.ip || null, req);
          return res.status(403).json({ ok: false, error: "CAPABILITY_DENIED" });
        }
        if (who.role === "ROLE_INTERNAL_SUPPORT" && requiresAudit(capability) && (!target || !reason || reason.length < 10)) {
          await recordAccess(db, who, "BLOCKED_" + capability, req.path, target, reason, req.ip || null, req);
          return res.status(400).json({ ok: false, error: "MERCHANT_AND_JUSTIFICATION_REQUIRED" });
        }
        if (requiresAudit(capability)) await recordAccess(db, who, capability, req.path, target, reason, req.ip || null, req);
        req.internal = who;
        req.adminPrincipal = principal;
        req.environment = "PROVIDER_BO";
        next();
      } catch (err) {
        if (err instanceof AuthUnavailableError) return res.status(503).json({ ok: false, error: "AUTH_UNAVAILABLE" });
        next(err);
      }
    };
  }
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res, await getDb());
    } catch (err) {
      console.error(`[admin] ${req.method} ${req.path}:`, err.message);
      res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
    }
  };
  app.get("/api/admin/me", guard("VIEW_MERCHANT_HEALTH", true), (req, res) => {
    res.json({ ok: true, user: req.internal, capabilities: internalCapabilities(req.internal.role), environment: "PROVIDER_BO", mfaRequired: req.mfaRequired });
  });
  app.get("/api/admin/identities", guard("VIEW_ACCESS_AUDIT"), wrap(async (_req, res, db) => {
    const { rows } = await db.query("SELECT email,full_name,role FROM internal.internal_users WHERE is_active ORDER BY role");
    res.json({ ok: true, identities: rows });
  }));
  app.put("/api/admin/identities/:email/role", guard("VIEW_ACCESS_AUDIT"), wrap(async (req, res, db) => {
    if (req.internal.role !== "ROLE_SUPERADMIN") {
      return res.status(403).json({ ok: false, error: "FORBIDDEN", detail: "Hanya Superadmin yang memiliki hak mengubah wewenang/role pengguna." });
    }
    const email = req.params.email;
    const { role } = req.body || {};
    if (!role || !isInternalRole(role)) {
      return res.status(400).json({ ok: false, error: "INVALID_ROLE", detail: "Role internal tidak valid." });
    }
    if (role !== "ROLE_SUPERADMIN") {
      const superadmins = await db.query(
        "SELECT id FROM internal.internal_users WHERE role = 'ROLE_SUPERADMIN' AND is_active AND LOWER(email) != LOWER($1)",
        [email]
      );
      if (superadmins.rows.length === 0) {
        return res.status(400).json({ ok: false, error: "LAST_SUPERADMIN", detail: "Tidak dapat mengubah role Superadmin terakhir pada sistem." });
      }
    }
    const updated = await db.query(
      "UPDATE internal.internal_users SET role = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2) RETURNING id, email, full_name, role",
      [role, email]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND", detail: "Pengguna internal tidak ditemukan." });
    }
    res.json({ ok: true, message: `Role pengguna ${email} berhasil diubah menjadi ${role}`, user: updated.rows[0] });
  }));
  app.post("/api/admin/identities", guard("VIEW_ACCESS_AUDIT"), wrap(async (req, res, db) => {
    if (req.internal.role !== "ROLE_SUPERADMIN") {
      return res.status(403).json({ ok: false, error: "FORBIDDEN", detail: "Hanya Superadmin yang memiliki hak mendaftarkan operator internal baru." });
    }
    const { email, fullName, role } = req.body || {};
    if (!email || !fullName || !isInternalRole(role)) {
      return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD", detail: "Email, nama lengkap, dan role internal wajib diisi." });
    }
    const inserted = await db.query(
      `INSERT INTO internal.internal_users (id, email, full_name, role, is_active)
       VALUES (gen_random_uuid(), LOWER($1), $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true, updated_at = NOW()
       RETURNING id, email, full_name, role`,
      [email.trim(), fullName.trim(), role]
    );
    res.json({ ok: true, message: `Pengguna internal ${email} berhasil ditambahkan sebagai ${role}`, user: inserted.rows[0] });
  }));
  registerSubscriptionAdminRoutes(app, getDb, guard, wrap);
  registerClientSupportRoutes(app, getDb, guard, supportProvider);
  registerPrivacySupport(app, getDb, guard);
  registerAdminIntegrationRoutes(app, getDb, guard);
  registerBlogMediaRoutes(app, guard, blogMediaProvider);
  app.get("/api/admin/staff-commissions", guard("VIEW_TRANSACTION_LOG"), wrap(async (req, res, db) => {
    const f = cleanFilter(req.query);
    const { rows } = await db.query(`SELECT * FROM contract.staff_commission_ledger
      WHERE ($1::text IS NULL OR business_sector=$1) AND ($2::uuid IS NULL OR merchant_id=$2)
      AND ($3::text IS NULL OR staff_name ILIKE '%'||$3||'%' OR merchant_name ILIKE '%'||$3||'%')
      ORDER BY created_at DESC LIMIT 200`, [f.sector, f.merchantId, f.search]);
    res.json({ ok: true, rows });
  }));
  app.get(
    "/api/admin/overview",
    guard("VIEW_SECTOR_ANALYTICS"),
    wrap(async (_req, res, db) => {
      const [sectors4, totals, daily] = await Promise.all([
        sectorSummary(db),
        platformTotals(db),
        dailyRevenue(db, 30)
      ]);
      res.json({ ok: true, sectors: sectors4, totals, daily, sectorLabels: SECTOR_LABEL });
    })
  );
  app.get(
    "/api/admin/merchants",
    guard("VIEW_MERCHANT_HEALTH"),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...await merchantDirectory(db, req.query, req.internal.role === "ROLE_SUPERADMIN") });
    })
  );
  app.get(
    "/api/admin/merchants/:merchantId",
    guard("VIEW_MERCHANT_DETAIL"),
    wrap(async (req, res, db) => {
      const detail = await merchantDetail(db, req.params.merchantId);
      if (!detail) return res.status(404).json({ ok: false, error: "MERCHANT_NOT_FOUND" });
      res.json({ ok: true, ...detail });
    })
  );
  app.get(
    "/api/admin/transactions",
    guard("VIEW_TRANSACTION_LOG"),
    wrap(async (req, res, db) => {
      try {
        res.json({ ok: true, ...await transactionLog(db, req.query) });
      } catch (err) {
        if (err instanceof TransactionFilterError) return res.status(400).json({ ok: false, error: err.message });
        throw err;
      }
    })
  );
  app.get(
    "/api/admin/transactions/:id",
    guard("VIEW_TRANSACTION_LOG"),
    wrap(async (req, res, db) => {
      const detail = await transactionDetail(db, req.params.id, cleanFilter(req.query).merchantId);
      if (!detail) return res.status(404).json({ ok: false, error: "TRANSACTION_NOT_FOUND" });
      res.json({ ok: true, ...detail });
    })
  );
  app.get(
    "/api/admin/products",
    guard("VIEW_PRODUCT_SALES"),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...await productSales(db, req.query) });
    })
  );
  app.get(
    "/api/admin/catalog",
    guard("VIEW_PRODUCT_SALES"),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...await catalog(db, req.query) });
    })
  );
  app.get(
    "/api/admin/raw-materials",
    guard("VIEW_PRODUCT_SALES"),
    wrap(async (req, res, db) => {
      try {
        const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
        let q = `SELECT id, name, sku, category, unit, cost_per_unit, current_stock, minimum_stock_alert, is_active, updated_at
                   FROM pos.inventory_items`;
        const params = [];
        if (search) {
          params.push(search);
          q += ` WHERE name ILIKE $1 OR sku ILIKE $1 OR category ILIKE $1`;
        }
        q += ` ORDER BY name ASC LIMIT 200`;
        const { rows } = await db.query(q, params);
        res.json({ ok: true, rows, total: rows.length });
      } catch {
        res.json({ ok: true, rows: [], total: 0 });
      }
    })
  );
  app.get(
    "/api/admin/bundles",
    guard("VIEW_PRODUCT_SALES"),
    wrap(async (req, res, db) => {
      try {
        const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
        let q = `SELECT p.id, p.name, p.sku, p.price, p.cost_price, p.is_available, p.offering_type,
                        p.category_name
                   FROM pos.products p
                  WHERE p.offering_type = 'BUNDLE'`;
        const params = [];
        if (search) {
          params.push(search);
          q += ` AND (p.name ILIKE $1 OR p.sku ILIKE $1)`;
        }
        q += ` ORDER BY p.name ASC LIMIT 200`;
        const { rows } = await db.query(q, params);
        res.json({ ok: true, rows, total: rows.length });
      } catch {
        res.json({ ok: true, rows: [], total: 0 });
      }
    })
  );
  app.get(
    "/api/admin/recipes",
    guard("VIEW_PRODUCT_SALES"),
    wrap(async (_req, res, db) => {
      try {
        const { rows } = await db.query(
          `SELECT r.id, r.merchant_id, r.output_product_id, p.name AS output_product_name,
                  r.output_quantity, r.notes,
                  COALESCE(
                    json_agg(
                      json_build_object(
                        'item_id', ri.inventory_item_id,
                        'item_name', ii.name,
                        'quantity', ri.quantity_required,
                        'unit', ii.unit
                      )
                    ) FILTER (WHERE ri.id IS NOT NULL), '[]'::json
                  ) AS ingredients
             FROM pos.recipes r
             LEFT JOIN pos.products p ON p.id = r.output_product_id
             LEFT JOIN pos.recipe_items ri ON ri.recipe_id = r.id
             LEFT JOIN pos.inventory_items ii ON ii.id = ri.inventory_item_id
            GROUP BY r.id, r.merchant_id, r.output_product_id, p.name, r.output_quantity, r.notes
            ORDER BY p.name ASC
            LIMIT 200`
        );
        res.json({ ok: true, rows, total: rows.length });
      } catch {
        res.json({ ok: true, rows: [], total: 0 });
      }
    })
  );
  app.get(
    "/api/admin/activity",
    guard("VIEW_ACTIVITY_LOG"),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...await activityLog(db, req.query) });
    })
  );
  app.get(
    "/api/admin/activity/breakdown",
    guard("VIEW_ACTIVITY_LOG"),
    wrap(async (req, res, db) => {
      res.json({ ok: true, rows: await activityBreakdown(db, cleanFilter(req.query).merchantId) });
    })
  );
  app.get(
    "/api/admin/access-audit",
    guard("VIEW_ACCESS_AUDIT"),
    wrap(async (_req, res, db) => {
      const { rows } = await db.query(
        `SELECT l.id, l.internal_role, l.action, l.resource, l.justification,
                l.accessed_at,l.request_id,l.user_agent,l.ip_address, u.email AS internal_email, u.full_name AS internal_name,
                t.name AS merchant_name
           FROM internal.internal_access_log l
           JOIN internal.internal_users u ON u.id = l.internal_user_id
           LEFT JOIN internal.tenants t ON t.id::text = COALESCE(l.target_id,l.merchant_id::text)
          ORDER BY l.accessed_at DESC
          LIMIT 200`
      );
      res.json({ ok: true, rows });
    })
  );
  function rowToBlogPost(r) {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt || "",
      content: r.content,
      category: r.category,
      coverImage: r.cover_image || "",
      author: {
        name: r.author_name || "Tim Editorial New Hope POS",
        role: r.author_role || "Business Consultant",
        avatar: r.author_avatar || ""
      },
      readingTimeMinutes: Number(r.reading_time_minutes || 5),
      tags: Array.isArray(r.tags) ? r.tags : [],
      mediaEmbeds: Array.isArray(r.media_embeds) ? r.media_embeds : typeof r.media_embeds === "string" ? JSON.parse(r.media_embeds) : [],
      seo: r.seo && typeof r.seo === "object" ? r.seo : typeof r.seo === "string" ? JSON.parse(r.seo) : {},
      isPublished: Boolean(r.is_published),
      isFeatured: Boolean(r.is_featured),
      viewCount: Number(r.view_count || 0),
      likesCount: Number(r.likes_count || 0),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  app.get(
    "/api/v1/blog",
    wrap(async (req, res, db) => {
      const category = req.query.category ? String(req.query.category).trim() : null;
      let query = `SELECT id, slug, title, excerpt, content, category, cover_image,
                          author_name, author_role, author_avatar, reading_time_minutes,
                          tags, media_embeds, seo, is_published, is_featured, view_count, likes_count,
                          created_at, updated_at
                     FROM public.blog_posts
                    WHERE is_published = true`;
      const params = [];
      if (category && category !== "Semua Kategori" && category !== "ALL") {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      query += ` ORDER BY is_featured DESC, created_at DESC`;
      const { rows } = await db.query(query, params);
      res.json({ ok: true, posts: rows.map(rowToBlogPost) });
    })
  );
  app.get(
    "/api/v1/blog/:slug",
    wrap(async (req, res, db) => {
      const slug = String(req.params.slug).trim();
      const { rows } = await db.query(
        `SELECT id, slug, title, excerpt, content, category, cover_image,
                author_name, author_role, author_avatar, reading_time_minutes,
                tags, media_embeds, seo, is_published, is_featured, view_count, likes_count,
                created_at, updated_at
           FROM public.blog_posts
          WHERE slug = $1 AND is_published = true`,
        [slug]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: "POST_NOT_FOUND" });
      if (req.method !== "HEAD" && blogViewTrackingEnabled()) void db.query(`UPDATE public.blog_posts SET view_count = view_count + 1 WHERE id = $1`, [rows[0].id]).catch(() => {
      });
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );
  const likeWindow = /* @__PURE__ */ new Map();
  app.post(
    "/api/v1/blog/:id/like",
    wrap(async (req, res, db) => {
      const client = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
      const now = Date.now(), entry = likeWindow.get(client);
      if (!entry || entry.resetAt < now) likeWindow.set(client, { count: 1, resetAt: now + 36e5 });
      else if (++entry.count > 30) return res.status(429).json({ ok: false, error: "TOO_MANY_LIKES" });
      if (likeWindow.size > 1e4) {
        for (const [key, value] of likeWindow) if (value.resetAt < now) likeWindow.delete(key);
      }
      const id = String(req.params.id).trim();
      const { rows } = await db.query(
        `UPDATE public.blog_posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: "POST_NOT_FOUND" });
      res.json({ ok: true, likesCount: Number(rows[0].likes_count) });
    })
  );
  app.get(
    "/api/admin/blog",
    guard("VIEW_SECTOR_ANALYTICS"),
    wrap(async (_req, res, db) => {
      const { rows } = await db.query(
        `SELECT id, slug, title, excerpt, content, category, cover_image,
                author_name, author_role, author_avatar, reading_time_minutes,
                tags, media_embeds, seo, is_published, is_featured, view_count, likes_count,
                created_at, updated_at
           FROM public.blog_posts
          ORDER BY created_at DESC`
      );
      res.json({ ok: true, posts: rows.map(rowToBlogPost) });
    })
  );
  app.post(
    "/api/admin/blog",
    guard("VIEW_SECTOR_ANALYTICS"),
    wrap(async (req, res, db) => {
      const b = req.body || {};
      const id = b.id ? String(b.id) : "blog-" + randomUUID7();
      const slug = String(b.slug || "").trim();
      const title = String(b.title || "").trim();
      if (!slug || !title) return res.status(400).json({ ok: false, error: "TITLE_AND_SLUG_REQUIRED" });
      const previous = (await db.query("SELECT slug, is_published FROM public.blog_posts WHERE slug = $1", [slug])).rows[0];
      const author = b.author || {};
      const { rows } = await db.query(
        `INSERT INTO public.blog_posts (
           id, slug, title, excerpt, content, category, cover_image,
           author_name, author_role, author_avatar, reading_time_minutes,
           tags, media_embeds, seo, is_published, is_featured,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13::jsonb, $14::jsonb, $15, $16,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           excerpt = EXCLUDED.excerpt,
           content = EXCLUDED.content,
           category = EXCLUDED.category,
           cover_image = EXCLUDED.cover_image,
           author_name = EXCLUDED.author_name,
           author_role = EXCLUDED.author_role,
           author_avatar = EXCLUDED.author_avatar,
           reading_time_minutes = EXCLUDED.reading_time_minutes,
           tags = EXCLUDED.tags,
           media_embeds = EXCLUDED.media_embeds,
           seo = EXCLUDED.seo,
           is_published = EXCLUDED.is_published,
           is_featured = EXCLUDED.is_featured,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          id,
          slug,
          title,
          String(b.excerpt || "").trim(),
          String(b.content || "").trim(),
          String(b.category || "Tips Bisnis & Strategi"),
          String(b.coverImage || ""),
          String(author.name || "Tim Editorial New Hope POS"),
          String(author.role || "Business Consultant"),
          String(author.avatar || ""),
          Number(b.readingTimeMinutes) || 5,
          Array.isArray(b.tags) ? b.tags : [],
          JSON.stringify(Array.isArray(b.mediaEmbeds) ? b.mediaEmbeds : []),
          JSON.stringify(b.seo && typeof b.seo === "object" ? b.seo : {}),
          b.isPublished !== false,
          Boolean(b.isFeatured)
        ]
      );
      await notifyBlogDiscovery([...previous?.is_published ? [previous.slug] : [], ...rows[0].is_published ? [rows[0].slug] : []]);
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );
  app.put(
    "/api/admin/blog/:id",
    guard("VIEW_SECTOR_ANALYTICS"),
    wrap(async (req, res, db) => {
      const id = String(req.params.id);
      const b = req.body || {};
      const previous = (await db.query("SELECT slug, is_published FROM public.blog_posts WHERE id = $1", [id])).rows[0];
      const author = b.author || {};
      const { rows } = await db.query(
        `UPDATE public.blog_posts
            SET slug = COALESCE($2, slug),
                title = COALESCE($3, title),
                excerpt = COALESCE($4, excerpt),
                content = COALESCE($5, content),
                category = COALESCE($6, category),
                cover_image = COALESCE($7, cover_image),
                author_name = COALESCE($8, author_name),
                author_role = COALESCE($9, author_role),
                author_avatar = COALESCE($10, author_avatar),
                reading_time_minutes = COALESCE($11, reading_time_minutes),
                tags = COALESCE($12, tags),
                media_embeds = COALESCE($13::jsonb, media_embeds),
                seo = CASE WHEN $14::jsonb IS NULL THEN seo ELSE COALESCE(seo, '{}'::jsonb) || $14::jsonb END,
                is_published = COALESCE($15, is_published),
                is_featured = COALESCE($16, is_featured),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *`,
        [
          id,
          b.slug ? String(b.slug).trim() : null,
          b.title ? String(b.title).trim() : null,
          b.excerpt !== void 0 ? String(b.excerpt).trim() : null,
          b.content !== void 0 ? String(b.content).trim() : null,
          b.category ? String(b.category) : null,
          b.coverImage !== void 0 ? String(b.coverImage) : null,
          author.name !== void 0 ? String(author.name) : null,
          author.role !== void 0 ? String(author.role) : null,
          author.avatar !== void 0 ? String(author.avatar) : null,
          b.readingTimeMinutes !== void 0 ? Number(b.readingTimeMinutes) : null,
          Array.isArray(b.tags) ? b.tags : null,
          b.mediaEmbeds !== void 0 ? JSON.stringify(b.mediaEmbeds) : null,
          b.seo !== void 0 ? JSON.stringify(b.seo) : null,
          b.isPublished !== void 0 ? Boolean(b.isPublished) : null,
          b.isFeatured !== void 0 ? Boolean(b.isFeatured) : null
        ]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: "POST_NOT_FOUND" });
      await notifyBlogDiscovery([...previous?.is_published ? [previous.slug] : [], ...rows[0].is_published ? [rows[0].slug] : []]);
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );
  app.delete(
    "/api/admin/blog/:id",
    guard("VIEW_SECTOR_ANALYTICS"),
    wrap(async (req, res, db) => {
      const id = String(req.params.id);
      const { rows } = await db.query(`DELETE FROM public.blog_posts WHERE id = $1 RETURNING id, slug, is_published`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "POST_NOT_FOUND" });
      if (rows[0].is_published) await notifyBlogDiscovery([rows[0].slug]);
      res.json({ ok: true, id: rows[0].id });
    })
  );
}

// services/pos/hybridOnboarding.ts
import { randomUUID as randomUUID8, randomBytes } from "node:crypto";
var sectors = /* @__PURE__ */ new Set(["FNB", "RETAIL", "LAUNDRY", "BARBERSHOP", "CARWASH"]);
var label = (v, fallback, max) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
function registerHybridOnboarding(app, db) {
  if (process.env.NEON_DB_PHASE1 !== "1") return;
  app.get("/api/v1/sync/identity", (req, res) => {
    const p = trustedPrincipal(req);
    res.setHeader("Cache-Control", "no-store");
    if (!p) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    return res.json({ ok: true, subject: p.subject, provider: "supabase", identityRemapped: false });
  });
  app.post("/api/v1/sync/hybrid-onboarding", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const p = trustedPrincipal(req);
    if (!p?.isEmailVerified || !p.email) return res.status(403).json({ ok: false, error: "VERIFIED_SOURCE_ACCOUNT_REQUIRED" });
    try {
      hybridPhase1Config();
      const result = await db.tx(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["hybrid-onboarding:" + p.subject]);
        const tenant2 = (await c.query("SELECT id FROM internal.tenants WHERE owner_user_ref=$1", [p.subject])).rows;
        if (tenant2.length) return { created: false };
        const profile = (await c.query("SELECT id FROM internal.users WHERE id=$1", [p.subject])).rows.length;
        const member = (await c.query("SELECT 1 FROM internal.memberships WHERE user_id=$1", [p.subject])).rows.length;
        const old = (await c.query("SELECT 1 FROM internal.hybrid_source_accounts WHERE source_uuid=$1", [p.subject])).rows.length;
        if (profile || member || old) return { created: false, recoveryRequired: !member };
        const state = (await c.query("SELECT source_cutover_at,signup_provisioning_enabled FROM internal.hybrid_phase1_state WHERE singleton")).rows[0];
        if (!state?.signup_provisioning_enabled) throw Error("HYBRID_NEW_SIGNUPS_PAUSED");
        const created = Date.parse(p.sourceCreatedAt || "");
        if (!Number.isFinite(created) || created <= new Date(state.source_cutover_at).getTime() || created > Date.now() + 3e4) throw Error("SOURCE_CREATION_PROOF_REQUIRED");
        if ((await c.query("SELECT 1 FROM internal.users WHERE lower(email)=lower($1)", [p.email])).rows.length) throw Error("SOURCE_UUID_EMAIL_CONFLICT_REQUIRES_REVIEW");
        const id = randomUUID8(), name = label(req.body?.store_name, "Toko Baru", 100), owner = label(req.body?.full_name, "Pemilik Toko", 150), sector = sectors.has(req.body?.business_sector) ? req.body.business_sector : "FNB";
        const first = label(req.body?.first_outlet_name, name + " (Cabang Utama)", 150), second = label(req.body?.second_outlet_name, "", 150);
        await c.query("INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,lower($2),$3,true)", [p.subject, p.email, owner]);
        await c.query("INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref,owner_user_id,is_active) VALUES($1,$2,$3,$4::text,$4::uuid,true)", [id, name, sector, p.subject]);
        await c.query("INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref,is_active) VALUES($1,$2,$3,$4,true)", [id, name, sector, p.subject]);
        await c.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref,is_active) VALUES($1,$1,$2,$3,$4,true)", [id, name, sector, `${p.subject}_${sector}`]);
        for (const outlet of second && second !== first ? [first, second] : [first]) await c.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,is_active) VALUES($1,$2,$2,$3,true)", [randomUUID8(), id, outlet]);
        await c.query("INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,role,pin,is_active) VALUES($1,$2,$3,$3,'OWNER',$4,true)", [randomUUID8(), p.subject, id, randomBytes(32).toString("hex")]);
        await c.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,grace_period_end,trial_started_at,trial_ends_at,has_used_trial) VALUES($1,$2,'plan-free','TRIAL',now(),now()+interval '45 days',now()+interval '59 days',now(),now()+interval '45 days',true)", [randomUUID8(), id]);
        await c.query("INSERT INTO ai.merchant_ai_credits(merchant_id,tenant_id,balance,monthly_grant,used_this_month,period_reset_at) VALUES($1,$1,$2,$2,0,date_trunc('month',now())+interval '1 month')", [id, SAAS_PLANS.find((v) => v.id === TRIAL_PLAN_ID).aiQuotaMonthly]);
        return { created: true };
      });
      return res.json({ ok: true, identityRemapped: false, ...result });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      return res.status(code === "HYBRID_NEW_SIGNUPS_PAUSED" ? 503 : 409).json({ ok: false, error: ["HYBRID_NEW_SIGNUPS_PAUSED", "SOURCE_CREATION_PROOF_REQUIRED", "SOURCE_UUID_EMAIL_CONFLICT_REQUIRES_REVIEW"].includes(code) ? code : "HYBRID_ONBOARDING_REVIEW_REQUIRED" });
    }
  });
}

// services/pos/financialAuthorization.ts
import { createHash as createHash3, randomBytes as randomBytes2, scrypt as derive, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var scrypt = (pin, salt) => new Promise((resolve, reject) => derive(pin, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
var ACTIONS = /* @__PURE__ */ new Set(["VOID", "REFUND", "CASH_OUT", "CASH_REVERSE"]);
var FinancialApprovalError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
var canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => k !== "approvalGrant" && v[k] !== void 0).sort().map((k) => [k, canonical(v[k])])) : v;
var commandHash = (command) => createHash3("sha256").update(JSON.stringify(canonical(command))).digest("hex");
var digest2 = (token) => createHash3("sha256").update(token).digest("hex");
function validFinancialPin(pin) {
  return typeof pin === "string" && /^\d{4,8}$/.test(pin) && !/^([0-9])\1+$/.test(pin) && !["1234", "4321", "123456", "654321", "12345678", "87654321"].includes(pin);
}
async function hashFinancialPin(pin) {
  if (!validFinancialPin(pin)) throw new FinancialApprovalError(400, "WEAK_FINANCIAL_PIN");
  const salt = randomBytes2(16).toString("hex");
  const value = await scrypt(pin, salt);
  return "scrypt-v1$" + salt + "$" + value.toString("hex");
}
async function verifyFinancialPin(pin, encoded) {
  if (!validFinancialPin(pin)) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const result = await scrypt(pin, parts[1]);
  return timingSafeEqual2(result, Buffer.from(parts[2], "hex"));
}
async function rateWindow(c, s) {
  await c.query("INSERT INTO pos.financial_pin_attempts(tenant_id,actor_ref) VALUES($1,$2) ON CONFLICT DO NOTHING", [s.tenantId, s.actorRef]);
  await c.query(`UPDATE pos.financial_pin_attempts SET failures=0,attempts=0,window_started_at=now()
    WHERE tenant_id=$1 AND actor_ref=$2 AND window_started_at<now()-interval '15 minutes'`, [s.tenantId, s.actorRef]);
  const row = (await c.query("SELECT * FROM pos.financial_pin_attempts WHERE tenant_id=$1 AND actor_ref=$2 FOR UPDATE", [s.tenantId, s.actorRef])).rows[0];
  if (row.failures >= 5 || row.attempts >= 60) return false;
  await c.query("UPDATE pos.financial_pin_attempts SET attempts=attempts+1 WHERE tenant_id=$1 AND actor_ref=$2", [s.tenantId, s.actorRef]);
  return true;
}
async function credential(c, s) {
  return (await c.query("SELECT pin_hash FROM pos.financial_pin_credentials WHERE tenant_id=$1 AND approver_ref=$2", [s.tenantId, s.actorRef])).rows[0];
}
async function failure(c, s) {
  await c.query("UPDATE pos.financial_pin_attempts SET failures=failures+1 WHERE tenant_id=$1 AND actor_ref=$2", [s.tenantId, s.actorRef]);
  return { status: 403, error: "INVALID_FINANCIAL_PIN" };
}
async function reauthenticateOwner(req, subject, db) {
  const principal = trustedPrincipal(req), password = req.body?.ownerPassword;
  if (!principal?.email || typeof password !== "string" || !password || password.length > 1024) return false;
  if (process.env.AUTH_PROVIDER === "better-auth") {
    const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""))?.[1];
    if (!token) return false;
    try {
      return await reauthenticateBetterOwner(token, password, subject);
    } catch {
      throw new FinancialApprovalError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
    }
  }
  if (process.env.AUTH_PROVIDER === "neon") {
    try {
      return await reauthenticateNeonOwner(db, principal.email, password, subject);
    } catch {
      throw new FinancialApprovalError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
    }
  }
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url.startsWith("https://") || !key) throw new FinancialApprovalError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
  let response;
  try {
    response = await fetch(url + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email: principal.email, password }), redirect: "error", signal: AbortSignal.timeout(5e3) });
  } catch {
    throw new FinancialApprovalError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
  }
  if (response.status >= 500 || response.status === 429) throw new FinancialApprovalError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
  if (!response.ok) return false;
  const data = await response.json();
  return data.user?.id === subject && Boolean(data.user?.email_confirmed_at || data.user?.confirmed_at);
}
function registerFinancialApprovalRoutes(app, db, scopeFor3) {
  const route = (path, run) => app.post(path, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await db.tx(async (c) => run(c, await scopeFor3(c, req), req));
      if (result.error) {
        if (result.status === 429) res.setHeader("Retry-After", "900");
        return res.status(result.status).json({ ok: false, error: result.error });
      }
      return res.json({ ok: true, ...result });
    } catch (e) {
      const error = e;
      return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : "FINANCIAL_AUTHORIZATION_UNAVAILABLE" });
    }
  });
  route("/api/v1/finance/pin", async (c, s, req) => {
    if (!await rateWindow(c, s)) return { status: 429, error: "FINANCIAL_PIN_RATE_LIMITED" };
    if (!validFinancialPin(req.body?.newPin)) throw new FinancialApprovalError(400, "WEAK_FINANCIAL_PIN");
    if (!await reauthenticateOwner(req, s.actorRef, c)) {
      await failure(c, s);
      return { status: 403, error: "OWNER_REAUTHENTICATION_REQUIRED" };
    }
    const old = await credential(c, s);
    if (old && !await verifyFinancialPin(req.body?.currentPin, old.pin_hash)) return failure(c, s);
    const pinHash = await hashFinancialPin(req.body?.newPin);
    await c.query(`INSERT INTO pos.financial_pin_credentials(tenant_id,approver_ref,pin_hash)
      VALUES($1,$2,$3) ON CONFLICT(tenant_id,approver_ref) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,updated_at=now()`, [s.tenantId, s.actorRef, pinHash]);
    await c.query("DELETE FROM pos.financial_approval_grants WHERE tenant_id=$1 AND approver_ref=$2", [s.tenantId, s.actorRef]);
    await c.query(`INSERT INTO pos.financial_authorization_audit(tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,grant_hash) VALUES($1,$2,$3,$4,$4,$5,$4,'Owner financial PIN setup/change',$6,$7)`, [s.tenantId, s.merchantId, s.outletId, s.actorRef, old ? "PIN_ROTATED" : "PIN_ENROLLED", commandHash({ operation: "pin-setup" }), digest2(randomBytes2(32).toString("hex"))]);
    return { enrolled: true };
  });
  route("/api/v1/finance/approve", async (c, s, req) => {
    const { action, reference, reason, command, pin } = req.body || {};
    if (!ACTIONS.has(action) || typeof reference !== "string" || !reference || reference.length > 128 || typeof reason !== "string" || !reason.trim() || reason.length > 500 || !command || typeof command !== "object" || JSON.stringify(command).length > 1e5)
      throw new FinancialApprovalError(400, "INVALID_APPROVAL_REQUEST");
    if (!await rateWindow(c, s)) return { status: 429, error: "FINANCIAL_PIN_RATE_LIMITED" };
    const row = await credential(c, s);
    if (!row) return { status: 409, error: "FINANCIAL_PIN_SETUP_REQUIRED" };
    if (!await verifyFinancialPin(pin, row.pin_hash)) return failure(c, s);
    const token = randomBytes2(32).toString("base64url");
    await c.query(
      `INSERT INTO pos.financial_approval_grants
      (token_hash,tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,now()+interval '90 seconds')`,
      [digest2(token), s.tenantId, s.merchantId, s.outletId, s.actorRef, action, reference, reason.trim(), commandHash(command)]
    );
    return { approvalGrant: token, expiresInSeconds: 90, approverRef: s.actorRef };
  });
}
async function consumeFinancialApproval(c, s, action, reference, command, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new FinancialApprovalError(403, "FINANCIAL_APPROVAL_REQUIRED");
  const row = (await c.query(
    `SELECT * FROM pos.financial_approval_grants WHERE token_hash=$1
    AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 AND actor_ref=$5
    AND action=$6 AND reference=$7 AND command_hash=$8 FOR UPDATE`,
    [digest2(token), s.tenantId, s.merchantId, s.outletId, s.actorRef, action, reference, commandHash(command)]
  )).rows[0];
  if (!row || !row.consumed_at && Date.parse(row.expires_at) <= Date.now()) throw new FinancialApprovalError(403, "FINANCIAL_APPROVAL_INVALID_OR_EXPIRED");
  if (row.consumed_at) return;
  await c.query("UPDATE pos.financial_approval_grants SET consumed_at=now() WHERE token_hash=$1", [row.token_hash]);
  await c.query(`INSERT INTO pos.financial_authorization_audit
    (tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,grant_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [s.tenantId, s.merchantId, s.outletId, s.actorRef, row.approver_ref, action, reference, row.reason, row.command_hash, row.token_hash]);
}

// services/pos/neonOnboarding.ts
import { randomUUID as randomUUID9, randomBytes as randomBytes3 } from "node:crypto";
var sectors2 = /* @__PURE__ */ new Set(["FNB", "RETAIL", "LAUNDRY", "CARWASH", "BARBERSHOP"]);
var label2 = (v, fallback, max) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
function registerNeonOnboarding(app, db) {
  app.get("/api/v1/sync/identity", async (req, res) => {
    const p = trustedPrincipal(req);
    res.setHeader("Cache-Control", "no-store");
    if (!p) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const issuer = process.env.AUTH_PROVIDER === "better-auth" ? betterAuthPilotConfig().baseUrl : neonPilotConfig().issuer;
      const result = await db.query(`SELECT b.verification_ref,u.is_platform_user,u.platform_role,
        EXISTS(SELECT 1 FROM internal.tenants t WHERE t.owner_user_ref=u.id::text) AS owns_tenant,
        EXISTS(SELECT 1 FROM internal.memberships m WHERE m.user_id=u.id) AS has_membership
        FROM internal.auth_identity_bindings b JOIN internal.users u ON u.id=b.canonical_user_id
        WHERE b.provider=$3 AND b.issuer=$1 AND b.canonical_user_id=$2 AND b.is_active AND u.is_active`, [issuer, p.subject, process.env.AUTH_PROVIDER]);
      const row = result.rows[0];
      const needsOnboarding = Boolean(row && row.verification_ref === "NEW_VERIFIED_ACCOUNT" && !row.owns_tenant && !row.has_membership && !row.is_platform_user && !row.platform_role);
      return res.json({ ok: true, subject: p.subject, needsOnboarding });
    } catch {
      return res.status(503).json({ ok: false, error: "IDENTITY_DIRECTORY_UNAVAILABLE" });
    }
  });
  app.post("/api/v1/sync/neon-onboarding", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["neon", "better-auth"].includes(process.env.AUTH_PROVIDER || "")) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const p = trustedPrincipal(req);
    if (!p?.isEmailVerified || !p.email) return res.status(403).json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" });
    try {
      const issuer = process.env.AUTH_PROVIDER === "better-auth" ? betterAuthPilotConfig().baseUrl : neonPilotConfig().issuer;
      const result = await db.tx(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["onboarding:" + p.subject]);
        const binding = (await c.query(`SELECT b.verification_ref,u.is_platform_user,u.platform_role
          FROM internal.auth_identity_bindings b JOIN internal.users u ON u.id=b.canonical_user_id
          WHERE b.provider=$3 AND b.issuer=$1 AND b.canonical_user_id=$2 AND b.is_active AND u.is_active`, [issuer, p.subject, process.env.AUTH_PROVIDER])).rows[0];
        const existing = (await c.query("SELECT id FROM internal.tenants WHERE owner_user_ref=$1", [p.subject])).rows;
        if (existing.length) return { tenantId: existing[0].id, created: false };
        const member = (await c.query("SELECT 1 FROM internal.memberships WHERE user_id=$1", [p.subject])).rows.length;
        if (!binding || binding.verification_ref !== "NEW_VERIFIED_ACCOUNT" || member || binding.is_platform_user || binding.platform_role) throw Error("IDENTITY_REVIEW_REQUIRED");
        const id = randomUUID9(), name = label2(req.body?.store_name, "Toko Baru", 100);
        const fullName = label2(req.body?.full_name, "Pemilik Toko", 150);
        const sector = sectors2.has(req.body?.business_sector) ? req.body.business_sector : "FNB";
        const first = label2(req.body?.first_outlet_name, name + " (Cabang Utama)", 150);
        const second = label2(req.body?.second_outlet_name, "", 150);
        await c.query("UPDATE internal.users SET full_name=$2 WHERE id=$1", [p.subject, fullName]);
        await c.query(`INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref,owner_user_id,is_active)
          VALUES($1,$2,$3,$4::text,$4::uuid,true)`, [id, name, sector, p.subject]);
        await c.query("INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref) VALUES($1,$2,$3,$4)", [id, name, sector, p.subject]);
        await c.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$1,$2,$3,$4)", [id, name, sector, `${p.subject}_${sector}`]);
        for (const outlet of second && second !== first ? [first, second] : [first]) await c.query(
          "INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$2,$3)",
          [randomUUID9(), id, outlet]
        );
        await c.query(`INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,role,pin,is_active)
          VALUES($1,$2,$3,$3,'OWNER',$4,true)`, [randomUUID9(), p.subject, id, randomBytes3(32).toString("hex")]);
        await c.query(`INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,
          grace_period_end,trial_started_at,trial_ends_at,has_used_trial)
          VALUES($1,$2,'plan-free','TRIAL',now(),now()+interval '45 days',now()+interval '59 days',now(),now()+interval '45 days',true)`, [randomUUID9(), id]);
        await c.query(`INSERT INTO ai.merchant_ai_credits(merchant_id,tenant_id,balance,monthly_grant,used_this_month,period_reset_at)
          VALUES($1,$1,$2,$2,0,date_trunc('month',now())+interval '1 month')`, [id, SAAS_PLANS.find((p2) => p2.id === TRIAL_PLAN_ID).aiQuotaMonthly]);
        return { tenantId: id, created: true };
      });
      return res.json({ ok: true, ...result });
    } catch {
      return res.status(409).json({ ok: false, error: "NEON_ONBOARDING_REVIEW_REQUIRED" });
    }
  });
}

// services/pos/businessDirectory.ts
function registerBusinessDirectory(app, db) {
  app.get("/api/v1/sync/business", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const tenantId = await tenantForPrincipal(db, principal);
      if (!tenantId) return res.json({ ok: true, tenantId: null, businesses: [] });
      const result = await db.query(`SELECT m.id,m.tenant_id,m.name,m.business_sector,m.is_active,m.external_ref,
        o.id AS outlet_id,o.name AS outlet_name,o.address,o.is_active AS outlet_active,o.latitude,o.longitude,o.radius_meters
        FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
        LEFT JOIN internal.outlets o ON o.merchant_id=m.id AND o.tenant_id=m.tenant_id
        WHERE m.tenant_id=$1 AND t.owner_user_ref=$2 AND t.merged_into IS NULL AND t.is_active
        ORDER BY m.created_at,m.id,o.created_at,o.id`, [tenantId, principal.subject]);
      const capabilities = (await db.query("SELECT 1 FROM pg_constraint WHERE conrelid='pos.shared_state_records'::regclass AND conname='shared_state_business_namespace'")).rows.length > 0;
      const businesses = /* @__PURE__ */ new Map();
      for (const row of result.rows) {
        let business = businesses.get(row.id);
        if (!business) {
          business = {
            businessId: row.id,
            tenantId: row.tenant_id,
            name: row.name,
            sector: row.business_sector,
            status: row.is_active ? "ACTIVE" : "INACTIVE",
            legacyAlias: row.external_ref === `${principal.subject}_${row.business_sector}` ? row.external_ref : null,
            transportRef: row.external_ref || row.id,
            outlets: []
          };
          businesses.set(row.id, business);
        }
        if (row.outlet_id) business.outlets.push({
          outletId: row.outlet_id,
          businessId: row.id,
          name: row.outlet_name,
          address: row.address || "",
          status: row.outlet_active ? "ACTIVE" : "INACTIVE",
          ...{ latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude), radiusMeters: row.radius_meters === null ? null : Number(row.radius_meters) }
        });
      }
      return res.json({ ok: true, tenantId, capabilities: { multiBusiness: capabilities }, businesses: [...businesses.values()] });
    } catch {
      return res.status(503).json({ ok: false, error: "BUSINESS_DIRECTORY_UNAVAILABLE" });
    }
  });
}

// services/pos/sync.ts
import { randomBytes as randomBytes4 } from "node:crypto";

// services/shared/schemaFeatures.ts
var FEATURES = {
  /** migration 0054 / 20261004090200 */
  syncReceiptOutcomes: `SELECT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('pos.sync_receipts') AND attname = 'outcomes' AND NOT attisdropped) AS ok`,
  /** migration 0055 / 20261004090300 */
  sharedStateVersions: `SELECT to_regclass('pos.shared_state_versions') IS NOT NULL AS ok`
};
var ABSENT_RECHECK_MS = 6e4;
var known = /* @__PURE__ */ new Map();
async function hasSchemaFeature(db, feature, now = Date.now()) {
  const cached = known.get(feature);
  if (cached && (cached.ok || now - cached.at < ABSENT_RECHECK_MS)) return cached.ok;
  const ok = Boolean((await db.query(FEATURES[feature])).rows[0]?.ok);
  known.set(feature, { ok, at: now });
  return ok;
}

// services/pos/activity.ts
var SECTORS2 = ["FNB", "LAUNDRY", "RETAIL", "CARWASH", "BARBERSHOP"];
var APP_MODULES2 = [
  "POS",
  "TABLES",
  "INVENTORY",
  "CUSTOMERS",
  "REPORTS",
  "AI",
  "SETTINGS",
  "SYNC",
  "AUTH"
];
var SEVERITIES2 = ["INFO", "NOTICE", "WARNING", "CRITICAL"];
var UUID_RE2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pick2(allowed, v) {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}
async function writeActivity(db, a) {
  const sector = pick2(SECTORS2, a.businessSector);
  const mod = pick2(APP_MODULES2, a.appModule);
  if (!sector || !mod || !UUID_RE2.test(a.merchantId)) return null;
  const { rows } = await db.query(
    `INSERT INTO internal.audit_logs
       (merchant_id, tenant_id, domain,
        event_type, severity, actor_id, actor_name, actor_role,
        amount_idr, summary, detail, occurred_at)
     VALUES ($1::uuid, $2::uuid, $3,
             $4, $5, $6::uuid, $7, $8,
             $9, $10, $11::jsonb, COALESCE($12::timestamptz, CURRENT_TIMESTAMP))
     RETURNING id`,
    [
      a.merchantId,
      a.tenantId && UUID_RE2.test(a.tenantId) ? a.tenantId : a.merchantId,
      mod,
      a.eventType.slice(0, 48),
      pick2(SEVERITIES2, a.severity) ?? "INFO",
      a.actorUserId && UUID_RE2.test(a.actorUserId) ? a.actorUserId : null,
      a.actorName ?? null,
      a.actorRole ?? null,
      a.amountIdr ?? null,
      a.summary.slice(0, 240),
      JSON.stringify({ ...a.detail, businessSector: a.businessSector, businessId: a.businessId, transactionId: a.transactionId }),
      a.occurredAt ?? null
    ]
  );
  return rows[0]?.id ?? null;
}

// services/pos/finance.ts
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ID = /^[^\x00-\x1f\x7f]{1,128}$/;
var money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
var FinanceError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
function timestamp2(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new FinanceError(400, "INVALID_EVENT_DATE");
  return new Date(value).toISOString();
}
async function scopeFor(db, req) {
  const input = req.method === "GET" ? req.query : req.body;
  const principal = trustedPrincipal(req), sector = input?.sector, outletId = input?.outletId;
  if (!principal || principal.subject === "local-development") throw new FinanceError(401, "UNAUTHENTICATED");
  if (!SECTORS2.includes(sector) || !UUID.test(String(outletId))) throw new FinanceError(400, "INVALID_FINANCIAL_SCOPE");
  const tenantId = await tenantForPrincipal(db, principal);
  if (!tenantId) throw new FinanceError(409, "TENANT_NOT_PROVISIONED");
  const row = (await db.query(`SELECT o.merchant_id,o.is_active FROM internal.outlets o JOIN internal.merchants m
    ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE o.id=$1 AND o.tenant_id=$2 AND m.business_sector=$3 AND m.is_active
      AND t.is_active AND t.merged_into IS NULL AND t.owner_user_ref=$4`, [outletId, tenantId, sector, principal.subject])).rows[0];
  if (!row) throw new FinanceError(403, "OUTLET_NOT_OWNED");
  if (!row.is_active) throw new FinanceError(409, "OUTLET_SETUP_REQUIRED");
  await assertTenantWritable(db, tenantId);
  const free = await freePlanState(db, tenantId);
  assertFreeScope(free, sector, []);
  if (free.free && free.selection?.branchId !== outletId) throw new FinanceError(403, "FREE_OUTLET_MISMATCH");
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [tenantId, row.merchant_id]);
  return { tenantId, merchantId: row.merchant_id, outletId, sector, actorRef: principal.subject };
}
async function applyRefund(db, scope, transactionId, command) {
  if (!command || !ID.test(command.clientRefundId || "") || !["CASH", "ORIGINAL_METHOD"].includes(command.refundMethod) || typeof command.reason !== "string" || !command.reason.trim() || command.reason.length > 500 || !Array.isArray(command.items) || !command.items.length || command.items.length > 200)
    throw new FinanceError(400, "INVALID_REFUND");
  const occurredAt = timestamp2(command.occurredAt || (/* @__PURE__ */ new Date()).toISOString());
  const { approvalGrant: unusedGrant, ...refundInput } = command;
  const normalized = { ...refundInput, occurredAt, reason: command.reason.trim(), items: [...command.items].sort((a, b) => a.clientItemId.localeCompare(b.clientItemId)) };
  const txn = (await db.query(
    `SELECT * FROM pos.transactions WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE`,
    [transactionId, scope.tenantId, scope.merchantId, scope.outletId]
  )).rows[0];
  if (!txn) throw new FinanceError(404, "TRANSACTION_NOT_FOUND");
  await consumeFinancialApproval(db, scope, "REFUND", txn.client_txn_id, command, command.approvalGrant);
  const previous = (await db.query("SELECT * FROM pos.transaction_refunds WHERE tenant_id=$1 AND client_refund_id=$2", [scope.tenantId, command.clientRefundId])).rows[0];
  if (previous) {
    if (previous.transaction_id !== transactionId || JSON.stringify(previous.command) !== JSON.stringify(normalized)) {
      const same = (await db.query("SELECT command=$2::jsonb AS same FROM pos.transaction_refunds WHERE id=$1", [previous.id, JSON.stringify(normalized)])).rows[0]?.same;
      if (previous.transaction_id !== transactionId || !same) throw new FinanceError(409, "REFUND_ID_CONFLICT");
    }
    return { id: previous.id, clientRefundId: previous.client_refund_id, amount: Number(previous.amount), subtotal: Number(previous.subtotal_amount), discount: Number(previous.discount_amount), tax: Number(previous.tax_amount), service: Number(previous.service_amount), replayed: true };
  }
  const eligible = (await db.query("SELECT id FROM contract.merchant_revenue WHERE id=$1 AND tenant_id=$2", [transactionId, scope.tenantId])).rows[0];
  if (!eligible) throw new FinanceError(409, "TRANSACTION_NOT_REFUNDABLE");
  const rows = (await db.query(`SELECT i.*,COALESCE(i.quantity_exact,i.quantity) AS quantity,COALESCE(r.quantity,0) AS returned FROM pos.transaction_items i
    LEFT JOIN LATERAL(SELECT SUM(ri.quantity) AS quantity FROM pos.transaction_refund_items ri
      WHERE ri.transaction_item_id=i.id) r ON true WHERE i.transaction_id=$1 AND i.tenant_id=$2`, [transactionId, scope.tenantId])).rows;
  const seen = /* @__PURE__ */ new Set();
  let subtotal = 0, netItems = 0;
  const lines = normalized.items.map((item) => {
    if (!ID.test(item.clientItemId || "") || seen.has(item.clientItemId) || !Number.isFinite(item.quantity) || item.quantity <= 0 || Math.abs(item.quantity * 1e3 - Math.round(item.quantity * 1e3)) > 1e-3)
      throw new FinanceError(400, "INVALID_REFUND_ITEM");
    seen.add(item.clientItemId);
    const line = rows.find((row) => row.client_item_id === item.clientItemId || row.id === item.clientItemId);
    if (!line || item.quantity > Number(line.quantity) - Number(line.returned)) throw new FinanceError(409, "REFUND_QUANTITY_EXCEEDED");
    const amount2 = money(Number(line.total_price) * item.quantity / Number(line.quantity));
    subtotal += money(Number(line.unit_price) * item.quantity);
    netItems += amount2;
    return { line, quantity: item.quantity, amount: amount2 };
  });
  subtotal = money(subtotal);
  const allNetItems = rows.reduce((sum, row) => sum + Number(row.total_price), 0);
  const ratio = allNetItems > 0 ? netItems / allNetItems : 0;
  const already = (await db.query(`SELECT COALESCE(SUM(amount),0) AS amount,COALESCE(SUM(discount_amount),0) AS discount,
    COALESCE(SUM(tax_amount),0) AS tax,COALESCE(SUM(service_amount),0) AS service
    FROM pos.transaction_refunds WHERE transaction_id=$1`, [transactionId])).rows[0];
  const last = rows.every((row) => Number(row.returned) + (lines.find((l) => l.line.id === row.id)?.quantity || 0) >= Number(row.quantity));
  const component = (name, total) => last ? money(total - Number(already[name])) : Math.min(money(total * ratio), money(total - Number(already[name])));
  const lineDiscount = money(subtotal - netItems);
  const discount = last ? money(Number(txn.discount_amount) - Number(already.discount)) : Math.min(lineDiscount, money(Number(txn.discount_amount) - Number(already.discount)));
  const tax = component("tax", Number(txn.tax_amount)), service = component("service", Number(txn.service_charge_amount));
  const amount = last ? money(Number(txn.total_amount) - Number(already.amount)) : money(subtotal - discount + tax + service);
  if (amount <= 0 || amount > money(Number(txn.total_amount) - Number(already.amount))) throw new FinanceError(409, "REFUND_AMOUNT_EXCEEDED");
  const refund = (await db.query(
    `INSERT INTO pos.transaction_refunds
    (tenant_id,merchant_id,outlet_id,transaction_id,client_refund_id,amount,subtotal_amount,discount_amount,tax_amount,service_amount,refund_method,reason,actor_ref,occurred_at,command)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb) RETURNING id`,
    [scope.tenantId, scope.merchantId, scope.outletId, transactionId, command.clientRefundId, amount, subtotal, discount, tax, service, command.refundMethod, normalized.reason, scope.actorRef, occurredAt, JSON.stringify(normalized)]
  )).rows[0];
  for (const { line, quantity, amount: lineAmount } of lines) {
    await db.query("INSERT INTO pos.transaction_refund_items(refund_id,transaction_item_id,quantity,amount) VALUES($1,$2,$3,$4)", [refund.id, line.id, quantity, lineAmount]);
    await db.query(`INSERT INTO pos.inventory_transactions(id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reference_id,reason)
      SELECT uuidv7(),s.tenant_id,s.merchant_id,s.outlet_id,s.location_id,s.inventory_item_id,$2,'REFUND_RESTORE',$3,'Retur POS'
      FROM pos.inventory_transactions s JOIN pos.products p ON p.inventory_item_id=s.inventory_item_id
      WHERE s.reference_id=$1 AND s.reference_type='SALE_DEDUCT' AND p.id=$4 LIMIT 1`, [transactionId, quantity, refund.id, line.product_id]);
  }
  const cashPaid = Number((await db.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM pos.cash_ledger
    WHERE transaction_id=$1 AND tenant_id=$2`, [transactionId, scope.tenantId])).rows[0]?.amount || 0);
  const tenders = (await db.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE payment_method='CASH'),0) AS cash,
    COALESCE(SUM(amount),0) AS total FROM pos.payments WHERE transaction_id=$1 AND tenant_id=$2
    AND payment_status IN('PAID','SETTLED')`, [transactionId, scope.tenantId])).rows[0];
  const originalCash = Number(tenders.total) > 0 ? money(amount * Number(tenders.cash) / Number(tenders.total)) : 0;
  const cashRefund = command.refundMethod === "CASH" ? amount : Math.min(originalCash, Math.max(0, cashPaid));
  if (cashRefund > 0) await db.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,reference_id,note,actor_ref,occurred_at)
    VALUES($1,$2,$3,$4,'REFUND',$5,$6,$7,$8,$9,$10)`, [scope.tenantId, scope.merchantId, scope.outletId, "refund:" + refund.id, -cashRefund, transactionId, refund.id, normalized.reason, scope.actorRef, occurredAt]);
  await writeActivity(db, { tenantId: scope.tenantId, merchantId: scope.merchantId, businessSector: scope.sector, appModule: "POS", eventType: "TRANSACTION_REFUND", transactionId, amountIdr: amount, severity: "WARNING", summary: "Retur transaksi dicatat", detail: { clientRefundId: command.clientRefundId } });
  return { id: refund.id, clientRefundId: command.clientRefundId, amount, subtotal, discount, tax, service, replayed: false };
}
function registerFinanceRoutes(app, db) {
  registerFinancialApprovalRoutes(app, db, scopeFor);
  const route = (path, run) => app.post(path, async (req, res) => {
    try {
      const result = await db.tx(async (c) => run(c, await scopeFor(c, req), req));
      res.json({ ok: true, ...result });
    } catch (error) {
      const known2 = error instanceof FinanceError || error instanceof BillingError || error instanceof FinancialApprovalError;
      if (!known2 && !(error instanceof FreePlanAccessError)) {
        const diagnostic = error;
        console.error("[finance] write failed", { route: path, code: diagnostic.code, constraint: diagnostic.constraint, column: diagnostic.column });
      }
      res.status(known2 ? error.status : error instanceof FreePlanAccessError ? 403 : 500).json({ ok: false, error: known2 || error instanceof FreePlanAccessError ? error.message : "FINANCIAL_WRITE_FAILED" });
    }
  });
  app.get("/api/v1/finance/reconciliation", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const data = await db.tx(async (c) => {
        const s = await scopeFor(c, req);
        const totals = (await c.query(`SELECT verification_origin,count(*)::int count,COALESCE(sum(amount),0) amount
        FROM pos.payments WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND payment_status IN('PAID','SETTLED') GROUP BY verification_origin`, [s.tenantId, s.merchantId, s.outletId])).rows;
        const exceptions = (await c.query(`SELECT e.provider_event_ref,e.reason,e.received_at FROM pos.payment_reconciliation_events e
        LEFT JOIN pos.payments p ON p.id=e.payment_id WHERE e.tenant_id=$1 AND e.merchant_id=$2 AND e.outcome='EXCEPTION'
        AND (e.payment_id IS NULL OR p.outlet_id=$3) ORDER BY e.received_at DESC LIMIT 50`, [s.tenantId, s.merchantId, s.outletId])).rows;
        return { totals, exceptions };
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(e instanceof FinanceError || e instanceof BillingError ? e.status : 503).json({ ok: false, error: e instanceof FinanceError || e instanceof BillingError ? e.message : "RECONCILIATION_UNAVAILABLE" });
    }
  });
  app.get("/api/v1/finance/shift", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await db.tx(async (c) => {
        const s = await scopeFor(c, req);
        const rows = (await c.query(`SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 ORDER BY opened_at DESC LIMIT 100`, [s.tenantId, s.merchantId, s.outletId])).rows;
        const current = rows.find((r) => r.status === "OPEN");
        return { shift: current ? await calculateShift(c, s, current) : null, history: rows.filter((r) => r.status === "CLOSED").map((r) => r.summary).filter(Boolean) };
      });
      res.json({ ok: true, ...result, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (error) {
      if (!(error instanceof FinanceError) && !(error instanceof BillingError)) {
        const diagnostic = error;
        console.error("[finance] shift read failed", { code: diagnostic.code, constraint: diagnostic.constraint, table: diagnostic.table, column: diagnostic.column });
      }
      res.status(error instanceof FinanceError || error instanceof BillingError ? error.status : 503).json({ ok: false, error: error instanceof FinanceError || error instanceof BillingError ? error.message : "SHIFT_UNAVAILABLE" });
    }
  });
  route("/api/v1/finance/shift/open", async (c, s, req) => {
    const b = req.body;
    if (!ID.test(b.clientShiftId || "") || !Number.isFinite(b.initialCash) || b.initialCash < 0 || b.initialCash > 9999999999) throw new FinanceError(400, "INVALID_SHIFT");
    await c.query("SELECT id FROM internal.outlets WHERE id=$1 FOR UPDATE", [s.outletId]);
    const active = (await c.query(`SELECT * FROM pos.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1`, [s.tenantId, s.outletId])).rows[0];
    if (active) return { shift: await calculateShift(c, s, active), replayed: true };
    const previous = (await c.query("SELECT id FROM pos.shifts WHERE tenant_id=$1 AND client_shift_id=$2", [s.tenantId, b.clientShiftId])).rows[0];
    if (previous) throw new FinanceError(409, "SHIFT_ALREADY_CLOSED");
    let register = (await c.query("SELECT id FROM pos.cash_registers WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND status='ACTIVE' ORDER BY created_at LIMIT 1", [s.tenantId, s.merchantId, s.outletId])).rows[0];
    if (!register) register = (await c.query("INSERT INTO pos.cash_registers(tenant_id,merchant_id,outlet_id,name) VALUES($1,$2,$3,'Kas bersama outlet') RETURNING id", [s.tenantId, s.merchantId, s.outletId])).rows[0];
    const row = (await c.query(`INSERT INTO pos.shifts(tenant_id,merchant_id,outlet_id,client_shift_id,actor_name,opening_cash,business_date,status,register_id)
      VALUES($1,$2,$3,$4,$5,$6,(now() AT TIME ZONE 'Asia/Jakarta')::date,'OPEN',$7) RETURNING *`, [s.tenantId, s.merchantId, s.outletId, b.clientShiftId, String(b.cashierName || "Kasir").slice(0, 100), money(b.initialCash), register.id])).rows[0];
    await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,shift_ref,actor_ref,actor_name)
      VALUES($1,$2,$3,$4,'OPENING',$5,'Modal awal shift','MODAL_AWAL',$6,$7,$8)`, [s.tenantId, s.merchantId, s.outletId, "opening:" + row.id, money(b.initialCash), b.clientShiftId, s.actorRef, row.actor_name]);
    return { shift: await calculateShift(c, s, row), replayed: false };
  });
  route("/api/v1/finance/shift/close", async (c, s, req) => {
    const b = req.body;
    if (!ID.test(b.clientShiftId || "") || !Number.isFinite(b.actualCash) || b.actualCash < 0 || b.actualCash > 9999999999) throw new FinanceError(400, "INVALID_SHIFT");
    const row = (await c.query(`SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_shift_id=$4 FOR UPDATE`, [s.tenantId, s.merchantId, s.outletId, b.clientShiftId])).rows[0];
    if (!row) throw new FinanceError(409, "SHIFT_NOT_FOUND");
    if (row.status === "CLOSED") {
      if (Number(row.closing_cash) !== money(b.actualCash)) throw new FinanceError(409, "SHIFT_CLOSE_CONFLICT");
      return { shift: row.summary, replayed: true };
    }
    const summary2 = { ...await calculateShift(c, s, row), status: "CLOSED", endTime: (/* @__PURE__ */ new Date()).toISOString(), actualCash: money(b.actualCash), notes: String(b.notes || "").slice(0, 500) };
    summary2.difference = money(summary2.actualCash - summary2.expectedCash);
    await c.query(`UPDATE pos.shifts SET status='CLOSED',closed_at=$2,closing_cash=$3,expected_cash=$4,cash_difference=$5,summary=$6::jsonb,notes=$7 WHERE id=$1`, [row.id, summary2.endTime, summary2.actualCash, summary2.expectedCash, summary2.difference, JSON.stringify(summary2), summary2.notes]);
    await writeActivity(c, { tenantId: s.tenantId, merchantId: s.merchantId, businessSector: s.sector, appModule: "POS", eventType: "SHIFT_CLOSED", severity: "INFO", summary: "Shift ditutup", detail: { clientShiftId: b.clientShiftId, expectedCash: summary2.expectedCash, difference: summary2.difference } });
    return { shift: summary2, replayed: false };
  });
  route("/api/v1/finance/refund", async (c, s, req) => {
    const id = String(req.body?.clientTxnId || "");
    const txn = (await c.query("SELECT id FROM pos.transactions WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_txn_id=$4", [s.tenantId, s.merchantId, s.outletId, id])).rows[0];
    if (!txn) throw new FinanceError(409, "TRANSACTION_SYNC_REQUIRED");
    return { refund: await applyRefund(c, s, txn.id, req.body.refund) };
  });
  route("/api/v1/finance/cash", async (c, s, req) => {
    const b = req.body;
    if (!ID.test(b.clientEventId || "") || !["CASH_IN", "CASH_OUT", "OPENING"].includes(b.type) || typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount < 0 || b.amount > 9999999999 || typeof b.description !== "string" || b.description.length > 500 || typeof b.category !== "string" || b.category.length > 64)
      throw new FinanceError(400, "INVALID_CASH_EVENT");
    if (b.type === "CASH_OUT") await consumeFinancialApproval(c, s, "CASH_OUT", b.clientEventId, b, b.approvalGrant);
    const amount = money(b.amount) * (b.type === "CASH_OUT" ? -1 : 1), occurredAt = timestamp2(b.occurredAt);
    const command = { clientEventId: b.clientEventId, type: b.type, amount, occurredAt, category: b.category, description: b.description.trim(), shiftId: String(b.shiftId || ""), recipientOrSource: String(b.recipientOrSource || "").slice(0, 200) };
    const prev = (await c.query("SELECT id,command=$2::jsonb AS same,outlet_id FROM pos.cash_ledger WHERE tenant_id=$1 AND client_event_id=$3", [s.tenantId, JSON.stringify(command), b.clientEventId])).rows[0];
    if (prev) {
      if (!prev.same || prev.outlet_id !== s.outletId) throw new FinanceError(409, "CASH_EVENT_ID_CONFLICT");
      return { id: prev.id, replayed: true };
    }
    const row = (await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,actor_ref,actor_name,shift_ref,recipient_or_source,occurred_at,command)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING id`, [s.tenantId, s.merchantId, s.outletId, b.clientEventId, b.type, amount, command.description, b.category, s.actorRef, String(b.actorName || "").slice(0, 100), command.shiftId, command.recipientOrSource, occurredAt, JSON.stringify(command)])).rows[0];
    await writeActivity(c, { tenantId: s.tenantId, merchantId: s.merchantId, businessSector: s.sector, appModule: "POS", eventType: b.type, severity: "INFO", amountIdr: amount, summary: command.description || "Mutasi kas", detail: { clientEventId: b.clientEventId } });
    return { id: row.id, replayed: false };
  });
  route("/api/v1/finance/cash/reverse", async (c, s, req) => {
    const b = req.body;
    if (!ID.test(b.clientEventId || "") || !ID.test(b.originalEventId || "") || typeof b.reason !== "string" || !b.reason.trim() || b.reason.length > 500) throw new FinanceError(400, "INVALID_CASH_REVERSAL");
    await consumeFinancialApproval(c, s, "CASH_REVERSE", b.originalEventId, b, b.approvalGrant);
    const original = (await c.query(`SELECT * FROM pos.cash_ledger WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_event_id=$4 FOR UPDATE`, [s.tenantId, s.merchantId, s.outletId, b.originalEventId])).rows[0];
    if (!original || !["CASH_IN", "CASH_OUT", "OPENING"].includes(original.event_type)) throw new FinanceError(409, "CASH_EVENT_NOT_REVERSIBLE");
    const reused = (await c.query("SELECT reference_id,event_type FROM pos.cash_ledger WHERE tenant_id=$1 AND client_event_id=$2", [s.tenantId, b.clientEventId])).rows[0];
    if (reused && (reused.event_type !== "REVERSAL" || reused.reference_id !== original.id)) throw new FinanceError(409, "CASH_EVENT_ID_CONFLICT");
    const existing = (await c.query(`SELECT id FROM pos.cash_ledger WHERE tenant_id=$1 AND event_type='REVERSAL' AND reference_id=$2`, [s.tenantId, original.id])).rows[0];
    if (existing) return { id: existing.id, replayed: true };
    const row = (await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,reference_id,note,category,actor_ref)
      VALUES($1,$2,$3,$4,'REVERSAL',$5,$6,$7,$8,$9) RETURNING id`, [s.tenantId, s.merchantId, s.outletId, b.clientEventId, -Number(original.amount), original.id, b.reason.trim(), original.category, s.actorRef])).rows[0];
    await writeActivity(c, { tenantId: s.tenantId, merchantId: s.merchantId, businessSector: s.sector, appModule: "POS", eventType: "CASH_REVERSAL", severity: "WARNING", amountIdr: -Number(original.amount), summary: b.reason, detail: { originalEventId: b.originalEventId } });
    return { id: row.id, replayed: false };
  });
}
async function calculateShift(db, scope, row) {
  const params = [scope.tenantId, scope.merchantId, scope.outletId, row.opened_at, row.closed_at || (/* @__PURE__ */ new Date()).toISOString()];
  const revenue = (await db.query(`WITH revenue AS (
    SELECT * FROM contract.merchant_revenue WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3
    AND created_at >=$4 AND ($5::timestamptz IS NULL OR created_at<$5)
  ), tenders AS (
    SELECT r.id,r.total_amount,p.payment_method,p.amount,SUM(p.amount) OVER(PARTITION BY r.id) AS paid
    FROM revenue r JOIN pos.payments p ON p.transaction_id=r.id AND p.tenant_id=r.tenant_id
    AND p.payment_status IN('PAID','SETTLED')
  ) SELECT (SELECT COUNT(*)::int FROM revenue) AS orders,(SELECT COALESCE(SUM(total_amount),0) FROM revenue) AS total,
    COALESCE(SUM(total_amount*amount/NULLIF(paid,0)) FILTER(WHERE payment_method='CASH'),0) AS cash,
    COALESCE(SUM(total_amount*amount/NULLIF(paid,0)) FILTER(WHERE payment_method IN('QRIS','QRIS_DYNAMIC','QRIS_STATIC')),0) AS qris,
    COALESCE(SUM(total_amount*amount/NULLIF(paid,0)) FILTER(WHERE payment_method IN('DEBIT','CREDIT','DEBIT_CARD','CREDIT_CARD','CARD')),0) AS card FROM tenders`, params)).rows[0];
  const cash = (await db.query(`SELECT COALESCE(SUM(c.amount),0) AS balance,
    COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='OPENING' OR c.category='MODAL_AWAL'),0) AS opening,
    COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_IN' AND c.category<>'MODAL_AWAL'),0) AS cash_in,
    COALESCE(-SUM(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT'),0) AS cash_out
    FROM pos.cash_ledger c LEFT JOIN pos.cash_ledger original ON c.event_type='REVERSAL'
      AND c.reference_id=original.id::text AND c.tenant_id=original.tenant_id
    WHERE c.tenant_id=$1 AND c.merchant_id=$2 AND c.outlet_id=$3 AND c.occurred_at >=$4 AND ($5::timestamptz IS NULL OR c.occurred_at<$5)`, params)).rows[0];
  return {
    id: row.client_shift_id || row.id,
    cashierName: row.actor_name || "Kasir",
    startTime: new Date(row.opened_at).toISOString(),
    initialCash: Number(cash.opening),
    cashSales: money(Number(revenue.cash)),
    qrisSales: money(Number(revenue.qris)),
    cardSales: money(Number(revenue.card)),
    eWalletSales: money(Number(revenue.total) - Number(revenue.cash) - Number(revenue.qris) - Number(revenue.card)),
    totalSales: Number(revenue.total),
    totalCashIn: Number(cash.cash_in),
    totalCashOut: Number(cash.cash_out),
    expectedCash: Number(cash.balance),
    totalOrders: Number(revenue.orders),
    status: row.status
  };
}

// services/pos/tenders.ts
async function applyTenders(db, scope, transactionId, tenders) {
  if (!Array.isArray(tenders) || !tenders.length || tenders.length > 100) throw new FinanceError(400, "INVALID_TENDERS");
  const txn = (await db.query("SELECT * FROM pos.transactions WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE", [transactionId, scope.tenantId, scope.merchantId, scope.outletId])).rows[0];
  if (!txn || ["VOIDED", "CANCELLED", "REFUNDED"].includes(txn.order_status)) throw new FinanceError(409, "TRANSACTION_NOT_PAYABLE");
  const seen = /* @__PURE__ */ new Set();
  for (const tender of tenders) {
    if (typeof tender.clientPaymentId !== "string" || !/^[-a-zA-Z0-9_:]{1,128}$/.test(tender.clientPaymentId) || seen.has(tender.clientPaymentId) || !["CASH", "QRIS", "DEBIT", "CREDIT", "TRANSFER", "E_WALLET", "SHOPEEPAY", "GOPAY", "OVO", "DANA", "QRIS_STATIC", "QRIS_DYNAMIC"].includes(tender.method) || !Number.isFinite(tender.amount) || tender.amount <= 0 || Math.abs(tender.amount * 100 - Math.round(tender.amount * 100)) > 1e-3 || !Number.isFinite(Date.parse(tender.createdAt))) throw new FinanceError(400, "INVALID_TENDER");
    seen.add(tender.clientPaymentId);
    const previous = (await db.query("SELECT * FROM pos.payments WHERE transaction_id=$1 AND client_payment_id=$2", [transactionId, tender.clientPaymentId])).rows[0];
    if (previous) {
      if (Number(previous.amount) !== tender.amount || previous.payment_method !== tender.method || new Date(previous.created_at).toISOString() !== new Date(tender.createdAt).toISOString()) throw new FinanceError(409, "TENDER_ID_CONFLICT");
      continue;
    }
    const paid = Number((await db.query("SELECT COALESCE(SUM(amount),0) AS amount FROM pos.payments WHERE transaction_id=$1 AND payment_status IN('PAID','SETTLED')", [transactionId])).rows[0].amount);
    if (Math.round((paid + tender.amount) * 100) > Math.round(Number(txn.total_amount) * 100)) throw new FinanceError(409, "TENDER_EXCEEDS_BALANCE");
    const row = (await db.query(`INSERT INTO pos.payments(tenant_id,merchant_id,outlet_id,transaction_id,client_payment_id,payment_method,payment_status,amount,gateway_provider,verification_origin,paid_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'PAID',$7,'MANUAL_CASH','CASHIER_RECORDED',$8,$8) RETURNING id`, [scope.tenantId, scope.merchantId, scope.outletId, transactionId, tender.clientPaymentId, tender.method, tender.amount, tender.createdAt])).rows[0];
    if (tender.method === "CASH") await db.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,actor_ref,note,occurred_at)
      VALUES($1,$2,$3,$4,'SALE',$5,$6,$7,'Pembayaran tunai split',$8)`, [scope.tenantId, scope.merchantId, scope.outletId, "payment:" + row.id, tender.amount, transactionId, scope.actorRef, tender.createdAt]);
  }
}

// src/config/legalNotices.ts
var LEGAL_NOTICE_VERSION = "2026-10-12-review-v1";

// services/pos/privacy.ts
var TYPES = /* @__PURE__ */ new Set(["ACCESS", "CORRECTION", "DELETION", "EXPORT", "CONSENT_WITHDRAWAL"]);
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var PrivacyError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function ownerScope(db, req) {
  const p = trustedPrincipal(req);
  if (!p || p.subject === "local-development") throw new PrivacyError(401, "UNAUTHENTICATED");
  const t = (await db.query("SELECT id FROM internal.tenants WHERE owner_user_ref=$1 AND is_active AND merged_into IS NULL ORDER BY created_at,id LIMIT 1", [p.subject])).rows[0];
  if (!t) throw new PrivacyError(403, "OWNER_REQUIRED");
  await db.query("SELECT set_config('app.tenant_id',$1,true)", [t.id]);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["privacy:" + t.id]);
  return { tenantId: t.id, actor: p.subject };
}
function registerPrivacyRoutes(app, db) {
  const route = (method, path, run) => app[method](path, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const data = await db.tx(async (c) => run(c, await ownerScope(c, req), req));
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(e instanceof PrivacyError ? e.status : 503).json({ ok: false, error: e instanceof PrivacyError ? e.message : "PRIVACY_WORKFLOW_UNAVAILABLE" });
    }
  });
  route("get", "/api/v1/privacy/requests", async (c, s) => ({ requests: (await c.query("SELECT id,client_request_id,request_type,message,status,created_at,updated_at FROM internal.privacy_requests WHERE tenant_id=$1 AND actor_ref=$2 ORDER BY created_at DESC LIMIT 50", [s.tenantId, s.actor])).rows }));
  route("post", "/api/v1/privacy/requests", async (c, s, req) => {
    const { clientRequestId, type, message } = req.body || {};
    if (!UUID2.test(clientRequestId || "") || !TYPES.has(type) || typeof message !== "string" || !message.trim() || message.length > 1e3) throw new PrivacyError(400, "INVALID_PRIVACY_REQUEST");
    const previous = (await c.query("SELECT id,status,request_type,message FROM internal.privacy_requests WHERE tenant_id=$1 AND actor_ref=$2 AND client_request_id=$3", [s.tenantId, s.actor, clientRequestId])).rows[0];
    if (previous) {
      if (previous.request_type !== type || previous.message !== message.trim()) throw new PrivacyError(409, "PRIVACY_REQUEST_ID_CONFLICT");
      return { requestId: previous.id, status: previous.status, replayed: true };
    }
    const count = (await c.query("SELECT count(*)::int n FROM internal.privacy_requests WHERE tenant_id=$1 AND created_at>now()-interval '24 hours'", [s.tenantId])).rows[0].n;
    if (count >= 10) throw new PrivacyError(429, "PRIVACY_REQUEST_RATE_LIMITED");
    const record = (await c.query("INSERT INTO internal.privacy_requests(tenant_id,actor_ref,client_request_id,request_type,message) VALUES($1,$2,$3,$4,$5) RETURNING id,status", [s.tenantId, s.actor, clientRequestId, type, message.trim()])).rows[0];
    await c.query("INSERT INTO internal.privacy_request_events(request_id,tenant_id,actor_ref,event,reason) VALUES($1,$2,$3,'RECEIVED','Owner submitted request; identity and retention review required')", [record.id, s.tenantId, s.actor]);
    return { requestId: record.id, status: record.status };
  });
  route("post", "/api/v1/privacy/notices", async (c, s, req) => {
    if (req.body?.termsVersion !== LEGAL_NOTICE_VERSION || req.body?.privacyVersion !== LEGAL_NOTICE_VERSION) throw new PrivacyError(400, "NOTICE_VERSION_REQUIRED");
    await c.query("INSERT INTO internal.legal_notice_acknowledgements(tenant_id,actor_ref,terms_version,privacy_version) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING", [s.tenantId, s.actor, LEGAL_NOTICE_VERSION]);
    return { version: LEGAL_NOTICE_VERSION };
  });
}

// src/lib/sync/orderOperations.ts
var ORDER_OPERATION_FIELDS = [
  "id",
  "notes",
  "laundryStatus",
  "laundryStage",
  "waNotifiedAt",
  "storageRack",
  "carwashStage",
  "vehiclePlate",
  "vehicleModel",
  "assignedCrew",
  "completionDate",
  "dropOffDate",
  "completionEstimate",
  "tableId",
  "tableName",
  "customer",
  "servedByStaffId",
  "servedByStaffName",
  "onlineChannel"
];

// src/lib/sync/operationalScope.ts
var operationalKinds = /* @__PURE__ */ new Set([
  "categories",
  "products",
  "tables",
  "customers",
  "order_operations",
  "held_orders",
  "inventory_logs",
  "promo_codes",
  "stock_items",
  "bundles",
  "attendance_logs",
  "kds_tickets",
  "carwash_queue",
  "bookings",
  "commission_rules",
  "payroll_slips",
  "sent_lifecycle_hooks",
  "store_settings",
  "users",
  "staff_members"
]);
var sectors3 = /* @__PURE__ */ new Set(["FNB", "LAUNDRY", "RETAIL", "CARWASH", "BARBERSHOP"]);
var presets = { fnb: "FNB", ld: "LAUNDRY", rt: "RETAIL", cw: "CARWASH", bb: "BARBERSHOP" };
function presetSector(kind, id) {
  if (typeof id !== "string") return;
  const pattern = kind === "products" ? /^prod-(fnb|ld|rt|cw|bb)-\d+$/ : kind === "categories" ? /^cat-(fnb|ld|rt|cw|bb)-\d+$/ : kind === "tables" ? /^tbl-(ld|rt|cw|bb)-[md]?\d+$/ : null;
  const match = pattern?.exec(id);
  if (match) return presets[match[1]];
  if (kind === "tables" && /^tbl-\d+$/.test(id)) return "FNB";
}
function operationalScopeIssue(owner, sector, kind, id, value, businessId = `${owner}_${sector}`) {
  if (!operationalKinds.has(kind) || kind === "users" || kind === "staff_members") return null;
  const row = value && typeof value === "object" ? value : {};
  if (kind === "store_settings" && typeof row.storeMode === "string") {
    const expected = sector === "FNB" ? "FNB" : sector === "RETAIL" ? "RETAIL" : "SERVICE";
    if (row.storeMode !== expected) return "WRONG_STORE_MODE:" + row.storeMode;
  }
  for (const field of ["businessSector", "sector"]) {
    if (typeof row[field] === "string" && sectors3.has(row[field]) && row[field] !== sector) return `WRONG_SECTOR:${row[field]}`;
  }
  if (typeof row.businessId === "string" && row.businessId !== businessId)
    return "WRONG_BUSINESS:" + row.businessId;
  const references = [[kind, id], ["products", row.productId], ["categories", row.categoryId], ["tables", row.tableId]];
  for (const field of ["items", "recipeIngredients"]) if (Array.isArray(row[field])) {
    for (const item of row[field]) {
      if (item && typeof item === "object") {
        const value2 = item;
        references.push(["products", value2.productId], ["products", value2.product?.id]);
      }
    }
  }
  for (const [kind2, ref] of references) {
    const source = presetSector(kind2, ref);
    if (source && source !== sector) return `WRONG_SECTOR:${source}`;
  }
  return null;
}

// services/pos/laborProjection.ts
var text2 = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
var timestamp3 = (value, optional = false) => {
  if (optional && (value === void 0 || value === null || value === "")) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new BillingError(422, "INVALID_LABOR_DATE");
  return new Date(value).toISOString();
};
var money2 = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new BillingError(422, "INVALID_PAYROLL_AMOUNT");
  return value;
};
async function projectLabor(c, scope, sector, op) {
  if (op.kind !== "attendance_logs" && op.kind !== "payroll_slips") return;
  const attendance = op.kind === "attendance_logs";
  const table = attendance ? "pos.staff_attendances" : "pos.staff_payrolls";
  const clientColumn = attendance ? "client_attendance_id" : "client_slip_id";
  const existing = (await c.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND ${clientColumn}=$2 FOR UPDATE`, [scope.tenantId, op.recordId])).rows[0];
  if (existing && existing.merchant_id !== scope.merchantId) throw new BillingError(409, "LABOR_PROJECTION_OWNER_CONFLICT");
  if (op.deleted) {
    if (!attendance && existing?.status === "PAID") throw new BillingError(409, "PAID_PAYROLL_IMMUTABLE");
    return;
  }
  const value = op.value;
  if (value.id !== op.recordId || !text2(value.staffId, 96) || !text2(value.staffName, 120)) throw new BillingError(422, "INVALID_LABOR_RECORD");
  if (attendance) {
    if (!["CLOCKED_IN", "CLOCKED_OUT"].includes(String(value.status))) throw new BillingError(422, "INVALID_ATTENDANCE_STATUS");
    const started = timestamp3(value.clockInTime), ended = timestamp3(value.clockOutTime, true);
    if (value.status === "CLOCKED_OUT" && !ended || ended && Date.parse(ended) < Date.parse(started)) throw new BillingError(422, "INVALID_ATTENDANCE_DATE");
    if (typeof value.branchId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.branchId)) throw new BillingError(422, "ATTENDANCE_OUTLET_REQUIRED");
    const outlet = (await c.query("SELECT id FROM internal.outlets WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3", [value.branchId, scope.tenantId, scope.merchantId])).rows[0];
    if (!outlet) throw new BillingError(403, "ATTENDANCE_OUTLET_NOT_OWNED");
    if (existing && (existing.staff_id !== value.staffId || existing.outlet_id !== outlet.id || new Date(existing.clock_in_at).toISOString() !== started)) throw new BillingError(409, "ATTENDANCE_IDENTITY_IMMUTABLE");
    if (existing?.clock_out_at && (!ended || new Date(existing.clock_out_at).toISOString() !== ended)) throw new BillingError(409, "CLOSED_ATTENDANCE_IMMUTABLE");
    if (existing && existing.status === value.status && (existing.clock_out_at ? new Date(existing.clock_out_at).toISOString() : null) === ended && existing.shift_notes === (text2(value.shiftNotes, 500) || null) && JSON.stringify(existing.clock_out_geo) === JSON.stringify(value.clockOutGeo || null)) return;
    const saved2 = await c.query(
      `INSERT INTO pos.staff_attendances
      (tenant_id,merchant_id,outlet_id,client_attendance_id,staff_id,staff_name,staff_role,clock_in_at,clock_out_at,
       shift_notes,status,branch_id,branch_name,clock_in_geo,clock_out_geo,business_sector)
      VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$3::text,$12,$13::jsonb,$14::jsonb,$15)
      ON CONFLICT(tenant_id,client_attendance_id) DO UPDATE SET
        clock_out_at=EXCLUDED.clock_out_at,shift_notes=EXCLUDED.shift_notes,status=EXCLUDED.status,
        clock_out_geo=EXCLUDED.clock_out_geo,updated_at=now()
      WHERE pos.staff_attendances.merchant_id=EXCLUDED.merchant_id RETURNING id`,
      [
        scope.tenantId,
        scope.merchantId,
        outlet.id,
        op.recordId,
        value.staffId,
        text2(value.staffName, 120),
        text2(value.staffRole, 64) || "STAFF",
        started,
        ended,
        text2(value.shiftNotes, 500) || null,
        value.status,
        text2(value.branchName, 100),
        JSON.stringify(value.clockInGeo || null),
        JSON.stringify(value.clockOutGeo || null),
        sector
      ]
    );
    if (!saved2.rows.length) throw new BillingError(409, "LABOR_PROJECTION_OWNER_CONFLICT");
    return;
  }
  if (!["DRAFT", "PAID"].includes(String(value.status)) || typeof value.periodMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.periodMonth) || !Number.isSafeInteger(value.daysAttended) || Number(value.daysAttended) < 0) throw new BillingError(422, "INVALID_PAYROLL_RECORD");
  const start = timestamp3(value.periodStart), end = timestamp3(value.periodEnd), paid = timestamp3(value.paidAt, true);
  if (end < start || value.status === "PAID" && !paid) throw new BillingError(422, "INVALID_PAYROLL_DATE");
  const fields = ["baseSalary", "allowance", "individualCommission", "teamPoolCommission", "dailyTargetBonus", "grossEarnings", "deductions", "netSalary"];
  const amounts = fields.map((field) => money2(value[field]));
  const columns = ["base_salary", "allowance", "individual_commission", "team_pool_commission", "daily_target_bonus", "gross_earnings", "deductions", "net_salary"];
  if (existing?.status === "PAID") {
    if (value.status !== "PAID" || existing.staff_id !== value.staffId || existing.period_month !== value.periodMonth || new Date(existing.period_start).toISOString().slice(0, 10) !== start.slice(0, 10) || new Date(existing.period_end).toISOString().slice(0, 10) !== end.slice(0, 10) || new Date(existing.paid_at).toISOString() !== paid || existing.payment_method !== (text2(value.paymentMethod, 64) || null) || Number(existing.days_attended) !== Number(value.daysAttended) || columns.some((column, index) => Number(existing[column]) !== amounts[index]))
      throw new BillingError(409, "PAID_PAYROLL_IMMUTABLE");
    return;
  }
  const saved = await c.query(
    `INSERT INTO pos.staff_payrolls
    (tenant_id,merchant_id,client_slip_id,staff_id,staff_name,staff_role,period_month,period_start,period_end,days_attended,
     base_salary,allowance,individual_commission,team_pool_commission,daily_target_bonus,gross_earnings,deductions,net_salary,
     status,paid_at,payment_method,notes,business_sector)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT(tenant_id,client_slip_id) DO UPDATE SET
      staff_id=EXCLUDED.staff_id,staff_name=EXCLUDED.staff_name,staff_role=EXCLUDED.staff_role,
      period_month=EXCLUDED.period_month,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,days_attended=EXCLUDED.days_attended,
      base_salary=EXCLUDED.base_salary,allowance=EXCLUDED.allowance,individual_commission=EXCLUDED.individual_commission,
      team_pool_commission=EXCLUDED.team_pool_commission,daily_target_bonus=EXCLUDED.daily_target_bonus,
      gross_earnings=EXCLUDED.gross_earnings,deductions=EXCLUDED.deductions,net_salary=EXCLUDED.net_salary,
      status=EXCLUDED.status,paid_at=EXCLUDED.paid_at,payment_method=EXCLUDED.payment_method,notes=EXCLUDED.notes,updated_at=now()
    WHERE pos.staff_payrolls.merchant_id=EXCLUDED.merchant_id AND pos.staff_payrolls.status<>'PAID' RETURNING id`,
    [
      scope.tenantId,
      scope.merchantId,
      op.recordId,
      value.staffId,
      text2(value.staffName, 120),
      text2(value.staffRole, 64) || "STAFF",
      value.periodMonth,
      start.slice(0, 10),
      end.slice(0, 10),
      value.daysAttended,
      ...amounts,
      value.status,
      paid,
      text2(value.paymentMethod, 64) || null,
      text2(value.notes, 500) || null,
      sector
    ]
  );
  if (!saved.rows.length) throw new BillingError(409, "LABOR_PROJECTION_OWNER_CONFLICT");
}

// services/pos/sharedState.ts
var SECTOR_SET = new Set(SECTORS2);
var GLOBAL_KINDS = /* @__PURE__ */ new Set(["users", "staff_members"]);
var SECTOR_KINDS = /* @__PURE__ */ new Set([
  "categories",
  "products",
  "tables",
  "customers",
  "order_operations",
  "held_orders",
  "inventory_logs",
  "promo_codes",
  "stock_items",
  "bundles",
  "attendance_logs",
  "kds_tickets",
  "carwash_queue",
  "bookings",
  "commission_rules",
  "payroll_slips",
  "sent_lifecycle_hooks",
  "store_settings"
]);
var ID_RE = /^[^\x00-\x1f\x7f]{1,128}$/;
var HISTORY_WINDOWS = {
  inventory_logs: { newest: 2e3 },
  kds_tickets: { days: 3 },
  order_operations: { days: 120 },
  bookings: { days: 180 },
  carwash_queue: { days: 180 },
  attendance_logs: { days: 400 }
};
var STATE_PAGE_SIZE = 5e3;
var SCOPE_SQL = (a) => `${a}.tenant_id=$1 AND ((${a}.scope='GLOBAL' AND ${a}.merchant_id IS NULL) OR (${a}.scope=ANY($2::text[]) AND ${a}.merchant_id=$3))
  AND ($4::text[] IS NULL OR ${a}.kind=ANY($4::text[]))`;
var WINDOW_SQL = `AND (r.kind <> ALL(ARRAY[${Object.keys(HISTORY_WINDOWS).map((k) => `'${k}'`).join(",")}]::text[])
  ${Object.entries(HISTORY_WINDOWS).map(([kind, w]) => w.days ? `OR (r.kind='${kind}' AND r.updated_at > now() - interval '${w.days} days')` : `OR (r.kind='${kind}' AND (r.scope,r.record_id) IN (SELECT l.scope,l.record_id FROM pos.shared_state_records l
        WHERE ${SCOPE_SQL("l")} AND l.kind='${kind}' ORDER BY l.updated_at DESC LIMIT ${w.newest}))`).join("\n  ")})`;
var encodeCursor = (row) => Buffer.from(JSON.stringify([row.scope, row.kind, row.record_id])).toString("base64url");
function decodeCursor(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 600) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}
var CORE_KINDS = /* @__PURE__ */ new Set([
  "store_settings",
  "users",
  "staff_members",
  "categories",
  "products",
  "bundles",
  "promo_codes",
  "stock_items",
  "tables",
  "customers",
  "commission_rules"
]);
var StateConflict = class extends Error {
  constructor(kind, recordId) {
    super("STATE_CONFLICT");
    this.kind = kind;
    this.recordId = recordId;
  }
};
function validOperations(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const seen = /* @__PURE__ */ new Set();
  const operations = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw;
    if (typeof r.kind !== "string" || !(GLOBAL_KINDS.has(r.kind) || SECTOR_KINDS.has(r.kind)) || typeof r.recordId !== "string" || !ID_RE.test(r.recordId) || !Number.isSafeInteger(r.baseRevision) || Number(r.baseRevision) < 0 || typeof r.deleted !== "boolean") return null;
    const key = `${r.kind}\0${r.recordId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (!r.deleted && (!r.value || typeof r.value !== "object" || Array.isArray(r.value))) return null;
    if (r.kind === "users" && !r.deleted) {
      const user = r.value;
      if (user.id !== r.recordId || !["MANAGER", "CASHIER"].includes(String(user.role)) || !["ACTIVE", "INACTIVE"].includes(String(user.status)) || typeof user.pin !== "string" || !/^sha256\$[^$]{8,128}\$[a-f0-9]{64}$/i.test(user.pin)) return null;
    }
    if (r.kind === "products" && !r.deleted) {
      const product = r.value;
      if (product.id !== r.recordId || typeof product.name !== "string" || !product.name.trim() || product.name.length > 100 || !Number.isFinite(product.price) || Number(product.price) < 0 || !Number.isFinite(product.costPrice) || Number(product.costPrice) < 0) return null;
    }
    if (r.kind === "store_settings" && !r.deleted) {
      const settings = r.value;
      if ("subscription" in settings || "branches" in settings || "activeBranchId" in settings || "logoUrl" in settings || "registeredTerminalId" in settings) return null;
    }
    if (r.kind === "order_operations" && !r.deleted) {
      const allowed = new Set(ORDER_OPERATION_FIELDS);
      if (Object.keys(r.value).some((key2) => !allowed.has(key2))) return null;
      if (r.value.id !== r.recordId) return null;
    }
    if (r.deleted && r.value !== null) return null;
    if (JSON.stringify(r.value).length > 64e3) return null;
    operations.push({
      kind: r.kind,
      recordId: r.recordId,
      baseRevision: Number(r.baseRevision),
      value: r.value,
      deleted: r.deleted,
      owner: typeof r.owner === "string" ? r.owner : void 0,
      sector: typeof r.sector === "string" ? r.sector : void 0
    });
  }
  return operations;
}
function registerSharedStateRoutes(app, db) {
  app.get("/api/v1/sync/state", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const sector = String(req.query.sector || "");
    if (!SECTOR_SET.has(sector)) return res.status(400).json({ ok: false, error: "INVALID_SECTOR" });
    const kinds = req.query.kinds === void 0 ? null : typeof req.query.kinds === "string" ? [...new Set(req.query.kinds.split(","))] : [];
    if (kinds && (!kinds.length || kinds.length > 25 || kinds.some((kind) => !GLOBAL_KINDS.has(kind) && !SECTOR_KINDS.has(kind))))
      return res.status(400).json({ ok: false, error: "INVALID_STATE_KINDS" });
    const paged = req.query.paged === "1";
    const cursor = paged && req.query.cursor !== void 0 ? decodeCursor(req.query.cursor) : null;
    if (paged && req.query.cursor !== void 0 && !cursor) return res.status(400).json({ ok: false, error: "INVALID_STATE_CURSOR" });
    try {
      const scope = await resolveBusinessScope(db, principal.subject, sector, req.query.businessId);
      if (!scope) return res.json({ ok: true, ready: false, records: [] });
      const snapshot = await db.tx(async (c) => {
        await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await c.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",
          [scope.tenantId, scope.merchantId]
        );
        const parameters2 = [scope.tenantId, [sector, "BUSINESS:" + scope.merchantId], scope.merchantId, kinds];
        const stamp = await hasSchemaFeature(c, "sharedStateVersions") ? await c.query(`SELECT md5(COALESCE(string_agg(v.scope||'/'||v.kind||'/'||v.version,'|' ORDER BY v.scope,v.kind),'')) AS version
          FROM pos.shared_state_versions v WHERE v.tenant_id=$1 AND
          ((v.scope='GLOBAL' AND v.merchant_key='00000000-0000-0000-0000-000000000000'::uuid) OR (v.scope=ANY($2::text[]) AND v.merchant_key=$3))
          AND ($4::text[] IS NULL OR v.kind=ANY($4::text[]))`, parameters2) : await c.query(`SELECT md5(COALESCE(string_agg(
          jsonb_build_array(scope,kind,record_id,revision,deleted,updated_at,quarantine_reason)::text,
          '|' ORDER BY scope,kind,record_id),'')) AS version
          FROM pos.shared_state_records WHERE tenant_id=$1 AND
          ((scope='GLOBAL' AND merchant_id IS NULL) OR (scope=ANY($2::text[]) AND merchant_id=$3))
          AND ($4::text[] IS NULL OR kind=ANY($4::text[]))`, parameters2);
        const version = stamp.rows[0].version;
        if (req.query.knownVersion === version && !req.query.legacyCandidates && !cursor) return { rows: [], version, unchanged: true };
        const columns = "r.scope,r.kind,r.record_id,r.value,r.revision,r.deleted,r.updated_at,r.recovery_value,r.quarantine_reason";
        const result = paged ? await c.query(`SELECT ${columns} FROM pos.shared_state_records r WHERE ${SCOPE_SQL("r")} ${WINDOW_SQL}
              AND ($5::text IS NULL OR (r.scope,r.kind,r.record_id) > ($5::text,$6::text,$7::text))
              ORDER BY r.scope,r.kind,r.record_id LIMIT $8`, [...parameters2, cursor?.[0] ?? null, cursor?.[1] ?? null, cursor?.[2] ?? null, STATE_PAGE_SIZE + 1]) : await c.query(`SELECT ${columns} FROM pos.shared_state_records r WHERE ${SCOPE_SQL("r")} ${WINDOW_SQL}
              ORDER BY CASE WHEN r.kind=ANY($5::text[]) THEN 0 ELSE 1 END,r.updated_at DESC,r.scope,r.kind,r.record_id LIMIT 10001`, [...parameters2, [...CORE_KINDS]]);
        return { ...result, version, unchanged: false };
      });
      const { rows } = snapshot;
      if (snapshot.unchanged) return res.json({ ok: true, ready: true, unchanged: true, version: snapshot.version, kinds, business: { businessId: scope.merchantId, tenantId: scope.tenantId, name: scope.businessName, sector }, records: [] });
      let candidates = [];
      if (!cursor) try {
        const parsed = JSON.parse(String(req.query.legacyCandidates || "[]"));
        if (Array.isArray(parsed) && parsed.length <= 100) candidates = parsed.filter((r) => SECTOR_KINDS.has(r?.kind) && r.kind !== "store_settings" && typeof r.recordId === "string" && ID_RE.test(r.recordId));
      } catch {
      }
      const otherMerchants = candidates.length ? (await db.query(`SELECT id,business_sector FROM internal.merchants WHERE tenant_id=$1 AND business_sector<>$2`, [scope.tenantId, sector])).rows : [];
      const foreignRecords = (await Promise.all(otherMerchants.map(async (merchant) => {
        const result = await db.tx(async (c) => {
          await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [scope.tenantId, merchant.id]);
          return c.query(`SELECT r.scope,r.kind,r.record_id,r.value FROM pos.shared_state_records r
          JOIN jsonb_to_recordset($3::jsonb) AS candidate(kind text,"recordId" text) ON r.kind=candidate.kind AND r.record_id=candidate."recordId"
          WHERE r.tenant_id=$1 AND r.merchant_id=$2 AND r.scope<>'GLOBAL' AND NOT r.deleted`, [scope.tenantId, merchant.id, JSON.stringify(candidates)]);
        });
        return result.rows.map((r) => ({ scope: merchant.business_sector, kind: r.kind, recordId: r.record_id, value: r.value }));
      }))).flat();
      return res.json({
        ok: true,
        ready: true,
        version: snapshot.version,
        scopeProof: true,
        foreignRecords,
        kinds,
        business: { businessId: scope.merchantId, tenantId: scope.tenantId, name: scope.businessName, sector },
        ...paged ? { truncated: false, nextCursor: rows.length > STATE_PAGE_SIZE ? encodeCursor(rows[STATE_PAGE_SIZE - 1]) : null } : { truncated: rows.length > 1e4 },
        records: rows.slice(0, paged ? STATE_PAGE_SIZE : 1e4).map((r) => ({
          scope: r.scope === "GLOBAL" ? "GLOBAL" : sector,
          kind: r.kind,
          recordId: r.record_id,
          value: r.value,
          revision: Number(r.revision),
          deleted: r.deleted,
          updatedAt: r.updated_at,
          ...r.recovery_value ? { recoveryValue: r.recovery_value, quarantineReason: r.quarantine_reason } : {}
        }))
      });
    } catch (error) {
      if (error instanceof BusinessScopeError) return res.status(error.status).json({ ok: false, error: error.message });
      return res.status(503).json({ ok: false, error: "STATE_UNAVAILABLE" });
    }
  });
  app.post("/api/v1/sync/state", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const sector = String(req.body?.sector || "");
    const requestedOutletId = typeof req.body?.outletId === "string" && /^[0-9a-f-]{36}$/i.test(req.body.outletId) ? req.body.outletId : null;
    const operations = validOperations(req.body?.operations);
    if (!SECTOR_SET.has(sector) || !operations) return res.status(400).json({ ok: false, error: "INVALID_STATE_REQUEST" });
    try {
      const scope = await resolveBusinessScope(db, principal.subject, sector, req.body?.businessId);
      if (!scope) return res.status(409).json({ ok: false, error: "BUSINESS_SETUP_REQUIRED" });
      const versions = await db.tx(async (c) => {
        await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [scope.tenantId]);
        await assertTenantWritable(c, scope.tenantId);
        await c.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",
          [scope.tenantId, scope.merchantId]
        );
        const free = await freePlanState(c, scope.tenantId);
        assertFreeScope(free, sector, []);
        if (free.free && !(await c.query(
          "SELECT 1 FROM internal.outlets WHERE id=$1 AND merchant_id=$2 AND tenant_id=$3 AND is_active",
          [free.selection?.branchId, scope.merchantId, scope.tenantId]
        )).rows.length) throw new FreePlanAccessError("FREE_BRANCH_MISMATCH");
        const result = [];
        const changed = /* @__PURE__ */ new Set();
        const conflicts = [];
        const rejected = [];
        let productOutlet = null;
        if (operations.some((op) => op.kind === "products")) {
          const outlet = await c.query(
            `SELECT id FROM internal.outlets WHERE tenant_id=$1 AND merchant_id=$2
            AND is_active AND ($3::uuid IS NULL OR id=$3::uuid) ORDER BY created_at,id LIMIT 1`,
            [scope.tenantId, scope.merchantId, free.free ? free.selection?.branchId : requestedOutletId]
          );
          productOutlet = outlet.rows[0]?.id || null;
        }
        for (const op of operations) {
          const issue = op.owner && op.owner !== principal.subject ? "WRONG_OWNER" : op.sector && op.sector !== sector ? "WRONG_SECTOR" : operationalScopeIssue(principal.subject, sector, op.kind, op.recordId, op.value, scope.transportRef || scope.merchantId);
          if (issue) {
            rejected.push({ kind: op.kind, recordId: op.recordId, error: "WRONG_SCOPE", detail: issue });
            continue;
          }
          await c.exec("SAVEPOINT operational_record");
          try {
            if (free.free && (op.kind === "users" || op.kind === "staff_members")) throw new FreePlanAccessError("FREE_OWNER_ONLY");
            if (op.kind === "products" && !productOutlet) throw new BillingError(409, "OUTLET_SETUP_REQUIRED");
            if (op.kind === "products" && !op.deleted) assertFreeScope(free, sector, [op.recordId]);
            if (op.kind === "products" && free.free) {
              if (requestedOutletId && requestedOutletId !== productOutlet) throw new FreePlanAccessError("FREE_BRANCH_MISMATCH");
              const existing = await c.query(`SELECT outlet_id FROM pos.products WHERE tenant_id=$1 AND merchant_id=$2 AND external_ref=$3 AND NOT sync_quarantined`, [scope.tenantId, scope.merchantId, op.recordId]);
              if (existing.rows.some((r2) => r2.outlet_id !== productOutlet)) throw new FreePlanAccessError("FREE_PRODUCT_BRANCH_MISMATCH");
            }
            const docScope = GLOBAL_KINDS.has(op.kind) ? "GLOBAL" : scope.legacyAlias ? sector : "BUSINESS:" + scope.merchantId;
            const merchantId = docScope === "GLOBAL" ? null : scope.merchantId;
            const r = await c.query(`INSERT INTO pos.shared_state_records
            (tenant_id,merchant_id,scope,kind,record_id,value,revision,deleted)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,1,$7)
            ON CONFLICT(tenant_id,scope,kind,record_id) DO UPDATE SET
              value=EXCLUDED.value,deleted=EXCLUDED.deleted,quarantine_reason=NULL,
              revision=pos.shared_state_records.revision+1,updated_at=now()
            WHERE pos.shared_state_records.revision=$8
              AND pos.shared_state_records.merchant_id IS NOT DISTINCT FROM EXCLUDED.merchant_id
            RETURNING revision`, [
              scope.tenantId,
              merchantId,
              docScope,
              op.kind,
              op.recordId,
              op.deleted ? null : JSON.stringify(op.value),
              op.deleted,
              op.baseRevision
            ]);
            let replayed = false;
            if (!r.rows.length) {
              replayed = true;
              r.rows = (await c.query(
                `SELECT revision FROM pos.shared_state_records WHERE tenant_id=$1 AND scope=$2
              AND kind=$3 AND record_id=$4 AND merchant_id IS NOT DISTINCT FROM $5::uuid
              AND value IS NOT DISTINCT FROM $6::jsonb AND deleted=$7 AND quarantine_reason IS NULL`,
                [scope.tenantId, docScope, op.kind, op.recordId, merchantId, op.deleted ? null : JSON.stringify(op.value), op.deleted]
              )).rows;
            }
            if (!r.rows.length || !replayed && op.baseRevision !== 0 && Number(r.rows[0].revision) === 1)
              throw new StateConflict(op.kind, op.recordId);
            await projectLabor(c, scope, sector, op);
            if (replayed) {
              result.push({ kind: op.kind, recordId: op.recordId, revision: Number(r.rows[0].revision) });
              await c.exec("RELEASE SAVEPOINT operational_record");
              continue;
            }
            const settingsName = op.value?.storeName;
            if (op.kind === "store_settings" && !op.deleted && typeof settingsName === "string" && settingsName.trim()) {
              await c.query(
                "UPDATE internal.merchants SET name=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [scope.tenantId, scope.merchantId, settingsName.trim().slice(0, 100)]
              );
            }
            if (op.kind === "customers" && op.deleted) {
              await c.query(
                "UPDATE pos.customers SET archived_at=now(),updated_at=now() WHERE tenant_id=$1 AND merchant_id=$2 AND external_ref=$3",
                [scope.tenantId, scope.merchantId, op.recordId]
              );
            }
            if (op.kind === "customers" && !op.deleted) {
              const customer = op.value;
              if (typeof customer.name !== "string" || !customer.name.trim()) throw new Error("INVALID_CUSTOMER");
              const saved = await c.query(
                `INSERT INTO pos.customers
              (tenant_id,merchant_id,external_ref,name,phone,email,address,notes)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8)
              ON CONFLICT(tenant_id,merchant_id,external_ref) DO UPDATE SET
                name=EXCLUDED.name,phone=EXCLUDED.phone,email=EXCLUDED.email,
                address=EXCLUDED.address,notes=EXCLUDED.notes,archived_at=null,updated_at=now()
              WHERE pos.customers.merchant_id=EXCLUDED.merchant_id RETURNING id`,
                [
                  scope.tenantId,
                  scope.merchantId,
                  op.recordId,
                  customer.name.trim().slice(0, 120),
                  String(customer.phone || "").slice(0, 32) || null,
                  String(customer.email || "").slice(0, 120) || null,
                  String(customer.address || "").slice(0, 255) || null,
                  String(customer.notes || "").slice(0, 500) || null
                ]
              );
              if (!saved.rows.length) throw new StateConflict(op.kind, op.recordId);
            }
            if (op.kind === "products") {
              if (op.deleted) {
                await c.query(
                  `UPDATE pos.products SET is_available=false,catalog_synced_at=now()
                WHERE tenant_id=$1 AND merchant_id=$2 AND external_ref=$3`,
                  [scope.tenantId, scope.merchantId, op.recordId]
                );
              } else {
                const p = op.value;
                const saved = await c.query(
                  `INSERT INTO pos.products
                (id,tenant_id,merchant_id,outlet_id,name,sku,price,cost_price,is_available,
                 business_sector,business_id,category_name,description,unit,external_ref,catalog_synced_at)
                VALUES(uuidv7(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
                ON CONFLICT(tenant_id,merchant_id,external_ref) WHERE external_ref IS NOT NULL AND NOT sync_quarantined DO UPDATE SET
                  name=EXCLUDED.name,sku=EXCLUDED.sku,price=EXCLUDED.price,
                  cost_price=EXCLUDED.cost_price,is_available=EXCLUDED.is_available,
                  category_name=EXCLUDED.category_name,description=EXCLUDED.description,
                  unit=EXCLUDED.unit,catalog_synced_at=now()
                WHERE pos.products.business_sector=EXCLUDED.business_sector RETURNING id`,
                  [
                    scope.tenantId,
                    scope.merchantId,
                    productOutlet,
                    String(p.name).trim(),
                    String(p.sku || op.recordId).slice(0, 50),
                    Number(p.price),
                    Number(p.costPrice),
                    p.isAvailable !== false,
                    sector,
                    scope.transportRef || scope.merchantId,
                    String(p.categoryName || "Lainnya").slice(0, 100),
                    String(p.description || "").slice(0, 300),
                    String(p.unit || "pcs").slice(0, 20),
                    op.recordId
                  ]
                );
                if (!saved.rows.length) throw new StateConflict(op.kind, op.recordId);
              }
            }
            result.push({ kind: op.kind, recordId: op.recordId, revision: Number(r.rows[0].revision) });
            changed.add(op.kind + "\0" + op.recordId);
            await c.exec("RELEASE SAVEPOINT operational_record");
          } catch (error) {
            await c.exec("ROLLBACK TO SAVEPOINT operational_record");
            await c.exec("RELEASE SAVEPOINT operational_record");
            if (error instanceof StateConflict) conflicts.push({ kind: op.kind, recordId: op.recordId, error: "STATE_CONFLICT" });
            else if (error instanceof BillingError || error instanceof FreePlanAccessError)
              rejected.push({ kind: op.kind, recordId: op.recordId, error: error.message });
            else if (["23505", "23514", "22001", "22P02"].includes(String(error?.code)))
              rejected.push({ kind: op.kind, recordId: op.recordId, error: "INVALID_OPERATION" });
            else throw error;
          }
        }
        const accepted = operations.filter((op) => changed.has(op.kind + "\0" + op.recordId));
        const kinds = [...new Set(accepted.map((op) => op.kind))];
        if (accepted.length)
          await writeActivity(c, {
            merchantId: scope.merchantId,
            tenantId: scope.tenantId,
            businessSector: sector,
            businessId: scope.merchantId,
            appModule: "SYNC",
            eventType: "SHARED_STATE_CHANGED",
            actorUserId: principal.subject,
            actorName: principal.email || null,
            summary: `${accepted.length} perubahan data operasional`,
            detail: { kinds, records: accepted.map((op) => ({ kind: op.kind, id: op.recordId, deleted: op.deleted })) }
          });
        return { versions: result, conflicts, rejected };
      });
      return res.json({ ok: true, ...versions });
    } catch (error) {
      if (error instanceof BusinessScopeError) return res.status(error.status).json({ ok: false, error: error.message });
      if (error instanceof StateConflict) return res.status(409).json({ ok: false, error: "STATE_CONFLICT", kind: error.kind, recordId: error.recordId });
      if (error instanceof FreePlanAccessError) return res.status(403).json({ ok: false, error: error.message });
      if (error instanceof BillingError) return res.status(error.status).json({ ok: false, error: error.message });
      return res.status(503).json({ ok: false, error: "STATE_UNAVAILABLE" });
    }
  });
}

// services/pos/reports.ts
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DATE = /^\d{4}-\d{2}-\d{2}$/;
var PAYMENT_METHODS = /* @__PURE__ */ new Set(["CASH", "QRIS", "QRIS_DYNAMIC", "QRIS_STATIC", "DEBIT", "CREDIT", "DEBIT_CARD", "CREDIT_CARD", "CARD", "TRANSFER", "E_WALLET", "EWALLET", "OTHER", "SHOPEEPAY", "GOPAY", "OVO", "DANA", "SPLIT"]);
var numeric = (value) => Number(value ?? 0);
var money3 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
var iso = (value) => new Date(String(value)).toISOString();
var ReportRequestError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
function stringQuery(value, name) {
  if (value === void 0 || value === "") return null;
  if (typeof value !== "string") throw new ReportRequestError(400, `INVALID_${name}`);
  return value.trim() || null;
}
function dateQuery(value, name) {
  const date2 = stringQuery(value, name);
  if (!date2) return null;
  if (!DATE.test(date2) || !Number.isFinite(Date.parse(`${date2}T00:00:00Z`)) || (/* @__PURE__ */ new Date(`${date2}T00:00:00Z`)).toISOString().slice(0, 10) !== date2) {
    throw new ReportRequestError(400, `INVALID_${name}`);
  }
  return date2;
}
function parseReportFilter(query) {
  const outletId = stringQuery(query.outletId, "OUTLET_ID");
  if (!outletId || !UUID3.test(outletId)) throw new ReportRequestError(400, "INVALID_OUTLET_ID");
  const merchantId = stringQuery(query.merchantId, "MERCHANT_ID");
  const tenantId = stringQuery(query.tenantId, "TENANT_ID");
  if (merchantId && !UUID3.test(merchantId) || tenantId && !UUID3.test(tenantId)) throw new ReportRequestError(400, "INVALID_SCOPE");
  const sector = stringQuery(query.sector, "SECTOR");
  if (sector && !SECTORS2.includes(sector)) throw new ReportRequestError(400, "INVALID_SECTOR");
  const from = dateQuery(query.from, "FROM_DATE");
  const to = dateQuery(query.to, "TO_DATE");
  if (from && to && from > to) throw new ReportRequestError(400, "INVALID_DATE_RANGE");
  const requestedZone = stringQuery(query.timezone, "TIMEZONE") || "Asia/Jakarta";
  let timezone;
  try {
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(requestedZone) || requestedZone.length > 100) throw new Error();
    timezone = new Intl.DateTimeFormat("en", { timeZone: requestedZone }).resolvedOptions().timeZone;
  } catch {
    throw new ReportRequestError(400, "INVALID_TIMEZONE");
  }
  const paymentMethod = stringQuery(query.paymentMethod, "PAYMENT_METHOD");
  if (paymentMethod && paymentMethod !== "ALL" && !PAYMENT_METHODS.has(paymentMethod)) throw new ReportRequestError(400, "INVALID_PAYMENT_METHOD");
  const search = stringQuery(query.search, "SEARCH");
  if (search && search.length > 120) throw new ReportRequestError(400, "SEARCH_TOO_LONG");
  const trendRaw = stringQuery(query.trend, "TREND");
  const trendDays = trendRaw === null ? null : Number(trendRaw);
  if (trendDays !== null && (!Number.isInteger(trendDays) || trendDays < 2 || trendDays > 31)) throw new ReportRequestError(400, "INVALID_TREND");
  return {
    outletId,
    merchantId,
    tenantId,
    sector,
    from,
    to,
    timezone,
    timezoneExplicit: Boolean(query.timezone),
    paymentMethod: paymentMethod === "ALL" ? null : paymentMethod,
    search,
    trendDays
  };
}
async function scopeFor2(db, subject, filter) {
  const { rows } = await db.query(
    `SELECT o.tenant_id,o.merchant_id,o.id AS outlet_id,m.business_sector,ms.timezone
    FROM internal.outlets o
    JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    JOIN internal.tenants t ON t.id=o.tenant_id
    LEFT JOIN internal.merchant_settings ms ON ms.merchant_id=m.id
    WHERE o.id=$1 AND t.owner_user_ref=$2
      AND ($3::uuid IS NULL OR m.id=$3) AND ($4::uuid IS NULL OR t.id=$4)
      AND ($5::text IS NULL OR m.business_sector=$5)`,
    [filter.outletId, subject, filter.merchantId, filter.tenantId, filter.sector]
  );
  if (!rows.length) throw new ReportRequestError(403, "REPORT_SCOPE_FORBIDDEN");
  const row = rows[0];
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [row.tenant_id, row.merchant_id]);
  return {
    tenantId: row.tenant_id,
    merchantId: row.merchant_id,
    outletId: row.outlet_id,
    sector: row.business_sector,
    from: filter.from,
    to: filter.to,
    timezone: filter.timezoneExplicit ? filter.timezone : row.timezone || "Asia/Jakarta"
  };
}
function parameters(scope, filter) {
  return [
    scope.tenantId,
    scope.merchantId,
    scope.outletId,
    filter.from,
    filter.to,
    filter.timezone,
    filter.paymentMethod,
    filter.search
  ];
}
var inPeriod = (alias, column = "created_at") => `
  ${alias}.tenant_id=$1 AND ${alias}.merchant_id=$2 AND ${alias}.outlet_id=$3
  AND ($4::date IS NULL OR ${alias}.${column} >= ($4::date::timestamp AT TIME ZONE $6))
  AND ($5::date IS NULL OR ${alias}.${column} < (($5::date + 1)::timestamp AT TIME ZONE $6))`;
var transactionFilters = (alias) => `
  AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM pos.payments fp
    WHERE fp.transaction_id=${alias}.id AND fp.tenant_id=$1 AND fp.merchant_id=$2
      AND fp.payment_method=$7 AND fp.payment_status IN ('PAID','SETTLED','REFUNDED')))
  AND ($8::text IS NULL OR POSITION(lower($8) IN lower(COALESCE(${alias}.invoice_number,'')))>0
    OR EXISTS (SELECT 1 FROM pos.users fu WHERE fu.id=${alias}.cashier_user_id
      AND fu.tenant_id=$1 AND POSITION(lower($8) IN lower(fu.name))>0))`;
var revenueCTE = `WITH revenue AS (
  SELECT r.*,x.cashier_user_id
  FROM contract.merchant_revenue r
  JOIN pos.transactions x ON x.id=r.id AND x.tenant_id=r.tenant_id AND x.merchant_id=r.merchant_id
  WHERE ${inPeriod("r")} ${transactionFilters("x")}
)`;
function financial(row) {
  const totalNetRevenue = numeric(row.net_revenue);
  const totalCOGS = numeric(row.cogs);
  const totalTax = numeric(row.tax);
  const totalOrders = numeric(row.orders);
  const grossProfit = money3(totalNetRevenue - totalTax - totalCOGS);
  return {
    totalOrders,
    totalGrossSales: numeric(row.gross_sales),
    totalDiscount: numeric(row.discount),
    totalTax,
    totalServiceCharge: numeric(row.service),
    totalNetRevenue,
    totalRefunds: numeric(row.refunds),
    totalCOGS,
    grossProfit,
    netProfitMargin: totalNetRevenue ? money3(grossProfit / totalNetRevenue * 100) : 0,
    avgOrderValue: totalOrders ? money3(totalNetRevenue / totalOrders) : 0
  };
}
async function revenueSummary(db, params) {
  const { rows } = await db.query(`${revenueCTE}
    SELECT count(*)::int AS orders,COALESCE(sum(r.subtotal-COALESCE(f.subtotal,0)),0) AS gross_sales,
      COALESCE(sum(r.discount_amount-COALESCE(f.discount,0)),0) AS discount,COALESCE(sum(r.tax_amount-COALESCE(f.tax,0)),0) AS tax,
      COALESCE(sum(r.service_charge_amount-COALESCE(f.service,0)),0) AS service,COALESCE(sum(r.total_amount),0) AS net_revenue,
      COALESCE(sum(r.refund_amount),0) AS refunds,COALESCE(sum(r.cogs_amount),0) AS cogs
    FROM revenue r LEFT JOIN LATERAL(SELECT SUM(subtotal_amount) AS subtotal,SUM(discount_amount) AS discount,
      SUM(tax_amount) AS tax,SUM(service_amount) AS service FROM pos.transaction_refunds WHERE transaction_id=r.id) f ON true`, params);
  return financial(rows[0]);
}
async function cashSummary(db, params) {
  const { rows } = await db.query(`SELECT
    COALESCE(sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='OPENING' OR c.category='MODAL_AWAL'),0) AS initial_cash,
    COALESCE(sum(c.amount) FILTER (WHERE c.event_type IN ('SALE','VOID')),0) AS cash_sales,
    COALESCE(-sum(c.amount) FILTER (WHERE c.event_type='REFUND'),0) AS cash_refunds,
    COALESCE(sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_IN'),0) AS cash_in,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT'),0) AS cash_out,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT' AND c.category='BELANJA_BAHAN'),0) AS bahan,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT' AND c.category='OPERASIONAL'),0) AS operasional,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT' AND c.category='KASBON'),0) AS kasbon,
    COALESCE(sum(c.amount),0) AS balance
    FROM pos.cash_ledger c LEFT JOIN pos.cash_ledger original ON c.event_type='REVERSAL' AND c.reference_id=original.id::text AND c.tenant_id=original.tenant_id
    WHERE ${inPeriod("c", "occurred_at")}`, params.slice(0, 6));
  const row = rows[0];
  return {
    initialCash: numeric(row.initial_cash),
    cashSales: numeric(row.cash_sales),
    cashRefunds: numeric(row.cash_refunds),
    cashIn: numeric(row.cash_in),
    cashOut: numeric(row.cash_out),
    expenseBahan: numeric(row.bahan),
    expenseOperasional: numeric(row.operasional),
    expenseKasbon: numeric(row.kasbon),
    expectedCashInDrawer: numeric(row.balance)
  };
}
async function paymentBreakdown(db, params) {
  const { rows } = await db.query(`${revenueCTE}, tenders AS (
    SELECT r.id,r.total_amount,p.payment_method,p.amount,
      sum(p.amount) OVER (PARTITION BY r.id) AS tender_total
    FROM revenue r JOIN pos.payments p ON p.transaction_id=r.id AND p.tenant_id=r.tenant_id
      AND p.merchant_id=r.merchant_id AND p.payment_status IN ('PAID','SETTLED')
  ) SELECT payment_method,COALESCE(sum(total_amount * amount / NULLIF(tender_total,0)),0) AS amount
    FROM tenders GROUP BY payment_method ORDER BY payment_method`, params);
  return Object.fromEntries(rows.map((row) => [row.payment_method, money3(numeric(row.amount))]));
}
function localDate(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(/* @__PURE__ */ new Date());
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function shiftDate(date2, days) {
  const d = /* @__PURE__ */ new Date(`${date2}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function cashMovement(row) {
  return {
    id: row.client_event_id || row.id,
    type: numeric(row.amount) < 0 ? "CASH_OUT" : "CASH_IN",
    category: row.category || (row.event_type === "OPENING" ? "MODAL_AWAL" : numeric(row.amount) < 0 ? "PENGELUARAN_LAIN" : "PENDAPATAN_LAIN"),
    amount: Math.abs(numeric(row.amount)),
    description: row.note || row.event_type,
    timestamp: iso(row.occurred_at),
    cashierName: row.actor_name || row.actor_ref || "Kasir",
    shiftId: row.shift_ref || void 0,
    recipientOrSource: row.recipient_or_source || void 0
  };
}
async function serverReportSummary(db, subject, filter) {
  return db.tx(async (c) => {
    await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await scopeFor2(c, subject, filter);
    filter = { ...filter, timezone: scope.timezone };
    const params = parameters(scope, filter);
    const today = localDate(filter.timezone);
    const todayParams = parameters(scope, { ...filter, from: today, to: today, paymentMethod: null, search: null });
    const financialSummary = await revenueSummary(c, params);
    const todayFinancial = await revenueSummary(c, todayParams);
    const cash = await cashSummary(c, params);
    const todayCash = await cashSummary(c, todayParams);
    const breakdown = await paymentBreakdown(c, params);
    const todayPayment = await paymentBreakdown(c, todayParams);
    const top = await c.query(`${revenueCTE} SELECT i.product_name AS name,MIN(COALESCE(p.external_ref,p.id::text)) AS product_id,
      sum(GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ri.qty,0),0)) AS qty,
      sum(GREATEST(i.total_price-COALESCE(ri.amount,0),0)) AS revenue,
      sum(GREATEST(i.total_price-COALESCE(ri.amount,0),0)-i.unit_cost*GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ri.qty,0),0)) AS profit
      FROM revenue r JOIN pos.transaction_items i ON i.transaction_id=r.id AND i.tenant_id=r.tenant_id
      LEFT JOIN pos.products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id
      LEFT JOIN LATERAL (SELECT sum(ri.quantity) AS qty,sum(ri.amount) AS amount
        FROM pos.transaction_refund_items ri JOIN pos.transaction_refunds rf ON rf.id=ri.refund_id
        WHERE ri.transaction_item_id=i.id AND rf.tenant_id=$1 AND rf.merchant_id=$2) ri ON TRUE
      GROUP BY i.product_name ORDER BY qty DESC,i.product_name LIMIT 5`, params);
    const dailySql = `${revenueCTE} SELECT to_char(created_at AT TIME ZONE $6,'YYYY-MM-DD') AS date,
      sum(total_amount) AS revenue,SUM(total_amount-net_tax_amount-cogs_amount) AS profit,count(*)::int AS orders FROM revenue GROUP BY 1 ORDER BY 1`;
    const daily = await c.query(dailySql, params);
    const trend = filter.trendDays ? await c.query(dailySql, parameters(scope, {
      ...filter,
      paymentMethod: null,
      search: null,
      from: shiftDate(today, -(filter.trendDays - 1)),
      to: today
    })) : null;
    const hourly = await c.query(`${revenueCTE} SELECT extract(hour FROM created_at AT TIME ZONE $6)::int AS hour,
      sum(total_amount) AS revenue FROM revenue GROUP BY 1 ORDER BY 1`, params);
    const statuses = await c.query(`SELECT x.order_status,count(*)::int AS n FROM pos.transactions x
      WHERE ${inPeriod("x")} ${transactionFilters("x")} GROUP BY x.order_status`, params);
    const movements = await c.query(`SELECT * FROM pos.cash_ledger c WHERE ${inPeriod("c", "occurred_at")}
      AND event_type IN ('CASH_IN','CASH_OUT','OPENING')
      AND NOT EXISTS(SELECT 1 FROM pos.cash_ledger rev WHERE rev.reference_id=c.id::text AND rev.tenant_id=c.tenant_id AND rev.event_type='REVERSAL')
      ORDER BY occurred_at DESC,id DESC LIMIT 1001`, params.slice(0, 6));
    const counts = await c.query(`${revenueCTE} SELECT p.payment_method,COUNT(DISTINCT r.id)::int AS count
      FROM revenue r JOIN pos.payments p ON p.transaction_id=r.id AND p.payment_status IN('PAID','SETTLED') GROUP BY p.payment_method`, params);
    const itemCount = (await c.query(`${revenueCTE} SELECT COALESCE(SUM(GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ret.qty,0),0)),0) AS qty
      FROM revenue r JOIN pos.transaction_items i ON i.transaction_id=r.id
      LEFT JOIN LATERAL(SELECT SUM(quantity) AS qty FROM pos.transaction_refund_items WHERE transaction_item_id=i.id) ret ON true`, params)).rows[0];
    const sortedMethods = Object.entries(breakdown).map(([key, total]) => ({ key, name: key, count: numeric(counts.rows.find((row) => row.payment_method === key)?.count), total, percentage: financialSummary.totalNetRevenue ? money3(total / financialSummary.totalNetRevenue * 100) : 0 })).sort((a, b) => b.total - a.total);
    const cashSales = breakdown.CASH || 0, cashCount = numeric(counts.rows.find((row) => row.payment_method === "CASH")?.count);
    const sumMethods = (methods) => methods.reduce((sum, method) => sum + (todayPayment[method] || 0), 0);
    const todayQrisSales = sumMethods(["QRIS", "QRIS_DYNAMIC", "QRIS_STATIC"]);
    const todayCardSales = sumMethods(["CARD", "DEBIT", "CREDIT", "DEBIT_CARD", "CREDIT_CARD"]);
    const todayCashSales = todayPayment.CASH || 0;
    return {
      ok: true,
      source: "server",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope,
      financialSummary,
      overview: {
        grossSales: financialSummary.totalGrossSales,
        discountTotal: financialSummary.totalDiscount,
        taxTotal: financialSummary.totalTax,
        serviceChargeTotal: financialSummary.totalServiceCharge,
        netRevenue: financialSummary.totalNetRevenue,
        totalCOGS: financialSummary.totalCOGS,
        grossProfit: financialSummary.grossProfit,
        netProfitMargin: financialSummary.netProfitMargin,
        averageOrderValue: financialSummary.avgOrderValue,
        itemsSold: numeric(itemCount.qty),
        cashSales,
        cashCount,
        cashPercent: financialSummary.totalNetRevenue ? money3(cashSales / financialSummary.totalNetRevenue * 100) : 0,
        cashlessSales: money3(financialSummary.totalNetRevenue - cashSales),
        cashlessCount: financialSummary.totalOrders - cashCount,
        cashlessPercent: financialSummary.totalNetRevenue ? money3((financialSummary.totalNetRevenue - cashSales) / financialSummary.totalNetRevenue * 100) : 0,
        orderCount: financialSummary.totalOrders,
        sortedMethods,
        mostUsedMethod: sortedMethods[0] || null
      },
      todayMetrics: {
        totalOrders: todayFinancial.totalOrders,
        todayGrossSales: todayFinancial.totalGrossSales,
        todayDiscount: todayFinancial.totalDiscount,
        todayTax: todayFinancial.totalTax,
        todayNetRevenue: todayFinancial.totalNetRevenue,
        todayCashSales,
        todayQrisSales,
        todayCardSales,
        todayEWalletSales: money3(todayFinancial.totalNetRevenue - todayCashSales - todayQrisSales - todayCardSales),
        todayCashIn: todayCash.cashIn,
        todayCashOut: todayCash.cashOut,
        todayExpenseBahan: todayCash.expenseBahan,
        todayExpenseOperasional: todayCash.expenseOperasional,
        todayExpenseKasbon: todayCash.expenseKasbon,
        initialCash: todayCash.initialCash,
        expectedCashInDrawer: todayCash.expectedCashInDrawer,
        avgOrderValue: todayFinancial.avgOrderValue
      },
      paymentBreakdown: breakdown,
      topProductsBarData: top.rows.map((row) => ({ name: row.name, productId: row.product_id, qty: numeric(row.qty), revenue: numeric(row.revenue), profit: numeric(row.profit) })),
      areaChartData: Array.from({ length: 24 }, (_, hour) => ({
        time: `${String(hour).padStart(2, "0")}:00`,
        Omset: numeric(hourly.rows.find((row) => numeric(row.hour) === hour)?.revenue)
      })),
      dailySales: daily.rows.map((row) => ({ date: row.date, revenue: numeric(row.revenue), orders: numeric(row.orders), profit: numeric(row.profit) })),
      ...trend ? { trendDailySales: trend.rows.map((row) => ({ date: row.date, revenue: numeric(row.revenue), orders: numeric(row.orders), profit: numeric(row.profit) })) } : {},
      statusCounts: Object.fromEntries(statuses.rows.map((row) => [row.order_status, numeric(row.n)])),
      cashSummary: cash,
      cashMovements: movements.rows.slice(0, 1e3).map(cashMovement),
      cashMovementsTruncated: movements.rows.length > 1e3
    };
  });
}
function cursorFor(value) {
  const raw = stringQuery(value, "CURSOR");
  if (!raw) return null;
  try {
    if (raw.length > 300) throw new Error();
    const cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!UUID3.test(cursor.id) || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return { createdAt: new Date(cursor.createdAt).toISOString(), id: cursor.id };
  } catch {
    throw new ReportRequestError(400, "INVALID_CURSOR");
  }
}
async function serverTransactions(db, subject, filter, cursor, limit = 100) {
  return db.tx(async (c) => {
    await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await scopeFor2(c, subject, filter);
    filter = { ...filter, timezone: scope.timezone };
    const params = [...parameters(scope, filter), cursor?.createdAt || null, cursor?.id || null, limit + 1];
    const { rows } = await c.query(`SELECT x.*,u.name AS cashier_name,r.total_amount AS recognized_revenue,r.cogs_amount AS recognized_cogs,
      COALESCE(r.refund_amount,rf.refund_amount,0) AS refund_total
      FROM pos.transactions x LEFT JOIN pos.users u ON u.id=x.cashier_user_id AND u.tenant_id=x.tenant_id
      LEFT JOIN contract.merchant_revenue r ON r.id=x.id AND r.tenant_id=x.tenant_id
      LEFT JOIN LATERAL (SELECT sum(amount) AS refund_amount FROM pos.transaction_refunds rf
        WHERE rf.transaction_id=x.id AND rf.tenant_id=x.tenant_id) rf ON TRUE
      WHERE ${inPeriod("x")} ${transactionFilters("x")}
        AND ($9::timestamptz IS NULL OR (x.created_at,x.id)<($9::timestamptz,$10::uuid))
      ORDER BY x.created_at DESC,x.id DESC LIMIT $11`, params);
    const page2 = rows.slice(0, limit);
    const items = page2.length ? (await c.query(`SELECT i.*,COALESCE(i.quantity_exact,i.quantity) AS quantity,p.external_ref AS product_ref,
      COALESCE(ri.quantity,0) AS refunded_quantity FROM pos.transaction_items i
      LEFT JOIN pos.products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id
      LEFT JOIN LATERAL (SELECT sum(ri.quantity) AS quantity FROM pos.transaction_refund_items ri
        JOIN pos.transaction_refunds rf ON rf.id=ri.refund_id
        WHERE ri.transaction_item_id=i.id AND rf.tenant_id=$1) ri ON TRUE
      WHERE i.tenant_id=$1 AND i.transaction_id=ANY($2::uuid[]) ORDER BY i.id`, [scope.tenantId, page2.map((r) => r.id)])).rows : [];
    const tenders = page2.length ? (await c.query(`SELECT * FROM pos.payments WHERE tenant_id=$1 AND transaction_id=ANY($2::uuid[])
      AND client_payment_id IS NOT NULL AND payment_status IN('PAID','SETTLED') ORDER BY created_at,id`, [scope.tenantId, page2.map((r) => r.id)])).rows : [];
    const transactions = page2.map((row) => ({
      id: row.client_txn_id || row.invoice_number || row.id,
      serverId: row.id,
      clientTxnId: row.client_txn_id || null,
      invoiceNumber: row.invoice_number,
      orderNumber: 0,
      branchId: row.outlet_id,
      date: iso(row.created_at),
      orderType: row.order_type,
      subtotal: numeric(row.subtotal),
      discountTotal: numeric(row.discount_amount),
      taxTotal: numeric(row.tax_amount),
      serviceChargeTotal: numeric(row.service_charge_amount),
      total: numeric(row.total_amount),
      paymentMethod: row.payment_method,
      paymentStatus: ["VOIDED", "CANCELLED"].includes(row.order_status) ? "CANCELLED" : row.recognized_revenue !== null ? "PAID" : "PENDING",
      cashierName: row.cashier_name || "Kasir",
      shiftId: row.client_shift_id || row.shift_id || "",
      ...tenders.some((t) => t.transaction_id === row.id) ? { paymentTenders: tenders.filter((t) => t.transaction_id === row.id).map((t) => ({ clientPaymentId: t.client_payment_id, method: t.payment_method, amount: numeric(t.amount), createdAt: iso(t.created_at) })) } : {},
      status: ["VOIDED", "CANCELLED"].includes(row.order_status) ? "VOID" : ["OPEN", "PENDING_PAYMENT", "IN_FULFILLMENT"].includes(row.order_status) ? "HOLD" : "COMPLETED",
      serverOrderStatus: row.order_status,
      refundTotal: numeric(row.refund_total),
      recognizedRevenue: row.recognized_revenue === null ? null : numeric(row.recognized_revenue),
      recognizedCOGS: row.recognized_cogs === null ? null : numeric(row.recognized_cogs),
      syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
      items: items.filter((i) => i.transaction_id === row.id).map((i) => ({
        id: i.client_item_id || i.id,
        selectedModifiers: [],
        productId: i.product_ref || i.product_id,
        name: i.product_name,
        unitPrice: numeric(i.unit_price),
        unitCost: numeric(i.unit_cost),
        quantity: numeric(i.quantity),
        discountPercent: 0,
        discountAmount: 0,
        totalPrice: numeric(i.total_price),
        refundedQuantity: numeric(i.refunded_quantity)
      }))
    }));
    const last = page2[page2.length - 1];
    return {
      ok: true,
      source: "server",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope,
      transactions,
      nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: iso(last.created_at), id: last.id })).toString("base64url") : null
    };
  });
}
function registerReportRoutes(app, db) {
  for (const route of ["summary", "transactions"]) app.get(`/api/v1/reports/${route}`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const principal = trustedPrincipal(req);
    if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "AUTHENTICATION_REQUIRED" });
    try {
      const filter = parseReportFilter(req.query);
      if (route === "summary") return res.json(await serverReportSummary(db, principal.subject, filter));
      const rawLimit = stringQuery(req.query.limit, "LIMIT");
      const limit = rawLimit === null ? 100 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ReportRequestError(400, "INVALID_LIMIT");
      return res.json(await serverTransactions(db, principal.subject, filter, cursorFor(req.query.cursor), limit));
    } catch (error) {
      if (!(error instanceof ReportRequestError)) {
        const diagnostic = error;
        console.error("[reports] read failed", { route, code: diagnostic.code, constraint: diagnostic.constraint, table: diagnostic.table, column: diagnostic.column });
      }
      return res.status(error instanceof ReportRequestError ? error.status : 503).json({
        ok: false,
        error: error instanceof ReportRequestError ? error.message : "REPORT_UNAVAILABLE"
      });
    }
  });
}

// services/pos/sync.ts
var SECTOR_SET2 = new Set(SECTORS2);
var MAX_BATCH = 500;
var SyncAccessError = class extends Error {
};
var ProductLimitError = class extends Error {
};
async function ensureInventoryLocation(db, tenantId, merchantId, outletId) {
  const existing = await db.query(`SELECT id FROM pos.inventory_locations
    WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND is_primary AND is_active
    ORDER BY created_at,id LIMIT 1`, [tenantId, merchantId, outletId]);
  if (existing.rows.length) return existing.rows[0].id;
  await db.query(`INSERT INTO pos.inventory_locations
    (id,tenant_id,merchant_id,outlet_id,name,is_primary,is_active)
    VALUES(uuidv7(),$1,$2,$3,'Gudang Utama',true,true)
    ON CONFLICT(outlet_id,name) DO NOTHING`, [tenantId, merchantId, outletId]);
  const created = await db.query(`SELECT id FROM pos.inventory_locations
    WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND is_active
    ORDER BY is_primary DESC,created_at,id LIMIT 1`, [tenantId, merchantId, outletId]);
  if (!created.rows.length) throw new BillingError(409, "INVENTORY_LOCATION_REQUIRED");
  return created.rows[0].id;
}
async function assertBusinessCanBeClaimed(db, businessId, ownerSubject, sector) {
  if (ownerSubject === "local-development") return null;
  const { rows } = await db.query(
    `SELECT m.id,m.tenant_id,t.owner_user_ref,t.is_active AS tenant_active,t.merged_into,m.is_active AS merchant_active,m.business_sector
       FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE (m.external_ref = $1 OR m.id::text = $1)`,
    [businessId]
  );
  if (rows.length > 1 || rows.length && (rows[0].owner_user_ref !== ownerSubject || !rows[0].tenant_active || !rows[0].merchant_active || rows[0].merged_into || sector && rows[0].business_sector !== sector)) {
    throw new SyncAccessError("BUSINESS_NOT_OWNED");
  }
  if (!rows.length && sector && businessId !== `${ownerSubject}_${sector}`) throw new SyncAccessError("BUSINESS_SETUP_REQUIRED");
  return rows[0] || null;
}
async function productLimitForTenant(db, tenantId) {
  return -1;
}
var num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
var str = (v, max) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
var outletRef = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
function invalidTransaction(x) {
  if (!str(x.clientTxnId, 64) || !Array.isArray(x.items) || !x.items.length) return "INVALID_TRANSACTION";
  if (!Number.isFinite(x.subtotal) || !Number.isFinite(x.totalAmount) || x.subtotal < 0 || x.totalAmount < 0) return "INVALID_AMOUNT";
  if (Math.abs(x.totalAmount - (x.subtotal - (x.discountAmount || 0) + (x.taxAmount || 0) + (x.serviceChargeAmount || 0))) > 0.02) return "TOTAL_MISMATCH";
  if (x.items.some((i) => !i || typeof i.productName !== "string" || !i.productName.trim() || !Number.isFinite(i.unitPrice) || i.unitPrice < 0 || !Number.isFinite(i.quantity) || i.quantity <= 0 || i.quantity > 999999999 || Math.abs(i.quantity * 1e3 - Math.round(i.quantity * 1e3)) > 1e-3)) return "INVALID_ITEM";
  return null;
}
function perSaleRejection(error) {
  if (error instanceof FinanceError || error instanceof FinancialApprovalError) return error.message;
  const code = String(error?.code || "");
  if (/^(22|23)/.test(code)) return "REJECTED_BY_DATABASE:" + (error.constraint || code);
  return null;
}
var INVOICE_CONSTRAINTS = /* @__PURE__ */ new Set(["uq_transactions_invoice_number", "uq_txn_invoice_per_tenant"]);
function registerSyncRoutes(app, db) {
  registerHybridOnboarding(app, db);
  registerNeonOnboarding(app, db);
  registerPrivacyRoutes(app, db);
  registerBusinessDirectory(app, db);
  registerSharedStateRoutes(app, db);
  registerReportRoutes(app, db);
  registerFinanceRoutes(app, db);
  app.post("/api/v1/sync/business", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const sector = str(req.body?.sector, 16);
    const storeName = str(req.body?.storeName, 100);
    if (!sector || !SECTOR_SET2.has(sector) || !storeName) return res.status(400).json({ ok: false, error: "INVALID_BUSINESS" });
    const create = req.body?.intent === "create";
    const requestKey = str(req.body?.requestKey, 36);
    if (create && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestKey || "")) return res.status(400).json({ ok: false, error: "BUSINESS_REQUEST_KEY_REQUIRED" });
    const businessId = create ? `${principal.subject}_business_${requestKey}` : `${principal.subject}_${sector}`;
    try {
      const result = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, principal.subject);
        let tenantId = await tenantForPrincipal(c, principal);
        if (!tenantId) {
          if (process.env.NEON_DB_PHASE1 === "1") throw new BillingError(409, "HYBRID_ONBOARDING_REQUIRED");
          const created2 = await c.query(`INSERT INTO internal.tenants(id,name,external_ref,owner_user_ref)
            VALUES(uuidv7(),$1,$2,$2) ON CONFLICT(external_ref) WHERE external_ref IS NOT NULL
            DO UPDATE SET name=EXCLUDED.name RETURNING id`, [storeName, principal.subject]);
          tenantId = created2.rows[0].id;
        }
        if (!tenantId) throw new BillingError(409, "TENANT_NOT_PROVISIONED");
        await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [tenantId]);
        await assertTenantWritable(c, tenantId);
        if (create) {
          const ready = await c.query("SELECT 1 FROM pg_constraint WHERE conrelid='pos.shared_state_records'::regclass AND conname='shared_state_business_namespace'");
          if (!ready.rows.length) throw new BillingError(409, "MULTI_BUSINESS_MIGRATION_REQUIRED");
          const free = await freePlanState(c, tenantId);
          if (free.free) throw new BillingError(409, "FREE_SINGLE_BUSINESS");
          const previous = (await c.query("SELECT id,business_sector,name FROM internal.merchants WHERE tenant_id=$1 AND external_ref=$2", [tenantId, businessId])).rows[0];
          if (previous) {
            if (previous.business_sector !== sector || previous.name !== storeName) throw new BillingError(409, "BUSINESS_REQUEST_KEY_CONFLICT");
            return { tenantId, merchantId: previous.id };
          }
        }
        const existing = create ? null : await resolveBusinessScope(c, principal.subject, sector, req.body?.businessId);
        if (existing) return { tenantId, merchantId: existing.merchantId };
        const created = await c.query(`INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref)
          VALUES(uuidv7(),$1,$2,$3,$4) ON CONFLICT(external_ref) WHERE external_ref IS NOT NULL
          DO UPDATE SET name=EXCLUDED.name WHERE internal.merchants.tenant_id=$1 RETURNING id`, [tenantId, storeName, sector, businessId]);
        if (!created.rows.length) throw new BillingError(409, "BUSINESS_OWNERSHIP_CONFLICT");
        return { tenantId, merchantId: created.rows[0].id };
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(error instanceof BillingError || error instanceof BusinessScopeError ? error.status : 500).json({ ok: false, error: error instanceof BillingError || error instanceof BusinessScopeError ? error.message : "BUSINESS_SETUP_FAILED" });
    }
  });
  app.get("/api/v1/sync/receipt-logo", async (req, res) => {
    const principal = trustedPrincipal(req);
    const businessId = str(req.query.businessId, 96);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    if (!businessId) return res.status(400).json({ ok: false, error: "BUSINESS_ID_REQUIRED" });
    if (!await canAccessBusiness(db, principal, businessId)) return res.status(403).json({ ok: false, error: "BUSINESS_NOT_OWNED" });
    const { rows } = await db.query("SELECT logo_url FROM internal.merchants WHERE (external_ref = $1 OR id::text = $1)", [businessId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "BUSINESS_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, logoUrl: rows[0].logo_url || null });
  });
  app.put("/api/v1/sync/receipt-logo", async (req, res) => {
    const principal = trustedPrincipal(req);
    const businessId = str(req.body?.businessId, 96);
    const logoUrl = req.body?.logoUrl;
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    if (!businessId) return res.status(400).json({ ok: false, error: "BUSINESS_ID_REQUIRED" });
    if (!await canAccessBusiness(db, principal, businessId)) return res.status(403).json({ ok: false, error: "BUSINESS_NOT_OWNED" });
    if (logoUrl !== null && logoUrl !== void 0) {
      if (typeof logoUrl !== "string" || logoUrl.length > 2e5) return res.status(413).json({ ok: false, error: "LOGO_TOO_LARGE" });
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(logoUrl);
      if (!match) return res.status(400).json({ ok: false, error: "INVALID_LOGO" });
      const bytes = Buffer.from(match[2], "base64");
      const valid = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : match[1] === "jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
      if (!valid) return res.status(400).json({ ok: false, error: "INVALID_LOGO" });
    }
    const { rows } = await db.query(
      "UPDATE internal.merchants SET logo_url = $1, updated_at = now() WHERE (external_ref = $2 OR id::text = $2) RETURNING id",
      [logoUrl || null, businessId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "BUSINESS_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true });
  });
  app.post("/api/v1/sync/transactions", async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? "Tanpa Nama";
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const ownerRef = principal.subject;
    const idemKey = str(body.idempotencyKey, 120);
    const requestedOutletId = outletRef(body.outletId);
    const txns = Array.isArray(body.transactions) ? body.transactions : [];
    if (!businessId || !sector || !SECTOR_SET2.has(sector)) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        detail: "businessId dan sector wajib; sector harus salah satu dari " + SECTORS2.join(", ")
      });
    }
    if (body.outletId && !requestedOutletId) return res.status(400).json({ ok: false, error: "INVALID_OUTLET_ID" });
    if (txns.length > MAX_BATCH) {
      return res.status(413).json({
        ok: false,
        error: "BATCH_TOO_LARGE",
        detail: `Maksimal ${MAX_BATCH} transaksi per kiriman. Pecah antriannya.`
      });
    }
    if (!txns.length || txns.some((x) => !x || typeof x !== "object"))
      return res.status(400).json({ ok: false, error: "INVALID_TRANSACTIONS" });
    try {
      const out = await db.tx(async (c) => {
        const claimedBusiness = await assertBusinessCanBeClaimed(c, businessId, ownerRef, sector);
        const storesOutcomes = await hasSchemaFeature(c, "syncReceiptOutcomes");
        if (idemKey) {
          const prev = await c.query(
            `SELECT business_id, rows_accepted, rows_duplicate${storesOutcomes ? ", outcomes" : ""} FROM pos.sync_receipts WHERE idempotency_key = $1`,
            [idemKey]
          );
          if (prev.rows.length) {
            if (prev.rows[0].business_id !== businessId) throw new BillingError(409, "IDEMPOTENCY_KEY_CONFLICT");
            return {
              replayed: true,
              accepted: prev.rows[0].rows_accepted,
              duplicates: prev.rows[0].rows_duplicate,
              rejected: prev.rows[0].outcomes?.rejected ?? [],
              renumbered: prev.rows[0].outcomes?.renumbered ?? [],
              tenantId: null
            };
          }
        }
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId;
        let merchantId;
        let outletId;
        if (freeScope) {
          if (!(await c.query(
            `SELECT 1 FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
            WHERE m.id=$1 AND m.tenant_id=$3 AND t.owner_user_ref=$4 AND m.business_sector=$5
              AND m.is_active AND t.is_active AND t.merged_into IS NULL
              AND (m.id::text=$2 OR m.external_ref=$2 OR (m.external_ref IS NULL AND $2=$4||'_'||$5))`,
            [freeScope.merchant_id, businessId, freeScope.tenant_id, ownerRef, sector]
          )).rows.length) throw new SyncAccessError("FREE_BUSINESS_MISMATCH");
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          outletId = freeScope.outlet_id;
          await assertTenantWritable(c, tenantId);
        } else {
          const tenantExternalRef = ownerRef || `tenant_${businessId}`;
          const existingTenant = await tenantForPrincipal(c, { subject: ownerRef });
          const t = existingTenant ? { rows: [{ id: existingTenant }] } : await c.query(
            `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
            [storeName, tenantExternalRef, ownerRef]
          );
          tenantId = t.rows[0].id;
          await assertTenantWritable(c, tenantId);
          if (claimedBusiness && claimedBusiness.tenant_id !== tenantId) throw new SyncAccessError("BUSINESS_NOT_OWNED");
          const m = claimedBusiness ? { rows: [claimedBusiness] } : await c.query(
            `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET external_ref = EXCLUDED.external_ref
             WHERE internal.merchants.tenant_id=$1 AND internal.merchants.business_sector=$3 AND internal.merchants.is_active
           RETURNING id`,
            [tenantId, storeName, sector, businessId]
          );
          if (!m.rows.length) throw new SyncAccessError("BUSINESS_NOT_OWNED");
          merchantId = m.rows[0].id;
          const outq = await c.query(
            `SELECT id FROM internal.outlets WHERE merchant_id = $1 AND is_active
             AND ($2::uuid IS NULL OR id = $2::uuid) ORDER BY created_at ASC LIMIT 1`,
            [merchantId, requestedOutletId]
          );
          if (!outq.rows.length) throw new BillingError(409, "OUTLET_SETUP_REQUIRED");
          outletId = outq.rows[0].id;
        }
        const defaultInventoryLocationId = await ensureInventoryLocation(c, tenantId, merchantId, outletId);
        await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [tenantId, merchantId]);
        const financialScope = { tenantId, merchantId, outletId, sector, actorRef: ownerRef };
        const cashierCache = /* @__PURE__ */ new Map();
        const productCache = /* @__PURE__ */ new Map();
        const productLimit = await productLimitForTenant(c, tenantId);
        const existingProductCount = await c.query(
          `SELECT COUNT(*)::int AS count FROM pos.products WHERE tenant_id = $1`,
          [tenantId]
        );
        let productCount = Number(existingProductCount.rows[0]?.count ?? 0);
        const resolveCashier = async (ref, name, role) => {
          const free = await freePlanState(c, tenantId);
          if (free.free) {
            if (ref !== free.ownerId) throw new SyncAccessError("FREE_OWNER_ONLY");
            if (cashierCache.has(ref)) return cashierCache.get(ref);
            await c.query(`INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref)
              SELECT id,name,business_sector,owner_user_ref FROM internal.tenants WHERE id=$1
              ON CONFLICT(id) DO NOTHING`, [tenantId]);
            const owner = await c.query(`INSERT INTO pos.users(id,tenant_id,name,username,pin,role,external_ref)
              SELECT u.id,$1,left(u.full_name,100),'owner_'||u.id::text,$3,'ADMIN',u.id::text
              FROM internal.users u WHERE u.id::text=$2 AND u.is_active
              ON CONFLICT(id) DO NOTHING RETURNING id`, [tenantId, free.ownerId, randomBytes4(32).toString("hex")]);
            if (!owner.rows.length) {
              const existing = await c.query(`SELECT p.id FROM pos.users p JOIN internal.users u ON u.id=p.id
                WHERE p.id::text=$1 AND u.is_active`, [free.ownerId]);
              if (!existing.rows.length) throw new SyncAccessError("FREE_OWNER_UNAVAILABLE");
            }
            cashierCache.set(ref, free.ownerId);
            return free.ownerId;
          }
          const key = ref || name;
          if (!key) return null;
          if (cashierCache.has(key)) return cashierCache.get(key);
          if (ref === ownerRef) {
            await c.query(`INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref)
              SELECT id,name,business_sector,owner_user_ref FROM internal.tenants WHERE id=$1
              ON CONFLICT(id) DO NOTHING`, [tenantId]);
            await c.query(`INSERT INTO pos.users(id,tenant_id,name,username,pin,role,external_ref)
              SELECT u.id,$1,left(u.full_name,100),'owner_'||u.id::text,$3,'ADMIN',u.id::text
              FROM internal.users u WHERE u.id::text=$2 AND u.is_active
              ON CONFLICT(id) DO NOTHING`, [tenantId, ownerRef, randomBytes4(32).toString("hex")]);
          }
          const verified = await c.query(`SELECT id FROM pos.users
            WHERE tenant_id=$1 AND (id::text=$2 OR external_ref=$2) LIMIT 1`, [tenantId, ref]);
          const userId = verified.rows[0]?.id ?? null;
          cashierCache.set(key, userId);
          return userId;
        };
        const resolveProduct = async (i) => {
          assertFreeScope(await freePlanState(c, tenantId), sector, [i.productRef || ""]);
          const key = i.productRef || i.productName;
          if (!key) return null;
          if (productCache.has(key)) return productCache.get(key);
          const found = await c.query(
            `SELECT id, outlet_id FROM pos.products WHERE tenant_id = $1 AND merchant_id=$5 AND business_sector=$6 AND NOT sync_quarantined
              AND (external_ref = $2 OR (NOT $4::boolean AND name = $3)) ORDER BY (external_ref=$2) DESC NULLS LAST,id LIMIT 1`,
            [tenantId, i.productRef ?? null, i.productName, !!freeScope, merchantId, sector]
          );
          if (freeScope && found.rows[0] && found.rows[0].outlet_id !== outletId) {
            throw new FreePlanAccessError("FREE_PRODUCT_BRANCH_MISMATCH");
          }
          let id;
          if (found.rows.length) {
            id = found.rows[0].id;
          } else {
            if (productLimit >= 0 && productCount >= productLimit) {
              throw new ProductLimitError("PRODUCT_LIMIT_EXCEEDED");
            }
            const ins = await c.query(
              `INSERT INTO pos.products (id, tenant_id, merchant_id, outlet_id, name, sku, price, cost_price,
                                     business_sector, business_id, category_name,
                                     description, external_ref)
               VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
              [
                tenantId,
                merchantId,
                outletId,
                i.productName.slice(0, 100),
                (i.productRef || i.productName).slice(0, 50),
                num(i.unitPrice),
                num(i.unitCost),
                sector,
                businessId,
                str(i.categoryName, 100),
                str(i.productDescription, 300),
                i.productRef ?? null
              ]
            );
            id = ins.rows[0].id;
            productCount++;
          }
          productCache.set(key, id);
          return id;
        };
        let accepted = 0;
        let duplicates = 0;
        let voided = 0;
        const rejected = [];
        const renumbered = [];
        const syncOne = async (x, clientId) => {
          const cashierId = await resolveCashier(
            str(x.cashierRef, 96),
            str(x.cashierName, 100),
            str(x.cashierRole, 24)
          );
          const subtotal = Math.max(0, num(x.subtotal));
          const discount = Math.max(0, num(x.discountAmount));
          const tax = Math.max(0, num(x.taxAmount));
          const serviceCharge = Math.max(0, num(x.serviceChargeAmount));
          const total = Math.max(0, num(x.totalAmount, subtotal - discount + tax + serviceCharge));
          const appModule = ["POS", "TABLES", "CUSTOMERS"].includes(String(x.appModule)) ? String(x.appModule) : "POS";
          const paymentMethod = str(x.paymentMethod, 20) ?? "CASH";
          const paymentStatus = str(x.paymentStatus, 20) ?? "PAID";
          const isVoid = paymentStatus === "CANCELLED";
          if (isVoid) {
            const prior = (await c.query("SELECT id FROM pos.transactions WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_txn_id=$4", [tenantId, merchantId, outletId, clientId])).rows[0];
            if (!prior) throw new FinanceError(409, "TRANSACTION_SYNC_REQUIRED");
            await consumeFinancialApproval(c, financialScope, "VOID", clientId, x, x.approvalGrant);
          }
          const orderStatus = isVoid ? "VOIDED" : paymentStatus === "PENDING" ? "PENDING_PAYMENT" : "COMPLETED";
          const insertSale = (invoiceNumber2) => c.query(
            `INSERT INTO pos.transactions
               (id, tenant_id, merchant_id, outlet_id, cashier_user_id, subtotal, discount_amount, tax_amount,
                service_charge_amount, total_amount, payment_method, order_status,
                business_sector, business_id, app_module, order_type, invoice_number,
                client_txn_id, shift_id, business_date, completed_at, cancelled_at, voided_at, created_at)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18::uuid, $19::date, $20::timestamptz, $21::timestamptz, $22::timestamptz, COALESCE($23::timestamptz, CURRENT_TIMESTAMP))
             ON CONFLICT (tenant_id, client_txn_id) WHERE client_txn_id IS NOT NULL
               DO NOTHING
             RETURNING id`,
            [
              tenantId,
              merchantId,
              outletId,
              cashierId,
              subtotal,
              discount,
              tax,
              serviceCharge,
              total,
              paymentMethod,
              orderStatus,
              sector,
              businessId,
              appModule,
              str(x.orderType, 16),
              invoiceNumber2,
              clientId,
              outletRef(x.shiftId),
              str(x.businessDate, 10) ?? (x.createdAt ? x.createdAt.split("T")[0] : null),
              x.completedAt ?? (orderStatus === "COMPLETED" ? x.createdAt : null),
              x.cancelledAt ?? (isVoid ? x.createdAt : null),
              x.voidedAt ?? null,
              x.createdAt ?? null
            ]
          );
          let ins;
          const invoiceNumber = str(x.invoiceNumber, 32);
          await c.exec("SAVEPOINT sync_invoice");
          try {
            ins = await insertSale(invoiceNumber);
            await c.exec("RELEASE SAVEPOINT sync_invoice");
          } catch (error) {
            await c.exec("ROLLBACK TO SAVEPOINT sync_invoice");
            await c.exec("RELEASE SAVEPOINT sync_invoice");
            if (error.code !== "23505" || !INVOICE_CONSTRAINTS.has(String(error.constraint)) || !invoiceNumber) throw error;
            const unique = `${invoiceNumber.slice(0, 22)}-${clientId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
            ins = await insertSale(unique);
            if (ins.rows.length) renumbered.push({ clientTxnId: clientId, invoiceNumber: unique });
          }
          if (!ins.rows.length) {
            duplicates++;
            const original = (await c.query(`SELECT * FROM pos.transactions WHERE tenant_id=$1 AND client_txn_id=$2 FOR UPDATE`, [tenantId, clientId])).rows[0];
            if (!original || original.merchant_id !== merchantId || paymentStatus !== "CANCELLED" && original.outlet_id !== outletId || Number(original.total_amount) !== total || Number(original.subtotal) !== subtotal)
              throw new FinanceError(409, "TRANSACTION_ID_CONFLICT");
            const status = str(x.paymentStatus, 20);
            if (status === "CANCELLED") {
              const voidedAt = x.voidedAt ?? (/* @__PURE__ */ new Date()).toISOString();
              const upd = await c.query(
                `UPDATE pos.transactions
                    SET order_status = 'VOIDED',
                        voided_at = COALESCE($3::timestamptz, CURRENT_TIMESTAMP)
                  WHERE tenant_id = $1 AND client_txn_id = $2 AND merchant_id = $4
                    AND order_status NOT IN ('VOIDED','CANCELLED')
                RETURNING id`,
                [tenantId, clientId, voidedAt, merchantId]
              );
              if (upd.rows.length) {
                const voidedTxnId = upd.rows[0].id;
                const cashBalance = Number((await c.query("SELECT COALESCE(SUM(amount),0) AS amount FROM pos.cash_ledger WHERE transaction_id=$1 AND tenant_id=$2", [voidedTxnId, tenantId])).rows[0].amount);
                if (cashBalance !== 0) await c.query(
                  `INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,note,occurred_at)
                  VALUES($1,$2,$3,$4,'VOID',$5,$6,'Pembatalan transaksi',$7) ON CONFLICT(tenant_id,client_event_id) DO NOTHING`,
                  [tenantId, merchantId, original.outlet_id, "void:" + voidedTxnId, -cashBalance, voidedTxnId, voidedAt]
                );
                await c.query(
                  `UPDATE pos.payments SET payment_status = 'REFUNDED' WHERE transaction_id = $1`,
                  [voidedTxnId]
                );
                const voidedItems = await c.query(
                  `SELECT ti.product_id, GREATEST(COALESCE(ti.quantity_exact,ti.quantity)-COALESCE((SELECT SUM(ri.quantity) FROM pos.transaction_refund_items ri WHERE ri.transaction_item_id=ti.id),0),0) AS quantity,
                          p.inventory_item_id, p.merchant_id, tx.outlet_id
                     FROM pos.transaction_items ti
                     JOIN pos.products p ON p.id = ti.product_id
                     JOIN pos.transactions tx ON tx.id=ti.transaction_id
                    WHERE ti.transaction_id = $1
                      AND p.inventory_item_id IS NOT NULL`,
                  [voidedTxnId]
                );
                for (const vi of voidedItems.rows) {
                  const fallbackLocation = vi.outlet_id === outletId ? defaultInventoryLocationId : await ensureInventoryLocation(c, tenantId, merchantId, vi.outlet_id);
                  await c.query(
                    `INSERT INTO pos.inventory_transactions
                       (id, tenant_id, merchant_id, outlet_id, location_id,
                        inventory_item_id, quantity_delta, reference_type,
                        reference_id, reason, created_at)
                     VALUES (
                       uuidv7(), $1, $2, $3,
                       COALESCE((SELECT location_id FROM pos.inventory_balances
                         WHERE inventory_item_id = $5 AND outlet_id = $3 AND location_id IS NOT NULL
                         ORDER BY updated_at DESC LIMIT 1),$7::uuid),
                       $5, $4, 'VOID_RESTORE', $6,
                       'Pengembalian stok \u2014 transaksi dibatalkan', CURRENT_TIMESTAMP)`,
                    [tenantId, vi.merchant_id, vi.outlet_id, vi.quantity, vi.inventory_item_id, voidedTxnId, fallbackLocation]
                  );
                }
                voided++;
                await writeActivity(c, {
                  merchantId,
                  tenantId,
                  businessSector: sector,
                  businessId,
                  appModule: "POS",
                  eventType: "TRANSACTION_VOID",
                  severity: "WARNING",
                  actorName: str(x.cashierName, 100),
                  actorRole: str(x.cashierRole, 24),
                  transactionId: voidedTxnId,
                  amountIdr: total,
                  summary: `Transaksi ${str(x.invoiceNumber, 64) ?? clientId} dibatalkan`,
                  detail: { clientTxnId: clientId }
                });
              }
            }
            if (status !== "CANCELLED" && x.tenders) await applyTenders(c, financialScope, original.id, x.tenders);
            if (status !== "CANCELLED") for (const refund of x.refunds || []) await applyRefund(c, financialScope, original.id, refund);
            return;
          }
          const txnId = ins.rows[0].id;
          await c.query("UPDATE pos.transactions SET client_shift_id=$2 WHERE id=$1", [txnId, str(x.shiftId, 128)]);
          const pStatus = isVoid ? "REFUNDED" : paymentStatus === "PENDING" ? "PENDING" : "PAID";
          if (x.tenders) {
            if (isVoid) throw new FinanceError(400, "VOID_TENDER_IMPORT_REQUIRES_REVIEW");
            await applyTenders(c, financialScope, txnId, x.tenders);
          } else
            await c.query(
              `INSERT INTO pos.payments
               (id, tenant_id, merchant_id, outlet_id, transaction_id, payment_method, payment_status, amount, gateway_provider, verification_origin)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'MANUAL_CASH','CASHIER_RECORDED')
             ON CONFLICT DO NOTHING RETURNING id`,
              [tenantId, merchantId, outletId, txnId, paymentMethod, pStatus, total]
            ).then(async (payment) => {
              if (payment.rows.length && pStatus === "PAID" && paymentMethod === "CASH")
                await c.query(
                  `INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,note,actor_ref,occurred_at)
                VALUES($1,$2,$3,$4,'SALE',$5,$6,'Pembayaran tunai',$7,COALESCE($8::timestamptz,now())) ON CONFLICT(tenant_id,client_event_id) DO NOTHING`,
                  [tenantId, merchantId, outletId, "payment:" + payment.rows[0].id, total, txnId, ownerRef, x.createdAt || null]
                );
            });
          for (const i of x.items) {
            const productId = await resolveProduct(i);
            if (!productId) continue;
            const qty = num(i.quantity, 1);
            const unitPrice = Math.max(0, num(i.unitPrice));
            const unitCost = Math.max(0, num(i.unitCost));
            const totalPrice = Math.max(0, num(i.totalPrice, unitPrice * qty));
            await c.query(
              `INSERT INTO pos.transaction_items
                 (id, transaction_id, tenant_id, product_id, product_name, unit_price,
                  quantity, total_price, business_sector, category_name, unit_cost,
                  product_description,client_item_id,quantity_exact)
               VALUES (uuidv7(), $1, $2, $3, $4, $5,CEIL($6::numeric)::int, $7, $8, $9, $10, $11,$12,$6)`,
              [
                txnId,
                tenantId,
                productId,
                i.productName.slice(0, 100),
                unitPrice,
                qty,
                totalPrice,
                sector,
                str(i.categoryName, 100),
                unitCost,
                str(i.productDescription, 300),
                str(i.clientItemId, 128)
              ]
            );
            if (!isVoid) {
              await c.query(
                `INSERT INTO pos.inventory_transactions
                   (id, tenant_id, merchant_id, outlet_id, location_id,
                    inventory_item_id, quantity_delta, reference_type,
                    reference_id, reason, created_at)
                 SELECT
                   uuidv7(), p.tenant_id, p.merchant_id, $4::uuid,
                   COALESCE((SELECT ib.location_id FROM pos.inventory_balances ib
                     WHERE ib.inventory_item_id = p.inventory_item_id
                       AND ib.outlet_id = $4::uuid AND ib.location_id IS NOT NULL
                     ORDER BY ib.updated_at DESC LIMIT 1),$5::uuid),
                   p.inventory_item_id,
                   -($2::numeric),
                   'SALE_DEDUCT',
                   $3,
                   'Penjualan POS',
                   CURRENT_TIMESTAMP
                 FROM pos.products p
                 WHERE p.id = $1
                   AND p.inventory_item_id IS NOT NULL`,
                [productId, qty, txnId, outletId, defaultInventoryLocationId]
              );
            }
          }
          for (const refund of x.refunds || []) await applyRefund(c, financialScope, txnId, refund);
          accepted++;
        };
        for (const x of txns) {
          const clientId = str(x?.clientTxnId, 64) || "(tanpa id)";
          const invalid = invalidTransaction(x);
          if (invalid) {
            rejected.push({ clientTxnId: clientId, error: invalid });
            continue;
          }
          const snapshot = { cashier: new Map(cashierCache), product: new Map(productCache), productCount, accepted, duplicates, voided, renumbered: renumbered.length };
          await c.exec("SAVEPOINT sync_sale");
          try {
            await syncOne(x, clientId);
            await c.exec("RELEASE SAVEPOINT sync_sale");
          } catch (error) {
            await c.exec("ROLLBACK TO SAVEPOINT sync_sale");
            await c.exec("RELEASE SAVEPOINT sync_sale");
            cashierCache.clear();
            for (const [k, v] of snapshot.cashier) cashierCache.set(k, v);
            productCache.clear();
            for (const [k, v] of snapshot.product) productCache.set(k, v);
            productCount = snapshot.productCount;
            accepted = snapshot.accepted;
            duplicates = snapshot.duplicates;
            voided = snapshot.voided;
            renumbered.length = snapshot.renumbered;
            const code = perSaleRejection(error);
            if (!code) throw error;
            rejected.push({ clientTxnId: clientId, error: code });
          }
        }
        if (idemKey && storesOutcomes) {
          await c.query(
            `INSERT INTO pos.sync_receipts (idempotency_key, tenant_id, business_id,
                                        rows_accepted, rows_duplicate, outcomes)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [idemKey, tenantId, businessId, accepted, duplicates, JSON.stringify({ rejected, renumbered })]
          );
        } else if (idemKey && !rejected.length && !renumbered.length) {
          await c.query(
            `INSERT INTO pos.sync_receipts (idempotency_key, tenant_id, business_id, rows_accepted, rows_duplicate)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [idemKey, tenantId, businessId, accepted, duplicates]
          );
        }
        if (accepted > 0) {
          await writeActivity(c, {
            merchantId,
            tenantId,
            businessSector: sector,
            businessId,
            appModule: "SYNC",
            eventType: "SYNC_BATCH",
            severity: "INFO",
            summary: `Sinkronisasi ${accepted} transaksi dari perangkat kasir`,
            detail: { accepted, duplicates, rejected: rejected.length, renumbered: renumbered.length, batch: txns.length }
          });
        }
        return { replayed: false, accepted, duplicates, voided, rejected, renumbered, tenantId };
      });
      res.json({ ok: true, ...out });
    } catch (err) {
      if (err instanceof FinanceError) return res.status(err.status).json({ ok: false, error: err.message });
      if (err instanceof FreePlanAccessError) return res.status(403).json({ ok: false, error: err.message });
      if (err instanceof BillingError) return res.status(err.status).json({ ok: false, error: err.message });
      console.error("[sync] gagal:", err.message);
      if (err instanceof SyncAccessError) return res.status(403).json({ ok: false, error: "FORBIDDEN" });
      if (err instanceof ProductLimitError) return res.status(409).json({ ok: false, error: "PRODUCT_LIMIT_EXCEEDED" });
      res.status(500).json({ ok: false, error: "SYNC_FAILED" });
    }
  });
  app.post("/api/v1/sync/catalog", async (req, res) => {
    if (!trustedPrincipal(req)) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    return res.status(409).json({ ok: false, error: "VERSIONED_CATALOG_SYNC_REQUIRED" });
  });
  app.post("/api/v1/sync/activity", async (req, res) => {
    const b = req.body ?? {};
    const businessId = str(b.businessId, 96);
    if (!businessId) return res.status(400).json({ ok: false, error: "BUSINESS_ID_REQUIRED" });
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    if (!await canAccessBusiness(db, principal, businessId)) {
      return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    }
    const t = await db.query(`SELECT id, tenant_id, business_sector FROM internal.merchants WHERE (external_ref = $1 OR id::text = $1)`, [
      businessId
    ]);
    if (!t.rows.length) return res.status(404).json({ ok: false, error: "MERCHANT_NOT_SYNCED" });
    const id = await writeActivity(db, {
      merchantId: t.rows[0].id,
      tenantId: t.rows[0].tenant_id,
      businessSector: t.rows[0].business_sector,
      businessId,
      appModule: String(b.appModule ?? "POS"),
      eventType: String(b.eventType ?? "UNKNOWN"),
      severity: String(b.severity ?? "INFO"),
      actorName: str(b.actorName, 100),
      actorRole: str(b.actorRole, 24),
      amountIdr: b.amountIdr == null ? null : num(b.amountIdr),
      summary: String(b.summary ?? "Kejadian tanpa keterangan"),
      detail: typeof b.detail === "object" && b.detail ? b.detail : {},
      occurredAt: str(b.occurredAt, 40)
    });
    if (!id) return res.status(400).json({ ok: false, error: "INVALID_ACTIVITY" });
    res.json({ ok: true, id });
  });
  app.get("/api/v1/sync/status", async (req, res) => {
    const businessId = str(req.query.businessId, 96);
    if (!businessId) return res.status(400).json({ ok: false, error: "BUSINESS_ID_REQUIRED" });
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    if (!await canAccessBusiness(db, principal, businessId)) {
      return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    }
    const { rows } = await db.query(
      `SELECT m.id, m.name, m.business_sector,
              COUNT(x.id)::int              AS synced_transactions,
              COALESCE(SUM(x.total_amount), 0) AS synced_revenue,
              MAX(x.created_at)             AS last_transaction_at
         FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
         LEFT JOIN pos.transactions x ON x.tenant_id = t.id AND x.merchant_id=m.id
        WHERE (m.external_ref = $1 OR m.id::text=$1) AND t.owner_user_ref=$2
          AND t.is_active AND t.merged_into IS NULL AND m.is_active
        GROUP BY m.id, m.name, m.business_sector`,
      [businessId, principal.subject]
    );
    if (!rows.length) return res.json({ ok: true, synced: false });
    res.json({ ok: true, synced: true, ...rows[0] });
  });
  app.post("/api/v1/sync/customers", async (req, res) => {
    if (!trustedPrincipal(req)) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    return res.status(409).json({ ok: false, error: "VERSIONED_CUSTOMER_SYNC_REQUIRED" });
  });
  app.get("/api/v1/sync/catalog", async (req, res) => {
    const businessId = str(req.query.businessId, 96);
    const sector = str(req.query.sector, 16);
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const ownerRef = principal.subject;
    if (!businessId || !sector || !SECTOR_SET2.has(sector)) {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST", detail: "businessId dan sector wajib" });
    }
    try {
      const tenantRes = await db.query(
        `SELECT t.id AS tenant_id, m.id AS merchant_id
           FROM internal.tenants t
           JOIN internal.merchants m ON m.tenant_id = t.id
          WHERE (m.external_ref = $1 OR m.id::text = $1) AND m.business_sector=$3 AND t.owner_user_ref=$2 AND t.is_active AND t.merged_into IS NULL AND m.is_active`,
        [businessId, ownerRef, sector]
      );
      if (!tenantRes.rows.length) {
        return res.json({ ok: true, products: [], categories: [] });
      }
      const tenantId = tenantRes.rows[0].tenant_id;
      const merchantId = tenantRes.rows[0].merchant_id;
      const prodRes = await db.query(
        `SELECT p.id, p.external_ref, p.name, p.sku, p.price, p.cost_price, p.unit, p.description,
                  p.is_available, COALESCE(p.category_name, 'Lainnya') AS category_name
             FROM pos.products p
            WHERE p.tenant_id = $1 AND p.merchant_id = $2 AND NOT p.sync_quarantined
            ORDER BY p.name ASC`,
        [tenantId, merchantId]
      );
      const categoryId = (r) => r.category_id || `category:${r.category_name}`;
      res.json({
        ok: true,
        products: prodRes.rows.map((r) => ({
          id: r.external_ref || r.id,
          name: r.name,
          sku: r.sku,
          price: Number(r.price || 0),
          costPrice: Number(r.cost_price || 0),
          unit: r.unit,
          description: r.description,
          categoryName: r.category_name,
          categoryId: categoryId(r),
          isAvailable: Boolean(r.is_available)
        })),
        categories: [...new Map(prodRes.rows.map((r) => [categoryId(r), {
          id: categoryId(r),
          name: r.category_name
        }])).values()]
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || "CATALOG_FETCH_FAILED" });
    }
  });
  app.post("/api/v1/sync/attendance", (req, res) => {
    if (!trustedPrincipal(req)) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    return res.status(409).json({ ok: false, error: "VERSIONED_LABOR_SYNC_REQUIRED" });
  });
  app.post("/api/v1/sync/payroll", (req, res) => {
    if (!trustedPrincipal(req)) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    return res.status(409).json({ ok: false, error: "VERSIONED_LABOR_SYNC_REQUIRED" });
  });
}

// services/billing/store.ts
async function pastikanPaket(db, paket) {
  for (const p of paket) {
    await db.query(
      `INSERT INTO billing.plans (id, name, tier_level, billing_cycle, price_idr, product_limit, features)
       VALUES ($1, $2, $3, 'MONTHLY', $4, $5, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, tier_level = EXCLUDED.tier_level,
         price_idr = EXCLUDED.price_idr, product_limit = EXCLUDED.product_limit, features = EXCLUDED.features,
         updated_at = CURRENT_TIMESTAMP`,
      [p.id, p.name, p.tierLevel, p.priceIdr, p.productLimit, JSON.stringify(p.features)]
    );
  }
}

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
import express from "express";
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

// api/_runtime.ts
async function buildRuntime() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  const db = await connectDb({ schema: "billing", max: 2 });
  await pastikanPaket(db, SAAS_PLANS);
  const app = express2();
  app.use(express2.json({ limit: "10mb", verify: (req, _res, buf) => {
    req.rawBody = buf;
  } }));
  registerBillingRoutes(app, db);
  registerAdminRoutes(app, async () => db);
  registerSyncRoutes(app, db);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use((_req, res) => res.status(404).json({ ok: false, error: "NOT_FOUND" }));
  app.use((err, _req, res, _next) => {
    if (_req.path === "/api/v1/webhooks/doku") {
      console.warn("[doku] NOTIFICATION_PARSER_OR_RUNTIME_ERROR");
      return res.status(err.type === "entity.parse.failed" ? 400 : err.type === "entity.too.large" ? 413 : 500).json({ ok: false, error: "NOTIFICATION_REQUEST_FAILED" });
    }
    console.error("[api]", err.message);
    res.status(500).json({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });
  return app;
}
var PUBLIC_EXACT = /* @__PURE__ */ new Set(["/api/v1/subscription/plans", "/api/v1/webhooks/doku", "/api/health"]);
function isPublicApi(path, method) {
  if (PUBLIC_EXACT.has(path)) return true;
  if ((method === "GET" || method === "HEAD") && (path === "/blog" || /^\/blog\/[A-Za-z0-9._~-]{1,200}$/.test(path) || path === "/sitemap.xml" || path === "/rss.xml")) return true;
  if (path === "/api/v1/blog-automation" || path.startsWith("/api/v1/blog-automation/")) return true;
  if (method === "GET" && (path === "/api/v1/blog" || /^\/api\/v1\/blog\/[A-Za-z0-9._~-]{1,200}$/.test(path))) return true;
  return method === "POST" && /^\/api\/v1\/blog\/[A-Za-z0-9._~-]{1,200}\/like$/.test(path);
}
function createNativeApiHandler(authenticate = authenticateBearer, build = buildRuntime) {
  let runtime2;
  return async (req, res) => {
    normalizeVercelUrl(req);
    res.setHeader("Cache-Control", "no-store");
    stripIdentityHeaders(req);
    const path = String(req.url || "").split("?")[0];
    if (!isPublicApi(path, String(req.method || "GET"))) {
      let principal;
      try {
        principal = await authenticate(req);
      } catch (error) {
        if (error instanceof AuthUnavailableError) {
          res.setHeader("Retry-After", "2");
          return res.status(503).json({ ok: false, error: "AUTH_UNAVAILABLE" });
        }
        return res.status(401).json({ ok: false, error: "AUTHENTICATION_REQUIRED" });
      }
      if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "AUTHENTICATION_REQUIRED" });
      applyPrincipal(req, principal);
    }
    try {
      runtime2 ??= build().catch((err) => {
        runtime2 = void 0;
        throw err;
      });
      const app = await runtime2;
      app(req, res);
    } catch {
      res.status(503).json({ ok: false, error: "DATABASE_UNAVAILABLE" });
    }
  };
}
var handleNativeApi = createNativeApiHandler();

// api/_gateway.ts
async function proxyToGateway(req, res) {
  normalizeVercelUrl(req);
  const base = (process.env.GATEWAY_URL || "").replace(/\/$/, "");
  if (base) {
    try {
      if (new URL(base).host === req.headers.host) return void res.status(503).json({ ok: false, error: "GATEWAY_SELF_REFERENCE" });
      const headers = { ...req.headers };
      for (const key of ["host", "connection", "content-length", "transfer-encoding", ...TRUSTED_IDENTITY_HEADERS]) delete headers[key];
      const isDoku = req.url?.split("?")[0] === "/api/v1/webhooks/doku";
      if (isDoku && req.rawBody === void 0 && req.body !== void 0) return void res.status(400).json({ ok: false, error: "RAW_BODY_REQUIRED" });
      let body = req.rawBody ?? (req.body === void 0 ? void 0 : JSON.stringify(req.body));
      if (req.url?.split("?")[0] === "/api/v1/webhooks/doku" && body === void 0) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > 1048576) return void res.status(413).end();
          chunks.push(bytes);
        }
        body = Buffer.concat(chunks);
      }
      const response = await fetch(base + req.url, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? void 0 : body,
        signal: AbortSignal.timeout(35e3)
      });
      res.status(response.status);
      res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
      for (const name of ["cache-control", "x-request-id"]) {
        const value = response.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.status(503).json({ ok: false, error: "GATEWAY_UNAVAILABLE" });
    }
    return;
  }
  await handleNativeApi(req, res);
}

// src/server/releaseLatency.ts
import pg3 from "pg";
import { performance } from "node:perf_hooks";
function createReleaseLatencyHandler(factory = (config) => new pg3.Client(config)) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.VERCEL_ENV !== "preview" || process.env.HYBRID_STAGING !== "1" || process.env.NEON_DB_PHASE1 !== "1") return res.status(404).json({ ok: false });
    if (req.method !== "GET") return res.status(405).json({ ok: false });
    let c;
    try {
      const url = process.env.DATABASE_URL || "";
      assertHybridDatabase(url);
      c = factory({ ...databaseTransport(url), connectionTimeoutMillis: 1e4, statement_timeout: 2e3 });
      const at = performance.now();
      await c.connect();
      const connectionMs = performance.now() - at;
      await c.query("BEGIN READ ONLY");
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const at2 = performance.now();
        await c.query("SELECT 1");
        samples.push(Math.round((performance.now() - at2) * 100) / 100);
      }
      await c.query("ROLLBACK");
      return res.status(200).json({ ok: true, scope: "bounded SELECT 1; no business rows or writes", region: process.env.VERCEL_REGION || "unknown", node: process.versions.node, connectionMs: Math.round(connectionMs), queryMs: samples });
    } catch {
      return res.status(503).json({ ok: false, error: "BENCHMARK_UNAVAILABLE" });
    } finally {
      if (c) await c.end().catch(() => {
      });
    }
  };
}
var releaseLatencyHandler = createReleaseLatencyHandler();

// src/server/adminHandler.ts
async function handler(req, res) {
  normalizeVercelUrl(req);
  if (req.url?.split("?")[0] === "/api/admin/release-latency") return releaseLatencyHandler(req, res);
  return proxyToGateway(req, res);
}
export {
  handler as default
};
