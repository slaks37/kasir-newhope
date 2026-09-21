// src/server/syncHandler.ts
import express from "express";

// services/shared/auth.ts
var LOCAL_BYPASS = () => process.env.NODE_ENV !== "production" && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === "1";
function firstHeader(value) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}
function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return { url, apiKey };
}
async function authenticateBearer(req) {
  const authorization = firstHeader(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return LOCAL_BYPASS() ? { subject: "local-development" } : null;
  }
  const { url, apiKey } = supabaseConfig();
  if (!url || !apiKey) {
    return LOCAL_BYPASS() ? { subject: "local-development" } : null;
  }
  try {
    const upstream = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${match[1]}`, apikey: apiKey },
      signal: AbortSignal.timeout(5e3)
    });
    if (!upstream.ok) return null;
    const user = await upstream.json();
    if (typeof user.id !== "string" || !user.id) return null;
    const claims = JSON.parse(Buffer.from(match[1].split(".")[1], "base64url").toString("utf8"));
    if (claims.sub !== user.id || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1e3) return null;
    const times = Array.isArray(claims.amr) ? claims.amr.filter((a) => a.method === "totp" && Number.isFinite(a.timestamp) && a.timestamp <= Date.now() / 1e3 + 30).map((a) => a.timestamp) : [];
    return {
      subject: user.id,
      email: typeof user.email === "string" ? user.email : void 0,
      aal: claims.aal === "aal2" ? "aal2" : "aal1",
      mfaVerifiedAt: times.length ? Math.max(...times) : void 0
    };
  } catch {
    return null;
  }
}
function trustedPrincipal(req) {
  const subject = firstHeader(req.headers["x-auth-sub"]);
  if (subject) return { subject, email: firstHeader(req.headers["x-auth-email"]) || void 0 };
  return LOCAL_BYPASS() ? { subject: "local-development" } : null;
}
async function canAccessBusiness(db, principal, businessId) {
  if (principal.subject === "local-development") return true;
  const { rows } = await db.query(
    `SELECT 1
       FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE m.external_ref = $1 AND t.owner_user_ref = $2
      LIMIT 1`,
    [businessId, principal.subject]
  );
  return rows.length === 1;
}

// services/shared/db.ts
import fs from "node:fs";
import pg from "pg";
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
  const connectionString = opts.connectionString || process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5432/postgres";
  const pool = new pg.Pool({
    connectionString,
    ssl: konfigurasiSsl(connectionString),
    // Kecil dengan sengaja. Di pengembangan, keempat service berbagi satu
    // batas koneksi di db-server; pool besar per service akan menghabiskannya
    // dan membuat service yang menyala terakhir gagal tersambung.
    max: opts.max ?? Number(process.env.PGPOOL_MAX || 4),
    idleTimeoutMillis: 3e4,
    connectionTimeoutMillis: 1e4
  });
  void opts.schema;
  pool.on("error", (err) => {
    console.error("[db] koneksi idle bermasalah:", err.message);
  });
  await withRetry(async () => {
    const probe = await pool.connect();
    probe.release();
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
async function withRetry(fn, attempts = 15) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(250 * 2 ** i, 3e3);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`Database tidak bisa dihubungi setelah ${attempts} percobaan: ${lastErr?.message}`);
}

// services/pos/sync.ts
import { randomBytes } from "node:crypto";

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
  const { rows } = await db.query(`SELECT * FROM contract.free_plan_entitlements
    WHERE owner_user_ref=$1 ORDER BY tenant_id LIMIT 1`, [ownerId]);
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

// services/pos/sync.ts
var SECTOR_SET = new Set(SECTORS);
var MAX_BATCH = 500;
var SyncAccessError = class extends Error {
};
var ProductLimitError = class extends Error {
};
async function assertBusinessCanBeClaimed(db, businessId, ownerSubject) {
  if (ownerSubject === "local-development") return;
  const { rows } = await db.query(
    `SELECT t.owner_user_ref
       FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE m.external_ref = $1
      LIMIT 1`,
    [businessId]
  );
  if (rows.length && rows[0].owner_user_ref !== ownerSubject) {
    throw new SyncAccessError("BUSINESS_NOT_OWNED");
  }
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
function registerSyncRoutes(app, db) {
  app.post("/api/v1/sync/transactions", async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? "Tanpa Nama";
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const ownerRef = principal.subject;
    const idemKey = str(body.idempotencyKey, 120);
    const txns = Array.isArray(body.transactions) ? body.transactions : [];
    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        detail: "businessId dan sector wajib; sector harus salah satu dari " + SECTORS.join(", ")
      });
    }
    if (txns.length > MAX_BATCH) {
      return res.status(413).json({
        ok: false,
        error: "BATCH_TOO_LARGE",
        detail: `Maksimal ${MAX_BATCH} transaksi per kiriman. Pecah antriannya.`
      });
    }
    try {
      const out = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        if (idemKey) {
          const prev = await c.query(
            `SELECT business_id, rows_accepted, rows_duplicate FROM pos.sync_receipts WHERE idempotency_key = $1`,
            [idemKey]
          );
          if (prev.rows.length) {
            if (prev.rows[0].business_id !== businessId) throw new BillingError(409, "IDEMPOTENCY_KEY_CONFLICT");
            return {
              replayed: true,
              accepted: prev.rows[0].rows_accepted,
              duplicates: prev.rows[0].rows_duplicate,
              tenantId: null
            };
          }
        }
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId;
        let merchantId;
        let outletId;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          outletId = freeScope.outlet_id;
          await assertTenantWritable(c, tenantId);
        } else {
          const tenantExternalRef = ownerRef || `tenant_${businessId}`;
          const t = await c.query(
            `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
            [storeName, tenantExternalRef, ownerRef]
          );
          tenantId = t.rows[0].id;
          await assertTenantWritable(c, tenantId);
          const m = await c.query(
            `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
            [tenantId, storeName, sector, businessId]
          );
          merchantId = m.rows[0].id;
          const outq = await c.query(
            `SELECT id FROM internal.outlets WHERE merchant_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [merchantId]
          );
          if (outq.rows.length) {
            outletId = outq.rows[0].id;
          } else {
            await assertOutletCapacity(c, tenantId);
            const outins = await c.query(
              `INSERT INTO internal.outlets (id, tenant_id, merchant_id, name)
                 VALUES (uuidv7(), $1, $2, $3) RETURNING id`,
              [tenantId, merchantId, `${storeName} (Cabang Utama)`]
            );
            outletId = outins.rows[0].id;
          }
        }
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
              ON CONFLICT(id) DO NOTHING RETURNING id`, [tenantId, free.ownerId, randomBytes(32).toString("hex")]);
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
          const found = await c.query(
            `SELECT id FROM internal.memberships WHERE tenant_id = $1 AND (external_ref = $2 OR role = $3) LIMIT 1`,
            [tenantId, ref, role]
          );
          let userId;
          const userCheck = await c.query(
            `SELECT id FROM internal.users WHERE email = $1 LIMIT 1`,
            [`${ref || "kasir"}@pos.local`]
          );
          if (userCheck.rows.length) {
            userId = userCheck.rows[0].id;
          } else {
            const insUser = await c.query(
              `INSERT INTO internal.users (id, email, full_name) VALUES (uuidv7(), $1, $2) RETURNING id`,
              [`${ref || "kasir"}_${Date.now()}@pos.local`, name || "Kasir"]
            );
            userId = insUser.rows[0].id;
          }
          cashierCache.set(key, userId);
          return userId;
        };
        const resolveProduct = async (i) => {
          assertFreeScope(await freePlanState(c, tenantId), sector, [i.productRef || ""]);
          const key = i.productRef || i.productName;
          if (!key) return null;
          if (productCache.has(key)) return productCache.get(key);
          const found = await c.query(
            `SELECT id, outlet_id FROM pos.products WHERE tenant_id = $1
              AND (external_ref = $2 OR (NOT $4::boolean AND name = $3)) LIMIT 1`,
            [tenantId, i.productRef ?? null, i.productName, !!freeScope]
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
        for (const x of txns) {
          const clientId = str(x.clientTxnId, 64);
          if (!clientId || !Array.isArray(x.items) || !x.items.length) continue;
          const cashierId = await resolveCashier(
            str(x.cashierRef, 96),
            str(x.cashierName, 100),
            str(x.cashierRole, 24)
          );
          const subtotal = num(x.subtotal);
          const discount = num(x.discountAmount);
          const tax = num(x.taxAmount);
          const serviceCharge = num(x.serviceChargeAmount);
          const total = num(x.totalAmount, subtotal - discount + tax + serviceCharge);
          const appModule = ["POS", "TABLES", "CUSTOMERS"].includes(String(x.appModule)) ? String(x.appModule) : "POS";
          const paymentMethod = str(x.paymentMethod, 20) ?? "CASH";
          const paymentStatus = str(x.paymentStatus, 20) ?? "PAID";
          const isVoid = paymentStatus === "CANCELLED";
          const orderStatus = isVoid ? "VOIDED" : paymentStatus === "PENDING" ? "PENDING_PAYMENT" : "COMPLETED";
          const ins = await c.query(
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
              str(x.invoiceNumber, 64),
              clientId,
              str(x.shiftId, 36) ?? null,
              str(x.businessDate, 10) ?? (x.createdAt ? x.createdAt.split("T")[0] : null),
              x.completedAt ?? (orderStatus === "COMPLETED" ? x.createdAt : null),
              x.cancelledAt ?? (isVoid ? x.createdAt : null),
              x.voidedAt ?? null,
              x.createdAt ?? null
            ]
          );
          if (!ins.rows.length) {
            duplicates++;
            const status = str(x.paymentStatus, 20);
            if (status === "CANCELLED") {
              const upd = await c.query(
                `UPDATE pos.transactions
                    SET order_status = 'VOIDED',
                        voided_at = COALESCE($3::timestamptz, CURRENT_TIMESTAMP)
                  WHERE tenant_id = $1 AND client_txn_id = $2
                    AND order_status <> 'VOIDED'
                RETURNING id`,
                [tenantId, clientId, x.voidedAt ?? x.createdAt ?? null]
              );
              if (upd.rows.length) {
                const voidedTxnId = upd.rows[0].id;
                await c.query(
                  `UPDATE pos.payments SET payment_status = 'REFUNDED' WHERE transaction_id = $1`,
                  [voidedTxnId]
                );
                const voidedItems = await c.query(
                  `SELECT ti.product_id, ti.quantity,
                          p.inventory_item_id, p.merchant_id, p.outlet_id
                     FROM pos.transaction_items ti
                     JOIN pos.products p ON p.id = ti.product_id
                    WHERE ti.transaction_id = $1
                      AND p.inventory_item_id IS NOT NULL`,
                  [voidedTxnId]
                );
                for (const vi of voidedItems.rows) {
                  await c.query(
                    `INSERT INTO pos.inventory_transactions
                       (id, tenant_id, merchant_id, outlet_id, location_id,
                        inventory_item_id, quantity_delta, reference_type,
                        reference_id, reason, created_at)
                     VALUES (
                       uuidv7(), $1, $2, $3,
                       (SELECT location_id FROM pos.inventory_balances
                         WHERE inventory_item_id = $5 AND outlet_id = $3 LIMIT 1),
                       $5, $4, 'VOID_RESTORE', $6,
                       'Pengembalian stok \u2014 transaksi dibatalkan', CURRENT_TIMESTAMP)`,
                    [tenantId, vi.merchant_id, vi.outlet_id, vi.quantity, vi.inventory_item_id, voidedTxnId]
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
            continue;
          }
          const txnId = ins.rows[0].id;
          const pStatus = isVoid ? "REFUNDED" : paymentStatus === "PENDING" ? "PENDING" : "PAID";
          await c.query(
            `INSERT INTO pos.payments
               (id, tenant_id, merchant_id, outlet_id, transaction_id, payment_method, payment_status, amount, gateway_provider)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'MANUAL_CASH')
             ON CONFLICT DO NOTHING`,
            [tenantId, merchantId, outletId, txnId, paymentMethod, pStatus, total]
          );
          for (const i of x.items) {
            const productId = await resolveProduct(i);
            if (!productId) continue;
            const qty = Math.max(1, Math.trunc(num(i.quantity, 1)));
            await c.query(
              `INSERT INTO pos.transaction_items
                 (id, transaction_id, tenant_id, product_id, product_name, unit_price,
                  quantity, total_price, business_sector, category_name, unit_cost,
                  product_description)
               VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                txnId,
                tenantId,
                productId,
                i.productName.slice(0, 100),
                num(i.unitPrice),
                qty,
                num(i.totalPrice, num(i.unitPrice) * qty),
                sector,
                str(i.categoryName, 100),
                num(i.unitCost),
                str(i.productDescription, 300)
              ]
            );
            if (!isVoid) {
              await c.query(
                `INSERT INTO pos.inventory_transactions
                   (id, tenant_id, merchant_id, outlet_id, location_id,
                    inventory_item_id, quantity_delta, reference_type,
                    reference_id, reason, created_at)
                 SELECT
                   uuidv7(), p.tenant_id, p.merchant_id, p.outlet_id,
                   (SELECT ib.location_id FROM pos.inventory_balances ib
                     WHERE ib.inventory_item_id = p.inventory_item_id
                       AND ib.outlet_id = p.outlet_id LIMIT 1),
                   p.inventory_item_id,
                   -($2::numeric),
                   'SALE_DEDUCT',
                   $3,
                   'Penjualan POS',
                   CURRENT_TIMESTAMP
                 FROM pos.products p
                 WHERE p.id = $1
                   AND p.inventory_item_id IS NOT NULL`,
                [productId, qty, txnId]
              );
            }
          }
          accepted++;
        }
        if (idemKey) {
          await c.query(
            `INSERT INTO pos.sync_receipts (idempotency_key, tenant_id, business_id,
                                        rows_accepted, rows_duplicate)
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
            detail: { accepted, duplicates, batch: txns.length }
          });
        }
        return { replayed: false, accepted, duplicates, voided, tenantId };
      });
      res.json({ ok: true, ...out });
    } catch (err) {
      if (err instanceof FreePlanAccessError) return res.status(403).json({ ok: false, error: err.message });
      if (err instanceof BillingError) return res.status(err.status).json({ ok: false, error: err.message });
      console.error("[sync] gagal:", err.message);
      if (err instanceof SyncAccessError) return res.status(403).json({ ok: false, error: "FORBIDDEN" });
      if (err instanceof ProductLimitError) return res.status(409).json({ ok: false, error: "PRODUCT_LIMIT_EXCEEDED" });
      res.status(500).json({ ok: false, error: "SYNC_FAILED" });
    }
  });
  app.post("/api/v1/sync/catalog", async (req, res) => {
    const b = req.body ?? {};
    const businessId = str(b.businessId, 96);
    const sector = str(b.sector, 16);
    const storeName = str(b.storeName, 100) ?? "Tanpa Nama";
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const ownerRef = principal.subject;
    const products = Array.isArray(b.products) ? b.products : [];
    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST" });
    }
    if (products.length > 2e3) {
      return res.status(413).json({ ok: false, error: "CATALOG_TOO_LARGE" });
    }
    const desiredProductRefs = new Set(
      products.map((p) => str(p?.id, 96)).filter((ref) => !!ref)
    );
    try {
      const out = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId;
        let merchantId;
        let outletId;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          outletId = freeScope.outlet_id;
          await assertTenantWritable(c, tenantId);
        } else {
          const tenantExternalRef = ownerRef || `tenant_${businessId}`;
          const t = await c.query(
            `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
            [storeName, tenantExternalRef, ownerRef]
          );
          tenantId = t.rows[0].id;
          await assertTenantWritable(c, tenantId);
          const m = await c.query(
            `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
            [tenantId, storeName, sector, businessId]
          );
          merchantId = m.rows[0].id;
          const productLimit = await productLimitForTenant(c, tenantId);
          if (productLimit >= 0 && desiredProductRefs.size > productLimit) {
            throw new ProductLimitError("PRODUCT_LIMIT_EXCEEDED");
          }
          const outq = await c.query(
            `SELECT id FROM internal.outlets WHERE merchant_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [merchantId]
          );
          if (outq.rows.length) {
            outletId = outq.rows[0].id;
          } else {
            await assertOutletCapacity(c, tenantId);
            const outins = await c.query(
              `INSERT INTO internal.outlets (id, tenant_id, merchant_id, name)
                 VALUES (uuidv7(), $1, $2, $3) RETURNING id`,
              [tenantId, merchantId, `${storeName} (Cabang Utama)`]
            );
            outletId = outins.rows[0].id;
          }
        }
        const seen = [];
        assertFreeScope(await freePlanState(c, tenantId), sector, [...desiredProductRefs]);
        if (freeScope) {
          const misplaced = await c.query(
            `SELECT id FROM pos.products WHERE tenant_id=$1
            AND external_ref=ANY($2::text[]) AND outlet_id IS DISTINCT FROM $3::uuid LIMIT 1`,
            [tenantId, [...desiredProductRefs], outletId]
          );
          if (misplaced.rows.length) throw new FreePlanAccessError("FREE_PRODUCT_BRANCH_MISMATCH");
        }
        let upserted = 0;
        for (const p of products) {
          const ref = str(p.id, 96);
          const name = str(p.name, 100);
          if (!ref || !name) continue;
          seen.push(ref);
          await c.query(
            `INSERT INTO pos.products
               (id, tenant_id, merchant_id, outlet_id, name, sku, price, cost_price, is_available,
                business_sector, business_id, category_name, description,
                unit, external_ref, catalog_synced_at)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14, CURRENT_TIMESTAMP)
             ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET
               name              = EXCLUDED.name,
               sku               = EXCLUDED.sku,
               price             = EXCLUDED.price,
               cost_price        = EXCLUDED.cost_price,
               is_available      = EXCLUDED.is_available,
               category_name     = EXCLUDED.category_name,
               description       = EXCLUDED.description,
               unit              = EXCLUDED.unit,
               catalog_synced_at = CURRENT_TIMESTAMP`,
            [
              tenantId,
              merchantId,
              outletId,
              name,
              str(p.sku, 50) ?? ref,
              num(p.price),
              num(p.costPrice),
              p.isAvailable !== false,
              sector,
              businessId,
              str(p.categoryName, 100),
              str(p.description, 300),
              str(p.unit, 20),
              ref
            ]
          );
          upserted++;
        }
        let retired = 0;
        if (!freeScope && seen.length > 0) {
          const r = await c.query(
            `UPDATE pos.products
                SET is_available = FALSE
              WHERE tenant_id = $1
                AND external_ref IS NOT NULL
                AND NOT (external_ref = ANY($2::text[]))
                AND is_available
              RETURNING id`,
            [tenantId, seen]
          );
          retired = r.rows.length;
        }
        return { tenantId, upserted, retired };
      });
      res.json({ ok: true, ...out });
    } catch (err) {
      if (err instanceof FreePlanAccessError) return res.status(403).json({ ok: false, error: err.message });
      if (err instanceof BillingError) return res.status(err.status).json({ ok: false, error: err.message });
      console.error("[sync] katalog gagal:", err.message);
      if (err instanceof SyncAccessError) return res.status(403).json({ ok: false, error: "FORBIDDEN" });
      if (err instanceof ProductLimitError) return res.status(409).json({ ok: false, error: "PRODUCT_LIMIT_EXCEEDED" });
      res.status(500).json({ ok: false, error: "CATALOG_SYNC_FAILED" });
    }
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
    const t = await db.query(`SELECT id, tenant_id, business_sector FROM internal.merchants WHERE external_ref = $1`, [
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
      `SELECT t.id, t.name, t.business_sector,
              COUNT(x.id)::int              AS synced_transactions,
              COALESCE(SUM(x.total_amount), 0) AS synced_revenue,
              MAX(x.created_at)             AS last_transaction_at
         FROM internal.tenants t
         LEFT JOIN pos.transactions x ON x.tenant_id = t.id
        WHERE t.external_ref = $1
        GROUP BY t.id, t.name, t.business_sector`,
      [businessId]
    );
    if (!rows.length) return res.json({ ok: true, synced: false });
    res.json({ ok: true, synced: true, ...rows[0] });
  });
  app.post("/api/v1/sync/customers", async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? "Tanpa Nama";
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const ownerRef = principal.subject;
    const customers = Array.isArray(body.customers) ? body.customers : [];
    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        detail: "businessId dan sector wajib"
      });
    }
    try {
      const result = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId;
        let merchantId;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          await assertTenantWritable(c, tenantId);
        } else {
          const tenantExternalRef = ownerRef || `tenant_${businessId}`;
          const t = await c.query(
            `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
             VALUES (uuidv7(), $1, $2, $3)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [storeName, tenantExternalRef, ownerRef]
          );
          tenantId = t.rows[0].id;
          await assertTenantWritable(c, tenantId);
          const m = await c.query(
            `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
             VALUES (uuidv7(), $1, $2, $3, $4)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [tenantId, storeName, sector, businessId]
          );
          merchantId = m.rows[0].id;
        }
        let upserted = 0;
        for (const cust of customers) {
          const extRef = str(cust.id || cust.external_ref, 96);
          const name = str(cust.name, 120);
          if (!extRef || !name) continue;
          await c.query(
            `INSERT INTO pos.customers (
               tenant_id, merchant_id, external_ref, name, phone, email, address, notes,
               total_spent, orders_count, last_visit_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
             ON CONFLICT (tenant_id, external_ref)
               DO UPDATE SET
                 name = EXCLUDED.name,
                 phone = COALESCE(EXCLUDED.phone, pos.customers.phone),
                 email = COALESCE(EXCLUDED.email, pos.customers.email),
                 address = COALESCE(EXCLUDED.address, pos.customers.address),
                 notes = COALESCE(EXCLUDED.notes, pos.customers.notes),
                 total_spent = EXCLUDED.total_spent,
                 orders_count = EXCLUDED.orders_count,
                 last_visit_at = COALESCE(EXCLUDED.last_visit_at, pos.customers.last_visit_at),
                 updated_at = NOW()`,
            [
              tenantId,
              merchantId,
              extRef,
              name,
              str(cust.phone, 32),
              str(cust.email, 120),
              str(cust.address, 255),
              str(cust.notes, 500),
              num(cust.totalSpent || cust.total_spent),
              num(cust.ordersCount || cust.orders_count),
              cust.lastVisitAt ? new Date(cust.lastVisitAt) : null
            ]
          );
          upserted++;
        }
        return { ok: true, upserted };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || "CUSTOMER_SYNC_FAILED" });
    }
  });
}

