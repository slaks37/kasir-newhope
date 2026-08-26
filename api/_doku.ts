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
  return (process.env.DOKU_API_URL || 'https://api-sandbox.doku.com').replace(/\/+$/, '');
}

export function generateDigest(body: object | string): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHash('sha256').update(content, 'utf8').digest('base64');
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
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Request-Id': requestId,
      'Request-Timestamp': requestTimestamp,
      'Signature': signature,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as DokuCheckoutResponse;

  if (!response.ok || !data.response?.payment?.url) {
    const errorMsg = data.error?.message || `HTTP ${response.status}: ${JSON.stringify(data)}`;
    throw new Error(`DOKU_API_ERROR: ${errorMsg}`);
  }

  return {
    paymentUrl: data.response.payment.url,
    rawResponse: data,
  };
}

export function verifyDokuWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string | Buffer,
  requestTarget: string
): boolean {
  const secretKey = getDokuSecretKey();
  if (!secretKey) return false;

  const getHeader = (key: string): string => {
    const val = headers[key.toLowerCase()] || headers[key];
    if (Array.isArray(val)) return val[0] || '';
    return typeof val === 'string' ? val : '';
  };

  const clientId = getHeader('Client-Id');
  const requestId = getHeader('Request-Id');
  const requestTimestamp = getHeader('Request-Timestamp');
  const incomingSignature = getHeader('Signature');

  if (!clientId || !requestId || !requestTimestamp || !incomingSignature) {
    return false;
  }

  const rawString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const digest = generateDigest(rawString);
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
