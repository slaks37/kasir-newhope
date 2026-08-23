/**
 * Identitas TOKO untuk seluruh endpoint /api/v1/*.
 *
 * MASALAH YANG DITUTUP BERKAS INI.
 *
 * Sampai sebelum ini, setiap endpoint toko menentukan pemiliknya dari data yang
 * dikirim pemanggil: `body.businessId`, `query.tenantId`, atau header
 * `x-tenant-id`. Tidak ada satu pun pemeriksaan identitas. Formatnya pun mudah
 * ditebak (`userId_SEKTOR`, mis. `usr-siti_RETAIL`).
 *
 * Sudah dibuktikan dengan memanggil handler-nya langsung, tanpa kredensial:
 *
 *     GET  /v1/subscription/status?tenantId=usr-siti_RETAIL   -> 200, data lengkap
 *     POST /v1/sync/transactions   {businessId: "usr-siti_RETAIL"}
 *                                  -> transaksi korban 1139 -> 1140
 *
 * ATURANNYA SEKARANG: toko ditentukan dari TOKEN, tidak pernah dari isi
 * permintaan. `businessId` di body tetap boleh dikirim aplikasi lama, tapi
 * hanya dipakai untuk dicocokkan — kalau berbeda dari klaim token, permintaan
 * ditolak, bukan diikuti.
 *
 * KENAPA TOKEN SENDIRI, BUKAN SESI SUPABASE. Aplikasi kasir offline-first dan
 * dipasang di terminal toko: ia harus tetap melayani saat internet mati, dan
 * tidak bisa menyegarkan sesi ke pihak ketiga di tengah antrian kirim. Token
 * bertanda tangan dengan masa berlaku panjang dapat disimpan di perangkat,
 * dikirim apa adanya, dan diverifikasi tanpa satu pun perjalanan jaringan
 * tambahan.
 *
 * Mekanismenya sama persis dengan token konsol internal (src/server/adminAuth.ts)
 * — HMAC-SHA256 atas payload base64url — dan sengaja memakai RAHASIA YANG
 * BERBEDA, supaya token kasir tidak pernah bisa dipakai sebagai token admin
 * atau sebaliknya.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MerchantTokenPayload {
  /** business_id (UUID) — inilah satu-satunya sumber identitas toko. */
  bid: string;
  /** client_key (`userId_SEKTOR`), untuk pesan galat yang bisa dibaca manusia. */
  ck: string;
  /** Perangkat yang memegang token, bila diketahui. */
  dev?: string | null;
  /** Kedaluwarsa, epoch detik. */
  exp: number;
}

/**
 * GAGAL TERTUTUP bila belum diisi.
 *
 * Membangkitkan rahasia acak saat proses menyala akan terasa lebih ramah, tapi
 * artinya setiap replika serverless menandatangani dengan kunci berbeda —
 * token yang terbit di satu instans ditolak instans lain, dan kasir keluar
 * sendiri secara acak tanpa ada yang tahu sebabnya.
 */
function rahasia(): string {
  const s = process.env.MERCHANT_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'MERCHANT_SESSION_SECRET belum diisi (minimal 32 karakter). ' +
        'Endpoint toko sengaja menolak melayani tanpa itu.'
    );
  }
  return s;
}

export function rahasiaTersedia(): boolean {
  const s = process.env.MERCHANT_SESSION_SECRET;
  return Boolean(s && s.length >= 32);
}

/**
 * 30 hari.
 *
 * Jauh lebih panjang dari token konsol internal (8 jam), dan itu disengaja:
 * terminal kasir tidak punya orang yang memasukkan password tiap pagi, dan
 * memaksa masuk ulang berarti toko berhenti melayani. Yang menahan risikonya
 * bukan masa berlaku pendek melainkan cakupan token — ia hanya berlaku untuk
 * SATU business_id, dan tidak bisa membaca apa pun milik toko lain.
 */
export const TTL_TOKEN_TOKO = 30 * 24 * 60 * 60;

export function terbitkanTokenToko(
  p: Omit<MerchantTokenPayload, 'exp'>
): string {
  const lengkap: MerchantTokenPayload = {
    ...p,
    exp: Math.floor(Date.now() / 1000) + TTL_TOKEN_TOKO,
  };
  const body = Buffer.from(JSON.stringify(lengkap), 'utf8').toString('base64url');
  const sig = createHmac('sha256', rahasia()).update(body).digest('base64url');
  return `m1.${body}.${sig}`;
}

/** Mengembalikan payload bila tanda tangannya sah DAN belum kedaluwarsa. */
export function verifikasiTokenToko(token: string | null | undefined): MerchantTokenPayload | null {
  if (!token) return null;

  const bagian = token.split('.');
  // Awalan `m1` membedakannya dari token konsol yang berawalan `v1`. Token yang
  // tertukar tempat ditolak di baris ini, bukan setelah tanda tangannya dihitung.
  if (bagian.length !== 3 || bagian[0] !== 'm1') return null;

  const [, body, sig] = bagian;

  let diharapkan: Buffer;
  try {
    diharapkan = createHmac('sha256', rahasia()).update(body).digest();
  } catch {
    return null; // rahasia belum diisi: tidak ada token yang boleh dianggap sah
  }

  let diberikan: Buffer;
  try {
    diberikan = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (diberikan.length !== diharapkan.length) return null;
  if (!timingSafeEqual(diberikan, diharapkan)) return null;

  let payload: MerchantTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload?.bid || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** Mengambil token dari header Authorization: Bearer, atau header x-nhpos-token. */
export function ambilToken(req: any): string | null {
  const auth = String(req?.headers?.authorization ?? req?.headers?.Authorization ?? '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const alt = req?.headers?.['x-nhpos-token'];
  return alt ? String(alt) : null;
}
