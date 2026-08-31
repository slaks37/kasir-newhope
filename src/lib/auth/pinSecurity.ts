/**
 * Modul Keamanan PIN & Autentikasi Supervisor/Admin.
 *
 * FITUR KEAMANAN:
 * 1. Cryptographic Hashing: Menggunakan SHA-256 dengan random salt kriptografis.
 * 2. Format Penyimpanan: `sha256$<salt>$<hash>` (kebal terhadap rainbow tables).
 * 3. Backward Compatibility: Mendukung verifikasi legacy plaintext PIN secara aman.
 * 4. Attempt Limiting & Anti-Bruteforce:
 *    - Maksimal 3 kali percobaan salah berturut-turut.
 *    - Lockout timer otomatis (30 detik bertingkat hingga 5 menit).
 *    - Reset counter otomatis setelah verifikasi sukses.
 */

const STORAGE_KEY = 'newhope_pin_security_state';
const MAX_ATTEMPTS = 3;
const LOCKOUT_TIERS_SEC = [30, 60, 300]; // 30s, 60s, 5m

interface PinSecurityState {
  consecutiveFailures: number;
  lockedUntil: number | null; // Timestamp ms
  lockoutCount: number;
  lastFailureAt: string | null;
}

function readState(): PinSecurityState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { consecutiveFailures: 0, lockedUntil: null, lockoutCount: 0, lastFailureAt: null };
    return JSON.parse(raw);
  } catch {
    return { consecutiveFailures: 0, lockedUntil: null, lockoutCount: 0, lastFailureAt: null };
  }
}

function writeState(state: PinSecurityState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('[pinSecurity] gagal menyimpan state:', err);
  }
}

/**
 * Kesalahan yang sengaja TIDAK ditangkap di mana pun.
 *
 * Ia hanya bisa terjadi di lingkungan tanpa Web Crypto, dan di lingkungan itu
 * PIN memang tidak bisa diamankan. Menangkapnya berarti melanjutkan seolah-olah
 * bisa.
 */
export class KriptoTidakTersedia extends Error {
  constructor(bagian: string) {
    super(
      `Peramban ini tidak menyediakan Web Crypto (${bagian}), sehingga PIN staf ` +
      'tidak bisa diamankan. Buka aplikasi lewat HTTPS, atau pakai peramban yang ' +
      'lebih baru.'
    );
    this.name = 'KriptoTidakTersedia';
  }
}

/**
 * Salt acak 16 byte.
 *
 * MELEMPAR kalau tidak ada sumber acak kriptografis — sengaja, dan ini
 * perubahan dari perilaku sebelumnya.
 *
 * Versi lama jatuh ke `Math.random()`, yang bisa ditebak. Salt yang bisa
 * ditebak meniadakan gunanya salt: penyerang tinggal menghitung tabel untuk
 * 10.000 kemungkinan PIN empat angka satu kali, lalu memakainya untuk semua
 * staf sekaligus.
 *
 * Cadangan itu juga tidak pernah bisa berguna: `sha256()` di bawah menuntut
 * `crypto.subtle`, yang selalu ADA di mana pun `getRandomValues` ada. Jadi
 * cadangan ini hanya melindungi dari keadaan yang membuat baris berikutnya
 * gagal juga — ilusi ketahanan, bukan ketahanan.
 */
export function generateSalt(bytes = 16): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new KriptoTidakTersedia('getRandomValues');
  }
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Menghitung SHA-256 hash dari string */
export async function sha256(message: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  /*
   * TIDAK ADA CADANGAN, dan ini perubahan dari perilaku sebelumnya.
   *
   * Versi lama jatuh ke hash FNV 64-bit berawalan `fallback_`. Dua akibatnya,
   * dan keduanya buruk:
   *
   * 1. HASH ITU BUKAN PENGAMAN. 64 bit non-kriptografis atas PIN empat angka
   *    bisa dibalik seketika. Ia hanya TERLIHAT seperti hash.
   *
   * 2. SERVER TIDAK AKAN PERNAH MENCOCOKKANNYA. `services/pos/staff.ts`
   *    memverifikasi dengan SHA-256 sungguhan. Staf yang didaftarkan dari
   *    perangkat yang jatuh ke cadangan ini menyimpan `sha256$<salt>$<bukan
   *    sha256>` — dan PIN-nya tidak akan pernah cocok, dengan pesan "PIN
   *    salah" yang berbohong kepada manajer yang mengetiknya dengan benar.
   *
   * Kegagalan yang jujur jauh lebih baik: ia menunjuk sebabnya, dan bisa
   * diperbaiki dengan membuka aplikasi lewat HTTPS.
   */
  throw new KriptoTidakTersedia('crypto.subtle');
}

