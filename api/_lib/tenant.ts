/**
 * Resolusi identitas merchant untuk fungsi serverless.
 *
 * SATU SALINAN, bukan lima. Aturan pencarian yang sama sebelumnya ditulis ulang
 * inline di query.ts, sync/transactions.ts, subscription/status.ts,
 * simulate-payment.ts, dan prorated-upgrade.ts. Lima salinan aturan identitas
 * adalah lima aturan yang akan berbeda — dan bedanya tidak muncul sebagai
 * error, melainkan sebagai merchant yang transaksinya menempel pada satu id
 * sementara langganannya pada id lain.
 *
 * Urutannya mengikuti services/shared/identity.ts, yang dipakai microservice:
 *
 *   1. businessId (`userId_sector`) -> paling menentukan
 *   2. merchantId sebagai pemilik akun, HANYA bila ia punya tepat satu unit
 *      usaha. Pemilik dengan kafe + laundry ambigu, dan menebak salah satunya
 *      berarti melaporkan toko yang keliru tanpa ada yang menyadari.
 *   3. tidak ditemukan -> null, bukan tebakan
 */

import type pg from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveTenantId(
  db: pg.Pool,
  ref: string | null | undefined
): Promise<string | null> {
  const kunci = String(ref ?? '').trim();
  if (!kunci) return null;

  // Sudah UUID: dipakai apa adanya. Pemanggil internal kadang sudah memegangnya.
  if (UUID_RE.test(kunci)) return kunci;

  const { rows } = await db.query(
    `SELECT business_id FROM contract.merchant_directory
      WHERE client_key = $1
         OR (owner_user_ref = $1
             AND (SELECT COUNT(*) FROM contract.merchant_directory
                   WHERE owner_user_ref = $1) = 1)
      LIMIT 1`,
    [kunci]
  );
  return rows[0]?.business_id ?? null;
}

/**
 * Merchant (PEMILIK) dari sebuah business.
 *
 * Langganan menempel di sini, bukan di business. Pemilik yang punya kafe dan
 * laundry membeli satu paket; batas outlet, kuota AI, dan modulnya berlaku
 * untuk keduanya. Menagih per unit usaha berarti menagih orang yang sama dua
 * kali untuk satu langganan.
 */
export async function resolveMerchantId(
  db: pg.Pool,
  businessId: string
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT merchant_id FROM pos.businesses WHERE id = $1`,
    [businessId]
  );
  return rows[0]?.merchant_id ?? null;
}
