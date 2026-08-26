/**
 * DOKU Payment Gateway Client & Helper
 *
 * Mengimplementasikan protokol integrasi DOKU Checkout / Jokul API:
 * - Pembuatan SHA-256 Digest & HMAC-SHA256 Signature
 * - Panggilan API Checkout Payment Page
 * - Verifikasi keamanan Webhook Notifikasi
 */

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
    payment_due_date: number; // Durasi dalam menit sebelum expired (misal 60)
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

export interface DokuWebhookNotification {
  service?: {
    id?: string;
  };
  order?: {
    invoice_number?: string;
    amount?: number;
    currency?: string;
  };
  transaction?: {
    status?: 'SUCCESS' | 'FAILED' | string;
    date?: string;
    original_request_id?: string;
  };
  channel?: {
    id?: string;
  };
  payment?: {
    type?: string;
  };
  [key: string]: any;
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

/**
 * Menghasilkan Digest SHA-256 (Base64) dari JSON payload request
 */
export function generateDigest(body: object | string): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHash('sha256').update(content, 'utf8').digest('base64');
}

/**
 * Menghasilkan DOKU HMAC-SHA256 Signature
 */
export function generateSignature(
  clientId: string,
  requestId: string,
  requestTimestamp: string,
  requestTarget: string,
  digest: string,
  secretKey: string
): string {
  const componentSignature = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${requestTarget}\nDigest:${digest}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(componentSignature, 'utf8');
  return `HMACSHA256=${hmac.digest('base64')}`;
}

/**
 * Memanggil API DOKU Checkout untuk mendapatkan Payment Page URL
 */
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

/**
 * Memvalidasi keaslian signature webhook yang dikirimkan oleh DOKU
 */
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

  // Gunakan timingSafeEqual untuk mencegah timing attack
  try {
    const bufA = Buffer.from(incomingSignature, 'utf8');
    const bufB = Buffer.from(expectedSignature, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
