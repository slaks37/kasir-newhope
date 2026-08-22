/**
 * Impor katalog dari CSV/TSV — tanpa dependensi.
 *
 * Copy landing menjanjikan "foto menu/Excel". Yang ditangani di sini bagian
 * KEDUA-nya, dan batasnya disebut apa adanya: berkas `.xlsx` adalah arsip ZIP
 * berisi XML, dan membacanya menuntut pustaka yang tidak sepadan untuk sebuah
 * jalur impor. Excel, Google Sheets, dan Numbers semuanya bisa menyimpan ke
 * CSV dalam dua klik — jadi yang diminta itu, dan layarnya mengatakannya
 * dengan jelas alih-alih menerima .xlsx lalu gagal diam-diam.
 *
 * MURNI: tanpa I/O, tanpa DOM. Sama seperti ocrMenu.ts, bisa diuji tanpa
 * peramban.
 */

import { keRupiah } from './ocrMenu';
import type { BarisMenu } from './ocrMenu';

/**
 * Nama kolom yang dikenali, dalam bahasa Indonesia DAN Inggris.
 *
 * Merchant mengekspor dari mana saja — templat pemasok, aplikasi kasir lama,
 * daftar yang diketik sendiri. Menuntut satu susunan kolom yang tepat berarti
 * menuntut mereka menyusun ulang berkasnya lebih dulu, dan itu persis
 * pekerjaan yang fitur ini janjikan untuk dihapus.
 */
const KOLOM = {
  nama: ['nama', 'nama produk', 'produk', 'item', 'menu', 'name', 'product', 'product name'],
  harga: ['harga', 'harga jual', 'price', 'selling price', 'harga_jual'],
  modal: ['modal', 'harga modal', 'hpp', 'cost', 'cost price', 'harga_modal'],
  kategori: ['kategori', 'category', 'jenis', 'grup', 'group'],
  sku: ['sku', 'kode', 'kode produk', 'code', 'barcode'],
};

/** Memisahkan satu baris CSV, menghormati tanda kutip dan koma di dalamnya. */
export function pisahBarisCsv(baris: string, pemisah: string): string[] {
  const hasil: string[] = [];
  let kini = '';
  let dalamKutip = false;

  for (let i = 0; i < baris.length; i++) {
    const c = baris[i];
    if (c === '"') {
      // Dua kutip berturut-turut di dalam kutipan berarti satu kutip harfiah.
      if (dalamKutip && baris[i + 1] === '"') { kini += '"'; i++; }
      else dalamKutip = !dalamKutip;
      continue;
    }
    if (c === pemisah && !dalamKutip) { hasil.push(kini); kini = ''; continue; }
    kini += c;
  }
  hasil.push(kini);
  return hasil.map((x) => x.trim());
}

/**
 * Menebak pemisah dari BARIS JUDUL, bukan dari seluruh berkas.
 *
 * Nama produk sering memuat koma ("Nasi Goreng, Pedas"), jadi menghitung koma
 * di seluruh berkas akan memilih koma untuk berkas yang sebenarnya bertitik
 * koma. Baris judul hampir tidak pernah memuat pemisah di dalam selnya.
 */
export function tebakPemisah(barisJudul: string): string {
  const kandidat = [',', ';', '\t', '|'];
  let terbaik = ',';
  let terbanyak = 0;
  for (const p of kandidat) {
    const n = pisahBarisCsv(barisJudul, p).length;
    if (n > terbanyak) { terbanyak = n; terbaik = p; }
  }
  return terbaik;
}

function cocokkanKolom(judul: string[]): Record<keyof typeof KOLOM, number> {
  const norm = judul.map((h) => h.toLowerCase().replace(/[_-]+/g, ' ').trim());
  const peta = {} as Record<keyof typeof KOLOM, number>;
  for (const [medan, nama] of Object.entries(KOLOM) as Array<[keyof typeof KOLOM, string[]]>) {
    peta[medan] = norm.findIndex((h) => nama.includes(h));
  }
  return peta;
}

export interface HasilTabel {
  baris: BarisMenu[];
  dilewati: Array<{ asli: string; alasan: string }>;
  /** Judul kolom yang dikenali — ditampilkan supaya pemetaannya bisa diperiksa. */
  kolomDikenali: Partial<Record<keyof typeof KOLOM, string>>;
}

export function bacaTabel(teks: string): HasilTabel {
  const baris: BarisMenu[] = [];
  const dilewati: Array<{ asli: string; alasan: string }> = [];

  const semua = teks.split(/\r?\n/).filter((b) => b.trim());
  if (!semua.length) return { baris, dilewati, kolomDikenali: {} };

  const pemisah = tebakPemisah(semua[0]);
  const judul = pisahBarisCsv(semua[0], pemisah);
  const peta = cocokkanKolom(judul);

  if (peta.nama < 0) {
    return {
      baris,
      dilewati: [{
        asli: semua[0],
        alasan: 'tidak ada kolom nama produk — beri judul kolomnya "Nama" atau "Produk"',
      }],
      kolomDikenali: {},
    };
  }

  const kolomDikenali: Partial<Record<keyof typeof KOLOM, string>> = {};
  for (const [medan, idx] of Object.entries(peta) as Array<[keyof typeof KOLOM, number]>) {
    if (idx >= 0) kolomDikenali[medan] = judul[idx];
  }

  for (let i = 1; i < semua.length; i++) {
    const sel = pisahBarisCsv(semua[i], pemisah);
    const nama = (sel[peta.nama] ?? '').trim();
    if (!nama) {
      dilewati.push({ asli: semua[i], alasan: 'nama produk kosong' });
      continue;
    }

    const catatan: string[] = [];
    let keyakinan = 1;

    // Tanpa kolom harga, produknya TETAP diimpor dengan harga 0 dan ditandai —
    // menolaknya berarti merchant harus menyusun ulang berkasnya lebih dulu,
    // dan mengisi harga di layar tinjauan jauh lebih cepat.
    let harga = 0;
    if (peta.harga >= 0) {
      const h = keRupiah(String(sel[peta.harga] ?? ''));
      if (h) {
        harga = h.nilai;
        catatan.push(...h.catatan);
        if (h.catatan.length) keyakinan -= 0.2;
      } else {
        catatan.push('Harga tidak terbaca — isi manual');
        keyakinan -= 0.5;
      }
    } else {
      catatan.push('Berkas tidak punya kolom harga — isi manual');
      keyakinan -= 0.5;
    }

    baris.push({
      nama,
      harga,
      kategori: peta.kategori >= 0 ? (sel[peta.kategori] || undefined) : undefined,
      keyakinan: Math.max(0, Math.min(1, Number(keyakinan.toFixed(2)))),
      catatan,
      hargaLain: [],
      asli: semua[i],
    });
  }

  return { baris, dilewati, kolomDikenali };
}
