// api/_runtime.ts
import express from "express";

// services/shared/db.ts
import fs from "node:fs";
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
  return {
    // Each warm function owns a pool; keep the per-instance budget small.
    max: vercel === "1" ? Math.min(Math.max(1, max), 2) : max,
    idleTimeoutMillis: vercel === "1" ? 5e3 : 3e4,
    connectionTimeoutMillis: 1e4
  };
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
  await withRetry(async () => {
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
  const failure = new Error(`Database tidak bisa dihubungi setelah ${attempts} percobaan`);
  failure.cause = lastErr;
  throw failure;
}

// services/billing/routes.ts
import { randomUUID as randomUUID2 } from "node:crypto";

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
    return LOCAL_BYPASS() ? { subject: "local-development", isEmailVerified: true } : null;
  }
  const { url, apiKey } = supabaseConfig();
  if (!url || !apiKey) {
    return LOCAL_BYPASS() ? { subject: "local-development", isEmailVerified: true } : null;
  }
  try {
    const upstream = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${match[1]}`, apikey: apiKey },
      signal: AbortSignal.timeout(5e3)
    });
    if (!upstream.ok) return null;
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
  const subject = firstHeader(req.headers["x-auth-sub"]);
  const isEmailVerified = firstHeader(req.headers["x-auth-email-verified"]) === "true";
  if (subject) return { subject, email: firstHeader(req.headers["x-auth-email"]) || void 0, isEmailVerified };
  return LOCAL_BYPASS() ? { subject: "local-development", isEmailVerified: true } : null;
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
async function tenantForPrincipal(db, principal) {
  const { rows } = await db.query(
    `SELECT id FROM internal.tenants WHERE owner_user_ref = $1 OR external_ref = $1
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
import { randomUUID } from "node:crypto";

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
    FROM internal.tenants WHERE id=$2 ON CONFLICT(tenant_id) DO NOTHING`, [randomUUID(), tenantId, TRIAL_PLAN_ID]);
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
  const tenant = await db.query("SELECT is_active FROM internal.tenants WHERE id=$1", [tenantId]);
  if (!tenant.rows[0]?.is_active) Object.assign(access, { accessMode: "RESTRICTED", status: "EXPIRED" });
  if (access.status !== s.status && access.status !== "FREE") {
    await db.query("UPDATE billing.subscriptions SET status=$1, updated_at=now() WHERE id=$2", [access.status, s.id]).catch(() => {
    });
  }
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
  return (process.env.DOKU_CLIENT_ID || process.env.DOKU_SANDBOX_CLIENT_ID || "").replace(/["']/g, "").trim();
}
function getDokuSecretKey() {
  return (process.env.DOKU_SECRET_KEY || process.env.DOKU_SANDBOX_SECRET_KEY || "").replace(/["']/g, "").trim();
}
function getDokuApiUrl() {
  const raw = (process.env.DOKU_API_URL || "https://api.doku.com").replace(/["']/g, "").trim().replace(/\/+$/, "");
  if (raw.includes("sandbox")) {
    return "https://api-sandbox.doku.com";
  }
  return "https://api.doku.com";
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
  const requestId = crypto.randomUUID();
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

// services/billing/routes.ts
function registerBillingRoutes(app, db, viaGateway = false, checkoutProvider = createDokuCheckout) {
  const run = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (req.path === DOKU_NOTIFICATION_PATH && err instanceof BillingError) console.warn("[doku] NOTIFICATION_REJECTED", err.message);
      if (!(err instanceof BillingError)) {
        const diagnostic = err;
        console.error("[billing] INTERNAL_OPERATION_FAILED", { route: req.path, code: diagnostic.code, constraint: diagnostic.constraint, table: diagnostic.table, column: diagnostic.column });
      }
      res.status(err instanceof BillingError ? err.status : 500).json({ ok: false, error: err instanceof BillingError ? err.message : "BILLING_UNAVAILABLE" });
    }
  };
  const tenant = async (req) => {
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
      const merchant = (await c.query("SELECT id FROM internal.merchants WHERE tenant_id=$1 AND business_sector=$2 ORDER BY created_at LIMIT 1", [tenantId, sector])).rows[0];
      if (!merchant) throw new BillingError(409, "BUSINESS_SETUP_REQUIRED");
      const id = /^[0-9a-f-]{36}$/i.test(b.id || "") ? b.id : randomUUID2();
      const existing = (await c.query("SELECT * FROM internal.outlets WHERE id=$1", [id])).rows[0];
      if (existing && (existing.tenant_id !== tenantId || existing.merchant_id !== merchant.id)) throw new BillingError(403, "OUTLET_NOT_OWNED");
      if (b.isActive !== false) await assertOutletCapacity(c, tenantId, id);
      const { rows } = await c.query(
        `INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,address,latitude,longitude,radius_meters,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,
        latitude=excluded.latitude,longitude=excluded.longitude,radius_meters=excluded.radius_meters,is_active=excluded.is_active RETURNING *`,
        [id, tenantId, merchant.id, String(b.name).trim(), String(b.address ?? existing?.address ?? ""), Number(b.latitude ?? existing?.latitude) || 0, Number(b.longitude ?? existing?.longitude) || 0, Math.max(1, Number(b.allowedRadiusMeters ?? existing?.radius_meters) || 100), b.isActive !== false]
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
    const tenantId = await tenant(req);
    const key = String(req.body?.requestKey || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new BillingError(400, "CHECKOUT_REQUEST_KEY_REQUIRED");
    if (!isDokuConfigured()) throw new BillingError(503, "PAYMENT_GATEWAY_NOT_CONFIGURED");
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
    const id = randomUUID2(), invoiceNumber = `NH-${id}`;
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
          let allowedChannels;
          try {
            allowedChannels = getDokuAllowedChannels();
          } catch {
            allowedChannels = ["VIRTUAL_ACCOUNT_BCA"];
          }
          const rawChannel = inquiry.channelId || inv.quote?.allowedChannels?.[0] || "VIRTUAL_ACCOUNT_BCA";
          const channel = allowedChannels.includes(rawChannel) ? rawChannel : allowedChannels[0];
          await reconcilePayment(db, {
            eventKey: `inquiry-${inv.invoice_number}-${Date.now()}`,
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
          return res.json({ ok: true, paid: true, reconciled: true, status: statusData.subscription.status, subscription: statusData.subscription });
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

// src/server/adminRoutes.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// src/server/adminSecurity.ts
function adminSecurityError(principal, method, now = Date.now()) {
  if (principal.subject !== "verified-owner" && principal.subject !== "admin-sub") {
    return null;
  }
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

// src/server/subscriptionDetail.ts
async function subscriptionDetail(db, tenantId) {
  return db.tx(async (c) => {
    await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tenant = (await c.query("SELECT id,name,created_at,is_active FROM internal.tenants WHERE id=$1", [tenantId])).rows[0];
    if (!tenant) return null;
    const stored = (await c.query("SELECT * FROM billing.subscriptions WHERE tenant_id=$1", [tenantId])).rows[0];
    const start = new Date(tenant.created_at).toISOString();
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
    const plan = SAAS_PLANS.find((p) => p.id === s.plan_id);
    const access = subscriptionAccess({
      status: tenant.is_active ? s.status : "EXPIRED",
      currentPeriodEnd: new Date(s.current_period_end).toISOString(),
      gracePeriodEnd: s.grace_period_end ? new Date(s.grace_period_end).toISOString() : void 0
    });
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
    const cap = plan ? plan.maxOutlets + Number(s.extra_outlets || 0) : null;
    return {
      tenant,
      retrievedAt: (/* @__PURE__ */ new Date()).toISOString(),
      derivedTrial: !stored,
      activity,
      subscription: {
        planId: s.plan_id,
        planName: plan?.name || s.plan_id,
        billingCycle: s.billing_cycle || null,
        periodStart: s.current_period_start,
        periodEnd: s.current_period_end,
        graceEnd: s.grace_period_end,
        trialStart: s.trial_started_at,
        trialEnd: s.trial_ends_at,
        recurringAmount: s.recurring_amount ?? null,
        ...access
      },
      capacity: { included: plan?.maxOutlets ?? null, extra: Number(s.extra_outlets || 0), used: usage, max: cap, remaining: cap === null ? null : Math.max(0, cap - usage) },
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
    const { rows } = await db.query(`SELECT t.id,t.name,t.created_at,t.is_active,s.id AS subscription_id,s.plan_id,
      s.status,s.current_period_start,s.current_period_end,s.grace_period_end,s.billing_cycle,s.extra_outlets,s.trial_started_at,s.trial_ends_at,
      (SELECT count(*)::int FROM internal.outlets o WHERE o.tenant_id=t.id AND o.is_active) AS outlet_count,
      (SELECT min(r.created_at) FROM contract.merchant_revenue r WHERE r.tenant_id=t.id) AS first_transaction_at,
      (SELECT max(r.created_at) FROM contract.merchant_revenue r WHERE r.tenant_id=t.id) AS last_transaction_at,
      EXISTS(SELECT 1 FROM billing.invoices i WHERE i.tenant_id=t.id AND i.payment_status='PAID' AND i.reconciliation_status='APPLIED') AS converted
      FROM internal.tenants t LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id ORDER BY t.created_at DESC LIMIT 10001`);
    if (rows.length > 1e4) return res.status(503).json({ ok: false, error: "SUBSCRIPTION_REPORT_REQUIRES_PAGINATED_AGGREGATION" });
    const all = rows.map((r) => {
      const end = r.current_period_end || new Date(Date.parse(r.created_at) + TRIAL_DAYS * DAY_MS);
      const access = subscriptionAccess({ status: r.is_active ? r.status || "TRIAL" : "EXPIRED", currentPeriodEnd: new Date(end).toISOString(), gracePeriodEnd: r.grace_period_end ? new Date(r.grace_period_end).toISOString() : void 0 });
      const day = Math.max(1, Math.floor((Date.now() - Date.parse(r.trial_started_at || r.created_at)) / DAY_MS) + 1);
      return {
        ...r,
        status: access.status,
        accessMode: access.accessMode,
        daysLeft: access.daysLeft,
        trialDay: day,
        lifecycleStage: r.converted ? "CONVERTED" : lifecycleStage(day),
        maxOutlets: (SAAS_PLANS.find((p) => p.id === r.plan_id)?.maxOutlets ?? 2) + Number(r.extra_outlets || 0)
      };
    });
    const eligible = all.filter((r) => r.trial_started_at || r.plan_id === TRIAL_PLAN_ID || !r.subscription_id);
    const converted = eligible.filter((r) => r.converted).length;
    const summary = {
      active: all.filter((r) => r.status === "ACTIVE").length,
      trial: all.filter((r) => r.status === "TRIAL").length,
      expired: all.filter((r) => ["EXPIRED", "PAST_DUE"].includes(r.status)).length,
      trialEntrants: eligible.length,
      activated: eligible.filter((r) => r.first_transaction_at).length,
      converted,
      conversionRate: eligible.length ? Math.round(converted / eligible.length * 1e3) / 10 : 0
    };
    const search = String(req.query.search || "").toLowerCase();
    const filtered = all.filter((r) => (!search || r.name.toLowerCase().includes(search)) && (!req.query.status || r.status === req.query.status));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25)), offset = Math.max(0, Number(req.query.offset) || 0);
    res.json({
      ok: true,
      rows: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
      summary,
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
        const tenant = await c.query("SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE", [req.params.tenantId]);
        if (!tenant.rowCount) throw new BillingError(404, "TENANT_NOT_FOUND");
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
function registerAdminRoutes(app, getDb, authenticate = authenticateBearer) {
  app.use("/api/admin", (req, res, next) => {
    const forwarded = String(req.headers["x-request-id"] || "");
    const trusted = process.env.INTERNAL_GATEWAY_TOKEN && req.headers["x-newhope-gateway-token"] === process.env.INTERNAL_GATEWAY_TOKEN;
    req.auditRequestId = trusted && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forwarded) ? forwarded : randomUUID3();
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
          if (!principal.isEmailVerified && process.env.NODE_ENV === "production") {
            return res.status(403).json({
              ok: false,
              error: "EMAIL_VERIFICATION_REQUIRED",
              detail: "Email akun SSO harus diverifikasi terlebih dahulu sebelum dapat ditautkan ke akun administrator."
            });
          }
          const byEmail = await db.query(
            "SELECT id,email,full_name,role FROM internal.internal_users WHERE LOWER(email)=LOWER($1) AND is_active",
            [principal.email]
          );
          if (byEmail.rows[0] && isInternalRole(byEmail.rows[0].role)) {
            await db.query(
              "UPDATE internal.internal_users SET sso_subject=$1, updated_at=NOW() WHERE id=$2",
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
                   ON CONFLICT (email) DO UPDATE SET sso_subject=$4, role=EXCLUDED.role, is_active=true
                   RETURNING id, email, full_name, role`,
                  [principal.email, fromPublic.rows[0].full_name || "Administrator", fromPublic.rows[0].role, principal.subject]
                );
                rows = inserted.rows;
              }
            } catch {
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
        req.mfaRequired = (principal.subject === "verified-owner" || principal.subject === "admin-sub") && principal.aal !== "aal2";
        const securityError = adminSecurityError(principal, req.method);
        if (!enrollmentOnly && securityError) {
          await recordAccess(db, who, securityError, req.path, null, null, req.ip || null, req);
          return res.status(403).json({ ok: false, error: securityError, requestId: req.auditRequestId });
        }
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const value of [req.params.merchantId, req.params.tenantId, req.query.merchantId]) {
          if (value !== void 0 && (typeof value !== "string" || !uuid.test(value))) return res.status(400).json({ ok: false, error: "INVALID_ID" });
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
        req.environment = "PROVIDER_BO";
        next();
      } catch (err) {
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
      const [sectors2, totals, daily] = await Promise.all([
        sectorSummary(db),
        platformTotals(db),
        dailyRevenue(db, 30)
      ]);
      res.json({ ok: true, sectors: sectors2, totals, daily, sectorLabels: SECTOR_LABEL });
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
                        c.name AS category_name
                   FROM pos.products p
                   LEFT JOIN pos.categories c ON c.id = p.category_id
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
      void db.query(`UPDATE public.blog_posts SET view_count = view_count + 1 WHERE id = $1`, [rows[0].id]).catch(() => {
      });
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );
  app.post(
    "/api/v1/blog/:id/like",
    wrap(async (req, res, db) => {
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
      const id = b.id ? String(b.id) : "blog-" + randomUUID3();
      const slug = String(b.slug || "").trim();
      const title = String(b.title || "").trim();
      if (!slug || !title) return res.status(400).json({ ok: false, error: "TITLE_AND_SLUG_REQUIRED" });
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
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );
  app.put(
    "/api/admin/blog/:id",
    guard("VIEW_SECTOR_ANALYTICS"),
    wrap(async (req, res, db) => {
      const id = String(req.params.id);
      const b = req.body || {};
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
                seo = COALESCE($14::jsonb, seo),
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
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );
  app.delete(
    "/api/admin/blog/:id",
    guard("VIEW_SECTOR_ANALYTICS"),
    wrap(async (req, res, db) => {
      const id = String(req.params.id);
      const { rows } = await db.query(`DELETE FROM public.blog_posts WHERE id = $1 RETURNING id`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "POST_NOT_FOUND" });
      res.json({ ok: true, id: rows[0].id });
    })
  );
}

// services/pos/sync.ts
import { randomBytes } from "node:crypto";

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
function timestamp(value) {
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
    WHERE o.id=$1 AND o.tenant_id=$2 AND m.business_sector=$3`, [outletId, tenantId, sector])).rows[0];
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
  const occurredAt = timestamp(command.occurredAt || (/* @__PURE__ */ new Date()).toISOString());
  const normalized = { ...command, occurredAt, reason: command.reason.trim(), items: [...command.items].sort((a, b) => a.clientItemId.localeCompare(b.clientItemId)) };
  const txn = (await db.query(
    `SELECT * FROM pos.transactions WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE`,
    [transactionId, scope.tenantId, scope.merchantId, scope.outletId]
  )).rows[0];
  if (!txn) throw new FinanceError(404, "TRANSACTION_NOT_FOUND");
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
  const route = (path, run) => app.post(path, async (req, res) => {
    try {
      const result = await db.tx(async (c) => run(c, await scopeFor(c, req), req));
      res.json({ ok: true, ...result });
    } catch (error) {
      const known = error instanceof FinanceError || error instanceof BillingError;
      if (!known && !(error instanceof FreePlanAccessError)) {
        const diagnostic = error;
        console.error("[finance] write failed", { route: path, code: diagnostic.code, constraint: diagnostic.constraint, column: diagnostic.column });
      }
      res.status(known ? error.status : error instanceof FreePlanAccessError ? 403 : 500).json({ ok: false, error: known || error instanceof FreePlanAccessError ? error.message : "FINANCIAL_WRITE_FAILED" });
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
      res.json({ ok: true, ...result });
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
    const b = req.body;
    if (!ID.test(b.clientEventId || "") || !["CASH_IN", "CASH_OUT", "OPENING"].includes(b.type) || typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount < 0 || b.amount > 9999999999 || typeof b.description !== "string" || b.description.length > 500 || typeof b.category !== "string" || b.category.length > 64)
      throw new FinanceError(400, "INVALID_CASH_EVENT");
    const amount = money(b.amount) * (b.type === "CASH_OUT" ? -1 : 1), occurredAt = timestamp(b.occurredAt);
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
    const row = (await db.query(`INSERT INTO pos.payments(tenant_id,merchant_id,outlet_id,transaction_id,client_payment_id,payment_method,payment_status,amount,gateway_provider,paid_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'PAID',$7,'MANUAL_CASH',$8,$8) RETURNING id`, [scope.tenantId, scope.merchantId, scope.outletId, transactionId, tender.clientPaymentId, tender.method, tender.amount, tender.createdAt])).rows[0];
    if (tender.method === "CASH") await db.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,actor_ref,note,occurred_at)
      VALUES($1,$2,$3,$4,'SALE',$5,$6,$7,'Pembayaran tunai split',$8)`, [scope.tenantId, scope.merchantId, scope.outletId, "payment:" + row.id, tender.amount, transactionId, scope.actorRef, tender.createdAt]);
  }
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
function operationalScopeIssue(owner, sector, kind, id, value) {
  if (!operationalKinds.has(kind) || kind === "users" || kind === "staff_members") return null;
  const row = value && typeof value === "object" ? value : {};
  for (const field of ["businessSector", "sector"]) {
    if (typeof row[field] === "string" && sectors.has(row[field]) && row[field] !== sector) return `WRONG_SECTOR:${row[field]}`;
  }
  if (typeof row.businessId === "string" && /_(FNB|LAUNDRY|RETAIL|CARWASH|BARBERSHOP)$/.test(row.businessId) && row.businessId !== `${owner}_${sector}`)
    return "WRONG_BUSINESS:" + row.businessId;
  const ref = kind === "products" ? id : typeof row.productId === "string" ? row.productId : "";
  const match = /^prod-(fnb|ld|rt|cw|bb)-\d+$/.exec(ref);
  if (match && presets[match[1]] !== sector) return `WRONG_SECTOR:${presets[match[1]]}`;
  return null;
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
async function scopeFor2(db, subject, sector) {
  const tenantId = await tenantForPrincipal(db, { subject });
  if (!tenantId) return null;
  const { rows } = await db.query(
    `SELECT m.id AS merchant_id,m.name AS business_name,t.is_active
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE t.id=$1 AND t.owner_user_ref=$2 AND m.business_sector=$3
    ORDER BY (m.external_ref=$4) DESC NULLS LAST, m.created_at, m.id LIMIT 1`,
    [tenantId, subject, sector, `${subject}_${sector}`]
  );
  if (!rows.length || !rows[0].is_active) return null;
  return { tenantId, merchantId: rows[0].merchant_id, businessName: rows[0].business_name };
}
function registerSharedStateRoutes(app, db) {
  app.get("/api/v1/sync/state", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const sector = String(req.query.sector || "");
    if (!SECTOR_SET.has(sector)) return res.status(400).json({ ok: false, error: "INVALID_SECTOR" });
    try {
      const scope = await scopeFor2(db, principal.subject, sector);
      if (!scope) return res.json({ ok: true, ready: false, records: [] });
      const { rows } = await db.tx(async (c) => {
        await c.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",
          [scope.tenantId, scope.merchantId]
        );
        return c.query(`SELECT scope,kind,record_id,value,revision,deleted,updated_at,recovery_value,quarantine_reason
          FROM pos.shared_state_records WHERE tenant_id=$1 AND
          ((scope='GLOBAL' AND merchant_id IS NULL) OR (scope=$2 AND merchant_id=$3))
          ORDER BY scope,kind,record_id LIMIT 10001`, [scope.tenantId, sector, scope.merchantId]);
      });
      return res.json({ ok: true, ready: true, business: { name: scope.businessName, sector }, truncated: rows.length > 1e4, records: rows.slice(0, 1e4).map((r) => ({
        scope: r.scope,
        kind: r.kind,
        recordId: r.record_id,
        value: r.value,
        revision: Number(r.revision),
        deleted: r.deleted,
        updatedAt: r.updated_at,
        ...r.recovery_value ? { recoveryValue: r.recovery_value, quarantineReason: r.quarantine_reason } : {}
      })) });
    } catch {
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
      const scope = await scopeFor2(db, principal.subject, sector);
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
          const issue = op.owner && op.owner !== principal.subject ? "WRONG_OWNER" : op.sector && op.sector !== sector ? "WRONG_SECTOR" : operationalScopeIssue(principal.subject, sector, op.kind, op.recordId, op.value);
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
            const docScope = GLOBAL_KINDS.has(op.kind) ? "GLOBAL" : sector;
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
            if (replayed) {
              result.push({ kind: op.kind, recordId: op.recordId, revision: Number(r.rows[0].revision) });
              await c.exec("RELEASE SAVEPOINT operational_record");
              continue;
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
              ON CONFLICT(tenant_id,external_ref) DO UPDATE SET
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
                    `${principal.subject}_${sector}`,
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
            businessId: `${principal.subject}_${sector}`,
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
      if (error instanceof StateConflict) return res.status(409).json({ ok: false, error: "STATE_CONFLICT", kind: error.kind, recordId: error.recordId });
      if (error instanceof FreePlanAccessError) return res.status(403).json({ ok: false, error: error.message });
      if (error instanceof BillingError) return res.status(error.status).json({ ok: false, error: error.message });
      return res.status(503).json({ ok: false, error: "STATE_UNAVAILABLE" });
    }
  });
}

// services/pos/reports.ts
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DATE = /^\d{4}-\d{2}-\d{2}$/;
var PAYMENT_METHODS = /* @__PURE__ */ new Set(["CASH", "QRIS", "QRIS_DYNAMIC", "QRIS_STATIC", "DEBIT", "CREDIT", "DEBIT_CARD", "CREDIT_CARD", "CARD", "TRANSFER", "E_WALLET", "EWALLET", "OTHER", "SHOPEEPAY", "GOPAY", "OVO", "DANA", "SPLIT"]);
var numeric = (value) => Number(value ?? 0);
var money2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
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
  const date = stringQuery(value, name);
  if (!date) return null;
  if (!DATE.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || (/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).toISOString().slice(0, 10) !== date) {
    throw new ReportRequestError(400, `INVALID_${name}`);
  }
  return date;
}
function parseReportFilter(query) {
  const outletId = stringQuery(query.outletId, "OUTLET_ID");
  if (!outletId || !UUID2.test(outletId)) throw new ReportRequestError(400, "INVALID_OUTLET_ID");
  const merchantId = stringQuery(query.merchantId, "MERCHANT_ID");
  const tenantId = stringQuery(query.tenantId, "TENANT_ID");
  if (merchantId && !UUID2.test(merchantId) || tenantId && !UUID2.test(tenantId)) throw new ReportRequestError(400, "INVALID_SCOPE");
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
    search
  };
}
async function scopeFor3(db, subject, filter) {
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
  const grossProfit = money2(totalNetRevenue - totalTax - totalCOGS);
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
    netProfitMargin: totalNetRevenue ? money2(grossProfit / totalNetRevenue * 100) : 0,
    avgOrderValue: totalOrders ? money2(totalNetRevenue / totalOrders) : 0
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
  return Object.fromEntries(rows.map((row) => [row.payment_method, money2(numeric(row.amount))]));
}
function localDate(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(/* @__PURE__ */ new Date());
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
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
    const scope = await scopeFor3(c, subject, filter);
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
    const daily = await c.query(`${revenueCTE} SELECT to_char(created_at AT TIME ZONE $6,'YYYY-MM-DD') AS date,
      sum(total_amount) AS revenue,SUM(total_amount-net_tax_amount-cogs_amount) AS profit,count(*)::int AS orders FROM revenue GROUP BY 1 ORDER BY 1`, params);
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
    const sortedMethods = Object.entries(breakdown).map(([key, total]) => ({ key, name: key, count: numeric(counts.rows.find((row) => row.payment_method === key)?.count), total, percentage: financialSummary.totalNetRevenue ? money2(total / financialSummary.totalNetRevenue * 100) : 0 })).sort((a, b) => b.total - a.total);
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
        cashPercent: financialSummary.totalNetRevenue ? money2(cashSales / financialSummary.totalNetRevenue * 100) : 0,
        cashlessSales: money2(financialSummary.totalNetRevenue - cashSales),
        cashlessCount: financialSummary.totalOrders - cashCount,
        cashlessPercent: financialSummary.totalNetRevenue ? money2((financialSummary.totalNetRevenue - cashSales) / financialSummary.totalNetRevenue * 100) : 0,
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
        todayEWalletSales: money2(todayFinancial.totalNetRevenue - todayCashSales - todayQrisSales - todayCardSales),
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
    if (!UUID2.test(cursor.id) || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return { createdAt: new Date(cursor.createdAt).toISOString(), id: cursor.id };
  } catch {
    throw new ReportRequestError(400, "INVALID_CURSOR");
  }
}
async function serverTransactions(db, subject, filter, cursor, limit = 100) {
  return db.tx(async (c) => {
    await c.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await scopeFor3(c, subject, filter);
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
    const items = page.length ? (await c.query(`SELECT i.*,COALESCE(i.quantity_exact,i.quantity) AS quantity,p.external_ref AS product_ref,
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
    const last = page[page.length - 1];
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
var outletRef = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
function registerSyncRoutes(app, db) {
  registerSharedStateRoutes(app, db);
  registerReportRoutes(app, db);
  registerFinanceRoutes(app, db);
  app.post("/api/v1/sync/business", async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const sector = str(req.body?.sector, 16);
    const storeName = str(req.body?.storeName, 100);
    if (!sector || !SECTOR_SET2.has(sector) || !storeName) return res.status(400).json({ ok: false, error: "INVALID_BUSINESS" });
    const businessId = `${principal.subject}_${sector}`;
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
        const existing = (await c.query("SELECT id FROM internal.merchants WHERE tenant_id=$1 AND business_sector=$2 ORDER BY created_at LIMIT 1", [tenantId, sector])).rows[0];
        if (existing) return { tenantId, merchantId: existing.id };
        const created = await c.query(`INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref)
          VALUES(uuidv7(),$1,$2,$3,$4) ON CONFLICT(external_ref) WHERE external_ref IS NOT NULL
          DO UPDATE SET name=EXCLUDED.name WHERE internal.merchants.tenant_id=$1 RETURNING id`, [tenantId, storeName, sector, businessId]);
        if (!created.rows.length) throw new BillingError(409, "BUSINESS_OWNERSHIP_CONFLICT");
        return { tenantId, merchantId: created.rows[0].id };
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(error instanceof BillingError ? error.status : 500).json({ ok: false, error: error instanceof BillingError ? error.message : "BUSINESS_SETUP_FAILED" });
    }
  });
  app.get("/api/v1/sync/receipt-logo", async (req, res) => {
    const principal = trustedPrincipal(req);
    const businessId = str(req.query.businessId, 96);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    if (!businessId) return res.status(400).json({ ok: false, error: "BUSINESS_ID_REQUIRED" });
    if (!await canAccessBusiness(db, principal, businessId)) return res.status(403).json({ ok: false, error: "BUSINESS_NOT_OWNED" });
    const { rows } = await db.query("SELECT logo_url FROM internal.merchants WHERE external_ref = $1", [businessId]);
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
      "UPDATE internal.merchants SET logo_url = $1, updated_at = now() WHERE external_ref = $2 RETURNING id",
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
    if (!txns.length || txns.some((x) => !x || !str(x.clientTxnId, 64) || !Array.isArray(x.items) || !x.items.length || !Number.isFinite(x.subtotal) || !Number.isFinite(x.totalAmount) || x.subtotal < 0 || x.totalAmount < 0 || Math.abs(x.totalAmount - (x.subtotal - (x.discountAmount || 0) + (x.taxAmount || 0) + (x.serviceChargeAmount || 0))) > 0.02 || x.items.some((i) => !i || typeof i.productName !== "string" || !i.productName.trim() || !Number.isFinite(i.unitPrice) || i.unitPrice < 0 || !Number.isFinite(i.quantity) || i.quantity <= 0 || i.quantity > 999999999 || Math.abs(i.quantity * 1e3 - Math.round(i.quantity * 1e3)) > 1e-3)))
      return res.status(400).json({ ok: false, error: "INVALID_TRANSACTIONS" });
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
          if (ref === ownerRef) {
            await c.query(`INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref)
              SELECT id,name,business_sector,owner_user_ref FROM internal.tenants WHERE id=$1
              ON CONFLICT(id) DO NOTHING`, [tenantId]);
            await c.query(`INSERT INTO pos.users(id,tenant_id,name,username,pin,role,external_ref)
              SELECT u.id,$1,left(u.full_name,100),'owner_'||u.id::text,$3,'ADMIN',u.id::text
              FROM internal.users u WHERE u.id::text=$2 AND u.is_active
              ON CONFLICT(id) DO NOTHING`, [tenantId, ownerRef, randomBytes(32).toString("hex")]);
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
        for (const x of txns) {
          const clientId = str(x.clientTxnId, 64);
          if (!clientId || !Array.isArray(x.items) || !x.items.length) continue;
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
              str(x.invoiceNumber, 32),
              clientId,
              outletRef(x.shiftId),
              str(x.businessDate, 10) ?? (x.createdAt ? x.createdAt.split("T")[0] : null),
              x.completedAt ?? (orderStatus === "COMPLETED" ? x.createdAt : null),
              x.cancelledAt ?? (isVoid ? x.createdAt : null),
              x.voidedAt ?? null,
              x.createdAt ?? null
            ]
          );
          if (!ins.rows.length) {
            duplicates++;
            const original = (await c.query(`SELECT * FROM pos.transactions WHERE tenant_id=$1 AND client_txn_id=$2 FOR UPDATE`, [tenantId, clientId])).rows[0];
            if (!original || original.merchant_id !== merchantId || paymentStatus !== "CANCELLED" && original.outlet_id !== outletId || Number(original.total_amount) !== total || Number(original.subtotal) !== subtotal)
              throw new FinanceError(409, "TRANSACTION_ID_CONFLICT");
            const status = str(x.paymentStatus, 20);
            if (status === "CANCELLED") {
              const upd = await c.query(
                `UPDATE pos.transactions
                    SET order_status = 'VOIDED',
                        voided_at = COALESCE($3::timestamptz, CURRENT_TIMESTAMP)
                  WHERE tenant_id = $1 AND client_txn_id = $2 AND merchant_id = $4
                    AND order_status NOT IN ('VOIDED','CANCELLED')
                RETURNING id`,
                [tenantId, clientId, x.voidedAt ?? x.createdAt ?? null, merchantId]
              );
              if (upd.rows.length) {
                const voidedTxnId = upd.rows[0].id;
                const cashBalance = Number((await c.query("SELECT COALESCE(SUM(amount),0) AS amount FROM pos.cash_ledger WHERE transaction_id=$1 AND tenant_id=$2", [voidedTxnId, tenantId])).rows[0].amount);
                if (cashBalance !== 0) await c.query(
                  `INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,note,occurred_at)
                  VALUES($1,$2,$3,$4,'VOID',$5,$6,'Pembatalan transaksi',$7) ON CONFLICT(tenant_id,client_event_id) DO NOTHING`,
                  [tenantId, merchantId, original.outlet_id, "void:" + voidedTxnId, -cashBalance, voidedTxnId, x.voidedAt || (/* @__PURE__ */ new Date()).toISOString()]
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
            continue;
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
               (id, tenant_id, merchant_id, outlet_id, transaction_id, payment_method, payment_status, amount, gateway_provider)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'MANUAL_CASH')
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
          WHERE m.external_ref = $1 AND m.business_sector=$4 AND (t.owner_user_ref = $2 OR t.external_ref = $2 OR t.external_ref = $3)`,
        [businessId, ownerRef, `tenant_${businessId}`, sector]
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
  app.post("/api/v1/sync/attendance", async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? "Tanpa Nama";
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const ownerRef = principal.subject;
    const attendances = Array.isArray(body.attendances) ? body.attendances : [];
    if (!businessId || !sector || !SECTOR_SET2.has(sector)) {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST", detail: "businessId dan sector wajib" });
    }
    try {
      const result = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId;
        let merchantId;
        let outletId = null;
        if (freeScope) {
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
        for (const att of attendances) {
          const clientAttendanceId = str(att.id, 96);
          const staffId = str(att.staffId, 96);
          const staffName = str(att.staffName, 120);
          const staffRole = str(att.staffRole, 64) || "STAFF";
          const clockInAt = att.clockInTime ? new Date(att.clockInTime) : /* @__PURE__ */ new Date();
          const clockOutAt = att.clockOutTime ? new Date(att.clockOutTime) : null;
          const status = str(att.status, 32) || "CLOCKED_IN";
          if (!clientAttendanceId || !staffId || !staffName) continue;
          await c.query(
            `INSERT INTO pos.staff_attendances (
               tenant_id, merchant_id, outlet_id, client_attendance_id,
               staff_id, staff_name, staff_role, clock_in_at, clock_out_at,
               shift_notes, status, branch_id, branch_name, clock_in_geo, clock_out_geo,
               business_sector, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, NOW())
             ON CONFLICT (tenant_id, client_attendance_id)
               DO UPDATE SET
                 clock_out_at = COALESCE(EXCLUDED.clock_out_at, pos.staff_attendances.clock_out_at),
                 shift_notes = COALESCE(EXCLUDED.shift_notes, pos.staff_attendances.shift_notes),
                 status = EXCLUDED.status,
                 clock_out_geo = COALESCE(EXCLUDED.clock_out_geo, pos.staff_attendances.clock_out_geo),
                 updated_at = NOW()`,
            [
              tenantId,
              merchantId,
              outletId,
              clientAttendanceId,
              staffId,
              staffName,
              staffRole,
              clockInAt,
              clockOutAt,
              str(att.shiftNotes, 500),
              status,
              str(att.branchId, 64),
              str(att.branchName, 100),
              JSON.stringify(att.clockInGeo || null),
              JSON.stringify(att.clockOutGeo || null),
              sector
            ]
          );
          upserted++;
        }
        return { ok: true, upserted };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || "ATTENDANCE_SYNC_FAILED" });
    }
  });
  app.post("/api/v1/sync/payroll", async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? "Tanpa Nama";
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const ownerRef = principal.subject;
    const slips = Array.isArray(body.payrollSlips) ? body.payrollSlips : [];
    if (!businessId || !sector || !SECTOR_SET2.has(sector)) {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST", detail: "businessId dan sector wajib" });
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
        for (const slip of slips) {
          const clientSlipId = str(slip.id, 96);
          const staffId = str(slip.staffId, 96);
          const staffName = str(slip.staffName, 120);
          const staffRole = str(slip.staffRole, 64) || "STAFF";
          const periodMonth = str(slip.periodMonth, 16) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
          const periodStart = slip.periodStart ? new Date(slip.periodStart) : /* @__PURE__ */ new Date();
          const periodEnd = slip.periodEnd ? new Date(slip.periodEnd) : /* @__PURE__ */ new Date();
          if (!clientSlipId || !staffId || !staffName) continue;
          await c.query(
            `INSERT INTO pos.staff_payrolls (
               tenant_id, merchant_id, client_slip_id, staff_id, staff_name, staff_role,
               period_month, period_start, period_end, days_attended,
               base_salary, allowance, individual_commission, team_pool_commission,
               daily_target_bonus, gross_earnings, deductions, net_salary,
               status, paid_at, payment_method, notes, business_sector, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, $23, NOW()
             )
             ON CONFLICT (tenant_id, client_slip_id)
               DO UPDATE SET
                 status = EXCLUDED.status,
                 paid_at = COALESCE(EXCLUDED.paid_at, pos.staff_payrolls.paid_at),
                 payment_method = COALESCE(EXCLUDED.payment_method, pos.staff_payrolls.payment_method),
                 notes = COALESCE(EXCLUDED.notes, pos.staff_payrolls.notes),
                 net_salary = EXCLUDED.net_salary,
                 updated_at = NOW()`,
            [
              tenantId,
              merchantId,
              clientSlipId,
              staffId,
              staffName,
              staffRole,
              periodMonth,
              periodStart,
              periodEnd,
              Number(slip.daysAttended) || 0,
              num(slip.baseSalary),
              num(slip.allowance),
              num(slip.individualCommission),
              num(slip.teamPoolCommission),
              num(slip.dailyTargetBonus),
              num(slip.grossEarnings),
              num(slip.deductions),
              num(slip.netSalary),
              str(slip.status, 32) || "DRAFT",
              slip.paidAt ? new Date(slip.paidAt) : null,
              str(slip.paymentMethod, 64),
              str(slip.notes, 500),
              sector
            ]
          );
          upserted++;
        }
        return { ok: true, upserted };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || "PAYROLL_SYNC_FAILED" });
    }
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

