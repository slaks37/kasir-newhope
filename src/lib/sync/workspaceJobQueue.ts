import {
  readFinancialValue,
  writeFinancialValue,
} from "../../platform/runtime/financialStorage";
import { financialWorkspaceKey, type FinancialWorkspace } from "./queue";
export type JobLineInput = {
  id: string;
  productRef: string;
  quantity: number;
  description?: string;
  variantId?: string;
  selectedModifiers?: Array<{ groupId: string; optionId: string }>;
};
export type JobInput =
  | {
      action: "CREATE";
      jobId: string;
      customerName: string;
      customerPhone: string;
      resource?: string;
      assignedStaffId?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
      orderType?: string;
      collection?: string;
      deliveryAddress?: string;
      vehiclePlate?: string;
      vehicleModel?: string;
      lines: JobLineInput[];
    }
  | {
      action: "TRANSITION";
      jobId: string;
      baseRevision: number;
      status: string;
    }
  | {
      action: "ASSIGN";
      jobId: string;
      baseRevision: number;
      assignedStaffId: string | null;
    };
type Command = JobInput & {
  commandId: string;
  businessId: string;
  outletId: string;
  moduleId: string;
};
const key = (w: FinancialWorkspace) =>
  "newhope_job_outbox_v1_" + financialWorkspaceKey(w);
export function pendingWorkspaceJob(w: FinancialWorkspace): Command | null {
  const raw = readFinancialValue(key(w));
  if (!raw) return null;
  const row = JSON.parse(raw);
  if (
    row.actorRef !== w.actorRef ||
    row.command.businessId !== w.merchantId ||
    row.command.outletId !== w.outletId ||
    row.command.moduleId !== w.moduleId
  )
    throw Error("JOB_QUEUE_SCOPE_MISMATCH");
  return row.command;
}
export async function flushWorkspaceJob(w: FinancialWorkspace) {
  const command = pendingWorkspaceJob(w);
  if (!command) return null;
  const response = await fetch("/api/v1/sync/modules/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw Error(data.error || "JOB_SYNC_UNAVAILABLE");
  if (
    data.commandId !== command.commandId ||
    data.action !== command.action ||
    data.jobId !== command.jobId ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 1 ||
    data.workspace?.tenantId !== w.tenantId ||
    data.workspace?.merchantId !== w.merchantId ||
    data.workspace?.outletId !== w.outletId ||
    data.workspace?.moduleId !== w.moduleId ||
    data.workspace?.actorRef !== w.actorRef
  )
    throw Error("JOB_ACK_MISMATCH");
  if (pendingWorkspaceJob(w)?.commandId === command.commandId)
    await writeFinancialValue(key(w), null);
  return data;
}
export async function submitWorkspaceJob(
  w: FinancialWorkspace,
  input: JobInput,
) {
  if (pendingWorkspaceJob(w)) throw Error("JOB_COMMAND_PENDING_RETRY_REQUIRED");
  const command: Command = {
    ...input,
    commandId: crypto.randomUUID(),
    businessId: w.merchantId,
    outletId: w.outletId,
    moduleId: w.moduleId,
  };
  await writeFinancialValue(
    key(w),
    JSON.stringify({ actorRef: w.actorRef, command }),
  );
  return flushWorkspaceJob(w);
}
