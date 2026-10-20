import GrowthIntegration from "./GrowthIntegration";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  Filter,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  STAGES,
  STAGE_LABEL,
  SECTORS,
  SIGNALS,
  allowedCommunication,
  type Lead,
  type Brief,
  type Stage,
} from "../../lib/growth/model";
import { SAAS_PLANS } from "../../config/saasPlans";
import "./growth.css";
const TABS = [
  "Overview",
  "Leads",
  "Pipeline",
  "AI Intelligence",
  "Trial Activation",
  "Content Performance",
  "Partners",
  "Retention",
  "Reports",
  "Settings",
  "Product Integration",
] as const;
type Tab = (typeof TABS)[number];
const labels: Record<Tab, string> = {
  Overview: "Ringkasan",
  Leads: "Leads",
  Pipeline: "Pipeline",
  "AI Intelligence": "AI Intelligence",
  "Trial Activation": "Aktivasi trial",
  "Content Performance": "Konten",
  Partners: "Partner",
  Retention: "Retensi",
  Reports: "Laporan",
  Settings: "Pengaturan",
  "Product Integration": "Integrasi produk",
};
const EMPTY = {
  company: "",
  contact_name: "",
  email: "",
  phone: "",
  sector: "FNB",
  city: "",
  outlets: 1,
  tools: "",
  challenges: "",
  source: "manual",
  owner_id: "",
  stage: "LEAD" as Stage,
  consent_email: false,
  consent_whatsapp: false,
  consent_ai: false,
  consent_basis: "",
  next_followup: "",
  partner_id: "",
};
function err(e: unknown) {
  return e instanceof Error
    ? e.message
    : "Permintaan belum berhasil. Silakan coba lagi.";
}
function date(v: string | null) {
  return v
    ? new Date(v).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Belum dijadwalkan";
}
function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="ge-panel">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
function Badge({ children }: { children: ReactNode }) {
  return <span className="ge-badge">{children}</span>;
}
function Chart({
  data,
  color = "#d97706",
}: {
  data: { name: string; count: number }[];
  color?: string;
}) {
  return data.length ? (
    <div
      className="ge-chart"
      role="img"
      aria-label={data.map((x) => `${x.name}: ${x.count}`).join(", ")}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar
            dataKey="count"
            name="Jumlah"
            fill={color}
            radius={[5, 5, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  ) : (
    <Empty />
  );
}
function Empty({ text = "Data belum tersedia" }: { text?: string }) {
  return (
    <div className="ge-empty">
      <Target size={26} />
      <p>{text}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} className="ge-dialog">
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="Tutup dialog" onClick={close}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function GrowthEngine({
  superadmin,
  onContent,
}: {
  superadmin: boolean;
  onContent: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Overview"),
    [overview, setOverview] = useState<any>(null),
    [leads, setLeads] = useState<Lead[]>([]),
    [total, setTotal] = useState(0),
    [operators, setOperators] = useState<any[]>([]),
    [candidates, setCandidates] = useState<any[]>([]),
    [partners, setPartners] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [sector, setSector] = useState(""),
    [stage, setStage] = useState(""),
    [owner, setOwner] = useState(""),
    [source, setSource] = useState(""),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [edit, setEdit] = useState<Lead | "new" | null>(null),
    [detail, setDetail] = useState<any>(null),
    [brief, setBrief] = useState<Brief | null>(null),
    [selected, setSelected] = useState(""),
    [settings, setSettings] = useState<any>(null),
    [content, setContent] = useState<any[]>([]);
  const refresh = () => setRevision((x) => x + 1);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.all([
        api.growth("overview"),
        api.growth("leads", { search, sector, stage, source, owner, offset }),
        api.growth("operators"),
        api.growth("partners"),
        api.growth("settings"),
      ])
        .then(
          ([a, b, c, d, e]) => {
            if (!live) return;
            setOverview(a.overview);
            setLeads(b.leads);
            setTotal(b.total);
            setOperators(c.operators);
            setCandidates(c.candidates);
            setPartners(d.partners);
            setSettings(e);
            setError("");
          },
          (e) => {
            if (live) setError(err(e));
          },
        )
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, sector, stage, source, owner, offset, revision]);
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }, []);
  const open = async (id: string) => {
    await act(async () => {
      setDetail(await api.growth("leads/" + id));
      setBrief(null);
    });
  };
  async function move(l: Lead, s: Stage) {
    await act(async () => {
      await api.growth(
        "leads/" + l.id,
        undefined,
        { stage: s, expectedVersion: l.version },
        "PATCH",
      );
      if (detail?.lead.id === l.id)
        setDetail(await api.growth("leads/" + l.id));
    });
  }
  const filtered = search || sector || stage || source || owner;
  const nav = (t: Tab) => {
    setTab(t);
    setError("");
    if (t === "Content Performance")
      void api.blog
        .list({ limit: 50 })
        .then((d) => setContent(d.posts ?? d.rows ?? []))
        .catch((e) => setError(err(e)));
  };
  return (
    <div className="ge" aria-busy={busy || loading}>
      <header className="ge-hero">
        <div>
          <div className="ge-eyebrow">
            <span /> NEW HOPE · INTERNAL WORKSPACE
          </div>
          <h1>
            Growth Engine <span>Pre-launch</span>
          </h1>
          <p>Bangun hubungan. Pahami kebutuhan. Tumbuhkan bisnis.</p>
        </div>
        <div className="ge-actions">
          <button onClick={refresh} aria-label="Muat ulang" disabled={busy}>
            <RefreshCw size={16} />
          </button>
          <button
            className="ge-primary"
            onClick={() => setEdit("new")}
            disabled={busy}
          >
            <Plus size={17} /> Lead baru
          </button>
        </div>
      </header>
      <div className="ge-safety">
        <Check size={15} />
        <span>
          {overview?.synthetic
            ? "DATA SINTETIS STAGING · Bukan performa bisnis nyata"
            : "Operasi internal · Data first-party"}{" "}
          · Komunikasi hanya draf · Waktu ditampilkan WIB
        </span>
      </div>
      <nav className="ge-tabs" aria-label="Modul Growth Engine">
        {TABS.map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => nav(t)}
          >
            {labels[t]}
          </button>
        ))}
      </nav>
      {error && (
        <div className="ge-error" role="alert">
          {error}
          <button onClick={refresh}>Coba lagi</button>
        </div>
      )}
      {loading && !overview ? (
        <p role="status" className="ge-empty">
          Memuat workspace Growth…
        </p>
      ) : null}
      {overview && (
        <>
          {(tab === "Overview" || tab === "Reports") && (
            <>
              <div className="ge-stats">
                {[
                  {
                    label: "Total leads",
                    value: overview.totalLeads,
                    icon: Users,
                    hint: "Prospek yang tersimpan",
                  },
                  {
                    label: "Terkualifikasi",
                    value: overview.qualified,
                    icon: Target,
                    hint: "Tahap pipeline saat ini",
                  },
                  {
                    label: "Product qualified",
                    value: overview.pql,
                    icon: TrendingUp,
                    hint: "Aturan transparan, belum tervalidasi statistik",
                  },
                  {
                    label: "Aktivasi trial",
                    value:
                      overview.activationRate === null
                        ? "—"
                        : Math.round(overview.activationRate * 100) + "%",
                    icon: ArrowUpRight,
                    hint: overview.trials
                      ? `${overview.trials} trial dengan event terverifikasi`
                      : "Data belum tersedia",
                  },
                ].map((x) => (
                  <div className="ge-stat" key={x.label}>
                    <div>
                      <span>{x.label}</span>
                      <x.icon size={18} />
                    </div>
                    <strong>{x.value}</strong>
                    <small>{x.hint}</small>
                  </div>
                ))}
              </div>
              <div className="ge-grid">
                <Panel
                  title="Pipeline saat ini"
                  action={<Badge>Snapshot, bukan kohor konversi</Badge>}
                >
                  <div className="ge-funnel">
                    {overview.funnel
                      .filter((x: any) => x.name !== "LOST")
                      .map((x: any, i: number) => (
                        <button
                          key={x.name}
                          onClick={() => {
                            setStage(x.name);
                            setOffset(0);
                            setTab("Pipeline");
                          }}
                        >
                          <span className="ge-step">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>{STAGE_LABEL[x.name as Stage]}</span>
                          <strong>{x.count}</strong>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                  </div>
                </Panel>
                <Panel title="Rekomendasi pertumbuhan">
                  <div className="ge-recommend">
                    <Sparkles size={26} />
                    <h3>Langkah kecil, dampak terukur.</h3>
                    <p>
                      Rekomendasi aturan berdasarkan data yang tersedia.
                      Validasi dengan manusia.
                    </p>
                    {overview.recommendations.map((s: string) => (
                      <div key={s}>
                        <Check size={16} />
                        <span>{s}</span>
                      </div>
                    ))}
                    <button onClick={() => nav("AI Intelligence")}>
                      Buka Sales Copilot <ArrowUpRight size={16} />
                    </button>
                  </div>
                </Panel>
                <Panel title="Akuisisi menurut sektor">
                  <Chart data={overview.sectors} />
                </Panel>
                <Panel title="Sumber lead">
                  <Chart data={overview.sources} color="#0f766e" />
                </Panel>
                <Panel title="Lead baru per minggu · UTC">
                  <Chart data={overview.weekly} />
                </Panel>
                <Panel title="Kesehatan trial">
                  <Chart data={overview.health} color="#475569" />
                </Panel>
              </div>
              <Panel title="Metrik yang memerlukan sumber tambahan">
                <div className="ge-unavailable">
                  {overview.unavailable.map((s: string) => (
                    <div key={s}>
                      <span>{s}</span>
                      <strong>Data belum tersedia</strong>
                    </div>
                  ))}
                </div>
                <p className="ge-footnote">
                  Tahap PAID pada CRM adalah catatan operator, bukan bukti
                  pembayaran. MRR, CAC dan churn tidak diturunkan dari catatan
                  manual.
                </p>
              </Panel>
            </>
          )}
          {(tab === "Leads" || tab === "Pipeline") && (
            <>
              <div className="ge-toolbar">
                <label className="ge-search">
                  <Search size={16} />
                  <span className="sr-only">Cari lead</span>
                  <input
                    placeholder="Cari usaha atau kontak…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
                <label>
                  <span className="sr-only">Sektor</span>
                  <select
                    value={sector}
                    onChange={(e) => {
                      setSector(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">Semua sektor</option>
                    {SECTORS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Tahap</span>
                  <select
                    value={stage}
                    onChange={(e) => {
                      setStage(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">Semua tahap</option>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Owner</span>
                  <select
                    value={owner}
                    onChange={(e) => {
                      setOwner(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">Semua owner</option>
                    {operators.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Sumber</span>
                  <input
                    placeholder="Filter sumber"
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
                {filtered && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setSector("");
                      setStage("");
                      setOwner("");
                      setSource("");
                      setOffset(0);
                    }}
                  >
                    <Filter size={14} /> Reset
                  </button>
                )}
                <button
                  onClick={() =>
                    void act(async () => {
                      const d = await api.growth("export");
                      download(
                        "newhope-growth-leads.csv",
                        d.csv,
                        "text/csv;charset=utf-8",
                      );
                    })
                  }
                >
                  <Download size={15} /> Ekspor
                </button>
                <label className="ge-upload">
                  Impor JSON
                  <input
                    aria-label="Impor lead JSON"
                    type="file"
                    accept="application/json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void act(async () => {
                          if (f.size > 300000)
                            throw Error("Berkas maksimal 300 KB.");
                          const d = JSON.parse(await f.text());
                          await api.growth(
                            "imports",
                            undefined,
                            { leads: Array.isArray(d) ? d : d.leads },
                            "POST",
                          );
                        });
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {tab === "Leads" ? (
                <Panel title={`${total} lead ${filtered ? "· difilter" : ""}`}>
                  <div className="ge-tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Usaha / kontak</th>
                          <th>Sektor / kota</th>
                          <th>Tahap</th>
                          <th>Skor</th>
                          <th>Owner</th>
                          <th>Follow-up</th>
                          <th>Komunikasi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((l) => (
                          <tr key={l.id}>
                            <td>
                              <button
                                className="ge-link"
                                onClick={() => void open(l.id)}
                              >
                                {l.company}
                              </button>
                              <small>
                                {l.contact_name || "Kontak belum dicatat"}
                              </small>
                            </td>
                            <td>
                              {l.sector}
                              <small>{l.city || "—"}</small>
                            </td>
                            <td>
                              <Badge>{STAGE_LABEL[l.stage]}</Badge>
                            </td>
                            <td>
                              <strong>{l.score}</strong>
                              <small>{l.classification}</small>
                            </td>
                            <td>
                              {operators.find((o) => o.id === l.owner_id)
                                ?.full_name ?? "Belum ditugaskan"}
                            </td>
                            <td>{date(l.next_followup)}</td>
                            <td>
                              {l.opted_out_at
                                ? "Opt-out"
                                : l.consent_email || l.consent_whatsapp
                                  ? "Opt-in tercatat"
                                  : "Tidak ada izin kirim"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!leads.length && (
                      <Empty text="Belum ada lead yang cocok. Tambahkan prospek dengan dasar pengumpulan yang sah." />
                    )}
                  </div>
                </Panel>
              ) : (
                <div className="ge-kanban" aria-label="Pipeline penjualan">
                  {STAGES.map((s) => (
                    <section
                      className="ge-column"
                      key={s}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const l = leads.find(
                          (l) => l.id === e.dataTransfer.getData("text/plain"),
                        );
                        if (l && !busy) void move(l, s);
                      }}
                    >
                      <header>
                        <h2>{STAGE_LABEL[s]}</h2>
                        <Badge>
                          {leads.filter((l) => l.stage === s).length}
                        </Badge>
                      </header>
                      {leads
                        .filter((l) => l.stage === s)
                        .map((l) => (
                          <article
                            className="ge-leadcard"
                            key={l.id}
                            draggable={!busy}
                            onDragStart={(e) =>
                              e.dataTransfer.setData("text/plain", l.id)
                            }
                          >
                            <small>
                              {l.sector} · {l.source}
                            </small>
                            <button
                              className="ge-link"
                              onClick={() => void open(l.id)}
                            >
                              {l.company}
                            </button>
                            <p>
                              {l.city || "Kota belum dicatat"} · {l.outlets}{" "}
                              outlet
                            </p>
                            <div>
                              <Badge>
                                {l.classification} · {l.score}
                              </Badge>
                            </div>
                            <label>
                              <span className="sr-only">
                                Pindahkan {l.company}
                              </span>
                              <select
                                value={l.stage}
                                disabled={busy}
                                onChange={(e) =>
                                  void move(l, e.target.value as Stage)
                                }
                              >
                                {STAGES.map((st) => (
                                  <option key={st} value={st}>
                                    {STAGE_LABEL[st]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </article>
                        ))}
                    </section>
                  ))}
                </div>
              )}
              <div className="ge-pagination">
                <span>
                  {offset + 1}–{Math.min(offset + leads.length, total)} dari{" "}
                  {total} · maksimal 100 kartu per halaman
                </span>
                <button
                  disabled={!offset || loading}
                  onClick={() => setOffset((x) => Math.max(0, x - 100))}
                >
                  Sebelumnya
                </button>
                <button
                  disabled={offset + 100 >= total || loading}
                  onClick={() => setOffset((x) => x + 100)}
                >
                  Berikutnya
                </button>
              </div>
            </>
          )}
          {tab === "AI Intelligence" && (
            <div className="ge-grid">
              <Panel title="Sales Copilot">
                <div className="ge-form">
                  <p>
                    Briefing, discovery, demo, keberatan dan follow-up. Fakta
                    yang dicatat selalu terpisah dari hipotesis AI.
                  </p>
                  <label>
                    Prospek
                    <select
                      value={selected}
                      onChange={(e) => {
                        setSelected(e.target.value);
                        setBrief(null);
                      }}
                    >
                      <option value="">
                        Pilih lead dari halaman CRM saat ini
                      </option>
                      {leads.map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.company}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="ge-primary"
                    disabled={!selected || busy}
                    onClick={() =>
                      void act(async () => {
                        setBrief(
                          (
                            await api.growth(
                              "leads/" + selected + "/copilot",
                              undefined,
                              {},
                              "POST",
                            )
                          ).brief,
                        );
                      })
                    }
                  >
                    <Sparkles size={16} /> Siapkan briefing
                  </button>
                  <p className="ge-footnote">
                    Jika provider atau persetujuan AI belum tersedia, sistem
                    memakai aturan lokal. Data kontak tidak dikirim ke provider.
                    Tidak ada pengiriman pesan.
                  </p>
                </div>
              </Panel>
              <Panel title="Brief & draf untuk ditinjau">
                {brief ? (
                  <BriefView
                    brief={brief}
                    lead={leads.find((l) => l.id === selected) ?? null}
                  />
                ) : (
                  <Empty text="Pilih prospek untuk memulai briefing." />
                )}
              </Panel>
            </div>
          )}
          {(tab === "Trial Activation" || tab === "Retention") && (
            <>
              <Panel
                title={
                  tab === "Retention"
                    ? "Kesehatan akun · event terverifikasi"
                    : "Aktivasi trial 45 hari"
                }
              >
                <p className="ge-footnote">
                  Tanggal trial memakai lifecycle billing bila akun tertaut; estimasi signup diberi label. Analitik tidak mengubah
                  langganan atau entitlement. Event yang belum tertaut ke lead
                  tidak dihitung. Health ini belum memprediksi churn.
                </p>
                <div className="ge-tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Lead</th>
                        <th>Hari tersisa</th><th>Sumber lifecycle</th>
                        <th>Setup</th>
                        <th>Health</th>
                        <th>Langkah berikut</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.profiles
                        .filter((p: any) => p.startedAt)
                        .map((p: any) => (
                          <tr key={p.id}>
                            <td>
                              <button
                                className="ge-link"
                                onClick={() => void open(p.id)}
                              >
                                {leads.find((l) => l.id === p.id)?.company ??
                                  "Lihat detail akun"}
                              </button>
                            </td>
                            <td>{p.daysRemaining}</td><td>{p.lifecycleSource==='billing_subscription'?`Billing · ${p.subscriptionStatus}`:'Estimasi signup'}</td>
                            <td>{p.completed.length}/8</td>
                            <td>{p.health}%</td>
                            <td>{p.next}</td>
                            <td>
                              {p.atRisk
                                ? "Perlu perhatian"
                                : p.activated
                                  ? "Aktif"
                                  : "Onboarding"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!overview.trials && (
                    <Empty text="Belum ada signup terverifikasi yang tertaut. Tidak ada trial yang diasumsikan." />
                  )}
                </div>
              </Panel>
              <Panel title="Paket New Hope yang tersedia">
                <div className="ge-plans">
                  {SAAS_PLANS.filter((p) => p.isActive).map((p) => (
                    <div key={p.id}>
                      <strong>{p.name}</strong>
                      <small>
                        {p.isTrial
                          ? "45 hari"
                          : `Rp${p.priceIdr.toLocaleString("id-ID")} / ${p.billingCycle}`}
                      </small>
                      <p>
                        {p.maxOutlets} outlet · {p.features[0]}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="ge-footnote">
                  Referensi katalog aplikasi; bukan penawaran otomatis,
                  perubahan harga, penagihan, atau aktivasi subscription.
                </p>
              </Panel>
            </>
          )}
          {tab === "Content Performance" && (
            <Panel
              title="Editorial & solusi New Hope"
              action={
                <button onClick={onContent}>
                  Buka pengelola blog <ArrowUpRight size={15} />
                </button>
              }
            >
              <p className="ge-footnote">
                Menggunakan blog yang sudah ada. Traffic, atribusi lead,
                ranking, dan visibilitas AI: Data belum tersedia.
              </p>
              <div className="ge-tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Artikel</th>
                      <th>Status</th>
                      <th>Pain point / solusi · saran aturan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {content.map((p: any) => (
                      <tr key={p.id}>
                        <td>{p.title}</td>
                        <td>{p.status ?? (p.published ? "Terbit" : "Draf")}</td>
                        <td>
                          {/hpp|margin|laba/i.test(p.title)
                            ? "Profitabilitas → HPP & laporan"
                            : /stok|inventor|waste/i.test(p.title)
                              ? "Persediaan → Inventori"
                              : /laundry/i.test(p.title)
                                ? "Operasional laundry → Pesanan"
                                : /kas|cash/i.test(p.title)
                                  ? "Arus kas → Laporan kas"
                                  : "Operasional usaha → Discovery kebutuhan"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!content.length && <Empty />}
              </div>
            </Panel>
          )}
          {tab === "Partners" && (
            <div className="ge-grid">
              <Panel title="Partner & referral">
                <div className="ge-tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Partner</th>
                        <th>Kode</th>
                        <th>Lead</th>
                        <th>Qualified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partners.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.name}
                            <small>{p.kind}</small>
                          </td>
                          <td>
                            <code>{p.code}</code>
                          </td>
                          <td>{p.referred}</td>
                          <td>{p.qualified}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!partners.length && (
                    <Empty text="Belum ada partner. Tidak ada komisi atau insentif finansial." />
                  )}
                </div>
              </Panel>
              <Panel title="Tambahkan partner">
                <form
                  className="ge-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act(async () => {
                      await api.growth(
                        "partners",
                        undefined,
                        Object.fromEntries(f),
                        "POST",
                      );
                    });
                  }}
                >
                  <label>
                    Nama partner
                    <input name="name" required maxLength={200} />
                  </label>
                  <label>
                    Jenis
                    <select name="kind">
                      {[
                        "community",
                        "trainer",
                        "consultant",
                        "mentor",
                        "implementation",
                        "software",
                        "association",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Kode referral
                    <input
                      name="code"
                      required
                      pattern="[A-Za-z0-9_-]{4,64}"
                      placeholder="KOMUNITAS2026"
                    />
                  </label>
                  <button className="ge-primary" disabled={busy}>
                    Simpan partner
                  </button>
                  <p className="ge-footnote">
                    Atribusi dicatat melalui pemilihan partner pada lead atau
                    impor yang disetujui. Tidak ada janji komisi.
                  </p>
                </form>
              </Panel>
            </div>
          )}
          {tab === "Product Integration" && <><label>Lead untuk undangan<select aria-label="Lead untuk undangan" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Pilih lead</option>{leads.map(l=><option key={l.id} value={l.id}>{l.company}</option>)}</select></label><GrowthIntegration leadId={selected||undefined}/></> }
          {tab === "Settings" && settings && (
            <div className="ge-grid">
              <Panel title="Bobot scoring · rules v1">
                <form
                  className="ge-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act(async () => {
                      await api.growth(
                        "settings",
                        undefined,
                        {
                          expectedVersion: settings.version,
                          weights: Object.fromEntries(
                            Object.keys(SIGNALS).map((k) => [
                              k,
                              Number(f.get(k)),
                            ]),
                          ),
                        },
                        "PUT",
                      );
                    });
                  }}
                >
                  <p>
                    Skor 0–100. PQL memerlukan ≥70 poin, transaksi server-synced
                    dan repeat usage. Belum tervalidasi statistik.
                  </p>
                  <div className="ge-weightgrid">
                    {Object.keys(SIGNALS).map((k) => (
                      <label key={k}>
                        {k}
                        <input
                          name={k}
                          type="number"
                          min={0}
                          max={40}
                          required
                          defaultValue={settings.weights[k]}
                          disabled={!superadmin}
                        />
                      </label>
                    ))}
                  </div>
                  <button disabled={busy || !superadmin} className="ge-primary">
                    Simpan bobot
                  </button>
                </form>
              </Panel>
              <Panel title="Akses & batas operasional">
                <div className="ge-form">
                  <p>
                    Hanya Superadmin dapat memberikan grant CRM kepada operator
                    internal terverifikasi. Grant ini tidak memberikan akses
                    pembukuan merchant.
                  </p>
                  {superadmin && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void act(() =>
                          api.growth(
                            "operators/" + f.get("id"),
                            undefined,
                            { canManage: f.get("access") === "write" },
                            "PUT",
                          ),
                        );
                      }}
                    >
                      <label>
                        Operator
                        <select name="id" required>
                          {candidates.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name} · {u.role}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Akses CRM
                        <select name="access">
                          <option value="read">Baca CRM</option>
                          <option value="write">Kelola CRM</option>
                        </select>
                      </label>
                      <button disabled={busy}>Simpan grant</button>
                    </form>
                  )}
                  {superadmin &&
                    operators
                      .filter((o) => o.role !== "ROLE_SUPERADMIN")
                      .map((o) => (
                        <div className="ge-actions" key={o.id}>
                          <span>{o.full_name}</span>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                api.growth(
                                  "operators/" + o.id + "/revoke",
                                  undefined,
                                  {},
                                  "POST",
                                ),
                              )
                            }
                          >
                            Cabut akses CRM
                          </button>
                        </div>
                      ))}
                  <ul>
                    <li>Produksi: dinonaktifkan di server.</li>
                    <li>Email/WhatsApp: draf, tanpa pengiriman.</li>
                    <li>
                      Identitas: review terpisah; tidak pernah merge otomatis.
                    </li>
                    <li>
                      AI: persetujuan per lead, payload minim, fallback aturan.
                    </li>
                    <li>
                      Retention data: ekspor/peninjauan manual; tidak ada
                      penghapusan otomatis.
                    </li>
                  </ul>
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
      {edit && (
        <LeadEditor
          lead={edit === "new" ? null : edit}
          operators={operators}
          partners={partners}
          busy={busy}
          error={error}
          close={() => setEdit(null)}
          save={async (data) => {
            await act(async () => {
              if (edit === "new")
                await api.growth("leads", undefined, data, "POST");
              else
                await api.growth(
                  "leads/" + edit.id,
                  undefined,
                  { ...data, expectedVersion: edit.version },
                  "PATCH",
                );
              setEdit(null);
              if (detail)
                setDetail(await api.growth("leads/" + detail.lead.id));
            });
          }}
        />
      )}
      {detail && !edit && (
        <Modal
          title={detail.lead.company}
          close={() => {
            setDetail(null);
            setBrief(null);
          }}
        >
          <div className="ge-form">
            <div className="ge-actions">
              <Badge>
                {detail.lead.classification} · {detail.lead.score}/100
              </Badge>
              <button onClick={() => setEdit(detail.lead)}>Edit lead</button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api.growth(
                      "leads/" + detail.lead.id + "/opt-out",
                      undefined,
                      {},
                      "POST",
                    );
                    setDetail(await api.growth("leads/" + detail.lead.id));
                  })
                }
              >
                Catat opt-out
              </button>
            </div>
            <p>
              {detail.lead.sector} · {detail.lead.city || "Kota belum diisi"} ·{" "}
              {detail.lead.outlets} outlet
            </p>
            <p>
              {detail.lead.email || "Email belum diisi"} ·{" "}
              {detail.lead.phone || "Telepon belum diisi"}
            </p>
            <p>
              <strong>Tantangan:</strong>{" "}
              {detail.lead.challenges || "Belum dicatat"}
            </p>
            <label>
              Tahap pipeline
              <select
                value={detail.lead.stage}
                disabled={busy}
                onChange={(e) =>
                  void move(detail.lead, e.target.value as Stage)
                }
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <h3>Alasan skor</h3>
            {detail.lead.reasons.length ? (
              detail.lead.reasons.map((r: any) => (
                <p key={r.signal}>
                  {r.signal}: +{r.points}
                </p>
              ))
            ) : (
              <p>Belum ada sinyal terverifikasi.</p>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void act(async () =>
                  setBrief(
                    (
                      await api.growth(
                        "leads/" + detail.lead.id + "/copilot",
                        undefined,
                        {},
                        "POST",
                      )
                    ).brief,
                  ),
                )
              }
            >
              <Sparkles size={15} /> Siapkan briefing & draf
            </button>
            {brief && <BriefView brief={brief} lead={detail.lead} />}
            <h3>Aktivitas & follow-up</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                void act(async () => {
                  await api.growth(
                    "leads/" + detail.lead.id + "/activities",
                    undefined,
                    {
                      ...Object.fromEntries(f),
                      dueAt: f.get("dueAt")
                        ? new Date(String(f.get("dueAt"))).toISOString()
                        : null,
                    },
                    "POST",
                  );
                  setDetail(await api.growth("leads/" + detail.lead.id));
                  form.reset();
                });
              }}
            >
              <label>
                Jenis
                <select name="kind">
                  <option value="note">Catatan</option>
                  <option value="task">Tugas</option>
                  <option value="call">Panggilan</option>
                  <option value="meeting">Pertemuan</option>
                </select>
              </label>
              <label>
                Catatan
                <textarea name="body" required maxLength={5000} />
              </label>
              <label>
                Jadwal (waktu perangkat)
                <input type="datetime-local" name="dueAt" />
              </label>
              <button disabled={busy}>Simpan aktivitas</button>
            </form>
            <div className="ge-timeline">
              {detail.activities.map((a: any) => (
                <article key={a.id}>
                  <small>
                    {a.kind} · {date(a.created_at)}
                  </small>
                  <p>{a.body}</p>
                  {a.due_at && <small>Jadwal: {date(a.due_at)}</small>}
                  {a.kind === "task" && !a.completed_at && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api.growth(
                            "activities/" + a.id + "/complete",
                            undefined,
                            {},
                            "POST",
                          );
                          setDetail(
                            await api.growth("leads/" + detail.lead.id),
                          );
                        })
                      }
                    >
                      Tandai selesai
                    </button>
                  )}
                  {a.completed_at && <Badge>Selesai</Badge>}
                </article>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function BriefView({ brief, lead }: { brief: Brief; lead: Lead | null }) {
  const [template, setTemplate] = useState("Discovery");
  return (
    <div className="ge-brief">
      <Badge>
        {brief.source === "provider"
          ? "Saran AI · perlu review"
          : "Aturan lokal"}
      </Badge>
      <h3>Informasi yang dicatat</h3>
      <ul>
        {brief.verifiedFacts.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h3>Hipotesis · belum terverifikasi</h3>
      <ul>
        {brief.hypotheses.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h3>Pertanyaan discovery</h3>
      <ul>
        {brief.questions.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h3>Agenda demo</h3>
      <ul>
        {brief.demo.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <p>
        <strong>Langkah berikut:</strong> {brief.nextAction}
      </p>
      <label>
        Template draf
        <select value={template} onChange={(e) => setTemplate(e.target.value)}>
          {[
            "Discovery",
            "WhatsApp",
            "Email",
            "Undangan demo",
            "Follow-up",
            "Onboarding trial",
            "Pengingat akhir trial",
            "Partnership",
            "Keberatan",
            "Ringkasan pertemuan",
            "Proposal",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Draf {template} · tinjau dan lengkapi fakta
        <textarea
          key={template + brief.draft}
          rows={6}
          defaultValue={
            template === "Discovery"
              ? brief.draft
              : template === "Keberatan"
                ? "Terima kasih telah menyampaikan pertimbangan Anda. Bagian mana yang perlu kita validasi melalui demo?"
                : template === "Proposal"
                  ? "Tujuan yang perlu disepakati:\nRuang lingkup demo:\nPaket sesuai katalog aktif:\nLangkah evaluasi berikut:"
                  : `Draf ${template}. Validasi jadwal, kebutuhan dan penerima sebelum digunakan.\n\n${brief.draft}`
          }
        />
      </label>
      <p className="ge-footnote">{brief.warning}</p>
      <p className="ge-footnote">
        Email:{" "}
        {lead && allowedCommunication(lead, "email")
          ? "opt-in tercatat"
          : "tidak diizinkan"}{" "}
        · WhatsApp:{" "}
        {lead && allowedCommunication(lead, "whatsapp")
          ? "opt-in tercatat"
          : "tidak diizinkan"}
        . Tidak ada tombol pengiriman.
      </p>
    </div>
  );
}
function LeadEditor({
  lead,
  operators,
  partners,
  busy,
  error,
  close,
  save,
}: {
  lead: Lead | null;
  operators: any[];
  partners: any[];
  busy: boolean;
  error: string;
  close: () => void;
  save: (data: any) => Promise<void>;
}) {
  const [form, setForm] = useState<any>(
    lead
      ? {
          ...EMPTY,
          ...lead,
          next_followup: lead.next_followup
            ? new Date(
                new Date(lead.next_followup).getTime() -
                  new Date(lead.next_followup).getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)
            : "",
        }
      : { ...EMPTY },
  );
  const set = (key: string, v: unknown) =>
    setForm((f: any) => ({ ...f, [key]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = Object.fromEntries(
      Object.keys(EMPTY).map((k) => [k, form[k]]),
    );
    if (data.next_followup)
      data.next_followup = new Date(String(data.next_followup)).toISOString();
    void save(data);
  };
  return (
    <Modal title={lead ? "Edit lead" : "Tambah lead baru"} close={close}>
      <form className="ge-form" onSubmit={submit}>
        {error && (
          <p className="ge-error" role="alert">
            {error}
          </p>
        )}
        <p>
          Masukkan hanya kontak bisnis yang Anda berwenang simpan. Persetujuan
          kirim pesan dan persetujuan AI dicatat terpisah.
        </p>
        <div className="ge-fields">
          {[
            ["company", "Nama usaha"],
            ["contact_name", "Nama kontak"],
            ["email", "Email"],
            ["phone", "Telepon"],
            ["city", "Kota"],
            ["tools", "Tools saat ini"],
            ["source", "Sumber lead"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={form[key] ?? ""}
                onChange={(e) => set(key, e.target.value)}
                required={key === "company" || key === "source"}
                type={key === "email" ? "email" : "text"}
                maxLength={key === "tools" ? 1000 : 254}
              />
            </label>
          ))}
          <label>
            Sektor
            <select
              value={form.sector}
              onChange={(e) => set("sector", e.target.value)}
            >
              {SECTORS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Jumlah outlet
            <input
              type="number"
              required
              min={1}
              max={10000}
              value={form.outlets}
              onChange={(e) => set("outlets", Number(e.target.value))}
            />
          </label>
          <label>
            Owner
            <select
              value={form.owner_id ?? ""}
              onChange={(e) => set("owner_id", e.target.value)}
            >
              <option value="">Belum ditugaskan</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tahap awal
            <select
              value={form.stage}
              onChange={(e) => set("stage", e.target.value)}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Partner
            <select
              value={form.partner_id ?? ""}
              onChange={(e) => set("partner_id", e.target.value)}
            >
              <option value="">Tanpa partner</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Follow-up (waktu perangkat)
            <input
              type="datetime-local"
              value={form.next_followup}
              onChange={(e) => set("next_followup", e.target.value)}
            />
          </label>
        </div>
        <label>
          Tantangan operasional
          <textarea
            value={form.challenges}
            maxLength={3000}
            onChange={(e) => set("challenges", e.target.value)}
          />
        </label>
        <label>
          Dasar pengumpulan & bukti persetujuan
          <textarea
            value={form.consent_basis}
            maxLength={1000}
            onChange={(e) => set("consent_basis", e.target.value)}
            placeholder="Contoh: formulir opt-in workshop, tanggal dan sumber privat"
            required={
              !!(
                form.email ||
                form.phone ||
                form.consent_email ||
                form.consent_whatsapp ||
                form.consent_ai
              )
            }
          />
        </label>
        <fieldset>
          <legend>Preferensi · tidak mengirim pesan</legend>
          {[
            ["consent_email", "Email"],
            ["consent_whatsapp", "WhatsApp"],
            [
              "consent_ai",
              "Analisis AI pihak ketiga (Agnes/DeepSeek, data minim)",
            ],
          ].map(([k, l]) => (
            <label className="ge-checkbox" key={k}>
              <input
                type="checkbox"
                checked={form[k]}
                disabled={!!lead?.opted_out_at}
                onChange={(e) => set(k, e.target.checked)}
              />
              {l}
            </label>
          ))}
        </fieldset>
        <footer className="ge-actions">
          <button type="button" onClick={close}>
            Batal
          </button>
          <button className="ge-primary" disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan lead"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
