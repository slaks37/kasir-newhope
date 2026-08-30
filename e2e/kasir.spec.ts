/**
 * JALUR KASIR, DARI UJUNG KE UJUNG.
 *
 * buka shift -> pilih produk -> bayar -> struk -> tutup shift
 *
 * KENAPA UJI INI ADA, padahal sudah ada belasan probe lain.
 *
 * Semua probe di scripts/dev/audit/ memeriksa SATU lapisan: byte ESC/POS,
 * kueri SQL, aturan otorisasi, presisi rupiah. Semuanya bisa hijau sementara
 * merchant tidak bisa berjualan sama sekali — tombol Bayar yang tidak
 * tersambung, modal yang tidak terbuka, atau satu galat render yang membuat
 * layar kasir kosong tidak akan terdeteksi oleh satu pun dari uji-uji itu.
 *
 * Uji ini menjalankan aplikasi yang sudah di-build di dalam peramban
 * sungguhan dan melakukan apa yang dilakukan kasir. Ia tidak memeriksa
 * detail; ia memeriksa bahwa jalurnya ADA dan tersambung ujung ke ujung —
 * itulah arti "smoke test".
 *
 * AKUN LOKAL, BUKAN SUPABASE. Tanpa VITE_SUPABASE_URL, AuthContext jatuh ke
 * sesi lokal (lihat createLocalSession). Uji ini karena itu tidak membutuhkan
 * layanan luar mana pun, dan tidak boleh membuatnya: uji yang bergantung pada
 * jaringan pihak ketiga akan gagal karena hal yang tidak ada hubungannya
 * dengan kode ini.
 */
import { test, expect, type Page } from '@playwright/test';

/** Akun berbeda tiap jalan: localStorage dikunci per pengguna. */
const RUN = Date.now().toString(36);
const AKUN = {
  nama: 'Kasir Uji',
  toko: `Warung Uji ${RUN}`,
  email: `kasir.${RUN}@uji.local`,
  sandi: 'sandi-uji-123',
};

async function daftarDanMasuk(page: Page) {
  await page.goto('/#register');
  await page.getByPlaceholder('Nama Lengkap Pemilik / Kasir').fill(AKUN.nama);
  await page.getByPlaceholder(/Nama Usaha \/ Toko/).fill(AKUN.toko);
  await page.getByPlaceholder('Alamat Email').fill(AKUN.email);
  await page.getByPlaceholder(/Kata Sandi/).fill(AKUN.sandi);
  await page.getByRole('button', { name: /Daftar & Buat Toko Baru/ }).click();

  // Sesudah pendaftaran, aplikasi kasir harus muncul. Sidebar adalah penanda
  // paling stabil: ia ada di setiap layar setelah masuk.
  await expect(page.getByRole('button', { name: /Mulai Shift Baru|Mulai \/ Akhiri Shift/ }))
    .toBeVisible({ timeout: 30_000 });
}

