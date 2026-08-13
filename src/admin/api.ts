/**
 * Klien HTTP untuk API admin.
 *
 * Identitas internal disimpan di sessionStorage, bukan localStorage: menutup
 * tab harus mengakhiri sesi konsol internal. localStorage bertahan berhari-hari
 * di laptop yang mungkin dipakai bersama.
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
  ROLE_SUPERADMIN: 'Superadmin',
  ROLE_INTERNAL_GROWTH: 'Growth (agregat saja)',
  ROLE_INTERNAL_SUPPORT: 'Support (wajib alasan)',
};

export function getIdentity(): string | null {
  return sessionStorage.getItem(IDENTITY_KEY);
}

export function setIdentity(email: string | null): void {
  if (email) sessionStorage.setItem(IDENTITY_KEY, email);
  else sessionStorage.removeItem(IDENTITY_KEY);
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

async function request<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {};
  const id = getIdentity();
  if (id) headers['x-internal-user'] = id;

  const res = await fetch(url.toString(), { headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.ok === false) {
    throw new ApiError(
      res.status,
      body.error ?? 'UNKNOWN',
      body.detail ?? body.error ?? `HTTP ${res.status}`
    );
  }
  return body as T;
}

export const api = {
  identities: () => request<{ identities: Identity[] }>('/api/admin/identities'),
  me: () => request<Session>('/api/admin/me'),
  overview: () => request<any>('/api/admin/overview'),
  merchants: (p?: Record<string, unknown>) => request<any>('/api/admin/merchants', p),
  merchant: (id: string, justification?: string) =>
    request<any>(`/api/admin/merchants/${id}`, { justification }),
  transactions: (p?: Record<string, unknown>) => request<any>('/api/admin/transactions', p),
  transaction: (id: string) => request<any>(`/api/admin/transactions/${id}`),
  products: (p?: Record<string, unknown>) => request<any>('/api/admin/products', p),
  catalog: (p?: Record<string, unknown>) => request<any>('/api/admin/catalog', p),
  activity: (p?: Record<string, unknown>) => request<any>('/api/admin/activity', p),
  activityBreakdown: () => request<any>('/api/admin/activity/breakdown'),
  audit: () => request<any>('/api/admin/access-audit'),
};

/* -------------------------------------------------------------------------- */
/* FORMAT                                                                      */
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

/** Kelas Tailwind per sektor. Ditulis lengkap agar tidak dipangkas JIT. */
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
  WARNING:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800',
  CRITICAL: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800',
};

export const rupiah = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'Rp 0';
  return 'Rp ' + Math.round(v).toLocaleString('id-ID');
};

/** Ringkas untuk kartu: 181.696.920 -> Rp 181,7 jt */
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

/** "3 hari lalu" — jarak waktu itu sendiri adalah sinyal, bukan sekadar hiasan. */
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
