/**
 * POST /api/v1/sync/branches — menyimpan cabang merchant ke server.
 *
 * KENAPA ENDPOINT INI ADA. `max_outlets` sudah ada di paket sejak 0014 dan
 * sudah ditolak aplikasi kasir lewat bolehTambahOutlet(). Tapi cabang tidak
 * pernah meninggalkan browser, jadi penegakannya persis sekuat tombol Simpan di
 * layar Pengaturan: siapa pun yang menyunting localStorage melewatinya, dan
 * perangkat kedua yang belum pernah melihat cabang pertama menghitung dari nol.
 *
 * Ini lubang yang sama dengan batas produk di sync/transactions.ts, dan
 * penutupannya menuntut cabang punya tempat di server untuk dihitung.
 *
 * BATASNYA MENOLAK, TIDAK MEMOTONG DIAM-DIAM. Berbeda dari produk — di sana
 * barang sudah terlanjur terjual dan uangnya tidak boleh hilang — cabang adalah
 * sesuatu yang merchant BUAT, bukan yang sudah terjadi. Menolaknya di muka
 * adalah jawaban yang benar, dan merchant diberi tahu persis cabang mana yang
 * tidak tersimpan.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { resolveTenantId } from '../../_lib/tenant.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\//.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

/** Derajat yang di luar jangkauan bumi adalah salah ketik, bukan lokasi. */
function derajat(v: unknown, maks: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > maks) return null;
  return n;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body ?? {};
  const ref = String(body.businessId ?? body.tenantId ?? '').trim();
  const masuk = Array.isArray(body.branches) ? body.branches : [];

  if (!ref) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId wajib diisi.' });
  }

  const db = getPool();
  const client = await db.connect();

  try {
    const tenantId = await resolveTenantId(db, ref);
    if (!tenantId) {
      return res.status(409).json({
        ok: false,
        error: 'MERCHANT_BELUM_SINKRON',
        detail: 'Toko ini belum tersinkronisasi ke server.',
      });
    }

    await client.query('BEGIN');

    // Batas dibaca DI DALAM transaksi dan barisnya dikunci, supaya dua
    // perangkat yang sama-sama menambah cabang terakhir tidak lolos berdua.
    await client.query('SELECT id FROM pos.tenants WHERE id = $1 FOR UPDATE', [tenantId]);

    const { rows: kuota } = await client.query(
      `SELECT max_outlets, outlet_aktif
         FROM contract.merchant_outlet_usage WHERE merchant_id = $1`,
      [tenantId]
    );
    const maksOutlet = Number(kuota[0]?.max_outlets ?? 1);

    const tersimpan: Array<{ ref: string; id: string }> = [];
    const ditolak: Array<{ ref: string; nama: string; alasan: string }> = [];

    for (const c of masuk) {
      const cref = String(c?.id ?? c?.ref ?? '').trim().slice(0, 96);
      const nama = String(c?.name ?? '').trim().slice(0, 120);
      if (!cref || !nama) continue;

      const aktif = c.isActive !== false;

      // Sudah ada -> selalu boleh diperbarui. Menutup akses sunting pada cabang
      // yang terlanjur ada saat admin menurunkan batas berarti merchant tidak
      // bisa memperbaiki alamat atau menonaktifkan cabang yang sudah ditutup —
      // padahal menonaktifkannya justru yang membebaskan kuotanya.
      const { rows: ada } = await client.query(
        `SELECT id FROM pos.branches WHERE tenant_id = $1 AND external_ref = $2`,
        [tenantId, cref]
      );

      if (!ada.length && aktif) {
        const { rows: hitung } = await client.query(
          `SELECT COUNT(*)::int AS n FROM pos.branches
            WHERE tenant_id = $1 AND is_active`,
          [tenantId]
        );
        if (hitung[0].n >= maksOutlet) {
          ditolak.push({
            ref: cref,
            nama,
            alasan: `Paket mencakup ${maksOutlet} outlet dan semuanya sudah terpakai.`,
          });
          continue;
        }
      }

      const { rows: simpan } = await client.query(
        `INSERT INTO pos.branches
           (id, tenant_id, external_ref, name, address, latitude, longitude,
            allowed_radius_meters, business_sector, is_active, notes)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET
           name                  = EXCLUDED.name,
           address               = EXCLUDED.address,
           latitude              = EXCLUDED.latitude,
           longitude             = EXCLUDED.longitude,
           allowed_radius_meters = EXCLUDED.allowed_radius_meters,
           business_sector       = EXCLUDED.business_sector,
           is_active             = EXCLUDED.is_active,
           notes                 = EXCLUDED.notes,
           updated_at            = CURRENT_TIMESTAMP
         RETURNING id`,
        [
          tenantId,
          cref,
          nama,
          String(c.address ?? '').slice(0, 300),
          derajat(c.latitude, 90),
          derajat(c.longitude, 180),
          Math.min(50_000, Math.max(10, Math.trunc(Number(c.allowedRadiusMeters) || 200))),
          c.businessSector ? String(c.businessSector).slice(0, 16) : null,
          aktif,
          c.notes ? String(c.notes) : null,
        ]
      );
      tersimpan.push({ ref: cref, id: simpan[0].id });
    }

    if (body.activeBranchRef) {
      const cocok = tersimpan.find((t) => t.ref === String(body.activeBranchRef));
      if (cocok) {
        await client.query('UPDATE pos.tenants SET active_branch_id = $2 WHERE id = $1', [
          tenantId,
          cocok.id,
        ]);
      }
    }

    const { rows: akhir } = await client.query(
      `SELECT max_outlets, outlet_aktif, sisa_kuota
         FROM contract.merchant_outlet_usage WHERE merchant_id = $1`,
      [tenantId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      tenantId,
      saved: tersimpan.length,
      rejected: ditolak,
      maxOutlets: Number(akhir[0]?.max_outlets ?? maksOutlet),
      activeOutlets: Number(akhir[0]?.outlet_aktif ?? 0),
      remainingQuota: Number(akhir[0]?.sisa_kuota ?? 0),
      message: ditolak.length
        ? `${tersimpan.length} cabang tersimpan, ${ditolak.length} ditolak karena batas paket.`
        : `${tersimpan.length} cabang tersimpan.`,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[API Sync Branches Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'BRANCH_SYNC_FAILED' });
  } finally {
    client.release();
  }
}
