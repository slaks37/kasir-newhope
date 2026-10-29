// services/shared/offlineIdentity.ts
import { createECDH, createHmac, createPrivateKey, createPublicKey, createHash, sign } from "node:crypto";

// src/lib/auth/offlineIdentity.ts
var OFFLINE_MAX_SECONDS = 3600;

// services/shared/offlineIdentity.ts
function offlineIdentityKeys(secret, issuer2) {
  if (secret.length < 48 || new URL(issuer2).origin !== issuer2) throw Error("OFFLINE_SIGNER_CONFIG_INVALID");
  const seed = createHmac("sha256", secret).update("newhope-offline-ui-signing-v1\0" + issuer2).digest();
  const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  const d = Buffer.from((BigInt("0x" + seed.toString("hex")) % (order - 1n) + 1n).toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const publicBytes = ecdh.getPublicKey(void 0, "uncompressed");
  const jwk = { kty: "EC", crv: "P-256", x: publicBytes.subarray(1, 33).toString("base64url"), y: publicBytes.subarray(33).toString("base64url"), d: d.toString("base64url") };
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" }), pub = createPublicKey(privateKey).export({ format: "jwk" });
  const publicKey = { kty: "EC", crv: "P-256", x: pub.x, y: pub.y, kid: createHash("sha256").update(pub.x + "." + pub.y).digest("base64url").slice(0, 16) };
  return { privateKey, publicKey };
}
function issueOfflineIdentity(input, now = Date.now()) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.device) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.user.id) || !input.sessionId || input.sessionId.length > 255) throw Error("OFFLINE_RECEIPT_INPUT_INVALID");
  const iat = Math.floor(now / 1e3), sessionExp = Math.floor(new Date(input.expiresAt).getTime() / 1e3), exp = Math.min(iat + OFFLINE_MAX_SECONDS, sessionExp);
  if (!Number.isFinite(exp) || exp <= iat) throw Error("OFFLINE_SESSION_EXPIRED");
  const { privateKey, publicKey } = offlineIdentityKeys(input.secret, input.issuer), claims = { v: 1, aud: "newhope-offline-ui", iss: input.issuer, sub: input.user.id, sid: input.sessionId, device: input.device, iat, exp, sessionExp, user: { id: input.user.id, email: input.user.email, twoFactorEnabled: input.user.twoFactorEnabled, passwordCredential: input.user.passwordCredential, providers: input.user.providers, user_metadata: Object.fromEntries(Object.entries(input.user.user_metadata).filter(([k, v]) => ["full_name", "store_name", "business_sector"].includes(k) && typeof v === "string" && v.length <= 150)) } };
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url"), body = encode({ alg: "ES256", typ: "NH-OFFLINE-UI", kid: publicKey.kid }) + "." + encode(claims);
  return body + "." + sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

