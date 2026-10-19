import type express from "express";
import type { Db } from "../../../services/shared/db";
import type { InternalCapability } from "../../lib/rbac/environments";
import { growthEnabled, growthDb, inWorkspace, GROWTH_WORKSPACE } from "./db";
import * as svc from "./service";
import { SIGNALS, STAGES, SECTORS, scoreLead } from "../../lib/growth/model";
export function registerGrowthRoutes(
  app: express.Express,
  getBusinessDb: () => Promise<Db>,
  guard: (cap: InternalCapability) => express.RequestHandler,
  getGrowthDb = growthDb,
) {
  const enabled: express.RequestHandler = (_req, res, next) =>
    growthEnabled()
      ? next()
      : void res.status(404).json({ ok: false, error: "GROWTH_DISABLED" });
  const run =
    (
      fn: (req: any, c: Db) => Promise<any>,
      write = false,
      superOnly = false,
    ): express.RequestHandler =>
    async (req: any, res) => {
      try {
        if (superOnly && req.internal.role !== "ROLE_SUPERADMIN")
          throw new svc.GrowthError(403, "SUPERADMIN_REQUIRED");
        if (req.route.path.includes("/operators"))
          req.growthOperators = (
            await (
              await getBusinessDb()
            ).query(
              "SELECT id,full_name,role FROM internal.internal_users WHERE is_active AND sso_subject IS NOT NULL AND role IN ('ROLE_SUPERADMIN','ROLE_INTERNAL_GROWTH')",
            )
          ).rows;
        const db = await getGrowthDb();
        const result = await inWorkspace(db, async (c) => {
          if (req.internal.role === "ROLE_SUPERADMIN")
            await c.query(
              "INSERT INTO growth.operator_grants(workspace_id,id,can_manage) VALUES($1,$2,true) ON CONFLICT DO NOTHING",
              [GROWTH_WORKSPACE, req.internal.id],
            );
          const permission = (
            await c.query(
              "SELECT can_manage FROM growth.operator_grants WHERE workspace_id=$1 AND id=$2 AND is_active",
              [GROWTH_WORKSPACE, req.internal.id],
            )
          ).rows[0];
          if (
            req.internal.role !== "ROLE_SUPERADMIN" &&
            (!permission || (write && !permission.can_manage))
          )
            throw new svc.GrowthError(403, "GROWTH_OPERATOR_GRANT_REQUIRED");
          await svc.audit(
            c,
            req.internal.id,
            req.method + ":" + req.route.path,
            req.params.id && /^[0-9a-f-]{36}$/i.test(req.params.id)
              ? req.params.id
              : null,
          );
          return fn(req, c);
        });
        res.json({ ok: true, ...result });
      } catch (e: any) {
        const codes: Record<string, [number, string]> = {
          "23505": [409, "DUPLICATE_LEAD_OR_CODE"],
          "23503": [400, "INVALID_RELATIONSHIP"],
          "22P02": [400, "INVALID_INPUT"],
          "42P01": [503, "GROWTH_MIGRATION_REQUIRED"],
        };
        const [status, code] =
          e instanceof svc.GrowthError
            ? [e.status, e.code]
            : (codes[e.code] ?? [503, "GROWTH_UNAVAILABLE"]);
        res.status(status).json({ ok: false, error: code });
      }
    };
  const route = (
    method: "get" | "post" | "patch" | "put",
    path: string,
    fn: (req: any, c: Db) => Promise<any>,
    write = false,
    superOnly = false,
  ) =>
    app[method](
      "/api/admin/growth" + path,
      enabled,
      guard("MANAGE_GROWTH"),
      run(fn, write, superOnly),
    );
  route("get", "/overview", async (_r, c) => ({
    overview: await svc.overview(c),
  }));
  route("get", "/leads", async (r, c) => {
    const q = r.query;
    if (Object.values(q).some((v) => typeof v !== "string"))
      return svc.fail("INVALID_FILTER");
    if (q.stage && !STAGES.includes(q.stage)) return svc.fail("INVALID_STAGE");
    if (q.sector && !SECTORS.includes(q.sector))
      return svc.fail("INVALID_SECTOR");
    const offset = Number(q.offset ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
      return svc.fail("INVALID_OFFSET");
    const params = [
      GROWTH_WORKSPACE,
      q.search ? svc.text(q.search, 100) : "",
      q.stage ?? null,
      q.sector ?? null,
      q.source ? svc.text(q.source, 100) : null,
      q.owner ? svc.uuid(q.owner) : null,
    ];
    const where = `workspace_id=$1 AND ($2='' OR company ILIKE '%'||$2||'%' OR contact_name ILIKE '%'||$2||'%') AND ($3::text IS NULL OR stage=$3) AND ($4::text IS NULL OR sector=$4) AND ($5::text IS NULL OR source=$5) AND ($6::uuid IS NULL OR owner_id=$6)`;
    const rows = (
      await c.query(
        `SELECT * FROM growth.leads WHERE ${where} ORDER BY created_at DESC,id LIMIT 100 OFFSET $7`,
        [...params, offset],
      )
    ).rows;
    const events = (
      await c.query(
        "SELECT lead_id,signal,verified,occurred_at FROM growth.events WHERE workspace_id=$1 AND lead_id=ANY($2::uuid[])",
        [GROWTH_WORKSPACE, rows.map((x) => x.id)],
      )
    ).rows;
    const weights = (await svc.weights(c)).weights;
    return {
      leads: rows.map((l) => ({
        ...l,
        ...scoreLead(
          events.filter((e) => e.lead_id === l.id),
          weights,
        ),
      })),
      total: Number(
        (
          await c.query(
            `SELECT count(*) FROM growth.leads WHERE ${where}`,
            params,
          )
        ).rows[0].count,
      ),
      offset,
    };
  });
  route("get", "/leads/:id", async (r, c) => svc.leadDetails(c, r.params.id));
  route(
    "post",
    "/leads",
    async (r, c) => ({ lead: await svc.createLead(c, r.internal.id, r.body) }),
    true,
  );
  route(
    "patch",
    "/leads/:id",
    async (r, c) => ({
      lead: await svc.updateLead(
        c,
        r.internal.id,
        svc.uuid(r.params.id),
        r.body,
      ),
    }),
    true,
  );
  route(
    "post",
    "/leads/:id/opt-out",
    async (r, c) => {
      const l = await svc.findLead(c, r.params.id);
      await c.query(
        "UPDATE growth.leads SET consent_email=false,consent_whatsapp=false,consent_ai=false,opted_out_at=coalesce(opted_out_at,now()),updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2",
        [GROWTH_WORKSPACE, l.id],
      );
      await c.query(
        "INSERT INTO growth.activities(workspace_id,lead_id,actor_id,kind,body) VALUES($1,$2,$3,'consent','Opt-out: seluruh komunikasi dan transfer AI dinonaktifkan.')",
        [GROWTH_WORKSPACE, l.id, r.internal.id],
      );
      return { lead: await svc.findLead(c, l.id) };
    },
    true,
  );
  route(
    "post",
    "/leads/:id/activities",
    async (r, c) => {
      const id = (await svc.findLead(c, r.params.id)).id;
      const b = r.body;
      if (!["note", "task", "meeting", "call"].includes(b.kind))
        return svc.fail("INVALID_ACTIVITY");
      const body = svc.text(b.body, 5000, true);
      if (b.dueAt && !Number.isFinite(Date.parse(b.dueAt)))
        return svc.fail("INVALID_DATE");
      return {
        activity: (
          await c.query(
            "INSERT INTO growth.activities(workspace_id,lead_id,actor_id,kind,body,due_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              GROWTH_WORKSPACE,
              id,
              r.internal.id,
              b.kind,
              body,
              b.dueAt ?? null,
            ],
          )
        ).rows[0],
      };
    },
    true,
  );
  route(
    "post",
    "/activities/:id/complete",
    async (r, c) => ({
      activity:
        (
          await c.query(
            "UPDATE growth.activities SET completed_at=coalesce(completed_at,now()) WHERE workspace_id=$1 AND id=$2 AND kind='task' RETURNING *",
            [GROWTH_WORKSPACE, svc.uuid(r.params.id)],
          )
        ).rows[0] ?? svc.fail("TASK_NOT_FOUND", 404),
    }),
    true,
  );
  route(
    "post",
    "/leads/:id/events",
    async (r, c) => {
      await svc.findLead(c, r.params.id);
      const b = r.body;
      if (!["demo_requested", "referral"].includes(b.signal))
        return svc.fail("SERVER_VERIFIED_SIGNAL_REQUIRED");
      const result = await svc.recordEvent(
        c,
        {
          leadId: r.params.id,
          signal: b.signal,
          key: svc.text(b.eventKey, 200, true),
          occurredAt: b.occurredAt ?? new Date().toISOString(),
        },
        "operator",
        true,
      );
      return result;
    },
    true,
  );
  route(
    "post",
    "/leads/:id/identity-review",
    async (r, c) => {
      const lead = await svc.findLead(c, r.params.id);
      await c.query(
        "INSERT INTO growth.identity_reviews(workspace_id,lead_id,requested_subject,evidence,requested_by) VALUES($1,$2,$3,$4,$5)",
        [
          GROWTH_WORKSPACE,
          lead.id,
          svc.uuid(r.body.subject),
          svc.text(r.body.evidence, 3000, true),
          r.internal.id,
        ],
      );
      return { status: "PENDING", linked: false };
    },
    true,
    true,
  );
  route(
    "post",
    "/leads/:id/copilot",
    async (r, c) => ({
      brief: await svc.copilot(c, r.internal.id, r.params.id),
    }),
    true,
  );
  route("get", "/settings", async (_r, c) => ({
    ...(await svc.weights(c)),
    limits: {
      trialDays: 45,
      communications: "DRAFT_ONLY",
      model: "rules-v1-unvalidated",
    },
    productionEnabled: false,
  }));
  route(
    "put",
    "/settings",
    async (r, c) => {
      const b = r.body;
      if (
        !b.weights ||
        Object.keys(b.weights).length !== Object.keys(SIGNALS).length ||
        Object.keys(b.weights).some(
          (k) =>
            !Object.hasOwn(SIGNALS, k) ||
            !Number.isInteger(b.weights[k]) ||
            b.weights[k] < 0 ||
            b.weights[k] > 40,
        )
      )
        return svc.fail("INVALID_WEIGHTS");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "growth-settings",
      ]);
      const old = await svc.weights(c);
      if (b.expectedVersion !== old.version)
        return svc.fail("SETTINGS_CHANGED", 409);
      await c.query(
        "INSERT INTO growth.settings(workspace_id,weights,version) VALUES($1,$2,1) ON CONFLICT(workspace_id) DO UPDATE SET weights=EXCLUDED.weights,version=growth.settings.version+1,updated_at=now()",
        [GROWTH_WORKSPACE, JSON.stringify(b.weights)],
      );
      return svc.weights(c);
    },
    true,
    true,
  );
  route("get", "/operators", async (r, c) => {
    const grants = (
      await c.query(
        "SELECT id,can_manage FROM growth.operator_grants WHERE workspace_id=$1 AND is_active",
        [GROWTH_WORKSPACE],
      )
    ).rows;
    const users = r.growthOperators as {
      id: string;
      full_name: string;
      role: string;
    }[];
    return {
      operators: users
        .filter((u) => grants.some((g) => g.id === u.id))
        .map((u) => ({
          ...u,
          can_manage:
            u.role === "ROLE_SUPERADMIN" ||
            grants.some((g) => g.id === u.id && g.can_manage),
        })),
      candidates: r.internal.role === "ROLE_SUPERADMIN" ? users : [],
    };
  });
  route(
    "put",
    "/operators/:id",
    async (r, c) => {
      const id = svc.uuid(r.params.id);
      if (typeof r.body.canManage !== "boolean")
        return svc.fail("INVALID_GRANT");
      const user = r.growthOperators.find((u: any) => u.id === id);
      if (!user) return svc.fail("VERIFIED_INTERNAL_OPERATOR_REQUIRED");
      await c.query(
        "INSERT INTO growth.operator_grants(workspace_id,id,can_manage) VALUES($1,$2,$3) ON CONFLICT(workspace_id,id) DO UPDATE SET can_manage=EXCLUDED.can_manage,is_active=true",
        [GROWTH_WORKSPACE, id, r.body.canManage],
      );
      return { granted: true };
    },
    true,
    true,
  );
  route(
    "post",
    "/operators/:id/revoke",
    async (r, c) => {
      await c.query(
        "UPDATE growth.operator_grants SET is_active=false WHERE workspace_id=$1 AND id=$2",
        [GROWTH_WORKSPACE, svc.uuid(r.params.id)],
      );
      return { revoked: true };
    },
    true,
    true,
  );
  route("get", "/partners", async (_r, c) => ({
    partners: (
      await c.query(
        "SELECT p.*,count(l.id)::int AS referred,count(l.id) FILTER(WHERE l.stage='QUALIFIED')::int AS qualified FROM growth.partners p LEFT JOIN growth.leads l ON l.workspace_id=p.workspace_id AND l.partner_id=p.id WHERE p.workspace_id=$1 GROUP BY p.workspace_id,p.id ORDER BY p.created_at DESC LIMIT 200",
        [GROWTH_WORKSPACE],
      )
    ).rows,
  }));
  route(
    "post",
    "/partners",
    async (r, c) => {
      const b = r.body;
      if (
        ![
          "community",
          "trainer",
          "consultant",
          "mentor",
          "implementation",
          "software",
          "association",
        ].includes(b.kind) ||
        typeof b.code !== "string" ||
        !/^[A-Za-z0-9_-]{4,64}$/.test(b.code)
      )
        return svc.fail("INVALID_PARTNER");
      return {
        partner: (
          await c.query(
            "INSERT INTO growth.partners(workspace_id,name,kind,code) VALUES($1,$2,$3,$4) RETURNING *",
            [GROWTH_WORKSPACE, svc.text(b.name, 200, true), b.kind, b.code],
          )
        ).rows[0],
      };
    },
    true,
  );
  route(
    "post",
    "/imports",
    async (r, c) => {
      if (
        !Array.isArray(r.body.leads) ||
        r.body.leads.length < 1 ||
        r.body.leads.length > 100
      )
        return svc.fail("IMPORT_LIMIT_100");
      let created = 0,
        duplicates = 0;
      // All rows validate before any insertion; the surrounding transaction is atomic.
      r.body.leads.forEach(svc.leadInput);
      for (const b of r.body.leads) {
        if (await svc.createLead(c, r.internal.id, b, true)) created++;
        else duplicates++;
      }
      return { created, duplicates };
    },
    true,
  );
  route("get", "/export", async (_r, c) => {
    const rows = (
      await c.query(
        "SELECT * FROM growth.leads WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1001",
        [GROWTH_WORKSPACE],
      )
    ).rows;
    if (rows.length > 1000) return svc.fail("EXPORT_LIMIT_1000", 422);
    return { csv: svc.safeCsv(rows) };
  });
}
