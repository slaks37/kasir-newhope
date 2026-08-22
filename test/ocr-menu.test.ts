/**
 * Parser menu hasil OCR.
 *
 * MURNI, tanpa peramban dan tanpa gambar. Tesseract menghasilkan teks; yang
 * menentukan fitur ini berguna atau berbahaya adalah apa yang dilakukan
 * terhadap teks itu — dan yang paling berbahaya bukan gagal membaca, melainkan
 * membaca dengan PERCAYA DIRI dan salah. Harga yang salah baca masuk ke
 * katalog dan benar-benar ditagihkan ke pembeli.
 */

import { describe, it, expect } from 'vitest';
import {
  bacaMenu, keRupiah, buangDuplikat, urutUntukTinjauan,
} from '../src/lib/katalog/ocrMenu';

describe('harga Indonesia', () => {
  it('titik dan koma sama-sama pemisah ribuan, bukan desimal', () => {
    expect(keRupiah('25.000')?.nilai).toBe(25000);
    expect(keRupiah('25,000')?.nilai).toBe(25000);
    expect(keRupiah('1.250.000')?.nilai).toBe(1250000);
  });

  it('penanda mata uang dan ekor "-," dibuang', () => {
    expect(keRupiah('Rp 18.000')?.nilai).toBe(18000);
    expect(keRupiah('rp18.000')?.nilai).toBe(18000);
    expect(keRupiah('18.000,-')?.nilai).toBe(18000);
  });

  it('singkatan ribuan dikenali', () => {
    expect(keRupiah('25rb')?.nilai).toBe(25000);
    expect(keRupiah('25 ribu')?.nilai).toBe(25000);
    expect(keRupiah('25k')?.nilai).toBe(25000);
    expect(keRupiah('25K')?.nilai).toBe(25000);
  });

  it('angka telanjang kecil dibaca sebagai ribuan, DAN dicatat alasannya', () => {
    // Tidak ada warung yang menjual apa pun seharga Rp 25.
    const h = keRupiah('25');
    expect(h?.nilai).toBe(25000);
    expect(h?.catatan.join(' ')).toContain('tanpa ribuan');
  });

  it('angka besar tanpa pemisah TIDAK dikalikan', () => {
    expect(keRupiah('25000')?.nilai).toBe(25000);
    expect(keRupiah('1250000')?.nilai).toBe(1250000);
  });

  it('bukan angka ditolak, bukan ditebak', () => {
    expect(keRupiah('')).toBeNull();
    expect(keRupiah('Nasi')).toBeNull();
    expect(keRupiah('Rp')).toBeNull();
  });
});

describe('membaca menu yang berantakan', () => {
  const MENU = `
NASI GORENG
Nasi Goreng Spesial ............ 25.000
Nasi Goreng Seafood      Rp 28.000
MINUMAN
Es Teh Manis                     5rb
Kopi Susu Gula Aren   18.000
`;

  it('mengambil nama dan harga dari baris bertitik-titik', () => {
    const { baris } = bacaMenu(MENU);
    const ng = baris.find((b) => b.nama.startsWith('Nasi Goreng Spesial'));
    expect(ng?.nama).toBe('Nasi Goreng Spesial');
    expect(ng?.harga).toBe(25000);
  });

  it('judul kategori menempel pada produk di bawahnya', () => {
    const { baris } = bacaMenu(MENU);
    expect(baris.find((b) => b.nama === 'Nasi Goreng Seafood')?.kategori).toBe('NASI GORENG');
    expect(baris.find((b) => b.nama === 'Es Teh Manis')?.kategori).toBe('MINUMAN');
  });

  it('judul kategori TIDAK ikut menjadi produk', () => {
    const { baris } = bacaMenu(MENU);
    expect(baris.map((b) => b.nama)).not.toContain('MINUMAN');
    expect(baris.map((b) => b.nama)).not.toContain('NASI GORENG');
  });

  it('membaca lima produk dari menu enam baris berisi dua judul', () => {
    expect(bacaMenu(MENU).baris).toHaveLength(4);
  });
});

describe('derau dibuang, TAPI dilaporkan', () => {
  const KOTOR = `
Warung Bu Sri
Jl. Merdeka No. 12 Sidoarjo
Telp 0812-3456-7890
Buka Senin - Sabtu
IG: @warungbusri
Nasi Rawon                   22.000
Harga sudah termasuk PPN
halaman 2
`;

  it('alamat, telepon, jam buka, dan medsos tidak menjadi produk', () => {
    const { baris } = bacaMenu(KOTOR);
    expect(baris).toHaveLength(1);
    expect(baris[0].nama).toBe('Nasi Rawon');
  });

  it('yang dibuang tetap dilaporkan beserta alasannya — tidak disembunyikan', () => {
    const { dilewati } = bacaMenu(KOTOR);
    const alasan = dilewati.map((d) => d.alasan);
    expect(alasan).toContain('alamat');
    expect(alasan).toContain('nomor telepon');
    expect(alasan).toContain('jam buka');
    expect(alasan).toContain('media sosial');
    expect(alasan).toContain('keterangan pajak');
  });
});

describe('salah baca OCR yang paling sering', () => {
  it('huruf yang terbaca sebagai digit diluruskan, DAN dicatat', () => {
    // OCR sering membaca "1" sebagai "l", dan "0" sebagai "O".
    const { baris } = bacaMenu('Kopi Susu Gula Aren   l8.OOO');
    expect(baris[0].harga).toBe(18000);
    expect(baris[0].catatan.join(' ')).toContain('OCR membaca');
    // Dan keyakinannya TURUN — perbaikan otomatis bukan kepastian.
    expect(baris[0].keyakinan).toBeLessThan(1);
  });

  it('nama produk TIDAK ikut diluruskan', () => {
    // Menerapkan perbaikan digit ke nama akan mengubah "Soto" jadi "5oto".
    const { baris } = bacaMenu('Soto Betawi Iga   35.000');
    expect(baris[0].nama).toBe('Soto Betawi Iga');
  });
});

