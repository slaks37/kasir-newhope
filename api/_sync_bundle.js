var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// services/shared/betterAuthConfig.ts
function authProvider(env = process.env) {
  const value = env.AUTH_PROVIDER || "supabase";
  if (value !== "supabase" && value !== "neon") throw Error("AUTH_PROVIDER_UNSUPPORTED");
  return value;
}
function getAuthConfig(env = process.env) {
  const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && env.APP_ENV !== "staging";
  if (production || env.NEWHOPE_NEON_AUTH_STAGING !== "1") throw Error("NEON_AUTH_PRODUCTION_CUTOVER_DISABLED");
  const base = new URL(env.NEWHOPE_AUTH_URL || "");
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash || base.protocol !== "https:" && !(env.NODE_ENV !== "production" && local(base.hostname))) throw Error("AUTH_HTTPS_ORIGIN_REQUIRED");
  const databaseUrl = env.BETTER_AUTH_DATABASE_URL || "", db = new URL(databaseUrl), app = new URL(env.DATABASE_URL || databaseUrl);
  const host = db.hostname.replace("-pooler", ""), expected = env.NEWHOPE_AUTH_NEON_HOST;
  const testLocal = env.NODE_ENV === "test" && local(db.hostname);
  if (!["postgres:", "postgresql:"].includes(db.protocol) || db.hash || db.port && db.port !== "5432" && !testLocal || [...db.searchParams.keys()].some((k) => !["sslmode", "channel_binding", "application_name"].includes(k))) throw Error("AUTH_DATABASE_TARGET_REJECTED");
  if (!testLocal && (!expected || host !== expected || !/^br-/.test(env.NEWHOPE_AUTH_NEON_BRANCH_ID || "") || !host.endsWith(".neon.tech"))) throw Error("AUTH_STAGING_BRANCH_REQUIRED");
  if (app.hostname.replace("-pooler", "") !== host || app.pathname !== db.pathname) throw Error("AUTH_APPLICATION_BRANCH_MISMATCH");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 48) throw Error("AUTH_SECRET_REQUIRED");
  const allowedOrigins = [.../* @__PURE__ */ new Set([base.origin, ...(env.NEWHOPE_AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean)])];
  for (const origin of allowedOrigins) {
    const u = new URL(origin);
    if (u.origin !== origin || u.protocol !== "https:" && !(env.NODE_ENV !== "production" && local(u.hostname))) throw Error("AUTH_ORIGIN_REJECTED");
  }
  const nativeOrigins = (env.NEW_HOPE_NATIVE_ORIGINS || "").split(",").filter(Boolean);
  if (nativeOrigins.some((o) => !["capacitor://localhost", "https://localhost"].includes(o))) throw Error("AUTH_NATIVE_ORIGIN_REJECTED");
  const google = env.NEWHOPE_GOOGLE_CLIENT_ID && env.NEWHOPE_GOOGLE_CLIENT_SECRET ? { clientId: env.NEWHOPE_GOOGLE_CLIENT_ID, clientSecret: env.NEWHOPE_GOOGLE_CLIENT_SECRET } : void 0;
  return { databaseUrl, baseUrl: base.origin, secret: env.BETTER_AUTH_SECRET, allowedOrigins, nativeOrigins, google };
}
function authDatabaseOptions(value) {
  const u = new URL(value);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("channel_binding");
  return { connectionString: u.href, ssl: local(u.hostname) ? false : { rejectUnauthorized: true } };
}
var local;
var init_betterAuthConfig = __esm({
  "services/shared/betterAuthConfig.ts"() {
    "use strict";
    local = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  }
});

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
var init_poolConfig = __esm({
  "services/shared/poolConfig.ts"() {
    "use strict";
  }
});

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
var init_authReturnUrl = __esm({
  "services/shared/authReturnUrl.ts"() {
    "use strict";
  }
});

// services/shared/betterAuthEmail.ts
import { createHash } from "node:crypto";
import { Resend } from "resend";
function authEmailPayload(mail, env = process.env) {
  const origin = new URL(mail.baseUrl), link = new URL(mail.url);
  if (origin.origin !== mail.baseUrl || link.origin !== mail.baseUrl || (mail.kind === "RESET" ? !/^\/api\/auth\/reset-password\/[^/]+$/.test(link.pathname) : link.pathname !== "/api/auth/verify-email")) throw Error("AUTH_EMAIL_URL_REJECTED");
  if (link.protocol !== "https:") throw Error("AUTH_EMAIL_HTTPS_REQUIRED");
  const callbacks = link.searchParams.getAll("callbackURL");
  if (callbacks.length !== 1) throw Error("AUTH_CALLBACK_REJECTED");
  authReturnUrl(mail.kind, callbacks[0], mail.baseUrl, [mail.baseUrl, ...(env.NEWHOPE_AUTH_TRUSTED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(mail.email)) throw Error("AUTH_EMAIL_RECIPIENT_REJECTED");
  if (env.AUTH_EMAIL_ENABLED !== "1" || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM || !env.AUTH_EMAIL_VERIFIED_DOMAIN)
    throw Error("AUTH_EMAIL_PROVIDER_NOT_CONFIGURED");
  const sender = env.AUTH_EMAIL_FROM.match(/^(?:[^<>\r\n]+<)?([^<>\s@,;]+@[^<>\s@,;]+)(?:>)?$/)?.[1];
  if (!sender || sender.split("@")[1].toLowerCase() !== env.AUTH_EMAIL_VERIFIED_DOMAIN.toLowerCase()) throw Error("AUTH_EMAIL_SENDER_REJECTED");
  if (env.VERCEL_ENV === "preview" || env.APP_ENV === "staging") {
    const allowed = (env.AUTH_EMAIL_ALLOWED_RECIPIENTS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(mail.email.toLowerCase())) throw Error("AUTH_EMAIL_STAGING_RECIPIENT_NOT_APPROVED");
  }
  const text2 = mail.kind === "RESET" ? "Atur password New Hope Anda" : "Verifikasi email New Hope Anda";
  const safeUrl = mail.url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const key = createHash("sha256").update(mail.kind + ":" + mail.email + ":" + mail.url).digest("hex");
  return { payload: {
    from: env.AUTH_EMAIL_FROM,
    to: mail.email,
    replyTo: "stefen@newsystem.space",
    subject: text2,
    text: text2 + ". Buka tautan ini (berlaku 15 menit): " + mail.url + "\nJika Anda tidak meminta ini, abaikan email dan hubungi dukungan.",
    html: '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' + text2 + "</title></head><body><h1>" + text2 + '</h1><p>Tautan berlaku 15 menit.</p><p><a href="' + safeUrl + '">' + text2 + "</a></p><p>Jika Anda tidak meminta ini, abaikan email dan hubungi stefen@newsystem.space.</p></body></html>"
  }, idempotencyKey: "newhope-auth-" + key };
}
async function sendBetterAuthEmail(mail) {
  const { payload, idempotencyKey } = authEmailPayload(mail);
  const response = await new Resend(process.env.RESEND_API_KEY).emails.send(payload, { idempotencyKey });
  if (response.error || !response.data?.id) throw Error("AUTH_EMAIL_DELIVERY_FAILED");
}
var init_betterAuthEmail = __esm({
  "services/shared/betterAuthEmail.ts"() {
    "use strict";
    init_authReturnUrl();
  }
});

// services/shared/betterAuth.ts
var betterAuth_exports = {};
__export(betterAuth_exports, {
  createBetterAuthRuntime: () => createBetterAuthRuntime,
  getBetterAuthRuntime: () => getBetterAuthRuntime
});
import { betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { PostgresDialect } from "kysely";
import pg from "pg";
import { randomUUID } from "node:crypto";
function createBetterAuthRuntime(config = getAuthConfig(), sendEmail = sendBetterAuthEmail) {
  const pool = new pg.Pool({ ...authDatabaseOptions(config.databaseUrl), ...databasePoolLimits(2) });
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
    user: { additionalFields: { isActive: { type: "boolean", defaultValue: true, required: true, input: false }, onboarding: { type: "json", required: false, input: true } } },
    socialProviders: config.google ? { google: config.google } : {},
    account: { accountLinking: { enabled: false } },
    databaseHooks: { user: { create: { after: async (user) => {
      await pool.query("INSERT INTO newhope_auth.registration_intents(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user.id]);
    } } } },
    session: { expiresIn: 3600, updateAge: 900, cookieCache: { enabled: false }, freshAge: 300 },
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
      allowPasswordless: true,
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
        if (ctx.path === "/sign-up/email" && ctx.body) {
          const raw = ctx.body.onboarding || {};
          ctx.body.onboarding = Object.fromEntries(["full_name", "store_name", "business_sector", "first_outlet_name", "second_outlet_name"].filter((k) => typeof raw[k] === "string" && raw[k].length <= 100).map((k) => [k, raw[k]]));
        }
        if (ctx.path === "/sign-in/social" && ctx.body) {
          let target;
          try {
            target = new URL(ctx.body.callbackURL || config.baseUrl + "/overview");
          } catch {
            throw new APIError("BAD_REQUEST", { code: "AUTH_CALLBACK_REJECTED" });
          }
          if (target.origin !== config.baseUrl || target.hash || target.username || target.password || !(["/overview", "/login"].includes(target.pathname) && !target.search || target.pathname === "/api/auth/native/complete" && target.searchParams.size === 1 && /^[-_A-Za-z0-9]{43}$/.test(target.searchParams.get("transaction") || ""))) throw new APIError("BAD_REQUEST", { code: "AUTH_CALLBACK_REJECTED" });
          ctx.body.callbackURL = target.href;
        }
        if (ctx.path.startsWith("/two-factor/") && ctx.body) ctx.body.trustDevice = false;
        if (["/two-factor/enable", "/two-factor/disable", "/two-factor/generate-backup-codes", "/two-factor/get-totp-uri", "/change-password", "/revoke-session", "/revoke-sessions", "/revoke-other-sessions", "/list-sessions"].includes(ctx.path)) {
          const current = await auth.api.getSession({ headers: ctx.headers || new Headers(), query: { disableCookieCache: true } });
          if (ctx.path === "/two-factor/enable" && current?.user && !current.user.twoFactorEnabled && Date.now() - new Date(current.session.createdAt).getTime() > 3e5) throw new APIError("FORBIDDEN", { message: "Masuk kembali sebelum menyiapkan autentikator.", code: "REAUTH_REQUIRED" });
          if (current?.user.twoFactorEnabled) {
            const fresh = (await pool.query(`SELECT 1 FROM newhope_auth.mfa_session_proofs
              WHERE session_id=$1 AND user_id=$2 AND method='totp' AND verified_at>now()-interval '10 minutes' AND verified_at<=now()+interval '30 seconds'`, [current.session.id, current.user.id])).rowCount;
            if (!fresh) throw new APIError("FORBIDDEN", { message: "Verifikasi ulang autentikator sebelum mengubah MFA.", code: "REAUTH_REQUIRED" });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!["/two-factor/verify-totp", "/two-factor/verify-backup-code"].includes(ctx.path) || ctx.context.returned instanceof APIError) return;
        const result = ctx.context.returned;
        if (!result?.token || !result.user?.id) return;
        const fresh = ctx.context.newSession;
        const sessionToken = fresh?.session.token || result.token;
        const userId = fresh?.user.id || result.user.id;
        await pool.query(`INSERT INTO newhope_auth.mfa_session_proofs(session_id,user_id,method,verified_at)
          SELECT id,"userId",$3,now() FROM newhope_auth.session WHERE token=$1 AND "userId"=$2 AND "expiresAt">now()
          ON CONFLICT(session_id) DO UPDATE SET method=EXCLUDED.method,verified_at=EXCLUDED.verified_at`, [sessionToken, userId, ctx.path === "/two-factor/verify-totp" ? "totp" : "recovery"]);
      })
    }
  });
  const ready = process.env.NODE_ENV === "test" ? Promise.resolve() : pool.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,pg_has_role(current_user,'svc_auth','MEMBER') AS auth_role,EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos' AND c.relname='transactions' AND has_table_privilege(current_user,c.oid,'SELECT')) AS ledger_access,has_table_privilege(current_user,'internal.auth_identity_bindings','INSERT') AS mapping_write FROM pg_roles r WHERE r.rolname=current_user`).then((result) => {
    const role = result.rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || !role.auth_role || role.ledger_access || role.mapping_write) throw Error("AUTH_DATABASE_ROLE_REJECTED");
  });
  void ready.catch(() => {
  });
  return { auth, pool, ready, close: () => pool.end() };
}
function getBetterAuthRuntime() {
  return runtime ??= createBetterAuthRuntime();
}
var runtime;
var init_betterAuth = __esm({
  "services/shared/betterAuth.ts"() {
    "use strict";
    init_betterAuthConfig();
    init_poolConfig();
    init_betterAuthEmail();
    init_authReturnUrl();
  }
});

// services/shared/authIdentity.ts
function issuer(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return fail("AUTH_IDENTITY_ISSUER_INVALID");
  }
  if (u.protocol !== "https:" || u.origin !== value || u.username || u.password) fail("AUTH_IDENTITY_ISSUER_INVALID");
  return value;
}
function subject(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail("AUTH_IDENTITY_SUBJECT_INVALID");
  return value;
}
function verified(input) {
  if (input.provider !== "better-auth" || input.isEmailVerified !== true || typeof input.email !== "string" || input.email.length > 320 || !/^\S+@\S+\.\S+$/.test(input.email)) return false;
  try {
    issuer(input.issuer);
    subject(input.subject);
    return true;
  } catch {
    return false;
  }
}
async function resolveAuthIdentity(db, input) {
  if (!verified(input)) return null;
  const rows = (await db.query(`SELECT b.canonical_user_id FROM internal.auth_identity_bindings b
  JOIN internal.users u ON u.id=b.canonical_user_id AND u.is_active
  WHERE b.provider=$1 AND b.issuer=$2 AND b.provider_subject=$3 AND b.is_active`, [input.provider, input.issuer, input.subject])).rows;
  return rows.length === 1 ? rows[0].canonical_user_id : null;
}
async function reverseAuthIdentity(db, input) {
  if (input.provider !== "better-auth" || !uuid.test(input.canonicalSubject)) return null;
  try {
    issuer(input.issuer);
  } catch {
    return null;
  }
  const rows = (await db.query(`SELECT b.provider_subject FROM internal.auth_identity_bindings b
  JOIN internal.users u ON u.id=b.canonical_user_id AND u.is_active
  WHERE b.provider=$1 AND b.issuer=$2 AND b.canonical_user_id=$3 AND b.is_active`, [input.provider, input.issuer, input.canonicalSubject])).rows;
  return rows.length === 1 ? rows[0].provider_subject : null;
}
var uuid, fail, resolveProviderIdentity;
var init_authIdentity = __esm({
  "services/shared/authIdentity.ts"() {
    "use strict";
    uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    fail = (code) => {
      throw Error(code);
    };
    resolveProviderIdentity = reverseAuthIdentity;
  }
});

// services/shared/betterAuthPrincipal.ts
var betterAuthPrincipal_exports = {};
__export(betterAuthPrincipal_exports, {
  NeonIdentityError: () => NeonIdentityError,
  authenticateNeonRequest: () => authenticateNeonRequest,
  neonSession: () => neonSession,
  resolveNeonSession: () => resolveNeonSession
});
async function neonSession(headers, runtime2 = getBetterAuthRuntime(), capture) {
  await runtime2.ready;
  const checked = new Headers(headers);
  if (checked.has("authorization")) checked.delete("cookie");
  const result = await runtime2.auth.api.getSession({ headers: checked, query: { disableCookieCache: true }, returnHeaders: true });
  capture?.(result.headers);
  return result.response;
}
async function resolveNeonSession(headers, options = {}, runtime2 = getBetterAuthRuntime()) {
  let refreshHeaders = new Headers();
  const config = getAuthConfig(), session = await neonSession(headers, runtime2, (h) => {
    refreshHeaders = h;
  });
  if (!session?.user.emailVerified || !session.user.isActive) return null;
  const db = runtime2.pool;
  let subject2 = await resolveAuthIdentity(db, { provider: "better-auth", issuer: config.baseUrl, subject: session.user.id, email: session.user.email, isEmailVerified: true });
  if (!subject2 && options.enroll) {
    await db.query("SELECT newhope_auth.enroll_new_identity($1,$2)", [session.user.id, config.baseUrl]);
    subject2 = await resolveAuthIdentity(db, { provider: "better-auth", issuer: config.baseUrl, subject: session.user.id, email: session.user.email, isEmailVerified: true });
  }
  if (!subject2) throw new NeonIdentityError("IDENTITY_MAPPING_REQUIRED");
  const proof = (await db.query(`SELECT method,verified_at FROM newhope_auth.mfa_session_proofs WHERE session_id=$1 AND user_id=$2 AND method IN ('totp','recovery') AND verified_at<=now()+interval '30 seconds'`, [session.session.id, session.user.id])).rows[0];
  if (session.user.twoFactorEnabled && !proof && options.requireMfa !== false) throw new NeonIdentityError("MFA_REQUIRED");
  const principal = { subject: subject2, email: session.user.email, isEmailVerified: true, aal: proof?.method === "totp" ? "aal2" : "aal1", ...proof?.method === "totp" ? { mfaVerifiedAt: new Date(proof.verified_at).getTime() / 1e3 } : {} };
  return { session, principal, refreshHeaders };
}
async function authenticateNeonRequest(req) {
  const config = getAuthConfig(), headers = new Headers();
  for (const name of ["authorization", "cookie"]) if (typeof req.headers[name] === "string") headers.set(name, req.headers[name]);
  if (!headers.has("authorization") && !headers.has("cookie")) return null;
  if (!headers.has("authorization") && !["GET", "HEAD", "OPTIONS"].includes(req.method || "GET") && !config.allowedOrigins.includes(String(req.headers.origin || ""))) return null;
  try {
    return (await resolveNeonSession(headers))?.principal || null;
  } catch (error) {
    if (error instanceof NeonIdentityError) return null;
    throw error;
  }
}
var NeonIdentityError;
var init_betterAuthPrincipal = __esm({
  "services/shared/betterAuthPrincipal.ts"() {
    "use strict";
    init_betterAuth();
    init_betterAuthConfig();
    init_authIdentity();
    NeonIdentityError = class extends Error {
      constructor(code) {
        super(code);
        this.code = code;
      }
    };
  }
});

// services/shared/legacyAuthOperations.ts
var legacyAuthOperations_exports = {};
__export(legacyAuthOperations_exports, {
  createLegacyAuthOperations: () => createLegacyAuthOperations
});
function createLegacyAuthOperations() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  let opening;
  const client = async () => {
    if (!url || !serviceKey) throw new AuthOperationError(503, "SUPPORT_AUTH_NOT_CONFIGURED");
    return opening ??= import("@supabase/supabase-js").then(({ createClient }) => createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5e3) }) } }));
  };
  const identity = async (subject2) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject2)) return null;
    const auth = await client(), { data, error } = await auth.auth.admin.getUserById(subject2);
    if (error) {
      if (error.status === 404) return null;
      throw new AuthOperationError(502, "OWNER_LOOKUP_FAILED");
    }
    const u = data.user;
    return u?.id === subject2 && !u.deleted_at && (!u.banned_until || Date.parse(u.banned_until) <= Date.now()) && u.email ? { email: u.email, verified: !!u.email_confirmed_at } : null;
  };
  const destination = (path) => {
    let target;
    try {
      target = new URL(path, process.env.APP_URL || "https://kasir.newhope.space");
    } catch {
      throw new AuthOperationError(503, "SUPPORT_REDIRECT_NOT_CONFIGURED");
    }
    if (target.protocol !== "https:" || target.username || target.password) throw new AuthOperationError(503, "SUPPORT_REDIRECT_NOT_CONFIGURED");
    return target.href;
  };
  return {
    provider: "supabase",
    configured: !!url && !!serviceKey,
    ownerIdentity: identity,
    async sendConfirmation(email) {
      const auth = await client();
      const { error } = await auth.auth.resend({ type: "signup", email, options: { emailRedirectTo: destination("/login") } });
      if (error) throw new AuthOperationError(error.status === 429 ? 429 : 502, "EMAIL_CONFIRMATION_PROVIDER_REJECTED");
    },
    async sendReset(email) {
      const auth = await client();
      const { error } = await auth.auth.resetPasswordForEmail(email, { redirectTo: destination("/reset-password") });
      if (error) throw new AuthOperationError(error.status === 429 ? 429 : 502, "PASSWORD_RESET_PROVIDER_REJECTED");
    },
    async reauthenticate(_req, subject2, password, verifiedEmail) {
      if (!verifiedEmail || !password || password.length > 1024) return false;
      if (!url.startsWith("https://") || !anonKey) throw new AuthOperationError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
      let response;
      try {
        response = await fetch(url + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: anonKey, "content-type": "application/json" }, body: JSON.stringify({ email: verifiedEmail, password }), redirect: "error", signal: AbortSignal.timeout(5e3) });
      } catch {
        throw new AuthOperationError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
      }
      if (response.status >= 500 || response.status === 429) throw new AuthOperationError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
      if (!response.ok) return false;
      const data = await response.json();
      return data.user?.id === subject2 && Boolean(data.user?.email_confirmed_at || data.user?.confirmed_at);
    }
  };
}
var init_legacyAuthOperations = __esm({
  "services/shared/legacyAuthOperations.ts"() {
    "use strict";
    init_authProviderOperations();
  }
});

