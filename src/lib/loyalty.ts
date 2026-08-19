/**
 * Aturan poin dan tier member.
 *
 * Dipisah dari POSContext karena sejak 0012 nilainya tidak lagi berhenti di
 * layar: angka yang dihasilkan di sini ikut terkirim ke `pos.customers` dan
 * menjadi dasar laporan RFM. Dua tempat yang menghitungnya sendiri-sendiri akan
 * menghasilkan dua tier berbeda untuk orang yang sama.
 */

import type { Customer, CustomerTier, LoyaltyTier } from '../types';

/**
 * Tier bawaan — TITIK AWAL, bukan aturan tetap.
 *
 * Setiap merchant mengatur ambang dan manfaatnya sendiri lewat Pengaturan;
 * angka-angka ini hanya yang terpasang sebelum ada yang menyentuhnya. Kafe
 * dengan nota rata-rata 30 ribu dan salon dengan nota rata-rata 300 ribu tidak
 * mungkin memakai ambang yang sama.
 *
 * Diurutkan MENURUN supaya pencarian berhenti di kecocokan pertama — menambah
 * tier baru cukup menyisipkan satu baris, bukan menulis ulang rantai if/else
 * yang urutannya harus tepat agar benar.
 */
export const TIER_BAWAAN: readonly LoyaltyTier[] = [
  { tier: 'PLATINUM', minSpend: 5_000_000, discountPercent: 10 },
  { tier: 'GOLD', minSpend: 2_500_000, discountPercent: 7 },
  { tier: 'SILVER', minSpend: 1_000_000, discountPercent: 3 },
  { tier: 'BRONZE', minSpend: 0, discountPercent: 0 },
];

/**
 * Susunan tier yang benar-benar dipakai: milik merchant bila ada, bawaan bila
 * belum diatur — selalu diurutkan menurun, karena pengaturan yang diketik
 * manusia tidak dijamin urut dan `find` yang pertama cocok akan salah tier.
 */
export function tierAktif(tiers?: readonly LoyaltyTier[] | null): readonly LoyaltyTier[] {
  const daftar = tiers && tiers.length ? tiers : TIER_BAWAAN;
  return [...daftar].sort((a, b) => b.minSpend - a.minSpend);
}

export function tierForSpend(
  totalSpent: number,
  tiers?: readonly LoyaltyTier[] | null
): CustomerTier {
  return tierAktif(tiers).find((t) => totalSpent >= t.minSpend)?.tier ?? 'BRONZE';
}

/** Potongan persen yang menjadi hak sebuah tier. 0 bila tier tidak dikenali. */
export function diskonTier(
  tier: CustomerTier | undefined,
  tiers?: readonly LoyaltyTier[] | null
): number {
  if (!tier) return 0;
  const cocok = tierAktif(tiers).find((t) => t.tier === tier);
  return Math.max(0, Math.min(100, cocok?.discountPercent ?? 0));
}

/**
 * Keadaan member setelah satu transaksi selesai dibayar.
 *
 * Tier tidak pernah TURUN. Total belanja hanya bertambah, jadi dalam pemakaian
 * normal ini tidak pernah terpicu — tapi koreksi transaksi salah input bisa
 * membuatnya berkurang, dan menurunkan tier orang yang sudah terlanjur
 * diberitahu "Anda GOLD" adalah percakapan yang tidak perlu ada di depan kasir.
 */
export interface OpsiPembelian {
  /** Susunan tier toko. Kosong berarti bawaan. */
  tiers?: readonly LoyaltyTier[] | null;
  /**
   * Program loyalitas menyala. Bila mati, tier DIBEKUKAN.
   *
   * Ini tidak bisa disimpulkan dari earnRate 0: toko yang berhenti membagikan
   * poin baru tapi tetap menghormati tier adalah pengaturan yang sah, dan
   * berbeda dari toko yang mematikan programnya sama sekali. Menyimpulkannya
   * membuat member naik ke GOLD selama program mati, lalu menuntut manfaat
   * GOLD saat program dinyalakan lagi.
   */
  aktif?: boolean;
}

export function applyPurchase(
  customer: Customer,
  amount: number,
  earnRate: number,
  pointsUsed = 0,
  opsi: OpsiPembelian = {}
): Customer {
  const aktif = opsi.aktif !== false;
  const daftar = tierAktif(opsi.tiers);
  const totalSpent = customer.totalSpent + amount;
  const naik = aktif ? tierForSpend(totalSpent, daftar) : customer.tier;
  const sekarang = daftar.findIndex((t) => t.tier === customer.tier);
  const calon = daftar.findIndex((t) => t.tier === naik);

  return {
    ...customer,
    // earnRate 0 atau negatif berarti pengaturan toko belum diisi; tanpa
    // penjagaan ini hasilnya Infinity dan poin member rusak permanen.
    //
    // Poin yang ditukar dikurangi lebih dulu, lalu poin dari belanja hari ini
    // ditambahkan. Urutannya penting: menukar 100 poin lalu mendapat 4 poin
    // dari transaksi yang sama harus berakhir di saldo yang benar, bukan di
    // saldo negatif yang ditahan Math.max.
    points: Math.max(
      0,
      customer.points - Math.max(0, Math.trunc(pointsUsed))
    ) + (earnRate > 0 ? Math.floor(amount / earnRate) : 0),
    totalSpent,
    visitCount: customer.visitCount + 1,
    lastVisit: new Date().toISOString().split('T')[0],
    tier: calon < sekarang ? naik : customer.tier,
  };
}

