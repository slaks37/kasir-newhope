type VercelRequest = any;
type VercelResponse = any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { targetPlanId, billingCycle } = req.body ?? {};

  const pricing: Record<string, number> = {
    'plan-basic-monthly': 0,
    'plan-pro-monthly': 55000,
    'plan-enterprise-monthly': 88000,
  };

  const targetPrice = pricing[targetPlanId] ?? 55000;
  const currentPrice = 0;
  const daysRemaining = 25;
  const totalDays = 30;

  const proratedAmount = Math.max(0, Math.round(((targetPrice - currentPrice) / totalDays) * daysRemaining));

  return res.status(200).json({
    ok: true,
    calculation: {
      targetPlanId,
      billingCycle: billingCycle || 'MONTHLY',
      proratedAmount,
      currency: 'IDR',
      daysRemaining,
      totalDays,
      chargeNow: proratedAmount,
    },
  });
}