// services/shared/authProviderOperations.ts
function createAuthProviderOperations(deps = {}) {
  const provider = deps.provider || authProvider();
  if (provider === "supabase") {
    let operation;
    const legacy = () => operation ??= deps.legacy ? deps.legacy() : Promise.resolve().then(() => (init_legacyAuthOperations(), legacyAuthOperations_exports)).then((m) => m.createLegacyAuthOperations());
    return {
      provider,
      configured: deps.configured ?? !!((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
      ownerIdentity: async (s) => (await legacy()).ownerIdentity(s),
      sendConfirmation: async (e) => (await legacy()).sendConfirmation(e),
      sendReset: async (e) => (await legacy()).sendReset(e),
      reauthenticate: async (...args) => (await legacy()).reauthenticate(...args)
    };
  }
  const config = deps.config || getAuthConfig;
  const runtime2 = deps.runtime || (async () => {
    const m = await Promise.resolve().then(() => (init_betterAuth(), betterAuth_exports)), runtime3 = m.getBetterAuthRuntime();
    await runtime3.ready;
    return runtime3;
  });
  const reverse = deps.reverse || ((db, issuer2, canonical2) => resolveProviderIdentity(db, { provider: "better-auth", issuer: issuer2, canonicalSubject: canonical2 }));
  const resolve2 = deps.resolve || ((db, issuer2, subject2, email) => resolveAuthIdentity(db, { provider: "better-auth", issuer: issuer2, subject: subject2, email, isEmailVerified: true }));
  let configured = false;
  try {
    configured = !!config().baseUrl;
  } catch {
  }
  return {
    provider,
    configured: deps.configured ?? configured,
    async ownerIdentity(canonical2) {
      if (!canonicalUuid.test(canonical2)) return null;
      try {
        const { pool } = await runtime2(), subject2 = await reverse(pool, config().baseUrl, canonical2);
        if (!subject2) return null;
        const row = (await pool.query('SELECT id,email,"emailVerified","isActive" FROM newhope_auth."user" WHERE id=$1', [subject2])).rows[0];
        return row?.id === subject2 && row.isActive === true && typeof row.email === "string" ? { email: row.email, verified: row.emailVerified === true } : null;
      } catch {
        throw new AuthOperationError(502, "OWNER_LOOKUP_FAILED");
      }
    },
    async sendConfirmation(email) {
      try {
        const { auth } = await runtime2();
        await auth.api.sendVerificationEmail({ body: { email, callbackURL: new URL("/login", config().baseUrl).href } });
      } catch (error) {
        throw failure(error, "EMAIL_CONFIRMATION_PROVIDER_REJECTED");
      }
    },
    async sendReset(email) {
      try {
        const { auth } = await runtime2();
        await auth.api.requestPasswordReset({ body: { email, redirectTo: new URL("/reset-password", config().baseUrl).href } });
      } catch (error) {
        throw failure(error, "PASSWORD_RESET_PROVIDER_REJECTED");
      }
    },
    async reauthenticate(req, canonical2, password) {
      if (!canonicalUuid.test(canonical2) || password !== void 0 && (typeof password !== "string" || password.length > 1024)) return false;
      try {
        const { auth, pool } = await runtime2(), headers = headersFor(req), session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
        if (!session?.user?.id || session.user.emailVerified !== true || session.user.isActive !== true) return false;
        const mapped = await resolve2(pool, config().baseUrl, session.user.id, session.user.email);
        if (mapped !== canonical2) return false;
        const account = (await pool.query(`SELECT
      EXISTS(SELECT 1 FROM newhope_auth.account WHERE "userId"=$1 AND "providerId"='credential' AND password IS NOT NULL AND length(password)>0) AS has_password,
      EXISTS(SELECT 1 FROM newhope_auth.account WHERE "userId"=$1 AND "providerId"='google') AS google_account`, [session.user.id])).rows[0];
        if (account?.has_password === true) {
          if (!password) return false;
          return (await auth.api.verifyPassword({ headers, body: { password } }))?.status === true;
        }
        if (account?.google_account !== true || session.user.twoFactorEnabled !== true || !session.session?.id) return false;
        return (await pool.query(`SELECT 1 AS fresh FROM newhope_auth.mfa_session_proofs
      WHERE session_id=$1 AND user_id=$2 AND method='totp'
        AND verified_at>now()-interval '5 minutes' AND verified_at<=now()+interval '30 seconds'`, [session.session.id, session.user.id])).rows.length === 1;
      } catch (error) {
        if (["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"].includes(error?.status || "")) return false;
        throw new AuthOperationError(503, "OWNER_REAUTHENTICATION_UNAVAILABLE");
      }
    }
  };
}
var AuthOperationError, canonicalUuid, failure, headersFor;
var init_authProviderOperations = __esm({
  "services/shared/authProviderOperations.ts"() {
    "use strict";
    init_betterAuthConfig();
    init_authIdentity();
    AuthOperationError = class extends Error {
      constructor(status, code) {
        super(code);
        this.status = status;
      }
    };
    canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    failure = (error, code) => {
      const e = error;
      return new AuthOperationError(e?.status === 429 || e?.statusCode === 429 || e?.status === "TOO_MANY_REQUESTS" ? 429 : 502, code);
    };
    headersFor = (req) => {
      const headers = new Headers();
      for (const key of ["authorization", "cookie"]) {
        const value = req.headers[key];
        if (typeof value === "string") headers.set(key, value);
      }
      return headers;
    };
  }
});

// services/shared/auth.ts
init_betterAuthConfig();
var LOCAL_BYPASS = () => process.env.NODE_ENV !== "production" && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === "1";
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
  if (authProvider() === "neon") {
    try {
      return await (await Promise.resolve().then(() => (init_betterAuthPrincipal(), betterAuthPrincipal_exports))).authenticateNeonRequest(req);
    } catch {
      throw new AuthUnavailableError();
    }
  }
  const authorization = firstHeader(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return LOCAL_BYPASS() ? { subject: "local-development", isEmailVerified: true } : null;
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
  const subject2 = firstHeader(req.headers["x-auth-sub"]);
  const isEmailVerified = firstHeader(req.headers["x-auth-email-verified"]) === "true";
  if (subject2) return { subject: subject2, email: firstHeader(req.headers["x-auth-email"]) || void 0, isEmailVerified };
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

// services/shared/db.ts
init_poolConfig();
import fs from "node:fs";
import pg2 from "pg";

// services/shared/databaseStartup.ts
async function waitForDatabase(probe, vercel = process.env.VERCEL, sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms))) {
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
    return { ca: fs.readFileSync(process.env.PGSSLROOTCERT, "utf8"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}
async function connectDb(opts) {
  const connectionString = serverlessConnectionString(
    opts.connectionString || process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5432/postgres"
  );
  const pool = new pg2.Pool({
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

// services/pos/registerOperations.ts
import { createHash as createHash2 } from "node:crypto";

// services/shared/schemaFeatures.ts
var FEATURES = {
  cashierRegisters: `SELECT (SELECT count(*)=2 FROM pg_policy WHERE polrelid IN(to_regclass('pos.cash_registers'),to_regclass('pos.shifts')) AND polname='workspace_scope' AND position('workspace_modules' in pg_get_expr(polqual,polrelid))>0) AND to_regclass('pos.shift_variance_events') IS NOT NULL AND to_regprocedure('pos.bind_register_money()') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.transactions') AND attname='register_shift_id' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.shifts') AND attname='close_command' AND NOT attisdropped) AS ok`,
  moduleScopeGuard: `SELECT to_regprocedure('internal.requires_module_scope(uuid)') IS NOT NULL AS ok`,
  merchantActivityAppend: `SELECT to_regprocedure('internal.append_merchant_activity(uuid,uuid,text,text,text,uuid,text,text,numeric,text,jsonb,timestamptz)') IS NOT NULL AS ok`,
  workspaceIsolation: `SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.shared_state_records') AND attname='module_id' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.products') AND attname='workspace_payload' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.inventory_transactions') AND attname='actor_ref' AND NOT attisdropped) AND to_regclass('pos.workspace_commands') IS NOT NULL AND to_regclass('contract.workspace_subscription_metadata') IS NOT NULL AND to_regprocedure('internal.append_merchant_activity(uuid,uuid,text,text,text,uuid,text,text,numeric,text,jsonb,timestamptz)') IS NOT NULL AS ok`,
  moduleAssignments: `SELECT to_regclass('internal.merchant_modules') IS NOT NULL AND to_regclass('internal.outlet_modules') IS NOT NULL AND to_regclass('billing.module_entitlements') IS NOT NULL AS ok`,
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

// services/billing/freePlan.ts
var FreePlanAccessError = class extends Error {
};
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
var BillingError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function serializeSubscription(s) {
  const iso3 = (x) => new Date(x).toISOString();
  const free = isFreePlan({ status: s.status, planId: s.plan_id, currentPeriodEnd: iso3(s.current_period_end) });
  const planId = free ? FREE_PLAN_ID : s.plan_id;
  return {
    id: s.id,
    tenantId: s.tenant_id,
    planId,
    status: free ? "FREE" : s.status,
    plan: findSaaSPlan(planId),
    freeSelection: free ? s.free_selection : void 0,
    currentPeriodStart: iso3(s.current_period_start),
    currentPeriodEnd: iso3(s.current_period_end),
    gracePeriodEnd: s.grace_period_end ? iso3(s.grace_period_end) : void 0,
    billingCycle: s.billing_cycle,
    extraOutlets: free ? 0 : s.extra_outlets,
    trialStartedAt: s.trial_started_at ? iso3(s.trial_started_at) : null,
    trialEndsAt: s.trial_ends_at ? iso3(s.trial_ends_at) : null,
    hasUsedTrial: Boolean(s.has_used_trial)
  };
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

// src/platform/modules/registerCapabilities.ts
var REGISTER_CAPABILITIES = ["outlet_revenue.read", "shift.open", "shift.read", "shift_history.read", "shift.close", "shift_variance.submit", "shift_variance.approve", "register.configure"];
function registerCapabilities(role) {
  if (["OWNER", "ADMIN"].includes(role)) return [...REGISTER_CAPABILITIES];
  if (role === "MANAGER") return REGISTER_CAPABILITIES.filter((c) => c !== "register.configure");
  if (role === "CASHIER") return REGISTER_CAPABILITIES.filter((c) => !["register.configure", "shift_variance.approve"].includes(c));
  return [];
}

// src/modules/fnb/manifest.ts
var manifest = {
  "id": "fnb",
  "name": "New Hope F&B",
  "sector": "FNB",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Kasir & pesanan",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Dapur & pesanan",
      "tab": "tables",
      "permission": "tables"
    },
    {
      "id": "tables",
      "label": "Meja restoran",
      "tab": "tables",
      "permission": "tables"
    },
    {
      "id": "inventory",
      "label": "Katalog & persediaan",
      "tab": "inventory",
      "permission": "inventory"
    },
    {
      "id": "customers",
      "label": "Pelanggan",
      "tab": "customers",
      "permission": "customers"
    },
    {
      "id": "labor",
      "label": "Staf & komisi",
      "tab": "labor",
      "permission": "labor"
    },
    {
      "id": "reports",
      "label": "Laporan",
      "tab": "reports",
      "permission": "reports"
    },
    {
      "id": "group-reports",
      "label": "Laporan semua bisnis",
      "tab": "reports",
      "permission": "reports",
      "ownerOnly": true
    },
    {
      "id": "ai",
      "label": "Intelligence",
      "tab": "ai",
      "permission": "ai"
    },
    {
      "id": "settings",
      "label": "Pengaturan",
      "tab": "settings",
      "permission": "settings"
    },
    {
      "id": "payment",
      "label": "Langganan",
      "tab": "payment",
      "permission": "payment"
    },
    {
      "id": "businesses",
      "label": "Bisnis & outlet",
      "tab": "businesses",
      "permission": "businesses"
    }
  ],
  "workflow": [
    "Pesanan diterima",
    "Dimasak",
    "Siap",
    "Disajikan"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_fnb",
    "pos.tables",
    "pos.kds_stations"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "kitchen",
    "menu",
    "recipes"
  ],
  "dashboardKinds": [
    "kds_tickets",
    "tables"
  ],
  "limitations": ["Mode pilot memakai satu outlet. Resep dan persediaan bahan masih memakai pengelolaan lama."],
  "adapter": "sector-native"
};

// src/modules/retail/manifest.ts
var manifest2 = {
  "id": "retail",
  "name": "New Hope Retail",
  "sector": "RETAIL",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Kasir barcode",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Produk, SKU & stok",
      "tab": "inventory",
      "permission": "inventory"
    },
    { "id": "inventory", "label": "Katalog", "tab": "inventory", "permission": "inventory" },
    {
      "id": "customers",
      "label": "Pelanggan",
      "tab": "customers",
      "permission": "customers"
    },
    {
      "id": "labor",
      "label": "Staf & komisi",
      "tab": "labor",
      "permission": "labor"
    },
    {
      "id": "reports",
      "label": "Laporan",
      "tab": "reports",
      "permission": "reports"
    },
    {
      "id": "group-reports",
      "label": "Laporan semua bisnis",
      "tab": "reports",
      "permission": "reports",
      "ownerOnly": true
    },
    {
      "id": "ai",
      "label": "Intelligence",
      "tab": "ai",
      "permission": "ai"
    },
    {
      "id": "settings",
      "label": "Pengaturan",
      "tab": "settings",
      "permission": "settings"
    },
    {
      "id": "payment",
      "label": "Langganan",
      "tab": "payment",
      "permission": "payment"
    },
    {
      "id": "businesses",
      "label": "Bisnis & outlet",
      "tab": "businesses",
      "permission": "businesses"
    }
  ],
  "workflow": [
    "Purchase order",
    "Penerimaan",
    "Stok tersedia",
    "Penjualan",
    "Replenishment"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_retail",
    "pos.inventory_transactions"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "barcode",
    "sku",
    "replenishment"
  ],
  "dashboardKinds": [
    "products",
    "stock_items",
    "inventory_logs"
  ],
  "limitations": ["Purchase order, penerimaan barang, transfer, dan retur belum tersedia sebagai satu alur modul."],
  "adapter": "sector-native"
};

// src/modules/laundry/manifest.ts
var manifest3 = {
  "id": "laundry",
  "name": "New Hope Laundry",
  "sector": "LAUNDRY",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Penerimaan laundry",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Produksi & pengambilan",
      "tab": "tables",
      "permission": "tables"
    },
    {
      "id": "inventory",
      "label": "Katalog & persediaan",
      "tab": "inventory",
      "permission": "inventory"
    },
    {
      "id": "customers",
      "label": "Pelanggan",
      "tab": "customers",
      "permission": "customers"
    },
    {
      "id": "labor",
      "label": "Staf & komisi",
      "tab": "labor",
      "permission": "labor"
    },
    {
      "id": "reports",
      "label": "Laporan",
      "tab": "reports",
      "permission": "reports"
    },
    {
      "id": "group-reports",
      "label": "Laporan semua bisnis",
      "tab": "reports",
      "permission": "reports",
      "ownerOnly": true
    },
    {
      "id": "ai",
      "label": "Intelligence",
      "tab": "ai",
      "permission": "ai"
    },
    {
      "id": "settings",
      "label": "Pengaturan",
      "tab": "settings",
      "permission": "settings"
    },
    {
      "id": "payment",
      "label": "Langganan",
      "tab": "payment",
      "permission": "payment"
    },
    {
      "id": "businesses",
      "label": "Bisnis & outlet",
      "tab": "businesses",
      "permission": "businesses"
    }
  ],
  "workflow": [
    "Diterima",
    "Cuci",
    "Kering",
    "Setrika",
    "Packing",
    "Siap ambil",
    "Diambil"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_laundry",
    "pos.operational_jobs"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "pricing",
    "fragrance",
    "rack"
  ],
  "dashboardKinds": [
    "order_operations"
  ],
  "limitations": ["Penjadwalan mesin dan pengiriman notifikasi otomatis belum terintegrasi."],
  "adapter": "sector-native"
};

// src/modules/carwash/manifest.ts
var manifest4 = {
  "id": "carwash",
  "name": "New Hope Carwash",
  "sector": "CARWASH",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Checkout kendaraan",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Antrean kendaraan",
      "tab": "tables",
      "permission": "tables"
    },
    {
      "id": "inventory",
      "label": "Katalog & persediaan",
      "tab": "inventory",
      "permission": "inventory"
    },
    {
      "id": "customers",
      "label": "Pelanggan",
      "tab": "customers",
      "permission": "customers"
    },
    {
      "id": "labor",
      "label": "Staf & komisi",
      "tab": "labor",
      "permission": "labor"
    },
    {
      "id": "reports",
      "label": "Laporan",
      "tab": "reports",
      "permission": "reports"
    },
    {
      "id": "group-reports",
      "label": "Laporan semua bisnis",
      "tab": "reports",
      "permission": "reports",
      "ownerOnly": true
    },
    {
      "id": "ai",
      "label": "Intelligence",
      "tab": "ai",
      "permission": "ai"
    },
    {
      "id": "settings",
      "label": "Pengaturan",
      "tab": "settings",
      "permission": "settings"
    },
    {
      "id": "payment",
      "label": "Langganan",
      "tab": "payment",
      "permission": "payment"
    },
    {
      "id": "businesses",
      "label": "Bisnis & outlet",
      "tab": "businesses",
      "permission": "businesses"
    }
  ],
  "workflow": [
    "Antrean bay",
    "Cuci",
    "Kering & vakum",
    "Inspeksi",
    "Siap keluar"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_carwash",
    "pos.bays",
    "pos.vehicles"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "bay",
    "vehicle",
    "service"
  ],
  "dashboardKinds": [
    "carwash_queue"
  ],
  "limitations": ["Resource bay dan riwayat kendaraan kanonis belum terhubung penuh ke antrean."],
  "adapter": "sector-native"
};

// src/modules/barber/manifest.ts
var manifest5 = {
  "id": "barber",
  "name": "New Hope Barbershop",
  "sector": "BARBERSHOP",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Layanan & produk",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Booking & stylist",
      "tab": "tables",
      "permission": "tables"
    },
    {
      "id": "inventory",
      "label": "Katalog & persediaan",
      "tab": "inventory",
      "permission": "inventory"
    },
    {
      "id": "customers",
      "label": "Pelanggan",
      "tab": "customers",
      "permission": "customers"
    },
    {
      "id": "labor",
      "label": "Staf & komisi",
      "tab": "labor",
      "permission": "labor"
    },
    {
      "id": "reports",
      "label": "Laporan",
      "tab": "reports",
      "permission": "reports"
    },
    {
      "id": "group-reports",
      "label": "Laporan semua bisnis",
      "tab": "reports",
      "permission": "reports",
      "ownerOnly": true
    },
    {
      "id": "ai",
      "label": "Intelligence",
      "tab": "ai",
      "permission": "ai"
    },
    {
      "id": "settings",
      "label": "Pengaturan",
      "tab": "settings",
      "permission": "settings"
    },
    {
      "id": "payment",
      "label": "Langganan",
      "tab": "payment",
      "permission": "payment"
    },
    {
      "id": "businesses",
      "label": "Bisnis & outlet",
      "tab": "businesses",
      "permission": "businesses"
    }
  ],
  "workflow": [
    "Booking / walk-in",
    "Antrean",
    "Stylist",
    "Layanan",
    "Pembayaran",
    "Komisi"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_barber",
    "pos.chairs",
    "pos.staff_commissions"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "chair",
    "stylist",
    "commission"
  ],
  "dashboardKinds": [
    "bookings",
    "staff_members"
  ],
  "limitations": ["Pencegahan bentrok jadwal, walk-in, dan komisi per modul masih perlu validasi lanjutan."],
  "adapter": "sector-native"
};

// src/platform/modules/contracts.ts
var MODULE_IDS = ["fnb", "retail", "laundry", "carwash", "barber"];
var acceptedWorkspaceFeatures = (features, version) => version === 2 ? features.filter((feature) => !["labor", "ai"].includes(feature)) : features;
function isBusinessModuleId(value) {
  return typeof value === "string" && MODULE_IDS.includes(value);
}

// src/platform/modules/registry.ts
var moduleRegistry = Object.freeze({ fnb: manifest, retail: manifest2, laundry: manifest3, carwash: manifest4, barber: manifest5 });
function moduleManifest(id) {
  return isBusinessModuleId(id) ? moduleRegistry[id] : null;
}
function legacyModuleForSector(sector) {
  return Object.values(moduleRegistry).find((m) => m.sector === sector) || null;
}

