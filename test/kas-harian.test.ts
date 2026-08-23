/**
 * BUKU KAS HARIAN — omzet, modal awal, uang masuk, uang keluar.
 *
 * KEKELIRUAN YANG DIBUKTIKAN SUDAH TERTUTUP.
 *
 * Sampai sekarang aplikasi hanya mengenal satu arah uang: penjualan. Isi laci
 * dihitung `modal awal + penjualan tunai`, dan tidak ada satu pun tempat untuk
 * mencatat uang yang KELUAR. Di warung yang sesungguhnya laci dipakai untuk
 * belanja bahan mendadak, bayar ojek, kasbon, dan setoran ke bank — sehingga
 * setiap tutup kas melaporkan selisih atas uang yang jelas ke mana perginya.
 *
 * Selisih kas dipakai untuk menilai kejujuran orang. Sistem yang membuat
 * selisih itu tak terhindarkan tidak sekadar salah hitung: ia menuduh orang
 * yang tidak melakukan apa-apa. Itu sebabnya berkas ini menguji arah uang,
 * tanda angka, dan batas hari sedetail ini.
 */

import { describe, it, expect } from 'vitest';
import {
  kunciHari,
  ringkasOmzet,
  ringkasKas,
  entriHari,
  kasShift,
} from '../src/lib/kas/buku';
import type { EntriKas, Order } from '../src/types';

const HARI = '2026-08-23';

function struk(p: {
  id: string;
  total: number;
  metode?: string;
  status?: string;
  jam?: string;
}): Order {
  return {
    id: p.id,
    date: `${HARI}T${p.jam ?? '10:00'}:00`,
    total: p.total,
    subtotal: p.total,
    paymentMethod: (p.metode ?? 'CASH') as any,
    status: (p.status ?? 'COMPLETED') as any,
    items: [],
    discountTotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
  } as unknown as Order;
}

function kas(p: {
  id: string;
  jenis: EntriKas['jenis'];
  jumlah: number;
  kategori?: string;
  jam?: string;
  shiftId?: string;
}): EntriKas {
  return {
    id: p.id,
    jenis: p.jenis,
    jumlah: p.jumlah,
    kategori: p.kategori ?? 'Lainnya',
    waktu: `${HARI}T${p.jam ?? '09:00'}:00`,
    shiftId: p.shiftId,
  };
}

/* ========================================================================== */

describe('omzet harian', () => {

  it('OMZET BUKAN KAS: QRIS menambah omzet tanpa menambah isi laci', () => {
    const r = ringkasOmzet([
      struk({ id: 'a', total: 1_000_000, metode: 'QRIS' }),
      struk({ id: 'b', total: 200_000, metode: 'CASH' }),
    ], HARI);

    expect(r.omzet).toBe(1_200_000);
    // Inilah pembedaan yang membuat pemilik berhenti mengira uangnya hilang:
    // omzet Rp 1,2 juta, tapi yang masuk laci hanya Rp 200.000.
    expect(r.omzetTunai).toBe(200_000);
    expect(r.omzetNonTunai).toBe(1_000_000);
  });

  it('struk BATAL dihitung terpisah, tidak dikurangkan diam-diam', () => {
    const r = ringkasOmzet([
      struk({ id: 'a', total: 100_000 }),
      struk({ id: 'b', total: 50_000, status: 'VOID' }),
    ], HARI);

    expect(r.omzet).toBe(100_000);
    expect(r.jumlahTransaksi).toBe(1);
    // Pembatalan yang lenyap dari layar tidak bisa ditelusuri — dan
    // pembatalan adalah tempat pertama yang diperiksa saat uang tidak cocok.
    expect(r.nilaiBatal).toBe(50_000);
    expect(r.jumlahBatal).toBe(1);
  });

  it('hari lain tidak ikut terhitung', () => {
    const lain = struk({ id: 'x', total: 999_000 });
    (lain as any).date = '2026-08-22T10:00:00';
    const r = ringkasOmzet([struk({ id: 'a', total: 10_000 }), lain], HARI);
    expect(r.omzet).toBe(10_000);
  });

  it('rata-rata nol saat belum ada transaksi, bukan NaN', () => {
    const r = ringkasOmzet([], HARI);
    expect(r.rataRata).toBe(0);
    expect(Number.isNaN(r.rataRata)).toBe(false);
  });

  it('batas hari mengikuti waktu perangkat, bukan UTC', () => {
    // Pukul 23.30 waktu setempat masih hari yang sama. Memakai UTC akan
    // memindahkannya ke besok bagi pemakai di WIB, dan rekap tutup kas malam
    // tidak akan pernah cocok dengan laci.
    expect(kunciHari(new Date(2026, 7, 23, 23, 30))).toBe('2026-08-23');
    expect(kunciHari(new Date(2026, 7, 24, 0, 5))).toBe('2026-08-24');
  });
});

