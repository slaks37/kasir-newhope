/**
 * CHURN RISK — explainable scoring model.
 *
 * TIDAK ADA YANG MENGIMPOR BERKAS INI, DAN ITU BUKAN BERARTI IA MATI.
 *
 * Berkas ini sempat dihapus sebagai "kode mati" karena graf impor menunjukkan
 * nol pengimpor. Itu keliru: `scripts/dev/check-source-hygiene.mjs` membacanya
 * LEWAT PATH, bukan lewat `import`, sebagai ekspresi kanonik model churn dalam
 * TypeScript — lalu membandingkannya dengan dua implementasi lain (rumus SQL di
 * migrations/0004 dan cron di scripts/batch/merchant-health.mjs) dan menggagalkan
 * gerbang higiene bila ketiganya menyimpang.
 *
 * Menghapusnya tidak menimbulkan error apa pun. Pemeriksa paritas hanya berhenti
 * diam-diam (`if (!sql || !ts || !job) return;`), dan ketiga salinan model itu
 * bebas berbeda tanpa ada yang tahu. Jangan hapus tanpa memindahkan perannya.
 *
 * This is the TypeScript twin of `compute_churn_risk()` in
 * migrations/0004_internal_backoffice.sql. The weights MUST stay identical: the
 * API scores live merchants with this, the nightly job writes history with the
 * SQL version, and a growth analyst comparing today's dashboard against last
 * week's cohort must not be looking at two different models.
 *
 * Deliberately a transparent weighted sum rather than a fitted classifier. A CSM
 * has to phone a merchant and say *why* — "belum ada transaksi 9 hari" is
 * actionable, "model says 0.73" is not.
 */

export interface ChurnRiskInput {
  /** Days since the merchant's last recorded transaction. */
  daysSinceLastTxn: number;
  /** Distinct days with activity in the last 7. */
  activeDaysLast7: number;
  /** Revenue change, 7-day average vs the prior period. Negative = decline. */
  revenueTrendPct: number;
  subscriptionStatus?: string;
  /** How many distinct features the merchant touched in the window. */
  distinctFeatures: number;
  supportTickets: number;
}

export type ChurnBand = 'HEALTHY' | 'WATCH' | 'AT_RISK' | 'CRITICAL';

export interface ChurnRiskResult {
  /** 0.00 - 1.00, two decimals. */
  score: number;
  band: ChurnBand;
  /** Ordered by contribution, largest first. What the CSM actually reads. */
  reasons: { factor: string; weight: number; contribution: number; detail: string }[];
}

/** Weights mirror the SQL function exactly. Change both or neither. */
export const CHURN_WEIGHTS = {
  recency: 0.4,
  activity: 0.2,
  trend: 0.15,
  billing: 0.15,
  adoption: 0.05,
  support: 0.05,
} as const;

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

function billingRisk(status?: string): { value: number; detail: string } {
  switch (status) {
    case 'EXPIRED':
      return { value: 1, detail: 'Langganan sudah kedaluwarsa' };
    case 'CANCELED':
      return { value: 1, detail: 'Langganan dibatalkan' };
    case 'PAST_DUE':
      return { value: 0.7, detail: 'Pembayaran menunggak' };
    case 'TRIAL':
      return { value: 0.3, detail: 'Masih masa trial, belum berkomitmen' };
    default:
      return { value: 0, detail: 'Langganan aktif' };
  }
}

export function bandFor(score: number): ChurnBand {
  if (score >= 0.7) return 'CRITICAL';
  if (score >= 0.45) return 'AT_RISK';
  if (score >= 0.25) return 'WATCH';
  return 'HEALTHY';
}

export function computeChurnRisk(input: ChurnRiskInput): ChurnRiskResult {
  const recency = clamp01(Math.max(input.daysSinceLastTxn || 0, 0) / 14);
  const activity = 1 - clamp01(Math.min(Math.max(input.activeDaysLast7 || 0, 0), 7) / 7);
  // Only decline counts; growth does not reduce risk below zero.
  const trend = clamp01(Math.max(-(input.revenueTrendPct || 0), 0) / 50);
  const billing = billingRisk(input.subscriptionStatus);
  const adoption = 1 - clamp01(Math.min(Math.max(input.distinctFeatures || 0, 0), 5) / 5);
  const support = clamp01(Math.max(input.supportTickets || 0, 0) / 3);

  const parts = [
    {
      factor: 'RECENCY',
      weight: CHURN_WEIGHTS.recency,
      raw: recency,
      detail:
        input.daysSinceLastTxn >= 14
          ? `Tidak ada transaksi ${input.daysSinceLastTxn} hari — sudah lewat ambang 14 hari`
          : `Transaksi terakhir ${input.daysSinceLastTxn} hari lalu`,
    },
    {
      factor: 'ACTIVITY',
      weight: CHURN_WEIGHTS.activity,
      raw: activity,
      detail: `Hanya ${input.activeDaysLast7} dari 7 hari terakhir ada aktivitas`,
    },
    {
      factor: 'REVENUE_TREND',
      weight: CHURN_WEIGHTS.trend,
      raw: trend,
      detail:
        input.revenueTrendPct < 0
          ? `Omzet turun ${Math.abs(Math.round(input.revenueTrendPct))}% dibanding periode sebelumnya`
          : 'Tren omzet stabil atau naik',
    },
    { factor: 'BILLING', weight: CHURN_WEIGHTS.billing, raw: billing.value, detail: billing.detail },
    {
      factor: 'ADOPTION',
      weight: CHURN_WEIGHTS.adoption,
      raw: adoption,
      detail: `Baru memakai ${input.distinctFeatures} fitur berbeda`,
    },
    {
      factor: 'SUPPORT',
      weight: CHURN_WEIGHTS.support,
      raw: support,
      detail: `${input.supportTickets} tiket support pada periode ini`,
    },
  ];

  const score = Math.min(
    1,
    Math.round(parts.reduce((sum, p) => sum + p.raw * p.weight, 0) * 100) / 100
  );

  const reasons = parts
    .map((p) => ({
      factor: p.factor,
      weight: p.weight,
      contribution: Math.round(p.raw * p.weight * 100) / 100,
      detail: p.detail,
    }))
    // Only surface factors that actually push the score up.
    .filter((r) => r.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);

  return { score, band: bandFor(score), reasons };
}