// services/pos/modules.ts
var UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
var ModuleAccessError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
var moduleWorkspacesEnabled = () => process.env.NEW_HOPE_MODULE_WORKSPACES === "1";
var permissionsForModuleRole = (role) => {
  const roles = {
    OWNER: ["overview", "pos", "tables", "inventory", "customers", "labor", "reports", "ai", "settings", "payment", "businesses"],
    ADMIN: ["overview", "pos", "tables", "inventory", "customers", "labor", "reports", "ai", "settings"],
    MANAGER: ["overview", "pos", "tables", "inventory", "customers", "labor", "reports"],
    CASHIER: ["overview", "pos", "tables", "customers"],
    BARISTA: ["overview", "tables"],
    CHEF: ["overview", "tables"],
    WASHER: ["overview", "tables"],
    KAPSTER: ["overview", "tables"],
    STAFF: ["overview", "tables"]
  };
  return roles[role] || [];
};
async function resolveModuleAccess(db, subject2, businessId, outletId) {
  if (typeof businessId !== "string" || !UUID.test(businessId) || typeof outletId !== "string" || !UUID.test(outletId))
    throw new ModuleAccessError(400, "INVALID_MODULE_SCOPE");
  const { rows } = await db.query(`SELECT t.id AS tenant_id,m.business_sector,t.owner_user_ref=$3 AS tenant_owner,
    CASE WHEN t.owner_user_ref=$3 THEN 'OWNER' ELSE membership.role END AS role,
    (SELECT count(*)::int FROM internal.outlets ox WHERE ox.merchant_id=m.id) AS outlet_count
    FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    JOIN internal.tenants t ON t.id=m.tenant_id
    LEFT JOIN LATERAL (SELECT ms.role FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id
      WHERE u.id::text=$3 AND u.is_active AND ms.is_active AND ms.tenant_id=t.id
      AND (ms.scope_type='TENANT' OR ms.merchant_id=m.id AND
        (ms.scope_type='MERCHANT' OR ms.scope_type='OUTLET' AND ms.outlet_id=o.id))
      ORDER BY CASE ms.role WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 WHEN 'CASHIER' THEN 3 ELSE 4 END LIMIT 1
    ) membership ON true
    WHERE m.id=$1 AND o.id=$2 AND t.is_active AND t.merged_into IS NULL AND m.is_active AND o.is_active
      AND (t.owner_user_ref=$3 AND EXISTS(SELECT 1 FROM internal.users owner_identity WHERE owner_identity.id::text=$3 AND owner_identity.is_active) OR membership.role IS NOT NULL)`, [businessId, outletId, subject2]);
  if (rows.length !== 1) throw new ModuleAccessError(403, "MODULE_SCOPE_FORBIDDEN");
  const scope = rows[0];
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [scope.tenant_id, businessId]);
  if (!moduleWorkspacesEnabled() || !await hasSchemaFeature(db, "moduleAssignments"))
    return { enabled: false, businessId, outletId, modules: [] };
  await assertTenantWritable(db, scope.tenant_id);
  if ((await freePlanState(db, scope.tenant_id)).free) throw new ModuleAccessError(403, "MODULE_PILOT_REQUIRES_PAID_OR_TRIAL");
  const isolated = await hasSchemaFeature(db, "workspaceIsolation") && await hasSchemaFeature(db, "cashierRegisters");
  const assignments = await db.query(`SELECT mm.module_id, e.features,e.expires_at,COALESCE((to_jsonb(mm)->>'workspace_version')::int,1) AS workspace_version FROM internal.merchant_modules mm
    JOIN billing.module_entitlements e ON (e.tenant_id,e.merchant_id,e.module_id)=(mm.tenant_id,mm.merchant_id,mm.module_id)
    LEFT JOIN internal.outlet_modules om ON om.tenant_id=mm.tenant_id AND om.merchant_id=mm.merchant_id
      AND om.module_id=mm.module_id AND om.outlet_id=$3
    WHERE mm.tenant_id=$1 AND mm.merchant_id=$2 AND mm.enabled AND COALESCE(om.enabled,true)
      AND e.enabled AND e.expires_at>now() ORDER BY mm.module_id`, [scope.tenant_id, businessId, outletId]);
  const permissions = permissionsForModuleRole(scope.role);
  const modules = [];
  for (const row of assignments.rows) {
    const manifest6 = moduleManifest(row.module_id);
    const operationalModule = { BARISTA: "fnb", CHEF: "fnb", WASHER: "carwash", KAPSTER: "barber" };
    if (operationalModule[scope.role] && operationalModule[scope.role] !== row.module_id) continue;
    if (Number(row.workspace_version) === 2 && (!isolated || !["retail", "barber"].includes(row.module_id))) continue;
    if (!manifest6 || Number(row.workspace_version) !== 2 && (manifest6.sector !== scope.business_sector || scope.outlet_count !== 1)) continue;
    modules.push({ id: manifest6.id, permissions, capabilities: Number(row.workspace_version) === 2 ? registerCapabilities(scope.role) : [], features: acceptedWorkspaceFeatures(row.features, Number(row.workspace_version)), tenantOwner: Boolean(scope.tenant_owner), workspaceVersion: Number(row.workspace_version), expiresAt: new Date(row.expires_at).toISOString() });
  }
  return { enabled: true, businessId, outletId, modules };
}
async function authorizeNativeModule(db, subject2, merchantId, outletId, requirements) {
  if (!await hasSchemaFeature(db, "moduleAssignments")) return;
  const merchant = (await db.query("SELECT tenant_id,business_sector FROM internal.merchants WHERE id=$1", [merchantId])).rows[0];
  if (!merchant) throw new BillingError(403, "MODULE_SCOPE_FORBIDDEN");
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [merchant.tenant_id, merchantId]);
  const enrolled = await db.query("SELECT module_id,COALESCE((to_jsonb(mm)->>'workspace_version')::int,1) AS workspace_version FROM internal.merchant_modules mm WHERE tenant_id=$1 AND merchant_id=$2 AND (guard_legacy_apis OR COALESCE((to_jsonb(mm)->>'workspace_version')::int,1)=2)", [merchant.tenant_id, merchantId]);
  if (enrolled.rows.some((row) => Number(row.workspace_version) === 2)) throw new BillingError(403, "EXPLICIT_WORKSPACE_REQUIRED");
  if (!moduleWorkspacesEnabled() || !enrolled.rows.length) return;
  const outlets = await db.query("SELECT id FROM internal.outlets WHERE merchant_id=$1", [merchantId]);
  const target = outletId ?? (outlets.rows.length === 1 ? outlets.rows[0].id : null);
  const manifest6 = legacyModuleForSector(merchant.business_sector);
  try {
    const access = await resolveModuleAccess(db, subject2, merchantId, target);
    const grant = manifest6 && access.modules.find((module) => module.id === manifest6.id);
    if (grant?.workspaceVersion === 2) throw new ModuleAccessError(403, "EXPLICIT_WORKSPACE_REQUIRED");
    if (!access.enabled || !grant || requirements.some((options) => !options.some((permission) => grant.permissions.includes(permission) && grant.features.includes(permission))))
      throw new ModuleAccessError(403, "MODULE_COMMAND_FORBIDDEN");
  } catch (error) {
    if (error instanceof ModuleAccessError) throw new BillingError(error.status, error.message);
    throw error;
  }
}
var stateReadPermissions = {
  store_settings: permissionsForModuleRole("OWNER"),
  users: permissionsForModuleRole("OWNER"),
  staff_members: ["pos", "tables", "labor", "settings"],
  products: ["pos", "tables", "inventory", "reports", "ai"],
  categories: ["pos", "tables", "inventory", "reports", "ai"],
  tables: ["pos", "tables"],
  customers: ["pos", "customers", "ai"],
  order_operations: ["pos", "tables"],
  held_orders: ["pos"],
  inventory_logs: ["inventory"],
  promo_codes: ["pos", "inventory"],
  stock_items: ["inventory", "ai"],
  bundles: ["pos", "inventory"],
  attendance_logs: ["labor"],
  kds_tickets: ["tables"],
  carwash_queue: ["tables"],
  bookings: ["tables"],
  commission_rules: ["labor"],
  payroll_slips: ["labor"],
  sent_lifecycle_hooks: ["customers", "tables", "ai"]
};
var stateWritePermissions = {
  ...stateReadPermissions,
  store_settings: ["settings"],
  users: ["settings"],
  staff_members: ["labor", "settings"],
  products: ["inventory"],
  categories: ["inventory"],
  tables: ["tables"],
  customers: ["customers", "pos"],
  stock_items: ["inventory"],
  bundles: ["inventory"],
  promo_codes: ["inventory"]
};
var moduleStateRequirements = (kinds, write = false) => {
  const map = write ? stateWritePermissions : stateReadPermissions;
  return (kinds || Object.keys(map)).map((kind) => map[kind] || []);
};
async function authorizeModulePage(db, subject2, query) {
  const access = await resolveModuleAccess(db, subject2, query.businessId, query.outletId);
  if (!access.enabled || !isBusinessModuleId(query.moduleId)) throw new ModuleAccessError(403, "MODULE_NOT_ENABLED");
  const manifest6 = moduleManifest(query.moduleId);
  const page = manifest6.pages.find((p) => p.id === query.page);
  const grant = access.modules.find((m) => m.id === manifest6.id);
  if (!page || !grant || page.ownerOnly && !grant.tenantOwner || !grant.permissions.includes(page.permission) || !grant.features.includes(page.permission))
    throw new ModuleAccessError(403, "MODULE_PAGE_FORBIDDEN");
  if (grant.workspaceVersion === 2) await db.query("SELECT set_config('app.outlet_id',$1,true),set_config('app.module_id',$2,true)", [access.outletId, manifest6.id]);
  return { access, manifest: manifest6, page };
}
function respondError(res, error) {
  if (error instanceof ModuleAccessError || error instanceof BillingError) return res.status(error.status).json({ ok: false, error: error.message });
  return res.status(503).json({ ok: false, error: "MODULE_ACCESS_UNAVAILABLE" });
}
function registerModuleRoutes(app, db) {
  app.get("/api/v1/sync/modules/revenue", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const from = String(req.query.from || ""), to = String(req.query.to || "");
      const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      if (!validDate(from) || !validDate(to) || to < from || Date.parse(to) - Date.parse(from) > 90 * 864e5)
        throw new ModuleAccessError(400, "INVALID_REPORT_PERIOD");
      const offset = Number(req.query.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e5) throw new ModuleAccessError(400, "INVALID_REPORT_OFFSET");
      const result = await db.tx(async (c) => {
        const { access, page } = await authorizeModulePage(c, principal.subject, req.query);
        if (!["reports", "group-reports"].includes(page.id)) throw new ModuleAccessError(403, "MODULE_PAGE_FORBIDDEN");
        const owner = await c.query(`SELECT id FROM internal.tenants WHERE id::text=current_setting('app.tenant_id',true)
          AND owner_user_ref=$1 AND is_active AND merged_into IS NULL`, [principal.subject]);
        if (owner.rows.length !== 1) throw new ModuleAccessError(403, "GROUP_REPORT_OWNER_REQUIRED");
        const groups = await c.query(`WITH grouped AS (
          SELECT r.merchant_id,r.outlet_id,r.business_sector,to_jsonb(r)->>'module_id' AS module_id,count(*)::int AS transactions,
            sum(r.total_amount) AS net_revenue,sum(r.refund_amount) AS refunds,sum(r.cogs_amount) AS cogs
          FROM contract.merchant_revenue r WHERE r.tenant_id=$1
            AND r.created_at>=($2::date::timestamp AT TIME ZONE 'Asia/Jakarta')
            AND r.created_at<(($3::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta')
          GROUP BY r.merchant_id,r.outlet_id,r.business_sector,to_jsonb(r)->>'module_id'
        ) SELECT *,count(*) OVER()::int AS total_groups,sum(net_revenue) OVER() AS total_net_revenue,
          sum(transactions) OVER() AS total_transactions FROM grouped
          ORDER BY merchant_id,outlet_id NULLS FIRST,business_sector,module_id NULLS FIRST LIMIT 50 OFFSET $4`, [owner.rows[0].id, from, to, offset]);
        return {
          businessId: access.businessId,
          rows: groups.rows.map((row) => ({ ...row, moduleId: row.module_id || null, attribution: row.module_id ? "verified_module" : "historical_sector" })),
          nextOffset: groups.rows.length === 50 && offset + 50 < groups.rows[0].total_groups ? offset + 50 : null,
          attribution: groups.rows.some((r) => r.module_id) ? groups.rows.every((r) => r.module_id) ? "verified_module" : "mixed" : "historical_sector",
          from,
          to,
          timezone: "Asia/Jakarta"
        };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get("/api/v1/sync/modules/dashboard", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const result = await db.tx(async (c) => {
        const { access, manifest: manifest6, page } = await authorizeModulePage(c, principal.subject, req.query);
        if (page.id !== "dashboard") throw new ModuleAccessError(403, "MODULE_PAGE_FORBIDDEN");
        const definitions = {
          fnb: { kind: "kds_tickets", field: "status" },
          retail: { kind: "products", field: "stock" },
          laundry: { kind: "order_operations", field: "laundryStage" },
          carwash: { kind: "carwash_queue", field: "stage" },
          barber: { kind: "bookings", field: "status" }
        };
        const definition = definitions[manifest6.id];
        const isolated = access.modules.find((m) => m.id === manifest6.id)?.workspaceVersion === 2;
        if (isolated && manifest6.id === "retail") {
          const stock = await c.query(`SELECT CASE WHEN COALESCE(b.stock,0)<=0 THEN 'OUT_OF_STOCK' ELSE 'AVAILABLE' END AS status,count(*)::int count FROM pos.products p LEFT JOIN LATERAL(SELECT sum(current_stock) stock FROM pos.inventory_balances WHERE inventory_item_id=p.inventory_item_id AND outlet_id=$2) b ON true WHERE p.merchant_id=$1 AND p.module_id=$3 AND p.is_available GROUP BY 1 ORDER BY 1`, [access.businessId, access.outletId, manifest6.id]);
          return { buckets: stock.rows, total: stock.rows.reduce((n, r) => n + r.count, 0), generatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        }
        const rows = await c.query(`SELECT
          CASE WHEN $4='products' THEN CASE WHEN value->>'stock' ~ '^-?[0-9]+([.][0-9]+)?$' THEN CASE
            WHEN (value->>'stock')::numeric<=0 THEN 'OUT_OF_STOCK'
            WHEN (value->>'stock')::numeric<=(CASE WHEN value->>'minStockAlert' ~ '^[0-9]+([.][0-9]+)?$' THEN (value->>'minStockAlert')::numeric END) THEN 'LOW_STOCK'
            ELSE 'AVAILABLE' END ELSE 'UNKNOWN' END
          ELSE COALESCE(NULLIF(value->>$5,''),'UNKNOWN') END AS status,count(*)::int AS count
          FROM (SELECT DISTINCT ON(record_id) record_id,value,deleted
            FROM pos.shared_state_records
            WHERE tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id=$1
              AND scope=ANY($2::text[]) AND kind=$4
            ORDER BY record_id,updated_at DESC,revision DESC,(scope LIKE 'BUSINESS:%') DESC
          ) records WHERE NOT deleted AND COALESCE(value->>'branchId',value->>'outletId',$3)=$3
          GROUP BY 1 ORDER BY 1`, [access.businessId, isolated ? [`WORKSPACE:${access.businessId}:${access.outletId}:${manifest6.id}`] : [manifest6.sector, "BUSINESS:" + access.businessId], access.outletId, definition.kind, definition.field]);
        return { buckets: rows.rows, total: rows.rows.reduce((sum, row) => sum + row.count, 0), generatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get("/api/v1/sync/modules/access", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const result = await db.tx(async (c) => req.query.moduleId !== void 0 || req.query.page !== void 0 ? (await authorizeModulePage(c, principal.subject, req.query)).access : resolveModuleAccess(c, principal.subject, req.query.businessId, req.query.outletId));
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (error) {
      return respondError(res, error);
    }
  });
}

// services/pos/workspaceScope.ts
async function resolveWorkspaceScope(db, subject2, input, required = []) {
  if (!isBusinessModuleId(input.moduleId)) throw new ModuleAccessError(400, "EXPLICIT_MODULE_REQUIRED");
  const access = await resolveModuleAccess(db, subject2, input.businessId, input.outletId);
  const grant = access.modules.find((m) => m.id === input.moduleId);
  if (!access.enabled || !grant || grant.workspaceVersion !== 2) throw new ModuleAccessError(403, "ISOLATED_WORKSPACE_REQUIRED");
  if (required.some((permission) => !grant.permissions.includes(permission) || !grant.features.includes(permission))) throw new ModuleAccessError(403, "WORKSPACE_PERMISSION_DENIED");
  const row = (await db.query(`SELECT m.tenant_id,m.external_ref,CASE WHEN t.owner_user_ref=$2 THEN 'OWNER' ELSE ms.role END AS role,CASE WHEN t.owner_user_ref=$2 THEN 'TENANT' ELSE ms.scope_type END AS membership_scope
 FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id LEFT JOIN LATERAL(
 SELECT role,scope_type FROM internal.memberships WHERE user_id::text=$2 AND tenant_id=m.tenant_id AND is_active AND
 (scope_type='TENANT' OR merchant_id=m.id AND (scope_type='MERCHANT' OR outlet_id=$3))
 ORDER BY CASE role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 WHEN 'CASHIER' THEN 3 ELSE 4 END LIMIT 1
 ) ms ON true WHERE m.id=$1`, [access.businessId, subject2, access.outletId])).rows[0];
  if (!row?.role) throw new ModuleAccessError(403, "WORKSPACE_MEMBERSHIP_REQUIRED");
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true),set_config('app.outlet_id',$3,true),set_config('app.module_id',$4,true),set_config('app.actor_ref',$5,true),set_config('app.actor_role',$6,true)", [row.tenant_id, access.businessId, access.outletId, input.moduleId, subject2, row.role]);
  return { tenantId: row.tenant_id, merchantId: access.businessId, outletId: access.outletId, moduleId: input.moduleId, sector: moduleManifest(input.moduleId).sector, actorRef: subject2, role: row.role, membershipScope: row.membership_scope, transportRef: row.external_ref || access.businessId, namespace: `WORKSPACE:${access.businessId}:${access.outletId}:${input.moduleId}`, permissions: grant.permissions, features: grant.features };
}
function requireWorkspaceRole(scope, roles) {
  if (!roles.includes(scope.role)) throw new ModuleAccessError(403, "WORKSPACE_ROLE_FORBIDDEN");
}

// services/pos/activity.ts
var SECTORS = ["FNB", "LAUNDRY", "RETAIL", "CARWASH", "BARBERSHOP"];
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
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pick(allowed, v) {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}
async function writeActivity(db, a) {
  const sector = pick(SECTORS, a.businessSector);
  const mod = pick(APP_MODULES, a.appModule);
  if (!sector || !mod || !UUID_RE.test(a.merchantId)) return null;
  const { rows } = await db.query(
    await hasSchemaFeature(db, "merchantActivityAppend") ? `SELECT internal.append_merchant_activity($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid,$7::text,$8::text,$9::numeric,$10::text,$11::jsonb,$12::timestamptz) AS id` : `INSERT INTO internal.audit_logs
       (merchant_id, tenant_id, domain,
        event_type, severity, actor_id, actor_name, actor_role,
        amount_idr, summary, detail, occurred_at)
     VALUES ($1::uuid, $2::uuid, $3,
             $4, $5, $6::uuid, $7, $8,
             $9, $10, $11::jsonb, COALESCE($12::timestamptz, CURRENT_TIMESTAMP))
     RETURNING id`,
    [
      a.merchantId,
      a.tenantId && UUID_RE.test(a.tenantId) ? a.tenantId : a.merchantId,
      mod,
      a.eventType.slice(0, 48),
      pick(SEVERITIES, a.severity) ?? "INFO",
      a.actorUserId && UUID_RE.test(a.actorUserId) ? a.actorUserId : null,
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

// services/pos/registerOperations.ts
var UUID2 = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
var ID = /^[^\x00-\x1f\x7f]{1,128}$/;
var round = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
var hash = (v) => createHash2("sha256").update(JSON.stringify(v)).digest("hex");
var iso = (v) => new Date(String(v)).toISOString();
var RegisterError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
function requireRegisterCapability(scope, cap) {
  if (!registerCapabilities(scope.role).includes(cap)) throw new RegisterError(403, "REGISTER_CAPABILITY_FORBIDDEN");
}
async function resolve(db, req, cap) {
  const principal = trustedPrincipal(req);
  if (!principal || principal.subject === "local-development") throw new RegisterError(401, "UNAUTHENTICATED");
  if (!await hasSchemaFeature(db, "cashierRegisters")) throw new RegisterError(503, "REGISTER_MIGRATION_REQUIRED");
  const scope = await resolveWorkspaceScope(db, principal.subject, req.method === "GET" ? req.query : req.body, ["pos"]);
  requireRegisterCapability(scope, cap);
  return scope;
}
async function moduleContext(db, scope, moduleId) {
  await db.query("SELECT set_config('app.module_id',$1,true)", [moduleId]);
}
async function authorizedModules(db, scope, moduleIds) {
  if (!Array.isArray(moduleIds) || !moduleIds.length || moduleIds.length > 5 || new Set(moduleIds).size !== moduleIds.length) throw new RegisterError(400, "EXPLICIT_REGISTER_MODULES_REQUIRED");
  for (const moduleId of [...moduleIds].sort()) await resolveWorkspaceScope(db, scope.actorRef, { businessId: scope.merchantId, outletId: scope.outletId, moduleId }, ["pos"]);
  await moduleContext(db, scope, scope.moduleId);
  return [...moduleIds].sort();
}
async function clearRegisterBinding(db) {
  await db.query("SELECT set_config('app.register_id','',true),set_config('app.register_shift_id','',true)");
}
async function setBinding(db, registerId, shiftId) {
  await db.query("SELECT set_config('app.register_id',$1,true),set_config('app.register_shift_id',$2,true)", [registerId, shiftId]);
}
async function bindRegisterSale(db, scope, clientShiftId) {
  await clearRegisterBinding(db);
  const row = (await db.query("SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND (client_shift_id=$4 OR id::text=$4)", [scope.tenantId, scope.merchantId, scope.outletId, clientShiftId])).rows[0];
  if (row && !row.workspace_modules && row.module_id === scope.moduleId) return null;
  if (!row || !row.workspace_modules?.includes(scope.moduleId)) throw new RegisterError(403, "SHIFT_WORKSPACE_MISMATCH");
  await authorizedModules(db, scope, row.workspace_modules);
  await db.query("SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE", [row.register_id]);
  const locked = (await db.query("SELECT * FROM pos.shifts WHERE id=$1 FOR UPDATE", [row.id])).rows[0];
  if (locked.status !== "OPEN") throw new RegisterError(409, "SHIFT_CLOSED_REQUIRES_REVIEW");
  if (scope.role === "CASHIER" && locked.opened_by_user_id !== scope.actorRef) throw new RegisterError(403, "SHIFT_OPERATOR_REQUIRED");
  await setBinding(db, row.register_id, row.id);
  return row;
}
async function bindRegisterCash(db, scope, registerId) {
  if (!UUID2.test(String(registerId))) throw new RegisterError(400, "INVALID_REGISTER");
  const r = (await db.query("SELECT * FROM pos.cash_registers WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4", [registerId, scope.tenantId, scope.merchantId, scope.outletId])).rows[0];
  if (!r?.workspace_modules?.includes(scope.moduleId)) throw new RegisterError(403, "REGISTER_SCOPE_FORBIDDEN");
  await authorizedModules(db, scope, r.workspace_modules);
  await db.query("SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE", [r.id]);
  const shift = (await db.query("SELECT id FROM pos.shifts WHERE register_id=$1 AND status='OPEN' FOR UPDATE", [r.id])).rows[0];
  if (!shift) throw new RegisterError(409, "OPEN_REGISTER_SHIFT_REQUIRED");
  await setBinding(db, r.id, shift.id);
}
async function registers(db, scope) {
  const rows = (await db.query("SELECT id,name,module_id,workspace_modules,status FROM pos.cash_registers WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[] AND status='ACTIVE' ORDER BY name,id", [scope.tenantId, scope.merchantId, scope.outletId, scope.moduleId])).rows;
  const result = [];
  for (const row of rows) {
    try {
      await authorizedModules(db, scope, row.workspace_modules);
      result.push(row);
    } catch (e) {
      if (!(e instanceof ModuleAccessError)) throw e;
    }
  }
  await moduleContext(db, scope, scope.moduleId);
  return result;
}
async function openRegisterShift(db, scope, b) {
  requireRegisterCapability(scope, "shift.open");
  if (!ID.test(b.clientShiftId || "") || !Number.isFinite(b.initialCash) || b.initialCash < 0 || b.initialCash > 9999999999 || Math.abs(b.initialCash * 100 - Math.round(b.initialCash * 100)) > 1e-3) throw new RegisterError(400, "INVALID_SHIFT");
  await clearRegisterBinding(db);
  await db.query("SELECT id FROM internal.outlets WHERE id=$1 FOR UPDATE", [scope.outletId]);
  let choices = await registers(db, scope), register = choices.find((r) => r.id === b.registerId);
  if (b.registerId && !register) throw new RegisterError(403, "REGISTER_SCOPE_FORBIDDEN");
  if (!register) {
    if (choices.length > 1) throw new RegisterError(409, "EXPLICIT_REGISTER_REQUIRED");
    register = choices[0];
  }
  if (!register) {
    const mapped = (await db.query("SELECT id FROM pos.cash_registers WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[]", [scope.tenantId, scope.merchantId, scope.outletId, scope.moduleId])).rows.length;
    throw new RegisterError(mapped ? 403 : 409, mapped ? "REGISTER_SCOPE_FORBIDDEN" : "REGISTER_CONFIGURATION_REQUIRED");
  }
  await authorizedModules(db, scope, register.workspace_modules);
  await db.query("SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE", [register.id]);
  const active = (await db.query("SELECT * FROM pos.shifts WHERE register_id=$1 AND status='OPEN' FOR UPDATE", [register.id])).rows[0];
  if (active) {
    if (scope.role === "CASHIER" && active.opened_by_user_id !== scope.actorRef) throw new RegisterError(409, "REGISTER_IN_USE");
    if (active.client_shift_id !== b.clientShiftId && Number(b.initialCash) !== 0) throw new RegisterError(409, "REGISTER_ALREADY_OPEN");
    return { shift: await registerSnapshot(db, scope, active), replayed: true };
  }
  if ((await db.query("SELECT id FROM pos.shifts WHERE tenant_id=$1 AND client_shift_id=$2", [scope.tenantId, b.clientShiftId])).rows.length) throw new RegisterError(409, "SHIFT_ALREADY_CLOSED");
  const user = (await db.query("SELECT full_name FROM internal.users WHERE id::text=$1 AND is_active", [scope.actorRef])).rows[0];
  const row = (await db.query(`INSERT INTO pos.shifts(tenant_id,merchant_id,outlet_id,register_id,client_shift_id,actor_name,opened_by_user_id,opening_cash,business_date,workspace_modules) VALUES($1,$2,$3,$4,$5,$6,$7,$8,(now() AT TIME ZONE 'Asia/Jakarta')::date,$9) RETURNING *`, [scope.tenantId, scope.merchantId, scope.outletId, register.id, b.clientShiftId, user.full_name, scope.actorRef, round(b.initialCash), register.workspace_modules])).rows[0];
  await setBinding(db, register.id, row.id);
  await db.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,shift_ref,actor_ref,actor_name) VALUES($1,$2,$3,$4,'OPENING',$5,'Modal awal shift','MODAL_AWAL',$6,$7,$8)`, [scope.tenantId, scope.merchantId, scope.outletId, "opening:" + row.id, round(b.initialCash), b.clientShiftId, scope.actorRef, user.full_name]);
  await audit(db, scope, "SHIFT_OPENED", { shiftId: row.id, registerId: register.id, moduleIds: row.workspace_modules, initialCash: round(b.initialCash) });
  return { shift: await registerSnapshot(db, scope, row), replayed: false };
}
async function audit(db, s, eventType, detail) {
  await moduleContext(db, s, s.moduleId);
  await writeActivity(db, { tenantId: s.tenantId, merchantId: s.merchantId, businessSector: s.sector, appModule: "POS", eventType, severity: "INFO", summary: eventType, detail });
}
async function financialTotals(db, s, moduleId, shiftId, day) {
  await moduleContext(db, s, moduleId);
  const p = [s.tenantId, s.merchantId, s.outletId, moduleId, shiftId, day];
  const where = `t.tenant_id=$1 AND t.merchant_id=$2 AND t.outlet_id=$3 AND t.module_id=$4 AND ($5::uuid IS NULL OR t.register_shift_id=$5) AND ($6::date IS NULL OR t.created_at>=($6::date::timestamp AT TIME ZONE 'Asia/Jakarta') AND t.created_at<(($6::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta'))`;
  const revenue = (await db.query(`SELECT count(r.id)::int orders,COALESCE(sum(t.subtotal),0) gross_sales,COALESCE(sum(t.total_amount),0) gross_receivable,COALESCE(sum(r.total_amount),0) net_revenue,COALESCE(sum(r.refund_amount),0) refunds FROM pos.transactions t JOIN contract.merchant_revenue r ON r.id=t.id AND r.tenant_id=t.tenant_id WHERE ${where}`, p)).rows[0];
  const payments = (await db.query(`SELECT p.payment_method,count(*)::int count,sum(p.amount) amount,COALESCE(sum(p.amount) FILTER(WHERE p.verification_origin='PROVIDER_VERIFIED'),0) provider_verified,COALESCE(sum(p.amount) FILTER(WHERE p.verification_origin<>'PROVIDER_VERIFIED'),0) unverified FROM pos.payments p JOIN pos.transactions t ON t.id=p.transaction_id AND t.tenant_id=p.tenant_id WHERE ${where} AND p.payment_status IN('PAID','SETTLED') GROUP BY p.payment_method ORDER BY p.payment_method`, p)).rows;
  const pending = (await db.query(`SELECT count(*)::int count,COALESCE(sum(t.total_amount),0) amount FROM pos.transactions t WHERE ${where} AND NOT EXISTS(SELECT 1 FROM contract.merchant_revenue r WHERE r.id=t.id) AND t.order_status NOT IN('VOIDED','CANCELLED')`, p)).rows[0];
  return { moduleId, grossSales: round(revenue.gross_sales), grossReceivable: round(revenue.gross_receivable), netRevenue: round(revenue.net_revenue), refunds: round(revenue.refunds), orderCount: revenue.orders, payments: payments.map((p2) => ({ method: p2.payment_method, count: p2.count, receipts: round(p2.amount), providerVerified: round(p2.provider_verified), unverified: round(p2.unverified) })), pendingOrders: pending.count, pendingAmount: round(pending.amount) };
}
async function registerSnapshot(db, s, row) {
  if (row.status === "CLOSED") return row.summary;
  await authorizedModules(db, s, row.workspace_modules);
  const modules = [], cashRows = [];
  for (const moduleId of row.workspace_modules) {
    modules.push(await financialTotals(db, s, moduleId, row.id, null));
    cashRows.push((await db.query(`SELECT count(*)::int count,COALESCE(sum(c.amount),0) balance,
   COALESCE(sum(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='OPENING'),0) opening,
   COALESCE(sum(c.amount) FILTER(WHERE c.event_type='SALE'),0) sales,
   COALESCE(-sum(c.amount) FILTER(WHERE c.event_type='REFUND'),0) refunds,
   COALESCE(-sum(c.amount) FILTER(WHERE c.event_type='VOID'),0) voids,
   COALESCE(sum(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_IN'),0) cash_in,
   COALESCE(-sum(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT'),0) cash_out,
   md5(COALESCE(string_agg(c.id::text,',' ORDER BY c.id),'')) fingerprint
   FROM pos.cash_ledger c LEFT JOIN pos.cash_ledger original ON c.event_type='REVERSAL' AND original.id::text=c.reference_id AND original.tenant_id=c.tenant_id
   WHERE c.tenant_id=$1 AND c.merchant_id=$2 AND c.outlet_id=$3 AND c.module_id=$4 AND c.register_shift_id=$5`, [s.tenantId, s.merchantId, s.outletId, moduleId, row.id])).rows[0]);
  }
  await moduleContext(db, s, s.moduleId);
  const sum = (field) => {
    const cents = cashRows.reduce((n, r) => n + Math.round(Number(r[field] || 0) * 100), 0);
    if (!Number.isSafeInteger(cents)) throw new RegisterError(503, "DRAWER_AMOUNT_TOO_LARGE");
    return cents / 100;
  };
  const methods = modules.flatMap((m) => m.payments);
  const method = (allowed) => round(methods.filter((p) => allowed.includes(p.method)).reduce((n, p) => n + p.receipts, 0));
  const summary = {
    id: row.client_shift_id,
    serverShiftId: row.id,
    registerId: row.register_id,
    moduleIds: row.workspace_modules,
    openedBy: row.opened_by_user_id,
    cashierName: row.actor_name,
    startTime: iso(row.opened_at),
    businessDate: typeof row.business_date === "string" ? row.business_date.slice(0, 10) : iso(row.business_date).slice(0, 10),
    timezone: "Asia/Jakarta",
    status: row.status,
    initialCash: sum("opening"),
    cashSales: sum("sales"),
    cashRefunds: sum("refunds"),
    cashVoids: sum("voids"),
    qrisSales: method(["QRIS", "QRIS_STATIC", "QRIS_DYNAMIC"]),
    cardSales: method(["CARD", "DEBIT", "CREDIT", "DEBIT_CARD", "CREDIT_CARD"]),
    eWalletSales: method(["E_WALLET", "EWALLET", "GOPAY", "OVO", "DANA", "SHOPEEPAY"]),
    grossSales: round(modules.reduce((n, m) => n + m.grossSales, 0)),
    totalSales: round(modules.reduce((n, m) => n + m.netRevenue, 0)),
    totalOrders: modules.reduce((n, m) => n + m.orderCount, 0),
    totalCashIn: sum("cash_in"),
    totalCashOut: sum("cash_out"),
    expectedCash: sum("balance"),
    modules,
    ledgerEntries: cashRows.reduce((n, r) => n + r.count, 0),
    canClose: scopeCanClose(s, row)
  };
  return { ...summary, version: hash({ ...summary, canClose: void 0, cashFingerprints: cashRows.map((r) => r.fingerprint) }) };
}
function scopeCanClose(s, row) {
  return registerCapabilities(s.role).includes("shift.close") && (s.role !== "CASHIER" || row.opened_by_user_id === s.actorRef);
}
async function readRegisterShifts(db, s, registerId, historyCursor, historyLimit = 50) {
  requireRegisterCapability(s, "shift.read");
  requireRegisterCapability(s, "shift_history.read");
  const limit = Number(historyLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RegisterError(400, "INVALID_SHIFT_HISTORY_LIMIT");
  const choices = await registers(db, s);
  if (registerId !== void 0 && !choices.some((r) => r.id === registerId)) throw new RegisterError(403, "REGISTER_SCOPE_FORBIDDEN");
  let cursor = null;
  if (historyCursor !== void 0) {
    try {
      const decoded = JSON.parse(Buffer.from(String(historyCursor), "base64url").toString("utf8"));
      if (!Array.isArray(decoded) || decoded.length !== 2 || !UUID2.test(decoded[1]) || !Number.isFinite(Date.parse(decoded[0]))) throw Error();
      cursor = [decoded[0], decoded[1]];
    } catch {
      throw new RegisterError(400, "INVALID_SHIFT_HISTORY_CURSOR");
    }
  }
  const params = [s.tenantId, s.merchantId, s.outletId, s.moduleId, registerId || null];
  const activeRows = (await db.query("SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[] AND ($5::uuid IS NULL OR register_id=$5) AND status='OPEN' ORDER BY opened_at DESC,id DESC LIMIT 100", params)).rows;
  const closedRows = (await db.query("SELECT *,opened_at::text AS cursor_opened_at FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[] AND ($5::uuid IS NULL OR register_id=$5) AND status='CLOSED' AND ($6::timestamptz IS NULL OR (opened_at,id)<($6::timestamptz,$7::uuid)) ORDER BY opened_at DESC,id DESC LIMIT $8", [...params, cursor?.[0] || null, cursor?.[1] || null, limit + 1])).rows;
  const last = closedRows[Math.min(limit - 1, closedRows.length - 1)], nextHistoryCursor = closedRows.length > limit ? Buffer.from(JSON.stringify([last.cursor_opened_at, last.id])).toString("base64url") : null;
  const rows = [...activeRows, ...closedRows.slice(0, limit)];
  const allowed = [];
  for (const r of rows) {
    try {
      await authorizedModules(db, s, r.workspace_modules);
      allowed.push(r);
    } catch (e) {
      if (!(e instanceof ModuleAccessError)) throw e;
    }
  }
  const active = allowed.filter((r) => r.status === "OPEN");
  const selected = registerId ? active.find((r) => r.register_id === registerId) : active.find((r) => r.opened_by_user_id === s.actorRef) || active[0];
  const history = allowed.filter((r) => r.status === "CLOSED").slice(0, 100).map((r) => ({ ...r.summary, canClose: false }));
  const events = history.length ? (await db.query(`SELECT id,shift_id,action,submission_id,actor_ref,reason,created_at FROM pos.shift_variance_events WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND shift_id=ANY($4::uuid[]) ORDER BY created_at,id`, [s.tenantId, s.merchantId, s.outletId, history.map((r) => r.serverShiftId)])).rows : [];
  await moduleContext(db, s, s.moduleId);
  return { shift: selected ? await registerSnapshot(db, s, selected) : null, history, registers: choices, varianceEvents: events, historyTruncated: !!nextHistoryCursor, nextHistoryCursor, capabilities: registerCapabilities(s.role) };
}
async function closeRegisterShift(db, s, b) {
  requireRegisterCapability(s, "shift.close");
  if (!ID.test(b.clientShiftId || "") || !UUID2.test(b.clientCloseId || "") || typeof b.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(b.expectedVersion) || !Number.isFinite(b.actualCash) || b.actualCash < 0 || b.actualCash > 9999999999 || Math.abs(b.actualCash * 100 - Math.round(b.actualCash * 100)) > 1e-3 || typeof b.notes !== "string" || b.notes.length > 500) throw new RegisterError(400, "INVALID_SHIFT_CLOSE");
  const first = (await db.query("SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_shift_id=$4", [s.tenantId, s.merchantId, s.outletId, b.clientShiftId])).rows[0];
  if (!first?.workspace_modules) throw new RegisterError(409, "EXPLICIT_REGISTER_SHIFT_REQUIRED");
  await authorizedModules(db, s, first.workspace_modules);
  if (!scopeCanClose(s, first)) throw new RegisterError(403, "SHIFT_OPERATOR_REQUIRED");
  await db.query("SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE", [first.register_id]);
  const row = (await db.query("SELECT * FROM pos.shifts WHERE id=$1 FOR UPDATE", [first.id])).rows[0];
  const command = { clientCloseId: b.clientCloseId, actualCash: round(b.actualCash), notes: b.notes.trim(), expectedVersion: b.expectedVersion };
  if (row.status === "CLOSED") {
    const same = (await db.query("SELECT close_command=$2::jsonb AS same FROM pos.shifts WHERE id=$1", [row.id, JSON.stringify(command)])).rows[0].same;
    if (!same) throw new RegisterError(409, "SHIFT_CLOSE_CONFLICT");
    return { shift: { ...row.summary, canClose: false }, replayed: true };
  }
  const current = await registerSnapshot(db, s, row);
  if (current.version !== b.expectedVersion) throw new RegisterError(409, "DRAWER_CHANGED_RECOUNT_REQUIRED");
  const difference = round(b.actualCash - current.expectedCash);
  if (difference !== 0 && !command.notes) throw new RegisterError(400, "VARIANCE_EXPLANATION_REQUIRED");
  const summary = { ...current, canClose: false, status: "CLOSED", endTime: (/* @__PURE__ */ new Date()).toISOString(), actualCash: command.actualCash, difference, notes: command.notes, closedBy: s.actorRef };
  await db.query(`UPDATE pos.shifts SET status='CLOSED',closed_at=$2,closing_cash=$3,expected_cash=$4,cash_difference=$5,summary=$6::jsonb,notes=$7,closed_by_user_id=$8,close_command=$9::jsonb WHERE id=$1`, [row.id, summary.endTime, summary.actualCash, summary.expectedCash, difference, JSON.stringify(summary), command.notes, s.actorRef, JSON.stringify(command)]);
  if (difference !== 0) await db.query(`INSERT INTO pos.shift_variance_events(tenant_id,merchant_id,outlet_id,shift_id,client_command_id,action,actor_ref,reason) VALUES($1,$2,$3,$4,$5,'SUBMIT',$6,$7)`, [s.tenantId, s.merchantId, s.outletId, row.id, "close:" + b.clientCloseId, s.actorRef, command.notes]);
  await audit(db, s, "SHIFT_CLOSED", { shiftId: row.id, registerId: row.register_id, clientCloseId: b.clientCloseId, actualCash: summary.actualCash, expectedCash: summary.expectedCash, difference, notes: summary.notes, moduleIds: row.workspace_modules });
  return { shift: summary, replayed: false };
}
function registerCashierFinanceRoutes(app, db) {
  const run = (path, method, cap, fn) => app[method](path, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await db.tx(async (c) => {
        if (method === "get") await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        return fn(c, await resolve(c, req, cap), req);
      });
      res.json({ ok: true, ...result, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (e) {
      const known2 = e instanceof RegisterError || e instanceof ModuleAccessError || e instanceof BillingError;
      if (!known2) console.error("[register-operations]", { message: e.message, code: e.code });
      res.status(known2 ? e.status : 503).json({ ok: false, error: known2 ? e.message : "REGISTER_OPERATIONS_UNAVAILABLE" });
    }
  });
  run("/api/v1/finance/outlet", "get", "outlet_revenue.read", async (c, s, req) => {
    const requested = req.query.moduleIds === void 0 ? [s.moduleId] : String(req.query.moduleIds).split(",");
    const ids = await authorizedModules(c, s, requested);
    const day = String(req.query.businessDate || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new RegisterError(400, "INVALID_BUSINESS_DATE");
    const modules = [];
    for (const moduleId of ids) modules.push(await financialTotals(c, s, moduleId, null, day));
    await moduleContext(c, s, s.moduleId);
    return { businessId: s.merchantId, outletId: s.outletId, businessDate: day, timezone: "Asia/Jakarta", from: day + "T00:00:00+07:00", to: new Date(Date.parse(day + "T00:00:00+07:00") + 864e5).toISOString(), modules, netRevenue: round(modules.reduce((n, m) => n + m.netRevenue, 0)), orderCount: modules.reduce((n, m) => n + m.orderCount, 0), capabilities: registerCapabilities(s.role) };
  });
  run("/api/v1/finance/registers", "get", "shift.read", async (c, s) => ({ registers: await registers(c, s) }));
  run("/api/v1/finance/registers", "post", "register.configure", async (c, s, req) => {
    const b = req.body, ids = await authorizedModules(c, s, b.moduleIds);
    if (!ids.includes(s.moduleId) || typeof b.name !== "string" || !b.name.trim() || b.name.length > 100 || !UUID2.test(b.registerId || "")) throw new RegisterError(400, "INVALID_REGISTER");
    await c.query("SELECT id FROM internal.outlets WHERE id=$1 FOR UPDATE", [s.outletId]);
    const prev = (await c.query("SELECT * FROM pos.cash_registers WHERE id=$1 FOR UPDATE", [b.registerId])).rows[0];
    if (prev && (prev.tenant_id !== s.tenantId || prev.merchant_id !== s.merchantId || prev.outlet_id !== s.outletId || !prev.workspace_modules)) throw new RegisterError(403, "REGISTER_SCOPE_FORBIDDEN");
    if (prev) {
      await authorizedModules(c, s, prev.workspace_modules);
      if ((await c.query("SELECT id FROM pos.shifts WHERE register_id=$1 AND status='OPEN'", [prev.id])).rows.length) throw new RegisterError(409, "REGISTER_HAS_OPEN_SHIFT");
    }
    const row = (await c.query(`INSERT INTO pos.cash_registers(id,tenant_id,merchant_id,outlet_id,name,workspace_modules) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,workspace_modules=excluded.workspace_modules RETURNING id,name,workspace_modules`, [b.registerId, s.tenantId, s.merchantId, s.outletId, b.name.trim(), ids])).rows[0];
    await audit(c, s, "REGISTER_CONFIGURED", { registerId: row.id, moduleIds: ids, name: row.name });
    return { register: row };
  });
  run("/api/v1/finance/shift/variance", "post", "shift_variance.submit", async (c, s, req) => {
    const b = req.body;
    if (!UUID2.test(b.shiftId || "") || !UUID2.test(b.clientCommandId || "") || !["SUBMIT", "APPROVE", "REJECT"].includes(b.action) || typeof b.reason !== "string" || !b.reason.trim() || b.reason.length > 500) throw new RegisterError(400, "INVALID_VARIANCE_REVIEW");
    const row = (await c.query("SELECT * FROM pos.shifts WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE", [b.shiftId, s.tenantId, s.merchantId, s.outletId])).rows[0];
    if (!row?.workspace_modules || row.status !== "CLOSED" || Number(row.cash_difference) === 0) throw new RegisterError(409, "VARIANCE_NOT_AVAILABLE");
    await authorizedModules(c, s, row.workspace_modules);
    if (b.action === "SUBMIT") {
      if (s.role === "CASHIER" && row.opened_by_user_id !== s.actorRef) throw new RegisterError(403, "SHIFT_OPERATOR_REQUIRED");
    } else requireRegisterCapability(s, "shift_variance.approve");
    const events = (await c.query("SELECT * FROM pos.shift_variance_events WHERE shift_id=$1 ORDER BY created_at,id", [row.id])).rows;
    const prior = events.find((e) => e.client_command_id === b.clientCommandId);
    if (prior) {
      if (prior.action !== b.action || prior.actor_ref !== s.actorRef || prior.reason !== b.reason.trim() || String(prior.submission_id || "") !== String(b.submissionId || "")) throw new RegisterError(409, "VARIANCE_COMMAND_CONFLICT");
      return { event: prior, replayed: true };
    }
    const submission = events.filter((e) => e.action === "SUBMIT").at(-1);
    const decision = submission && events.find((e) => e.submission_id === submission.id);
    if (b.action === "SUBMIT" && submission && decision?.action !== "REJECT" || b.action !== "SUBMIT" && (!submission || decision || b.submissionId !== submission.id)) throw new RegisterError(409, "VARIANCE_REVIEW_CONFLICT");
    const event = (await c.query("INSERT INTO pos.shift_variance_events(tenant_id,merchant_id,outlet_id,shift_id,client_command_id,action,submission_id,actor_ref,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *", [s.tenantId, s.merchantId, s.outletId, row.id, b.clientCommandId, b.action, b.action === "SUBMIT" ? null : submission.id, s.actorRef, b.reason.trim()])).rows[0];
    await audit(c, s, "SHIFT_VARIANCE_" + b.action, { shiftId: row.id, eventId: event.id, submissionId: event.submission_id, reason: event.reason, difference: Number(row.cash_difference) });
    return { event, replayed: false };
  });
}

// services/pos/financialAuthorization.ts
import { createHash as createHash3, randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
init_authProviderOperations();
var scrypt = (pin, salt) => new Promise((resolve2, reject) => derive(pin, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve2(key)));
var ACTIONS = /* @__PURE__ */ new Set(["VOID", "REFUND", "CASH_OUT", "CASH_REVERSE"]);
var FinancialApprovalError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
var canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => k !== "approvalGrant" && v[k] !== void 0).sort().map((k) => [k, canonical(v[k])])) : v;
var commandHash = (command) => createHash3("sha256").update(JSON.stringify(canonical(command))).digest("hex");
var digest = (token) => createHash3("sha256").update(token).digest("hex");
function validFinancialPin(pin) {
  return typeof pin === "string" && /^\d{4,8}$/.test(pin) && !/^([0-9])\1+$/.test(pin) && !["1234", "4321", "123456", "654321", "12345678", "87654321"].includes(pin);
}
async function hashFinancialPin(pin) {
  if (!validFinancialPin(pin)) throw new FinancialApprovalError(400, "WEAK_FINANCIAL_PIN");
  const salt = randomBytes(16).toString("hex");
  const value = await scrypt(pin, salt);
  return "scrypt-v1$" + salt + "$" + value.toString("hex");
}
async function verifyFinancialPin(pin, encoded) {
  if (!validFinancialPin(pin)) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const result = await scrypt(pin, parts[1]);
  return timingSafeEqual(result, Buffer.from(parts[2], "hex"));
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
async function failure2(c, s) {
  await c.query("UPDATE pos.financial_pin_attempts SET failures=failures+1 WHERE tenant_id=$1 AND actor_ref=$2", [s.tenantId, s.actorRef]);
  return { status: 403, error: "INVALID_FINANCIAL_PIN" };
}
async function reauthenticateOwner(req, subject2) {
  const principal = trustedPrincipal(req), password = req.body?.ownerPassword;
  if (!principal?.email || password !== void 0 && (typeof password !== "string" || password.length > 1024)) return false;
  try {
    return await createAuthProviderOperations().reauthenticate(req, subject2, password, principal.email);
  } catch (error) {
    if (error instanceof AuthOperationError) throw new FinancialApprovalError(error.status, "OWNER_REAUTHENTICATION_UNAVAILABLE");
    throw error;
  }
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
    if (!await reauthenticateOwner(req, s.actorRef)) {
      await failure2(c, s);
      return { status: 403, error: "OWNER_REAUTHENTICATION_REQUIRED" };
    }
    const old = await credential(c, s);
    if (old && !await verifyFinancialPin(req.body?.currentPin, old.pin_hash)) return failure2(c, s);
    const pinHash = await hashFinancialPin(req.body?.newPin);
    await c.query(`INSERT INTO pos.financial_pin_credentials(tenant_id,approver_ref,pin_hash)
      VALUES($1,$2,$3) ON CONFLICT(tenant_id,approver_ref) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,updated_at=now()`, [s.tenantId, s.actorRef, pinHash]);
    await c.query("DELETE FROM pos.financial_approval_grants WHERE tenant_id=$1 AND approver_ref=$2", [s.tenantId, s.actorRef]);
    await c.query(`INSERT INTO pos.financial_authorization_audit(tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,grant_hash) VALUES($1,$2,$3,$4,$4,$5,$4,'Owner financial PIN setup/change',$6,$7)`, [s.tenantId, s.merchantId, s.outletId, s.actorRef, old ? "PIN_ROTATED" : "PIN_ENROLLED", commandHash({ operation: "pin-setup" }), digest(randomBytes(32).toString("hex"))]);
    return { enrolled: true };
  });
  route("/api/v1/finance/approve", async (c, s, req) => {
    const { action, reference, reason, command, pin } = req.body || {};
    if (!ACTIONS.has(action) || typeof reference !== "string" || !reference || reference.length > 128 || typeof reason !== "string" || !reason.trim() || reason.length > 500 || !command || typeof command !== "object" || JSON.stringify(command).length > 1e5)
      throw new FinancialApprovalError(400, "INVALID_APPROVAL_REQUEST");
    if (!await rateWindow(c, s)) return { status: 429, error: "FINANCIAL_PIN_RATE_LIMITED" };
    const row = await credential(c, s);
    if (!row) return { status: 409, error: "FINANCIAL_PIN_SETUP_REQUIRED" };
    if (!await verifyFinancialPin(pin, row.pin_hash)) return failure2(c, s);
    const token = randomBytes(32).toString("base64url");
    await c.query(
      `INSERT INTO pos.financial_approval_grants
      (token_hash,tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,expires_at${s.moduleId ? ",module_id" : ""})
      VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,now()+interval '90 seconds'${s.moduleId ? ",$10" : ""})`,
      [digest(token), s.tenantId, s.merchantId, s.outletId, s.actorRef, action, reference, reason.trim(), commandHash(command), ...s.moduleId ? [s.moduleId] : []]
    );
    return { approvalGrant: token, expiresInSeconds: 90, approverRef: s.actorRef };
  });
}
async function consumeFinancialApproval(c, s, action, reference, command, token) {
  if (s.moduleId && !["OWNER", "ADMIN", "MANAGER"].includes(s.role || "")) throw new FinancialApprovalError(403, "WORKSPACE_ROLE_FORBIDDEN");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new FinancialApprovalError(403, "FINANCIAL_APPROVAL_REQUIRED");
  const row = (await c.query(
    `SELECT * FROM pos.financial_approval_grants WHERE token_hash=$1
    AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 AND actor_ref=$5
    AND action=$6 AND reference=$7 AND command_hash=$8 FOR UPDATE`,
    [digest(token), s.tenantId, s.merchantId, s.outletId, s.actorRef, action, reference, commandHash(command)]
  )).rows[0];
  if (!row || s.moduleId && row.module_id !== s.moduleId || !row.consumed_at && Date.parse(row.expires_at) <= Date.now()) throw new FinancialApprovalError(403, "FINANCIAL_APPROVAL_INVALID_OR_EXPIRED");
  if (row.consumed_at) return;
  await c.query("UPDATE pos.financial_approval_grants SET consumed_at=now() WHERE token_hash=$1", [row.token_hash]);
  await c.query(`INSERT INTO pos.financial_authorization_audit
    (tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,grant_hash${s.moduleId ? ",module_id" : ""})
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10${s.moduleId ? ",$11" : ""})`, [s.tenantId, s.merchantId, s.outletId, s.actorRef, row.approver_ref, action, reference, row.reason, row.command_hash, row.token_hash, ...s.moduleId ? [s.moduleId] : []]);
}

// services/pos/finance.ts
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ID2 = /^[^\x00-\x1f\x7f]{1,128}$/;
var money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
var FinanceError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
};
function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new FinanceError(400, "INVALID_EVENT_DATE");
  return new Date(value).toISOString();
}
async function scopeFor(db, req) {
  const input = req.method === "GET" ? req.query : req.body;
  const principal = trustedPrincipal(req), sector = input?.sector, outletId = input?.outletId;
  if (!principal || principal.subject === "local-development") throw new FinanceError(401, "UNAUTHENTICATED");
  if (input?.moduleId !== void 0) {
    const scope = await resolveWorkspaceScope(db, principal.subject, input, [req.path.endsWith("/reconciliation") ? "reports" : "pos"]);
    if (req.method !== "GET" && !req.path.endsWith("/shift/open") && !(req.path.endsWith("/shift/close") && await hasSchemaFeature(db, "cashierRegisters"))) requireWorkspaceRole(scope, ["OWNER", "ADMIN", "MANAGER"]);
    return { ...scope, sector: scope.sector };
  }
  if (!SECTORS.includes(sector) || !UUID3.test(String(outletId))) throw new FinanceError(400, "INVALID_FINANCIAL_SCOPE");
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
  await authorizeNativeModule(db, principal.subject, row.merchant_id, outletId, [req.method === "GET" ? req.path.endsWith("/reconciliation") ? ["reports"] : ["pos", "reports"] : ["pos"]]);
  return { tenantId, merchantId: row.merchant_id, outletId, sector, actorRef: principal.subject };
}
async function applyRefund(db, scope, transactionId, command) {
  if (scope.moduleId && !["OWNER", "ADMIN", "MANAGER"].includes(scope.role || "")) throw new FinanceError(403, "WORKSPACE_ROLE_FORBIDDEN");
  if (!command || !ID2.test(command.clientRefundId || "") || !["CASH", "ORIGINAL_METHOD"].includes(command.refundMethod) || typeof command.reason !== "string" || !command.reason.trim() || command.reason.length > 500 || !Array.isArray(command.items) || !command.items.length || command.items.length > 200)
    throw new FinanceError(400, "INVALID_REFUND");
  const occurredAt = timestamp(command.occurredAt || (/* @__PURE__ */ new Date()).toISOString());
  const { approvalGrant: unusedGrant, ...refundInput } = command;
  const normalized = { ...refundInput, occurredAt, reason: command.reason.trim(), items: [...command.items].sort((a, b) => a.clientItemId.localeCompare(b.clientItemId)) };
  const txn = (await db.query(
    `SELECT * FROM pos.transactions WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE`,
    [transactionId, scope.tenantId, scope.merchantId, scope.outletId]
  )).rows[0];
  if (!txn || scope.moduleId && txn.module_id !== scope.moduleId) throw new FinanceError(404, "TRANSACTION_NOT_FOUND");
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
    if (!ID2.test(item.clientItemId || "") || seen.has(item.clientItemId) || !Number.isFinite(item.quantity) || item.quantity <= 0 || Math.abs(item.quantity * 1e3 - Math.round(item.quantity * 1e3)) > 1e-3)
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
async function applyCashEvent(c, s, b) {
  if (s.moduleId && !["OWNER", "ADMIN", "MANAGER"].includes(s.role || "")) throw new FinanceError(403, "WORKSPACE_ROLE_FORBIDDEN");
  if (!ID2.test(b.clientEventId || "") || !["CASH_IN", "CASH_OUT", "OPENING"].includes(b.type) || typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount < 0 || b.amount > 9999999999 || typeof b.description !== "string" || b.description.length > 500 || typeof b.category !== "string" || b.category.length > 64)
    throw new FinanceError(400, "INVALID_CASH_EVENT");
  if (s.moduleId && b.registerId && await hasSchemaFeature(c, "cashierRegisters")) await bindRegisterCash(c, s, b.registerId);
  if (b.category === "KOREKSI_KAS" && !b.description.trim()) throw new FinanceError(400, "CORRECTION_REASON_REQUIRED");
  if (b.type === "CASH_OUT") await consumeFinancialApproval(c, s, "CASH_OUT", b.clientEventId, b, b.approvalGrant);
  const amount = money(b.amount) * (b.type === "CASH_OUT" ? -1 : 1), occurredAt = timestamp(b.occurredAt);
  const command = { clientEventId: b.clientEventId, type: b.type, amount, occurredAt, category: b.category, description: b.description.trim(), shiftId: String(b.shiftId || ""), ...b.registerId ? { registerId: b.registerId } : {}, recipientOrSource: String(b.recipientOrSource || "").slice(0, 200) };
  const prev = (await c.query(`SELECT id,command=$2::jsonb AS same,outlet_id,to_jsonb(cash_ledger)->>'module_id' AS module_id FROM pos.cash_ledger WHERE tenant_id=$1 AND client_event_id=$3`, [s.tenantId, JSON.stringify(command), b.clientEventId])).rows[0];
  if (prev) {
    if (!prev.same || prev.outlet_id !== s.outletId || s.moduleId && prev.module_id !== s.moduleId) throw new FinanceError(409, "CASH_EVENT_ID_CONFLICT");
    return { id: prev.id, replayed: true };
  }
  const row = (await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,actor_ref,actor_name,shift_ref,recipient_or_source,occurred_at,command)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING id`, [s.tenantId, s.merchantId, s.outletId, b.clientEventId, b.type, amount, command.description, b.category, s.actorRef, String(b.actorName || "").slice(0, 100), command.shiftId, command.recipientOrSource, occurredAt, JSON.stringify(command)])).rows[0];
  await writeActivity(c, { tenantId: s.tenantId, merchantId: s.merchantId, businessSector: s.sector, appModule: "POS", eventType: b.type, severity: "INFO", amountIdr: amount, summary: command.description || "Mutasi kas", detail: { clientEventId: b.clientEventId } });
  return { id: row.id, replayed: false };
}
function registerFinanceRoutes(app, db) {
  registerFinancialApprovalRoutes(app, db, scopeFor);
  registerCashierFinanceRoutes(app, db);
  const route = (path, run) => app.post(path, async (req, res) => {
    try {
      const result = await db.tx(async (c) => run(c, await scopeFor(c, req), req));
      res.json({ ok: true, ...result, clientEventId: req.body.clientEventId });
    } catch (error) {
      const known2 = error instanceof RegisterError || error instanceof RegisterError || error instanceof ModuleAccessError || error instanceof FinanceError || error instanceof BillingError || error instanceof FinancialApprovalError;
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
        FROM pos.payments WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND ($4::text IS NULL OR to_jsonb(payments)->>'module_id'=$4) AND payment_status IN('PAID','SETTLED') GROUP BY verification_origin`, [s.tenantId, s.merchantId, s.outletId, s.moduleId || null])).rows;
        const exceptions = (await c.query(`SELECT e.provider_event_ref,e.reason,e.received_at FROM pos.payment_reconciliation_events e
        LEFT JOIN pos.payments p ON p.id=e.payment_id WHERE e.tenant_id=$1 AND e.merchant_id=$2 AND e.outcome='EXCEPTION'
        AND (e.payment_id IS NULL OR p.outlet_id=$3) AND ($4::text IS NULL OR p.outlet_id=$3 AND to_jsonb(p)->>'module_id'=$4) ORDER BY e.received_at DESC LIMIT 50`, [s.tenantId, s.merchantId, s.outletId, s.moduleId || null])).rows;
        return { totals, exceptions };
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(e instanceof ModuleAccessError || e instanceof FinanceError || e instanceof BillingError ? e.status : 503).json({ ok: false, error: e instanceof ModuleAccessError || e instanceof FinanceError || e instanceof BillingError ? e.message : "RECONCILIATION_UNAVAILABLE" });
    }
  });
  app.get("/api/v1/finance/shift", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await db.tx(async (c) => {
        const s = await scopeFor(c, req);
        if (s.moduleId && await hasSchemaFeature(c, "cashierRegisters")) return readRegisterShifts(c, s, req.query.registerId, req.query.historyCursor, req.query.historyLimit);
        const rows = (await c.query(`SELECT * FROM pos.shifts WHERE (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(shifts)->>'module_id'=current_setting('app.module_id',true)) AND tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 ORDER BY opened_at DESC LIMIT 100`, [s.tenantId, s.merchantId, s.outletId])).rows;
        const current = rows.find((r) => r.status === "OPEN");
        return { shift: current ? await calculateShift(c, s, current) : null, history: rows.filter((r) => r.status === "CLOSED").map((r) => r.summary).filter(Boolean) };
      });
      res.json({ ok: true, ...result, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (error) {
      if (!(error instanceof RegisterError) && !(error instanceof FinanceError) && !(error instanceof BillingError) && !(error instanceof ModuleAccessError)) {
        const diagnostic = error;
        console.error("[finance] shift read failed", { code: diagnostic.code, constraint: diagnostic.constraint, table: diagnostic.table, column: diagnostic.column });
      }
      res.status(error instanceof RegisterError || error instanceof ModuleAccessError || error instanceof FinanceError || error instanceof BillingError ? error.status : 503).json({ ok: false, error: error instanceof RegisterError || error instanceof ModuleAccessError || error instanceof FinanceError || error instanceof BillingError ? error.message : "SHIFT_UNAVAILABLE" });
    }
  });
  route("/api/v1/finance/shift/open", async (c, s, req) => {
    if (s.moduleId && await hasSchemaFeature(c, "cashierRegisters")) return openRegisterShift(c, s, req.body);
    const b = req.body;
    if (!ID2.test(b.clientShiftId || "") || !Number.isFinite(b.initialCash) || b.initialCash < 0 || b.initialCash > 9999999999) throw new FinanceError(400, "INVALID_SHIFT");
    await c.query("SELECT id FROM internal.outlets WHERE id=$1 FOR UPDATE", [s.outletId]);
    const active = (await c.query(`SELECT * FROM pos.shifts WHERE (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(shifts)->>'module_id'=current_setting('app.module_id',true)) AND tenant_id=$1 AND outlet_id=$2 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1`, [s.tenantId, s.outletId])).rows[0];
    if (active) return { shift: await calculateShift(c, s, active), replayed: true };
    const previous = (await c.query(`SELECT id FROM pos.shifts WHERE (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(shifts)->>'module_id'=current_setting('app.module_id',true)) AND tenant_id=$1 AND client_shift_id=$2`, [s.tenantId, b.clientShiftId])).rows[0];
    if (previous) throw new FinanceError(409, "SHIFT_ALREADY_CLOSED");
    let register = (await c.query("SELECT id FROM pos.cash_registers WHERE (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(cash_registers)->>'module_id'=current_setting('app.module_id',true)) AND tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND status='ACTIVE' ORDER BY created_at LIMIT 1", [s.tenantId, s.merchantId, s.outletId])).rows[0];
    if (!register) register = (await c.query("INSERT INTO pos.cash_registers(tenant_id,merchant_id,outlet_id,name) VALUES($1,$2,$3,'Kas bersama outlet') RETURNING id", [s.tenantId, s.merchantId, s.outletId])).rows[0];
    const row = (await c.query(`INSERT INTO pos.shifts(tenant_id,merchant_id,outlet_id,client_shift_id,actor_name,opening_cash,business_date,status,register_id)
      VALUES($1,$2,$3,$4,$5,$6,(now() AT TIME ZONE 'Asia/Jakarta')::date,'OPEN',$7) RETURNING *`, [s.tenantId, s.merchantId, s.outletId, b.clientShiftId, String(b.cashierName || "Kasir").slice(0, 100), money(b.initialCash), register.id])).rows[0];
    await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,shift_ref,actor_ref,actor_name)
      VALUES($1,$2,$3,$4,'OPENING',$5,'Modal awal shift','MODAL_AWAL',$6,$7,$8)`, [s.tenantId, s.merchantId, s.outletId, "opening:" + row.id, money(b.initialCash), b.clientShiftId, s.actorRef, row.actor_name]);
    return { shift: await calculateShift(c, s, row), replayed: false };
  });
  route("/api/v1/finance/shift/close", async (c, s, req) => {
    if (s.moduleId && await hasSchemaFeature(c, "cashierRegisters")) return closeRegisterShift(c, s, req.body);
    const b = req.body;
    if (!ID2.test(b.clientShiftId || "") || !Number.isFinite(b.actualCash) || b.actualCash < 0 || b.actualCash > 9999999999) throw new FinanceError(400, "INVALID_SHIFT");
    const row = (await c.query(`SELECT * FROM pos.shifts WHERE (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(shifts)->>'module_id'=current_setting('app.module_id',true)) AND tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_shift_id=$4 FOR UPDATE`, [s.tenantId, s.merchantId, s.outletId, b.clientShiftId])).rows[0];
    if (!row) throw new FinanceError(409, "SHIFT_NOT_FOUND");
    if (row.status === "CLOSED") {
      if (Number(row.closing_cash) !== money(b.actualCash)) throw new FinanceError(409, "SHIFT_CLOSE_CONFLICT");
      return { shift: row.summary, replayed: true };
    }
    const summary = { ...await calculateShift(c, s, row), status: "CLOSED", endTime: (/* @__PURE__ */ new Date()).toISOString(), actualCash: money(b.actualCash), notes: String(b.notes || "").slice(0, 500) };
    summary.difference = money(summary.actualCash - summary.expectedCash);
    await c.query(`UPDATE pos.shifts SET status='CLOSED',closed_at=$2,closing_cash=$3,expected_cash=$4,cash_difference=$5,summary=$6::jsonb,notes=$7 WHERE id=$1`, [row.id, summary.endTime, summary.actualCash, summary.expectedCash, summary.difference, JSON.stringify(summary), summary.notes]);
    await writeActivity(c, { tenantId: s.tenantId, merchantId: s.merchantId, businessSector: s.sector, appModule: "POS", eventType: "SHIFT_CLOSED", severity: "INFO", summary: "Shift ditutup", detail: { clientShiftId: b.clientShiftId, expectedCash: summary.expectedCash, difference: summary.difference } });
    return { shift: summary, replayed: false };
  });
  route("/api/v1/finance/refund", async (c, s, req) => {
    const id = String(req.body?.clientTxnId || "");
    const txn = (await c.query("SELECT id FROM pos.transactions WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_txn_id=$4", [s.tenantId, s.merchantId, s.outletId, id])).rows[0];
    if (!txn) throw new FinanceError(409, "TRANSACTION_SYNC_REQUIRED");
    return { refund: await applyRefund(c, s, txn.id, req.body.refund) };
  });
  route("/api/v1/finance/cash", async (c, s, req) => {
    return applyCashEvent(c, s, req.body);
  });
  route("/api/v1/finance/cash/reverse", async (c, s, req) => {
    const b = req.body;
    if (!ID2.test(b.clientEventId || "") || !ID2.test(b.originalEventId || "") || typeof b.reason !== "string" || !b.reason.trim() || b.reason.length > 500) throw new FinanceError(400, "INVALID_CASH_REVERSAL");
    await consumeFinancialApproval(c, s, "CASH_REVERSE", b.originalEventId, b, b.approvalGrant);
    const original = (await c.query(`SELECT * FROM pos.cash_ledger WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_event_id=$4 FOR UPDATE`, [s.tenantId, s.merchantId, s.outletId, b.originalEventId])).rows[0];
    if (!original || s.moduleId && original.module_id !== s.moduleId || !["CASH_IN", "CASH_OUT", "OPENING"].includes(original.event_type)) throw new FinanceError(409, "CASH_EVENT_NOT_REVERSIBLE");
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
    SELECT * FROM contract.merchant_revenue WHERE (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(merchant_revenue)->>'module_id'=current_setting('app.module_id',true)) AND tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3
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
    WHERE (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(c)->>'module_id'=current_setting('app.module_id',true)) AND c.tenant_id=$1 AND c.merchant_id=$2 AND c.outlet_id=$3 AND c.occurred_at >=$4 AND ($5::timestamptz IS NULL OR c.occurred_at<$5)`, params)).rows[0];
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

// src/lib/pos/workspacePurchase.ts
function sharedPurchaseCashCommand(commandId, moduleId, outletId, sector, amount, occurredAt, description) {
  return { sector, outletId, clientEventId: `purchase:${commandId}:${moduleId}`, type: "CASH_OUT", amount, occurredAt, description, category: "BELANJA_BAHAN", recipientOrSource: "Shared purchase " + commandId };
}

// services/pos/inventoryLocation.ts
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

// services/pos/workspaceIdentity.ts
import { createHash as createHash4 } from "node:crypto";
var workspaceProductRef = (moduleId, recordId) => "workspace:" + createHash4("sha256").update(moduleId + "\0" + recordId).digest("hex");

// services/pos/workspaceInventory.ts
async function workspaceProduct(c, s, recordId, lock = false) {
  const row = (await c.query(`SELECT * FROM pos.products WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$3 AND external_ref=$4 AND NOT sync_quarantined ${lock ? "FOR UPDATE" : ""}`, [s.tenantId, s.merchantId, s.moduleId, workspaceProductRef(s.moduleId, recordId)])).rows[0];
  if (!row) throw new ModuleAccessError(404, "WORKSPACE_PRODUCT_NOT_FOUND");
  return row;
}
async function attachWorkspaceInventory(c, s, productId, stockable) {
  if (!stockable) return;
  const p = (await c.query("SELECT * FROM pos.products WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND module_id=$4 FOR UPDATE", [productId, s.tenantId, s.merchantId, s.moduleId])).rows[0];
  if (!p) throw new ModuleAccessError(404, "WORKSPACE_PRODUCT_NOT_FOUND");
  if (!p.inventory_item_id) {
    const i = (await c.query(`INSERT INTO pos.inventory_items(tenant_id,merchant_id,module_id,item_name,sku,base_unit,item_type,cost_per_unit,is_stockable) VALUES($1,$2,$3,$4,$5,$6,'RETAIL_FINISHED',$7,true) RETURNING id`, [s.tenantId, s.merchantId, s.moduleId, p.name, s.moduleId + ":" + p.sku, p.unit || "pcs", p.cost_price])).rows[0];
    await c.query("UPDATE pos.products SET inventory_item_id=$2,offering_type='PHYSICAL' WHERE id=$1", [p.id, i.id]);
  }
}
async function lockWorkspaceStock(c, s, p) {
  if (!p.inventory_item_id) return null;
  const location = await ensureInventoryLocation(c, s.tenantId, s.merchantId, s.outletId);
  await c.query(`INSERT INTO pos.inventory_balances(tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,current_stock) VALUES($1,$2,$3,$4,$5,0) ON CONFLICT(outlet_id,location_id,inventory_item_id) DO NOTHING`, [s.tenantId, s.merchantId, s.outletId, location, p.inventory_item_id]);
  const row = (await c.query(`SELECT current_stock FROM pos.inventory_balances WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND location_id=$5 AND inventory_item_id=$6 FOR UPDATE`, [s.tenantId, s.merchantId, s.outletId, s.moduleId, location, p.inventory_item_id])).rows[0];
  if (!row) throw new ModuleAccessError(409, "STOCK_WORKSPACE_MISMATCH");
  return { location, quantity: Number(row.current_stock) };
}
async function movement(c, s, item, location, qty, type, ref) {
  await c.query(`INSERT INTO pos.inventory_transactions(tenant_id,merchant_id,outlet_id,module_id,location_id,inventory_item_id,quantity_delta,reference_type,reference_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Explicit workspace inventory command')`, [s.tenantId, s.merchantId, s.outletId, s.moduleId, location, item, qty, type, ref]);
}
function registerWorkspaceInventoryRoutes(app, db) {
  app.post("/api/v1/sync/modules/inventory", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const b = req.body;
    if (!b || !["RECEIVE", "TRANSFER", "ADJUST"].includes(b.action) || typeof b.commandId !== "string" || !/^[^\x00-\x1f\x7f]{1,128}$/.test(b.commandId) || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 100 || b.lines.some((l) => !l || typeof l.productRef !== "string" || !l.productRef || !Number.isFinite(l.quantity) || (b.action === "ADJUST" ? l.quantity < 0 : l.quantity <= 0) || l.quantity > 999999 || Math.abs(l.quantity * 1e3 - Math.round(l.quantity * 1e3)) > 1e-3)) return res.status(400).json({ ok: false, error: "INVALID_STOCK_COMMAND" });
    try {
      const result = await db.tx(async (c) => {
        const initial = await resolveWorkspaceScope(c, principal.subject, b, ["inventory"]);
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [initial.tenantId + ":" + b.commandId]);
        for (const moduleId of new Set(b.lines.map((l) => l.moduleId || b.moduleId))) await resolveWorkspaceScope(c, principal.subject, { ...b, moduleId }, ["inventory"]);
        if (b.action === "TRANSFER") await resolveWorkspaceScope(c, principal.subject, { ...b, outletId: b.destinationOutletId }, ["inventory"]);
        await resolveWorkspaceScope(c, principal.subject, b, ["inventory"]);
        const hash2 = commandHash(b), prior = (await c.query("SELECT * FROM pos.workspace_commands WHERE tenant_id=$1 AND command_id=$2", [initial.tenantId, b.commandId])).rows[0];
        if (prior) {
          if (prior.actor_ref !== principal.subject || prior.request_hash !== hash2 || prior.merchant_id !== initial.merchantId) throw new ModuleAccessError(409, "STOCK_COMMAND_ID_CONFLICT");
          return { ...prior.result, replayed: true };
        }
        if (b.action === "TRANSFER" && (b.lines.some((l) => l.moduleId && l.moduleId !== b.moduleId) || b.destinationOutletId === b.outletId)) throw new ModuleAccessError(400, "INVALID_TRANSFER_SCOPE");
        const scopes = /* @__PURE__ */ new Map();
        const sorted = [...b.lines].sort((a, z) => String(a.moduleId || b.moduleId).localeCompare(String(z.moduleId || b.moduleId)) || a.productRef.localeCompare(z.productRef));
        for (const line of sorted) {
          const scope = await resolveWorkspaceScope(c, principal.subject, { ...b, moduleId: line.moduleId || b.moduleId }, ["inventory"]);
          scopes.set(scope.moduleId, scope);
          const p = await workspaceProduct(c, scope, line.productRef, true);
          if (!p.inventory_item_id) throw new ModuleAccessError(409, "PRODUCT_NOT_STOCKABLE");
          const stock = await lockWorkspaceStock(c, scope, p);
          if (!stock) throw new ModuleAccessError(409, "PRODUCT_NOT_STOCKABLE");
          if (b.action === "ADJUST") {
            if (!Number.isFinite(line.expectedQuantity) || stock.quantity !== line.expectedQuantity) throw new ModuleAccessError(409, "STOCK_CHANGED_REVIEW_REQUIRED");
            await movement(c, scope, p.inventory_item_id, stock.location, line.quantity - stock.quantity, "ADJUSTMENT", b.commandId);
          } else if (b.action === "TRANSFER") {
            if (stock.quantity < line.quantity) throw new ModuleAccessError(409, "INSUFFICIENT_STOCK");
            const destination = await resolveWorkspaceScope(c, principal.subject, { ...b, outletId: b.destinationOutletId }, ["inventory"]);
            const destLocation = await ensureInventoryLocation(c, destination.tenantId, destination.merchantId, destination.outletId);
            await resolveWorkspaceScope(c, principal.subject, b, ["inventory"]);
            await movement(c, scope, p.inventory_item_id, stock.location, -line.quantity, "TRANSFER_OUT", b.commandId);
            await resolveWorkspaceScope(c, principal.subject, { ...b, outletId: b.destinationOutletId }, ["inventory"]);
            await movement(c, destination, p.inventory_item_id, destLocation, line.quantity, "TRANSFER_IN", b.commandId);
          } else await movement(c, scope, p.inventory_item_id, stock.location, line.quantity, "PURCHASE", b.commandId);
        }
        const expenses = [];
        if (b.purchase) {
          const p = b.purchase, allocations = p.allocations;
          if (b.action !== "RECEIVE" || b.commandId.length > 80 || !Number.isFinite(p.totalAmount) || p.totalAmount <= 0 || !Array.isArray(allocations) || allocations.length !== scopes.size || new Set(allocations.map((a) => a.moduleId)).size !== scopes.size || allocations.some((a) => !scopes.has(a.moduleId) || !Number.isFinite(a.amount) || a.amount <= 0 || Math.abs(a.amount * 100 - Math.round(a.amount * 100)) > 1e-3) || Math.round(allocations.reduce((n, a) => n + a.amount, 0) * 100) !== Math.round(p.totalAmount * 100) || typeof p.occurredAt !== "string" || !Number.isFinite(Date.parse(p.occurredAt)) || typeof p.description !== "string" || !p.description.trim() || p.description.length > 500) throw new ModuleAccessError(400, "EXACT_PURCHASE_ALLOCATION_REQUIRED");
          for (const allocation of allocations) {
            const s = await resolveWorkspaceScope(c, principal.subject, { ...b, moduleId: allocation.moduleId }, ["inventory", "pos"]);
            const command = sharedPurchaseCashCommand(b.commandId, s.moduleId, s.outletId, s.sector, allocation.amount, p.occurredAt, p.description);
            const expense = await applyCashEvent(c, { ...s, sector: s.sector }, { ...command, approvalGrant: allocation.approvalGrant });
            expenses.push({ moduleId: s.moduleId, amount: allocation.amount, cashEventId: expense.id });
          }
        }
        await resolveWorkspaceScope(c, principal.subject, b, ["inventory"]);
        const result2 = { commandId: b.commandId, action: b.action, lineCount: b.lines.length, moduleIds: [...scopes.keys()], expenses, financialRecorded: expenses.length > 0, replayed: false };
        await c.query("INSERT INTO pos.workspace_commands(tenant_id,merchant_id,command_id,actor_ref,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)", [initial.tenantId, initial.merchantId, b.commandId, principal.subject, hash2, result2]);
        return result2;
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (e) {
      const known2 = e instanceof ModuleAccessError || e instanceof BillingError || e instanceof FinanceError || e instanceof FinancialApprovalError;
      return res.status(known2 ? e.status : 503).json({ ok: false, error: known2 ? e.message : "WORKSPACE_INVENTORY_UNAVAILABLE" });
    }
  });
}

// services/pos/businessScope.ts
var BusinessScopeError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function resolveBusinessScope(db, subject2, sector, businessId) {
  if (businessId !== void 0 && (typeof businessId !== "string" || !businessId || businessId.length > 128))
    throw new BusinessScopeError(400, "INVALID_BUSINESS_ID");
  const tenantId = await tenantForPrincipal(db, { subject: subject2 });
  if (!tenantId) {
    if (businessId !== void 0) throw new BusinessScopeError(403, "BUSINESS_ACCESS_DENIED");
    return null;
  }
  const result = await db.query(`SELECT m.id AS merchant_id,m.name AS business_name,m.external_ref
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE t.id=$1 AND t.owner_user_ref=$2 AND t.is_active AND t.merged_into IS NULL
      AND m.business_sector=$3 AND m.is_active
      AND ($4::text IS NULL OR m.id::text=$4 OR m.external_ref=$4)
    ORDER BY m.id`, [tenantId, subject2, sector, businessId ?? null]);
  const rows = result.rows;
  if (businessId !== void 0 && rows.length !== 1) throw new BusinessScopeError(403, "BUSINESS_ACCESS_DENIED");
  const aliases = rows.filter((row) => row.external_ref === `${subject2}_${sector}`);
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
    legacyAlias: selected.external_ref === `${subject2}_${sector}` ? selected.external_ref : null
  };
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
var sectors = /* @__PURE__ */ new Set(["FNB", "LAUNDRY", "RETAIL", "CARWASH", "BARBERSHOP"]);
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
    if (typeof row[field] === "string" && sectors.has(row[field]) && row[field] !== sector) return `WRONG_SECTOR:${row[field]}`;
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
var text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
var timestamp2 = (value, optional = false) => {
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
  if (value.id !== op.recordId || !text(value.staffId, 96) || !text(value.staffName, 120)) throw new BillingError(422, "INVALID_LABOR_RECORD");
  if (attendance) {
    if (!["CLOCKED_IN", "CLOCKED_OUT"].includes(String(value.status))) throw new BillingError(422, "INVALID_ATTENDANCE_STATUS");
    const started = timestamp2(value.clockInTime), ended = timestamp2(value.clockOutTime, true);
    if (value.status === "CLOCKED_OUT" && !ended || ended && Date.parse(ended) < Date.parse(started)) throw new BillingError(422, "INVALID_ATTENDANCE_DATE");
    if (typeof value.branchId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.branchId)) throw new BillingError(422, "ATTENDANCE_OUTLET_REQUIRED");
    const outlet = (await c.query("SELECT id FROM internal.outlets WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3", [value.branchId, scope.tenantId, scope.merchantId])).rows[0];
    if (!outlet) throw new BillingError(403, "ATTENDANCE_OUTLET_NOT_OWNED");
    if (existing && (existing.staff_id !== value.staffId || existing.outlet_id !== outlet.id || new Date(existing.clock_in_at).toISOString() !== started)) throw new BillingError(409, "ATTENDANCE_IDENTITY_IMMUTABLE");
    if (existing?.clock_out_at && (!ended || new Date(existing.clock_out_at).toISOString() !== ended)) throw new BillingError(409, "CLOSED_ATTENDANCE_IMMUTABLE");
    if (existing && existing.status === value.status && (existing.clock_out_at ? new Date(existing.clock_out_at).toISOString() : null) === ended && existing.shift_notes === (text(value.shiftNotes, 500) || null) && JSON.stringify(existing.clock_out_geo) === JSON.stringify(value.clockOutGeo || null)) return;
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
        text(value.staffName, 120),
        text(value.staffRole, 64) || "STAFF",
        started,
        ended,
        text(value.shiftNotes, 500) || null,
        value.status,
        text(value.branchName, 100),
        JSON.stringify(value.clockInGeo || null),
        JSON.stringify(value.clockOutGeo || null),
        sector
      ]
    );
    if (!saved2.rows.length) throw new BillingError(409, "LABOR_PROJECTION_OWNER_CONFLICT");
    return;
  }
  if (!["DRAFT", "PAID"].includes(String(value.status)) || typeof value.periodMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.periodMonth) || !Number.isSafeInteger(value.daysAttended) || Number(value.daysAttended) < 0) throw new BillingError(422, "INVALID_PAYROLL_RECORD");
  const start = timestamp2(value.periodStart), end = timestamp2(value.periodEnd), paid = timestamp2(value.paidAt, true);
  if (end < start || value.status === "PAID" && !paid) throw new BillingError(422, "INVALID_PAYROLL_DATE");
  const fields = ["baseSalary", "allowance", "individualCommission", "teamPoolCommission", "dailyTargetBonus", "grossEarnings", "deductions", "netSalary"];
  const amounts = fields.map((field) => money2(value[field]));
  const columns = ["base_salary", "allowance", "individual_commission", "team_pool_commission", "daily_target_bonus", "gross_earnings", "deductions", "net_salary"];
  if (existing?.status === "PAID") {
    if (value.status !== "PAID" || existing.staff_id !== value.staffId || existing.period_month !== value.periodMonth || new Date(existing.period_start).toISOString().slice(0, 10) !== start.slice(0, 10) || new Date(existing.period_end).toISOString().slice(0, 10) !== end.slice(0, 10) || new Date(existing.paid_at).toISOString() !== paid || existing.payment_method !== (text(value.paymentMethod, 64) || null) || Number(existing.days_attended) !== Number(value.daysAttended) || columns.some((column, index) => Number(existing[column]) !== amounts[index]))
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
      text(value.staffName, 120),
      text(value.staffRole, 64) || "STAFF",
      value.periodMonth,
      start.slice(0, 10),
      end.slice(0, 10),
      value.daysAttended,
      ...amounts,
      value.status,
      paid,
      text(value.paymentMethod, 64) || null,
      text(value.notes, 500) || null,
      sector
    ]
  );
  if (!saved.rows.length) throw new BillingError(409, "LABOR_PROJECTION_OWNER_CONFLICT");
}

// services/pos/sharedState.ts
var SECTOR_SET = new Set(SECTORS);
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
function validOperations(value, workspace = false) {
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
      const allowed = /* @__PURE__ */ new Set([...ORDER_OPERATION_FIELDS, ...workspace ? ["tenantId", "businessId", "businessSector", "moduleId", "outletId", "branchId"] : []]);
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
        await authorizeNativeModule(c, principal.subject, scope.merchantId, req.query.outletId, moduleStateRequirements(kinds));
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
      if (error instanceof BusinessScopeError || error instanceof BillingError) return res.status(error.status).json({ ok: false, error: error.message });
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
        await authorizeNativeModule(c, principal.subject, scope.merchantId, requestedOutletId || void 0, moduleStateRequirements(operations.map((op) => op.kind), true));
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
      if (error instanceof BusinessScopeError || error instanceof BillingError) return res.status(error.status).json({ ok: false, error: error.message });
      if (error instanceof StateConflict) return res.status(409).json({ ok: false, error: "STATE_CONFLICT", kind: error.kind, recordId: error.recordId });
      if (error instanceof FreePlanAccessError) return res.status(403).json({ ok: false, error: error.message });
      if (error instanceof BillingError) return res.status(error.status).json({ ok: false, error: error.message });
      return res.status(503).json({ ok: false, error: "STATE_UNAVAILABLE" });
    }
  });
}

