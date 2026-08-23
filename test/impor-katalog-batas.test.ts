/**
 * Batas produk pada jalur impor katalog.
 *
 * KENAPA INI PENTING JUSTRU SEKARANG. Sebelum fitur impor menu dibangun,
 * api/v1/sync/catalog.ts menyisipkan apa pun yang dikirim tanpa memeriksa
 * paket sama sekali — penegakan hanya ada di jalur transaksi. Fitur yang
 * menjanjikan "100 produk sekali unggah" akan menjadi jalan memutar
 * mengelilingi seluruh paywall, lewat tombol yang kami sediakan sendiri.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sinkronKatalog from '../api/v1/sync/catalog';
import { ADA_DB, db, tutupDb, merchantUji, pasangPaket, resTiruan, bersihkanPemilik, headerToko, daftarTokoUji } from './helper-db';

const d = describe.skipIf(!ADA_DB);

// Endpoint toko menolak permintaan tanpa token. Diisi setelah toko ujinya ada.
let HDR: Record<string, string> = {};

d('batas produk saat impor katalog', () => {
  const BID = 'usr-uji-impor_FNB';
  let tid = '';

  beforeAll(async () => {
    tid = await merchantUji(BID, 'Toko Uji Impor');
    HDR = headerToko(tid, BID);
  });
  afterAll(tutupDb);

  const kirim = async (jumlah: number, tag: string) => {
    const res = resTiruan();
    await sinkronKatalog({ method: 'POST', headers: HDR,
      body: {
        businessId: BID, sector: 'FNB', storeName: 'Toko Uji Impor',
        products: Array.from({ length: jumlah }, (_, i) => ({
          id: `${tag}-${i}`, name: `Produk ${tag} ${i}`, price: 10_000 + i,
        })),
      },
    }, res);
    return res._body;
  };

  const jumlahProduk = async () =>
    (await db().query('SELECT COUNT(*)::int n FROM pos.products WHERE business_id = $1', [tid]))
      .rows[0].n as number;

  it('paket Free menahan produk di atas batasnya', async () => {
    await pasangPaket(tid, 'plan-free');
    const batas = Number((await db().query(
      `SELECT product_limit FROM billing.plans WHERE id = 'plan-free'`)).rows[0].product_limit);

    const h = await kirim(batas + 25, 'a');
    expect(h.ok).toBe(true);
    expect(h.productLimit).toBe(batas);
    expect(await jumlahProduk()).toBe(batas);
    expect(h.held.length).toBe(25);
  });

  it('yang ditahan DISEBUT NAMANYA, bukan sekadar dihitung', async () => {
    // Merchant yang mengimpor 100 produk dan menerima "80 tersimpan" tanpa tahu
    // dua puluh mana yang hilang akan mengira sistemnya rusak.
    const h = await kirim(5, 'b');
    expect(Array.isArray(h.held)).toBe(true);
    for (const nama of h.held) expect(typeof nama).toBe('string');
    expect(h.message).toContain('batas paket');
  });

  it('produk yang SUDAH ada tetap bisa diperbarui walau batas terlampaui', async () => {
    // Menahan penyuntingan saat batas penuh berarti merchant tidak bisa
    // memperbaiki harga yang salah — justru yang paling mendesak.
    const sebelum = await jumlahProduk();
    const res = resTiruan();
    await sinkronKatalog({ method: 'POST', headers: HDR,
      body: {
        businessId: BID, sector: 'FNB',
        products: [{ id: 'a-0', name: 'Produk a 0', price: 99_000 }],
      },
    }, res);
    expect(res._body.held).toEqual([]);
    expect(await jumlahProduk()).toBe(sebelum);

    const { rows } = await db().query(
      `SELECT price FROM pos.products WHERE business_id = $1 AND name = 'Produk a 0'`, [tid]);
    expect(Number(rows[0].price)).toBe(99_000);
  });

  it('naik paket membuka sisanya', async () => {
    await pasangPaket(tid, 'plan-pro-monthly');   // product_limit = -1
    const sebelum = await jumlahProduk();
    const h = await kirim(40, 'c');
    expect(h.held).toEqual([]);
    expect(h.productLimit).toBe(-1);
    expect(await jumlahProduk()).toBe(sebelum + 40);
  });

  it('merchant tanpa langganan memakai batas DARURAT, bukan tanpa batas', async () => {
    const BID2 = 'usr-uji-impor-nosub_FNB';
    const tid2 = await merchantUji(BID2, 'Tanpa Langganan');
    HDR = headerToko(tid2, BID2);
    await db().query(
      `DELETE FROM billing.subscriptions
        WHERE merchant_id = (SELECT merchant_id FROM pos.businesses WHERE id = $1)`, [tid2]);

    const res = resTiruan();
    await sinkronKatalog({ method: 'POST', headers: HDR,
      body: {
        businessId: BID2, sector: 'FNB',
        products: Array.from({ length: 200 }, (_, i) => ({
          id: `d-${i}`, name: `Produk d ${i}`, price: 10_000,
        })),
      },
    }, res);

    const { rows } = await db().query(
      'SELECT COUNT(*)::int n FROM pos.products WHERE business_id = $1', [tid2]);
    // Merchant yang belum berlangganan bukan merchant dengan paket termahal.
    expect(rows[0].n).toBeLessThan(200);
    expect(res._body.held.length).toBeGreaterThan(0);

    // DIBERSIHKAN. Merchant tanpa langganan adalah keadaan yang sengaja dibuat
    // di sini, dan membiarkannya melanggar invarian yang dijaga berkas tes
    // lain ("tidak ada merchant tanpa langganan") — kegagalan yang muncul di
    // berkas yang tidak bersalah dan sangat sulit ditelusuri.
    await bersihkanPemilik(BID2);
  });
});
