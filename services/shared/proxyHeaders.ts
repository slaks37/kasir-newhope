/**
 * Header kiriman klien yang TIDAK PERNAH diteruskan gateway ke service.
 *
 * Berdiri sebagai modul sendiri, bukan konstanta di dalam gateway, karena dua
 * alasan: daftar ini adalah batas keamanan yang layak diuji langsung, dan
 * mengimpor services/gateway/index.ts ikut menyalakan servernya.
 *
 * Dua kelompok, dua alasan berbeda:
 *
 * 1. HOP-BY-HOP (`host`, `connection`, `content-length`, …). Kalau diteruskan,
 *    koneksi ke service rusak.
 *
 * 2. IDENTITAS & LINGKUNGAN. Header inilah yang menentukan siapa pemanggilnya
 *    dan di lingkungan mana ia berada, jadi ia hanya boleh lahir DI GATEWAY,
 *    sesudah sesi diverifikasi ke Auth API. Kalau kiriman klien diteruskan apa
 *    adanya, siapa pun bisa mengirim `x-auth-sub: <id korban>` atau
 *    `x-env-override: PROVIDER_BO` dan langsung dianggap orang lain di
 *    lingkungan penyedia.
 *
 *    `x-auth-sub` dan `x-auth-email` memang ditimpa gateway — TAPI hanya saat
 *    principal ada. Route publik (PUBLIC_API_PATHS) melewati autentikasi, jadi
 *    tanpa dibuang di sini kiriman klien lolos utuh justru pada jalur yang
 *    tidak diperiksa siapa pun.
 *
 *    `x-newhope-gateway-token` dibuang supaya token tebakan dari luar tidak
 *    pernah sampai ke requireTrustedGateway(); gateway mengisinya sendiri.
 */
export const HEADER_TIDAK_DITERUSKAN: ReadonlySet<string> = new Set([
  // Hop-by-hop
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',

  // Diisi ulang gateway dari data yang dilihatnya sendiri
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-for',
  'x-request-id',

  // Identitas & lingkungan — hanya gateway yang boleh menerbitkannya
  'x-auth-sub',
  'x-auth-email',
  'x-internal-user',
  'x-env-override',
  'x-newhope-gateway-token',
]);
