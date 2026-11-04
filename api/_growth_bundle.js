// src/server/growthCronHandler.ts
import { timingSafeEqual } from "node:crypto";

// src/server/growth/db.ts
import pg from "pg";
var GROWTH_WORKSPACE = "b1b56887-e47e-45ec-9e10-d58d378709ce";
function growthEnabled(env = process.env) {
  const staging = env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development" || !env.VERCEL_ENV && env.NODE_ENV !== "production";
  return env.GROWTH_ENGINE_ENABLED === "1" && staging && env.APP_ENV !== "production";
}
var pool;
async function growthDb() {
  if (!growthEnabled() || !process.env.GROWTH_DATABASE_URL)
    throw Error("GROWTH_NOT_CONFIGURED");
  if (!pool) {
    const u = new URL(process.env.GROWTH_DATABASE_URL);
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (!local && !u.hostname.endsWith(".neon.tech"))
      throw Error("GROWTH_DATABASE_HOST_NOT_APPROVED");
    for (const k of [
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert",
      "uselibpqcompat"
    ])
      u.searchParams.delete(k);
    pool = new pg.Pool({
      connectionString: u.toString(),
      ssl: local ? void 0 : { rejectUnauthorized: true },
      max: 3,
      connectionTimeoutMillis: 5e3,
      idleTimeoutMillis: 1e4,
      statement_timeout: 5e3
    });
    pool.on("error", () => console.error("[growth] database pool unavailable"));
  }
  const wrap = (q) => ({
    query: async (s, p) => {
      const r = await q.query(s, p);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    exec: async (s) => {
      await q.query(s);
    },
    tx: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const result = await fn(wrap(c));
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: async () => {
      await pool?.end();
      pool = void 0;
    }
  });
  return wrap(pool);
}
async function inWorkspace(db, fn, workspace = GROWTH_WORKSPACE) {
  return db.tx(async (c) => {
    await c.query("SELECT set_config('app.growth_workspace',$1,true)", [
      workspace
    ]);
    return fn(c);
  });
}

// src/server/growth/sourceDb.ts
import pg2 from "pg";
var pool2;
async function sourceDb() {
  if (!growthEnabled() || !process.env.GROWTH_SOURCE_DATABASE_URL)
    throw Error("GROWTH_SOURCE_NOT_CONFIGURED");
  if (!pool2) {
    const u = new URL(process.env.GROWTH_SOURCE_DATABASE_URL);
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.hostname.endsWith(".neon.tech"))
      throw Error("UNAPPROVED_SOURCE_HOST");
    for (const k of [
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert",
      "uselibpqcompat"
    ])
      u.searchParams.delete(k);
    pool2 = new pg2.Pool({
      connectionString: u.toString(),
      ssl: ["localhost", "127.0.0.1"].includes(u.hostname) ? void 0 : { rejectUnauthorized: true },
      max: 2,
      connectionTimeoutMillis: 5e3,
      statement_timeout: 5e3,
      idleTimeoutMillis: 1e4
    });
    pool2.on("error", () => console.error("[growth] source worker unavailable"));
  }
  const wrap = (q) => ({
    query: async (s, p) => {
      const r = await q.query(s, p);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    exec: async (s) => {
      await q.query(s);
    },
    tx: async (fn) => {
      const c = await pool2.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(wrap(c));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: async () => {
      await pool2?.end();
      pool2 = void 0;
    }
  });
  return wrap(pool2);
}

// src/server/growth/integration.ts
import { createHash, randomUUID } from "node:crypto";

// src/lib/growth/model.ts
var SIGNALS = {
  signup: 10,
  business_setup: 10,
  outlet_setup: 10,
  catalog_setup: 10,
  test_transaction: 5,
  synced_transaction: 20,
  report_viewed: 5,
  repeat_usage: 15,
  demo_requested: 10,
  referral: 5,
  pricing_interest: 5
};

// src/server/growth/service.ts
var GrowthError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
var fail = (code, status = 400) => {
  throw new GrowthError(status, code);
};
var uuid = (v) => typeof v === "string" && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
  v
) ? v : fail("INVALID_ID");
async function findLead(db, id) {
  const row = (await db.query(
    "SELECT * FROM growth.leads WHERE workspace_id=$1 AND id=$2",
    [GROWTH_WORKSPACE, uuid(id)]
  )).rows[0];
  if (!row) return fail("LEAD_NOT_FOUND", 404);
  return row;
}
async function recordEvent(db, b, origin, verified) {
  if (!Object.hasOwn(SIGNALS, b.signal) || typeof b.key !== "string" || b.key.length < 1 || b.key.length > 200 || !Number.isFinite(Date.parse(b.occurredAt)) || Date.parse(b.occurredAt) > Date.now() + 3e5)
    return fail("INVALID_EVENT");
  if (b.signal === "pricing_interest" && b.leadId) {
    const l = await findLead(db, b.leadId);
    if (l.opted_out_at || !l.consent_basis)
      return fail("TRACKING_CONSENT_REQUIRED");
  }
  const row = (await db.query(
    `INSERT INTO growth.events(workspace_id,lead_id,subject_ref,signal,event_key,verified,origin,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,event_key) DO NOTHING RETURNING id`,
    [
      GROWTH_WORKSPACE,
      b.leadId ? uuid(b.leadId) : null,
      b.subject ? uuid(b.subject) : null,
      b.signal,
      b.key,
      verified,
      origin,
      b.occurredAt
    ]
  )).rows[0];
  if (!row) {
    const old = (await db.query(
      "SELECT lead_id,subject_ref,signal FROM growth.events WHERE workspace_id=$1 AND event_key=$2",
      [GROWTH_WORKSPACE, b.key]
    )).rows[0];
    if (old && (old.lead_id !== (b.leadId ?? null) || old.subject_ref !== (b.subject ?? null) || old.signal !== b.signal))
      return fail("EVENT_KEY_CONFLICT", 409);
  }
  return { inserted: !!row };
}

// src/server/growth/integration.ts
var hash = (s) => createHash("sha256").update(s).digest("hex");
async function drainOutbox(source, target, limit = 100) {
  const cfg = (await source.query("SELECT * FROM growth_source.config WHERE singleton")).rows[0];
  if (!cfg?.enabled) return { processed: 0, failed: 0, disabled: true };
  const lease = randomUUID();
  const batch = await source.tx(
    (c) => c.query(
      `WITH pick AS(SELECT id FROM growth_source.outbox WHERE delivered_at IS NULL AND dead_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY seq LIMIT $1 FOR UPDATE SKIP LOCKED) UPDATE growth_source.outbox o SET lease_id=$2,lease_until=now()+interval '60 seconds',attempts=attempts+1 FROM pick WHERE o.id=pick.id RETURNING o.*`,
      [Math.min(500, Math.max(1, limit)), lease]
    )
  );
  const started = Date.now();
  let processed = 0, failed = 0;
  for (const r of batch.rows.sort((a, b) => Number(a.seq) - Number(b.seq))) {
    if (Date.now() - started > 2e4) break;
    try {
      await inWorkspace(target, async (c) => {
        const fingerprint = hash(
          JSON.stringify({
            source: r.source_id,
            tenant: r.tenant_ref,
            subject: r.subject_ref,
            kind: r.kind,
            payload: r.payload,
            data: r.data_class,
            time: new Date(r.occurred_at).toISOString()
          })
        );
        const inserted = await c.query(
          "INSERT INTO growth.receipts(workspace_id,source_event_id,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING source_event_id",
          [GROWTH_WORKSPACE, r.id, fingerprint]
        );
        if (!inserted.rowCount) {
          const old = (await c.query(
            "SELECT payload_hash FROM growth.receipts WHERE workspace_id=$1 AND source_event_id=$2",
            [GROWTH_WORKSPACE, r.id]
          )).rows[0];
          if (old.payload_hash !== fingerprint)
            fail("SOURCE_EVENT_CONFLICT", 409);
          return;
        }
        const b = r.payload;
        if (!["synthetic", "first_party"].includes(r.data_class) || r.source_id !== cfg.source_id)
          fail("SOURCE_BINDING_MISMATCH");
        if (r.kind === "signal") {
          if (![
            "signup",
            "business_setup",
            "outlet_setup",
            "catalog_setup",
            "synced_transaction",
            "report_viewed"
          ].includes(b.signal))
            fail("SOURCE_SIGNAL_NOT_ALLOWED");
          const linked = (await c.query(
            `SELECT i.lead_id FROM growth.link_invites i JOIN growth.leads l ON l.workspace_id=i.workspace_id AND l.id=i.lead_id WHERE i.workspace_id=$1 AND i.subject_ref=$2 AND (i.tenant_ref=$3 OR ($3::uuid IS NULL AND $4::text='signup')) AND i.approved_at IS NOT NULL AND i.revoked_at IS NULL AND l.opted_out_at IS NULL AND l.anonymized_at IS NULL`,
            [GROWTH_WORKSPACE, r.subject_ref, r.tenant_ref, b.signal]
          )).rows[0];
          await recordEvent(
            c,
            {
              subject: r.subject_ref,
              leadId: linked?.lead_id,
              signal: b.signal,
              key: "source:" + r.id,
              occurredAt: new Date(r.occurred_at).toISOString()
            },
            "server",
            true
          );
          await c.query(
            "UPDATE growth.events SET tenant_ref=$3,source_event_id=$4,data_class=$5 WHERE workspace_id=$1 AND event_key=$2",
            [GROWTH_WORKSPACE, "source:" + r.id, r.tenant_ref, r.id, r.data_class]
          );
          if (linked && b.signal === "synced_transaction") {
            const days = await c.query(
              `SELECT count(DISTINCT (occurred_at AT TIME ZONE 'Asia/Jakarta')::date)::int AS days FROM growth.events WHERE workspace_id=$1 AND lead_id=$2 AND tenant_ref=$3 AND signal='synced_transaction' AND verified AND source_event_id IS NOT NULL`,
              [GROWTH_WORKSPACE, linked.lead_id, r.tenant_ref]
            );
            if (days.rows[0].days >= 2) {
              await recordEvent(
                c,
                {
                  subject: r.subject_ref,
                  leadId: linked.lead_id,
                  signal: "repeat_usage",
                  key: "repeat:" + r.subject_ref + ":" + r.tenant_ref,
                  occurredAt: new Date(r.occurred_at).toISOString()
                },
                "server",
                true
              );
              await c.query(
                "UPDATE growth.events SET tenant_ref=$3,data_class=$4 WHERE workspace_id=$1 AND event_key=$2",
                [
                  GROWTH_WORKSPACE,
                  "repeat:" + r.subject_ref + ":" + r.tenant_ref,
                  r.tenant_ref,
                  r.data_class
                ]
              );
            }
          }
        } else if (r.kind === "ownership") {
          await c.query(
            "UPDATE growth.link_invites SET revoked_at=now() WHERE workspace_id=$1 AND tenant_ref=$2 AND revoked_at IS NULL AND subject_ref::text IS DISTINCT FROM $3::text",
            [GROWTH_WORKSPACE, r.tenant_ref, b.currentSubject ?? null]
          );
          await c.query(
            "UPDATE growth.billing_facts SET paid_verified=false WHERE workspace_id=$1 AND tenant_ref=$2 AND subject_ref::text IS DISTINCT FROM $3::text",
            [GROWTH_WORKSPACE, r.tenant_ref, b.currentSubject ?? null]
          );
          await c.query(
            "INSERT INTO growth.audit(workspace_id,actor_id,action,target_id) VALUES($1,$2,'SOURCE_OWNERSHIP_LINK_REVOKED',$3)",
            [GROWTH_WORKSPACE, r.subject_ref, r.tenant_ref]
          );
        } else if (r.kind === "subscription") {
          if (!b.subscriptionId || !Number.isFinite(Number(b.monthlyAmount)) || Number(b.monthlyAmount) < 0)
            fail("INVALID_SUBSCRIPTION_FACT");
          await c.query(
            `INSERT INTO growth.billing_history(workspace_id,source_event_id,tenant_ref,status,paid_verified,trial_started_at,trial_ends_at,period_start,period_end,data_class,observed_at,source_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
            [
              GROWTH_WORKSPACE,
              r.id,
              r.tenant_ref,
              b.status,
              b.paidVerified === true,
              b.trialStart,
              b.trialEnd,
              b.periodStart,
              b.periodEnd,
              r.data_class,
              r.occurred_at,
              r.seq
            ]
          );
          const existing = (await c.query(
            "SELECT source_id FROM growth.billing_facts WHERE workspace_id=$1 AND tenant_ref=$2",
            [GROWTH_WORKSPACE, r.tenant_ref]
          )).rows[0];
          if (existing && existing.source_id !== r.source_id)
            fail("SOURCE_REBIND_REQUIRES_REVIEW", 409);
          await c.query(
            `INSERT INTO growth.billing_facts(workspace_id,tenant_ref,subject_ref,subscription_id,status,trial_started_at,trial_ends_at,period_start,period_end,monthly_amount,paid_verified,data_class,source_seq,source_id,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(workspace_id,tenant_ref) DO UPDATE SET subject_ref=EXCLUDED.subject_ref,subscription_id=EXCLUDED.subscription_id,status=EXCLUDED.status,trial_started_at=EXCLUDED.trial_started_at,trial_ends_at=EXCLUDED.trial_ends_at,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,monthly_amount=EXCLUDED.monthly_amount,paid_verified=EXCLUDED.paid_verified,data_class=EXCLUDED.data_class,source_seq=EXCLUDED.source_seq,observed_at=EXCLUDED.observed_at WHERE growth.billing_facts.source_seq<EXCLUDED.source_seq`,
            [
              GROWTH_WORKSPACE,
              r.tenant_ref,
              r.subject_ref,
              b.subscriptionId,
              b.status,
              b.trialStart,
              b.trialEnd,
              b.periodStart,
              b.periodEnd,
              b.monthlyAmount,
              b.paidVerified === true,
              r.data_class,
              r.seq,
              r.source_id,
              r.occurred_at
            ]
          );
        } else fail("INVALID_SOURCE_KIND");
      });
      await source.query(
        "UPDATE growth_source.outbox SET delivered_at=now(),lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_id=$2",
        [r.id, lease]
      );
      processed++;
    } catch {
      failed++;
      await source.query(
        `UPDATE growth_source.outbox SET lease_until=NULL,available_at=now()+make_interval(secs=>LEAST(3600,power(2,LEAST(attempts,10))::int)),dead_at=CASE WHEN attempts>=8 THEN now() ELSE NULL END,last_error='DELIVERY_FAILED' WHERE id=$1 AND lease_id=$2`,
        [r.id, lease]
      );
    }
  }
  await source.query(
    "UPDATE growth_source.outbox SET lease_until=NULL WHERE lease_id=$1 AND delivered_at IS NULL AND dead_at IS NULL",
    [lease]
  );
  const state = (await source.query(
    `SELECT count(*) FILTER(WHERE delivered_at IS NULL AND dead_at IS NULL)::int AS pending,count(*) FILTER(WHERE dead_at IS NOT NULL)::int AS dead,min(occurred_at) FILTER(WHERE delivered_at IS NULL) AS oldest FROM growth_source.outbox`
  )).rows[0];
  await inWorkspace(
    target,
    (c) => c.query(
      `INSERT INTO growth.integration_state(workspace_id,source_id,last_run_at,backfill_at,pending,dead,oldest_pending) VALUES($1,$2,now(),$3,$4,$5,$6) ON CONFLICT(workspace_id) DO UPDATE SET source_id=EXCLUDED.source_id,last_run_at=EXCLUDED.last_run_at,backfill_at=EXCLUDED.backfill_at,pending=EXCLUDED.pending,dead=EXCLUDED.dead,oldest_pending=EXCLUDED.oldest_pending`,
      [
        GROWTH_WORKSPACE,
        cfg.source_id,
        cfg.backfill_at,
        state.pending,
        state.dead,
        state.oldest
      ]
    )
  );
  return { processed, failed, ...state };
}

// src/server/growth/retention.ts
async function maintainRetention(source, target) {
  const removed = await inWorkspace(target, async (c) => {
    const r = await c.query(
      `DELETE FROM growth.events WHERE workspace_id=$1 AND ((lead_id IS NULL AND received_at<now()-interval '30 days') OR (lead_id IS NOT NULL AND received_at<now()-interval '180 days')) RETURNING id`,
      [GROWTH_WORKSPACE]
    );
    await c.query(
      `UPDATE growth.link_invites SET token_hash='expired:'||id::text,subject_ref=NULL,tenant_ref=NULL,revoked_at=coalesce(revoked_at,now()) WHERE workspace_id=$1 AND approved_at IS NULL AND expires_at<now()-interval '30 days'`,
      [GROWTH_WORKSPACE]
    );
    return r.rowCount;
  });
  const delivered = await source.query(
    "DELETE FROM growth_source.outbox WHERE delivered_at<now()-interval '30 days' RETURNING id"
  );
  return {
    expiredAnalytics: removed,
    expiredTransport: delivered.rowCount,
    contactsDeleted: 0,
    businessRecordsDeleted: 0
  };
}

// src/server/growthCronHandler.ts
async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!growthEnabled())
    return res.status(404).json({ ok: false, error: "GROWTH_DISABLED" });
  const a = Buffer.from(String(req.headers.authorization || "")), b = Buffer.from("Bearer " + (process.env.CRON_SECRET || ""));
  if (!process.env.CRON_SECRET || a.length !== b.length || !timingSafeEqual(a, b))
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED_CRON" });
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  try {
    const source = await sourceDb(), target = await growthDb();
    const result = await drainOutbox(source, target, 500);
    const retention = await maintainRetention(source, target);
    res.json({ ok: true, ...result, retention });
  } catch {
    return res.status(503).json({ ok: false, error: "GROWTH_WORKER_UNAVAILABLE" });
  }
}
export {
  handler as default
};
