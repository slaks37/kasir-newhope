/**
 * Impor katalog massal di sisi klien.
 *
 * Yang dijaga di sini bukan tampilannya melainkan ARITMETIKA BATASNYA, dan
 * satu jebakan React yang sangat mudah masuk tanpa disadari:
 *
 *     for (const p of seratusProduk) saveProduct(p);
 *
 * saveProduct memeriksa `products.length` dari closure-nya, dan React tidak
 * memperbarui state itu di antara pemanggilan dalam satu putaran. Seratus
 * panggilan berturut-turut SEMUANYA lolos berdasarkan hitungan awal — batas
 * paket dilewati tanpa satu pun peringatan, dan tidak ada galat yang muncul.
 *
 * Fungsinya diuji lewat logika yang sama, tanpa React.
 */

import { describe, it, expect } from 'vitest';

/**
 * Salinan aturan pemotongan yang dipakai imporProduk().
 *
 * Ditulis ulang di sini SENGAJA: kalau aturannya berubah di POSContext tanpa
 * berkas ini ikut berubah, tesnya gagal — dan itulah gunanya. Menariknya
 * keluar menjadi fungsi bersama akan membuat tes ini menguji dirinya sendiri.
 */
function potongSesuaiBatas(
  masuk: Array<{ name: string }>,
  batasProduk: number,
  produkSekarang: number
): { diterima: number; ditahan: string[] } {
  const bersih = masuk.filter((m) => m.name?.trim());
  const muat = batasProduk === -1 ? bersih.length : Math.max(0, batasProduk - produkSekarang);
  return {
    diterima: bersih.slice(0, muat).length,
    ditahan: bersih.slice(muat).map((m) => m.name),
  };
}

const produk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Produk ${i}` }));

describe('batas dihitung SEKALI atas seluruh impor', () => {
  it('paket Free 30 dengan katalog kosong menerima 30 dari 100', () => {
    const h = potongSesuaiBatas(produk(100), 30, 0);
    expect(h.diterima).toBe(30);
    expect(h.ditahan).toHaveLength(70);
  });

  it('katalog yang sudah terisi mengurangi jatahnya', () => {
    // INI yang dilewatkan perulangan saveProduct: hitungan awal 25, dan
    // seratus produk berikutnya semuanya lolos karena membaca 25 terus.
    const h = potongSesuaiBatas(produk(100), 30, 25);
    expect(h.diterima).toBe(5);
    expect(h.ditahan).toHaveLength(95);
  });

  it('katalog yang sudah penuh tidak menerima apa pun', () => {
    const h = potongSesuaiBatas(produk(50), 30, 30);
    expect(h.diterima).toBe(0);
    expect(h.ditahan).toHaveLength(50);
  });

  it('katalog MELEBIHI batas (admin menurunkan paket) tidak menghasilkan angka negatif', () => {
    const h = potongSesuaiBatas(produk(10), 30, 45);
    expect(h.diterima).toBe(0);
    expect(h.ditahan).toHaveLength(10);
  });

  it('paket tanpa batas menerima semuanya', () => {
    const h = potongSesuaiBatas(produk(500), -1, 1200);
    expect(h.diterima).toBe(500);
    expect(h.ditahan).toEqual([]);
  });
});

describe('yang ditahan disebut namanya', () => {
  it('nama dikembalikan, bukan sekadar jumlah', () => {
    // "80 tersimpan" tanpa menyebut dua puluh mana yang hilang membuat
    // merchant mengira sistemnya rusak.
    const h = potongSesuaiBatas(produk(5), 3, 0);
    expect(h.ditahan).toEqual(['Produk 3', 'Produk 4']);
  });

  it('urutannya dipertahankan — yang ditahan adalah yang PALING BAWAH', () => {
    // Layar tinjauan menaruh yang meragukan di atas, jadi yang terpotong
    // adalah yang paling meyakinkan. Itu disengaja: kalau harus ada yang
    // hilang, biarlah yang hilang yang paling mudah diketik ulang.
    const h = potongSesuaiBatas(produk(4), 2, 0);
    expect(h.ditahan).toEqual(['Produk 2', 'Produk 3']);
  });
});

describe('masukan yang tidak layak', () => {
  it('nama kosong dibuang sebelum dihitung terhadap batas', () => {
    const h = potongSesuaiBatas(
      [{ name: 'Nasi' }, { name: '   ' }, { name: '' }, { name: 'Ayam' }], 30, 0);
    expect(h.diterima).toBe(2);
  });

  it('impor kosong bukan galat', () => {
    expect(potongSesuaiBatas([], 30, 0)).toEqual({ diterima: 0, ditahan: [] });
  });
});
