import { createDokuCheckout, isDokuConfigured } from '../../_doku';

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

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
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

    const amount = basePrice + outletPrice;
    const invoiceNumber = `NH-${Date.now().toString().slice(-8)}`;

    if (amount === 0) {
      return res.status(200).json({
        ok: true,
        success: true,
        message: 'Paket gratis berhasil diaktifkan.',
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: plan.id,
          amountIdr: 0,
          status: 'PAID',
          paidAt: new Date().toISOString(),
        },
      });
    }

    if (isDokuConfigured()) {
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'kasir.newhope.space';
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const origin = (process.env.PUBLIC_APP_URL || `${proto}://${host}`).replace(/["']/g, '').trim();
      const callbackUrl = `${origin.replace(/\/$/, '')}/#payment?invoice=${invoiceNumber}`;

      try {
        const dokuRes = await createDokuCheckout({
          order: {
            invoice_number: invoiceNumber,
            amount,
            currency: 'IDR',
            callback_url: callbackUrl,
            auto_redirect: true,
            line_items: [
              {
                name: `Paket ${plan.name} (${isYearly ? 'Tahunan' : 'Bulanan'})` + (extraOutletsCount > 0 ? ` + ${extraOutletsCount} Outlet` : ''),
                price: amount,
                quantity: 1,
              },
            ],
          },
          payment: {
            payment_due_date: 1440, // 24 jam
          },
        });

        return res.status(200).json({
          ok: true,
          success: true,
          paymentUrl: dokuRes.paymentUrl,
          invoice: {
            id: invoiceNumber,
            invoiceNumber,
            planId: plan.id,
            amountIdr: amount,
            status: 'UNPAID',
            createdAt: new Date().toISOString(),
          },
        });
      } catch (err: any) {
        console.warn('DOKU checkout API call error:', err.message);
        return res.status(200).json({
          ok: true,
          success: true,
          paymentUrl: `https://checkout.example.test/pay/${invoiceNumber}`,
          warning: 'DOKU_API_CALL_FAILED',
          detail: err?.message || String(err),
          invoice: {
            id: invoiceNumber,
            invoiceNumber,
            planId: plan.id,
            amountIdr: amount,
            status: 'UNPAID',
            createdAt: new Date().toISOString(),
          },
        });
      }
    } else {
      // Fallback dev simulator
      return res.status(200).json({
        ok: true,
        success: true,
        paymentUrl: `https://checkout.example.test/pay/${invoiceNumber}`,
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: plan.id,
          amountIdr: amount,
          status: 'UNPAID',
          createdAt: new Date().toISOString(),
        },
      });
    }
  } catch (err: any) {
    console.error('Checkout error:', err);
    return res.status(500).json({
      ok: false,
      error: 'CHECKOUT_PROCESSING_FAILED',
      detail: err?.message || String(err),
    });
  }
}
