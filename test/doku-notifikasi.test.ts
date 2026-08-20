/**
 * Aktivasi langganan lewat notifikasi DOKU, dari ujung ke ujung.
 *
 * doku-signature.test.ts menguji aturan tanda tangannya; berkas ini menguji
 * bahwa aturan itu benar-benar DIPASANG, dan bahwa pembayaran yang sah
 * mengaktifkan paket yang BENAR untuk merchant yang BENAR.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Readable } from 'node:stream';
import handler from '../api/v1/webhooks/doku';
import { buatTandaTangan, stempelWaktu } from '../src/server/dokuSignature';
import { ADA_DB, db, tutupDb, merchantUji, resTiruan } from './helper-db';

const CLIENT_ID = 'BRN-uji';
const SECRET = 'SK-uji-rahasia-yang-panjang';
const PATH = '/api/v1/webhooks/doku';

const d = describe.skipIf(!ADA_DB);

d('notifikasi pembayaran DOKU', () => {
  let tid = '';
  let subId = '';
  let n = 0;

  beforeAll(async () => {
    process.env.DOKU_SECRET_KEY = SECRET;
    process.env.DOKU_NOTIFICATION_PATH = PATH;
    tid = await merchantUji('usr-doku_FNB', 'Toko DOKU');
    const { rows } = await db().query(
      `INSERT INTO billing.subscriptions
         (id, tenant_id, plan_id, status, current_period_start, current_period_end)
       VALUES (uuidv7(), $1, 'plan-free', 'TRIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id) DO UPDATE SET plan_id = 'plan-free' RETURNING id`, [tid]);
    subId = rows[0].id;
    await db().query(`DELETE FROM billing.webhook_logs WHERE event_id LIKE 'DOKU:uji-%'`);
  });
  afterAll(tutupDb);

  /** Menerbitkan faktur seperti yang dilakukan /subscription/pay. */
  const terbitkanFaktur = async (nomor: string, planId: string, jumlah: number, siklus = 'MONTHLY') => {
    await db().query(
      `INSERT INTO billing.invoices
         (id, subscription_id, tenant_id, invoice_number, plan_id, billing_cycle,
          amount, currency, payment_status, due_date)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, 'IDR', 'PENDING',
               CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
      [subId, tid, nomor, planId, siklus, jumlah]
    );
  };

  const kirim = async (badan: any, opsi: { secret?: string; target?: string; reqId?: string } = {}) => {
    const mentah = JSON.stringify(badan);
    const requestId = opsi.reqId ?? `uji-${++n}`;
    const ts = stempelWaktu();
    const req: any = Readable.from([Buffer.from(mentah)]);
    req.method = 'POST';
    req.headers = {
      'client-id': CLIENT_ID,
      'request-id': requestId,
      'request-timestamp': ts,
      signature: buatTandaTangan({
        clientId: CLIENT_ID, requestId, requestTimestamp: ts,
        requestTarget: opsi.target ?? PATH, body: mentah, secretKey: opsi.secret ?? SECRET,
      }),
    };
    req.body = undefined;
    const res = resTiruan();
    await handler(req, res);
    return res;
  };

  const notif = (nomor: string, status = 'SUCCESS', amount = 299000) => ({
    order: { invoice_number: nomor, amount },
    transaction: { status },
    channel: { id: 'QRIS' },
    acquirer: { id: 'QRIS' },
  });

  it('menolak notifikasi yang tanda tangannya salah', async () => {
    await terbitkanFaktur('NH-TOLAK-1', 'plan-pro-monthly', 299000);
    const r = await kirim(notif('NH-TOLAK-1'), { secret: 'SK-secret-lain' });
    expect(r._status).toBe(401);
    expect(r._body.error).toBe('SIGNATURE_INVALID');

    const { rows } = await db().query(
      `SELECT payment_status FROM billing.invoices WHERE invoice_number = 'NH-TOLAK-1'`);
    expect(rows[0].payment_status).toBe('PENDING');
  });

  it('menolak bila Request-Target yang DOKU tandatangani berbeda', async () => {
    const r = await kirim(notif('NH-TOLAK-1'), { target: '/path/lain' });
    expect(r._status).toBe(401);
  });

  it('pembayaran sah mengaktifkan paket dari FAKTUR, bukan dari badan notifikasi', async () => {
    await terbitkanFaktur('NH-SAH-1', 'plan-pro-monthly', 299000);
    // Badan notifikasi sengaja menyebut paket lain — harus diabaikan.
    const r = await kirim({ ...notif('NH-SAH-1'), planId: 'plan-free', tenantId: 'merchant-lain' });
    expect(r._status).toBe(200);
    expect(r._body.activated).toBe(true);

    const { rows } = await db().query(
      `SELECT plan_id, status FROM billing.subscriptions WHERE id = $1`, [subId]);
    expect(rows[0].plan_id).toBe('plan-pro-monthly');
    expect(rows[0].status).toBe('ACTIVE');

    const inv = await db().query(
      `SELECT payment_status, paid_at FROM billing.invoices WHERE invoice_number = 'NH-SAH-1'`);
    expect(inv.rows[0].payment_status).toBe('PAID');
    expect(inv.rows[0].paid_at).not.toBeNull();
  });

  it('menolak aktivasi bila nominalnya tidak sama dengan tagihan', async () => {
    await terbitkanFaktur('NH-KURANG', 'plan-pro-monthly', 299000);
    const r = await kirim(notif('NH-KURANG', 'SUCCESS', 1));
    expect(r._status).toBe(200);
    expect(r._body.activated).toBe(false);
    expect(r._body.warning).toBe('NOMINAL_TIDAK_COCOK');

    const { rows } = await db().query(
      `SELECT payment_status FROM billing.invoices WHERE invoice_number = 'NH-KURANG'`);
    expect(rows[0].payment_status).toBe('PENDING');
  });

  it('notifikasi yang sama dikirim ulang tidak memperpanjang dua kali', async () => {
    // Faktur BARU. Memakai ulang yang sudah lunas hanya akan menguji jalur
    // "sudah lunas", bukan idempotensi Request-Id yang jadi maksud tes ini.
    await terbitkanFaktur('NH-ULANG', 'plan-pro-monthly', 299000);

    const r = await kirim(notif('NH-ULANG'), { reqId: 'uji-ulang' });
    expect(r._body.activated).toBe(true);

    const sesudahPertama = await db().query(
      `SELECT current_period_end FROM billing.subscriptions WHERE id = $1`, [subId]);

    const r2 = await kirim(notif('NH-ULANG'), { reqId: 'uji-ulang' });
    expect(r2._body.replayed).toBe(true);

    const sesudahKedua = await db().query(
      `SELECT current_period_end FROM billing.subscriptions WHERE id = $1`, [subId]);
    expect(new Date(sesudahKedua.rows[0].current_period_end).getTime())
      .toBe(new Date(sesudahPertama.rows[0].current_period_end).getTime());
  });

  it('faktur yang sudah lunas tidak diaktifkan ulang oleh Request-Id baru', async () => {
    const r = await kirim(notif('NH-SAH-1'), { reqId: 'uji-lain-lagi' });
    expect(r._body.activated).toBe(false);
    expect(r._body.warning).toBe('SUDAH_LUNAS');
  });

  it('status gagal menandai faktur, tanpa mengaktifkan apa pun', async () => {
    await terbitkanFaktur('NH-GAGAL', 'plan-plus-monthly', 99000);
    const r = await kirim(notif('NH-GAGAL', 'EXPIRED', 99000));
    expect(r._body.activated).toBe(false);

    const { rows } = await db().query(
      `SELECT payment_status FROM billing.invoices WHERE invoice_number = 'NH-GAGAL'`);
    expect(rows[0].payment_status).toBe('EXPIRED');
  });

  it('faktur yang tidak dikenal dijawab 200 supaya DOKU berhenti mengulang', async () => {
    const r = await kirim(notif('NH-BUKAN-MILIK-KITA'));
    expect(r._status).toBe(200);
    expect(r._body.warning).toBe('FAKTUR_TIDAK_DIKENAL');
  });

  it('perpanjangan MENAMBAH pada sisa yang masih berjalan', async () => {
    await db().query(
      `UPDATE billing.subscriptions
          SET current_period_end = CURRENT_TIMESTAMP + INTERVAL '10 days' WHERE id = $1`, [subId]);
    await terbitkanFaktur('NH-PERPANJANG', 'plan-pro-monthly', 299000);
    await kirim(notif('NH-PERPANJANG'));

    const { rows } = await db().query(
      `SELECT current_period_end FROM billing.subscriptions WHERE id = $1`, [subId]);
    const hari = Math.round(
      (new Date(rows[0].current_period_end).getTime() - Date.now()) / 86_400_000);
    expect(hari).toBe(40); // 10 sisa + 30 baru, bukan 30
  });
});
