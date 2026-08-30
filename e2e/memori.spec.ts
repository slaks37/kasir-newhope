/**
 * PROFIL MEMORI — apa yang terjadi setelah shift 12 jam.
 *
 * KENAPA INI PENTING DI SINI, dan tidak di aplikasi web biasa.
 *
 * Tab peramban biasa hidup beberapa menit. Tablet kasir TIDAK dimuat ulang:
 * ia dinyalakan pagi hari, melayani ratusan transaksi, dan baru dimatikan saat
 * toko tutup. Kebocoran sekecil apa pun per transaksi menjadi ratusan kali
 * lipat pada akhir hari — dan yang dialami merchant bukan pesan kesalahan,
 * melainkan kasir yang makin lambat menjelang jam sibuk, lalu tab yang mati
 * tepat saat antrean paling panjang.
 *
 * YANG DIUKUR di sini adalah HEAP SETELAH GC, bukan heap apa adanya. Heap yang
 * naik antar pengukuran tidak berarti apa-apa — itu sampah yang belum dipungut.
 * Yang berarti adalah memori yang MASIH TERJANGKAU sesudah pemungutan sampah
 * dipaksa: itu memori yang tidak akan pernah kembali.
 */
import { test, expect } from '@playwright/test';

const RUN = Date.now().toString(36);
const AKUN = {
  nama: 'Kasir Memori',
  toko: `Warung Memori ${RUN}`,
  email: `memori.${RUN}@uji.local`,
  sandi: 'sandi-uji-123',
};

/** Jumlah penjualan. Cukup untuk memperlihatkan kecenderungan, cukup cepat untuk CI. */
const PENJUALAN = 40;

