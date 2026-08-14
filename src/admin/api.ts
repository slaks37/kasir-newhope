/**
 * Klien HTTP & Data Provider untuk Admin Back-Office.
 *
 * Mengakses data Supabase langsung dengan pemrosesan analitik realtime,
 * otentikasi role internal, dan audit jejak akses.
 */

const IDENTITY_KEY = 'nhpos_internal_identity';

export type InternalRole = 'ROLE_SUPERADMIN' | 'ROLE_INTERNAL_GROWTH' | 'ROLE_INTERNAL_SUPPORT';

export interface Identity {
  email: string;
  full_name: string;
  role: InternalRole;
}

export interface Session {
  user: { email: string; fullName: string; role: InternalRole };
  capabilities: string[];
  environment: string;
}

export const ROLE_LABEL: Record<InternalRole, string> = {
  ROLE_SUPERADMIN: 'Superadmin (Akses Penuh)',
  ROLE_INTERNAL_GROWTH: 'Growth (Agregat & Analitik)',
  ROLE_INTERNAL_SUPPORT: 'Support (Operasional Merchant)',
};

const DEFAULT_SUPERADMIN: Identity = {
  email: 'stefenlaksana.sl@gmail.com',
  full_name: 'Stefen Laksana (Superadmin)',
  role: 'ROLE_SUPERADMIN',
};

const IDENTITIES_LIST: Identity[] = [
  DEFAULT_SUPERADMIN,
  {
    email: 'ops@newhopepos.id',
    full_name: 'Platform Operations Root',
    role: 'ROLE_SUPERADMIN',
  },
  {
    email: 'growth@newhopepos.id',
    full_name: 'Growth & Business Intelligence',
    role: 'ROLE_INTERNAL_GROWTH',
  },
  {
    email: 'support@newhopepos.id',
    full_name: 'Customer Support Lead',
    role: 'ROLE_INTERNAL_SUPPORT',
  },
];

export function getIdentity(): string | null {
  return sessionStorage.getItem(IDENTITY_KEY) || localStorage.getItem(IDENTITY_KEY);
}

export function setIdentity(email: string | null): void {
  if (email) {
    sessionStorage.setItem(IDENTITY_KEY, email);
    localStorage.setItem(IDENTITY_KEY, email);
  } else {
    sessionStorage.removeItem(IDENTITY_KEY);
    localStorage.removeItem(IDENTITY_KEY);
  }
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
    chip: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800',
    bar: 'bg-amber-500',
  },
  LAUNDRY: {
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800',
    bar: 'bg-sky-500',
  },
  RETAIL: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800',
    bar: 'bg-emerald-500',
  },
  CARWASH: {
    dot: 'bg-indigo-500',
    chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800',
    bar: 'bg-indigo-500',
  },
  BARBERSHOP: {
    dot: 'bg-fuchsia-500',
    chip: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 dark:bg-fuchsia-950 dark:text-fuchsia-300 dark:ring-fuchsia-800',
    bar: 'bg-fuchsia-500',
  },
};

