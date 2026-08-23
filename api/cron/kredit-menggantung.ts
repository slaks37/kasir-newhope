/**
 * Mengembalikan kredit AI yang tertahan.
 *
 * Fungsi `ai.bersihkan_cadangan_menggantung()` sudah ada sejak migrasi 0027 —
 * tetapi TIDAK PERNAH DIPANGGIL dari mana pun. Pencarian di seluruh kode hanya
 * menemukannya di dalam sebuah komentar.
 *
 * Akibatnya: proses yang mati setelah kredit dipesan tetapi sebelum jawabannya
 * tercatat meninggalkan kredit tertahan PERMANEN. Merchant kehilangan kuota
 * berbayar tanpa pernah mendapat jawaban, dan tidak ada satu pun galat yang
 * memberi tahu siapa pun.
 *
 * Dijalankan tiap 15 menit — sama dengan ambang bawaan fungsinya.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { jagaCron } from './_jaga.js';
import { sslUntuk } from '../../src/server/sslDb.js';

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    pool = new pg.Pool({ connectionString: url, ssl: sslUntuk(url), max: 2 });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!jagaCron(req, res)) return;
  try {
    const { rows } = await getPool().query('SELECT ai.bersihkan_cadangan_menggantung(15) AS dikembalikan');
    const n = Number(rows[0]?.dikembalikan ?? 0);
    if (n > 0) console.warn(`[cron] ${n} cadangan kredit menggantung dikembalikan`);
    return res.status(200).json({ ok: true, dikembalikan: n });
  } catch (err: any) {
    console.error('[cron/kredit-menggantung]', err?.message);
    return res.status(500).json({ ok: false, error: 'CRON_FAILED' });
  }
}
