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

import type { Db } from './db';

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
  merchantId?: unknown;
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
           COALESCE(v.business_unit_count, 0)::int    AS business_unit_count,
           COALESCE(v.transaction_count, 0)::int      AS transaction_count,
           COALESCE(v.gross_revenue, 0)               AS gross_revenue,
           COALESCE(v.avg_basket, 0)                  AS avg_basket,
           COALESCE(v.total_discount, 0)              AS total_discount,
           v.last_transaction_at,
           COALESCE(m.registered_merchants, 0)::int   AS registered_merchants
      FROM unnest($1::text[]) AS s(sector)
      LEFT JOIN contract.sector_summary v ON v.business_sector = s.sector
      LEFT JOIN (
            SELECT business_sector, COUNT(*) AS registered_merchants
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
      (SELECT COUNT(*) FROM contract.activity_log)::int                      AS activity_events,
      (SELECT COUNT(*) FROM contract.activity_log
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
       FROM contract.daily_sector_revenue
      WHERE sales_date >= (CURRENT_DATE - ($1::int - 1))
      ORDER BY sales_date, business_sector`,
    [n]
  );
  return rows;
}

/* -------------------------------------------------------------------------- */
/* MERCHANT                                                                    */
/* -------------------------------------------------------------------------- */

export async function merchantDirectory(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  w.add((p) => `d.business_sector = ${p}`, c.sector);
  w.add((p) => `d.merchant_name ILIKE ${p}`, c.search ? `%${c.search}%` : null);

  const { rows } = await db.query(
    `SELECT d.*, h.churn_risk_score, h.subscription_status, h.days_since_last_txn
       FROM contract.merchant_directory d
       LEFT JOIN contract.merchant_health_latest h ON h.merchant_id = d.merchant_id
       ${w.sql()}
      ORDER BY d.gross_revenue DESC, d.merchant_name
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.merchant_directory d ${w.sql()}`,
    w.params
  );
  return { rows, total: cnt[0]?.total ?? 0, limit: c.limit, offset: c.offset };
}

export async function merchantDetail(db: Db, merchantId: string) {
  if (!UUID_RE.test(merchantId)) return null;

  const [profile, bySector, health, topProducts] = await Promise.all([
    db.query(`SELECT * FROM contract.merchant_directory WHERE merchant_id = $1`, [merchantId]),
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
              units_sold::int, revenue, gross_profit, last_sold_at
         FROM contract.product_sales
        WHERE merchant_id = $1
        ORDER BY revenue DESC
        LIMIT 15`,
      [merchantId]
    ),
  ]);

  if (!profile.rows.length) return null;
  return {
    profile: profile.rows[0],
    sectors: bySector.rows,
    health: health.rows[0] ?? null,
    topProducts: topProducts.rows,
  };
}

/* -------------------------------------------------------------------------- */
/* TRANSAKSI                                                                   */
/* -------------------------------------------------------------------------- */

export async function transactionLog(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const w = new Where();
  // Penyaringan CANCELLED sudah dilakukan contract.merchant_revenue — tidak
  // boleh diulang di sini. Satu definisi omzet, satu tempat.
  w.add((p) => `x.business_sector = ${p}`, c.sector);
  w.add((p) => `x.merchant_id = ${p}::uuid`, c.merchantId);
  w.add((p) => `x.app_module = ${p}`, c.module);
  w.add((p) => `x.created_at >= ${p}::date`, c.from);
  // `to` inklusif: pengguna yang mengetik 31 Agustus bermaksud memasukkan
  // seluruh tanggal 31, bukan berhenti pada 00:00.
  w.add((p) => `x.created_at < (${p}::date + 1)`, c.to);
  w.add((p) => `(x.invoice_number ILIKE ${p} OR x.merchant_name ILIKE ${p})`, c.search ? `%${c.search}%` : null);

  const { rows } = await db.query(
    `SELECT x.id, x.invoice_number, x.business_sector, x.business_id, x.app_module,
            x.order_type, x.payment_method, x.payment_status,
            x.subtotal, x.discount_amount, x.tax_amount, x.service_charge_amount,
            x.total_amount, x.created_at, x.merchant_name, x.cashier_name,
            x.item_count::int AS item_count
       FROM contract.transaction_log x
       ${w.sql()}
      ORDER BY x.created_at DESC
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: agg } = await db.query(
    `SELECT COUNT(*)::int AS total, COALESCE(SUM(x.total_amount), 0) AS sum_amount
       FROM contract.transaction_log x ${w.sql()}`,
    w.params
  );

  return {
    rows,
    total: agg[0]?.total ?? 0,
    sumAmount: agg[0]?.sum_amount ?? 0,
    limit: c.limit,
    offset: c.offset,
  };
}

export async function transactionDetail(db: Db, id: string) {
  if (!UUID_RE.test(id)) return null;
  const head = await db.query(
    `SELECT * FROM contract.transaction_log WHERE id = $1`,
    [id]
  );
  if (!head.rows.length) return null;

  const items = await db.query(
    `SELECT product_name, category_name, business_sector, quantity::int,
            unit_price, unit_cost, total_price
       FROM contract.transaction_items WHERE transaction_id = $1 ORDER BY product_name`,
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
            v.product_description, v.category_name, v.units_sold::int, v.revenue,
            v.cogs, v.gross_profit, v.appeared_in_transactions::int, v.last_sold_at
       FROM contract.product_sales v
       ${w.sql()}
      ORDER BY v.revenue DESC
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.product_sales v ${w.sql()}`,
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
       FROM contract.activity_log a
       ${w.sql()}
      ORDER BY a.occurred_at DESC
      LIMIT ${w.next()} OFFSET $${w.params.length + 2}`,
    [...w.params, c.limit, c.offset]
  );

  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS total FROM contract.activity_log a ${w.sql()}`,
    w.params
  );
  return { rows, total: cnt[0]?.total ?? 0, limit: c.limit, offset: c.offset };
}

