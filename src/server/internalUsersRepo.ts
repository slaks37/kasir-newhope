/**
 * Akun konsol internal: daftar, undang, ubah peran, aktifkan, cabut password.
 *
 * SATU HAL YANG SENGAJA TIDAK ADA DI SINI: menetapkan password orang lain.
 *
 * Kalau seorang admin bisa mengetikkan password untuk akun rekannya, ia tahu
 * password itu — dan seluruh gunanya jejak audit runtuh, karena tindakan atas
 * nama seseorang tidak lagi membuktikan orang itu yang melakukannya. Yang bisa
 * dilakukan di sini hanyalah MENCABUT password; pemiliknya menetapkan yang baru
 * sendiri lewat `npm run admin:password`.
 */

import type { Db } from './db';
import type { InternalRole } from '../lib/rbac/environments';

export const INTERNAL_ROLES: InternalRole[] = [
  'ROLE_SUPERADMIN',
  'ROLE_INTERNAL_GROWTH',
  'ROLE_INTERNAL_SUPPORT',
];

export interface InternalUserRow {
  id: string;
  email: string;
  fullName: string;
  role: InternalRole;
  isActive: boolean;
  /** false berarti akun belum bisa dipakai login sama sekali. */
  hasPassword: boolean;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
}

export class InternalUserError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const KOLOM = `
  id, email, full_name, role, is_active,
  (password_hash IS NOT NULL) AS has_password,
  password_set_at, last_login_at, failed_login_count, locked_until, created_at`;

function keRow(r: any): InternalUserRow {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    isActive: r.is_active,
    hasPassword: r.has_password,
    passwordSetAt: r.password_set_at,
    lastLoginAt: r.last_login_at,
    failedLoginCount: Number(r.failed_login_count ?? 0),
    lockedUntil: r.locked_until,
    createdAt: r.created_at,
  };
}

export async function daftarUserInternal(db: Db): Promise<InternalUserRow[]> {
  const { rows } = await db.query(
    `SELECT ${KOLOM} FROM internal.internal_users ORDER BY role, email`
  );
  return rows.map(keRow);
}

/**
 * Berapa SUPERADMIN yang masih aktif DAN benar-benar bisa login.
 *
 * Akun tanpa password tidak dihitung. Kalau dihitung, menonaktifkan satu-satunya
 * superadmin yang punya password akan lolos hanya karena ada akun superadmin
 * lain yang sebenarnya tidak bisa dipakai masuk — dan konsolnya terkunci untuk
 * semua orang.
 */
