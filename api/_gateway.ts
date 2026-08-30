import { createDokuCheckout, isDokuConfigured, type DokuWebhookNotification, verifyDokuWebhookSignature } from './_doku';


/*
 * Katalog paket dulu DISALIN utuh ke berkas ini — satu dari empat salinan
 * yang tersebar di dua permukaan deployment. Nilainya kebetulan masih sama;
 * yang tidak ada adalah apa pun yang menjaganya tetap begitu.
 * Sekarang satu sumber: src/data/saasPlans.ts
 */
import { SAAS_PLANS } from '../src/data/saasPlans';

/** Serverless API Handler untuk Vercel: Mendukung Gateway Proxy & Serverless Billing/DOKU secara langsung */
export async function proxyToGateway(req: any, res: any): Promise<void> {
  const base = (process.env.GATEWAY_URL || '').replace(/\/$/, '');
  const isSelf = base.includes('kasir.newhope.space') || base.includes('vercel.app');

  let requestUrl = req.url || '/';
  if (!requestUrl.startsWith('/api')) {
    requestUrl = `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`;
  }
  const cleanPath = requestUrl.split('?')[0];

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-id, x-tenant-id');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // JIKA ADA GATEWAY_URL EKSTERNAL: Teruskan request ke gateway tersebut (hanya jika bukan domain sendiri)
  if (base && !isSelf) {

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers || {})) {
      const normalized = name.toLowerCase();
      if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(normalized)) continue;
      if (typeof value === 'string') headers[name] = value;
      else if (Array.isArray(value)) headers[name] = value.join(', ');
    }

    try {
      const response = await fetch(`${base}${requestUrl}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(35_000),
      });
      response.headers.forEach((value, name) => {
        if (!['connection', 'content-encoding', 'transfer-encoding'].includes(name.toLowerCase())) {
          res.setHeader(name, value);
        }
      });
      res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
      return;
    } catch {
      // Fallback ke serverless internal jika gateway eksternal offline
    }
  }

  // ==========================================
  // SERVERLESS HANDLERS NATIVE (VERCEL ENGINE)
  // ==========================================

  // 1. Health Check
  if (cleanPath === '/api/health') {
    res.status(200).json({ ok: true, status: 'healthy', env: 'vercel-serverless', dokuConfigured: isDokuConfigured() });
    return;
  }

  // 2. Daftar Paket Langganan
  if (cleanPath === '/api/v1/subscription/plans') {
    res.status(200).json({ ok: true, plans: SAAS_PLANS });
    return;
  }

  // 3. Status Langganan Tenant
  if (cleanPath === '/api/v1/subscription/status') {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    res.status(200).json({
      ok: true,
      subscription: {
        id: 'sub-trial-active',
        tenantId: req.query?.tenantId || 'tenant-default',
        planId: 'plan-pro-monthly',
        plan: SAAS_PLANS[2],
        status: 'TRIAL',
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        trialEndsAt: periodEnd.toISOString(),
      },
      daysLeft: 90,
      invoices: [],
    });
    return;
  }

  // 4. Kalkulasi Upgrade Paket Prorasi
  if (cleanPath === '/api/v1/subscription/prorated-upgrade') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { targetPlanId } = body;
    const targetPlan = SAAS_PLANS.find((p) => p.id === targetPlanId) || SAAS_PLANS[2];
    const currentPlan = SAAS_PLANS[1]; // Tier Plus

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

    res.status(200).json({
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
    return;
  }

  // 5. DOKU Checkout Payment Flow
  if (cleanPath === '/api/v1/subscription/checkout') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { planId, targetPlanId, billingCycle } = body;
    const chosenPlanId = targetPlanId || planId || 'plan-pro-monthly';
    const selectedPlan = SAAS_PLANS.find((p) => p.id === chosenPlanId) || SAAS_PLANS[1];
    
    const isYearly = billingCycle === 'YEARLY';
    const amount = isYearly && selectedPlan.priceYearlyIdr ? selectedPlan.priceYearlyIdr * 12 : selectedPlan.priceIdr;
    const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

    if (amount === 0) {
      res.status(200).json({
        ok: true,
        success: true,
        message: 'Paket gratis aktif.',
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: selectedPlan.id,
          amountIdr: 0,
          status: 'PAID',
          paidAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (isDokuConfigured()) {
      try {
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'kasir.newhope.space';
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const callbackUrl = `${proto}://${host}/#settings?payment_status=success&inv=${invoiceNumber}`;

        const dokuRes = await createDokuCheckout({
          order: {
            invoice_number: invoiceNumber,
            amount,
            currency: 'IDR',
            callback_url: callbackUrl,
            auto_redirect: true,
            line_items: [
              {
                name: `Paket ${selectedPlan.name} (${isYearly ? 'Tahunan' : 'Bulanan'})`,
                price: amount,
                quantity: 1,
              },
            ],
          },
          payment: {
            payment_due_date: 60, // 60 Menit
          },
        });

        res.status(200).json({
          ok: true,
          success: true,
          paymentUrl: dokuRes.paymentUrl,
          invoice: {
            id: invoiceNumber,
            invoiceNumber,
            planId: selectedPlan.id,
            amountIdr: amount,
            status: 'UNPAID',
            createdAt: new Date().toISOString(),
          },
        });
        return;
      } catch (err: any) {
        console.error('DOKU API Error:', err);
        res.status(500).json({
          ok: false,
          error: 'DOKU_CHECKOUT_FAILED',
          detail: err?.message || String(err),
        });
        return;
      }
    } else {
      // Fallback dev simulator
      res.status(200).json({
        ok: true,
        success: true,
        paymentUrl: `https://checkout.example.test/pay/${invoiceNumber}`,
        invoice: {
          id: invoiceNumber,
          invoiceNumber,
          planId: selectedPlan.id,
          amountIdr: amount,
          status: 'UNPAID',
          createdAt: new Date().toISOString(),
        },
      });
      return;
    }
  }

  // 5. DOKU Webhook Notification Endpoint
  if (cleanPath === '/api/v1/webhooks/doku' || cleanPath === '/api/v1/webhooks/payment-gateway') {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const isValid = verifyDokuWebhookSignature(req.headers, rawBody, '/api/v1/webhooks/doku');
    
    // Log notifikasi
    console.log('[DOKU Webhook Notification Received]', {
      signatureValid: isValid,
      body: req.body,
    });

    res.status(200).json({ ok: true, message: 'Notification received successfully' });
    return;
  }

  // 6. Sync Catalog & Device Sync
  if (cleanPath.startsWith('/api/v1/sync')) {
    res.status(200).json({ ok: true, synced: true, message: 'Sync catalog ready' });
    return;
  }

  // Fallback untuk route API lainnya
  res.status(200).json({ ok: true, path: cleanPath, message: 'New Hope POS Serverless Engine' });
}

export default proxyToGateway;
