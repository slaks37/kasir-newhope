/**
 * ESC/POS — perintah cetak untuk printer termal.
 *
 * KENAPA BERKAS INI ADA.
 *
 * Sebelum ini seluruh "cetak struk" di aplikasi adalah `window.print()`, yaitu
 * dialog cetak browser. Itu bukan integrasi printer termal: ia tidak bisa
 * memotong kertas, tidak bisa membuka laci kasir, tidak bisa dipakai tanpa
 * seseorang menekan tombol di dialog, dan hasilnya bergantung pada driver
 * sistem operasi. Sementara itu halaman pemasaran menjanjikan struk termal dan
 * laci kasir otomatis yang bekerja saat internet putus.
 *
 * Berkas ini membangkitkan perintah ESC/POS yang sesungguhnya — standar Epson
 * yang diikuti hampir semua printer termal 58/80mm, termasuk Sunmi dan iMin.
 *
 * MURNI FUNGSI, DAN ITU DISENGAJA. Tidak ada I/O di sini: masuknya struk,
 * keluarnya byte. Perintah printer adalah hal yang paling sulit didiagnosis
 * ketika salah (printer hanya diam, atau memuntahkan kertas), jadi ia harus
 * bisa diuji byte-per-byte tanpa perangkat keras.
 */

/* --- Perintah mentah -------------------------------------------------------
 *
 * Angka-angka ini berasal dari spesifikasi ESC/POS. Ditulis sebagai konstanta
 * bernama, bukan literal di tengah kode: `0x1D 0x56 0x42 0x03` di tengah baris
 * tidak bisa dibaca siapa pun, termasuk yang menulisnya minggu depan.
 */
const ESC = 0x1b;
const GS = 0x1d;

export const CMD = {
  /** ESC @ — kembalikan printer ke keadaan awal. Selalu perintah pertama. */
  INIT: [ESC, 0x40],
  /** ESC a n — 0 kiri, 1 tengah, 2 kanan. */
  ALIGN: (n: 0 | 1 | 2) => [ESC, 0x61, n],
  /** ESC E n — tebal. */
  BOLD: (on: boolean) => [ESC, 0x45, on ? 1 : 0],
  /** GS ! n — ukuran karakter; 4 bit atas lebar, 4 bit bawah tinggi. */
  SIZE: (w: 0 | 1, h: 0 | 1) => [GS, 0x21, (w << 4) | h],
  /** ESC d n — maju n baris. */
  FEED: (n: number) => [ESC, 0x64, Math.max(0, Math.min(255, n))],
  /**
   * GS V 66 n — potong sebagian setelah maju n baris.
   *
   * Potong SEBAGIAN, bukan penuh: potongan penuh melepas struk sepenuhnya dan
   * pada banyak printer ia jatuh ke lantai sebelum kasir sempat mengambilnya.
   * Potongan sebagian menyisakan sambungan kecil, struk menggantung, kasir
   * merobeknya.
   */
  CUT: (feed = 3) => [GS, 0x56, 66, Math.max(0, Math.min(255, feed))],
  /**
   * ESC p m t1 t2 — pulsa ke konektor laci kasir.
   *
   * m=0 adalah pin 2, yang dipakai hampir semua laci. t1/t2 adalah lama pulsa
   * ON/OFF dalam satuan 2ms. 25/250 (50ms/500ms) adalah nilai aman: pulsa yang
   * terlalu pendek tidak cukup kuat menarik solenoid, yang terlalu panjang
   * memanaskan kumparannya.
   */
  DRAWER: (pin: 0 | 1 = 0) => [ESC, 0x70, pin, 25, 250],
  /** ESC t n — halaman kode. 0 = CP437. */
  CODEPAGE: (n: number) => [ESC, 0x74, n],
} as const;

/** Lebar karakter Font A menurut lebar kertas. Standar, bukan pilihan. */
export const LEBAR_KOLOM = { '58mm': 32, '80mm': 48 } as const;
export type LebarKertas = keyof typeof LEBAR_KOLOM;

/**
 * Printer termal memakai halaman kode satu byte, bukan UTF-8.
 *
 * Mengirim "Ø" atau "—" apa adanya menghasilkan karakter sampah di struk, dan
 * pada sebagian printer membuat sisa barisnya ikut kacau. Bahasa Indonesia
 * hampir seluruhnya ASCII, jadi yang perlu ditangani hanya tanda baca tipografis
 * yang masuk lewat salin-tempel dari aplikasi lain — dan itu sering terjadi:
 * nama produk diketik di WhatsApp lalu ditempel ke katalog.
 */
const GANTI: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', ' ': ' ',
  '€': 'EUR', '×': 'x', '•': '*', '°': 'deg',
};

export function keAscii(teks: string): string {
  let hasil = '';
  for (const ch of String(teks ?? '')) {
    if (GANTI[ch] !== undefined) { hasil += GANTI[ch]; continue; }
    const kode = ch.codePointAt(0) ?? 63;
    // Di luar ASCII cetak: diganti '?', bukan dibuang. Nama produk yang
    // kehilangan huruf diam-diam lebih membingungkan daripada yang jelas rusak.
    hasil += kode >= 0x20 && kode <= 0x7e ? ch : '?';
  }
  return hasil;
}

/** Satu baris dengan kiri rata kiri dan kanan rata kanan, dipotong bila perlu. */
export function barisKiriKanan(kiri: string, kanan: string, lebar: number): string {
  const k = keAscii(kiri);
  const n = keAscii(kanan);
  // Yang dipotong adalah sisi KIRI (nama produk), bukan kanan (angka uang).
  // Struk dengan harga terpotong tidak ada gunanya.
  const ruang = Math.max(1, lebar - n.length - 1);
  const kiriPotong = k.length > ruang ? k.slice(0, ruang - 1) + '.' : k;
  return kiriPotong + ' '.repeat(Math.max(1, lebar - kiriPotong.length - n.length)) + n;
}

