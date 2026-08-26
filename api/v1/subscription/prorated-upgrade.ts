import { createDokuCheckout, isDokuConfigured } from '../../_doku';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { targetPlanId } = body;

    const targetPlan = {
      id: targetPlanId || 'plan-pro-monthly',
      name: 'Tier Pro',
      tierLevel: 3,
      priceIdr: 299000,
      features: ['Full POS & Multi-Outlet', 'Manajemen Stok & BOM', 'AI Analyst 90x/bln'],
    };

    const currentPlan = {
      id: 'plan-plus-monthly',
      name: 'Tier Plus',
      tierLevel: 2,
      priceIdr: 99000,
      features: ['Full POS Kasir', 'Inventori Dasar', 'AI Analyst 30x/bln'],
    };

    const remainingDays = 25;
    const diffMonth = Math.max(0, targetPlan.priceIdr - currentPlan.priceIdr);
    const proratedAmountIdr = Math.round((diffMonth / 30) * remainingDays);
    const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

    let paymentUrl = `https://checkout.example.test/pay/${invoiceNumber}`;

    if (isDokuConfigured() && proratedAmountIdr > 0) {
      try {
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'kasir.newhope.space';
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const callbackUrl = `${proto}://${host}/#settings?payment_status=success&inv=${invoiceNumber}`;

        const dokuRes = await createDokuCheckout({
          order: {
            invoice_number: invoiceNumber,
            amount: proratedAmountIdr,
            currency: 'IDR',
            callback_url: callbackUrl,
            auto_redirect: true,
            line_items: [
              {
                name: `Prorasi Upgrade ke ${targetPlan.name} (${remainingDays} hari)`,
                price: proratedAmountIdr,
                quantity: 1,
              },
            ],
          },
          payment: {
            payment_due_date: 60,
          },
        });
        paymentUrl = dokuRes.paymentUrl;
      } catch (err) {
        console.error('DOKU Proration checkout error:', err);
      }
    }

    return res.status(200).json({
      success: true,
      ok: true,
      currentPlan,
      targetPlan,
      remainingDays,
      proratedAmountIdr,
      paymentUrl,
      invoice: {
        id: invoiceNumber,
        invoiceNumber,
        amountIdr: proratedAmountIdr,
        status: 'UNPAID',
      },
    });
  } catch (err: any) {
    console.error('Prorated upgrade error:', err);
    return res.status(500).json({
      ok: false,
      error: 'PRORATION_FAILED',
      detail: err?.message || String(err),
    });
  }
}
