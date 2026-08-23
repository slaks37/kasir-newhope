/**
 * PENANDA "BELUM SAMPAI KE SERVER" untuk katalog dan cabang.
 *
 * MASALAH YANG DIPERBAIKI.
 *
 * Katalog dan cabang dikirim dengan pola "kirim seluruh keadaan terkini",
 * bukan lewat antrian kejadian seperti transaksi. Polanya benar — kiriman
 * terakhir selalu yang paling benar. Yang salah adalah kesimpulan yang dulu
 * ditarik darinya:
 *
 *     "Karena kiriman berikutnya akan memperbaiki, kegagalan boleh ditelan."
 *
 * Kiriman berikutnya hanya terjadi kalau ADA SUNTINGAN BERIKUTNYA. Pemilik
 * yang menyusun katalognya sekali, lalu tidak menyentuhnya lagi berbulan-bulan,
 * kehilangan seluruh katalognya di server bila satu-satunya kiriman itu jatuh
 * pada detik internetnya terputus. Tidak ada galat, tidak ada antrian, tidak
 * ada yang bisa tahu. Itu persis bentuk kehilangan data yang paling sulit
 * disadari.
 *
 * CARANYA. Yang disimpan BUKAN muatannya, melainkan penanda "ada yang belum
 * sampai" berikut waktunya. Saat dicoba lagi, muatannya dibaca ulang dari
 * keadaan aplikasi saat itu — jadi yang terkirim selalu yang terbaru, bukan
 * potret basi yang menimpa suntingan yang lebih baru. Penandanya kecil dan
 * berukuran tetap, sehingga tidak ikut memakan kuota penyimpanan yang harus
 * disisakan untuk antrian transaksi.
 *
 * Penandanya bertahan di localStorage: tab yang ditutup sebelum katalognya
 * terkirim akan tetap mengirimnya saat dibuka kembali.
 */

export type JenisTertunda = 'catalog' | 'branches';

const KUNCI = 'newhope_tertunda_';

type Catatan = Partial<Record<JenisTertunda, string>>;

function baca(businessId: string): Catatan {
  try {
    const raw = localStorage.getItem(KUNCI + businessId);
    const d = raw ? JSON.parse(raw) : {};
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

function tulis(businessId: string, c: Catatan): void {
  try {
    if (Object.keys(c).length === 0) localStorage.removeItem(KUNCI + businessId);
    else localStorage.setItem(KUNCI + businessId, JSON.stringify(c));
  } catch {
    /*
     * Penyimpanan penuh. Penanda ini memang yang pertama boleh dikorbankan:
     * antrian transaksi memuat penjualan yang sudah terjadi dan tidak ada di
     * tempat lain, sedangkan katalog masih utuh di layar pemiliknya dan bisa
     * dikirim ulang dari suntingan berikutnya.
     */
  }
}

/** Menandai bahwa ada perubahan yang belum dikonfirmasi server. */
export function tandaiTertunda(businessId: string, jenis: JenisTertunda): void {
  const c = baca(businessId);
  // Waktu penandaan PERTAMA yang dipertahankan, bukan yang terakhir. Itulah
  // yang menjawab "sudah berapa lama data ini belum sampai" — pertanyaan yang
  // sebenarnya ingin dijawab layar.
  if (!c[jenis]) c[jenis] = new Date().toISOString();
  tulis(businessId, c);
}

/** Server sudah mengonfirmasi. Penanda dicabut. */
export function tandaiSampai(businessId: string, jenis: JenisTertunda): void {
  const c = baca(businessId);
  if (!c[jenis]) return;
  delete c[jenis];
  tulis(businessId, c);
}

export function adaTertunda(businessId: string, jenis: JenisTertunda): boolean {
  return Boolean(baca(businessId)[jenis]);
}

/** Sejak kapan jenis ini tertunda. Null bila tidak ada yang tertunda. */
export function tertundaSejak(businessId: string, jenis: JenisTertunda): string | null {
  return baca(businessId)[jenis] ?? null;
}

/** Semua yang belum sampai untuk satu toko. */
export function daftarTertunda(businessId: string): JenisTertunda[] {
  const c = baca(businessId);
  return (['catalog', 'branches'] as JenisTertunda[]).filter((j) => c[j]);
}