/** Membungkus teks panjang ke beberapa baris tanpa memotong kata di tengah. */
export function bungkus(teks: string, lebar: number): string[] {
  const kata = keAscii(teks).split(/\s+/).filter(Boolean);
  if (!kata.length) return [''];
  const baris: string[] = [];
  let kini = '';
  for (const w of kata) {
    if (!kini) { kini = w.length > lebar ? w.slice(0, lebar) : w; continue; }
    if (kini.length + 1 + w.length <= lebar) kini += ' ' + w;
    else { baris.push(kini); kini = w.length > lebar ? w.slice(0, lebar) : w; }
  }
  if (kini) baris.push(kini);
  return baris;
}

/** Penyusun byte. Menyembunyikan encoder supaya pemanggil hanya berpikir baris. */
export class Struk {
  private buf: number[] = [];
  private enc = new TextEncoder();

  constructor(public readonly lebar: number) {}

  cmd(bytes: readonly number[] | number[]): this { this.buf.push(...bytes); return this; }

  teks(s: string): this {
    // Sengaja lewat ASCII: lihat keAscii().
    for (const b of this.enc.encode(keAscii(s))) this.buf.push(b);
    return this;
  }

  baris(s = ''): this { return this.teks(s).cmd([0x0a]); }

  garis(ch = '-'): this { return this.baris(ch.repeat(this.lebar)); }

  bytes(): Uint8Array { return new Uint8Array(this.buf); }
}

export interface StrukData {
  namaToko: string;
  alamat?: string;
  telepon?: string;
  nomorStruk: string;
  tanggal: string;
  kasir: string;
  items: Array<{ nama: string; jumlah: number; hargaSatuan: number; total: number }>;
  subtotal: number;
  diskon: number;
  pajak: number;
  serviceCharge: number;
  total: number;
  metodePembayaran: string;
  tunaiDiterima?: number;
  kembalian?: number;
  catatanKaki?: string;
}

const uang = (n: number) => Math.round(Number(n) || 0).toLocaleString('id-ID');

/**
 * Struk lengkap sebagai byte ESC/POS.
 *
 * `bukaLaci` sengaja dikirim SEBELUM isi struk, bukan sesudah. Laci harus
 * terbuka saat kasir mengambil kembalian, dan itu terjadi bersamaan dengan
 * struk yang keluar — bukan setelah printer selesai memotong kertas.
 */
export function bangunStruk(d: StrukData, kertas: LebarKertas = '80mm', bukaLaci = false): Uint8Array {
  const lebar = LEBAR_KOLOM[kertas];
  const s = new Struk(lebar);

  s.cmd(CMD.INIT).cmd(CMD.CODEPAGE(0));
  if (bukaLaci) s.cmd(CMD.DRAWER(0));

  s.cmd(CMD.ALIGN(1)).cmd(CMD.BOLD(true)).cmd(CMD.SIZE(1, 1));
  s.baris(d.namaToko);
  s.cmd(CMD.SIZE(0, 0)).cmd(CMD.BOLD(false));
  if (d.alamat) bungkus(d.alamat, lebar).forEach((b) => s.baris(b));
  if (d.telepon) s.baris(d.telepon);

  s.cmd(CMD.ALIGN(0)).garis();
  s.baris(barisKiriKanan('No', d.nomorStruk, lebar));
  s.baris(barisKiriKanan('Tanggal', d.tanggal, lebar));
  s.baris(barisKiriKanan('Kasir', d.kasir, lebar));
  s.garis();

  for (const it of d.items) {
    bungkus(it.nama, lebar).forEach((b) => s.baris(b));
    s.baris(barisKiriKanan(`  ${it.jumlah} x ${uang(it.hargaSatuan)}`, uang(it.total), lebar));
  }

  s.garis();
  s.baris(barisKiriKanan('Subtotal', uang(d.subtotal), lebar));
  if (d.diskon > 0) s.baris(barisKiriKanan('Diskon', '-' + uang(d.diskon), lebar));
  if (d.pajak > 0) s.baris(barisKiriKanan('Pajak', uang(d.pajak), lebar));
  if (d.serviceCharge > 0) s.baris(barisKiriKanan('Layanan', uang(d.serviceCharge), lebar));

  s.cmd(CMD.BOLD(true)).cmd(CMD.SIZE(0, 1));
  s.baris(barisKiriKanan('TOTAL', uang(d.total), lebar));
  s.cmd(CMD.SIZE(0, 0)).cmd(CMD.BOLD(false));

  s.baris(barisKiriKanan(d.metodePembayaran, '', lebar).trimEnd());
  if (d.tunaiDiterima != null) s.baris(barisKiriKanan('Tunai', uang(d.tunaiDiterima), lebar));
  if (d.kembalian != null) s.baris(barisKiriKanan('Kembali', uang(d.kembalian), lebar));

  s.garis();
  s.cmd(CMD.ALIGN(1));
  bungkus(d.catatanKaki || 'Terima kasih atas kunjungan Anda', lebar).forEach((b) => s.baris(b));

  s.cmd(CMD.FEED(2)).cmd(CMD.CUT(3));
  return s.bytes();
}

/** Membuka laci tanpa mencetak apa pun — untuk tombol "Buka Laci" dan setoran tunai. */
export function bangunBukaLaci(): Uint8Array {
  return new Uint8Array([...CMD.INIT, ...CMD.DRAWER(0)]);
}
