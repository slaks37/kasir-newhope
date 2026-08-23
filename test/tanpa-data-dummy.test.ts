/**
 * TIDAK ADA DATA DUMMY YANG BOLEH KEMBALI.
 *
 * Data contoh selalu masuk dengan niat baik: supaya layarnya tidak kosong saat
 * dikembangkan. Lalu ia tinggal, dan pemilik toko yang baru mendaftar membuka
 * aplikasi dan melihat omzet Rp 2.800.000 atas nama kasir yang tidak pernah ia
 * pekerjakan. Yang paling berbahaya justru yang paling tidak berisik:
 *
 *   - INITIAL_SHIFT berisi shift lengkap milik "Budi Santoso" dengan omzet
 *     Rp 2,8 juta dan modal awal Rp 500.000. Header mencetak `totalSales` apa
 *     adanya, dan angka itu ikut ke `expectedCash` — sehingga tutup kas
 *     pertama melaporkan selisih Rp 1,28 juta terhadap laci yang kosong.
 *   - Alamat 'Jl. Utama Resto No. 123' dan telepon '081234567890' tercetak di
 *     STRUK setiap toko yang belum sempat membuka layar Pengaturan.
 *   - Nilai cadangan `|| 'Budi Santoso'` membuat layar menyebut nama orang di
 *     tempat yang sebenarnya kosong — termasuk pada kolom "siapa yang
 *     melakukan penyesuaian stok".
 *   - Testimoni bernama lengkap di halaman depan, di bawah judul "Dipercaya
 *     oleh Ribuan Pemilik Usaha", untuk orang yang tidak ada.
 *
 * Berkas ini membaca sumbernya, bukan mempercayai ingatan siapa pun.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  INITIAL_SHIFT,
  INITIAL_SETTINGS,
  INITIAL_PRODUCTS,
  INITIAL_CATEGORIES,
  INITIAL_CUSTOMERS,
  INITIAL_USERS,
  INITIAL_HISTORICAL_ORDERS,
  INITIAL_STAFF_MEMBERS,
  INITIAL_STOCK_ITEMS,
  INITIAL_BUNDLES,
  INITIAL_BRANCHES,
  INITIAL_TABLES,
  INITIAL_PROMO_CODES,
  INITIAL_ATTENDANCE_LOGS,
} from '../src/data/initialData';
import { BUSINESS_PRESETS } from '../src/data/businessPresets';

/** Membaca seluruh berkas sumber di src/, tanpa komentar. */
function berkasSumber(): Array<{ path: string; kode: string }> {
  const hasil: Array<{ path: string; kode: string }> = [];
  const telusuri = (dir: string) => {
    for (const nama of readdirSync(dir)) {
      const p = join(dir, nama);
      if (statSync(p).isDirectory()) { telusuri(p); continue; }
      if (!/\.(ts|tsx)$/.test(nama)) continue;
      const mentah = readFileSync(p, 'utf8');
      // Komentar dibuang lebih dulu. Penjelasan tentang lubang lama justru
      // berharga dan harus tetap boleh menyebut nama yang dulu ada di sana.
      const kode = mentah
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      hasil.push({ path: p, kode });
    }
  };
  telusuri('src');
  return hasil;
}

const SUMBER = berkasSumber();

/* ========================================================================== */

