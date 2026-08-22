#!/usr/bin/env node
/**
 * =============================================================================
 * LAYER 1 — NIGHTLY BATCH LEARNING JOB
 * =============================================================================
 * Reads yesterday's trading data, computes the expensive analytics ONCE, and
 * upserts them into `daily_merchant_insights`. The app then answers merchant
 * questions from that table all day for Rp 0.
 *
 * Schedule (crontab -e):
 *     0 1 * * *  cd /srv/new-hope-pos && /usr/bin/node scripts/batch/daily-insights.mjs >> /var/log/nhpos-insights.log 2>&1
 *
 * systemd timer alternative:
 *     # /etc/systemd/system/nhpos-insights.timer
 *     [Timer]
 *     OnCalendar=*-*-* 01:00:00
 *     Persistent=true          # catches up after downtime
 *     [Install]
 *     WantedBy=timers.target
 *
 * Usage:
 *     node scripts/batch/daily-insights.mjs                 # live, needs DATABASE_URL + pg
 *     node scripts/batch/daily-insights.mjs --dry-run       # built-in demo dataset
 *     node scripts/batch/daily-insights.mjs --input data.json
 *     node scripts/batch/daily-insights.mjs --merchant usr-1 --window 30 --lead-time 3
 *
 * The reorder-point and market-basket maths below intentionally mirror
 * src/lib/assistant/insights.ts. The browser and the cron must never disagree
 * about what "stok kritis" means.
 * =============================================================================
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = { dryRun: false, input: null, merchantId: 'tenant-default', windowDays: 30, leadTimeDays: 3, safetyFactor: 0.5, minSupport: 0.05, minConfidence: 0.3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--merchant') args.merchantId = argv[++i];
    else if (a === '--window') args.windowDays = Number(argv[++i]) || 30;
    else if (a === '--lead-time') args.leadTimeDays = Number(argv[++i]) || 3;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  console.log(`
Nightly Smart Assistant batch job.

  --dry-run            Compute against a built-in demo dataset, print JSON, write nothing.
  --input <file.json>  Compute against { products, stockItems, orders, customers, inventoryLogs }.
  --merchant <id>      Merchant to process (default: tenant-default).
  --window <days>      Analysis window (default: 30).
  --lead-time <days>   Supplier lead time for the reorder point (default: 3).
`);
}

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

/* -------------------------------------------------------------------------- */
/* SHARED MATH HELPERS                                                        */
/* -------------------------------------------------------------------------- */

const round = (n, dp = 2) => {
  const f = Math.pow(10, dp);
  return Math.round((Number(n) || 0) * f) / f;
};

/** Never let NaN/Infinity reach JSONB. */
const safe = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);

const DAY_MS = 86400000;
const daysBetween = (a, b) => Math.max(0, (a.getTime() - b.getTime()) / DAY_MS);

function toDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Round an order quantity up to a friendly pack size. */
function roundUpToPack(qty) {
  if (qty <= 0) return 0;
  if (qty < 10) return Math.ceil(qty);
  if (qty < 100) return Math.ceil(qty / 5) * 5;
  if (qty < 1000) return Math.ceil(qty / 10) * 10;
  return Math.ceil(qty / 100) * 100;
}

/* -------------------------------------------------------------------------- */
/* ALGORITHM 1 — DYNAMIC STOCK REORDER ALERT                                  */
/* -------------------------------------------------------------------------- */

/**
 * Average Daily Consumption over trailing windows, blended so a recent surge
 * moves the reorder point without a single quiet week hiding a real trend.
 *
 * Crucially the divisor is the number of days ACTUALLY COVERED by data, not the
 * nominal window: a store that opened five days ago would otherwise look like it
 * consumes 1/6th of what it really does, and would never trigger a restock.
 */
