/**
 * Gerbang identitas untuk endpoint toko.
 *
 * Satu pintu, dipakai SELURUH /api/v1/*. Sebelumnya tiap endpoint menentukan
 * tokonya sendiri dari isi permintaan, dan tidak satu pun memverifikasi apa
 * pun — lihat catatan panjang di src/server/merchantAuth.ts.
 */

import type pg from 'pg';
import { verifikasiTokenToko, ambilToken, rahasiaTersedia } from '../../src/server/merchantAuth.js';

export interface KonteksToko {
  /** business_id (UUID). Satu-satunya sumber identitas toko. */
  businessId: string;
  /** client_key, untuk pesan yang bisa dibaca manusia. */
  clientKey: string;
  deviceRef: string | null;
}

/**
 * Memastikan permintaan datang dari toko yang sah, dan mengembalikan
 * identitasnya. Bila tidak, menulis balasan penolakan dan mengembalikan null —
 * pemanggil cukup `if (!ctx) return;`.
 *
 * `businessIdDiminta` adalah nilai yang dikirim aplikasi (body/query). Ia TIDAK
 * dipakai untuk menentukan toko; hanya dicocokkan. Aplikasi yang meminta toko
 * lain ditolak, bukan dilayani.
 */
export async function wajibToko(
  req: any,
  res: any,
  businessIdDiminta?: string | null
): Promise<KonteksToko | null> {
  if (!rahasiaTersedia()) {
    // Gagal tertutup. Kalau rahasianya belum dipasang, tidak ada permintaan yang
    // boleh dianggap sah — termasuk yang tidak membawa token sama sekali.
    res.status(503).json({
      ok: false,
      error: 'AUTH_NOT_CONFIGURED',
      detail: 'MERCHANT_SESSION_SECRET belum dipasang di server.',
    });
    return null;
  }

  const payload = verifikasiTokenToko(ambilToken(req));
  if (!payload) {
    res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      detail: 'Token toko tidak ada, tidak sah, atau sudah kedaluwarsa. Masuk kembali di aplikasi kasir.',
    });
    return null;
  }

  const diminta = String(businessIdDiminta ?? '').trim();
  if (diminta && diminta !== payload.bid && diminta !== payload.ck) {
    // Inilah yang menutup penyusupan lintas toko: aplikasi boleh salah, tapi
    // tidak boleh menentukan.
    res.status(403).json({
      ok: false,
      error: 'TENANT_MISMATCH',
      detail: 'Permintaan menyebut toko yang berbeda dari pemilik token.',
    });
    return null;
  }

  return {
    businessId: payload.bid,
    clientKey: payload.ck,
    deviceRef: payload.dev ?? (String(req?.headers?.['x-device-id'] ?? '').slice(0, 128) || null),
  };
}

/** Memastikan business_id dari token benar-benar masih ada di database. */
export async function tokoMasihAda(db: pg.Pool, businessId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM pos.businesses WHERE id = $1', [businessId]);
  return rows.length > 0;
}
