const SAAS_PLANS: Record<string, { id: string; name: string; tierLevel: number; priceIdr: number; priceYearlyIdr: number; extraOutletPriceIdr: number; extraOutletYearlyIdr: number }> = {
  'plan-free': {
    id: 'plan-free',
    name: 'Free Trial 15 Hari',
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

function sendJson(res: any, status: number, data: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');
    res.setHeader('Content-Type', 'application/json');
  } catch {}

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

async function getJsonBody(req: any): Promise<any> {
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: any) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  try {
    const body = await getJsonBody(req);
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

    return sendJson(res, 200, {
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
    return sendJson(res, 200, {
      ok: true,
      planId: 'plan-plus-monthly',
      planName: 'Tier Plus',
      billingCycle: 'MONTHLY',
      amount: 99000,
      recurringAmount: 99000,
      unusedCredit: 0,
      extraOutlets: 0,
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      netProratedAmount: 99000,
      proratedAmountIdr: 99000,
    });
  }
}
