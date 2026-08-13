/**
 * LAYER 1 — DAILY BATCH LEARNING ENGINE
 * =====================================
 * Pure, deterministic analytics over a `MerchantSnapshot`.
 *
 * No React, no localStorage, no network, no ambient clock (except the
 * `durationMs` stopwatch inside `runDailyBatch`). Everything else derives
 * "now" from `options.now` and falls back to `snapshot.generatedAt`, so the
 * exact same code produces the exact same output in the browser, in a Node
 * cron job, and in a test.
 *
 * Real-data defences baked in everywhere:
 *  - order lines may reference product ids that no longer exist in the catalog,
 *    so the catalog is treated as *enrichment*: the line's own name/unitPrice
 *    is always the source of truth,
 *  - `Order.date` may be an ISO string without a timezone suffix (parsed as
 *    local time — consistently, everywhere),
 *  - only COMPLETED orders feed revenue/quantity maths; VOID orders only feed
 *    the void-rate metric,
 *  - every division is guarded.
 */

import type {
  AttendanceRecord,
  Customer,
  CustomerTier,
  InventoryLog,
  Order,
  Product,
  StockItem,
} from '../../types';
import { formatRupiah } from '../../utils/formatters';
import type {
  BatchRunOptions,
  BatchRunResult,
  CalendarBehaviourPayload,
  ShiftPerformancePayload,
  CrmChurnPayload,
  CrossSellPayload,
  FinancialPerformancePayload,
  InsightAction,
  InsightCategory,
  InsightPayload,
  InsightPriority,
  InventoryAlertPayload,
  LayoutUtilisationPayload,
  MerchantAggregates,
  MerchantInsight,
  MerchantSnapshot,
  PeakHoursPayload,
  StaffBehaviourPayload,
} from './types';

/* -------------------------------------------------------------------------- */
/* CONSTANTS                                                                  */
/* -------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;

/** Reported instead of Infinity when an item has no measurable consumption. */
const DAYS_OF_COVER_SENTINEL = 999;

const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const SEVERITY_RANK: Record<InventoryAlertPayload['items'][number]['severity'], number> = {
  OUT_OF_STOCK: 0,
  CRITICAL: 1,
  BELOW_ROP: 2,
  WATCH: 3,
};

const EMPTY_TIER_COUNTS: Record<CustomerTier | 'TOTAL', number> = {
  BRONZE: 0,
  SILVER: 0,
  GOLD: 0,
  PLATINUM: 0,
  TOTAL: 0,
};

/* -------------------------------------------------------------------------- */
/* SMALL PURE HELPERS                                                         */
/* -------------------------------------------------------------------------- */

