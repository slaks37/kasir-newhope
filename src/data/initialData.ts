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

/**
 * Pengaturan awal toko yang BARU LAHIR.
 *
 * Seluruh identitas toko dikosongkan. Sebelumnya berisi 'New Hope POS',
 * 'Jl. Utama Resto No. 123', dan nomor telepon '081234567890' — dan karena
 * struk mencetak ketiganya, setiap toko yang belum sempat membuka layar
 * Pengaturan memberi pelanggannya struk beralamat kantor kami.
 *
 * Kosong lebih jujur daripada terisi salah: layar Pengaturan bisa menandai
 * yang kosong sebagai "belum diisi", tapi tidak punya cara mengetahui bahwa
 * 'Jl. Utama Resto No. 123' bukan alamat toko ini.
 */
export const INITIAL_SETTINGS: StoreSettings = {
  storeName: '',
  tagline: '',
  address: '',
  phone: '',
  taxRate: 0,
  enableTax: false,
  serviceRate: 0,
  enableService: false,
  currencySymbol: 'Rp',
  // Kepala struk dibiarkan kosong: yang dicetak di atas struk adalah nama dan
  // alamat toko, dan keduanya diisi pemiliknya sendiri. Kaki struk boleh
  // berupa ucapan umum — tidak ada yang bisa salah dari "terima kasih".
  receiptHeader: '',
  receiptFooter: 'Terima kasih atas kunjungan Anda',
  storeMode: 'FNB',
  autoPrintReceipt: false,
  // Menyala secara bawaan: toko yang tidak memakainya cukup mematikannya di
  // Pengaturan, dan yang memakainya tidak perlu menyalakan apa pun dulu.
  enableLoyalty: true,
  loyaltyEarnRate: 10000,
  loyaltyRedeemRate: 100,
  loyaltyTiers: [...TIER_BAWAAN],
  branches: INITIAL_BRANCHES,
  // TIDAK menunjuk cabang mana pun. Dulu berisi 'branch-senayan' — id cabang
  // contoh yang sudah tidak ada, sehingga setiap pencarian cabang aktif
  // mengembalikan undefined dan geofence absensi diam-diam tidak menemukan
  // titik pembanding apa pun.
  activeBranchId: undefined,
  geofenceEnforcement: 'FLEXIBLE',
};

/**
 * Shift awal: TIDAK ADA SHIFT.
 *
 * INILAH SUMBER "OMZET" YANG MUNCUL DI TOKO YANG BELUM PERNAH MENJUAL APA PUN.
 * Nilai sebelumnya bukan nol melainkan sebuah shift lengkap milik "Budi
 * Santoso" berisi omzet Rp 2.800.000 — Rp 780.000 tunai, Rp 1.250.000 QRIS,
 * Rp 450.000 kartu, Rp 320.000 e-wallet — dengan modal awal Rp 500.000.
 *
 * Header membaca `shift.totalSales` dan mencetaknya apa adanya, jadi pemilik
 * yang baru mendaftar membuka aplikasi dan langsung melihat omzet Rp 2,8 juta
 * atas nama kasir yang tidak pernah ia pekerjakan. Angka itu juga masuk ke
 * `expectedCash`, sehingga tutup kas pertama akan melaporkan selisih Rp 1,28
 * juta terhadap laci yang sebenarnya kosong.
 *
 * Statusnya CLOSED, bukan OPEN. Toko yang belum pernah dibuka siapa pun tidak
 * sedang berada di tengah shift, dan layar "Mulai Shift" memang yang
 * seharusnya muncul pertama kali.
 */
export const INITIAL_SHIFT: Shift = {
  id: '',
  cashierName: '',
  startTime: '',
  initialCash: 0,
  cashSales: 0,
  qrisSales: 0,
  cardSales: 0,
  eWalletSales: 0,
  totalSales: 0,
  expectedCash: 0,
  totalOrders: 0,
  status: 'CLOSED',
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


