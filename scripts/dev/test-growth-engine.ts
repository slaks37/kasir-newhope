// All records are synthetic; no production DB, Auth, payments or AI network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../../services/shared/db";
import { registerAdminRoutes } from "../../src/server/adminRoutes";
import { registerGrowthRoutes } from "../../src/server/growth/routes";
import {
  GROWTH_WORKSPACE,
  inWorkspace,
  growthEnabled,
} from "../../src/server/growth/db";
import * as svc from "../../src/server/growth/service";
import {
  SIGNALS,
  scoreLead,
  trialHealth,
  allowedCommunication,
  type GrowthEvent,
} from "../../src/lib/growth/model";
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
let server: ReturnType<express.Express["listen"]> | undefined;
const actor = randomUUID(),
  growth = randomUUID(),
  support = randomUUID(),
  other = randomUUID();
let passed = 0;
const ok = (name: string) => {
  console.log("PASS " + name);
  passed++;
};
try {
  await pg.exec(
    "CREATE SCHEMA internal; CREATE TABLE internal.internal_users(id uuid PRIMARY KEY,email text,full_name text,role text,sso_subject text,is_active boolean DEFAULT true,updated_at timestamptz); CREATE TABLE internal.internal_access_log(id uuid,internal_user_id uuid,internal_role text,target_id uuid,action text,resource text,justification text,ip_address text,request_id text,user_agent text);",
  );
  const migration = fs.readFileSync("growth/migrations/001_core.sql", "utf8");
  await pg.exec(migration);
  await pg.exec(migration);
  await pg.exec(
    fs.readFileSync("growth/migrations/002_integration.sql", "utf8"),
  );
  for (const [id, role] of [
    [actor, "ROLE_SUPERADMIN"],
    [growth, "ROLE_INTERNAL_GROWTH"],
    [support, "ROLE_INTERNAL_SUPPORT"],
  ])
    await db.query(
      "INSERT INTO internal.internal_users VALUES($1::uuid,$2,$2,$3,$1::text,true,now())",
      [id, id + "@test.invalid", role],
    );
  process.env.GROWTH_ENGINE_ENABLED = "1";
  process.env.VERCEL_ENV = "preview";
  const app = express();
  app.use(express.json());
  // Existing guard validates real membership+MFA; only the bearer verifier is a fixture.
  registerAdminRoutes(
    app,
    async () => db,
    async (req) => {
      const t = req.headers.authorization?.replace("Bearer ", "");
      if (!t) return null;
      return {
        subject: t === "aal1" || t === "stale" ? actor : t,
        aal: t === "aal1" ? "aal1" : "aal2",
        mfaVerifiedAt:
          Math.floor(Date.now() / 1000) - (t === "stale" ? 900 : 0),
      };
    },
    undefined,
    undefined,
    async () => db,
  );
  // Replace only Growth handlers' DB getter without weakening their existing guard.
  const test = app;
  server = test.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server!.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const call = async (
    path: string,
    token: string | null = actor,
    body?: any,
    method = body ? "POST" : "GET",
  ) => {
    const r = await fetch(base + "/api/admin/growth" + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await call("/overview", null)).status, 401);
  assert.equal((await call("/overview", randomUUID())).status, 403);
  assert.equal((await call("/overview", support)).status, 403);
  assert.equal((await call("/overview", "aal1")).status, 403);
  assert.equal((await call("/overview", growth)).status, 403);
  ok("Unauthenticated, merchant, support, missing grant and aal1 rejected");
  assert.equal(
    (await call("/leads", "stale", { company: "No", sector: "FNB" })).status,
    403,
  );
  process.env.VERCEL_ENV = "production";
  assert.equal(growthEnabled(), false);
  assert.equal(
    growthEnabled({ GROWTH_ENGINE_ENABLED: "1", NODE_ENV: "production" }),
    false,
  );
  assert.equal(
    growthEnabled({
      GROWTH_ENGINE_ENABLED: "1",
      VERCEL_ENV: "preview",
      APP_ENV: "production",
    }),
    false,
  );
  assert.equal((await call("/overview")).status, 404);
  process.env.VERCEL_ENV = "preview";
  ok("Production disabled and stale MFA mutations rejected");
  const input = {
    company: "Laundry sintetis",
    sector: "LAUNDRY",
    outlets: 3,
    email: "laundry@example.invalid",
    consent_basis: "Synthetic consent fixture",
    consent_email: true,
    consent_ai: true,
    owner_id: actor,
  };
  const created = await call("/leads", actor, input);
  assert.equal(created.status, 200, JSON.stringify(created));
  const lead = created.body.lead;
  assert.equal((await call("/leads", actor, input)).status, 409);
  assert.equal(
    (await call("/leads", actor, { ...input, email: "bad" })).status,
    400,
  );
  assert.equal(
    (
      await call("/leads", actor, {
        ...input,
        email: "other@example.invalid",
        owner_id: other,
      })
    ).status,
    400,
  );
  ok(
    "Persistent lead creation, duplicate prevention, validation and assignment boundary",
  );
  const moves = await Promise.all([
    call(
      "/leads/" + lead.id,
      actor,
      { stage: "DEMO", expectedVersion: 1 },
      "PATCH",
    ),
    call(
      "/leads/" + lead.id,
      actor,
      { stage: "QUALIFIED", expectedVersion: 1 },
      "PATCH",
    ),
  ]);
  assert.deepEqual(moves.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await call("/leads/" + lead.id)).body.lead.version, 2);
  ok("Concurrent pipeline edits cannot silently overwrite each other");
  const note = await call("/leads/" + lead.id + "/activities", actor, {
    kind: "task",
    body: "Follow-up sintetis",
    dueAt: new Date().toISOString(),
  });
  assert.equal(note.status, 200);
  assert.equal(
    (
      await call(
        "/activities/" + note.body.activity.id + "/complete",
        actor,
        {},
      )
    ).status,
    200,
  );
  assert.equal((await call("/leads/" + lead.id)).body.activities.length, 2);
  ok("Activity persistence, stage history and task completion");
  const event = {
    signal: "demo_requested",
    eventKey: "demo-fixture-1",
    occurredAt: new Date().toISOString(),
  };
  assert.equal(
    (await call("/leads/" + lead.id + "/events", actor, event)).body.inserted,
    true,
  );
  assert.equal(
    (await call("/leads/" + lead.id + "/events", actor, event)).body.inserted,
    false,
  );
  assert.equal(
    (
      await call("/leads/" + lead.id + "/events", actor, {
        ...event,
        signal: "synced_transaction",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/leads/" + lead.id + "/events", actor, {
        ...event,
        signal: "referral",
      })
    ).status,
    409,
  );
  ok(
    "Event deduplication, mismatched key conflict and forged operational signal rejection",
  );
  assert.equal(
    (
      await call("/leads/" + lead.id + "/identity-review", actor, {
        subject: randomUUID(),
        evidence: "Pending synthetic ownership review",
      })
    ).body.linked,
    false,
  );
  ok("Identity review never merges or reassigns UUIDs");
  const seedSignals = Object.keys(SIGNALS).filter(
    (k) => k !== "pricing_interest",
  );
  await inWorkspace(db, async (c) => {
    for (const signal of seedSignals)
      await svc.recordEvent(
        c,
        {
          leadId: lead.id,
          signal,
          key: "synthetic:" + signal,
          occurredAt: new Date(Date.now() - 86400000).toISOString(),
        },
        "server",
        true,
      );
  });
  const profile = (await call("/leads/" + lead.id)).body;
  assert.equal(profile.lead.classification, "PQL");
  assert.ok(
    profile.lead.reasons.some((r: any) => r.signal === "synced_transaction"),
  );
  assert.equal(profile.trial.daysRemaining, 44);
  assert.equal(profile.trial.activated, true);
  const now = new Date("2026-10-19T00:00:00Z");
  const events: GrowthEvent[] = [
    {
      lead_id: lead.id,
      signal: "signup",
      verified: true,
      occurred_at: "2026-09-04T00:00:00Z",
    },
  ];
  assert.equal(trialHealth(events, now).daysRemaining, 0);
  assert.equal(trialHealth(events, now).atRisk, true);
  assert.equal(
    scoreLead([{ ...events[0], signal: "synced_transaction", verified: false }])
      .score,
    0,
  );
  ok(
    "Explainable PQL, verified-only scoring, 45-day trial and expiry boundaries",
  );
  const overview = (await call("/overview")).body.overview;
  assert.equal(overview.totalLeads, 1);
  assert.equal(overview.pql, 1);
  assert.equal(overview.activationRate, 1);
  assert.ok(overview.unavailable.includes("MRR"));
  ok("Dashboard metrics derive from stored evidence; no invented financials");
  const ai = (await call("/leads/" + lead.id + "/copilot", actor, {})).body
    .brief;
  assert.equal(ai.source, "rules");
  assert.ok(ai.hypotheses.length);
  assert.ok(!JSON.stringify(ai).includes(input.email));
  process.env.GROWTH_AI_ENABLED = "1";
  process.env.AGNES_API_KEY = "synthetic-provider-fixture";
  const invalid = await inWorkspace(db, (c) =>
    svc.copilot(c, actor, lead.id, async (options) => {
      assert.ok(!options.user.includes(input.email));
      return {
        text: '{"revenue":99999999}',
        promptTokens: 0,
        completionTokens: 0,
      };
    }),
  );
  assert.equal(invalid.source, "rules");
  const unavailable = await inWorkspace(db, (c) =>
    svc.copilot(c, actor, lead.id, async () => {
      throw Error("Synthetic provider outage");
    }),
  );
  assert.equal(unavailable.source, "rules");
  process.env.GROWTH_AI_ENABLED = "0";
  delete process.env.AGNES_API_KEY;
  ok(
    "Invalid AI output and provider failures fall back without transmitting contact data",
  );
  const opt = (await call("/leads/" + lead.id + "/opt-out", actor, {})).body
    .lead;
  assert.equal(allowedCommunication(opt, "email"), false);
  assert.equal(
    (
      await call(
        "/leads/" + lead.id,
        actor,
        { consent_email: true, expectedVersion: opt.version },
        "PATCH",
      )
    ).status,
    409,
  );
  ok("Consent withdrawal, opt-out enforcement and safe Copilot fallback");
  assert.equal(
    (
      await call(
        "/settings",
        actor,
        { weights: { ...SIGNALS, signup: 41 }, expectedVersion: 0 },
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/settings",
        actor,
        { weights: { ...SIGNALS, signup: 12 }, expectedVersion: 0 },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/settings",
        actor,
        { weights: { ...SIGNALS }, expectedVersion: 0 },
        "PUT",
      )
    ).status,
    409,
  );
  ok("Scoring configuration validation and optimistic versioning");
  assert.equal(
    (
      await call("/imports", actor, {
        leads: [
          { company: "Import valid", sector: "FNB" },
          { company: "Bad", sector: "WRONG" },
        ],
      })
    ).status,
    400,
  );
  assert.equal((await call("/overview")).body.overview.totalLeads, 1);
  assert.equal(
    (await call("/imports", actor, { leads: [input] })).body.duplicates,
    1,
  );
  const csv = svc.safeCsv([{ ...lead, company: '=WEBSERVICE("bad")' }]);
  assert.ok(csv.includes("'=WEBSERVICE"));
  ok("Atomic validated imports, duplicate reporting and CSV formula escaping");
  assert.equal(
    (await call("/operators/" + growth, actor, { canManage: false }, "PUT"))
      .status,
    200,
  );
  assert.equal((await call("/overview", growth)).status, 200);
  for (const [path, body] of [
    ["/leads/" + lead.id + "/link-invites", {}],
    ["/identity-links/" + actor + "/approve", {}],
    ["/leads/" + lead.id + "/anonymize", { confirm: true }],
    ["/integration/drain", {}],
    ["/integration/retry", { id: actor }],
  ] as const) {
    assert.equal((await call(path, growth, body)).status, 403, path);
    assert.equal((await call(path, null, body)).status, 401, path);
    assert.equal((await call(path, "stale", body)).status, 403, path);
  }
  ok(
    "M2 identity, retention, worker and retry endpoints deny non-Superadmin, anonymous and stale MFA mutations",
  );

  assert.equal(
    (await call("/leads", growth, { company: "Blocked", sector: "FNB" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        "/settings",
        growth,
        { weights: SIGNALS, expectedVersion: 1 },
        "PUT",
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/operators/" + growth + "/revoke", actor, {})).status,
    200,
  );
  assert.equal((await call("/overview", growth)).status, 403);
  ok(
    "Read-only operator grants, settings restrictions and immediate revocation",
  );
  await pg.exec(
    `CREATE ROLE growth_test NOLOGIN; GRANT USAGE ON SCHEMA growth TO growth_test; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA growth TO growth_test;`,
  );
  await db.query(
    "INSERT INTO growth.workspaces VALUES($1,'Other workspace',true)",
    [other],
  );
  await inWorkspace(
    db,
    (c) =>
      c.query(
        "INSERT INTO growth.leads(workspace_id,company,sector) VALUES($1,'Private other workspace','FNB')",
        [other],
      ),
    other,
  );
  await pg.exec("SET ROLE growth_test");
  await pg.exec("BEGIN");
  await db.query("SELECT set_config('app.growth_workspace',$1,true)", [
    GROWTH_WORKSPACE,
  ]);
  assert.equal(
    Number((await db.query("SELECT count(*) FROM growth.leads")).rows[0].count),
    1,
  );
  await assert.rejects(() =>
    db.query(
      "INSERT INTO growth.leads(workspace_id,company,sector) VALUES($1,'Cross workspace','FNB')",
      [other],
    ),
  );
  await pg.exec("ROLLBACK; RESET ROLE;");
  ok(
    "PostgreSQL RLS hides other workspaces and rejects cross-workspace writes",
  );
  const audit = await inWorkspace(db, (c) =>
    c.query("SELECT count(*) FROM growth.audit"),
  );
  assert.ok(Number(audit.rows[0].count) > 10);
  ok("Growth access and mutations audited without copying contact payloads");
  console.log(`Growth Engine: ${passed} security and regression groups PASS`);
} finally {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  await pg.close();
}
