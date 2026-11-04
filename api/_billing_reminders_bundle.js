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
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
function createReminderProvider() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RESEND_API_KEY) throw new Error("REMINDER_PROVIDER_NOT_CONFIGURED");
  const auth = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5e3) }) }
  });
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async verifiedOwnerEmail(subject) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject || "")) return null;
      const { data, error } = await auth.auth.admin.getUserById(subject);
      if (error) {
        if (error.status === 404) return null;
        throw new Error("OWNER_LOOKUP_FAILED");
      }
      const user = data.user;
      if (user?.deleted_at || user?.banned_until && Date.parse(user.banned_until) > Date.now()) return null;
      return user?.id === subject && user.email_confirmed_at && user.email ? user.email : null;
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

// services/billing/recovery.ts
import { randomUUID as randomUUID2 } from "node:crypto";

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
function getDokuSecretKey() {
  return (process.env.DOKU_SECRET_KEY || "").trim();
}
var DOKU_API_URLS = /* @__PURE__ */ new Set(["https://api.doku.com", "https://api-sandbox.doku.com"]);
function getDokuApiUrl() {
  const raw = (process.env.DOKU_API_URL || "https://api.doku.com").replace(/["']/g, "").trim().replace(/\/+$/, "");
  if (!DOKU_API_URLS.has(raw)) throw new Error("DOKU_API_URL_NOT_ALLOWED");
  return raw;
}
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

// src/config/freePlanPolicy.ts
var FREE_PLAN_ID = "plan-free-lifetime";

// src/config/saasPlans.ts
var TRIAL_PLAN_ID = "plan-free";
var TRIAL_DAYS = 45;
var TRIAL_READ_ONLY_DAYS = 14;
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

// services/billing/engine.ts
var BillingError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function outletUsage(db, tenantId) {
  const { rows } = await db.query("SELECT count(*)::int AS count FROM internal.outlets WHERE tenant_id=$1 AND is_active", [tenantId]);
  return Number(rows[0].count);
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
   VALUES($1,$2,'UNVERIFIED','STATUS_INQUIRY_ATTEMPT','{"source":"INQUIRY_PROBE"}'::jsonb,$3)`, ["probe-" + randomUUID2(), fresh.invoice_number, new Date(now).toISOString()]);
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
async function recoverPendingPayments(db, options = {}) {
  const limit = Math.min(100, Math.max(1, options.limit || 20)), start = Date.now();
  const invoices = (await db.query(`SELECT i.* FROM billing.invoices i LEFT JOIN (SELECT invoice_number,max(created_at) checked_at FROM billing.payment_events
    WHERE payload->>'source'='INQUIRY_PROBE' GROUP BY invoice_number) probes USING(invoice_number)
  WHERE i.payment_status='PENDING' AND i.quote->>'paymentIntegration'='DOKU_CHECKOUT' AND i.quote->'allowedChannels'=$2::jsonb AND ($3::text IS NULL OR i.quote->>'releaseAcceptanceId'=$3) AND i.created_at>now()-interval '30 days'
  ORDER BY coalesce(probes.checked_at,i.created_at),i.id LIMIT $1`, [limit, JSON.stringify(getDokuAllowedChannels()), process.env.DOKU_ACCEPTANCE_ID || null])).rows;
  const summary = { checked: 0, applied: 0, review: 0, unavailable: 0, deferred: 0 };
  for (const inv of invoices) {
    if (Date.now() - start >= (options.budgetMs ?? 2e4)) {
      summary.deferred++;
      continue;
    }
    summary.checked++;
    try {
      const result = await reconcileInvoiceByInquiry(db, inv, options.provider, { now: options.now });
      if (result.outcome === "APPLIED") summary.applied++;
      else if (result.outcome === "REVIEW") summary.review++;
      else if (result.outcome === "UNAVAILABLE") summary.unavailable++;
      else if (result.outcome === "DEFERRED") summary.deferred++;
    } catch {
      summary.unavailable++;
    }
  }
  return summary;
}
async function runScheduledDokuRecovery(db, options = {}) {
  if (process.env.DOKU_RECONCILIATION_ENABLED !== "1") return { skipped: true, reason: "PAYMENT_RECOVERY_DISABLED" };
  const live = getDokuApiUrl() === "https://api.doku.com";
  if (!isDokuConfigured() || !process.env.DOKU_ACCEPTANCE_ID || (live ? process.env.FULL_NEON_TARGET !== "production" || process.env.VERCEL_ENV !== "production" || process.env.AUTH_PROVIDER !== "neon" : process.env.FULL_NEON_TARGET === "production" || process.env.VERCEL_ENV === "production")) throw Error("PAYMENT_RECOVERY_CONFIGURATION_INVALID");
  return { skipped: false, ...await recoverPendingPayments(db, { limit: 20, budgetMs: 15e3, ...options }) };
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
    const db = await database;
    const recovery = await runScheduledDokuRecovery(db);
    const result = await runBillingReminders(db, provider, {
      dryRun,
      from: process.env.BILLING_EMAIL_FROM,
      appUrl: process.env.PUBLIC_APP_URL
    });
    const unhealthy = result.failed || result.review || !recovery.skipped && ("unavailable" in recovery && recovery.unavailable || "review" in recovery && recovery.review);
    return res.status(unhealthy ? 503 : 200).json({ ok: !unhealthy, ...result, paymentRecovery: recovery });
  } catch {
    return res.status(503).json({ ok: false, error: "BILLING_REMINDERS_UNAVAILABLE" });
  }
}
export {
  handler as default
};
