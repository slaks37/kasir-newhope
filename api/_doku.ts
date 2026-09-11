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
  return Boolean(process.env.DOKU_CLIENT_ID && process.env.DOKU_SECRET_KEY);
}

export function getDokuClientId(): string {
  return process.env.DOKU_CLIENT_ID || '';
}

export function getDokuSecretKey(): string {
  return process.env.DOKU_SECRET_KEY || '';
}

export function getDokuApiUrl(): string {
  const url=(process.env.DOKU_API_URL || 'https://api-sandbox.doku.com').replace(/\/+$/, '');
  if(!['https://api-sandbox.doku.com','https://api.doku.com'].includes(url)) throw new Error('DOKU_API_URL_NOT_ALLOWED');
  return url;
}

export const DOKU_NOTIFICATION_PATH='/api/v1/webhooks/doku';
export function getDokuAllowedChannels(): string[] {
  const channels=(process.env.DOKU_ALLOWED_CHANNELS || '').split(',').map(x=>x.trim()).filter(Boolean);
  if(!channels.length || channels.some(x=>!/^[A-Z0-9_]{1,100}$/.test(x))) throw new Error('DOKU_CHANNEL_SCOPE_NOT_CONFIGURED');
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

  const requestId = crypto.randomUUID();
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

  return {
    paymentUrl: data.response.payment.url,
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