function computeAdc(consumptionByDay, now, windowDays, oldestDataDate) {
  const windows = [7, 14, 30];
  const out = {};
  for (const w of windows) {
    const from = new Date(now.getTime() - w * DAY_MS);
    let total = 0;
    for (const [dayIso, qty] of Object.entries(consumptionByDay)) {
      const d = toDate(dayIso);
      if (d && d >= from && d <= now) total += qty;
    }
    const coveredDays = oldestDataDate
      ? Math.min(w, Math.max(1, Math.ceil(daysBetween(now, oldestDataDate))))
      : w;
    out[`adc${w}`] = round(safe(total / coveredDays), 3);
  }

  const present = windows.filter((w) => out[`adc${w}`] > 0);
  let blended;
  if (present.length === 0) {
    blended = 0;
  } else if (out.adc7 > 0 && out.adc14 > 0 && out.adc30 > 0) {
    blended = 0.5 * out.adc7 + 0.3 * out.adc14 + 0.2 * out.adc30;
  } else {
    blended = present.reduce((s, w) => s + out[`adc${w}`], 0) / present.length;
  }

  return {
    adc7: out.adc7,
    adc14: out.adc14,
    adc30: out.adc30,
    avgDailyConsumption: round(safe(blended), 3),
    trendFactor: out.adc30 > 0 ? round(safe(out.adc7 / out.adc30, 1), 2) : 1,
  };
}

export function computeDynamicReorderAlerts(data, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const leadTimeDays = opts.leadTimeDays ?? 3;
  const safetyFactor = opts.safetyFactor ?? 0.5;
  const windowDays = opts.windowDays ?? 30;
  const from = new Date(now.getTime() - windowDays * DAY_MS);

  const completed = (data.orders || []).filter((o) => (o.status || 'COMPLETED') === 'COMPLETED');

  // Finished-goods consumption from order lines.
  const byProduct = new Map();
  let oldest = null;
  for (const o of completed) {
    const d = toDate(o.date || o.created_at);
    if (!d || d < from || d > now) continue;
    if (!oldest || d < oldest) oldest = d;
    const dayIso = d.toISOString().slice(0, 10);
    for (const li of o.items || []) {
      const key = li.productId || li.product_id || li.name;
      if (!key) continue;
      if (!byProduct.has(key)) byProduct.set(key, {});
      const bucket = byProduct.get(key);
      bucket[dayIso] = (bucket[dayIso] || 0) + (Number(li.quantity) || 0);
    }
  }

  // Raw-material consumption from the inventory mutation log.
  const byIngredient = new Map();
  for (const lg of data.inventoryLogs || []) {
    if (!['SALE', 'OUT'].includes(lg.type)) continue;
    const d = toDate(lg.timestamp || lg.created_at);
    if (!d || d < from || d > now) continue;
    if (!oldest || d < oldest) oldest = d;
    const dayIso = d.toISOString().slice(0, 10);
    const key = lg.productId || lg.ingredient_id;
    if (!key) continue;
    if (!byIngredient.has(key)) byIngredient.set(key, {});
    const bucket = byIngredient.get(key);
    bucket[dayIso] = (bucket[dayIso] || 0) + Math.abs(Number(lg.quantity) || 0);
  }

  const rows = [];

  const evaluate = (item, itemKind, consumption) => {
    const stock = Number(item.stock ?? item.current_stock ?? 0) || 0;
    const minAlert = Number(item.minStockAlert ?? item.min_stock_alert ?? 0) || 0;
    const adc = computeAdc(consumption || {}, now, windowDays, oldest);

    const safetyStock = round(safe(safetyFactor * adc.avgDailyConsumption * leadTimeDays), 2);
    const reorderPoint = round(safe(adc.avgDailyConsumption * leadTimeDays + safetyStock), 2);
    const daysOfCover =
      adc.avgDailyConsumption > 0 ? round(safe(stock / adc.avgDailyConsumption), 1) : 9999;

    let severity = null;
    if (stock <= 0) severity = 'OUT_OF_STOCK';
    else if (daysOfCover <= leadTimeDays) severity = 'CRITICAL';
    else if (reorderPoint > 0 && stock <= reorderPoint) severity = 'BELOW_ROP';
    else if (minAlert > 0 && stock <= minAlert) severity = 'WATCH';
    if (!severity) return;

    const target = reorderPoint + adc.avgDailyConsumption * leadTimeDays;
    rows.push({
      itemId: item.id,
      name: item.name,
      itemKind,
      unit: item.unit || 'pcs',
      currentStock: stock,
      ...adc,
      daysOfCover,
      reorderPoint,
      safetyStock,
      suggestedReorderQty: roundUpToPack(Math.max(0, target - stock)),
      projectedStockoutDate:
        adc.avgDailyConsumption > 0 && daysOfCover < 9999
          ? new Date(now.getTime() + daysOfCover * DAY_MS).toISOString().slice(0, 10)
          : null,
      severity,
    });
  };

  for (const p of data.products || []) evaluate(p, 'PRODUCT', byProduct.get(p.id));
  for (const s of data.stockItems || []) evaluate(s, 'STOCK_ITEM', byIngredient.get(s.id));

  const rank = { OUT_OF_STOCK: 0, CRITICAL: 1, BELOW_ROP: 2, WATCH: 3 };
  rows.sort((a, b) => rank[a.severity] - rank[b.severity] || a.daysOfCover - b.daysOfCover);
  return rows.slice(0, 12);
}

