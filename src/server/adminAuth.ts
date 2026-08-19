/**
 * Kredensial dan sesi konsol internal.
 *
 * HANYA UNTUK SISI SERVER. Berkas ini tidak boleh diimpor oleh kode yang ikut
 * dibundel ke browser — seluruh gunanya adalah menyimpan hal-hal yang tidak
 * pernah sampai ke klien.
 *
 * TANPA DEPENDENSI BARU. scrypt dan HMAC keduanya ada di `node:crypto`.
 * Menambah bcrypt/jsonwebtoken berarti menambah dua pustaka yang harus diikuti
 * pembaruan keamanannya, untuk sesuatu yang sudah disediakan runtime.
 *
 * KENAPA scrypt, bukan SHA-256 bergaram. SHA-256 dirancang CEPAT; itu tepat
 * untuk checksum dan justru salah untuk password — GPU bisa mencoba miliaran
 * tebakan per detik. scrypt sengaja mahal di memori, sehingga menebak massal
 * tidak lagi ekonomis. Parameter biayanya ikut disimpan di dalam string hash,
 * jadi menaikkannya nanti tidak membatalkan password yang sudah ada.
 */

import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from 'node:crypto';

/**
 * promisify() hanya mengambil overload pertama scrypt, yang tidak menerima
 * parameter biaya — jadi bentuknya ditulis sendiri di sini. Tanpa ini,
 * TypeScript menolak argumen keempat yang justru menentukan seberapa mahal
 * hash-nya.
 */
function scrypt(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

/** Biaya scrypt. N harus pangkat dua; 2^15 ≈ 32 MB per hash. */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

/* -------------------------------------------------------------------------- */
/* PASSWORD                                                                    */
/* -------------------------------------------------------------------------- */

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    // Node menolak scrypt di atas ~32 MB tanpa ini; batas bawaannya lebih kecil
    // daripada biaya yang kita pilih di atas.
    maxmem: 256 * 1024 * 1024,
  });

  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Selalu mengembalikan boolean, tidak pernah melempar.
 *
 * Hash yang rusak atau format asing dijawab `false`, sama seperti password
 * salah. Melempar akan membedakan "akun ini datanya aneh" dari "password
 * salah" bagi siapa pun yang mencoba — perbedaan yang tidak perlu diberikan.
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const bagian = stored.split('$');
  if (bagian.length !== 6 || bagian[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = bagian;

  try {
    const expected = Buffer.from(hashB64, 'base64url');
    const key = await scrypt(plain.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });

    // Panjang harus dicek dulu: timingSafeEqual melempar kalau berbeda.
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* SESI                                                                        */
/* -------------------------------------------------------------------------- */

export interface AdminTokenPayload {
  /** Email admin internal. */
  sub: string;
  /** UUID baris internal_users — dipakai jejak audit. */
  uid: string;
  role: string;
  /** Kedaluwarsa, epoch detik. */
  exp: number;
}

/**
 * Rahasia penanda tangan sesi.
 *
 * GAGAL TERTUTUP kalau belum diisi. Membangkitkan rahasia acak saat proses
 * menyala akan terasa lebih ramah, tapi artinya setiap replika menandatangani
 * dengan kunci berbeda dan setiap deploy mengeluarkan semua orang — dan yang
 * lebih buruk, tidak ada yang menyadari bahwa keamanannya bergantung pada
 * nilai yang tidak pernah sengaja dipilih siapa pun.
 */
function sessionSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET belum diisi (minimal 32 karakter). ' +
        'Konsol internal sengaja menolak menyala tanpa itu.'
    );
  }
  return s;
}

export function sessionSecretTersedia(): boolean {
  const s = process.env.ADMIN_SESSION_SECRET;
  return Boolean(s && s.length >= 32);
}

/** Berlaku 8 jam — satu hari kerja, bukan sesi abadi. */
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function issueToken(payload: Omit<AdminTokenPayload, 'exp'>): string {
  const lengkap: AdminTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };

  const body = Buffer.from(JSON.stringify(lengkap), 'utf8').toString('base64url');
  const sig = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `v1.${body}.${sig}`;
}

/** Mengembalikan payload bila tanda tangannya sah DAN belum kedaluwarsa. */
export function verifyToken(token: string | undefined | null): AdminTokenPayload | null {
  if (!token) return null;

  const bagian = token.split('.');
  if (bagian.length !== 3 || bagian[0] !== 'v1') return null;

  const [, body, sig] = bagian;

  let diharapkan: Buffer;
  try {
    diharapkan = createHmac('sha256', sessionSecret()).update(body).digest();
  } catch {
    // Rahasia belum diisi — tidak ada token yang boleh dianggap sah.
    return null;
  }

  const diberikan = Buffer.from(sig, 'base64url');
  if (diberikan.length !== diharapkan.length) return null;
  if (!timingSafeEqual(diberikan, diharapkan)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminTokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    if (!payload.sub || !payload.uid || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Membaca token dari header Authorization: Bearer <token>. */
export function tokenDariHeader(authorization: string | string[] | undefined): string | null {
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!raw) return null;
  const cocok = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return cocok ? cocok[1] : null;
}
