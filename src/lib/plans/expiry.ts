/**
 * Aturan kedaluwarsa langganan — SATU salinan.
 *
 * Sebelumnya aturan ini ditulis dua kali: di services/billing/index.ts dan di
 * api/v1/subscription/status.ts. Dua salinan berarti dua masa tenggang yang
 * bisa berbeda diam-diam, dan bedanya tidak muncul sebagai error: merchant
 * yang sama terbaca ACTIVE lewat satu jalur dan EXPIRED lewat jalur lain,
 * tergantung mana yang kebetulan melayani permintaan.
 *
 * Kedaluwarsa DIHITUNG, tidak disimpan. Menyimpannya menuntut cron yang
 * mengubah status tepat waktu; cron yang telat semenit berarti merchant
 * kedaluwarsa masih bisa berjualan, dan cron yang mati semalam berarti
 * semuanya masih aktif esok paginya. Menghitung dari current_period_end selalu
 * benar tanpa proses tambahan apa pun.
 *
 * Berkas ini murni (tanpa I/O, tanpa modul node), jadi aman dipakai bersama
 * oleh microservice, fungsi serverless, dan aplikasi kasir di browser.
 */

export const HARI_MS = 86_400_000;

/**
 * Masa tenggang setelah periode berakhir, sebelum akses benar-benar dicabut.
 *
 * Angka ini punya satu kembaran yang tidak bisa dihindari: `INTERVAL '3 days'`
 * di dalam view `contract.merchant_entitlements` (migrasi 0016), karena kuota
 * AI dihitung di database. Keduanya harus diubah bersamaan.
 */
export const GRACE_DAYS = 3;

export type StatusLangganan = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED';

/**
 * Status yang benar-benar berlaku saat ini.
 *
 * CANCELED tidak pernah dihitung ulang: langganan yang dibatalkan tetap
 * dibatalkan walau periodenya belum habis.
 */
export function statusEfektif(
  status: string,
  currentPeriodEnd: string | Date | null | undefined,
  sekarang: number = Date.now()
): StatusLangganan {
  if (status === 'CANCELED') return 'CANCELED';
  if (!currentPeriodEnd) return status as StatusLangganan;

  const akhir = new Date(currentPeriodEnd).getTime();
  if (Number.isNaN(akhir)) return status as StatusLangganan;

  if (sekarang <= akhir) return status as StatusLangganan;
  if (sekarang <= akhir + GRACE_DAYS * HARI_MS) return 'PAST_DUE';
  return 'EXPIRED';
}

/** Boleh memakai aplikasi. Masa tenggang TIDAK termasuk — itu urusan `dalamTenggang`. */
export function langgananAktif(status: StatusLangganan): boolean {
  return status === 'ACTIVE' || status === 'TRIAL';
}

export function dalamTenggang(status: StatusLangganan): boolean {
  return status === 'PAST_DUE';
}

/**
 * Sisa hari, dibulatkan ke bawah: "0 hari lagi" berarti periodenya habis hari
 * ini, bukan beberapa jam sisa yang dibulatkan naik jadi satu hari akses penuh.
 */
export function sisaHari(
  currentPeriodEnd: string | Date | null | undefined,
  sekarang: number = Date.now()
): number {
  if (!currentPeriodEnd) return 0;
  const akhir = new Date(currentPeriodEnd).getTime();
  if (Number.isNaN(akhir)) return 0;
  return Math.max(0, Math.floor((akhir - sekarang) / HARI_MS));
}
