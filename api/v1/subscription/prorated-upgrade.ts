import { SAAS_PLANS, annualTotal } from '../../../src/config/saasPlans';

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
    const selectedPlan = SAAS_PLANS.find((p) => p.id === chosenPlanId) || SAAS_PLANS[1];

    const isYearly = billingCycle === 'YEARLY';
    const basePrice = isYearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr;
    const extraOutletsCount = Math.max(0, Number(extraOutlets) || 0);
    const outletPrice = isYearly
      ? (selectedPlan.extraOutletYearlyIdr || 760320) * extraOutletsCount
      : (selectedPlan.extraOutletPriceIdr || 79200) * extraOutletsCount;

    const totalAmount = basePrice + outletPrice;
    const now = new Date();
    const end = new Date(now);
    if (isYearly) end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);

    return res.status(200).json({
      ok: true,
      planId: selectedPlan.id,
      planName: selectedPlan.name,
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
