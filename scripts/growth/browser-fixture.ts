// Local test entry point only. Never imported by application code or deployed APIs.
import express from "express";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../../services/shared/db";
import { registerAdminRoutes } from "../../src/server/adminRoutes";
import { inWorkspace, GROWTH_WORKSPACE } from "../../src/server/growth/db";
import { createLead, recordEvent } from "../../src/server/growth/service";
const pg = new PGlite();
const wrap = (q: any): Db => ({
  query: async (s, p) => {
    const r = await q.query(s, p);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  exec: (s) => q.exec(s),
  tx: (fn) => pg.transaction((t) => fn(wrap(t))),
  close: () => pg.close(),
});
const db = wrap(pg);
await pg.exec(
  "CREATE SCHEMA internal; CREATE TABLE internal.internal_users(id uuid PRIMARY KEY,email text,full_name text,role text,sso_subject text,is_active boolean DEFAULT true,updated_at timestamptz); CREATE TABLE internal.internal_access_log(id uuid,internal_user_id uuid,internal_role text,target_id uuid,action text,resource text,justification text,ip_address text,request_id text,user_agent text);",
);
await pg.exec(fs.readFileSync("growth/migrations/001_core.sql", "utf8"));
await pg.exec(fs.readFileSync("growth/migrations/002_integration.sql","utf8"));
const actor = "00000000-0000-4000-8000-000000000001";
await db.query(
  "INSERT INTO internal.internal_users VALUES($1::uuid,'fixture@example.invalid','Operator Sintetis','ROLE_SUPERADMIN',$1::text,true,now())",
  [actor],
);
await db.query("UPDATE growth.workspaces SET synthetic=true WHERE id=$1", [
  GROWTH_WORKSPACE,
]);
await inWorkspace(db, async (c) => {
  await c.query(
    "INSERT INTO growth.operator_grants(workspace_id,id,can_manage) VALUES($1,$2,true)",
    [GROWTH_WORKSPACE, actor],
  );
  for (const [i, sector] of [
    "LAUNDRY",
    "FNB",
    "RETAIL",
    "SERVICES",
  ].entries()) {
    const l = await createLead(c, actor, {
      company:
        ["Laundry Pelangi", "Kopi Pagi", "Ritel Sejahtera", "Studio Rapi"][i] +
        " · Sintetis",
      sector,
      outlets: i + 1,
      city: "Jakarta",
      source: ["community", "workshop", "founder_referral", "partner"][i],
      challenges: "Memahami operasional multi-outlet melalui fixture sintetis.",
      consent_basis: "Synthetic fixture only",
    });
    if (!l) throw Error("FIXTURE_FAILED");
    if (i === 1)
      for (const signal of [
        "signup",
        "business_setup",
        "outlet_setup",
        "catalog_setup",
        "synced_transaction",
        "repeat_usage",
      ])
        await recordEvent(
          c,
          {
            leadId: l.id,
            signal,
            key: "fixture:" + signal,
            occurredAt: new Date(Date.now() - 86400000).toISOString(),
          },
          "server",
          true,
        );
  }
});
process.env.GROWTH_ENGINE_ENABLED = "1";
process.env.VERCEL_ENV = "preview";
const app = express();
app.use(express.json());
registerAdminRoutes(
  app,
  async () => db,
  async (req) =>
    req.headers.authorization?.startsWith("Bearer ")
      ? {
          subject: actor,
          aal: "aal2",
          mfaVerifiedAt: Math.floor(Date.now() / 1000),
        }
      : null,
  undefined,
  undefined,
  async () => db,
);
app.use((e: any, _r: any, res: any, _n: any) =>
  res.status(500).json({ ok: false, error: "FIXTURE_ERROR" }),
);
const server = app.listen(5188, "127.0.0.1", () =>
  console.log("GROWTH_BROWSER_FIXTURE_READY"),
);
process.on("SIGTERM", () =>
  server.close(() => void pg.close().then(() => process.exit(0))),
);
