const SAAS_PLANS: Record<string, { id: string; name: string; tierLevel: number; priceIdr: number }> = {
  'plan-free': {
    id: 'plan-free',
    name: 'Free Tier',
    tierLevel: 1,
    priceIdr: 0,
  },
  'plan-plus-monthly': {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    priceIdr: 99000,
  },
  'plan-pro-monthly': {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    priceIdr: 299000,
  },
};

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { targetPlanId, planId, invoiceId } = body;
  const chosenPlanId = targetPlanId || planId || 'plan-pro-monthly';
  const plan = SAAS_PLANS[chosenPlanId] || SAAS_PLANS['plan-plus-monthly'];

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const invNumber = invoiceId || `INV-${Date.now().toString().slice(-8)}`;

  return res.status(200).json({
    ok: true,
    success: true,
    message: `Pembayaran langganan paket ${plan.name} berhasil disimulasikan! Paket sekarang aktif.`,
    subscription: {
      id: 'sub-simulated-active',
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
    },
    invoice: {
      id: invNumber,
      invoiceNumber: invNumber,
      planId: plan.id,
      amountIdr: plan.priceIdr,
      status: 'PAID',
      paidAt: now.toISOString(),
    },
  });
}
