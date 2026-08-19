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

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
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

const DAY_MS = 86_400_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body ?? {};
  const tenantRef = String(body.tenantId ?? '').trim();
  const targetPlanId = String(body.targetPlanId ?? body.planId ?? '').trim();
  const billingCycle = body.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';

  if (!tenantRef || !targetPlanId) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'tenantId dan targetPlanId wajib diisi.' });
  }

  const db = getPool();

  try {
    const tenant = await db.query(
      `SELECT merchant_id FROM contract.merchant_directory
        WHERE business_id = $1
           OR (owner_user_ref = $1 AND (SELECT COUNT(*) FROM contract.merchant_directory
                                         WHERE owner_user_ref = $1) = 1)
        LIMIT 1`,
      [tenantRef]
    );
    if (!tenant.rows.length) {
      return res.status(409).json({ ok: false, error: 'MERCHANT_BELUM_SINKRON' });
    }

    const target = await db.query(
      `SELECT id, name, price_idr, price_yearly_idr FROM billing.plans WHERE id = $1 AND is_active`,
      [targetPlanId]
    );
    if (!target.rows.length) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

    const sekarang = await db.query(
      `SELECT p.id, p.name, p.price_idr, s.current_period_end
         FROM billing.subscriptions s
         JOIN billing.plans p ON p.id = s.plan_id
        WHERE s.tenant_id = $1`,
      [tenant.rows[0].merchant_id]
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
