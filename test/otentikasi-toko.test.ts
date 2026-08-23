/**
 * Lubang paling berat di audit ini, dan buktinya sudah tertutup.
 *
 * Sebelum gerbang identitas dipasang, ini berhasil TANPA satu pun kredensial:
 *
 *     GET  /v1/subscription/status?tenantId=usr-siti_RETAIL  -> 200, data lengkap
 *     POST /v1/sync/transactions {businessId: "usr-siti_RETAIL"}
 *                                                            -> 1139 -> 1140
 *
 * Berkas ini menjalankan handler yang sama, dengan cara yang sama, dan menuntut
 * keduanya ditolak. Ia juga menuntut jalur yang SAH tetap berjalan — penjagaan
 * yang ikut mematikan penggunaan normal bukan penjagaan, melainkan kerusakan
 * jenis lain.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import status from '../api/v1/subscription/status';
import sinkron from '../api/v1/sync/transactions';
import sesi from '../api/v1/auth/session';
import { ADA_DB, db, tutupDb, resTiruan, bersihkanPemilik } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('gerbang identitas toko', () => {
  const KEY = 'usr-gerbang_FNB';
  const OWNER = 'usr-gerbang';
  let businessId = '';
  let tokenSah = '';

  beforeAll(async () => {
    if (!ADA_DB) return;
    process.env.MERCHANT_SESSION_SECRET =
      process.env.MERCHANT_SESSION_SECRET || 'rahasia-uji-minimal-tiga-puluh-dua-karakter';
    await bersihkanPemilik(KEY);
    const { rows } = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Gerbang', 'FNB', $1, $2, true) RETURNING id`,
      [KEY, OWNER]
    );
    businessId = rows[0].id;
  });

  afterAll(async () => {
    if (ADA_DB) await bersihkanPemilik(KEY);
    await tutupDb();
  });

  const kirimSinkron = (headers: any, body: any) => {
    const res = resTiruan();
    return sinkron({ method: 'POST', headers, body } as any, res as any).then(() => res);
  };

  it('menerbitkan token untuk pemilik yang cocok', async () => {
    const res = resTiruan();
    await sesi({ method: 'POST', headers: {}, body: { businessId: KEY, ownerRef: OWNER } } as any, res as any);
    expect(res._status).toBe(200);
    expect(res._body.token).toMatch(/^m1\./);
    expect(res._body.businessId).toBe(businessId);
    tokenSah = res._body.token;
  });

  it('DEF-01: toko baru terdaftar dan langsung dapat token + langganan percobaan', async () => {
    // Sebelum perbaikan, jalur ini memanggil fungsi basis data `custom_signup`
    // yang tidak ada di satu pun migrasi — pendaftaran selalu gagal.
    const BARU = 'usr-daftarbaru_LAUNDRY';
    await bersihkanPemilik(BARU);
    const res = resTiruan();
    await sesi({ method: 'POST', headers: {}, body: {
      businessId: BARU, ownerRef: 'usr-daftarbaru',
      storeName: 'Laundry Baru', sector: 'LAUNDRY',
    } } as any, res as any);

    expect(res._status).toBe(200);
    expect(res._body.token).toMatch(/^m1\./);

    const { rows } = await db().query(
      `SELECT b.id, b.merchant_id, s.status, s.plan_id
         FROM pos.businesses b
         LEFT JOIN billing.subscriptions s ON s.merchant_id = b.merchant_id
        WHERE b.client_key = $1`, [BARU]);
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant_id).toBeTruthy();     // trigger merchant berjalan
    expect(rows[0].status).toBe('TRIAL');          // langganan percobaan lahir
    await bersihkanPemilik(BARU);
  });

  it('pendaftaran menolak sektor yang tidak dikenal', async () => {
    const res = resTiruan();
    await sesi({ method: 'POST', headers: {}, body: {
      businessId: 'usr-x_KEBUN', ownerRef: 'usr-x',
      storeName: 'Kebun', sector: 'KEBUN',
    } } as any, res as any);
    expect(res._status).toBe(401);
  });

  it('menolak menerbitkan token bila pemiliknya tidak cocok', async () => {
    const res = resTiruan();
    await sesi(
      { method: 'POST', headers: {}, body: { businessId: KEY, ownerRef: 'usr-penyusup' } } as any,
      res as any
    );
    expect(res._status).toBe(401);
  });

  it('BACA tanpa token ditolak (dulu 200 + data lengkap)', async () => {
    const res = resTiruan();
    await status({ method: 'GET', query: { tenantId: KEY }, headers: {} } as any, res as any);
    expect(res._status).toBe(401);
    expect(JSON.stringify(res._body)).not.toContain('planId');
  });

  it('TULIS tanpa token ditolak (dulu menambah transaksi korban)', async () => {
    const sebelum = await db().query(
      `SELECT COUNT(*)::int n FROM pos.transactions WHERE business_id = $1`, [businessId]);
    const res = await kirimSinkron({}, {
      businessId: KEY, sector: 'FNB', idempotencyKey: `x-${Date.now()}`,
      transactions: [{ clientTxnId: `x-${Date.now()}`, invoiceNumber: 'PALSU',
        subtotal: 99999999, totalAmount: 99999999, paymentMethod: 'CASH',
        paymentStatus: 'COMPLETED', items: [] }],
    });
    const sesudah = await db().query(
      `SELECT COUNT(*)::int n FROM pos.transactions WHERE business_id = $1`, [businessId]);
    expect(res._status).toBe(401);
    expect(sesudah.rows[0].n).toBe(sebelum.rows[0].n);
  });

  it('token palsu / diubah ditolak', async () => {
    const rusak = tokenSah.slice(0, -4) + 'AAAA';
    const res = resTiruan();
    await status({ method: 'GET', query: { tenantId: KEY }, headers: { authorization: `Bearer ${rusak}` } } as any, res as any);
    expect(res._status).toBe(401);
  });

  it('token konsol internal tidak bisa dipakai sebagai token toko', async () => {
    const res = resTiruan();
    await status(
      { method: 'GET', query: { tenantId: KEY }, headers: { authorization: 'Bearer v1.abc.def' } } as any,
      res as any
    );
    expect(res._status).toBe(401);
  });

  it('token sah TAPI menyebut toko lain ditolak dengan jelas', async () => {
    const res = resTiruan();
    await status(
      { method: 'GET', query: { tenantId: 'usr-oranglain_RETAIL' },
        headers: { authorization: `Bearer ${tokenSah}` } } as any,
      res as any
    );
    expect(res._status).toBe(403);
    expect(res._body.error).toBe('TENANT_MISMATCH');
  });

  it('token sah tetap dapat MEMBACA tokonya sendiri', async () => {
    const res = resTiruan();
    await status(
      { method: 'GET', query: { tenantId: KEY }, headers: { authorization: `Bearer ${tokenSah}` } } as any,
      res as any
    );
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('token sah tetap dapat MENULIS transaksi tokonya sendiri', async () => {
    const sebelum = await db().query(
      `SELECT COUNT(*)::int n FROM pos.transactions WHERE business_id = $1`, [businessId]);
    const tanda = `sah-${Date.now()}`;
    const res = await kirimSinkron({ authorization: `Bearer ${tokenSah}` }, {
      businessId: KEY, sector: 'FNB', storeName: 'Toko Gerbang', ownerRef: OWNER,
      idempotencyKey: tanda,
      transactions: [{ clientTxnId: tanda, invoiceNumber: 'INV-SAH',
        subtotal: 15000, totalAmount: 15000, paymentMethod: 'CASH',
        paymentStatus: 'COMPLETED', items: [] }],
    });
    const sesudah = await db().query(
      `SELECT COUNT(*)::int n FROM pos.transactions WHERE business_id = $1`, [businessId]);
    expect(res._status).toBe(200);
    expect(sesudah.rows[0].n).toBe(sebelum.rows[0].n + 1);
  });

  it('galat server tidak lagi membocorkan struktur basis data', async () => {
    const res = await kirimSinkron({ authorization: `Bearer ${tokenSah}` }, {
      businessId: KEY, sector: 'FNB', idempotencyKey: `rusak-${Date.now()}`,
      transactions: [{ clientTxnId: `rusak-${Date.now()}`, totalAmount: 'bukan-angka',
        paymentMethod: 'CASH', paymentStatus: 'COMPLETED', items: null }],
    });
    const badan = JSON.stringify(res._body ?? {});
    expect(badan).not.toMatch(/pos\.|column|relation|constraint/i);
  });
});
