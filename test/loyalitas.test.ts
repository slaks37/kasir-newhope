/**
 * Aturan poin, tier, dan total transaksi.
 *
 * MURNI — tanpa database, tanpa jaringan. Selalu jalan, termasuk di mesin yang
 * belum pernah menyiapkan Postgres. Yang dijaga di sini adalah uang yang
 * berpindah di depan kasir; kekeliruan satu baris di antaranya baru ketahuan
 * saat kas tidak cocok di akhir hari.
 */

import { describe, it, expect } from 'vitest';
import {
  hitungTotal, applyPurchase, tierForSpend, diskonTier, tierAktif, TIER_BAWAAN,
} from '../src/lib/loyalty';
import type { Customer, LoyaltyTier } from '../src/types';

const DASAR = {
  loyaltyRedeemRate: 100,
  taxRate: 10,
  serviceRate: 5,
  enableTax: true,
  enableService: true,
};

const member = (ubah: Partial<Customer> = {}): Customer =>
  ({
    id: 'c1', name: 'Budi', phone: '08', points: 40, tier: 'BRONZE',
    totalSpent: 900_000, visitCount: 3, joinDate: '2026-01-01', lastVisit: '2026-08-01',
    ...ubah,
  }) as Customer;

describe('program loyalitas dimatikan merchant', () => {
  it('tidak menukar poin dan tidak memberi manfaat tier', () => {
    const h = hitungTotal({
      ...DASAR, subtotal: 100_000, pointsToRedeem: 500,
      availablePoints: 500, enableLoyalty: false, customerTier: 'PLATINUM',
    });
    expect(h.pointsUsed).toBe(0);
    expect(h.tierDiscount).toBe(0);
    expect(h.grandTotal).toBe(115_000);
  });

  it('MEMBEKUKAN tier — tanpa ini member naik diam-diam lalu menuntut manfaatnya', () => {
    const setelah = applyPurchase(member(), 200_000, 0, 0, { aktif: false });
    expect(setelah.points).toBe(40);
    expect(setelah.tier).toBe('BRONZE');
    // Belanjanya TETAP tercatat, jadi menyalakan program lagi langsung
    // menempatkan member di tier yang semestinya.
    expect(setelah.totalSpent).toBe(1_100_000);
    expect(applyPurchase(setelah, 0, 10_000, 0, { tiers: TIER_BAWAAN }).tier).toBe('SILVER');
  });
});

describe('urutan potongan', () => {
  it('tier dulu, baru poin, baru pajak', () => {
    const h = hitungTotal({
      ...DASAR, subtotal: 100_000, pointsToRedeem: 500,
      availablePoints: 500, enableLoyalty: true, customerTier: 'PLATINUM',
    });
    expect(h.tierDiscount).toBe(10_000);      // 10% dari 100rb
    expect(h.loyaltyDiscount).toBe(50_000);   // 500 poin x 100
    expect(h.subtotalSetelahDiskon).toBe(40_000);
    expect(h.taxTotal).toBe(4_000);           // pajak atas uang yang BENAR diterima
    expect(h.grandTotal).toBe(46_000);
  });
});

describe('batas penukaran poin', () => {
  it('tidak pernah menghasilkan total negatif', () => {
    const h = hitungTotal({
      ...DASAR, subtotal: 10_000, pointsToRedeem: 99_999,
      availablePoints: 99_999, enableLoyalty: true, customerTier: 'BRONZE',
    });
    expect(h.grandTotal).toBeGreaterThanOrEqual(0);
    expect(h.pointsUsed).toBe(100);
  });

  it('dibatasi saldo yang benar-benar dimiliki', () => {
    const h = hitungTotal({
      ...DASAR, subtotal: 1_000_000, pointsToRedeem: 500, availablePoints: 40,
    });
    expect(h.pointsUsed).toBe(40);
  });

  it('earnRate 0 tidak menghasilkan Infinity poin', () => {
    expect(applyPurchase(member(), 100_000, 0).points).toBe(40);
  });
});

describe('tier yang diatur merchant', () => {
  const tokoSendiri: LoyaltyTier[] = [
    { tier: 'PLATINUM', minSpend: 500_000, discountPercent: 20 },
    { tier: 'BRONZE', minSpend: 0, discountPercent: 0 },
  ];

  it('memakai ambang toko, bukan bawaan', () => {
    expect(tierForSpend(600_000, tokoSendiri)).toBe('PLATINUM');
    expect(tierForSpend(600_000)).toBe('BRONZE');
  });

  it('memakai manfaat toko, bukan bawaan', () => {
    expect(diskonTier('PLATINUM', tokoSendiri)).toBe(20);
    expect(diskonTier('PLATINUM')).toBe(10);
  });

  it('urutan yang diketik manusia tidak harus urut', () => {
    const acak: LoyaltyTier[] = [
      { tier: 'BRONZE', minSpend: 0, discountPercent: 0 },
      { tier: 'PLATINUM', minSpend: 5_000_000, discountPercent: 10 },
      { tier: 'SILVER', minSpend: 1_000_000, discountPercent: 3 },
    ];
    expect(tierForSpend(1_500_000, acak)).toBe('SILVER');
    expect(tierAktif(acak)[0].tier).toBe('PLATINUM');
  });
});

describe('tier tidak pernah turun', () => {
  it('koreksi transaksi salah input tidak menurunkan member', () => {
    const gold = member({ tier: 'GOLD', totalSpent: 2_600_000 });
    expect(applyPurchase(gold, -2_000_000, 10_000).tier).toBe('GOLD');
  });
});

describe('menukar poin lalu mendapat poin baru pada transaksi yang sama', () => {
  it('berakhir di saldo yang benar, bukan nol', () => {
    expect(applyPurchase(member(), 100_000, 10_000, 40).points).toBe(10);
  });
});
