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

// api/_subscription/plans.ts
function sendJson(res, status, data) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-device-id, x-tenant-id");
    res.setHeader("Content-Type", "application/json");
  } catch {
  }
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}
function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 200, {
    ok: true,
    plans: SAAS_PLANS
  });
}

// api/_subscription/free-plan.ts
import { Pool } from "pg";

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
  if (!url || !apiKey) return null;
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

// services/billing/engine.ts
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

// api/_subscription/free-plan.ts
async function ownedSubscription(req, res, selectFree = false) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== (selectFree ? "POST" : "GET")) return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  const principal = await authenticateBearer(req);
  if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "DATABASE_UNAVAILABLE" });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 5e3 });
  let c;
  try {
    c = await pool.connect();
    await c.query("BEGIN");
    const { rows } = await c.query(`SELECT s.*,t.is_active FROM billing.subscriptions s
      JOIN internal.tenants t ON t.id=s.tenant_id WHERE t.owner_user_ref=$1
      ORDER BY t.created_at,t.id LIMIT 1 FOR UPDATE OF s`, [principal.subject]);
    const s = rows[0];
    if (!s) {
      await c.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "SUBSCRIPTION_NOT_FOUND" });
    }
    const source = { status: s.status, planId: s.plan_id, currentPeriodEnd: new Date(s.current_period_end).toISOString(), gracePeriodEnd: s.grace_period_end ? new Date(s.grace_period_end).toISOString() : void 0 };
    const free = s.is_active && isFreePlan(source);
    if (selectFree) {
      if (!free) {
        await c.query("ROLLBACK");
        return res.status(409).json({ ok: false, error: "FREE_PLAN_NOT_ELIGIBLE" });
      }
      const selection = await validateFreeBranchSelection(c, principal.subject, req.body);
      await c.query("UPDATE billing.subscriptions SET free_selection=$2::jsonb,updated_at=now() WHERE id=$1", [s.id, JSON.stringify(selection)]);
      s.free_selection = selection;
    }
    const access = subscriptionAccess(source);
    const plan = findSaaSPlan(free ? FREE_PLAN_ID : s.plan_id);
    const outletCount = await c.query("SELECT count(*)::int AS used FROM internal.outlets WHERE tenant_id=$1 AND is_active", [s.tenant_id]);
    const invoices = await c.query("SELECT * FROM billing.invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100", [s.tenant_id]);
    await c.query("COMMIT");
    return res.status(200).json({
      ok: true,
      daysLeft: free ? 0 : access.daysLeft,
      subscription: {
        id: s.id,
        tenantId: s.tenant_id,
        planId: free ? FREE_PLAN_ID : s.plan_id,
        isActive: s.is_active,
        status: !s.is_active ? "EXPIRED" : free ? "FREE" : access.status,
        accessMode: !s.is_active ? "RESTRICTED" : access.accessMode,
        billingCycle: s.billing_cycle,
        extraOutlets: free ? 0 : s.extra_outlets,
        currentPeriodStart: s.current_period_start,
        currentPeriodEnd: s.current_period_end,
        gracePeriodEnd: s.grace_period_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        hasUsedTrial: s.has_used_trial,
        freeSelection: free ? s.free_selection : void 0
      },
      plan,
      accessMode: !s.is_active ? "RESTRICTED" : access.accessMode,
      activeDays: Math.max(0, Math.floor((Date.now() - Date.parse(s.current_period_start)) / DAY_MS)),
      totalPeriodDays: Math.max(1, Math.round((Date.parse(s.current_period_end) - Date.parse(s.current_period_start)) / DAY_MS)),
      requiresRenewal: !free && (access.accessMode !== "FULL" || access.daysLeft <= 3),
      renewalDueDate: free ? null : s.current_period_end,
      outlets: { used: free ? s.free_selection ? 1 : 0 : outletCount.rows[0].used, retained: outletCount.rows[0].used, included: plan?.maxOutlets ?? 2, extra: free ? 0 : Number(s.extra_outlets || 0), limit: free ? 1 : (plan?.maxOutlets ?? 2) + Number(s.extra_outlets || 0) },
      invoices: invoices.rows.map(serializeInvoice),
      limits: free ? { products: 10, outlets: 1, accounts: 1, ai: false } : void 0
    });
  } catch (error) {
    await c?.query("ROLLBACK").catch(() => {
    });
    const invalid = error instanceof Error && error.message === "INVALID_FREE_SELECTION";
    if (error instanceof FreePlanAccessError) return res.status(error.message === "BRANCH_NOT_OWNED" ? 403 : 409).json({ ok: false, error: error.message });
    return res.status(invalid ? 400 : 503).json({ ok: false, error: invalid ? "INVALID_FREE_SELECTION" : "SUBSCRIPTION_UNAVAILABLE" });
  } finally {
    c?.release();
    await pool.end();
  }
}
async function handler2(req, res) {
  return ownedSubscription(req, res, true);
}

