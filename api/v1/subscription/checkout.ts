import { createDokuCheckout, isDokuConfigured } from '../../_doku';

const SAAS_PLANS = [
  {
    id: 'plan-free',
    name: 'Free Tier',
    tierLevel: 1,
    billingCycle: 'MONTHLY',
    priceIdr: 0,
    currency: 'IDR',
  },
  {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    billingCycle: 'MONTHLY',
    priceIdr: 99000,
    priceYearlyIdr: 79000,
    currency: 'IDR',
  },
  {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    billingCycle: 'MONTHLY',
    priceIdr: 299000,
    priceYearlyIdr: 239000,
    currency: 'IDR',
  },
];

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { planId, targetPlanId, billingCycle } = body;
    const chosenPlanId = targetPlanId || planId || 'plan-plus-monthly';
    const selectedPlan = SAAS_PLANS.find((p) => p.id === chosenPlanId) || SAAS_PLANS[1];

    const isYearly = billingCycle === 'YEARLY';
    const amount = isYearly && selectedPlan.priceYearlyIdr ? selectedPlan.priceYearlyIdr * 12 : selectedPlan.priceIdr;
    const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

    if (amount === 0) {
      return res.status(200).json({
        ok: true,
        success: true,
        message: 'Paket gratis berhasil diaktifkan.',
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: selectedPlan.id,
          amountIdr: 0,
          status: 'PAID',
          paidAt: new Date().toISOString(),
        },
      });
    }

    if (isDokuConfigured()) {
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'kasir.newhope.space';
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const callbackUrl = `${proto}://${host}/#settings?payment_status=success&inv=${invoiceNumber}`;

      const dokuRes = await createDokuCheckout({
        order: {
          invoice_number: invoiceNumber,
          amount,
          currency: 'IDR',
          callback_url: callbackUrl,
          auto_redirect: true,
          line_items: [
            {
              name: `Paket ${selectedPlan.name} (${isYearly ? 'Tahunan' : 'Bulanan'})`,
              price: amount,
              quantity: 1,
            },
          ],
        },
        payment: {
          payment_due_date: 60, // 60 menit
        },
      });

      return res.status(200).json({
        ok: true,
        success: true,
        paymentUrl: dokuRes.paymentUrl,
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: selectedPlan.id,
          amountIdr: amount,
          status: 'UNPAID',
          createdAt: new Date().toISOString(),
        },
      });
    } else {
      // Fallback dev simulator
      return res.status(200).json({
        ok: true,
        success: true,
        paymentUrl: `https://checkout.example.test/pay/${invoiceNumber}`,
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: selectedPlan.id,
          amountIdr: amount,
          status: 'UNPAID',
          createdAt: new Date().toISOString(),
        },
      });
    }
  } catch (err: any) {
    console.error('DOKU Checkout error:', err);
    return res.status(500).json({
      ok: false,
      error: 'DOKU_CHECKOUT_FAILED',
      detail: err?.message || String(err),
    });
  }
}
