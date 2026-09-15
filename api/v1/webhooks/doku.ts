import { verifyDokuWebhookSignature } from '../../_doku';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Client-Id, Request-Id, Request-Timestamp, Signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const isValid = verifyDokuWebhookSignature(req.headers, rawBody, '/api/v1/webhooks/doku');

  console.log('[DOKU Serverless Webhook Received]', {
    isValid,
    body: req.body,
  });

  return res.status(200).json({
    ok: true,
    message: 'Webhook processed successfully',
  });
}
