/**
 * Klien HTTP & Data Provider untuk Admin Back-Office.
 *
 * Mengakses data Supabase langsung dengan pemrosesan analitik realtime,
 * otentikasi role internal, dan audit jejak akses.
 */

import type { AdminPlan } from '../lib/plans/entitlements';

export interface PlanChangeRow {
  id: string;
  plan_id: string;
  changed_by: string;
  change_kind: 'CREATE' | 'UPDATE' | 'ACTIVATE' | 'DEACTIVATE';
  before_json: AdminPlan | null;
  after_json: AdminPlan;
  changed_at: string;
}

const TOKEN_KEY = 'nhpos_internal_token';

export type InternalRole = 'ROLE_SUPERADMIN' | 'ROLE_INTERNAL_GROWTH' | 'ROLE_INTERNAL_SUPPORT';

export interface Session {
  user: { email: string; fullName: string; role: InternalRole };
  capabilities: string[];
  environment?: string;
}

export const ROLE_LABEL: Record<InternalRole, string> = {
  ROLE_SUPERADMIN: 'Superadmin (Akses Penuh)',
  ROLE_INTERNAL_GROWTH: 'Growth (Agregat & Analitik)',
  ROLE_INTERNAL_SUPPORT: 'Support (Operasional Merchant)',
};

/**
 * Sebagian halaman panel masih menampilkan DATA CONTOH, bukan isi database.
 *
 * Dibiarkan terlihat dari kode, dan diberi tanda di layar, karena angka yang
 * kelihatan meyakinkan tapi tidak nyata adalah cara tercepat mengambil
 * keputusan yang salah. Halaman Paket & Harga TIDAK termasuk — ia menulis ke
 * database sungguhan.
 */
export const HALAMAN_DATA_CONTOH = ['overview', 'merchants', 'subscriptions', 'transactions', 'products', 'activity', 'audit', 'users'];

/* -------------------------------------------------------------------------- */
/* SESI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Token sesi disimpan di sessionStorage, bukan localStorage.
 *
 * sessionStorage habis saat tab ditutup. Untuk konsol yang bisa mengubah harga,
 * sesi yang bertahan berhari-hari di perangkat bersama adalah risiko yang tidak
 * sebanding dengan kenyamanan tidak perlu login ulang.
 */
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/* -------------------------------------------------------------------------- */
/* SECTOR STYLES & HELPERS                                                    */
/* -------------------------------------------------------------------------- */

export const SECTORS = ['FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP'] as const;
export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABEL: Record<Sector, string> = {
  FNB: 'Kafe, Resto & F&B',
  LAUNDRY: 'Laundry',
  RETAIL: 'Ritel & Minimarket',
  CARWASH: 'Cuci Mobil & Motor',
  BARBERSHOP: 'Barbershop & Salon',
};

export const SECTOR_SHORT: Record<Sector, string> = {
  FNB: 'F&B',
  LAUNDRY: 'Laundry',
  RETAIL: 'Ritel',
  CARWASH: 'Carwash',
  BARBERSHOP: 'Barber',
};

export const SECTOR_STYLE: Record<Sector, { dot: string; chip: string; bar: string }> = {
  FNB: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-950 border border-amber-300',
    bar: 'bg-amber-500',
  },
  LAUNDRY: {
    dot: 'bg-sky-500',
    chip: 'bg-sky-100 text-sky-950 border border-sky-300',
    bar: 'bg-sky-500',
  },
  RETAIL: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-950 border border-emerald-300',
    bar: 'bg-emerald-500',
  },
  CARWASH: {
    dot: 'bg-indigo-500',
    chip: 'bg-indigo-100 text-indigo-950 border border-indigo-300',
    bar: 'bg-indigo-500',
  },
  BARBERSHOP: {
    dot: 'bg-fuchsia-500',
    chip: 'bg-fuchsia-100 text-fuchsia-950 border border-fuchsia-300',
    bar: 'bg-fuchsia-500',
  },
};

export const SEVERITY_STYLE: Record<string, string> = {
  INFO: 'bg-slate-100 text-slate-800 border border-slate-200',
  NOTICE: 'bg-sky-100 text-sky-950 border border-sky-300',
  WARNING: 'bg-amber-100 text-amber-950 border border-amber-300',
  CRITICAL: 'bg-red-100 text-red-950 border border-red-300',
};

export const rupiah = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'Rp 0';
  return 'Rp ' + Math.round(v).toLocaleString('id-ID');
};

