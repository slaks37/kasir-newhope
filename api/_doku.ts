import crypto from 'node:crypto';

export interface DokuLineItem {
  name: string;
  price: number;
  quantity: number;
}

export interface DokuCheckoutPayload {
  order: {
    invoice_number: string;
    amount: number;
    currency?: string;
    callback_url?: string;
    auto_redirect?: boolean;
    line_items?: DokuLineItem[];
  };
  payment: {
    payment_method_types?: string[];
    payment_due_date: number; // Durasi dalam menit sebelum expired
  };
  customer?: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
}

export interface DokuCheckoutResponse {
  response?: {
    order?: {
      invoice_number?: string;
      amount?: number;
    };
    payment?: {
      url?: string;
      expired_date?: string;
    };
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export function isDokuConfigured(): boolean {
  const clientId = getDokuClientId();
  const secretKey = getDokuSecretKey();
  return Boolean(clientId && secretKey && !clientId.includes('sandbox_dummy'));
}

// DOKU_SANDBOX_* hanya untuk alat bukti sandbox (scripts/batch/doku-sandbox-evidence.ts),
// tidak pernah menjadi cadangan kredensial checkout.
export function getDokuClientId(): string {
  return validateDokuBrandClientId(process.env.DOKU_CLIENT_ID || '');
}

/** A Business ID belongs to the dashboard, never the Checkout gateway. */
export function validateDokuBrandClientId(value: string): string {
  const id = value.replace(/["']/g, '').trim();
  if (/^BSN-/i.test(id)) throw new Error('DOKU_BRAND_CLIENT_ID_REQUIRED');
  return id;
}

/** URL is returned by the server, never accepted from the payer. */
export function validateDokuPaymentUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('DOKU_PAYMENT_URL_INVALID'); }
  const sandbox = getDokuApiUrl() === 'https://api-sandbox.doku.com';
  const hosts = sandbox ? ['sandbox.doku.com'] : ['checkout.doku.com', 'jokul.doku.com'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) {
    throw new Error('DOKU_PAYMENT_URL_INVALID');
  }
  return url.href;
}

export function getDokuSecretKey(): string {
  return (process.env.DOKU_SECRET_KEY || '').replace(/["']/g, '').trim();
}

const DOKU_API_URLS = new Set(['https://api.doku.com', 'https://api-sandbox.doku.com']);

/** Hanya dua host resmi. Salah ketik tidak boleh diam-diam mengarah ke produksi. */
export function getDokuApiUrl(): string {
  const raw = (process.env.DOKU_API_URL || 'https://api.doku.com').replace(/["']/g, '').trim().replace(/\/+$/, '');
  if (!DOKU_API_URLS.has(raw)) throw new Error('DOKU_API_URL_NOT_ALLOWED');
  return raw;
}

export const DOKU_NOTIFICATION_PATH = '/api/v1/webhooks/doku';
export function getDokuAllowedChannels(): string[] {
  const raw = (process.env.DOKU_ALLOWED_CHANNELS || '').replace(/["']/g, '').trim();
  const channels = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (!channels.length || channels.some((x) => !/^[A-Z0-9_]{1,100}$/.test(x))) {
    throw new Error('DOKU_CHANNEL_SCOPE_NOT_CONFIGURED');
  }
  return [...new Set(channels)];
}

export function generateDigest(body: object | string): string {
  const content = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  return crypto.createHash('sha256').update(content).digest('base64');
}

export function generateSignature(
  clientId: string,
  requestId: string,
  requestTimestamp: string,
  requestTarget: string,
  digest: string,
  secretKey: string
): string {
  const componentSignature = `Client-Id:${clientId}\n` +
    `Request-Id:${requestId}\n` +
    `Request-Timestamp:${requestTimestamp}\n` +
    `Request-Target:${requestTarget}\n` +
    `Digest:${digest}`;

  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(componentSignature, 'utf8');
  const hmacBase64 = hmac.digest('base64');

  return `HMACSHA256=${hmacBase64}`;
}

export function generateGetSignature(
  clientId: string,
  requestId: string,
  requestTimestamp: string,
  requestTarget: string,
  secretKey: string
): string {
  const componentSignature = `Client-Id:${clientId}\n` +
    `Request-Id:${requestId}\n` +
    `Request-Timestamp:${requestTimestamp}\n` +
    `Request-Target:${requestTarget}`;

  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(componentSignature, 'utf8');
  const hmacBase64 = hmac.digest('base64');

  return `HMACSHA256=${hmacBase64}`;
}

export async function createDokuCheckout(payload: DokuCheckoutPayload): Promise<{
  paymentUrl: string;
  rawResponse: DokuCheckoutResponse;
}> {
  const clientId = getDokuClientId();
  const secretKey = getDokuSecretKey();
  const apiUrl = getDokuApiUrl();

  if (!clientId || !secretKey) {
    throw new Error('DOKU_CREDENTIALS_NOT_CONFIGURED');
  }

  const requestId = payload.order.invoice_number;
  const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';
  const requestTarget = '/checkout/v1/payment';
  const digest = generateDigest(payload);
  const signature = generateSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    digest,
    secretKey
  );

  const response = await fetch(`${apiUrl}${requestTarget}`, {
    method: 'POST',
    redirect: 'error',
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

  const data = (await response.json()) as DokuCheckoutResponse;

  if (!response.ok || !data.response?.payment?.url) {
    // Provider bodies can contain customer data and payment tokens.
    throw new Error(`DOKU_API_ERROR_HTTP_${response.status}`);
  }

  const echoed = data.response.order;
  if (echoed && (echoed.invoice_number !== payload.order.invoice_number || Number(echoed.amount) !== payload.order.amount)) {
    throw new Error('DOKU_CHECKOUT_ORDER_MISMATCH');
  }
  return {
    paymentUrl: validateDokuPaymentUrl(data.response.payment.url),
    rawResponse: data,
  };
}

export interface DokuOrderStatusResponse {
  ok: boolean;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED' | 'UNKNOWN';
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  transactionId?: string;
  channelId?: string;
  rawResponse?: any;
}

export async function checkDokuOrderStatus(invoiceNumber: string): Promise<DokuOrderStatusResponse> {
  const clientId = getDokuClientId();
  const secretKey = getDokuSecretKey();
  const apiUrl = getDokuApiUrl();

  if (!clientId || !secretKey) {
    throw new Error('DOKU_CREDENTIALS_NOT_CONFIGURED');
  }

  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(invoiceNumber)) throw new Error('DOKU_INVOICE_INVALID');
  const requestTarget = `/orders/v1/status/${encodeURIComponent(invoiceNumber)}`;
  const signature = generateGetSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    secretKey
  );

  const response = await fetch(`${apiUrl}${requestTarget}`, {
    method: 'GET',
    redirect: 'error',
    headers: {
      'Client-Id': clientId,
      'Request-Id': requestId,
      'Request-Timestamp': requestTimestamp,
      'Signature': signature,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return { ok: false, status: 'UNKNOWN' };
    }
    throw new Error(`DOKU_STATUS_INQUIRY_HTTP_${response.status}`);
  }

  const data = (await response.json()) as any;
  const txStatus = String(data?.transaction?.status || data?.order?.status || '').toUpperCase();
  const status: DokuOrderStatusResponse['status'] =
    ['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'].includes(txStatus) ? txStatus as DokuOrderStatusResponse['status'] :
    txStatus === 'ORDER_EXPIRED' ? 'EXPIRED' :
    ['PENDING', 'WAITING', 'ORDER_GENERATED'].includes(txStatus) ? 'PENDING' : 'UNKNOWN';
  const rawAmount = data?.order?.amount;
  const amount = ['string','number'].includes(typeof rawAmount) && /^\d+(?:\.0{1,2})?$/.test(String(rawAmount)) && Number.isSafeInteger(Number(rawAmount)) ? Number(rawAmount) : undefined;

  return {
    ok: true,
    status,
    invoiceNumber: typeof data?.order?.invoice_number === 'string' ? data.order.invoice_number : undefined,
    amount,
    currency: data?.order?.currency === undefined ? 'IDR' : String(data.order.currency),
    transactionId: data?.transaction?.original_request_id || data?.transaction?.reference_id,
    channelId: data?.channel?.id,
    rawResponse: data,
  };
}

export function verifyDokuWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string | Buffer,
  requestTarget: string,
  now = Date.now()
): boolean {
  const secretKey = getDokuSecretKey();
  if (!secretKey) return false;

  const getHeader = (key: string): string => {
    const matches=Object.entries(headers).filter(([name])=>name.toLowerCase()===key.toLowerCase());
    if(matches.length!==1)return '';
    const val = matches[0][1];
    if (Array.isArray(val)) return '';
    return typeof val === 'string' ? val : '';
  };

  const clientId = getHeader('Client-Id');
  const requestId = getHeader('Request-Id');
  const requestTimestamp = getHeader('Request-Timestamp');
  const incomingSignature = getHeader('Signature');

  if (!clientId || clientId !== getDokuClientId() || !requestId || !requestTimestamp || !incomingSignature) {
    return false;
  }

  if(!/^[\x21-\x7e]{1,128}$/.test(requestId) || requestId.includes(','))return false;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(requestTimestamp))return false;
  const time=Date.parse(requestTimestamp);
  if(!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z','Z')!==requestTimestamp.replace('.000Z','Z'))return false;
  // Local replay policy: 13h accommodates DOKU's documented final retry at
  // 12h plus clock/delivery allowance. Confirm older manual retries with DOKU.
  if(time>now+5*60_000 || now-time>13*60*60_000)return false;

  const digest = generateDigest(rawBody);
  const expectedSignature = generateSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    digest,
    secretKey
  );

  try {
    const bufA = Buffer.from(incomingSignature, 'utf8');
    const bufB = Buffer.from(expectedSignature, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
