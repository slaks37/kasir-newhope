type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

const DEFAULT_PLANS = [
  {
    id: 'plan-basic-monthly',
    name: 'Free Trial 90 Hari / Starter',
    tierLevel: 1,
    billingCycle: 'MONTHLY',
    priceIdr: 0,
    features: ['Laporan Finansial Realtime', 'Ekspor Excel & PDF', '1 Terminal Kasir Aktif', 'Sinkronisasi Cloud Supabase'],
  },
  {
    id: 'plan-pro-monthly',
    name: 'Pro Merchant (Rp 55.000 / bln)',
    tierLevel: 2,
    billingCycle: 'MONTHLY',
    priceIdr: 55000,
    features: ['Semua Fitur Starter', 'Multi Kasir & Multi Cabang', 'AI Financial Copilot', 'Manajemen Stok HPP & Resep BOM'],
  },
  {
    id: 'plan-enterprise-monthly',
    name: 'Enterprise Ultra (Rp 88.000 / bln)',
    tierLevel: 3,
    billingCycle: 'MONTHLY',
    priceIdr: 88000,
    features: ['Semua Fitur Pro', 'Unlimited Multi Cabang', 'Akses API & Webhook', 'Dukungan Prioritas 24/7 VIP', 'Dedicated Business Advisor'],
  },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = getPool();
  try {
    const result = await db.query(
      `SELECT id, name, tier_level as "tierLevel", billing_cycle as "billingCycle", price_idr as "priceIdr", features
       FROM billing.plans
       ORDER BY tier_level ASC`
    );

    if (result.rows.length > 0) {
      return res.status(200).json({ ok: true, plans: result.rows });
    }

    return res.status(200).json({ ok: true, plans: DEFAULT_PLANS });
  } catch (err) {
    console.error('[API Subscription Plans Error]:', err);
    return res.status(200).json({ ok: true, plans: DEFAULT_PLANS });
  }
}