interface ResolvedOptions {
  windowDays: number;
  leadTimeDays: number;
  safetyFactor: number;
  minSupport: number;
  minConfidence: number;
  churnDays: number;
  churnValueTopPct: number;
  paydayUpliftThreshold: number;
  minOrdersPerCalendarWindow: number;
  targetGrowthFactor: number;
  minShiftsForJudgement: number;
  cashVarianceTolerancePct: number;
  now: Date;
  /** Local-midnight timestamp of `now`. */
  todayStart: number;
  /** Local-midnight timestamp of the first day inside the window. */
  windowStart: number;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDayTime(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function keyToTime(key: string): number {
  const parts = key.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return new Date(y, m - 1, d).getTime();
}

function addDays(time: number, days: number): number {
  const base = new Date(time);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days).getTime();
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function round0(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function safeDiv(a: number, b: number, fallback = 0): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return fallback;
  const r = a / b;
  return Number.isFinite(r) ? r : fallback;
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? round2((part / whole) * 100) : 0;
}

function normName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Indonesian number formatting without pulling in Intl for every tiny label. */
function num(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith('-');
  const bare = negative ? fixed.slice(1) : fixed;
  const [intPart, fracPart] = bare.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const hasFraction = !!fracPart && Number(fracPart) !== 0;
  return `${negative ? '-' : ''}${grouped}${hasFraction ? `,${fracPart}` : ''}`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function shortDate(time: number): string {
  const d = new Date(time);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'][d.getMonth()]}`;
}

function resolveOptions(snapshot: MerchantSnapshot, options?: BatchRunOptions): ResolvedOptions {
  const now = options?.now && !Number.isNaN(options.now.getTime())
    ? options.now
    : toDate(snapshot.generatedAt) || new Date();
  const windowDays = Math.max(1, Math.round(options?.windowDays ?? 30));
  const todayStart = startOfDayTime(now);
  return {
    windowDays,
    leadTimeDays: Math.max(1, options?.leadTimeDays ?? 3),
    safetyFactor: Math.max(0, options?.safetyFactor ?? 0.5),
    minSupport: Math.max(0, options?.minSupport ?? 0.05),
    minConfidence: Math.max(0, options?.minConfidence ?? 0.3),
    churnDays: Math.max(1, options?.churnDays ?? 30),
    churnValueTopPct: Math.min(1, Math.max(0.01, options?.churnValueTopPct ?? 0.2)),
    paydayUpliftThreshold: Math.max(1, options?.paydayUpliftThreshold ?? 1.2),
    minOrdersPerCalendarWindow: Math.max(1, options?.minOrdersPerCalendarWindow ?? 5),
    targetGrowthFactor: Math.max(0.1, options?.targetGrowthFactor ?? 1.1),
    minShiftsForJudgement: Math.max(1, options?.minShiftsForJudgement ?? 3),
    cashVarianceTolerancePct: Math.max(0, options?.cashVarianceTolerancePct ?? 2),
    now,
    todayStart,
    windowStart: addDays(todayStart, -(windowDays - 1)),
  };
}

/* -------------------------------------------------------------------------- */
/* ORDER / LINE NORMALISATION                                                 */
/* -------------------------------------------------------------------------- */

interface DatedOrder {
  order: Order;
  date: Date;
  time: number;
  dayKey: string;
  dayTime: number;
}

interface LineRef {
  /** Stable identity: product id when usable, else `name:<normalised>`. */
  key: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  product: Product | null;
}

interface Catalog {
  byId: Map<string, Product>;
  byName: Map<string, Product>;
}

function buildCatalog(products: Product[]): Catalog {
  const byId = new Map<string, Product>();
  const byName = new Map<string, Product>();
  for (const p of products) {
    if (p && p.id) byId.set(p.id, p);
    const n = normName(p?.name);
    if (n && !byName.has(n)) byName.set(n, p);
  }
  return { byId, byName };
}

function datedOrders(orders: Order[]): DatedOrder[] {
  const out: DatedOrder[] = [];
  for (const order of orders || []) {
    const date = toDate(order?.date);
    if (!date) continue;
    const dayTime = startOfDayTime(date);
    out.push({ order, date, time: date.getTime(), dayKey: dateKey(date), dayTime });
  }
  return out.sort((a, b) => a.time - b.time);
}

function inWindow(o: DatedOrder, opt: ResolvedOptions): boolean {
  return o.dayTime >= opt.windowStart;
}

function linesOf(order: Order, catalog: Catalog): LineRef[] {
  const out: LineRef[] = [];
  for (const item of order?.items || []) {
    if (!item) continue;
    const product =
      (item.productId ? catalog.byId.get(item.productId) : undefined) ||
      catalog.byName.get(normName(item.name)) ||
      null;
    const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
    const unitPrice = Number.isFinite(item.unitPrice) ? item.unitPrice : (product?.price ?? 0);
    const lineTotal = Number.isFinite(item.totalPrice) ? item.totalPrice : unitPrice * qty;
    const key = product?.id || (item.productId ? item.productId : '') || `name:${normName(item.name)}`;
    out.push({
      key: key || `name:${normName(item.name) || 'tanpa-nama'}`,
      name: item.name || product?.name || 'Item tanpa nama',
      qty,
      unitPrice,
      lineTotal,
      product,
    });
  }
  return out;
}

/** COGS for a line: real cost when the product is known, else 50% of price. */
function lineCost(line: LineRef): number {
  const cost = line.product && Number.isFinite(line.product.costPrice)
    ? line.product.costPrice
    : line.unitPrice * 0.5;
  return cost * line.qty;
}

/* -------------------------------------------------------------------------- */
/* INSIGHT ENVELOPE                                                           */
/* -------------------------------------------------------------------------- */

function buildInsight(
  snapshot: MerchantSnapshot,
  opt: ResolvedOptions,
  category: InsightCategory,
  priority: InsightPriority,
  title: string,
  summary: string,
  metricLabel: string,
  payload: InsightPayload,
  actions: InsightAction[]
): MerchantInsight {
  const insightDate = dateKey(opt.now);
  return {
    id: `ins-${snapshot.merchantId}-${insightDate}-${category}`,
    merchantId: snapshot.merchantId,
    insightDate,
    category,
    priority,
    title,
    summary,
    metricLabel,
    payload,
    actions,
    status: 'ACTIVE',
    createdAt: opt.now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* 1. INVENTORY — dynamic reorder point                                       */
/* -------------------------------------------------------------------------- */

interface AdcWindow {
  adc: number;
  covered: boolean;
}

/**
 * Average daily consumption over a trailing window.
 *
 * Divides by the number of days actually covered by data (first observed sale
 * day inside the window .. today) instead of the nominal window length, so a
 * store that opened four days ago is not told it sells a quarter of what it
 * really sells.
 *
 * `covered` is false when the window contains no data AND the item has no sales
 * history older than the window either — i.e. we genuinely cannot say anything,
 * as opposed to a real, meaningful zero.
 */
function computeAdc(
  daily: Map<string, number>,
  opt: ResolvedOptions,
  windowLength: number,
  firstEverDataTime: number | null
): AdcWindow {
  const start = addDays(opt.todayStart, -(windowLength - 1));
  let total = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  daily.forEach((qty, key) => {
    const t = keyToTime(key);
    if (t < start || qty <= 0) return;
    total += qty;
    if (t < earliest) earliest = t;
    if (t > latest) latest = t;
  });

  if (total <= 0 || !Number.isFinite(earliest)) {
    const genuineZero = firstEverDataTime !== null && firstEverDataTime <= start;
    return { adc: 0, covered: genuineZero };
  }

  const end = Math.max(opt.todayStart, latest);
  const spanDays = Math.round((end - earliest) / MS_PER_DAY) + 1;
  const daysCovered = Math.min(windowLength, Math.max(1, spanDays));
  return { adc: total / daysCovered, covered: true };
}

function blendAdc(a7: AdcWindow, a14: AdcWindow, a30: AdcWindow): number {
  const parts = [
    { value: a7.adc, weight: 0.5, covered: a7.covered },
    { value: a14.adc, weight: 0.3, covered: a14.covered },
    { value: a30.adc, weight: 0.2, covered: a30.covered },
  ].filter((p) => p.covered);
  const weightSum = parts.reduce((acc, p) => acc + p.weight, 0);
  if (weightSum <= 0) return 0;
  return parts.reduce((acc, p) => acc + p.value * p.weight, 0) / weightSum;
}

/** Reorder quantities merchants can actually buy: 1s, 5s, 10s, 25s. */
function roundToPack(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (qty < 10) return Math.ceil(qty);
  if (qty < 50) return Math.ceil(qty / 5) * 5;
  if (qty < 200) return Math.ceil(qty / 10) * 10;
  return Math.ceil(qty / 25) * 25;
}

interface ConsumptionSeries {
  daily: Map<string, number>;
  firstEver: number | null;
}

function emptySeries(): ConsumptionSeries {
  return { daily: new Map<string, number>(), firstEver: null };
}

function addConsumption(series: ConsumptionSeries, dayKeyValue: string, dayTime: number, qty: number): void {
  if (qty <= 0) return;
  series.daily.set(dayKeyValue, (series.daily.get(dayKeyValue) || 0) + qty);
  if (series.firstEver === null || dayTime < series.firstEver) series.firstEver = dayTime;
}

function productConsumption(orders: DatedOrder[], catalog: Catalog): Map<string, ConsumptionSeries> {
  const map = new Map<string, ConsumptionSeries>();
  for (const o of orders) {
    if (o.order.status !== 'COMPLETED') continue;
    for (const line of linesOf(o.order, catalog)) {
      if (!line.product) continue; // stock maths needs a catalog row
      let series = map.get(line.product.id);
      if (!series) {
        series = emptySeries();
        map.set(line.product.id, series);
      }
      addConsumption(series, o.dayKey, o.dayTime, line.qty);
    }
  }
  return map;
}

function stockItemConsumption(logs: InventoryLog[], stockItems: StockItem[]): Map<string, ConsumptionSeries> {
  const byId = new Map<string, StockItem>();
  const byName = new Map<string, StockItem>();
  for (const si of stockItems || []) {
    if (si?.id) byId.set(si.id, si);
    const n = normName(si?.name);
    if (n && !byName.has(n)) byName.set(n, si);
  }

  const map = new Map<string, ConsumptionSeries>();
  for (const log of logs || []) {
    if (!log) continue;
    if (log.type !== 'SALE' && log.type !== 'OUT') continue;
    const target = (log.productId ? byId.get(log.productId) : undefined) || byName.get(normName(log.productName));
    if (!target) continue;
    const stamped = toDate(log.timestamp);
    if (!stamped) continue;
    let series = map.get(target.id);
    if (!series) {
      series = emptySeries();
      map.set(target.id, series);
    }
    addConsumption(series, dateKey(stamped), startOfDayTime(stamped), Math.abs(Number(log.quantity) || 0));
  }
  return map;
}

export function computeInventoryInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || []);

  const productSeries = productConsumption(orders, catalog);
  const stockSeries = stockItemConsumption(snapshot.inventoryLogs || [], snapshot.stockItems || []);

  const items: InventoryAlertPayload['items'] = [];

  const evaluate = (
    itemId: string,
    name: string,
    itemKind: 'PRODUCT' | 'STOCK_ITEM',
    unit: string,
    currentStock: number,
    minStockAlert: number,
    series: ConsumptionSeries | undefined
  ): void => {
    const daily = series?.daily ?? new Map<string, number>();
    const firstEver = series?.firstEver ?? null;

    const w7 = computeAdc(daily, opt, 7, firstEver);
    const w14 = computeAdc(daily, opt, 14, firstEver);
    const w30 = computeAdc(daily, opt, 30, firstEver);
    const adc = blendAdc(w7, w14, w30);

    const trendFactor = w30.adc > 0 ? w7.adc / w30.adc : w7.adc > 0 ? 1.5 : 1;
    const safetyStock = opt.safetyFactor * adc * opt.leadTimeDays;
    const reorderPoint = adc * opt.leadTimeDays + safetyStock;
    const rawCover = adc > 0 ? currentStock / adc : Number.POSITIVE_INFINITY;
    const daysOfCover = Number.isFinite(rawCover)
      ? Math.min(DAYS_OF_COVER_SENTINEL, Math.max(0, rawCover))
      : DAYS_OF_COVER_SENTINEL;
    const suggestedReorderQty = roundToPack(
      Math.max(0, Math.ceil(reorderPoint + adc * opt.leadTimeDays - currentStock))
    );

    let severity: InventoryAlertPayload['items'][number]['severity'] | null = null;
    if (currentStock <= 0) severity = 'OUT_OF_STOCK';
    else if (adc > 0 && daysOfCover <= opt.leadTimeDays) severity = 'CRITICAL';
    else if (reorderPoint > 0 && currentStock <= reorderPoint) severity = 'BELOW_ROP';
    else if (minStockAlert > 0 && currentStock <= minStockAlert) severity = 'WATCH';
    if (!severity) return;

    const projectedStockoutDate =
      adc > 0 && Number.isFinite(rawCover)
        ? new Date(opt.now.getTime() + Math.min(DAYS_OF_COVER_SENTINEL, rawCover) * MS_PER_DAY).toISOString()
        : null;

    items.push({
      itemId,
      name,
      itemKind,
      unit: unit || 'pcs',
      currentStock: round2(currentStock),
      avgDailyConsumption: round2(adc),
      adc7: round2(w7.adc),
      adc14: round2(w14.adc),
      adc30: round2(w30.adc),
      trendFactor: round2(trendFactor),
      daysOfCover: round2(daysOfCover),
      reorderPoint: round2(reorderPoint),
      safetyStock: round2(safetyStock),
      suggestedReorderQty,
      projectedStockoutDate,
      severity,
    });
  };

  for (const p of snapshot.products || []) {
    if (!p || !p.id) continue;
    evaluate(
      p.id,
      p.name,
      'PRODUCT',
      p.unit,
      Number(p.stock) || 0,
      Number(p.minStockAlert) || 0,
      productSeries.get(p.id)
    );
  }
  for (const si of snapshot.stockItems || []) {
    if (!si || !si.id) continue;
    evaluate(
      si.id,
      si.name,
      'STOCK_ITEM',
      si.unit,
      Number(si.stock) || 0,
      Number(si.minStockAlert) || 0,
      stockSeries.get(si.id)
    );
  }

  if (items.length === 0) return null;

  items.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.daysOfCover - b.daysOfCover;
  });
  const capped = items.slice(0, 12);

  const outCount = capped.filter((i) => i.severity === 'OUT_OF_STOCK').length;
  const criticalCount = capped.filter((i) => i.severity === 'CRITICAL').length;
  const ropCount = capped.filter((i) => i.severity === 'BELOW_ROP').length;

  const priority: InsightPriority = outCount > 0 || criticalCount > 0 ? 1 : ropCount > 0 ? 2 : 3;

  const head = capped[0];
  const headCover =
    head.avgDailyConsumption > 0 && head.daysOfCover < DAYS_OF_COVER_SENTINEL
      ? `cukup ${num(head.daysOfCover)} hari lagi`
      : 'belum ada penjualan tercatat';

  const pieces: string[] = [];
  if (outCount > 0) pieces.push(`${outCount} item habis`);
  if (criticalCount > 0) pieces.push(`${criticalCount} item kritis`);
  if (ropCount > 0) pieces.push(`${ropCount} item di bawah titik pesan`);
  const watchCount = capped.length - outCount - criticalCount - ropCount;
  if (watchCount > 0) pieces.push(`${watchCount} item perlu dipantau`);

  const summary = `${pieces.join(', ')}. Paling mendesak ${head.name}: sisa ${num(head.currentStock)} ${head.unit}, ${headCover}. Saran pesan ${num(head.suggestedReorderQty, 0)} ${head.unit}.`;

  const title =
    outCount > 0
      ? 'Ada stok yang sudah habis'
      : criticalCount > 0
        ? 'Stok kritis, pesan hari ini'
        : 'Stok mulai menipis';

  const payload: InventoryAlertPayload = { kind: 'INVENTORY_ALERT', items: capped };

  return buildInsight(snapshot, opt, 'INVENTORY_ALERT', priority, title, summary, `${capped.length} item`, payload, [
    { label: 'Buka Stok', kind: 'OPEN_INVENTORY', params: { focusItemId: head.itemId } },
    { label: 'Tanya rincian', kind: 'ASK_ASSISTANT', params: { query: 'stok apa yang harus saya pesan hari ini?' } },
  ]);
}

/* -------------------------------------------------------------------------- */
/* 2. CROSS-SELL — market basket analysis                                     */
/* -------------------------------------------------------------------------- */

export function computeCrossSellInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || []).filter(
    (o) => o.order.status === 'COMPLETED' && inWindow(o, opt)
  );

  const nameByKey = new Map<string, string>();
  const priceByKey = new Map<string, number>();
  const itemCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  const baskets: string[][] = [];

  for (const o of orders) {
    const lines = linesOf(o.order, catalog);
    const keys: string[] = [];
    for (const line of lines) {
      if (!nameByKey.has(line.key)) nameByKey.set(line.key, line.product?.name || line.name);
      const price = line.product?.price ?? line.unitPrice;
      if (Number.isFinite(price) && price > 0 && !priceByKey.has(line.key)) priceByKey.set(line.key, price);
      if (!keys.includes(line.key)) keys.push(line.key);
    }
    if (keys.length < 2) continue;
    baskets.push(keys);
    for (const k of keys) itemCount.set(k, (itemCount.get(k) || 0) + 1);
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const [a, b] = keys[i] < keys[j] ? [keys[i], keys[j]] : [keys[j], keys[i]];
        const pk = `${a}\0${b}`;
        pairCount.set(pk, (pairCount.get(pk) || 0) + 1);
      }
    }
  }

  const basketCount = baskets.length;
  if (basketCount === 0 || pairCount.size === 0) return null;

  const bundlePrice = (a: string, b: string): number | null => {
    const pa = priceByKey.get(a) ?? null;
    const pb = priceByKey.get(b) ?? null;
    if (pa === null && pb === null) return null;
    const total = (pa || 0) + (pb || 0);
    return Math.round((total * 0.9) / 500) * 500;
  };

  const all: CrossSellPayload['pairs'] = [];
  pairCount.forEach((coOccurrence, pk) => {
    const [x, y] = pk.split('\0');
    const cx = itemCount.get(x) || 0;
    const cy = itemCount.get(y) || 0;
    if (cx === 0 || cy === 0) return;

    const confXY = safeDiv(coOccurrence, cx);
    const confYX = safeDiv(coOccurrence, cy);
    // Emit the direction the merchant can actually act on: highest confidence.
    const [aId, bId, confidence, bCount] =
      confXY >= confYX ? [x, y, confXY, cy] : [y, x, confYX, cx];

    const support = safeDiv(coOccurrence, basketCount);
    const lift = safeDiv(confidence, safeDiv(bCount, basketCount));

    all.push({
      aId,
      aName: nameByKey.get(aId) || aId,
      bId,
      bName: nameByKey.get(bId) || bId,
      coOccurrence,
      support: round2(support * 100) / 100,
      confidence: round2(confidence * 100) / 100,
      lift: round2(lift),
      bundlePriceSuggestion: bundlePrice(aId, bId),
    });
  });

  if (all.length === 0) return null;

  const strong = all.filter(
    (p) => p.support >= opt.minSupport && p.confidence >= opt.minConfidence && p.lift > 1
  );
  const relaxed = strong.length === 0;

  const pairs = (relaxed
    ? [...all].sort((a, b) => b.coOccurrence - a.coOccurrence || b.lift - a.lift)
    : [...strong].sort((a, b) => b.lift - a.lift || b.coOccurrence - a.coOccurrence)
  ).slice(0, 6);

  if (pairs.length === 0) return null;

  const top = pairs[0];
  const bundleText =
    top.bundlePriceSuggestion !== null
      ? ` Coba paket bundling ${formatRupiah(top.bundlePriceSuggestion)}.`
      : '';

  const summary = relaxed
    ? `Data masih tipis (${basketCount} transaksi berisi 2 item atau lebih), tapi ${top.aName} dan ${top.bName} sudah ${top.coOccurrence}x dibeli bersamaan.${bundleText}`
    : `${Math.round(top.confidence * 100)}% pembeli ${top.aName} juga ambil ${top.bName} (${top.coOccurrence}x dari ${basketCount} keranjang, lift ${num(top.lift, 2)}).${bundleText}`;

  const priority: InsightPriority = relaxed ? 3 : top.lift >= 1.5 && top.coOccurrence >= 3 ? 2 : 3;

  const payload: CrossSellPayload = { kind: 'CROSS_SELL_OPPORTUNITY', basketCount, pairs };

  return buildInsight(
    snapshot,
    opt,
    'CROSS_SELL_OPPORTUNITY',
    priority,
    'Peluang jualan tambahan',
    summary,
    `${pairs.length} pasangan`,
    payload,
    [
      {
        label: 'Buat promo bundling',
        kind: 'CREATE_PROMO',
        params: { aId: top.aId, bId: top.bId, suggestedPrice: top.bundlePriceSuggestion },
      },
      { label: 'Buka kasir', kind: 'OPEN_POS', params: { highlightProductId: top.bId } },
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* 3. CRM — RFM + churn                                                       */
/* -------------------------------------------------------------------------- */

type Segment = CrmChurnPayload['customers'][number]['segment'];

interface CustomerStat {
  customer: Customer;
  recencyDays: number;
  frequency: number;
  monetary: number;
  avgTicket: number;
  favouriteProduct: string | null;
}

function quintile(sorted: number[], value: number, higherIsBetter: boolean): number {
  const n = sorted.length;
  if (n === 0) return 3;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  const percentile = (below + equal / 2) / n;
  let q = Math.floor(percentile * 5) + 1;
  if (q > 5) q = 5;
  if (q < 1) q = 1;
  return higherIsBetter ? q : 6 - q;
}

function thresholdR(recencyDays: number): number {
  if (recencyDays <= 7) return 5;
  if (recencyDays <= 14) return 4;
  if (recencyDays <= 30) return 3;
  if (recencyDays <= 60) return 2;
  return 1;
}

function thresholdF(frequency: number): number {
  if (frequency >= 10) return 5;
  if (frequency >= 5) return 4;
  if (frequency >= 3) return 3;
  if (frequency >= 2) return 2;
  return 1;
}

function thresholdM(monetary: number): number {
  if (monetary >= 1_000_000) return 5;
  if (monetary >= 500_000) return 4;
  if (monetary >= 250_000) return 3;
  if (monetary >= 100_000) return 2;
  return 1;
}

function segmentOf(
  recencyDays: number,
  frequency: number,
  rScore: number,
  fScore: number,
  churnDays: number
): Segment {
  if (recencyDays > churnDays * 3) return 'LOST';
  if (recencyDays > churnDays) return fScore >= 3 ? 'AT_RISK' : 'HIBERNATING';
  if (rScore >= 4 && fScore >= 4) return 'CHAMPION';
  if (fScore >= 4) return 'LOYAL';
  if (frequency <= 1) return 'NEW';
  if (rScore >= 4 && fScore <= 2) return 'POTENTIAL';
  return fScore >= 3 ? 'LOYAL' : 'POTENTIAL';
}

function offerFor(segment: Segment, stat: CustomerStat): string {
  const fav = stat.favouriteProduct;
  const favText = fav ? fav : 'menu favoritnya';
  const days = Math.round(stat.recencyDays);
  switch (segment) {
    case 'LOST':
      return `Sudah ${days} hari tidak mampir. Kirim WA sapaan hangat + voucher 25% untuk ${favText}, sekali ini saja untuk menariknya kembali.`;
    case 'HIBERNATING':
      return `Terakhir belanja ${days} hari lalu. Kirim WA promo 20% untuk ${favText} dengan batas 7 hari biar ada alasan datang.`;
    case 'AT_RISK':
      return `Pelanggan rutin yang mulai hilang. Kirim WA promo 20% untuk ${favText} — terakhir belanja ${days} hari lalu.`;
    case 'CHAMPION':
      return `Pelanggan terbaik Anda. Beri ucapan terima kasih + bonus poin dobel untuk ${favText} minggu ini.`;
    case 'LOYAL':
      return `Sudah langganan. Tawarkan paket hemat ${favText} atau undang jadi member prioritas.`;
    case 'POTENTIAL':
      return `Baru mulai sering datang. Kirim kupon kunjungan ke-3 untuk ${favText} biar jadi kebiasaan.`;
    case 'NEW':
    default:
      return `Pelanggan baru. Kirim WA ucapan terima kasih + diskon 10% untuk kunjungan berikutnya.`;
  }
}

function buildCustomerStats(snapshot: MerchantSnapshot, opt: ResolvedOptions): CustomerStat[] {
  const catalog = buildCatalog(snapshot.products || []);
  const completed = datedOrders(snapshot.orders || []).filter((o) => o.order.status === 'COMPLETED');

  interface Agg {
    customer: Customer;
    orders: number;
    spend: number;
    lastTime: number | null;
    itemQty: Map<string, number>;
  }
  const agg = new Map<string, Agg>();

  const ensure = (customer: Customer): Agg => {
    let row = agg.get(customer.id);
    if (!row) {
      row = { customer, orders: 0, spend: 0, lastTime: null, itemQty: new Map<string, number>() };
      agg.set(customer.id, row);
    } else if (row.customer !== customer) {
      // Prefer the master record from snapshot.customers when we have it.
      row.customer = row.customer.id ? row.customer : customer;
    }
    return row;
  };

  for (const c of snapshot.customers || []) {
    if (c && c.id) ensure(c);
  }

  for (const o of completed) {
    const c = o.order.customer;
    if (!c || !c.id) continue;
    const master = (snapshot.customers || []).find((x) => x.id === c.id) || c;
    const row = ensure(master);
    row.orders += 1;
    row.spend += Number(o.order.total) || 0;
    if (row.lastTime === null || o.time > row.lastTime) row.lastTime = o.time;
    for (const line of linesOf(o.order, catalog)) {
      const label = line.product?.name || line.name;
      row.itemQty.set(label, (row.itemQty.get(label) || 0) + line.qty);
    }
  }

  const stats: CustomerStat[] = [];
  agg.forEach((row) => {
    const lastVisit = toDate(row.customer.lastVisit);
    const lastVisitTime = lastVisit ? lastVisit.getTime() : null;
    const mostRecent =
      row.lastTime !== null && lastVisitTime !== null
        ? Math.max(row.lastTime, lastVisitTime)
        : row.lastTime !== null
          ? row.lastTime
          : lastVisitTime;

    const frequency = Math.max(row.orders, Number(row.customer.visitCount) || 0);
    const monetary = Math.max(row.spend, Number(row.customer.totalSpent) || 0);
    if (mostRecent === null && frequency <= 0 && monetary <= 0) return; // nothing to say

    const recencyDays =
      mostRecent === null
        ? opt.churnDays * 3 + 1
        : Math.max(0, Math.floor((opt.todayStart - startOfDayTime(new Date(mostRecent))) / MS_PER_DAY));

    let favouriteProduct: string | null = null;
    let bestQty = 0;
    row.itemQty.forEach((qty, label) => {
      if (qty > bestQty) {
        bestQty = qty;
        favouriteProduct = label;
      }
    });

    stats.push({
      customer: row.customer,
      recencyDays,
      frequency,
      monetary,
      avgTicket: frequency > 0 ? monetary / frequency : 0,
      favouriteProduct,
    });
  });

  return stats;
}

export function computeChurnInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const stats = buildCustomerStats(snapshot, opt);
  if (stats.length === 0) return null;

  const useQuintiles = stats.length >= 5;
  const recencies = stats.map((s) => s.recencyDays);
  const frequencies = stats.map((s) => s.frequency);
  const monetaries = stats.map((s) => s.monetary);

  const rows: CrmChurnPayload['customers'] = stats.map((s) => {
    const rScore = useQuintiles ? quintile(recencies, s.recencyDays, false) : thresholdR(s.recencyDays);
    const fScore = useQuintiles ? quintile(frequencies, s.frequency, true) : thresholdF(s.frequency);
    const mScore = useQuintiles ? quintile(monetaries, s.monetary, true) : thresholdM(s.monetary);
    const segment = segmentOf(s.recencyDays, s.frequency, rScore, fScore, opt.churnDays);
    return {
      customerId: s.customer.id,
      name: s.customer.name || 'Tanpa nama',
      phone: s.customer.phone || '',
      tier: s.customer.tier,
      recencyDays: s.recencyDays,
      frequency: s.frequency,
      monetary: round0(s.monetary),
      rScore,
      fScore,
      mScore,
      rfmScore: rScore * 100 + fScore * 10 + mScore,
      segment,
      avgTicket: round0(s.avgTicket),
      favouriteProduct: s.favouriteProduct,
      suggestedOffer: offerFor(segment, s),
    };
  });

  /*
   * Spec #3 gates churn on Monetary being in the merchant's top 20%. Chasing a
   * one-time Rp 50k buyer with a WhatsApp blast costs more attention than it
   * returns, so only genuinely valuable lapsed customers earn a card.
   *
   * The gate is skipped for very small customer bases (< 5), where a "top 20%"
   * would be a single person and the percentile is meaningless.
   */
  const lapsed = rows.filter(
    (r) => r.segment === 'AT_RISK' || r.segment === 'HIBERNATING' || r.segment === 'LOST'
  );

  let valueThreshold = 0;
  if (stats.length >= 5) {
    const sortedMonetary = monetaries.slice().sort((a, b) => b - a);
    const cutIndex = Math.max(
      0,
      Math.min(sortedMonetary.length - 1, Math.ceil(sortedMonetary.length * opt.churnValueTopPct) - 1)
    );
    valueThreshold = sortedMonetary[cutIndex] ?? 0;
  }

  const highValueLapsed = lapsed.filter((r) => r.monetary >= valueThreshold);
  // Never return an empty card just because the value gate was strict — if no
  // lapsed customer clears it, fall back to the full lapsed list.
  const atRisk = (highValueLapsed.length > 0 ? highValueLapsed : lapsed)
    .slice()
    .sort((a, b) => b.monetary - a.monetary)
    .slice(0, 10);

  if (atRisk.length === 0) return null;

  const valueAtRisk = atRisk.reduce((acc, r) => acc + r.monetary, 0);
  const top = atRisk[0];
  const lostCount = atRisk.filter((r) => r.segment === 'LOST').length;

  const priority: InsightPriority =
    top.monetary >= 500_000 || atRisk.length >= 3 ? 1 : lostCount > 0 ? 2 : 2;

  const summary = `${atRisk.length} pelanggan mulai hilang, total belanja mereka ${formatRupiah(valueAtRisk)}. Paling sayang: ${top.name} (${formatRupiah(top.monetary)}, terakhir ${top.recencyDays} hari lalu).`;

  const payload: CrmChurnPayload = { kind: 'CRM_CHURN', customers: atRisk };

  return buildInsight(
    snapshot,
    opt,
    'CRM_CHURN',
    priority,
    'Pelanggan lama mulai menghilang',
    summary,
    `${atRisk.length} pelanggan`,
    payload,
    [
      { label: 'Kirim WA', kind: 'SEND_WHATSAPP', params: { customerId: top.customerId, phone: top.phone, message: top.suggestedOffer } },
      { label: 'Buka Pelanggan', kind: 'OPEN_CUSTOMERS', params: { filter: 'AT_RISK' } },
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* 4. PEAK HOURS                                                              */
/* -------------------------------------------------------------------------- */

export function computePeakHoursInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const completed = datedOrders(snapshot.orders || []).filter(
    (o) => o.order.status === 'COMPLETED' && inWindow(o, opt)
  );
  if (completed.length === 0) return null;

  const hourOrders = new Array<number>(24).fill(0);
  const hourRevenue = new Array<number>(24).fill(0);
  const dowOrders = new Array<number>(7).fill(0);
  const dowRevenue = new Array<number>(7).fill(0);

  let minHour = 23;
  let maxHour = 0;
  for (const o of completed) {
    const h = o.date.getHours();
    const d = o.date.getDay();
    const total = Number(o.order.total) || 0;
    hourOrders[h] += 1;
    hourRevenue[h] += total;
    dowOrders[d] += 1;
    dowRevenue[d] += total;
    if (h < minHour) minHour = h;
    if (h > maxHour) maxHour = h;
  }
  if (minHour > maxHour) return null;

  const byHour: PeakHoursPayload['byHour'] = [];
  for (let h = minHour; h <= maxHour; h += 1) {
    byHour.push({ hour: h, label: hourLabel(h), orders: hourOrders[h], revenue: round0(hourRevenue[h]) });
  }

  const byDayOfWeek: PeakHoursPayload['byDayOfWeek'] = DAY_LABELS.map((label, dayIndex) => ({
    dayIndex,
    label,
    orders: dowOrders[dayIndex],
    revenue: round0(dowRevenue[dayIndex]),
  }));

  const activeHours = byHour.filter((h) => h.revenue > 0);
  const meanActive = activeHours.length > 0
    ? activeHours.reduce((acc, h) => acc + h.revenue, 0) / activeHours.length
    : 0;

  const runsOf = (predicate: (h: PeakHoursPayload['byHour'][number]) => boolean) => {
    const windows: PeakHoursPayload['peakWindows'] = [];
    let start: number | null = null;
    let revenue = 0;
    let orders = 0;
    const flush = (endHour: number) => {
      if (start === null) return;
      windows.push({
        label: `${hourLabel(start)}–${hourLabel(Math.min(23, endHour + 1))}`,
        startHour: start,
        endHour,
        revenue: round0(revenue),
        orders,
      });
      start = null;
      revenue = 0;
      orders = 0;
    };
    for (let i = 0; i < byHour.length; i += 1) {
      const h = byHour[i];
      if (predicate(h)) {
        if (start === null) start = h.hour;
        revenue += h.revenue;
        orders += h.orders;
      } else {
        flush(byHour[i - 1]?.hour ?? h.hour);
      }
    }
    flush(byHour[byHour.length - 1].hour);
    return windows;
  };

  const peakWindows = meanActive > 0 ? runsOf((h) => h.revenue >= meanActive * 1.2) : [];
  // "Quiet" only makes sense inside trading hours — 03:00 is not a quiet hour,
  // it is a closed hour. byHour already spans only the observed trading range.
  const quietWindows = meanActive > 0 ? runsOf((h) => h.revenue <= meanActive * 0.5) : [];

  peakWindows.sort((a, b) => b.revenue - a.revenue);
  quietWindows.sort((a, b) => a.revenue - b.revenue);

  const busiestDayEntry = [...byDayOfWeek].sort((a, b) => b.revenue - a.revenue)[0];
  const busiestDay = busiestDayEntry && busiestDayEntry.revenue > 0 ? busiestDayEntry.label : null;

  const peak = peakWindows[0] || null;
  const quiet = quietWindows[0] || null;

  const staffingHint = peak
    ? `Jam tersibuk ${peak.label} — ${peak.orders} transaksi, ${formatRupiah(peak.revenue)}. Pastikan kasir dan dapur sudah siap 30 menit sebelumnya${quiet ? `, lalu geser istirahat ke ${quiet.label} yang paling sepi` : ''}${busiestDay ? `. Hari ${busiestDay} paling ramai` : ''}.`
    : `Transaksi tersebar cukup merata dari ${hourLabel(minHour)} sampai ${hourLabel(Math.min(23, maxHour + 1))}. Belum perlu tambah orang, cukup jaga ritme yang ada${busiestDay ? `; hari ${busiestDay} paling ramai` : ''}.`;

  const topHour = [...byHour].sort((a, b) => b.revenue - a.revenue)[0];
  const summary = peak
    ? `Puncak omzet di ${peak.label}: ${formatRupiah(peak.revenue)} dari ${peak.orders} transaksi${quiet ? `, sementara ${quiet.label} paling sepi (${formatRupiah(quiet.revenue)})` : ''}.`
    : `Jam ${topHour.label} paling ramai dengan ${topHour.orders} transaksi (${formatRupiah(topHour.revenue)}), tapi bedanya tipis dengan jam lain.`;

  const priority: InsightPriority = peak ? 2 : 3;

  const payload: PeakHoursPayload = {
    kind: 'OPERATIONAL_PEAK',
    byHour,
    byDayOfWeek,
    peakWindows,
    quietWindows,
    busiestDay,
    staffingHint,
  };

  return buildInsight(
    snapshot,
    opt,
    'OPERATIONAL_PEAK',
    priority,
    'Pola jam ramai toko',
    summary,
    peak ? peak.label : topHour.label,
    payload,
    [
      { label: 'Lihat laporan', kind: 'OPEN_REPORTS', params: { tab: 'hourly' } },
      { label: 'Tanya jadwal staf', kind: 'ASK_ASSISTANT', params: { query: 'jam berapa toko paling ramai?' } },
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* 5. FINANCIAL ANOMALY                                                       */
/* -------------------------------------------------------------------------- */

type AnomalyMetric = FinancialPerformancePayload['anomalies'][number]['metric'];

interface DayFinance {
  dayTime: number;
  completed: number;
  voided: number;
  revenue: number;
  subtotal: number;
  discount: number;
  lineRevenue: number;
  cogs: number;
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDevOf(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

/** Revenue of COMPLETED orders falling in a given calendar month. */
function revenueOfMonth(orders: DatedOrder[], year: number, month: number): number {
  let total = 0;
  for (const o of orders) {
    if (o.order.status !== 'COMPLETED') continue;
    if (o.date.getFullYear() === year && o.date.getMonth() === month) {
      total += Number(o.order.total) || 0;
    }
  }
  return total;
}

/**
 * Spec #5 needs a monthly revenue target. Most UMKM never fill one in, which
 * would leave this card permanently blank — so when the merchant has not set
 * one we derive it from the trailing COMPLETE months and label it AUTO. The UI
 * and every answer must disclose that, otherwise the merchant is being shown a
 * goal they never agreed to.
 */
export function resolveMonthlyTarget(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): { target: number; source: 'MERCHANT' | 'AUTO'; monthsUsed: number } {
  const opt = resolveOptions(snapshot, options);
  const manual = Number(snapshot.settings?.monthlyRevenueTarget) || 0;
  if (manual > 0) return { target: round0(manual), source: 'MERCHANT', monthsUsed: 0 };

  const all = datedOrders(snapshot.orders || []);
  const totals: number[] = [];
  for (let back = 1; back <= 3; back++) {
    const ref = new Date(opt.now.getFullYear(), opt.now.getMonth() - back, 1);
    const rev = revenueOfMonth(all, ref.getFullYear(), ref.getMonth());
    if (rev > 0) totals.push(rev);
  }

  if (totals.length === 0) return { target: 0, source: 'AUTO', monthsUsed: 0 };
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  return { target: round0(avg * opt.targetGrowthFactor), source: 'AUTO', monthsUsed: totals.length };
}

export function computeFinancialPerformanceInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || []).filter((o) => inWindow(o, opt));

  const days = new Map<string, DayFinance>();
  const ensureDay = (key: string, dayTime: number): DayFinance => {
    let row = days.get(key);
    if (!row) {
      row = {
        dayTime,
        completed: 0,
        voided: 0,
        revenue: 0,
        subtotal: 0,
        discount: 0,
        lineRevenue: 0,
        cogs: 0,
      };
      days.set(key, row);
    }
    return row;
  };

  for (const o of orders) {
    if (o.order.status === 'HOLD') continue;
    const row = ensureDay(o.dayKey, o.dayTime);
    if (o.order.status === 'VOID') {
      row.voided += 1;
      continue;
    }
    row.completed += 1;
    row.revenue += Number(o.order.total) || 0;
    row.subtotal += Number(o.order.subtotal) || 0;
    row.discount += Number(o.order.discountTotal) || 0;
    for (const line of linesOf(o.order, catalog)) {
      row.lineRevenue += line.lineTotal;
      row.cogs += lineCost(line);
    }
  }

  const tradingDays = [...days.values()].filter((d) => d.completed > 0).sort((a, b) => a.dayTime - b.dayTime);
  if (tradingDays.length < 4) return null; // need latest + 3 prior

  const latest = tradingDays[tradingDays.length - 1];
  const prior = tradingDays.slice(0, -1);

  const anomalies: FinancialPerformancePayload['anomalies'] = [];
  const windowLabel = `${prior.length} hari dagang sebelumnya`;

  const evaluate = (
    metric: AnomalyMetric,
    label: string,
    actual: number,
    priorValues: number[],
    note: (actualValue: number, expected: number, deltaPct: number) => string
  ): void => {
    if (priorValues.length < 3) return;
    const expected = meanOf(priorValues);
    const sd = stdDevOf(priorValues, expected);
    // Never divide by a zero stddev: fall back to a 15% band around the mean.
    const denominator = sd > 1e-9 ? sd : Math.abs(expected) * 0.15;
    if (denominator <= 1e-9) return;
    let zScore = (actual - expected) / denominator;
    if (!Number.isFinite(zScore)) return;
    zScore = Math.max(-9, Math.min(9, zScore));
    if (Math.abs(zScore) < 1.5) return;

    const deltaPct = expected !== 0 ? ((actual - expected) / Math.abs(expected)) * 100 : actual !== 0 ? 100 : 0;
    anomalies.push({
      metric,
      label,
      actual: round2(actual),
      expected: round2(expected),
      deltaPct: round2(deltaPct),
      direction: actual >= expected ? 'ABOVE' : 'BELOW',
      zScore: round2(zScore),
      window: windowLabel,
      note: note(actual, expected, deltaPct),
    });
  };

  const dayName = shortDate(latest.dayTime);

  evaluate(
    'REVENUE',
    'Omzet harian',
    latest.revenue,
    prior.map((d) => d.revenue),
    (a, e, dp) => `Omzet ${dayName} ${formatRupiah(a)}, biasanya ${formatRupiah(e)} (${dp >= 0 ? '+' : ''}${num(dp)}%).`
  );

  evaluate(
    'AVG_TICKET',
    'Rata-rata struk',
    safeDiv(latest.revenue, latest.completed),
    prior.map((d) => safeDiv(d.revenue, d.completed)),
    (a, e, dp) => `Rata-rata belanja per struk ${formatRupiah(a)}, biasanya ${formatRupiah(e)} (${dp >= 0 ? '+' : ''}${num(dp)}%).`
  );

  evaluate(
    'VOID_RATE',
    'Tingkat void',
    pctOf(latest.voided, latest.completed + latest.voided),
    prior.map((d) => pctOf(d.voided, d.completed + d.voided)),
    (a, e) => `Void ${num(a)}% dari transaksi hari itu, biasanya ${num(e)}%. Cek alasan pembatalannya.`
  );

  evaluate(
    'DISCOUNT_RATE',
    'Tingkat diskon',
    pctOf(latest.discount, latest.subtotal),
    prior.map((d) => pctOf(d.discount, d.subtotal)),
    (a, e) => `Diskon terpakai ${num(a)}% dari subtotal, biasanya ${num(e)}%. Pastikan promonya memang disengaja.`
  );

  evaluate(
    'GROSS_MARGIN',
    'Margin kotor',
    pctOf(latest.lineRevenue - latest.cogs, latest.lineRevenue),
    prior.map((d) => pctOf(d.lineRevenue - d.cogs, d.lineRevenue)),
    (a, e) => `Margin kotor ${num(a)}%, biasanya ${num(e)}%. Cek harga modal dan porsi diskon.`
  );

  // Cash variance lives on the shift history, not the order list.
  const shiftByDay = new Map<string, number>();
  for (const shift of snapshot.shifts || []) {
    if (!shift || shift.difference === undefined || shift.difference === null) continue;
    const start = toDate(shift.startTime);
    if (!start) continue;
    const dayTime = startOfDayTime(start);
    if (dayTime < opt.windowStart) continue;
    const key = dateKey(start);
    shiftByDay.set(key, (shiftByDay.get(key) || 0) + (Number(shift.difference) || 0));
  }
  const cashSeries = [...shiftByDay.entries()]
    .map(([key, value]) => ({ dayTime: keyToTime(key), value }))
    .sort((a, b) => a.dayTime - b.dayTime);
  if (cashSeries.length >= 4) {
    const latestCash = cashSeries[cashSeries.length - 1];
    evaluate(
      'CASH_VARIANCE',
      'Selisih kas',
      latestCash.value,
      cashSeries.slice(0, -1).map((c) => c.value),
      (a, e) => `Selisih kas ${formatRupiah(a)}, biasanya ${formatRupiah(e)}. Cek serah terima shift dan struk tunai.`
    );
  }

  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  /* --- Spec #5: run rate vs target (the headline) ------------------------ */
  const allOrders = datedOrders(snapshot.orders || []);
  const { target, source: targetSource } = resolveMonthlyTarget(snapshot, options);
  const mtdRevenue = round0(revenueOfMonth(allOrders, opt.now.getFullYear(), opt.now.getMonth()));

  const dayOfMonth = opt.now.getDate();
  const daysInMonth = new Date(opt.now.getFullYear(), opt.now.getMonth() + 1, 0).getDate();
  const expectedPct = round2(pctOf(dayOfMonth, daysInMonth));
  const hasTarget = target > 0;

  const runRatePct = hasTarget ? round2(pctOf(mtdRevenue, target)) : 0;
  const gapPct = hasTarget ? round2(runRatePct - expectedPct) : 0;
  // Straight-line projection: what the month ends at if the current daily pace holds.
  const projectedMonthEnd = dayOfMonth > 0 ? round0(safeDiv(mtdRevenue, dayOfMonth) * daysInMonth) : 0;
  const projectedGapIdr = hasTarget ? round0(projectedMonthEnd - target) : 0;
  const onTrack = hasTarget ? runRatePct >= expectedPct : true;
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const dailyRunRateNeeded =
    hasTarget && daysLeft > 0 ? round0(Math.max(0, target - mtdRevenue) / daysLeft) : 0;

  // Nothing to say at all: no target to track AND no statistical signal.
  if (!hasTarget && anomalies.length === 0) return null;

  const monthLabel = opt.now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const payload: FinancialPerformancePayload = {
    kind: 'FINANCIAL_PERFORMANCE',
    monthLabel,
    dayOfMonth,
    daysInMonth,
    mtdRevenue,
    monthlyTarget: target,
    targetSource,
    runRatePct,
    expectedPct,
    gapPct,
    projectedMonthEnd,
    projectedGapIdr,
    onTrack,
    dailyRunRateNeeded,
    anomalies,
  };

  const autoNote = targetSource === 'AUTO' ? ' (target otomatis dari rata-rata bulan sebelumnya)' : '';

  let priority: InsightPriority = 3;
  let title = 'Ringkasan performa keuangan';
  let summary = '';
  let metric = monthLabel;

  if (hasTarget && !onTrack) {
    // Spec #5: behind the straight-line pace is a HIGH priority negative anomaly.
    priority = 1;
    title = 'Omzet di bawah pace target bulan ini';
    metric = `${num(runRatePct)}% dari target`;
    summary = `Baru ${num(runRatePct)}% dari target ${formatRupiah(target)}${autoNote}, padahal hari ke-${dayOfMonth} seharusnya sudah ${num(expectedPct)}%. Perlu ${formatRupiah(dailyRunRateNeeded)}/hari selama ${daysLeft} hari tersisa untuk mengejar.`;
  } else if (hasTarget) {
    priority = anomalies.length > 0 && Math.abs(anomalies[0].zScore) >= 2.5 ? 2 : 3;
    title = 'Omzet on-track terhadap target';
    metric = `${num(runRatePct)}% dari target`;
    summary = `Sudah ${num(runRatePct)}% dari target ${formatRupiah(target)}${autoNote} di hari ke-${dayOfMonth} (pace seharusnya ${num(expectedPct)}%). Proyeksi akhir bulan ${formatRupiah(projectedMonthEnd)}.`;
  } else {
    const top = anomalies[0];
    priority = Math.abs(top.zScore) >= 2.5 ? 1 : 2;
    title = top.direction === 'ABOVE' ? 'Ada lonjakan yang perlu dicek' : 'Ada penurunan yang perlu dicek';
    metric = `${anomalies.length} sinyal`;
    summary = `${anomalies.length} angka keluar dari kebiasaan pada ${dayName}. Paling menonjol: ${top.label} ${top.direction === 'ABOVE' ? 'naik' : 'turun'} ${num(Math.abs(top.deltaPct))}% dari rata-rata ${prior.length} hari sebelumnya.`;
  }

  if (hasTarget && anomalies.length > 0) {
    summary += ` Ada juga ${anomalies.length} angka harian yang keluar kebiasaan.`;
  }

  return buildInsight(
    snapshot,
    opt,
    'FINANCIAL_PERFORMANCE',
    priority,
    title,
    summary,
    metric,
    payload,
    [
      { label: 'Buka laporan', kind: 'OPEN_REPORTS', params: { metric: anomalies[0]?.metric ?? 'REVENUE', date: dateKey(new Date(latest.dayTime)) } },
      { label: 'Tanya strategi', kind: 'ASK_ASSISTANT', params: { query: 'progres target bulan ini bagaimana?' } },
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* 6. LAYOUT / DENAH UTILISATION                                              */
/* -------------------------------------------------------------------------- */

export function computeLayoutInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const tables = (snapshot.tables || []).filter((t) => !!t && !!t.id);
  if (tables.length === 0) return null;

  const noun = snapshot.slotNoun || 'Meja';
  const completed = datedOrders(snapshot.orders || []).filter(
    (o) => o.order.status === 'COMPLETED' && inWindow(o, opt)
  );

  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const t of tables) {
    byId.set(t.id, t.id);
    const n = normName(t.name);
    if (n && !byName.has(n)) byName.set(n, t.id);
  }

  const slotOrders = new Map<string, number>();
  const slotRevenue = new Map<string, number>();
  const activeDays = new Set<string>();

  for (const o of completed) {
    activeDays.add(o.dayKey);
    const resolved =
      (o.order.tableId ? byId.get(o.order.tableId) : undefined) || byName.get(normName(o.order.tableName));
    if (!resolved) continue; // ad-hoc slot that no longer exists on the floor plan
    slotOrders.set(resolved, (slotOrders.get(resolved) || 0) + 1);
    slotRevenue.set(resolved, (slotRevenue.get(resolved) || 0) + (Number(o.order.total) || 0));
  }

  const daysActive = Math.max(1, activeDays.size);

  const slots: LayoutUtilisationPayload['slots'] = tables.map((t) => {
    const ordersCount = slotOrders.get(t.id) || 0;
    const revenue = slotRevenue.get(t.id) || 0;
    const capacity = Number(t.capacity) || 0;
    return {
      slotId: t.id,
      name: t.name || noun,
      zone: t.zone || 'Tanpa Zona',
      capacity,
      orders: ordersCount,
      revenue: round0(revenue),
      turnover: round2(safeDiv(ordersCount, daysActive)),
      revenuePerSeat: capacity > 0 ? round0(revenue / capacity) : 0,
      status: t.status,
    };
  });

  const totalRevenue = slots.reduce((acc, s) => acc + s.revenue, 0);
  const zoneMap = new Map<string, { slots: number; orders: number; revenue: number }>();
  for (const s of slots) {
    const row = zoneMap.get(s.zone) || { slots: 0, orders: 0, revenue: 0 };
    row.slots += 1;
    row.orders += s.orders;
    row.revenue += s.revenue;
    zoneMap.set(s.zone, row);
  }
  const zones: LayoutUtilisationPayload['zones'] = [...zoneMap.entries()]
    .map(([zone, row]) => ({
      zone,
      slots: row.slots,
      orders: row.orders,
      revenue: row.revenue,
      sharePct: pctOf(row.revenue, totalRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const deadSlots = slots.filter((s) => s.orders === 0).map((s) => s.name);
  const occupiedNow = tables.filter((t) => t.status === 'OCCUPIED' || t.status === 'BILLING').length;
  const totalSlots = tables.length;

  const ranked = [...slots].sort((a, b) => b.revenue - a.revenue);
  const best = ranked[0];
  const bestZone = zones[0];

  if (totalRevenue <= 0 && deadSlots.length === totalSlots) {
    // Genuinely no floor-plan activity to talk about yet.
    return null;
  }

  const hint =
    deadSlots.length > 0
      ? `${deadSlots.length} ${noun} belum menghasilkan sama sekali (${deadSlots.slice(0, 3).join(', ')}${deadSlots.length > 3 ? ', dll' : ''}). Arahkan tamu ke sana saat ${best.name} penuh, atau pindahkan menu andalan ke zona ${bestZone ? bestZone.zone : '-'}.`
      : `Semua ${noun} terpakai. ${best.name} paling produktif (${formatRupiah(best.revenue)} dari ${best.orders} order). Pertimbangkan menambah ${noun} di zona ${bestZone ? bestZone.zone : '-'}.`;

  const summary = `${best.name} menyumbang ${formatRupiah(best.revenue)} dari ${best.orders} order (${num(pctOf(best.revenue, totalRevenue))}% omzet ${noun.toLowerCase()}). ${deadSlots.length} ${noun} masih kosong sepanjang ${opt.windowDays} hari terakhir.`;

  const priority: InsightPriority = deadSlots.length > 0 ? 2 : 3;

  const payload: LayoutUtilisationPayload = {
    kind: 'LAYOUT_UTILISATION',
    slotNoun: noun,
    slots: ranked,
    zones,
    deadSlots,
    occupiedNow,
    totalSlots,
    hint,
  };

  return buildInsight(
    snapshot,
    opt,
    'LAYOUT_UTILISATION',
    priority,
    `Pemakaian ${noun} belum merata`,
    summary,
    `${occupiedNow}/${totalSlots} ${noun}`,
    payload,
    [
      { label: `Buka Denah ${noun}`, kind: 'OPEN_TABLES', params: { focusSlotId: best.slotId } },
      { label: 'Lihat laporan', kind: 'OPEN_REPORTS', params: { tab: 'layout' } },
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* 7. STAFF BEHAVIOUR                                                         */
/* -------------------------------------------------------------------------- */

function attendanceInWindow(records: AttendanceRecord[], opt: ResolvedOptions): AttendanceRecord[] {
  const out: AttendanceRecord[] = [];
  for (const r of records || []) {
    const clockIn = toDate(r?.clockInTime);
    if (!clockIn) continue;
    if (startOfDayTime(clockIn) < opt.windowStart) continue;
    out.push(r);
  }
  return out;
}

export function computeStaffBehaviourInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const staffList = (snapshot.staff || []).filter((s) => !!s && !!s.id);
  if (staffList.length === 0) return null;

  const catalog = buildCatalog(snapshot.products || []);
  const completed = datedOrders(snapshot.orders || []).filter(
    (o) => o.order.status === 'COMPLETED' && inWindow(o, opt)
  );
  const records = attendanceInWindow(snapshot.attendance || [], opt);

  const staffById = new Map<string, string>();
  const staffByName = new Map<string, string>();
  for (const s of staffList) {
    staffById.set(s.id, s.id);
    const n = normName(s.name);
    if (n && !staffByName.has(n)) staffByName.set(n, s.id);
  }

  interface StaffAgg {
    orders: number;
    revenue: number;
    items: number;
    shifts: number;
    hours: number;
    late: number;
    offSite: number;
    presentDays: Set<string>;
  }
  const agg = new Map<string, StaffAgg>();
  const ensure = (id: string): StaffAgg => {
    let row = agg.get(id);
    if (!row) {
      row = { orders: 0, revenue: 0, items: 0, shifts: 0, hours: 0, late: 0, offSite: 0, presentDays: new Set<string>() };
      agg.set(id, row);
    }
    return row;
  };
  for (const s of staffList) ensure(s.id);

  for (const o of completed) {
    const resolved =
      (o.order.servedByStaffId ? staffById.get(o.order.servedByStaffId) : undefined) ||
      staffByName.get(normName(o.order.servedByStaffName));
    if (!resolved) continue;
    const row = ensure(resolved);
    row.orders += 1;
    row.revenue += Number(o.order.total) || 0;
    for (const line of linesOf(o.order, catalog)) row.items += line.qty;
  }

  const operatingDays = new Set<string>();
  for (const r of records) {
    const clockIn = toDate(r.clockInTime);
    if (!clockIn) continue;
    const dayKeyValue = dateKey(clockIn);
    operatingDays.add(dayKeyValue);

    const resolved = (r.staffId ? staffById.get(r.staffId) : undefined) || staffByName.get(normName(r.staffName));
    if (!resolved) continue;
    const row = ensure(resolved);
    row.shifts += 1;
    row.presentDays.add(dayKeyValue);

    const clockOut = toDate(r.clockOutTime);
    if (clockOut) {
      const hours = (clockOut.getTime() - clockIn.getTime()) / 3_600_000;
      if (Number.isFinite(hours) && hours > 0) row.hours += Math.min(24, hours);
    }
    // Late = clocked in after 09:00 local.
    const h = clockIn.getHours();
    const m = clockIn.getMinutes();
    if (h > 9 || (h === 9 && (m > 0 || clockIn.getSeconds() > 0))) row.late += 1;
    if (r.clockInGeo && r.clockInGeo.isWithinRadius === false) row.offSite += 1;
  }

  const dayDenominator = Math.max(1, operatingDays.size);

  const rows: StaffBehaviourPayload['staff'] = staffList.map((s) => {
    const row = ensure(s.id);
    const avgTicket = safeDiv(row.revenue, row.orders);
    const itemsPerOrder = safeDiv(row.items, row.orders);
    const revenuePerHour = row.hours > 0 ? row.revenue / row.hours : 0;
    const attendanceRatePct = Math.min(100, pctOf(row.presentDays.size, dayDenominator));

    const notes: string[] = [];
    if (row.orders > 0) notes.push(`${row.orders} order, rata-rata ${formatRupiah(avgTicket)} per struk`);
    else notes.push('belum ada order atas namanya');
    if (row.hours > 0) notes.push(`${num(row.hours)} jam kerja`);
    if (row.late > 0) notes.push(`${row.late}x clock-in lewat jam 09:00`);
    if (row.offSite > 0) notes.push(`${row.offSite}x absen di luar radius toko`);

    return {
      staffId: s.id,
      name: s.name,
      role: s.role,
      ordersServed: row.orders,
      revenue: round0(row.revenue),
      avgTicket: round0(avgTicket),
      itemsPerOrder: round2(itemsPerOrder),
      shiftsWorked: row.shifts,
      hoursWorked: round2(row.hours),
      revenuePerHour: round0(revenuePerHour),
      lateClockIns: row.late,
      offSiteClockIns: row.offSite,
      attendanceRatePct,
      note: `${notes.join(', ')}.`,
    };
  });

  const hasActivity = rows.some((r) => r.ordersServed > 0 || r.shiftsWorked > 0);
  if (!hasActivity) return null;

  // Top performer: revenue per hour, but only for staff who actually sold.
  const withOrders = rows.filter((r) => r.ordersServed >= 1);
  const withHours = withOrders.filter((r) => r.hoursWorked > 0);
  const performerPool = withHours.length > 0 ? withHours : withOrders;
  const topRow = performerPool.length > 0
    ? [...performerPool].sort((a, b) =>
        withHours.length > 0 ? b.revenuePerHour - a.revenuePerHour : b.revenue - a.revenue
      )[0]
    : null;
  const topPerformer = topRow ? topRow.name : null;

  // Needs coaching: lowest average ticket, but only when there is a real
  // comparison to make. Never name-and-shame on a single data point.
  const coachPool = rows.filter((r) => r.ordersServed >= 3);
  let coachRow: StaffBehaviourPayload['staff'][number] | null = null;
  if (coachPool.length >= 2) {
    coachRow = [...coachPool].sort((a, b) => a.avgTicket - b.avgTicket)[0];
  } else {
    const attendancePool = rows.filter((r) => r.shiftsWorked >= 3 && (r.lateClockIns > 0 || r.offSiteClockIns > 0));
    if (attendancePool.length >= 2) {
      coachRow = [...attendancePool].sort(
        (a, b) => b.lateClockIns + b.offSiteClockIns - (a.lateClockIns + a.offSiteClockIns)
      )[0];
    }
  }
  const needsCoaching = coachRow ? coachRow.name : null;

  const totalLate = rows.reduce((acc, r) => acc + r.lateClockIns, 0);
  const totalOffSite = rows.reduce((acc, r) => acc + r.offSiteClockIns, 0);

  const bits: string[] = [];
  if (topRow) {
    bits.push(
      topRow.hoursWorked > 0
        ? `${topRow.name} paling produktif: ${formatRupiah(topRow.revenuePerHour)} per jam dari ${topRow.ordersServed} order`
        : `${topRow.name} paling banyak menjual: ${formatRupiah(topRow.revenue)} dari ${topRow.ordersServed} order`
    );
  }
  if (coachRow) bits.push(`${coachRow.name} perlu didampingi (rata-rata ${formatRupiah(coachRow.avgTicket)} per struk)`);
  if (totalLate > 0) bits.push(`${totalLate}x clock-in lewat jam 09:00`);
  if (totalOffSite > 0) bits.push(`${totalOffSite}x absen di luar radius toko`);
  if (bits.length === 0) return null;

  const priority: InsightPriority = totalOffSite > 0 ? 1 : coachRow || totalLate > 0 ? 2 : 3;

  const payload: StaffBehaviourPayload = {
    kind: 'STAFF_BEHAVIOUR',
    staff: [...rows].sort((a, b) => b.revenue - a.revenue),
    topPerformer,
    needsCoaching,
  };

  return buildInsight(
    snapshot,
    opt,
    'STAFF_BEHAVIOUR',
    priority,
    'Catatan kinerja & kehadiran tim',
    `${bits.join('. ')}.`,
    `${rows.filter((r) => r.shiftsWorked > 0 || r.ordersServed > 0).length} staf aktif`,
    payload,
    [
      { label: 'Lihat laporan staf', kind: 'OPEN_REPORTS', params: { tab: 'staff' } },
      { label: 'Tanya detail staf', kind: 'ASK_ASSISTANT', params: { query: 'siapa staf terbaik bulan ini?' } },
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* AGGREGATES                                                                 */
/* -------------------------------------------------------------------------- */

export function computeAggregates(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantAggregates {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const all = datedOrders(snapshot.orders || []);
  const windowed = all.filter((o) => inWindow(o, opt));
  const completed = windowed.filter((o) => o.order.status === 'COMPLETED');
  const voided = windowed.filter((o) => o.order.status === 'VOID');

  // Month-to-date is a calendar-month figure, deliberately independent of the
  // rolling analysis window — a 7-day window must not shrink the MTD number.
  const mtdRevenue = round0(revenueOfMonth(all, opt.now.getFullYear(), opt.now.getMonth()));
  const daysInThisMonth = new Date(opt.now.getFullYear(), opt.now.getMonth() + 1, 0).getDate();
  const targetInfo = resolveMonthlyTarget(snapshot, options);

  let revenueTotal = 0;
  let subtotalTotal = 0;
  let discountTotal = 0;
  let lineRevenue = 0;
  let cogs = 0;
  let revenueToday = 0;
  let ordersToday = 0;

  const productAgg = new Map<string, { name: string; qty: number; revenue: number }>();
  const paymentAgg = new Map<string, { orders: number; revenue: number }>();
  const orderTypeAgg = new Map<string, { orders: number; revenue: number }>();
  const categoryAgg = new Map<string, { name: string; qty: number; revenue: number }>();
  const dayAgg = new Map<string, { orders: number; revenue: number }>();

  const categoryNameById = new Map<string, string>();
  for (const c of snapshot.categories || []) {
    if (c?.id) categoryNameById.set(c.id, c.name);
  }

  for (const o of completed) {
    const total = Number(o.order.total) || 0;
    revenueTotal += total;
    subtotalTotal += Number(o.order.subtotal) || 0;
    discountTotal += Number(o.order.discountTotal) || 0;

    if (o.dayTime === opt.todayStart) {
      revenueToday += total;
      ordersToday += 1;
    }

    const day = dayAgg.get(o.dayKey) || { orders: 0, revenue: 0 };
    day.orders += 1;
    day.revenue += total;
    dayAgg.set(o.dayKey, day);

    const pay = paymentAgg.get(o.order.paymentMethod) || { orders: 0, revenue: 0 };
    pay.orders += 1;
    pay.revenue += total;
    paymentAgg.set(o.order.paymentMethod, pay);

    const type = orderTypeAgg.get(o.order.orderType) || { orders: 0, revenue: 0 };
    type.orders += 1;
    type.revenue += total;
    orderTypeAgg.set(o.order.orderType, type);

    for (const line of linesOf(o.order, catalog)) {
      lineRevenue += line.lineTotal;
      cogs += lineCost(line);

      const prod = productAgg.get(line.key) || { name: line.product?.name || line.name, qty: 0, revenue: 0 };
      prod.qty += line.qty;
      prod.revenue += line.lineTotal;
      productAgg.set(line.key, prod);

      const catId = line.product?.categoryId || 'cat-lainnya';
      const cat = categoryAgg.get(catId) || {
        name: categoryNameById.get(catId) || 'Lainnya',
        qty: 0,
        revenue: 0,
      };
      cat.qty += line.qty;
      cat.revenue += line.lineTotal;
      categoryAgg.set(catId, cat);
    }
  }

  const ordersAnalysed = completed.length;

  const topProducts = [...productAgg.entries()]
    .map(([productId, v]) => ({ productId, name: v.name, qty: round2(v.qty), revenue: round0(v.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
    .slice(0, 10);

  // Slow movers: catalog products with the least movement in the window,
  // including products that never sold at all.
  const lastSaleByProduct = new Map<string, number>();
  for (const o of all) {
    if (o.order.status !== 'COMPLETED') continue;
    for (const line of linesOf(o.order, catalog)) {
      if (!line.product) continue;
      const prev = lastSaleByProduct.get(line.product.id);
      if (prev === undefined || o.time > prev) lastSaleByProduct.set(line.product.id, o.time);
    }
  }
  const windowQtyByProduct = new Map<string, number>();
  for (const o of completed) {
    for (const line of linesOf(o.order, catalog)) {
      if (!line.product) continue;
      windowQtyByProduct.set(line.product.id, (windowQtyByProduct.get(line.product.id) || 0) + line.qty);
    }
  }
  const slowMovers = (snapshot.products || [])
    .filter((p) => !!p && !!p.id)
    .map((p: Product) => {
      const lastSale = lastSaleByProduct.get(p.id);
      const daysSinceLastSale =
        lastSale === undefined
          ? null
          : Math.max(0, Math.floor((opt.todayStart - startOfDayTime(new Date(lastSale))) / MS_PER_DAY));
      return {
        productId: p.id,
        name: p.name,
        qty: round2(windowQtyByProduct.get(p.id) || 0),
        daysSinceLastSale,
      };
    })
    .sort((a, b) => {
      if (a.qty !== b.qty) return a.qty - b.qty;
      const av = a.daysSinceLastSale === null ? Number.MAX_SAFE_INTEGER : a.daysSinceLastSale;
      const bv = b.daysSinceLastSale === null ? Number.MAX_SAFE_INTEGER : b.daysSinceLastSale;
      return bv - av;
    })
    .slice(0, 10);

  const paymentMix = [...paymentAgg.entries()]
    .map(([method, v]) => ({
      method,
      orders: v.orders,
      revenue: round0(v.revenue),
      sharePct: pctOf(v.revenue, revenueTotal),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const orderTypeMix = [...orderTypeAgg.entries()]
    .map(([orderType, v]) => ({
      orderType,
      orders: v.orders,
      revenue: round0(v.revenue),
      sharePct: pctOf(v.revenue, revenueTotal),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const categoryMix = [...categoryAgg.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      name: v.name,
      qty: round2(v.qty),
      revenue: round0(v.revenue),
      sharePct: pctOf(v.revenue, lineRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const revenueByDay: MerchantAggregates['revenueByDay'] = [];
  for (let i = opt.windowDays - 1; i >= 0; i -= 1) {
    const t = addDays(opt.todayStart, -i);
    const key = dateKey(new Date(t));
    const row = dayAgg.get(key);
    revenueByDay.push({ date: key, orders: row?.orders || 0, revenue: round0(row?.revenue || 0) });
  }

  const customerCounts: Record<CustomerTier | 'TOTAL', number> = { ...EMPTY_TIER_COUNTS };
  for (const c of snapshot.customers || []) {
    if (!c) continue;
    customerCounts.TOTAL += 1;
    if (c.tier && customerCounts[c.tier] !== undefined) customerCounts[c.tier] += 1;
  }

  const stockCritical =
    (snapshot.products || []).filter((p) => p && (Number(p.stock) || 0) <= (Number(p.minStockAlert) || 0)).length +
    (snapshot.stockItems || []).filter((s) => s && (Number(s.stock) || 0) <= (Number(s.minStockAlert) || 0)).length;

  const slotsTotal = (snapshot.tables || []).length;
  const slotsOccupied = (snapshot.tables || []).filter(
    (t) => t && (t.status === 'OCCUPIED' || t.status === 'BILLING')
  ).length;

  const onShift = new Set<string>();
  for (const r of snapshot.attendance || []) {
    if (r && r.status === 'CLOCKED_IN') onShift.add(r.staffId || r.staffName || r.id);
  }

  return {
    windowDays: opt.windowDays,
    ordersAnalysed,
    revenueTotal: round0(revenueTotal),
    revenueToday: round0(revenueToday),
    ordersToday,
    avgTicket: round0(safeDiv(revenueTotal, ordersAnalysed)),
    grossMarginPct: pctOf(lineRevenue - cogs, lineRevenue),
    voidRatePct: pctOf(voided.length, completed.length + voided.length),
    discountRatePct: pctOf(discountTotal, subtotalTotal),
    topProducts,
    slowMovers,
    paymentMix,
    orderTypeMix,
    categoryMix,
    revenueByDay,
    customerCounts,
    stockCritical,
    slotsOccupied,
    slotsTotal,
    staffOnShift: onShift.size,
    mtdRevenue,
    monthlyTarget: targetInfo.target,
    targetSource: targetInfo.target > 0 ? targetInfo.source : 'NONE',
    runRatePct: targetInfo.target > 0 ? round2(pctOf(mtdRevenue, targetInfo.target)) : 0,
    expectedPct: round2(pctOf(opt.now.getDate(), daysInThisMonth)),
  };
}

/* -------------------------------------------------------------------------- */
/* THE BATCH                                                                  */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 8. CALENDAR / PAYDAY BEHAVIOUR (spec algorithm #6)                         */
/* -------------------------------------------------------------------------- */

/** Payday window in Indonesia: days 25-31 and 1-3 of the following month. */
function isPaydayWindow(day: number): boolean {
  return day >= 25 || day <= 3;
}

export function computeCalendarBehaviourInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || []).filter(
    (o) => o.order.status === 'COMPLETED' && inWindow(o, opt)
  );
  if (orders.length === 0) return null;

  let paydayRevenue = 0;
  let normalRevenue = 0;
  let paydayOrders = 0;
  let normalOrders = 0;
  const paydayDays = new Set<string>();
  const normalDays = new Set<string>();
  const paydayProducts = new Map<string, { name: string; qty: number; revenue: number }>();

  for (const o of orders) {
    const total = Number(o.order.total) || 0;
    const day = o.date.getDate();
    if (isPaydayWindow(day)) {
      paydayRevenue += total;
      paydayOrders += 1;
      paydayDays.add(o.dayKey);
      for (const line of linesOf(o.order, catalog)) {
        const row = paydayProducts.get(line.key) || { name: line.name, qty: 0, revenue: 0 };
        row.qty += line.qty;
        row.revenue += line.lineTotal;
        paydayProducts.set(line.key, row);
      }
    } else {
      normalRevenue += total;
      normalOrders += 1;
      normalDays.add(o.dayKey);
    }
  }

  // Both sides need real data, otherwise the ratio is noise dressed as insight.
  if (paydayOrders < opt.minOrdersPerCalendarWindow || normalOrders < opt.minOrdersPerCalendarWindow) {
    return null;
  }

  const paydayAvgBasket = round0(safeDiv(paydayRevenue, paydayOrders));
  const normalAvgBasket = round0(safeDiv(normalRevenue, normalOrders));
  if (normalAvgBasket <= 0) return null;

  const basketUplift = round2(safeDiv(paydayAvgBasket, normalAvgBasket, 1));
  const paydayOrdersPerDay = round2(safeDiv(paydayOrders, Math.max(1, paydayDays.size)));
  const normalOrdersPerDay = round2(safeDiv(normalOrders, Math.max(1, normalDays.size)));
  const volumeUplift = round2(safeDiv(paydayOrdersPerDay, normalOrdersPerDay, 1));

  // One "cycle" ≈ one payday window observed. Under one full cycle the pattern
  // is not yet a pattern.
  const cyclesObserved = Math.max(1, Math.round(paydayDays.size / 7));

  if (basketUplift < opt.paydayUpliftThreshold && volumeUplift < opt.paydayUpliftThreshold) {
    return null;
  }

  const topPaydayProducts = [...paydayProducts.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)
    .map((p) => ({ name: p.name, qty: p.qty, revenue: round0(p.revenue) }));

  // Next 25th, relative to now.
  const nextPayday =
    opt.now.getDate() < 25
      ? new Date(opt.now.getFullYear(), opt.now.getMonth(), 25)
      : new Date(opt.now.getFullYear(), opt.now.getMonth() + 1, 25);

  const upliftPct = round1((basketUplift - 1) * 100);
  const payload: CalendarBehaviourPayload = {
    kind: 'CALENDAR_BEHAVIOR',
    paydayWindowLabel: 'Tanggal 25–3 (musim gajian)',
    normalWindowLabel: 'Tanggal 4–24',
    paydayAvgBasket,
    normalAvgBasket,
    basketUplift,
    paydayOrders,
    normalOrders,
    paydayOrdersPerDay,
    normalOrdersPerDay,
    volumeUplift,
    cyclesObserved,
    topPaydayProducts,
    nextPaydayWindowStart: dateKey(nextPayday),
    hint:
      basketUplift >= opt.paydayUpliftThreshold
        ? `Belanja pelanggan naik ${num(upliftPct)}% saat musim gajian. Siapkan stok dan tawarkan paket bundling mulai tanggal 25.`
        : `Jumlah transaksi naik ${num((volumeUplift - 1) * 100)}% saat musim gajian walau nilai per struk mirip. Tambah kapasitas layanan, bukan diskon.`,
  };

  const priority: InsightPriority = basketUplift >= 1.35 || volumeUplift >= 1.35 ? 2 : 3;

  return buildInsight(
    snapshot,
    opt,
    'CALENDAR_BEHAVIOR',
    priority,
    'Pola belanja musim gajian terdeteksi',
    `Rata-rata struk tanggal 25–3 ${formatRupiah(paydayAvgBasket)} vs ${formatRupiah(normalAvgBasket)} di tanggal biasa (${basketUplift >= 1 ? '+' : ''}${num(upliftPct)}%). Musim gajian berikutnya mulai ${shortDate(nextPayday.getTime())}.`,
    `${basketUplift >= 1 ? '+' : ''}${num(upliftPct)}% basket`,
    payload,
    [
      { label: 'Siapkan promo gajian', kind: 'CREATE_PROMO', params: { window: 'PAYDAY' } },
      { label: 'Lihat laporan', kind: 'OPEN_REPORTS', params: { tab: 'calendar' } },
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* 9. SHIFT PERFORMANCE (spec algorithm #7 — formula defined here)            */
/* -------------------------------------------------------------------------- */

export function computeShiftPerformanceInsight(
  snapshot: MerchantSnapshot,
  options?: BatchRunOptions
): MerchantInsight | null {
  const opt = resolveOptions(snapshot, options);

  const closed = (snapshot.shifts || []).filter((s) => {
    if (!s || s.status !== 'CLOSED') return false;
    const start = toDate(s.startTime);
    if (!start) return false;
    return startOfDayTime(start) >= opt.windowStart;
  });
  if (closed.length === 0) return null;

  interface Acc {
    cashierName: string;
    shifts: number;
    ordersServed: number;
    totalSales: number;
    hours: number;
    variances: number[];
    expectedCashTotal: number;
  }

  const byCashier = new Map<string, Acc>();
  for (const s of closed) {
    const name = (s.cashierName || 'Tanpa nama').trim() || 'Tanpa nama';
    const acc =
      byCashier.get(name) ||
      { cashierName: name, shifts: 0, ordersServed: 0, totalSales: 0, hours: 0, variances: [], expectedCashTotal: 0 };

    const start = toDate(s.startTime);
    const end = toDate(s.endTime);
    // A shift with no end time contributes sales but not hours — counting a
    // missing clock-out as a zero-length shift would inflate sales/hour.
    const hours = start && end ? Math.max(0, (end.getTime() - start.getTime()) / 3_600_000) : 0;

    acc.shifts += 1;
    acc.ordersServed += Number(s.totalOrders) || 0;
    acc.totalSales += Number(s.totalSales) || 0;
    acc.hours += hours;
    acc.expectedCashTotal += Number(s.expectedCash) || 0;

    if (typeof s.actualCash === 'number' && Number.isFinite(s.actualCash)) {
      const variance =
        typeof s.difference === 'number' && Number.isFinite(s.difference)
          ? s.difference
          : s.actualCash - (Number(s.expectedCash) || 0);
      acc.variances.push(variance);
    }

    byCashier.set(name, acc);
  }

  const accs = [...byCashier.values()];
  if (accs.length === 0) return null;

  const perHour = accs.map((a) => safeDiv(a.totalSales, a.hours));
  const benchmark = meanOf(perHour.filter((v) => v > 0));
  const sd = stdDevOf(perHour.filter((v) => v > 0), benchmark);

  let bestName: string | null = null;
  let bestRate = -1;

  const cashiers: ShiftPerformancePayload['cashiers'] = accs.map((a) => {
    const salesPerHour = round0(safeDiv(a.totalSales, a.hours));
    const avgTicket = round0(safeDiv(a.totalSales, a.ordersServed));
    const meanCashVariance = a.variances.length > 0 ? round0(meanOf(a.variances)) : 0;
    const worstCashVariance =
      a.variances.length > 0 ? round0(a.variances.reduce((w, v) => (v < w ? v : w), a.variances[0])) : 0;
    const shortages = a.variances.filter((v) => v < 0).length;
    const shortageRate = a.variances.length > 0 ? round2(shortages / a.variances.length) : 0;
    const avgExpectedCash = safeDiv(a.expectedCashTotal, a.shifts);
    const variancePct = round2(pctOf(Math.abs(meanCashVariance), Math.max(1, avgExpectedCash)));

    const judgeable = a.shifts >= opt.minShiftsForJudgement;
    let flag: ShiftPerformancePayload['cashiers'][number]['flag'] = 'OK';
    let note = 'Dalam batas normal.';

    if (judgeable && (variancePct > opt.cashVarianceTolerancePct || shortageRate >= 0.5)) {
      flag = 'CASH_VARIANCE';
      note =
        meanCashVariance < 0
          ? `Rata-rata kas kurang ${formatRupiah(Math.abs(meanCashVariance))} per shift (${num(variancePct)}% dari kas seharusnya). Perlu dicek: prosedur serah terima, struk tunai, atau kembalian.`
          : `Rata-rata kas lebih ${formatRupiah(meanCashVariance)} per shift. Perlu dicek: transaksi yang belum tercatat di kasir.`;
    } else if (judgeable && sd > 0 && salesPerHour > 0 && salesPerHour < benchmark - sd) {
      flag = 'LOW_PRODUCTIVITY';
      note = `Omzet per jam ${formatRupiah(salesPerHour)}, di bawah rata-rata tim ${formatRupiah(round0(benchmark))}. Cocok untuk coaching upselling.`;
    }

    if (salesPerHour > bestRate && flag === 'OK' && a.shifts >= opt.minShiftsForJudgement) {
      bestRate = salesPerHour;
      bestName = a.cashierName;
    }

    return {
      cashierName: a.cashierName,
      shifts: a.shifts,
      ordersServed: a.ordersServed,
      totalSales: round0(a.totalSales),
      hoursWorked: round1(a.hours),
      salesPerHour,
      avgTicket,
      meanCashVariance,
      worstCashVariance,
      shortageRate,
      variancePct,
      flag,
      note,
    };
  });

  for (const c of cashiers) {
    if (bestName && c.cashierName === bestName && cashiers.length > 1) {
      c.flag = 'TOP_PERFORMER';
      c.note = `Omzet per jam tertinggi (${formatRupiah(c.salesPerHour)}) dengan kas bersih.`;
    }
  }

  const flagged = cashiers.filter((c) => c.flag === 'CASH_VARIANCE');
  const totalCashVariance = round0(cashiers.reduce((acc, c) => acc + c.meanCashVariance * c.shifts, 0));

  const priority: InsightPriority = flagged.length > 0 ? 1 : cashiers.length > 1 ? 3 : 3;

  const summary =
    flagged.length > 0
      ? `${flagged.length} kasir punya selisih kas di luar toleransi ${num(opt.cashVarianceTolerancePct)}%. Terbesar: ${flagged[0].cashierName} (rata-rata ${formatRupiah(flagged[0].meanCashVariance)} per shift dari ${flagged[0].shifts} shift).`
      : `${closed.length} shift tertutup dianalisa, selisih kas semua kasir masih dalam toleransi. Omzet per jam rata-rata ${formatRupiah(round0(benchmark))}.`;

  const payload: ShiftPerformancePayload = {
    kind: 'SHIFT_PERFORMANCE',
    shiftsAnalysed: closed.length,
    cashiers: cashiers.sort((a, b) => b.salesPerHour - a.salesPerHour),
    totalCashVariance,
    benchmarkSalesPerHour: round0(benchmark),
    hint:
      flagged.length > 0
        ? 'Selisih kas berulang biasanya soal prosedur, bukan niat. Mulai dari cek ulang serah terima shift dan kembalian sebelum mengambil kesimpulan.'
        : 'Kas rapi. Fokus berikutnya: naikkan omzet per jam lewat upselling di jam ramai.',
  };

  return buildInsight(
    snapshot,
    opt,
    'SHIFT_PERFORMANCE',
    priority,
    flagged.length > 0 ? 'Selisih kas shift perlu dicek' : 'Rekap kinerja shift kasir',
    summary,
    `${closed.length} shift`,
    payload,
    [
      { label: 'Buka laporan shift', kind: 'OPEN_REPORTS', params: { tab: 'shift' } },
      { label: 'Tanya detail kasir', kind: 'ASK_ASSISTANT', params: { query: 'kinerja shift kasir bagaimana?' } },
    ]
  );
}

export function runDailyBatch(snapshot: MerchantSnapshot, options?: BatchRunOptions): BatchRunResult {
  const startedAt = Date.now();
  const opt = resolveOptions(snapshot, options);

  const aggregates = computeAggregates(snapshot, options);

  const produced: (MerchantInsight | null)[] = [
    computeInventoryInsight(snapshot, options),
    computeCrossSellInsight(snapshot, options),
    computeChurnInsight(snapshot, options),
    computePeakHoursInsight(snapshot, options),
    computeFinancialPerformanceInsight(snapshot, options),
    computeCalendarBehaviourInsight(snapshot, options),
    computeShiftPerformanceInsight(snapshot, options),
    computeLayoutInsight(snapshot, options),
    computeStaffBehaviourInsight(snapshot, options),
  ];

  const insights = produced
    .filter((i): i is MerchantInsight => i !== null)
    .sort((a, b) => a.priority - b.priority || a.category.localeCompare(b.category));

  return {
    merchantId: snapshot.merchantId,
    insightDate: dateKey(opt.now),
    generatedAt: opt.now.toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    insights,
    aggregates,
  };
}
