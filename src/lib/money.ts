/**
 * Aritmetika rupiah — satu-satunya tempat uang dibulatkan.
 *
 * MASALAH YANG DISELESAIKAN, dan buktinya.
 *
 * Perhitungan uang tersebar di belasan tempat dengan aturan yang berbeda-beda:
 * pajak dan service charge dibulatkan dengan `Math.round`, tapi diskon per item
 * tidak dibulatkan sama sekali. Hasilnya pecahan rupiah yang merambat sampai ke
 * uang yang benar-benar diserahkan kasir:
 *
 *     33.333 x1, diskon 10%   -> total 29.999,7
 *     subtotal                -> 76.874,7
 *     grand total             -> 89.174,7
 *     bayar 100.000           -> kembalian 10.825,300000000003
 *
 * Angka terakhir itu bukan sekadar jelek di layar. Ia masuk ke `Order.total`,
 * ikut tersinkron ke `pos.transactions.total_amount`, lalu dijumlahkan menjadi
 * omzet di `contract.merchant_revenue`. Ribuan transaksi berpecahan menghasilkan
 * laporan yang tidak pernah bisa direkonsiliasi dengan uang fisik di laci.
 *
 * ATURAN YANG DIPAKAI DI SINI
 *
 * 1. RUPIAH ADALAH BILANGAN BULAT. Sen sudah tidak dipakai dalam praktik, dan
 *    tidak ada pecahan uang di bawah Rp 100 yang beredar. Setiap nilai uang yang
 *    keluar dari modul ini adalah integer.
 *
 * 2. PEMBULATAN KE TERDEKAT, SETENGAH KE ATAS. Konvensi ritel Indonesia, dan
 *    yang sama dipakai mesin kasir konvensional. `Math.round` di JavaScript
 *    membulatkan -0,5 ke 0 (bukan ke -1), jadi untuk nilai negatif — potongan,
 *    pengembalian — dipakai pembulatan pada nilai absolutnya agar arahnya
 *    konsisten.
 *
 * 3. DIBULATKAN DI SETIAP LANGKAH, BUKAN DI AKHIR. Membiarkan pecahan mengalir
 *    lalu membulatkan sekali di akhir membuat baris struk tidak pernah
 *    menjumlah tepat ke totalnya — pelanggan yang menjumlahkan sendiri akan
 *    menemukan selisih, dan kasir tidak punya jawaban.
 *
 * 4. TIDAK PERNAH NEGATIF untuk nilai yang secara bisnis tidak boleh negatif.
 *    Diskon lebih besar dari harga menghasilkan 0, bukan tagihan terbalik.
 *
 * BATAS AMAN. Rupiah dalam `number` JavaScript aman sampai
 * Number.MAX_SAFE_INTEGER (~9 kuadriliun). Omzet tahunan seratus miliar berada
 * jauh di bawahnya, jadi tidak perlu BigInt atau desimal berbasis string.
 */

/**
 * Membulatkan ke rupiah utuh terdekat.
 *
 * Nilai bukan-angka menjadi 0 — masukan rusak tidak boleh menjadi NaN yang
 * merambat diam-diam ke seluruh struk dan baru terlihat sebagai "Rp NaN".
 */
export function rupiah(nilai: unknown): number {
  const n = Number(nilai);
  if (!Number.isFinite(n)) return 0;
  // Math.round(-0.5) = -0, bukan -1. Membulatkan nilai absolutnya menjaga arah
  // pembulatan tetap sama untuk potongan dan pengembalian.
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Membulatkan, lalu menjepit ke minimal nol. Untuk nilai yang tidak boleh negatif. */
export function rupiahPositif(nilai: unknown): number {
  return Math.max(0, rupiah(nilai));
}

/**
 * Persentase dari sebuah nilai, dibulatkan ke rupiah utuh.
 *
 * Dipakai untuk pajak, service charge, dan diskon persen — ketiganya dulu
 * memakai rumus yang ditulis ulang di setiap tempat, dan hanya dua dari tiga
 * yang dibulatkan.
 */
export function persenDari(nilai: unknown, persen: unknown): number {
  const dasar = Number(nilai);
  const p = Number(persen);
  if (!Number.isFinite(dasar) || !Number.isFinite(p)) return 0;
  return rupiah((dasar * p) / 100);
}

/**
 * Diskon satu baris keranjang.
 *
 * Persen didahulukan bila diisi; kalau tidak, nominal yang dipakai. Hasilnya
 * tidak pernah melebihi nilai barisnya sendiri — diskon 150% menghasilkan
 * potongan sebesar harga, bukan uang kembali.
 */
export function hitungDiskonBaris(
  hargaSatuan: unknown,
  jumlah: unknown,
  diskonPersen: unknown,
  diskonNominal: unknown
): { bruto: number; diskon: number; neto: number } {
  const bruto = rupiahPositif(Number(hargaSatuan) * Number(jumlah));
  const p = Number(diskonPersen);
  const mentah = Number.isFinite(p) && p > 0 ? persenDari(bruto, p) : rupiahPositif(diskonNominal);
  const diskon = Math.min(bruto, mentah);
  return { bruto, diskon, neto: bruto - diskon };
}

/**
 * Total sebuah transaksi, dari baris-baris yang SUDAH dibulatkan.
 *
 * Menerima subtotal apa adanya dan tidak menghitung ulang dari item: yang
 * memanggil sudah membulatkan tiap baris, dan menjumlahkan integer selalu
 * menghasilkan integer. Membulatkan lagi di sini hanya akan menutupi kalau ada
 * pemanggil yang melewatkan pembulatan barisnya.
 */
export function hitungTotal(opts: {
  subtotal: unknown;
  pajakPersen?: unknown;
  pakaiPajak?: boolean;
  servicePersen?: unknown;
  pakaiService?: boolean;
}): { subtotal: number; pajak: number; service: number; total: number } {
  const subtotal = rupiahPositif(opts.subtotal);
  const pajak = opts.pakaiPajak ? persenDari(subtotal, opts.pajakPersen) : 0;
  const service = opts.pakaiService ? persenDari(subtotal, opts.servicePersen) : 0;
  return { subtotal, pajak, service, total: subtotal + pajak + service };
}

/** Kembalian tunai. Tidak pernah negatif: uang kurang bukan kembalian minus. */
export function hitungKembalian(dibayar: unknown, tagihan: unknown): number {
  return rupiahPositif(rupiah(dibayar) - rupiah(tagihan));
}

/**
 * Penjaga terakhir sebelum angka meninggalkan aplikasi.
 *
 * Dipakai di jalur sinkronisasi: apa pun yang tersimpan di localStorage dari
 * versi lama — termasuk transaksi berpecahan yang sudah terlanjur dibuat —
 * dibulatkan sebelum dikirim ke server, sehingga pembukuan pusat tetap bulat
 * meski riwayat lokalnya tidak.
 */
export function bulatkanUangObjek<T extends Record<string, unknown>>(obj: T, kunci: readonly (keyof T)[]): T {
  const keluar = { ...obj };
  for (const k of kunci) {
    if (keluar[k] !== undefined && keluar[k] !== null) {
      (keluar as Record<string, unknown>)[k as string] = rupiah(keluar[k]);
    }
  }
  return keluar;
}
