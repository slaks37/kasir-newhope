/**
 * ANTRIAN CETAK — dengan batas waktu, percobaan ulang, dan keadaan gagal yang
 * terlihat.
 *
 * MASALAH YANG DISELESAIKAN.
 *
 * Printer termal adalah perangkat paling tidak bisa diandalkan di meja kasir.
 * Ia kehabisan kertas, penutupnya terbuka, Bluetooth-nya lepas, atau kepala
 * cetaknya terlalu panas — semuanya di tengah antrean pembeli. Yang TIDAK boleh
 * terjadi adalah salah satu dari dua hal berikut:
 *
 *   1. transaksi ikut gagal karena printernya gagal. Penjualan sudah terjadi;
 *      uangnya sudah diterima. Struk adalah salinan, bukan transaksinya.
 *
 *   2. kegagalan cetak lewat tanpa jejak. Kasir mengira struk keluar, pelanggan
 *      menunggu, dan tidak ada satu pun yang tahu kenapa tidak ada apa-apa.
 *
 * Sebelum ini keduanya mungkin terjadi: `window.print()` dipanggil dan hasilnya
 * tidak pernah diperiksa.
 *
 * KENAPA ADA BATAS WAKTU.
 *
 * Printer Bluetooth yang terputus di tengah pengiriman TIDAK mengembalikan
 * kesalahan — ia hanya diam. `await kirim(bytes)` menggantung selamanya, dan
 * bersamanya layar kasir. Setiap pekerjaan karena itu berlomba dengan batas
 * waktu; yang kalah dianggap gagal dan dicoba lagi.
 *
 * KENAPA ANTRIANNYA BERTAHAN DI DISK.
 *
 * Tablet kasir dimuat ulang, kehabisan baterai, dan ditutup tanpa peringatan.
 * Struk yang belum tercetak harus masih ada sesudahnya — kalau tidak, satu-
 * satunya bukti transaksi hilang bersama proses yang mati.
 */

const KUNCI = 'newhope_print_queue_v1';

export type StatusJob = 'menunggu' | 'dikirim' | 'selesai' | 'gagal';

export interface PrintJob {
  id: string;
  /** Byte ESC/POS, disimpan base64 supaya selamat lewat JSON. */
  data: string;
  keterangan: string;
  status: StatusJob;
  percobaan: number;
  dibuatPada: string;
  kesalahanTerakhir?: string;
}

export interface OpsiSpooler {
  /** Batas waktu satu pengiriman. Bawaan 8 detik. */
  batasWaktuMs?: number;
  /** Berapa kali dicoba sebelum menyerah. Bawaan 3. */
  maksPercobaan?: number;
  /** Jeda antar percobaan; bertambah dua kali lipat. Bawaan 1 detik. */
  jedaAwalMs?: number;
  /** Penyimpanan; bisa diganti saat pengujian. */
  simpanan?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Jam; bisa diganti saat pengujian. */
  tunggu?: (ms: number) => Promise<void>;
}

/** Pengirim ke perangkat. Melempar atau menggantung kalau printernya bermasalah. */
export type Pengirim = (data: Uint8Array) => Promise<void>;

export const keBase64 = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(b).toString('base64');
};

export const dariBase64 = (s: string): Uint8Array => {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
};

/**
 * Membatasi waktu sebuah janji.
 *
 * `Promise.race` saja tidak cukup: janji yang kalah TETAP berjalan, dan pada
 * printer yang menggantung ia tidak pernah selesai. Yang penting di sini bukan
 * membatalkan pengirimannya — itu tidak bisa dilakukan dari luar — melainkan
 * memastikan pemanggilnya tidak ikut menggantung bersamanya.
 */
