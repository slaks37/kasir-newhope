/**
 * Katalog paket yang benar-benar tersimpan di database.
 *
 * entitlements.test.ts menguji ATURANNYA; berkas ini menguji ISINYA. Migrasi
 * yang salah seed, atau admin yang menyimpan paket mustahil lewat jalur lain,
 * menghasilkan katalog yang lolos semua tes murni tapi tetap tidak bisa dijual.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { validasiPaket, TANPA_BATAS, type AdminPlan } from '../src/lib/plans/entitlements';
import { ADA_DB, db, tutupDb } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('katalog paket di billing.plans', () => {
  afterAll(tutupDb);

  const ambil = async (): Promise<AdminPlan[]> => {
    const { rows } = await db().query(
      `SELECT id, name, tier_level, billing_cycle, price_idr, price_yearly_idr,
              extra_outlet_price_idr, currency, features, product_limit, max_outlets,
              ai_quota_monthly, dashboard_access_level, module_access, is_active, sort_order
         FROM billing.plans ORDER BY tier_level`
    );
    return rows.map((r: any) => ({
      id: r.id, name: r.name, tierLevel: Number(r.tier_level),
      billingCycle: r.billing_cycle, priceIdr: Number(r.price_idr),
      priceYearlyIdr: r.price_yearly_idr == null ? null : Number(r.price_yearly_idr),
      extraOutletPriceIdr: r.extra_outlet_price_idr == null ? null : Number(r.extra_outlet_price_idr),
      currency: r.currency, features: r.features ?? [],
      productLimit: Number(r.product_limit), maxOutlets: Number(r.max_outlets),
      aiQuotaMonthly: Number(r.ai_quota_monthly),
      dashboardAccessLevel: r.dashboard_access_level,
      moduleAccess: r.module_access ?? [], isActive: r.is_active,
      sortOrder: Number(r.sort_order),
    }));
  };

  it('tidak kosong — katalog kosong berarti tidak ada yang bisa dijual', async () => {
    expect((await ambil()).length).toBeGreaterThan(0);
  });

  it('SETIAP paket lolos aturan yang sama dengan formulir admin', async () => {
    for (const p of await ambil()) {
      expect({ id: p.id, galat: validasiPaket(p) }).toEqual({ id: p.id, galat: [] });
    }
  });

  it('tier yang lebih tinggi tidak pernah memberi LEBIH SEDIKIT', async () => {
    const paket = (await ambil()).filter((p) => p.isActive);
    for (let i = 1; i < paket.length; i++) {
      const bawah = paket[i - 1];
      const atas = paket[i];

      // -1 (tanpa batas) selalu lebih besar dari angka berapa pun.
      const batas = (n: number) => (n === TANPA_BATAS ? Number.POSITIVE_INFINITY : n);
      expect(batas(atas.productLimit)).toBeGreaterThanOrEqual(batas(bawah.productLimit));
      expect(atas.maxOutlets).toBeGreaterThanOrEqual(bawah.maxOutlets);
      expect(atas.aiQuotaMonthly).toBeGreaterThanOrEqual(bawah.aiQuotaMonthly);

      // Modul paket bawah harus seluruhnya ada di paket atas. Upgrade yang
      // MENGHILANGKAN modul adalah pelanggan yang membayar lebih untuk
      // kehilangan fitur — dan baru ketahuan saat dia mengeluh.
      for (const m of bawah.moduleAccess) {
        expect(atas.moduleAccess).toContain(m);
      }
    }
  });

  it('harga naik seiring tier', async () => {
    const paket = (await ambil()).filter((p) => p.isActive);
    for (let i = 1; i < paket.length; i++) {
      expect(paket[i].priceIdr).toBeGreaterThanOrEqual(paket[i - 1].priceIdr);
    }
  });

  it('view kontrak menyajikan paket aktif yang sama dengan tabelnya', async () => {
    const { rows } = await db().query('SELECT id FROM contract.plan_catalog WHERE is_active ORDER BY tier_level');
    const aktif = (await ambil()).filter((p) => p.isActive).map((p) => p.id);
    expect(rows.map((r: any) => r.id)).toEqual(aktif);
  });
});
