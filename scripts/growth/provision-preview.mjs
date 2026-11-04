// Maintainer-only: isolated preview provisioning. Never accepts a production URL.
import fs from "node:fs";
import path from "node:path";
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
  throw Error("EXPECTED_ISOLATED_REHEARSAL_BRANCH");
const url = new URL(source.NEON_RESTORE_DATABASE_URL);
url.hostname = new URL(rehearsal.DATABASE_URL).hostname.replace("-pooler", "");
url.pathname = "/newhope_growth_preview";
if (
  url.hostname !== "ep-long-glade-azcugn8m.c-3.ap-southeast-1.aws.neon.tech" ||
  url.pathname !== "/newhope_growth_preview"
)
  throw Error("UNAPPROVED_TARGET");
for (const k of ["sslmode", "uselibpqcompat"]) url.searchParams.delete(k);
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  const state = (
    await client.query("SELECT current_database() AS db,current_user AS role")
  ).rows[0];
  if (state.db !== "newhope_growth_preview" || state.role !== "neondb_owner")
    throw Error("WRONG_TARGET");
  console.log("PASS isolated preview owner connectivity and verified TLS");
  if (!process.argv.includes("--apply")) process.exitCode = 0;
  else {
    const present = (
      await client.query(
        "SELECT to_regclass('internal.internal_users') AS present",
      )
    ).rows[0].present;
    if (!present) {
      for (const role of ["anon", "authenticated", "service_role"])
        await client.query(
          `DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`,
        );
      const files = [
        "migrations/0001_compat.sql",
        "schema.sql",
        "schema_hybrid_pos.sql",
        ...fs
          .readdirSync("migrations")
          .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f !== "0001_compat.sql")
          .sort()
          .map((f) => "migrations/" + f),
      ];
      for (const file of files)
        await client.query(fs.readFileSync(file, "utf8"));
      console.log(
        "PASS preview-only business schema installed; zero customer records imported",
      );
    }
    await client.query(
      fs.readFileSync("growth/migrations/001_core.sql", "utf8"),
    );
    const exists = (
      await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname='newhope_growth_preview_runtime'",
      )
    ).rowCount;
    if (exists && fs.existsSync(".env.growth-preview.local"))
      throw Error("RUNTIME_ALREADY_PROVISIONED_USE_EXISTING_PRIVATE_ENV");
    const password = crypto.randomBytes(40).toString("base64url");
    await client.query(
      exists
        ? `ALTER ROLE newhope_growth_preview_runtime LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`
        : `CREATE ROLE newhope_growth_preview_runtime LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`,
    );
    await client.query(
      "GRANT CONNECT ON DATABASE newhope_growth_preview TO newhope_growth_preview_runtime",
    );
    await client.query(
      "GRANT USAGE ON SCHEMA growth,internal,billing TO newhope_growth_preview_runtime",
    );
    await client.query(
      "GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA growth TO newhope_growth_preview_runtime",
    );
    await client.query(
      "GRANT SELECT ON internal.internal_users TO newhope_growth_preview_runtime",
    );
    await client.query(
      "GRANT INSERT ON internal.internal_access_log TO newhope_growth_preview_runtime",
    );
    await client.query(
      "GRANT SELECT,INSERT,UPDATE ON billing.plans TO newhope_growth_preview_runtime",
    );
    await client.query(fs.readFileSync('scripts/growth/preview-grants.sql','utf8'));
    await client.query(
      "UPDATE growth.workspaces SET synthetic=true WHERE id='b1b56887-e47e-45ec-9e10-d58d378709ce'",
    );
    const runtime = new URL(url);
    runtime.hostname = runtime.hostname.replace(".c-3.", "-pooler.c-3.");
    runtime.username = "newhope_growth_preview_runtime";
    runtime.password = password;
    runtime.searchParams.set("sslmode", "verify-full");
    const e = {
      DATABASE_URL: runtime.toString(),
      GROWTH_DATABASE_URL: runtime.toString(),
      GROWTH_ENGINE_ENABLED: "1",
      GROWTH_CAPTURE_ENABLED: "0",
      GROWTH_AI_ENABLED: "0",
      AUTH_PROVIDER: "supabase",
      AUTH_EMAIL_ENABLED: "0",
      DOKU_PAYMENTS_ENABLED: "0",
      SUPABASE_URL: rehearsal.SUPABASE_URL,
      SUPABASE_ANON_KEY: rehearsal.SUPABASE_ANON_KEY,
      VITE_SUPABASE_URL: rehearsal.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: rehearsal.VITE_SUPABASE_ANON_KEY,
    };
    fs.writeFileSync(
      ".env.growth-preview.local",
      Object.entries(e)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    console.log(
      "PASS additive Growth schema and restricted runtime; private env saved mode 600",
    );
  }
} finally {
  await client.end();
}
