import {
  workspaceCommissionRule,
  accrueWorkspaceCommission,
} from "./workspaceLabor";
import {
  jobCheckoutAmounts,
  jobMoney,
} from "../../src/platform/modules/jobAmounts";
import type { Express } from "express";
import type { Db } from "../shared/db";
import { trustedPrincipal } from "../shared/auth";
import { hasSchemaFeature } from "../shared/schemaFeatures";
import { BillingError } from "../billing/engine";
import { ModuleAccessError, resolveModuleAccess } from "./modules";
import {
  resolveWorkspaceScope,
  requireWorkspaceRole,
  type WorkspaceScope,
} from "./workspaceScope";
import { workspaceProduct } from "./workspaceInventory";
import { priceWorkspaceSelection } from "./workspacePricing";
import { commandHash } from "./financialAuthorization";
import { workflowStages } from "../../src/platform/modules/domainWorkflow";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (x: any, n: number) =>
  typeof x === "string" &&
  x.trim().length > 0 &&
  x.length <= n &&
  !/[\x00-\x1f\x7f]/.test(x);
const complete = (s: WorkspaceScope, status: string) =>
  workflowStages[s.moduleId].at(-1) === status;
function canonicalSelection(input: any) {
  const modifiers = input.selectedModifiers ?? [];
  if (
    !Array.isArray(modifiers) ||
    modifiers.length > 100 ||
    modifiers.some(
      (m: any) => !m || !text(m.groupId, 128) || !text(m.optionId, 128),
    ) ||
    new Set(modifiers.map((m: any) => m.groupId + "\0" + m.optionId)).size !==
      modifiers.length
  )
    throw new ModuleAccessError(400, "INVALID_MODIFIER_SELECTION");
  return {
    variantId: input.variantId ?? null,
    selectedModifiers: modifiers
      .map((m: any) => ({ groupId: m.groupId, optionId: m.optionId }))
      .sort((a: any, b: any) =>
        (a.groupId + ":" + a.optionId).localeCompare(
          b.groupId + ":" + b.optionId,
        ),
      ),
  };
}