// api/_runtime.ts
var runtime;
async function buildRuntime() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  const db = await connectDb({ schema: "billing", max: 2 });
  await pastikanPaket(db, SAAS_PLANS);
  const app = express();
  app.use(express.json({ limit: "10mb", verify: (req, _res, buf) => {
    req.rawBody = buf;
  } }));
  app.use(async (req, res, next) => {
    try {
      for (const name of ["x-auth-sub", "x-auth-email", "x-internal-user", "x-newhope-gateway-token"]) delete req.headers[name];
      if (!["/api/v1/subscription/plans", "/api/v1/webhooks/doku", "/api/health"].includes(req.path)) {
        const principal = await authenticateBearer(req);
        if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "AUTHENTICATION_REQUIRED" });
        req.headers["x-auth-sub"] = principal.subject;
        if (principal.email) req.headers["x-auth-email"] = principal.email;
      }
      next();
    } catch (err) {
      next(err);
    }
  });
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
async function handleNativeApi(req, res) {
  normalizeVercelUrl(req);
  try {
    runtime ??= buildRuntime().catch((err) => {
      runtime = void 0;
      throw err;
    });
    const app = await runtime;
    app(req, res);
  } catch {
    res.status(503).json({ ok: false, error: "DATABASE_UNAVAILABLE" });
  }
}

// api/_gateway.ts
async function proxyToGateway(req, res) {
  normalizeVercelUrl(req);
  const base = (process.env.GATEWAY_URL || "").replace(/\/$/, "");
  if (base) {
    try {
      if (new URL(base).host === req.headers.host) return void res.status(503).json({ ok: false, error: "GATEWAY_SELF_REFERENCE" });
      const headers = { ...req.headers };
      for (const key of ["host", "connection", "content-length", "transfer-encoding", "x-auth-sub", "x-auth-email", "x-internal-user", "x-newhope-gateway-token"]) delete headers[key];
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

// src/server/adminHandler.ts
async function handler(req, res) {
  normalizeVercelUrl(req);
  return proxyToGateway(req, res);
}
export {
  handler as default
};