// services/pos/workspaceState.ts
var exclusive = { kds_tickets: "fnb", carwash_queue: "carwash", bookings: "barber" };
function assertWorkspaceKinds(scope, kinds, write = false) {
  const requirements = moduleStateRequirements(kinds, write);
  if (requirements.some((choices) => !choices.some((p) => scope.permissions.includes(p) && scope.features.includes(p)))) throw new ModuleAccessError(403, "WORKSPACE_PERMISSION_DENIED");
  if (kinds.some((kind) => exclusive[kind] && exclusive[kind] !== scope.moduleId)) throw new ModuleAccessError(403, "OPERATIONAL_MODULE_MISMATCH");
  if (write && kinds.some((kind) => ["stock_items", "bundles", "inventory_logs"].includes(kind))) throw new ModuleAccessError(403, "CANONICAL_WORKSPACE_COMMAND_REQUIRED");
  if (write && kinds.some((kind) => kind === "users" || kind === "staff_members")) throw new ModuleAccessError(403, "IDENTITY_RECORDS_ARE_SERVER_OWNED");
}
function errorResponse(res, e) {
  if (!(e instanceof ModuleAccessError)) {
    const d = e;
    console.error("[workspace-state]", { message: d.message, code: d.code, constraint: d.constraint });
  }
  return res.status(e instanceof ModuleAccessError ? e.status : 503).json({ ok: false, error: e instanceof ModuleAccessError ? e.message : "WORKSPACE_STATE_UNAVAILABLE" });
}
function registerWorkspaceStateRoutes(app, db) {
  app.get("/api/v1/sync/modules/state", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const result = await db.tx(async (c) => {
        await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const scope = await resolveWorkspaceScope(c, principal.subject, req.query);
        const kinds = typeof req.query.kinds === "string" ? [...new Set(req.query.kinds.split(","))] : [];
        if (!kinds.length || kinds.length > 25) throw new ModuleAccessError(400, "EXPLICIT_STATE_KINDS_REQUIRED");
        assertWorkspaceKinds(scope, kinds);
        const cursor = typeof req.query.cursor === "string" ? req.query.cursor : "";
        if (cursor.length > 300) throw new ModuleAccessError(400, "INVALID_STATE_CURSOR");
        const window = Object.entries(HISTORY_WINDOWS).filter(([, w]) => w.days).map(([kind, w]) => `(kind<>'${kind}' OR updated_at>now()-interval '${w.days} days')`).join(" AND ");
        const rows = (await c.query(`SELECT * FROM(
    SELECT scope,kind,record_id,value,revision,deleted FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND scope=$5 AND kind=ANY($6::text[]) AND kind NOT IN('products','inventory_logs') AND ${window} AND(kind<>'inventory_logs' OR record_id IN(SELECT record_id FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND kind='inventory_logs' ORDER BY updated_at DESC LIMIT 2000))
    UNION ALL
    SELECT $5::text,'products'::text,p.workspace_payload->>'id',p.workspace_payload||jsonb_build_object('tenantId',$1::text,'businessId',$8::text,'moduleId',$4::text,'outletId',$3::text,'branchId',$3::text,'businessSector',$9::text,'name',p.name,'price',p.price,'costPrice',p.cost_price,'sku',p.sku,'isAvailable',p.is_available,'catalogRevision',p.workspace_revision,'stock',COALESCE((SELECT sum(current_stock) FROM pos.inventory_balances WHERE inventory_item_id=p.inventory_item_id AND outlet_id=$3),0),'inventoryTracked',p.inventory_item_id IS NOT NULL),p.workspace_revision,false
    FROM pos.products p WHERE p.tenant_id=$1 AND p.merchant_id=$2 AND p.module_id=$4 AND p.workspace_payload IS NOT NULL AND 'products'=ANY($6::text[])
    UNION ALL
    SELECT $5::text,'inventory_logs'::text,l.id::text,jsonb_build_object('id',l.id,'productId',COALESCE(p.workspace_payload->>'id',l.inventory_item_id::text),'productName',COALESCE(p.name,'Inventory'),'type',CASE WHEN l.quantity_delta<0 THEN 'OUT' ELSE 'IN' END,'quantity',abs(l.quantity_delta),'previousStock',l.running-l.quantity_delta,'newStock',l.running,'reason',COALESCE(l.reason,l.reference_type),'timestamp',l.created_at,'user',l.actor_ref,'businessSector',$9::text,'moduleId',$4::text,'outletId',$3::text,'branchId',$3::text,'businessId',$8::text),1::bigint,false
    FROM(SELECT * FROM(SELECT t.*,sum(quantity_delta) OVER(PARTITION BY inventory_item_id,location_id ORDER BY created_at,id) AS running FROM pos.inventory_transactions t WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4) history ORDER BY created_at DESC,id DESC LIMIT 2000) l LEFT JOIN pos.products p ON p.inventory_item_id=l.inventory_item_id AND p.tenant_id=$1 AND p.merchant_id=$2 AND p.module_id=$4 WHERE 'inventory_logs'=ANY($6::text[])
   ) snapshot WHERE kind||chr(1)||record_id>$7 ORDER BY kind,record_id LIMIT 1001`, [scope.tenantId, scope.merchantId, scope.outletId, scope.moduleId, scope.namespace, kinds, cursor, scope.transportRef, scope.sector])).rows;
        const version = (await c.query(`SELECT md5(COALESCE((SELECT string_agg(kind||record_id||revision::text||deleted::text,'|' ORDER BY kind,record_id) FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND kind=ANY($5::text[])),'')||COALESCE((SELECT string_agg(id::text||workspace_revision::text,'|' ORDER BY id) FROM pos.products WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$4),'')||COALESCE((SELECT string_agg(id::text||current_stock::text,'|' ORDER BY id) FROM pos.inventory_balances WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4),'')) AS version`, [scope.tenantId, scope.merchantId, scope.outletId, scope.moduleId, kinds])).rows[0].version;
        if (scope.role === "CASHIER") {
          for (const row of rows) if (row.kind === "products") {
            row.value = { ...row.value, costPrice: 0 };
            delete row.value.recipeIngredients;
          }
        }
        const more = rows.length > 1e3;
        if (more) rows.pop();
        if (!cursor && kinds.includes("users")) {
          const user = (await c.query("SELECT id,full_name FROM internal.users WHERE id::text=$1 AND is_active", [principal.subject])).rows[0];
          if (user) rows.push({ scope: scope.namespace, kind: "users", record_id: user.id, value: { id: user.id, name: user.full_name, role: ["OWNER", "ADMIN"].includes(scope.role) ? "ADMIN" : scope.role, pin: "", status: "ACTIVE" }, revision: 1, deleted: false });
        }
        if (!cursor && kinds.includes("staff_members")) {
          const roster = (await c.query(`SELECT DISTINCT u.id,u.full_name,ms.role FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id WHERE ms.tenant_id=$1 AND ms.is_active AND u.is_active AND (ms.scope_type='TENANT' OR ms.merchant_id=$2 AND(ms.scope_type='MERCHANT' OR ms.outlet_id=$3)) ORDER BY u.full_name,u.id`, [scope.tenantId, scope.merchantId, scope.outletId])).rows;
          for (const user of roster) rows.push({ scope: scope.namespace, kind: "staff_members", record_id: user.id, value: { id: user.id, name: user.full_name, role: user.role, businessId: scope.transportRef, status: "ACTIVE" }, revision: 1, deleted: false });
        }
        return { ok: true, ready: true, scopeProof: true, kinds, business: { businessId: scope.merchantId, tenantId: scope.tenantId, sector: scope.sector }, workspace: { outletId: scope.outletId, moduleId: scope.moduleId }, records: rows.map((r) => ({ scope: r.scope, kind: r.kind, recordId: r.record_id, value: r.value, revision: Number(r.revision), deleted: r.deleted })), version, nextCursor: more ? rows[Math.min(999, rows.length - 1)].kind + "" + rows[Math.min(999, rows.length - 1)].record_id : null };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json(result);
    } catch (e) {
      return errorResponse(res, e);
    }
  });
  app.post("/api/v1/sync/modules/state", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const operations = validOperations(req.body?.operations, true);
    if (!operations) return res.status(400).json({ ok: false, error: "INVALID_STATE_REQUEST" });
    try {
      const result = await db.tx(async (c) => {
        const scope = await resolveWorkspaceScope(c, principal.subject, req.body);
        assertWorkspaceKinds(scope, operations.map((op) => op.kind), true);
        if (operations.some((op) => op.kind === "products") && !["TENANT", "MERCHANT"].includes(scope.membershipScope)) throw new ModuleAccessError(403, "MODULE_CATALOG_MANAGER_REQUIRED");
        const versions = [], conflicts = [];
        for (const op of operations) {
          if (op.kind === "products" && op.baseRevision > 0 && !(await c.query("SELECT id FROM pos.products WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$3 AND external_ref=$4 FOR UPDATE", [scope.tenantId, scope.merchantId, scope.moduleId, workspaceProductRef(scope.moduleId, op.recordId)])).rows.length) {
            conflicts.push({ kind: op.kind, recordId: op.recordId, error: "STATE_CONFLICT" });
            continue;
          }
          const rawValue = op.value;
          if (op.kind === "products" && !op.deleted && (rawValue?.linkedStockItemId || Array.isArray(rawValue?.recipeIngredients) && rawValue.recipeIngredients.length)) throw new ModuleAccessError(409, "WORKSPACE_RECIPE_NOT_VALIDATED");
          const value = op.deleted ? null : { ...rawValue, tenantId: scope.tenantId, moduleId: scope.moduleId, outletId: scope.outletId, branchId: scope.outletId, businessId: scope.transportRef, businessSector: scope.sector };
          if (!op.deleted && ["moduleId", "outletId", "branchId", "businessId", "tenantId"].some((field) => rawValue?.[field] !== void 0 && rawValue[field] !== value[field])) throw new ModuleAccessError(403, "WORKSPACE_PAYLOAD_MISMATCH");
          const saved = await c.query(`INSERT INTO pos.shared_state_records(tenant_id,merchant_id,outlet_id,module_id,scope,kind,record_id,value,revision,deleted) SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::jsonb,1,$9::boolean WHERE $10::bigint=0 OR $6='products' OR EXISTS(SELECT 1 FROM pos.shared_state_records WHERE tenant_id=$1 AND scope=$5 AND kind=$6 AND record_id=$7 AND revision=$10) ON CONFLICT(tenant_id,scope,kind,record_id) DO UPDATE SET value=excluded.value,deleted=excluded.deleted,revision=CASE WHEN(pos.shared_state_records.value,pos.shared_state_records.deleted) IS DISTINCT FROM(excluded.value,excluded.deleted) THEN pos.shared_state_records.revision+1 ELSE pos.shared_state_records.revision END,updated_at=CASE WHEN(pos.shared_state_records.value,pos.shared_state_records.deleted) IS DISTINCT FROM(excluded.value,excluded.deleted) THEN now() ELSE pos.shared_state_records.updated_at END WHERE pos.shared_state_records.revision=$10 OR excluded.kind='products' RETURNING revision`, [scope.tenantId, scope.merchantId, scope.outletId, scope.moduleId, scope.namespace, op.kind, op.recordId, value, op.deleted, op.baseRevision]);
          let revision = saved.rows[0]?.revision;
          if (!revision) {
            revision = (await c.query(`SELECT revision FROM pos.shared_state_records WHERE tenant_id=$1 AND scope=$2 AND kind=$3 AND record_id=$4 AND value IS NOT DISTINCT FROM $5::jsonb AND deleted=$6`, [scope.tenantId, scope.namespace, op.kind, op.recordId, value, op.deleted])).rows[0]?.revision;
          }
          if (!revision) {
            conflicts.push({ kind: op.kind, recordId: op.recordId, error: "STATE_CONFLICT" });
            continue;
          }
          if (op.kind === "products") {
            if (op.deleted) await c.query("UPDATE pos.products SET is_available=false WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$3 AND external_ref=$4", [scope.tenantId, scope.merchantId, scope.moduleId, workspaceProductRef(scope.moduleId, op.recordId)]);
            else {
              const p = rawValue;
              const catalogPayload = Object.fromEntries(Object.entries(p).filter(([key]) => !["stock", "catalogRevision", "tenantId", "businessId", "businessSector", "sector", "moduleId", "outletId", "branchId"].includes(key)));
              const projection = await c.query(`INSERT INTO pos.products(id,tenant_id,merchant_id,outlet_id,module_id,external_ref,name,sku,price,cost_price,is_available,business_sector,business_id,unit,workspace_payload) VALUES(uuidv7(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$15::jsonb) ON CONFLICT(tenant_id,merchant_id,external_ref) WHERE external_ref IS NOT NULL AND NOT sync_quarantined DO UPDATE SET name=excluded.name,sku=excluded.sku,price=excluded.price,cost_price=excluded.cost_price,is_available=excluded.is_available,workspace_payload=excluded.workspace_payload,workspace_revision=CASE WHEN pos.products.workspace_payload IS DISTINCT FROM excluded.workspace_payload THEN pos.products.workspace_revision+1 ELSE pos.products.workspace_revision END WHERE pos.products.module_id=excluded.module_id AND(pos.products.workspace_revision=$14::bigint OR pos.products.workspace_payload IS NOT DISTINCT FROM excluded.workspace_payload) RETURNING id,workspace_revision`, [scope.tenantId, scope.merchantId, scope.outletId, scope.moduleId, workspaceProductRef(scope.moduleId, op.recordId), p.name, String(p.sku || op.recordId).slice(0, 50), p.price, p.costPrice, p.isAvailable !== false, scope.sector, scope.transportRef, String(p.unit || "pcs").slice(0, 20), Number.isSafeInteger(p.catalogRevision) ? p.catalogRevision : null, JSON.stringify(catalogPayload)]);
              if (!projection.rows.length) throw new ModuleAccessError(409, "CATALOG_REVISION_CONFLICT");
              revision = projection.rows[0].workspace_revision;
              await attachWorkspaceInventory(c, scope, projection.rows[0].id, p.inventoryTracked === true || scope.moduleId === "retail");
            }
          }
          versions.push({ kind: op.kind, recordId: op.recordId, revision: Number(revision) });
        }
        return { ok: true, versions, conflicts, rejected: [] };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json(result);
    } catch (e) {
      return errorResponse(res, e);
    }
  });
}

// services/pos/workspaceDirectory.ts
async function workspaceDirectory(db, subject2, requestedTenant) {
  if (!moduleWorkspacesEnabled() || !await hasSchemaFeature(db, "workspaceIsolation")) throw new ModuleAccessError(403, "ISOLATED_WORKSPACE_REQUIRED");
  const tenants = (await db.query(`SELECT DISTINCT t.id,t.name FROM internal.tenants t WHERE t.is_active AND t.merged_into IS NULL AND (t.owner_user_ref=$1 OR EXISTS(SELECT 1 FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id WHERE ms.tenant_id=t.id AND u.id::text=$1 AND u.is_active AND ms.is_active)) ORDER BY t.id`, [subject2])).rows;
  const tenantId = typeof requestedTenant === "string" ? tenants.find((t) => t.id === requestedTenant)?.id : tenants.length === 1 ? tenants[0].id : null;
  if (requestedTenant && !tenantId) throw new ModuleAccessError(403, "TENANT_MEMBERSHIP_REQUIRED");
  if (!tenantId) return { ok: true, tenantId: null, tenants: tenants.map((t) => ({ tenantId: t.id, name: t.name })), businesses: [], workspaceAuth: true };
  const result = await db.query(`SELECT m.id,m.tenant_id,m.name,m.business_sector,m.is_active,m.external_ref,o.id outlet_id,o.name outlet_name,o.address,o.is_active outlet_active,CASE WHEN t.owner_user_ref=$2 THEN 'OWNER' ELSE ms.role END role FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id JOIN internal.outlets o ON o.merchant_id=m.id AND o.tenant_id=t.id LEFT JOIN LATERAL(SELECT role FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id WHERE ms.tenant_id=t.id AND ms.is_active AND u.is_active AND u.id::text=$2 AND(ms.scope_type='TENANT' OR ms.merchant_id=m.id AND(ms.scope_type='MERCHANT' OR ms.outlet_id=o.id)) ORDER BY CASE ms.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 WHEN 'CASHIER' THEN 3 ELSE 4 END LIMIT 1) ms ON true WHERE t.id=$1 AND(t.owner_user_ref=$2 OR ms.role IS NOT NULL) ORDER BY m.id,o.id`, [tenantId, subject2]);
  const businesses = /* @__PURE__ */ new Map();
  for (const r of result.rows) {
    let b = businesses.get(r.id);
    if (!b) {
      b = { businessId: r.id, tenantId, name: r.name, sector: r.business_sector, status: r.is_active ? "ACTIVE" : "INACTIVE", legacyAlias: r.external_ref === subject2 + "_" + r.business_sector ? r.external_ref : null, transportRef: r.external_ref || r.id, outlets: [] };
      businesses.set(r.id, b);
    }
    b.outlets.push({ outletId: r.outlet_id, businessId: r.id, name: r.outlet_name, address: r.address || "", status: r.outlet_active ? "ACTIVE" : "INACTIVE", role: r.role });
  }
  await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  const subscription = (await db.query("SELECT * FROM contract.workspace_subscription_metadata WHERE tenant_id=$1", [tenantId])).rows[0];
  return { ok: true, tenantId, tenants: tenants.map((t) => ({ tenantId: t.id, name: t.name })), businesses: [...businesses.values()], workspaceAuth: true, capabilities: { multiBusiness: true }, subscription: subscription ? serializeSubscription(subscription) : null };
}

// services/pos/businessDirectory.ts
function registerBusinessDirectory(app, db) {
  app.get("/api/v1/sync/business", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      res.setHeader("Cache-Control", "no-store");
      if (req.query.workspace === "2") return res.json(await db.tx((c) => workspaceDirectory(c, principal.subject, req.query.tenantId)));
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
    } catch (e) {
      return res.status(e instanceof ModuleAccessError ? e.status : 503).json({ ok: false, error: e instanceof ModuleAccessError ? e.message : "BUSINESS_DIRECTORY_UNAVAILABLE" });
    }
  });
}

