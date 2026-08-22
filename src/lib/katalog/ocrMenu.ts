/**
 * Teks mentah hasil OCR -> baris produk yang bisa ditinjau.
 *
 * MURNI: tanpa I/O, tanpa DOM, tanpa Tesseract. Tesseract menghasilkan teks;
 * yang menentukan berguna atau tidaknya fitur ini adalah apa yang dilakukan
 * terhadap teks itu, dan itu semua ada di berkas ini — jadi bisa diuji tanpa
 * peramban dan tanpa gambar.
 *
 * YANG DIHADAPI. Foto menu warung bukan dokumen bersih. Yang masuk kira-kira
 * begini, lengkap dengan salah bacanya:
 *
 *     NASI GORENG
 *     Nasi Goreng Spesial ............ 25.000
 *     Nasi Goreng Seafood      Rp 28.000
 *     Nasi Goreng Kambing   32.000  38.000
 *     MINUMAN
 *     Es Teh Manis                     5rb
 *     Kopi Susu Gula Aren   l8.000        <- OCR membaca "1" sebagai "l"
 *     Jl. Merdeka No. 12 Telp 0812-3456
 *
 * Enam hal yang harus dibedakan: judul kategori, nama produk, harga, pemisah
 * titik-titik, varian ukuran, dan derau (alamat, telepon, jam buka).
 *
 * SETIAP BARIS MEMBAWA SKOR KEYAKINAN, dan layar tinjauan menaruh yang paling
 * meragukan di ATAS. Itu perbedaan antara alat yang berguna dan alat yang
 * berbahaya: OCR foto tidak pernah sempurna, dan menyajikan semuanya seolah
 * sama pastinya membuat orang menyetujui seratus baris tanpa melihat — lalu
 * menjual "Nasi Goreng" seharga Rp 3.000 karena angkanya salah baca.
 */

export interface BarisMenu {
  /** Nama produk, sudah dirapikan. */
  nama: string;
  /** Harga dalam rupiah penuh. 25.000 -> 25000. */
  harga: number;
  /** Judul kategori terakhir sebelum baris ini, bila ada. */
  kategori?: string;
  /** 0..1. Di bawah 0.7 wajib diperiksa manusia. */
  keyakinan: number;
  /** Kenapa keyakinannya turun. Ditampilkan apa adanya ke peninjau. */
  catatan: string[];
  /** Harga lain di baris yang sama — biasanya varian ukuran. */
  hargaLain: number[];
  /** Baris aslinya, supaya peninjau bisa membandingkan dengan fotonya. */
  asli: string;
}

export interface HasilBaca {
  baris: BarisMenu[];
  /** Baris yang sengaja dibuang, beserta alasannya. Ditampilkan, tidak disembunyikan. */
  dilewati: Array<{ asli: string; alasan: string }>;
}

/* -------------------------------------------------------------------------- */
/* ANGKA                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Batas kewajaran harga satu item di Indonesia.
 *
 * Bukan aturan bisnis melainkan penyaring salah-baca: OCR yang menempelkan dua
 * angka menghasilkan 250000000, dan yang memotong satu digit menghasilkan 250.
 * Keduanya lolos kalau tidak ada batas, dan keduanya masuk ke katalog sebagai
 * harga yang akan benar-benar ditagihkan ke pembeli.
 */
const HARGA_MIN = 500;
const HARGA_MAX = 100_000_000;

/**
 * Salah baca OCR yang paling sering pada DIGIT.
 *
 * Hanya diterapkan pada potongan yang sudah diduga angka — mengubah huruf
 * menjadi digit di nama produk akan mengubah "Soto" menjadi "5oto".
 */
const RUNCING: Record<string, string> = {
  O: '0', o: '0', D: '0', Q: '0',
  l: '1', I: '1', i: '1', '|': '1',
  S: '5', s: '5',
  B: '8',
  Z: '2', z: '2',
  G: '6',
};

function luruskanDigit(s: string): { hasil: string; diperbaiki: boolean } {
  let diperbaiki = false;
  const hasil = s.replace(/[ODQoliI|SsBZzG]/g, (c) => {
    diperbaiki = true;
    return RUNCING[c] ?? c;
  });
  return { hasil, diperbaiki };
}