/* ========================================================================== */

describe('buku kas', () => {

  it('SALDO LACI = modal + tunai + masuk lain − keluar', () => {
    const r = ringkasKas([
      kas({ id: 'k1', jenis: 'MODAL_AWAL', jumlah: 500_000 }),
      kas({ id: 'k2', jenis: 'KELUAR', jumlah: 150_000, kategori: 'Belanja Bahan Baku' }),
      kas({ id: 'k3', jenis: 'MASUK', jumlah: 100_000, kategori: 'Pelunasan Piutang' }),
    ], HARI, 300_000);

    expect(r.modalAwal).toBe(500_000);
    expect(r.penjualanTunai).toBe(300_000);
    expect(r.masukLain).toBe(100_000);
    expect(r.keluar).toBe(150_000);
    expect(r.saldoSeharusnya).toBe(750_000);
  });

  it('INILAH YANG DULU HILANG: belanja mengurangi saldo laci', () => {
    const tanpaBelanja = ringkasKas(
      [kas({ id: 'k1', jenis: 'MODAL_AWAL', jumlah: 500_000 })], HARI, 300_000);
    const denganBelanja = ringkasKas([
      kas({ id: 'k1', jenis: 'MODAL_AWAL', jumlah: 500_000 }),
      kas({ id: 'k2', jenis: 'KELUAR', jumlah: 200_000 }),
    ], HARI, 300_000);

    // Rumus lama menghasilkan 800.000 pada KEDUA keadaan, sehingga laci yang
    // isinya 600.000 dilaporkan kurang 200.000 — dan kasirnya yang ditanya.
    expect(tanpaBelanja.saldoSeharusnya).toBe(800_000);
    expect(denganBelanja.saldoSeharusnya).toBe(600_000);
  });

  it('tanda angka DIABAIKAN: arah uang hanya dari jenisnya', () => {
    // Baris bertanda minus yang lolos dari layar mana pun tidak boleh
    // MENAMBAH kas. Hasil yang salah di sini akan tetap tampak masuk akal,
    // sehingga tidak ada yang memeriksanya.
    const r = ringkasKas([
      kas({ id: 'k1', jenis: 'MODAL_AWAL', jumlah: 500_000 }),
      { ...kas({ id: 'k2', jenis: 'KELUAR', jumlah: 0 }), jumlah: -200_000 },
    ], HARI, 0);
    expect(r.keluar).toBe(200_000);
    expect(r.saldoSeharusnya).toBe(300_000);
  });

  it('saldo negatif TIDAK dibulatkan ke nol', () => {
    const r = ringkasKas([kas({ id: 'k1', jenis: 'KELUAR', jumlah: 250_000 })], HARI, 0);
    // Keadaan ini harus terlihat: pengeluaran melebihi apa pun yang pernah
    // masuk. Membulatkannya ke nol membuat layarnya rapi dan bukunya bohong.
    expect(r.saldoSeharusnya).toBe(-250_000);
  });

  it('penjualan TIDAK dicatat dua kali', () => {
    // Penjualan tunai masuk lewat argumen, bukan lewat entri kas. Kalau
    // seseorang salah mencatatnya sebagai MASUK juga, angkanya memang
    // bertambah — dan itu memang yang tercatat. Yang dijamin di sini: buku
    // kas sendiri tidak pernah menambahkan penjualan atas inisiatifnya.
    const r = ringkasKas([], HARI, 300_000);
    expect(r.masukLain).toBe(0);
    expect(r.saldoSeharusnya).toBe(300_000);
  });

  it('rincian per kategori diurutkan dari yang terbesar', () => {
    const r = ringkasKas([
      kas({ id: 'a', jenis: 'KELUAR', jumlah: 50_000, kategori: 'Transport & Ongkir' }),
      kas({ id: 'b', jenis: 'KELUAR', jumlah: 300_000, kategori: 'Belanja Bahan Baku' }),
      kas({ id: 'c', jenis: 'KELUAR', jumlah: 25_000, kategori: 'Transport & Ongkir' }),
    ], HARI, 0);

    expect(r.keluarPerKategori[0]).toEqual({
      kategori: 'Belanja Bahan Baku', jumlah: 300_000, banyak: 1,
    });
    expect(r.keluarPerKategori[1]).toEqual({
      kategori: 'Transport & Ongkir', jumlah: 75_000, banyak: 2,
    });
  });

  it('entri nol diabaikan, tidak menambah hitungan kategori', () => {
    const r = ringkasKas([kas({ id: 'a', jenis: 'KELUAR', jumlah: 0 })], HARI, 0);
    expect(r.keluar).toBe(0);
    expect(r.keluarPerKategori).toEqual([]);
  });
});

