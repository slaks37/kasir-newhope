// services/shared/betterAuth.ts
import { betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { PostgresDialect } from "kysely";
import pg from "pg";
import { randomUUID } from "node:crypto";

// services/shared/databaseTls.ts
import fs from "node:fs";
function databaseTransport(connectionString, env = process.env) {
  const url = new URL(connectionString);
  const neon = /(?:^|\.)neon\.(?:tech|build)$/.test(url.hostname);
  if (neon) {
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
    return { connectionString: url.href, ssl: { rejectUnauthorized: true } };
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (local || url.searchParams.get("sslmode") === "disable") return { connectionString, ssl: void 0 };
  return { connectionString, ssl: env.PGSSLROOTCERT ? { ca: fs.readFileSync(env.PGSSLROOTCERT, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: false } };
}

// services/shared/poolConfig.ts
function databasePoolLimits(max, vercel = process.env.VERCEL) {
  return {
    // Each warm function owns a pool; keep the per-instance budget small.
    max: vercel === "1" ? Math.min(Math.max(1, max), 2) : max,
    idleTimeoutMillis: vercel === "1" ? 5e3 : 3e4,
    connectionTimeoutMillis: 1e4
  };
}

// services/shared/betterAuthPilot.ts
function betterAuthPilotConfig(env = process.env) {
  if (env.BETTER_AUTH_MIGRATION_PILOT !== "1" || env.VERCEL_ENV === "production" || env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && env.APP_ENV !== "staging") throw Error("BETTER_AUTH_PRODUCTION_CUTOVER_BLOCKED");
  if (env.NEON_PROJECT_ID !== "steep-sea-66546931" || env.NEON_BRANCH_ID !== "br-icy-dust-azqi5vlc") throw Error("BETTER_AUTH_STAGING_BRANCH_MISMATCH");
  if (!env.DATABASE_URL) throw Error("BETTER_AUTH_APPLICATION_DATABASE_REQUIRED");
  const databaseUrl = env.BETTER_AUTH_DATABASE_URL || env.DATABASE_URL || env.NEON_STAGING_DATABASE_URL || "";
  const database = new URL(databaseUrl), app = new URL(env.BETTER_AUTH_URL || "");
  if (database.hostname.replace("-pooler", "") !== "ep-damp-pine-azrnsoge.c-3.ap-southeast-1.aws.neon.tech") throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  if (database.pathname !== "/neondb" || !["postgres:", "postgresql:"].includes(database.protocol)) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  for (const value of [env.DATABASE_URL, env.BETTER_AUTH_DATABASE_URL, env.NEON_STAGING_DATABASE_URL].filter(Boolean)) {
    const u = new URL(value);
    if (u.hostname.replace("-pooler", "") !== database.hostname.replace("-pooler", "") || u.pathname !== "/neondb" || !["postgres:", "postgresql:"].includes(u.protocol) || u.port && u.port !== "5432" || u.hash || [...u.searchParams.keys()].some((k) => !["sslmode", "channel_binding", "application_name"].includes(k))) throw Error("BETTER_AUTH_DATABASE_MISMATCH");
  }
  if (app.username || app.password || app.pathname !== "/" || app.search || app.hash) throw Error("INVALID_BETTER_AUTH_ORIGIN");
  if (app.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["127.0.0.1", "localhost"].includes(app.hostname))) throw Error("BETTER_AUTH_HTTPS_REQUIRED");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 48) throw Error("BETTER_AUTH_SECRET_REQUIRED");
  return { databaseUrl, baseUrl: app.origin, secret: env.BETTER_AUTH_SECRET };
}

// services/shared/betterAuthEmail.ts
import { createHash } from "node:crypto";
import { Resend } from "resend";
async function sendBetterAuthEmail(mail) {
  const link = new URL(mail.url);
  if (link.origin !== mail.baseUrl || !link.pathname.startsWith("/api/auth/")) throw Error("AUTH_EMAIL_URL_REJECTED");
  if (link.protocol !== "https:") throw Error("AUTH_EMAIL_HTTPS_REQUIRED");
  if (process.env.AUTH_EMAIL_ENABLED !== "1" || !process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM)
    throw Error("AUTH_EMAIL_PROVIDER_NOT_CONFIGURED");
  const text = mail.kind === "RESET" ? "Atur password New Hope Anda" : "Verifikasi email New Hope Anda";
  const safeUrl = mail.url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const key = createHash("sha256").update(mail.kind + ":" + mail.email + ":" + mail.url).digest("hex");
  const response = await new Resend(process.env.RESEND_API_KEY).emails.send(
    {
      from: process.env.AUTH_EMAIL_FROM,
      to: mail.email,
      replyTo: "stefen@newsystem.space",
      subject: text,
      text: text + ". Buka tautan ini (berlaku 15 menit): " + mail.url + "\nJika Anda tidak meminta ini, abaikan email dan hubungi dukungan.",
      html: '<!doctype html><html lang="id"><body><h1>' + text + '</h1><p>Tautan berlaku 15 menit.</p><p><a href="' + safeUrl + '">' + text + "</a></p><p>Jika Anda tidak meminta ini, abaikan email dan hubungi stefen@newsystem.space.</p></body></html>"
    },
    { idempotencyKey: "newhope-auth-" + key }
  );
  if (response.error || !response.data?.id) throw Error("AUTH_EMAIL_DELIVERY_FAILED");
}

// services/shared/betterAuth.ts
function createBetterAuthRuntime(config = betterAuthPilotConfig(), sendEmail = sendBetterAuthEmail) {
  const pool = new pg.Pool({ ...databaseTransport(config.databaseUrl), ...databasePoolLimits(2) });
  const auth = betterAuth({
    appName: "New Hope POS",
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret: config.secret,
    database: { dialect: new PostgresDialect({ pool }), type: "postgres", schemaName: "newhope_auth" },
    trustedOrigins: [config.baseUrl],
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

// src/server/betterAuthHandler.ts
function createBetterAuthHandler(runtime2 = getBetterAuthRuntime) {
  return async function betterAuthHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.AUTH_PROVIDER !== "better-auth") return res.status(404).json({ error: "NOT_FOUND" });
    normalizeVercelUrl(req);
    const relative = new URL(req.originalUrl || req.url, "http://localhost");
    if (!relative.pathname.startsWith("/api/auth/") || !["GET", "POST"].includes(req.method)) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      const config = betterAuthPilotConfig();
      if (req.headers.origin && req.headers.origin !== config.baseUrl) return res.status(403).json({ error: "INVALID_ORIGIN" });
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (["host", "content-length", "connection", "transfer-encoding"].includes(key)) continue;
        if (typeof value === "string") headers.set(key, value);
      }
      const ip = process.env.VERCEL ? String(req.headers["x-vercel-forwarded-for"] || "unknown") : String(req.socket?.remoteAddress || "unknown");
      headers.set("x-forwarded-for", ip);
      headers.delete("x-real-ip");
      let body;
      if (req.method === "POST") {
        if (req.body !== void 0) body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
        else {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 32768) return res.status(413).json({ error: "BODY_TOO_LARGE" });
            chunks.push(Buffer.from(chunk));
          }
          body = Buffer.concat(chunks);
        }
        if (body && body.length > 32768) return res.status(413).json({ error: "BODY_TOO_LARGE" });
      }
      const request = new Request(config.baseUrl + relative.pathname + relative.search, { method: req.method, headers, body });
      const response = await runtime2().auth.handler(request);
      const bytes = Buffer.from(await response.arrayBuffer());
      let pendingMfa = false;
      if (relative.pathname === "/api/auth/sign-in/email") try {
        pendingMfa = JSON.parse(bytes.toString()).twoFactorRedirect === true;
      } catch {
      }
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie" && !(pendingMfa && key === "set-auth-token")) res.setHeader(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("set-cookie", cookies);
      return res.status(response.status).send(bytes);
    } catch {
      return res.status(503).json({ error: "AUTH_UNAVAILABLE" });
    }
  };
}
var betterAuthHandler_default = createBetterAuthHandler();
export {
  createBetterAuthHandler,
  betterAuthHandler_default as default
};