// api/_subscription/verify.ts
import crypto from "crypto";
function sendJson2(res, status, data) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-device-id, x-tenant-id");
    res.setHeader("Content-Type", "application/json");
  } catch {
  }
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}
function getDokuCredentials() {
  const clientId = (process.env.DOKU_CLIENT_ID || process.env.DOKU_SANDBOX_CLIENT_ID || "").replace(/["']/g, "").trim();
  const secretKey = (process.env.DOKU_SECRET_KEY || process.env.DOKU_SANDBOX_SECRET_KEY || "").replace(/["']/g, "").trim();
  const rawUrl = (process.env.DOKU_API_URL || "https://api.doku.com").replace(/["']/g, "").trim().replace(/\/+$/, "");
  const apiUrl = rawUrl.includes("sandbox") ? "https://api-sandbox.doku.com" : "https://api.doku.com";
  const isConfigured = Boolean(clientId && secretKey && !clientId.includes("sandbox_dummy"));
  return { clientId, secretKey, apiUrl, isConfigured };
}
async function handler3(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson2(res, 200, { ok: true });
  }
  const invoiceId = req.query?.invoiceId || req.query?.invoice || req.query?.inv;
  if (!invoiceId) {
    return sendJson2(res, 200, {
      ok: true,
      paid: false,
      status: "PENDING_PAYMENT",
      subscription: { status: "PENDING_PAYMENT", accessMode: "RESTRICTED" },
      message: "INVOICE_REQUIRED"
    });
  }
  const { clientId, secretKey, apiUrl, isConfigured } = getDokuCredentials();
  if (isConfigured) {
    try {
      const invNumber = String(invoiceId).startsWith("NH-") ? String(invoiceId) : `NH-${invoiceId}`;
      const requestId = crypto.randomUUID();
      const requestTimestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19) + "Z";
      const requestTarget = `/orders/v1/status/${invNumber}`;
      const componentSignature = `Client-Id:${clientId}
Request-Id:${requestId}
Request-Timestamp:${requestTimestamp}
Request-Target:${requestTarget}`;
      const hmac = crypto.createHmac("sha256", secretKey);
      hmac.update(componentSignature, "utf8");
      const signature = `HMACSHA256=${hmac.digest("base64")}`;
      const response = await fetch(`${apiUrl}${requestTarget}`, {
        method: "GET",
        headers: {
          "Client-Id": clientId,
          "Request-Id": requestId,
          "Request-Timestamp": requestTimestamp,
          "Signature": signature
        },
        signal: AbortSignal.timeout(15e3)
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const txStatus = String(data?.transaction?.status || data?.order?.status || "").toUpperCase();
        if (txStatus === "SUCCESS") {
          return sendJson2(res, 200, {
            ok: true,
            paid: true,
            status: "ACTIVE",
            subscription: {
              status: "ACTIVE",
              currentPeriodEnd: new Date(Date.now() + 30 * 864e5).toISOString()
            },
            invoice: {
              invoiceNumber: invNumber,
              status: "PAID"
            }
          });
        }
      }
    } catch (e) {
      console.warn("DOKU order status check error:", e.message);
    }
  }
  return sendJson2(res, 200, {
    ok: true,
    paid: false,
    status: "PENDING_PAYMENT",
    invoice: {
      id: invoiceId,
      invoiceNumber: invoiceId,
      status: "UNPAID"
    }
  });
}

// api/_subscription/checkout.ts
import crypto2 from "crypto";
var SAAS_PLANS2 = {
  "plan-free": {
    id: "plan-free",
    name: "Free Trial 45 Hari",
    tierLevel: 1,
    priceIdr: 0,
    priceYearlyIdr: 0,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360
  },
  "plan-plus-monthly": {
    id: "plan-plus-monthly",
    name: "Tier Plus",
    tierLevel: 2,
    priceIdr: 99e3,
    priceYearlyIdr: 79200,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360
  },
  "plan-pro-monthly": {
    id: "plan-pro-monthly",
    name: "Tier Pro",
    tierLevel: 3,
    priceIdr: 299e3,
    priceYearlyIdr: 248170,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360
  }
};
function sendJson3(res, status, data) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-device-id, x-tenant-id");
    res.setHeader("Content-Type", "application/json");
  } catch {
  }
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}
async function getJsonBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}
function getDokuCredentials2() {
  const clientId = (process.env.DOKU_CLIENT_ID || process.env.DOKU_SANDBOX_CLIENT_ID || "").replace(/["']/g, "").trim();
  const secretKey = (process.env.DOKU_SECRET_KEY || process.env.DOKU_SANDBOX_SECRET_KEY || "").replace(/["']/g, "").trim();
  const rawUrl = (process.env.DOKU_API_URL || "https://api.doku.com").replace(/["']/g, "").trim().replace(/\/+$/, "");
  const apiUrl = rawUrl.includes("sandbox") ? "https://api-sandbox.doku.com" : "https://api.doku.com";
  const isConfigured = Boolean(clientId && secretKey && !clientId.includes("sandbox_dummy"));
  return { clientId, secretKey, apiUrl, isConfigured };
}
function generateDigest(body) {
  const content = typeof body === "string" ? body : JSON.stringify(body);
  return crypto2.createHash("sha256").update(content, "utf8").digest("base64");
}
function generateSignature(clientId, requestId, requestTimestamp, requestTarget, digest, secretKey) {
  const componentSignature = `Client-Id:${clientId}
Request-Id:${requestId}
Request-Timestamp:${requestTimestamp}
Request-Target:${requestTarget}
Digest:${digest}`;
  const hmac = crypto2.createHmac("sha256", secretKey);
  hmac.update(componentSignature, "utf8");
  return `HMACSHA256=${hmac.digest("base64")}`;
}
async function handler4(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson3(res, 200, { ok: true });
  }
  try {
    const body = await getJsonBody(req);
    const { planId, targetPlanId, billingCycle, extraOutlets } = body;
    const chosenPlanId = targetPlanId || planId || "plan-plus-monthly";
    const plan = SAAS_PLANS2[chosenPlanId] || SAAS_PLANS2["plan-plus-monthly"];
    const isYearly = billingCycle === "YEARLY";
    const basePrice = isYearly ? plan.priceYearlyIdr * 12 : plan.priceIdr;
    const extraOutletsCount = Math.max(0, Number(extraOutlets) || 0);
    const outletPrice = isYearly ? plan.extraOutletYearlyIdr * 12 * extraOutletsCount : plan.extraOutletPriceIdr * extraOutletsCount;
    const amount = basePrice + outletPrice;
    const invoiceNumber = `NH-${Date.now().toString().slice(-8)}`;
    if (amount === 0) {
      return sendJson3(res, 200, {
        ok: true,
        success: true,
        message: "Paket gratis berhasil diaktifkan.",
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: plan.id,
          amountIdr: 0,
          status: "PAID",
          paidAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    }
    const { clientId, secretKey, apiUrl, isConfigured } = getDokuCredentials2();
    if (!isConfigured) {
      return sendJson3(res, 200, {
        ok: false,
        error: "PAYMENT_GATEWAY_NOT_CONFIGURED",
        message: "Kredensial DOKU belum terdeteksi di Vercel Environment Variables. Pastikan DOKU_CLIENT_ID (dari API Key DOKU) dan DOKU_SECRET_KEY (dari Active Secret Key DOKU) sudah ditambahkan di Vercel Project Settings > Environment Variables (centang opsi Production) lalu lakukan Redeploy.",
        debug: {
          hasClientId: Boolean(clientId),
          hasSecretKey: Boolean(secretKey),
          apiUrl
        }
      });
    }
    const host = req.headers["x-forwarded-host"] || req.headers.host || "kasir.newhope.space";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const origin = (process.env.PUBLIC_APP_URL || `${proto}://${host}`).replace(/["']/g, "").trim();
    const callbackUrl = `${origin.replace(/\/$/, "")}/#payment?invoice=${invoiceNumber}`;
    const payload = {
      order: {
        invoice_number: invoiceNumber,
        amount,
        currency: "IDR",
        callback_url: callbackUrl,
        auto_redirect: true,
        line_items: [
          {
            name: `Paket ${plan.name} (${isYearly ? "Tahunan" : "Bulanan"})` + (extraOutletsCount > 0 ? ` + ${extraOutletsCount} Outlet` : ""),
            price: amount,
            quantity: 1
          }
        ]
      },
      payment: {
        payment_due_date: 1440
      }
    };
    try {
      const requestId = crypto2.randomUUID();
      const requestTimestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19) + "Z";
      const requestTarget = "/checkout/v1/payment";
      const digest = generateDigest(payload);
      const signature = generateSignature(clientId, requestId, requestTimestamp, requestTarget, digest, secretKey);
      const dokuResponse = await fetch(`${apiUrl}${requestTarget}`, {
        method: "POST",
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
      const data = await dokuResponse.json().catch(() => ({}));
      if (dokuResponse.ok && data?.response?.payment?.url) {
        return sendJson3(res, 200, {
          ok: true,
          success: true,
          paymentUrl: data.response.payment.url,
          invoice: {
            id: invoiceNumber,
            invoiceNumber,
            planId: plan.id,
            amountIdr: amount,
            status: "UNPAID",
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        });
      }
      const errorMessage = data?.error?.message || data?.message || (Array.isArray(data?.error) ? data.error.join(", ") : `DOKU API Error (HTTP ${dokuResponse.status})`);
      const maskedClient = clientId.length > 8 ? `${clientId.slice(0, 4)}...${clientId.slice(-4)}` : clientId;
      console.warn("DOKU API error response:", data);
      return sendJson3(res, 200, {
        ok: false,
        error: "DOKU_API_ERROR",
        message: `Gagal membuat pembayaran di DOKU: ${errorMessage} (Target: ${apiUrl}, Client-ID: ${maskedClient})`,
        details: data,
        httpStatus: dokuResponse.status
      });
    } catch (fetchErr) {
      console.warn("DOKU fetch error:", fetchErr.message);
      return sendJson3(res, 200, {
        ok: false,
        error: "DOKU_CONNECTION_ERROR",
        message: `Tidak dapat terhubung ke server DOKU: ${fetchErr.message}. Target URL: ${apiUrl}.`
      });
    }
  } catch (err) {
    console.error("Server error in checkout handler:", err);
    return sendJson3(res, 200, {
      ok: false,
      error: "SERVER_ERROR",
      message: `Terjadi kendala pada server checkout: ${err.message}`
    });
  }
}

// api/_subscription/start-trial.ts
async function handler5(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  return ownedSubscription({ ...req, method: "GET", headers: req.headers }, res);
}

// api/_subscription/status.ts
async function handler6(req, res) {
  return ownedSubscription(req, res);
}

// api/_subscription/outlets.ts
import { Pool as Pool2 } from "pg";
async function handler7(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  const principal = await authenticateBearer(req);
  if (!principal || principal.subject === "local-development") return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "DATABASE_UNAVAILABLE" });
  const pool = new Pool2({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 5e3 });
  try {
    const { rows } = await pool.query(`SELECT o.*,m.business_sector FROM internal.outlets o
      JOIN internal.tenants t ON t.id=o.tenant_id JOIN internal.merchants m ON m.id=o.merchant_id
      WHERE t.owner_user_ref=$1 ORDER BY o.created_at`, [principal.subject]);
    return res.status(200).json({ ok: true, rows });
  } catch {
    return res.status(503).json({ ok: false, error: "OUTLETS_UNAVAILABLE" });
  } finally {
    await pool.end();
  }
}

// api/_subscription/prorated-upgrade.ts
var SAAS_PLANS3 = {
  "plan-free": {
    id: "plan-free",
    name: "Free Trial 45 Hari",
    tierLevel: 1,
    priceIdr: 0,
    priceYearlyIdr: 0,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360
  },
  "plan-plus-monthly": {
    id: "plan-plus-monthly",
    name: "Tier Plus",
    tierLevel: 2,
    priceIdr: 99e3,
    priceYearlyIdr: 79200,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360
  },
  "plan-pro-monthly": {
    id: "plan-pro-monthly",
    name: "Tier Pro",
    tierLevel: 3,
    priceIdr: 299e3,
    priceYearlyIdr: 248170,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360
  }
};
function sendJson4(res, status, data) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-device-id, x-tenant-id");
    res.setHeader("Content-Type", "application/json");
  } catch {
  }
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}
async function getJsonBody2(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}
async function handler8(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson4(res, 200, { ok: true });
  }
  try {
    const body = await getJsonBody2(req);
    const { planId, targetPlanId, billingCycle, extraOutlets } = body;
    const chosenPlanId = targetPlanId || planId || "plan-plus-monthly";
    const plan = SAAS_PLANS3[chosenPlanId] || SAAS_PLANS3["plan-plus-monthly"];
    const isYearly = billingCycle === "YEARLY";
    const basePrice = isYearly ? plan.priceYearlyIdr * 12 : plan.priceIdr;
    const extraOutletsCount = Math.max(0, Number(extraOutlets) || 0);
    const outletPrice = isYearly ? plan.extraOutletYearlyIdr * 12 * extraOutletsCount : plan.extraOutletPriceIdr * extraOutletsCount;
    const totalAmount = basePrice + outletPrice;
    const now = /* @__PURE__ */ new Date();
    const end = new Date(now);
    if (isYearly) end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);
    return sendJson4(res, 200, {
      ok: true,
      planId: plan.id,
      planName: plan.name,
      billingCycle: isYearly ? "YEARLY" : "MONTHLY",
      amount: totalAmount,
      recurringAmount: totalAmount,
      unusedCredit: 0,
      extraOutlets: extraOutletsCount,
      periodStart: now.toISOString(),
      periodEnd: end.toISOString(),
      netProratedAmount: totalAmount,
      proratedAmountIdr: totalAmount
    });
  } catch (err) {
    return sendJson4(res, 200, {
      ok: true,
      planId: "plan-plus-monthly",
      planName: "Tier Plus",
      billingCycle: "MONTHLY",
      amount: 99e3,
      recurringAmount: 99e3,
      unusedCredit: 0,
      extraOutlets: 0,
      periodStart: (/* @__PURE__ */ new Date()).toISOString(),
      periodEnd: new Date(Date.now() + 30 * 864e5).toISOString(),
      netProratedAmount: 99e3,
      proratedAmountIdr: 99e3
    });
  }
}

// src/server/subscriptionDispatcher.ts
async function handler9(req, res) {
  let action = "";
  if (req.query?.slug) {
    action = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  }
  if (!action && req.url) {
    const pathname = req.url.split("?")[0].replace(/\/+$/, "");
    const segments = pathname.split("/");
    action = segments[segments.length - 1];
  }
  switch (action) {
    case "free-plan":
      return handler2(req, res);
    case "plans":
      return handler(req, res);
    case "verify":
      return handler3(req, res);
    case "checkout":
      return handler4(req, res);
    case "start-trial":
      return handler5(req, res);
    case "status":
      return handler6(req, res);
    case "outlets":
      return handler7(req, res);
    case "prorated-upgrade":
      return handler8(req, res);
    default:
      return res.status(404).json({
        ok: false,
        error: "ENDPOINT_NOT_FOUND",
        requestedAction: action,
        availableActions: ["plans", "verify", "checkout", "start-trial", "status", "outlets", "prorated-upgrade", "free-plan"]
      });
  }
}
export {
  handler9 as default
};
