/**
 * Fikstur untuk regresi AI Copilot.
 *
 * KENAPA BERKAS INI ADA. Suite di `scripts/dev/smoke-assistant.ts` dulu memakai
 * `INITIAL_*` dari `src/data/initialData.ts` — data contoh yang ikut dikirim ke
 * aplikasi merchant. Ketika data contoh itu dikosongkan (benar: merchant baru
 * tidak boleh menemukan transaksi orang lain di tokonya), enam konstanta menjadi
 * `[]` sekaligus dan suite-nya berhenti di baris pertama yang mengambil
 * `INITIAL_HISTORICAL_ORDERS[0]`:
 *
 *   TypeError: Cannot read properties of undefined (reading 'items')
 *
 * Regresi 47 intent yang dikutip README dan docs/smart-assistant-architecture.md
 * karenanya TIDAK PERNAH berjalan lagi — dan tidak ada yang memberi tahu, karena
 * tidak ada CI yang menjalankannya.
 *
 * Pelajarannya: fikstur uji adalah milik UJINYA. Data contoh aplikasi melayani
 * pengguna dan boleh berubah kapan saja; ekspektasi sebuah suite tidak boleh
 * ikut berubah diam-diam bersamanya.
 *
 * BENTUK DATANYA sengaja mendekati sebuah kafe sungguhan selama ±5 minggu:
 * beberapa produk dengan margin berbeda, pelanggan yang berulang dan yang
 * menghilang, jam ramai yang nyata, dan stok yang sebagian menipis. Angka yang
 * rata membuat setiap algoritma Layer 1 mengembalikan "tidak ada temuan", dan
 * suite yang tidak menemukan apa pun tidak menguji apa pun.
 */

import type {
  AttendanceRecord,
  CartItem,
  Customer,
  Order,
  PromoCode,
  StaffMember,
  StockItem,
} from '../../../src/types';

/** Titik acuan waktu. Sama dengan NOW di smoke-assistant.ts. */
export const FIXTURE_NOW = new Date('2026-08-11T15:00:00');

const HARI = 86_400_000;

/** Katalog kecil dengan margin yang sengaja berbeda-beda. */
const KATALOG = [
  { id: 'p-kopi-susu', nama: 'Kopi Susu Gula Aren', harga: 22000, hpp: 8000 },
  { id: 'p-americano', nama: 'Americano', harga: 18000, hpp: 5000 },
  { id: 'p-croissant', nama: 'Croissant Butter', harga: 25000, hpp: 12000 },
  { id: 'p-nasi-ayam', nama: 'Nasi Ayam Rica', harga: 35000, hpp: 19000 },
  // Margin tipis — bahan uji untuk analisa profitabilitas.
  { id: 'p-air-mineral', nama: 'Air Mineral', harga: 6000, hpp: 4500 },
] as const;

export const FIXTURE_CUSTOMERS: Customer[] = [
  {
    id: 'c-sinta',
    name: 'Sinta Dewi',
    phone: '081200000001',
    points: 480,
    tier: 'GOLD',
    totalSpent: 1_240_000,
    visitCount: 26,
    lastVisit: new Date(FIXTURE_NOW.getTime() - 1 * HARI).toISOString(),
  },
  {
    id: 'c-bagus',
    name: 'Bagus Pratama',
    phone: '081200000002',
    points: 150,
    tier: 'SILVER',
    totalSpent: 420_000,
    visitCount: 11,
    lastVisit: new Date(FIXTURE_NOW.getTime() - 3 * HARI).toISOString(),
  },
  {
    // Sengaja lama tidak datang — bahan uji deteksi pelanggan hilang.
    id: 'c-rani',
    name: 'Rani Kusuma',
    phone: '081200000003',
    points: 60,
    tier: 'BRONZE',
    totalSpent: 180_000,
    visitCount: 4,
    lastVisit: new Date(FIXTURE_NOW.getTime() - 41 * HARI).toISOString(),
  },
];

/**
 * Staf untuk KELIMA sektor, bukan hanya FNB.
 *
 * Suite memeriksa bahwa tiap sektor punya minimal satu petugas: tanpa itu layar
 * "Pilih Petugas" menjadi jalan buntu, karena aplikasi belum punya layar tambah
 * staf. Fikstur yang hanya berisi FNB akan melaporkan empat sektor rusak —
 * padahal yang rusak fiksturnya.
 *
 * Sebutan jabatannya mengikuti istilah sektornya masing-masing (kapster, bukan
 * "staf 3"), karena beberapa jawaban Copilot mengutipnya apa adanya.
 */