/**
 * Angka Indonesia menjadi rupiah penuh.
 *
 * Titik dan koma keduanya dipakai sebagai pemisah ribuan di menu cetak, dan
 * mana yang mana tidak konsisten bahkan dalam satu menu. Karena harga menu
 * praktis selalu bilangan bulat, keduanya diperlakukan sebagai pemisah ribuan
 * — bukan desimal.
 *
 * `25` sendirian ditafsirkan 25.000. Tidak ada warung yang menjual apa pun
 * seharga Rp 25, dan menuliskan harga sebagai "25" adalah kebiasaan yang
 * sangat umum di papan menu. Keyakinannya diturunkan, bukan ditolak.
 */
export function keRupiah(teks: string): { nilai: number; catatan: string[] } | null {
  const catatan: string[] = [];
  let t = teks.trim();

  // Buang penanda mata uang dan ekor "-,"
  t = t.replace(/^rp\.?\s*/i, '').replace(/[,.]\s*-\s*$/, '').trim();
  if (!t) return null;

  // Singkatan ribuan: 25rb, 25 rb, 25k, 25K
  const singkat = t.match(/^([\d.,]+)\s*(rb|ribu|k)$/i);
  if (singkat) {
    const dasar = Number(singkat[1].replace(/[.,]/g, ''));
    if (!Number.isFinite(dasar) || dasar <= 0) return null;
    return { nilai: dasar * 1000, catatan };
  }

  if (!/^[\d.,]+$/.test(t)) return null;

  const angkaSaja = t.replace(/[.,]/g, '');
  if (!/^\d+$/.test(angkaSaja)) return null;

  let nilai = Number(angkaSaja);
  if (!Number.isFinite(nilai) || nilai <= 0) return null;

  // Tanpa pemisah dan kecil: kebiasaan papan menu menulis "25" untuk 25.000.
  if (!/[.,]/.test(t) && nilai < 1000) {
    nilai *= 1000;
    catatan.push(`Ditulis "${t}" tanpa ribuan — dibaca ${nilai.toLocaleString('id-ID')}`);
  }

  return { nilai, catatan };
}

/* -------------------------------------------------------------------------- */
/* BARIS                                                                      */
/* -------------------------------------------------------------------------- */

/** Baris yang jelas bukan produk. Dibuang, tapi dilaporkan. */
const DERAU: Array<{ pola: RegExp; alasan: string }> = [
  { pola: /\b(telp|telepon|hp|wa|whatsapp)\b|\+62|\b08\d{8,}/i, alasan: 'nomor telepon' },
  { pola: /\b(jl\.?|jalan|no\.?\s*\d+|kel\.|kec\.|rt\s*\d|rw\s*\d)\b/i, alasan: 'alamat' },
  { pola: /\b(buka|tutup|jam\s*operasional|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/i, alasan: 'jam buka' },
  // `\b@` tidak pernah cocok: @ bukan karakter kata, jadi tidak ada batas kata
  // sebelumnya. Ditulis terpisah supaya benar-benar menangkap handel medsos.
  { pola: /\b(instagram|facebook|tiktok|www\.)|https?:\/\/|(^|\s)@[a-z0-9_.]{3,}|\bIG\s*[:：]/i, alasan: 'media sosial' },
  { pola: /\b(harga\s*sudah\s*termasuk|ppn|pajak|service\s*charge)\b/i, alasan: 'keterangan pajak' },
  { pola: /\b(halaman|page)\s*\d+\b/i, alasan: 'nomor halaman' },
];

/**
 * Judul kategori: tidak berharga, pendek, dan menonjol.
 *
 * Diperiksa SEBELUM baris tanpa harga dibuang — kalau tidak, seluruh
 * pengelompokan menu hilang dan setiap produk mendarat tanpa kategori.
 */
function judulKategori(baris: string): string | null {
  const t = baris.trim().replace(/[:•·—–-]+$/, '').trim();
  if (!t || t.length > 40) return null;
  if (/\d/.test(t)) return null;                      // ada angka -> bukan judul
  if (t.split(/\s+/).length > 4) return null;         // terlalu panjang

  const huruf = t.replace(/[^A-Za-z]/g, '');
  if (huruf.length < 3) return null;

  // Semua kapital, atau Diawali Kapital Tiap Kata — dua gaya judul yang lazim.
  const semuaKapital = huruf === huruf.toUpperCase();
  const tiapKata = t.split(/\s+/).every((k) => /^[A-Z]/.test(k));
  return semuaKapital || tiapKata ? t : null;
}

/** Merapikan nama: buang titik-titik pemisah, spasi ganda, tanda baca menggantung. */
function rapikanNama(s: string): string {
  return s
    .replace(/[.·•]{2,}/g, ' ')
    .replace(/[_\-–—]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9)\]]+$/, '')
    .trim();
}

