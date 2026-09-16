const SAAS_PLANS = [
  {
    id: 'plan-free',
    name: 'Free Trial 15 Hari',
    tierLevel: 1,
    billingCycle: 'MONTHLY',
    priceIdr: 0,
    currency: 'IDR',
    maxOutlets: 2,
    isActive: true,
    isTrial: true,
    features: [
      'Seluruh fitur Tier Pro selama 15 hari',
      'Hingga 2 outlet',
      'Produk dan pengguna tidak terbatas',
      'Kuota AI trial terbatas',
      'WhatsApp assisted melalui wa.me',
      'Tanpa kartu kredit',
      'Data tetap dapat dibaca 14 hari setelah trial',
    ],
  },
  {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    billingCycle: 'MONTHLY',
    priceIdr: 99000,
    priceYearlyIdr: 79200,
    annualDiscountPercent: 20,
    currency: 'IDR',
    maxOutlets: 2,
    isActive: true,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
    features: [
      'POS, transaksi, QRIS, dan struk',
      '2 outlet termasuk dalam paket',
      'Produk dan kategori tidak terbatas',
      'Inventori dan workflow sektor dasar',
      'Pelanggan, shift, kas, dan laporan omzet',
      'AI Analyst kuota dasar',
      'Support standar',
    ],
  },
  {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    billingCycle: 'MONTHLY',
    priceIdr: 299000,
    priceYearlyIdr: 248170,
    annualDiscountPercent: 17,
    currency: 'IDR',
    maxOutlets: 4,
    isActive: true,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
    features: [
      'Semua fitur Tier Plus',
      '4 outlet termasuk dalam paket',
      'Inventori multi-location, transfer stok, dan recursive BOM',
      'Smart Labor, absensi, komisi, bonus, dan payroll',
      'Workflow vertikal lengkap untuk tiap sektor',
      'WhatsApp Lifecycle Center',
      'Advanced AI Business Analyst dan laporan lintas outlet',
      'Priority support',
    ],
  },
];

function sendJson(res: any, status: number, data: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');
    res.setHeader('Content-Type', 'application/json');
  } catch {}

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

export default function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 200, {
    ok: true,
    plans: SAAS_PLANS,
  });
}
