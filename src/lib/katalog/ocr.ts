/**
 * Tesseract OCR di PERAMBAN.
 *
 * KENAPA DI KLIEN, BUKAN DI SERVER. Tiga alasan, dan yang pertama menentukan:
 *
 *   1. Foto menu tidak perlu diunggah ke mana pun. Ia tidak pernah melewati
 *      jaringan, tidak pernah disimpan, dan tidak pernah menjadi tanggung
 *      jawab kami untuk dijaga atau dihapus. Data yang tidak pernah kami
 *      pegang adalah data yang tidak bisa bocor dari kami.
 *   2. Tesseract WASM beserta data bahasanya belasan megabyte. Di fungsi
 *      serverless itu dimuat ulang setiap cold start, dan pengenalan satu foto
 *      menu bisa melewati batas waktu eksekusi.
 *   3. Biayanya nol. Fitur yang dijanjikan "100% GRATIS" tidak boleh menagih
 *      kami per foto.
 *
 * Berkas ini SENGAJA tipis: ia hanya memuat worker dan menyerahkan hasilnya.
 * Seluruh penafsiran ada di ocrMenu.ts, yang murni dan bisa diuji tanpa
 * peramban — karena di sanalah kesalahan yang sesungguhnya terjadi.
 */

import type { LoggerMessage } from 'tesseract.js';

export interface KemajuanOcr {
  /** 0..1 */
  progres: number;
  /** Tahap yang sedang berjalan, sudah diterjemahkan. */
  tahap: string;
}

const TAHAP: Record<string, string> = {
  'loading tesseract core': 'Menyiapkan mesin pengenal',
  'initializing tesseract': 'Menyiapkan mesin pengenal',
  'loading language traineddata': 'Memuat bahasa Indonesia',
  'initializing api': 'Menyiapkan pengenalan',
  'recognizing text': 'Membaca tulisan di foto',
};

/**
 * Bahasa: Indonesia DAN Inggris.
 *
 * Menu Indonesia bercampur istilah Inggris hampir tanpa kecuali — "Iced Latte",
 * "Chicken Wings", "Extra Cheese". Memuat `ind` saja membuat kata-kata itu
 * dibaca dengan model bahasa yang salah dan hasilnya lebih buruk daripada
 * tanpa model sama sekali.
 */
const BAHASA = 'ind+eng';

/**
 * Membaca teks dari satu gambar.
 *
 * Worker dibuat dan DIHENTIKAN setiap panggilan. Menyimpannya antar panggilan
 * lebih cepat, tapi worker Tesseract memegang belasan megabyte; membiarkannya
 * hidup di tab kasir yang dibuka sepanjang hari adalah cara membuat perangkat
 * murah kehabisan memori di tengah jam sibuk.
 */
export async function bacaGambar(
  berkas: Blob,
  onKemajuan?: (k: KemajuanOcr) => void
): Promise<string> {
  // Impor dinamis: Tesseract belasan megabyte dan TIDAK boleh ikut di bundel
  // utama. Kasir yang tidak pernah mengimpor menu tidak perlu mengunduhnya.
  const { createWorker } = await import('tesseract.js');

  const worker = await createWorker(BAHASA, 1, {
    logger: (m: LoggerMessage) => {
      if (!onKemajuan) return;
      onKemajuan({
        progres: typeof m.progress === 'number' ? m.progress : 0,
        tahap: TAHAP[m.status] ?? m.status,
      });
    },
  });

  try {
    const { data } = await worker.recognize(berkas);
    return data.text ?? '';
  } finally {
    // Dihentikan APA PUN yang terjadi. Worker yang bocor karena pengenalan
    // gagal tetap memegang memorinya.
    await worker.terminate();
  }
}

/**
 * Beberapa foto sekaligus — menu berlembar-lembar.
 *
 * Berurutan, bukan bersamaan. Menjalankan empat worker Tesseract sekaligus di
 * ponsel kelas menengah membekukan perambannya, dan pengenalan gambar memang
 * terikat CPU: menjalankannya paralel tidak lebih cepat, hanya lebih berat.
 */
export async function bacaBeberapaGambar(
  berkas: Blob[],
  onKemajuan?: (k: KemajuanOcr & { berkasKe: number; dariBerkas: number }) => void
): Promise<string> {
  const potongan: string[] = [];
  for (let i = 0; i < berkas.length; i++) {
    const teks = await bacaGambar(berkas[i], (k) =>
      onKemajuan?.({ ...k, berkasKe: i + 1, dariBerkas: berkas.length })
    );
    potongan.push(teks);
  }
  return potongan.join('\n');
}
