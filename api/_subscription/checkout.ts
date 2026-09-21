import crypto from 'crypto';

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

function sendJson(res: any, status: number, data: any) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

function getDokuCredentials() {
  const clientId = (process.env.DOKU_CLIENT_ID || process.env.DOKU_SANDBOX_CLIENT_ID || '').replace(/["']/g, '').trim();
  const secretKey = (process.env.DOKU_SECRET_KEY || process.env.DOKU_SANDBOX_SECRET_KEY || '').replace(/["']/g, '').trim();
  const rawUrl = (process.env.DOKU_API_URL || 'https://api.doku.com').replace(/["']/g, '').trim().replace(/\/+$/, '');
  const apiUrl = rawUrl.includes('sandbox') ? 'https://api-sandbox.doku.com' : 'https://api.doku.com';
  const isConfigured = Boolean(clientId && secretKey && !clientId.includes('sandbox_dummy'));
  return { clientId, secretKey, apiUrl, isConfigured };
}

function generateDigest(body: object | string): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHash('sha256').update(content, 'utf8').digest('base64');
}

function generateSignature(clientId: string, requestId: string, requestTimestamp: string, requestTarget: string, digest: string, secretKey: string): string {
  const componentSignature = `Client-Id:${clientId}\n` +
    `Request-Id:${requestId}\n` +
    `Request-Timestamp:${requestTimestamp}\n` +
    `Request-Target:${requestTarget}\n` +
    `Digest:${digest}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(componentSignature, 'utf8');
  return `HMACSHA256=${hmac.digest('base64')}`;
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

    const amount = basePrice + outletPrice;
    const invoiceNumber = `NH-${Date.now().toString().slice(-8)}`;

    if (amount === 0) {
      return sendJson(res, 200, {
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

    const { clientId, secretKey, apiUrl, isConfigured } = getDokuCredentials();

    if (!isConfigured) {
      if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_MOCK_CHECKOUT === '1' || process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1') {
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const origin = (process.env.PUBLIC_APP_URL || `${proto}://${host}`).replace(/["']/g, '').trim();
        const callbackUrl = `${origin.replace(/\/$/, '')}/#payment?invoice=${invoiceNumber}`;
        return sendJson(res, 200, {
          ok: true,
          success: true,
          paymentUrl: callbackUrl,
          invoice: {
            id: invoiceNumber,
            invoiceNumber,
            planId: plan.id,
            amountIdr: amount,
            status: 'UNPAID',
            createdAt: new Date().toISOString(),
          },
          mockPayment: true,
        });
      }

      return sendJson(res, 200, {
        ok: false,
        error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
        message: 'Kredensial DOKU belum terdeteksi di Vercel Environment Variables. Pastikan DOKU_CLIENT_ID (dari API Key DOKU) dan DOKU_SECRET_KEY (dari Active Secret Key DOKU) sudah ditambahkan di Vercel Project Settings > Environment Variables (centang opsi Production) lalu lakukan Redeploy.',
        debug: {
          hasClientId: Boolean(clientId),
          hasSecretKey: Boolean(secretKey),
          apiUrl,
        },
      });
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'kasir.newhope.space';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const origin = (process.env.PUBLIC_APP_URL || `${proto}://${host}`).replace(/["']/g, '').trim();
    const callbackUrl = `${origin.replace(/\/$/, '')}/#payment?invoice=${invoiceNumber}`;

    const payload = {
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
        payment_due_date: 1440,
      },
    };

    try {
      const requestId = crypto.randomUUID();
      const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';
      const requestTarget = '/checkout/v1/payment';
      const digest = generateDigest(payload);
      const signature = generateSignature(clientId, requestId, requestTimestamp, requestTarget, digest, secretKey);

      const dokuResponse = await fetch(`${apiUrl}${requestTarget}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': clientId,
          'Request-Id': requestId,
          'Request-Timestamp': requestTimestamp,
          'Signature': signature,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      const data: any = await dokuResponse.json().catch(() => ({}));

      if (dokuResponse.ok && data?.response?.payment?.url) {
        return sendJson(res, 200, {
          ok: true,
          success: true,
          paymentUrl: data.response.payment.url,
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

      // If DOKU API returned an error response
      const errorMessage = data?.error?.message || data?.message || (Array.isArray(data?.error) ? data.error.join(', ') : `DOKU API Error (HTTP ${dokuResponse.status})`);
      const maskedClient = clientId.length > 8 ? `${clientId.slice(0, 4)}...${clientId.slice(-4)}` : clientId;
      console.warn('DOKU API error response:', data);

      return sendJson(res, 200, {
        ok: false,
        error: 'DOKU_API_ERROR',
        message: `Gagal membuat pembayaran di DOKU: ${errorMessage} (Target: ${apiUrl}, Client-ID: ${maskedClient})`,
        details: data,
        httpStatus: dokuResponse.status,
      });
    } catch (fetchErr: any) {
      console.warn('DOKU fetch error:', fetchErr.message);
      return sendJson(res, 200, {
        ok: false,
        error: 'DOKU_CONNECTION_ERROR',
        message: `Tidak dapat terhubung ke server DOKU: ${fetchErr.message}. Target URL: ${apiUrl}.`,
      });
    }
  } catch (err: any) {
    console.error('Server error in checkout handler:', err);
    return sendJson(res, 200, {
      ok: false,
      error: 'SERVER_ERROR',
      message: `Terjadi kendala pada server checkout: ${err.message}`,
    });
  }
}