export function batasiWaktu<T>(janji: Promise<T>, ms: number, pesan: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(pesan)), ms);
    janji.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export class Spooler {
  private batasWaktuMs: number;
  private maksPercobaan: number;
  private jedaAwalMs: number;
  private simpanan: Pick<Storage, 'getItem' | 'setItem'>;
  private tunggu: (ms: number) => Promise<void>;
  private sedangJalan = false;

  constructor(private kirim: Pengirim, opsi: OpsiSpooler = {}) {
    this.batasWaktuMs = opsi.batasWaktuMs ?? 8_000;
    this.maksPercobaan = opsi.maksPercobaan ?? 3;
    this.jedaAwalMs = opsi.jedaAwalMs ?? 1_000;
    this.simpanan =
      opsi.simpanan ?? (typeof localStorage !== 'undefined' ? localStorage : petaSimpanan());
    this.tunggu = opsi.tunggu ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  daftar(): PrintJob[] {
    try {
      const raw = this.simpanan.getItem(KUNCI);
      const p = raw ? JSON.parse(raw) : [];
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }

  private tulis(rows: PrintJob[]): void {
    try {
      this.simpanan.setItem(KUNCI, JSON.stringify(rows));
    } catch (err) {
      // Kuota penuh. Tidak boleh diam: struk berikutnya berisiko hilang.
      console.error('[cetak] gagal menyimpan antrian:', err);
    }
  }

  /** Memasukkan pekerjaan. Menulis ke disk SEBELUM apa pun dikirim. */
  antre(data: Uint8Array, keterangan: string): PrintJob {
    const job: PrintJob = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      data: keBase64(data),
      keterangan,
      status: 'menunggu',
      percobaan: 0,
      dibuatPada: new Date().toISOString(),
    };
    this.tulis([...this.daftar(), job]);
    return job;
  }

  /**
   * Menjalankan antrian sampai habis.
   *
   * TIDAK PERNAH MELEMPAR. Pemanggilnya adalah jalur pembayaran kasir, dan
   * printer yang bermasalah tidak boleh menjatuhkan penjualan yang sudah
   * terjadi.
   */
  async jalankan(): Promise<{ selesai: number; gagal: number }> {
    // Satu penjalan pada satu waktu: dua penjalan paralel akan mengirim
    // pekerjaan yang sama dua kali, dan struk ganda terlihat seperti
    // transaksi ganda bagi pelanggan.
    if (this.sedangJalan) return { selesai: 0, gagal: 0 };
    this.sedangJalan = true;

    let selesai = 0;
    let gagal = 0;
    try {
      for (;;) {
        const rows = this.daftar();
        const idx = rows.findIndex((j) => j.status === 'menunggu');
        if (idx < 0) break;

        const job = rows[idx];
        job.status = 'dikirim';
        job.percobaan += 1;
        this.tulis(rows);

        try {
          await batasiWaktu(
            this.kirim(dariBase64(job.data)),
            this.batasWaktuMs,
            `printer tidak menjawab dalam ${this.batasWaktuMs} ms`
          );
          this.perbarui(job.id, { status: 'selesai' });
          selesai++;
        } catch (err) {
          const pesan = (err as Error)?.message || 'kesalahan tidak diketahui';
          if (job.percobaan >= this.maksPercobaan) {
            // Menyerah, tapi TIDAK menghapus. Pekerjaan gagal harus tetap
            // terlihat supaya kasir tahu ada struk yang tidak keluar dan bisa
            // mencetak ulang setelah kertasnya diganti.
            this.perbarui(job.id, { status: 'gagal', kesalahanTerakhir: pesan });
            gagal++;
          } else {
            this.perbarui(job.id, { status: 'menunggu', kesalahanTerakhir: pesan });
            // Mundur bertahap: printer yang baru kehabisan kertas tidak akan
            // sembuh dalam 10 ms, dan mencobanya 3 kali beruntun hanya membuang
            // baterai serta menahan antrian.
            await this.tunggu(this.jedaAwalMs * 2 ** (job.percobaan - 1));
          }
        }
      }
    } finally {
      this.sedangJalan = false;
    }
    return { selesai, gagal };
  }

  private perbarui(id: string, patch: Partial<PrintJob>): void {
    const rows = this.daftar();
    const i = rows.findIndex((j) => j.id === id);
    if (i >= 0) { rows[i] = { ...rows[i], ...patch }; this.tulis(rows); }
  }

  /** Mengembalikan pekerjaan yang gagal ke antrian — tombol "Cetak Ulang". */
  ulangiYangGagal(): number {
    const rows = this.daftar();
    let n = 0;
    for (const j of rows) {
      if (j.status === 'gagal') { j.status = 'menunggu'; j.percobaan = 0; n++; }
    }
    if (n) this.tulis(rows);
    return n;
  }

  /** Membuang pekerjaan yang sudah selesai. Yang gagal TIDAK ikut dibuang. */
  bersihkan(): number {
    const rows = this.daftar();
    const sisa = rows.filter((j) => j.status !== 'selesai');
    if (sisa.length !== rows.length) this.tulis(sisa);
    return rows.length - sisa.length;
  }

  ringkasan(): Record<StatusJob, number> {
    const r: Record<StatusJob, number> = { menunggu: 0, dikirim: 0, selesai: 0, gagal: 0 };
    for (const j of this.daftar()) r[j.status] = (r[j.status] ?? 0) + 1;
    return r;
  }
}

/** Penyimpanan dalam memori untuk lingkungan tanpa localStorage (Node, uji). */
export function petaSimpanan(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}
