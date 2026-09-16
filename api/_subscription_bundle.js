// api/_subscription/plans.ts
var SAAS_PLANS = [
  {
    id: "plan-free",
    name: "Free Trial 45 Hari",
    tierLevel: 1,
    billingCycle: "MONTHLY",
    priceIdr: 0,
    currency: "IDR",
    maxOutlets: 2,
    isActive: true,
    isTrial: true,
    features: [
      "Seluruh fitur Tier Pro selama 45 hari",
      "Hingga 2 outlet",
      "Produk dan pengguna tidak terbatas",
      "Kuota AI trial terbatas",
      "WhatsApp assisted melalui wa.me",
      "Tanpa kartu kredit",
      "Data tetap dapat dibaca 14 hari setelah trial"
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
async function handler2(req, res) {
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
async function handler3(req, res) {
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
import { randomUUID } from "crypto";
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
async function handler4(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson4(res, 200, { ok: true });
  }
  if (req.method !== "POST") {
    return sendJson4(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  const now = /* @__PURE__ */ new Date();
  const end = new Date(now.getTime() + 45 * 864e5);
  const grace = new Date(now.getTime() + 59 * 864e5);
  const tenantId = req.body?.tenantId || req.query?.tenantId || req.headers["x-tenant-id"] || "tenant-default";
  if (process.env.DATABASE_URL) {
    let pool;
    try {
      const { Pool } = await import("pg");
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5e3
      });
      const tenantCheck = await pool.query("SELECT id, is_active FROM internal.tenants WHERE id = $1", [tenantId]);
      if (tenantCheck.rows.length === 0) {
        await pool.query(
          `INSERT INTO internal.tenants (id, name, is_active) VALUES ($1, 'Tenant User', true) ON CONFLICT (id) DO NOTHING`,
          [tenantId]
        );
      }
      const subCheck = await pool.query("SELECT * FROM billing.subscriptions WHERE tenant_id = $1", [tenantId]);
      const existing = subCheck.rows[0];
      if (existing && existing.has_used_trial && existing.status !== "TRIAL" && existing.status !== "PENDING_PAYMENT") {
        await pool.end();
        return sendJson4(res, 400, {
          ok: false,
          error: "TRIAL_ALREADY_USED",
          message: "Masa Free Trial 45 Hari hanya berlaku 1 kali per akun toko. Silakan pilih paket Tier Plus atau Pro."
        });
      }
      const upsertRes = await pool.query(
        `INSERT INTO billing.subscriptions
          (id, tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end, grace_period_end, trial_started_at, trial_ends_at, has_used_trial, extra_outlets, revision, updated_at)
         VALUES
          ($1, $2, 'plan-free', 'TRIAL', 'MONTHLY', $3, $4, $5, $3, $4, true, 0, 1, now())
         ON CONFLICT (tenant_id) DO UPDATE
          SET plan_id = 'plan-free',
              status = 'TRIAL',
              billing_cycle = 'MONTHLY',
              current_period_start = $3,
              current_period_end = $4,
              grace_period_end = $5,
              trial_started_at = COALESCE(billing.subscriptions.trial_started_at, $3),
              trial_ends_at = $4,
              has_used_trial = true,
              revision = billing.subscriptions.revision + 1,
              updated_at = now()
         RETURNING *`,
        [randomUUID(), tenantId, now.toISOString(), end.toISOString(), grace.toISOString()]
      );
      await pool.end();
      const updated = upsertRes.rows[0];
      return sendJson4(res, 200, {
        ok: true,
        subscription: {
          id: updated.id,
          tenantId: updated.tenant_id,
          planId: "plan-free",
          status: "TRIAL",
          billingCycle: "MONTHLY",
          extraOutlets: 0,
          currentPeriodStart: updated.current_period_start,
          currentPeriodEnd: updated.current_period_end,
          accessMode: "FULL",
          hasUsedTrial: true
        }
      });
    } catch (err) {
      if (pool) {
        try {
          await pool.end();
        } catch {
        }
      }
      console.error("start-trial DB error:", err?.message);
      return sendJson4(res, 500, {
        ok: false,
        error: "TRIAL_ACTIVATION_FAILED",
        message: err?.message || "Gagal mengaktifkan masa uji coba gratis."
      });
    }
  }
  return sendJson4(res, 200, {
    ok: true,
    subscription: {
      id: `sub-trial-${Date.now()}`,
      tenantId,
      planId: "plan-free",
      status: "TRIAL",
      billingCycle: "MONTHLY",
      extraOutlets: 0,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: end.toISOString(),
      accessMode: "FULL",
      hasUsedTrial: true
    }
  });
}

// api/_subscription/status.ts
function sendJson5(res, status, data) {
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
async function handler5(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson5(res, 200, { ok: true });
  }
  const now = /* @__PURE__ */ new Date();
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5e3
      });
      const tenantId = req.query?.tenantId || req.headers["x-tenant-id"] || "tenant-default";
      const resSub = await pool.query(
        `SELECT s.*, i.payment_status, i.paid_at 
         FROM billing.subscriptions s
         LEFT JOIN billing.invoices i ON i.subscription_id = s.id AND i.payment_status = 'PAID'
         WHERE s.tenant_id = $1 OR s.id = $1
         ORDER BY s.updated_at DESC LIMIT 1`,
        [tenantId]
      );
      await pool.end();
      if (resSub.rows.length > 0) {
        const sub = resSub.rows[0];
        const isPaid = sub.status === "ACTIVE" || sub.payment_status === "PAID";
        return sendJson5(res, 200, {
          ok: true,
          subscription: {
            id: sub.id,
            tenantId: sub.tenant_id,
            planId: sub.plan_id || "plan-plus-monthly",
            status: isPaid ? "ACTIVE" : "PENDING_PAYMENT",
            accessMode: isPaid ? "FULL" : "RESTRICTED",
            currentPeriodStart: sub.current_period_start || now.toISOString(),
            currentPeriodEnd: sub.current_period_end || now.toISOString()
          },
          daysLeft: isPaid ? 30 : 0,
          invoices: []
        });
      }
    } catch (dbErr) {
      console.warn("Status DB lookup fallback:", dbErr?.message);
    }
  }
  return sendJson5(res, 200, {
    ok: true,
    subscription: {
      id: "sub-pending",
      tenantId: req.query?.tenantId || "tenant-default",
      planId: req.query?.planId || "plan-plus-monthly",
      status: "PENDING_PAYMENT",
      accessMode: "RESTRICTED",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: now.toISOString()
    },
    daysLeft: 0,
    invoices: []
  });
}

