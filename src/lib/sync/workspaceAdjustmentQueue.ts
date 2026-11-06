import {
  readFinancialValue,
  writeFinancialValue,
} from "../../platform/runtime/financialStorage";
import {
  financialWorkspaceKey,
  type FinancialWorkspace,
  type SyncPayloadTxn,
} from "./queue";
export type Adjustment =
  | {
      action: "REFUND";
      commandId: string;
      body: {
        businessId: string;
        outletId: string;
        moduleId: string;
        sector: string;
        clientTxnId: string;
        clientEventId: string;
        refund: {
          clientRefundId: string;
          occurredAt: string;
          refundMethod: "CASH" | "ORIGINAL_METHOD";
          reason: string;
          items: Array<{ clientItemId: string; quantity: number }>;
          approvalGrant?: string;
        };
      };
    }
  | {
      action: "VOID";
      commandId: string;
      body: {
        businessId: string;
        outletId: string;
        moduleId: string;
        sector: string;
        idempotencyKey: string;
        transactions: SyncPayloadTxn[];
      };
    };
const key = (w: FinancialWorkspace) =>
  "newhope_adjustment_outbox_v1_" + financialWorkspaceKey(w);
export function pendingWorkspaceAdjustment(
  w: FinancialWorkspace,
): Adjustment | null {
  const raw = readFinancialValue(key(w));
  if (!raw) return null;
  const row = JSON.parse(raw);
  if (
    row.actorRef !== w.actorRef ||
    row.command.body.businessId !== w.merchantId ||
    row.command.body.outletId !== w.outletId ||
    row.command.body.moduleId !== w.moduleId
  )
    throw Error("ADJUSTMENT_SCOPE_MISMATCH");
  return row.command;
}
export async function flushWorkspaceAdjustment(w: FinancialWorkspace) {
  const c = pendingWorkspaceAdjustment(w);
  if (!c) return null;
  const r = await fetch(
      c.action === "REFUND"
        ? "/api/v1/finance/refund"
        : "/api/v1/sync/transactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c.body),
        signal: AbortSignal.timeout(15000),
      },
    ),
    d = await r.json();
  if (!r.ok || !d.ok) throw Error(d.error || "ADJUSTMENT_SYNC_UNAVAILABLE");
  if (
    c.action === "REFUND"
      ? d.clientEventId !== c.commandId ||
        d.refund?.clientRefundId !== c.commandId
      : d.idempotencyKey !== c.commandId ||
        d.tenantId !== w.tenantId ||
        d.rejected?.length ||
        Number(d.accepted || 0) + Number(d.duplicates || 0) !== 1
  )
    throw Error("ADJUSTMENT_ACK_MISMATCH");
  if (pendingWorkspaceAdjustment(w)?.commandId === c.commandId)
    await writeFinancialValue(key(w), null);
  return d;
}
export async function submitWorkspaceAdjustment(
  w: FinancialWorkspace,
  c: Adjustment,
) {
  if (pendingWorkspaceAdjustment(w))
    throw Error("ADJUSTMENT_PENDING_RETRY_REQUIRED");
  if (
    c.body.businessId !== w.merchantId ||
    c.body.outletId !== w.outletId ||
    c.body.moduleId !== w.moduleId
  )
    throw Error("ADJUSTMENT_SCOPE_MISMATCH");
  await writeFinancialValue(
    key(w),
    JSON.stringify({ actorRef: w.actorRef, command: c }),
  );
  return flushWorkspaceAdjustment(w);
}
export async function renewWorkspaceAdjustment(
  w: FinancialWorkspace,
  id: string,
  grant: string,
) {
  const c = pendingWorkspaceAdjustment(w);
  if (c?.commandId !== id || !grant) throw Error("ADJUSTMENT_QUEUE_CHANGED");
  if (c.action === "REFUND") c.body.refund.approvalGrant = grant;
  else c.body.transactions[0].approvalGrant = grant;
  await writeFinancialValue(
    key(w),
    JSON.stringify({ actorRef: w.actorRef, command: c }),
  );
}