/* ========================================================================== */

describe('urutan log kas', () => {

  it('terbaru di atas, MODAL AWAL selalu di paling bawah', () => {
    const daftar = entriHari([
      kas({ id: 'siang', jenis: 'KELUAR', jumlah: 10_000, jam: '13:00' }),
      // Modal dicatat pemilik pukul 15.00, terlambat — tapi ia tetap pembuka
      // buku, dan buku kas yang dibaca dari bawah harus dimulai dari sana.
      kas({ id: 'modal', jenis: 'MODAL_AWAL', jumlah: 500_000, jam: '15:00' }),
      kas({ id: 'sore', jenis: 'MASUK', jumlah: 20_000, jam: '17:00' }),
    ], HARI);

    expect(daftar.map((e) => e.id)).toEqual(['sore', 'siang', 'modal']);
  });
});

/* ========================================================================== */

describe('saldo laci per shift', () => {

  it('dihitung per SHIFT, bukan per tanggal', () => {
    const entri = [
      kas({ id: 'm1', jenis: 'MODAL_AWAL', jumlah: 300_000, shiftId: 'shf-pagi' }),
      kas({ id: 'b1', jenis: 'KELUAR', jumlah: 50_000, shiftId: 'shf-pagi' }),
      // Milik shift lain di hari yang sama. Tidak boleh ikut terhitung —
      // laci diserahterimakan saat pergantian kasir, bukan saat tengah malam.
      kas({ id: 'm2', jenis: 'MODAL_AWAL', jumlah: 900_000, shiftId: 'shf-malam' }),
    ];

    expect(kasShift(entri, 'shf-pagi', 200_000)).toBe(450_000);
    expect(kasShift(entri, 'shf-malam', 0)).toBe(900_000);
  });

  it('shift lama tanpa entri MODAL_AWAL memakai modal dari rekap shift', () => {
    // Shift yang sudah berjalan sebelum buku kas ada tidak punya entri itu.
    // Tanpa cadangannya, saldonya akan turun persis sebesar modal awal pada
    // saat pembaruan aplikasi — selisih yang muncul entah dari mana, tepat di
    // angka yang paling diperiksa orang.
    const entri = [kas({ id: 'b1', jenis: 'KELUAR', jumlah: 25_000, shiftId: 'shf-lama' })];
    expect(kasShift(entri, 'shf-lama', 100_000, 500_000)).toBe(575_000);
  });

  it('entri tanpa shift tidak ikut ke shift mana pun', () => {
    const entri = [kas({ id: 'x', jenis: 'KELUAR', jumlah: 80_000 })];
    expect(kasShift(entri, 'shf-1', 100_000, 200_000)).toBe(300_000);
  });
});
