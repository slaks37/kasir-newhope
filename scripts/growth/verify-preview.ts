import fs from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import { growthDb, inWorkspace } from "../../src/server/growth/db";
import { overview } from "../../src/server/growth/service";
import { pastikanPaket } from "../../services/billing/store";
import { SAAS_PLANS } from "../../src/config/saasPlans";
import type { Db } from "../../services/shared/db";
const e = dotenv.parse(fs.readFileSync(".env.growth-preview.local"));
Object.assign(process.env, e, { VERCEL_ENV: "preview" });
const u = new URL(e.DATABASE_URL);
assert.equal(u.pathname, "/newhope_growth_preview");
assert.equal(u.username, "newhope_growth_preview_runtime");
for (const k of ["sslmode", "uselibpqcompat"]) u.searchParams.delete(k);
const c = new pg.Client({
  connectionString: u.toString(),
  ssl: { rejectUnauthorized: true },
});
await c.connect();
try {
  const role = (
    await c.query(
      "SELECT rolbypassrls,rolsuper,rolinherit FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  assert.deepEqual(role, {
    rolbypassrls: false,
    rolsuper: false,
    rolinherit: false,
  });
  const transport = (c as any).connection.stream;
  assert.equal(transport.encrypted, true);
  assert.equal(transport.authorized, true);
  const tls = (
    await c.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()")
  ).rows[0];
  console.log(
    "TLS evidence: client-to-pooler certificate verified; backend pg_stat_ssl=" +
      tls.ssl +
      " (not proof of pooler-to-compute encryption)",
  );
  const admins = (await c.query("SELECT count(*) FROM internal.internal_users"))
    .rows[0];
  assert.ok(Number(admins.count) > 0);
  await assert.rejects(() => c.query("SELECT * FROM pos.transactions LIMIT 1"));
  const wrap = (q: any): Db => ({
    query: async (s, p) => {
      const r = await q.query(s, p);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    exec: async (s) => {
      await q.query(s);
    },
    tx: async (fn) => fn(wrap(q)),
    close: async () => {},
  });
  await pastikanPaket(wrap(c), SAAS_PLANS);
  const db = await growthDb();
  const stats = await inWorkspace(db, overview);
  assert.equal(stats.synthetic, true);
  assert.equal(stats.totalLeads, 6);
  assert.ok(stats.pql >= 1);
  assert.equal(stats.unavailable.includes("MRR"), true);
  await db.close();
  console.log(
    "PASS Neon TLS verification, NOBYPASSRLS/NOINHERIT runtime, actual admin reads, catalog bootstrap, POS denial, RLS-scoped six synthetic leads and persistent metrics",
  );
} finally {
  await c.end();
}
