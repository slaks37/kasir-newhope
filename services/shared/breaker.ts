/**
 * Circuit breaker per service tujuan.
 *
 * MASALAH YANG DISELESAIKAN. Ketika satu service mati, gateway tetap mencoba
 * menghubunginya untuk SETIAP request yang masuk. Tiap percobaan menunggu
 * sampai batas waktu koneksi, menahan satu slot, dan menumpuk. Trafik yang
 * sebenarnya sehat ikut melambat karena antre di belakang percobaan yang sudah
 * pasti gagal — satu service mati menyeret seluruh gateway.
 *
 * Breaker memutus lebih awal: setelah beberapa kegagalan berturut-turut ia
 * berhenti mencoba dan langsung menjawab 503. Sesekali ia melepas SATU
 * permintaan percobaan untuk melihat apakah service sudah pulih.
 *
 *   TERTUTUP  normal, semua diteruskan
 *   TERBUKA   menolak cepat tanpa menyentuh jaringan
 *   SETENGAH  satu permintaan percobaan; berhasil -> TERTUTUP, gagal -> TERBUKA
 *
 * Yang TIDAK dilakukan breaker: memperbaiki service yang mati. Ia hanya menjaga
 * kegagalan tetap lokal dan murah.
 */

export type StatusBreaker = 'TERTUTUP' | 'TERBUKA' | 'SETENGAH';

export interface OpsiBreaker {
  /** Kegagalan berturut-turut sebelum memutus. */
  ambangGagal?: number;
  /** Berapa lama tetap terbuka sebelum mencoba lagi. */
  jedaPulihMs?: number;
}

export class Breaker {
  private gagalBerturut = 0;
  private terbukaSampai = 0;
  private percobaanBerjalan = false;

  readonly nama: string;
  private readonly ambangGagal: number;
  private readonly jedaPulihMs: number;

  constructor(nama: string, opsi: OpsiBreaker = {}) {
    this.nama = nama;
    this.ambangGagal = opsi.ambangGagal ?? 5;
    this.jedaPulihMs = opsi.jedaPulihMs ?? 10_000;
  }

  status(): StatusBreaker {
    if (this.terbukaSampai === 0) return 'TERTUTUP';
    if (Date.now() < this.terbukaSampai) return 'TERBUKA';
    return 'SETENGAH';
  }

  /**
   * Apakah request boleh lewat sekarang.
   *
   * Saat SETENGAH hanya SATU yang dilepas. Tanpa penjaga itu, seluruh trafik
   * yang tertahan akan menyerbu service yang baru saja bangun dan
   * menjatuhkannya lagi — persis pola yang membuat pemulihan tidak pernah
   * selesai.
   */
  bolehLewat(): boolean {
    const s = this.status();
    if (s === 'TERTUTUP') return true;
    if (s === 'TERBUKA') return false;
    if (this.percobaanBerjalan) return false;
    this.percobaanBerjalan = true;
    return true;
  }

  catatSukses(): void {
    this.gagalBerturut = 0;
    this.terbukaSampai = 0;
    this.percobaanBerjalan = false;
  }

  catatGagal(): void {
    this.percobaanBerjalan = false;
    this.gagalBerturut++;
    if (this.gagalBerturut >= this.ambangGagal) {
      this.terbukaSampai = Date.now() + this.jedaPulihMs;
    }
  }

  ringkasan() {
    return {
      service: this.nama,
      status: this.status(),
      gagalBerturut: this.gagalBerturut,
      terbukaSampai: this.terbukaSampai ? new Date(this.terbukaSampai).toISOString() : null,
    };
  }
}
