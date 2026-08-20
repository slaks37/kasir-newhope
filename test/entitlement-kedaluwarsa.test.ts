/**
 * Apa yang DIDAPAT merchant yang berhenti membayar.
 *
 * Pernah salah total dan tidak ada yang tahu: merchant paket Pro yang lewat 30
 * hari tetap menerima batas produk tanpa batas, 5 outlet, dashboard Advanced,
 * dan 13 modul. Statusnya benar EXPIRED, tapi tidak ada satu pun batas yang
 * ikut turun.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import statusHandler from '../api/v1/subscription/status';
import { ADA_DB, db, tutupDb, merchantUji, resTiruan } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('entitlement saat langganan mati', () => {
  const BID = 'usr-uji-nunggak_FNB';
  let tid = '';
  let free: any = null;

  beforeAll(async () => {
    tid = await merchantUji(BID, 'Toko Nunggak');
    free = (await db().query(
      `SELECT product_limit, max_outlets, ai_quota_monthly, dashboard_access_level, module_access
         FROM billing.plans WHERE id = 'plan-free'`)).rows[0];
  });
  afterAll(tutupDb);

  /** Memasang langganan Pro yang berakhir `hariLalu` hari yang lalu. */
  const pasang = async (hariLalu: number) => {
    await db().query(
      `INSERT INTO billing.subscriptions
         (id, tenant_id, plan_id, status, current_period_start, current_period_end)
       VALUES (uuidv7(), $1, 'plan-pro-monthly', 'ACTIVE',
               CURRENT_TIMESTAMP - ($2::int || ' days')::interval - INTERVAL '30 days',
               CURRENT_TIMESTAMP - ($2::int || ' days')::interval)
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan_id = 'plan-pro-monthly', status = 'ACTIVE',
         current_period_start = EXCLUDED.current_period_start,
         current_period_end   = EXCLUDED.current_period_end`,
      [tid, hariLalu]
    );
  };

  const entitlement = async () =>
    (await db().query(
      `SELECT * FROM contract.merchant_entitlements WHERE merchant_id = $1`, [tid])).rows[0];

  const lewatEndpoint = async () => {
    const res = resTiruan();
    await statusHandler({ method: 'GET', query: { tenantId: BID }, headers: {} }, res);
    return res._body;
  };

  it('masih berjalan: entitlement Pro penuh', async () => {
    await pasang(-5); // berakhir 5 hari LAGI
    const e = await entitlement();
    expect(e.status).toBe('ACTIVE');
    expect(Number(e.product_limit)).toBe(-1);
    expect(Number(e.max_outlets)).toBe(5);
    expect(Number(e.ai_quota_effective)).toBe(90);
    expect(e.dashboard_access_level).toBe('ADVANCED');
  });

  it('MASA TENGGANG tidak diturunkan — terlambat bukan berarti berhenti', async () => {
    await pasang(1); // lewat 1 hari, tenggang 3 hari
    const e = await entitlement();
    expect(e.status).toBe('PAST_DUE');
    expect(e.berlaku).toBe(true);
    expect(Number(e.product_limit)).toBe(-1);
    expect(Number(e.max_outlets)).toBe(5);
    expect(Number(e.ai_quota_effective)).toBe(90);
  });

  it('kedaluwarsa: SEMUA batas turun ke tingkat Free', async () => {
    await pasang(30);
    const e = await entitlement();
    expect(e.status).toBe('EXPIRED');
    expect(e.berlaku).toBe(false);
    expect(Number(e.product_limit)).toBe(Number(free.product_limit));
    expect(Number(e.max_outlets)).toBe(Number(free.max_outlets));
    expect(Number(e.ai_quota_effective)).toBe(0);
    expect(e.dashboard_access_level).toBe(free.dashboard_access_level);
    expect(e.module_access).toEqual(free.module_access);
  });

  it('nilai PAKET tetap dibawa terpisah, untuk mengajak memperpanjang', async () => {
    const e = await entitlement();
    expect(Number(e.product_limit_plan)).toBe(-1);
    expect(Number(e.max_outlets_plan)).toBe(5);
    expect(Number(e.ai_quota_plan)).toBe(90);
    expect(e.dashboard_access_level_plan).toBe('ADVANCED');
  });

  it('endpoint status mengirim batas yang BERLAKU, bukan batas paket', async () => {
    const d = await lewatEndpoint();
    expect(d.subscription.status).toBe('EXPIRED');
    expect(d.isActive).toBe(false);
    expect(d.plan.productLimit).toBe(Number(free.product_limit));
    expect(d.plan.maxOutlets).toBe(Number(free.max_outlets));
    expect(d.plan.aiQuotaMonthly).toBe(0);
    expect(d.plan.dashboardAccessLevel).toBe(free.dashboard_access_level);
    expect(d.planEntitlements.maxOutlets).toBe(5); // yang hilang, untuk ditawarkan
  });

  it('batas outlet yang ditegakkan server ikut turun', async () => {
    const { rows } = await db().query(
      `SELECT max_outlets FROM contract.merchant_outlet_usage WHERE merchant_id = $1`, [tid]);
    expect(Number(rows[0].max_outlets)).toBe(Number(free.max_outlets));
  });

  it('dibayar lagi: entitlement Pro kembali utuh', async () => {
    await pasang(-30);
    const e = await entitlement();
    expect(e.status).toBe('ACTIVE');
    expect(Number(e.max_outlets)).toBe(5);
    expect(Number(e.ai_quota_effective)).toBe(90);
  });
});