// services/pos/sync.ts
import { randomBytes as randomBytes2 } from "node:crypto";

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
var UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    if (!UUID4.test(clientRequestId || "") || !TYPES.has(type) || typeof message !== "string" || !message.trim() || message.length > 1e3) throw new PrivacyError(400, "INVALID_PRIVACY_REQUEST");
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

// services/pos/reports.ts
var UUID5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DATE = /^\d{4}-\d{2}-\d{2}$/;
var PAYMENT_METHODS = /* @__PURE__ */ new Set(["CASH", "QRIS", "QRIS_DYNAMIC", "QRIS_STATIC", "DEBIT", "CREDIT", "DEBIT_CARD", "CREDIT_CARD", "CARD", "TRANSFER", "E_WALLET", "EWALLET", "OTHER", "SHOPEEPAY", "GOPAY", "OVO", "DANA", "SPLIT"]);
var numeric = (value) => Number(value ?? 0);
var money3 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
var iso2 = (value) => new Date(String(value)).toISOString();
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
  const date = stringQuery(value, name);
  if (!date) return null;
  if (!DATE.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || (/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).toISOString().slice(0, 10) !== date) {
    throw new ReportRequestError(400, `INVALID_${name}`);
  }
  return date;
}
function parseReportFilter(query) {
  const outletId = stringQuery(query.outletId, "OUTLET_ID");
  if (!outletId || !UUID5.test(outletId)) throw new ReportRequestError(400, "INVALID_OUTLET_ID");
  const moduleId = stringQuery(query.moduleId, "MODULE_ID");
  const merchantId = stringQuery(query.merchantId ?? query.businessId, "MERCHANT_ID");
  const tenantId = stringQuery(query.tenantId, "TENANT_ID");
  if (merchantId && !UUID5.test(merchantId) || tenantId && !UUID5.test(tenantId)) throw new ReportRequestError(400, "INVALID_SCOPE");
  const sector = stringQuery(query.sector, "SECTOR");
  if (sector && !SECTORS.includes(sector)) throw new ReportRequestError(400, "INVALID_SECTOR");
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
    moduleId,
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
async function scopeFor2(db, subject2, filter) {
  if (filter.moduleId) {
    const s = await resolveWorkspaceScope(db, subject2, { businessId: filter.merchantId, outletId: filter.outletId, moduleId: filter.moduleId }, [filter.operational ? "pos" : "reports"]);
    if (filter.tenantId && filter.tenantId !== s.tenantId) throw new ReportRequestError(403, "REPORT_SCOPE_FORBIDDEN");
    return { tenantId: s.tenantId, merchantId: s.merchantId, outletId: s.outletId, moduleId: s.moduleId, role: s.role, sector: s.sector, from: filter.from, to: filter.to, timezone: filter.timezone };
  }
  const { rows } = await db.query(
    `SELECT o.tenant_id,o.merchant_id,o.id AS outlet_id,m.business_sector
    FROM internal.outlets o
    JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    JOIN internal.tenants t ON t.id=o.tenant_id
    WHERE o.id=$1 AND t.owner_user_ref=$2
      AND ($3::uuid IS NULL OR m.id=$3) AND ($4::uuid IS NULL OR t.id=$4)
      AND ($5::text IS NULL OR m.business_sector=$5)`,
    [filter.outletId, subject2, filter.merchantId, filter.tenantId, filter.sector]
  );
  if (!rows.length) throw new ReportRequestError(403, "REPORT_SCOPE_FORBIDDEN");
  const row = rows[0];
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [row.tenant_id, row.merchant_id]);
  try {
    await authorizeNativeModule(db, subject2, row.merchant_id, row.outlet_id, [["reports"]]);
  } catch (error) {
    if (error instanceof BillingError) throw new ReportRequestError(error.status, error.message);
    throw error;
  }
  const timezone = filter.timezoneExplicit ? filter.timezone : (await db.query("SELECT timezone FROM internal.merchant_settings WHERE merchant_id=$1", [row.merchant_id])).rows[0]?.timezone || "Asia/Jakarta";
  return {
    tenantId: row.tenant_id,
    merchantId: row.merchant_id,
    outletId: row.outlet_id,
    sector: row.business_sector,
    from: filter.from,
    to: filter.to,
    timezone
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
  AND (NULLIF(current_setting('app.module_id',true),'') IS NULL OR to_jsonb(${alias})->>'module_id'=current_setting('app.module_id',true))
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
function shiftDate(date, days) {
  const d = /* @__PURE__ */ new Date(`${date}T12:00:00Z`);
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
    timestamp: iso2(row.occurred_at),
    cashierName: row.actor_name || row.actor_ref || "Kasir",
    shiftId: row.shift_ref || void 0,
    recipientOrSource: row.recipient_or_source || void 0
  };
}
async function serverReportSummary(db, subject2, filter) {
  return db.tx(async (c) => {
    await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await scopeFor2(c, subject2, filter);
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
    if (!UUID5.test(cursor.id) || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return { createdAt: new Date(cursor.createdAt).toISOString(), id: cursor.id };
  } catch {
    throw new ReportRequestError(400, "INVALID_CURSOR");
  }
}
async function serverTransactions(db, subject2, filter, cursor, limit = 100) {
  return db.tx(async (c) => {
    await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await scopeFor2(c, subject2, filter);
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
    const page = rows.slice(0, limit);
    const items = page.length ? (await c.query(`SELECT i.*,COALESCE(i.quantity_exact,i.quantity) AS quantity,COALESCE(to_jsonb(p)->'workspace_payload'->>'id',p.external_ref) AS product_ref,
      COALESCE(ri.quantity,0) AS refunded_quantity FROM pos.transaction_items i
      LEFT JOIN pos.products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id
      LEFT JOIN LATERAL (SELECT sum(ri.quantity) AS quantity FROM pos.transaction_refund_items ri
        JOIN pos.transaction_refunds rf ON rf.id=ri.refund_id
        WHERE ri.transaction_item_id=i.id AND rf.tenant_id=$1) ri ON TRUE
      WHERE i.tenant_id=$1 AND i.transaction_id=ANY($2::uuid[]) ORDER BY i.id`, [scope.tenantId, page.map((r) => r.id)])).rows : [];
    const tenders = page.length ? (await c.query(`SELECT * FROM pos.payments WHERE tenant_id=$1 AND transaction_id=ANY($2::uuid[])
      AND client_payment_id IS NOT NULL AND payment_status IN('PAID','SETTLED') ORDER BY created_at,id`, [scope.tenantId, page.map((r) => r.id)])).rows : [];
    const transactions = page.map((row) => ({
      id: row.client_txn_id || row.invoice_number || row.id,
      serverId: row.id,
      clientTxnId: row.client_txn_id || null,
      invoiceNumber: row.invoice_number,
      orderNumber: 0,
      branchId: row.outlet_id,
      date: iso2(row.created_at),
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
      ...tenders.some((t) => t.transaction_id === row.id) ? { paymentTenders: tenders.filter((t) => t.transaction_id === row.id).map((t) => ({ clientPaymentId: t.client_payment_id, method: t.payment_method, amount: numeric(t.amount), createdAt: iso2(t.created_at) })) } : {},
      status: ["VOIDED", "CANCELLED"].includes(row.order_status) ? "VOID" : ["OPEN", "PENDING_PAYMENT", "IN_FULFILLMENT"].includes(row.order_status) ? "HOLD" : "COMPLETED",
      serverOrderStatus: row.order_status,
      refundTotal: numeric(row.refund_total),
      recognizedRevenue: row.recognized_revenue === null ? null : numeric(row.recognized_revenue),
      ...!scope.moduleId || scope.role !== "CASHIER" ? { recognizedCOGS: row.recognized_cogs === null ? null : numeric(row.recognized_cogs) } : {},
      syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
      items: items.filter((i) => i.transaction_id === row.id).map((i) => ({
        id: i.client_item_id || i.id,
        selectedModifiers: [],
        productId: i.product_ref || i.product_id,
        name: i.product_name,
        unitPrice: numeric(i.unit_price),
        ...!scope.moduleId || scope.role !== "CASHIER" ? { unitCost: numeric(i.unit_cost) } : {},
        quantity: numeric(i.quantity),
        discountPercent: 0,
        discountAmount: 0,
        totalPrice: numeric(i.total_price),
        refundedQuantity: numeric(i.refunded_quantity)
      }))
    }));
    const last = page[page.length - 1];
    return {
      ok: true,
      source: "server",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope,
      transactions,
      nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: iso2(last.created_at), id: last.id })).toString("base64url") : null
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
      if (route === "transactions" && req.query.purpose === "pos") filter.operational = true;
      if (route === "summary") return res.json(await serverReportSummary(db, principal.subject, filter));
      const rawLimit = stringQuery(req.query.limit, "LIMIT");
      const limit = rawLimit === null ? 100 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ReportRequestError(400, "INVALID_LIMIT");
      return res.json(await serverTransactions(db, principal.subject, filter, cursorFor(req.query.cursor), limit));
    } catch (error) {
      if (!(error instanceof ModuleAccessError || error instanceof ReportRequestError)) {
        const diagnostic = error;
        console.error("[reports] read failed", { route, code: diagnostic.code, constraint: diagnostic.constraint, table: diagnostic.table, column: diagnostic.column });
      }
      return res.status(error instanceof ModuleAccessError || error instanceof ReportRequestError ? error.status : 503).json({
        ok: false,
        error: error instanceof ModuleAccessError || error instanceof ReportRequestError ? error.message : "REPORT_UNAVAILABLE"
      });
    }
  });
}