async function ready(c: Db) {
  if (process.env.NEW_HOPE_MODULE_DOMAIN_WORKFLOWS !== "1")
    throw new ModuleAccessError(403, "WORKSPACE_JOBS_DISABLED");
  if (!(await hasSchemaFeature(c, "workspaceJobs")))
    throw new ModuleAccessError(503, "WORKSPACE_JOBS_SCHEMA_REQUIRED");
}
async function job(c: Db, s: WorkspaceScope, id: string) {
  if (!UUID.test(id)) throw new ModuleAccessError(400, "INVALID_JOB_ID");
  const j = (
    await c.query(
      "SELECT * FROM pos.operational_jobs WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 AND module_id=$5 FOR UPDATE",
      [id, s.tenantId, s.merchantId, s.outletId, s.moduleId],
    )
  ).rows[0];
  if (!j) throw new ModuleAccessError(404, "WORKSPACE_JOB_NOT_FOUND");
  return j;
}
async function assigned(c: Db, s: WorkspaceScope, staffId: any) {
  if (staffId === null || staffId === undefined || staffId === "") return null;
  if (!UUID.test(staffId))
    throw new ModuleAccessError(400, "INVALID_ASSIGNED_STAFF");
  const access = await resolveModuleAccess(
      c,
      staffId,
      s.merchantId,
      s.outletId,
    ),
    grant = access.modules.find((m) => m.id === s.moduleId);
  await resolveWorkspaceScope(
    c,
    s.actorRef,
    { businessId: s.merchantId, outletId: s.outletId, moduleId: s.moduleId },
    ["tables"],
  );
  if (!grant?.permissions.includes("tables"))
    throw new ModuleAccessError(403, "STAFF_WORKSPACE_ASSIGNMENT_REQUIRED");
  return staffId;
}
async function conflicts(
  c: Db,
  s: WorkspaceScope,
  staffId: string | null,
  resource: string | null,
  from: string | null,
  to: string | null,
  exclude?: string,
) {
  // A common outlet lock also covers changes of resource/staff and unbounded table occupancy.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `jobs:${s.tenantId}:${s.merchantId}:${s.outletId}:${s.moduleId}`,
  ]);
  if (
    staffId &&
    (
      await c.query(
        "SELECT pos.workspace_staff_conflict($1,$2,$3,$4) AS conflict",
        [staffId, from, to, exclude || null],
      )
    ).rows[0].conflict
  )
    throw new ModuleAccessError(409, "STAFF_OR_RESOURCE_BOOKING_CONFLICT");
  if (!staffId && !resource) return;
  const rows = (
    await c.query(
      `SELECT id,workspace_payload FROM pos.operational_jobs WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND status<>ALL($5::text[]) AND ($6::uuid IS NULL OR id<>$6) AND (($7::uuid IS NOT NULL AND assigned_staff_id=$7) OR ($8::text IS NOT NULL AND resource_name=$8))`,
      [
        s.tenantId,
        s.merchantId,
        s.outletId,
        s.moduleId,
        ["CANCELLED", workflowStages[s.moduleId].at(-1)],
        exclude || null,
        staffId,
        resource,
      ],
    )
  ).rows;
  for (const row of rows) {
    const a = row.workspace_payload.scheduledStart,
      b = row.workspace_payload.scheduledEnd;
    if (
      !from ||
      !to ||
      !a ||
      !b ||
      (Date.parse(from) < Date.parse(b) && Date.parse(to) > Date.parse(a))
    )
      throw new ModuleAccessError(409, "STAFF_OR_RESOURCE_BOOKING_CONFLICT");
  }
}
/** Existing intake prices/options are server snapshots, even after a catalog edit. */
export async function workspaceJobSelection(
  c: Db,
  s: WorkspaceScope,
  id: string,
  item: any,
) {
  await ready(c);
  const j = await job(c, s, id),
    line = j.workspace_payload.lines.find(
      (l: any) => l.id === item.clientItemId,
    );
  if (j.status === "CANCELLED")
    throw new ModuleAccessError(409, "JOB_CANCELLED");
  if (
    !line ||
    line.productRef !== item.productRef ||
    Number(line.unitPrice) !== Number(item.unitPrice) ||
    commandHash(line.selection) !== commandHash(canonicalSelection(item))
  )
    throw new ModuleAccessError(409, "JOB_QUOTE_OR_QUANTITY_MISMATCH");
  return line.quote;
}
export async function linkWorkspaceJobSale(
  c: Db,
  s: WorkspaceScope,
  jobId: string,
  transactionId: string,
  items: any[],
  sale: any,
) {
  await ready(c);
  const j = await job(c, s, jobId);
  if (j.status === "CANCELLED")
    throw new ModuleAccessError(409, "JOB_CANCELLED");
  const lines = j.workspace_payload.lines;
  const prior = (
    await c.query(
      `SELECT ti.client_item_id,COALESCE(ti.quantity_exact,ti.quantity) AS quantity FROM pos.workspace_job_receipts r JOIN pos.transactions t ON t.id=r.transaction_id JOIN pos.transaction_items ti ON ti.transaction_id=t.id WHERE r.job_id=$1 AND t.order_status NOT IN('VOIDED','CANCELLED')`,
      [jobId],
    )
  ).rows;
  const used = new Map<string, number>();
  for (const row of prior)
    used.set(
      row.client_item_id,
      (used.get(row.client_item_id) || 0) + Number(row.quantity),
    );
  const seen = new Set<string>();
  for (const item of items) {
    const line = lines.find((l: any) => l.id === item.clientItemId);
    if (
      !line ||
      seen.has(item.clientItemId) ||
      line.productRef !== item.productRef ||
      Number(line.unitPrice) !== Number(item.unitPrice) ||
      commandHash(line.selection) !== commandHash(canonicalSelection(item)) ||
      Number(item.quantity) + (used.get(line.id) || 0) >
        Number(line.quantity) + 0.00001
    )
      throw new ModuleAccessError(409, "JOB_QUOTE_OR_QUANTITY_MISMATCH");
    seen.add(item.clientItemId);
  }
  const billed = await billedJob(c, j.id);
  const amounts = jobCheckoutAmounts(
    j.workspace_payload.pricing,
    jobMoney(
      items.reduce((sum, i) => sum + jobMoney(i.unitPrice * i.quantity), 0),
    ),
    billed,
  );
  if (
    Number(sale.discountAmount || 0) !== 0 ||
    Math.abs(Number(sale.subtotal) - amounts.subtotal) > 0.001 ||
    Math.abs(Number(sale.taxAmount || 0) - amounts.tax) > 0.001 ||
    Math.abs(Number(sale.serviceChargeAmount || 0) - amounts.service) > 0.001 ||
    Math.abs(Number(sale.totalAmount) - amounts.total) > 0.001 ||
    items.some(
      (i) =>
        i.totalPrice !== undefined &&
        Math.abs(Number(i.totalPrice) - jobMoney(i.unitPrice * i.quantity)) >
          0.001,
    )
  )
    throw new ModuleAccessError(409, "JOB_QUOTED_TOTAL_MISMATCH");
  await c.query(
    "INSERT INTO pos.workspace_job_receipts(tenant_id,merchant_id,outlet_id,module_id,job_id,transaction_id) VALUES($1,$2,$3,$4,$5,$6)",
    [s.tenantId, s.merchantId, s.outletId, s.moduleId, jobId, transactionId],
  );
}
async function billedJob(c: Db, jobId: string) {
  const row = (
    await c.query(
      `SELECT COALESCE(sum(t.subtotal),0) AS subtotal,COALESCE(sum(t.tax_amount),0) AS tax,COALESCE(sum(t.service_charge_amount),0) AS service FROM pos.workspace_job_receipts r JOIN pos.transactions t ON t.id=r.transaction_id WHERE r.job_id=$1 AND t.order_status NOT IN('VOIDED','CANCELLED')`,
      [jobId],
    )
  ).rows[0];
  return {
    subtotal: Number(row.subtotal),
    tax: Number(row.tax),
    service: Number(row.service),
  };
}
/** Batch receipt allocation and payment state; quantities already billed remain allocated
 * after refunds. A refund reverses a sale, it does not silently authorize a second sale. */
