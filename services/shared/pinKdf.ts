/**
 * Hash PIN & kata sandi staf — PBKDF2-HMAC-SHA256.
 *
 * KENAPA BUKAN SHA-256 BIASA (yang dipakai src/lib/auth/pinSecurity.ts)
 *
 * SHA-256 dirancang supaya CEPAT. Untuk PIN 4 digit, seluruh ruang kunci hanya
 * 10.000 kemungkinan: satu GPU menghitung habis semuanya dalam waktu yang tidak
 * terukur, salt atau bukan. Salt hanya mencegah rainbow table yang dipakai
 * ulang antar-akun; ia tidak memperlambat tebakan terhadap satu akun.
 *
 * PBKDF2 dengan iterasi tinggi membalik ekonominya: satu percobaan jadi mahal.
 *
 * TAPI JUJUR SAJA — untuk PIN 4 digit, KDF saja TIDAK cukup. Siapa pun yang
 * memegang hash-nya tetap bisa menghabiskan 10.000 kemungkinan, hanya lebih
 * lama. Yang benar-benar menghentikan tebakan adalah dua hal lain:
 *
 *   1. Hash TIDAK PERNAH meninggalkan server. Itulah sebabnya verifikasi
 *      pindah ke pos-service dan bukan lagi dijalankan di browser.
 *   2. Lockout dihitung server (pos.pin_attempts), sehingga tidak bisa direset
 *      dengan menghapus satu kunci localStorage.
 *
 * KDF di sini adalah lapisan ketiga: yang menahan kerusakan kalau isi database
 * bocor. Bukan pengganti dua yang di atas.
 *
 * Format simpan: `pbkdf2$<iterasi>$<salt hex>$<hash hex>`
 * Iterasi ikut disimpan supaya bisa dinaikkan nanti tanpa membatalkan hash lama.
 */

import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

/**
 * OWASP menganjurkan >= 600.000 untuk PBKDF2-HMAC-SHA256 pada kata sandi.
 * Di sini dipakai 210.000: verifikasi step-up menelusuri beberapa anggota staf
 * dalam satu permintaan, dan pada 600k satu penekanan tombol "Otorisasi" bisa
 * memakan lebih dari satu detik di terminal kasir yang lemah. Angka ini
 * tersimpan di dalam hash, jadi menaikkannya nanti tidak membatalkan apa pun.
 */
export const PBKDF2_ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export interface PinVerification {
  ok: boolean;
  /**
   * True kalau kecocokan didapat dari format LAMA (sha256$… atau plaintext).
   * Pemanggil wajib menulis ulang hash-nya ke format PBKDF2 — inilah cara
   * kredensial lama naik kelas tanpa memaksa semua orang mengganti PIN.
   */
  needsRehash: boolean;
}

export async function hashPin(pin: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const derived = await pbkdf2Async(pin, salt, iterations, KEY_LENGTH, DIGEST);
  return `pbkdf2$${iterations}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Perbandingan waktu-tetap atas dua string hex. */
function equalsConstantTime(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual melempar kalau panjangnya beda, jadi panjang diperiksa
  // dulu — perbedaan panjang memang sudah bocor lewat ukuran, bukan waktu.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function pbkdf2Matches(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
  let salt: Buffer;
  try {
    salt = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0) return false;
  const derived = await pbkdf2Async(pin, salt, iterations, KEY_LENGTH, DIGEST);
  return equalsConstantTime(derived.toString('hex'), parts[3]);
}

/** Format warisan browser: `sha256$<salt>$<hash>` dengan hash = SHA256(`pin:salt`). */
async function legacySha256Matches(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const { createHash } = await import('node:crypto');
  const computed = createHash('sha256').update(`${pin}:${parts[1]}`).digest('hex');
  return equalsConstantTime(computed, parts[2]);
}

/**
 * Memverifikasi PIN terhadap nilai tersimpan, apa pun formatnya.
 *
 * Tiga format diterima demi migrasi: PBKDF2 (tujuan), sha256$ (warisan browser),
 * dan plaintext (warisan internal.memberships.pin yang defaultnya '1234').
 * Dua yang terakhir selalu menandai needsRehash, dan pemanggil WAJIB
 * menindaklanjutinya — kalau tidak, tidak ada yang pernah naik kelas.
 */
export async function verifyPin(pin: string, stored: string | null | undefined): Promise<PinVerification> {
  const input = String(pin ?? '').trim();
  const saved = String(stored ?? '').trim();
  if (!input || !saved) return { ok: false, needsRehash: false };

  if (saved.startsWith('pbkdf2$')) {
    return { ok: await pbkdf2Matches(input, saved), needsRehash: false };
  }
  if (saved.startsWith('sha256$')) {
    const ok = await legacySha256Matches(input, saved);
    return { ok, needsRehash: ok };
  }
  // Plaintext warisan.
  const ok = equalsConstantTime(input, saved);
  return { ok, needsRehash: ok };
}