/**
 * Semua calon harga di sebuah baris, beserta posisinya.
 *
 * BERBASIS TOKEN, bukan regex yang menyapu seluruh baris.
 *
 * Versi pertama memakai satu regex atas seluruh baris, dan himpunan
 * karakternya memuat huruf yang mirip digit (S, s, o, l, i, B…) supaya salah
 * baca OCR bisa diluruskan. Akibatnya ia mencocokkan huruf DI DALAM NAMA
 * PRODUK: "Nasi Rawon" mengandung "si", yang diluruskan menjadi "51" lalu
 * dibaca Rp 51.000. Setiap nama yang memuat huruf-huruf itu — hampir semua
 * nama Indonesia — melahirkan harga hantu.
 *
 * Yang benar: baris dipecah menjadi token utuh lebih dulu, dan hanya token
 * yang BERDIRI SENDIRI yang dinilai. Pecahan di tengah kata tidak pernah
 * sampai ke penilaian.
 */
function calonHarga(baris: string): Array<{ mulai: number; nilai: number; catatan: string[] }> {
  const hasil: Array<{ mulai: number; nilai: number; catatan: string[] }> = [];

  // Token beserta posisinya di baris asli — posisinya dipakai memotong nama.
  const token: Array<{ teks: string; mulai: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(baris)) !== null) token.push({ teks: m[0], mulai: m.index });

  for (let i = 0; i < token.length; i++) {
    let { teks, mulai } = token[i];

    // "Rp" berdiri sendiri: gabungkan dengan token berikutnya.
    if (/^rp\.?$/i.test(teks) && i + 1 < token.length) {
      teks = token[i + 1].teks;
      i++;
    } else {
      teks = teks.replace(/^rp\.?/i, '');
    }

    const bersih = teks.replace(/[,.]\s*-?$/, '').trim();
    if (!bersih) continue;

    // HARUS mengandung digit sungguhan. Token tanpa satu pun digit adalah kata,
    // bukan angka yang salah terbaca — dan inilah yang menahan "Nasi" menjadi
    // harga.
    if (!/[0-9]/.test(bersih)) continue;

    const inti = bersih.replace(/(rb|ribu|k)$/i, '');
    const satuan = bersih.slice(inti.length);

    // Selain digit, hanya huruf-mirip-digit dan pemisah ribuan yang boleh ada.
    if (!/^[\dODQoliI|SsBZzG.,]+$/.test(inti)) continue;

    const catatan: string[] = [];
    const { hasil: lurus, diperbaiki } = luruskanDigit(inti);
    if (diperbaiki) {
      catatan.push(`OCR membaca "${inti}" — dibaca sebagai "${lurus}"`);
    }

    // Satu digit terlalu sedikit untuk sebuah harga, KECUALI ada satuan
    // eksplisit: "5rb" jelas, "5" di tengah nama tidak.
    const jumlahDigit = lurus.replace(/[^0-9]/g, '').length;
    if (jumlahDigit < 2 && !satuan) continue;

    const nilai = keRupiah(lurus + satuan);
    if (!nilai) continue;
    if (nilai.nilai < HARGA_MIN || nilai.nilai > HARGA_MAX) continue;

    hasil.push({ mulai, nilai: nilai.nilai, catatan: [...catatan, ...nilai.catatan] });
  }
  return hasil;
}

/* -------------------------------------------------------------------------- */
/* PARSER                                                                     */
/* -------------------------------------------------------------------------- */

export interface OpsiBaca {
  /** Nama sepanjang ini dianggap kalimat, bukan produk. */
  namaMaks?: number;
}

