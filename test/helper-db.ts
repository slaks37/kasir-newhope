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
import { terbitkanTokenToko } from '../src/server/merchantAuth';

// Endpoint toko menolak permintaan tanpa token sejak gerbang identitas dipasang.
// Rahasia uji dipasang di sini supaya setiap berkas tes tidak perlu mengurusnya.
process.env.MERCHANT_SESSION_SECRET =
  process.env.MERCHANT_SESSION_SECRET || 'rahasia-uji-minimal-tiga-puluh-dua-karakter';

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

/**
 * Membuang seluruh jejak seorang pemilik uji: merchant, unit usahanya, dan
 * langganannya.
 *
 * Menghapus business saja tidak cukup sejak 0028. Langganan menempel di
 * merchant, jadi sisa dari percobaan sebelumnya tetap hidup dan unit usaha
 * berikutnya mewarisi paketnya — tes pertama yang mengharapkan TRIAL malah
 * menemukan ACTIVE, tergantung urutan menjalankan.
 */
export async function bersihkanPemilik(clientKey: string): Promise<void> {
  const d = db();
  const owner = clientKey.split('_')[0];
  await d.query('DELETE FROM pos.merchants WHERE owner_user_ref = $1', [owner]);
  await d.query('DELETE FROM pos.businesses WHERE client_key = $1', [clientKey]);
}

/**
 * Membuat merchant uji yang bersih, membuang sisa percobaan sebelumnya.
 *
 * Yang dihapus adalah PEMILIKNYA, bukan hanya unit usahanya. Sejak 0028
 * langganan menempel di merchant: menghapus business saja meninggalkan
 * langganan pemiliknya hidup, dan unit usaha berikutnya mewarisi paket dari
 * percobaan sebelumnya alih-alih memulai dari trial. Tes yang hasilnya
 * bergantung pada urutan menjalankan adalah tes yang tidak membuktikan apa pun.
 */
export async function merchantUji(businessId: string, nama = 'Toko Uji'): Promise<string> {
  const d = db();
  await bersihkanPemilik(businessId);
  const { rows } = await d.query(
    `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
     VALUES (uuidv7(), $1, 'FNB', $2, $3, true) RETURNING id`,
    [nama, businessId, businessId.split('_')[0]]
  );
  return rows[0].id;
}

/**
 * Memasang paket pada PEMILIK unit usaha ini.
 *
 * Sejak 0028 langganan menempel di merchant, bukan di business. Argumennya
 * tetap business_id supaya tes tidak perlu tahu soal itu — resolusinya
 * dikerjakan di sini, sama seperti yang dilakukan endpoint sungguhan.
 */
export async function pasangPaket(tenantId: string, planId: string): Promise<void> {
  await db().query(
    `INSERT INTO billing.subscriptions
       (id, merchant_id, plan_id, status, current_period_start, current_period_end)
     SELECT uuidv7(), b.merchant_id, $2, 'ACTIVE',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days'
       FROM pos.businesses b WHERE b.id = $1
     ON CONFLICT (merchant_id) DO UPDATE SET
       plan_id = $2, status = 'ACTIVE',
       current_period_end = CURRENT_TIMESTAMP + INTERVAL '30 days'`,
    [tenantId, planId]
  );
}

/** Langganan yang BERLAKU untuk sebuah unit usaha, lewat merchantnya. */
export async function langgananUntuk(tenantId: string): Promise<any | null> {
  const { rows } = await db().query(
    `SELECT s.* FROM billing.subscriptions s
       JOIN pos.businesses b ON b.merchant_id = s.merchant_id
      WHERE b.id = $1 LIMIT 1`,
    [tenantId]
  );
  return rows[0] ?? null;
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


/**
 * Header Authorization untuk sebuah toko.
 *
 * Dipakai tes yang memanggil handler /api/v1/* langsung. Tanpa ini seluruhnya
 * dijawab 401 — dan itu memang perilaku yang benar.
 */
export function headerToko(businessId: string, clientKey = ''): Record<string, string> {
  return { authorization: `Bearer ${terbitkanTokenToko({ bid: businessId, ck: clientKey })}` };
}

/** Membuat toko uji sekaligus header tokennya. */
export async function tokoBerToken(clientKey: string, nama = 'Toko Uji') {
  const businessId = await merchantUji(clientKey, nama);
  return { businessId, headers: headerToko(businessId, clientKey) };
}


/**
 * Header token untuk toko yang SUDAH ada, dicari lewat client_key.
 *
 * Dipakai berkas tes yang membuat tokonya sendiri alih-alih lewat merchantUji.
 */
export async function hdrUntuk(clientKey: string): Promise<Record<string, string>> {
  const { rows } = await db().query(
    'SELECT id FROM pos.businesses WHERE client_key = $1 LIMIT 1', [clientKey]);
  if (!rows.length) throw new Error(`hdrUntuk: toko ${clientKey} belum ada`);
  return headerToko(rows[0].id, clientKey);
}


/**
 * Mendaftarkan toko lewat endpoint sesi lalu mengembalikan headernya.
 *
 * Dipakai berkas tes yang tokonya dulu lahir dari panggilan sinkron pertama.
 * Sejak gerbang identitas dipasang, urutannya terbalik: toko didaftarkan lebih
 * dulu, baru sinkron bisa jalan. Itu memang alur yang sesungguhnya di lapangan.
 */
export async function daftarTokoUji(
  clientKey: string,
  sector = 'FNB',
  storeName = 'Toko Uji'
): Promise<Record<string, string>> {
  const { default: sesi } = await import('../api/v1/auth/session');
  const res = resTiruan();
  await sesi(
    { method: 'POST', headers: {}, body: {
      businessId: clientKey, ownerRef: clientKey.split('_')[0], storeName, sector,
    } } as any,
    res as any
  );
  if (res._status !== 200) throw new Error(`daftarTokoUji gagal: ${JSON.stringify(res._body)}`);
  return headerToko(res._body.businessId, clientKey);
}