/* -------------------------------------------------------------------------- */
/* PENUKARAN POIN                                                              */
/* -------------------------------------------------------------------------- */

export interface RincianTotal {
  /** Potongan rupiah hasil menukar poin. */
  loyaltyDiscount: number;
  /** Potongan rupiah dari manfaat tier member (persen dari subtotal). */
  tierDiscount: number;
  /** Persen manfaat tier yang dipakai — untuk ditampilkan di struk dan layar. */
  tierDiscountPercent: number;
  /** Poin yang BENAR-BENAR terpakai setelah dibatasi saldo dan nilai belanja. */
  pointsUsed: number;
  subtotalSetelahDiskon: number;
  taxTotal: number;
  serviceChargeTotal: number;
  grandTotal: number;
}

export interface MasukanTotal {
  subtotal: number;
  /** Poin yang ingin ditukar kasir. Dibatasi di dalam fungsi ini. */
  pointsToRedeem?: number;
  /** Poin yang dimiliki member. 0 bila tidak ada member. */
  availablePoints?: number;
  loyaltyRedeemRate: number;
  taxRate: number;
  serviceRate: number;
  enableTax: boolean;
  enableService: boolean;
  /**
   * Program loyalitas menyala di toko ini.
   *
   * Bila mati, poin TIDAK ditukar dan manfaat tier TIDAK diberikan — walaupun
   * membernya masih punya saldo poin dari masa program pernah aktif. Saldo itu
   * tidak dihapus, hanya tidak bisa dipakai; mematikan program lalu
   * menyalakannya lagi tidak boleh menghanguskan poin orang.
   */
  enableLoyalty?: boolean;
  /** Tier member yang sedang dilayani, bila ada. */
  customerTier?: CustomerTier;
  /** Susunan tier toko. Kosong berarti pakai bawaan. */
  loyaltyTiers?: readonly LoyaltyTier[] | null;
}

/**
 * Satu-satunya tempat total transaksi dihitung.
 *
 * Sebelumnya rumusnya ditulis dua kali — di CheckoutModal untuk ditampilkan,
 * dan di POSContext untuk disimpan. Selama keduanya kebetulan sama, tidak ada
 * yang tahu; begitu salah satunya disunting, layar menunjukkan satu angka dan
 * struk mencatat angka lain. Itu jenis selisih yang baru ketahuan saat kas
 * tidak cocok di akhir hari.
 *
 * PAJAK DIHITUNG SETELAH POTONGAN POIN. Merchant menyetorkan pajak atas uang
 * yang benar-benar diterima, bukan atas harga sebelum diskon.
 */
export function hitungTotal(m: MasukanTotal): RincianTotal {
  // Program dianggap MENYALA bila tidak disebut, supaya pemanggil lama yang
  // belum mengirim medan ini tetap berperilaku sama persis seperti sebelumnya.
  const loyalitasAktif = m.enableLoyalty !== false;

  const rate = Math.max(0, m.loyaltyRedeemRate || 0);
  const tersedia = loyalitasAktif ? Math.max(0, Math.trunc(m.availablePoints ?? 0)) : 0;
  const diminta = loyalitasAktif ? Math.max(0, Math.trunc(m.pointsToRedeem ?? 0)) : 0;

  // MANFAAT TIER DIHITUNG LEBIH DULU, dan poin ditukar atas sisa setelahnya.
  // Urutan sebaliknya membuat member tier atas mendapat potongan persen dari
  // angka yang sudah dipotong poinnya sendiri — ia justru dihukum karena
  // menukar poin.
  const tierDiscountPercent = loyalitasAktif ? diskonTier(m.customerTier, m.loyaltyTiers) : 0;
  const tierDiscount = Math.round((m.subtotal * tierDiscountPercent) / 100);
  const setelahTier = Math.max(0, m.subtotal - tierDiscount);

  // Dibatasi tiga hal sekaligus: poin yang diminta, poin yang dimiliki, dan
  // nilai belanjanya sendiri. Tanpa batas ketiga, menukar poin berlebih
  // menghasilkan total negatif — dan kasir menyerahkan uang kepada pelanggan.
  const maksDariBelanja = rate > 0 ? Math.floor(setelahTier / rate) : 0;
  const pointsUsed = Math.min(diminta, tersedia, maksDariBelanja);
  const loyaltyDiscount = pointsUsed * rate;

  const subtotalSetelahDiskon = Math.max(0, setelahTier - loyaltyDiscount);
  const taxTotal = m.enableTax ? Math.round((subtotalSetelahDiskon * m.taxRate) / 100) : 0;
  const serviceChargeTotal = m.enableService
    ? Math.round((subtotalSetelahDiskon * m.serviceRate) / 100)
    : 0;

  return {
    loyaltyDiscount,
    tierDiscount,
    tierDiscountPercent,
    pointsUsed,
    subtotalSetelahDiskon,
    taxTotal,
    serviceChargeTotal,
    grandTotal: subtotalSetelahDiskon + taxTotal + serviceChargeTotal,
  };
}
