/**
 * Pembatasan paket dan aturan kedaluwarsa.
 *
 * MURNI. Angka paket sungguhan diuji terpisah di batas-db.test.ts; yang dijaga
 * di sini adalah aturannya sendiri — perilaku di batas persis, bukan di
 * tengah-tengah yang selalu benar.
 */

import { describe, it, expect } from 'vitest';
import {
  bolehTambahProduk, bolehTambahOutlet, bolehPakaiModul, bolehLevelDashboard,
  validasiPaket, ENTITLEMENT_DARURAT, TANPA_BATAS, MODUL_SELALU_TERBUKA,
  type PlanEntitlements,
} from '../src/lib/plans/entitlements';
import {
  statusEfektif, langgananAktif, dalamTenggang, sisaHari, GRACE_DAYS, HARI_MS,
} from '../src/lib/plans/expiry';

const paket = (u: Partial<PlanEntitlements> = {}): PlanEntitlements => ({
  productLimit: 30, maxOutlets: 1, aiQuotaMonthly: 3,
  dashboardAccessLevel: 'BASIC', moduleAccess: ['pos', 'customers', 'settings'],
  ...u,
});

describe('batas produk', () => {
  it('menolak tepat di batas, bukan sesudahnya', () => {
    const p = paket({ productLimit: 30 });
    expect(bolehTambahProduk(p, 29)).toBe(true);
    expect(bolehTambahProduk(p, 30)).toBe(false);
  });

  it('merchant yang sudah melewati batas tetap ditolak', () => {
    expect(bolehTambahProduk(paket({ productLimit: 30 }), 500)).toBe(false);
  });

  it('-1 berarti tanpa batas', () => {
    expect(bolehTambahProduk(paket({ productLimit: TANPA_BATAS }), 10_000)).toBe(true);
  });
});

describe('batas outlet', () => {
  it('menolak tepat di batas', () => {
    const p = paket({ maxOutlets: 2 });
    expect(bolehTambahOutlet(p, 1)).toBe(true);
    expect(bolehTambahOutlet(p, 2)).toBe(false);
  });
});

describe('akses modul', () => {
  it('home dan overview selalu terbuka — paket tanpa keduanya bukan tingkatan, tapi bug', () => {
    const p = paket({ moduleAccess: [] });
    for (const m of MODUL_SELALU_TERBUKA) expect(bolehPakaiModul(p, m)).toBe(true);
  });

  it('modul yang tidak dijual paket tertutup', () => {
    const p = paket({ moduleAccess: ['pos'] });
    expect(bolehPakaiModul(p, 'pos')).toBe(true);
    expect(bolehPakaiModul(p, 'reports')).toBe(false);
  });
});

describe('level dashboard', () => {
  it('bertingkat, bukan sekadar cocok', () => {
    const advanced = paket({ dashboardAccessLevel: 'ADVANCED' });
    expect(bolehLevelDashboard(advanced, 'BASIC')).toBe(true);
    expect(bolehLevelDashboard(advanced, 'ADVANCED')).toBe(true);

    const full = paket({ dashboardAccessLevel: 'FULL' });
    expect(bolehLevelDashboard(full, 'FULL')).toBe(true);
    expect(bolehLevelDashboard(full, 'ADVANCED')).toBe(false);
  });
});

describe('entitlement darurat (langganan tidak terbaca)', () => {
  it('tetap bisa berjualan — gangguan jaringan kami tidak menghentikan kasir', () => {
    expect(bolehPakaiModul(ENTITLEMENT_DARURAT, 'pos')).toBe(true);
  });

  it('tapi tidak membagikan fitur berbayar', () => {
    expect(bolehPakaiModul(ENTITLEMENT_DARURAT, 'reports')).toBe(false);
    expect(bolehPakaiModul(ENTITLEMENT_DARURAT, 'ai')).toBe(false);
    expect(ENTITLEMENT_DARURAT.aiQuotaMonthly).toBe(0);
    expect(bolehTambahOutlet(ENTITLEMENT_DARURAT, 1)).toBe(false);
  });
});

