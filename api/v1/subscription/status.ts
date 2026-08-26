export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  return res.status(200).json({
    ok: true,
    subscription: {
      id: 'sub-trial-active',
      tenantId: req.query?.tenantId || 'tenant-default',
      planId: 'plan-pro-monthly',
      plan: {
        id: 'plan-pro-monthly',
        name: 'Tier Pro',
        tierLevel: 3,
        billingCycle: 'MONTHLY',
        priceIdr: 299000,
        currency: 'IDR',
        maxOutlets: 4,
        isActive: true,
      },
      status: 'TRIAL',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      trialEndsAt: periodEnd.toISOString(),
    },
    daysLeft: 90,
    invoices: [],
  });
}
