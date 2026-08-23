/**
 * Verifikasi PIN kasir, dengan pembatasan percobaan.
 *
 * KENAPA PEMBATASAN, BUKAN HANYA HASH. PIN empat angka punya sepuluh ribu
 * kemungkinan. Menebak seluruhnya terhadap hash yang lambat sekalipun tetap
 * selesai — yang benar-benar menahannya adalah penguncian setelah beberapa kali
 * gagal. Keduanya dipasang bersama; salah satunya saja tidak cukup.
 *
 * Hash-nya memakai `hashPassword`/`verifyPassword` yang sama dengan akun konsol
 * internal. Bukan demi hemat baris — melainkan supaya tidak ada dua gagasan
 * berbeda tentang "kata sandi yang aman" di dalam satu sistem.
 */

import type pg from 'pg';
import { hashPassword, verifyPassword } from './adminAuth.js';

/** Setelah sekian gagal berturut-turut, terkunci. */
export const BATAS_GAGAL = 5;
/** Lama penguncian. Cukup lama untuk mematikan penebakan, cukup pendek untuk
 *  tidak melumpuhkan toko saat kasir benar-benar lupa. */
export const KUNCI_MENIT = 15;

export type HasilPin =
  | { ok: true; authUserId: string }
  | { ok: false; sebab: 'SALAH'; sisaPercobaan: number }
  | { ok: false; sebab: 'TERKUNCI'; sampai: string }
  | { ok: false; sebab: 'TIDAK_DITEMUKAN' };

type Klien = pg.Pool | pg.PoolClient;

/** Memasang PIN baru (selalu ter-hash) dan mengosongkan penghitung gagal. */
export async function pasangPin(db: Klien, authUserId: string, pin: string): Promise<void> {
  const hash = await hashPassword(pin);
  await db.query(
    `UPDATE pos.auth_users
        SET pin_hash = $2, pin_set_at = CURRENT_TIMESTAMP,
            failed_attempt = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [authUserId, hash]
  );
}

export async function periksaPin(
  db: Klien,
  businessId: string,
  login: string,
  pin: string
): Promise<HasilPin> {
  const { rows } = await db.query(
    `SELECT id, pin, pin_hash, failed_attempt, locked_until, is_active
       FROM pos.auth_users
      WHERE business_id = $1 AND login = $2
      LIMIT 1`,
    [businessId, login]
  );
  if (!rows.length || !rows[0].is_active) return { ok: false, sebab: 'TIDAK_DITEMUKAN' };

  const a = rows[0];

  if (a.locked_until && new Date(a.locked_until) > new Date()) {
    return { ok: false, sebab: 'TERKUNCI', sampai: new Date(a.locked_until).toISOString() };
  }

  let cocok = false;
  if (a.pin_hash) {
    cocok = await verifyPassword(pin, a.pin_hash);
  } else if (a.pin) {
    // MASA PERALIHAN. Baris yang PIN-nya belum di-hash dibandingkan apa adanya
    // SEKALI LAGI, lalu langsung di-hash begitu cocok — supaya perangkat lama
    // tidak terkunci di luar, tapi juga tidak tinggal selamanya dalam keadaan
    // tidak aman. Lihat contract.staf_pin_belum_aman untuk sisa yang belum.
    cocok = a.pin === pin;
    if (cocok) await pasangPin(db, a.id, pin);
  }

  if (cocok) {
    await db.query(
      `UPDATE pos.auth_users
          SET failed_attempt = 0, locked_until = NULL,
              last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [a.id]
    );
    return { ok: true, authUserId: a.id };
  }

  const gagal = Number(a.failed_attempt ?? 0) + 1;
  const kunci = gagal >= BATAS_GAGAL;
  await db.query(
    `UPDATE pos.auth_users
        SET failed_attempt = $2,
            locked_until = CASE WHEN $3 THEN CURRENT_TIMESTAMP + ($4 || ' minutes')::interval ELSE locked_until END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [a.id, kunci ? 0 : gagal, kunci, String(KUNCI_MENIT)]
  );

  if (kunci) {
    return {
      ok: false, sebab: 'TERKUNCI',
      sampai: new Date(Date.now() + KUNCI_MENIT * 60_000).toISOString(),
    };
  }
  return { ok: false, sebab: 'SALAH', sisaPercobaan: BATAS_GAGAL - gagal };
}
