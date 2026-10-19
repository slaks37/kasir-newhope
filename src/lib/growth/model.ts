export const STAGES = [
  "LEAD",
  "QUALIFIED",
  "DEMO",
  "SIGNUP",
  "TRIAL",
  "ACTIVATED",
  "PQL",
  "PAID",
  "RETAINED",
  "ADVOCATE",
  "LOST",
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  LEAD: "Lead baru",
  QUALIFIED: "Terkualifikasi",
  DEMO: "Demo",
  SIGNUP: "Terdaftar",
  TRIAL: "Trial",
  ACTIVATED: "Aktif",
  PQL: "PQL",
  PAID: "Berbayar",
  RETAINED: "Bertahan",
  ADVOCATE: "Advokat",
  LOST: "Ditutup",
};
export const SECTORS = [
  "FNB",
  "LAUNDRY",
  "RETAIL",
  "SERVICES",
  "OTHER",
] as const;
export const SIGNALS = {
  signup: 10,
  business_setup: 10,
  outlet_setup: 10,
  catalog_setup: 10,
  test_transaction: 5,
  synced_transaction: 20,
  report_viewed: 5,
  repeat_usage: 15,
  demo_requested: 10,
  referral: 5,
  pricing_interest: 5,
} as const;
export type Signal = keyof typeof SIGNALS;
export type Weights = Record<Signal, number>;
export interface Lead {
  id: string;
  company: string;
  contact_name: string;
  email: string | null;
  phone: string | null;
  sector: string;
  city: string;
  outlets: number;
  tools: string;
  challenges: string;
  source: string;
  owner_id: string | null;
  stage: Stage;
  version: number;
  consent_email: boolean;
  consent_whatsapp: boolean;
  consent_ai: boolean;
  consent_basis: string;
  consent_at: string | null;
  opted_out_at: string | null;
  next_followup: string | null;
  created_at: string;
  updated_at: string;
  partner_id: string | null;
  score?: number;
  classification?: string;
  reasons?: { signal: string; points: number }[];
}
export interface GrowthEvent {
  id?: string;
  lead_id: string | null;
  signal: Signal;
  occurred_at: string;
  verified: boolean;
  event_key?: string;
}
export function scoreLead(
  events: GrowthEvent[],
  weights: Weights = { ...SIGNALS },
) {
  const seen = new Set(events.filter((e) => e.verified).map((e) => e.signal));
  const reasons = Object.keys(weights)
    .filter((s) => seen.has(s as Signal))
    .map((s) => ({ signal: s, points: weights[s as Signal] }));
  const score = Math.min(
    100,
    reasons.reduce((n, r) => n + r.points, 0),
  );
  // A PQL must demonstrate actual server-synced usage and repeat usage.
  const classification =
    score >= 70 && seen.has("synced_transaction") && seen.has("repeat_usage")
      ? "PQL"
      : score >= 60
        ? "Hot"
        : score >= 30
          ? "Warm"
          : "Cold";
  return { score, classification, reasons };
}
const DAY = 86400000;
export function trialHealth(events: GrowthEvent[], now = new Date()) {
  const verified = events.filter(
    (e) => e.verified && new Date(e.occurred_at) <= now,
  );
  const starts = verified
    .filter((e) => e.signal === "signup")
    .map((e) => new Date(e.occurred_at).getTime());
  const started = starts.length ? Math.min(...starts) : null;
  const milestones = [
    "signup",
    "business_setup",
    "outlet_setup",
    "catalog_setup",
    "test_transaction",
    "synced_transaction",
    "report_viewed",
    "repeat_usage",
  ] as Signal[];
  const done = new Set(verified.map((e) => e.signal));
  const complete = milestones.filter((s) => done.has(s));
  const daysRemaining =
    started === null
      ? null
      : Math.max(0, 45 - Math.floor((now.getTime() - started) / DAY));
  const last = verified.length
    ? Math.max(...verified.map((e) => new Date(e.occurred_at).getTime()))
    : null;
  const inactiveDays =
    last === null ? null : Math.floor((now.getTime() - last) / DAY);
  const health = Math.round((complete.length / milestones.length) * 100);
  return {
    startedAt: started === null ? null : new Date(started).toISOString(),
    daysRemaining,
    health,
    completed: complete,
    next: milestones.find((s) => !done.has(s)) ?? "review_plan",
    atRisk:
      started !== null &&
      (daysRemaining === 0 || (inactiveDays !== null && inactiveDays >= 7)),
    activated: done.has("synced_transaction") && done.has("repeat_usage"),
    inactiveDays,
  };
}
export function allowedCommunication(
  lead: Pick<Lead, "consent_email" | "consent_whatsapp" | "opted_out_at">,
  channel: "email" | "whatsapp",
) {
  return (
    !lead.opted_out_at &&
    (channel === "email" ? lead.consent_email : lead.consent_whatsapp)
  );
}
export interface Brief {
  source: "rules" | "provider";
  verifiedFacts: string[];
  hypotheses: string[];
  questions: string[];
  demo: string[];
  nextAction: string;
  draft: string;
  warning: string;
}
export function prospectBrief(lead: Lead): Brief {
  const modules =
    lead.sector === "LAUNDRY"
      ? ["Status pesanan laundry", "Harga layanan", "Kinerja outlet"]
      : lead.sector === "FNB"
        ? ["HPP dan resep", "Persediaan bahan", "Laporan penjualan"]
        : ["Katalog produk/layanan", "Persediaan", "Laporan outlet"];
  return {
    source: "rules",
    verifiedFacts: [
      `Sektor yang dicatat operator: ${lead.sector}`,
      `Jumlah outlet yang dicatat: ${lead.outlets}`,
      `Tantangan yang dicatat: ${lead.challenges || "Belum diketahui"}`,
    ],
    hypotheses: [
      `Kemungkinan kebutuhan: ${modules.join(", ")}. Perlu konfirmasi prospek.`,
    ],
    questions: [
      "Bagaimana proses operasional saat ini?",
      "Hambatan mana yang paling mendesak?",
      "Siapa yang berwenang mengevaluasi solusi?",
    ],
    demo: modules,
    nextAction: lead.next_followup
      ? "Tinjau jadwal follow-up dan persetujuan komunikasi."
      : "Validasi kebutuhan dan catat tindak lanjut.",
    draft:
      "Halo, kami ingin memahami kebutuhan operasional usaha Anda. Apakah Anda bersedia menjadwalkan diskusi singkat? Pesan ini adalah draf untuk ditinjau manusia.",
    warning:
      "Hipotesis berbasis aturan, bukan fakta atau model prediksi tervalidasi. Tidak ada pesan yang dikirim.",
  };
}
