/**
 * Isi sebuah paket langganan: harga, akses, dan batas.
 *
 * SATU BENTUK UNTUK TIGA PEMAKAI — panel admin yang menyuntingnya, server yang
 * menyimpannya, dan aplikasi kasir yang menegakkannya. Sebelum ini angka paket
 * hidup di tiga tempat yang tidak pernah sepakat (kartu harga di landing page,
 * SAAS_PLANS di billing-service, DEFAULT_PLANS di api/v1/subscription/plans),
 * dan tidak satu pun dari ketiganya benar-benar membatasi apa pun.
 *
 * Berkas ini AMAN untuk browser: tidak ada impor Node, tidak ada akses
 * database. Aturannya sama persis di kedua sisi, jadi pesan yang dilihat admin
 * saat menyimpan adalah pesan yang sama yang akan ditolak server.
 */

import type { PermissionFeature } from '../../types';

export type DashboardAccessLevel = 'BASIC' | 'FULL' | 'ADVANCED';

/** -1 berarti tanpa batas — konvensi yang sama dipakai kolom database. */
export const TANPA_BATAS = -1;

export interface PlanEntitlements {
  productLimit: number;
  maxOutlets: number;
  aiQuotaMonthly: number;
  dashboardAccessLevel: DashboardAccessLevel;
  moduleAccess: PermissionFeature[];
}

export interface AdminPlan extends PlanEntitlements {
  id: string;
  name: string;
  tierLevel: number;
  billingCycle: 'MONTHLY' | 'YEARLY';
  priceIdr: number;
  priceYearlyIdr: number | null;
  extraOutletPriceIdr: number | null;
  currency: string;
  /** Benefit yang ditampilkan di kartu harga. Teks bebas, untuk dibaca calon pelanggan. */
  features: string[];
  isActive: boolean;
  sortOrder: number;
  updatedBy?: string | null;
}

/* -------------------------------------------------------------------------- */
/* KOSAKATA                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Modul yang boleh dijual per paket, dengan namanya menurut pemilik toko.
 *
 * `home` dan `overview` sengaja TIDAK ada di sini. Keduanya adalah halaman
 * depan aplikasi; paket yang tidak membukanya menghasilkan merchant yang bisa
 * login tapi menatap layar kosong, dan itu bukan tingkatan paket melainkan bug
 * yang tampak seperti tingkatan paket.
 */
export const MODUL_TERJUAL: ReadonlyArray<{
  key: PermissionFeature;
  label: string;
  catatan: string;
}> = [
  { key: 'pos', label: 'Kasir (POS)', catatan: 'Layar transaksi dan pembayaran' },
  { key: 'tables', label: 'Manajemen Meja', catatan: 'Denah meja untuk kafe dan restoran' },
  { key: 'inventory', label: 'Inventori & Stok', catatan: 'Katalog produk, stok, dan bahan baku' },
  { key: 'customers', label: 'Member & Loyalitas', catatan: 'Data pelanggan, poin, dan tier' },
  { key: 'reports', label: 'Laporan & Analitik', catatan: 'Laporan penjualan, ekspor Excel dan PDF' },
  { key: 'ai', label: 'AI Copilot', catatan: 'Analisa dan saran berbasis data toko' },
  { key: 'settings', label: 'Pengaturan Toko', catatan: 'Profil toko, pajak, cabang' },
  { key: 'void_order', label: 'Pembatalan Transaksi', catatan: 'Membatalkan struk yang sudah tercetak' },
  { key: 'stock_adjustment', label: 'Penyesuaian Stok', catatan: 'Koreksi stok manual dengan alasan' },
  { key: 'user_management', label: 'Manajemen Staf', catatan: 'Menambah kasir dan mengatur PIN' },
  { key: 'billing_subscription', label: 'Halaman Langganan', catatan: 'Melihat tagihan dan mengubah paket' },
];

/** Modul yang selalu terbuka, berapa pun paketnya. */
export const MODUL_SELALU_TERBUKA: PermissionFeature[] = ['home', 'overview'];

export const LEVEL_DASHBOARD: ReadonlyArray<{
  key: DashboardAccessLevel;
  label: string;
  catatan: string;
}> = [
  { key: 'BASIC', label: 'Basic', catatan: 'Ringkasan penjualan harian saja' },
  { key: 'FULL', label: 'Full', catatan: 'Grafik tren, metode bayar, produk terlaris' },
  { key: 'ADVANCED', label: 'Advanced', catatan: 'Tambah laba rugi, HPP, dan margin bersih' },
];

const URUTAN_DASHBOARD: DashboardAccessLevel[] = ['BASIC', 'FULL', 'ADVANCED'];

/* -------------------------------------------------------------------------- */
/* PENEGAKAN                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Entitlement bagi merchant yang langganannya tidak diketahui — belum sinkron,
 * server sedang mati, atau memang belum pernah berlangganan.
 *
 * GAGAL TERTUTUP, tapi tidak sampai mematikan kasir. Menutup total berarti
 * gangguan jaringan di pihak kami menghentikan penjualan merchant, dan itu
 * kerugian nyata untuk melindungi pendapatan yang jauh lebih kecil. Yang
 * dibuka adalah yang membuat toko tetap bisa berjualan; yang bernilai jual
 * tetap tertutup sampai paketnya benar-benar terbaca.
 */
