/**
 * Router AI DI DALAM endpoint sungguhan.
 *
 * test/router-ai.test.ts menjaga keputusannya; berkas ini menjaga bahwa
 * keputusan itu benar-benar dipakai. Router yang sempurna dan tidak pernah
 * dipanggil sama saja dengan tidak ada — dan itu keadaannya sampai commit ini:
 * query.ts memilih jalur dengan `if (matched)` saja, jadi "kenapa omzet saya
 * turun?" dijawab tabel omzet karena kata `omzet` kebetulan cocok.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import tanyaAI from '../api/v1/assistant/query';
import { ADA_DB, db, tutupDb, merchantUji, pasangPaket, resTiruan, headerToko, daftarTokoUji } from './helper-db';

const d = describe.skipIf(!ADA_DB);

// Endpoint toko menolak permintaan tanpa token. Diisi setelah toko ujinya ada.
let HDR: Record<string, string> = {};

d('router di jalur /assistant/query', () => {
  const BID = 'usr-uji-router_FNB';
  let tid = '';

  beforeAll(async () => {
    tid = await merchantUji(BID, 'Toko Uji Router');
    HDR = headerToko(tid, BID);
    await pasangPaket(tid, 'plan-pro-monthly');
    // Kartu insight semalam, supaya lapisan analitik punya sesuatu untuk
    // dijawab tanpa memanggil model.
    await db().query(
      `INSERT INTO ai.daily_merchant_insights
         (id, business_id, insight_date, category, priority, title, summary,
          metric_label, payload, actions, status)
       VALUES (uuidv7(), $1, CURRENT_DATE, 'CRM_CHURN', 1,
               '3 member mulai jarang datang',
               'Budi terakhir belanja 21 hari lalu.', 'Rp 1.200.000 berisiko',
               '{"kind":"CRM_CHURN"}'::jsonb, '[]'::jsonb, 'ACTIVE')
       ON CONFLICT (business_id, insight_date, category) DO UPDATE SET title = EXCLUDED.title`,
      [tid]
    );
  });
  afterAll(tutupDb);

  const tanya = async (query: string) => {
    const res = resTiruan();
    await tanyaAI({ method: 'POST', headers: HDR, body: { businessId: BID, query } }, res);
    return res._body;
  };

  it('pertanyaan angka dijawab gratis dari data toko', async () => {
    const b = await tanya('berapa omzet bulan ini?');
    expect(b.answer.source).toBe('RULE_ENGINE');
    expect(b.answer.costCredits).toBe(0);
    expect(b.answer.intent).toBe('GET_REVENUE_SUMMARY');
  });

  it('INI PERBAIKAN INTINYA: "kenapa omzet turun" TIDAK dijawab tabel omzet', async () => {
    const b = await tanya('kenapa omzet saya turun bulan ini?');
    // Kata `omzet` tetap cocok dengan polanya, tapi jawabannya bukan angka —
    // jadi jalur deterministik tidak boleh mengambilnya.
    expect(b.answer.source).not.toBe('RULE_ENGINE');
    expect(b.answer.intent).not.toBe('GET_REVENUE_SUMMARY');
  });

  it('pertanyaan "sebaiknya" juga bukan urusan jalur deterministik', async () => {
    const b = await tanya('sebaiknya saya promo produk apa?');
    expect(b.answer.source).not.toBe('RULE_ENGINE');
  });

  it('pertanyaan pelanggan dijawab dari kartu batch, gratis, tanpa model', async () => {
    const b = await tanya('pelanggan mana yang mulai jarang datang?');
    expect(b.answer.source).toBe('BATCH_INSIGHT');
    expect(b.answer.costCredits).toBe(0);
    expect(b.answer.markdown).toContain('3 member mulai jarang datang');
  });

  it('kartu batch yang belum ada TIDAK membuat pertanyaan gratis jadi berbayar', async () => {
    // Tidak ada kartu INVENTORY_ALERT untuk merchant ini. Pertanyaan stok
    // harus jatuh ke jawaban deterministik yang gratis, bukan ke LLM.
    const b = await tanya('stok apa yang menipis?');
    expect(b.answer.costCredits).toBe(0);
    expect(b.answer.source).toBe('RULE_ENGINE');
  });

  it('umur kartu disebutkan, tidak disamarkan sebagai angka hari ini', async () => {
    await db().query(
      `UPDATE ai.daily_merchant_insights
          SET insight_date = CURRENT_DATE - 2
        WHERE business_id = $1 AND category = 'CRM_CHURN'`,
      [tid]
    );
    const b = await tanya('pelanggan mana yang mulai jarang datang?');
    expect(b.answer.source).toBe('BATCH_INSIGHT');
    expect(b.answer.markdown).toContain('2 hari lalu');

    await db().query(
      `UPDATE ai.daily_merchant_insights
          SET insight_date = CURRENT_DATE
        WHERE business_id = $1 AND category = 'CRM_CHURN'`,
      [tid]
    );
  });

  it('modul AI yang tidak dibeli ditolak sebelum apa pun dihitung', async () => {
    await db().query(
      `INSERT INTO billing.plans
         (id, name, tier_level, price_idr, billing_cycle, is_active, ai_quota_monthly,
          product_limit, max_outlets, dashboard_access_level, module_access)
       VALUES ('plan-uji-router-tanpa-ai', 'Uji Router Tanpa AI', 1, 1000, 'MONTHLY', true, 0,
               10, 1, 'BASIC', ARRAY['pos'])
       ON CONFLICT (id) DO UPDATE SET module_access = EXCLUDED.module_access, is_active = true`);
    await pasangPaket(tid, 'plan-uji-router-tanpa-ai');

    const b = await tanya('berapa omzet bulan ini?');
    expect(b.answer.source).toBe('PAYWALL');
    expect(b.answer.intent).toBe('MODUL_TIDAK_TERMASUK_PAKET');
    expect(b.answer.costCredits).toBe(0);

    await db().query(`UPDATE billing.plans SET is_active = false WHERE id = 'plan-uji-router-tanpa-ai'`);
    await pasangPaket(tid, 'plan-pro-monthly');
  });
});
