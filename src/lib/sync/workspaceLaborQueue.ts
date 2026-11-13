import {
  readFinancialValue,
  writeFinancialValue,
} from "../../platform/runtime/financialStorage";
import { financialWorkspaceKey, type FinancialWorkspace } from "./queue";
export type LaborCommand = {
  commandId: string;
  businessId: string;
  outletId: string;
  moduleId: string;
  staffId: string;
  action: "SET_RULE" | "PAY";
  kind?: string;
  rate?: number;
  baseRevision?: number;
  periodMonth?: string;
  periodEnd?: string;
  fingerprint?: string;
  baseSalary?: number;
  allowance?: number;
  deductions?: number;
  cash?: {
    clientEventId: string;
    type: "CASH_OUT";
    amount: number;
    occurredAt: string;
    description: string;
    category: string;
    recipientOrSource: string;
    registerId: string;
    approvalGrant?: string;
  };
};
const key = (w: FinancialWorkspace) =>
  "newhope_labor_outbox_v1_" + financialWorkspaceKey(w);
export function pendingWorkspaceLabor(
  w: FinancialWorkspace,
): LaborCommand | null {
  const raw = readFinancialValue(key(w));
  if (!raw) return null;
  const row = JSON.parse(raw);
  if (
    row.actorRef !== w.actorRef ||
    row.command.businessId !== w.merchantId ||
    row.command.outletId !== w.outletId ||
    row.command.moduleId !== w.moduleId
  )
    throw Error("LABOR_QUEUE_SCOPE_MISMATCH");
  return row.command;
}
export async function flushWorkspaceLabor(w: FinancialWorkspace) {
  const command = pendingWorkspaceLabor(w);
  if (!command) return null;
  const r = await fetch("/api/v1/sync/modules/labor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(15000),
    }),
    data = await r.json();
  if (!r.ok || !data.ok) throw Error(data.error || "LABOR_SYNC_UNAVAILABLE");
  if (
    data.commandId !== command.commandId ||
    data.action !== command.action ||
    data.workspace?.tenantId !== w.tenantId ||
    data.workspace?.merchantId !== w.merchantId ||
    data.workspace?.outletId !== w.outletId ||
    data.workspace?.moduleId !== w.moduleId ||
    data.workspace?.actorRef !== w.actorRef ||
    (command.action === "PAY" &&
      (!data.payrollId || data.netSalary !== command.cash?.amount))
  )
    throw Error("LABOR_ACK_MISMATCH");
  if (pendingWorkspaceLabor(w)?.commandId === command.commandId)
    await writeFinancialValue(key(w), null);
  return data;
}
export async function submitWorkspaceLabor(
  w: FinancialWorkspace,
  command: LaborCommand,
) {
  if (pendingWorkspaceLabor(w))
    throw Error("LABOR_COMMAND_PENDING_RETRY_REQUIRED");
  if (
    command.businessId !== w.merchantId ||
    command.outletId !== w.outletId ||
    command.moduleId !== w.moduleId
  )
    throw Error("LABOR_QUEUE_SCOPE_MISMATCH");
  await writeFinancialValue(
    key(w),
    JSON.stringify({ actorRef: w.actorRef, command }),
  );
  return flushWorkspaceLabor(w);
}
export async function renewWorkspaceLaborApproval(
  w: FinancialWorkspace,
  commandId: string,
  grant: string,
) {
  const command = pendingWorkspaceLabor(w);
  if (command?.commandId !== commandId || !command.cash || !grant)
    throw Error("LABOR_QUEUE_CHANGED");
  await writeFinancialValue(
    key(w),
    JSON.stringify({
      actorRef: w.actorRef,
      command: { ...command, cash: { ...command.cash, approvalGrant: grant } },
    }),
  );
}
