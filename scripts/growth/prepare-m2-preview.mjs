// Explicit existing isolated preview target. No production, parent database or auth mutation.
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import dotenv from "dotenv";
const source = dotenv.parse(
  fs.readFileSync("../kasir-newhope/.env.neon-hybrid-candidate.local"),
);
const rehearsal = dotenv.parse(
  fs.readFileSync("../kasir-newhope/.env.neon-prelaunch-rehearsal.local"),
);
if (rehearsal.NEON_BRANCH_ID !== "br-orange-union-azwj2z2e")
  throw Error("ISOLATED_BRANCH_REQUIRED");
const u = new URL(source.NEON_RESTORE_DATABASE_URL);
u.hostname = new URL(rehearsal.DATABASE_URL).hostname.replace("-pooler", "");
u.pathname = "/newhope_growth_preview";
if (u.hostname !== "ep-long-glade-azcugn8m.c-3.ap-southeast-1.aws.neon.tech")
  throw Error("WRONG_TARGET");
for (const k of ["sslmode", "uselibpqcompat"]) u.searchParams.delete(k);
const c = new pg.Client({
  connectionString: u.toString(),
  ssl: { rejectUnauthorized: true },
});
try {
  await c.connect();
  const r = (await c.query("SELECT current_database() db,current_user role"))
    .rows[0];
  if (r.db !== "newhope_growth_preview" || r.role !== "neondb_owner")
    throw Error("OWNER_PREVIEW_ONLY");
  for (const f of [
    "growth/migrations/002_integration.sql",
    "growth/source/001_outbox.sql",
  ])
    await c.query(fs.readFileSync(f, "utf8"));
  for (const f of fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith("_business_scoped_operational_state.sql"))
    .sort())
    await c.query(fs.readFileSync("supabase/migrations/" + f, "utf8"));
  await c.query(
    fs.readFileSync("docs/security/free-plan-selection.sql", "utf8"),
  );
  const runtime = "newhope_growth_preview_runtime",
    worker = "newhope_growth_preview_worker";
  const env = dotenv.parse(fs.readFileSync(".env.growth-preview.local"));
  if (
    !(await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [worker]))
      .rowCount
  ) {
    const pw = crypto.randomBytes(40).toString("base64url");
    await c.query(
      `CREATE ROLE ${worker} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${pw}'`,
    );
    const w = new URL(env.DATABASE_URL);
    w.username = worker;
    w.password = pw;
    env.GROWTH_SOURCE_DATABASE_URL = w.toString();
  } else if (!env.GROWTH_SOURCE_DATABASE_URL)
    throw Error("EXISTING_WORKER_CREDENTIAL_REQUIRED_NO_ROTATION");
  await c.query(
    `GRANT CONNECT ON DATABASE newhope_growth_preview TO ${worker}; GRANT USAGE ON SCHEMA growth_source,internal TO ${worker}; GRANT SELECT ON growth_source.outbox,growth_source.config TO ${worker}; GRANT DELETE ON growth_source.outbox TO ${worker}; GRANT DELETE ON growth.events TO ${runtime}; GRANT UPDATE(attempts,lease_id,lease_until,delivered_at,available_at,dead_at,last_error) ON growth_source.outbox TO ${worker}; GRANT SELECT(id,owner_user_ref,is_active,merged_into) ON internal.tenants TO ${worker},${runtime}; GRANT USAGE ON SCHEMA growth_source TO ${runtime}; GRANT SELECT ON growth_source.config TO ${runtime}; GRANT INSERT ON growth_source.outbox TO ${runtime}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA growth_source TO ${runtime}; GRANT SELECT,INSERT,UPDATE,DELETE ON growth.receipts,growth.link_invites,growth.billing_facts,growth.billing_history,growth.integration_state TO ${runtime}; GRANT UPDATE ON growth.identity_reviews TO ${runtime};`,
  );
  await c.query(
    `DROP POLICY IF EXISTS growth_preview_owner_columns ON internal.tenants; CREATE POLICY growth_preview_owner_columns ON internal.tenants FOR SELECT TO ${worker},${runtime} USING(true)`,
  );
  // Only the isolated synthetic workspace is backfilled. Source images contain IDs,
  // milestones and subscription fields, never customer names, line items or secrets.
  const business = "newhope_growth_preview_business";
  if (
    !(await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [business]))
      .rowCount
  ) {
    const pw = crypto.randomBytes(40).toString("base64url");
    await c.query(
      `CREATE ROLE ${business} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${pw}'`,
    );
    const b = new URL(env.DATABASE_URL);
    b.username = business;
    b.password = pw;
    env.GROWTH_BUSINESS_DATABASE_URL = b.toString();
  } else if (!env.GROWTH_BUSINESS_DATABASE_URL)
    throw Error("EXISTING_BUSINESS_CREDENTIAL_REQUIRED");
  await c.query(
    `GRANT CONNECT ON DATABASE newhope_growth_preview TO ${business};GRANT USAGE ON SCHEMA pos,billing,internal,contract,growth_source TO ${business};GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA pos,billing TO ${business};GRANT SELECT ON ALL TABLES IN SCHEMA contract TO ${business};GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pos,billing,growth_source TO ${business};GRANT SELECT,INSERT ON growth_source.milestones,growth_source.outbox TO ${business};GRANT SELECT ON growth_source.config TO ${business};GRANT EXECUTE ON FUNCTION growth_source.capture_document(text,jsonb),growth_source.subscription_payload(uuid),growth_source.capture_row() TO ${business};GRANT SELECT,INSERT,UPDATE ON internal.tenants,internal.merchants,internal.outlets,internal.users TO ${business};GRANT SELECT ON internal.merchant_settings TO ${business};GRANT INSERT,SELECT(id) ON internal.audit_logs TO ${business};`,
  );
  const tables = (
    await c.query(
      `SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN('pos','billing') OR (schemaname='internal' AND tablename IN('tenants','merchants','outlets','users','merchant_settings','audit_logs'))`,
    )
  ).rows;
  for (const t of tables) {
    const rel = '"' + t.schemaname + '"."' + t.tablename + '"';
    await c.query(
      `DROP POLICY IF EXISTS growth_preview_business_service ON ${rel};CREATE POLICY growth_preview_business_service ON ${rel} TO ${business} USING(true) WITH CHECK(true)`,
    );
  }
  // No grants on CRM or internal administrator memberships to the business role.
  await c.query("BEGIN");
  await c.query(
    "UPDATE growth_source.config SET enabled=true WHERE singleton AND data_class='synthetic'",
  );
  for (const rel of [
    "internal.tenants",
    "internal.merchants",
    "internal.outlets",
    "pos.products",
    "pos.transactions",
    "billing.subscriptions",
  ])
    await c.query(
      `SELECT growth_source.capture_document($1,to_jsonb(r)) FROM ${rel} r`,
      [rel.split(".")[1]],
    );
  await c.query("UPDATE growth_source.config SET backfill_at=now()");
  await c.query("COMMIT");
  env.VITE_GROWTH_ENGINE_ENABLED = "1";
  env.GROWTH_CAPTURE_ENABLED = "1";
  fs.writeFileSync(
    ".env.growth-preview.local",
    Object.entries(env)
      .map(([k, v]) => k + "=" + JSON.stringify(v))
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  fs.chmodSync(".env.growth-preview.local", 0o600);
  console.log(
    "PASS additive M2 migrations + synthetic backfill + restricted worker installed in existing isolated Growth Preview database",
  );
} finally {
  await c.end();
}
