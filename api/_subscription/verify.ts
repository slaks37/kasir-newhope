import crypto from 'crypto';

function sendJson(res: any, status: number, data: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');
    res.setHeader('Content-Type', 'application/json');
  } catch {}

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

function getDokuCredentials() {
  const clientId = (process.env.DOKU_CLIENT_ID || process.env.DOKU_SANDBOX_CLIENT_ID || '').replace(/["']/g, '').trim();
  const secretKey = (process.env.DOKU_SECRET_KEY || process.env.DOKU_SANDBOX_SECRET_KEY || '').replace(/["']/g, '').trim();
  const rawUrl = (process.env.DOKU_API_URL || 'https://api.doku.com').replace(/["']/g, '').trim().replace(/\/+$/, '');
  const apiUrl = rawUrl.includes('sandbox') ? 'https://api-sandbox.doku.com' : 'https://api.doku.com';
  const isConfigured = Boolean(clientId && secretKey && !clientId.includes('sandbox_dummy'));
  return { clientId, secretKey, apiUrl, isConfigured };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const invoiceId = req.query?.invoiceId || req.query?.invoice || req.query?.inv;

  if (!invoiceId) {
    return sendJson(res, 200, {
      ok: true,
      paid: false,
      status: 'PENDING_PAYMENT',
      subscription: { status: 'PENDING_PAYMENT', accessMode: 'RESTRICTED' },
      message: 'INVOICE_REQUIRED',
    });
  }

  const { clientId, secretKey, apiUrl, isConfigured } = getDokuCredentials();

  if (isConfigured) {
    try {
      const invNumber = String(invoiceId).startsWith('NH-') ? String(invoiceId) : `NH-${invoiceId}`;
      const requestId = crypto.randomUUID();
      const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';
      const requestTarget = `/orders/v1/status/${invNumber}`;
      const componentSignature = `Client-Id:${clientId}\n` +
        `Request-Id:${requestId}\n` +
        `Request-Timestamp:${requestTimestamp}\n` +
        `Request-Target:${requestTarget}`;
      const hmac = crypto.createHmac('sha256', secretKey);
      hmac.update(componentSignature, 'utf8');
      const signature = `HMACSHA256=${hmac.digest('base64')}`;

      const response = await fetch(`${apiUrl}${requestTarget}`, {
        method: 'GET',
        headers: {
          'Client-Id': clientId,
          'Request-Id': requestId,
          'Request-Timestamp': requestTimestamp,
          'Signature': signature,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const data: any = await response.json().catch(() => ({}));
        const txStatus = String(data?.transaction?.status || data?.order?.status || '').toUpperCase();
        if (txStatus === 'SUCCESS') {
          return sendJson(res, 200, {
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
      }
    } catch (e: any) {
      console.warn('DOKU order status check error:', e.message);
    }
  }

  return sendJson(res, 200, {
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