test.describe('Jalur kasir', () => {
  test('buka shift, jual, bayar, struk, tutup shift', async ({ page }) => {
    const galat: string[] = [];
    // Galat konsol adalah bagian dari hasil. Layar yang "terlihat benar" sambil
    // melempar TypeError pada setiap render bukan layar yang lulus.
    page.on('pageerror', (e) => galat.push(String(e)));

    await test.step('1. Daftar akun toko baru', async () => {
      await daftarDanMasuk(page);
    });

    await test.step('2. Pastikan shift kasir terbuka', async () => {
      /*
       * Toko yang baru dibuat SUDAH membuka shift sendiri, jadi formulirnya
       * belum tentu muncul. Uji ini menerima keduanya: yang harus dibuktikan
       * adalah shiftnya terbuka, bukan lewat jalan mana ia terbuka. Uji yang
       * memaksakan satu jalan akan gagal karena perubahan yang benar.
       */
      await page.getByRole('button', { name: /Mulai Shift Baru|Mulai \/ Akhiri Shift/ }).click();

      const formShift = page.getByText('Form Mulai Shift Baru');
      if (await formShift.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await page.getByPlaceholder(/Masukkan nama kasir/).fill('Kasir Uji');
        await page.getByPlaceholder('500000').fill('500000');
        await page.getByRole('button', { name: /Mulai Shift Kasir Sekarang/ }).click();
      }

      await page.keyboard.press('Escape');
      await expect(page.getByText(/Shift Terbuka/)).toBeVisible({ timeout: 15_000 });
    });

    await test.step('3. Buka layar Kasir dan masukkan produk ke keranjang', async () => {
      // Aplikasi mendarat di Overview, bukan di kasir. Berpindah dulu.
      await page.getByRole('button', { name: /^Kasir \(POS\)$/ }).click();

      /*
       * Dipilih produk TANPA varian/modifier. Produk bervarian membuka modal
       * pilihan lebih dulu, dan uji asap ini menguji jalur bayar — bukan
       * jalur varian.
       */
      const kartu = page.getByRole('button', { name: /Matcha Latte Ice/ });
      await expect(kartu.first()).toBeVisible({ timeout: 20_000 });
      await kartu.first().click();

      // Keranjang harus menunjukkan total yang bukan nol.
      await expect(page.getByText('Total Bayar:')).toBeVisible({ timeout: 10_000 });
    });

    await test.step('4. Bayar', async () => {
      await page.getByRole('button', { name: /^Bayar$/ }).click();
      await expect(page.getByText('Proses Pembayaran')).toBeVisible({ timeout: 10_000 });

      await page.getByRole('button', { name: /Konfirmasi Lunas/ }).click();
    });

    await test.step('5. Struk muncul', async () => {
      // INI yang membuktikan transaksinya benar-benar diproses: struk hanya
      // dibuat setelah pembayaran tercatat.
      await expect(page.getByText('Pembayaran Sukses')).toBeVisible({ timeout: 15_000 });

      // Struk memuat nomor faktur, bukan tempat kosong.
      await expect(page.getByText(/INV-/).first()).toBeVisible();
    });

    await test.step('6. Tutup struk lalu TUTUP SHIFT sungguhan', async () => {
      await page.getByRole('button', { name: /Selesai & Transaksi Baru/ }).click();

      await page.getByRole('button', { name: /Mulai \/ Akhiri Shift/ }).click();
      await expect(page.getByRole('heading', { name: 'Form Penutupan / Akhiri Shift' }))
        .toBeVisible({ timeout: 15_000 });

      /*
       * Shift ditutup SUNGGUHAN, bukan hanya formulirnya dibuka.
       *
       * Penutupan shift adalah saat kasir mempertanggungjawabkan uang di laci —
       * kalau ia gagal, merchant tidak bisa menutup hari. Uji yang berhenti di
       * "formulirnya muncul" tidak membuktikan apa pun tentang itu.
       */
      await page.getByPlaceholder(/Masukkan total hitungan uang tunai laci/).fill('528000');
      await page.getByRole('button', { name: /Akhiri Shift Kasir Sekarang/ }).click();

      /*
       * Tombol sidebar-nya yang diperiksa, dibedakan lewat `title` — dialog
       * penutupan memuat tombol dengan teks mirip, dan mencocokkan keduanya
       * berarti uji ini lulus hanya karena dialognya masih terbuka.
       */
      await expect(page.getByTitle('Mulai / Akhiri Shift & Lihat Log Sesi Kasir'))
        .toContainText('Status: Ditutup', { timeout: 15_000 });
    });

    expect(galat, `galat JavaScript selama jalur kasir:\n${galat.join('\n')}`).toEqual([]);
  });

  test('penjualan bertahan setelah tablet dimuat ulang', async ({ page }) => {
    /*
     * KENAPA UJI INI TERPISAH.
     *
     * Uji di atas berhenti ketika struk muncul. Struk yang muncul membuktikan
     * transaksinya diproses DI MEMORI — bukan bahwa ia selamat. Tablet kasir
     * dimuat ulang, kehabisan baterai, dan ditutup tanpa peringatan; penjualan
     * yang hanya ada di state React hilang bersamanya, dan tidak ada satu pun
     * uji server yang bisa menangkap itu karena transaksinya memang tidak
     * pernah sampai ke server.
     *
     * Versi pertama uji ini hanya memeriksa `Array.isArray(kunci)` — pernyataan
     * yang tidak mungkin salah, jadi tidak membuktikan apa pun. Sekarang ia
     * menjual sesuatu, memuat ulang halaman, dan menuntut penjualannya masih
     * ada.
     */
    await daftarDanMasuk(page);
    await page.getByRole('button', { name: /^Kasir \(POS\)$/ }).click();

    const kartu = page.getByRole('button', { name: /Matcha Latte Ice/ });
    await expect(kartu.first()).toBeVisible({ timeout: 20_000 });
    await kartu.first().click();
    await page.getByRole('button', { name: /^Bayar$/ }).click();
    await page.getByRole('button', { name: /Konfirmasi Lunas/ }).click();
    await expect(page.getByText('Pembayaran Sukses')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Selesai & Transaksi Baru/ }).click();

    const bacaLokal = () => page.evaluate(() => {
      const hasil: Record<string, number> = {};
      for (const k of Object.keys(localStorage)) {
        if (!k.includes('orders') && !k.includes('sync_queue')) continue;
        try {
          const v = JSON.parse(localStorage.getItem(k) || '[]');
          if (Array.isArray(v)) hasil[k] = v.length;
        } catch { /* kunci yang bukan JSON diabaikan */ }
      }
      return hasil;
    });

    const sebelum = await bacaLokal();
    const adaOrder = Object.entries(sebelum).some(([k, n]) => k.includes('orders') && n > 0);
    expect(adaOrder, `tidak ada order tersimpan: ${JSON.stringify(sebelum)}`).toBe(true);

    // Tablet dimuat ulang.
    await page.reload();
    await expect(page.getByTitle('Mulai / Akhiri Shift & Lihat Log Sesi Kasir'))
      .toBeVisible({ timeout: 30_000 });

    const sesudah = await bacaLokal();
    const masihAda = Object.entries(sesudah).some(([k, n]) => k.includes('orders') && n > 0);
    expect(masihAda, `penjualan hilang setelah muat ulang: ${JSON.stringify(sesudah)}`).toBe(true);

    /*
     * Muat ulang KEDUA. Cacat aslinya hanya menghapus pada muat ulang pertama
     * (setelah itu tidak ada lagi yang tersisa untuk dihapus), jadi uji yang
     * berhenti di muat ulang pertama akan lulus untuk perbaikan yang cuma
     * menunda kerusakan satu putaran.
     */
    await page.reload();
    await expect(page.getByTitle('Mulai / Akhiri Shift & Lihat Log Sesi Kasir'))
      .toBeVisible({ timeout: 30_000 });
    const kedua = await bacaLokal();
    expect(
      Object.entries(kedua).some(([k, n]) => k.includes('orders') && n > 0),
      `penjualan hilang pada muat ulang kedua: ${JSON.stringify(kedua)}`
    ).toBe(true);

    // Riwayat juga harus TERLIHAT oleh kasir, bukan hanya ada di penyimpanan.
    await page.getByRole('button', { name: /Transaksi Terakhir/ }).click();
    await expect(page.getByText(/INV-/).first()).toBeVisible({ timeout: 15_000 });
  });
});
