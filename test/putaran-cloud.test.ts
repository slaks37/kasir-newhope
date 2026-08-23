/**
 * PUTARAN PENUH: DAFTAR -> KIRIM -> AMBIL KEMBALI.
 *
 * Sebelum ini sinkronisasi SATU ARAH. Aplikasi mengirim katalog, cabang, dan
 * transaksi ke server, tetapi tidak pernah mengambil apa pun kembali —
 * sehingga semua yang tampak di layar sebenarnya hanya ada di penyimpanan
 * perangkat itu sendiri:
 *
 *   - Menyiapkan katalog di laptop, membuka aplikasi di ponsel: toko kosong.
 *   - Kasir kedua di toko yang sama: katalognya sendiri, terpisah.
 *   - Riwayat peramban dibersihkan: katalog hilang dari pandangan pemiliknya,
 *     padahal datanya masih utuh di server.
 *
 * Yang diuji di sini adalah perjalanan yang sesungguhnya dilalui pemilik baru,
 * dari mendaftar sampai membuka aplikasi di perangkat kedua.
 */

import { describe, it, expect, afterAll } from 'vitest';
import sesi from '../api/v1/auth/session';
import sinkronKatalog from '../api/v1/sync/catalog';
import sinkronTransaksi from '../api/v1/sync/transactions';
import tarik from '../api/v1/sync/pull';
import { ADA_DB, db, tutupDb, resTiruan, bersihkanPemilik, headerToko } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('putaran penuh dengan cloud', () => {
  const KEY = 'usr-putaran_LAUNDRY';
  const OWNER = 'usr-putaran';
  let businessId = '';
  let HDR: Record<string, string> = {};

  afterAll(async () => {
    if (ADA_DB) await bersihkanPemilik(KEY);
    await tutupDb();
  });

  it('1. pemilik baru benar-benar bisa mendaftar', async () => {
    await bersihkanPemilik(KEY);
    const res = resTiruan();
    await sesi({ method: 'POST', headers: {}, body: {
      businessId: KEY, ownerRef: OWNER, storeName: 'Laundry Putaran', sector: 'LAUNDRY',
    } } as any, res as any);

    expect(res._status).toBe(200);
    expect(res._body.token).toMatch(/^m1\./);
    businessId = res._body.businessId;
    HDR = headerToko(businessId, KEY);

    // Tokonya nyata di cloud, lengkap dengan merchant dan langganan percobaan.
    const { rows } = await db().query(
      `SELECT b.name, b.business_sector, b.merchant_id, s.status
         FROM pos.businesses b
         LEFT JOIN billing.subscriptions s ON s.merchant_id = b.merchant_id
        WHERE b.client_key = $1`, [KEY]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Laundry Putaran');
    expect(rows[0].business_sector).toBe('LAUNDRY');
    expect(rows[0].merchant_id).toBeTruthy();
    expect(rows[0].status).toBe('TRIAL');
  });

  it('2. katalog yang disusun pemilik sampai ke cloud', async () => {
    const res = resTiruan();
    await sinkronKatalog({ method: 'POST', headers: HDR, body: {
      businessId: KEY, sector: 'LAUNDRY', storeName: 'Laundry Putaran', ownerRef: OWNER,
      products: [
        { ref: 'cuci-kilo', name: 'Cuci Kiloan', price: 7000, cost: 2500, category: 'Cuci' },
        { ref: 'setrika', name: 'Setrika Saja', price: 5000, cost: 1500, category: 'Setrika' },
      ],
      customers: [
        { ref: 'plg-1', name: 'Bu Ratna', phone: '0812000111', points: 20, totalSpent: 140000 },
      ],
    } } as any, res as any);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('3. transaksi kasir sampai ke cloud', async () => {
    const tanda = `putaran-${Date.now()}`;
    const res = resTiruan();
    await sinkronTransaksi({ method: 'POST', headers: HDR, body: {
      businessId: KEY, sector: 'LAUNDRY', storeName: 'Laundry Putaran', ownerRef: OWNER,
      idempotencyKey: tanda,
      transactions: [{
        clientTxnId: tanda, invoiceNumber: 'INV-PUTARAN-1', cashierName: 'Mbak Sri',
        subtotal: 21000, totalAmount: 21000, paymentMethod: 'CASH', paymentStatus: 'COMPLETED',
        items: [{ productRef: 'cuci-kilo', productName: 'Cuci Kiloan', unitPrice: 7000,
                  unitCost: 2500, quantity: 3, totalPrice: 21000 }],
      }],
    } } as any, res as any);
    expect(res._status).toBe(200);
    expect(res._body.accepted).toBe(1);
  });

  it('4. PERANGKAT BARU menarik seluruh isi tokonya dari cloud', async () => {
    // Perangkat kedua: tidak punya apa pun di penyimpanannya. Yang ia bawa
    // hanya token — persis keadaan pemilik yang membuka aplikasi di ponsel
    // setelah menyiapkan katalog di laptop.
    const res = resTiruan();
    await tarik({ method: 'GET', headers: HDR, query: { businessId: KEY } } as any, res as any);

    expect(res._status).toBe(200);
    const isi = res._body;

    expect(isi.business.storeName).toBe('Laundry Putaran');
    expect(isi.business.sector).toBe('LAUNDRY');

    const namaProduk = isi.products.map((p: any) => p.product_name).sort();
    expect(namaProduk).toEqual(['Cuci Kiloan', 'Setrika Saja']);
    expect(Number(isi.products.find((p: any) => p.product_name === 'Cuci Kiloan').price)).toBe(7000);

    expect(isi.customers.map((c: any) => c.name)).toContain('Bu Ratna');

    expect(isi.transactions).toHaveLength(1);
    expect(isi.transactions[0].invoice_number).toBe('INV-PUTARAN-1');
    expect(isi.transactions[0].cashier_name).toBe('Mbak Sri');
    expect(isi.transactionsTruncated).toBe(false);
  });

  it('5. penarikan menolak token toko lain', async () => {
    const res = resTiruan();
    await tarik(
      { method: 'GET', headers: HDR, query: { businessId: 'usr-oranglain_FNB' } } as any,
      res as any
    );
    expect(res._status).toBe(403);
  });

  it('6. penarikan tanpa token ditolak', async () => {
    const res = resTiruan();
    await tarik({ method: 'GET', headers: {}, query: { businessId: KEY } } as any, res as any);
    expect(res._status).toBe(401);
    expect(JSON.stringify(res._body)).not.toContain('Cuci Kiloan');
  });

  it('7. struk yang dibatalkan tidak ikut tertarik sebagai penjualan', async () => {
    const tanda = `batal-${Date.now()}`;
    const kirim = async (status: string) => {
      const r = resTiruan();
      await sinkronTransaksi({ method: 'POST', headers: HDR, body: {
        businessId: KEY, sector: 'LAUNDRY', ownerRef: OWNER,
        idempotencyKey: `${status}-${tanda}`,
        transactions: [{
          clientTxnId: tanda, invoiceNumber: 'INV-BATAL', subtotal: 9000, totalAmount: 9000,
          paymentMethod: 'CASH', paymentStatus: status, items: [],
        }],
      } } as any, r as any);
      return r;
    };
    await kirim('COMPLETED');
    await kirim('CANCELLED');

    const res = resTiruan();
    await tarik({ method: 'GET', headers: HDR, query: { businessId: KEY } } as any, res as any);
    const nomor = res._body.transactions.map((t: any) => t.invoice_number);
    expect(nomor).not.toContain('INV-BATAL');
    expect(nomor).toContain('INV-PUTARAN-1');
  });
});