async function superadminAktif(db: Db, kecualiId?: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM internal.internal_users
      WHERE role = 'ROLE_SUPERADMIN' AND is_active AND password_hash IS NOT NULL
        AND ($1::uuid IS NULL OR id <> $1::uuid)`,
    [kecualiId ?? null]
  );
  return rows[0].n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Mengundang akun internal baru. TANPA password — sengaja.
 *
 * Akun lahir dalam keadaan tidak bisa dipakai login sampai pemiliknya sendiri
 * menetapkan password lewat skrip. Undangan yang langsung bisa dipakai menuntut
 * pengirimannya lewat email atau chat, dan password yang pernah melewati chat
 * bukan lagi rahasia.
 */
export async function undangUserInternal(
  db: Db,
  masukan: { email: string; fullName: string; role: string }
): Promise<InternalUserRow> {
  const email = String(masukan.email ?? '').trim().toLowerCase();
  const fullName = String(masukan.fullName ?? '').trim();
  const role = String(masukan.role ?? '') as InternalRole;

  if (!EMAIL_RE.test(email)) throw new InternalUserError('EMAIL_INVALID', 'Format email tidak sah.');
  if (fullName.length < 2) throw new InternalUserError('NAME_INVALID', 'Nama minimal 2 karakter.');
  if (!INTERNAL_ROLES.includes(role)) throw new InternalUserError('ROLE_INVALID', 'Role tidak dikenal.');

  const ada = await db.query(`SELECT 1 FROM internal.internal_users WHERE lower(email) = $1`, [email]);
  if (ada.rows.length) throw new InternalUserError('EMAIL_TAKEN', 'Email itu sudah terdaftar.');

  const { rows } = await db.query(
    `INSERT INTO internal.internal_users (id, email, full_name, role, is_active)
     VALUES (uuidv7(), $1, $2, $3::internal_role_enum, TRUE)
     RETURNING ${KOLOM}`,
    [email, fullName.slice(0, 120), role]
  );
  return keRow(rows[0]);
}

export async function ubahPeran(
  db: Db,
  userId: string,
  role: string,
  aktorId: string
): Promise<InternalUserRow> {
  if (!INTERNAL_ROLES.includes(role as InternalRole)) {
    throw new InternalUserError('ROLE_INVALID', 'Role tidak dikenal.');
  }
  // Menurunkan peran diri sendiri adalah cara paling umum mengunci diri keluar,
  // dan tidak bisa dibatalkan tanpa akses database.
  if (userId === aktorId && role !== 'ROLE_SUPERADMIN') {
    throw new InternalUserError('SELF_DEMOTE', 'Anda tidak bisa menurunkan peran akun Anda sendiri.');
  }

  const lama = await db.query(`SELECT role FROM internal.internal_users WHERE id = $1::uuid`, [userId]);
  if (!lama.rows.length) throw new InternalUserError('NOT_FOUND', 'Akun tidak ditemukan.');

  if (lama.rows[0].role === 'ROLE_SUPERADMIN' && role !== 'ROLE_SUPERADMIN') {
    if ((await superadminAktif(db, userId)) === 0) {
      throw new InternalUserError(
        'LAST_SUPERADMIN',
        'Ini satu-satunya superadmin yang bisa login. Tetapkan penggantinya lebih dulu.'
      );
    }
  }

  const { rows } = await db.query(
    `UPDATE internal.internal_users SET role = $2::internal_role_enum
      WHERE id = $1::uuid RETURNING ${KOLOM}`,
    [userId, role]
  );
  return keRow(rows[0]);
}

export async function ubahAktif(
  db: Db,
  userId: string,
  aktif: boolean,
  aktorId: string
): Promise<InternalUserRow> {
  if (userId === aktorId && !aktif) {
    throw new InternalUserError('SELF_DEACTIVATE', 'Anda tidak bisa menonaktifkan akun Anda sendiri.');
  }

  const lama = await db.query(
    `SELECT role FROM internal.internal_users WHERE id = $1::uuid`,
    [userId]
  );
  if (!lama.rows.length) throw new InternalUserError('NOT_FOUND', 'Akun tidak ditemukan.');

  if (!aktif && lama.rows[0].role === 'ROLE_SUPERADMIN' && (await superadminAktif(db, userId)) === 0) {
    throw new InternalUserError(
      'LAST_SUPERADMIN',
      'Ini satu-satunya superadmin yang bisa login. Menonaktifkannya mengunci konsol untuk semua orang.'
    );
  }

  const { rows } = await db.query(
    `UPDATE internal.internal_users
        SET is_active = $2, failed_login_count = 0, locked_until = NULL
      WHERE id = $1::uuid RETURNING ${KOLOM}`,
    [userId, aktif]
  );
  return keRow(rows[0]);
}

/**
 * Mencabut password, bukan menggantinya.
 *
 * Sesudah ini akun tidak bisa login sampai pemiliknya menetapkan yang baru
 * lewat `npm run admin:password`. Penguncian karena percobaan gagal ikut
 * dibersihkan — itulah gunanya tombol ini bagi orang yang benar-benar lupa.
 */
export async function cabutPassword(
  db: Db,
  userId: string,
  aktorId: string
): Promise<InternalUserRow> {
  if (userId === aktorId) {
    throw new InternalUserError(
      'SELF_REVOKE',
      'Mencabut password Anda sendiri akan langsung mengeluarkan Anda. Pakai `npm run admin:password` untuk menggantinya.'
    );
  }

  const lama = await db.query(`SELECT role FROM internal.internal_users WHERE id = $1::uuid`, [userId]);
  if (!lama.rows.length) throw new InternalUserError('NOT_FOUND', 'Akun tidak ditemukan.');

  if (lama.rows[0].role === 'ROLE_SUPERADMIN' && (await superadminAktif(db, userId)) === 0) {
    throw new InternalUserError(
      'LAST_SUPERADMIN',
      'Ini satu-satunya superadmin yang bisa login. Cabut passwordnya dan tidak ada yang bisa masuk lagi.'
    );
  }

  const { rows } = await db.query(
    `UPDATE internal.internal_users
        SET password_hash = NULL, password_set_at = NULL,
            failed_login_count = 0, locked_until = NULL
      WHERE id = $1::uuid RETURNING ${KOLOM}`,
    [userId]
  );
  return keRow(rows[0]);
}

/**
 * Staf merchant, untuk tab "User Client" di panel.
 *
 * Dibaca lewat contract.staff_directory, bukan langsung dari tabelnya. Konsol
 * internal adalah KONSUMEN data merchant, dan konsumen membaca permukaan
 * kontrak — itu yang membuat perubahan bentuk tabel tidak menyeret panel ikut
 * rusak. Dua hal yang ditemukan justru karena aturan itu tidak diikuti di sini:
 *
 *   - `t.external_ref` sudah lama berganti nama menjadi `client_key`, dan
 *     kueri ini tidak ikut diperbarui — artinya /api/admin/merchant-staff
 *     mengembalikan galat SQL, bukan daftar staf. Endpoint yang membaca dari
 *     view tidak bisa gagal begitu.
 *   - `pin <> '----'` menebak "PIN terpasang" dari nilai sentinel. Sejak 0033
 *     kredensial punya tabelnya sendiri, jadi pertanyaannya bisa dijawab
 *     langsung: ada barisnya atau tidak.
 *
 * PIN tidak pernah ikut — staff_directory memang tidak memuatnya, jadi bocornya
 * tidak lagi bergantung pada kolom mana yang kebetulan ditulis di SELECT.
 */
export async function staffMerchant(
  db: Db,
  f: { sector?: string | null; search?: string | null; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(Number(f.limit) || 50), 1), 200);
  const offset = Math.max(Math.trunc(Number(f.offset) || 0), 0);
  const sector = f.sector || null;
  const search = f.search ? String(f.search).slice(0, 80) : null;

  const where = `
     WHERE ($1::text IS NULL OR t.business_sector = $1)
       AND ($2::text IS NULL OR d.name ILIKE '%' || $2 || '%' OR t.name ILIKE '%' || $2 || '%')`;

  const { rows } = await db.query(
    `SELECT d.staff_user_id AS id, d.name, d.employee_code, d.status,
            d.joined_at, d.left_at, d.login, d.last_login_at,
            -- Tiga keadaan yang berbeda, dan panel perlu membedakannya:
            -- belum pernah diberi login, punya login yang dinonaktifkan, dan
            -- punya login aktif.
            (d.login IS NOT NULL)                       AS punya_login,
            COALESCE(d.login_aktif, false)              AS login_aktif,
            d.roles,
            t.id AS business_id, t.name AS merchant_name, t.business_sector,
            t.client_key
       FROM contract.staff_directory d
       JOIN pos.businesses t ON t.id = d.business_id
       ${where}
      ORDER BY t.name, d.name
      LIMIT $3 OFFSET $4`,
    [sector, search, limit, offset]
  );
  const total = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM contract.staff_directory d
       JOIN pos.businesses t ON t.id = d.business_id ${where}`,
    [sector, search]
  );
  return { rows, total: total.rows[0].n, limit, offset };
}
