/**
 * Agregat merchant untuk AI Copilot — dibaca dari kontrak bersama.
 *
 * PERUBAHAN PALING PENTING DARI VERSI MONOLIT
 *
 * Sebelumnya file ini menulis sendiri `WHERE payment_status <> 'CANCELLED'`,
 * dan admin panel menulis klausa yang sama di tempat lain. Keduanya identik
 * karena saya menjaganya identik — satu kata berbeda dan copilot serta panel
 * diam-diam melaporkan omzet yang berbeda, tanpa ada yang tahu mana yang benar.
 *
 * Sekarang keduanya WAJIB lewat `contract.merchant_revenue`. ai-service bahkan
 * tidak PUNYA hak baca ke pos.transactions — Postgres menolaknya. Kesamaan
 * angka berhenti menjadi disiplin dan menjadi sifat struktural.
 *
 * PEMBATASAN CAKUPAN. Setiap query terikat satu merchant lewat parameter, dan
 * merchant itu diturunkan dari `client_key`, bukan dari id yang dikirim klien.
 * Tidak ada jalur yang menerima UUID tenant langsung dari luar.
 */

import type { Db } from '../shared/db';
import type { MerchantAggregates } from '../../src/lib/assistant/types';

export type FieldSource = 'DATABASE' | 'CLIENT' | 'UNAVAILABLE';

export interface MerchantDataResult {
  aggregates: MerchantAggregates | null;
  tenantId: string | null;
  storeName: string | null;
  businessSector: string | null;
  provenance: Record<string, FieldSource>;
}

const WINDOW_DAYS = 30;

const emptyAggregates = (): MerchantAggregates => ({
  windowDays: WINDOW_DAYS,
  ordersAnalysed: 0, revenueTotal: 0, revenueToday: 0, ordersToday: 0,
  avgTicket: 0, grossMarginPct: 0, voidRatePct: 0, discountRatePct: 0,
  topProducts: [], slowMovers: [], paymentMix: [], orderTypeMix: [],
  categoryMix: [], revenueByDay: [],
  customerCounts: { TOTAL: 0, BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 },
  stockCritical: 0, slotsOccupied: 0, slotsTotal: 0, staffOnShift: 0,
  mtdRevenue: 0, monthlyTarget: 0, targetSource: 'NONE', runRatePct: 0, expectedPct: 0,
});

async function resolveTenant(db: Db, businessId: string) {
  const { rows } = await db.query(
    `SELECT business_id AS id, merchant_name AS name, business_sector
       FROM contract.merchant_directory WHERE client_key = $1`,
    [businessId]
  );
  return rows[0] ?? null;
}

