/**
 * Penolong untuk tes yang butuh Postgres sungguhan.
 *
 * Tes di sini MELEWATKAN DIRI bila DATABASE_URL tidak diset, bukan gagal.
 * Kontributor yang belum menyiapkan Postgres harus tetap bisa menjalankan
 * `npm test` dan mendapat jawaban yang berguna; suite yang merah karena
 * lingkungan, bukan karena kode, adalah suite yang lama-lama diabaikan orang.
 *
 * Di CI, DATABASE_URL diset dan semuanya benar-benar berjalan.
 */

import pg from 'pg';

export const ADA_DB = Boolean(process.env.DATABASE_URL);

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\//.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: 4,
    });
  }
  return pool;
}

export async function tutupDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Membuat merchant uji yang bersih, membuang sisa percobaan sebelumnya. */
export async function merchantUji(businessId: string, nama = 'Toko Uji'): Promise<string> {
  const d = db();
  await d.query('DELETE FROM pos.businesses WHERE client_key = $1', [businessId]);
  const { rows } = await d.query(
    `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
     VALUES (uuidv7(), $1, 'FNB', $2, $3, true) RETURNING id`,
    [nama, businessId, businessId.split('_')[0]]
  );
  return rows[0].id;
}

export async function pasangPaket(tenantId: string, planId: string): Promise<void> {
  await db().query(
    `INSERT INTO billing.subscriptions
       (id, business_id, plan_id, status, current_period_start, current_period_end)
     VALUES (uuidv7(), $1, $2, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days')
     ON CONFLICT (business_id) DO UPDATE SET
       plan_id = $2, status = 'ACTIVE',
       current_period_end = CURRENT_TIMESTAMP + INTERVAL '30 days'`,
    [tenantId, planId]
  );
}

/** Res tiruan yang menangkap status dan badan balasan handler serverless. */
export function resTiruan() {
  return {
    _status: 0,
    _body: null as any,
    status(c: number) { this._status = c; return this; },
    json(b: any) { this._body = b; return this; },
    end() { return this; },
  };
}