/* -------------------------------------------------------------------------- */
/* BAHAN BAKU & RESEP                                                          */
/* -------------------------------------------------------------------------- */

export async function rawMaterials(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const { rows } = await db.query(
    `SELECT * FROM contract.raw_materials
      WHERE ($1::text IS NULL OR business_sector = $1)
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR merchant_name ILIKE '%' || $2 || '%')
      ORDER BY menipis DESC, nilai_persediaan DESC
      LIMIT $3 OFFSET $4`,
    [c.sector, c.search, c.limit, c.offset]
  );
  const total = await db.query(
    `SELECT COUNT(*)::int AS n FROM contract.raw_materials
      WHERE ($1::text IS NULL OR business_sector = $1)
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR merchant_name ILIKE '%' || $2 || '%')`,
    [c.sector, c.search]
  );
  return { rows, total: total.rows[0].n, limit: c.limit, offset: c.offset };
}

/**
 * Cabang merchant beserta pemakaiannya terhadap batas paket.
 *
 * Digabung dalam satu kueri karena pertanyaannya selalu satu paket: "toko ini
 * punya cabang apa saja, dan apakah sudah mentok?" Menyajikan daftarnya tanpa
 * kuotanya membuat staf support harus membuka layar lain untuk tahu apakah
 * keluhan "tidak bisa tambah cabang" itu batas paket atau kerusakan.
 */
export async function branches(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const { rows } = await db.query(
    `SELECT b.*, t.name AS merchant_name,
            u.max_outlets, u.outlet_aktif, u.sisa_kuota
       FROM contract.branches b
       JOIN pos.tenants t ON t.id = b.merchant_id
       LEFT JOIN contract.merchant_outlet_usage u ON u.merchant_id = b.merchant_id
      WHERE ($1::text IS NULL OR b.business_sector = $1)
        AND ($2::text IS NULL OR b.name ILIKE '%' || $2 || '%' OR t.name ILIKE '%' || $2 || '%')
      ORDER BY t.name, b.is_active DESC, b.name
      LIMIT $3 OFFSET $4`,
    [c.sector, c.search, c.limit, c.offset]
  );
  const total = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM contract.branches b
       JOIN pos.tenants t ON t.id = b.merchant_id
      WHERE ($1::text IS NULL OR b.business_sector = $1)
        AND ($2::text IS NULL OR b.name ILIKE '%' || $2 || '%' OR t.name ILIKE '%' || $2 || '%')`,
    [c.sector, c.search]
  );
  return { rows, total: total.rows[0].n, limit: c.limit, offset: c.offset };
}

export async function bundles(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const { rows } = await db.query(
    `SELECT * FROM contract.bundles
      WHERE ($1::text IS NULL OR business_sector = $1)
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR merchant_name ILIKE '%' || $2 || '%')
      ORDER BY diskon_persen DESC, name
      LIMIT $3 OFFSET $4`,
    [c.sector, c.search, c.limit, c.offset]
  );
  const total = await db.query(
    `SELECT COUNT(*)::int AS n FROM contract.bundles
      WHERE ($1::text IS NULL OR business_sector = $1)
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR merchant_name ILIKE '%' || $2 || '%')`,
    [c.sector, c.search]
  );
  return { rows, total: total.rows[0].n, limit: c.limit, offset: c.offset };
}

export async function productRecipes(db: Db, f: ListFilter = {}) {
  const c = cleanFilter(f);
  const { rows } = await db.query(
    `SELECT * FROM contract.product_recipes
      WHERE ($1::text IS NULL OR business_sector = $1)
        AND ($2::text IS NULL OR product_name ILIKE '%' || $2 || '%'
             OR ingredient_name ILIKE '%' || $2 || '%')
      ORDER BY product_name, ingredient_name
      LIMIT $3 OFFSET $4`,
    [c.sector, c.search, c.limit, c.offset]
  );
  const total = await db.query(
    `SELECT COUNT(*)::int AS n FROM contract.product_recipes
      WHERE ($1::text IS NULL OR business_sector = $1)
        AND ($2::text IS NULL OR product_name ILIKE '%' || $2 || '%'
             OR ingredient_name ILIKE '%' || $2 || '%')`,
    [c.sector, c.search]
  );
  return { rows, total: total.rows[0].n, limit: c.limit, offset: c.offset };
}

export async function activityBreakdown(db: Db) {
  const { rows } = await db.query(
    `SELECT business_sector, app_module, event_type, severity,
            event_count::int, merchants_affected::int, last_seen_at
       FROM contract.activity_by_sector
      ORDER BY event_count DESC`
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
