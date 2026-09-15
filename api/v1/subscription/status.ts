export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  return res.status(200).json({
    ok: true,
    subscription: {
      id: 'sub-trial-active',
      tenantId: req.query?.tenantId || 'tenant-default',
      planId: 'plan-plus-monthly',
      status: 'ACTIVE',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
    },
    daysLeft: 45,
    invoices: [],
  });
}
