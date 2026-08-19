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

const DAY_MS = 86_400_000;
const GRACE_DAYS = 3;

/**
 * Expiry is COMPUTED, never stored — same rule as billing-service.
 *
 * Storing it needs a cron that flips the status on time. A cron that runs a
 * minute late lets an expired merchant keep selling; one that dies overnight
 * leaves everyone active in the morning. Deriving it from current_period_end
 * is always right and needs no moving parts.
 */
function effectiveStatus(status: string, periodEnd: string | null): string {
  if (status === 'CANCELED') return 'CANCELED';
  if (!periodEnd) return status;

  const end = new Date(periodEnd).getTime();
  const now = Date.now();
  if (now <= end) return status;
  if (now <= end + GRACE_DAYS * DAY_MS) return 'PAST_DUE';
  return 'EXPIRED';
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
    // Resolved the same way services/shared/identity.ts does it: the business
    // unit key first, then the account ref, and only when that account owns
    // exactly one unit. Guessing between a café and a laundry would report one
    // shop's subscription on the other's screen.
    const tenant = await db.query(
      `SELECT merchant_id FROM contract.merchant_directory
        WHERE business_id = $1
           OR (owner_user_ref = $1 AND (SELECT COUNT(*) FROM contract.merchant_directory
                                         WHERE owner_user_ref = $1) = 1)
        LIMIT 1`,
      [tenantRef]
    );

    if (!tenant.rows.length) {
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

    const tenantId = tenant.rows[0].merchant_id;

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
              p.product_limit          AS "productLimit",
              p.max_outlets            AS "maxOutlets",
              p.ai_quota_monthly       AS "aiQuotaMonthly",
              p.dashboard_access_level AS "dashboardAccessLevel",
              p.module_access          AS "moduleAccess"
         FROM billing.subscriptions s
         LEFT JOIN billing.plans p ON p.id = s.plan_id
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
    const status = effectiveStatus(row.status, row.currentPeriodEnd);

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

    // Floored, so "0 hari lagi" means the period ends today rather than
    // rounding a few remaining hours up into a whole day of access.
    const daysLeft = row.currentPeriodEnd
      ? Math.max(
          0,
          Math.floor((new Date(row.currentPeriodEnd).getTime() - Date.now()) / DAY_MS)
        )
      : 0;

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
      invoices: invoices.rows,
      daysLeft,
      isActive: status === 'ACTIVE' || status === 'TRIAL',
      inGrace: status === 'PAST_DUE',
    });
  } catch (err: any) {
    // A database failure is not the same as "not subscribed". Reporting it as
    // an error keeps the app from unlocking itself whenever the DB is down.
    console.error('[API Subscription Status Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'SUBSCRIPTION_LOOKUP_FAILED' });
  }
}