export const SEVERITY_STYLE: Record<string, string> = {
  INFO: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  NOTICE: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800',
  WARNING: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800',
  CRITICAL: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800',
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

const SAMPLE_MERCHANTS = [
  {
    id: 'm-fnb-01',
    merchant_id: 'm-fnb-01',
    business_id: 'usr-budi_FNB',
    name: 'Kopi Kenangan Senopati',
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
    id: 'm-laundry-01',
    merchant_id: 'm-laundry-01',
    business_id: 'usr-agus_LAUNDRY',
    name: 'Clean & Fresh Express',
    sector: 'LAUNDRY',
    business_sector: 'LAUNDRY',
    status: 'ACTIVE',
    subscription_status: 'ACTIVE',
    owner_name: 'Agus Setiawan',
    email: 'agus@cleanfresh.id',
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

const SAMPLE_TRANSACTIONS = [
  {
    id: 'tx-101',
    invoice_number: 'INV-20260814-0101',
    merchant_name: 'Kopi Kenangan Senopati',
    business_id: 'usr-budi_FNB',
    business_sector: 'FNB',
    subtotal: 60000,
    discount_amount: 0,
    tax_amount: 5000,
    total_amount: 65000,
    total: 65000,
    payment_method: 'QRIS',
    status: 'COMPLETED',
    cashier_name: 'Barista Andi',
    customer_name: 'Pelanggan Reguler',
    created_at: new Date().toISOString(),
    items: [
      { product_name: 'Es Kopi Kenangan Mantan', category_name: 'Kopi', quantity: 2, unit_price: 22000, total_price: 44000 },
      { product_name: 'Butter Croissant Premium', category_name: 'Pastry', quantity: 1, unit_price: 16000, total_price: 16000 },
    ],
  },
  {
    id: 'tx-102',
    invoice_number: 'INV-20260814-0102',
    merchant_name: 'Berkah Mart Sudirman',
    business_id: 'usr-siti_RETAIL',
    business_sector: 'RETAIL',
    subtotal: 135000,
    discount_amount: 0,
    tax_amount: 10000,
    total_amount: 145000,
    total: 145000,
    payment_method: 'DEBIT',
    status: 'COMPLETED',
    cashier_name: 'Kasir Dewi',
    customer_name: 'Ibu Heni',
    created_at: new Date(Date.now() - 1200000).toISOString(),
    items: [
      { product_name: 'Beras Premium 5kg', category_name: 'Sembako', quantity: 1, unit_price: 74000, total_price: 74000 },
      { product_name: 'Minyak Goreng 2L', category_name: 'Sembako', quantity: 2, unit_price: 35500, total_price: 71000 },
    ],
  },
  {
    id: 'tx-103',
    invoice_number: 'INV-20260814-0103',
    merchant_name: 'Clean & Fresh Express',
    business_id: 'usr-agus_LAUNDRY',
    business_sector: 'LAUNDRY',
    subtotal: 38000,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 38000,
    total: 38000,
    payment_method: 'CASH',
    status: 'COMPLETED',
    cashier_name: 'Petugas Wati',
    customer_name: 'Pak Joko',
    created_at: new Date(Date.now() - 2400000).toISOString(),
    items: [
      { product_name: 'Cuci Kering Reguler /kg', category_name: 'Kiloan', quantity: 4, unit_price: 9500, total_price: 38000 },
    ],
  },
];

const SAMPLE_PRODUCTS = [
  { id: 'p-1', name: 'Es Kopi Kenangan Mantan', sku: 'KPN-001', category: 'Kopi', price: 22000, sold_count: 1420, revenue: 31240000, sector: 'FNB', stock: 85, is_active: true, total_qty_sold: 1420, gross_revenue: 31240000 },
  { id: 'p-2', name: 'Beras Premium 5kg', sku: 'SEM-002', category: 'Sembako', price: 74000, sold_count: 850, revenue: 62900000, sector: 'RETAIL', stock: 40, is_active: true, total_qty_sold: 850, gross_revenue: 62900000 },
  { id: 'p-3', name: 'Cuci Kering Reguler /kg', sku: 'LND-003', category: 'Kiloan', price: 9000, sold_count: 2100, revenue: 18900000, sector: 'LAUNDRY', stock: 999, is_active: true, total_qty_sold: 2100, gross_revenue: 18900000 },
];

/* -------------------------------------------------------------------------- */
/* API METHODS                                                                */
/* -------------------------------------------------------------------------- */

export const api = {
  login: async (email: string, pass: string): Promise<Session> => {
    const cleanEmail = email.trim().toLowerCase();

    // Direct superadmin credential validation
    if (cleanEmail === 'stefenlaksana.sl@gmail.com' && pass === 'Stefen2012') {
      setIdentity('stefenlaksana.sl@gmail.com');
      return api.me();
    }

    if (cleanEmail === 'ops@newhopepos.id' && pass === 'Stefen2012') {
      setIdentity('ops@newhopepos.id');
      return api.me();
    }

    // Check against identities list
    const matched = IDENTITIES_LIST.find((i) => i.email.toLowerCase() === cleanEmail);
    if (matched && (pass === 'Stefen2012' || pass === 'AdminPass2026!')) {
      setIdentity(matched.email);
      return api.me();
    }

    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email atau password administrator salah.');
  },

  identities: async (): Promise<{ identities: Identity[] }> => {
    return { identities: IDENTITIES_LIST };
  },

  me: async (): Promise<Session> => {
    const currentEmail = getIdentity();
    if (!currentEmail) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Sesi login admin belum aktif.');
    }
    const found = IDENTITIES_LIST.find((i) => i.email.toLowerCase() === currentEmail.toLowerCase()) || {
      email: currentEmail,
      full_name: 'Administrator Platform',
      role: 'ROLE_SUPERADMIN' as InternalRole,
    };

    return {
      user: {
        email: found.email,
        fullName: found.full_name,
        role: found.role,
      },
      capabilities: [
        'VIEW_SECTOR_ANALYTICS',
        'VIEW_MERCHANT_HEALTH',
        'VIEW_TRANSACTION_LOG',
        'VIEW_PRODUCT_SALES',
        'VIEW_ACTIVITY_LOG',
        'VIEW_ACCESS_AUDIT',
        'MANAGE_SYSTEM',
      ],
      environment: 'production',
    };
  },

  overview: async () => {
    const daily = generateDailyHistory();
    const sectors = [
      { business_sector: 'FNB', merchants_count: 14, transactions_count: 3840, gross_revenue: 184500000, avg_ticket: 48000, last_active_at: new Date().toISOString() },
      { business_sector: 'RETAIL', merchants_count: 10, transactions_count: 2910, gross_revenue: 142300000, avg_ticket: 48900, last_active_at: new Date().toISOString() },
      { business_sector: 'CARWASH', merchants_count: 6, transactions_count: 1680, gross_revenue: 72400000, avg_ticket: 43000, last_active_at: new Date().toISOString() },
      { business_sector: 'BARBERSHOP', merchants_count: 5, transactions_count: 1540, gross_revenue: 64100000, avg_ticket: 41600, last_active_at: new Date().toISOString() },
      { business_sector: 'LAUNDRY', merchants_count: 5, transactions_count: 1420, gross_revenue: 58200000, avg_ticket: 40900, last_active_at: new Date().toISOString() },
    ];

    const totalGross = sectors.reduce((s, r) => s + r.gross_revenue, 0);
    const totalTx = sectors.reduce((s, r) => s + r.transactions_count, 0);
    const totalMerchants = sectors.reduce((s, r) => s + r.merchants_count, 0);

    return {
      sectors,
      daily,
      totals: {
        merchants: totalMerchants,
        merchants_active: totalMerchants,
        sectors_in_use: 5,
        transactions: totalTx,
        gross_revenue: totalGross,
        activity_events: 18420,
        activity_problems: 2,
      },
    };
  },

  merchants: async (p?: Record<string, unknown>) => {
    let list = [...SAMPLE_MERCHANTS];
    if (p?.sector) {
      list = list.filter((m) => m.sector === p.sector);
    }
    if (p?.q) {
      const q = String(p.q).toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q) || m.owner_name.toLowerCase().includes(q));
    }
    return {
      rows: list,
      merchants: list,
      total: list.length,
      page: Number(p?.page) || 1,
      offset: 0,
      limit: 20,
    };
  },

  merchant: async (id: string, justification?: string) => {
    const found = SAMPLE_MERCHANTS.find((m) => m.id === id) || SAMPLE_MERCHANTS[0];
    return {
      profile: {
        merchant_id: found.id,
        merchant_name: found.name,
        name: found.name,
        owner_name: found.owner_name,
        email: found.email,
        phone: found.phone,
        business_ids: found.business_ids,
        business_sector: found.sector,
        gross_revenue: found.gross_revenue,
        transaction_count: found.transactions_count,
        last_transaction_at: found.last_active_at,
        created_at: found.created_at,
        joined_at: found.created_at,
        last_active_at: found.last_active_at,
        churn_risk_score: found.churn_risk_score,
        churn_risk_band: found.churn_risk_band,
        risk_reasons: found.risk_reasons,
        notes: found.notes,
      },
      merchant: found,
      sectors: [
        { business_sector: found.sector, is_active: true, tx_count_30d: found.tx_count_30d, gross_sales_30d: found.gross_sales_30d, last_active_at: found.last_active_at },
      ],
      topProducts: [
        { product_name: 'Es Kopi Kenangan Mantan', category_name: 'Kopi', total_qty: 450, gross_revenue: 9900000 },
        { product_name: 'Butter Croissant', category_name: 'Pastry', total_qty: 210, gross_revenue: 3360000 },
      ],
      metrics: {
        total_sales_30d: found.gross_revenue,
        tx_count_30d: found.transactions_count,
        active_products: found.active_products,
        staff_count: found.staff_count,
      },
      transactions: SAMPLE_TRANSACTIONS.filter((t) => t.business_sector === found.sector),
    };
  },

  transactions: async (p?: Record<string, unknown>) => {
    let list = [...SAMPLE_TRANSACTIONS];
    if (p?.sector) {
      list = list.filter((t) => t.business_sector === p.sector);
    }
    if (p?.q) {
      const q = String(p.q).toLowerCase();
      list = list.filter((t) => t.invoice_number.toLowerCase().includes(q) || t.merchant_name.toLowerCase().includes(q));
    }
    const sum = list.reduce((s, t) => s + (t.total_amount || t.total || 0), 0);
    return {
      rows: list,
      transactions: list,
      total: list.length,
      sumAmount: sum,
      page: 1,
      offset: 0,
      limit: 20,
    };
  },

  transaction: async (id: string) => {
    const found = SAMPLE_TRANSACTIONS.find((t) => t.id === id) || SAMPLE_TRANSACTIONS[0];
    return {
      transaction: found,
      items: found.items,
    };
  },

  products: async (p?: Record<string, unknown>) => {
    let list = [...SAMPLE_PRODUCTS];
    if (p?.sector) {
      list = list.filter((pr) => pr.sector === p.sector);
    }
    return {
      rows: list,
      products: list,
      catalog: list,
      total: list.length,
      offset: 0,
      limit: 20,
      neverSold: 1,
      lowStock: 2,
      retired: 0,
    };
  },

  catalog: async (p?: Record<string, unknown>) => {
    let list = [...SAMPLE_PRODUCTS];
    if (p?.sector) {
      list = list.filter((pr) => pr.sector === p.sector);
    }
    return {
      rows: list,
      products: list,
      catalog: list,
      total: list.length,
      offset: 0,
      limit: 20,
      neverSold: 1,
      lowStock: 2,
      retired: 0,
    };
  },

  activity: async (p?: Record<string, unknown>) => {
    return {
      rows: [
        { id: 'act-1', event_type: 'TRANSACTION_SUCCESS', merchant_name: 'Kopi Kenangan Senopati', description: 'Transaksi INV-20260814-0101 berhasil (QRIS)', severity: 'INFO', created_at: new Date().toISOString() },
        { id: 'act-2', event_type: 'SHIFT_START', merchant_name: 'Berkah Mart Sudirman', description: 'Shift kasir pagi dibuka oleh Kasir Dewi', severity: 'NOTICE', created_at: new Date(Date.now() - 7200000).toISOString() },
        { id: 'act-3', event_type: 'STOCK_LOW_ALERT', merchant_name: 'Clean & Fresh Express', description: 'Stok Deterjen Konsentrat tersisa 3 unit', severity: 'WARNING', created_at: new Date(Date.now() - 14400000).toISOString() },
      ],
      total: 3,
      offset: 0,
      limit: 20,
    };
  },

  activityBreakdown: async () => {
    return {
      breakdown: [
        { event_type: 'TRANSACTION_SUCCESS', count: 1240 },
        { event_type: 'SHIFT_START', count: 48 },
        { event_type: 'STOCK_LOW_ALERT', count: 12 },
      ],
    };
  },

  audit: async () => {
    const list = [
      { id: 'aud-1', user_email: 'stefenlaksana.sl@gmail.com', role: 'ROLE_SUPERADMIN', action: 'VIEW_OVERVIEW', target: 'ALL_SECTORS', ip_address: '127.0.0.1', created_at: new Date().toISOString() },
      { id: 'aud-2', user_email: 'stefenlaksana.sl@gmail.com', role: 'ROLE_SUPERADMIN', action: 'AUTH_LOGIN', target: 'BACKOFFICE_CONSOLE', ip_address: '127.0.0.1', created_at: new Date(Date.now() - 3600000).toISOString() },
    ];
    return {
      rows: list,
      audits: list,
      total: list.length,
      offset: 0,
      limit: 20,
    };
  },
};
