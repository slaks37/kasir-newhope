/**
 * TIDAK ADA JALAN MASUK TANPA LOGIN, DAN TIDAK ADA DATA PALSU DI AKUN BARU.
 *
 * Tiga lubang yang ditutup berkas ini, ketiganya pernah ada sekaligus:
 *
 *   1. PINTU BELAKANG DI LAYAR MASUK. Email apa pun yang mengandung kata
 *      "admin", "budi", "stefen", atau "ops" diterima DENGAN PASSWORD APA PUN.
 *      Tidak ada satu permintaan pun ke server.
 *
 *   2. SESI BUATAN SENDIRI. Bila Supabase belum dikonfigurasi, seluruh
 *      autentikasi berjalan di dalam browser: "mendaftar" dengan email apa pun
 *      langsung memberi sesi dan membuka aplikasi kasir penuh.
 *
 *   3. DATA PALSU DI AKUN SUNGGUHAN. Setiap toko baru lahir berisi 86 baris
 *      contoh — termasuk riwayat penjualan, sehingga layar laporan pemilik
 *      menunjukkan omzet dari transaksi yang tidak pernah terjadi, dan sebuah
 *      akun ADMIN bernama "Budi Santoso" ber-PIN 1234 yang sama di semua toko.
 *
 * Yang diuji di sini adalah SUMBERNYA, bukan tampilannya: begitu data contoh
 * kembali terisi atau jalur lokal kembali dipakai, tes ini merah.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as awal from '../src/data/initialData';

const baca = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/**
 * Membuang komentar sebelum memeriksa.
 *
 * Yang diuji adalah KODE yang berjalan. Tanpa ini, komentar yang menjelaskan
 * lubang lama — dan komentar semacam itu justru berharga — membuat tesnya
 * merah, lalu orang menghapus penjelasannya alih-alih menjaga kodenya.
 */
const kode = (p: string) =>
  baca(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('tidak ada jalan masuk tanpa login', () => {
  const auth = kode('src/context/AuthContext.tsx');

  it('pintu belakang berbasis nama email sudah tidak ada', () => {
    // Pola aslinya. Dicari sebagai KODE, bukan sekadar kata — komentar yang
    // menjelaskan sejarahnya boleh tetap menyebutnya.
    expect(auth).not.toMatch(/const isDemo\s*=/);
    expect(auth).not.toMatch(/cleanEmail\.includes\(/);
  });

  it('tidak ada lagi sesi yang dibuat di dalam browser', () => {
    expect(auth).not.toMatch(/function createLocalSession/);
    expect(auth).not.toMatch(/saveLocalUser\(/);
  });

  it('tanpa konfigurasi, setiap jalur masuk MENOLAK — bukan memalsukan', () => {
    // Empat jalur: pulihkan sesi, Google, masuk email, daftar email.
    const cabang = auth.match(/if \(!isSupabaseConfigured\)/g) ?? [];
    expect(cabang.length).toBeGreaterThanOrEqual(4);
    // Dan tidak satu pun dari mereka mengembalikan sukses.
    expect(auth).not.toMatch(/if \(!isSupabaseConfigured\)[\s\S]{0,400}?return \{ error: null \}/);
  });

  it('aplikasi kasir hanya dirender ketika ada pengguna', () => {
    const app = kode('src/App.tsx');
    // Gerbangnya: seluruh cabang tanpa pengguna berakhir di halaman depan,
    // masuk, daftar, atau blog — tidak ada satu pun yang merender POS.
    expect(app).toMatch(/if \(!user\) \{/);
    expect(app).not.toMatch(/guest_mode['"]\s*\)\s*(===|==)\s*['"]true/);
  });

  it('halaman depan mengajak mendaftar, bukan membuka kasir', () => {
    const home = kode('src/components/home/HomePage.tsx');
    // handleOpenPOS pernah jatuh ke setActiveTab('pos'), yang membuka aplikasi
    // penuh untuk pengunjung tanpa akun.
    expect(home).not.toMatch(/setActiveTab\(['"]pos['"]\)/);
  });
});

describe('akun baru dimulai bersih', () => {
  it('tidak ada pelanggan, riwayat penjualan, atau promo contoh', () => {
    expect(awal.INITIAL_CUSTOMERS).toEqual([]);
    // Yang paling menyesatkan dari semuanya: omzet dari penjualan yang tidak
    // pernah terjadi, di layar laporan pemiliknya sendiri.
    expect(awal.INITIAL_HISTORICAL_ORDERS).toEqual([]);
    expect(awal.INITIAL_PROMO_CODES).toEqual([]);
  });

  it('tidak ada staf, absensi, stok, bundle, atau cabang contoh', () => {
    expect(awal.INITIAL_STAFF_MEMBERS).toEqual([]);
    expect(awal.INITIAL_ATTENDANCE_LOGS).toEqual([]);
    expect(awal.INITIAL_STOCK_ITEMS).toEqual([]);
    expect(awal.INITIAL_BUNDLES).toEqual([]);
    expect(awal.INITIAL_BRANCHES).toEqual([]);
  });

  it('katalog dimulai kosong, bukan berisi menu contoh', () => {
    expect(awal.INITIAL_PRODUCTS).toEqual([]);
    expect(awal.INITIAL_CATEGORIES).toEqual([]);
    expect(awal.INITIAL_TABLES).toEqual([]);
  });

  it('tidak ada akun ADMIN bawaan ber-PIN sama untuk semua toko', () => {
    expect(awal.INITIAL_USERS).toEqual([]);
    const pemilik = awal.buatPemilik({ id: 'usr-abc', email: 'pemilik@toko.id' });
    expect(pemilik.role).toBe('ADMIN');
    expect(pemilik.id).toBe('usr-abc');
    // PIN kosong: pemilik memasangnya sendiri. PIN bawaan yang sama untuk semua
    // orang bukan pengamanan, hanya penundaan.
    expect(pemilik.pin).toBe('');
  });

  it('pemilik memakai identitas akunnya sendiri, bukan nama contoh', () => {
    const p = awal.buatPemilik({ id: 'usr-x', email: 'sari@warung.id', nama: 'Bu Sari' });
    expect(p.name).toBe('Bu Sari');
    expect(p.email).toBe('sari@warung.id');
    const tanpaNama = awal.buatPemilik({ id: 'usr-y', email: 'joko@laundry.id' });
    expect(tanpaNama.name).toBe('joko');
  });

  it('preset sektor tidak lagi mengisi katalog akun sungguhan', () => {
    const ctx = kode('src/context/POSContext.tsx');
    for (const p of ['preset.products', 'preset.categories', 'preset.tables',
                     'defaultPreset.products', 'defaultPreset.categories', 'defaultPreset.tables']) {
      expect(ctx.includes(`, ${p})`), `${p} masih dipakai sebagai isi awal`).toBe(false);
    }
  });
});
