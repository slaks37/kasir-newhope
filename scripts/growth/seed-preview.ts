import fs from "node:fs";
import pg from "pg";
import dotenv from "dotenv";
import {
  growthDb,
  inWorkspace,
  GROWTH_WORKSPACE,
} from "../../src/server/growth/db";
import { createLead, recordEvent } from "../../src/server/growth/service";
const env = dotenv.parse(fs.readFileSync(".env.growth-preview.local"));
Object.assign(process.env, env, { VERCEL_ENV: "preview" });
const owner = dotenv.parse(
  fs.readFileSync("../kasir-newhope/.env.neon-hybrid-candidate.local"),
);
const rehearsal = dotenv.parse(
  fs.readFileSync("../kasir-newhope/.env.neon-prelaunch-rehearsal.local"),
);
const base = new URL(owner.NEON_RESTORE_DATABASE_URL);
base.hostname = new URL(rehearsal.DATABASE_URL).hostname.replace("-pooler", "");
for (const k of ["sslmode", "uselibpqcompat"]) base.searchParams.delete(k);
const source = new pg.Client({
  connectionString: base.toString(),
  ssl: { rejectUnauthorized: true },
});
await source.connect();
const admins = (
  await source.query(
    "SELECT id,email,full_name,role,sso_subject FROM internal.internal_users WHERE is_active AND role='ROLE_SUPERADMIN' AND sso_subject~'^[0-9a-f-]{36}$'",
  )
).rows;
await source.end();
if (admins.length < 1 || admins.length > 20)
  throw Error("STAGING_INTERNAL_MEMBERSHIP_SCOPE_UNEXPECTED");
base.pathname = "/newhope_growth_preview";
const target = new pg.Client({
  connectionString: base.toString(),
  ssl: { rejectUnauthorized: true },
});
await target.connect();
try {
  const fixtureActor = "00000000-0000-4000-8000-000000000001";
  for (const a of admins)
    await target.query(
      "INSERT INTO internal.internal_users(id,email,full_name,role,sso_subject,is_active) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO NOTHING",
      [a.id, a.email, a.full_name, a.role, a.sso_subject],
    );
  await target.query(
    "REVOKE UPDATE ON growth.audit FROM newhope_growth_preview_runtime",
  );
  await target.query("BEGIN");
  await target.query("SELECT set_config('app.growth_workspace',$1,true)", [
    GROWTH_WORKSPACE,
  ]);
  await target.query(
    "INSERT INTO growth.operator_grants(workspace_id,id,can_manage) VALUES($1,$2,true) ON CONFLICT DO NOTHING",
    [GROWTH_WORKSPACE, fixtureActor],
  );
  await target.query("COMMIT");
  const db = await growthDb();
  await inWorkspace(db, async (c) => {
    const already = Number(
      (
        await c.query(
          "SELECT count(*) FROM growth.leads WHERE workspace_id=$1",
          [GROWTH_WORKSPACE],
        )
      ).rows[0].count,
    );
    if (already) return;
    const partner = (
      await c.query(
        "INSERT INTO growth.partners(workspace_id,name,kind,code) VALUES($1,'Komunitas Uji Sintetis','community','SYNTHETIC2026') RETURNING id",
        [GROWTH_WORKSPACE],
      )
    ).rows[0];
    for (const [i, sector] of [
      "LAUNDRY",
      "FNB",
      "RETAIL",
      "SERVICES",
      "FNB",
      "LAUNDRY",
    ].entries()) {
      const lead = await createLead(c, fixtureActor, {
        company:
          [
            "Laundry Pelangi",
            "Kopi Pagi",
            "Ritel Sejahtera",
            "Studio Rapi",
            "Dapur Lokal",
            "Laundry Bersih",
          ][i] + " · Sintetis",
        sector,
        city: ["Jakarta", "Bandung", "Surabaya"][i % 3],
        outlets: (i % 3) + 1,
        email: `fixture${i}@example.invalid`,
        contact_name: "Kontak Sintetis",
        source: ["community", "workshop", "founder_referral"][i % 3],
        challenges: "Fixture pengujian operasional; bukan prospek sungguhan.",
        consent_basis: "Synthetic fixture, not a real contact consent",
        consent_email: false,
        consent_ai: false,
        stage: ["QUALIFIED", "DEMO", "TRIAL", "ACTIVATED", "PQL", "LEAD"][i],
        owner_id: null,
        partner_id: i % 2 ? null : partner.id,
        next_followup: new Date(Date.now() + 86400000).toISOString(),
      });
      if (!lead) throw Error("SEED_FAILED");
      if (i > 1) {
        const signals = [
          "signup",
          "business_setup",
          "outlet_setup",
          "catalog_setup",
          "synced_transaction",
          "report_viewed",
          "repeat_usage",
        ];
        for (const signal of signals.slice(0, i === 4 ? 7 : i + 1))
          await recordEvent(
            c,
            {
              leadId: lead.id,
              signal,
              key: `synthetic-v1:${i}:${signal}`,
              occurredAt: new Date(
                Date.now() - (i + 1) * 86400000,
              ).toISOString(),
            },
            "server",
            true,
          );
      }
      await c.query(
        "INSERT INTO growth.activities(workspace_id,lead_id,actor_id,kind,body,due_at) VALUES($1,$2,$3,'task','Tinjau kebutuhan operasional pada sesi demo sintetis.',now()+interval '1 day')",
        [GROWTH_WORKSPACE, lead.id, fixtureActor],
      );
    }
  });
  await db.close();
  console.log(
    "PASS existing UUID-bound internal memberships copied without remapping; six synthetic CRM leads seeded in isolated Growth database",
  );
} finally {
  await target.end();
}