export const rupiahShort = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'Rp 0';
  if (Math.abs(v) >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (Math.abs(v) >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (Math.abs(v) >= 1_000) return `Rp ${(v / 1_000).toFixed(0)} rb`;
  return rupiah(v);
};

export const angka = (n: unknown): string => Number(n ?? 0).toLocaleString('id-ID');

export const waktu = (iso: unknown): string => {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const tanggal = (iso: unknown): string => {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const sejak = (iso: unknown): string => {
  if (!iso) return 'belum pernah';
  const d = new Date(String(iso)).getTime();
  if (Number.isNaN(d)) return '—';
  const menit = Math.floor((Date.now() - d) / 60000);
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 30) return `${hari} hari lalu`;
  return `${Math.floor(hari / 30)} bulan lalu`;
};

/* -------------------------------------------------------------------------- */
/* SAMPLE DATA FOR BACKOFFICE CONSOLE                                         */
/* -------------------------------------------------------------------------- */

function generateDailyHistory() {
  const daily: any[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];

    daily.push(
      { sales_date: dateStr, business_sector: 'FNB', gross_revenue: 3500000 + Math.sin(i) * 500000 + (30 - i) * 20000, transaction_count: 85 + (i % 10) },
      { sales_date: dateStr, business_sector: 'RETAIL', gross_revenue: 2800000 + Math.cos(i) * 400000 + (30 - i) * 15000, transaction_count: 65 + (i % 8) },
      { sales_date: dateStr, business_sector: 'LAUNDRY', gross_revenue: 1200000 + (i % 5) * 100000, transaction_count: 28 + (i % 5) },
      { sales_date: dateStr, business_sector: 'CARWASH', gross_revenue: 1600000 + (i % 7) * 120000, transaction_count: 32 + (i % 6) },
      { sales_date: dateStr, business_sector: 'BARBERSHOP', gross_revenue: 1400000 + (i % 4) * 80000, transaction_count: 24 + (i % 4) }
    );
  }
  return daily;
}

export const SAMPLE_MERCHANTS = [
  {
    id: 'm-fnb-01',
    merchant_id: 'm-fnb-01',
    business_id: 'usr-budi_FNB',
    name: 'Kopi Kenangan Senopati',
    merchant_name: 'Kopi Kenangan Senopati',
    sector: 'FNB',
    business_sector: 'FNB',
    status: 'ACTIVE',
    subscription_status: 'ACTIVE',
    owner_name: 'Budi Santoso',
    email: 'budi@kopikenangan.id',
    phone: '081234567890',
    gross_revenue: 184500000,
    gross_sales_30d: 184500000,
    transactions_count: 3840,
    tx_count_30d: 3840,
    risk_score: 0.12,
    churn_risk_score: 0.12,
    churn_risk_band: 'LOW',
    risk_reasons: [],
    notes: 'Merchant stabil dengan pertumbuhan transaksi +15% bulan ini.',
    active_products: 48,
    staff_count: 5,
    business_ids: ['usr-budi_FNB'],
    last_active_at: new Date().toISOString(),
    created_at: '2026-01-10T08:00:00Z',
  },
  {
    id: 'm-retail-01',
    merchant_id: 'm-retail-01',
    business_id: 'usr-siti_RETAIL',
    name: 'Berkah Mart Sudirman',
    merchant_name: 'Berkah Mart Sudirman',
    sector: 'RETAIL',
    business_sector: 'RETAIL',
    status: 'ACTIVE',
    subscription_status: 'ACTIVE',
    owner_name: 'Siti Rahma',
    email: 'siti@berkahmart.id',
    phone: '081398765432',
    gross_revenue: 142300000,
    gross_sales_30d: 142300000,
    transactions_count: 2910,
    tx_count_30d: 2910,
    risk_score: 0.18,
    churn_risk_score: 0.18,
    churn_risk_band: 'LOW',
    risk_reasons: [],
    notes: 'Supermarket lokal dengan perputaran stok sembako sangat cepat.',
    active_products: 120,
    staff_count: 4,
    business_ids: ['usr-siti_RETAIL'],
    last_active_at: new Date(Date.now() - 3600000).toISOString(),
    created_at: '2026-01-15T09:30:00Z',
  },
  {
    id: 'm-carwash-01',
    merchant_id: 'm-carwash-01',
    business_id: 'usr-agus_CARWASH',
    name: 'Agus Auto Wash & Detailing',
    merchant_name: 'Agus Auto Wash & Detailing',
    sector: 'CARWASH',
    business_sector: 'CARWASH',
    status: 'ACTIVE',
    subscription_status: 'ACTIVE',
    owner_name: 'Agus Santoso',
    email: 'agus@autowash.id',
    phone: '081922334455',
    gross_revenue: 72400000,
    gross_sales_30d: 72400000,
    transactions_count: 1680,
    tx_count_30d: 1680,
    risk_score: 0.15,
    churn_risk_score: 0.15,
    churn_risk_band: 'LOW',
    risk_reasons: [],
    notes: 'Pusat cuci mobil dan salon nano coating.',
    active_products: 14,
    staff_count: 6,
    business_ids: ['usr-agus_CARWASH'],
    last_active_at: new Date(Date.now() - 1800000).toISOString(),
    created_at: '2026-01-20T08:00:00Z',
  },
  {
    id: 'm-barber-01',
    merchant_id: 'm-barber-01',
    business_id: 'usr-rina_BARBERSHOP',
    name: 'Rina Beauty Lounge & Barbershop',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    sector: 'BARBERSHOP',
    business_sector: 'BARBERSHOP',
    status: 'ACTIVE',
    subscription_status: 'ACTIVE',
    owner_name: 'Rina Marlina',
    email: 'rina@beautylounge.id',
    phone: '081566778899',
    gross_revenue: 64100000,
    gross_sales_30d: 64100000,
    transactions_count: 1540,
    tx_count_30d: 1540,
    risk_score: 0.14,
    churn_risk_score: 0.14,
    churn_risk_band: 'LOW',
    risk_reasons: [],
    notes: 'Salon dan barbershop modern dengan layanan hair treatment.',
    active_products: 22,
    staff_count: 4,
    business_ids: ['usr-rina_BARBERSHOP'],
    last_active_at: new Date(Date.now() - 5400000).toISOString(),
    created_at: '2026-01-25T11:00:00Z',
  },
  {
    id: 'm-laundry-01',
    merchant_id: 'm-laundry-01',
    business_id: 'usr-agus_LAUNDRY',
    name: 'Clean & Fresh Express Laundry',
    merchant_name: 'Clean & Fresh Express Laundry',
    sector: 'LAUNDRY',
    business_sector: 'LAUNDRY',
    status: 'ACTIVE',
    subscription_status: 'ACTIVE',
    owner_name: 'Dewi Lestari',
    email: 'dewi@cleanfresh.id',
    phone: '081711223344',
    gross_revenue: 58200000,
    gross_sales_30d: 58200000,
    transactions_count: 1420,
    tx_count_30d: 1420,
    risk_score: 0.25,
    churn_risk_score: 0.25,
    churn_risk_band: 'MEDIUM',
    risk_reasons: ['Stok deterjen menipis'],
    notes: 'Outlet laundry kiloan & satuan.',
    active_products: 16,
    staff_count: 3,
    business_ids: ['usr-agus_LAUNDRY'],
    last_active_at: new Date(Date.now() - 7200000).toISOString(),
    created_at: '2026-02-01T10:00:00Z',
  },
];

/* -------------------------------------------------------------------------- */
/* COMPLETE PRODUCTS CATALOG ACROSS ALL MERCHANTS                             */
/* -------------------------------------------------------------------------- */

export const ALL_PRODUCTS_DATA = [
  // F&B Products
  {
    id: 'prod-01',
    product_name: 'Es Kopi Kenangan Mantan',
    merchant_name: 'Kopi Kenangan Senopati',
    business_sector: 'FNB',
    category_name: 'Signature Coffee',
    sku: 'KPN-001',
    price: 22000,
    cost_price: 7955,
    stock: 85,
    min_stock_alert: 20,
    is_low_stock: false,
    is_available: true,
    units_sold: 1420,
    transaction_count: 1210,
    gross_revenue: 31240000,
    gross_profit: 19943900,
    margin_pct: 63.8,
    last_sold_at: new Date().toISOString(),
  },
  {
    id: 'prod-02',
    product_name: 'Butter Croissant Premium',
    merchant_name: 'Kopi Kenangan Senopati',
    business_sector: 'FNB',
    category_name: 'Pastry & Bakery',
    sku: 'PST-002',
    price: 18000,
    cost_price: 7000,
    stock: 24,
    min_stock_alert: 15,
    is_low_stock: false,
    is_available: true,
    units_sold: 480,
    transaction_count: 420,
    gross_revenue: 8640000,
    gross_profit: 5280000,
    margin_pct: 61.1,
    last_sold_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'prod-03',
    product_name: 'Signature Matcha Latte',
    merchant_name: 'Kopi Kenangan Senopati',
    business_sector: 'FNB',
    category_name: 'Non-Coffee',
    sku: 'KPN-003',
    price: 28000,
    cost_price: 9810,
    stock: 45,
    min_stock_alert: 15,
    is_low_stock: false,
    is_available: true,
    units_sold: 730,
    transaction_count: 640,
    gross_revenue: 20440000,
    gross_profit: 13278700,
    margin_pct: 65.0,
    last_sold_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'prod-04',
    product_name: 'Nasi Goreng Spesial Resto',
    merchant_name: 'New Hope Resto & Cafe',
    business_sector: 'FNB',
    category_name: 'Makanan Utama',
    sku: 'FD-001',
    price: 32000,
    cost_price: 12500,
    stock: 150,
    min_stock_alert: 30,
    is_low_stock: false,
    is_available: true,
    units_sold: 890,
    transaction_count: 810,
    gross_revenue: 28480000,
    gross_profit: 17355000,
    margin_pct: 60.9,
    last_sold_at: new Date().toISOString(),
  },
  {
    id: 'prod-05',
    product_name: 'Ayam Bakar Madu Spesial',
    merchant_name: 'New Hope Resto & Cafe',
    business_sector: 'FNB',
    category_name: 'Makanan Utama',
    sku: 'FD-002',
    price: 38000,
    cost_price: 16000,
    stock: 60,
    min_stock_alert: 20,
    is_low_stock: false,
    is_available: true,
    units_sold: 620,
    transaction_count: 580,
    gross_revenue: 23560000,
    gross_profit: 13640000,
    margin_pct: 57.9,
    last_sold_at: new Date(Date.now() - 5400000).toISOString(),
  },

  // Retail Products
  {
    id: 'prod-06',
    product_name: 'Beras Premium Pandan Wangi 5kg',
    merchant_name: 'Berkah Mart Sudirman',
    business_sector: 'RETAIL',
    category_name: 'Sembako Pokok',
    sku: 'SEM-001',
    price: 74000,
    cost_price: 62000,
    stock: 40,
    min_stock_alert: 15,
    is_low_stock: false,
    is_available: true,
    units_sold: 850,
    transaction_count: 850,
    gross_revenue: 62900000,
    gross_profit: 10200000,
    margin_pct: 16.2,
    last_sold_at: new Date().toISOString(),
  },
  {
    id: 'prod-07',
    product_name: 'Minyak Goreng Sania Pouch 2L',
    merchant_name: 'Berkah Mart Sudirman',
    business_sector: 'RETAIL',
    category_name: 'Sembako Pokok',
    sku: 'SEM-002',
    price: 36000,
    cost_price: 30000,
    stock: 65,
    min_stock_alert: 20,
    is_low_stock: false,
    is_available: true,
    units_sold: 1250,
    transaction_count: 1180,
    gross_revenue: 45000000,
    gross_profit: 7500000,
    margin_pct: 16.7,
    last_sold_at: new Date(Date.now() - 1200000).toISOString(),
  },
  {
    id: 'prod-08',
    product_name: 'Gula Pasir Kristal Putih 1kg',
    merchant_name: 'Berkah Mart Sudirman',
    business_sector: 'RETAIL',
    category_name: 'Sembako Pokok',
    sku: 'SEM-003',
    price: 17500,
    cost_price: 14500,
    stock: 110,
    min_stock_alert: 25,
    is_low_stock: false,
    is_available: true,
    units_sold: 980,
    transaction_count: 910,
    gross_revenue: 17150000,
    gross_profit: 2940000,
    margin_pct: 17.1,
    last_sold_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'prod-09',
    product_name: 'Telur Ayam Negeri Fresh 1kg',
    merchant_name: 'Berkah Mart Sudirman',
    business_sector: 'RETAIL',
    category_name: 'Sembako Pokok',
    sku: 'SEM-004',
    price: 29000,
    cost_price: 24000,
    stock: 35,
    min_stock_alert: 10,
    is_low_stock: false,
    is_available: true,
    units_sold: 760,
    transaction_count: 730,
    gross_revenue: 22040000,
    gross_profit: 3800000,
    margin_pct: 17.2,
    last_sold_at: new Date(Date.now() - 7200000).toISOString(),
  },

  // Carwash Products (including Most Expensive)
  {
    id: 'prod-10',
    product_name: 'Paket Ceramic Coating 9H & Detailing Sultan',
    merchant_name: 'Agus Auto Wash & Detailing',
    business_sector: 'CARWASH',
    category_name: 'Salon & Nano Coating',
    sku: 'CW-001',
    price: 450000,
    cost_price: 109000,
    stock: 999,
    min_stock_alert: 10,
    is_low_stock: false,
    is_available: true,
    units_sold: 85,
    transaction_count: 85,
    gross_revenue: 38250000,
    gross_profit: 28985000,
    margin_pct: 75.8,
    last_sold_at: new Date(Date.now() - 14400000).toISOString(),
  },
  {
    id: 'prod-11',
    product_name: 'Cuci Mobil Salju & Vacum Interior',
    merchant_name: 'Agus Auto Wash & Detailing',
    business_sector: 'CARWASH',
    category_name: 'Cuci Mobil',
    sku: 'CW-002',
    price: 50000,
    cost_price: 6920,
    stock: 999,
    min_stock_alert: 50,
    is_low_stock: false,
    is_available: true,
    units_sold: 1120,
    transaction_count: 1120,
    gross_revenue: 56000000,
    gross_profit: 48249600,
    margin_pct: 86.2,
    last_sold_at: new Date().toISOString(),
  },
  {
    id: 'prod-12',
    product_name: 'Cuci Motor Salju Express',
    merchant_name: 'Agus Auto Wash & Detailing',
    business_sector: 'CARWASH',
    category_name: 'Cuci Motor',
    sku: 'CW-003',
    price: 20000,
    cost_price: 3200,
    stock: 999,
    min_stock_alert: 50,
    is_low_stock: false,
    is_available: true,
    units_sold: 810,
    transaction_count: 810,
    gross_revenue: 16200000,
    gross_profit: 13608000,
    margin_pct: 84.0,
    last_sold_at: new Date(Date.now() - 3600000).toISOString(),
  },

  // Barbershop Products
  {
    id: 'prod-13',
    product_name: 'Gentleman Haircut + Creambath Tradisional',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    business_sector: 'BARBERSHOP',
    category_name: 'Perawatan Pria',
    sku: 'BS-001',
    price: 75000,
    cost_price: 5900,
    stock: 999,
    min_stock_alert: 50,
    is_low_stock: false,
    is_available: true,
    units_sold: 780,
    transaction_count: 780,
    gross_revenue: 58500000,
    gross_profit: 53898000,
    margin_pct: 92.1,
    last_sold_at: new Date().toISOString(),
  },
  {
    id: 'prod-14',
    product_name: 'Korean Wave Perming & Styling',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    business_sector: 'BARBERSHOP',
    category_name: 'Treatment Khusus',
    sku: 'BS-002',
    price: 250000,
    cost_price: 55000,
    stock: 999,
    min_stock_alert: 10,
    is_low_stock: false,
    is_available: true,
    units_sold: 115,
    transaction_count: 115,
    gross_revenue: 28750000,
    gross_profit: 22425000,
    margin_pct: 78.0,
    last_sold_at: new Date(Date.now() - 10800000).toISOString(),
  },
  {
    id: 'prod-15',
    product_name: 'Hair Coloring Fashion Tone',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    business_sector: 'BARBERSHOP',
    category_name: 'Coloring',
    sku: 'BS-003',
    price: 185000,
    cost_price: 42000,
    stock: 999,
    min_stock_alert: 15,
    is_low_stock: false,
    is_available: true,
    units_sold: 142,
    transaction_count: 142,
    gross_revenue: 26270000,
    gross_profit: 20306000,
    margin_pct: 77.3,
    last_sold_at: new Date(Date.now() - 7200000).toISOString(),
  },

  // Laundry Products (including Most Transacted)
  {
    id: 'prod-16',
    product_name: 'Cuci Kering Setrika Reguler /kg',
    merchant_name: 'Clean & Fresh Express Laundry',
    business_sector: 'LAUNDRY',
    category_name: 'Laundry Kiloan',
    sku: 'LND-001',
    price: 9500,
    cost_price: 1605,
    stock: 999,
    min_stock_alert: 100,
    is_low_stock: false,
    is_available: true,
    units_sold: 2100,
    transaction_count: 2100,
    gross_revenue: 19950000,
    gross_profit: 16579500,
    margin_pct: 83.1,
    last_sold_at: new Date().toISOString(),
  },
  {
    id: 'prod-17',
    product_name: 'Cuci Bed Cover Jumbo & Karpet',
    merchant_name: 'Clean & Fresh Express Laundry',
    business_sector: 'LAUNDRY',
    category_name: 'Laundry Satuan',
    sku: 'LND-002',
    price: 45000,
    cost_price: 11500,
    stock: 999,
    min_stock_alert: 20,
    is_low_stock: false,
    is_available: true,
    units_sold: 340,
    transaction_count: 340,
    gross_revenue: 15300000,
    gross_profit: 11390000,
    margin_pct: 74.4,
    last_sold_at: new Date(Date.now() - 14400000).toISOString(),
  },
];

/* -------------------------------------------------------------------------- */
/* RAW MATERIALS / INGREDIENTS PER CLIENT (BAHAN BAKU & MENTAH KLIEN)         */
/* -------------------------------------------------------------------------- */

export const RAW_MATERIALS_DATA = [
  // Kopi Kenangan Senopati
  {
    id: 'mat-01',
    merchant_name: 'Kopi Kenangan Senopati',
    material_name: 'Biji Kopi Arabika Gayo Grade 1',
    category: 'Coffee Beans',
    stock_quantity: 18.5,
    unit: 'kg',
    cost_per_unit: 160000,
    min_stock: 5.0,
    status: 'IN_STOCK',
    supplier: 'Gayo Highland Agro, Aceh',
  },
  {
    id: 'mat-02',
    merchant_name: 'Kopi Kenangan Senopati',
    material_name: 'Susu Segar Full Cream Pasteurisasi',
    category: 'Dairy Fresh',
    stock_quantity: 42.0,
    unit: 'Liter',
    cost_per_unit: 22000,
    min_stock: 10.0,
    status: 'IN_STOCK',
    supplier: 'Greenfields Fresh Milk',
  },
  {
    id: 'mat-03',
    merchant_name: 'Kopi Kenangan Senopati',
    material_name: 'Sirup Gula Aren Organik Cair',
    category: 'Syrup & Flavor',
    stock_quantity: 12.0,
    unit: 'Liter',
    cost_per_unit: 45000,
    min_stock: 5.0,
    status: 'IN_STOCK',
    supplier: 'Aren Asli Nusantara',
  },
  {
    id: 'mat-04',
    merchant_name: 'Kopi Kenangan Senopati',
    material_name: 'Bubuk Pure Matcha Uji Japan',
    category: 'Tea Powder',
    stock_quantity: 1.2,
    unit: 'kg',
    cost_per_unit: 320000,
    min_stock: 2.0,
    status: 'LOW_STOCK',
    supplier: 'Kyoto Import Trade',
  },
  {
    id: 'mat-05',
    merchant_name: 'Kopi Kenangan Senopati',
    material_name: 'Cup Plastik PET 16oz + Sedotan Steril',
    category: 'Packaging',
    stock_quantity: 850,
    unit: 'pcs',
    cost_per_unit: 650,
    min_stock: 200,
    status: 'IN_STOCK',
    supplier: 'Mitra Kemasan Lestari',
  },

  // New Hope Resto & Cafe
  {
    id: 'mat-06',
    merchant_name: 'New Hope Resto & Cafe',
    material_name: 'Daging Sapi Sirloin Potong Fresh',
    category: 'Meat & Poultry',
    stock_quantity: 8.5,
    unit: 'kg',
    cost_per_unit: 135000,
    min_stock: 4.0,
    status: 'IN_STOCK',
    supplier: 'RPA Berkah Daging Segar',
  },
  {
    id: 'mat-07',
    merchant_name: 'New Hope Resto & Cafe',
    material_name: 'Daging Dada Ayam Fillet',
    category: 'Meat & Poultry',
    stock_quantity: 15.0,
    unit: 'kg',
    cost_per_unit: 48000,
    min_stock: 5.0,
    status: 'IN_STOCK',
    supplier: 'Peternakan Ayam Mandiri',
  },
  {
    id: 'mat-08',
    merchant_name: 'New Hope Resto & Cafe',
    material_name: 'Beras Organik Rojolele Super',
    category: 'Grains & Rice',
    stock_quantity: 80.0,
    unit: 'kg',
    cost_per_unit: 14000,
    min_stock: 20.0,
    status: 'IN_STOCK',
    supplier: 'Koperasi Tani Makmur',
  },
  {
    id: 'mat-09',
    merchant_name: 'New Hope Resto & Cafe',
    material_name: 'Minyak Goreng Sawit Berkualitas',
    category: 'Cooking Oil',
    stock_quantity: 24.0,
    unit: 'Liter',
    cost_per_unit: 16500,
    min_stock: 10.0,
    status: 'IN_STOCK',
    supplier: 'Distributor Sembako Jaya',
  },

  // Agus Auto Wash & Detailing
  {
    id: 'mat-10',
    merchant_name: 'Agus Auto Wash & Detailing',
    material_name: 'Konsentrat Shampo Salju pH Balance',
    category: 'Chemical Wash',
    stock_quantity: 45.0,
    unit: 'Liter',
    cost_per_unit: 28000,
    min_stock: 10.0,
    status: 'IN_STOCK',
    supplier: 'Autocare Chemical Solutions',
  },
  {
    id: 'mat-11',
    merchant_name: 'Agus Auto Wash & Detailing',
    material_name: 'Cairan Semir Ban Silicone High-Gloss',
    category: 'Chemical Detailing',
    stock_quantity: 18.0,
    unit: 'Liter',
    cost_per_unit: 38000,
    min_stock: 5.0,
    status: 'IN_STOCK',
    supplier: 'Autocare Chemical Solutions',
  },
  {
    id: 'mat-12',
    merchant_name: 'Agus Auto Wash & Detailing',
    material_name: 'Formula Pembersih Jamur Kaca Glass-Clean',
    category: 'Chemical Special',
    stock_quantity: 4.0,
    unit: 'Liter',
    cost_per_unit: 65000,
    min_stock: 5.0,
    status: 'LOW_STOCK',
    supplier: 'Nano Shine Indonesia',
  },
  {
    id: 'mat-13',
    merchant_name: 'Agus Auto Wash & Detailing',
    material_name: 'Obat Nano Ceramic 9H Glass Coating',
    category: 'Coating Liquid',
    stock_quantity: 8.0,
    unit: 'Botol (50ml)',
    cost_per_unit: 85000,
    min_stock: 3.0,
    status: 'IN_STOCK',
    supplier: 'Crystal Coating Japan Import',
  },

  // Clean & Fresh Express Laundry
  {
    id: 'mat-14',
    merchant_name: 'Clean & Fresh Express Laundry',
    material_name: 'Deterjen Cair Konsentrat Low Foam',
    category: 'Laundry Chemical',
    stock_quantity: 60.0,
    unit: 'Liter',
    cost_per_unit: 14500,
    min_stock: 15.0,
    status: 'IN_STOCK',
    supplier: 'Indo Chemical Laundry',
  },
  {
    id: 'mat-15',
    merchant_name: 'Clean & Fresh Express Laundry',
    material_name: 'Parfum Laundry Grade A Ocean Fresh',
    category: 'Fragrance',
    stock_quantity: 8.0,
    unit: 'Liter',
    cost_per_unit: 55000,
    min_stock: 10.0,
    status: 'LOW_STOCK',
    supplier: 'Aroma Fresh Sentosa',
  },
  {
    id: 'mat-16',
    merchant_name: 'Clean & Fresh Express Laundry',
    material_name: 'Cairan Pelicin & Pelembut Pakaian',
    category: 'Softener',
    stock_quantity: 35.0,
    unit: 'Liter',
    cost_per_unit: 12000,
    min_stock: 10.0,
    status: 'IN_STOCK',
    supplier: 'Indo Chemical Laundry',
  },

  // Rina Beauty Lounge & Barbershop
  {
    id: 'mat-17',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    material_name: 'Pomade Wax Strong Hold Water-based',
    category: 'Hair Styling',
    stock_quantity: 24.0,
    unit: 'Jar (100g)',
    cost_per_unit: 42000,
    min_stock: 8.0,
    status: 'IN_STOCK',
    supplier: 'Gentleman Grooming ID',
  },
  {
    id: 'mat-18',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    material_name: 'Krim Creambath Tradisional Ginseng & Aloe',
    category: 'Hair Treatment',
    stock_quantity: 6.0,
    unit: 'Jar (1kg)',
    cost_per_unit: 65000,
    min_stock: 2.0,
    status: 'IN_STOCK',
    supplier: 'Salon Pro Supply',
  },
  {
    id: 'mat-19',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    material_name: 'Obat Keriting Korean Wave Solution Set',
    category: 'Chemical Treatment',
    stock_quantity: 3.0,
    unit: 'Set',
    cost_per_unit: 110000,
    min_stock: 5.0,
    status: 'LOW_STOCK',
    supplier: 'Seoul Hair Cosmetic',
  },
];

/* -------------------------------------------------------------------------- */
/* BUNDLE SETS / PROMO PACKAGES PER CLIENT (BUNDLE SET KLIEN)                 */
/* -------------------------------------------------------------------------- */

export const BUNDLE_SETS_DATA = [
  {
    id: 'bun-01',
    merchant_name: 'Kopi Kenangan Senopati',
    bundle_name: 'Paket Combo Sarapan Mantan',
    sector: 'FNB',
    included_items: ['1x Es Kopi Kenangan Mantan', '1x Butter Croissant Premium'],
    regular_price: 40000,
    bundle_price: 32000,
    discount_pct: 20.0,
    sold_count: 420,
    gross_revenue: 13440000,
  },
  {
    id: 'bun-02',
    merchant_name: 'Kopi Kenangan Senopati',
    bundle_name: 'Paket Rame-Rame 4 Cup Mantan',
    sector: 'FNB',
    included_items: ['4x Es Kopi Kenangan Mantan'],
    regular_price: 88000,
    bundle_price: 72000,
    discount_pct: 18.2,
    sold_count: 280,
    gross_revenue: 20160000,
  },
  {
    id: 'bun-03',
    merchant_name: 'Berkah Mart Sudirman',
    bundle_name: 'Paket Sembako Dapur Hemat Berkah',
    sector: 'RETAIL',
    included_items: [
      '1x Beras Pandan Wangi 5kg',
      '1x Minyak Sania 2L',
      '1x Gula Pasir 1kg',
      '1x Telur Ayam Negeri 1kg',
    ],
    regular_price: 156500,
    bundle_price: 142000,
    discount_pct: 9.3,
    sold_count: 560,
    gross_revenue: 79520000,
  },
  {
    id: 'bun-04',
    merchant_name: 'Agus Auto Wash & Detailing',
    bundle_name: 'Paket Cuci Komplit + Bersih Jamur Kaca',
    sector: 'CARWASH',
    included_items: [
      '1x Cuci Mobil Salju & Vacum',
      '1x Pembersih Jamur Kaca Depan & Samping',
      '1x Semir Ban Silicone',
    ],
    regular_price: 95000,
    bundle_price: 75000,
    discount_pct: 21.1,
    sold_count: 310,
    gross_revenue: 23250000,
  },
  {
    id: 'bun-05',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    bundle_name: 'Paket Ganteng Maksimal (Cut + Cream + Styling)',
    sector: 'BARBERSHOP',
    included_items: [
      '1x Gentleman Haircut',
      '1x Creambath Tradisional Ginseng',
      '1x Styling Pomade Water-based',
    ],
    regular_price: 120000,
    bundle_price: 95000,
    discount_pct: 20.8,
    sold_count: 460,
    gross_revenue: 43700000,
  },
];

/* -------------------------------------------------------------------------- */
/* PRODUCT RECIPES / BILL OF MATERIALS (BAHAN MENTAH PEMBUAT PRODUK)          */
/* -------------------------------------------------------------------------- */

export const PRODUCT_RECIPES_DATA = [
  {
    id: 'rec-01',
    product_name: 'Es Kopi Kenangan Mantan',
    merchant_name: 'Kopi Kenangan Senopati',
    business_sector: 'FNB',
    price: 22000,
    ingredients: [
      { name: 'Biji Kopi Arabika Gayo', qty: '18 gram', cost: 2880 },
      { name: 'Susu Segar Full Cream', qty: '150 ml', cost: 3300 },
      { name: 'Sirup Gula Aren Organik', qty: '25 ml', cost: 1125 },
      { name: 'Cup PET 16oz + Sedotan', qty: '1 pcs', cost: 650 },
    ],
    total_material_cost: 7955,
    gross_profit: 14045,
    margin_pct: 63.8,
  },
  {
    id: 'rec-02',
    product_name: 'Butter Croissant Premium',
    merchant_name: 'Kopi Kenangan Senopati',
    business_sector: 'FNB',
    price: 18000,
    ingredients: [
      { name: 'Adonan Croissant Butter Import', qty: '120 gram', cost: 5800 },
      { name: 'Mentega Olesan & Glaze', qty: '15 gram', cost: 1200 },
    ],
    total_material_cost: 7000,
    gross_profit: 11000,
    margin_pct: 61.1,
  },
  {
    id: 'rec-03',
    product_name: 'Signature Matcha Latte',
    merchant_name: 'Kopi Kenangan Senopati',
    business_sector: 'FNB',
    price: 28000,
    ingredients: [
      { name: 'Bubuk Pure Matcha Uji', qty: '15 gram', cost: 4800 },
      { name: 'Susu Segar Full Cream', qty: '180 ml', cost: 3960 },
      { name: 'Simple Sugar Syrup', qty: '20 ml', cost: 400 },
      { name: 'Cup PET 16oz + Sedotan', qty: '1 pcs', cost: 650 },
    ],
    total_material_cost: 9810,
    gross_profit: 18190,
    margin_pct: 65.0,
  },
  {
    id: 'rec-04',
    product_name: 'Cuci Mobil Salju & Vacum Interior',
    merchant_name: 'Agus Auto Wash & Detailing',
    business_sector: 'CARWASH',
    price: 50000,
    ingredients: [
      { name: 'Konsentrat Shampo Salju', qty: '150 ml', cost: 4200 },
      { name: 'Cairan Semir Ban Silicone', qty: '40 ml', cost: 1520 },
      { name: 'Plastik Pelindung Alas Kaki', qty: '1 set', cost: 1200 },
    ],
    total_material_cost: 6920,
    gross_profit: 43080,
    margin_pct: 86.2,
  },
  {
    id: 'rec-05',
    product_name: 'Paket Ceramic Coating 9H & Detailing Sultan',
    merchant_name: 'Agus Auto Wash & Detailing',
    business_sector: 'CARWASH',
    price: 450000,
    ingredients: [
      { name: 'Obat Nano Ceramic 9H Coating', qty: '1 botol (50ml)', cost: 85000 },
      { name: 'Kain Lap Microfiber Khusus', qty: '2 pcs', cost: 18000 },
      { name: 'Aplikator Spons Nano Glass', qty: '1 set', cost: 6000 },
    ],
    total_material_cost: 109000,
    gross_profit: 341000,
    margin_pct: 75.8,
  },
  {
    id: 'rec-06',
    product_name: 'Cuci Kering Setrika Reguler /kg',
    merchant_name: 'Clean & Fresh Express Laundry',
    business_sector: 'LAUNDRY',
    price: 9500,
    ingredients: [
      { name: 'Deterjen Cair Konsentrat', qty: '25 ml', cost: 360 },
      { name: 'Parfum Laundry Ocean Fresh', qty: '15 ml', cost: 825 },
      { name: 'Cairan Pelicin & Pelembut', qty: '20 ml', cost: 240 },
      { name: 'Plastik Packing Laundry 35x50', qty: '1 pcs', cost: 180 },
    ],
    total_material_cost: 1605,
    gross_profit: 7895,
    margin_pct: 83.1,
  },
  {
    id: 'rec-07',
    product_name: 'Gentleman Haircut + Creambath Tradisional',
    merchant_name: 'Rina Beauty Lounge & Barbershop',
    business_sector: 'BARBERSHOP',
    price: 75000,
    ingredients: [
      { name: 'Krim Creambath Ginseng & Aloe', qty: '40 gram', cost: 2600 },
      { name: 'Pomade Wax Strong Hold', qty: '15 gram', cost: 1800 },
      { name: 'Pisau Silet Cukur Baru & Antiseptik', qty: '1 set', cost: 1500 },
    ],
    total_material_cost: 5900,
    gross_profit: 69100,
    margin_pct: 92.1,
  },
];

/* -------------------------------------------------------------------------- */
/* API METHODS                                                                */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* TRANSPOR                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Satu pintu untuk semua panggilan ke backend admin.
 *
 * Token dilampirkan di sini, sekali, bukan di setiap pemanggil — dan 401
 * membuang token yang sudah tidak berlaku supaya panel jatuh ke layar login
 * alih-alih menampilkan halaman kosong tanpa penjelasan.
 */
async function minta<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Endpoint yang belum ter-deploy jatuh ke rewrite SPA dan mengembalikan
    // HTML. Dijelaskan apa adanya, bukan dibiarkan muncul sebagai
    // "Unexpected token <".
    throw new ApiError(res.status, 'BAD_RESPONSE', 'Server tidak mengembalikan JSON. Endpoint admin mungkin belum ter-deploy.');
  }

  if (!res.ok || data?.ok === false) {
    if (res.status === 401) setToken(null);
    throw new ApiError(
      res.status,
      data?.error || 'REQUEST_FAILED',
      data?.detail || (Array.isArray(data?.issues) ? data.issues.join(' ') : null) || pesanGalat(res.status, data?.error)
    );
  }
  return data as T;
}

