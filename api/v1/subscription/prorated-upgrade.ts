const SAAS_PLANS: Record<string, { id: string; name: string; tierLevel: number; priceIdr: number; priceYearlyIdr: number; extraOutletPriceIdr: number; extraOutletYearlyIdr: number }> = {
  'plan-free': {
    id: 'plan-free',
    name: 'Free Trial 45 Hari',
    tierLevel: 1,
    priceIdr: 0,
    priceYearlyIdr: 0,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
  },
  'plan-plus-monthly': {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    priceIdr: 99000,
    priceYearlyIdr: 79200,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
  },
  'plan-pro-monthly': {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    priceIdr: 299000,
    priceYearlyIdr: 248170,
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
  },
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { planId, targetPlanId, billingCycle, extraOutlets } = body;
    const chosenPlanId = targetPlanId || planId || 'plan-plus-monthly';
    const plan = SAAS_PLANS[chosenPlanId] || SAAS_PLANS['plan-plus-monthly'];

    const isYearly = billingCycle === 'YEARLY';
    const basePrice = isYearly ? plan.priceYearlyIdr * 12 : plan.priceIdr;
    const extraOutletsCount = Math.max(0, Number(extraOutlets) || 0);
    const outletPrice = isYearly
      ? plan.extraOutletYearlyIdr * 12 * extraOutletsCount
      : plan.extraOutletPriceIdr * extraOutletsCount;

    const totalAmount = basePrice + outletPrice;
    const now = new Date();
    const end = new Date(now);
    if (isYearly) end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);

    return res.status(200).json({
      ok: true,
      planId: plan.id,
      planName: plan.name,
      billingCycle: isYearly ? 'YEARLY' : 'MONTHLY',
      amount: totalAmount,
      recurringAmount: totalAmount,
      unusedCredit: 0,
      extraOutlets: extraOutletsCount,
      periodStart: now.toISOString(),
      periodEnd: end.toISOString(),
      netProratedAmount: totalAmount,
      proratedAmountIdr: totalAmount,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: 'PRORATION_CALCULATION_FAILED',
      detail: err?.message || String(err),
    });
  }
}
