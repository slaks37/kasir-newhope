/**
 * Klien HTTP & Data Provider untuk Admin Back-Office.
 *
 * Mengakses data Supabase langsung dengan pemrosesan analitik realtime,
 * otentikasi role internal, dan audit jejak akses.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { verifyPinHash } from '../lib/auth/pinSecurity';

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

/*
 * DAFTAR IDENTITAS INTERNAL DIHAPUS DARI SINI.
 *
 * Empat identitas — termasuk satu alamat pribadi — dulu ter-hardcode di berkas
 * ini, yang berarti ikut terkirim ke setiap browser yang membuka konsol. Lebih
 * buruk, `me()` memakainya sebagai basis role, dan email yang TIDAK ada di
 * daftar itu di-default menjadi ROLE_SUPERADMIN.
 *
 * Sumbernya sekarang `internal.internal_users` lewat GET /api/admin/identities,
 * dan role-nya diputuskan server. Menambah staf internal menjadi satu INSERT,
 * bukan sebuah deploy.
 */

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
/* TRANSPORT                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Berkas ini DULU mengembalikan data karangan.
 *
 * Seluruh konsol — omzet per sektor, kesehatan merchant, log transaksi, jejak
 * audit — dilayani dari ±1.400 baris konstanta di berkas ini, tanpa satu pun
 * panggilan jaringan. Sementara itu backend-nya sudah lengkap dan berjalan: 12
 * rute `/api/admin/*` di `src/server/adminRoutes.ts`, masing-masing di balik
 * guard kapabilitas, dengan pencatatan akses ke `internal.internal_access_log`
 * — termasuk mencatat percobaan yang DITOLAK. Gateway sudah merutekannya ke
 * backoffice-service. Yang tidak ada hanyalah pemanggilnya.
 *
 * Akibatnya berlapis: angka yang ditampilkan tidak berhubungan dengan merchant
 * mana pun, RBAC menjadi kosmetik karena `me()` mengembalikan seluruh
 * kapabilitas tanpa syarat, dan jejak audit tidak pernah tertulis sekali pun.
 *
 * Sekarang setiap metode di bawah memanggil endpoint sungguhan, dan bentuk
 * kembaliannya sengaja dipertahankan persis seperti sebelumnya supaya halaman
 * yang sudah benar tidak perlu ikut berubah.
 */

/** Nama host yang membedakan konsol penyedia dari domain merchant. */
const ENV_OVERRIDE_KEY = 'nhpos_env_override';

function headerInternal(justification?: string): Record<string, string> {
  const h: Record<string, string> = {};

  // Identitas internal. Guard di server memakainya untuk mencari baris di
  // internal.internal_users — bukan untuk mempercayainya begitu saja.
  const email = getIdentity();
  if (email) h['x-internal-user'] = email;

  // Alasan akses. Role support WAJIB menyertakannya sebelum membaca data satu
  // merchant; tanpa itu server menjawab JUSTIFICATION_REQUIRED.
  if (justification) h['x-justification'] = justification;

  /*
   * Di pengembangan, konsol dilayani dari localhost — yang tidak dikenali
   * `resolveEnvironment()` sebagai domain back-office, sehingga guard menjawab
   * 404. Override ini hanya berlaku kalau operator menyetelnya sendiri, dan
   * server tetap yang memutuskan apakah nilainya sah.
   */
  const override = localStorage.getItem(ENV_OVERRIDE_KEY);
  if (override) h['x-env-override'] = override;

  return h;
}

