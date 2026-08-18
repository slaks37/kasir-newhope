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
export function applyPurchase(customer: Customer, amount: number, earnRate: number): Customer {
  const totalSpent = customer.totalSpent + amount;
  const naik = tierForSpend(totalSpent);
  const sekarang = TIER_THRESHOLDS.findIndex(([t]) => t === customer.tier);
  const calon = TIER_THRESHOLDS.findIndex(([t]) => t === naik);

  return {
    ...customer,
    // earnRate 0 atau negatif berarti pengaturan toko belum diisi; tanpa
    // penjagaan ini hasilnya Infinity dan poin member rusak permanen.
    points: customer.points + (earnRate > 0 ? Math.floor(amount / earnRate) : 0),
    totalSpent,
    visitCount: customer.visitCount + 1,
    lastVisit: new Date().toISOString().split('T')[0],
    tier: calon < sekarang ? naik : customer.tier,
  };
}
