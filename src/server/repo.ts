/**
 * Query yang dipakai admin panel.
 *
 * Semua SQL tinggal di sini, bukan di route handler. Alasannya bukan kerapian:
 * kalau setiap handler menyusun agregatnya sendiri, cepat atau lambat halaman
 * "Ringkasan" dan halaman "Merchant" akan menghitung omzet dengan cara yang
 * sedikit berbeda, dan tidak akan ada yang tahu angka mana yang benar.
 *
 * ATURAN KEAMANAN, tanpa pengecualian: setiap nilai dari luar masuk lewat
 * parameter $1/$2. Satu-satunya bagian yang pernah dirangkai jadi string adalah
 * arah pengurutan, dan itu pun dipetakan dari daftar tertutup.
 */

import type { Db } from '../../services/shared/db';
import { subscriptionAccess } from '../config/subscriptionPolicy';
import { findSaaSPlan, DAY_MS, TRIAL_DAYS } from '../config/saasPlans';

function withSubscription(row:any) {
  const end=row.current_period_end || new Date(Date.parse(row.joined_at)+TRIAL_DAYS*DAY_MS);
  const state=subscriptionAccess({status:row.is_active?(row.raw_status || 'TRIAL'):'EXPIRED',currentPeriodEnd:new Date(end).toISOString(),gracePeriodEnd:row.grace_period_end?new Date(row.grace_period_end).toISOString():undefined});
  return {...row,subscription_status:state.status,access_mode:state.accessMode,plan_name:findSaaSPlan(row.plan_id)?.name || 'Trial 45 Hari'};
}

export const SECTORS = ['FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP'] as const;
export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABEL: Record<Sector, string> = {
  FNB: 'Kafe, Resto & F&B',
  LAUNDRY: 'Laundry Kiloan & Satuan',
  RETAIL: 'Ritel, Toko & Minimarket',
  CARWASH: 'Cuci Mobil & Motor',
  BARBERSHOP: 'Barbershop & Salon',
};

export const APP_MODULES = [
  'POS', 'TABLES', 'INVENTORY', 'CUSTOMERS', 'REPORTS', 'AI', 'SETTINGS', 'SYNC', 'AUTH',
] as const;

export const SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] as const;

