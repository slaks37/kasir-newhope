/**
 * Kueri panel admin harus benar-benar BISA DIJALANKAN.
 *
 * Yang sudah ada hanya memeriksa bahwa nama tiap view kontrak DISEBUT di
 * dokumentasi. Itu tidak menangkap apa pun tentang bentuknya — dan bentuk
 * adalah tempat kerusakan sesungguhnya terjadi:
 *
 *   - 0033 membangun ulang contract.transaction_log untuk mengganti rujukan
 *     pos.users, dan sambil lalu menghapus `id`, `merchant_id`,
 *     `merchant_name`, serta `item_count`. Halaman Transaksi mengembalikan
 *     galat SQL. Seluruh 302 tes tetap hijau.
 *   - Sebelum itu, /api/admin/merchant-staff membaca
 *     pos.businesses.external_ref yang sudah lama berganti nama menjadi
 *     client_key. Rusak entah sejak kapan, tanpa ada yang tahu.
 *
 * Keduanya jenis kerusakan yang sama: pembaca dan yang dibaca berpisah jalan,
 * dan tidak ada satu pun galat sampai ada orang membuka halamannya.
 *
 * Berkas ini menjalankan kueri panel yang sesungguhnya — repo-nya, bukan
 * salinan SQL di sini, supaya yang diuji memang yang dipakai.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { ADA_DB, db, tutupDb } from './helper-db';
import * as repo from '../src/server/repo';
import { staffMerchant } from '../src/server/internalUsersRepo';
import { poolSebagaiDb } from '../api/_lib/adminContext';

const d = describe.skipIf(!ADA_DB);

d('kueri panel admin berjalan di skema sekarang', () => {
  afterAll(tutupDb);

  const bagi = () => poolSebagaiDb(db() as any);

  it('daftar transaksi — kolom yang dibaca panel masih ada', async () => {
    const hasil = await repo.transactionLog(bagi(), { limit: 5 });
    expect(Array.isArray(hasil.rows)).toBe(true);
    if (hasil.rows.length) {
      // Bukan sekadar "kuerinya jalan": inilah kolom yang dirender halamannya.
      for (const k of ['id', 'invoice_number', 'merchant_name', 'client_key', 'item_count']) {
        expect(Object.keys(hasil.rows[0]), `kolom ${k} hilang`).toContain(k);
      }
    }
  });

  it('transaction_log tidak memuat struk yang dibatalkan', async () => {
    // Panel mengandalkan penyaringan itu terjadi SEKALI, di merchant_revenue.
    const { rows } = await db().query(
      `SELECT COUNT(*)::int n FROM contract.transaction_log
        WHERE payment_status = 'CANCELLED'`
    );
    expect(rows[0].n).toBe(0);
  });

  it('transaction_status memuat semuanya, termasuk yang dibatalkan', async () => {
    // Tanpa view ini, void rate mustahil dihitung dari permukaan kontrak.
    const semua = await db().query(`SELECT COUNT(*)::int n FROM contract.transaction_status`);
    const hidup = await db().query(`SELECT COUNT(*)::int n FROM contract.transaction_log`);
    expect(semua.rows[0].n).toBeGreaterThanOrEqual(hidup.rows[0].n);

    const kolom = await db().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='contract' AND table_name='transaction_status'`
    );
    expect(kolom.rows.map((r: any) => r.column_name)).toContain('payment_status');
  });

  it('staf merchant — kueri panel berjalan', async () => {
    const hasil = await staffMerchant(bagi(), { limit: 5 });
    expect(typeof hasil.total).toBe('number');
  });

  it('sisa kueri daftar panel juga berjalan', async () => {
    const b = bagi();
    // Satu baris per halaman panel. Yang gagal akan menyebut namanya sendiri.
    const halaman: Array<[string, () => Promise<unknown>]> = [
      ['sectorSummary', () => repo.sectorSummary(b)],
      ['platformTotals', () => repo.platformTotals(b)],
      ['dailyRevenue', () => repo.dailyRevenue(b)],
      ['merchants', () => repo.merchantDirectory(b, { limit: 5 })],
      ['catalog', () => repo.catalog(b, { limit: 5 })],
      ['productSales', () => repo.productSales(b, { limit: 5 })],
      ['activity', () => repo.activityLog(b, { limit: 5 })],
      ['activityBreakdown', () => repo.activityBreakdown(b)],
      ['branches', () => repo.branches(b, { limit: 5 })],
      ['bundles', () => repo.bundles(b, { limit: 5 })],
      ['rawMaterials', () => repo.rawMaterials(b, { limit: 5 })],
      ['productRecipes', () => repo.productRecipes(b, { limit: 5 })],
    ];
    for (const [nama, jalankan] of halaman) {
      await expect(jalankan(), `kueri ${nama} gagal`).resolves.toBeDefined();
    }
  });
});
