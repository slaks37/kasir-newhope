/**
 * DECODER ESC/POS — membaca byte seperti printer membacanya.
 *
 * KENAPA INI ADA, dan kenapa ia BUKAN pengulangan encoder.
 *
 * Uji peripheral yang sudah ada memeriksa byte dengan mencocokkannya ke
 * konstanta yang diambil dari encoder yang sama (`CMD.CUT(3)`, `CMD.DRAWER(0)`).
 * Itu membuktikan encoder konsisten dengan dirinya sendiri — dan akan tetap
 * hijau kalau konstantanya sendiri yang salah menurut spesifikasi.
 *
 * Decoder ini ditulis dari SPESIFIKASI ESC/POS, bukan dari encoder-nya. Angka
 * di bawah berasal dari tabel perintah Epson, disalin ke sini secara terpisah.
 * Menguji encoder terhadapnya berarti menguji dua pembacaan spesifikasi yang
 * berbeda terhadap satu sama lain — kalau keduanya cocok, kemungkinan besar
 * keduanya benar; kalau salah satu meleset, ketidakcocokannya terlihat.
 *
 * YANG TETAP TIDAK DIBUKTIKAN: bahwa printer merek tertentu menafsirkan byte
 * ini seperti spesifikasi mengatakannya. Itu menuntut perangkat keras, dan
 * tidak ada apa pun di repositori ini yang boleh mengaku sudah membuktikannya.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Membongkar aliran byte menjadi teks dan perintah.
 *
 * Panjang argumen tiap perintah diambil dari spesifikasi. Perintah yang tidak
 * dikenali DILAPORKAN, bukan dilewati diam-diam — byte tak dikenal di tengah
 * aliran adalah persis penyebab printer memuntahkan karakter sampah, dan
 * decoder yang mengabaikannya menyembunyikan justru yang perlu dilihat.
 */
export function bongkarEscPos(bytes) {
  const perintah = [];
  const baris = [];
  let kini = '';
  let i = 0;

  // Keadaan yang dilacak, seperti printer melacaknya.
  let rata = 'kiri';
  let tebal = false;
  let laciDibuka = false;
  let kertasDipotong = false;
  let potongPenuh = false;
  const takDikenal = [];

  const RATA = { 0: 'kiri', 1: 'tengah', 2: 'kanan' };

  while (i < bytes.length) {
    const b = bytes[i];

    if (b === LF) {
      baris.push({ teks: kini, rata, tebal });
      kini = '';
      i += 1;
      continue;
    }

    if (b === ESC) {
      const kode = bytes[i + 1];
      if (kode === 0x40) { perintah.push({ nama: 'INIT' }); i += 2; continue; }
      if (kode === 0x61) {
        rata = RATA[bytes[i + 2]] ?? `tak dikenal(${bytes[i + 2]})`;
        perintah.push({ nama: 'ALIGN', nilai: rata }); i += 3; continue;
      }
      if (kode === 0x45) {
        tebal = bytes[i + 2] === 1;
        perintah.push({ nama: 'BOLD', nilai: tebal }); i += 3; continue;
      }
      if (kode === 0x64) { perintah.push({ nama: 'FEED', nilai: bytes[i + 2] }); i += 3; continue; }
      if (kode === 0x74) { perintah.push({ nama: 'CODEPAGE', nilai: bytes[i + 2] }); i += 3; continue; }
      if (kode === 0x70) {
        // ESC p m t1 t2 — pulsa laci kasir.
        laciDibuka = true;
        perintah.push({
          nama: 'DRAWER',
          pin: bytes[i + 2],
          // Satuan spesifikasi: 2 ms per hitungan.
          onMs: bytes[i + 3] * 2,
          offMs: bytes[i + 4] * 2,
          posisi: baris.length,
        });
        i += 5; continue;
      }
      if (kode === 0x21) { perintah.push({ nama: 'PRINTMODE', nilai: bytes[i + 2] }); i += 3; continue; }
      takDikenal.push({ awalan: 'ESC', kode, offset: i });
      i += 2; continue;
    }

    if (b === GS) {
      const kode = bytes[i + 1];
      if (kode === 0x21) {
        const n = bytes[i + 2];
        perintah.push({ nama: 'SIZE', lebar: (n >> 4) + 1, tinggi: (n & 0x0f) + 1 });
        i += 3; continue;
      }
      if (kode === 0x56) {
        const m = bytes[i + 2];
        kertasDipotong = true;
        // m 0/48 = penuh, 1/49 = sebagian; 65/66 = potong setelah maju n baris.
        potongPenuh = m === 0 || m === 48 || m === 65;
        const adaFeed = m === 65 || m === 66;
        perintah.push({
          nama: 'CUT',
          jenis: potongPenuh ? 'penuh' : 'sebagian',
          feed: adaFeed ? bytes[i + 3] : 0,
          posisi: baris.length,
        });
        i += adaFeed ? 4 : 3; continue;
      }
      takDikenal.push({ awalan: 'GS', kode, offset: i });
      i += 2; continue;
    }

    if (b >= 0x20 && b <= 0x7e) { kini += String.fromCharCode(b); i += 1; continue; }

    // Byte di luar ASCII cetak. Printer termal akan mencetak karakter dari
    // halaman kodenya — hampir selalu bukan yang dimaksud penulisnya.
    takDikenal.push({ awalan: 'BYTE', kode: b, offset: i });
    i += 1;
  }

  if (kini) baris.push({ teks: kini, rata, tebal });

  return {
    baris,
    teks: baris.map((r) => r.teks),
    perintah,
    laciDibuka,
    kertasDipotong,
    potongPenuh,
    takDikenal,
    /** Urutan perintah saja — memudahkan pemeriksaan urutan. */
    urutan: perintah.map((p) => p.nama),
  };
}

/** Menampilkan hasil bongkaran seperti struk yang tercetak, untuk dibaca manusia. */
export function gambarStruk(hasil, lebar = 48) {
  const garis = '='.repeat(lebar + 4);
  const out = [garis];
  for (const r of hasil.baris) {
    let t = r.teks;
    if (r.rata === 'tengah') t = t.padStart(Math.floor((lebar + t.length) / 2)).padEnd(lebar);
    else if (r.rata === 'kanan') t = t.padStart(lebar);
    else t = t.padEnd(lebar);
    out.push(`| ${t} |`);
  }
  out.push(garis);
  return out.join('\n');
}
