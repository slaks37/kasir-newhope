import { Category, Product, Table, Customer, StoreSettings, Order, Shift, User, PromoCode, StaffMember, StockItem, AttendanceRecord, StoreBranch, ProductBundle } from '../types';
import { TIER_BAWAAN } from '../lib/loyalty';

/** Kategori. Lahir bersama produk pertamanya. */
export const INITIAL_CATEGORIES: Category[] = [];

/** Katalog. Diisi pemilik, atau lewat impor foto menu / CSV. */
export const INITIAL_PRODUCTS: Product[] = [];

/** Meja / bay / rak / kursi. Ditata pemilik sesuai tempatnya. */
export const INITIAL_TABLES: Table[] = [];

/** Member toko. Tumbuh dari transaksi sungguhan. */
export const INITIAL_CUSTOMERS: Customer[] = [];

/** Cabang. Cabang pertama dibuat dari nama toko saat pendaftaran. */
export const INITIAL_BRANCHES: StoreBranch[] = [];

export const INITIAL_SETTINGS: StoreSettings = {
  storeName: 'New Hope POS',
  tagline: 'KASIR & RESTO',
  address: 'Jl. Utama Resto No. 123',
  phone: '081234567890',
  taxRate: 0,
  enableTax: false,
  serviceRate: 0,
  enableService: false,
  currencySymbol: 'Rp',
  receiptHeader: 'New Hope POS - KASIR & RESTO\nTerima Kasih Atas Kunjungan Anda!',
  receiptFooter: 'Semoga Harimu Menyenangkan!',
  storeMode: 'FNB',
  autoPrintReceipt: false,
  // Menyala secara bawaan: toko yang tidak memakainya cukup mematikannya di
  // Pengaturan, dan yang memakainya tidak perlu menyalakan apa pun dulu.
  enableLoyalty: true,
  loyaltyEarnRate: 10000,
  loyaltyRedeemRate: 100,
  loyaltyTiers: [...TIER_BAWAAN],
  branches: INITIAL_BRANCHES,
  activeBranchId: 'branch-senayan',
  geofenceEnforcement: 'FLEXIBLE',
};

export const INITIAL_SHIFT: Shift = {
  id: 'shift-001',
  cashierName: 'Budi Santoso',
  startTime: '2026-08-10T08:00:00',
  initialCash: 500000,
  cashSales: 780000,
  qrisSales: 1250000,
  cardSales: 450000,
  eWalletSales: 320000,
  totalSales: 2800000,
  expectedCash: 1280000, // initial 500k + cash sales 780k
  status: 'OPEN',
};

/** Riwayat penjualan. Toko baru belum menjual apa pun — angka omzet palsu di layar pemilik lebih buruk daripada layar kosong. */
export const INITIAL_HISTORICAL_ORDERS: Order[] = [];

/** Akun staf kasir. Pemiliknya sendiri yang menjadi ADMIN pertama, dibentuk dari akun yang mendaftar — bukan dari "Budi Santoso" dengan PIN 1234. */
export const INITIAL_USERS: User[] = [];

/**
 * Membentuk pemilik toko sebagai ADMIN pertama.
 *
 * Menggantikan INITIAL_USERS[0], yang dulu berisi akun contoh bernama "Budi
 * Santoso" ber-PIN 1234 — dipakai SETIAP toko baru, dan karena itu PIN yang
 * sama berlaku di semua toko yang belum pernah menggantinya.
 *
 * PIN sengaja KOSONG. Pemilik memasangnya sendiri di Kelola Staf; PIN bawaan
 * yang sama untuk semua orang bukan pengamanan, hanya penundaan.
 */
export function buatPemilik(akun: { id: string; email?: string; nama?: string }): User {
  const nama = akun.nama?.trim() || akun.email?.split('@')[0] || 'Pemilik Toko';
  return {
    id: akun.id,
    name: nama,
    username: (akun.email || nama).toLowerCase().replace(/\s+/g, '.').slice(0, 50),
    role: 'ADMIN',
    pin: '',
    email: akun.email || '',
    phone: '',
    status: 'ACTIVE',
    createdAt: new Date().toISOString().slice(0, 10),
  } as User;
}



/** Kode promo. Dibuat pemilik lewat halaman Pengaturan. */
export const INITIAL_PROMO_CODES: PromoCode[] = [];

/** Daftar karyawan. Diisi pemilik lewat Kelola Staf. */
export const INITIAL_STAFF_MEMBERS: StaffMember[] = [];

/** Absensi. Lahir dari kehadiran sungguhan. */
export const INITIAL_ATTENDANCE_LOGS: AttendanceRecord[] = [];

/** Bahan baku. Diisi pemilik atau lewat impor. */
export const INITIAL_STOCK_ITEMS: StockItem[] = [];

/** Paket bundling. Dirakit pemilik dari produknya sendiri. */
export const INITIAL_BUNDLES: ProductBundle[] = [];