export const ENTITLEMENT_DARURAT: PlanEntitlements = {
  productLimit: 30,
  maxOutlets: 1,
  aiQuotaMonthly: 0,
  dashboardAccessLevel: 'BASIC',
  moduleAccess: ['pos', 'customers', 'settings'],
};

export function bolehPakaiModul(e: PlanEntitlements, modul: PermissionFeature): boolean {
  if (MODUL_SELALU_TERBUKA.includes(modul)) return true;
  return e.moduleAccess.includes(modul);
}

/** true bila paketnya mencakup level dashboard yang diminta. */
export function bolehLevelDashboard(e: PlanEntitlements, minimal: DashboardAccessLevel): boolean {
  return URUTAN_DASHBOARD.indexOf(e.dashboardAccessLevel) >= URUTAN_DASHBOARD.indexOf(minimal);
}

/**
 * Apakah produk ke-(jumlahSekarang + 1) masih boleh dibuat.
 *
 * Dipisah dari pesan galatnya supaya pemanggil bisa memakainya untuk
 * menonaktifkan tombol lebih dulu — memberi tahu batas sebelum orang mengetik
 * satu formulir penuh lebih baik daripada menolaknya sesudah.
 */
export function bolehTambahProduk(e: PlanEntitlements, jumlahSekarang: number): boolean {
  return e.productLimit === TANPA_BATAS || jumlahSekarang < e.productLimit;
}

export function bolehTambahOutlet(e: PlanEntitlements, jumlahSekarang: number): boolean {
  return jumlahSekarang < e.maxOutlets;
}

export function labelBatas(nilai: number): string {
  return nilai === TANPA_BATAS ? 'Tanpa batas' : String(nilai);
}

/* -------------------------------------------------------------------------- */
/* VALIDASI                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Aturan yang sama dipakai formulir admin dan endpoint penyimpanan.
 *
 * Database punya CHECK constraint untuk semuanya, dan itu lapisan terakhir yang
 * tidak bisa dilewati. Yang dikerjakan di sini adalah mengubah penolakan
 * Postgres yang berbunyi "violates check constraint ck_plans_product_limit"
 * menjadi kalimat yang bisa ditindaklanjuti orang yang sedang mengisi formulir.
 */
export function validasiPaket(p: Partial<AdminPlan>): string[] {
  const galat: string[] = [];

  if (!p.id || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(p.id)) {
    galat.push('Kode paket harus 3–64 karakter, huruf kecil, angka, atau tanda hubung.');
  }
  if (!p.name || p.name.trim().length < 3) {
    galat.push('Nama paket minimal 3 karakter.');
  }
  if (!Number.isInteger(p.tierLevel) || (p.tierLevel as number) < 1 || (p.tierLevel as number) > 4) {
    galat.push('Tier level harus bilangan bulat 1 sampai 4.');
  }
  if (!Number.isFinite(p.priceIdr) || (p.priceIdr as number) < 0) {
    galat.push('Harga tidak boleh negatif.');
  }
  if (p.priceYearlyIdr != null && p.priceYearlyIdr < 0) {
    galat.push('Harga tahunan tidak boleh negatif.');
  }
  if (p.extraOutletPriceIdr != null && p.extraOutletPriceIdr < 0) {
    galat.push('Harga tambahan per outlet tidak boleh negatif.');
  }
  if (p.productLimit !== TANPA_BATAS && (!Number.isInteger(p.productLimit) || (p.productLimit as number) < 1)) {
    galat.push('Batas produk harus minimal 1, atau -1 untuk tanpa batas.');
  }
  if (!Number.isInteger(p.maxOutlets) || (p.maxOutlets as number) < 1) {
    galat.push('Jumlah outlet minimal 1.');
  }
  if (!Number.isInteger(p.aiQuotaMonthly) || (p.aiQuotaMonthly as number) < 0) {
    galat.push('Kuota AI tidak boleh negatif.');
  }
  if (!p.dashboardAccessLevel || !URUTAN_DASHBOARD.includes(p.dashboardAccessLevel)) {
    galat.push('Level dashboard harus BASIC, FULL, atau ADVANCED.');
  }

  const modulSah = new Set<string>(MODUL_TERJUAL.map((m) => m.key));
  const modul = p.moduleAccess ?? [];
  const asing = modul.filter((m) => !modulSah.has(m) && !MODUL_SELALU_TERBUKA.includes(m));
  if (asing.length) {
    galat.push(`Modul tidak dikenal: ${asing.join(', ')}.`);
  }
  if (!modul.includes('pos')) {
    galat.push('Setiap paket harus membuka modul Kasir (POS) — tanpa itu paketnya bukan POS.');
  }

  // Menjual kuota AI tanpa membuka modulnya menghasilkan merchant yang membayar
  // untuk tombol yang tidak pernah muncul.
  if ((p.aiQuotaMonthly ?? 0) > 0 && !modul.includes('ai')) {
    galat.push('Kuota AI diisi tapi modul AI Copilot tidak dibuka.');
  }
  if (p.dashboardAccessLevel && p.dashboardAccessLevel !== 'BASIC' && !modul.includes('reports')) {
    galat.push('Level dashboard di atas Basic menuntut modul Laporan & Analitik dibuka.');
  }

  return galat;
}
