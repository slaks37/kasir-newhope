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