async function jobBalances(c: Db, ids: string[]) {
  const rows = (
    await c.query(
      `SELECT r.job_id,ti.client_item_id,
 SUM(CASE WHEN t.order_status NOT IN('VOIDED','CANCELLED') THEN COALESCE(ti.quantity_exact,ti.quantity) ELSE 0 END) AS allocated,
 SUM(CASE WHEN t.order_status NOT IN('VOIDED','CANCELLED') AND COALESCE((SELECT sum(p.amount) FROM pos.payments p WHERE p.transaction_id=t.id AND p.payment_status IN('PAID','SETTLED')),0)>=t.total_amount THEN COALESCE(ti.quantity_exact,ti.quantity)-COALESCE((SELECT SUM(ri.quantity) FROM pos.transaction_refund_items ri WHERE ri.transaction_item_id=ti.id),0) ELSE 0 END) AS paid_quantity
 FROM pos.workspace_job_receipts r JOIN pos.transactions t ON t.id=r.transaction_id JOIN pos.transaction_items ti ON ti.transaction_id=t.id WHERE r.job_id=ANY($1::uuid[]) GROUP BY r.job_id,ti.client_item_id`,
      [ids],
    )
  ).rows;
  const amounts = (
    await c.query(
      `SELECT r.job_id,COALESCE(sum(t.subtotal),0) AS subtotal,COALESCE(sum(t.tax_amount),0) AS tax,COALESCE(sum(t.service_charge_amount),0) AS service FROM pos.workspace_job_receipts r JOIN pos.transactions t ON t.id=r.transaction_id WHERE r.job_id=ANY($1::uuid[]) AND t.order_status NOT IN('VOIDED','CANCELLED') GROUP BY r.job_id`,
      [ids],
    )
  ).rows;
  return (j: any) => {
    const lines = j.workspace_payload?.lines || j.intake.lines,
      own = rows.filter((r) => r.job_id === j.id),
      amount = amounts.find((r) => r.job_id === j.id);
    return {
      paid: lines.every(
        (l: any) =>
          Number(
            own.find((r) => r.client_item_id === l.id)?.paid_quantity || 0,
          ) >=
          Number(l.quantity) - 0.00001,
      ),
      remaining: Object.fromEntries(
        lines.map((l: any) => [
          l.id,
          Math.max(
            0,
            Math.round(
              (Number(l.quantity) -
                Number(
                  own.find((r) => r.client_item_id === l.id)?.allocated || 0,
                )) *
                1000,
            ) / 1000,
          ),
        ]),
      ),
      billed: {
        subtotal: Number(amount?.subtotal || 0),
        tax: Number(amount?.tax || 0),
        service: Number(amount?.service || 0),
      },
    };
  };
}
async function paid(c: Db, s: WorkspaceScope, j: any) {
  return (await jobBalances(c, [j.id]))(j).paid;
}
/** Match the sale/refund lock order: financial transactions before the job row.
 * Concurrent refunds can follow completion, but cannot invalidate its payment check midway. */
