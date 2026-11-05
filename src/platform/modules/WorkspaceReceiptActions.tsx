import React, { useState } from "react";
import { useBusinessModule } from "./ModuleWorkspaceGate";
import { useWorkspaceBusiness } from "../../context/WorkspaceBusinessContext";
import { useAuth } from "../../context/AuthContext";
import { requestFinancialApproval } from "../../lib/auth/financialApprovalClient";
import {
  pendingWorkspaceAdjustment,
  submitWorkspaceAdjustment,
  flushWorkspaceAdjustment,
  renewWorkspaceAdjustment,
  type Adjustment,
} from "../../lib/sync/workspaceAdjustmentQueue";
export type ServiceReceipt = {
  client_txn_id: string;
  invoice_number: string;
  created_at: string;
  client_shift_id: string;
  subtotal: number;
  total_amount: number;
  discount_amount: number;
  tax_amount: number;
  service_charge_amount: number;
  payment_method: string;
  order_status: string;
  items: Array<{
    id: string;
    productRef: string;
    name: string;
    quantity: number;
    returned: number;
    unitPrice: number;
    options: any;
  }>;
};
export default function WorkspaceReceiptActions({
  receipts,
  jobId,
  onRefresh,
}: {
  receipts: ServiceReceipt[];
  jobId: string;
  onRefresh: () => Promise<void>;
}) {
  const runtime = useBusinessModule()!,
    business = useWorkspaceBusiness(),
    actor = useAuth().user!;
  const w = {
      tenantId: business.business.tenantId,
      merchantId: runtime.access.businessId,
      outletId: runtime.access.outletId,
      moduleId: runtime.manifest.id,
      actorRef: actor.id,
    },
    scope = {
      businessId: w.merchantId,
      outletId: w.outletId,
      moduleId: w.moduleId,
      sector: runtime.manifest.sector,
    };
  const [selected, setSelected] = useState(""),
    [quantity, setQuantity] = useState<Record<string, number>>({}),
    [reason, setReason] = useState(""),
    [method, setMethod] = useState<"CASH" | "ORIGINAL_METHOD">(
      "ORIGINAL_METHOD",
    ),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const r = receipts.find((r) => r.client_txn_id === selected);
  let pending: Adjustment | null = null;
  try {
    pending = pendingWorkspaceAdjustment(w);
  } catch {}
  const approve = (c: Adjustment) =>
    requestFinancialApproval({
      ...scope,
      action: c.action,
      reference:
        c.action === "REFUND"
          ? c.body.clientTxnId
          : c.body.transactions[0].clientTxnId,
      reason:
        c.action === "REFUND"
          ? c.body.refund.reason
          : c.body.transactions[0].voidReason!,
      command: c.action === "REFUND" ? c.body.refund : c.body.transactions[0],
    });
  const run = async (action: "REFUND" | "VOID" | "RETRY" | "RENEW") => {
    setBusy(true);
    try {
      if (action === "RETRY") await flushWorkspaceAdjustment(w);
      else if (action === "RENEW") {
        const c = pendingWorkspaceAdjustment(w);
        if (!c) throw Error("Tidak ada perintah tersimpan");
        await renewWorkspaceAdjustment(w, c.commandId, await approve(c));
        await flushWorkspaceAdjustment(w);
      } else {
        if (!r || !reason.trim()) throw Error("Pilih struk dan isi alasan.");
        const commandId = crypto.randomUUID();
        let c: Adjustment;
        if (action === "REFUND") {
          const items = r.items
            .filter((l) => (quantity[l.id] || 0) > 0)
            .map((l) => ({ clientItemId: l.id, quantity: quantity[l.id] }));
          if (!items.length) throw Error("Pilih jumlah yang dikembalikan");
          c = {
            action,
            commandId,
            body: {
              ...scope,
              clientTxnId: r.client_txn_id,
              clientEventId: commandId,
              refund: {
                clientRefundId: commandId,
                occurredAt: new Date().toISOString(),
                refundMethod: method,
                reason: reason.trim(),
                items,
              },
            },
          };
        } else {
          c = {
            action,
            commandId,
            body: {
              ...scope,
              idempotencyKey: commandId,
              transactions: [
                {
                  workspace: w,
                  branchId: w.outletId,
                  operationalJobId: jobId,
                  clientTxnId: r.client_txn_id,
                  createdAt: new Date(r.created_at).toISOString(),
                  shiftId: r.client_shift_id,
                  subtotal: Number(r.subtotal),
                  discountAmount: Number(r.discount_amount),
                  taxAmount: Number(r.tax_amount),
                  serviceChargeAmount: Number(r.service_charge_amount),
                  totalAmount: Number(r.total_amount),
                  paymentMethod: r.payment_method,
                  paymentStatus: "CANCELLED",
                  voidedAt: new Date().toISOString(),
                  voidReason: reason.trim(),
                  items: r.items.map((l) => ({
                    clientItemId: l.id,
                    productRef: l.productRef,
                    productName: l.name,
                    unitPrice: Number(l.unitPrice),
                    unitCost: 0,
                    quantity: Number(l.quantity),
                    totalPrice:
                      Math.round(
                        Number(l.unitPrice) * Number(l.quantity) * 100,
                      ) / 100,
                  })),
                },
              ],
            },
          };
        }
        const grant = await approve(c);
        if (c.action === "REFUND") c.body.refund.approvalGrant = grant;
        else c.body.transactions[0].approvalGrant = grant;
        await submitWorkspaceAdjustment(w, c);
      }
      await onRefresh();
      window.dispatchEvent(new Event("financial-updated"));
      setStatus("Koreksi dikonfirmasi server.");
      setSelected("");
    } catch (e) {
      setStatus(
        e instanceof Error
          ? e.message
          : "Belum dikonfirmasi; perintah tersimpan tetap dipertahankan.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t pt-3 space-y-2">
      <p role="status">{status}</p>
      {pending && (
        <p>
          Perintah koreksi {pending.commandId} tersimpan.{" "}
          <button
            disabled={busy}
            onClick={() => void run("RETRY")}
            className="border p-2"
          >
            Kirim ulang asli
          </button>
          <button
            disabled={busy}
            onClick={() => void run("RENEW")}
            className="border p-2"
          >
            Perbarui persetujuan
          </button>
        </p>
      )}
      <label>
        Koreksi struk
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setQuantity({});
          }}
          className="block border p-2"
        >
          <option value="">Pilih struk</option>
          {receipts
            .filter((r) => !["VOIDED", "CANCELLED"].includes(r.order_status))
            .map((r) => (
              <option key={r.client_txn_id} value={r.client_txn_id}>
                {r.invoice_number || r.client_txn_id}
              </option>
            ))}
        </select>
      </label>
      {r && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("REFUND");
          }}
          className="space-y-2"
        >
          {r.items.map((l) => (
            <label key={l.id} className="block">
              {l.name} · Sisa retur{" "}
              {Math.max(0, Number(l.quantity) - Number(l.returned))}
              <input
                type="number"
                min={0}
                step="0.001"
                max={Math.max(0, Number(l.quantity) - Number(l.returned))}
                value={quantity[l.id] || 0}
                onChange={(e) =>
                  setQuantity({ ...quantity, [l.id]: Number(e.target.value) })
                }
                className="block border p-2"
              />
            </label>
          ))}
          <label>
            Alasan
            <input
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="block border p-2"
            />
          </label>
          <select
            aria-label="Metode retur"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className="border p-2"
          >
            <option value="ORIGINAL_METHOD">Metode pembayaran asal</option>
            <option value="CASH">Tunai dari laci</option>
          </select>
          <button disabled={busy || !!pending} className="border p-2">
            Setujui retur item
          </button>
          <button
            type="button"
            disabled={busy || !!pending || !reason.trim()}
            onClick={() => void run("VOID")}
            className="border p-2"
          >
            Setujui void seluruh struk
          </button>
        </form>
      )}
    </div>
  );
}
