/**
 * BENDERA FITUR — peluncuran bertahap.
 *
 * Penilaiannya ada di DATABASE (internal.fn_flag_aktif, migrasi 0046), bukan
 * di sini. Alasannya sama seperti penjaga stok: aplikasi kasir bukan
 * satu-satunya yang perlu tahu apakah sebuah fitur menyala. Skrip batch,
 * backoffice, dan laporan menanyakan hal yang sama, dan tiga salinan aturan
 * yang sama pada akhirnya akan berbeda pendapat — tepat pada bendera yang
 * sedang dipakai mematikan sesuatu yang rusak.
 *
 * Berkas ini hanya lapisan tipis di atasnya, plus cache pendek.
 */

import type { Db } from './db';

/**
 * Cache 30 detik.
 *
 * Bendera ditanyakan pada hampir setiap permintaan, dan tanpa cache itu berarti
 * satu kueri tambahan per permintaan untuk data yang berubah beberapa kali
 * sehari.
 *
 * 30 detik dipilih karena ia harus PENDEK. Bendera dipakai untuk mematikan
 * sesuatu yang sedang merusak produksi; jendela antara "dimatikan" dan
 * "benar-benar mati di semua proses" adalah jendela di mana merchant masih
 * terkena. Satu menit sudah terlalu lama untuk ditunggu sambil melihat grafik
 * kesalahan naik.
 */
const CACHE_MS = 30_000;

interface Entri { nilai: boolean; kedaluwarsa: number }
const cache = new Map<string, Entri>();

/** Dipakai uji, dan setelah mengubah bendera lewat backoffice. */
export function bersihkanCacheBendera(): void {
  cache.clear();
}

/**
 * Apakah `kunci` menyala untuk `tenantId`?
 *
 * TIDAK PERNAH MELEMPAR. Kegagalan basis data menghasilkan `false`, yaitu
 * perilaku LAMA — bendera adalah cara menyalakan sesuatu yang baru, jadi
 * ketika ragu, jangan. Kegagalan yang menyalakan fitur setengah jadi pada
 * setiap merchant adalah cara paling buruk untuk kehilangan gunanya bendera.
 */
export async function benderaAktif(db: Db, kunci: string, tenantId: string | null): Promise<boolean> {
  if (!tenantId) return false;

  const ck = `${kunci}:${tenantId}`;
  const now = Date.now();
  const hit = cache.get(ck);
  if (hit && hit.kedaluwarsa > now) return hit.nilai;

  try {
    const { rows } = await db.query<{ aktif: boolean }>(
      `SELECT internal.fn_flag_aktif($1, $2::uuid) AS aktif`,
      [kunci, tenantId]
    );
    const nilai = rows[0]?.aktif === true;
    cache.set(ck, { nilai, kedaluwarsa: now + CACHE_MS });
    return nilai;
  } catch (err) {
    console.error(`[bendera] ${kunci} gagal dinilai:`, (err as Error).message);
    return false;
  }
}

/**
 * Seluruh bendera untuk satu tenant, untuk dikirim ke aplikasi kasir.
 *
 * Dinilai di server, lalu dikirim sebagai jawaban ya/tidak. Klien TIDAK
 * menerima aturannya — daftar tenant di daftar putih dan persentase peluncuran
 * bukan urusan perangkat kasir, dan mengirimkannya berarti setiap merchant
 * bisa membaca siapa saja yang sedang menguji apa.
 */
export async function benderaUntukTenant(
  db: Db,
  tenantId: string | null
): Promise<Record<string, boolean>> {
  if (!tenantId) return {};
  try {
    const { rows } = await db.query<{ key: string; aktif: boolean }>(
      `SELECT key, internal.fn_flag_aktif(key, $1::uuid) AS aktif
         FROM internal.feature_flags
        WHERE enabled
        ORDER BY key`,
      [tenantId]
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.aktif === true]));
  } catch (err) {
    console.error('[bendera] daftar gagal:', (err as Error).message);
    return {};
  }
}
