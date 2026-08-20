/**
 * Penegakan batas paket DI SERVER.
 *
 * Ini yang membedakan pembatasan sungguhan dari pembatasan yang hanya
 * menyembunyikan tombol: seluruh tes di berkas ini memanggil handler serverless
 * langsung, persis seperti klien mana pun yang mengirim POST sendiri.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sinkronTransaksi from '../api/v1/sync/transactions';
import sinkronCabang from '../api/v1/sync/branches';
import { ADA_DB, db, tutupDb, merchantUji, pasangPaket, resTiruan } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('batas produk di jalur sinkron', () => {
  const BID = 'usr-uji-produk_FNB';
  let tid = '';

  beforeAll(async () => {
    await db().query('DELETE FROM pos.tenants WHERE external_ref = $1', [BID]);
  });
  afterAll(tutupDb);

  const kirim = async (jumlahProduk: number, tag: string) => {
    const res = resTiruan();
    await sinkronTransaksi({
      method: 'POST',
      body: {
        businessId: BID, sector: 'FNB', storeName: 'Toko Uji Produk', ownerRef: 'usr-uji-produk',
        idempotencyKey: `${tag}-${Date.now()}`,
        transactions: [{
          clientTxnId: `${tag}-${Date.now()}`, invoiceNumber: `INV-${tag}`,
          subtotal: jumlahProduk * 10_000, totalAmount: jumlahProduk * 10_000,
          items: Array.from({ length: jumlahProduk }, (_, i) => ({
            productRef: `sku-${i}`, productName: `Produk ${i}`,
            unitPrice: 10_000, unitCost: 4_000, quantity: 1, totalPrice: 10_000,
          })),
        }],
      },
    }, res);
    return res._body;
  };

  const jumlahProdukKatalog = async () =>
    (await db().query('SELECT COUNT(*)::int n FROM pos.products WHERE tenant_id = $1', [tid])).rows[0].n;

  it('menahan katalog di batas darurat saat merchant belum berlangganan', async () => {
    const hasil = await kirim(40, 'a');
    expect(hasil.ok).toBe(true);
    expect(hasil.productLimit).toBe(30);
    expect(hasil.catalogSkipped).toBe(10);

    tid = hasil.tenantId;
    expect(await jumlahProdukKatalog()).toBe(30);
  });

  it('TIDAK menghilangkan omzet — barisnya tetap masuk tanpa produk katalog', async () => {
    const { rows } = await db().query(
      `SELECT COUNT(*)::int total, COUNT(product_id)::int berkatalog,
              COALESCE(SUM(total_price),0)::numeric omzet
         FROM pos.transaction_items WHERE tenant_id = $1`, [tid]);
    expect(rows[0].total).toBe(40);        // seluruh baris struk ada
    expect(rows[0].berkatalog).toBe(30);   // 10 tanpa produk katalog
    expect(Number(rows[0].omzet)).toBe(400_000);
  });

  it('membuka sisanya setelah naik paket', async () => {
    await pasangPaket(tid, 'plan-pro-monthly');
    const hasil = await kirim(40, 'b');
    expect(hasil.catalogSkipped).toBe(0);
    expect(hasil.productLimit).toBe(-1);
    expect(await jumlahProdukKatalog()).toBe(40);
  });

  it('turun paket menahan produk BARU tanpa menghapus yang lama', async () => {
    await pasangPaket(tid, 'plan-free');
    const res = resTiruan();
    await sinkronTransaksi({
      method: 'POST',
      body: {
        businessId: BID, sector: 'FNB', ownerRef: 'usr-uji-produk',
        idempotencyKey: `c-${Date.now()}`,
        transactions: [{
          clientTxnId: `c-${Date.now()}`, invoiceNumber: 'INV-C',
          subtotal: 10_000, totalAmount: 10_000,
          items: [{ productRef: 'sku-baru-999', productName: 'Produk Baru 999',
                    unitPrice: 10_000, unitCost: 4_000, quantity: 1, totalPrice: 10_000 }],
        }],
      },
    }, res);
    expect(res._body.catalogSkipped).toBe(1);
    expect(await jumlahProdukKatalog()).toBe(40);  // tidak ada yang dihapus
  });
});

d('batas outlet di jalur sinkron', () => {
  const BID = 'usr-uji-outlet_FNB';
  let tid = '';

  beforeAll(async () => {
    tid = await merchantUji(BID, 'Toko Uji Outlet');
  });
  afterAll(tutupDb);

  const cabang = (n: number, aktif = true) => ({
    id: `branch-${n}`, name: `Cabang ${n}`, address: `Jl. Uji ${n}`,
    latitude: -6.2 - n / 100, longitude: 106.8 + n / 100,
    allowedRadiusMeters: 200, businessSector: 'FNB', isActive: aktif,
  });

  const kirim = async (branches: any[], activeBranchRef?: string) => {
    const res = resTiruan();
    await sinkronCabang({ method: 'POST', body: { businessId: BID, branches, activeBranchRef } }, res);
    return res._body;
  };

  it('paket Free menyimpan satu dan MENOLAK sisanya dengan alasannya', async () => {
    await pasangPaket(tid, 'plan-free');
    const h = await kirim([cabang(1), cabang(2), cabang(3)]);
    expect(h.saved).toBe(1);
    expect(h.rejected).toHaveLength(2);
    expect(h.rejected[0].alasan).toContain('1 outlet');
    expect(h.remainingQuota).toBe(0);
  });

  /** Batas dibaca dari katalog, bukan dipatok di tes — katalognya bisa berubah. */
  const batasOutlet = async (planId: string) =>
    Number((await db().query(
      'SELECT max_outlets FROM billing.plans WHERE id = $1', [planId])).rows[0].max_outlets);

  it('membuka bertahap mengikuti paket', async () => {
    const batasPlus = await batasOutlet('plan-plus-monthly');
    await pasangPaket(tid, 'plan-plus-monthly');
    const semua = Array.from({ length: batasPlus + 3 }, (_, i) => cabang(i + 1));
    expect((await kirim(semua)).activeOutlets).toBe(batasPlus);

    const batasPro = await batasOutlet('plan-pro-monthly');
    await pasangPaket(tid, 'plan-pro-monthly');
    expect((await kirim(semua)).activeOutlets).toBe(Math.min(batasPro, semua.length));
  });

  it('menonaktifkan cabang MEMBEBASKAN kuotanya', async () => {
    const batasPro = await batasOutlet('plan-pro-monthly');
    // Penuhi dulu sampai batas, apa pun angkanya.
    await kirim(Array.from({ length: batasPro }, (_, i) => cabang(i + 1)));

    const setelahTutup = await kirim([cabang(batasPro, false)]);
    expect(setelahTutup.activeOutlets).toBe(batasPro - 1);
    expect(setelahTutup.remainingQuota).toBe(1);

    const berikutnya = await kirim([cabang(batasPro + 1)]);
    expect(berikutnya.rejected).toHaveLength(0);
    expect(berikutnya.activeOutlets).toBe(batasPro);
  });

  it('turun paket tidak menghapus cabang lama dan tetap boleh menyuntingnya', async () => {
    await pasangPaket(tid, 'plan-free');
    expect((await kirim([cabang(99)])).rejected).toHaveLength(1);

    const batasPro = Number((await db().query(
      'SELECT max_outlets FROM billing.plans WHERE id = $1', ['plan-pro-monthly'])).rows[0].max_outlets);
    const { rows } = await db().query(
      'SELECT COUNT(*)::int n FROM pos.branches WHERE tenant_id = $1 AND is_active', [tid]);
    expect(rows[0].n).toBe(batasPro);

    const sunting = await kirim([{ ...cabang(1), address: 'Alamat diperbaiki' }]);
    expect(sunting.rejected).toHaveLength(0);
    const alamat = await db().query(
      'SELECT address FROM pos.branches WHERE tenant_id = $1 AND external_ref = $2', [tid, 'branch-1']);
    expect(alamat.rows[0].address).toBe('Alamat diperbaiki');
  });

  it('merchant tanpa langganan dibatasi 1 outlet, bukan tanpa batas', async () => {
    const BID2 = 'usr-nolangganan_FNB';
    await merchantUji(BID2, 'Tanpa Langganan');
    const res = resTiruan();
    await sinkronCabang({ method: 'POST', body: { businessId: BID2, branches: [cabang(1), cabang(2)] } }, res);
    expect(res._body.maxOutlets).toBe(1);
    expect(res._body.saved).toBe(1);
  });
});