/**
 * Meng-hash PIN kasir/supervisor dengan salt.
 * Menghasilkan: `sha256$<salt>$<hash>`
 */
export async function hashPin(pin: string, customSalt?: string): Promise<string> {
  const salt = customSalt || generateSalt();
  const hash = await sha256(`${pin}:${salt}`);
  return `sha256$${salt}$${hash}`;
}

/**
 * Memverifikasi input PIN terhadap PIN tersimpan (bisa hash atau legacy plaintext).
 * Constant-time comparison untuk mencegah timing attack.
 */
export async function verifyPinHash(inputPin: string, storedPinOrHash: string): Promise<boolean> {
  if (!inputPin || !storedPinOrHash) return false;

  // Format Hashed: sha256$<salt>$<hash>
  if (storedPinOrHash.startsWith('sha256$')) {
    const parts = storedPinOrHash.split('$');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const expectedHash = parts[2];
    const computedHash = await sha256(`${inputPin}:${salt}`);
    
    // Constant time comparison
    if (computedHash.length !== expectedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < computedHash.length; i++) {
      diff |= computedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    }
    return diff === 0;
  }

  // Legacy Plaintext fallback
  let diff = 0;
  const a = inputPin.trim();
  const b = storedPinOrHash.trim();
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Memeriksa status lockout terminal saat ini.
 */
export function getPinLockoutStatus(): {
  isLockedOut: boolean;
  remainingSec: number;
  attemptsLeft: number;
  totalFailed: number;
} {
  const state = readState();
  const now = Date.now();

  if (state.lockedUntil && state.lockedUntil > now) {
    const remainingSec = Math.ceil((state.lockedUntil - now) / 1000);
    return {
      isLockedOut: true,
      remainingSec,
      attemptsLeft: 0,
      totalFailed: state.consecutiveFailures,
    };
  }

  // Jika waktu lockout sudah lewat, hapus status lockedUntil
  if (state.lockedUntil && state.lockedUntil <= now) {
    writeState({
      ...state,
      lockedUntil: null,
      consecutiveFailures: 0, // Reset setelah lockout usai
    });
    return {
      isLockedOut: false,
      remainingSec: 0,
      attemptsLeft: MAX_ATTEMPTS,
      totalFailed: 0,
    };
  }

  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - state.consecutiveFailures);
  return {
    isLockedOut: false,
    remainingSec: 0,
    attemptsLeft,
    totalFailed: state.consecutiveFailures,
  };
}

/**
 * Mencatat percobaan PIN yang salah dan mengaktifkan lockout jika mencapai limit.
 */
export function recordFailedPinAttempt(): {
  isLockedOut: boolean;
  remainingSec: number;
  attemptsLeft: number;
} {
  const state = readState();
  const now = Date.now();
  const newFailures = state.consecutiveFailures + 1;
  const newLockoutCount = state.lockoutCount + 1;

  if (newFailures >= MAX_ATTEMPTS) {
    const tierIndex = Math.min(state.lockoutCount, LOCKOUT_TIERS_SEC.length - 1);
    const lockoutDurationSec = LOCKOUT_TIERS_SEC[tierIndex];
    const lockedUntil = now + lockoutDurationSec * 1000;

    writeState({
      consecutiveFailures: newFailures,
      lockedUntil,
      lockoutCount: newLockoutCount,
      lastFailureAt: new Date().toISOString(),
    });

    return {
      isLockedOut: true,
      remainingSec: lockoutDurationSec,
      attemptsLeft: 0,
    };
  }

  writeState({
    ...state,
    consecutiveFailures: newFailures,
    lastFailureAt: new Date().toISOString(),
  });

  return {
    isLockedOut: false,
    remainingSec: 0,
    attemptsLeft: MAX_ATTEMPTS - newFailures,
  };
}

/**
 * Me-reset counter kesalahan setelah PIN berhasil diverifikasi.
 */
export function resetPinAttempts(): void {
  const state = readState();
  writeState({
    ...state,
    consecutiveFailures: 0,
    lockedUntil: null,
  });
}
