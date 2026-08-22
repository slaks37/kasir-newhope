/**
 * Enam algoritma insight yang dijalankan batch semalam.
 *
 * Semuanya fungsi murni atas transaksi, jadi diuji tanpa database — yang
 * dijaga di sini bukan pipa datanya melainkan aritmetikanya, dan aritmetika
 * yang salah tetap salah walaupun querynya benar.
 *
 * Yang paling penting dari berkas ini adalah tes-tes DIAM: setiap algoritma
 * punya ambang, dan algoritma yang selalu berbicara sama tidak bergunanya
 * dengan algoritma yang tidak pernah berbicara. Kartu yang muncul setiap hari
 * dengan isi yang sama adalah kartu yang berhenti dibaca orang.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeFinancialPerformance, buildFinancialRow,
  computeOperationalPeak, buildPeakRow,
  computeCalendarBehavior, buildCalendarRow,
  computeShiftPerformance, buildShiftRow,
  computeLayoutUtilisation, buildLayoutRow,
  computeStaffBehaviour, buildStaffRow,
  berlakuUntukSektor, CAKUPAN_BAWAAN,
} from '../scripts/batch/daily-insights.mjs';

const HARI = 86_400_000;

/**
 * Titik acuan waktu yang TETAP untuk seluruh berkas ini.
 *
 * Tanpa acuan tetap, `txn(0, 12)` menaruh transaksi jam 12.00 WIB hari ini —
 * yang masih di MASA DEPAN bila tesnya dijalankan pagi hari, jadi ikut
 * tersaring keluar dari jendela analisis. Hasilnya tes yang lulus sore dan
 * gagal pagi, kegagalan yang tidak ada hubungannya dengan kodenya.
 */
const SEKARANG = new Date();
SEKARANG.setUTCHours(23, 59, 0, 0);

/** Transaksi pada `n` hari lalu, jam `jamWib` waktu setempat. */
function txn(n: number, jamWib: number, opsi: any = {}) {
  const d = new Date(SEKARANG.getTime() - n * HARI);
  d.setUTCHours(jamWib - 7, 0, 0, 0);
  return {
    id: `t-${n}-${jamWib}-${Math.random().toString(36).slice(2, 7)}`,
    date: d.toISOString(),
    status: 'COMPLETED',
    totalAmount: 100_000,
    discountAmount: 0,
    orderType: 'TAKEAWAY',
    cashierUserId: 'u1',
    items: [{ quantity: 1, unitPrice: 100_000, unitCost: 40_000 }],
    ...opsi,
  };
}

describe('cakupan sektor', () => {
  it('kategori global berlaku di semua sektor', () => {
    for (const s of ['FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP']) {
      expect(berlakuUntukSektor('CRM_CHURN', s)).toBe(true);
      expect(berlakuUntukSektor('FINANCIAL_PERFORMANCE', s)).toBe(true);
    }
  });

  it('perputaran tempat TIDAK berlaku untuk toko tanpa tempat duduk', () => {
    expect(berlakuUntukSektor('LAYOUT_UTILISATION', 'FNB')).toBe(true);
    expect(berlakuUntukSektor('LAYOUT_UTILISATION', 'RETAIL')).toBe(false);
    expect(berlakuUntukSektor('LAYOUT_UTILISATION', 'CARWASH')).toBe(false);
  });

  it('cakupan dari database menimpa bawaan, bukan digabung', () => {
    const dariDb = { LAYOUT_UTILISATION: ['RETAIL'] };
    expect(berlakuUntukSektor('LAYOUT_UTILISATION', 'RETAIL', dariDb)).toBe(true);
    expect(berlakuUntukSektor('LAYOUT_UTILISATION', 'FNB', dariDb)).toBe(false);
    // Kategori yang tidak ada di daftar tidak dijalankan diam-diam.
    expect(berlakuUntukSektor('CRM_CHURN', 'FNB', dariDb)).toBe(false);
  });

  it('daftar bawaan memuat sembilan kategori', () => {
    expect(Object.keys(CAKUPAN_BAWAAN)).toHaveLength(9);
  });
});

