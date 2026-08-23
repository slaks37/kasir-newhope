/**
 * BUKU KAS HARIAN — satu tempat menghitung, dipakai seluruh layar.
 *
 * MASALAH YANG DIPERBAIKI.
 *
 * Sampai sekarang aplikasi ini hanya mengenal satu arah uang: penjualan.
 * `expectedCash` dihitung sebagai `modal awal + penjualan tunai`, titik.
 * Padahal di warung yang sesungguhnya, laci kasir dipakai untuk:
 *
 *   - belanja bahan mendadak ("beli telur dulu, kasnya nanti diganti")
 *   - bayar ojek, parkir, kasbon karyawan
 *   - setoran ke bank di tengah hari
 *   - tambahan modal saat kembalian menipis
 *
 * Tidak satu pun punya tempat untuk dicatat. Akibatnya setiap tutup kas
 * melaporkan SELISIH — uang yang "hilang" padahal jelas ke mana perginya. Dan
 * karena selisih kas dipakai untuk menilai kejujuran orang, sistem yang
 * membuat selisih itu tak terhindarkan bukan sekadar tidak lengkap: ia
 * menuduh.
 *
 * KENAPA BERKAS TERSENDIRI, BUKAN DI DALAM KOMPONEN LAPORAN.
 *
 * Angka yang sama dibaca di tiga tempat berbeda — ringkasan omzet, tutup kas,
 * dan panel admin. Rumus yang disalin ke tiga tempat akan menyimpang, dan
 * menyimpangnya tidak berisik: dua layar menunjukkan saldo kas berbeda untuk
 * hari yang sama, dan tidak ada yang tahu mana yang benar. Di sini rumusnya
 * satu.
 *
 * ATURAN YANG MENENTUKAN SELURUH BERKAS INI:
 *
 *   1. OMZET BUKAN KAS. Omzet adalah seluruh penjualan apa pun cara bayarnya;
 *      kas hanya yang berbentuk uang tunai di laci. QRIS Rp 1 juta menambah
 *      omzet dan TIDAK menambah satu rupiah pun isi laci. Menyamakan keduanya
 *      adalah kekeliruan yang membuat pemilik mengira uangnya hilang.
 *
 *   2. MODAL AWAL BUKAN PENDAPATAN. Ia uang pemilik yang dititipkan di laci
 *      supaya ada kembalian. Ikut menghitungnya sebagai omzet berarti melapor
 *      untung dari uang sendiri.
 *
 *   3. PENJUALAN TIDAK DICATAT DUA KALI. Struk sudah menjadi catatannya.
 *      Entri kas hanya untuk pergerakan uang yang BUKAN penjualan.
 */

import type { EntriKas, Order } from '../../types';

