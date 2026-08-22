/**
 * Endpoint yang MEMBACA hasil batch.
 *
 * Sampai endpoint ini ada, ai.daily_merchant_insights hanya ditulis dan tidak
 * pernah dibaca kode mana pun — batch semalam berjalan setiap hari dan
 * hasilnya tidak sampai ke siapa-siapa. Tes ini menjaga supaya keadaan itu
 * tidak kembali diam-diam.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bacaInsight from '../api/v1/assistant/insights';
import { ADA_DB, db, tutupDb, merchantUji, pasangPaket, resTiruan } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('endpoint insight', () => {
  const BID = 'usr-uji-insight_FNB';
  let tid = '';

  const sisipkan = async (category: string, tanggal: string, priority = 2) => {
    await db().query(
      `INSERT INTO ai.daily_merchant_insights
         (id, business_id, insight_date, category, priority, title, summary,
          metric_label, payload, actions, status)
       VALUES (uuidv7(), $1, $2::date, $3, $4, $5, 'Ringkasan uji', '1 item',
               '{"kind":"UJI"}'::jsonb, '[]'::jsonb, 'ACTIVE')
       ON CONFLICT (business_id, insight_date, category) DO UPDATE SET title = EXCLUDED.title`,
      [tid, tanggal, category, priority, `Judul ${category}`]
    );
  };

  beforeAll(async () => {
    tid = await merchantUji(BID, 'Toko Uji Insight');
    await pasangPaket(tid, 'plan-pro-monthly');
  });
  afterAll(tutupDb);

  const panggil = async (businessId = BID) => {
    const res = resTiruan();
    await bacaInsight({ method: 'GET', query: { businessId } }, res);
    return res;
  };

  it('menyajikan kartu hari ini beserta cakupan algoritmanya', async () => {
    await sisipkan('INVENTORY_ALERT', new Date().toISOString().slice(0, 10), 1);
    await sisipkan('FINANCIAL_PERFORMANCE', new Date().toISOString().slice(0, 10), 3);

    const res = await panggil();
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.insights.length).toBeGreaterThanOrEqual(2);
    // Prioritas tertinggi lebih dulu — kartu yang perlu ditindak hari ini
    // tidak boleh tenggelam di bawah laporan biasa.
    expect(res._body.insights[0].priority).toBe(1);
  });

  it('cakupan menjawab kategori mana yang BERLAKU untuk sektor ini', async () => {
    const res = await panggil();
    const c = new Map(res._body.coverage.map((r: any) => [r.category, r]));
    expect(c.size).toBe(9);
    // FNB punya tempat duduk; toko kelontong tidak.
    expect((c.get('LAYOUT_UTILISATION') as any).berlakuUntukSektor).toBe(true);
    expect((c.get('CRM_CHURN') as any).berlakuUntukSektor).toBe(true);
  });

  it('kartu kemarin dilaporkan BASI, bukan disajikan seolah hari ini', async () => {
    // Bersihkan kartu hari ini supaya yang tersisa hanya yang lama.
    await db().query('DELETE FROM ai.daily_merchant_insights WHERE business_id = $1', [tid]);
    const tigaHariLalu = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    await sisipkan('INVENTORY_ALERT', tigaHariLalu, 1);

    const res = await panggil();
    expect(res._body.stale).toBe(true);
    expect(res._body.ageHours).toBeGreaterThan(26);
    expect(res._body.insightDate).not.toBeNull();
  });

  it('tanpa kartu sama sekali: dianggap basi, bukan segar', async () => {
    await db().query('DELETE FROM ai.daily_merchant_insights WHERE business_id = $1', [tid]);
    const res = await panggil();
    expect(res._body.insights).toEqual([]);
    expect(res._body.stale).toBe(true);
    expect(res._body.ageHours).toBeNull();
  });

  it('paket tanpa modul AI ditolak di sini juga, bukan hanya di /query', async () => {
    await db().query(
      `INSERT INTO billing.plans
         (id, name, tier_level, price_idr, billing_cycle, is_active, ai_quota_monthly,
          product_limit, max_outlets, dashboard_access_level, module_access)
       VALUES ('plan-uji-insight-tanpa-ai', 'Uji Tanpa AI', 1, 1000, 'MONTHLY', true, 0,
               10, 1, 'BASIC', ARRAY['pos','inventory'])
       ON CONFLICT (id) DO UPDATE SET module_access = EXCLUDED.module_access, is_active = true`);
    await pasangPaket(tid, 'plan-uji-insight-tanpa-ai');

    const res = await panggil();
    expect(res._status).toBe(402);
    expect(res._body.error).toBe('MODUL_TIDAK_TERMASUK_PAKET');

    await db().query(`UPDATE billing.plans SET is_active = false WHERE id = 'plan-uji-insight-tanpa-ai'`);
    await pasangPaket(tid, 'plan-pro-monthly');
  });

  it('toko yang belum tersinkron ditolak, bukan dilayani dengan data kosong', async () => {
    const res = await panggil('usr-tidak-ada_FNB');
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('MERCHANT_BELUM_SINKRON');
  });
});