describe('kesejajaran batch dengan ai.algorithm_scope', () => {
  /*
   * Dua daftar yang sama harus tetap sama.
   *
   * Cakupan bawaan di batch dipakai saat tabelnya tidak terbaca — mode
   * --dry-run, atau database yang belum menerapkan 0028. Kalau isinya
   * berbeda dari migrasinya, dry-run menjanjikan kartu yang tidak muncul di
   * produksi, dan ketidaksesuaian itu tidak akan pernah menimbulkan galat.
   */
  const sql = readFileSync(
    new URL('../migrations/0028_langganan_per_merchant.sql', import.meta.url), 'utf8');

  it('kategori yang sama, tidak lebih dan tidak kurang', () => {
    const dariSql = [...sql.matchAll(/\('([A-Z_]+)',\s+(?:NULL|ARRAY\[)/g)].map((m) => m[1]);
    expect(new Set(dariSql)).toEqual(new Set(Object.keys(CAKUPAN_BAWAAN)));
  });

  it('sektor yang sama untuk kategori yang dibatasi', () => {
    for (const [kategori, sektor] of Object.entries(CAKUPAN_BAWAAN)) {
      if (sektor === null) {
        expect(sql).toContain(`('${kategori}',`);
        continue;
      }
      const pola = new RegExp(`\\('${kategori}',\\s+ARRAY\\[([^\\]]+)\\]`);
      const cocok = sql.match(pola);
      expect(cocok, `${kategori} tidak punya ARRAY sektor di migrasi`).not.toBeNull();
      const dariSql = cocok![1].split(',').map((x) => x.trim().replace(/'/g, ''));
      expect(dariSql).toEqual(sektor);
    }
  });
});

describe('FINANCIAL_PERFORMANCE', () => {
  /** 30 hari berjalan + 30 hari pembanding, dengan modal yang bisa diatur. */
  const dataDuaPeriode = (modalBaru: number, modalLama: number) => [
    ...Array.from({ length: 30 }, (_, i) =>
      txn(i, 12, { items: [{ quantity: 1, unitPrice: 100_000, unitCost: modalBaru }] })),
    ...Array.from({ length: 30 }, (_, i) =>
      txn(i + 30, 12, { items: [{ quantity: 1, unitPrice: 100_000, unitCost: modalLama }] })),
  ];

  it('margin dihitung dari modal DI BARIS STRUK, bukan harga hari ini', () => {
    const f = computeFinancialPerformance(dataDuaPeriode(60_000, 40_000), { now: SEKARANG });
    expect(f.kini.margin).toBeCloseTo(0.4, 3);   // 100rb - 60rb
    expect(f.lalu.margin).toBeCloseTo(0.6, 3);   // 100rb - 40rb
  });

  it('penurunan margin dilaporkan dalam POIN persentase', () => {
    const f = computeFinancialPerformance(dataDuaPeriode(60_000, 40_000), { now: SEKARANG });
    expect(f.deltaMarginPp).toBe(-20);           // 60% -> 40%
    const row = buildFinancialRow('m1', '2026-01-01', f);
    expect(row.priority).toBe(1);                // turun >3 poin: perlu ditindak
    expect(row.title).toContain('poin');
  });

  it('omzet naik sambil margin turun tetap dilaporkan sebagai masalah margin', () => {
    const orders = [
      // Periode berjalan: struk lebih banyak, modal jauh lebih tinggi.
      ...Array.from({ length: 60 }, (_, i) =>
        txn(i % 30, 12, { items: [{ quantity: 1, unitPrice: 100_000, unitCost: 80_000 }] })),
      ...Array.from({ length: 30 }, (_, i) =>
        txn(i + 30, 12, { items: [{ quantity: 1, unitPrice: 100_000, unitCost: 40_000 }] })),
    ];
    const f = computeFinancialPerformance(orders, { now: SEKARANG });
    expect(f.deltaOmzet).toBeGreaterThan(0);     // omzet NAIK
    expect(f.deltaMarginPp).toBeLessThan(0);     // margin TURUN
    expect(buildFinancialRow('m1', '2026-01-01', f).title).toContain('Margin turun');
  });

  it('TIDAK mengklaim pertumbuhan saat periode pembanding hampir kosong', () => {
    // Toko yang baru berdagang 30 hari: pembandingnya cuma 3 hari.
    const orders = [
      ...Array.from({ length: 30 }, (_, i) => txn(i, 12)),
      ...Array.from({ length: 3 }, (_, i) => txn(i + 30, 12)),
    ];
    const f = computeFinancialPerformance(orders, { now: SEKARANG });
    expect(f.layakDibanding).toBe(false);
    expect(f.deltaOmzet).toBeNull();
    const row = buildFinancialRow('m1', '2026-01-01', f);
    expect(row.title).not.toContain('naik');
    expect(row.summary).toContain('Belum ada periode sebelumnya');
  });

  it('transaksi batal tidak ikut dihitung', () => {
    const f = computeFinancialPerformance([
      ...Array.from({ length: 30 }, (_, i) => txn(i, 12)),
      ...Array.from({ length: 30 }, (_, i) => txn(i, 12, { status: 'CANCELLED', totalAmount: 9_000_000 })),
    ], { now: SEKARANG });
    expect(f.kini.omzet).toBe(30 * 100_000);
  });

  it('tanpa transaksi sama sekali: tidak ada kartu, bukan kartu berisi nol', () => {
    expect(computeFinancialPerformance([])).toBeNull();
    expect(buildFinancialRow('m1', '2026-01-01', null)).toBeNull();
  });
});

describe('OPERATIONAL_PEAK', () => {
  it('menemukan jam sibuk yang sesungguhnya', () => {
    const orders = [];
    for (let h = 0; h < 14; h++) {
      for (let k = 0; k < 8; k++) orders.push(txn(h, 12));  // ramai jam 12
      orders.push(txn(h, 9));
      orders.push(txn(h, 16));
    }
    const p = computeOperationalPeak(orders);
    expect(p.puncak.jam).toBe(12);
    expect(p.rasioPuncak).toBeGreaterThan(1.5);
    expect(buildPeakRow('m1', '2026-01-01', p).title).toContain('12.00');
  });

  it('DIAM saat bebannya memang rata sepanjang hari', () => {
    const orders = [];
    for (let h = 0; h < 14; h++) for (const jam of [9, 12, 15, 18]) orders.push(txn(h, jam));
    const p = computeOperationalPeak(orders);
    expect(p.rasioPuncak).toBeLessThan(1.5);
    expect(buildPeakRow('m1', '2026-01-01', p)).toBeNull();
  });

  it('dihitung per HARI BUKA, bukan total — satu hari ramai tidak menang sendiri', () => {
    const orders = [
      // Satu hari dengan 20 transaksi jam 8, dan 14 hari dengan 3 transaksi jam 12.
      ...Array.from({ length: 20 }, () => txn(0, 8)),
      ...Array.from({ length: 14 }, (_, h) => [txn(h, 12), txn(h, 12), txn(h, 12)]).flat(),
    ];
    const p = computeOperationalPeak(orders);
    // Total jam 8 (20) lebih besar dari total jam 12 (42/14=3 per hari)…
    const jam8 = p.jam.find((j: any) => j.jam === 8);
    const jam12 = p.jam.find((j: any) => j.jam === 12);
    expect(jam8.totalStruk).toBe(20);
    // …tapi per hari buka, jam 8 hanya 20/14 = 1.43 dan jam 12 tetap 3.
    expect(jam12.strukPerHari).toBeGreaterThan(jam8.strukPerHari);
    expect(p.puncak.jam).toBe(12);
  });
});

describe('CALENDAR_BEHAVIOR', () => {
  it('membandingkan RATA-RATA per hari, bukan jumlah kemunculan', () => {
    // 35 hari: setiap hari sama ramai kecuali Sabtu yang tiga kali lipat.
    const orders = [];
    for (let n = 0; n < 35; n++) {
      const d = new Date(Date.now() - n * HARI);
      const sabtu = d.getDay() === 6;
      for (let k = 0; k < (sabtu ? 3 : 1); k++) orders.push(txn(n, 12));
    }
    const c = computeCalendarBehavior(orders);
    expect(c.terbaik.nama).toBe('Sabtu');
    expect(c.rasio).toBeGreaterThan(2);
  });

  it('DIAM saat semua hari sama ramai', () => {
    const orders = Array.from({ length: 28 }, (_, n) => txn(n, 12));
    expect(buildCalendarRow('m1', '2026-01-01', computeCalendarBehavior(orders))).toBeNull();
  });

  it('butuh minimal tiga hari berbeda sebelum berpendapat', () => {
    const orders = [txn(0, 12), txn(1, 12)];
    expect(computeCalendarBehavior(orders)).toBeNull();
  });
});

describe('SHIFT_PERFORMANCE', () => {
  it('membandingkan shift dan menyebut yang tertinggal', () => {
    const orders = [];
    for (let h = 0; h < 14; h++) {
      for (let k = 0; k < 5; k++) orders.push(txn(h, 13));  // siang ramai
      orders.push(txn(h, 8));                                // pagi sepi
    }
    const s = computeShiftPerformance(orders);
    expect(s.terbaik.nama).toBe('Siang');
    expect(s.terlemah.nama).toBe('Pagi');
    expect(buildShiftRow('m1', '2026-01-01', s).title).toContain('Pagi');
  });

  it('satu shift saja: tidak ada yang bisa dibandingkan', () => {
    const orders = Array.from({ length: 14 }, (_, h) => txn(h, 13));
    expect(computeShiftPerformance(orders)).toBeNull();
  });

  it('DIAM saat selisih antar shift kecil', () => {
    const orders = [];
    for (let h = 0; h < 14; h++) { orders.push(txn(h, 9)); orders.push(txn(h, 13)); }
    expect(buildShiftRow('m1', '2026-01-01', computeShiftPerformance(orders))).toBeNull();
  });
});

describe('LAYOUT_UTILISATION', () => {
  const ditempat = (n: number, jam: number) => txn(n, jam, { orderType: 'DINE_IN' });

  it('mengukur pesanan yang dilayani di tempat dan jam puncaknya', () => {
    const orders = [];
    for (let h = 0; h < 14; h++) {
      for (let k = 0; k < 6; k++) orders.push(ditempat(h, 12));
      orders.push(ditempat(h, 16));
      orders.push(txn(h, 16));   // bawa pulang: tidak menempati tempat
    }
    const l = computeLayoutUtilisation(orders);
    expect(l.puncak.jam).toBe(12);
    expect(l.porsiDitempat).toBeCloseTo(7 / 8, 2);
    expect(buildLayoutRow('m1', '2026-01-01', l).title).toContain('12.00');
  });

  it('DIAM saat hampir semua pesanan dibawa pulang', () => {
    const orders = [
      ...Array.from({ length: 50 }, (_, i) => txn(i % 14, 12)),
      ...Array.from({ length: 3 }, (_, i) => ditempat(i, 12)),
    ];
    expect(buildLayoutRow('m1', '2026-01-01', computeLayoutUtilisation(orders))).toBeNull();
  });

  it('mengaku memakai order_type sebagai pendekatan, bukan hitungan meja', () => {
    const orders = Array.from({ length: 14 }, (_, h) => ditempat(h, 12));
    expect(computeLayoutUtilisation(orders).basis).toBe('ORDER_TYPE_DINE_IN');
  });

  it('tanpa pesanan di tempat sama sekali: tidak ada kartu', () => {
    const orders = Array.from({ length: 14 }, (_, h) => txn(h, 12));
    expect(computeLayoutUtilisation(orders)).toBeNull();
  });
});

describe('STAFF_BEHAVIOUR', () => {
  const kasir = (id: string, n: number, opsi: any = {}) =>
    Array.from({ length: n }, (_, i) => txn(i % 14, 12, { cashierUserId: id, ...opsi }));

  it('menandai kasir yang pola diskonnya jauh dari kebiasaan tim', () => {
    const s = computeStaffBehaviour([
      ...kasir('u1', 40, { nama: 'Andi' }),                                  // tanpa diskon
      ...kasir('u2', 40, { discountAmount: 20_000, cashierName: 'Sari' }),   // selalu diskon
    ]);
    const row = buildStaffRow('m1', '2026-01-01', s);
    expect(row).not.toBeNull();
    expect(row.title).toContain('diskon');
    // Kalimatnya mengajak memeriksa, tidak menuduh.
    expect(row.summary).toContain('Belum tentu keliru');
  });

  it('butuh minimal dua kasir dengan cukup struk', () => {
    expect(computeStaffBehaviour(kasir('u1', 100))).toBeNull();
    // Kasir kedua hanya 5 struk: di bawah ambang, tidak layak dibandingkan.
    expect(computeStaffBehaviour([...kasir('u1', 100), ...kasir('u2', 5)])).toBeNull();
  });

  it('DIAM saat semua kasir berperilaku serupa', () => {
    const s = computeStaffBehaviour([...kasir('u1', 40), ...kasir('u2', 40)]);
    expect(buildStaffRow('m1', '2026-01-01', s)).toBeNull();
  });

  it('transaksi tanpa kasir tidak menciptakan kasir hantu', () => {
    const s = computeStaffBehaviour([
      ...kasir('u1', 40),
      ...kasir('u2', 40, { discountAmount: 20_000 }),
      ...Array.from({ length: 30 }, (_, i) => txn(i % 14, 12, { cashierUserId: null })),
    ]);
    expect(s.staf.map((x: any) => x.kasir).sort()).toEqual(['u1', 'u2']);
  });
});
