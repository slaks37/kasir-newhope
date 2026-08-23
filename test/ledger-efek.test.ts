/**
 * Efek domain: ORDER_PAID dan ORDER_VOIDED menjadi baris ledger.
 *
 * Yang dijaga di sini adalah hal yang paling sulit dilihat dari kode: bahwa
 * produk berbasis RESEP mengurangi bahan bakunya dan BUKAN stok produknya,
 * bahwa jasa tidak mengurangi apa pun, dan bahwa pembatalan mengembalikan
 * sebanyak yang DULU diambil — bukan sebanyak yang seharusnya menurut aturan
 * hari ini.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sinkron from '../api/v1/sync/transactions';
import { ADA_DB, db, tutupDb, resTiruan, bersihkanPemilik, headerToko, hdrUntuk } from './helper-db';

const d = describe.skipIf(!ADA_DB);

// Endpoint toko menolak permintaan tanpa token. Diisi setelah toko ujinya ada.
let HDR: Record<string, string> = {};
const BID = 'usr-ledger_FNB';

d('ORDER_PAID menurunkan efeknya ke ledger', () => {
  let bid = '';
  let idKopi = '', idNasgor = '', idPotong = '', idBeras = '';

  beforeAll(async () => {
    await bersihkanPemilik(BID);
    const b = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Ledger', 'FNB', $1, 'usr-ledger', true) RETURNING id`, [BID]);
    bid = b.rows[0].id;
    HDR = headerToko(bid, BID);

    const buatProduk = async (nama: string, ref: string, mode: string) => {
      const { rows } = await db().query(
        `INSERT INTO pos.products (id, business_id, name, sku, price, cost_price,
                                   business_sector, client_key, external_ref, inventory_mode)
         VALUES (uuidv7(), $1, $2, $3, 20000, 8000, 'FNB', $4, $3, $5::inventory_mode_enum)
         RETURNING id`, [bid, nama, ref, BID, mode]);
      return rows[0].id;
    };

    idKopi   = await buatProduk('Kopi Botol', 'sku-kopi', 'STOCK');
    idNasgor = await buatProduk('Nasi Goreng', 'sku-nasgor', 'RECIPE');
    idPotong = await buatProduk('Potong Rambut', 'sku-potong', 'NONE');

    const bahan = await db().query(
      `INSERT INTO pos.ingredients (id, business_id, name, unit, current_stock, min_stock_alert, cost_price)
       VALUES (uuidv7(), $1, 'Beras', 'gram', 10000, 500, 12) RETURNING id`, [bid]);
    idBeras = bahan.rows[0].id;

    await db().query(
      `INSERT INTO pos.product_recipes (id, business_id, product_id, ingredient_id, quantity_required)
       VALUES (uuidv7(), $1, $2, $3, 150)`, [bid, idNasgor, idBeras]);
  });
  afterAll(tutupDb);

  const kirim = async (items: any[], tag: string, batal = false) => {
    const res = resTiruan();
    await sinkron({
      method: 'POST',
      headers: { ...HDR, 'x-device-id': 'dev-ledger-01' },
      body: {
        businessId: BID, sector: 'FNB', storeName: 'Toko Ledger', ownerRef: 'usr-ledger',
        idempotencyKey: `${tag}-${Date.now()}`,
        transactions: [{
          clientTxnId: tag, invoiceNumber: `INV-${tag}`,
          subtotal: 20000 * items.length, totalAmount: 20000 * items.length,
          paymentStatus: batal ? 'CANCELLED' : 'COMPLETED',
          items,
        }],
      },
    }, res);
    return res._body;
  };

  const item = (ref: string, nama: string, qty = 1) => ({
    productRef: ref, productName: nama, unitPrice: 20000, unitCost: 8000,
    quantity: qty, totalPrice: 20000 * qty,
  });

  const ledger = async (jenis: string, itemId: string) =>
    (await db().query(
      `SELECT COALESCE(SUM(delta),0)::numeric s FROM pos.inventory_ledger
        WHERE business_id = $1 AND item_type = $2 AND item_id = $3`,
      [bid, jenis, itemId])).rows[0].s;

  it('produk STOCK mengurangi stok produknya', async () => {
    await kirim([item('sku-kopi', 'Kopi Botol', 3)], 'txn-stock');
    expect(Number(await ledger('PRODUCT', idKopi))).toBe(-3);
  });

  it('produk RECIPE mengurangi BAHAN BAKU, bukan stok produknya', async () => {
    await kirim([item('sku-nasgor', 'Nasi Goreng', 2)], 'txn-recipe');
    // 2 porsi x 150 gram
    expect(Number(await ledger('INGREDIENT', idBeras))).toBe(-300);
    // Stok produknya TIDAK ikut berkurang — inilah pengurangan ganda yang
    // dihindari inventory_mode.
    expect(Number(await ledger('PRODUCT', idNasgor))).toBe(0);
  });

  it('produk NONE (jasa) tidak menggerakkan persediaan sama sekali', async () => {
    await kirim([item('sku-potong', 'Potong Rambut', 5)], 'txn-jasa');
    expect(Number(await ledger('PRODUCT', idPotong))).toBe(0);
  });

  it('peristiwa dicatat berikut perangkat penerbitnya', async () => {
    const { rows } = await db().query(
      `SELECT event_type, device_ref FROM pos.domain_events
        WHERE business_id = $1 AND event_type = 'ORDER_PAID' LIMIT 1`, [bid]);
    expect(rows[0].event_type).toBe('ORDER_PAID');
    expect(rows[0].device_ref).toBe('dev-ledger-01');
  });

  it('kiriman ulang tidak menghasilkan efek kedua', async () => {
    const sebelum = Number(await ledger('PRODUCT', idKopi));
    await kirim([item('sku-kopi', 'Kopi Botol', 3)], 'txn-stock');
    expect(Number(await ledger('PRODUCT', idKopi))).toBe(sebelum);
  });

  it('saldo server terbaca dari view, bukan dari kolom yang ditimpa', async () => {
    const { rows } = await db().query(
      `SELECT saldo, jumlah_mutasi FROM contract.stock_balance
        WHERE business_id = $1 AND item_id = $2`, [bid, idKopi]);
    expect(Number(rows[0].saldo)).toBe(-3);
    expect(rows[0].jumlah_mutasi).toBe(1);
  });
});

d('ORDER_VOIDED membalik, bukan menghapus', () => {
  let bid = '';
  let idProduk = '';
  const BID2 = 'usr-ledger-void_FNB';

  beforeAll(async () => {
    await bersihkanPemilik(BID2);
    const b = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Void', 'FNB', $1, 'usr-ledger-void', true) RETURNING id`, [BID2]);
    bid = b.rows[0].id;
    HDR = headerToko(bid, BID2);
    const p = await db().query(
      `INSERT INTO pos.products (id, business_id, name, sku, price, cost_price,
                                 business_sector, client_key, external_ref, inventory_mode)
       VALUES (uuidv7(), $1, 'Teh Botol', 'sku-teh', 15000, 5000, 'FNB', $2, 'sku-teh', 'STOCK')
       RETURNING id`, [bid, BID2]);
    idProduk = p.rows[0].id;
  });
  afterAll(tutupDb);

  const kirim = async (batal: boolean) => {
    const res = resTiruan();
    await sinkron({
      method: 'POST',
      headers: HDR,
      body: {
        businessId: BID2, sector: 'FNB', ownerRef: 'usr-ledger-void',
        idempotencyKey: `v-${batal}-${Date.now()}`,
        transactions: [{
          clientTxnId: 'txn-void-1', invoiceNumber: 'INV-VOID-1',
          subtotal: 60000, totalAmount: 60000,
          paymentStatus: batal ? 'CANCELLED' : 'COMPLETED',
          items: [{ productRef: 'sku-teh', productName: 'Teh Botol', unitPrice: 15000,
                    unitCost: 5000, quantity: 4, totalPrice: 60000 }],
        }],
      },
    }, res);
    return res._body;
  };

  it('penjualan mengurangi, pembatalan mengembalikan ke nol', async () => {
    await kirim(false);
    const { rows: a } = await db().query(
      `SELECT COALESCE(SUM(delta),0)::numeric s FROM pos.inventory_ledger WHERE business_id = $1`, [bid]);
    expect(Number(a[0].s)).toBe(-4);

    await kirim(true);
    const { rows: b } = await db().query(
      `SELECT COALESCE(SUM(delta),0)::numeric s FROM pos.inventory_ledger WHERE business_id = $1`, [bid]);
    expect(Number(b[0].s)).toBe(0);
  });

  it('riwayatnya TETAP ada — dua baris, bukan nol', async () => {
    const { rows } = await db().query(
      `SELECT reason, delta FROM pos.inventory_ledger
        WHERE business_id = $1 ORDER BY occurred_at, reason`, [bid]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.reason).sort()).toEqual(['SALE', 'VOID_REVERSAL']);
  });

  it('pembatalan yang diulang tidak membalik dua kali', async () => {
    await kirim(true);
    const { rows } = await db().query(
      `SELECT COALESCE(SUM(delta),0)::numeric s FROM pos.inventory_ledger WHERE business_id = $1`, [bid]);
    expect(Number(rows[0].s)).toBe(0);
  });
});