/* -------------------------------------------------------------------------- */
/* ALGORITHM 2 — MARKET BASKET ANALYSIS                                       */
/* -------------------------------------------------------------------------- */

export function computeMarketBasket(orders, opts = {}) {
  const minSupport = opts.minSupport ?? 0.05;
  const minConfidence = opts.minConfidence ?? 0.3;
  const now = opts.now ? new Date(opts.now) : new Date();
  const from = new Date(now.getTime() - (opts.windowDays ?? 30) * DAY_MS);

  const baskets = [];
  const nameOf = new Map();

  for (const o of orders || []) {
    if ((o.status || 'COMPLETED') !== 'COMPLETED') continue;
    const d = toDate(o.date || o.created_at);
    if (!d || d < from || d > now) continue;

    const ids = new Set();
    for (const li of o.items || []) {
      // Fall back to the line's own name: seed/legacy orders reference product
      // ids that no longer exist in the catalog.
      const key = li.productId || li.product_id || (li.name || '').toLowerCase().trim();
      if (!key) continue;
      ids.add(key);
      if (!nameOf.has(key)) nameOf.set(key, li.name || key);
    }
    if (ids.size >= 2) baskets.push([...ids]);
  }

  const basketCount = baskets.length;
  if (basketCount === 0) return { basketCount: 0, pairs: [] };

  const single = new Map();
  const pair = new Map();
  for (const b of baskets) {
    for (const x of b) single.set(x, (single.get(x) || 0) + 1);
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const k = b[i] < b[j] ? `${b[i]}|${b[j]}` : `${b[j]}|${b[i]}`;
        pair.set(k, (pair.get(k) || 0) + 1);
      }
    }
  }

  const results = [];
  for (const [k, co] of pair.entries()) {
    const [x, y] = k.split('|');
    const cx = single.get(x) || 0;
    const cy = single.get(y) || 0;
    if (cx === 0 || cy === 0) continue;

    const support = co / basketCount;
    // Emit the direction with the stronger implication.
    const confXY = co / cx;
    const confYX = co / cy;
    const [aId, bId, confidence, aCount] =
      confXY >= confYX ? [x, y, confXY, cx] : [y, x, confYX, cy];
    const pB = (single.get(bId) || 0) / basketCount;
    const lift = pB > 0 ? confidence / pB : 0;

    results.push({
      aId,
      aName: nameOf.get(aId) || aId,
      bId,
      bName: nameOf.get(bId) || bId,
      coOccurrence: co,
      support: round(safe(support), 4),
      confidence: round(safe(confidence), 4),
      lift: round(safe(lift), 3),
      _aCount: aCount,
    });
  }

  let passing = results.filter(
    (r) => r.support >= minSupport && r.confidence >= minConfidence && r.lift > 1
  );

  // A young store still deserves a hint — but only from pairs that genuinely
  // co-occurred. We relax the thresholds, we never invent a pair.
  if (passing.length === 0) passing = results.filter((r) => r.coOccurrence > 0);

  passing.sort((a, b) => b.lift - a.lift || b.coOccurrence - a.coOccurrence);
  return {
    basketCount,
    pairs: passing.slice(0, 6).map(({ _aCount, ...rest }) => rest),
  };
}

