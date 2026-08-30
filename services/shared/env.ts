/**
 * Memuat `.env` — WAJIB diimpor paling awal di setiap titik masuk.
 *
 * BUG YANG DIPERBAIKI FILE INI. Sebelumnya tidak ada satu pun service yang
 * memanggil `dotenv.config()`. Warisan dari monolit: `server.ts` memanggilnya
 * di baris ketiga, dan saat dipecah menjadi lima service, pemanggilan itu ikut
 * terhapus bersama file lamanya.
 *
 * Akibatnya `.env` DIABAIKAN SEPENUHNYA. Mengisi `DATABASE_URL` di sana tidak
 * berpengaruh apa-apa: service tetap menyambung ke PGlite lokal, dan tidak ada
 * error apa pun yang memberi tahu kenapa. Persis jenis kegagalan yang membuat
 * orang mengira sudah tersambung ke Supabase padahal belum sama sekali.
 *
 * Impor efek-samping ini SEBELUM modul lain yang membaca process.env, karena
 * PORTS dan SERVICE_URL dievaluasi saat modul dimuat — bukan saat dipanggil.
 */

import { config } from 'dotenv';

const hasil = config();

/*
 * KOMBINASI YANG DITOLAK SAAT MENYALA.
 *
 * `AUTH_ALLOW_LOCAL_DEVELOPMENT=1` mematikan EMPAT pemeriksaan sekaligus:
 *
 *   shared/auth.ts:authenticateBearer      -> principal palsu tanpa token
 *   shared/auth.ts:requireTrustedGateway   -> port internal terbuka
 *   shared/auth.ts:canAccessBusiness       -> akses ke SEMUA unit usaha
 *   pos/sync.ts:assertBusinessCanBeClaimed -> klaim kepemilikan tidak diperiksa
 *
 * Itu tepat untuk pengembangan lokal dan bencana di produksi. Nilai bawaannya
 * memang aman, tapi "aman selama tidak ada yang salah setel" bukan jaminan —
 * flag ini persis jenis yang tersalin ke berkas env produksi bersama sisanya.
 *
 * Proses menolak menyala, bukan menyala sambil memperingatkan: peringatan di
 * log hanya terbaca kalau ada yang membacanya, dan kalau sudah dibaca pun
 * servicenya sudah terlanjur melayani trafik tanpa autentikasi.
 */
if (process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1' && process.env.NODE_ENV === 'production') {
  throw new Error(
    'AUTH_ALLOW_LOCAL_DEVELOPMENT=1 tidak boleh aktif saat NODE_ENV=production. ' +
      'Flag itu mematikan seluruh autentikasi dan pemeriksaan kepemilikan tenant. ' +
      'Kosongkan atau setel "0" di lingkungan produksi.'
  );
}

/** Peringatan berulang selama flag aktif, supaya tidak ada yang lupa. */
if (process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1') {
  console.warn(
    '[env] PERINGATAN: AUTH_ALLOW_LOCAL_DEVELOPMENT=1 — autentikasi dan pemeriksaan ' +
      'kepemilikan tenant DIMATIKAN. Hanya untuk pengembangan lokal.'
  );
}

/**
 * Ringkasan yang aman dicetak: hanya NAMA variabel yang terbaca, tidak pernah
 * nilainya. Tanpa ini, "kenapa .env-ku tidak terbaca" hanya bisa dijawab dengan
 * menebak.
 */
export function ringkasEnv(): string {
  if (hasil.error) return '.env tidak ditemukan — memakai nilai bawaan';
  const kunci = Object.keys(hasil.parsed ?? {});
  return kunci.length ? `.env dimuat (${kunci.length} variabel: ${kunci.join(', ')})` : '.env kosong';
}

/** Tujuan database dalam bentuk yang aman dicetak — kata sandi tidak pernah ikut. */
export function ringkasTujuanDb(): string {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return 'PGlite lokal (DATABASE_URL kosong)';
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname} sebagai ${u.username}`;
  } catch {
    return 'DATABASE_URL tidak bisa diurai — periksa formatnya';
  }
}
