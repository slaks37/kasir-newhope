import type { Db } from "../shared/db";
import type { Express } from "express";
import { trustedPrincipal } from "../shared/auth";
import { hasSchemaFeature } from "../shared/schemaFeatures";
import { ModuleAccessError, resolveModuleAccess } from "./modules";
import {
  resolveWorkspaceScope,
  requireWorkspaceRole,
  type WorkspaceScope,
} from "./workspaceScope";
import { commandHash } from "./financialAuthorization";
import { applyCashEvent, FinanceError } from "./finance";
import { FinancialApprovalError } from "./financialAuthorization";
import { RegisterError, bindRegisterCash } from "./registerOperations";
import { BillingError } from "../billing/engine";
import { jobMoney } from "../../src/platform/modules/jobAmounts";
import {calendarDate} from '../../src/lib/reports/calendarDate';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const managers = ["OWNER", "ADMIN", "MANAGER"];
const args = (s: WorkspaceScope, staff: string) => [
  s.tenantId,
  s.merchantId,
  s.outletId,
  s.moduleId,
  staff,
];
async function ready(c: Db) {
  if (
    process.env.NEW_HOPE_MODULE_DOMAIN_WORKFLOWS !== "1" ||
    !(await hasSchemaFeature(c, "workspaceLabor"))
  )
    throw new ModuleAccessError(403, "WORKSPACE_LABOR_DISABLED");
}
async function staffLock(c: Db, staff: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "labor:" + staff,
  ]);
}
export async function workspaceCommissionRule(
  c: Db,
  s: WorkspaceScope,
  staff: string | null,
) {
  if (!staff || !(await hasSchemaFeature(c, "workspaceLabor"))) return null;
  return (
    (
      await c.query(
        `SELECT kind,rate,revision FROM pos.workspace_commission_rules WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND staff_user_id=$5 ORDER BY revision DESC LIMIT 1`,
        args(s, staff),
      )
    ).rows[0] || null
  );
}
/** Called only after the job's canonical fully-paid completion check, inside its transaction. */
export async function accrueWorkspaceCommission(
  c: Db,
  s: WorkspaceScope,
  j: any,
) {
  if (
    !j.assigned_staff_id ||
    !j.commission_rule ||
    !(await hasSchemaFeature(c, "workspaceLabor"))
  )
    return;
  await staffLock(c, j.assigned_staff_id);
  const receipts = (
    await c.query(
      `SELECT t.id,t.subtotal FROM pos.workspace_job_receipts r JOIN pos.transactions t ON t.id=r.transaction_id WHERE r.job_id=$1 AND t.order_status NOT IN('VOIDED','CANCELLED') ORDER BY t.id`,
      [j.id],
    )
  ).rows;
  let allocated = 0,
    cumulative = 0;
  for (const t of receipts) {
    cumulative = jobMoney(cumulative + Number(t.subtotal));
    const target =
      j.commission_rule.kind === "PERCENTAGE"
        ? jobMoney((cumulative * Number(j.commission_rule.rate)) / 100)
        : jobMoney(
            (Number(j.commission_rule.rate) * cumulative) /
              Number(j.workspace_payload.pricing.gross),
          );
    const amount = jobMoney(target - allocated);
    allocated = target;
    await c.query(
      `INSERT INTO pos.staff_commissions(tenant_id,merchant_id,outlet_id,module_id,transaction_id,job_id,staff_user_id,commission_type,gross_service_amount,commission_rate_pct,commission_amount,status,accrued_at,workspace_source,notes) VALUES($1,$2,$3,$4,$5,$6,$7,'SERVICE_LABOR',$8,$9,$10,'ACCRUED',now(),'EARNING',$11) ON CONFLICT DO NOTHING`,
      [
        s.tenantId,
        s.merchantId,
        s.outletId,
        s.moduleId,
        t.id,
        j.id,
        j.assigned_staff_id,
        Number(t.subtotal),
        j.commission_rule.kind === "PERCENTAGE"
          ? Number(j.commission_rule.rate)
          : 0,
        amount,
        "Rule revision " + j.commission_rule.revision,
      ],
    );
  }
}
/** Compensation follows original receipt subtotal; repeated refund/void produces no duplicate delta. */
export async function adjustWorkspaceCommission(c: Db, transactionId: string) {
  if (!(await hasSchemaFeature(c, "workspaceLabor"))) return;
  const originals = (
    await c.query(
      `SELECT c.*,t.subtotal,t.order_status,COALESCE((SELECT sum(r.subtotal_amount) FROM pos.transaction_refunds r WHERE r.transaction_id=t.id),0) refunded FROM pos.staff_commissions c JOIN pos.transactions t ON t.id=c.transaction_id WHERE c.transaction_id=$1 AND c.workspace_source='EARNING' ORDER BY c.staff_user_id,c.id`,
      [transactionId],
    )
  ).rows;
  for (const o of originals) {
    await staffLock(c, o.staff_user_id);
    const target = ["VOIDED", "CANCELLED"].includes(o.order_status)
      ? 0
      : jobMoney(
          Number(o.commission_amount) *
            Math.max(0, 1 - Number(o.refunded) / Number(o.subtotal)),
        );
    const net = Number(
        (
          await c.query(
            "SELECT $2::numeric+COALESCE(sum(commission_amount),0) amount FROM pos.staff_commissions WHERE original_commission_id=$1",
            [o.id, o.commission_amount],
          )
        ).rows[0].amount,
      ),
      delta = jobMoney(target - net);
    if (!delta) continue;
    await c.query(
      `INSERT INTO pos.staff_commissions(tenant_id,merchant_id,outlet_id,module_id,transaction_id,job_id,staff_user_id,commission_type,gross_service_amount,commission_rate_pct,commission_amount,status,accrued_at,workspace_source,original_commission_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,'SERVICE_ADJUSTMENT',0,0,$8,'ACCRUED',now(),'ADJUSTMENT',$9,'Refund/void compensation')`,
      [
        o.tenant_id,
        o.merchant_id,
        o.outlet_id,
        o.module_id,
        o.transaction_id,
        o.job_id,
        o.staff_user_id,
        delta,
        o.id,
      ],
    );
  }
}
async function outstanding(
  c: Db,
  s: WorkspaceScope,
  staff: string,
  end: string,
) {
  return (
    await c.query(
      `SELECT c.id,c.commission_amount FROM pos.staff_commissions c WHERE c.tenant_id=$1 AND c.merchant_id=$2 AND c.outlet_id=$3 AND c.module_id=$4 AND c.staff_user_id=$5 AND c.workspace_source IS NOT NULL AND c.created_at<(($6::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta') AND NOT EXISTS(SELECT 1 FROM pos.workspace_payroll_entries e WHERE e.commission_id=c.id) ORDER BY c.id`,
      [...args(s, staff), end],
    )
  ).rows;
}
export function registerWorkspaceLaborRoutes(app: Express, db: Db) {
  app.get("/api/v1/sync/modules/labor", async (req, res) => {
    const p = trustedPrincipal(req);
    if (!p)
      return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const result = await db.tx(async (c) => {
        const s = await resolveWorkspaceScope(c, p.subject, req.query);
        await ready(c);
        if (!s.features.includes("labor"))
          throw new ModuleAccessError(403, "LABOR_ENTITLEMENT_REQUIRED");
        if (s.role === "CASHIER")
          throw new ModuleAccessError(403, "LABOR_VISIBILITY_FORBIDDEN");
        const manager = managers.includes(s.role),
          staff = manager ? String(req.query.staffId || p.subject) : p.subject;
        if (!UUID.test(staff))
          throw new ModuleAccessError(400, "INVALID_STAFF");
        const end = String(
          req.query.periodEnd || calendarDate(),
        );
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
          !Number.isFinite(Date.parse(end))
        )
          throw new ModuleAccessError(400, "INVALID_PAYROLL_PERIOD");
        const entries = await outstanding(c, s, staff, end),
          ledger = (
            await c.query(
              `SELECT id,job_id,transaction_id,commission_amount,workspace_source,original_commission_id,created_at FROM pos.staff_commissions WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND staff_user_id=$5 AND workspace_source IS NOT NULL ORDER BY created_at DESC LIMIT 200`,
              args(s, staff),
            )
          ).rows;
        const payrolls = (
          await c.query(
            "SELECT client_slip_id,period_month,base_salary,allowance,individual_commission,deductions,net_salary,status,paid_at FROM pos.staff_payrolls WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND staff_id=$5 ORDER BY paid_at DESC LIMIT 24",
            args(s, staff),
          )
        ).rows;
        return {
          rule: manager
            ? await workspaceCommissionRule(c, s, staff)
            : undefined,
          ledger,
          payrolls,
          quote: {
            fingerprint: commandHash(entries),
            commission: jobMoney(
              entries.reduce((n, r) => n + Number(r.commission_amount), 0),
            ),
            periodEnd: end,
          },
        };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (e) {
      return failure(res, e);
    }
  });
  app.post("/api/v1/sync/modules/labor", async (req, res) => {
    const p = trustedPrincipal(req);
    if (!p)
      return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const b = req.body;
    try {
      const result = await db.tx(async (c) => {
        const s = await resolveWorkspaceScope(c, p.subject, b);
        await ready(c);
        if (!s.features.includes("labor"))
          throw new ModuleAccessError(403, "LABOR_ENTITLEMENT_REQUIRED");
        requireWorkspaceRole(s, managers);
        if (!UUID.test(b.staffId) || !UUID.test(b.commandId))
          throw new ModuleAccessError(400, "INVALID_LABOR_COMMAND");
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          s.tenantId + ":" + b.commandId,
        ]);
        const hash = commandHash({
            ...b,
            approvalGrant: undefined,
            cash: b.cash ? { ...b.cash, approvalGrant: undefined } : undefined,
          }),
          previous = (
            await c.query(
              "SELECT * FROM pos.workspace_commands WHERE tenant_id=$1 AND command_id=$2",
              [s.tenantId, b.commandId],
            )
          ).rows[0];
        if (previous) {
          if (
            previous.actor_ref !== p.subject ||
            previous.request_hash !== hash
          )
            throw new ModuleAccessError(409, "LABOR_COMMAND_ID_CONFLICT");
          return { ...previous.result, replayed: true };
        }
        if (b.action === "PAY")
          await bindRegisterCash(c, s, b.cash?.registerId);
        await staffLock(c, b.staffId);
        const member = (
          await c.query(
            `SELECT u.full_name FROM internal.users u WHERE u.id=$1 AND u.is_active AND EXISTS(SELECT 1 FROM internal.memberships m WHERE m.user_id=u.id AND m.tenant_id=$2 AND m.is_active AND (m.scope_type='TENANT' OR m.merchant_id=$3 AND (m.scope_type='MERCHANT' OR m.outlet_id=$4)))`,
            [b.staffId, s.tenantId, s.merchantId, s.outletId],
          )
        ).rows[0];
        if (!member)
          throw new ModuleAccessError(403, "STAFF_MEMBERSHIP_REQUIRED");
        const staffAccess = await resolveModuleAccess(
          c,
          b.staffId,
          s.merchantId,
          s.outletId,
        );
        await resolveWorkspaceScope(c, p.subject, b);
        if (!staffAccess.modules.some((m) => m.id === s.moduleId))
          throw new ModuleAccessError(
            403,
            "STAFF_WORKSPACE_ASSIGNMENT_REQUIRED",
          );
        let saved: any;
        if (b.action === "SET_RULE") {
          if (
            !["PERCENTAGE", "FIXED_PER_ORDER"].includes(b.kind) ||
            !Number.isFinite(b.rate) ||
            b.rate < 0 ||
            b.rate > 999999999 ||
            (b.kind === "PERCENTAGE" && b.rate > 100) ||
            jobMoney(b.rate) !== b.rate
          )
            throw new ModuleAccessError(400, "INVALID_COMMISSION_RULE");
          const prior = await workspaceCommissionRule(c, s, b.staffId);
          if (b.baseRevision !== Number(prior?.revision || 0))
            throw new ModuleAccessError(
              409,
              "COMMISSION_RULE_REVISION_CONFLICT",
            );
          await c.query(
            "INSERT INTO pos.workspace_commission_rules(tenant_id,merchant_id,outlet_id,module_id,staff_user_id,revision,kind,rate,actor_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              ...args(s, b.staffId),
              b.baseRevision + 1,
              b.kind,
              b.rate,
              p.subject,
            ],
          );
          saved = { revision: b.baseRevision + 1 };
        } else if (b.action === "PAY") {
          if (
            !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.periodMonth) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(b.periodEnd) ||
            !b.periodEnd.startsWith(b.periodMonth) ||
            ![b.baseSalary, b.allowance, b.deductions].every(
              (n) =>
                Number.isFinite(n) &&
                n >= 0 &&
                n <= 999999999 &&
                jobMoney(n) === n,
            )
          )
            throw new ModuleAccessError(400, "INVALID_PAYROLL_AMOUNTS");
          if (
            (
              await c.query(
                "SELECT id FROM pos.staff_payrolls WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND staff_id=$5 AND period_month=$6",
                [...args(s, b.staffId), b.periodMonth],
              )
            ).rows.length
          )
            throw new ModuleAccessError(409, "PAYROLL_PERIOD_ALREADY_PAID");
          const entries = await outstanding(c, s, b.staffId, b.periodEnd);
          if (commandHash(entries) !== b.fingerprint)
            throw new ModuleAccessError(409, "PAYROLL_CHANGED_REVIEW_REQUIRED");
          const commission = jobMoney(
              entries.reduce((n, r) => n + Number(r.commission_amount), 0),
            ),
            gross = jobMoney(b.baseSalary + b.allowance + commission),
            net = jobMoney(gross - b.deductions);
          if (net <= 0)
            throw new ModuleAccessError(409, "POSITIVE_PAYROLL_REQUIRED");
          if (
            !b.cash ||
            b.cash.clientEventId !== "payroll:" + b.commandId ||
            b.cash.type !== "CASH_OUT" ||
            b.cash.amount !== net ||
            b.cash.category !== "GAJI" ||
            b.cash.recipientOrSource !== b.staffId
          )
            throw new ModuleAccessError(409, "PAYROLL_CASH_COMMAND_MISMATCH");
          const cash = await applyCashEvent(
            c,
            { ...s, sector: s.sector as any },
            b.cash,
          );
          const slip = (
            await c.query(
              `INSERT INTO pos.staff_payrolls(tenant_id,merchant_id,outlet_id,module_id,client_slip_id,staff_id,staff_name,staff_role,period_month,period_start,period_end,base_salary,allowance,individual_commission,gross_earnings,deductions,net_salary,status,paid_at,payment_method,cash_event_id,business_sector) VALUES($1,$2,$3,$4,$5,$6,$7,'STAFF',$8,$9,$10,$11,$12,$13,$14,$15,$16,'PAID',now(),'CASH',$17,$18) RETURNING id`,
              [
                s.tenantId,
                s.merchantId,
                s.outletId,
                s.moduleId,
                b.commandId,
                b.staffId,
                member.full_name,
                b.periodMonth,
                b.periodMonth + "-01",
                b.periodEnd,
                b.baseSalary,
                b.allowance,
                commission,
                gross,
                b.deductions,
                net,
                cash.id,
                s.sector,
              ],
            )
          ).rows[0];
          for (const e of entries)
            await c.query(
              "INSERT INTO pos.workspace_payroll_entries(payroll_id,commission_id) VALUES($1,$2)",
              [slip.id, e.id],
            );
          saved = { payrollId: slip.id, netSalary: net };
        } else throw new ModuleAccessError(400, "INVALID_LABOR_ACTION");
        const result = {
          ...saved,
          commandId: b.commandId,
          action: b.action,
          workspace: {
            tenantId: s.tenantId,
            merchantId: s.merchantId,
            outletId: s.outletId,
            moduleId: s.moduleId,
            actorRef: s.actorRef,
          },
          replayed: false,
        };
        await c.query(
          "INSERT INTO pos.workspace_commands(tenant_id,merchant_id,command_id,actor_ref,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)",
          [s.tenantId, s.merchantId, b.commandId, p.subject, hash, result],
        );
        return result;
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (e) {
      return failure(res, e);
    }
  });
}
function failure(res: any, e: unknown) {
  const known =
    e instanceof ModuleAccessError ||
    e instanceof FinanceError ||
    e instanceof FinancialApprovalError ||
    e instanceof RegisterError ||
    e instanceof BillingError;
  return res.status(known ? e.status : 503).json({
    ok: false,
    error: known ? e.message : "WORKSPACE_LABOR_UNAVAILABLE",
  });
}
