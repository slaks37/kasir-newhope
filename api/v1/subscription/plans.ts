import type { VercelRequest, VercelResponse } from '@vercel/node';

/*
 * Katalog paket dulu DISALIN utuh ke berkas ini — satu dari empat salinan
 * yang tersebar di dua permukaan deployment. Nilainya kebetulan masih sama;
 * yang tidak ada adalah apa pun yang menjaganya tetap begitu.
 * Sekarang satu sumber: src/data/saasPlans.ts
 */
import { SAAS_PLANS } from '../../../src/data/saasPlans';

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    plans: SAAS_PLANS,
  });
}