function pesanGalat(status: number, kode?: string): string {
  if (kode === 'SESSION_SECRET_MISSING') {
    return 'Server belum dikonfigurasi: ADMIN_SESSION_SECRET kosong. Hubungi yang mengelola deployment.';
  }
  if (kode === 'INVALID_CREDENTIALS') return 'Email atau password administrator salah.';
  if (kode === 'TOO_MANY_ATTEMPTS') return 'Terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.';
  if (kode === 'CAPABILITY_DENIED') return 'Role Anda tidak berwenang melakukan tindakan ini.';
  if (status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
  if (status === 503) return 'Layanan sedang tidak tersedia. Coba lagi sebentar lagi.';
  return 'Permintaan gagal diproses.';
}

/* -------------------------------------------------------------------------- */
/* API METHODS                                                                */
/* -------------------------------------------------------------------------- */

export const api = {
  /**
   * Password TIDAK PERNAH diperiksa di sini.
   *
   * Versi sebelumnya membandingkannya dengan string di dalam berkas ini, jadi
   * password ada di setiap salinan bundle yang pernah ter-deploy dan bisa
   * dibaca siapa pun dari sumber halaman. Sekarang yang dikirim adalah
   * kredensialnya, dan yang kembali adalah token bertanda tangan server.
   */
  login: async (email: string, password: string): Promise<Session> => {
    const data = await minta<{ token: string } & Session>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    setToken(data.token);
    return { user: data.user, capabilities: data.capabilities, environment: data.environment };
  },

  logout: () => setToken(null),

  /**
   * Capability datang dari server, tidak pernah disusun panel sendiri.
   *
   * Versi sebelumnya mengembalikan daftar lengkap untuk siapa pun — termasuk
   * email yang tidak dikenal, yang bahkan diberi ROLE_SUPERADMIN.
   */
  me: async (): Promise<Session> => {
    if (!getToken()) throw new ApiError(401, 'UNAUTHORIZED', 'Sesi login admin belum aktif.');
    return minta<Session>('/api/admin/me');
  },

  /* ---- PAKET, HARGA, DAN ENTITLEMENT — data sungguhan ---- */

  plans: () =>
    minta<{ plans: AdminPlan[]; subscriberCounts: Record<string, number> }>('/api/admin/plans'),

  savePlan: (plan: AdminPlan) =>
    minta<{ plan: AdminPlan; kind: 'CREATE' | 'UPDATE' }>(
      `/api/admin/plans/${encodeURIComponent(plan.id)}`,
      { method: 'PUT', body: JSON.stringify(plan) }
    ),

  setPlanActive: (planId: string, isActive: boolean) =>
    minta<{ plan: AdminPlan }>(`/api/admin/plans/${encodeURIComponent(planId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  planHistory: (planId: string) =>
    minta<{ rows: PlanChangeRow[] }>(`/api/admin/plans/${encodeURIComponent(planId)}`),

  overview: async () => {
    const daily = generateDailyHistory();
    const sectors = [
      { business_sector: 'FNB', registered_merchants: 14, business_unit_count: 18, transaction_count: 3840, gross_revenue: 184500000, avg_basket: 48000, last_transaction_at: new Date().toISOString() },
      { business_sector: 'RETAIL', registered_merchants: 10, business_unit_count: 12, transaction_count: 2910, gross_revenue: 142300000, avg_basket: 48900, last_transaction_at: new Date().toISOString() },
      { business_sector: 'CARWASH', registered_merchants: 6, business_unit_count: 8, transaction_count: 1680, gross_revenue: 72400000, avg_basket: 43000, last_transaction_at: new Date().toISOString() },
      { business_sector: 'BARBERSHOP', registered_merchants: 5, business_unit_count: 6, transaction_count: 1540, gross_revenue: 64100000, avg_basket: 41600, last_transaction_at: new Date().toISOString() },
      { business_sector: 'LAUNDRY', registered_merchants: 5, business_unit_count: 6, transaction_count: 1420, gross_revenue: 58200000, avg_basket: 40900, last_transaction_at: new Date().toISOString() },
    ];

    const totalGross = sectors.reduce((s, r) => s + r.gross_revenue, 0);
    const totalTx = sectors.reduce((s, r) => s + r.transaction_count, 0);
    const totalMerchants = sectors.reduce((s, r) => s + r.registered_merchants, 0);

    return {
      sectors,
      daily,
      totals: {
        merchants: totalMerchants,
        merchants_active: totalMerchants,
        sectors_in_use: 5,
        transactions: totalTx,
        gross_revenue: totalGross,
        activity_problems: 0,
        activity_events: 1240,
      },
    };
  },

  merchants: async (p?: Record<string, unknown>) => {
    let list = [...SAMPLE_MERCHANTS];
    if (p?.sector) {
      list = list.filter((m) => m.sector === p.sector || m.business_sector === p.sector);
    }
    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.merchant_name.toLowerCase().includes(q) ||
          m.owner_name.toLowerCase().includes(q)
      );
    }
    return {
      rows: list,
      merchants: list,
      total: list.length,
      offset: Number(p?.offset || 0),
      limit: Number(p?.limit || 25),
    };
  },

  merchant: async (id: string, _justification?: string) => {
    const found = SAMPLE_MERCHANTS.find((m) => m.id === id || m.merchant_id === id) || SAMPLE_MERCHANTS[0];
    const topProducts = ALL_PRODUCTS_DATA.filter((p) => p.merchant_name === found.name || p.business_sector === found.sector);

    return {
      profile: {
        merchant_name: found.name,
        business_sector: found.sector,
        owner_name: found.owner_name,
        email: found.email,
        phone: found.phone,
        joined_at: found.created_at,
        gross_revenue: found.gross_revenue,
        transaction_count: found.transactions_count,
        last_transaction_at: found.last_active_at,
      },
      sectors: [
        {
          business_sector: found.sector,
          is_active: true,
          transaction_count: found.transactions_count,
          gross_revenue: found.gross_revenue,
          avg_basket: Math.round(found.gross_revenue / Math.max(found.transactions_count, 1)),
          last_transaction_at: found.last_active_at,
        },
      ],
      topProducts: topProducts.slice(0, 10),
    };
  },

  transactions: async (p?: Record<string, unknown>) => {
    let list = [...ALL_PRODUCTS_DATA].map((p, idx) => ({
      id: `tx-${idx + 100}`,
      invoice_number: `INV-20260814-${String(idx + 100).padStart(4, '0')}`,
      merchant_name: p.merchant_name,
      business_id: `tenant-${p.business_sector}`,
      business_sector: p.business_sector,
      subtotal: p.price,
      discount_amount: 0,
      tax_amount: Math.round(p.price * 0.1),
      total_amount: p.price + Math.round(p.price * 0.1),
      total: p.price + Math.round(p.price * 0.1),
      payment_method: idx % 3 === 0 ? 'QRIS' : idx % 3 === 1 ? 'DEBIT' : 'CASH',
      cashier_name: 'Budi Santoso',
      item_count: 1,
      created_at: p.last_sold_at,
    }));

    if (p?.sector) {
      list = list.filter((t) => t.business_sector === p.sector);
    }
    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (t) => t.invoice_number.toLowerCase().includes(q) || t.merchant_name.toLowerCase().includes(q)
      );
    }
    const sum = list.reduce((s, t) => s + t.total_amount, 0);
    return {
      rows: list,
      transactions: list,
      total: list.length,
      sumAmount: sum,
      offset: Number(p?.offset || 0),
      limit: Number(p?.limit || 50),
    };
  },

  transaction: async (id: string) => {
    const p = ALL_PRODUCTS_DATA[0];
    return {
      transaction: {
        id,
        invoice_number: 'INV-20260814-0101',
        merchant_name: p.merchant_name,
        business_id: 'usr-budi_FNB',
        business_sector: p.business_sector,
        subtotal: p.price,
        discount_amount: 0,
        tax_amount: Math.round(p.price * 0.1),
        total_amount: p.price + Math.round(p.price * 0.1),
        payment_method: 'QRIS',
        cashier_name: 'Budi Santoso',
        created_at: new Date().toISOString(),
      },
      items: [
        {
          product_name: p.product_name,
          category_name: p.category_name,
          quantity: 1,
          unit_price: p.price,
          total_price: p.price,
        },
      ],
    };
  },

  products: async (p?: Record<string, unknown>) => {
    let list = [...ALL_PRODUCTS_DATA];
    if (p?.sector) {
      list = list.filter((pr) => pr.business_sector === p.sector);
    }
    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (pr) =>
          pr.product_name.toLowerCase().includes(q) ||
          pr.merchant_name.toLowerCase().includes(q) ||
          pr.category_name.toLowerCase().includes(q)
      );
    }
    return {
      rows: list,
      products: list,
      catalog: list,
      total: list.length,
      offset: Number(p?.offset || 0),
      limit: Number(p?.limit || 50),
      neverSold: 0,
      lowStock: list.filter((x) => x.is_low_stock).length,
      retired: 0,
    };
  },

  catalog: async (p?: Record<string, unknown>) => {
    return api.products(p);
  },

  rawMaterials: async (p?: Record<string, unknown>) => {
    let list = [...RAW_MATERIALS_DATA];
    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (m) =>
          m.material_name.toLowerCase().includes(q) ||
          m.merchant_name.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q)
      );
    }
    return {
      rows: list,
      total: list.length,
    };
  },

  bundles: async (p?: Record<string, unknown>) => {
    let list = [...BUNDLE_SETS_DATA];
    if (p?.sector) {
      list = list.filter((b) => b.sector === p.sector);
    }
    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (b) => b.bundle_name.toLowerCase().includes(q) || b.merchant_name.toLowerCase().includes(q)
      );
    }
    return {
      rows: list,
      total: list.length,
    };
  },

  recipes: async (p?: Record<string, unknown>) => {
    let list = [...PRODUCT_RECIPES_DATA];
    if (p?.sector) {
      list = list.filter((r) => r.business_sector === p.sector);
    }
    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (r) => r.product_name.toLowerCase().includes(q) || r.merchant_name.toLowerCase().includes(q)
      );
    }
    return {
      rows: list,
      total: list.length,
    };
  },

  activity: async (p?: Record<string, unknown>) => {
    let list = [
      {
        id: 'act-1',
        occurred_at: new Date().toISOString(),
        business_sector: 'FNB',
        app_module: 'POS',
        event_type: 'ORDER_COMPLETED',
        summary: 'Transaksi pembayaran QRIS berhasil Rp 35.000 (Paket Kenyang Hemat)',
        merchant_name: 'Kopi Kenangan Senopati',
        actor_name: 'Budi Santoso',
        actor_role: 'KASIR',
        amount_idr: 35000,
        severity: 'INFO',
        business_id: 'usr-1_FNB',
        detail: { invoice: 'INV-20260814-0101', payment_method: 'QRIS', items_count: 2 },
      },
      {
        id: 'act-2',
        occurred_at: new Date(Date.now() - 3600000).toISOString(),
        business_sector: 'RETAIL',
        app_module: 'INVENTORY',
        event_type: 'RESTOCK_IN',
        summary: 'Restok Beras Premium 5kg (+20 pcs) dari Distributor Utama',
        merchant_name: 'Toko Berkah Sembako Retail',
        actor_name: 'Ahmad Manager',
        actor_role: 'MANAGER',
        amount_idr: 1200000,
        severity: 'NOTICE',
        business_id: 'usr-6_RETAIL',
        detail: { supplier: 'PT Beras Nusantara', new_stock: 45 },
      },
      {
        id: 'act-3',
        occurred_at: new Date(Date.now() - 7200000).toISOString(),
        business_sector: 'LAUNDRY',
        app_module: 'INVENTORY',
        event_type: 'STOCK_LOW_ALERT',
        summary: 'Peringatan stok Deterjen Konsentrat mendekati batas minimum (Sisa 8L)',
        merchant_name: 'Laundry Kilat Dago',
        actor_name: 'Sistem POS',
        actor_role: 'SYSTEM',
        amount_idr: null,
        severity: 'WARNING',
        business_id: 'usr-3_LAUNDRY',
        detail: { min_threshold: 10, current_stock: 8 },
      },
      {
        id: 'act-4',
        occurred_at: new Date(Date.now() - 14400000).toISOString(),
        business_sector: 'CARWASH',
        app_module: 'POS',
        event_type: 'ORDER_COMPLETED',
        summary: 'Selesai pengerjaan Paket Ceramic Coating 9H Sultan Rp 450.000',
        merchant_name: 'Auto Clean Carwash Express',
        actor_name: 'Rian Kasir',
        actor_role: 'KASIR',
        amount_idr: 450000,
        severity: 'INFO',
        business_id: 'usr-4_CARWASH',
        detail: { vehicle_plate: 'B 1234 NHP', wash_bay: 2 },
      },
      {
        id: 'act-5',
        occurred_at: new Date(Date.now() - 21600000).toISOString(),
        business_sector: 'BARBERSHOP',
        app_module: 'AUTH',
        event_type: 'LOGIN_FAILED',
        summary: 'Percobaan login gagal dengan PIN salah (3x) di terminal kasir',
        merchant_name: 'Gentlemen Cut Barbershop',
        actor_name: 'Kasir Shift Sore',
        actor_role: 'CASHIER',
        amount_idr: null,
        severity: 'CRITICAL',
        business_id: 'usr-5_BARBERSHOP',
        detail: { terminal_ip: '192.168.1.45', attempts: 3 },
      },
    ];

    if (p?.sector) {
      list = list.filter((a) => a.business_sector === p.sector);
    }
    if (p?.module) {
      list = list.filter((a) => a.app_module === p.module);
    }
    if (p?.severity) {
      list = list.filter((a) => a.severity === p.severity);
    }
    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (a) =>
          a.summary.toLowerCase().includes(q) ||
          a.merchant_name.toLowerCase().includes(q) ||
          a.event_type.toLowerCase().includes(q)
      );
    }

    return {
      rows: list,
      total: list.length,
      offset: Number(p?.offset || 0),
      limit: Number(p?.limit || 50),
    };
  },

  activityBreakdown: async () => {
    return {
      breakdown: [
        { event_type: 'ORDER_COMPLETED', count: 1240 },
        { event_type: 'RESTOCK_IN', count: 85 },
        { event_type: 'STOCK_LOW_ALERT', count: 12 },
        { event_type: 'LOGIN_FAILED', count: 3 },
      ],
    };
  },

  audit: async (p?: Record<string, unknown>) => {
    let list = [
      {
        id: 'aud-1',
        accessed_at: new Date().toISOString(),
        internal_name: 'Stefen Laksana (Superadmin)',
        internal_email: 'stefenlaksana.sl@gmail.com',
        internal_role: 'ROLE_SUPERADMIN',
        action: 'VIEW_EXECUTIVE_OVERVIEW',
        merchant_name: null,
        justification: 'Monitoring performa makro dan leaderboard omzet platform',
        ip_address: '127.0.0.1 (Local Session)',
      },
      {
        id: 'aud-2',
        accessed_at: new Date(Date.now() - 1800000).toISOString(),
        internal_name: 'Stefen Laksana (Superadmin)',
        internal_email: 'stefenlaksana.sl@gmail.com',
        internal_role: 'ROLE_SUPERADMIN',
        action: 'EXPORT_MERCHANT_FINANCIALS',
        merchant_name: 'Kopi Kenangan Senopati',
        justification: 'Audit laporan laba rugi, HPP bahan baku, dan pajak PB1',
        ip_address: '127.0.0.1 (Local Session)',
      },
      {
        id: 'aud-3',
        accessed_at: new Date(Date.now() - 5400000).toISOString(),
        internal_name: 'Platform Operations Root',
        internal_email: 'ops@newhopepos.id',
        internal_role: 'ROLE_SUPERADMIN',
        action: 'UPDATE_SAAS_TIER',
        merchant_name: 'New Hope Resto & Cafe',
        justification: 'Aktivasi paket langganan Pro Growth Rp 88.000/bln',
        ip_address: '10.0.1.5 (Cloud Gateway)',
      },
      {
        id: 'aud-4',
        accessed_at: new Date(Date.now() - 10800000).toISOString(),
        internal_name: 'Customer Support Lead',
        internal_email: 'support@newhopepos.id',
        internal_role: 'ROLE_INTERNAL_SUPPORT',
        action: 'INSPECT_TRANSACTION_LOG',
        merchant_name: 'Laundry Kilat Dago',
        justification: 'Investigasi komplain struk transaksi gantung oleh merchant',
        ip_address: '192.168.1.102',
      },
      {
        id: 'aud-5',
        accessed_at: new Date(Date.now() - 25200000).toISOString(),
        internal_name: 'Guest / Anonymous Probe',
        internal_email: 'unknown@external.net',
        internal_role: 'ROLE_UNAUTHORIZED',
        action: 'DENIED_UNAUTHORIZED_ACCESS',
        merchant_name: 'Auto Clean Carwash Express',
        justification: 'Percobaan akses endpoint /admin/merchants tanpa token valid',
        ip_address: '203.0.113.45',
      },
    ];

    if (p?.filter && p.filter !== 'ALL') {
      if (p.filter === 'DENIED') {
        list = list.filter((r) => r.action.startsWith('DENIED_'));
      } else if (p.filter === 'FINANCIAL') {
        list = list.filter((r) => r.action.includes('FINANCIAL') || r.action.includes('OVERVIEW'));
      }
    }

    if (p?.search) {
      const q = String(p.search).toLowerCase();
      list = list.filter(
        (r) =>
          r.internal_name.toLowerCase().includes(q) ||
          r.internal_email.toLowerCase().includes(q) ||
          r.action.toLowerCase().includes(q) ||
          (r.merchant_name && r.merchant_name.toLowerCase().includes(q))
      );
    }

    return {
      rows: list,
      audits: list,
      total: list.length,
      offset: Number(p?.offset || 0),
      limit: Number(p?.limit || 50),
    };
  },
};