function queryString(p?: Record<string, unknown>): string {
  if (!p) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Satu jalur untuk seluruh permintaan konsol.
 *
 * Kode status diterjemahkan ke pesan yang menyebut LANGKAH BERIKUTNYA, bukan
 * sekadar mengulang kode. Staf yang melihat "403" tidak tahu harus berbuat apa;
 * "role Anda tidak punya kapabilitas ini" memberi tahu bahwa yang perlu diubah
 * adalah rolenya, bukan permintaannya.
 */
async function minta<T>(path: string, opts: { justification?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      headers: headerInternal(opts.justification),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Tidak bisa menghubungi server. Periksa koneksi lalu muat ulang.');
  }

  const body = await res.json().catch(() => ({}) as any);

  if (!res.ok) {
    const kode = String(body?.error || `HTTP_${res.status}`);
    const pesan: Record<string, string> = {
      NOT_FOUND:
        'Konsol internal tidak dilayani di alamat ini, atau identitas Anda tidak terdaftar sebagai staf internal.',
      UNKNOWN_IDENTITY: 'Identitas ini tidak terdaftar sebagai staf internal.',
      NOT_AN_INTERNAL_IDENTITY: 'Akun ini bukan identitas internal.',
      CAPABILITY_DENIED: body?.detail || 'Role Anda tidak memiliki kapabilitas untuk data ini.',
      JUSTIFICATION_REQUIRED:
        'Role Anda wajib menyertakan alasan sebelum membuka data satu merchant.',
      DATABASE_UNAVAILABLE: 'Database sedang tidak bisa dihubungi. Coba lagi sebentar lagi.',
      MERCHANT_NOT_FOUND: 'Merchant tidak ditemukan.',
      TRANSACTION_NOT_FOUND: 'Transaksi tidak ditemukan.',
      INTERNAL_ERROR: 'Terjadi kesalahan di server. Laporkan ke tim platform bila berulang.',
    };
    throw new ApiError(res.status, kode, pesan[kode] || `Permintaan gagal (${kode}).`);
  }

  return body as T;
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

export const api = {
  /**
   * Masuk sebagai staf internal.
   *
   * Kata sandi diverifikasi Supabase Auth; KAPABILITASNYA datang dari server
   * lewat `me()`. Versi sebelumnya menyusun kapabilitas di browser dan
   * memberikan ketujuhnya kepada siapa pun — termasuk email yang tidak ada di
   * daftar mana pun, yang di-default menjadi SUPERADMIN.
   */
  login: async (email: string, pass: string): Promise<Session> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !pass) {
      throw new ApiError(400, 'INVALID_INPUT', 'Email dan kata sandi administrator wajib diisi.');
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: pass,
      });
      if (error || !data.user) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi administrator salah.');
      }
    }

    // Identitas disimpan DULU: me() mengirimkannya lewat header x-internal-user,
    // dan server yang memutuskan apakah ia staf internal yang sah.
    setIdentity(cleanEmail);
    try {
      return await api.me();
    } catch (err) {
      // Kredensial Supabase benar tapi bukan staf internal — sesi tidak boleh
      // tertinggal setengah jadi.
      setIdentity(null);
      throw err;
    }
  },

  /** Daftar identitas internal untuk layar masuk. Hanya email, nama, dan role. */
  identities: async (): Promise<{ identities: Identity[] }> => {
    const r = await minta<{ identities: Identity[] }>('/identities');
    return { identities: r.identities ?? [] };
  },

  /** Siapa saya, dan kapabilitas apa yang DIBERIKAN SERVER untuk role itu. */
  me: async (): Promise<Session> => {
    if (!getIdentity()) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Sesi login admin belum aktif.');
    }
    const r = await minta<{
      user: { email: string; fullName: string; role: InternalRole };
      capabilities: string[];
      environment: string;
    }>('/me');
    return { user: r.user, capabilities: r.capabilities ?? [], environment: r.environment };
  },

  overview: async () => {
    const r = await minta<{
      sectors: unknown[];
      totals: Record<string, unknown>;
      daily: unknown[];
    }>('/overview');
    return { sectors: r.sectors ?? [], daily: r.daily ?? [], totals: r.totals ?? {} };
  },

  merchants: async (p?: Record<string, unknown>) => minta<any>(`/merchants${queryString(p)}`),

  /**
   * Detail satu merchant.
   *
   * `justification` diteruskan sebagai header, bukan dibuang seperti
   * sebelumnya (parameternya dulu bernama `_justification` — diterima lalu
   * diabaikan). Server mencatatnya ke jejak audit, dan menolak permintaan role
   * support yang datang tanpa alasan.
   */
  merchant: async (id: string, justification?: string) =>
    minta<any>(`/merchants/${encodeURIComponent(id)}`, { justification }),

  transactions: async (p?: Record<string, unknown>) => minta<any>(`/transactions${queryString(p)}`),

  transaction: async (id: string) => minta<any>(`/transactions/${encodeURIComponent(id)}`),

  products: async (p?: Record<string, unknown>) => minta<any>(`/products${queryString(p)}`),

  catalog: async (p?: Record<string, unknown>) => minta<any>(`/catalog${queryString(p)}`),

  /** Bahan mentah dan stoknya, dari contract.stock_status. */
  rawMaterials: async (p?: Record<string, unknown>) => minta<any>(`/raw-materials${queryString(p)}`),

  /** Komposisi bahan (BOM), dari contract.bom_explosion. */
  recipes: async (p?: Record<string, unknown>) => minta<any>(`/recipes${queryString(p)}`),

  /**
   * Paket bundling merchant.
   *
   * BELUM ADA di lapisan `contract`. Skema memodelkan resep dan modifier, tapi
   * tidak ada satu pun view yang menyatakan "paket bundling" — jadi tidak ada
   * yang bisa dibaca dengan jujur untuk tampilan ini.
   *
   * Dikembalikan kosong dengan alasan yang bisa ditampilkan, BUKAN diisi contoh.
   * Konsol penyedia yang menampilkan paket promo karangan lebih berbahaya
   * daripada konsol yang mengaku belum punya datanya: yang pertama akan dipakai
   * mengambil keputusan.
   */
  bundles: async (_p?: Record<string, unknown>) => ({
    rows: [] as unknown[],
    total: 0,
    unavailable: 'Paket bundling belum dimodelkan di lapisan contract.',
  }),

  activity: async (p?: Record<string, unknown>) => minta<any>(`/activity${queryString(p)}`),

  activityBreakdown: async () => {
    const r = await minta<{ rows: unknown[] }>('/activity/breakdown');
    return { breakdown: r.rows ?? [], rows: r.rows ?? [] };
  },

  audit: async (p?: Record<string, unknown>) => minta<any>(`/access-audit${queryString(p)}`),
};
