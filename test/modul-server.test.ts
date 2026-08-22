/**
 * Akses modul ditegakkan DI SERVER, bukan hanya disembunyikan di layar.
 *
 * CATATAN JUJUR TENTANG CAKUPANNYA. Laporan dan level dashboard dihitung
 * sepenuhnya di perangkat dari `orders` yang memang sudah dimiliki merchant —
 * tidak ada endpoint laporan sisi server, jadi tidak ada data bernilai jual
 * yang bisa bocor dari sana. Yang benar-benar perlu dijaga adalah endpoint yang
 * MELAKUKAN pekerjaan berbayar, dan sejauh ini hanya satu: AI Copilot, karena
 * tiap panggilan LLM yang lolos ditagihkan kepada kami.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import queryHandler from '../api/v1/assistant/query';
import { entitlementMerchant } from '../api/_lib/entitlementGuard';
import { ADA_DB, db, tutupDb, merchantUji, pasangPaket, resTiruan } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('penegakan modul di server', () => {
  const BID = 'usr-uji-modul_FNB';
  let tid = '';

  beforeAll(async () => {
    tid = await merchantUji(BID, 'Toko Uji Modul');
    // Paket tanpa modul ai — dibuat khusus untuk tes ini.
    await db().query(
      `INSERT INTO billing.plans
         (id, name, tier_level, billing_cycle, price_idr, currency, features, is_active,
          product_limit, max_outlets, ai_quota_monthly, dashboard_access_level,
          module_access, sort_order)
       VALUES ('plan-uji-tanpa-ai', 'Uji Tanpa AI', 1, 'MONTHLY', 0, 'IDR', '[]'::jsonb, false,
               30, 1, 0, 'BASIC', ARRAY['home','overview','pos','settings']::text[], 99)
       ON CONFLICT (id) DO UPDATE SET
         module_access = EXCLUDED.module_access, ai_quota_monthly = 0, is_active = false`
    );
  });
  afterAll(tutupDb);

  const tanya = async () => {
    const res = resTiruan();
    await queryHandler(
      { method: 'POST', body: { merchantId: BID, question: 'berapa omzet bulan ini?' }, headers: {} },
      res
    );
    return res._body;
  };

  it('paket TANPA modul AI ditolak di server, bukan disembunyikan di layar', async () => {
    await db().query(
      `UPDATE billing.subscriptions SET plan_id = 'plan-uji-tanpa-ai', status = 'ACTIVE',
              current_period_end = CURRENT_TIMESTAMP + INTERVAL '30 days'
        WHERE business_id = $1`, [tid]);

    const d = await tanya();
    expect(d.answer.source).toBe('PAYWALL');
    expect(d.answer.intent).toBe('MODUL_TIDAK_TERMASUK_PAKET');
    expect(d.answer.costCredits).toBe(0);
  });

  it('paket DENGAN modul AI tidak ikut terhalang', async () => {
    await pasangPaket(tid, 'plan-pro-monthly');
    const d = await tanya();
    expect(d.answer.intent).not.toBe('MODUL_TIDAK_TERMASUK_PAKET');
    expect(d.answer.source).not.toBe('PAYWALL');
  });

  it('entitlement dibaca dari view yang BERLAKU, jadi ikut turun saat kedaluwarsa', async () => {
    await db().query(
      `UPDATE billing.subscriptions
          SET current_period_end = CURRENT_TIMESTAMP - INTERVAL '30 days'
        WHERE business_id = $1`, [tid]);

    const e = await entitlementMerchant(db() as any, tid);
    const free = (await db().query(
      `SELECT product_limit, max_outlets, dashboard_access_level
         FROM billing.plans WHERE id = 'plan-free'`)).rows[0];

    expect(e.productLimit).toBe(Number(free.product_limit));
    expect(e.maxOutlets).toBe(Number(free.max_outlets));
    expect(e.dashboardAccessLevel).toBe(free.dashboard_access_level);
    expect(e.aiQuotaMonthly).toBe(0);
  });

  it('merchant tanpa baris langganan jatuh ke entitlement darurat, bukan paket termahal', async () => {
    const tid2 = await merchantUji('usr-uji-nosub_FNB', 'Tanpa Langganan');
    await db().query('DELETE FROM billing.subscriptions WHERE business_id = $1', [tid2]);

    const e = await entitlementMerchant(db() as any, tid2);
    expect(e.aiQuotaMonthly).toBe(0);
    expect(e.maxOutlets).toBe(1);
    expect(e.moduleAccess).not.toContain('reports');

    // Dibersihkan: merchant tanpa langganan adalah keadaan yang sengaja
    // dibuat tes ini, dan tidak boleh terlihat oleh tes lain sebagai
    // kebocoran trigger 0024.
    await db().query('DELETE FROM pos.businesses WHERE id = $1', [tid2]);
  });
});
