import React, { useState, useEffect } from "react";
import { useBusinessModule } from "./ModuleWorkspaceGate";
import { useWorkspaceBusiness } from "../../context/WorkspaceBusinessContext";
import { useAuth } from "../../context/AuthContext";
import { usePOSFields } from "../../context/POSDomains";
import { requestFinancialApproval } from "../../lib/auth/financialApprovalClient";
import {
  submitWorkspaceLabor,
  flushWorkspaceLabor,
  pendingWorkspaceLabor,
  renewWorkspaceLaborApproval,
  type LaborCommand,
} from "../../lib/sync/workspaceLaborQueue";
export default function WorkspaceLabor() {
  const runtime = useBusinessModule()!,
    business = useWorkspaceBusiness(),
    actor = useAuth().user!;
  const { staffMembers, shift } = usePOSFields(["staffMembers", "shift"]);
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
    };
  const [staff, setStaff] = useState(actor.id),
    [end, setEnd] = useState(new Date().toISOString().slice(0, 10)),
    [data, setData] = useState<any>(null),
    [kind, setKind] = useState("PERCENTAGE"),
    [rate, setRate] = useState(0),
    [base, setBase] = useState(0),
    [allowance, setAllowance] = useState(0),
    [deductions, setDeductions] = useState(0),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const query = new URLSearchParams({
      ...scope,
      staffId: staff,
      periodEnd: end,
    }).toString(),
    manager = runtime.grant.capabilities?.includes("workflow.manage");
  const load = async (signal?: AbortSignal) => {
    const r = await fetch("/api/v1/sync/modules/labor?" + query, {
        signal,
        cache: "no-store",
      }),
      d = await r.json();
    if (!r.ok || !d.ok) throw Error(d.error || "Komisi belum tersedia");
    if (!signal?.aborted) {
      setData(d);
      setRate(Number(d.rule?.rate || 0));
      setKind(d.rule?.kind || "PERCENTAGE");
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setStatus(e.message);
    });
    return () => controller.abort();
  }, [query]);
  let pending: LaborCommand | null = null;
  try {
    pending = pendingWorkspaceLabor(w);
  } catch {}
  const approve = async (c: LaborCommand) => {
    if (!c.cash) throw Error("PAYROLL_CASH_REQUIRED");
    return requestFinancialApproval({
      ...scope,
      sector: runtime.manifest.sector,
      action: "CASH_OUT",
      reference: c.cash.clientEventId,
      reason: c.cash.description,
      command: c.cash,
    });
  };
  const run = async (action: "SET_RULE" | "PAY" | "RETRY" | "RENEW") => {
    setBusy(true);
    try {
      if (action === "RETRY") await flushWorkspaceLabor(w);
      else if (action === "RENEW") {
        const c = pendingWorkspaceLabor(w);
        if (!c) throw Error("Perintah tersimpan tidak tersedia");
        await renewWorkspaceLaborApproval(w, c.commandId, await approve(c));
        await flushWorkspaceLabor(w);
      } else {
        if (!data) throw Error("Muat perhitungan server terlebih dahulu");
        const commandId = crypto.randomUUID(),
          c: LaborCommand = { ...scope, commandId, staffId: staff, action };
        if (action === "SET_RULE")
          Object.assign(c, {
            kind,
            rate,
            baseRevision: Number(data.rule?.revision || 0),
          });
        else {
          if (!shift?.registerId || shift.status !== "OPEN")
            throw Error("Buka shift register sebelum membayar payroll.");
          const amount =
            Math.round(
              (base + allowance + data.quote.commission - deductions) * 100,
            ) / 100;
          Object.assign(c, {
            periodMonth: end.slice(0, 7),
            periodEnd: end,
            fingerprint: data.quote.fingerprint,
            baseSalary: base,
            allowance,
            deductions,
            cash: {
              clientEventId: "payroll:" + commandId,
              type: "CASH_OUT",
              amount,
              occurredAt: new Date().toISOString(),
              description: "Payroll " + end.slice(0, 7),
              category: "GAJI",
              recipientOrSource: staff,
              registerId: shift.registerId,
            },
          });
          c.cash!.approvalGrant = await approve(c);
        }
        await submitWorkspaceLabor(w, c);
      }
      await load();
      setStatus("Dikonfirmasi server.");
      window.dispatchEvent(new Event("financial-updated"));
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
    <section className="p-4 space-y-4 bg-white">
      <h2 className="text-xl font-bold">
        Komisi dan payroll · {runtime.manifest.name}
      </h2>
      <p>
        Komisi dicatat setelah layanan selesai dan tagihan lunas. Refund/void
        mencatat penyesuaian; slip yang sudah dibayar tetap utuh. Payroll tunai
        memakai register dan persetujuan finansial.
      </p>
      <p role="status">{status}</p>
      {pending && (
        <div className="border p-3">
          <p>
            Perintah {pending.commandId} tersimpan ({pending.action}).
          </p>
          <button
            disabled={busy}
            onClick={() => void run("RETRY")}
            className="border p-2"
          >
            Kirim ulang perintah asli
          </button>
          {pending.cash && (
            <button
              disabled={busy}
              onClick={() => void run("RENEW")}
              className="border p-2"
            >
              Perbarui persetujuan finansial
            </button>
          )}
        </div>
      )}
      {manager && (
        <label>
          Staf
          <select
            value={staff}
            onChange={(e) => setStaff(e.target.value)}
            className="block border p-2"
          >
            <option value={actor.id}>Akun saya</option>
            {staffMembers
              .filter((s) => s.id !== actor.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        Sampai tanggal
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="block border p-2"
        />
      </label>
      {data && (
        <>
          <p>
            Hak belum masuk payroll: Rp{" "}
            {Number(data.quote.commission).toLocaleString("id-ID")}
          </p>
          {manager && (
            <>
              <form
                className="border p-3 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("SET_RULE");
                }}
              >
                <h3>Aturan untuk penugasan baru</h3>
                <select
                  aria-label="Jenis komisi"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="border p-2"
                >
                  <option value="PERCENTAGE">
                    Persentase nilai layanan sebelum pajak
                  </option>
                  <option value="FIXED_PER_ORDER">Nominal per order</option>
                </select>
                <input
                  aria-label="Tarif komisi"
                  required
                  type="number"
                  min={0}
                  max={kind === "PERCENTAGE" ? 100 : 999999999}
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                  className="border p-2"
                />
                <button disabled={busy || !!pending} className="border p-2">
                  Simpan aturan
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("PAY");
                }}
                className="border p-3 space-y-2"
              >
                <h3>Payroll tunai {end.slice(0, 7)}</h3>
                {[
                  ["Gaji pokok", base, setBase],
                  ["Tunjangan", allowance, setAllowance],
                  ["Potongan", deductions, setDeductions],
                ].map(([label, value, set]) => (
                  <label key={String(label)} className="block">
                    {String(label)}
                    <input
                      required
                      type="number"
                      min={0}
                      max={999999999}
                      step="0.01"
                      value={Number(value)}
                      onChange={(e) =>
                        (set as (n: number) => void)(Number(e.target.value))
                      }
                      className="block border p-2"
                    />
                  </label>
                ))}
                <p>
                  Total: Rp{" "}
                  {(
                    base +
                    allowance +
                    Number(data.quote.commission) -
                    deductions
                  ).toLocaleString("id-ID")}
                </p>
                <button disabled={busy || !!pending} className="border p-2">
                  Setujui dan bayar dari register
                </button>
              </form>
            </>
          )}
          <h3>Riwayat komisi</h3>
          <ul>
            {data.ledger.map((r: any) => (
              <li key={r.id}>
                {new Date(r.created_at).toLocaleString()} ·{" "}
                {r.workspace_source === "ADJUSTMENT"
                  ? "Penyesuaian"
                  : "Hak layanan"}{" "}
                · Rp {Number(r.commission_amount).toLocaleString("id-ID")}
              </li>
            ))}
          </ul>
          <h3>Slip dibayar</h3>
          <ul>
            {data.payrolls.map((r: any) => (
              <li key={r.client_slip_id}>
                {r.period_month} · Rp{" "}
                {Number(r.net_salary).toLocaleString("id-ID")} · {r.status}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