describe('validasi paket di panel admin', () => {
  const sah = {
    id: 'plan-uji', name: 'Uji', tierLevel: 2, priceIdr: 50_000,
    productLimit: 50, maxOutlets: 2, aiQuotaMonthly: 10,
    dashboardAccessLevel: 'FULL' as const,
    moduleAccess: ['pos', 'ai', 'reports'] as any,
  };

  it('paket yang benar lolos', () => {
    expect(validasiPaket(sah)).toEqual([]);
  });

  it('menolak paket tanpa modul kasir — tanpa itu bukan POS', () => {
    expect(validasiPaket({ ...sah, moduleAccess: ['ai', 'reports'] as any }).length).toBeGreaterThan(0);
  });

  it('menolak kuota AI tanpa modul AI — merchant membayar tombol yang tak pernah muncul', () => {
    expect(validasiPaket({ ...sah, moduleAccess: ['pos', 'reports'] as any }).length).toBeGreaterThan(0);
  });

  it('menolak dashboard di atas Basic tanpa modul laporan', () => {
    expect(validasiPaket({ ...sah, moduleAccess: ['pos', 'ai'] as any }).length).toBeGreaterThan(0);
  });

  it('menolak batas yang mustahil dan modul yang tidak dikenal', () => {
    expect(validasiPaket({ ...sah, productLimit: 0 }).length).toBeGreaterThan(0);
    expect(validasiPaket({ ...sah, maxOutlets: 0 }).length).toBeGreaterThan(0);
    expect(validasiPaket({ ...sah, moduleAccess: ['pos', 'kasir_rahasia'] as any }).length).toBeGreaterThan(0);
  });
});

describe('kedaluwarsa dihitung, tidak disimpan', () => {
  const kini = Date.now();
  const nanti = (h: number) => new Date(kini + h * HARI_MS).toISOString();

  it('belum lewat: status apa adanya', () => {
    expect(statusEfektif('ACTIVE', nanti(1), kini)).toBe('ACTIVE');
    expect(statusEfektif('TRIAL', nanti(1), kini)).toBe('TRIAL');
  });

  it('lewat tapi masih dalam tenggang: PAST_DUE', () => {
    expect(statusEfektif('ACTIVE', nanti(-1), kini)).toBe('PAST_DUE');
    expect(dalamTenggang(statusEfektif('ACTIVE', nanti(-1), kini))).toBe(true);
  });

  it('tepat di ujung tenggang masih PAST_DUE, sedetik sesudahnya EXPIRED', () => {
    const ujung = new Date(kini - GRACE_DAYS * HARI_MS).toISOString();
    expect(statusEfektif('ACTIVE', ujung, kini)).toBe('PAST_DUE');
    expect(statusEfektif('ACTIVE', ujung, kini + 1001)).toBe('EXPIRED');
  });

  it('dibatalkan tetap dibatalkan walau periodenya belum habis', () => {
    expect(statusEfektif('CANCELED', nanti(30), kini)).toBe('CANCELED');
  });

  it('EXPIRED tidak aktif', () => {
    expect(langgananAktif(statusEfektif('ACTIVE', nanti(-10), kini))).toBe(false);
  });

  it('sisa hari dibulatkan ke BAWAH — beberapa jam bukan satu hari akses', () => {
    expect(sisaHari(nanti(0.9), kini)).toBe(0);
    expect(sisaHari(nanti(1.9), kini)).toBe(1);
    expect(sisaHari(null, kini)).toBe(0);
  });

  it('tanggal rusak tidak menghasilkan NaN', () => {
    expect(statusEfektif('ACTIVE', 'bukan-tanggal', kini)).toBe('ACTIVE');
    expect(sisaHari('bukan-tanggal', kini)).toBe(0);
  });
});