/** Mengembalikan nilai hanya kalau ada di daftar yang diizinkan. */
function pick<T extends string>(allowed: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export interface ListFilter {
  sector?: unknown;
  tenantId?: unknown;
  merchantId?: unknown;
  outletId?: unknown;
  timezone?: unknown;
  module?: unknown;
  severity?: unknown;
  search?: unknown;
  from?: unknown;
  to?: unknown;
  limit?: unknown;
  offset?: unknown;
}

interface Clean {
  sector: Sector | null;
  merchantId: string | null;
  module: string | null;
  severity: string | null;
  search: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanFilter(f: ListFilter = {}): Clean {
  const rawLimit = Number(f.limit);
  const rawOffset = Number(f.offset);
  return {
    sector: pick(SECTORS, f.sector),
    // UUID divalidasi bentuknya lebih dulu. Kalau tidak, id ngawur akan sampai
    // ke Postgres dan meledak sebagai error 500 dengan pesan internal, bukan
    // sebagai 400 yang sopan.
    merchantId: typeof f.merchantId === 'string' && UUID_RE.test(f.merchantId) ? f.merchantId : null,
    module: pick(APP_MODULES, f.module),
    severity: pick(SEVERITIES, f.severity),
    search: typeof f.search === 'string' && f.search.trim() ? f.search.trim().slice(0, 80) : null,
    from: typeof f.from === 'string' && DATE_RE.test(f.from) ? f.from : null,
    to: typeof f.to === 'string' && DATE_RE.test(f.to) ? f.to : null,
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50,
    offset: Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0,
  };
}

/** Perakit WHERE bertahap yang menjaga nomor parameter tetap sinkron. */
class Where {
  private parts: string[] = [];
  readonly params: unknown[] = [];

  add(fragment: (p: string) => string, value: unknown): this {
    if (value === null || value === undefined) return this;
    this.params.push(value);
    this.parts.push(fragment(`$${this.params.length}`));
    return this;
  }

  raw(fragment: string): this {
    this.parts.push(fragment);
    return this;
  }

  sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }

  next(): string {
    return `$${this.params.length + 1}`;
  }
}

/* -------------------------------------------------------------------------- */
/* RINGKASAN PLATFORM                                                          */
/* -------------------------------------------------------------------------- */

export async function sectorSummary(db: Db) {
  // LEFT JOIN dari daftar sektor, bukan langsung dari view: sektor yang belum
  // punya transaksi sama sekali harus tetap muncul sebagai baris nol, bukan
  // menghilang. Sektor yang hilang dari layar terbaca seperti "tidak ada
  // masalah" padahal artinya "tidak ada yang memakai".
  const { rows } = await db.query(
    `
    SELECT s.sector                                   AS business_sector,
           COALESCE(v.merchant_count, 0)::int         AS merchant_count,
           COALESCE(m.registered_merchants, 0)::int   AS business_unit_count,
           COALESCE(m.active_outlet_count, 0)::int    AS active_outlet_count,
           COALESCE(v.transaction_count, 0)::int      AS transaction_count,
           COALESCE(v.gross_revenue, 0)               AS gross_revenue,
           COALESCE(v.avg_basket, 0)                  AS avg_basket,
           COALESCE(v.total_discount, 0)              AS total_discount,
           v.last_transaction_at,
           COALESCE(m.registered_merchants, 0)::int   AS registered_merchants
      FROM unnest($1::text[]) AS s(sector)
      LEFT JOIN contract.admin_sector_summary v ON v.business_sector = s.sector
      LEFT JOIN (
            SELECT business_sector, COUNT(*) AS registered_merchants,
                   COALESCE(SUM(outlet_count),0) AS active_outlet_count
              FROM contract.merchant_directory GROUP BY business_sector
           ) m ON m.business_sector = s.sector
     ORDER BY COALESCE(v.gross_revenue, 0) DESC, s.sector
    `,
    [SECTORS as unknown as string[]]
  );
  return rows;
}

export async function platformTotals(db: Db) {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM contract.merchant_directory)::int                AS merchants,
      (SELECT COUNT(*) FROM contract.merchant_directory WHERE is_active)::int AS merchants_active,
      (SELECT COUNT(*) FROM contract.merchant_revenue)::int                  AS transactions,
      (SELECT COALESCE(SUM(total_amount), 0) FROM contract.merchant_revenue) AS gross_revenue,
      (SELECT COALESCE(SUM(total_amount-net_tax_amount-cogs_amount),0) FROM contract.merchant_revenue) AS gross_profit,
      (SELECT COUNT(*) FROM contract.admin_activity_log)::int                      AS activity_events,
      (SELECT COUNT(*) FROM contract.admin_activity_log
        WHERE severity IN ('WARNING','CRITICAL'))::int                       AS activity_problems,
      (SELECT COUNT(DISTINCT business_sector) FROM contract.merchant_directory)::int AS sectors_in_use
  `);
  return rows[0];
}

/** Omzet harian per sektor untuk grafik. Rentang dibatasi agar respons terikat. */
export async function dailyRevenue(db: Db, days = 30) {
  const n = Math.min(Math.max(Math.trunc(Number(days) || 30), 1), 180);
  const { rows } = await db.query(
    `SELECT business_sector, sales_date, transaction_count::int, gross_revenue, active_merchants::int
       FROM contract.admin_daily_sector_revenue
      WHERE sales_date >= (CURRENT_DATE - ($1::int - 1))
      ORDER BY sales_date, business_sector`,
    [n]
  );
  return rows;
}

/* -------------------------------------------------------------------------- */
/* MERCHANT                                                                    */
/* -------------------------------------------------------------------------- */

export async function merchantDirectory(db: Db, f: ListFilter = {}, financialDetail=true) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `d.business_sector = ${p}`, c.sector);
  w.add((p) => `d.merchant_name ILIKE ${p}`, c.search ? `%${c.search}%` : null);

  const { rows } = await db.query(
    `SELECT d.*, h.churn_risk_score, h.days_since_last_txn,s.status AS raw_status,s.plan_id,s.current_period_end,s.grace_period_end,
       r.transaction_count,r.gross_revenue,r.last_transaction_at,
       (SELECT count(*)::int FROM internal.outlets WHERE merchant_id=d.merchant_id AND is_active) AS outlet_count,
       (SELECT COALESCE(sum(total_amount-net_tax_amount-cogs_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id AND tenant_id=d.tenant_id) AS gross_profit
       FROM contract.merchant_directory d
       LEFT JOIN contract.merchant_health_latest h ON h.merchant_id = d.merchant_id
       LEFT JOIN billing.subscriptions s ON s.tenant_id=d.tenant_id
       LEFT JOIN LATERAL (SELECT count(*)::int AS transaction_count,COALESCE(sum(total_amount),0) AS gross_revenue,max(created_at) AS last_transaction_at
         FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) r ON true
       ${w.sql()}
      ORDER BY d.merchant_name,d.merchant_id
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.merchant_directory d ${w.sql()}`,
    w.params
  );
  return { rows:rows.map(withSubscription).map(r=>financialDetail?r:{merchant_id:r.merchant_id,merchant_name:r.merchant_name,
    business_sector:r.business_sector,is_active:r.is_active,joined_at:r.joined_at,subscription_status:r.subscription_status,
    access_mode:r.access_mode,plan_name:r.plan_name,churn_risk_score:r.churn_risk_score,days_since_last_txn:r.days_since_last_txn}),
    financialDetail,total: cnt[0]?.total ?? 0, limit: c.limit, offset: c.offset };
}

export async function merchantDetail(db: Db, merchantId: string) {
  if (!UUID_RE.test(merchantId)) return null;

  const [profile, bySector, health, topProducts, customerStats] = await Promise.all([
    db.query(`SELECT d.*,s.status AS raw_status,s.plan_id,s.current_period_end,s.grace_period_end,
      (SELECT COALESCE(sum(cogs_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS cogs,
      (SELECT COALESCE(sum(total_amount-net_tax_amount-cogs_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS gross_profit,
      (SELECT COALESCE(sum(net_discount_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS discount_amount,
      (SELECT COALESCE(sum(net_tax_amount),0) FROM contract.merchant_revenue WHERE merchant_id=d.merchant_id) AS tax_amount
      FROM contract.merchant_directory d LEFT JOIN billing.subscriptions s ON s.tenant_id=d.tenant_id WHERE d.merchant_id = $1`, [merchantId]),
    // Satu merchant bisa menjalankan lebih dari satu sektor.
    db.query(
      `SELECT business_sector,
              COUNT(*)::int                     AS transaction_count,
              COALESCE(SUM(total_amount), 0)    AS gross_revenue,
              COALESCE(AVG(total_amount), 0)    AS avg_basket,
              MAX(created_at)                   AS last_transaction_at
         FROM contract.merchant_revenue
        WHERE merchant_id = $1
        GROUP BY business_sector
        ORDER BY gross_revenue DESC`,
      [merchantId]
    ),
    db.query(`SELECT * FROM contract.merchant_health_latest WHERE merchant_id = $1`, [merchantId]),
    db.query(
      `SELECT business_sector, product_name, category_name,
              units_sold_exact AS units_sold, revenue, gross_profit, last_sold_at
         FROM contract.admin_product_sales
        WHERE merchant_id = $1
        ORDER BY revenue DESC
        LIMIT 15`,
      [merchantId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS customer_count
         FROM pos.customers
        WHERE merchant_id = $1 AND archived_at IS NULL`,
      [merchantId]
    ).catch(() => ({ rows: [{ customer_count: 0, total_customer_spent: 0 }] })),
  ]);

  if (!profile.rows.length) return null;
  return {
    profile: {
      ...withSubscription(profile.rows[0]),
      gross_revenue: bySector.rows.reduce((sum, r) => sum + Number(r.gross_revenue), 0),
      transaction_count: bySector.rows.reduce((sum, r) => sum + Number(r.transaction_count), 0),
      customer_count: Number(customerStats.rows[0]?.customer_count || 0),
    },
    sectors: bySector.rows,
    health: health.rows[0] ?? null,
    topProducts: topProducts.rows,
  };
}

/* -------------------------------------------------------------------------- */
/* TRANSAKSI                                                                   */
/* -------------------------------------------------------------------------- */

export class TransactionFilterError extends Error {}

function transactionFilter(f: ListFilter) {
  for (const field of ['tenantId', 'merchantId', 'outletId'] as const) {
    const value = f[field];
    if (value !== undefined && value !== '' && (typeof value !== 'string' || !UUID_RE.test(value))) {
      throw new TransactionFilterError('INVALID_ID');
    }
  }
  for (const field of ['from', 'to'] as const) {
    const value = f[field];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !DATE_RE.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new TransactionFilterError('INVALID_DATE');
    }
  }
  if (f.from && f.to && String(f.from) > String(f.to)) throw new TransactionFilterError('INVALID_DATE_RANGE');
  if (f.timezone !== undefined && f.timezone !== '') {
    if (typeof f.timezone !== 'string' || f.timezone.length > 80) throw new TransactionFilterError('INVALID_TIMEZONE');
    try { new Intl.DateTimeFormat('en', { timeZone: f.timezone }).format(); }
    catch { throw new TransactionFilterError('INVALID_TIMEZONE'); }
  }
  return cleanFilter(f);
}

export async function transactionLog(db: Db, f: ListFilter = {}) {
  const c = transactionFilter(f);
  let timezone = typeof f.timezone === 'string' && f.timezone ? f.timezone : 'Asia/Jakarta';
  if (!f.timezone && c.merchantId) {
    const settings = await db.query('SELECT timezone FROM internal.merchant_settings WHERE merchant_id=$1', [c.merchantId]);
    timezone = settings.rows[0]?.timezone || timezone;
  }
  const w = new Where();
  // Audit keeps every status. Only the canonical revenue view supplies money
  // counted as revenue; the same filtered rows drive both the list and cards.
  w.add((p) => `x.business_sector = ${p}`, c.sector);
  w.add((p) => `x.tenant_id = ${p}::uuid`, f.tenantId || null);
  w.add((p) => `x.merchant_id = ${p}::uuid`, c.merchantId);
  w.add((p) => `x.outlet_id = ${p}::uuid`, f.outletId || null);
  w.add((p) => `x.app_module = ${p}`, c.module);
  // Convert calendar boundaries, not the indexed created_at column. `to` is
  // inclusive in the selected timezone, even when the server runs in UTC.
  const zoneParam = w.next();
  w.params.push(timezone);
  w.add((p) => `x.created_at >= (${p}::date::timestamp AT TIME ZONE ${zoneParam})`, c.from);
  w.add((p) => `x.created_at < ((${p}::date + 1)::timestamp AT TIME ZONE ${zoneParam})`, c.to);
  w.add((p) => `(x.invoice_number ILIKE ${p} OR x.merchant_name ILIKE ${p})`, c.search ? `%${c.search}%` : null);

  const { rows: result } = await db.query(
    `WITH filtered AS (
       SELECT x.*, COALESCE(r.total_amount,0) AS revenue_amount,
              COALESCE(r.refund_amount,rf.amount,0) AS refund_amount,
              (r.id IS NOT NULL) AS included_in_revenue
         FROM contract.transaction_log x
         LEFT JOIN contract.merchant_revenue r ON r.id=x.id AND r.tenant_id=x.tenant_id
         LEFT JOIN contract.refund_totals rf ON rf.transaction_id=x.id AND rf.tenant_id=x.tenant_id
         ${w.sql()}
     ), page AS (
       SELECT * FROM filtered ORDER BY created_at DESC,id DESC
       LIMIT ${w.next()} OFFSET $${w.params.length + 2}
     )
     SELECT COUNT(*)::int AS total,
            COALESCE(SUM(total_amount),0) AS audit_amount,
            COALESCE(SUM(revenue_amount),0) AS revenue_amount,
            COUNT(*) FILTER (WHERE included_in_revenue)::int AS revenue_count,
            COUNT(*) FILTER (WHERE order_status IN ('COMPLETED','SETTLED'))::int AS completed_count,
            COUNT(*) FILTER (WHERE order_status IN ('VOID','VOIDED'))::int AS voided_count,
            COUNT(*) FILTER (WHERE order_status IN ('CANCELLED','CANCELED'))::int AS cancelled_count,
            COUNT(*) FILTER (WHERE refund_amount>0 OR order_status='REFUNDED' OR payment_status='REFUNDED')::int AS refunded_count,
            COALESCE(SUM(refund_amount),0) AS refund_amount,
            COALESCE(SUM(total_amount) FILTER (WHERE order_status IN ('VOID','VOIDED','CANCELLED','CANCELED')),0) AS void_cancelled_amount,
            COALESCE((SELECT json_agg(page) FROM page),'[]'::json) AS rows,
            ${zoneParam}::text AS timezone
       FROM filtered`,
    [...w.params, c.limit, c.offset]
  );
  const agg = result[0];

  return {
    rows: agg.rows,
    total: Number(agg.total),
    // Backwards-compatible alias now means valid revenue, never all audit rows.
    sumAmount: Number(agg.revenue_amount),
    revenueAmount: Number(agg.revenue_amount),
    auditAmount: Number(agg.audit_amount),
    refundAmount: Number(agg.refund_amount),
    voidCancelledAmount: Number(agg.void_cancelled_amount),
    counts: {
      revenue: Number(agg.revenue_count), completed: Number(agg.completed_count),
      voided: Number(agg.voided_count), cancelled: Number(agg.cancelled_count), refunded: Number(agg.refunded_count),
    },
    timezone,
    source: 'contract.merchant_revenue',
    limit: c.limit,
    offset: c.offset,
  };
}

export async function transactionDetail(db: Db, id: string, merchantId:string|null=null) {
  if (!UUID_RE.test(id)) return null;
  const head = await db.query(
    `SELECT x.*,COALESCE(r.total_amount,0) AS revenue_amount,COALESCE(r.refund_amount,0) AS refund_amount,
            (r.id IS NOT NULL) AS included_in_revenue
       FROM contract.transaction_log x
       LEFT JOIN contract.merchant_revenue r ON r.id=x.id AND r.tenant_id=x.tenant_id
      WHERE x.id = $1 AND ($2::uuid IS NULL OR x.merchant_id=$2)`,
    [id,merchantId]
  );
  if (!head.rows.length) return null;

  const items = await db.query(
    `SELECT v.product_name,v.variant_name,v.modifier_snapshot,v.category_name,v.business_sector,v.quantity_exact AS quantity,
            v.unit_price,v.unit_cost,v.total_price,v.gross_profit
       FROM contract.transaction_items_detailed v
       WHERE v.transaction_id = $1 ORDER BY v.product_name`,
    [id]
  );
  return { transaction: head.rows[0], items: items.rows };
}

/* -------------------------------------------------------------------------- */
/* PRODUK TERJUAL                                                              */
/* -------------------------------------------------------------------------- */

export async function productSales(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `v.business_sector = ${p}`, c.sector);
  w.add((p) => `v.merchant_id = ${p}::uuid`, c.merchantId);
  // Pencarian ikut menjangkau deskripsi: "gula aren" harus menemukan produk
  // bernama "Kopi Susu" yang deskripsinya menyebut gula aren.
  w.add(
    (p) => `(v.product_name ILIKE ${p} OR v.product_description ILIKE ${p})`,
    c.search ? `%${c.search}%` : null
  );

  const { rows } = await db.query(
    `SELECT v.business_sector, v.merchant_id, v.merchant_name, v.product_name,
            v.product_description, v.category_name, v.units_sold_exact AS units_sold, v.revenue,
            v.cogs, v.gross_profit, v.appeared_in_transactions::int, v.last_sold_at
       FROM contract.admin_product_sales v
       ${w.sql()}
      ORDER BY v.revenue DESC
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.admin_product_sales v ${w.sql()}`,
    w.params
  );
  return { rows, total: cnt[0]?.total ?? 0, limit: c.limit, offset: c.offset };
}

/**
 * Katalog lengkap, termasuk produk yang belum pernah terjual.
 *
 * Berbeda dari productSales(): fungsi itu berangkat dari baris struk, jadi
 * produk yang tidak laku mustahil muncul. Yang ini berangkat dari katalog —
 * sehingga nol penjualan justru terlihat, dan itu biasanya temuan yang paling
 * berguna bagi pemilik.
 */
export async function catalog(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `v.business_sector = ${p}`, c.sector);
  w.add((p) => `v.merchant_id = ${p}::uuid`, c.merchantId);
  w.add(
    (p) => `(v.product_name ILIKE ${p} OR v.description ILIKE ${p} OR v.sku ILIKE ${p})`,
    c.search ? `%${c.search}%` : null
  );

  const { rows } = await db.query(
    `SELECT v.business_sector, v.merchant_id, v.merchant_name, v.product_id,
            v.product_name, v.sku, v.category_name, v.description,
            v.price, v.cost_price, v.margin_pct, v.stock, v.min_stock_alert,
            v.is_low_stock, v.is_available, v.catalog_synced_at,
            v.units_sold::int, v.revenue, v.last_sold_at
       FROM contract.catalog v
       ${w.sql()}
      ORDER BY v.units_sold ASC, v.product_name
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: agg } = await db.query(
    `SELECT COUNT(*)::int                                        AS total,
            COUNT(*) FILTER (WHERE units_sold = 0)::int          AS never_sold,
            COUNT(*) FILTER (WHERE is_low_stock)::int            AS low_stock,
            COUNT(*) FILTER (WHERE NOT is_available)::int        AS retired
       FROM contract.catalog v ${w.sql()}`,
    w.params
  );

  return {
    rows,
    total: agg[0]?.total ?? 0,
    neverSold: agg[0]?.never_sold ?? 0,
    lowStock: agg[0]?.low_stock ?? 0,
    retired: agg[0]?.retired ?? 0,
    limit: c.limit,
    offset: c.offset,
  };
}

/* -------------------------------------------------------------------------- */
/* JEJAK AKTIVITAS                                                             */
/* -------------------------------------------------------------------------- */

export async function activityLog(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `a.business_sector = ${p}`, c.sector);
  w.add((p) => `a.merchant_id = ${p}::uuid`, c.merchantId);
  w.add((p) => `a.app_module = ${p}`, c.module);
  w.add((p) => `a.severity = ${p}`, c.severity);
  w.add((p) => `a.occurred_at >= ${p}::date`, c.from);
  w.add((p) => `a.occurred_at < (${p}::date + 1)`, c.to);
  w.add((p) => `(a.summary ILIKE ${p} OR a.event_type ILIKE ${p})`, c.search ? `%${c.search}%` : null);

  const { rows } = await db.query(
    `SELECT a.id, a.business_sector, a.business_id, a.app_module, a.event_type,
            a.severity, a.actor_name, a.actor_role, a.amount_idr, a.summary,
            a.detail, a.occurred_at, a.transaction_id,
            a.merchant_name, a.merchant_id
       FROM contract.admin_activity_log a
       ${w.sql()}
      ORDER BY a.occurred_at DESC
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.admin_activity_log a ${w.sql()}`,
    w.params
  );
  return { rows, total: cnt[0]?.total ?? 0, limit: c.limit, offset: c.offset };
}

export async function activityBreakdown(db: Db, merchantId:string|null=null) {
  const { rows } = await db.query(
    `SELECT business_sector, app_module, event_type, severity,
            count(*)::int AS event_count,count(DISTINCT merchant_id)::int AS merchants_affected,max(occurred_at) AS last_seen_at
       FROM contract.admin_activity_log WHERE ($1::uuid IS NULL OR merchant_id=$1)
       GROUP BY business_sector,app_module,event_type,severity ORDER BY event_count DESC`,[merchantId]
  );
  return rows;
}

/*
 * Fungsi penulisan TIDAK ADA di sini lagi.
 *
 * File ini kini dimiliki backoffice-service, yang perannya (svc_internal) tidak
 * punya hak tulis ke skema pos sama sekali. writeActivity() pindah ke
 * services/pos/activity.ts — pemilik sesungguhnya dari merchant_activity_log.
 *
 * Kalau suatu saat backoffice perlu menulis jejak aktivitas merchant, itu harus
 * lewat panggilan HTTP ke pos-service, bukan dengan membuka kembali hak tulis.
 */