export function bacaMenu(teks: string, opsi: OpsiBaca = {}): HasilBaca {
  const namaMaks = opsi.namaMaks ?? 60;
  const baris: BarisMenu[] = [];
  const dilewati: Array<{ asli: string; alasan: string }> = [];

  let kategori: string | undefined;

  for (const mentah of teks.split(/\r?\n/)) {
    const t = mentah.trim();
    if (!t) continue;

    const derau = DERAU.find((d) => d.pola.test(t));
    if (derau) {
      dilewati.push({ asli: t, alasan: derau.alasan });
      continue;
    }

    const judul = judulKategori(t);
    if (judul) {
      kategori = judul;
      continue;
    }

    const harga = calonHarga(t);
    if (!harga.length) {
      dilewati.push({ asli: t, alasan: 'tidak ada harga yang terbaca' });
      continue;
    }

    // Harga = calon PALING KANAN. Yang di kirinya, kalau ada, varian ukuran.
    const terkanan = harga[harga.length - 1];
    const nama = rapikanNama(t.slice(0, terkanan.mulai));

    if (!nama) {
      dilewati.push({ asli: t, alasan: 'ada harga tapi tidak ada nama produk' });
      continue;
    }
    if (nama.length > namaMaks) {
      dilewati.push({ asli: t, alasan: 'terlalu panjang untuk sebuah nama produk' });
      continue;
    }

    // ADA KATA SETELAH HARGA -> ini kalimat, bukan baris menu.
    //
    // Di baris menu, harga berada di ujung kanan. Kalimat promosi seperti
    // "Setiap pembelian di atas 100.000 gratis es teh" menaruh angka di
    // TENGAH, dan potongan sebelum angkanya kebetulan pendek — jadi penyaring
    // panjang nama meloloskannya, dan "Setiap pembelian di atas" masuk katalog
    // sebagai produk seharga Rp 100.000.
    const ekor = t.slice(terkanan.mulai).replace(/^\S+\s*/, '').trim();
    if (ekor.split(/\s+/).filter((k) => /[A-Za-z]{2}/.test(k)).length >= 3) {
      dilewati.push({ asli: t, alasan: 'kalimat — ada kata setelah harga' });
      continue;
    }
    if (!/[A-Za-z]{2}/.test(nama)) {
      dilewati.push({ asli: t, alasan: 'nama tidak mengandung kata' });
      continue;
    }

    const catatan = [...terkanan.catatan];
    let keyakinan = 1;

    // Setiap keraguan menurunkan skor, dan alasannya ikut dibawa. Skor tanpa
    // alasan tidak bisa ditindaklanjuti peninjau.
    if (terkanan.catatan.length) keyakinan -= 0.25 * terkanan.catatan.length;
    if (harga.length > 1) {
      catatan.push(`Ada ${harga.length} harga di baris ini — kemungkinan varian ukuran`);
      keyakinan -= 0.2;
    }
    if (nama.length <= 3) {
      catatan.push('Nama sangat pendek — mungkin terpotong');
      keyakinan -= 0.3;
    }
    if (/[^\w\s()&'’./+-]/.test(nama)) {
      catatan.push('Nama mengandung karakter tidak lazim');
      keyakinan -= 0.2;
    }

    baris.push({
      nama,
      harga: terkanan.nilai,
      kategori,
      keyakinan: Math.max(0, Math.min(1, Number(keyakinan.toFixed(2)))),
      catatan,
      hargaLain: harga.slice(0, -1).map((h) => h.nilai),
      asli: t,
    });
  }

  return { baris, dilewati };
}

/**
 * Membuang duplikat berdasarkan nama.
 *
 * Menu difoto berlembar-lembar dan halaman yang tumpang tindih menghasilkan
 * item yang sama dua kali. Yang dipertahankan yang KEYAKINANNYA lebih tinggi —
 * bukan yang terakhir, karena foto terakhir belum tentu yang paling jelas.
 */
export function buangDuplikat(baris: BarisMenu[]): BarisMenu[] {
  const per = new Map<string, BarisMenu>();
  for (const b of baris) {
    const kunci = b.nama.toLowerCase().replace(/\s+/g, ' ');
    const ada = per.get(kunci);
    if (!ada || b.keyakinan > ada.keyakinan) per.set(kunci, b);
  }
  return [...per.values()];
}

/** Yang paling meragukan lebih dulu — itulah yang perlu dilihat orang. */
export function urutUntukTinjauan(baris: BarisMenu[]): BarisMenu[] {
  return [...baris].sort((a, b) => a.keyakinan - b.keyakinan || a.nama.localeCompare(b.nama));
}
