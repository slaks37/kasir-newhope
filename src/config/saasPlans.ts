import type { SaaSPlan } from '../types';

// `plan-free` dipertahankan sebagai ID legacy agar langganan lama tidak putus.
// Secara produk paket ini bukan free tier permanen lagi, melainkan trial 45 hari.
export const TRIAL_PLAN_ID = 'plan-free';
export const TRIAL_DAYS = 45;
export const TRIAL_READ_ONLY_DAYS = 14;
export const DAY_MS = 86_400_000;

export const SAAS_PLANS: SaaSPlan[] = [
  {
    id: TRIAL_PLAN_ID,
    name: 'Free Trial 45 Hari',
    tierLevel: 1,
    billingCycle: 'MONTHLY',
    priceIdr: 0,
    currency: 'IDR',
    maxOutlets: 2,
    isActive: true,
    isTrial: true,
    trialDays: TRIAL_DAYS,
    gracePeriodDays: TRIAL_READ_ONLY_DAYS,
    productLimit: -1,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: 'ADVANCED',
    features: [
      'Seluruh fitur Tier Pro selama 45 hari',
      'Hingga 2 outlet',
      'Produk dan pengguna tidak terbatas',
      'Kuota AI trial terbatas',
      'WhatsApp assisted melalui wa.me',
      'Tanpa kartu kredit',
      'Data tetap dapat dibaca 14 hari setelah trial',
    ],
  },
  {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    billingCycle: 'MONTHLY',
    priceIdr: 99_000,
    priceYearlyIdr: 79_200,
    annualDiscountPercent: 20,
    currency: 'IDR',
    maxOutlets: 2,
    isActive: true,
    productLimit: -1,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: 'FULL',
    extraOutletPriceIdr: 79_200,
    extraOutletYearlyIdr: 63_360,
    features: [
      'POS, transaksi, QRIS, dan struk',
      '2 outlet termasuk dalam paket',
      'Produk dan kategori tidak terbatas',
      'Inventori dan workflow sektor dasar',
      'Pelanggan, shift, kas, dan laporan omzet',
      'AI Analyst kuota dasar',
      'Support standar',
    ],
  },
  {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    billingCycle: 'MONTHLY',
    priceIdr: 299_000,
    priceYearlyIdr: 248_170,
    annualDiscountPercent: 17,
    currency: 'IDR',
    maxOutlets: 4,
    isActive: true,
    productLimit: -1,
    aiQuotaMonthly: 90,
    dashboardAccessLevel: 'ADVANCED',
    extraOutletPriceIdr: 79_200,
    extraOutletYearlyIdr: 63_360,
    features: [
      'Semua fitur Tier Plus',
      '4 outlet termasuk dalam paket',
      'Inventori multi-location, transfer stok, dan recursive BOM',
      'Smart Labor, absensi, komisi, bonus, dan payroll',
      'Workflow vertikal lengkap untuk tiap sektor',
      'WhatsApp Lifecycle Center',
      'Advanced AI Business Analyst dan laporan lintas outlet',
      'Priority support',
    ],
  },
];

export const PAID_SAAS_PLANS = SAAS_PLANS.filter((plan) => !plan.isTrial);

export function findSaaSPlan(planId: string) {
  return SAAS_PLANS.find((plan) => plan.id === planId) ?? null;
}

export function annualTotal(plan: SaaSPlan) {
  return (plan.priceYearlyIdr ?? plan.priceIdr) * 12;
}

export function addBillingPeriod(start: Date, cycle: 'MONTHLY' | 'YEARLY') {
  const end = new Date(start);
  const originalDay = end.getUTCDate();
  const monthsToAdd = cycle === 'YEARLY' ? 12 : 1;
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + monthsToAdd);
  const lastDayInTargetMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(originalDay, lastDayInTargetMonth));
  return end;
}
