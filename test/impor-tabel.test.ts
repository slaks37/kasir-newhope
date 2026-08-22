/**
 * Impor katalog dari CSV/TSV.
 *
 * Merchant mengekspor dari mana saja — templat pemasok, kasir lama, daftar
 * ketikan sendiri. Menuntut satu susunan kolom yang tepat berarti menuntut
 * mereka merapikan berkasnya lebih dulu, dan itu persis pekerjaan yang fitur
 * ini janjikan untuk dihapus.
 */

import { describe, it, expect } from 'vitest';
import { bacaTabel, pisahBarisCsv, tebakPemisah } from '../src/lib/katalog/imporTabel';

describe('memisahkan baris CSV', () => {
  it('koma di dalam tanda kutip bukan pemisah', () => {
    expect(pisahBarisCsv('"Nasi Goreng, Pedas",25000', ',')).toEqual(['Nasi Goreng, Pedas', '25000']);
  });

  it('dua kutip berturut-turut adalah satu kutip harfiah', () => {
    expect(pisahBarisCsv('"Kopi ""Spesial""",18000', ',')).toEqual(['Kopi "Spesial"', '18000']);
  });

  it('sel kosong tetap menjadi sel', () => {
    expect(pisahBarisCsv('Nasi,,25000', ',')).toEqual(['Nasi', '', '25000']);
  });
});

describe('menebak pemisah', () => {
  it('titik koma dikenali — lazim di Excel berlokal Indonesia', () => {
    expect(tebakPemisah('Nama;Harga;Kategori')).toBe(';');
  });

  it('tab dikenali', () => {
    expect(tebakPemisah('Nama\tHarga')).toBe('\t');
  });

  it('ditebak dari BARIS JUDUL, bukan seluruh berkas', () => {
    // Nama produk sering memuat koma; menghitung koma di seluruh berkas akan
    // memilih koma untuk berkas yang sebenarnya bertitik koma.
    const t = 'Nama;Harga\n"Nasi Goreng, Pedas";25000\n"Ayam, Bakar";30000';
    const { baris } = bacaTabel(t);
    expect(baris).toHaveLength(2);
    expect(baris[0].nama).toBe('Nasi Goreng, Pedas');
    expect(baris[0].harga).toBe(25000);
  });
});

describe('judul kolom bebas bahasa dan susunan', () => {
  it('judul Indonesia dikenali', () => {
    const { baris } = bacaTabel('Nama Produk,Harga Jual\nNasi Goreng,25.000');
    expect(baris[0].nama).toBe('Nasi Goreng');
    expect(baris[0].harga).toBe(25000);
  });

  it('judul Inggris dikenali', () => {
    const { baris } = bacaTabel('Product Name,Price\nFried Rice,25000');
    expect(baris[0].harga).toBe(25000);
  });

  it('susunan kolom tidak harus urut', () => {
    const { baris } = bacaTabel('Kategori,Harga,Nama\nMakanan,25.000,Nasi Goreng');
    expect(baris[0].nama).toBe('Nasi Goreng');
    expect(baris[0].harga).toBe(25000);
    expect(baris[0].kategori).toBe('Makanan');
  });

  it('kolom yang dikenali dilaporkan, supaya pemetaannya bisa diperiksa', () => {
    const { kolomDikenali } = bacaTabel('Nama,Harga,Kategori\nNasi,25000,Makanan');
    expect(kolomDikenali.nama).toBe('Nama');
    expect(kolomDikenali.harga).toBe('Harga');
    expect(kolomDikenali.kategori).toBe('Kategori');
  });
});

describe('berkas yang tidak sempurna tetap berguna', () => {
  it('tanpa kolom harga: produk TETAP masuk, ditandai untuk diisi manual', () => {
    // Menolaknya berarti merchant harus menyusun ulang berkasnya lebih dulu.
    const { baris } = bacaTabel('Nama\nNasi Goreng\nAyam Bakar');
    expect(baris).toHaveLength(2);
    expect(baris[0].harga).toBe(0);
    expect(baris[0].catatan.join(' ')).toContain('isi manual');
    expect(baris[0].keyakinan).toBeLessThan(0.7);
  });

  it('harga tak terbaca ditandai, barisnya tidak dibuang', () => {
    const { baris } = bacaTabel('Nama,Harga\nNasi Goreng,gratis');
    expect(baris).toHaveLength(1);
    expect(baris[0].harga).toBe(0);
    expect(baris[0].catatan.join(' ')).toContain('tidak terbaca');
  });

  it('baris tanpa nama dilewati beserta alasannya', () => {
    const { baris, dilewati } = bacaTabel('Nama,Harga\n,25000\nNasi,30000');
    expect(baris).toHaveLength(1);
    expect(dilewati[0].alasan).toContain('nama produk kosong');
  });

  it('tanpa kolom nama sama sekali: menolak DENGAN cara memperbaikinya', () => {
    const { baris, dilewati } = bacaTabel('Kolom A,Kolom B\nfoo,bar');
    expect(baris).toHaveLength(0);
    // Pesan galat yang tidak memberi tahu cara memperbaikinya adalah pesan
    // galat yang membuat orang menyerah.
    expect(dilewati[0].alasan).toContain('"Nama"');
  });

  it('berkas kosong menghasilkan nol baris, bukan galat', () => {
    expect(bacaTabel('').baris).toEqual([]);
  });
});
