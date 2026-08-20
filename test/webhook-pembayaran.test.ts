/**
 * Aktivasi langganan lewat webhook pembayaran, dari ujung ke ujung.
 *
 * webhook-auth.test.ts menguji aturan tanda tangannya; berkas ini menguji
 * bahwa aturan itu benar-benar DIPASANG di endpoint — dan bahwa pembayaran
 * yang sah menghasilkan langganan yang benar.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Readable } from 'node:stream';
import handler from '../api/v1/webhooks/payment-gateway';
import { tandaTangani } from '../src/server/webhookAuth';
import { ADA_DB, db, tutupDb, merchantUji, resTiruan } from './helper-db';

const SECRET = 'rahasia-webhook-yang-cukup-panjang-32';
const BID = 'usr-uji-bayar_FNB';

const d = describe.skipIf(!ADA_DB);

d('webhook pembayaran', () => {
  let tid = '';

  beforeAll(async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
    tid = await merchantUji(BID, 'Toko Uji Bayar');
    await db().query(
      `DELETE FROM billing.webhook_logs WHERE event_id LIKE 'uji-%'`
    );
  });
  afterAll(tutupDb);

  const kirim = async (payload: any, headerTT?: string | null) => {
    const mentah = JSON.stringify(payload);
    const req: any = Readable.from([Buffer.from(mentah)]);
    req.method = 'POST';
    req.headers = headerTT === null ? {} : { 'x-signature': headerTT ?? tandaTangani(mentah, SECRET) };
    req.body = undefined;
    const res = resTiruan();
    await handler(req, res);
    return res;
  };

  const bayar = (id: string, planId = 'plan-pro-monthly') => ({
    eventId: id, eventType: 'payment.succeeded', tenantId: BID, planId,
  });

  it('menolak permintaan tanpa tanda tangan yang sah', async () => {
    expect((await kirim(bayar('uji-tolak-1'), null))._status).toBe(401);
    expect((await kirim(bayar('uji-tolak-2'), 't=1,v1=deadbeef'))._status).toBe(401);

    const badan = JSON.stringify(bayar('uji-tolak-3'));
    const secretSalah = tandaTangani(badan, 'secret-lain-yang-juga-panjang-32b');
    expect((await kirim(bayar('uji-tolak-3'), secretSalah))._status).toBe(401);
  });

  it('tidak membocorkan alasan penolakan ke pemanggil', async () => {
    const r = await kirim(bayar('uji-tolak-4'), null);
    expect(r._body.error).toBe('SIGNATURE_INVALID');
    expect(JSON.stringify(r._body)).not.toContain('HEADER_KOSONG');
  });

  it('percobaan palsu TIDAK menaikkan paket dan tidak mengotori log', async () => {
    // Sejak 0024 merchant baru sudah punya langganan PERCOBAAN, jadi yang harus
    // dibuktikan bukan "tidak ada langganan" melainkan "tidak naik ke paket
    // berbayar".
    const sub = await db().query(
      'SELECT plan_id, status FROM billing.subscriptions WHERE tenant_id = $1', [tid]);
    expect(sub.rows[0]?.plan_id).not.toBe('plan-pro-monthly');
    expect(sub.rows[0]?.status).not.toBe('ACTIVE');

    const log = await db().query(
      `SELECT COUNT(*)::int n FROM billing.webhook_logs WHERE event_id LIKE 'uji-tolak-%'`);
    expect(log.rows[0].n).toBe(0);
  });

  it('pembayaran sah mengaktifkan paket selama 30 hari', async () => {
    const r = await kirim(bayar('uji-sah-1'));
    expect(r._status).toBe(200);
    expect(r._body.replayed).toBe(false);

    const { rows } = await db().query(
      `SELECT plan_id, status, current_period_end FROM billing.subscriptions WHERE tenant_id = $1`, [tid]);
    expect(rows[0].plan_id).toBe('plan-pro-monthly');
    expect(rows[0].status).toBe('ACTIVE');
    const hari = Math.round((new Date(rows[0].current_period_end).getTime() - Date.now()) / 86_400_000);
    expect(hari).toBe(30);
  });

  it('event yang sama dikirim ulang dijawab 200 — galat membuat gateway mengulang selamanya', async () => {
    const r = await kirim(bayar('uji-sah-1'));
    expect(r._status).toBe(200);
    expect(r._body.replayed).toBe(true);

    const { rows } = await db().query(
      `SELECT COUNT(*)::int n FROM billing.webhook_logs WHERE event_id = 'uji-sah-1'`);
    expect(rows[0].n).toBe(1);
  });

  it('kode paket salah ketik tidak menghanguskan entitlement yang sudah dibayar', async () => {
    const r = await kirim(bayar('uji-sah-2', 'plan-yang-tidak-pernah-ada'));
    expect(r._status).toBe(200);
    const { rows } = await db().query(
      'SELECT plan_id FROM billing.subscriptions WHERE tenant_id = $1', [tid]);
    expect(rows[0].plan_id).toBe('plan-pro-monthly');
  });

  it('merchant yang belum sinkron dijawab 200 dengan peringatan, bukan galat', async () => {
    const r = await kirim({
      eventId: 'uji-sah-3', eventType: 'payment.succeeded', tenantId: 'tidak-ada-sama-sekali_FNB',
    });
    expect(r._status).toBe(200);
    expect(r._body.warning).toBe('MERCHANT_BELUM_SINKRON');
  });
});