export const FIXTURE_STAFF: StaffMember[] = [
  { id: 's-budi', name: 'Budi Santoso', role: 'Barista', sector: 'FNB', isAvailable: true },
  { id: 's-rina', name: 'Rina Melati', role: 'Kasir', sector: 'FNB', isAvailable: true },
  { id: 's-agus', name: 'Agus Wibowo', role: 'Kasir', sector: 'FNB', isAvailable: false },

  { id: 's-sari', name: 'Sari Utami', role: 'Operator Cuci', sector: 'LAUNDRY', isAvailable: true },
  { id: 's-joko', name: 'Joko Susilo', role: 'Kasir', sector: 'LAUNDRY', isAvailable: true },

  { id: 's-dewi', name: 'Dewi Anggraini', role: 'Pramuniaga', sector: 'RETAIL', isAvailable: true },
  { id: 's-eko', name: 'Eko Prasetyo', role: 'Kasir', sector: 'RETAIL', isAvailable: true },

  { id: 's-tono', name: 'Tono Hermawan', role: 'Teknisi Cuci', sector: 'CARWASH', isAvailable: true },
  { id: 's-yudi', name: 'Yudi Saputra', role: 'Kasir', sector: 'CARWASH', isAvailable: false },

  { id: 's-hendra', name: 'Hendra Gunawan', role: 'Kapster', sector: 'BARBERSHOP', isAvailable: true },
  { id: 's-fajar', name: 'Fajar Nugroho', role: 'Kapster', sector: 'BARBERSHOP', isAvailable: true },
];

export const FIXTURE_ATTENDANCE: AttendanceRecord[] = [
  {
    id: 'att-1',
    staffId: 's-budi',
    staffName: 'Budi Santoso',
    staffRole: 'Barista',
    clockInTime: new Date(FIXTURE_NOW.getTime() - 7 * 3_600_000).toISOString(),
    status: 'CLOCKED_IN',
    businessSector: 'FNB',
  },
  {
    id: 'att-2',
    staffId: 's-rina',
    staffName: 'Rina Melati',
    staffRole: 'Kasir',
    clockInTime: new Date(FIXTURE_NOW.getTime() - 8 * 3_600_000).toISOString(),
    clockOutTime: new Date(FIXTURE_NOW.getTime() - 1 * 3_600_000).toISOString(),
    status: 'CLOCKED_OUT',
    businessSector: 'FNB',
  },
];

export const FIXTURE_STOCK: StockItem[] = [
  {
    id: 'st-biji-kopi',
    sku: 'BK-001',
    name: 'Biji Kopi Arabika',
    type: 'BAHAN_BAKU',
    categoryId: 'cat-bahan',
    categoryName: 'Bahan Baku',
    stock: 2.5,
    minStockAlert: 5,
    unit: 'kg',
    costPrice: 180_000,
    location: 'Gudang',
    businessSector: 'FNB',
  },
  {
    // Menipis juga — dua item kritis membuktikan daftarnya diurutkan, bukan
    // sekadar menemukan satu.
    id: 'st-susu',
    sku: 'SU-001',
    name: 'Susu UHT Full Cream',
    type: 'BAHAN_BAKU',
    categoryId: 'cat-bahan',
    categoryName: 'Bahan Baku',
    stock: 4,
    minStockAlert: 12,
    unit: 'liter',
    costPrice: 18_000,
    location: 'Kulkas',
    businessSector: 'FNB',
  },
  {
    id: 'st-gula-aren',
    sku: 'GA-001',
    name: 'Gula Aren Cair',
    type: 'BAHAN_BAKU',
    categoryId: 'cat-bahan',
    categoryName: 'Bahan Baku',
    stock: 20,
    minStockAlert: 6,
    unit: 'liter',
    costPrice: 45_000,
    location: 'Gudang',
    businessSector: 'FNB',
  },
];

export const FIXTURE_PROMOS: PromoCode[] = [
  {
    code: 'HEMAT10',
    discountPercent: 10,
    maxDiscountAmount: 15_000,
    minPurchaseAmount: 50_000,
    isActive: true,
    createdAt: new Date(FIXTURE_NOW.getTime() - 30 * HARI).toISOString(),
  },
  {
    code: 'LEBARAN25',
    discountPercent: 25,
    maxDiscountAmount: 40_000,
    isActive: false,
    createdAt: new Date(FIXTURE_NOW.getTime() - 120 * HARI).toISOString(),
  },
];

