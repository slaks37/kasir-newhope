var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
import pg2 from "pg";
import { randomUUID as randomUUID2 } from "node:crypto";
function createBetterAuthRuntime(config = getAuthConfig(), sendEmail = sendBetterAuthEmail) {
  const pool = new pg2.Pool({ ...authDatabaseOptions(config.databaseUrl), ...databasePoolLimits(2) });
  const auth = betterAuth({
    appName: "New Hope POS",
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret: config.secret,
    database: { dialect: new PostgresDialect({ pool }), type: "postgres", schemaName: "newhope_auth" },
    trustedOrigins: config.allowedOrigins || [config.baseUrl],
    telemetry: { enabled: false },
    logger: { disabled: true },
    advanced: { database: { generateId: () => randomUUID2() }, useSecureCookies: config.baseUrl.startsWith("https://") },
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
  const reverse = deps.reverse || ((db, issuer2, canonical) => resolveProviderIdentity(db, { provider: "better-auth", issuer: issuer2, canonicalSubject: canonical }));
  const resolve = deps.resolve || ((db, issuer2, subject2, email) => resolveAuthIdentity(db, { provider: "better-auth", issuer: issuer2, subject: subject2, email, isEmailVerified: true }));
  let configured = false;
  try {
    configured = !!config().baseUrl;
  } catch {
  }
  return {
    provider,
    configured: deps.configured ?? configured,
    async ownerIdentity(canonical) {
      if (!canonicalUuid.test(canonical)) return null;
      try {
        const { pool } = await runtime2(), subject2 = await reverse(pool, config().baseUrl, canonical);
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
    async reauthenticate(req, canonical, password) {
      if (!canonicalUuid.test(canonical) || password !== void 0 && (typeof password !== "string" || password.length > 1024)) return false;
      try {
        const { auth, pool } = await runtime2(), headers = headersFor(req), session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
        if (!session?.user?.id || session.user.emailVerified !== true || session.user.isActive !== true) return false;
        const mapped = await resolve(pool, config().baseUrl, session.user.id, session.user.email);
        if (mapped !== canonical) return false;
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

// services/shared/db.ts
init_poolConfig();
import fs from "node:fs";
import pg from "pg";

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
init_authProviderOperations();
import { Resend as Resend2 } from "resend";
function createReminderProvider() {
  const auth = createAuthProviderOperations();
  if (!auth.configured || !process.env.RESEND_API_KEY) throw new Error("REMINDER_PROVIDER_NOT_CONFIGURED");
  const resend = new Resend2(process.env.RESEND_API_KEY);
  return {
    async verifiedOwnerEmail(subject2) {
      const identity = await auth.ownerIdentity(subject2);
      return identity?.verified ? identity.email : null;
    },
    async send(mail, idempotencyKey) {
      const { data, error } = await resend.emails.send(mail, { idempotencyKey });
      if (error || !data?.id) throw new Error("EMAIL_PROVIDER_REJECTED");
      return data.id;
    }
  };
}

// services/shared/cron.ts
function isCronJobEnabled(job) {
  const configured = process.env.CRON_ENABLED_JOBS;
  if (configured === void 0) return true;
  return configured.split(",").map((value) => value.trim()).filter(Boolean).includes(job);
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
    const result = await runBillingReminders(await database, provider, {
      dryRun,
      from: process.env.BILLING_EMAIL_FROM,
      appUrl: process.env.PUBLIC_APP_URL
    });
    return res.status(result.failed || result.review ? 503 : 200).json({ ok: !result.failed && !result.review, ...result });
  } catch {
    return res.status(503).json({ ok: false, error: "BILLING_REMINDERS_UNAVAILABLE" });
  }
}
export {
  handler as default
};