// src/server/syncHandler.ts
var allowedPaths = /* @__PURE__ */ new Set(["/api/v1/sync/catalog", "/api/v1/sync/transactions", "/api/v1/sync/activity", "/api/v1/sync/customers"]);
function createSyncHandler(authenticate = authenticateBearer, connect = () => connectDb({ schema: "pos", max: 2 })) {
  let runtime;
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const path = String(req.url || "").split("?")[0].replace(/\/+$/, "");
    if (!allowedPaths.has(path)) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    const principal = await authenticate(req);
    if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "AUTHENTICATION_REQUIRED" });
    for (const key of ["x-auth-sub", "x-auth-email", "x-internal-user", "x-newhope-gateway-token"]) delete req.headers[key];
    req.headers["x-auth-sub"] = principal.subject;
    if (principal.email) req.headers["x-auth-email"] = principal.email;
    try {
      runtime ??= connect().then((db) => {
        const app = express();
        const parseJson = express.json({ limit: "10mb" });
        app.use((req2, res2, next) => req2.body !== void 0 ? next() : parseJson(req2, res2, next));
        registerSyncRoutes(app, db);
        app.use((_req, res2) => res2.status(404).json({ ok: false, error: "NOT_FOUND" }));
        app.use((error, _req, res2, _next) => res2.status(error.type === "entity.too.large" ? 413 : 400).json({ ok: false, error: "INVALID_SYNC_REQUEST" }));
        return app;
      }).catch((error) => {
        runtime = void 0;
        throw error;
      });
      (await runtime)(req, res);
    } catch {
      return res.status(503).json({ ok: false, error: "SYNC_UNAVAILABLE" });
    }
  };
}
var syncHandler_default = createSyncHandler();
export {
  createSyncHandler,
  syncHandler_default as default
};