// api/_subscription/outlets.ts
function sendJson6(res, status, data) {
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
async function handler6(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson6(res, 200, { ok: true });
  }
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5e3
      });
      const tenantId = req.query?.tenantId || req.headers["x-tenant-id"] || "tenant-default";
      const { rows } = await pool.query(
        `SELECT o.*, m.business_sector 
         FROM internal.outlets o 
         LEFT JOIN internal.merchants m ON m.id = o.merchant_id 
         WHERE o.tenant_id = $1 
         ORDER BY o.created_at`,
        [tenantId]
      );
      await pool.end();
      return sendJson6(res, 200, { ok: true, rows });
    } catch (err) {
      console.warn("Outlets DB fallback:", err.message);
    }
  }
  return sendJson6(res, 200, { ok: true, rows: [] });
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
function sendJson7(res, status, data) {
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
async function handler7(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson7(res, 200, { ok: true });
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
    return sendJson7(res, 200, {
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
    return sendJson7(res, 200, {
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
async function handler8(req, res) {
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
    case "plans":
      return handler(req, res);
    case "verify":
      return handler2(req, res);
    case "checkout":
      return handler3(req, res);
    case "start-trial":
      return handler4(req, res);
    case "status":
      return handler5(req, res);
    case "outlets":
      return handler6(req, res);
    case "prorated-upgrade":
      return handler7(req, res);
    default:
      return res.status(404).json({
        ok: false,
        error: "ENDPOINT_NOT_FOUND",
        requestedAction: action,
        availableActions: ["plans", "verify", "checkout", "start-trial", "status", "outlets", "prorated-upgrade"]
      });
  }
}
export {
  handler8 as default
};