/* -------------------------------------------------------------------------- */
/* INSIGHT ROW MAPPING                                                        */
/* -------------------------------------------------------------------------- */

const idFor = (merchantId, date, category) => `ins-${merchantId}-${date}-${category}`;

/**
 * Member yang berhenti datang.
 *
 * Sektor-netral: kafe, laundry, retail, cuci mobil, dan barbershop sama-sama
 * punya pelanggan berulang. Berbeda dengan LAYOUT_UTILISATION atau
 * SHIFT_PERFORMANCE yang hanya masuk akal di sebagian sektor — itu sebabnya
 * keduanya belum ditulis, bukan karena terlupakan.
 *
 * Ambangnya 14 hari DAN minimal dua kunjungan. Tanpa syarat kedua, setiap
 * pelanggan yang baru sekali mampir dan tidak kembali akan muncul sebagai
 * "churn", dan daftarnya menjadi terlalu panjang untuk ditindaklanjuti.
 */
export function buildChurnRow(merchantId, date, lapsedCustomers = []) {
  if (!lapsedCustomers.length) return null;

  const teratas = lapsedCustomers[0];
  const nilaiBerisiko = lapsedCustomers.reduce((n, c) => n + Number(c.belanja || 0), 0);

  return {
    id: idFor(merchantId, date, 'CRM_CHURN'),
    business_id: merchantId,
    insight_date: date,
    category: 'CRM_CHURN',
    priority: lapsedCustomers.length >= 3 ? 1 : 2,
    title: `${lapsedCustomers.length} member mulai jarang datang`,
    summary:
      `${teratas.name} (${teratas.tier}) terakhir belanja ${teratas.hari} hari lalu, ` +
      `total belanja seumur hidup Rp ${Number(teratas.belanja).toLocaleString('id-ID')}.`,
    metric_label: `Rp ${Math.round(nilaiBerisiko).toLocaleString('id-ID')} berisiko`,
    payload: {
      kind: 'CRM_CHURN',
      customers: lapsedCustomers.map((c) => ({
        name: c.name, tier: c.tier,
        daysSinceLastVisit: Number(c.hari),
        lifetimeSpent: Number(c.belanja),
      })),
    },
    actions: [{ label: 'Buka Member', kind: 'OPEN_CUSTOMERS' }],
  };
}

