import WorkspaceReceiptActions, {
  type ServiceReceipt,
} from "./WorkspaceReceiptActions";
import { jobCheckoutAmounts, type JobPricing } from "./jobAmounts";
import React, { useEffect, useState } from "react";
import { useBusinessModule } from "./ModuleWorkspaceGate";
import { useWorkspaceBusiness } from "../../context/WorkspaceBusinessContext";
import { useAuth } from "../../context/AuthContext";
import { usePOSFields } from "../../context/POSDomains";
import { workflowStages, workflowLabels } from "./domainWorkflow";
import {
  submitWorkspaceJob,
  flushWorkspaceJob,
  pendingWorkspaceJob,
  type JobInput,
  type JobLineInput,
} from "../../lib/sync/workspaceJobQueue";
import {
  enqueueDurable,
  flush,
  financialWorkspaceKey,
  getPendingTransactions,
  type SyncPayloadTxn,
} from "../../lib/sync/queue";
import { refreshCoordinator } from "../../lib/sync/refreshCoordinator";
type Job = {
  remaining: Record<string, number>;
  billed: { subtotal: number; tax: number; service: number };
  id: string;
  job_number: string;
  status: string;
  revision: number;
  paid: boolean;
  assigned_staff_id: string | null;
  resource_name: string | null;
  intake: {
    pricing: JobPricing;
    customerName: string;
    customerPhone: string;
    vehiclePlate?: string;
    vehicleModel?: string;
    orderType?: string;
    collection?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    lines: Array<
      JobLineInput & {
        productName: string;
        unit: string;
        unitPrice: number;
        selection: {
          variantId: string | null;
          selectedModifiers: Array<{ groupId: string; optionId: string }>;
        };
      }
    >;
  };
  receipts: ServiceReceipt[];
};
const money = (x: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(x);
export default function WorkspaceOperations() {
  const runtime = useBusinessModule()!,
    business = useWorkspaceBusiness(),
    actor = useAuth().user!;
  const { products, staffMembers, shift } = usePOSFields([
    "products",
    "staffMembers",
    "shift",
  ]);
  const identity = {
    tenantId: business.business.tenantId,
    merchantId: runtime.access.businessId,
    outletId: runtime.access.outletId,
    moduleId: runtime.manifest.id,
    actorRef: actor.id,
  };
  const key = financialWorkspaceKey(identity),
    scope = {
      businessId: identity.merchantId,
      outletId: identity.outletId,
      moduleId: identity.moduleId,
    },
    query = new URLSearchParams(scope).toString();
  const [resources, setResources] = useState<
      Array<{ id: string; name: string }>
    >([]),
    [resourceName, setResourceName] = useState(""),
    [capacity, setCapacity] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [customerName, setName] = useState(""),
    [customerPhone, setPhone] = useState(""),
    [resource, setResource] = useState(""),
    [staff, setStaff] = useState("");
  const [start, setStart] = useState(""),
    [duration, setDuration] = useState(45),
    [orderType, setOrderType] = useState("DINE_IN"),
    [collection, setCollection] = useState("PICKUP"),
    [address, setAddress] = useState(""),
    [plate, setPlate] = useState(""),
    [model, setModel] = useState("");
  const [productRef, setProduct] = useState(""),
    [quantity, setQuantity] = useState(1),
    [variant, setVariant] = useState(""),
    [modifiers, setModifiers] = useState<
      Array<{ groupId: string; optionId: string }>
    >([]),
    [description, setDescription] = useState(""),
    [lines, setLines] = useState<JobLineInput[]>([]);
  const [checkout, setCheckout] = useState<Job | null>(null),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [method, setMethod] = useState("CASH"),
    [receipt, setReceipt] = useState<Job | null>(null);
  const canSell =
    runtime.grant.permissions.includes("pos") &&
    runtime.grant.features.includes("pos");
  const manager = runtime.grant.capabilities?.includes("workflow.manage");
  const product = products.find((p) => p.id === productRef),
    stages = workflowStages[runtime.manifest.id];
  const load = async (signal?: AbortSignal, cursor?: string) => {
    const response = await fetch(
      "/api/v1/sync/modules/jobs?" +
        query +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      {
        signal,
      },
    );
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw Error(data.error || "Order belum dapat dimuat");
    setJobs((previous) =>
      cursor
        ? [
            ...previous,
            ...data.jobs.filter(
              (j: Job) => !previous.some((p) => p.id === j.id),
            ),
          ]
        : data.jobs,
    );
    setNextCursor(data.nextCursor || null);
    setResources(data.resources || []);
  };
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        if (pendingWorkspaceJob(identity)) await flushWorkspaceJob(identity);
        await load(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted)
          setStatus(e instanceof Error ? e.message : "Koneksi belum tersedia");
      }
    };
    const off = refreshCoordinator.register("domain-jobs:" + key, {
      run,
      interval: 30000,
      events: ["online", "financial-updated", "outlets-updated"],
    });
    void run();
    return () => {
      controller.abort();
      off();
    };
  }, [key, query]);
  let pending = false;
  try {
    pending = !!pendingWorkspaceJob(identity);
  } catch {}
  const run = async (input?: JobInput) => {
    setBusy(true);
    try {
      if (input) await submitWorkspaceJob(identity, input);
      else await flushWorkspaceJob(identity);
      await load();
      setStatus("Perubahan dikonfirmasi server.");
      if (input?.action === "CREATE") setLines([]);
    } catch (e) {
      setStatus(
        (e instanceof Error ? e.message : "Koneksi belum tersedia") +
          " · Perintah yang tersimpan tetap menunggu konfirmasi.",
      );
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    const scheduledStart = start ? new Date(start).toISOString() : undefined;
    void run({
      action: "CREATE",
      jobId: crypto.randomUUID(),
      customerName,
      customerPhone,
      resource: resource || undefined,
      assignedStaffId: staff || undefined,
      scheduledStart,
      scheduledEnd: scheduledStart
        ? new Date(Date.parse(scheduledStart) + duration * 60000).toISOString()
        : undefined,
      orderType,
      collection,
      deliveryAddress: address,
      vehiclePlate: plate,
      vehicleModel: model,
      lines,
    });
  };
  const pay = async () => {
    if (!checkout) return;
    setBusy(true);
    try {
      if (!shift || shift.status !== "OPEN")
        throw Error(
          "Buka shift kasir untuk outlet dan modul ini terlebih dahulu.",
        );
      if (
        getPendingTransactions(key).some(
          (t) => t.operationalJobId === checkout.id,
        )
      )
        throw Error(
          "Pembayaran order ini masih menunggu konfirmasi. Gunakan Kirim ulang pembayaran.",
        );
      const selected = checkout.intake.lines
        .filter((l) => (quantities[l.id] || 0) > 0)
        .map((l) => ({
          clientItemId: l.id,
          productRef: l.productRef,
          productName: l.productName,
          variantId: l.selection.variantId || undefined,
          selectedModifiers: l.selection.selectedModifiers,
          unitPrice: l.unitPrice,
          unitCost: 0,
          quantity: quantities[l.id],
          totalPrice: Math.round(l.unitPrice * quantities[l.id] * 100) / 100,
        }));
      if (!selected.length) throw Error("Pilih jumlah item yang dibayar.");
      const subtotal = selected.reduce((n, l) => n + l.totalPrice, 0),
        amounts = jobCheckoutAmounts(
          checkout.intake.pricing,
          subtotal,
          checkout.billed,
        ),
        txn: SyncPayloadTxn = {
          workspace: identity,
          branchId: identity.outletId,
          operationalJobId: checkout.id,
          clientTxnId: crypto.randomUUID(),
          invoiceNumber: "",
          cashierRef: actor.id,
          cashierName: String(
            actor.user_metadata.full_name || actor.email || "Kasir",
          ),
          createdAt: new Date().toISOString(),
          shiftId: shift.id,
          subtotal,
          discountAmount: 0,
          taxAmount: amounts.tax,
          serviceChargeAmount: amounts.service,
          totalAmount: amounts.total,
          paymentMethod: method,
          paymentStatus: "PAID",
          items: selected,
        };
      await enqueueDurable(key, txn);
      await retryPayment();
      setCheckout(null);
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : "Pembayaran belum dikonfirmasi",
      );
    } finally {
      setBusy(false);
    }
  };
  const retryPayment = async () => {
    const result = await flush(
      {
        businessId: key,
        workspace: identity,
        outletId: identity.outletId,
        sector: runtime.manifest.sector,
        storeName: runtime.manifest.name,
        ownerRef: actor.id,
      },
      true,
    );
    setStatus(
      result.pending || result.quarantined
        ? "Pembayaran tersimpan dan masih perlu sinkronisasi/pemeriksaan."
        : "Pembayaran dikonfirmasi server.",
    );
    await load();
  };
  return (
    <div className="p-4 space-y-5">
      <div className="print:hidden space-y-5">
        <h2 className="text-xl font-bold">
          {runtime.manifest.name} · Operasional
        </h2>
        <p role="status">{status}</p>
        {pending && (
          <button
            disabled={busy}
            onClick={() => void run()}
            className="border rounded p-2"
          >
            Kirim ulang perintah order tersimpan
          </button>
        )}
        {canSell && (
          <button
            disabled={busy}
            onClick={() =>
              void retryPayment().catch((e) => setStatus(e.message))
            }
            className="border rounded p-2"
          >
            Kirim ulang pembayaran
          </button>
        )}
        {manager && ["fnb", "carwash"].includes(runtime.manifest.id) && (
          <form
            className="flex flex-wrap items-end gap-2 border rounded-xl bg-white p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              const id = crypto.randomUUID();
              void fetch("/api/v1/sync/modules/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...scope,
                  operations: [
                    {
                      kind: "tables",
                      recordId: id,
                      baseRevision: 0,
                      deleted: false,
                      value: {
                        id,
                        name: resourceName,
                        capacity,
                        zone: "MAIN",
                        status: "AVAILABLE",
                      },
                    },
                  ],
                }),
              })
                .then(async (r) => {
                  const data = await r.json();
                  if (!r.ok || !data.ok || data.versions?.length !== 1)
                    throw Error(data.error || "Tempat belum dikonfirmasi");
                  await load();
                  setResourceName("");
                  setStatus("Meja/bay dikonfirmasi server.");
                })
                .catch((e) => setStatus(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Nama meja / bay
              <input
                required
                maxLength={64}
                value={resourceName}
                onChange={(e) => setResourceName(e.target.value)}
                className="block border p-2"
              />
            </label>
            <label>
              Kapasitas
              <input
                required
                type="number"
                min={1}
                max={100}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="block border p-2 w-24"
              />
            </label>
            <button disabled={busy} className="border p-2 rounded">
              Tambah meja / bay
            </button>
          </form>
        )}
        {canSell && (
          <section className="bg-white border rounded-xl p-4 space-y-3">
            <h3 className="font-bold">
              {runtime.manifest.id === "laundry"
                ? "Penerimaan cucian"
                : runtime.manifest.id === "carwash"
                  ? "Penerimaan kendaraan"
                  : runtime.manifest.id === "barber"
                    ? "Booking layanan"
                    : "Pesanan baru"}
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
              className="space-y-3"
            >
              <div className="flex flex-wrap gap-3">
                <label>
                  Nama pelanggan
                  <input
                    required
                    maxLength={150}
                    value={customerName}
                    onChange={(e) => setName(e.target.value)}
                    className="block border p-2"
                  />
                </label>
                <label>
                  Telepon
                  <input
                    required
                    maxLength={40}
                    value={customerPhone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="block border p-2"
                  />
                </label>
                <label>
                  Petugas
                  <select
                    value={staff}
                    onChange={(e) => setStaff(e.target.value)}
                    className="block border p-2"
                  >
                    <option value="">Belum ditugaskan</option>
                    {staffMembers
                      .filter((s) => s.isAvailable !== false)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                {["fnb", "carwash"].includes(runtime.manifest.id) && (
                  <label>
                    {runtime.manifest.id === "fnb" ? "Meja" : "Bay"}
                    <select
                      required={
                        runtime.manifest.id === "fnb" && orderType === "DINE_IN"
                      }
                      value={resource}
                      onChange={(e) => setResource(e.target.value)}
                      className="block border p-2"
                    >
                      <option value="">Tanpa tempat</option>
                      {resources.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {runtime.manifest.id === "fnb" && (
                  <label>
                    Jenis pesanan
                    <select
                      value={orderType}
                      onChange={(e) => setOrderType(e.target.value)}
                      className="block border p-2"
                    >
                      <option value="DINE_IN">Makan di tempat</option>
                      <option value="TAKEAWAY">Bawa pulang</option>
                      <option value="DELIVERY">Antar</option>
                    </select>
                  </label>
                )}
                {runtime.manifest.id === "laundry" && (
                  <label>
                    Penyerahan
                    <select
                      value={collection}
                      onChange={(e) => setCollection(e.target.value)}
                      className="block border p-2"
                    >
                      <option value="PICKUP">Diambil pelanggan</option>
                      <option value="DELIVERY">Diantar</option>
                    </select>
                  </label>
                )}
                {((orderType === "DELIVERY" && runtime.manifest.id === "fnb") ||
                  (collection === "DELIVERY" &&
                    runtime.manifest.id === "laundry")) && (
                  <label>
                    Alamat antar
                    <input
                      required
                      maxLength={500}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="block border p-2"
                    />
                  </label>
                )}
                {runtime.manifest.id === "carwash" && (
                  <>
                    <label>
                      Nomor kendaraan
                      <input
                        required
                        maxLength={20}
                        value={plate}
                        onChange={(e) => setPlate(e.target.value)}
                        className="block border p-2"
                      />
                    </label>
                    <label>
                      Jenis/model
                      <input
                        required
                        maxLength={100}
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="block border p-2"
                      />
                    </label>
                  </>
                )}
                {runtime.manifest.id === "barber" && (
                  <>
                    <label>
                      Jadwal
                      <input
                        required
                        type="datetime-local"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className="block border p-2"
                      />
                    </label>
                    <label>
                      Durasi (menit)
                      <input
                        required
                        type="number"
                        min={1}
                        max={1440}
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        className="block border p-2 w-24"
                      />
                    </label>
                  </>
                )}
              </div>
              <fieldset className="border rounded p-3 space-y-2">
                <legend>Layanan / item</legend>
                <div className="flex flex-wrap gap-2 items-end">
                  <label>
                    Produk
                    <select
                      value={productRef}
                      onChange={(e) => {
                        setProduct(e.target.value);
                        setVariant("");
                        setModifiers([]);
                      }}
                      className="block border p-2"
                    >
                      <option value="">Pilih layanan</option>
                      {products
                        .filter((p) => p.isAvailable)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {money(p.price)}/{p.unit}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {runtime.manifest.id === "laundry"
                      ? "Berat / jumlah"
                      : "Jumlah"}{" "}
                    ({product?.unit || "satuan"})
                    <input
                      type="number"
                      min="0.001"
                      max={999999}
                      step="0.001"
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="block border p-2 w-24"
                    />
                  </label>
                  {!!product?.variants?.length && (
                    <label>
                      Varian
                      <select
                        value={variant}
                        onChange={(e) => setVariant(e.target.value)}
                        className="block border p-2"
                      >
                        <option value="">Standar</option>
                        {product.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} +{money(v.priceExtra)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Catatan item
                    <input
                      maxLength={200}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="block border p-2"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!product || quantity <= 0}
                    onClick={() => {
                      setLines([
                        ...lines,
                        {
                          id: crypto.randomUUID(),
                          productRef,
                          quantity,
                          variantId: variant || undefined,
                          selectedModifiers: modifiers,
                          description: description || undefined,
                        },
                      ]);
                      setDescription("");
                    }}
                    className="border rounded p-2"
                  >
                    Tambah item
                  </button>
                </div>
                {product?.modifierGroups?.map((g) => (
                  <fieldset key={g.id}>
                    <legend>
                      {g.name}
                      {g.required ? " (wajib)" : ""}
                    </legend>
                    {g.options.map((o) => (
                      <label key={o.id} className="mr-3">
                        <input
                          type="checkbox"
                          checked={modifiers.some(
                            (m) => m.groupId === g.id && m.optionId === o.id,
                          )}
                          onChange={(e) =>
                            setModifiers(
                              e.target.checked
                                ? [
                                    ...modifiers,
                                    { groupId: g.id, optionId: o.id },
                                  ]
                                : modifiers.filter(
                                    (m) =>
                                      m.groupId !== g.id || m.optionId !== o.id,
                                  ),
                            )
                          }
                        />
                        {o.name} +{money(o.price)}
                      </label>
                    ))}
                  </fieldset>
                ))}
                <ul>
                  {lines.map((l) => (
                    <li key={l.id}>
                      {products.find((p) => p.id === l.productRef)?.name} ·{" "}
                      {l.quantity}{" "}
                      {products.find((p) => p.id === l.productRef)?.unit}{" "}
                      <button
                        type="button"
                        onClick={() =>
                          setLines(lines.filter((x) => x.id !== l.id))
                        }
                      >
                        Hapus
                      </button>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <button
                disabled={busy || pending || !lines.length}
                className="border rounded p-2"
              >
                Simpan intake / booking
              </button>
            </form>
          </section>
        )}
        <section
          className="grid gap-3 md:grid-cols-2"
          aria-label="Antrean layanan"
        >
          {jobs.map((j) => (
            <article
              key={j.id}
              className="bg-white border rounded-xl p-4 space-y-2"
            >
              <h3 className="font-bold">
                {j.intake.customerName} · {workflowLabels[j.status] || j.status}
              </h3>
              <p>
                {j.intake.vehiclePlate} {j.intake.vehicleModel}{" "}
                {j.intake.orderType} {j.intake.collection}
              </p>
              {j.intake.scheduledStart && (
                <p>
                  {new Date(j.intake.scheduledStart).toLocaleString()} –{" "}
                  {new Date(j.intake.scheduledEnd!).toLocaleTimeString()}
                </p>
              )}
              <ul>
                {j.intake.lines.map((l) => (
                  <li key={l.id}>
                    {l.productName} · {l.quantity} {l.unit} ·{" "}
                    {money(l.unitPrice * l.quantity)}
                  </li>
                ))}
                {nextCursor && (
                  <button
                    disabled={busy}
                    className="border rounded p-3"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await load(undefined, nextCursor);
                      } catch (e) {
                        setStatus(
                          e instanceof Error
                            ? e.message
                            : "Order belum dapat dimuat",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Muat order lebih lama
                  </button>
                )}
              </ul>
              {manager && j.status === stages[0] && (
                <label>
                  Petugas
                  <select
                    disabled={busy || pending}
                    value={j.assigned_staff_id || ""}
                    onChange={(e) =>
                      void run({
                        action: "ASSIGN",
                        jobId: j.id,
                        baseRevision: Number(j.revision),
                        assignedStaffId: e.target.value || null,
                      })
                    }
                    className="block border p-2"
                  >
                    <option value="">Belum ditugaskan</option>
                    {j.assigned_staff_id &&
                      !staffMembers.some(
                        (s) => s.id === j.assigned_staff_id,
                      ) && (
                        <option value={j.assigned_staff_id}>
                          Petugas sebelumnya
                        </option>
                      )}
                    {staffMembers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>
                {j.paid
                  ? "Lunas menurut struk server"
                  : "Belum lunas / perlu pemeriksaan pembayaran"}
              </p>
              <div className="flex flex-wrap gap-2">
                {stages.includes(j.status) &&
                  stages.indexOf(j.status) < stages.length - 1 && (
                    <button
                      disabled={busy || pending}
                      onClick={() =>
                        void run({
                          action: "TRANSITION",
                          jobId: j.id,
                          baseRevision: Number(j.revision),
                          status: stages[stages.indexOf(j.status) + 1],
                        })
                      }
                      className="border rounded p-2"
                    >
                      {workflowLabels[stages[stages.indexOf(j.status) + 1]]}
                    </button>
                  )}
                {canSell &&
                  !j.paid &&
                  j.status !== "CANCELLED" &&
                  Object.values(j.remaining).some((n) => n > 0) && (
                    <button
                      onClick={() => {
                        setCheckout(j);
                        setQuantities(
                          Object.fromEntries(
                            j.intake.lines.map((l) => [l.id, 0]),
                          ),
                        );
                      }}
                      className="border rounded p-2"
                    >
                      Bayar / pisah tagihan
                    </button>
                  )}
                {canSell && j.receipts.length > 0 && (
                  <button
                    onClick={() => {
                      setReceipt(j);
                      requestAnimationFrame(() => window.print());
                    }}
                    className="border rounded p-2"
                  >
                    Cetak struk server
                  </button>
                )}
                {manager && j.receipts.length > 0 && (
                  <WorkspaceReceiptActions
                    receipts={j.receipts}
                    jobId={j.id}
                    onRefresh={() => load()}
                  />
                )}
                {manager && j.status !== "CANCELLED" && (
                  <button
                    disabled={busy || pending}
                    onClick={() =>
                      void run({
                        action: "TRANSITION",
                        jobId: j.id,
                        baseRevision: Number(j.revision),
                        status: "CANCELLED",
                      })
                    }
                    className="border rounded p-2"
                  >
                    Batalkan intake
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
        {checkout && (
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Pembayaran order"
            className="fixed inset-4 z-50 overflow-auto bg-white border shadow-xl rounded-xl p-5 space-y-3"
          >
            <h3 className="font-bold">
              Pembayaran · {checkout.intake.customerName}
            </h3>
            <p>
              Isi jumlah item untuk struk ini. Sisa tagihan tetap pada order;
              server memeriksa jumlah kumulatif.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void pay();
              }}
              className="space-y-3"
            >
              {checkout.intake.lines.map((l) => (
                <label key={l.id} className="block">
                  {l.productName} ({l.unit}) · {money(l.unitPrice)} · Sisa{" "}
                  {checkout.remaining[l.id] || 0}
                  <input
                    type="number"
                    min={0}
                    max={checkout.remaining[l.id] || 0}
                    step="0.001"
                    value={quantities[l.id] || 0}
                    onChange={(e) =>
                      setQuantities({
                        ...quantities,
                        [l.id]: Number(e.target.value),
                      })
                    }
                    className="block border p-2 w-32"
                  />
                </label>
              ))}
              <label>
                Metode yang diterima kasir
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="block border p-2"
                >
                  <option value="CASH">Tunai</option>
                  <option value="QRIS_STATIC">QRIS toko (dicatat kasir)</option>
                  <option value="DEBIT">Debit (dicatat kasir)</option>
                  <option value="TRANSFER">Transfer (dicatat kasir)</option>
                </select>
              </label>
              <button disabled={busy} className="border rounded p-2">
                Simpan pembayaran
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCheckout(null)}
                className="border rounded p-2 ml-2"
              >
                Tutup
              </button>
            </form>
          </section>
        )}
      </div>
      {receipt && (
        <section className="hidden print:block">
          <h2>{runtime.manifest.name}</h2>
          <p>{receipt.intake.customerName}</p>
          {receipt.receipts.map((r) => (
            <div key={r.client_txn_id}>
              <h3>{r.invoice_number || r.client_txn_id}</h3>
              <p>
                {new Date(r.created_at).toLocaleString()} ·{" "}
                {money(Number(r.total_amount))}
              </p>
              <ul>
                {r.items?.map((l, i) => (
                  <li key={i}>
                    {l.name} · {l.quantity} × {money(Number(l.unitPrice))}
                  </li>
                ))}
              </ul>
              <p>
                {r.payment_method} · {r.order_status} · Dicatat kasir
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