export async function buildAggregatesFromDb(
  db: Db,
  businessId: string
): Promise<MerchantDataResult> {
  const tenant = await resolveTenant(db, businessId);
  if (!tenant) {
    return { aggregates: null, tenantId: null, storeName: null, businessSector: null, provenance: {} };
  }

  const t = tenant.id as string;
  const a = emptyAggregates();
  const W = `AND created_at >= CURRENT_TIMESTAMP - (${WINDOW_DAYS} || ' days')::interval`;

  /* -- Ringkasan utama ---------------------------------------------------- */
  const head = await db.query(
    `SELECT
       COUNT(*)::int                                    AS orders,
       COALESCE(SUM(total_amount), 0)                   AS revenue,
       COALESCE(AVG(total_amount), 0)                   AS avg_ticket,
       COALESCE(SUM(discount_amount), 0)                AS discount,
       COALESCE(SUM(subtotal), 0)                       AS subtotal,
       COUNT(*) FILTER (
         WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date
             = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date)::int AS orders_today,
       COALESCE(SUM(total_amount) FILTER (
         WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date
             = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date), 0)  AS revenue_today,
       COALESCE(SUM(total_amount) FILTER (
         WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Jakarta')
             = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')), 0) AS mtd_revenue
     FROM contract.merchant_revenue
     WHERE business_id = $1 ${W}`,
    [t]
  );

  const h = head.rows[0];
  a.ordersAnalysed = h.orders;
  a.revenueTotal = Number(h.revenue);
  a.revenueToday = Number(h.revenue_today);
  a.ordersToday = h.orders_today;
  a.avgTicket = Math.round(Number(h.avg_ticket));
  a.mtdRevenue = Number(h.mtd_revenue);
  a.discountRatePct =
    Number(h.subtotal) > 0 ? +((Number(h.discount) / Number(h.subtotal)) * 100).toFixed(2) : 0;

  /*
   * Void rate TIDAK BISA dihitung dari contract.merchant_revenue — view itu
   * memang sudah membuang baris CANCELLED, dan itulah gunanya. Angkanya diambil
   * dari transaction_log yang mempertahankan payment_status.
   */
  const voids = await db.query(
    `SELECT COUNT(*) FILTER (WHERE payment_status = 'CANCELLED')::int AS voided,
            COUNT(*)::int                                            AS total
       FROM contract.transaction_log
      WHERE business_id = $1 ${W}`,
    [t]
  );
  const v = voids.rows[0];
  a.voidRatePct = v.total > 0 ? +((v.voided / v.total) * 100).toFixed(2) : 0;

  /* -- Margin kotor, dari HPP yang tersnapshot di baris struk -------------- */
  const margin = await db.query(
    `SELECT COALESCE(SUM(i.total_price), 0)            AS revenue,
            COALESCE(SUM(i.unit_cost * i.quantity), 0) AS cogs
       FROM contract.transaction_items i
       JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
      WHERE r.business_id = $1
        AND r.created_at >= CURRENT_TIMESTAMP - (${WINDOW_DAYS} || ' days')::interval`,
    [t]
  );
  const m = margin.rows[0];
  a.grossMarginPct =
    Number(m.revenue) > 0
      ? +(((Number(m.revenue) - Number(m.cogs)) / Number(m.revenue)) * 100).toFixed(2)
      : 0;

  /* -- Produk terlaris & lambat ------------------------------------------- */
  const ps = await db.query(
    `SELECT product_id, product_name, units_sold, revenue, last_sold_at
       FROM contract.product_sales WHERE business_id = $1
      ORDER BY units_sold DESC LIMIT 10`,
    [t]
  );
  a.topProducts = ps.rows.map((r: any) => ({
    productId: String(r.product_id ?? ''),
    name: r.product_name,
    qty: Number(r.units_sold),
    revenue: Number(r.revenue),
  }));

  // Berangkat dari KATALOG, bukan dari baris struk: produk yang tidak pernah
  // terjual adalah kasus paling penting di sini, dan dari struk ia mustahil
  // muncul.
  const slow = await db.query(
    `SELECT product_id, product_name, units_sold, last_sold_at
       FROM contract.catalog WHERE business_id = $1 AND is_available
      ORDER BY units_sold ASC, product_name LIMIT 10`,
    [t]
  );
  a.slowMovers = slow.rows.map((r: any) => ({
    productId: String(r.product_id),
    name: r.product_name,
    qty: Number(r.units_sold),
    daysSinceLastSale: r.last_sold_at
      ? Math.floor((Date.now() - new Date(r.last_sold_at).getTime()) / 86_400_000)
      : null,
  }));

  /* -- Komposisi ----------------------------------------------------------- */
  const share = (rev: number) =>
    a.revenueTotal > 0 ? +((rev / a.revenueTotal) * 100).toFixed(1) : 0;

  const pay = await db.query(
    `SELECT payment_method, COUNT(*)::int AS orders, COALESCE(SUM(total_amount), 0) AS revenue
       FROM contract.merchant_revenue WHERE business_id = $1 ${W}
      GROUP BY payment_method ORDER BY revenue DESC`,
    [t]
  );
  a.paymentMix = pay.rows.map((r: any) => ({
    method: r.payment_method, orders: r.orders,
    revenue: Number(r.revenue), sharePct: share(Number(r.revenue)),
  }));

  const otype = await db.query(
    `SELECT COALESCE(order_type, 'LAINNYA') AS order_type,
            COUNT(*)::int AS orders, COALESCE(SUM(total_amount), 0) AS revenue
       FROM contract.merchant_revenue WHERE business_id = $1 ${W}
      GROUP BY COALESCE(order_type, 'LAINNYA') ORDER BY revenue DESC`,
    [t]
  );
  a.orderTypeMix = otype.rows.map((r: any) => ({
    orderType: r.order_type, orders: r.orders,
    revenue: Number(r.revenue), sharePct: share(Number(r.revenue)),
  }));

  const cat = await db.query(
    `SELECT COALESCE(i.category_name, 'Tanpa Kategori') AS name,
            SUM(i.quantity)::int AS qty, SUM(i.total_price) AS revenue
       FROM contract.transaction_items i
       JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
      WHERE r.business_id = $1
        AND r.created_at >= CURRENT_TIMESTAMP - (${WINDOW_DAYS} || ' days')::interval
      GROUP BY 1 ORDER BY revenue DESC`,
    [t]
  );
  a.categoryMix = cat.rows.map((r: any) => ({
    categoryId: r.name, name: r.name, qty: r.qty,
    revenue: Number(r.revenue), sharePct: share(Number(r.revenue)),
  }));

  // WIB, sama dengan contract.daily_sector_revenue. Tanpa konversi, penjualan
  // setelah 17.00 WIB jatuh ke tanggal berikutnya menurut UTC dan copilot
  // melaporkan hari yang berbeda dari panel.
  const daily = await db.query(
    `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS d,
            COUNT(*)::int AS orders, COALESCE(SUM(total_amount), 0) AS revenue
       FROM contract.merchant_revenue WHERE business_id = $1 ${W}
      GROUP BY 1 ORDER BY 1`,
    [t]
  );
  a.revenueByDay = daily.rows.map((r: any) => ({
    date: String(r.d).slice(0, 10), orders: r.orders, revenue: Number(r.revenue),
  }));

  /* -- Stok kritis --------------------------------------------------------- */
  // Menghitung PRODUK, sama dengan yang dilihat merchant di layarnya. Produk
  // yang katalognya belum pernah disinkronkan dikecualikan: stok default 0 akan
  // membanjiri merchant dengan peringatan palsu.
  const stock = await db.query(
    `SELECT COUNT(*)::int AS n FROM contract.stock_status
      WHERE business_id = $1 AND is_available AND is_low_stock
        AND catalog_synced_at IS NOT NULL`,
    [t]
  );
  a.stockCritical = stock.rows[0].n;

  /* -- Target bulanan ------------------------------------------------------ */
  // merchant_targets milik skema `ai` sendiri — satu-satunya tabel di fungsi ini
  // yang bukan kontrak.
  const target = await db.query(
    `SELECT monthly_revenue_target FROM ai.merchant_targets WHERE business_id = $1`,
    [t]
  );
  if (target.rows.length && Number(target.rows[0].monthly_revenue_target) > 0) {
    a.monthlyTarget = Number(target.rows[0].monthly_revenue_target);
    a.targetSource = 'MERCHANT';
  } else if (a.revenueTotal > 0) {
    a.monthlyTarget = Math.round((a.revenueTotal / WINDOW_DAYS) * 30);
    a.targetSource = 'AUTO';
  }

  if (a.monthlyTarget > 0) {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    a.runRatePct = +((a.mtdRevenue / a.monthlyTarget) * 100).toFixed(1);
    a.expectedPct = +((now.getDate() / daysInMonth) * 100).toFixed(1);
  }

  return {
    aggregates: a,
    tenantId: t,
    storeName: tenant.name,
    businessSector: tenant.business_sector,
    provenance: {
      ordersAnalysed: 'DATABASE', revenueTotal: 'DATABASE', revenueToday: 'DATABASE',
      ordersToday: 'DATABASE', avgTicket: 'DATABASE', grossMarginPct: 'DATABASE',
      voidRatePct: 'DATABASE', discountRatePct: 'DATABASE', topProducts: 'DATABASE',
      slowMovers: 'DATABASE', paymentMix: 'DATABASE', orderTypeMix: 'DATABASE',
      categoryMix: 'DATABASE', revenueByDay: 'DATABASE', stockCritical: 'DATABASE',
      mtdRevenue: 'DATABASE', monthlyTarget: 'DATABASE',
      // Belum punya tabel. Nol di sini berarti "belum tersedia", bukan
      // "benar-benar nol" — dan itu harus disebut apa adanya ke model.
      customerCounts: 'UNAVAILABLE', slotsOccupied: 'UNAVAILABLE',
      slotsTotal: 'UNAVAILABLE', staffOnShift: 'UNAVAILABLE',
    },
  };
}

/**
 * Menggabungkan agregat database dengan kiriman klien.
 * Database MENANG untuk setiap bidang yang dimilikinya. Klien hanya mengisi
 * bidang yang memang belum punya tabel — tidak pernah angka uang.
 */
export function mergeWithClient(
  fromDb: MerchantAggregates,
  fromClient: MerchantAggregates | undefined,
  provenance: Record<string, FieldSource>
): { aggregates: MerchantAggregates; provenance: Record<string, FieldSource> } {
  if (!fromClient) return { aggregates: fromDb, provenance };

  const merged = { ...fromDb };
  const p = { ...provenance };
  for (const key of ['customerCounts', 'slotsOccupied', 'slotsTotal', 'staffOnShift'] as const) {
    if (fromClient[key] !== undefined) {
      (merged as any)[key] = fromClient[key];
      p[key] = 'CLIENT';
    }
  }
  return { aggregates: merged, provenance: p };
}
