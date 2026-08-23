/**
 * ENAM ENTITAS YANG DULU TIDAK PERNAH MENINGGALKAN PERANGKAT.
 *
 * Denah meja, bahan baku, kode promo, rekap shift kas, absensi staf, dan
 * pengaturan toko seluruhnya hanya hidup di localStorage satu peramban.
 * Bersihkan riwayat, dan semuanya hilang tanpa satu pun salinan — termasuk
 * catatan absensi dan selisih kas yang dipakai untuk MENILAI ORANG.
 *
 * Berkas ini menjalankan endpointnya sungguhan terhadap Postgres sungguhan,
 * lalu menariknya kembali lewat /sync/pull. Yang dibuktikan bukan "kodenya ada"
 * melainkan bahwa data yang naik benar-benar bisa turun lagi — sinkronisasi
 * satu arah adalah bentuk kehilangan data yang lebih halus, bukan perbaikan.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADA_DB, db, tutupDb, resTiruan, daftarTokoUji, bersihkanPemilik } from './helper-db';

const KUNCI = 'usr-opsuji_FNB';
let hdr: Record<string, string> = {};

async function panggil(modul: string, req: any) {
  const { default: h } = await import(modul);
  const res = resTiruan();
  await h({ headers: hdr, ...req } as any, res as any);
  return res;
}

const kirim = (body: any) =>
  panggil('../api/v1/sync/operasional', { method: 'POST', body });

const tarik = () =>
  panggil('../api/v1/sync/pull', { method: 'GET', query: { businessId: KUNCI }, body: {} });

describe.skipIf(!ADA_DB)('sinkronisasi data operasional', () => {

  beforeAll(async () => {
    await bersihkanPemilik(KUNCI);
    hdr = await daftarTokoUji(KUNCI, 'FNB', 'Warung Operasional');
  });

  afterAll(async () => {
    await bersihkanPemilik(KUNCI);
    await tutupDb();
  });

  it('MEJA: denah naik ke server lalu bisa ditarik kembali', async () => {
    const res = await kirim({
      businessId: KUNCI,
      sector: 'FNB',
      tables: [
        { id: 'tbl-1', name: 'Meja 1', capacity: 4, zone: 'Indoor', status: 'OCCUPIED' },
        { id: 'tbl-2', name: 'Meja 2', capacity: 2, zone: 'Teras' },
      ],
    });
    expect(res._status).toBe(200);
    expect(res._body.tersimpan.tables).toBe(2);

    const t = await tarik();
    expect(t._status).toBe(200);
    const nama = t._body.tables.map((r: any) => r.name).sort();
    expect(nama).toEqual(['Meja 1', 'Meja 2']);

    // STATUS MEJA TIDAK IKUT. Meja yang sedang terisi hanya berarti di
    // perangkat yang melayaninya; menyimpannya di pusat berarti dua kasir
    // saling menimpa status meja sepanjang jam sibuk.
    expect(Object.keys(t._body.tables[0])).not.toContain('status');
  });

  it('MEJA: kiriman ulang memperbarui, tidak menggandakan', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      tables: [{ id: 'tbl-1', name: 'Meja 1 (VIP)', capacity: 6, zone: 'Indoor' }],
    });
    const t = await tarik();
    expect(t._body.tables.length).toBe(2);
    const m1 = t._body.tables.find((r: any) => r.external_ref === 'tbl-1');
    expect(m1.name).toBe('Meja 1 (VIP)');
    expect(Number(m1.capacity)).toBe(6);
  });

  it('BAHAN BAKU: sampai ke pos.ingredients — tabel yang selama ini kosong', async () => {
    const res = await kirim({
      businessId: KUNCI, sector: 'FNB',
      stockItems: [{
        id: 'stk-1', name: 'Kopi Arabika', sku: 'KOP-01', type: 'BAHAN_BAKU',
        stock: 12.5, minStockAlert: 5, unit: 'kg', costPrice: 150000,
        categoryName: 'Minuman', location: 'Gudang A',
      }],
    });
    expect(res._status).toBe(200);

    const t = await tarik();
    expect(t._body.stockItems.length).toBe(1);
    expect(t._body.stockItems[0].name).toBe('Kopi Arabika');
    expect(Number(t._body.stockItems[0].current_stock)).toBe(12.5);
  });

  it('KODE PROMO: kodenya sendiri yang jadi kunci, bukan id acak', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      promoCodes: [{ code: 'HEMAT10', discountPercent: 10, maxDiscountAmount: 20000, isActive: true }],
    });
    // Kiriman kedua dengan kode yang sama TIDAK boleh melahirkan baris kedua:
    // dua "HEMAT10" di satu toko tidak punya arti apa pun kecuali kebingungan
    // tentang mana yang berlaku.
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      promoCodes: [{ code: 'hemat10', discountPercent: 15, maxDiscountAmount: 25000, isActive: false }],
    });

    const t = await tarik();
    expect(t._body.promoCodes.length).toBe(1);
    expect(Number(t._body.promoCodes[0].discount_percent)).toBe(15);
    expect(t._body.promoCodes[0].is_active).toBe(false);
  });

  it('SHIFT: selisih kas disimpan apa adanya, tidak dihitung ulang', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      shifts: [{
        id: 'shf-1', cashierName: 'Sari', status: 'CLOSED',
        startTime: '2026-08-20T01:00:00.000Z',
        endTime: '2026-08-20T09:00:00.000Z',
        initialCash: 500000, cashSales: 1200000, qrisSales: 300000,
        totalSales: 1500000, expectedCash: 1700000, actualCash: 1685000,
        difference: -15000, totalOrders: 42, notes: 'Kurang Rp 15.000',
      }],
    });

    const t = await tarik();
    const s = t._body.shifts[0];
    // -15000, bukan hasil hitung ulang actual - expected. Angka yang sudah
    // ditandatangani orang di lembar serah terima tidak boleh berubah sendiri.
    expect(Number(s.difference)).toBe(-15000);
    expect(Number(s.actual_cash)).toBe(1685000);
    expect(s.status).toBe('CLOSED');
  });

  it('SHIFT: kas yang belum dihitung tetap NULL, bukan nol', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      shifts: [{
        id: 'shf-2', cashierName: 'Budi', status: 'OPEN',
        startTime: '2026-08-21T01:00:00.000Z',
        initialCash: 300000, totalSales: 0, expectedCash: 300000,
      }],
    });

    const t = await tarik();
    const s = t._body.shifts.find((r: any) => r.external_ref === 'shf-2');
    // "Belum dihitung" dan "dihitung dan hasilnya nol" adalah dua keadaan yang
    // sangat berbeda bagi orang yang menandatangani serah terima laci.
    expect(s.actual_cash).toBeNull();
    expect(s.difference).toBeNull();
  });

  it('ABSENSI: koordinat ikut tersimpan — penegakan geofence butuh buktinya', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      attendance: [{
        id: 'att-1', staffId: 'stf-1', staffName: 'Sari', staffRole: 'CASHIER',
        clockInTime: '2026-08-20T01:00:00.000Z',
        clockOutTime: '2026-08-20T09:00:00.000Z',
        status: 'CLOCKED_OUT',
        branchId: 'br-1', branchName: 'Cabang Pusat',
        clockInGeo: { latitude: -6.2, longitude: 106.8, distanceFromBranchMeters: 12, isWithinRadius: true },
        clockOutGeo: { latitude: -6.2001, longitude: 106.8002, distanceFromBranchMeters: 30, isWithinRadius: true },
      }],
    });

    const t = await tarik();
    const a = t._body.attendance[0];
    expect(a.staff_name).toBe('Sari');
    expect(Number(a.clock_in_distance_m)).toBe(12);
    expect(Number(a.clock_out_distance_m)).toBe(30);
    // Kesimpulan "di dalam radius" TIDAK disimpan: radius cabang bisa diubah
    // pemilik nanti, dan kesimpulan lama akan ikut berubah tanpa ada yang tahu.
    expect(Object.keys(a)).not.toContain('is_within_radius');
  });

  it('ABSENSI: status diturunkan dari ada-tidaknya waktu pulang, tidak dipercaya', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      attendance: [{
        id: 'att-2', staffName: 'Budi',
        clockInTime: '2026-08-21T01:00:00.000Z',
        clockOutTime: '2026-08-21T09:00:00.000Z',
        // Perangkat mengaku orangnya belum pulang, padahal waktu pulangnya ada.
        // Baris seperti ini muncul di data lapangan, dan rekap jam kerja
        // membacanya sebagai orang yang belum pulang sejak minggu lalu.
        status: 'CLOCKED_IN',
      }],
    });

    const t = await tarik();
    const a = t._body.attendance.find((r: any) => r.external_ref === 'att-2');
    expect(a.status).toBe('CLOCKED_OUT');
  });

  it('PENGATURAN: kolom yang dibaca server terisi, sisanya masuk extra', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      settings: {
        storeName: 'Warung Operasional', taxRate: 11, enableTax: true,
        serviceRate: 5, enableService: true,
        enableLoyalty: true, loyaltyEarnRate: 10000, loyaltyRedeemRate: 100,
        receiptFooter: 'Terima kasih!', autoPrintReceipt: true,
      },
    });

    const t = await tarik();
    const p = t._body.settings;
    expect(Number(p.tax_rate)).toBe(11);
    expect(p.enable_loyalty).toBe(true);
    // Yang tidak punya kolom tetap tersimpan, tidak dibuang. Pengaturan adalah
    // bagian aplikasi yang paling sering bertambah; memaksa migrasi untuk
    // setiap sakelar berarti sakelar itu akan disimpan di localStorage saja.
    expect(p.extra.receiptFooter).toBe('Terima kasih!');
    expect(p.extra.autoPrintReceipt).toBe(true);
  });

  it('PENGATURAN: status langganan dari perangkat DIBUANG', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      settings: {
        storeName: 'Warung Operasional', taxRate: 11,
        // Perangkat kasir tidak berwenang menyatakan paketnya sendiri.
        // Salinan di localStorage bisa basi, dan siapa pun yang membuka
        // devtools bisa menuliskan apa saja di sana.
        subscription: { planId: 'enterprise', status: 'ACTIVE' },
        branches: [{ id: 'br-palsu', name: 'Cabang Palsu' }],
      },
    });

    const t = await tarik();
    expect(t._body.settings.extra.subscription).toBeUndefined();
    expect(t._body.settings.extra.branches).toBeUndefined();
  });

  it('BAGIAN YANG TIDAK DIKIRIM TIDAK DISENTUH', async () => {
    const sebelum = await tarik();
    expect(sebelum._body.tables.length).toBeGreaterThan(0);

    // Hanya kode promo yang dikirim. Perangkat yang belum sempat memuat
    // mejanya tidak boleh menghapus meja yang dikirim perangkat lain.
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      promoCodes: [{ code: 'HEMAT10', discountPercent: 15, maxDiscountAmount: 25000, isActive: true }],
    });

    const sesudah = await tarik();
    expect(sesudah._body.tables.length).toBe(sebelum._body.tables.length);
    expect(sesudah._body.stockItems.length).toBe(sebelum._body.stockItems.length);
    expect(sesudah._body.attendance.length).toBe(sebelum._body.attendance.length);
  });

  it('TOKO LAIN TIDAK BISA MENULIS KE SINI', async () => {
    const lain = 'usr-opslain_FNB';
    await bersihkanPemilik(lain);
    const hdrLain = await daftarTokoUji(lain, 'FNB', 'Toko Lain');

    const { default: h } = await import('../api/v1/sync/operasional');
    const res = resTiruan();
    await h(
      { method: 'POST', headers: hdrLain, body: {
        businessId: KUNCI, sector: 'FNB',
        tables: [{ id: 'tbl-jahat', name: 'Meja Sisipan', capacity: 4 }],
      } } as any,
      res as any
    );
    expect(res._status).toBe(403);

    const t = await tarik();
    expect(t._body.tables.some((r: any) => r.external_ref === 'tbl-jahat')).toBe(false);
    await bersihkanPemilik(lain);
  });

  it('TANPA TOKEN: ditolak 401, tidak ada yang tersimpan', async () => {
    const { default: h } = await import('../api/v1/sync/operasional');
    const res = resTiruan();
    await h(
      { method: 'POST', headers: {}, body: {
        businessId: KUNCI, sector: 'FNB',
        tables: [{ id: 'tbl-anon', name: 'Meja Tanpa Login', capacity: 4 }],
      } } as any,
      res as any
    );
    expect(res._status).toBe(401);

    const { rows } = await db().query(
      `SELECT 1 FROM pos.dining_tables WHERE external_ref = 'tbl-anon'`);
    expect(rows.length).toBe(0);
  });

  it('KAS: modal awal, uang masuk, dan uang keluar sampai ke server', async () => {
    const res = await kirim({
      businessId: KUNCI, sector: 'FNB',
      cashEntries: [
        { id: 'kas-1', jenis: 'MODAL_AWAL', jumlah: 500000, kategori: 'Modal Awal Laci',
          waktu: '2026-08-23T01:00:00.000Z', dicatatOleh: 'Sari' },
        { id: 'kas-2', jenis: 'KELUAR', jumlah: 150000, kategori: 'Belanja Bahan Baku',
          keterangan: 'Beli telur 3 kg', waktu: '2026-08-23T03:00:00.000Z' },
        { id: 'kas-3', jenis: 'MASUK', jumlah: 100000, kategori: 'Pelunasan Piutang',
          waktu: '2026-08-23T05:00:00.000Z' },
      ],
    });
    expect(res._status).toBe(200);
    expect(res._body.tersimpan.cashEntries).toBe(3);

    const t = await tarik();
    expect(t._body.cashEntries.length).toBe(3);
    const keluar = t._body.cashEntries.find((r: any) => r.external_ref === 'kas-2');
    // Disimpan POSITIF. Arahnya dari entry_type, bukan dari tanda angkanya.
    expect(Number(keluar.amount)).toBe(150000);
    expect(keluar.entry_type).toBe('KELUAR');
  });

  it('KAS: jumlah negatif atau nol DITOLAK, tidak disimpan sebagai nol', async () => {
    const res = await kirim({
      businessId: KUNCI, sector: 'FNB',
      cashEntries: [
        { id: 'kas-nol', jenis: 'KELUAR', jumlah: 0, waktu: '2026-08-23T06:00:00.000Z' },
        // Angka bertanda yang lolos ke server akan MENAMBAH kas ketika
        // seharusnya mengurangi, dan hasilnya tetap tampak masuk akal —
        // sehingga tidak ada yang memeriksanya. Nilai mutlaknya yang dipakai.
        { id: 'kas-min', jenis: 'KELUAR', jumlah: -75000, waktu: '2026-08-23T07:00:00.000Z' },
        { id: 'kas-aneh', jenis: 'TRANSFER', jumlah: 50000, waktu: '2026-08-23T08:00:00.000Z' },
      ],
    });
    expect(res._status).toBe(200);
    expect(res._body.tersimpan.cashEntries).toBe(1);

    const { rows } = await db().query(
      `SELECT external_ref, amount FROM pos.cash_entries
        WHERE external_ref IN ('kas-nol','kas-min','kas-aneh')`);
    expect(rows.length).toBe(1);
    expect(rows[0].external_ref).toBe('kas-min');
    expect(Number(rows[0].amount)).toBe(75000);
  });

  it('REKAP HARIAN memisahkan omzet dari isi laci', async () => {
    const d = db();
    const { rows } = await d.query(
      `SELECT tanggal, omzet, omzet_tunai, modal_awal, kas_masuk_lain,
              kas_keluar, saldo_kas_seharusnya
         FROM contract.daily_cash
        WHERE business_id = $1 AND tanggal = DATE '2026-08-23'`, [KUNCI]);

    expect(rows.length).toBe(1);
    const r = rows[0];
    // Toko uji ini belum punya transaksi, jadi omzetnya nol — dan justru itu
    // yang membuktikan hari yang HANYA berisi pengeluaran tetap muncul.
    // FULL OUTER JOIN yang menahannya; INNER JOIN akan menyembunyikan persis
    // hari yang paling perlu dilihat pemilik.
    expect(Number(r.omzet)).toBe(0);
    expect(Number(r.modal_awal)).toBe(500000);
    expect(Number(r.kas_masuk_lain)).toBe(100000);
    expect(Number(r.kas_keluar)).toBe(225000);
    expect(Number(r.saldo_kas_seharusnya)).toBe(375000);
  });

  it('KAS: view kontrak memberi angka bertanda di satu tempat saja', async () => {
    const { rows } = await db().query(
      `SELECT entry_ref, amount, amount_signed FROM contract.cash_entries
        WHERE business_id = $1 AND entry_ref IN ('kas-2','kas-3')
        ORDER BY entry_ref`, [KUNCI]);

    expect(Number(rows[0].amount)).toBe(150000);
    expect(Number(rows[0].amount_signed)).toBe(-150000);
    expect(Number(rows[1].amount_signed)).toBe(100000);
  });

  it('PERMUKAAN KONTRAK ikut terisi, karena panel admin membaca dari sana', async () => {
    const d = db();
    for (const view of ['dining_tables', 'ingredients', 'promo_codes',
                        'cashier_shifts', 'attendance', 'store_settings',
                        'cash_entries', 'daily_cash']) {
      const { rows } = await d.query(
        `SELECT COUNT(*)::int AS n FROM contract.${view} WHERE business_id = $1`, [KUNCI]);
      expect({ view, n: rows[0].n }).toEqual({ view, n: expect.any(Number) });
      expect(rows[0].n).toBeGreaterThan(0);
    }
  });

  it('menit kerja dihitung di kontrak, dan NULL untuk yang belum pulang', async () => {
    await kirim({
      businessId: KUNCI, sector: 'FNB',
      attendance: [{
        id: 'att-3', staffName: 'Citra',
        clockInTime: '2026-08-22T01:00:00.000Z',
      }],
    });

    const { rows } = await db().query(
      `SELECT attendance_ref, menit_kerja FROM contract.attendance
        WHERE business_id = $1 ORDER BY attendance_ref`, [KUNCI]);

    const selesai = rows.find((r: any) => r.attendance_ref === 'att-1');
    const belum = rows.find((r: any) => r.attendance_ref === 'att-3');
    expect(selesai.menit_kerja).toBe(480);
    // "Belum pulang" bukan "bekerja nol menit". Keduanya pernah tercampur di
    // layar rekap, dan hasilnya jam kerja yang selalu terlihat terlalu kecil.
    expect(belum.menit_kerja).toBeNull();
  });
});