// services/pos/sync.ts
var SECTOR_SET2 = new Set(SECTORS);
var MAX_BATCH = 500;
var SyncAccessError = class extends Error {
};
var ProductLimitError = class extends Error {
};
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
  if (error instanceof RegisterError || error instanceof ModuleAccessError || error instanceof FinanceError || error instanceof FinancialApprovalError) return error.message;
  const code = String(error?.code || "");
  if (/^(22|23)/.test(code)) return "REJECTED_BY_DATABASE:" + (error.constraint || code);
  return null;
}
var workspaceSaleHash = (x) => {
  const { tenders, refunds, paymentStatus, approvalGrant, voidReason, voidedAt, ...immutable } = x;
  return commandHash(immutable);
};
var INVOICE_CONSTRAINTS = /* @__PURE__ */ new Set(["uq_transactions_invoice_number", "uq_txn_invoice_per_tenant"]);
function registerSyncRoutes(app, db) {
  registerModuleRoutes(app, db);
  registerWorkspaceStateRoutes(app, db);
  registerWorkspaceInventoryRoutes(app, db);
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
      return res.status(error instanceof BillingError || error instanceof ModuleAccessError || error instanceof BusinessScopeError ? error.status : 500).json({ ok: false, error: error instanceof BillingError || error instanceof ModuleAccessError || error instanceof BusinessScopeError ? error.message : "BUSINESS_SETUP_FAILED" });
    }
  });
  app.get("/api/v1/sync/receipt-logo", async (req, res) => {
    const principal = trustedPrincipal(req);
    const businessId = str(req.query.businessId, 96);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    if (!businessId) return res.status(400).json({ ok: false, error: "BUSINESS_ID_REQUIRED" });
    if (req.query.moduleId !== void 0) {
      try {
        const logo = await db.tx(async (c) => {
          const scope = await resolveWorkspaceScope(c, principal.subject, req.query);
          return (await c.query("SELECT logo_url FROM internal.merchants WHERE id=$1", [scope.merchantId])).rows[0]?.logo_url || null;
        });
        res.setHeader("Cache-Control", "no-store");
        return res.json({ ok: true, logoUrl: logo });
      } catch (e) {
        return res.status(e instanceof ModuleAccessError ? e.status : 503).json({ ok: false, error: e instanceof ModuleAccessError ? e.message : "LOGO_UNAVAILABLE" });
      }
    }
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
        detail: "businessId dan sector wajib; sector harus salah satu dari " + SECTORS.join(", ")
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
        const workspace = body.moduleId !== void 0 ? await resolveWorkspaceScope(c, ownerRef, body, ["pos"]) : null;
        if (workspace && workspace.sector !== sector) throw new ModuleAccessError(400, "WORKSPACE_SECTOR_MISMATCH");
        const receiptKey = workspace && idemKey ? "workspace:" + commandHash([workspace.tenantId, workspace.merchantId, workspace.outletId, workspace.moduleId, ownerRef, idemKey]) : idemKey;
        const requestHash = workspace ? commandHash(body) : null;
        if (workspace && receiptKey) await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [receiptKey]);
        const claimedBusiness = workspace ? { id: workspace.merchantId, tenant_id: workspace.tenantId } : await assertBusinessCanBeClaimed(c, businessId, ownerRef, sector);
        if (!workspace && claimedBusiness) await authorizeNativeModule(c, ownerRef, claimedBusiness.id, requestedOutletId, [["pos"]]);
        const storesOutcomes = await hasSchemaFeature(c, "syncReceiptOutcomes");
        if (receiptKey) {
          const prev = await c.query(
            `SELECT business_id, rows_accepted, rows_duplicate${workspace ? ",outlet_id,module_id,actor_ref,request_hash" : ""}${storesOutcomes ? ", outcomes" : ""} FROM pos.sync_receipts WHERE idempotency_key = $1`,
            [receiptKey]
          );
          if (prev.rows.length) {
            if (prev.rows[0].business_id !== businessId || workspace && (prev.rows[0].outlet_id !== workspace.outletId || prev.rows[0].module_id !== workspace.moduleId || prev.rows[0].actor_ref !== ownerRef || prev.rows[0].request_hash !== requestHash)) throw new BillingError(409, "IDEMPOTENCY_KEY_CONFLICT");
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
        const freeScope = workspace ? null : await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId;
        let merchantId;
        let outletId;
        if (workspace) {
          tenantId = workspace.tenantId;
          merchantId = workspace.merchantId;
          outletId = workspace.outletId;
        } else if (freeScope) {
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
        if (!workspace) await authorizeNativeModule(c, ownerRef, merchantId, outletId, [["pos"]]);
        const financialScope = { tenantId, merchantId, outletId, sector, actorRef: ownerRef, ...workspace ? { moduleId: workspace.moduleId, role: workspace.role } : {} };
        const cashierCache = /* @__PURE__ */ new Map();
        const productCache = /* @__PURE__ */ new Map();
        const productLimit = await productLimitForTenant(c, tenantId);
        const existingProductCount = await c.query(
          `SELECT COUNT(*)::int AS count FROM pos.products WHERE tenant_id = $1`,
          [tenantId]
        );
        let productCount = Number(existingProductCount.rows[0]?.count ?? 0);
        const resolveCashier = async (ref, name, role) => {
          if (workspace) {
            if (cashierCache.has(ownerRef)) return cashierCache.get(ownerRef);
            await c.query(`INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref) SELECT id,name,business_sector,owner_user_ref FROM internal.tenants WHERE id=$1 ON CONFLICT(id) DO NOTHING`, [tenantId]);
            const projection = (await c.query(`INSERT INTO pos.users(id,tenant_id,name,username,pin,role,external_ref) SELECT public.legacy_uuid('workspace-actor:'||$1::text||':'||u.id::text),$1::uuid,left(u.full_name,100),'ws_'||replace(public.legacy_uuid('workspace-actor:'||$1::text||':'||u.id::text)::text,'-',''),$3,$4,u.id::text FROM internal.users u WHERE u.id::text=$2 AND is_active ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role RETURNING id`, [tenantId, ownerRef, randomBytes2(32).toString("hex"), workspace.role === "OWNER" ? "ADMIN" : workspace.role])).rows[0];
            if (!projection) throw new ModuleAccessError(403, "AUTHENTICATED_STAFF_REQUIRED");
            cashierCache.set(ownerRef, projection.id);
            return projection.id;
          }
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
              ON CONFLICT(id) DO NOTHING RETURNING id`, [tenantId, free.ownerId, randomBytes2(32).toString("hex")]);
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
              ON CONFLICT(id) DO NOTHING`, [tenantId, ownerRef, randomBytes2(32).toString("hex")]);
          }
          const verified2 = await c.query(`SELECT id FROM pos.users
            WHERE tenant_id=$1 AND (id::text=$2 OR external_ref=$2) LIMIT 1`, [tenantId, ref]);
          const userId = verified2.rows[0]?.id ?? null;
          cashierCache.set(key, userId);
          return userId;
        };
        const resolveProduct = async (i) => {
          if (workspace) {
            const p = await workspaceProduct(c, workspace, i.productRef || "", true);
            if (!p.is_available) throw new FinanceError(409, "PRODUCT_UNAVAILABLE");
            productCache.set(i.productRef, p.id);
            return p.id;
          }
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
          if (workspace) {
            if (x.branchId && x.branchId !== workspace.outletId || x.workspace && ["tenantId", "merchantId", "outletId", "moduleId", "actorRef"].some((f) => x.workspace[f] !== workspace[f])) throw new FinanceError(403, "IMMUTABLE_WORKSPACE_MISMATCH");
            if (await hasSchemaFeature(c, "cashierRegisters")) {
              await clearRegisterBinding(c);
              const recorded = (await c.query("SELECT id,client_shift_id FROM pos.transactions WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_txn_id=$4", [tenantId, merchantId, outletId, clientId])).rows[0];
              if (x.shiftId && !recorded) await bindRegisterSale(c, workspace, x.shiftId);
              if (!x.shiftId && !recorded) throw new RegisterError(409, "EXPLICIT_REGISTER_SHIFT_REQUIRED");
              if (recorded && x.shiftId && recorded.client_shift_id !== x.shiftId) throw new FinanceError(409, "TRANSACTION_SHIFT_IMMUTABLE");
            } else if (x.shiftId && !(await c.query("SELECT id FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND (id::text=$5 OR client_shift_id=$5)", [tenantId, merchantId, outletId, workspace.moduleId, x.shiftId])).rows.length) throw new FinanceError(403, "SHIFT_WORKSPACE_MISMATCH");
            if (x.paymentStatus === "CANCELLED" && !["OWNER", "ADMIN", "MANAGER"].includes(workspace.role)) throw new FinanceError(403, "WORKSPACE_ROLE_FORBIDDEN");
            const lineSubtotal = x.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
            if (Math.abs(lineSubtotal - x.subtotal) > 0.011 || Math.abs(x.subtotal - (x.discountAmount || 0) + (x.taxAmount || 0) + (x.serviceChargeAmount || 0) - x.totalAmount) > 0.011) throw new FinanceError(400, "TRANSACTION_TOTAL_MISMATCH");
          }
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
                client_txn_id, shift_id, business_date, completed_at, cancelled_at, voided_at, created_at${workspace ? ",module_id,module_command_hash" : ""})
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18::uuid, $19::date, $20::timestamptz, $21::timestamptz, $22::timestamptz, COALESCE($23::timestamptz, CURRENT_TIMESTAMP)${workspace ? ",$24,$25" : ""})
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
              x.createdAt ?? null,
              ...workspace ? [workspace.moduleId, workspaceSaleHash(x)] : []
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
            if (workspace && original && (original.module_id !== workspace.moduleId || original.outlet_id !== outletId || paymentStatus !== "CANCELLED" && original.module_command_hash !== workspaceSaleHash(x))) throw new FinanceError(409, "TRANSACTION_ID_CONFLICT");
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
          for (const i of workspace ? [...x.items].sort((a, b) => (a.productRef || "").localeCompare(b.productRef || "")) : x.items) {
            const productId = await resolveProduct(i);
            if (!productId) continue;
            const qty = num(i.quantity, 1);
            const unitPrice = Math.max(0, num(i.unitPrice));
            const unitCost = workspace ? Number((await c.query("SELECT cost_price FROM pos.products WHERE id=$1", [productId])).rows[0].cost_price) : Math.max(0, num(i.unitCost));
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
              if (workspace) {
                const p = await workspaceProduct(c, workspace, i.productRef || "", true);
                const stock = await lockWorkspaceStock(c, workspace, p);
                if (stock && stock.quantity < qty) throw new FinanceError(409, "INSUFFICIENT_STOCK_REQUIRES_REVIEW");
              }
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
            [receiptKey, tenantId, businessId, accepted, duplicates, JSON.stringify({ rejected, renumbered })]
          );
        } else if (idemKey && !rejected.length && !renumbered.length) {
          await c.query(
            `INSERT INTO pos.sync_receipts (idempotency_key, tenant_id, business_id, rows_accepted, rows_duplicate)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [receiptKey, tenantId, businessId, accepted, duplicates]
          );
        }
        if (workspace && receiptKey) await c.query("UPDATE pos.sync_receipts SET outlet_id=$2,module_id=$3,actor_ref=$4,request_hash=$5 WHERE idempotency_key=$1", [receiptKey, outletId, workspace.moduleId, ownerRef, requestHash]);
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
      res.json({ ok: true, ...out, idempotencyKey: req.body.idempotencyKey });
    } catch (err) {
      if (err instanceof ModuleAccessError || err instanceof FinanceError) return res.status(err.status).json({ ok: false, error: err.message });
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
    const id = await db.tx(async (c) => {
      await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [t.rows[0].tenant_id, t.rows[0].id]);
      await authorizeNativeModule(c, principal.subject, t.rows[0].id, b.outletId, [["overview", "pos", "tables", "inventory"]]);
      return writeActivity(c, {
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
    try {
      const result = await db.tx(async (c) => {
        const merchant = (await c.query("SELECT id FROM internal.merchants WHERE external_ref=$1 OR id::text=$1", [businessId])).rows[0];
        if (!merchant) return { ok: true, synced: false };
        await authorizeNativeModule(c, principal.subject, merchant.id, req.query.outletId, [["pos", "reports"]]);
        const { rows } = await c.query(
          `SELECT m.id, m.name, m.business_sector,
              COUNT(x.id)::int              AS synced_transactions,
              COALESCE((SELECT SUM(r.total_amount) FROM contract.merchant_revenue r WHERE r.tenant_id=m.tenant_id AND r.merchant_id=m.id),0) AS synced_revenue,
              MAX(x.created_at)             AS last_transaction_at
         FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
         LEFT JOIN pos.transactions x ON x.tenant_id = t.id AND x.merchant_id=m.id
        WHERE (m.external_ref = $1 OR m.id::text=$1) AND t.owner_user_ref=$2
          AND t.is_active AND t.merged_into IS NULL AND m.is_active
        GROUP BY m.id, m.name, m.business_sector`,
          [businessId, principal.subject]
        );
        if (!rows.length) return { ok: true, synced: false };
        return { ok: true, synced: true, ...rows[0] };
      });
      res.json(result);
    } catch (error) {
      res.status(error instanceof BillingError || error instanceof ModuleAccessError ? error.status : 503).json({ ok: false, error: error instanceof BillingError || error instanceof ModuleAccessError ? error.message : "SYNC_STATUS_UNAVAILABLE" });
    }
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
      const result = await db.tx(async (c) => {
        const tenantRes = await c.query(
          `SELECT t.id AS tenant_id, m.id AS merchant_id
           FROM internal.tenants t
           JOIN internal.merchants m ON m.tenant_id = t.id
          WHERE (m.external_ref = $1 OR m.id::text = $1) AND m.business_sector=$3 AND t.owner_user_ref=$2 AND t.is_active AND t.merged_into IS NULL AND m.is_active`,
          [businessId, ownerRef, sector]
        );
        if (!tenantRes.rows.length) {
          return { ok: true, products: [], categories: [] };
        }
        const tenantId = tenantRes.rows[0].tenant_id;
        const merchantId = tenantRes.rows[0].merchant_id;
        await authorizeNativeModule(c, ownerRef, merchantId, req.query.outletId, [["pos", "tables", "inventory", "reports", "ai"]]);
        const prodRes = await c.query(
          `SELECT p.id, p.external_ref, p.name, p.sku, p.price, p.cost_price, p.unit, p.description,
                  p.is_available, COALESCE(p.category_name, 'Lainnya') AS category_name
             FROM pos.products p
            WHERE p.tenant_id = $1 AND p.merchant_id = $2 AND NOT p.sync_quarantined
            ORDER BY p.name ASC`,
          [tenantId, merchantId]
        );
        const categoryId = (r) => r.category_id || `category:${r.category_name}`;
        return {
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
        };
      });
      res.json(result);
    } catch (err) {
      res.status(err instanceof BillingError ? err.status : 500).json({ ok: false, error: err instanceof BillingError ? err.message : "CATALOG_FETCH_FAILED" });
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

// services/shared/nativeCors.ts
function nativeCors(req, res, methods) {
  const origin = String(req.headers.origin || "");
  const native = ["capacitor://localhost", "https://localhost"].includes(origin);
  if (!native) return false;
  const enabled = (process.env.NEW_HOPE_NATIVE_ORIGINS || "").split(",").map((v) => v.trim()).includes(origin);
  if (!enabled) {
    res.status(403).json({ ok: false, error: "NATIVE_ORIGIN_DISABLED" });
    return true;
  }
  const requested = String(req.headers["access-control-request-method"] || req.method).toUpperCase();
  const requestedHeaders = String(req.headers["access-control-request-headers"] || "").toLowerCase().split(",").map((v) => v.trim()).filter(Boolean);
  if (!methods.includes(requested) || requestedHeaders.some((h) => !["authorization", "content-type"].includes(h))) {
    res.status(403).json({ ok: false, error: "NATIVE_CORS_DENIED" });
    return true;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
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
    if ((options.name === "sync" || options.name === "billing" && path.startsWith("/api/v1/subscription/")) && nativeCors(req, res, options.routes[path])) return;
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

// src/server/syncHandler.ts
var allowedMethods = {
  "/api/v1/sync/modules/access": ["GET"],
  "/api/v1/sync/modules/inventory": ["POST"],
  "/api/v1/sync/modules/state": ["GET", "POST"],
  "/api/v1/sync/modules/dashboard": ["GET"],
  "/api/v1/sync/modules/revenue": ["GET"],
  "/api/v1/privacy/requests": ["GET", "POST"],
  "/api/v1/privacy/notices": ["POST"],
  "/api/v1/sync/business": ["GET", "POST"],
  "/api/v1/sync/catalog": ["GET", "POST"],
  "/api/v1/sync/transactions": ["POST"],
  "/api/v1/sync/activity": ["POST"],
  "/api/v1/sync/customers": ["POST"],
  "/api/v1/sync/attendance": ["POST"],
  "/api/v1/sync/payroll": ["POST"],
  "/api/v1/sync/state": ["GET", "POST"],
  "/api/v1/sync/status": ["GET"],
  "/api/v1/sync/receipt-logo": ["GET", "PUT"],
  "/api/v1/reports/summary": ["GET"],
  "/api/v1/reports/transactions": ["GET"],
  "/api/v1/finance/outlet": ["GET"],
  "/api/v1/finance/registers": ["GET", "POST"],
  "/api/v1/finance/shift/variance": ["POST"],
  "/api/v1/finance/pin": ["POST"],
  "/api/v1/finance/approve": ["POST"],
  "/api/v1/finance/refund": ["POST"],
  "/api/v1/finance/cash": ["POST"],
  "/api/v1/finance/cash/reverse": ["POST"],
  "/api/v1/finance/reconciliation": ["GET"],
  "/api/v1/finance/shift": ["GET"],
  "/api/v1/finance/shift/open": ["POST"],
  "/api/v1/finance/shift/close": ["POST"]
};
function createSyncHandler(authenticate = authenticateBearer, connect = () => connectDb({ schema: "pos", max: 2 })) {
  return createServerlessBoundary({
    name: "sync",
    routes: allowedMethods,
    bodyLimit: "10mb",
    register: registerSyncRoutes,
    unavailableError: "SYNC_UNAVAILABLE",
    invalidRequestError: "INVALID_SYNC_REQUEST"
  }, authenticate, connect);
}
var syncHandler_default = createSyncHandler();
export {
  createSyncHandler,
  syncHandler_default as default
};
