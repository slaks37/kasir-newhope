/**
 * GET /api/v1/subscription/plans — katalog paket yang dilihat merchant.
 *
 * Dibaca dari `contract.plan_catalog`, yang isinya diatur admin lewat panel.
 * Sebelumnya berkas ini memegang daftarnya sendiri (Starter / Pro 55rb /
 * Enterprise 88rb) yang sudah lama tidak cocok dengan kartu harga di landing
 * page maupun dengan billing-service — tiga daftar hidup bersamaan, dan tidak
 * ada yang tahu mana yang berlaku.
 *
 * TIDAK ADA lagi daftar cadangan di sini. Kalau database tidak terbaca, yang
 * dikembalikan adalah galat — bukan harga karangan yang bisa dipakai orang
 * untuk berlangganan.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { rows } = await getPool().query(
      `SELECT id, name, tier_level, billing_cycle, price_idr, price_yearly_idr,
              extra_outlet_price_idr, currency, features, product_limit, max_outlets,
              ai_quota_monthly, dashboard_access_level, module_access, sort_order
         FROM contract.plan_catalog
        WHERE is_active
        ORDER BY sort_order, tier_level`
    );

    return res.status(200).json({
      ok: true,
      plans: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        tierLevel: Number(r.tier_level),
        billingCycle: r.billing_cycle,
        priceIdr: Number(r.price_idr),
        priceYearlyIdr: r.price_yearly_idr == null ? undefined : Number(r.price_yearly_idr),
        extraOutletPriceIdr:
          r.extra_outlet_price_idr == null ? undefined : Number(r.extra_outlet_price_idr),
        currency: r.currency || 'IDR',
        features: r.features ?? [],
        productLimit: Number(r.product_limit),
        maxOutlets: Number(r.max_outlets),
        aiQuotaMonthly: Number(r.ai_quota_monthly),
        dashboardAccessLevel: r.dashboard_access_level,
        moduleAccess: r.module_access ?? [],
        isActive: true,
      })),
    });
  } catch (err: any) {
    console.error('[API Subscription Plans Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'PLAN_CATALOG_UNAVAILABLE' });
  }
}
