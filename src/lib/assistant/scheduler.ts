import { runDailyBatch } from './insights';
import { BatchRunOptions, BatchRunResult, MerchantSnapshot } from './types';

/**
 * LAYER 1 DRIVER (browser side).
 *
 * The spec calls for a midnight cron job. This deployment keeps merchant data in
 * the browser, so there is no server that can see it at 01:00 — instead the batch
 * runs at most once per calendar day, on first use, and is cached. The analytics
 * themselves live in `insights.ts` and are completely source-agnostic: the Node
 * cron in `scripts/batch/daily-insights.mjs` runs the same maths against Postgres
 * without touching this file.
 *
 * Every localStorage access is defensive: quota exhaustion, Safari private mode
 * and SSR all degrade to an in-memory computation rather than throwing.
 */

const KEY_PREFIX = 'newhope_ai_insights_';
const SCHEMA_VERSION = 1;

interface CachedEnvelope {
  version: number;
  result: BatchRunResult;
}

/** In-memory fallback for when localStorage is unavailable or full. */
const memoryCache = new Map<string, CachedEnvelope>();

function todayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Keyed by the tenant PARTITION KEY (`businessId`), not just the account.
 *
 * Without it a merchant running a cafe and a laundry shares one cache slot:
 * switch business and the assistant serves the other one's insight cards. The
 * freshness check (completed-order count) does not catch it either — two
 * businesses can trivially hold the same number of orders.
 */
function cacheKey(businessId: string, date: string): string {
  return `${KEY_PREFIX}${businessId}_${date}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readCache(key: string): CachedEnvelope | null {
  const mem = memoryCache.get(key);
  if (mem) return mem;

  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEnvelope;
    if (!parsed || parsed.version !== SCHEMA_VERSION || !parsed.result) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key: string, envelope: CachedEnvelope): void {
  memoryCache.set(key, envelope);
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota exceeded or storage disabled — the in-memory copy still serves
    // this session, so there is nothing to recover from here.
  }
}

/** Drop yesterday's runs so the cache cannot grow without bound. */
function pruneOldRuns(businessId: string, keepDate: string): void {
  const keep = cacheKey(businessId, keepDate);
  for (const k of Array.from(memoryCache.keys())) {
    if (k.startsWith(`${KEY_PREFIX}${businessId}_`) && k !== keep) memoryCache.delete(k);
  }

  const store = safeStorage();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k) continue;
      if (k.startsWith(`${KEY_PREFIX}${businessId}_`) && k !== keep) doomed.push(k);
    }
    doomed.forEach((k) => store.removeItem(k));
  } catch {
    // Non-fatal: stale keys are harmless, they are date-scoped.
  }
}

function completedOrderCount(snapshot: MerchantSnapshot): number {
  let n = 0;
  for (const o of snapshot.orders) if (o.status === 'COMPLETED') n++;
  return n;
}

/**
 * Returns today's batch result, recomputing only when it is genuinely stale.
 *
 * Cache is reused when it was produced today AND the number of completed orders
 * has not changed — a new sale must invalidate the insight set, otherwise the
 * assistant would quote yesterday's numbers back at the merchant.
 */
export function ensureDailyInsights(
  snapshot: MerchantSnapshot,
  options: BatchRunOptions = {}
): BatchRunResult {
  const now = options.now || new Date(snapshot.generatedAt) || new Date();
  const date = todayKey(now);
  const key = cacheKey(snapshot.businessId, date);

  const cached = readCache(key);
  if (cached && cached.result.aggregates.ordersAnalysed === completedOrderCount(snapshot)) {
    return cached.result;
  }

  let result: BatchRunResult;
  try {
    result = runDailyBatch(snapshot, options);
  } catch (err) {
    // A failed batch must never take the assistant down — Layer 2 can still
    // answer from the live snapshot, it just loses the pre-computed cards.
    console.error('[SmartAssistant] batch run failed:', err);
    return {
      merchantId: snapshot.merchantId,
      insightDate: date,
      generatedAt: now.toISOString(),
      durationMs: 0,
      insights: [],
      aggregates: {
        windowDays: options.windowDays ?? 30,
        ordersAnalysed: 0,
        revenueTotal: 0,
        revenueToday: 0,
        ordersToday: 0,
        avgTicket: 0,
        grossMarginPct: 0,
        voidRatePct: 0,
        discountRatePct: 0,
        topProducts: [],
        slowMovers: [],
        paymentMix: [],
        orderTypeMix: [],
        categoryMix: [],
        revenueByDay: [],
        customerCounts: { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0, TOTAL: 0 },
        stockCritical: 0,
        slotsOccupied: 0,
        slotsTotal: 0,
        staffOnShift: 0,
        mtdRevenue: 0,
        monthlyTarget: 0,
        targetSource: 'NONE',
        runRatePct: 0,
        expectedPct: 0,
      },
    };
  }

  writeCache(key, { version: SCHEMA_VERSION, result });
  pruneOldRuns(snapshot.businessId, date);
  return result;
}

/** Force the next `ensureDailyInsights` call to recompute. */
export function invalidateDailyInsights(businessId: string): void {
  for (const k of Array.from(memoryCache.keys())) {
    if (k.startsWith(`${KEY_PREFIX}${businessId}_`)) memoryCache.delete(k);
  }
  const store = safeStorage();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(`${KEY_PREFIX}${businessId}_`)) doomed.push(k);
    }
    doomed.forEach((k) => store.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Peek at the cached run without triggering a recompute.
 * Takes the tenant partition key — a merchant's cafe and laundry keep separate
 * caches, so passing only the account id would be ambiguous.
 */
export function getCachedInsights(
  businessId: string,
  now: Date = new Date()
): BatchRunResult | null {
  const cached = readCache(cacheKey(businessId, todayKey(now)));
  return cached ? cached.result : null;
}
