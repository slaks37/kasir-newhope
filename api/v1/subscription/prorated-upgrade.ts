/**
 * POST /api/v1/subscription/prorated-upgrade — hitung selisih tagihan upgrade.
 *
 * Versi sebelumnya memegang daftar harganya sendiri (Rp 55rb / 88rb) dan
 * menganggap setiap merchant punya sisa 25 dari 30 hari. Angka yang keluar
 * karena itu tidak pernah cocok dengan yang benar-benar ditagihkan — dan yang
 * dilihat merchant sebelum menekan bayar adalah angka inilah.
 *
 * Sekarang harga datang dari katalog, dan sisa hari dari langganan yang
 * sebenarnya berjalan.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { resolveTenantId } from '../../_lib/tenant.js';
import { wajibToko } from '../../_lib/tokoContext.js';
import { sslUntuk } from '../../../src/server/sslDb.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
    const url = process.env.DATABASE_URL || '';
    pool = new pg.Pool({
      connectionString: url,
      ssl: sslUntuk(url),
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

const DAY_MS = 86_400_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body ?? {};
  const tenantRef = String(body.tenantId ?? '').trim();
  // GERBANG IDENTITAS (lihat api/_lib/tokoContext.ts). Toko ditentukan dari
  // token, bukan dari isi permintaan.
  const toko = await wajibToko(req, res, tenantRef);
  if (!toko) return;

  const targetPlanId = String(body.targetPlanId ?? body.planId ?? '').trim();
  const billingCycle = body.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';

  if (!tenantRef || !targetPlanId) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'tenantId dan targetPlanId wajib diisi.' });
  }

  const db = getPool();

  try {
    const tenantId = toko.businessId;
    if (!tenantId) {
      return res.status(409).json({ ok: false, error: 'MERCHANT_BELUM_SINKRON' });
    }

    const target = await db.query(
      `SELECT id, name, price_idr, price_yearly_idr FROM billing.plans WHERE id = $1 AND is_active`,
      [targetPlanId]
    );
    if (!target.rows.length) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

    // Langganan ditemukan lewat MERCHANT-nya. Yang diupgrade adalah paket
    // pemilik, yang berlaku untuk seluruh unit usahanya sekaligus.
    const sekarang = await db.query(
      `SELECT p.id, p.name, p.price_idr, s.current_period_end
         FROM billing.subscriptions s
         JOIN pos.businesses b ON b.merchant_id = s.merchant_id
         JOIN billing.plans p ON p.id = s.plan_id
        WHERE b.id = $1`,
      [tenantId]
    );

    const lama = sekarang.rows[0] ?? null;
    const t = target.rows[0];

    // Harga tahunan disimpan sebagai harga PER BULAN bila ditagih tahunan —
    // sama seperti yang ditampilkan kartu harga.
    const hargaTarget = Number(
      billingCycle === 'YEARLY' && t.price_yearly_idr != null ? t.price_yearly_idr : t.price_idr
    );

    const sisaHari = lama?.current_period_end
      ? Math.max(0, Math.ceil((new Date(lama.current_period_end).getTime() - Date.now()) / DAY_MS))
      : 0;

    // Sisa periode paket LAMA dikreditkan; hanya selisihnya yang ditagih.
    // Menagih harga penuh saat upgrade di tengah periode berarti merchant
    // membayar dua kali untuk hari yang sama.
    const kreditSisa = Math.round((Number(lama?.price_idr ?? 0) / 30) * sisaHari);
    const ditagih = Math.max(0, hargaTarget - kreditSisa);

    return res.status(200).json({
      ok: true,
      calculation: {
        currentPlan: lama ? { id: lama.id, name: lama.name, priceIdr: Number(lama.price_idr) } : null,
        targetPlanId: t.id,
        targetPlanName: t.name,
        targetPriceIdr: hargaTarget,
        billingCycle,
        daysRemaining: sisaHari,
        creditFromCurrentPlan: kreditSisa,
        proratedAmount: ditagih,
        chargeNow: ditagih,
        currency: 'IDR',
      },
    });
  } catch (err: any) {
    console.error('[API Prorated Upgrade Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'PRORATION_UNAVAILABLE' });
  }
}
