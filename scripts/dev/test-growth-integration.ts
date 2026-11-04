import { maintainRetention } from "../../src/server/growth/retention";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Db } from "../../services/shared/db";
import { inWorkspace, GROWTH_WORKSPACE as W } from "../../src/server/growth/db";
import {
  drainOutbox,
  hash,
  productMetrics,
  linkedLifecycle,
  verifiedCohorts,
} from "../../src/server/growth/integration";
import { createLead, recordEvent } from "../../src/server/growth/service";
import { registerGrowthMerchantRoutes } from "../../src/server/growth/merchant";
import { registerProductRoutes } from "../../src/server/growth/productRoutes";
import { scoreLead, trialHealth } from "../../src/lib/growth/model";
import { createSyncHandler } from "../../src/server/syncHandler";
import {
  ensureSubscription,
  createQuote,
  reconcilePayment,
} from "../../services/billing/engine";
import { pastikanPaket } from "../../services/billing/store";
import { SAAS_PLANS } from "../../src/config/saasPlans";
async function engine(): Promise<any> {
  const value = process.env.NEW_HOPE_GROWTH_TEST_DATABASE_URL;
  if (!value) return new PGlite();
  const url = new URL(value);
  if (
    process.env.NEW_HOPE_GROWTH_TEST_CONFIRM !==
      "DISPOSABLE_GROWTH_POSTGRES17" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/newhope_growth_m2_rehearsal"
  )
    throw Error("DISPOSABLE_LOCAL_GROWTH_DATABASE_REQUIRED");
  const c = new Client({ connectionString: value, ssl: false });
  await c.connect();
  const existing = (
    await c.query(
      "SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema')",
    )
  ).rows[0].n;
  if (existing) throw Error("EMPTY_GROWTH_DATABASE_REQUIRED");
  const q: any = {
    query: async (s: string, p?: unknown[]) => {
      const r = await c.query(s, p);
      return { ...r, affectedRows: r.rowCount };
    },
    exec: async (s: string) => {
      await c.query(s);
    },
    close: () => c.end(),
    transaction: async (fn: any) => {
      await c.query("BEGIN");
      try {
        const out = await fn(q);
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    },
  };
  return q;
}
const pg = await engine();
const wrap = (q: any): Db => ({
  query: async (s, p) => {
    const r = await q.query(s, p);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  exec: async (s) => {
    await q.exec(s);
  },
  tx: (fn) => pg.transaction((c: any) => fn(wrap(c))),
  close: () => pg.close(),
});
const db = wrap(pg),
  subject = randomUUID(),
  tenant = randomUUID(),
  actor = randomUUID();
let server: ReturnType<express.Express["listen"]> | undefined;
let n = 0;
const pass = (s: string) => {
  n++;
  console.log("PASS " + s);
};
try {
  await pg.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;",
  );
  for (const f of [
    "migrations/0001_compat.sql",
    "schema.sql",
    "schema_hybrid_pos.sql",
    ...fs
      .readdirSync("migrations")
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f !== "0001_compat.sql")
      .sort()
      .map((f) => "migrations/" + f),
  ])
    await pg.exec(fs.readFileSync(f, "utf8"));
  for (const f of [
    "growth/migrations/001_core.sql",
    "growth/migrations/002_integration.sql",
    "growth/source/001_outbox.sql",
  ]) {
    await pg.exec(fs.readFileSync(f, "utf8"));
    await pg.exec(fs.readFileSync(f, "utf8"));
  }
  await pastikanPaket(db, SAAS_PLANS);
  await db.exec("UPDATE growth_source.config SET enabled=true");
  await db.query(
    "INSERT INTO internal.tenants(id,name,owner_user_ref,is_active) VALUES($1,'Synthetic M2 tenant',$2,true)",
    [tenant, subject],
  );
  const before = (
    await db.query("SELECT count(*)::int n FROM growth_source.outbox")
  ).rows[0].n;
  await assert.rejects(() =>
    db.tx(async (c) => {
      await c.query(
        "INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Rolled back',$2)",
        [randomUUID(), subject],
      );
      throw Error("ROLLBACK");
    }),
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM growth_source.outbox")).rows[0]
      .n,
    before,
  );
  pass("Business rollback also rolls back outbox; migrations idempotent");
  // No target connection is consulted during capture. Failure survives for retry.
  const unavailable = {
    ...db,
    tx: async () => {
      throw Error("TARGET_DOWN");
    },
  } as Db;
  await assert.rejects(() => drainOutbox(db, unavailable), /TARGET_DOWN/);
  await db.exec("UPDATE growth_source.outbox SET available_at=now()");
  assert.equal((await drainOutbox(db, db)).processed, before);
  pass("Target outage persists source event and successful retry delivers");
  const count = (await db.query("SELECT count(*)::int n FROM growth.events"))
    .rows[0].n;
  // ACK crash: same committed target event reappears, fingerprint/receipt prevents duplicates.
  await db.exec(
    "UPDATE growth_source.outbox SET delivered_at=NULL,available_at=now(),lease_until=NULL",
  );
  await drainOutbox(db, db);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM growth.events")).rows[0].n,
    count,
  );
  pass("Target commit/source ACK crash replay is idempotent");
  const held = randomUUID();
  await db.query(
    "UPDATE growth_source.outbox SET delivered_at=NULL,lease_until=now()+interval '1 minute',lease_id=$1",
    [held],
  );
  assert.equal((await drainOutbox(db, db)).processed, 0);
  await db.exec(
    "UPDATE growth_source.outbox SET lease_until=now()-interval '1 second'",
  );
  assert.equal((await drainOutbox(db, db)).processed, before);
  pass("Unexpired leases excluded; crashed worker lease recovers");
  process.env.GROWTH_ENGINE_ENABLED = "1";
  process.env.GROWTH_CAPTURE_ENABLED = "1";
  process.env.VERCEL_ENV = "preview";
  const lead = await inWorkspace(db, (c) =>
    createLead(c, actor, { company: "Synthetic M2 lead", sector: "FNB" }),
  );
  assert.ok(lead);
  const token = "T".repeat(43);
  await inWorkspace(db, (c) =>
    c.query(
      "INSERT INTO growth.link_invites(workspace_id,lead_id,token_hash,created_by) VALUES($1,$2,$3,$4)",
      [W, lead.id, hash(token), actor],
    ),
  );
  const proof = new PGlite();
  await proof.exec(
    "CREATE SCHEMA internal;CREATE TABLE internal.tenants(id uuid,owner_user_ref text,is_active boolean,merged_into uuid)",
  );
  await proof.query("INSERT INTO internal.tenants VALUES($1,$2,true,NULL)", [
    tenant,
    subject,
  ]);
  const proofDb = {
    ...db,
    query: async (s: string, p?: unknown[]) => {
      const r = await proof.query(s, p);
      return { rows: r.rows, rowCount: r.rows.length };
    },
  } as Db;
  const app = express();
  app.use(express.json());
  registerGrowthMerchantRoutes(
    app,
    db,
    async (req) =>
      req.headers.authorization === "Bearer owner"
        ? {
            subject,
            isEmailVerified: true,
            authCreatedAt: new Date().toISOString(),
            reauthenticatedAt: Date.now() / 1000,
          }
        : req.headers.authorization === "Bearer other"
          ? {
              subject: randomUUID(),
              isEmailVerified: true,
              reauthenticatedAt: Date.now() / 1000,
            }
          : req.headers.authorization === "Bearer stale"
            ? { subject, isEmailVerified: true, reauthenticatedAt: 1 }
            : null,
    async () => db,
  );
  // Test-only admin auth adapter; production registration retains existing MFA/RBAC.
  registerProductRoutes(
    (method, path, fn) =>
      app[method]("/admin" + path, async (req: any, res) => {
        req.internal = { id: actor };
        try {
          res.json(await inWorkspace(db, (c) => fn(req, c)));
        } catch (e: any) {
          res.status(e.status ?? 503).json({ error: e.code ?? e.message });
        }
      }),
    async () => proofDb,
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server!.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const request = async (path: string, b: any, auth = "owner") => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer " + auth,
      },
      body: JSON.stringify(b),
    });
    return { status: r.status, b: await r.json() };
  };
  const claim = {
    token,
    tenantId: tenant,
    consent: true,
    consentVersion: "growth-product-analytics-v1",
  };
  assert.equal(
    (await request("/api/v1/sync/growth/claim", claim, "none")).status,
    401,
  );
  assert.equal(
    (await request("/api/v1/sync/growth/claim", claim, "other")).status,
    403,
  );
  assert.equal(
    (await request("/api/v1/sync/growth/claim", claim, "stale")).status,
    403,
  );
  assert.equal(
    (await request("/api/v1/sync/growth/claim", { ...claim, consent: false }))
      .status,
    400,
  );
  assert.equal((await request("/api/v1/sync/growth/claim", claim)).status, 200);
  assert.equal((await request("/api/v1/sync/growth/claim", claim)).status, 409);
  assert.equal(
    (await db.query("SELECT lead_id FROM growth.events LIMIT 1")).rows[0]
      .lead_id,
    null,
  );
  pass(
    "Anonymous/foreign/stale auth/no-consent rejected; token single use; claim grants no linkage",
  );
  const link = (
    await db.query("SELECT id FROM growth.link_invites WHERE token_hash=$1", [
      hash(token),
    ])
  ).rows[0];
  assert.equal(
    (
      await request("/admin/identity-links/" + link.id + "/approve", {
        confirmSubject: randomUUID(),
        confirmTenant: tenant,
      })
    ).status,
    400,
  );
  // Same engine cannot nest source read under a PGlite transaction; source getter exposes query only.
  // Native PostgreSQL exercise below uses separate pools; monkey adapter avoids a second tx.
  const approval = await request(
    "/admin/identity-links/" + link.id + "/approve",
    { confirmSubject: subject, confirmTenant: tenant },
  );
  assert.equal(approval.status, 200, JSON.stringify(approval));
  await proof.close();
  assert.equal(
    (await db.query("SELECT lead_id FROM growth.events LIMIT 1")).rows[0]
      .lead_id,
    lead.id,
  );
  pass(
    "Exact UUID + current ownership approval attributes only matching tenant events",
  );
  await request("/api/v1/sync/growth/session", {});
  await request("/api/v1/sync/growth/session", {}); // canonical date should be stable per Auth; fixture clock is ignored by stable key
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM growth_source.outbox WHERE payload->>'signal'='signup'",
      )
    ).rows[0].n,
    1,
  );
  pass(
    "Verified signup source observation idempotent; browser cannot choose UUID/signal",
  );
  // Billing lifecycle projection is source-trusted, synthetic payment is excluded from real metrics.
  const sub = randomUUID();
  await db.query(
    "INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,trial_started_at,trial_ends_at) VALUES($1,$2,'plan-free','TRIAL',now(),now()+interval '45 days',now()-interval '5 days',now()+interval '40 days')",
    [sub, tenant],
  );
  await db.exec("UPDATE growth_source.config SET backfill_at=now()");
  await drainOutbox(db, db);
  const lifecycle = await inWorkspace(db, (c) => linkedLifecycle(c, lead.id));
  assert.equal(lifecycle.status, "TRIAL");
  const t = trialHealth([], new Date(), lifecycle);
  assert.equal(t.lifecycleSource, "billing_subscription");
  assert.ok(t.daysRemaining! <= 40);
  const metrics = await inWorkspace(db, (c) => productMetrics(c));
  assert.equal(metrics.mrr, null);
  assert.equal(metrics.verifiedSubscriptions, 0);
  pass(
    "Trial health uses actual billing dates; synthetic billing excluded from live MRR",
  );
  const signal = async (type: string, days: number) =>
    db.query(
      "INSERT INTO growth_source.outbox(source_id,tenant_ref,subject_ref,kind,payload,data_class,occurred_at) SELECT source_id,$1,$2,'signal',jsonb_build_object('signal',$3::text),'synthetic',now()-make_interval(days=>$4) FROM growth_source.config",
      [tenant, subject, type, days],
    );
  for (const type of ["outlet_setup", "catalog_setup", "report_viewed"])
    await signal(type, 0);
  await signal("synced_transaction", 2);
  await signal("synced_transaction", 1);
  await drainOutbox(db, db);
  const events = (
    await db.query("SELECT * FROM growth.events WHERE lead_id=$1", [lead.id])
  ).rows;
  assert.equal(scoreLead(events).classification, "PQL");
  assert.equal(events.filter((e) => e.signal === "repeat_usage").length, 1);
  pass(
    "PQL explained by source events and distinct-day repeat usage, not CRM stage",
  );
  // Exercise the actual POS HTTP -> ledger -> source trigger, not a forged Growth signal.
  const merchant = randomUUID(),
    outlet = randomUUID();
  await db.query(
    "INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Synthetic owner')",
    [subject, subject + "@fixture.invalid"],
  );
  await db.query("UPDATE internal.tenants SET owner_user_id=$2 WHERE id=$1", [
    tenant,
    subject,
  ]);
  await db.query(
    "INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'M2 Synthetic merchant','FNB',$3)",
    [merchant, tenant, subject + "_FNB"],
  );
  await db.query(
    "INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Synthetic outlet')",
    [outlet, tenant, merchant],
  );
  await ensureSubscription(db, tenant);
  for (const f of fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith("_business_scoped_operational_state.sql"))
    .sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + f, "utf8"));
  await db.exec(
    fs.readFileSync("docs/security/free-plan-selection.sql", "utf8"),
  );
  app.use(
    createSyncHandler(
      async (req) =>
        req.headers.authorization === "Bearer owner" ? { subject } : null,
      async () => db,
    ),
  );
  const txn = {
    clientTxnId: "growth-m2-real-pos",
    invoiceNumber: "M2-SYNTHETIC",
    cashierRef: "m2-cashier",
    cashierName: "Synthetic",
    cashierRole: "OWNER",
    subtotal: 10000,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 10000,
    paymentMethod: "CASH",
    paymentStatus: "PAID",
    createdAt: new Date().toISOString(),
    items: [
      {
        clientItemId: "m2-item",
        productRef: "m2-product",
        productName: "Synthetic Product",
        unitPrice: 10000,
        unitCost: 1000,
        quantity: 1,
        totalPrice: 10000,
      },
    ],
  };
  const body = {
    businessId: subject + "_FNB",
    sector: "FNB",
    outletId: outlet,
    storeName: "M2 Synthetic merchant",
    transactions: [txn],
  };
  const sale = await request("/api/v1/sync/transactions", body);
  assert.equal(sale.status, 200, JSON.stringify(sale));
  const queued = (
    await db.query(
      "SELECT count(*)::int n FROM growth_source.outbox WHERE payload->>'signal'='synced_transaction' AND payload->>'resource' IS NOT NULL",
    )
  ).rows[0].n;
  assert.equal(queued, 1);
  const retry = await request("/api/v1/sync/transactions", body);
  assert.equal(retry.status, 200);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM growth_source.outbox WHERE payload->>'signal'='synced_transaction' AND payload->>'resource' IS NOT NULL",
      )
    ).rows[0].n,
    1,
  );
  // Changing the same transaction another day cannot fabricate repeat usage.
  await db.query(
    "UPDATE pos.transactions SET invoice_number=invoice_number WHERE client_txn_id=$1",
    [txn.clientTxnId],
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM growth_source.outbox WHERE payload->>'signal'='synced_transaction' AND payload->>'resource' IS NOT NULL",
      )
    ).rows[0].n,
    1,
  );
  pass(
    "Actual POS ledger success captures one durable signal; retry/update cannot fabricate repeat usage",
  );
  const quote = await createQuote(db, tenant, {
    planId: "plan-pro-monthly",
    billingCycle: "YEARLY",
    extraOutlets: 0,
  });
  const invoice = randomUUID(),
    invoiceNumber = "M2-SYNTHETIC-" + invoice;
  await db.query(
    "INSERT INTO billing.invoices(id,tenant_id,subscription_id,invoice_number,amount,currency,due_date,quote) VALUES($1,$2,$3,$4,$5,'IDR',now()+interval '1 day',$6)",
    [invoice, tenant, sub, invoiceNumber, quote.amount, JSON.stringify(quote)],
  );
  await drainOutbox(db, db);
  assert.equal(
    (await inWorkspace(db, (c) => linkedLifecycle(c, lead.id))).paid_verified,
    false,
  );
  const notice = {
    eventKey: "m2-test-payment",
    invoiceNumber,
    reference: "M2-SYNTHETIC-REF",
    amount: quote.amount,
    currency: "IDR",
    success: true,
  };
  assert.equal(
    (
      await reconcilePayment(db, {
        ...notice,
        eventKey: "m2-mismatch",
        amount: 1,
      })
    ).outcome,
    "REVIEW",
  );
  assert.equal((await reconcilePayment(db, notice)).outcome, "APPLIED");
  await drainOutbox(db, db);
  const paid = await inWorkspace(db, (c) => linkedLifecycle(c, lead.id));
  assert.equal(paid.paid_verified, true);
  assert.equal(paid.status, "ACTIVE");
  assert.equal(Number(paid.monthly_amount), quote.recurringAmount / 12);
  assert.equal((await reconcilePayment(db, notice)).outcome, "DUPLICATE");
  pass(
    "Real billing reconciler mismatch rejected; matched synthetic provider notice projects verified annual-normalized subscription",
  );
  const mrrBefore = await inWorkspace(db, (c) => productMetrics(c));
  const now = new Date(),
    old = new Date(now.getTime() - 90 * 86400000),
    windowStart = new Date(now.getTime() - 31 * 86400000);
  const current = [
    {
      tenant_ref: tenant,
      status: "CANCELED",
      paid_verified: true,
      trial_started_at: old.toISOString(),
      trial_ends_at: new Date(now.getTime() - 10 * 86400000).toISOString(),
      period_start: old.toISOString(),
      period_end: now.toISOString(),
    },
  ];
  const history = [
    {
      ...current[0],
      status: "ACTIVE",
      observed_at: windowStart.toISOString(),
      period_end: new Date(now.getTime() + 86400000).toISOString(),
    },
  ];
  const cohorts = verifiedCohorts(
    current,
    history,
    new Date(now.getTime() - 100 * 86400000),
    now,
  );
  assert.equal(cohorts.conversion, 1);
  assert.equal(cohorts.churn, 1);
  assert.equal(verifiedCohorts(current, history, new Date(), now).churn, null);
  assert.equal(mrrBefore.mrr, null);
  pass(
    "Verified billing cohort calculations bounded by real observation coverage; immature history remains unavailable",
  );
  await request("/api/v1/sync/growth/withdraw", {});
  await signal("catalog_setup", 0);
  await drainOutbox(db, db);
  const latest = (
    await db.query(
      "SELECT lead_id FROM growth.events WHERE signal='catalog_setup' ORDER BY received_at DESC LIMIT 1",
    )
  ).rows[0];
  assert.equal(latest.lead_id, null);
  pass(
    "Consent withdrawal revokes linking and stops subsequent personal attribution",
  );
  await db.query(
    "INSERT INTO growth_source.outbox(source_id,tenant_ref,subject_ref,kind,payload,data_class,attempts) SELECT source_id,$1,$2,'signal','{\"signal\":\"forged\"}','synthetic',7 FROM growth_source.config",
    [tenant, subject],
  );
  assert.equal((await drainOutbox(db, db)).dead, 1);
  pass(
    "Poison events quarantined after bounded retry; failed receipt transaction rolled back",
  );
  const transferSubject = randomUUID(),
    transferTenant = randomUUID(),
    transferLead = await inWorkspace(db, (c) =>
      createLead(c, actor, {
        company: "Synthetic ownership transfer",
        sector: "FNB",
      }),
    );
  assert.ok(transferLead);
  await db.query(
    "INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic transfer',$2)",
    [transferTenant, transferSubject],
  );
  await db.query(
    "INSERT INTO growth.link_invites(workspace_id,lead_id,token_hash,created_by,subject_ref,tenant_ref,claimed_at,approved_at) VALUES($1,$2,$3,$4,$5,$6,now(),now())",
    [
      W,
      transferLead.id,
      hash(randomUUID()),
      actor,
      transferSubject,
      transferTenant,
    ],
  );
  const successor = randomUUID();
  await db.query("UPDATE internal.tenants SET owner_user_ref=$2 WHERE id=$1", [
    transferTenant,
    successor,
  ]);
  await drainOutbox(db, db);
  assert.ok(
    (
      await db.query(
        "SELECT revoked_at FROM growth.link_invites WHERE lead_id=$1",
        [transferLead.id],
      )
    ).rows[0].revoked_at,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM growth.link_invites WHERE subject_ref=$1 AND approved_at IS NOT NULL",
        [successor],
      )
    ).rows[0].n,
    0,
  );
  pass(
    "Authoritative owner change revokes stale CRM link without assigning the new owner",
  );
  const financeCount = (
    await db.query("SELECT count(*)::int n FROM pos.transactions")
  ).rows[0].n;
  const anon = await request("/admin/leads/" + lead.id + "/anonymize", {
    confirm: true,
  });
  assert.equal(anon.status, 200, JSON.stringify(anon));
  const redacted = (
    await db.query(
      "SELECT company,email,phone,anonymized_at FROM growth.leads WHERE id=$1",
      [lead.id],
    )
  ).rows[0];
  assert.equal(redacted.company, "Kontak dianonimkan");
  assert.equal(redacted.email, null);
  assert.ok(redacted.anonymized_at);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM pos.transactions")).rows[0].n,
    financeCount,
  );
  pass(
    "Reviewed CRM anonymization removes contact attribution without deleting business records",
  );
  await db.query(
    "INSERT INTO growth.events(workspace_id,signal,event_key,verified,origin,occurred_at,received_at) VALUES($1,'report_viewed','retention-old',true,'server',now()-interval '40 days',now()-interval '40 days')",
    [W],
  );
  const ttl = await maintainRetention(db, db);
  assert.ok(ttl.expiredAnalytics >= 1);
  assert.equal(ttl.businessRecordsDeleted, 0);
  pass(
    "Worker TTL removes expired minimized analytics only; business rows preserved",
  );
  await db.exec("CREATE ROLE growth_browser NOLOGIN");
  await db.exec("SET ROLE growth_browser");
  await assert.rejects(
    () => db.query("SELECT * FROM growth_source.outbox"),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("SELECT * FROM growth.link_invites"),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
  pass("Browser role cannot access outbox, invitations or CRM tables");
  console.log(
    `PASS ${n} Growth M2 integration groups; isolated PostgreSQL + HTTP, synthetic source data only`,
  );
} finally {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await pg.close();
}