export function buildInsightRows(merchantId, date, { reorder, basket, lapsedCustomers }) {
  const rows = [];

  const churn = buildChurnRow(merchantId, date, lapsedCustomers);
  if (churn) rows.push(churn);

  if (reorder.length > 0) {
    const urgent = reorder.filter((r) => r.severity === 'OUT_OF_STOCK' || r.severity === 'CRITICAL');
    rows.push({
      id: idFor(merchantId, date, 'INVENTORY_ALERT'),
      business_id: merchantId,
      insight_date: date,
      category: 'INVENTORY_ALERT',
      priority: urgent.length > 0 ? 1 : 2,
      title: urgent.length > 0 ? 'Stok kritis perlu restock hari ini' : 'Beberapa stok mendekati batas aman',
      summary:
        urgent.length > 0
          ? `${urgent.length} item kritis, terdepan ${urgent[0].name} (sisa ${urgent[0].currentStock} ${urgent[0].unit}, cukup ${urgent[0].daysOfCover} hari).`
          : `${reorder.length} item sudah menyentuh titik pemesanan ulang.`,
      metric_label: `${reorder.length} item`,
      payload: { kind: 'INVENTORY_ALERT', items: reorder },
      actions: [{ label: 'Buka Stok', kind: 'OPEN_INVENTORY' }],
    });
  }

  if (basket.pairs.length > 0) {
    const top = basket.pairs[0];
    rows.push({
      id: idFor(merchantId, date, 'CROSS_SELL_OPPORTUNITY'),
      business_id: merchantId,
      insight_date: date,
      category: 'CROSS_SELL_OPPORTUNITY',
      priority: 3,
      title: 'Peluang jualan tambahan',
      summary: `${Math.round(top.confidence * 100)}% pembeli ${top.aName} juga mengambil ${top.bName} (${top.coOccurrence}x dari ${basket.basketCount} keranjang, lift ${top.lift}).`,
      metric_label: `${basket.pairs.length} pasangan`,
      payload: { kind: 'CROSS_SELL_OPPORTUNITY', basketCount: basket.basketCount, pairs: basket.pairs },
      actions: [{ label: 'Buat promo bundling', kind: 'CREATE_PROMO' }],
    });
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/* PERSISTENCE                                                                */
/* -------------------------------------------------------------------------- */

// Tidak ada cast ke `insight_category_enum` — tipe itu memang SENGAJA tidak
// pernah dibuat (lihat catatan penutup 0003: domain kategori dijaga oleh
// CHECK ck_insight_category, bukan ENUM, supaya kosakata kategori bisa
// bertambah tanpa migrasi ALTER TYPE). Cast ke tipe yang tidak ada membuat
// setiap penulisan gagal.
const UPSERT_SQL = `
INSERT INTO daily_merchant_insights
  (id, business_id, insight_date, category, priority, title, summary, metric_label, payload, actions, status, created_at, updated_at)
VALUES
  (legacy_uuid($1), $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (business_id, insight_date, category) DO UPDATE SET
  priority     = EXCLUDED.priority,
  title        = EXCLUDED.title,
  summary      = EXCLUDED.summary,
  metric_label = EXCLUDED.metric_label,
  payload      = EXCLUDED.payload,
  actions      = EXCLUDED.actions,
  status       = 'ACTIVE',
  updated_at   = CURRENT_TIMESTAMP;
`;

async function upsertInsights(client, rows) {
  for (const r of rows) {
    await client.query(UPSERT_SQL, [
      r.id, r.business_id, r.insight_date, r.category, r.priority,
      r.title, r.summary, r.metric_label,
      JSON.stringify(r.payload), JSON.stringify(r.actions),
    ]);
  }
  return rows.length;
}

async function loadMerchantData(client, merchantId, windowDays) {
  const since = new Date(Date.now() - windowDays * DAY_MS).toISOString();

  // Berurutan, bukan Promise.all. Satu pg.Client hanya punya SATU koneksi:
  // lima query yang dikirim bersamaan tetap dijalankan satu per satu dalam
  // antrean internal pg — tidak ada yang lebih cepat — sambil memicu peringatan
  // usang yang akan menjadi galat di pg@9.
  const products = await client.query('SELECT id, name, price, cost_price, 0 AS stock, 0 AS min_stock_alert FROM products WHERE business_id = $1', [merchantId]);
  const stockItems = await client.query('SELECT id, name, current_stock AS stock, min_stock_alert, unit, cost_price FROM ingredients WHERE business_id = $1', [merchantId]);
  const orders = await client.query('SELECT id, created_at AS date, payment_status FROM transactions WHERE business_id = $1 AND created_at >= $2', [merchantId, since]);
  const items = await client.query('SELECT transaction_id, product_id, product_name AS name, quantity, unit_price FROM transaction_items WHERE business_id = $1', [merchantId]);
  const logs = await client.query("SELECT ingredient_id AS \"productId\", quantity_changed AS quantity, created_at AS timestamp, 'SALE' AS type FROM inventory_logs WHERE business_id = $1 AND created_at >= $2", [merchantId, since]);

  // Member yang dulu datang lalu berhenti. Dibaca dari contract.customer_rfm —
  // permukaan yang sama dengan yang dipakai AI Copilot, supaya angka di kartu
  // insight dan angka yang disebut asisten tidak pernah berbeda.
  const lapsed = await client.query(
    `SELECT name, tier, days_since_last_transaction AS hari, lifetime_spent_recorded AS belanja
       FROM contract.customer_rfm
      WHERE business_id = $1
        AND days_since_last_transaction > 14
        AND transaction_count > 1
      ORDER BY lifetime_spent_recorded DESC
      LIMIT 5`,
    [merchantId]
  );

  const itemsByTx = new Map();
  for (const li of items.rows) {
    if (!itemsByTx.has(li.transaction_id)) itemsByTx.set(li.transaction_id, []);
    itemsByTx.get(li.transaction_id).push(li);
  }

  return {
    lapsedCustomers: lapsed.rows,
    products: products.rows,
    stockItems: stockItems.rows,
    inventoryLogs: logs.rows,
    orders: orders.rows.map((o) => ({
      ...o,
      status: o.payment_status === 'COMPLETED' ? 'COMPLETED' : o.payment_status,
      items: itemsByTx.get(o.id) || [],
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* DEMO DATASET (dry-run)                                                     */
/* -------------------------------------------------------------------------- */

function demoData() {
  const day = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
  const line = (productId, name, quantity, unitPrice) => ({ productId, name, quantity, unitPrice });
  return {
    products: [
      { id: 'p1', name: 'Kopi Susu Gula Aren', stock: 12, minStockAlert: 10, unit: 'cup', price: 25000, costPrice: 8000 },
      { id: 'p2', name: 'Butter Croissant', stock: 4, minStockAlert: 5, unit: 'pcs', price: 22000, costPrice: 7000 },
      { id: 'p3', name: 'Nasi Goreng Spesial', stock: 40, minStockAlert: 5, unit: 'porsi', price: 35000, costPrice: 14000 },
    ],
    stockItems: [
      { id: 'i1', name: 'Biji Kopi Arabica', stock: 900, minStockAlert: 1000, unit: 'gram', costPrice: 180 },
      { id: 'i2', name: 'Susu Fresh Milk', stock: 3000, minStockAlert: 2000, unit: 'ml', costPrice: 25 },
    ],
    inventoryLogs: Array.from({ length: 14 }, (_, i) => ([
      { productId: 'i1', quantity: -90, timestamp: day(i), type: 'SALE' },
      { productId: 'i2', quantity: -450, timestamp: day(i), type: 'SALE' },
    ])).flat(),
    orders: Array.from({ length: 14 }, (_, i) => ([
      { id: `t${i}a`, date: day(i), status: 'COMPLETED', items: [line('p1', 'Kopi Susu Gula Aren', 3, 25000), line('p2', 'Butter Croissant', 2, 22000)] },
      { id: `t${i}b`, date: day(i), status: 'COMPLETED', items: [line('p1', 'Kopi Susu Gula Aren', 2, 25000)] },
      { id: `t${i}c`, date: day(i), status: 'COMPLETED', items: [line('p3', 'Nasi Goreng Spesial', 1, 35000), line('p1', 'Kopi Susu Gula Aren', 1, 25000)] },
    ])).flat(),
  };
}

/* -------------------------------------------------------------------------- */
/* MAIN                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Catatan satu kali eksekusi — DITULIS SETELAH pekerjaannya selesai.
 *
 * Sama seperti di merchant-health.mjs: baris berstatus 'SUCCESS' yang
 * disisipkan sebelum pekerjaannya dimulai akan bertahan sebagai pengakuan
 * palsu bila prosesnya dibunuh di tengah jalan. Dan `id` yang dibuatnya
 * (`run-1787…`) bukan UUID, padahal kolomnya UUID sejak 0005 — jadi INSERT
 * pertamanya selalu gagal dan job ini tidak pernah berhasil dijalankan.
 */
async function catatRun(client, merchantId, status, ditulis, durasiMs, error) {
  await client.query(
    `INSERT INTO batch_job_runs
       (id, job_name, business_id, started_at, finished_at, status,
        insights_written, duration_ms, error_text)
     VALUES (uuidv7(), 'daily-insights', $1,
             CURRENT_TIMESTAMP - ($4::int || ' milliseconds')::interval,
             CURRENT_TIMESTAMP, $2, $3, $4, $5)`,
    [merchantId, status, ditulis, durasiMs, error]
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = Date.now();
  const insightDate = new Date().toISOString().slice(0, 10);

  let aborted = false;
  process.on('SIGINT', () => {
    aborted = true;
    log('SIGINT received — aborting after the current step.');
  });

  // Decide the mode up front and say so loudly, so nobody mistakes a dry run
  // for a real one in the logs.
  let pg = null;
  if (!args.dryRun && process.env.DATABASE_URL) {
    try {
      pg = (await import('pg')).default;
    } catch {
      log('WARN  `pg` is not installed — falling back to DRY-RUN mode.');
    }
  }
  const live = Boolean(pg && process.env.DATABASE_URL && !args.dryRun);

  log(`MODE: ${live ? 'LIVE (writing to Postgres)' : 'DRY-RUN (no database writes)'}`);
  log(`merchant=${args.merchantId} window=${args.windowDays}d leadTime=${args.leadTimeDays}d`);

  const opts = {
    windowDays: args.windowDays,
    leadTimeDays: args.leadTimeDays,
    safetyFactor: args.safetyFactor,
    minSupport: args.minSupport,
    minConfidence: args.minConfidence,
  };

  /* ---- DRY RUN ---------------------------------------------------------- */
  if (!live) {
    let data;
    if (args.input) {
      log(`Reading fixture: ${args.input}`);
      data = JSON.parse(readFileSync(args.input, 'utf8'));
    } else {
      log('Using built-in demo dataset.');
      data = demoData();
    }

    const reorder = computeDynamicReorderAlerts(data, opts);
    const basket = computeMarketBasket(data.orders, opts);
    const rows = buildInsightRows(args.merchantId, insightDate, { reorder, basket, lapsedCustomers: data.lapsedCustomers });

    console.log(JSON.stringify({ mode: 'DRY_RUN', insightDate, rows }, null, 2));
    log(`Done in ${Date.now() - startedAt} ms — ${rows.length} insight(s) computed, 0 written.`);
    return;
  }

  /* ---- LIVE ------------------------------------------------------------- */
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const data = await loadMerchantData(client, args.merchantId, args.windowDays);
    if (aborted) throw new Error('aborted by SIGINT');

    const reorder = computeDynamicReorderAlerts(data, opts);
    const basket = computeMarketBasket(data.orders, opts);
    const rows = buildInsightRows(args.merchantId, insightDate, { reorder, basket, lapsedCustomers: data.lapsedCustomers });

    await client.query('BEGIN');
    const written = await upsertInsights(client, rows);
    await catatRun(client, args.merchantId, 'SUCCESS', written, Date.now() - startedAt, null);
    await client.query('COMMIT');

    log(`Done in ${Date.now() - startedAt} ms — ${written} insight(s) upserted.`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
    try {
      await catatRun(client, args.merchantId, 'FAILED', 0, Date.now() - startedAt,
                     String(err && err.message ? err.message : err));
    } catch { /* best effort */ }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  log('FATAL', err && err.stack ? err.stack : err);
  process.exit(1);
});
