import { registerGrowthMerchantRoutes } from "../../src/server/growth/merchant";
import { recordReportAdoption } from "../../src/server/growth/sourceCapture";
// Real Neon staging + real application SQL, synthetic fixture. No Auth account,
// provider request, production row or CRM identity mapping is created.
import fs from "node:fs";
import dotenv from "dotenv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { connectDb } from "../../services/shared/db";
import { growthBusinessConnection } from "../../src/server/growth/businessConnection";
import {
  growthDb,
  inWorkspace,
  GROWTH_WORKSPACE as W,
} from "../../src/server/growth/db";
import { sourceDb } from "../../src/server/growth/sourceDb";
import {
  drainOutbox,
  productMetrics,
} from "../../src/server/growth/integration";
import { createSyncHandler } from "../../src/server/syncHandler";
import {
  ensureSubscription,
  createQuote,
  reconcilePayment,
} from "../../services/billing/engine";
const env = dotenv.parse(fs.readFileSync(".env.growth-preview.local"));
Object.assign(process.env, env, { VERCEL_ENV: "preview" });
for (const key of [
  "DATABASE_URL",
  "GROWTH_SOURCE_DATABASE_URL",
  "GROWTH_BUSINESS_DATABASE_URL",
]) {
  const u = new URL(env[key]);
  assert.equal(u.pathname, "/newhope_growth_preview");
  assert.equal(
    u.hostname,
    "ep-long-glade-azcugn8m-pooler.c-3.ap-southeast-1.aws.neon.tech",
  );
}
const business = await connectDb({
  schema: "pos",
  connectionString: growthBusinessConnection(),
  max: 2,
});
const source = await sourceDb(),
  target = await growthDb();
let server: ReturnType<express.Express["listen"]> | undefined;
const owner = randomUUID(),
  tenant = randomUUID(),
  merchant = randomUUID(),
  outlet = randomUUID();
