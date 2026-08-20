/**
 * GET /api/v1/subscription/status
 *
 * The endpoint SubscriptionBillingTab has been calling all along. It only ever
 * existed in billing-service, so on Vercel the request fell through
 * vercel.json's catch-all rewrite, came back as index.html, and died in
 * res.json(). The catch block swallowed it — which is why settings.subscription
 * was never populated and SubscriptionLockScreen could never fire.
 *
 * The response shape mirrors billing-service exactly, including the deliberate
 * absence of a fallback: a merchant with no subscription row gets
 * `subscription: null`, never a manufactured ACTIVE one. Handing out a fake
 * active plan makes the paywall unenforceable everywhere downstream.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { resolveTenantId } from '../../_lib/tenant.js';
import {
  statusEfektif,
  langgananAktif,
  dalamTenggang,
  sisaHari,
} from '../../../src/lib/plans/expiry.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    // SSL wajib untuk database terkelola, dan mustahil untuk yang lokal —
    // Postgres di localhost menolak dengan "server does not support SSL".
    // Memaksanya membuat endpoint ini tidak bisa dijalankan atau diuji di mesin
    // sendiri sama sekali.
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\//.test(url);

    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const tenantRef = String(
    req.query?.tenantId || req.headers['x-tenant-id'] || ''
  ).trim();

  if (!tenantRef) {
    return res.status(400).json({ ok: false, error: 'TENANT_ID_REQUIRED' });
  }

  const db = getPool();

  try {
    const tenantId = await resolveTenantId(db, tenantRef);

    if (!tenantId) {
      // Not an error — there is simply nothing to bill yet.
      return res.status(200).json({
        ok: true,
        subscription: null,
        plan: null,
        invoices: [],
        daysLeft: 0,
        isActive: false,
        inGrace: false,
        reason: 'MERCHANT_BELUM_SINKRON',
      });
    }

    const subRes = await db.query(
      `SELECT s.id, s.tenant_id AS "tenantId", s.plan_id AS "planId", s.status,
              s.current_period_start AS "currentPeriodStart",
              s.current_period_end   AS "currentPeriodEnd",
              s.grace_period_end     AS "gracePeriodEnd",
              s.cancel_at_period_end AS "cancelAtPeriodEnd",
              s.canceled_at          AS "canceledAt",
              s.created_at           AS "createdAt",
              s.updated_at           AS "updatedAt",
              p.id                   AS "planCode",
              p.name                 AS "planName",
              p.tier_level           AS "tierLevel",
              p.billing_cycle        AS "billingCycle",
              p.price_idr            AS "priceIdr",
              p.price_yearly_idr     AS "priceYearlyIdr",
              p.extra_outlet_price_idr AS "extraOutletPriceIdr",
              p.currency,
              p.features,
              -- ENTITLEMENT DIBACA DARI contract.merchant_entitlements, bukan
              -- langsung dari billing.plans.
              --
              -- View itu yang menurunkan batas ke tingkat Free begitu langganan
              -- mati. Membaca paketnya langsung mengirim batas Pro kepada
              -- merchant yang sudah 30 hari tidak membayar — diuji, dan memang
              -- itu yang terjadi sebelum perbaikan ini.
              e.product_limit          AS "productLimit",
              e.max_outlets            AS "maxOutlets",
              e.ai_quota_effective     AS "aiQuotaMonthly",
              e.dashboard_access_level AS "dashboardAccessLevel",
              e.module_access          AS "moduleAccess",
              -- Nilai paketnya dibawa terpisah untuk mengajak memperpanjang:
              -- "paket Anda 5 outlet, aktifkan kembali untuk memakainya".
              e.product_limit_plan          AS "productLimitPlan",
              e.max_outlets_plan            AS "maxOutletsPlan",
              e.ai_quota_plan               AS "aiQuotaMonthlyPlan",
              e.dashboard_access_level_plan AS "dashboardAccessLevelPlan"
         FROM billing.subscriptions s
         LEFT JOIN billing.plans p ON p.id = s.plan_id
         LEFT JOIN contract.merchant_entitlements e ON e.merchant_id = s.tenant_id
        WHERE s.tenant_id = $1
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [tenantId]
    );

    if (!subRes.rows.length) {
      return res.status(200).json({
        ok: true,
        subscription: null,
        plan: null,
        invoices: [],
        daysLeft: 0,
        isActive: false,
        inGrace: false,
        reason: 'BELUM_BERLANGGANAN',
      });
    }

    const row = subRes.rows[0];
    const status = statusEfektif(row.status, row.currentPeriodEnd);

    // Entitlement ikut dikirim, bukan cuma nama dan harga. Inilah yang dipakai
    // aplikasi kasir untuk menegakkan batas produk, batas outlet, dan modul apa
    // yang boleh dibuka — jadi mengubahnya di panel admin langsung berlaku.
    const plan = row.planCode
      ? {
          id: row.planCode,
          name: row.planName,
          tierLevel: row.tierLevel,
          billingCycle: row.billingCycle,
          priceIdr: Number(row.priceIdr),
          priceYearlyIdr: row.priceYearlyIdr == null ? undefined : Number(row.priceYearlyIdr),
          extraOutletPriceIdr:
            row.extraOutletPriceIdr == null ? undefined : Number(row.extraOutletPriceIdr),
          currency: row.currency || 'IDR',
          features: row.features || [],
          productLimit: Number(row.productLimit),
          maxOutlets: Number(row.maxOutlets),
          aiQuotaMonthly: Number(row.aiQuotaMonthly),
          dashboardAccessLevel: row.dashboardAccessLevel,
          moduleAccess: row.moduleAccess ?? [],
          isActive: true,
        }
      : null;

    // Apa yang tertulis di paket, terlepas dari apakah sedang berlaku. Dipakai
    // layar langganan untuk menunjukkan apa yang hilang dan apa yang kembali
    // setelah dibayar.
    const planEntitlements = row.planCode
      ? {
          productLimit: Number(row.productLimitPlan),
          maxOutlets: Number(row.maxOutletsPlan),
          aiQuotaMonthly: Number(row.aiQuotaMonthlyPlan),
          dashboardAccessLevel: row.dashboardAccessLevelPlan,
        }
      : null;

    const invoices = await db.query(
      `SELECT i.id, i.subscription_id AS "subscriptionId", i.tenant_id AS "tenantId",
              i.amount, i.currency, i.payment_status AS "paymentStatus",
              i.payment_gateway_ref AS "paymentGatewayRef",
              i.payment_link_url AS "paymentLinkUrl",
              i.paid_at AS "paidAt", i.due_date AS "dueDate", i.created_at AS "createdAt",
              COALESCE(p.name, '-') AS "planName"
         FROM billing.invoices i
         LEFT JOIN billing.subscriptions s ON s.id = i.subscription_id
         LEFT JOIN billing.plans p ON p.id = s.plan_id
        WHERE i.tenant_id = $1
        ORDER BY i.created_at DESC
        LIMIT 24`,
      [tenantId]
    );

    const daysLeft = sisaHari(row.currentPeriodEnd);

    return res.status(200).json({
      ok: true,
      subscription: {
        id: row.id,
        tenantId: row.tenantId,
        planId: row.planId,
        status,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        gracePeriodEnd: row.gracePeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        canceledAt: row.canceledAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        plan,
      },
      plan,
      planEntitlements,
      invoices: invoices.rows,
      daysLeft,
      isActive: langgananAktif(status),
      inGrace: dalamTenggang(status),
    });
  } catch (err: any) {
    // A database failure is not the same as "not subscribed". Reporting it as
    // an error keeps the app from unlocking itself whenever the DB is down.
    console.error('[API Subscription Status Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'SUBSCRIPTION_LOOKUP_FAILED' });
  }
}