/** Batas hari mengikuti waktu perangkat — hari kerja kasir, bukan UTC. */
export function kunciHari(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function hariIni(): string {
  return kunciHari(new Date());
}

export interface RingkasanOmzet {
  /** Seluruh penjualan yang selesai, apa pun cara bayarnya. */
  omzet: number;
  /** Bagian omzet yang diterima TUNAI. Hanya ini yang masuk laci. */
  omzetTunai: number;
  omzetNonTunai: number;
  /** Nilai struk yang dibatalkan. Tidak ikut di `omzet`. */
  nilaiBatal: number;
  jumlahTransaksi: number;
  jumlahBatal: number;
  /** Rata-rata nilai struk. 0 bila belum ada transaksi — bukan NaN. */
  rataRata: number;
  perMetode: Record<string, number>;
}

const TUNAI = new Set(['CASH', 'TUNAI']);

/**
 * Ringkasan penjualan untuk satu hari.
 *
 * Struk VOID dihitung TERPISAH, tidak dikurangkan diam-diam dari omzet.
 * Pembatalan yang lenyap dari layar adalah pembatalan yang tidak bisa
 * ditelusuri — dan pembatalan adalah tempat pertama yang diperiksa orang saat
 * uang tidak cocok.
 */
export function ringkasOmzet(orders: Order[], hari: string): RingkasanOmzet {
  const r: RingkasanOmzet = {
    omzet: 0, omzetTunai: 0, omzetNonTunai: 0,
    nilaiBatal: 0, jumlahTransaksi: 0, jumlahBatal: 0,
    rataRata: 0, perMetode: {},
  };

  for (const o of orders) {
    if (kunciHari(o.date) !== hari) continue;

    if (o.status === 'VOID') {
      r.nilaiBatal += o.total;
      r.jumlahBatal += 1;
      continue;
    }
    if (o.status !== 'COMPLETED') continue;

    const metode = String(o.paymentMethod || 'LAINNYA').toUpperCase();
    r.omzet += o.total;
    r.jumlahTransaksi += 1;
    r.perMetode[metode] = (r.perMetode[metode] ?? 0) + o.total;
    if (TUNAI.has(metode)) r.omzetTunai += o.total;
    else r.omzetNonTunai += o.total;
  }

  r.rataRata = r.jumlahTransaksi ? Math.round(r.omzet / r.jumlahTransaksi) : 0;
  return r;
}

export interface RingkasanKas {
  modalAwal: number;
  /** Uang tunai masuk dari penjualan. Diambil dari struk, bukan entri kas. */
  penjualanTunai: number;
  /** Uang tunai masuk yang BUKAN penjualan. */
  masukLain: number;
  keluar: number;
  /**
   * Isi laci yang SEHARUSNYA ada sekarang.
   *
   *   modal awal + penjualan tunai + masuk lain − keluar
   *
   * Inilah angka yang dibandingkan dengan hitungan fisik saat tutup kas.
   */
  saldoSeharusnya: number;
  /** Rincian pengeluaran per kategori, terbesar dulu. */
  keluarPerKategori: Array<{ kategori: string; jumlah: number; banyak: number }>;
  masukPerKategori: Array<{ kategori: string; jumlah: number; banyak: number }>;
}

/**
 * Menyusun buku kas satu hari.
 *
 * `penjualanTunai` sengaja diminta sebagai argumen, bukan dihitung di sini
 * dari `orders`: pemanggil sudah memegang `ringkasOmzet`, dan menghitungnya
 * dua kali membuka peluang dua definisi "tunai" yang berbeda di satu layar
 * yang sama.
 */
export function ringkasKas(entri: EntriKas[], hari: string, penjualanTunai: number): RingkasanKas {
  let modalAwal = 0;
  let masukLain = 0;
  let keluar = 0;
  const perKatKeluar = new Map<string, { jumlah: number; banyak: number }>();
  const perKatMasuk = new Map<string, { jumlah: number; banyak: number }>();

  for (const e of entri) {
    if (kunciHari(e.waktu) !== hari) continue;
    // Jumlah selalu diperlakukan positif. Entri bertanda minus yang lolos dari
    // layar mana pun akan MENAMBAH kas kalau tandanya ikut dipakai, dan itu
    // kekeliruan yang hasilnya tampak masuk akal — sehingga tidak diperiksa.
    const jumlah = Math.abs(Number(e.jumlah) || 0);
    if (jumlah === 0) continue;
    const kategori = (e.kategori || 'Lainnya').trim() || 'Lainnya';

    if (e.jenis === 'MODAL_AWAL') {
      modalAwal += jumlah;
    } else if (e.jenis === 'MASUK') {
      masukLain += jumlah;
      const k = perKatMasuk.get(kategori) ?? { jumlah: 0, banyak: 0 };
      perKatMasuk.set(kategori, { jumlah: k.jumlah + jumlah, banyak: k.banyak + 1 });
    } else if (e.jenis === 'KELUAR') {
      keluar += jumlah;
      const k = perKatKeluar.get(kategori) ?? { jumlah: 0, banyak: 0 };
      perKatKeluar.set(kategori, { jumlah: k.jumlah + jumlah, banyak: k.banyak + 1 });
    }
  }

  const urut = (m: Map<string, { jumlah: number; banyak: number }>) =>
    [...m.entries()]
      .map(([kategori, v]) => ({ kategori, ...v }))
      .sort((a, b) => b.jumlah - a.jumlah);

  return {
    modalAwal,
    penjualanTunai,
    masukLain,
    keluar,
    // TIDAK dijaga agar >= 0. Saldo negatif berarti pengeluaran melebihi apa
    // yang pernah masuk, dan itu keadaan yang harus TERLIHAT — bukan dibulatkan
    // ke nol supaya layarnya rapi.
    saldoSeharusnya: modalAwal + penjualanTunai + masukLain - keluar,
    keluarPerKategori: urut(perKatKeluar),
    masukPerKategori: urut(perKatMasuk),
  };
}

/**
 * Entri satu hari, terbaru di atas.
 *
 * MODAL AWAL selalu di paling bawah apa pun jamnya. Ia pembuka buku, dan buku
 * kas yang dibaca dari bawah ke atas harus dimulai dari sana — meskipun
 * pemiliknya baru sempat mencatatnya setelah beberapa transaksi berjalan.
 */
export function entriHari(entri: EntriKas[], hari: string): EntriKas[] {
  return entri
    .filter((e) => kunciHari(e.waktu) === hari)
    .sort((a, b) => {
      if (a.jenis === 'MODAL_AWAL' && b.jenis !== 'MODAL_AWAL') return 1;
      if (b.jenis === 'MODAL_AWAL' && a.jenis !== 'MODAL_AWAL') return -1;
      return new Date(b.waktu).getTime() - new Date(a.waktu).getTime();
    });
}

/**
 * Isi laci yang seharusnya ada untuk SATU SHIFT.
 *
 * KENAPA PER SHIFT, BUKAN PER HARI. Laci diserahterimakan saat pergantian
 * kasir, bukan saat tengah malam. Warung yang buka sampai pukul 02.00 punya
 * satu shift yang melintasi dua tanggal, dan menghitungnya per tanggal berarti
 * kasir malam menyerahkan laci dengan selisih sebesar seluruh penjualan
 * sesudah pukul 00.00. Rekap HARIAN tetap ada — untuk pemilik, yang memang
 * berpikir per hari — tapi yang dibandingkan dengan hitungan fisik saat serah
 * terima adalah angka ini.
 *
 * `modalAwalCadangan` dipakai HANYA bila shift ini tidak punya entri
 * MODAL_AWAL sama sekali. Shift yang sudah berjalan sebelum buku kas ada tidak
 * punya entri itu, dan tanpa cadangannya saldonya akan turun persis sebesar
 * modal awal pada saat pembaruan aplikasi — selisih yang muncul entah dari
 * mana, tepat di angka yang paling diperiksa orang.
 */
export function kasShift(
  entri: EntriKas[],
  shiftId: string,
  penjualanTunaiShift: number,
  modalAwalCadangan = 0
): number {
  if (!shiftId) return modalAwalCadangan + penjualanTunaiShift;

  let modal = 0;
  let masuk = 0;
  let keluar = 0;
  let adaModal = false;

  for (const e of entri) {
    if (e.shiftId !== shiftId) continue;
    const jumlah = Math.abs(Number(e.jumlah) || 0);
    if (jumlah === 0) continue;
    if (e.jenis === 'MODAL_AWAL') { modal += jumlah; adaModal = true; }
    else if (e.jenis === 'MASUK') masuk += jumlah;
    else if (e.jenis === 'KELUAR') keluar += jumlah;
  }

  return (adaModal ? modal : modalAwalCadangan) + penjualanTunaiShift + masuk - keluar;
}
