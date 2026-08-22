import 'dotenv/config';
import pg from 'pg';

const SAAS_PLANS = [
  {
    id: 'plan-free',
    name: 'Free Trial',
    tier_level: 1,
    billing_cycle: 'MONTHLY',
    price_idr: 0,
    currency: 'IDR',
    features: [
      'Basic POS & Transaksi',
      'Ringkasan Penjualan Harian',
      '1 Outlet / Cabang Toko',
      'Maksimal 30 Produk',
      'AI Analyst (3x / bulan)',
    ],
    is_active: true,
  },
  {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tier_level: 2,
    billing_cycle: 'MONTHLY',
    price_idr: 99000,
    currency: 'IDR',
    features: [
      'Full POS & Transaksi Kasir',
      'Manajemen Inventori Dasar',
      'Laporan & Dashboard Analytics',
      'Maksimal 100 Produk per Outlet',
      'Up to 2 Outlet Terdaftar',
      'AI Analyst (30x / bulan)',
    ],
    is_active: true,
  },
  {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tier_level: 3,
    billing_cycle: 'MONTHLY',
    price_idr: 299000,
    currency: 'IDR',
    features: [
      'Full POS & Transaksi Lanjutan',
      'Manajemen Stok Lanjut & Bahan Baku',
      'Multi-Outlet Analytics & Laporan Lengkap',
      'Produk Tidak Terbatas (Unlimited)',
      'Up to 4 Outlet Terdaftar',
      'AI Analyst (90x / bulan)',
    ],
    is_active: true,
  },
];

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  console.log('Upserting SaaS plans into billing.plans...');
  for (const p of SAAS_PLANS) {
    await client.query(`
      INSERT INTO billing.plans (id, name, tier_level, billing_cycle, price_idr, currency, features, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        tier_level = EXCLUDED.tier_level,
        billing_cycle = EXCLUDED.billing_cycle,
        price_idr = EXCLUDED.price_idr,
        features = EXCLUDED.features,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `, [p.id, p.name, p.tier_level, p.billing_cycle, p.price_idr, p.currency, JSON.stringify(p.features), p.is_active]);
  }
  console.log('SaaS plans synced successfully!');

  await client.end();
}

main().catch(console.error);