const checks: string[] = [];
try {
  for (const [db, role] of [
    [business, "newhope_growth_preview_business"],
    [source, "newhope_growth_preview_worker"],
    [target, "newhope_growth_preview_runtime"],
  ] as const) {
    const who = (
      await db.query("SELECT current_database() db,current_user role")
    ).rows[0];
    assert.equal(who.db, "newhope_growth_preview");
    assert.equal(who.role, role);
    const attributes = (
      await db.query(
        "SELECT rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.deepEqual(attributes, {
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
    });
  }
  await assert.rejects(
    () => target.query("SELECT * FROM pos.transactions LIMIT 1"),
    /permission denied/,
  );
  await assert.rejects(
    () => source.query("SELECT * FROM pos.transactions LIMIT 1"),
    /permission denied/,
  );
  await assert.rejects(
    () => business.query("SELECT * FROM growth.leads LIMIT 1"),
    /permission denied/,
  );
  await assert.rejects(
    () => business.query("SELECT * FROM internal.internal_users LIMIT 1"),
    /permission denied/,
  );
  checks.push(
    "Three separate restricted runtime roles; CRM/worker cannot read merchant books; POS cannot read CRM or administrator memberships",
  );
  // Verify the actual business-role TLS connection, not only configuration text.
  const u = new URL(growthBusinessConnection()!);
  const c = new pg.Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: true },
  });
  await c.connect();
  assert.equal((c as any).connection.stream.authorized, true);
  assert.equal((c as any).connection.stream.encrypted, true);
  await c.end();
  checks.push("Verified TLS to Neon pooler");
  await business.query(
    "INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'M2 synthetic account')",
    [owner, owner + "@fixture.invalid"],
  );
  await business.query(
    "INSERT INTO internal.tenants(id,name,owner_user_ref,owner_user_id) VALUES($1,'GROWTH M2 SYNTHETIC',$2::text,$2::uuid)",
    [tenant, owner],
  );
  await business.query(
    "INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'GROWTH M2 SYNTHETIC','FNB',$3)",
    [merchant, tenant, owner + "_FNB"],
  );
  await business.query(
    "INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'GROWTH M2 SYNTHETIC')",
    [outlet, tenant, merchant],
  );
  const sub = await ensureSubscription(business, tenant);
  const app = express();
  app.use(express.json());
  registerGrowthMerchantRoutes(
    app,
    business,
    async (req) =>
      req.headers.authorization === "Bearer synthetic-fixture"
        ? {
            subject: owner,
            isEmailVerified: true,
            authCreatedAt: new Date().toISOString(),
            reauthenticatedAt: Date.now() / 1000,
          }
        : null,
    async () => target,
  );
  app.use(
    createSyncHandler(
      async (req) =>
        req.headers.authorization === "Bearer synthetic-fixture"
          ? { subject: owner }
          : null,
      async () => business,
    ),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server!.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const signup = await fetch(base + "/api/v1/sync/growth/session", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-fixture" },
  });
  assert.equal(signup.status, 200, await signup.text());
  await recordReportAdoption(business, owner, tenant);
  checks.push(
    "Native restricted-role signup observation and report adoption SQL",
  );
  const txn = {
    clientTxnId: "growth-m2-" + randomUUID(),
    invoiceNumber: "GROWTH-M2-SYNTHETIC",
    cashierRef: "m2-cashier",
    cashierName: "Synthetic",
    cashierRole: "OWNER",
    subtotal: 10000,
    totalAmount: 10000,
    paymentMethod: "CASH",
    paymentStatus: "PAID",
    createdAt: new Date().toISOString(),
    items: [
      {
        clientItemId: "m2-item",
        productRef: "m2-product",
        productName: "M2 SYNTHETIC",
        unitPrice: 10000,
        unitCost: 1000,
        quantity: 1,
        totalPrice: 10000,
      },
    ],
  };
  const post = async () => {
    const r = await fetch(base + "/api/v1/sync/transactions", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        businessId: owner + "_FNB",
        sector: "FNB",
        outletId: outlet,
        storeName: "GROWTH M2 SYNTHETIC",
        transactions: [txn],
      }),
    });
    return { status: r.status, body: await r.json() };
  };
  const sale = await post();
  assert.equal(sale.status, 200, JSON.stringify(sale));
  assert.equal((await post()).status, 200);
  const captured = (
    await source.query(
      "SELECT count(*)::int n FROM growth_source.outbox WHERE tenant_ref=$1 AND payload->>'signal'='synced_transaction'",
      [tenant],
    )
  ).rows[0].n;
  assert.equal(captured, 1);
  checks.push(
    "Real HTTP POS sync -> canonical cash ledger -> transactional source outbox; retry produces one adoption event",
  );
  const quote = await createQuote(business, tenant, {
    planId: "plan-pro-monthly",
    billingCycle: "YEARLY",
    extraOutlets: 0,
  });
  const invoice = randomUUID(),
    number = "M2-SYNTHETIC-" + invoice;
  await business.query(
    "INSERT INTO billing.invoices(id,tenant_id,subscription_id,invoice_number,amount,currency,due_date,quote) VALUES($1,$2,$3,$4,$5,'IDR',now()+interval '1 day',$6)",
    [invoice, tenant, sub.id, number, quote.amount, JSON.stringify(quote)],
  );
  const notice = {
    eventKey: "m2-synthetic-" + invoice,
    invoiceNumber: number,
    reference: "M2-SYNTHETIC-" + invoice,
    amount: quote.amount,
    currency: "IDR",
    success: true,
  };
  assert.equal((await reconcilePayment(business, notice)).outcome, "APPLIED");
  assert.equal((await reconcilePayment(business, notice)).outcome, "DUPLICATE");
  checks.push(
    "Real billing reconciler with explicit synthetic notice, verified annual subscription projection; no provider/payment request",
  );
  const start = performance.now();
  const result = await drainOutbox(source, target, 500);
  assert.equal(result.failed, 0);
  assert.equal(result.dead, 0);
  const elapsedMs = Math.round(performance.now() - start);
  const stats = await inWorkspace(target, async (c) => ({
    metrics: await productMetrics(c),
    events: (
      await c.query(
        "SELECT signal,data_class FROM growth.events WHERE workspace_id=$1 AND tenant_ref=$2",
        [W, tenant],
      )
    ).rows,
    fact: (
      await c.query(
        "SELECT status,monthly_amount,paid_verified,data_class FROM growth.billing_facts WHERE workspace_id=$1 AND tenant_ref=$2",
        [W, tenant],
      )
    ).rows[0],
  }));
  assert.ok(stats.events.some((e) => e.signal === "synced_transaction"));
  assert.equal(stats.fact.paid_verified, true);
  assert.equal(stats.fact.data_class, "synthetic");
  assert.equal(stats.metrics.mrr, null);
  checks.push(
    "Durable worker delivery on real Neon; synthetic billing excluded from live MRR",
  );
  fs.mkdirSync("build/growth-m2", { recursive: true });
  fs.writeFileSync(
    "build/growth-m2/neon.json",
    JSON.stringify(
      {
        pass: true,
        synthetic: true,
        productionModified: false,
        checks,
        worker: result,
        workerElapsedMs: elapsedMs,
        tenantFixture: tenant,
        recordsPreserved: true,
        metrics: stats.metrics,
        scope: "existing isolated newhope_growth_preview only",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      pass: true,
      checks,
      workerElapsedMs: elapsedMs,
      worker: result,
      liveMrr: stats.metrics.mrr,
    }),
  );
} finally {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await business.close();
  await source.close();
  await target.close();
}
