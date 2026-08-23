/**
 * Batas produk paket — SATU tempat, dipakai kedua jalur server.
 *
 * MASALAH YANG DITUTUP BERKAS INI.
 *
 * Sistem punya dua implementasi untuk alamat API yang sama: fungsi serverless
 * di `api/` dan microservice di `services/`. Yang pertama memeriksa batas
 * produk; yang kedua TIDAK MEMERIKSANYA SAMA SEKALI. Merchant paket gratis
 * dapat menyisipkan produk tanpa batas lewat jalur kedua — dan batas produk
 * adalah salah satu pembeda paket berbayar.
 *
 * Menyalin pemeriksaannya ke jalur kedua hanya akan melahirkan salinan ketiga
 * yang menyimpang berikutnya. Yang dilakukan di sini: aturannya dipindahkan ke
 * satu berkas, dan kedua jalur memanggilnya.
 */

export type PenjalankanKueri = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export interface KeadaanBatas {
  batas: number;
  terpakai: number;
  sisa: number;
}

/**
 * Batas darurat saat merchant belum punya baris langganan sama sekali.
 *
 * BUKAN "tanpa batas". Merchant yang belum berlangganan bukan merchant dengan
 * paket termahal — dan sejak trigger langganan percobaan dipasang, keadaan ini
 * seharusnya tidak ada lagi. Tetap ditutup rapat kalau-kalau triggernya
 * dimatikan orang.
 */
export const BATAS_DARURAT = 30;

export async function bacaBatasProduk(
  q: PenjalankanKueri,
  businessId: string
): Promise<KeadaanBatas> {
  const ent = await q.query(
    `SELECT product_limit FROM contract.merchant_entitlements WHERE business_id = $1`,
    [businessId]
  );
  const mentah = ent.rows.length ? Number(ent.rows[0].product_limit) : BATAS_DARURAT;
  // Angka negatif dipakai sebagian paket untuk menyatakan "tanpa batas".
  const batas = Number.isFinite(mentah) && mentah >= 0 ? mentah : Number.POSITIVE_INFINITY;

  const jml = await q.query(
    `SELECT COUNT(*)::int AS n FROM pos.products WHERE business_id = $1`,
    [businessId]
  );
  const terpakai = Number(jml.rows[0]?.n ?? 0);

  return { batas, terpakai, sisa: Math.max(0, batas - terpakai) };
}

/**
 * Apakah SATU produk baru masih boleh masuk.
 *
 * Dipanggil per produk, bukan per batch: batch yang separuhnya muat harus
 * memasukkan separuh itu, bukan menolak semuanya. Merchant yang kehilangan
 * seluruh kiriman karena satu produk kelebihan akan mengira sinkronnya rusak.
 */
export function bolehTambah(k: KeadaanBatas, sudahDitambah: number): boolean {
  return k.terpakai + sudahDitambah < k.batas;
}
