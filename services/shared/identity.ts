/**
 * Penerjemah identitas merchant — satu tempat untuk seluruh sistem.
 *
 * MASALAH YANG DISELESAIKAN, dan kenapa harus terpusat.
 *
 * Klien mengenali merchant lewat string bebas: `usr-budi` (akun) dan
 * `usr-budi_FNB` (unit usaha). Database memakai UUID sejak 0005. Setiap service
 * yang menerjemahkannya sendiri akan menerjemahkan sedikit berbeda, dan
 * akibatnya bukan error yang kelihatan — melainkan dompet kredit, langganan,
 * dan transaksi yang menempel pada identitas yang BERBEDA-BEDA untuk merchant
 * yang sama. Itu jenis kerusakan yang baru ketahuan berbulan-bulan kemudian,
 * saat angkanya sudah tidak bisa direkonsiliasi.
 *
 * Terbukti mahal: dompet kredit dan langganan sempat memakai legacy_uuid()
 * langsung, sementara transaksi memakai UUID hasil sinkronisasi. Keduanya
 * "berhasil" tanpa error, tapi menunjuk merchant yang berbeda.
 *
 * URUTAN PENCARIAN, dari yang paling pasti ke yang paling longgar:
 *
 *   1. Sudah UUID           -> pakai apa adanya
 *   2. businessId           -> contract.merchant_directory.business_id
 *   3. merchantId sebagai   -> contract.merchant_directory.owner_user_ref
 *      pemilik akun            (hanya bila TEPAT SATU unit usaha; pemilik
 *                               dengan kafe + laundry ambigu dan harus
 *                               menyebut businessId)
 *   4. tidak ditemukan      -> legacy_uuid(): UUID sintetis yang DETERMINISTIK
 *
 * Langkah 4 tidak menunjuk merchant mana pun di `tenants`, jadi penulisan
 * apa pun yang memakainya akan ditolak foreign key. Itu memang disengaja:
 * lebih baik ditolak daripada menempel pada merchant yang salah.
 */

import type { Db } from './db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdentitasMerchant {
  /** Id akun sisi klien, mis. `usr-budi`. */
  merchantId?: string | null;
  /** Partition key unit usaha, mis. `usr-budi_FNB`. Paling menentukan. */
  businessId?: string | null;
}

export interface HasilResolusi {
  /** UUID yang harus dipakai untuk semua penulisan. */
  tenantId: string;
  /** true bila merchant benar-benar ada di `tenants`. */
  terdaftar: boolean;
  /** Bagaimana ia ditemukan — berguna saat menelusuri angka yang aneh. */
  lewat: 'UUID' | 'BUSINESS_ID' | 'OWNER_REF' | 'SINTETIS';
}

export async function resolveTenant(db: Db, id: IdentitasMerchant): Promise<HasilResolusi> {
  const merchantId = (id.merchantId ?? '').trim();
  const businessId = (id.businessId ?? '').trim();

  if (UUID_RE.test(merchantId)) {
    return { tenantId: merchantId, terdaftar: true, lewat: 'UUID' };
  }

  if (businessId) {
    const { rows } = await db.query(
      `SELECT merchant_id FROM contract.merchant_directory WHERE business_id = $1`,
      [businessId]
    );
    if (rows.length) {
      return { tenantId: rows[0].merchant_id, terdaftar: true, lewat: 'BUSINESS_ID' };
    }
  }

  if (merchantId) {
    // Pemilik dengan lebih dari satu unit usaha SENGAJA tidak diselesaikan di
    // sini. Menebak salah satunya berarti kredit kafe terpotong untuk
    // pertanyaan tentang laundry — dan tidak akan ada yang menyadarinya.
    const { rows } = await db.query(
      `SELECT merchant_id FROM contract.merchant_directory
        WHERE owner_user_ref = $1 LIMIT 2`,
      [merchantId]
    );
    if (rows.length === 1) {
      return { tenantId: rows[0].merchant_id, terdaftar: true, lewat: 'OWNER_REF' };
    }
  }

  const kunci = businessId || merchantId || 'tanpa-identitas';
  const { rows } = await db.query(`SELECT legacy_uuid($1) AS id`, [kunci]);
  return { tenantId: rows[0].id, terdaftar: false, lewat: 'SINTETIS' };
}