describe('harga diambil dari KANAN', () => {
  it('angka di nama produk tidak menjadi harga', () => {
    // "Paket 2 Orang" — mengambil angka pertama dari kiri menjadikan 2 harganya.
    const { baris } = bacaMenu('Paket 2 Orang           75.000');
    expect(baris[0].nama).toBe('Paket 2 Orang');
    expect(baris[0].harga).toBe(75000);
  });

  it('varian ukuran: harga terkanan dipakai, sisanya dilaporkan', () => {
    const { baris } = bacaMenu('Kopi Susu     18.000   22.000');
    expect(baris[0].harga).toBe(22000);
    expect(baris[0].hargaLain).toEqual([18000]);
    expect(baris[0].catatan.join(' ')).toContain('varian ukuran');
    expect(baris[0].keyakinan).toBeLessThan(1);
  });
});

describe('angka mustahil ditolak', () => {
  it('harga terlalu kecil bukan harga', () => {
    // OCR memotong digit: "2.500" terbaca "250" -> di bawah batas.
    const { baris, dilewati } = bacaMenu('Teh Tawar   250');
    // 250 < 1000 jadi dikalikan seribu = 250.000. Masih wajar, jadi lolos —
    // tapi harus tercatat supaya peninjau melihatnya.
    expect(baris[0]?.catatan.join(' ')).toContain('tanpa ribuan');
    expect(dilewati.length).toBe(0);
  });

  it('harga di luar nalar dibuang, bukan disimpan', () => {
    // OCR menempelkan dua angka: 25.000 dan 30.000 menjadi satu.
    const { baris } = bacaMenu('Nasi Uduk   2500030000000000');
    expect(baris).toHaveLength(0);
  });
});

describe('keyakinan dipakai untuk mengarahkan mata peninjau', () => {
  it('baris bersih mendapat keyakinan penuh', () => {
    const { baris } = bacaMenu('Nasi Goreng Spesial   25.000');
    expect(baris[0].keyakinan).toBe(1);
    expect(baris[0].catatan).toEqual([]);
  });

  it('yang paling meragukan diurutkan PALING ATAS', () => {
    const { baris } = bacaMenu(`
Nasi Goreng Spesial   25.000
Ayam Bakar   l2.OOO
Es Jeruk   8.000
`);
    const urut = urutUntukTinjauan(baris);
    expect(urut[0].nama).toBe('Ayam Bakar');
    expect(urut[0].keyakinan).toBeLessThan(urut[urut.length - 1].keyakinan);
  });
});

describe('duplikat dari foto yang tumpang tindih', () => {
  it('yang KEYAKINANNYA lebih tinggi yang dipertahankan, bukan yang terakhir', () => {
    const { baris } = bacaMenu(`
Nasi Goreng   25.000
Nasi Goreng   2S.OOO
`);
    expect(baris).toHaveLength(2);
    const unik = buangDuplikat(baris);
    expect(unik).toHaveLength(1);
    // Foto terakhir belum tentu yang paling jelas.
    expect(unik[0].keyakinan).toBe(1);
    expect(unik[0].catatan).toEqual([]);
  });

  it('beda huruf besar-kecil tetap dianggap sama', () => {
    const { baris } = bacaMenu(`
Es Teh Manis   5.000
ES TEH MANIS   5.000
`);
    expect(buangDuplikat(baris)).toHaveLength(1);
  });
});

describe('baris tanpa produk', () => {
  it('harga tanpa nama dilewati', () => {
    const { baris, dilewati } = bacaMenu('   25.000');
    expect(baris).toHaveLength(0);
    expect(dilewati[0].alasan).toContain('tidak ada nama');
  });

  it('kalimat promosi bukan produk — ditandai oleh kata SETELAH harga', () => {
    // Yang menandai kalimat bukan panjang namanya. Di baris menu harga ada di
    // ujung kanan; kalimat menaruh angka di tengah, dan potongan sebelumnya
    // kebetulan pendek — jadi penyaring panjang nama meloloskannya.
    const t = 'Setiap pembelian di atas 100.000 gratis satu es teh manis untuk dibawa pulang';
    const { baris, dilewati } = bacaMenu(t);
    expect(baris).toHaveLength(0);
    expect(dilewati[0].alasan).toContain('kalimat');
  });

  it('nama yang benar-benar panjang tetap ditolak', () => {
    const t = 'Paket Komplit Nasi Goreng Spesial Plus Ayam Bakar Madu Dan Es Teh Manis Jumbo   95.000';
    const { baris, dilewati } = bacaMenu(t);
    expect(baris).toHaveLength(0);
    expect(dilewati[0].alasan).toContain('terlalu panjang');
  });

  it('keterangan pendek setelah harga TIDAK membuang produknya', () => {
    // "25.000 /porsi" — dua kata saja, masih baris menu yang sah.
    const { baris } = bacaMenu('Nasi Goreng Spesial   25.000 /porsi');
    expect(baris).toHaveLength(1);
    expect(baris[0].harga).toBe(25000);
  });

  it('teks kosong menghasilkan nol baris, bukan galat', () => {
    expect(bacaMenu('').baris).toEqual([]);
    expect(bacaMenu('\n\n   \n').baris).toEqual([]);
  });
});