describe('nilai awal tidak mengandung data siapa pun', () => {

  it('SHIFT AWAL nol seluruhnya — inilah sumber "omzet" yang tak dijelaskan', () => {
    expect(INITIAL_SHIFT.totalSales).toBe(0);
    expect(INITIAL_SHIFT.cashSales).toBe(0);
    expect(INITIAL_SHIFT.qrisSales).toBe(0);
    expect(INITIAL_SHIFT.cardSales).toBe(0);
    expect(INITIAL_SHIFT.eWalletSales).toBe(0);
    expect(INITIAL_SHIFT.initialCash).toBe(0);
    expect(INITIAL_SHIFT.expectedCash).toBe(0);
    expect(INITIAL_SHIFT.cashierName).toBe('');
    // Toko yang belum pernah dibuka siapa pun tidak sedang di tengah shift.
    expect(INITIAL_SHIFT.status).toBe('CLOSED');
  });

  it('IDENTITAS TOKO kosong — ia tercetak di struk pelanggan', () => {
    expect(INITIAL_SETTINGS.storeName).toBe('');
    expect(INITIAL_SETTINGS.address).toBe('');
    expect(INITIAL_SETTINGS.phone).toBe('');
    expect(INITIAL_SETTINGS.receiptHeader).toBe('');
  });

  it('tidak menunjuk cabang yang tidak ada', () => {
    // 'branch-senayan' membuat setiap pencarian cabang aktif mengembalikan
    // undefined, dan geofence absensi kehilangan titik pembandingnya diam-diam.
    expect(INITIAL_SETTINGS.activeBranchId).toBeUndefined();
    expect(INITIAL_SETTINGS.branches).toEqual([]);
  });

  it('seluruh koleksi awal kosong', () => {
    const koleksi = {
      INITIAL_PRODUCTS, INITIAL_CATEGORIES, INITIAL_CUSTOMERS, INITIAL_USERS,
      INITIAL_HISTORICAL_ORDERS, INITIAL_STAFF_MEMBERS, INITIAL_STOCK_ITEMS,
      INITIAL_BUNDLES, INITIAL_BRANCHES, INITIAL_TABLES, INITIAL_PROMO_CODES,
      INITIAL_ATTENDANCE_LOGS,
    };
    const berisi = Object.entries(koleksi)
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${k} (${v.length})`);
    expect(berisi, `koleksi awal harus kosong: ${berisi.join(', ')}`).toEqual([]);
  });

  it('preset sektor tidak membawa katalog bawaan', () => {
    for (const p of Object.values(BUSINESS_PRESETS)) {
      expect(p.products, `${p.id}.products`).toEqual([]);
      expect(p.categories, `${p.id}.categories`).toEqual([]);
      expect(p.tables, `${p.id}.tables`).toEqual([]);
    }
  });
});

/* ========================================================================== */

describe('tidak ada nama orang sebagai nilai cadangan', () => {

  const NAMA_CONTOH = [
    'Budi Santoso', 'Ahmad Kasir', 'Siti Aminah', 'Doni Pratama',
    'Hendra Wijaya', 'Rian Ardiansyah', 'Dewi Lestari',
  ];

  it('nama contoh tidak muncul di kode mana pun', () => {
    const kena: string[] = [];
    for (const { path, kode } of SUMBER) {
      for (const nama of NAMA_CONTOH) {
        if (kode.includes(nama)) kena.push(`${path}: ${nama}`);
      }
    }
    expect(kena, `nama contoh masih ada di kode: ${kena.join(', ')}`).toEqual([]);
  });

  it('alamat dan telepon contoh tidak muncul', () => {
    const kena = SUMBER
      .filter(({ kode }) =>
        kode.includes('Jl. Utama Resto') ||
        kode.includes('081234567890') ||
        kode.includes('budi@newhope.id') ||
        kode.includes('branch-senayan'))
      .map(({ path }) => path);
    expect(kena, `identitas contoh masih ada: ${kena.join(', ')}`).toEqual([]);
  });
});

/* ========================================================================== */

describe('penghapusan data berbasis waktu sudah dibuang', () => {

  it('tidak ada reset demo yang menghapus localStorage berkala', () => {
    // `enforce12HourDemoReset()` menghapus setiap kunci berawalan `newhope_`
    // setiap 12 jam — termasuk `newhope_sync_queue_*`, yaitu struk yang sudah
    // dibayar dan belum terkirim. Warung 24 jam kehilangan penjualan yang
    // sudah terjadi, tanpa galat dan tanpa jejak di laporan mana pun.
    const kena = SUMBER
      .filter(({ kode }) => /enforce\d*HourDemoReset\s*\(/.test(kode))
      .map(({ path }) => path);
    expect(kena, `reset demo masih dipanggil: ${kena.join(', ')}`).toEqual([]);
  });

  it('tidak ada yang menghapus antrian sinkron secara massal', () => {
    const kena = SUMBER
      .filter(({ kode }) =>
        /startsWith\(\s*['"]newhope_['"]\s*\)/.test(kode) &&
        /removeItem/.test(kode))
      .map(({ path }) => path);
    expect(kena, `penghapusan massal localStorage: ${kena.join(', ')}`).toEqual([]);
  });
});

/* ========================================================================== */

describe('halaman publik tidak memuat testimoni palsu', () => {

  it('daftar testimoni kosong dan bagiannya tidak dirender saat kosong', () => {
    const home = readFileSync('src/components/home/HomePage.tsx', 'utf8');
    expect(home).toMatch(/const testimonials[^=]*=\s*\[\s*\]/);
    // Judul "Dipercaya oleh Ribuan Pemilik Usaha" di atas kartu yang tidak ada
    // isinya adalah klaim yang sama saja — hanya lebih kentara.
    expect(home).toContain('{testimonials.length > 0 && (');
  });

  it('artikel blog ditandatangani penerbitnya, bukan orang yang tidak ada', () => {
    const blog = readFileSync('src/lib/blogStorage.ts', 'utf8');
    const penulis = [...blog.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(penulis.length).toBeGreaterThan(0);
    for (const n of penulis) expect(n).toBe('Redaksi Harapan Baru');
    // Foto wajah orang asli dari bank foto stok untuk penulis yang tidak ada.
    expect(blog).not.toContain('avatar:');
  });
});

/* ========================================================================== */

describe('perkakas yang bisa menghapus produksi menolak sendiri', () => {

  it('seeder menolak DATABASE_URL yang bukan lokal', () => {
    const seed = readFileSync('scripts/db/seed.ts', 'utf8');
    expect(seed).toContain('pastikanDatabaseLokal');
    // Pagarnya harus berjalan SEBELUM koneksi dibuka, bukan sesudah.
    const posPagar = seed.indexOf('pastikanDatabaseLokal(process.env.DATABASE_URL');
    const posDb = seed.indexOf('const db = await getDb', seed.indexOf('async function main'));
    expect(posPagar).toBeGreaterThan(0);
    expect(posPagar).toBeLessThan(posDb);
  });
});
