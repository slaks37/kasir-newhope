/**
 * Pengaturan TLS untuk koneksi basis data.
 *
 * `rejectUnauthorized: false` tersebar di dua puluh berkas. Artinya sertifikat
 * server tidak pernah diperiksa, dan koneksi ke basis data — tempat seluruh
 * data merchant lewat — terbuka terhadap penyadapan di tengah jalan.
 *
 * Yang menahan perbaikannya selama ini: Postgres di localhost MENOLAK SSL sama
 * sekali ("server does not support SSL"), jadi memaksa verifikasi membuat
 * aplikasi tidak bisa dijalankan di mesin sendiri. Berkas ini memisahkan kedua
 * keadaan itu alih-alih mengorbankan yang satu demi yang lain.
 */

export type PengaturanSsl = false | undefined | { rejectUnauthorized: boolean; ca?: string };

export function sslUntuk(url: string | undefined): PengaturanSsl {
  const u = url || '';

  // Lokal: tanpa SSL sama sekali. Bukan kelonggaran — servernya memang tidak
  // menyediakannya, dan lalu lintasnya tidak meninggalkan mesin.
  if (/@(127\.0\.0\.1|localhost)|host=\//.test(u)) return undefined;

  // Penyedia terkelola memberi sertifikat akar. Bila tersedia, dipakai dan
  // verifikasinya DINYALAKAN.
  const ca = process.env.DATABASE_CA_CERT;
  if (ca && ca.includes('BEGIN CERTIFICATE')) {
    return { rejectUnauthorized: true, ca };
  }

  // Tidak ada sertifikat akar. Dulu ini diam-diam berarti "jangan periksa".
  // Sekarang keputusannya harus disengaja: set DATABASE_SSL_INSECURE=1 untuk
  // menerimanya, dan angka itu tercatat di log supaya tidak terlupakan.
  if (process.env.DATABASE_SSL_INSECURE === '1') {
    if (!sudahMemperingatkan) {
      sudahMemperingatkan = true;
      console.warn(
        '[db] TLS TANPA VERIFIKASI. Isi DATABASE_CA_CERT dengan sertifikat akar ' +
        'penyedia basis data Anda, lalu hapus DATABASE_SSL_INSECURE.'
      );
    }
    return { rejectUnauthorized: false };
  }

  // Bawaannya sekarang AMAN: verifikasi menyala. Bila penyedia memakai akar
  // publik yang sudah dipercaya Node, ini langsung bekerja tanpa pengaturan apa
  // pun.
  return { rejectUnauthorized: true };
}

let sudahMemperingatkan = false;
