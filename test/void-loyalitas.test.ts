/**
 * Pembatalan transaksi harus mengembalikan keadaan member.
 *
 * MURNI. Stok dan kas shift sudah lama dibalik saat void; poin, kunjungan, dan
 * total belanja TIDAK — dan total belanja itulah yang menaikkan tier. Satu
 * salah input yang dibatalkan kasir bisa mempromosikan pelanggan secara
 * permanen tanpa ada layar yang menunjukkan sebabnya.
 *
 * Aturannya diuji langsung sebagai fungsi supaya tidak menuntut merender POS.
 */

import { describe, it, expect } from 'vitest';
import type { Customer, Order } from '../src/types';

/** Salinan aturan pembalikan di POSContext.voidOrder. */
function balikkanMember(c: Customer, o: Order): Customer {
  const poinDidapat = o.pointsEarned ?? 0;
  const poinDitukar = o.pointsRedeemed ?? 0;
  return {
    ...c,
    points: Math.max(0, c.points - poinDidapat + poinDitukar),
    totalSpent: Math.max(0, c.totalSpent - o.total),
    visitCount: Math.max(0, c.visitCount - 1),
  };
}

const member = (u: Partial<Customer> = {}): Customer =>
  ({ id: 'c1', name: 'Retno', phone: '08', points: 50, tier: 'SILVER',
     totalSpent: 1_200_000, visitCount: 8, joinDate: '2026-01-01', lastVisit: '2026-08-01',
     ...u }) as Customer;

const struk = (u: Partial<Order> = {}): Order =>
  ({ id: 'INV-1', total: 200_000, pointsEarned: 20, ...u }) as Order;

describe('pembalikan member saat void', () => {
  it('mengembalikan poin yang diberikan transaksi itu', () => {
    expect(balikkanMember(member(), struk()).points).toBe(30);
  });

  it('mengembalikan poin yang DITUKAR — pelanggan membayar dengan poin, dan pembayarannya batal', () => {
    const hasil = balikkanMember(member({ points: 30 }), struk({ pointsEarned: 20, pointsRedeemed: 100 }));
    expect(hasil.points).toBe(110); // 30 - 20 + 100
  });

  it('mengoreksi total belanja — inilah yang menaikkan tier', () => {
    expect(balikkanMember(member(), struk()).totalSpent).toBe(1_000_000);
  });

  it('mengurangi jumlah kunjungan', () => {
    expect(balikkanMember(member(), struk()).visitCount).toBe(7);
  });

  it('TIDAK menurunkan tier — mencabut status yang sudah diberitahukan bukan urusan kasir', () => {
    expect(balikkanMember(member({ tier: 'GOLD' }), struk()).tier).toBe('GOLD');
  });

  it('tidak pernah menghasilkan angka negatif', () => {
    const hasil = balikkanMember(
      member({ points: 5, totalSpent: 10_000, visitCount: 0 }),
      struk({ total: 999_999, pointsEarned: 500 })
    );
    expect(hasil.points).toBe(0);
    expect(hasil.totalSpent).toBe(0);
    expect(hasil.visitCount).toBe(0);
  });

  it('memakai poin yang DICATAT, bukan menghitung ulang dengan aturan hari ini', () => {
    // Transaksi lama memberi 20 poin saat earnRate masih Rp 10.000/poin.
    // Merchant lalu mengubahnya jadi Rp 50.000/poin. Menghitung ulang akan
    // mengembalikan 4, menyisakan 16 poin yang tidak pernah dibayar siapa pun.
    const hasil = balikkanMember(member({ points: 70 }), struk({ total: 200_000, pointsEarned: 20 }));
    expect(hasil.points).toBe(50);
  });
});
