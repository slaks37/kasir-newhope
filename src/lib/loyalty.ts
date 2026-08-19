/**
 * Aturan poin dan tier member.
 *
 * Dipisah dari POSContext karena sejak 0012 nilainya tidak lagi berhenti di
 * layar: angka yang dihasilkan di sini ikut terkirim ke `pos.customers` dan
 * menjadi dasar laporan RFM. Dua tempat yang menghitungnya sendiri-sendiri akan
 * menghasilkan dua tier berbeda untuk orang yang sama.
 */

import type { Customer, CustomerTier } from '../types';

/**
 * Ambang tier, dari yang tertinggi.
 *
 * Diurutkan menurun supaya pencarian berhenti di kecocokan pertama — menambah
 * tier baru cukup menyisipkan satu baris, bukan menulis ulang rantai if/else
 * yang urutannya harus tepat agar benar.
 */
export const TIER_THRESHOLDS: ReadonlyArray<readonly [CustomerTier, number]> = [
  ['PLATINUM', 5_000_000],
  ['GOLD', 2_500_000],
  ['SILVER', 1_000_000],
  ['BRONZE', 0],
];

export function tierForSpend(totalSpent: number): CustomerTier {
  return TIER_THRESHOLDS.find(([, minimum]) => totalSpent >= minimum)?.[0] ?? 'BRONZE';
}

/**
 * Keadaan member setelah satu transaksi selesai dibayar.
 *
 * Tier tidak pernah TURUN. Total belanja hanya bertambah, jadi dalam pemakaian
 * normal ini tidak pernah terpicu — tapi koreksi transaksi salah input bisa
 * membuatnya berkurang, dan menurunkan tier orang yang sudah terlanjur
 * diberitahu "Anda GOLD" adalah percakapan yang tidak perlu ada di depan kasir.
 */
export function applyPurchase(
  customer: Customer,
  amount: number,
  earnRate: number,
  pointsUsed = 0
): Customer {
  const totalSpent = customer.totalSpent + amount;
  const naik = tierForSpend(totalSpent);
  const sekarang = TIER_THRESHOLDS.findIndex(([t]) => t === customer.tier);
  const calon = TIER_THRESHOLDS.findIndex(([t]) => t === naik);

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
  const rate = Math.max(0, m.loyaltyRedeemRate || 0);
  const tersedia = Math.max(0, Math.trunc(m.availablePoints ?? 0));
  const diminta = Math.max(0, Math.trunc(m.pointsToRedeem ?? 0));

  // Dibatasi tiga hal sekaligus: poin yang diminta, poin yang dimiliki, dan
  // nilai belanjanya sendiri. Tanpa batas ketiga, menukar poin berlebih
  // menghasilkan total negatif — dan kasir menyerahkan uang kepada pelanggan.
  const maksDariBelanja = rate > 0 ? Math.floor(m.subtotal / rate) : 0;
  const pointsUsed = Math.min(diminta, tersedia, maksDariBelanja);
  const loyaltyDiscount = pointsUsed * rate;

  const subtotalSetelahDiskon = Math.max(0, m.subtotal - loyaltyDiscount);
  const taxTotal = m.enableTax ? Math.round((subtotalSetelahDiskon * m.taxRate) / 100) : 0;
  const serviceChargeTotal = m.enableService
    ? Math.round((subtotalSetelahDiskon * m.serviceRate) / 100)
    : 0;

  return {
    loyaltyDiscount,
    pointsUsed,
    subtotalSetelahDiskon,
    taxTotal,
    serviceChargeTotal,
    grandTotal: subtotalSetelahDiskon + taxTotal + serviceChargeTotal,
  };
}