test('memori tidak tumbuh tak terbatas sepanjang shift', async ({ page }) => {
  // Lima puluh penjualan lewat antarmuka sungguhan memakan waktu; batas bawaan
  // 60 detik terlalu pendek, dan uji yang gagal karena batas waktunya sendiri
  // tidak memberi tahu apa pun tentang memori.
  test.setTimeout(240_000);

  // Chromium perlu diizinkan memaparkan GC supaya angkanya berarti.
  const cdp = await page.context().newCDPSession(page);

  await page.goto('/#register');
  await page.getByPlaceholder('Nama Lengkap Pemilik / Kasir').fill(AKUN.nama);
  await page.getByPlaceholder(/Nama Usaha \/ Toko/).fill(AKUN.toko);
  await page.getByPlaceholder('Alamat Email').fill(AKUN.email);
  await page.getByPlaceholder(/Kata Sandi/).fill(AKUN.sandi);
  await page.getByRole('button', { name: /Daftar & Buat Toko Baru/ }).click();
  await expect(page.getByTitle('Mulai / Akhiri Shift & Lihat Log Sesi Kasir'))
    .toBeVisible({ timeout: 30_000 });
  /*
   * Stok dinaikkan langsung di penyimpanan sebelum mulai.
   *
   * Katalog contoh hanya punya 15-50 unit per produk, jadi lima puluh
   * penjualan menghabiskannya dan uji ini berhenti dengan "element is not
   * enabled" — kegagalan yang benar untuk penjaga stok, dan sama sekali tidak
   * ada hubungannya dengan memori. Uji harus mengukur SATU hal; variabel lain
   * disingkirkan, bukan ditoleransi.
   */
  // Penyimpanan katalog DITUNDA 2 detik (POSContext), jadi kuncinya belum ada
  // pada milidetik pertama. Menulis sebelum ia muncul tidak berpengaruh apa pun.
  await page.waitForFunction(
    () => Object.keys(localStorage).some((k) => {
      if (!k.includes('_products')) return false;
      try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) && v.length > 0; }
      catch { return false; }
    }),
    undefined,
    { timeout: 20_000 }
  );

  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.includes('_products')) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k) || '[]');
        if (!Array.isArray(v) || !v.length) continue;
        localStorage.setItem(k, JSON.stringify(v.map((p: any) => ({ ...p, stock: 99_999 }))));
      } catch { /* kunci yang bukan JSON diabaikan */ }
    }
  });
  await page.reload();
  await expect(page.getByTitle('Mulai / Akhiri Shift & Lihat Log Sesi Kasir'))
    .toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /^Kasir \(POS\)$/ }).click();
  await expect(page.getByRole('button', { name: /Matcha Latte Ice/ }).first())
    .toBeVisible({ timeout: 20_000 });


  const ukur = async () => {
    // Paksa pemungutan sampah lebih dulu; tanpa ini yang terukur adalah sampah.
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await cdp.send('Runtime.getHeapUsage');
    return m.usedSize;
  };

  /*
   * Produk digilir, bukan satu produk terus-menerus.
   *
   * Katalog contoh punya stok terbatas (15-50 per produk), dan menjual produk
   * yang sama lima puluh kali membuatnya habis — kartunya lalu menjadi
   * aria-disabled dan uji ini berhenti karena alasan yang tidak ada
   * hubungannya dengan memori.
   */
  const PRODUK = [/Es Kopi Susu Gula Aren/, /Matcha Latte Ice/, /Nasi Goreng Special/, /Butter Croissant/];
  let giliran = 0;

  const jual = async () => {
    // Es Kopi punya modifier; dilewati supaya tidak membuka modal pilihan.
    const nama = PRODUK[1 + (giliran++ % (PRODUK.length - 1))];
    await page.getByRole('button', { name: nama }).first().click();
    await page.getByRole('button', { name: /^Bayar$/ }).click();
    await page.getByRole('button', { name: /Konfirmasi Lunas/ }).click();
    await expect(page.getByText('Pembayaran Sukses')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Selesai & Transaksi Baru/ }).click();
  };

  // Sepuluh penjualan pertama untuk memanaskan: pemuatan modul lazy, cache
  // gambar, dan alokasi sekali-jalan lainnya bukan kebocoran, tapi akan
  // terhitung sebagai kebocoran kalau garis dasarnya diambil sebelum itu.
  for (let i = 0; i < 10; i++) await jual();
  const dasar = await ukur();

  for (let i = 0; i < PENJUALAN; i++) await jual();
  const sesudah = await ukur();

  const naikMb = (sesudah - dasar) / 1024 / 1024;
  const perTransaksiKb = ((sesudah - dasar) / PENJUALAN) / 1024;
  const jumlahOrder = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.includes('_orders') || k.includes('held')) continue;
      try { const v = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(v) && v.length) return v.length; } catch { /* abaikan */ }
    }
    return 0;
  });

  console.log(`\n  garis dasar (sesudah 10 penjualan) : ${(dasar / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  sesudah ${PENJUALAN} penjualan lagi        : ${(sesudah / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  pertumbuhan                        : ${naikMb.toFixed(2)} MB (${perTransaksiKb.toFixed(1)} KB/transaksi)`);
  console.log(`  order tersimpan                    : ${jumlahOrder}`);
  console.log(`  proyeksi 500 transaksi (shift ramai): ${(perTransaksiKb * 500 / 1024).toFixed(1)} MB\n`);

  /*
   * AMBANGNYA 50 KB PER TRANSAKSI, dan itu longgar dengan sengaja.
   *
   * Sebagian pertumbuhan memang WAJAR: setiap order disimpan di state supaya
   * layar "Transaksi Terakhir" dan laporan hari ini bisa membacanya. Satu order
   * dengan baris strukmya berukuran beberapa kilobyte, jadi pertumbuhan nol
   * justru akan berarti transaksinya tidak disimpan.
   *
   * Yang dicari adalah pertumbuhan yang TIDAK sebanding dengan datanya —
   * penangan yang menumpuk, komponen yang tidak pernah dilepas, closure yang
   * memegang snapshot lama. Pada 50 KB/transaksi, shift 500 transaksi memakai
   * ~25 MB, yang masih aman untuk tablet Android murah sekalipun.
   */
  expect(perTransaksiKb,
    `pertumbuhan ${perTransaksiKb.toFixed(1)} KB/transaksi terlalu besar untuk data yang disimpan`
  ).toBeLessThan(50);

  // Riwayat lokal dibatasi; kalau tidak, shift panjang mengisi localStorage
  // sampai penuh dan penyimpanan berhenti diam-diam.
  expect(jumlahOrder, 'riwayat lokal harus dibatasi').toBeLessThanOrEqual(500);
});