function baris(produk: (typeof KATALOG)[number], qty: number, urutan: number): CartItem {
  return {
    id: `line-${urutan}`,
    productId: produk.id,
    name: produk.nama,
    selectedModifiers: [],
    unitPrice: produk.harga,
    unitCost: produk.hpp,
    quantity: qty,
    discountPercent: 0,
    discountAmount: 0,
    totalPrice: produk.harga * qty,
  };
}

/**
 * 35 hari transaksi.
 *
 * Pola yang sengaja dibuat, masing-masing menguji satu algoritma Layer 1:
 *
 *   · jam ramai   — 08:00-10:00 dan 15:00-17:00 lebih padat daripada siang
 *   · akhir pekan — Sabtu dan Minggu bernilai lebih besar
 *   · pelanggan   — Sinta berulang, Rani berhenti sejak hari ke-41
 *   · produk      — Kopi Susu mendominasi, Air Mineral bermargin tipis
 *   · void        — satu transaksi dibatalkan, harus keluar dari omzet
 */
export function fixtureOrders(): Order[] {
  const out: Order[] = [];
  let nomor = 0;

  for (let hariLalu = 34; hariLalu >= 0; hariLalu--) {
    const tanggal = new Date(FIXTURE_NOW.getTime() - hariLalu * HARI);
    const akhirPekan = tanggal.getDay() === 0 || tanggal.getDay() === 6;
    const jumlahOrder = akhirPekan ? 6 : 4;

    for (let i = 0; i < jumlahOrder; i++) {
      // Dua puncak: pagi dan sore.
      const jam = i % 2 === 0 ? 8 + (i % 3) : 15 + (i % 3);
      const waktu = new Date(tanggal);
      waktu.setHours(jam, (i * 13) % 60, 0, 0);

      const utama = KATALOG[i % KATALOG.length];
      const qty = akhirPekan ? 2 : 1;
      const items = [baris(utama, qty, nomor)];

      // Sebagian transaksi membawa item kedua — bahan uji analisa cross-sell.
      if (i % 3 === 0) {
        items.push(baris(KATALOG[(i + 2) % KATALOG.length], 1, nomor + 1000));
      }

      const subtotal = items.reduce((s, x) => s + x.totalPrice, 0);
      const pajak = Math.round(subtotal * 0.1);
      const total = subtotal + pajak;

      // Sinta berulang; Bagus sesekali; Rani hanya di awal periode.
      const pelanggan =
        i === 0 ? FIXTURE_CUSTOMERS[0] : i === 2 ? FIXTURE_CUSTOMERS[1] : hariLalu > 30 ? FIXTURE_CUSTOMERS[2] : undefined;

      nomor++;
      out.push({
        id: `INV-F-${String(nomor).padStart(4, '0')}`,
        orderNumber: nomor,
        date: waktu.toISOString(),
        items,
        orderType: i % 4 === 0 ? 'TAKEAWAY' : 'DINE_IN',
        customer: pelanggan,
        servedByStaffId: i % 2 === 0 ? 's-budi' : 's-rina',
        servedByStaffName: i % 2 === 0 ? 'Budi Santoso' : 'Rina Melati',
        subtotal,
        discountTotal: 0,
        taxTotal: pajak,
        serviceChargeTotal: 0,
        total,
        paymentMethod: i % 3 === 0 ? 'QRIS' : 'CASH',
        paymentStatus: 'PAID',
        cashierName: i % 2 === 0 ? 'Budi Santoso' : 'Rina Melati',
        shiftId: `shift-${hariLalu}`,
        status: 'COMPLETED',
      });
    }
  }

  // Satu transaksi dibatalkan. Omzet dan laporan produk harus mengabaikannya —
  // dan itu justru yang paling mudah salah saat rumusnya diubah.
  if (out.length > 5) {
    out[5] = { ...out[5], status: 'VOID', paymentStatus: 'CANCELLED', voidReason: 'Salah input kasir' };
  }

  return out;
}

/** Dipakai sebagai basis oleh pembangun order lain di suite. */
export const FIXTURE_ORDERS: Order[] = fixtureOrders();