// services/shared/betterAuth.ts
import { betterAuth } from "better-auth";
import { bearer, twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { PostgresDialect } from "kysely";
import pg from "pg";
import { randomUUID } from "node:crypto";

// services/shared/betterAuthConfig.ts
function authProvider(env = process.env) {
  if (process.env.NEWHOPE_BUILD_TARGET === "neon") {
    if (env.AUTH_PROVIDER && env.AUTH_PROVIDER !== "neon") throw Error("AUTH_PROVIDER_UNSUPPORTED");
    return "neon";
  }
  const value = env.AUTH_PROVIDER || "supabase";
  if (value !== "supabase" && value !== "neon") throw Error("AUTH_PROVIDER_UNSUPPORTED");
  return value;
}
var local = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
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

// services/shared/poolConfig.ts
function databasePoolLimits(max, vercel = process.env.VERCEL) {
  return {
    // Each warm function owns a pool; keep the per-instance budget small.
    max: vercel === "1" ? Math.min(Math.max(1, max), 2) : max,
    idleTimeoutMillis: vercel === "1" ? 5e3 : 3e4,
    connectionTimeoutMillis: 1e4
  };
}

// services/shared/betterAuthEmail.ts
import { createHash as createHash2 } from "node:crypto";
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
  if (origin.origin !== mail.baseUrl || link.origin !== mail.baseUrl || (mail.kind === "STAFF_INVITE" ? link.pathname !== "/staff-invite" || link.search !== "" || !/^#token=[\w-]{43}$/.test(link.hash) : mail.kind === "RESET" ? !/^\/api\/auth\/reset-password\/[^/]+$/.test(link.pathname) : link.pathname !== "/api/auth/verify-email")) throw Error("AUTH_EMAIL_URL_REJECTED");
  if (link.protocol !== "https:") throw Error("AUTH_EMAIL_HTTPS_REQUIRED");
  if (mail.kind !== "STAFF_INVITE") {
    const callbacks = link.searchParams.getAll("callbackURL");
    if (callbacks.length !== 1) throw Error("AUTH_CALLBACK_REJECTED");
    authReturnUrl(mail.kind, callbacks[0], mail.baseUrl, [mail.baseUrl, ...(env.NEWHOPE_AUTH_TRUSTED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
  }
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(mail.email)) throw Error("AUTH_EMAIL_RECIPIENT_REJECTED");
  if (env.AUTH_EMAIL_ENABLED !== "1" || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM || !env.AUTH_EMAIL_VERIFIED_DOMAIN)
    throw Error("AUTH_EMAIL_PROVIDER_NOT_CONFIGURED");
  const sender = env.AUTH_EMAIL_FROM.match(/^(?:[^<>\r\n]+<)?([^<>\s@,;]+@[^<>\s@,;]+)(?:>)?$/)?.[1];
  if (!sender || sender.split("@")[1].toLowerCase() !== env.AUTH_EMAIL_VERIFIED_DOMAIN.toLowerCase()) throw Error("AUTH_EMAIL_SENDER_REJECTED");
  if (env.VERCEL_ENV === "preview" || env.APP_ENV === "staging") {
    const allowed = (env.AUTH_EMAIL_ALLOWED_RECIPIENTS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(mail.email.toLowerCase())) throw Error("AUTH_EMAIL_STAGING_RECIPIENT_NOT_APPROVED");
  }
  const text = mail.kind === "STAFF_INVITE" ? "Undangan akses staf New Hope" : mail.kind === "RESET" ? "Atur password New Hope Anda" : "Verifikasi email New Hope Anda";
  const duration = mail.kind === "STAFF_INVITE" ? "24 jam" : "15 menit";
  const safeUrl = mail.url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const key = createHash2("sha256").update(mail.kind + ":" + mail.email + ":" + mail.url).digest("hex");
  return { payload: {
    from: env.AUTH_EMAIL_FROM,
    to: mail.email,
    replyTo: "stefen@newsystem.space",
    subject: text,
    text: text + ". Buka tautan ini (berlaku " + duration + "): " + mail.url + "\nJika Anda tidak meminta ini, abaikan email dan hubungi dukungan.",
    html: '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' + text + "</title></head><body><h1>" + text + "</h1><p>Tautan berlaku " + duration + '.</p><p><a href="' + safeUrl + '">' + text + "</a></p><p>Jika Anda tidak meminta ini, abaikan email dan hubungi stefen@newsystem.space.</p></body></html>"
  }, idempotencyKey: "newhope-auth-" + key };
}
async function sendBetterAuthEmail(mail) {
  const { payload, idempotencyKey } = authEmailPayload(mail);
  const response = await new Resend(process.env.RESEND_API_KEY).emails.send(payload, { idempotencyKey });
  if (response.error || !response.data?.id) throw Error("AUTH_EMAIL_DELIVERY_FAILED");
}

// services/shared/schemaFeatures.ts
var FEATURES = {
  staffIdentityPurpose: `SELECT to_regprocedure('internal.is_staff_only_identity(text)') IS NOT NULL AS ok`,
  staffAccounts: `SELECT to_regclass('internal.staff_invitations') IS NOT NULL AND to_regclass('internal.staff_workspace_assignments') IS NOT NULL AND EXISTS(SELECT FROM pg_attribute WHERE attrelid=to_regclass('internal.memberships') AND attname='auth_managed' AND NOT attisdropped) AS ok`,
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

// services/shared/betterAuth.ts
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
          if (raw.account_purpose === "STAFF") {
            if (!await hasSchemaFeature(pool, "staffIdentityPurpose")) throw new APIError("SERVICE_UNAVAILABLE", { code: "STAFF_REGISTRATION_NOT_READY", message: "Pendaftaran staf belum tersedia." });
            ctx.body.onboarding.account_purpose = "STAFF";
          }
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
var runtime;
function getBetterAuthRuntime() {
  return runtime ??= createBetterAuthRuntime();
}

// services/shared/authIdentity.ts
var fail = (code) => {
  throw Error(code);
};
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

// services/shared/betterAuthPrincipal.ts
var NeonIdentityError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
};
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

// services/shared/nativeAuthState.ts
import { createCipheriv, createDecipheriv, createHash as createHash3, randomBytes } from "node:crypto";
function sealAuthState(value, secret, purpose, ttl = 300, now = Date.now()) {
  const iv = randomBytes(12), key = createHash3("sha256").update(secret).digest(), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const bytes = Buffer.concat([cipher.update(JSON.stringify({ value, expires: now + ttl * 1e3 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
function openAuthState(value, secret, purpose, now = Date.now()) {
  if (value.length > 16384) throw Error("AUTH_STATE_REJECTED");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 29) throw Error("AUTH_STATE_REJECTED");
  const decipher = createDecipheriv("aes-256-gcm", createHash3("sha256").update(secret).digest(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const parsed = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  if (!Number.isFinite(parsed.expires) || parsed.expires <= now) throw Error("AUTH_STATE_EXPIRED");
  return parsed.value;
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

// src/server/nativeAuthRoutes.ts
import { createHash as createHash4, randomBytes as randomBytes2 } from "node:crypto";
var digest = (v) => createHash4("sha256").update(v).digest("base64url");
var callback = "space.newhope.kasir://auth/callback";
async function throttle(c) {
  const now = Date.now(), key = "native:" + digest((c.headers.get("x-forwarded-for") || "unknown") + c.url.pathname), r = await c.runtime.pool.query(`INSERT INTO newhope_auth."rateLimit"(id,key,count,"lastRequest") VALUES($1,$1,1,$2)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN newhope_auth."rateLimit"."lastRequest"<$2-60000 THEN 1 ELSE newhope_auth."rateLimit".count+1 END,"lastRequest"=CASE WHEN newhope_auth."rateLimit"."lastRequest"<$2-60000 THEN $2 ELSE newhope_auth."rateLimit"."lastRequest" END RETURNING count`, [key, now]);
  return Number(r.rows[0]?.count) <= 20;
}
function cookies(response, res) {
  const values = response.headers.getSetCookie();
  if (values.length) res.setHeader("Set-Cookie", values);
}
function html(res, body, status = 200) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(status).send('<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>New Hope Login</title><body><main>' + body + "</main></body></html>");
}
async function handleNativeAuth(c) {
  const { req, res, url, headers, runtime: r, config } = c, path = url.pathname;
  if (!await throttle(c)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "AUTH_RATE_LIMITED" });
  }
  if (path === "/api/auth/native/start" && req.method === "GET") {
    const challenge = url.searchParams.get("challenge");
    if (url.searchParams.size !== 1 || !challenge || !/^[-_A-Za-z0-9]{43}$/.test(challenge)) return res.status(400).json({ error: "PKCE_REQUIRED" });
    if (!config.google) return res.status(503).json({ error: "GOOGLE_AUTH_NOT_CONFIGURED" });
    const transaction = randomBytes2(32).toString("base64url");
    await r.pool.query("INSERT INTO newhope_auth.native_transactions(id,challenge,expires_at) VALUES($1,$2,now()+interval '5 minutes')", [transaction, challenge]);
    const response = await r.auth.handler(new Request(config.baseUrl + "/api/auth/sign-in/social", { method: "POST", headers: { origin: config.baseUrl, "content-type": "application/json" }, body: JSON.stringify({ provider: "google", callbackURL: config.baseUrl + "/api/auth/native/complete?transaction=" + transaction, disableRedirect: true }) }));
    if (!response.ok) return res.status(503).json({ error: "GOOGLE_AUTH_UNAVAILABLE" });
    const data = await response.json();
    let target;
    try {
      target = new URL(data.url);
      if (target.protocol !== "https:" || target.hostname !== "accounts.google.com" || target.searchParams.get("redirect_uri") !== config.baseUrl + "/api/auth/callback/google") throw Error();
    } catch {
      return res.status(503).json({ error: "GOOGLE_AUTH_URL_REJECTED" });
    }
    cookies(response, res);
    return res.redirect(303, target.href);
  }
  if (path === "/api/auth/native/complete" && ["GET", "POST"].includes(req.method)) {
    const transaction = url.searchParams.get("transaction");
    if (!transaction || !/^[-_A-Za-z0-9]{43}$/.test(transaction) || url.searchParams.size !== 1) return res.status(400).json({ error: "NATIVE_TRANSACTION_REJECTED" });
    const tx = (await r.pool.query("SELECT id FROM newhope_auth.native_transactions WHERE id=$1 AND completed_at IS NULL AND expires_at>now()", [transaction])).rows[0];
    if (!tx) return res.status(410).json({ error: "NATIVE_TRANSACTION_EXPIRED" });
    if (req.method === "POST") {
      if (String(req.headers.origin || "") !== config.baseUrl) return res.status(403).json({ error: "AUTH_ORIGIN_REJECTED" });
      let code2 = "";
      try {
        code2 = headers.get("content-type")?.startsWith("application/json") ? JSON.parse(c.bytes?.toString() || "{}").code : new URLSearchParams(c.bytes?.toString()).get("code") || "";
      } catch {
      }
      if (!/^\d{6}$/.test(code2)) return html(res, "<h1>Kode autentikator tidak valid</h1>", 400);
      const response = await r.auth.handler(new Request(config.baseUrl + "/api/auth/two-factor/verify-totp", { method: "POST", headers: new Headers({ ...Object.fromEntries(headers), "content-type": "application/json" }), body: JSON.stringify({ code: code2, trustDevice: false }) }));
      cookies(response, res);
      if (!response.ok) return html(res, "<h1>Verifikasi belum berhasil</h1><p>Kembali dan coba kode autentikator terbaru.</p>", 401);
      return res.redirect(303, url.pathname + url.search);
    }
    let verified2;
    try {
      verified2 = await resolveNeonSession(headers, { enroll: true }, r);
    } catch (e) {
      if (e instanceof NeonIdentityError && e.code === "MFA_REQUIRED") return html(res, `<h1>Verifikasi autentikator</h1><form method="post" action="/api/auth/native/complete?transaction=${transaction}"><label>Kode 6 digit <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><button>Verifikasi dan kembali ke aplikasi</button></form>`);
      throw e;
    }
    if (!verified2) return html(res, "<h1>Sesi tidak tersedia</h1><p>Mulai kembali login dari aplikasi New Hope.</p>", 401);
    const context = await r.auth.$context, name = context.authCookies.sessionToken.name;
    const token = (headers.get("cookie") || "").split(";").map((v) => v.trim()).find((v) => v.startsWith(name + "="))?.slice(name.length + 1);
    if (!token) return res.status(401).json({ error: "NATIVE_SESSION_REQUIRED" });
    const code = randomBytes2(32).toString("base64url"), client = await r.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query("UPDATE newhope_auth.native_transactions SET completed_at=now() WHERE id=$1 AND completed_at IS NULL AND expires_at>now() RETURNING id", [transaction]);
      if (updated.rowCount !== 1) throw Error("NATIVE_TRANSACTION_REPLAY");
      await client.query("INSERT INTO newhope_auth.native_handoffs(code_hash,transaction_id,token_encrypted,expires_at) VALUES($1,$2,$3,now()+interval '60 seconds')", [digest(code), transaction, sealAuthState(token, config.secret, "native-session:" + config.baseUrl, 60)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return res.redirect(303, callback + "?code=" + code);
  }
  if (path === "/api/auth/native/exchange" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(c.bytes?.toString() || "{}");
    } catch {
      return res.status(400).json({ error: "PKCE_REJECTED" });
    }
    if (typeof body.code !== "string" || !/^[-_A-Za-z0-9]{43}$/.test(body.code) || typeof body.verifier !== "string" || !/^[-_A-Za-z0-9]{43,128}$/.test(body.verifier)) return res.status(400).json({ error: "PKCE_REJECTED" });
    const row = (await r.pool.query(`UPDATE newhope_auth.native_handoffs h SET consumed_at=now() FROM newhope_auth.native_transactions t WHERE h.transaction_id=t.id AND h.code_hash=$1 AND h.consumed_at IS NULL AND h.expires_at>now() AND t.challenge=$2 RETURNING h.token_encrypted`, [digest(body.code), digest(body.verifier)])).rows[0];
    if (!row) return res.status(401).json({ error: "NATIVE_CODE_REJECTED" });
    const token = openAuthState(row.token_encrypted, config.secret, "native-session:" + config.baseUrl);
    if (typeof token !== "string") throw Error("NATIVE_TOKEN_REJECTED");
    const verified2 = await resolveNeonSession(new Headers({ authorization: "Bearer " + token }), {}, r);
    if (!verified2) return res.status(401).json({ error: "AUTH_SESSION_REQUIRED" });
    res.setHeader("set-auth-token", token);
    return res.json({ ok: true });
  }
  return res.status(404).json({ error: "NOT_FOUND" });
}

// src/server/neonAuthHandler.ts
var pendingCookie = /^(?:__Secure-)?better-auth\.two_factor=/;
function createNeonAuthHandler(runtime2 = getBetterAuthRuntime) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (authProvider() !== "neon") return res.status(404).json({ error: "NOT_FOUND" });
    normalizeVercelUrl(req);
    try {
      const config = getAuthConfig(), url = new URL(req.originalUrl || req.url, config.baseUrl), path = url.pathname;
      if (!path.startsWith("/api/auth/") || !["GET", "POST", "OPTIONS"].includes(req.method)) return res.status(404).json({ error: "NOT_FOUND" });
      const origin = String(req.headers.origin || ""), native = ["capacitor://localhost", "https://localhost"].includes(origin);
      if (origin && !(native ? config.nativeOrigins : config.allowedOrigins).includes(origin)) return res.status(403).json({ error: "AUTH_ORIGIN_REJECTED" });
      if (native) {
        const requested = String(req.headers["access-control-request-headers"] || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
        if (requested.some((h) => !["authorization", "content-type", "x-newhope-auth-state", "x-newhope-offline-device"].includes(h))) return res.status(403).json({ error: "AUTH_CORS_REJECTED" });
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Newhope-Auth-State, X-Newhope-Offline-Device");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "set-auth-token, X-Newhope-Auth-State");
      }
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method === "POST" && !origin) return res.status(403).json({ error: "AUTH_ORIGIN_REQUIRED" });
      if (path.includes("%") || path.includes("//") || path.endsWith("/")) return res.status(404).json({ error: "NOT_FOUND" });
      if (["/api/auth/get-access-token", "/api/auth/refresh-token", "/api/auth/account-info", "/api/auth/link-social", "/api/auth/unlink-account"].includes(path)) return res.status(404).json({ error: "NOT_FOUND" });
      const r = runtime2();
      await r.ready;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string" && !["host", "content-length", "connection", "transfer-encoding", "x-auth-sub", "x-auth-email", "x-auth-aal", "x-real-ip", "x-forwarded-for"].includes(k)) headers.set(k, v);
      }
      if (headers.has("authorization")) headers.delete("cookie");
      headers.set("x-forwarded-for", process.env.VERCEL ? String(req.headers["x-vercel-forwarded-for"] || "unknown") : String(req.socket?.remoteAddress || "unknown"));
      if (native) {
        headers.delete("cookie");
        headers.set("origin", config.baseUrl);
        const state = req.headers["x-newhope-auth-state"];
        if (state) {
          const cookies3 = openAuthState(String(state), config.secret, "native-pending:" + config.baseUrl + ":" + origin);
          if (typeof cookies3 !== "string" || !cookies3.split("; ").every((c) => pendingCookie.test(c))) return res.status(400).json({ error: "AUTH_STATE_REJECTED" });
          headers.set("cookie", cookies3);
        }
      }
      let bytes;
      if (req.method === "POST") {
        if (req.body !== void 0) bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
        else {
          const chunks = [];
          let count = 0;
          for await (const chunk of req) {
            count += chunk.length;
            if (count > 32768) return res.status(413).json({ error: "BODY_TOO_LARGE" });
            chunks.push(Buffer.from(chunk));
          }
          bytes = Buffer.concat(chunks);
        }
        if (bytes && bytes.length > 32768) return res.status(413).json({ error: "BODY_TOO_LARGE" });
      }
      if (path.startsWith("/api/auth/native/")) return await handleNativeAuth({ req, res, url, headers, bytes, runtime: r, config });
      if (path === "/api/auth/identity") {
        if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
        const verified2 = await resolveNeonSession(headers, { enroll: true }, r);
        if (!verified2) return res.status(401).json({ error: "AUTH_SESSION_REQUIRED" });
        const { session, principal, refreshHeaders } = verified2;
        if (native) {
          const token = refreshHeaders.get("set-auth-token");
          if (token) res.setHeader("set-auth-token", token);
        } else {
          const cookies3 = refreshHeaders.getSetCookie();
          if (cookies3.length) res.setHeader("set-cookie", cookies3);
        }
        const accounts = (await r.pool.query('SELECT "providerId",password IS NOT NULL AS credential FROM newhope_auth.account WHERE "userId"=$1', [session.user.id])).rows;
        const identity = { user: { id: principal.subject, email: principal.email, emailVerified: true, twoFactorEnabled: session.user.twoFactorEnabled === true, passwordCredential: accounts.some((a) => a.providerId === "credential" && a.credential), providers: accounts.map((a) => a.providerId), user_metadata: { ...session.user.onboarding || {}, full_name: session.user.name } }, session: { id: session.session.id, expiresAt: session.session.expiresAt, aal: principal.aal, mfaVerifiedAt: principal.mfaVerifiedAt } };
        const device = String(req.headers["x-newhope-offline-device"] || "");
        if (device && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(device)) return res.status(400).json({ error: "OFFLINE_DEVICE_REJECTED" });
        const offlineReceipt = device ? issueOfflineIdentity({ secret: config.secret, issuer: config.baseUrl, device, sessionId: session.session.id, expiresAt: session.session.expiresAt, user: { ...identity.user, user_metadata: Object.fromEntries(Object.entries(identity.user.user_metadata).filter((entry) => typeof entry[1] === "string")) } }) : void 0;
        return res.json({ ...identity, ...offlineReceipt ? { offlineReceipt } : {} });
      }
      const response = await r.auth.handler(new Request(config.baseUrl + path + url.search, { method: req.method, headers, body: bytes }));
      const result = Buffer.from(await response.arrayBuffer());
      let pending = false;
      try {
        pending = JSON.parse(result.toString()).twoFactorRedirect === true;
      } catch {
      }
      response.headers.forEach((v, k) => {
        if (!["set-cookie", "set-auth-token", "access-control-expose-headers"].includes(k)) res.setHeader(k, v);
      });
      const cookies2 = response.headers.getSetCookie();
      if (native) {
        const token = response.headers.get("set-auth-token");
        if (token && !pending) res.setHeader("set-auth-token", token);
        const challenge = cookies2.map((c) => c.split(";")[0]).filter((c) => pendingCookie.test(c));
        if (challenge.length) res.setHeader("X-Newhope-Auth-State", sealAuthState(challenge.join("; "), config.secret, "native-pending:" + config.baseUrl + ":" + origin));
      } else if (cookies2.length) res.setHeader("set-cookie", cookies2);
      return res.status(response.status).send(result);
    } catch (error) {
      if (error instanceof NeonIdentityError) return res.status(error.code === "MFA_REQUIRED" ? 401 : 403).json({ error: error.code });
      return res.status(503).json({ error: "AUTH_UNAVAILABLE" });
    }
  };
}
var neonAuthHandler_default = createNeonAuthHandler();
export {
  createNeonAuthHandler,
  neonAuthHandler_default as default
};
