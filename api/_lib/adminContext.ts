/**
 * Konteks bersama untuk fungsi serverless konsol internal.
 *
 * KENAPA ADA. backoffice-service tidak ikut ter-deploy ke Vercel; yang tersaji
 * di sana hanya `admin.html` beserta fungsi di folder `api/`. Tanpa berkas ini,
 * panel admin di produksi tidak punya backend sama sekali — persis keadaan
 * sebelumnya, ketika seluruh angkanya konstanta di dalam bundle.
 *
 * Berkas diawali garis bawah supaya Vercel memperlakukannya sebagai pustaka,
 * bukan endpoint.
 *
 * Aturan izin, hashing, dan penyimpanan paket TIDAK diulang di sini. Semuanya
 * diimpor dari modul yang sama dengan yang dipakai backoffice-service, karena
 * dua salinan aturan akses adalah dua aturan akses yang akan berbeda.
 */

import pg from 'pg';
import {
  hasInternalCapability,
  type InternalCapability,
  type InternalRole,
} from '../../src/lib/rbac/environments';
import { tokenDariHeader, verifyToken } from '../../src/server/adminAuth';
import type { Db } from '../../src/server/db';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    // NUMERIC pulang sebagai string dari pg supaya presisi tidak hilang. Harga
    // paket jauh di bawah batas aman float64, jadi diparse sekali di sini —
    // bukan di setiap pemanggil, yang cepat atau lambat akan ada yang lupa.
    pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));

    // SSL wajib untuk database terkelola, dan mustahil untuk yang lokal —
    // Postgres di localhost menolak dengan "server does not support SSL".
    // Aturan yang sama dipakai services/db-server/migrate.ts; memaksa SSL di
    // sini membuat seluruh jalur admin tidak bisa dijalankan atau diuji di
    // mesin sendiri.
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\/|^postgres:\/\/[^@]*$/.test(url);

    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

/**
 * Membungkus pg.Pool menjadi antarmuka `Db` yang dipakai modul bersama.
 *
 * `exec()` tidak didukung: ia hanya untuk berkas migrasi, dan menjalankan
 * migrasi dari fungsi serverless yang bisa menyala puluhan kali bersamaan
 * adalah cara memastikan skemanya rusak.
 */
export function poolSebagaiDb(p: pg.Pool = getPool()): Db {
  return {
    driver: 'pg',
    label: 'vercel-serverless',
    async query(sql: string, params?: unknown[]) {
      const r = await p.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec() {
      throw new Error('exec() tidak tersedia di jalur serverless — migrasi dijalankan terpisah.');
    },
    async tx<T>(fn: (c: Db) => Promise<T>): Promise<T> {
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        const hasil = await fn({
          driver: 'pg',
          label: 'vercel-serverless-tx',
          query: async (sql: string, params?: unknown[]) => {
            const r = await client.query(sql, params as any[]);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
          exec: async () => {
            throw new Error('exec() tidak tersedia di dalam transaksi.');
          },
          tx: async () => {
            throw new Error('Transaksi bersarang tidak didukung.');
          },
        });
        await client.query('COMMIT');
        return hasil;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export interface AdminIdentity {
  id: string;
  email: string;
  fullName: string;
  role: InternalRole;
}

/**
 * Memeriksa token, memuat ulang akunnya, lalu menegakkan capability.
 *
 * Mengembalikan `null` setelah menulis respons galat sendiri, supaya pemanggil
 * cukup `if (!who) return;` — pola yang sulit dilupakan, tidak seperti
 * memeriksa boolean yang gampang terlewat satu cabang.
 *
 * Akun DIBACA ULANG dari database pada setiap request meskipun rolenya sudah
 * ada di dalam token. Token berlaku 8 jam; menonaktifkan akun yang
 * disalahgunakan harus berlaku saat itu juga, bukan delapan jam kemudian.
 */
export async function wajibAdmin(
  req: any,
  res: any,
  capability: InternalCapability
): Promise<AdminIdentity | null> {
  const klaim = verifyToken(tokenDariHeader(req.headers?.authorization));
  if (!klaim) {
    res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    return null;
  }

  let rows: any[];
  try {
    const r = await getPool().query(
      `SELECT id, email, full_name, role FROM internal.internal_users
        WHERE id = $1::uuid AND is_active`,
      [klaim.uid]
    );
    rows = r.rows;
  } catch (err: any) {
    console.error('[admin] gagal memuat identitas:', err?.message);
    res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
    return null;
  }

  if (!rows.length) {
    res.status(401).json({ ok: false, error: 'UNKNOWN_IDENTITY' });
    return null;
  }

  const who: AdminIdentity = {
    id: rows[0].id,
    email: rows[0].email,
    fullName: rows[0].full_name,
    role: rows[0].role,
  };

  if (!hasInternalCapability(who.role, capability)) {
    // Penolakan ikut dicatat. "Siapa yang MENCOBA mengubah harga" adalah
    // pertanyaan audit yang sah, dan jawabannya paling berguna justru ketika
    // percobaannya gagal.
    await catatAkses(who, `DENIED_${capability}`, req.url || '', req);
    res.status(403).json({
      ok: false,
      error: 'CAPABILITY_DENIED',
      detail: `Role ${who.role} tidak memiliki ${capability}.`,
    });
    return null;
  }

  return who;
}

export async function catatAkses(
  who: AdminIdentity,
  action: string,
  resource: string,
  req?: any
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO internal.internal_access_log
         (id, internal_user_id, internal_role, action, resource, ip_address)
       VALUES (uuidv7(), $1::uuid, $2::internal_role_enum, $3, $4, $5)`,
      [
        who.id,
        who.role,
        action,
        String(resource).slice(0, 200),
        req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null,
      ]
    );
  } catch (err: any) {
    // Audit yang gagal tidak menjatuhkan request — tapi juga tidak hilang diam.
    console.error('[audit] gagal mencatat akses internal:', err?.message);
  }
}

/** Menjawab preflight dan menolak metode yang tidak dilayani. */
export function metodeDilayani(req: any, res: any, daftar: string[]): boolean {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return false;
  }
  if (!daftar.includes(req.method)) {
    res.setHeader('Allow', daftar.join(', '));
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    return false;
  }
  return true;
}
