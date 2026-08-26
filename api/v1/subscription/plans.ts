import type { VercelRequest, VercelResponse } from '@vercel/node';

const SAAS_PLANS = [
  {
    id: 'plan-free',
    name: 'Free Tier',
    tierLevel: 1,
    billingCycle: 'MONTHLY',
    priceIdr: 0,
    currency: 'IDR',
    maxOutlets: 1,
    isActive: true,
    productLimit: 30,
    aiQuotaMonthly: 3,
    dashboardAccessLevel: 'BASIC',
    features: [
      'Basic POS & Transaksi',
      'Ringkasan Penjualan Harian',
      '1 Outlet / Cabang Toko',
      'Maksimal 30 Produk',
      'AI Analyst (3x / bulan)',
    ],
  },
  {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    billingCycle: 'MONTHLY',
    priceIdr: 99000,
    priceYearlyIdr: 79000,
    currency: 'IDR',
    maxOutlets: 2,
    isActive: true,
    productLimit: 100,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: 'FULL',
    extraOutletPriceIdr: 59000,
    features: [
      'Full POS & Transaksi Kasir',
      'Manajemen Inventori Dasar',
      'Laporan & Dashboard Analytics',
      'Maksimal 100 Produk per Outlet',
      'Up to 2 Outlet Terdaftar',
      'AI Analyst (30x / bulan)',
    ],
  },
  {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    billingCycle: 'MONTHLY',
    priceIdr: 299000,
    priceYearlyIdr: 239000,
    currency: 'IDR',
    maxOutlets: 4,
    isActive: true,
    productLimit: -1,
    aiQuotaMonthly: 90,
    dashboardAccessLevel: 'ADVANCED',
    extraOutletPriceIdr: 49000,
    features: [
      'Full POS & Transaksi Lanjutan',
      'Manajemen Stok Lanjut & Bahan Baku',
      'Multi-Outlet Analytics & Laporan Lengkap',
      'Produk Tidak Terbatas (Unlimited)',
      'Up to 4 Outlet Terdaftar',
      'AI Analyst (90x / bulan)',
    ],
  },
];

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    plans: SAAS_PLANS,
  });
}
