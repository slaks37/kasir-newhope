import { createDokuCheckout, isDokuConfigured } from '../../_doku';
import { SAAS_PLANS, annualTotal } from '../../../src/config/saasPlans';

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
    const selectedPlan = SAAS_PLANS.find((p) => p.id === chosenPlanId) || SAAS_PLANS[1];

    const isYearly = billingCycle === 'YEARLY';
    const basePrice = isYearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr;
    const extraOutletsCount = Math.max(0, Number(extraOutlets) || 0);
    const outletPrice = isYearly
      ? (selectedPlan.extraOutletYearlyIdr || 760320) * extraOutletsCount
      : (selectedPlan.extraOutletPriceIdr || 79200) * extraOutletsCount;

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
      const origin = process.env.PUBLIC_APP_URL || `${proto}://${host}`;
      const callbackUrl = `${origin.replace(/\/$/, '')}/#payment?invoice=${invoiceNumber}`;

      const dokuRes = await createDokuCheckout({
        order: {
          invoice_number: invoiceNumber,
          amount,
          currency: 'IDR',
          callback_url: callbackUrl,
          auto_redirect: true,
          line_items: [
            {
              name: `Paket ${selectedPlan.name} (${isYearly ? 'Tahunan' : 'Bulanan'})` + (extraOutletsCount > 0 ? ` + ${extraOutletsCount} Outlet` : ''),
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
          planId: selectedPlan.id,
          amountIdr: amount,
          status: 'UNPAID',
          createdAt: new Date().toISOString(),
        },
      });
    } else {
      // Fallback response bila kredensial DOKU belum dikonfigurasi
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
