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
 * Halaman yang masih menampilkan DATA CONTOH, bukan isi database.
 *
 * Tinggal satu: manajemen user internal, yang menuntut endpoint tulis
 * tersendiri dan belum dikerjakan. Sisanya sudah membaca database.
 *
 * Daftarnya dibiarkan terlihat dari kode, dan diberi tanda di layar, karena
 * angka yang kelihatan meyakinkan tapi tidak nyata adalah cara tercepat
 * mengambil keputusan yang salah.
 */
export const HALAMAN_DATA_CONTOH = ['users'];

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
    throw new ApiError(
      res.status,
      'BAD_RESPONSE',
      'Server tidak mengembalikan JSON. Endpoint admin mungkin belum ter-deploy.'
    );
  }

  if (!res.ok || data?.ok === false) {
    if (res.status === 401) setToken(null);
    throw new ApiError(
      res.status,
      data?.error || 'REQUEST_FAILED',
      data?.detail ||
        (Array.isArray(data?.issues) ? data.issues.join(' ') : null) ||
        pesanGalat(res.status, data?.error)
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
  if (kode === 'CAPABILITY_DENIED') return 'Role Anda tidak berwenang melihat halaman ini.';
  if (kode === 'JUSTIFICATION_REQUIRED') return 'Sertakan alasan sebelum membuka data merchant ini.';
  if (status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
  if (status === 404) return 'Data tidak ditemukan.';
  if (status === 503) return 'Layanan sedang tidak tersedia. Coba lagi sebentar lagi.';
  return 'Permintaan gagal diproses.';
}

/** Menyusun query string, membuang yang kosong supaya URL tetap terbaca. */
function qs(p: Record<string, unknown> = {}): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export type Filter = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* API METHODS                                                                 */
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

  /* ---- RINGKASAN & MERCHANT ---- */

  overview: () => minta<any>('/api/admin/overview'),

  merchants: (p?: Filter) => minta<any>(`/api/admin/merchants${qs(p)}`),

  /**
   * Detail satu merchant. `justification` wajib bagi role SUPPORT dan dikirim
   * sebagai header — bukan query string, yang berakhir di log akses server dan
   * riwayat browser.
   */
  merchant: (id: string, justification?: string) =>
    minta<any>(`/api/admin/merchants/${encodeURIComponent(id)}${qs({ merchantId: id })}`, {
      headers: justification ? { 'x-justification': justification } : undefined,
    }),

  /* ---- TRANSAKSI & PRODUK ---- */

  transactions: (p?: Filter) => minta<any>(`/api/admin/transactions${qs(p)}`),
  transaction: (id: string) => minta<any>(`/api/admin/transactions/${encodeURIComponent(id)}`),
  products: (p?: Filter) => minta<any>(`/api/admin/products${qs(p)}`),
  catalog: (p?: Filter) => minta<any>(`/api/admin/catalog${qs(p)}`),
  rawMaterials: (p?: Filter) => minta<any>(`/api/admin/raw-materials${qs(p)}`),
  recipes: (p?: Filter) => minta<any>(`/api/admin/recipes${qs(p)}`),

  /**
   * Bundle promo BELUM ada di database.
   *
   * Aplikasi kasir menyimpannya di localStorage dan jalur sinkronisasi belum
   * membawanya, jadi tidak ada yang bisa dibaca dari sini. Dijawab kosong
   * dengan alasan yang bisa ditampilkan, bukan dengan contoh yang terlihat
   * seperti data merchant sungguhan.
   */
  bundles: async (_p?: Filter) => ({
    rows: [] as any[],
    total: 0,
    belumTersedia: 'Bundle promo masih tersimpan di perangkat kasir dan belum ikut tersinkronisasi ke server.',
  }),

  /* ---- AKTIVITAS & AUDIT ---- */

  activity: (p?: Filter) => minta<any>(`/api/admin/activity${qs(p)}`),
  activityBreakdown: () => minta<any>('/api/admin/activity/breakdown'),
  audit: (p?: Filter) => minta<any>(`/api/admin/access-audit${qs(p)}`),

  /* ---- PAKET, HARGA, DAN ENTITLEMENT ---- */

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
};
