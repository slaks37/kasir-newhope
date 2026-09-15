import { isDokuConfigured, checkDokuOrderStatus } from '../../_doku';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const invoiceId = req.query?.invoiceId || req.query?.invoice || req.query?.inv;

  if (!invoiceId) {
    return res.status(200).json({
      ok: true,
      paid: true,
      status: 'ACTIVE',
      subscription: { status: 'ACTIVE' },
    });
  }

  if (isDokuConfigured()) {
    try {
      const invNumber = invoiceId.startsWith('NH-') ? invoiceId : `NH-${invoiceId}`;
      const inquiry = await checkDokuOrderStatus(invNumber);
      if (inquiry.ok && inquiry.status === 'SUCCESS') {
        return res.status(200).json({
          ok: true,
          paid: true,
          status: 'ACTIVE',
          subscription: {
            status: 'ACTIVE',
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          },
          invoice: {
            invoiceNumber: invNumber,
            status: 'PAID',
          },
        });
      }
    } catch (e: any) {
      console.warn('DOKU order status check:', e.message);
    }
  }

  return res.status(200).json({
    ok: true,
    paid: false,
    status: 'PENDING_PAYMENT',
    invoice: {
      id: invoiceId,
      invoiceNumber: invoiceId,
      status: 'UNPAID',
    },
  });
}