async function lockJobReceipts(c: Db, id: string) {
  await c.query(
    `SELECT t.id FROM pos.transactions t JOIN pos.workspace_job_receipts r ON r.transaction_id=t.id WHERE r.job_id=$1 ORDER BY t.id FOR UPDATE OF t`,
    [id],
  );
}
export function registerWorkspaceJobRoutes(app: Express, db: Db) {
  app.get("/api/v1/sync/modules/jobs", async (req, res) => {
    const p = trustedPrincipal(req);
    if (!p)
      return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    try {
      const result = await db.tx(async (c) => {
        const s = await resolveWorkspaceScope(c, p.subject, req.query, [
          "tables",
        ]);
        await ready(c);
        const jobs = (
          await c.query(
            `SELECT id,job_number,status,resource_name,assigned_staff_id,workspace_revision AS revision,workspace_payload AS intake,started_at,completed_at,created_at FROM pos.operational_jobs WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 ORDER BY created_at DESC,id DESC LIMIT 200`,
            [s.tenantId, s.merchantId, s.outletId, s.moduleId],
          )
        ).rows;
        const balances = await jobBalances(
          c,
          jobs.map((j) => j.id),
        );
        for (const j of jobs) Object.assign(j, balances(j));
        const receipts = s.permissions.includes("pos")
          ? (
              await c.query(
                `SELECT r.job_id,t.client_txn_id,t.invoice_number,t.total_amount,t.payment_method,t.order_status,t.created_at,(SELECT jsonb_agg(jsonb_build_object('name',ti.product_name,'quantity',COALESCE(ti.quantity_exact,ti.quantity),'unitPrice',ti.unit_price,'options',ti.workspace_options) ORDER BY ti.id) FROM pos.transaction_items ti WHERE ti.transaction_id=t.id) AS items FROM pos.workspace_job_receipts r JOIN pos.transactions t ON t.id=r.transaction_id WHERE r.job_id=ANY($1::uuid[]) ORDER BY t.created_at`,
                [jobs.map((j) => j.id)],
              )
            ).rows
          : [];
        for (const j of jobs)
          j.receipts = receipts.filter((r) => r.job_id === j.id);
        const resources = (
          await c.query(
            `SELECT record_id AS id,value->>'name' AS name FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND kind='tables' AND NOT deleted ORDER BY record_id`,
            [s.tenantId, s.merchantId, s.outletId, s.moduleId],
          )
        ).rows;
        return { jobs, resources };
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...result });
    } catch (e) {
      return failure(res, e);
    }
  });
  app.post("/api/v1/sync/modules/jobs", async (req, res) => {
    const p = trustedPrincipal(req);
    if (!p)
      return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
    const b = req.body;
    if (
      !b ||
      !text(b.commandId, 128) ||
      !["CREATE", "TRANSITION", "ASSIGN"].includes(b.action)
    )
      return res.status(400).json({ ok: false, error: "INVALID_JOB_COMMAND" });
    try {
      const result = await db.tx(async (c) => {
        const s = await resolveWorkspaceScope(c, p.subject, b, ["tables"]);
        await ready(c);
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          s.tenantId + ":" + b.commandId,
        ]);
        const hash = commandHash(b),
          prior = (
            await c.query(
              "SELECT * FROM pos.workspace_commands WHERE tenant_id=$1 AND command_id=$2",
              [s.tenantId, b.commandId],
            )
          ).rows[0];
        if (prior) {
          if (
            prior.actor_ref !== s.actorRef ||
            prior.merchant_id !== s.merchantId ||
            prior.request_hash !== hash
          )
            throw new ModuleAccessError(409, "JOB_COMMAND_ID_CONFLICT");
          return { ...prior.result, replayed: true };
        }
        // All job mutation paths acquire the same outlet lock before any job row lock.
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `jobs:${s.tenantId}:${s.merchantId}:${s.outletId}:${s.moduleId}`,
        ]);
        let j: any,
          previous: string | null = null;
        if (b.action === "CREATE") {
          if (!s.permissions.includes("pos"))
            throw new ModuleAccessError(403, "JOB_INTAKE_CASHIER_REQUIRED");
          if (
            !UUID.test(b.jobId) ||
            !text(b.customerName, 150) ||
            !text(b.customerPhone, 40) ||
            !Array.isArray(b.lines) ||
            !b.lines.length ||
            b.lines.length > 100 ||
            new Set(b.lines.map((l: any) => l?.id)).size !== b.lines.length
          )
            throw new ModuleAccessError(400, "INVALID_JOB_INTAKE");
          if (
            (s.moduleId === "fnb" &&
              !["DINE_IN", "TAKEAWAY", "DELIVERY"].includes(b.orderType)) ||
            (s.moduleId === "laundry" &&
              !["PICKUP", "DELIVERY"].includes(b.collection)) ||
            (s.moduleId === "carwash" &&
              (!text(b.vehiclePlate, 20) || !text(b.vehicleModel, 100)))
          )
            throw new ModuleAccessError(400, "MODULE_INTAKE_FIELDS_REQUIRED");
          const resource =
            b.resource === undefined || b.resource === "" ? null : b.resource;
          if (resource !== null && !text(resource, 64))
            throw new ModuleAccessError(400, "INVALID_JOB_RESOURCE");
          if (s.moduleId === "fnb" && b.orderType === "DINE_IN" && !resource)
            throw new ModuleAccessError(400, "DINING_TABLE_REQUIRED");
          if (
            resource &&
            ["fnb", "carwash"].includes(s.moduleId) &&
            !(
              await c.query(
                `SELECT record_id FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND kind='tables' AND record_id=$5 AND NOT deleted`,
                [s.tenantId, s.merchantId, s.outletId, s.moduleId, resource],
              )
            ).rows.length
          )
            throw new ModuleAccessError(404, "WORKSPACE_RESOURCE_NOT_FOUND");
          let start: string | null = null,
            end: string | null = null;
          if (b.scheduledStart !== undefined || b.scheduledEnd !== undefined) {
            if (
              !Number.isFinite(Date.parse(b.scheduledStart)) ||
              !Number.isFinite(Date.parse(b.scheduledEnd)) ||
              Date.parse(b.scheduledEnd) <= Date.parse(b.scheduledStart) ||
              Date.parse(b.scheduledEnd) - Date.parse(b.scheduledStart) >
                86400000
            )
              throw new ModuleAccessError(400, "INVALID_BOOKING_INTERVAL");
            start = new Date(b.scheduledStart).toISOString();
            end = new Date(b.scheduledEnd).toISOString();
          }
          if (s.moduleId === "barber" && (!start || !end))
            throw new ModuleAccessError(400, "BOOKING_INTERVAL_REQUIRED");
          const staff = await assigned(c, s, b.assignedStaffId);
          await conflicts(c, s, staff, resource, start, end);
          const lines = [];
          for (const l of [...b.lines].sort((a: any, z: any) =>
            String(a?.productRef).localeCompare(String(z?.productRef)),
          )) {
            if (
              !l ||
              !text(l.id, 128) ||
              typeof l.productRef !== "string" ||
              !Number.isFinite(l.quantity) ||
              l.quantity <= 0 ||
              l.quantity > 999999 ||
              Math.abs(l.quantity * 1000 - Math.round(l.quantity * 1000)) >
                0.001 ||
              (l.description !== undefined && !text(l.description, 200))
            )
              throw new ModuleAccessError(400, "INVALID_JOB_LINE");
            const product = await workspaceProduct(c, s, l.productRef, true);
            if (!product.is_available)
              throw new ModuleAccessError(409, "WORKSPACE_PRODUCT_UNAVAILABLE");
            const quote = priceWorkspaceSelection(product, l);
            const selection = canonicalSelection(l);
            lines.push({
              id: l.id,
              productRef: l.productRef,
              productName: product.name,
              quantity: l.quantity,
              unit: product.unit || "pcs",
              description: l.description || "",
              unitPrice: quote.unitPrice,
              quote,
              selection,
            });
          }
          const settings =
            (
              await c.query(
                `SELECT value FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND kind='store_settings' AND NOT deleted ORDER BY updated_at DESC LIMIT 1`,
                [s.tenantId, s.merchantId, s.outletId, s.moduleId],
              )
            ).rows[0]?.value || {};
          const taxRate = settings.enableTax ? Number(settings.taxRate) : 0,
            serviceRate = settings.enableService
              ? Number(settings.serviceRate)
              : 0;
          if (
            !Number.isFinite(taxRate) ||
            taxRate < 0 ||
            taxRate > 100 ||
            !Number.isFinite(serviceRate) ||
            serviceRate < 0 ||
            serviceRate > 100
          )
            throw new ModuleAccessError(
              409,
              "JOB_PRICING_SETTINGS_REVIEW_REQUIRED",
            );
          const gross = jobMoney(
              lines.reduce(
                (sum, l) => sum + jobMoney(l.unitPrice * l.quantity),
                0,
              ),
            ),
            pricing = {
              gross,
              tax: Math.round((gross * taxRate) / 100),
              service: Math.round((gross * serviceRate) / 100),
            };
          if (gross <= 0)
            throw new ModuleAccessError(400, "JOB_PRICE_REQUIRED");
          const intake = {
            pricing,
            customerName: b.customerName.trim(),
            customerPhone: b.customerPhone.trim(),
            vehiclePlate: s.moduleId === "carwash" ? b.vehiclePlate : null,
            vehicleModel: s.moduleId === "carwash" ? b.vehicleModel : null,
            orderType: s.moduleId === "fnb" ? b.orderType : null,
            collection: s.moduleId === "laundry" ? b.collection : null,
            deliveryAddress:
              b.collection === "DELIVERY" || b.orderType === "DELIVERY"
                ? b.deliveryAddress
                : null,
            scheduledStart: start,
            scheduledEnd: end,
            lines,
          };
          if (
            (b.collection === "DELIVERY" || b.orderType === "DELIVERY") &&
            !text(b.deliveryAddress, 500)
          )
            throw new ModuleAccessError(400, "DELIVERY_ADDRESS_REQUIRED");
          j = (
            await c.query(
              `INSERT INTO pos.operational_jobs(id,tenant_id,merchant_id,outlet_id,module_id,job_type,job_number,resource_name,assigned_staff_id,status,workspace_payload,commission_rule) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
              [
                b.jobId,
                s.tenantId,
                s.merchantId,
                s.outletId,
                s.moduleId,
                s.moduleId.toUpperCase() + "_WORKSPACE",
                s.moduleId + ":" + b.jobId,
                resource,
                staff,
                workflowStages[s.moduleId][0],
                intake,
                await workspaceCommissionRule(c, s, staff),
              ],
            )
          ).rows[0];
        } else {
          await lockJobReceipts(c, b.jobId);
          j = await job(c, s, b.jobId);
          previous = j.status;
          if (
            !Number.isSafeInteger(b.baseRevision) ||
            Number(j.workspace_revision) !== b.baseRevision
          )
            throw new ModuleAccessError(409, "JOB_REVISION_CONFLICT");
          const stages = workflowStages[s.moduleId];
          if (b.action === "ASSIGN") {
            requireWorkspaceRole(s, ["OWNER", "ADMIN", "MANAGER"]);
            if (j.status !== stages[0])
              throw new ModuleAccessError(
                409,
                "STARTED_JOB_ASSIGNMENT_IMMUTABLE",
              );
            const staff = await assigned(c, s, b.assignedStaffId);
            await conflicts(
              c,
              s,
              staff,
              j.resource_name,
              j.workspace_payload.scheduledStart,
              j.workspace_payload.scheduledEnd,
              j.id,
            );
            j = (
              await c.query(
                "UPDATE pos.operational_jobs SET assigned_staff_id=$2,commission_rule=$3,workspace_revision=workspace_revision+1,updated_at=now() WHERE id=$1 RETURNING *",
                [j.id, staff, await workspaceCommissionRule(c, s, staff)],
              )
            ).rows[0];
          } else {
            if (b.status === "CANCELLED") {
              requireWorkspaceRole(s, ["OWNER", "ADMIN", "MANAGER"]);
              if (
                (
                  await c.query(
                    `SELECT t.id FROM pos.workspace_job_receipts r JOIN pos.transactions t ON t.id=r.transaction_id WHERE r.job_id=$1 AND t.order_status NOT IN('VOIDED','CANCELLED') AND t.total_amount>COALESCE((SELECT sum(f.amount) FROM pos.transaction_refunds f WHERE f.transaction_id=t.id),0)`,
                    [j.id],
                  )
                ).rows.length
              )
                throw new ModuleAccessError(409, "JOB_REFUND_OR_VOID_REQUIRED");
            } else if (
              stages.indexOf(j.status) < 0 ||
              stages[stages.indexOf(j.status) + 1] !== b.status
            )
              throw new ModuleAccessError(409, "INVALID_JOB_TRANSITION");
            if (complete(s, b.status) && !(await paid(c, s, j)))
              throw new ModuleAccessError(
                409,
                "AUTHORITATIVE_PAYMENT_REQUIRED",
              );
            if (
              !["OWNER", "ADMIN", "MANAGER", "CASHIER"].includes(s.role) &&
              j.assigned_staff_id !== s.actorRef
            )
              throw new ModuleAccessError(403, "ASSIGNED_OPERATOR_REQUIRED");
            j = (
              await c.query(
                `UPDATE pos.operational_jobs SET status=$2::text,workspace_revision=workspace_revision+1,started_at=CASE WHEN started_at IS NULL AND $2::text<>$3::text AND $2::text<>'CANCELLED' THEN now() ELSE started_at END,completed_at=CASE WHEN $4 THEN now() ELSE completed_at END,updated_at=now() WHERE id=$1 RETURNING *`,
                [j.id, b.status, stages[0], complete(s, b.status)],
              )
            ).rows[0];
          }
        }
        if (b.action === "TRANSITION" && complete(s, j.status))
          await accrueWorkspaceCommission(c, s, j);
        await c.query(
          "INSERT INTO pos.workspace_job_events(tenant_id,merchant_id,outlet_id,module_id,job_id,command_id,actor_ref,action,previous_status,status,revision,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            s.tenantId,
            s.merchantId,
            s.outletId,
            s.moduleId,
            j.id,
            b.commandId,
            s.actorRef,
            b.action,
            previous,
            j.status,
            j.workspace_revision,
            { assignedStaffId: j.assigned_staff_id },
          ],
        );
        const result = {
          commandId: b.commandId,
          action: b.action,
          jobId: j.id,
          status: j.status,
          revision: Number(j.workspace_revision),
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
  const known = e instanceof ModuleAccessError || e instanceof BillingError;
  return res
    .status(known ? e.status : 503)
    .json({
      ok: false,
      error: known ? e.message : "WORKSPACE_JOBS_UNAVAILABLE",
    });
}
