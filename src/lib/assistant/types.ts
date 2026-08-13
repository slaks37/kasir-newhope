/**
 * SMART ASSISTANT ENGINE — SHARED CONTRACT
 * =========================================
 * Every layer of the hybrid assistant pipeline codes against this file.
 *
 *   LAYER 1  Batch Learning Engine   -> insights.ts   (runDailyBatch)
 *   LAYER 2  Intent Routing Engine   -> intents.ts    (parseIntent / resolveIntent)
 *   LAYER 3  LLM Fallback + Credits  -> server.ts     (/api/v1/assistant/query)
 *
 * Design rule: the engine never touches React, localStorage, or SQL directly.
 * It consumes a `MerchantSnapshot` (plain data) and returns plain data, so the
 * exact same code runs in the browser (localStorage adapter) and in a Node cron
 * job (Postgres adapter).
 */

import {
  AttendanceRecord,
  BusinessSector,
  Category,
  Customer,
  CustomerTier,
  InventoryLog,
  Order,
  Product,
  PromoCode,
  Shift,
  StaffMember,
  StockItem,
  StoreSettings,
  Table,
  UserRole,
} from '../../types';

/* -------------------------------------------------------------------------- */
/* MERCHANT SNAPSHOT — the data surface the assistant is allowed to read       */
/* -------------------------------------------------------------------------- */

/**
 * The complete merchant data surface. This is what "terhubung langsung dengan
 * data toko" actually means: sales, inventory (finished goods + raw materials +
 * mutation log), floor plan / denah, customers, staff and their attendance
 * behaviour, shifts, and promos.
 */
export interface MerchantSnapshot {
  /**
   * PARTITION KEY of the business unit this snapshot describes.
   * Every array below must contain only rows belonging to it.
   */
  businessId: string;
  merchantId: string;
  tenantId: string;
  /** Role of the user asking. Shapes how the assistant answers. */
  userRole: UserRole;
  generatedAt: string; // ISO timestamp
  businessSector: BusinessSector;
  storeName: string;
  /** Sector-aware noun for a floor-plan slot: "Meja", "Rak", "Bay", "Kursi". */
  slotNoun: string;

  categories: Category[];
  products: Product[];
  stockItems: StockItem[];
  inventoryLogs: InventoryLog[];

  /** All orders, every status. Engines filter to COMPLETED themselves. */
  orders: Order[];

  customers: Customer[];
  tables: Table[];
  staff: StaffMember[];
  attendance: AttendanceRecord[];
  shifts: Shift[];
  currentShift: Shift;
  promoCodes: PromoCode[];
  settings: StoreSettings;
}

/* -------------------------------------------------------------------------- */
/* LAYER 1 — BATCH LEARNING OUTPUT                                            */
/* -------------------------------------------------------------------------- */

/**
 * Superset of the 7 categories in the spec.
 *
 * Naming follows the spec (OPERATIONAL_PEAK, FINANCIAL_PERFORMANCE) so the
 * database enum, the docs and the code agree. Two extras are carried because
 * the product explicitly needs them and the spec's list cannot express them:
 *
 *   LAYOUT_UTILISATION — denah / floor-plan turnover (meja, bay, kursi, rak)
 *   STAFF_BEHAVIOUR    — per-staff service performance + attendance behaviour
 *
 * STAFF_BEHAVIOUR vs SHIFT_PERFORMANCE is a real distinction, not a duplicate:
 * the former is about the person serving customers (barista, kapster) measured
 * from order attribution and clock-ins; the latter is about the till — cash
 * variance and throughput of a cashier's shift session.
 */
export type InsightCategory =
  | 'INVENTORY_ALERT'
  | 'CROSS_SELL_OPPORTUNITY'
  | 'CRM_CHURN'
  | 'OPERATIONAL_PEAK'
  | 'FINANCIAL_PERFORMANCE'
  | 'CALENDAR_BEHAVIOR'
  | 'SHIFT_PERFORMANCE'
  | 'LAYOUT_UTILISATION'
  | 'STAFF_BEHAVIOUR';

/** 1 = HIGH, 2 = MEDIUM, 3 = LOW. */
export type InsightPriority = 1 | 2 | 3;

export type InsightStatus = 'ACTIVE' | 'DISMISSED' | 'ACTIONED';

export interface InventoryAlertPayload {
  kind: 'INVENTORY_ALERT';
  items: {
    itemId: string;
    name: string;
    itemKind: 'PRODUCT' | 'STOCK_ITEM';
    unit: string;
    currentStock: number;
    /** Average Daily Consumption, blended across 7/14/30-day windows. */
    avgDailyConsumption: number;
    adc7: number;
    adc14: number;
    adc30: number;
    /** Consumption trend multiplier: >1 accelerating, <1 decelerating. */
    trendFactor: number;
    daysOfCover: number;
    /** Dynamic Reorder Point = ADC x leadTimeDays + safety stock. */
    reorderPoint: number;
    safetyStock: number;
    suggestedReorderQty: number;
    projectedStockoutDate: string | null;
    severity: 'OUT_OF_STOCK' | 'CRITICAL' | 'BELOW_ROP' | 'WATCH';
  }[];
}

export interface CrossSellPayload {
  kind: 'CROSS_SELL_OPPORTUNITY';
  basketCount: number;
  pairs: {
    aId: string;
    aName: string;
    bId: string;
    bName: string;
    coOccurrence: number;
    /** P(A and B) */
    support: number;
    /** P(B | A) */
    confidence: number;
    /** confidence / P(B) — >1 means a genuine association. */
    lift: number;
    bundlePriceSuggestion: number | null;
  }[];
}

export interface CrmChurnPayload {
  kind: 'CRM_CHURN';
  customers: {
    customerId: string;
    name: string;
    phone: string;
    tier: CustomerTier;
    recencyDays: number;
    frequency: number;
    monetary: number;
    rScore: number;
    fScore: number;
    mScore: number;
    rfmScore: number;
    segment: 'CHAMPION' | 'LOYAL' | 'POTENTIAL' | 'AT_RISK' | 'HIBERNATING' | 'LOST' | 'NEW';
    avgTicket: number;
    favouriteProduct: string | null;
    suggestedOffer: string;
  }[];
}

export interface PeakHoursPayload {
  kind: 'OPERATIONAL_PEAK';
  byHour: { hour: number; label: string; orders: number; revenue: number }[];
  byDayOfWeek: { dayIndex: number; label: string; orders: number; revenue: number }[];
  peakWindows: { label: string; startHour: number; endHour: number; revenue: number; orders: number }[];
  quietWindows: { label: string; startHour: number; endHour: number; revenue: number; orders: number }[];
  busiestDay: string | null;
  staffingHint: string;
}

/**
 * Merged deliberately. The spec's UNIQUE (merchant_id, insight_date, category)
 * allows exactly one row per category per day, and "apakah keuangan saya sehat?"
 * is one merchant question — so run-rate-vs-target is the headline and the
 * statistical anomalies are the supporting detail on the same card.
 */
export interface FinancialPerformancePayload {
  kind: 'FINANCIAL_PERFORMANCE';

  /* --- Run rate vs target (spec algorithm #5) --- */
  monthLabel: string;
  dayOfMonth: number;
  daysInMonth: number;
  mtdRevenue: number;
  monthlyTarget: number;
  /**
   * AUTO = derived from the trailing 3 complete months x growth factor.
   * A target the merchant must type in is a target most UMKM never set, which
   * would leave this card permanently empty. Auto-target makes it work on day 1.
   */
  targetSource: 'MERCHANT' | 'AUTO';
  runRatePct: number;
  expectedPct: number;
  gapPct: number;
  projectedMonthEnd: number;
  projectedGapIdr: number;
  onTrack: boolean;
  dailyRunRateNeeded: number;

  /* --- Statistical anomalies (supporting) --- */
  anomalies: {
    metric: 'REVENUE' | 'AVG_TICKET' | 'VOID_RATE' | 'DISCOUNT_RATE' | 'GROSS_MARGIN' | 'CASH_VARIANCE';
    label: string;
    actual: number;
    expected: number;
    deltaPct: number;
    direction: 'ABOVE' | 'BELOW';
    /** Standard deviations from the trailing mean. */
    zScore: number;
    window: string;
    note: string;
  }[];
}

export interface LayoutUtilisationPayload {
  kind: 'LAYOUT_UTILISATION';
  slotNoun: string;
  slots: {
    slotId: string;
    name: string;
    zone: string;
    capacity: number;
    orders: number;
    revenue: number;
    /** Orders served per slot over the window. */
    turnover: number;
    revenuePerSeat: number;
    status: string;
  }[];
  zones: { zone: string; slots: number; orders: number; revenue: number; sharePct: number }[];
  deadSlots: string[];
  occupiedNow: number;
  totalSlots: number;
  hint: string;
}

export interface StaffBehaviourPayload {
  kind: 'STAFF_BEHAVIOUR';
  staff: {
    staffId: string;
    name: string;
    role: string;
    ordersServed: number;
    revenue: number;
    avgTicket: number;
    itemsPerOrder: number;
    shiftsWorked: number;
    hoursWorked: number;
    revenuePerHour: number;
    lateClockIns: number;
    offSiteClockIns: number;
    attendanceRatePct: number;
    note: string;
  }[];
  topPerformer: string | null;
  needsCoaching: string | null;
}

/** Spec algorithm #6 — Indonesian payday (gajian) cycle behaviour. */
export interface CalendarBehaviourPayload {
  kind: 'CALENDAR_BEHAVIOR';
  /** Days 25-31 + 1-3 of each month. */
  paydayWindowLabel: string;
  /** Days 4-24. */
  normalWindowLabel: string;
  paydayAvgBasket: number;
  normalAvgBasket: number;
  /** paydayAvgBasket / normalAvgBasket. > 1.20 triggers the insight. */
  basketUplift: number;
  paydayOrders: number;
  normalOrders: number;
  paydayOrdersPerDay: number;
  normalOrdersPerDay: number;
  volumeUplift: number;
  /** How many payday cycles the window actually covered — trust gate. */
  cyclesObserved: number;
  topPaydayProducts: { name: string; qty: number; revenue: number }[];
  nextPaydayWindowStart: string;
  hint: string;
}

/**
 * Spec algorithm #7 — SHIFT_PERFORMANCE.
 *
 * The formula was not supplied, so it is defined here around the two things a
 * POS owner actually loses money on: cash variance (selisih kas — the primary
 * shrinkage/fraud signal in retail) and till throughput.
 *
 *   CashVariance(s)  = actualCash(s) - expectedCash(s)
 *   ShortageRate(c)  = count(CashVariance < 0) / shifts(c)
 *   SalesPerHour(c)  = SUM(totalSales) / SUM(shift duration hours)
 *
 * Flags (require >= minShiftsForJudgement sessions, so nobody is judged on one
 * bad night):
 *   CASH_VARIANCE    |meanVariance| > cashVarianceTolerancePct of expected cash
 *                    OR shortageRate >= 0.5
 *   LOW_PRODUCTIVITY salesPerHour < mean - 1 stddev across cashiers
 *   TOP_PERFORMER    highest salesPerHour with clean cash
 */
export interface ShiftPerformancePayload {
  kind: 'SHIFT_PERFORMANCE';
  shiftsAnalysed: number;
  cashiers: {
    cashierName: string;
    shifts: number;
    ordersServed: number;
    totalSales: number;
    hoursWorked: number;
    salesPerHour: number;
    avgTicket: number;
    /** Positive = kas lebih, negative = kas kurang. */
    meanCashVariance: number;
    worstCashVariance: number;
    /** Fraction of shifts that ended short. 0..1 */
    shortageRate: number;
    /** |meanCashVariance| as a % of expected cash. */
    variancePct: number;
    flag: 'CASH_VARIANCE' | 'LOW_PRODUCTIVITY' | 'TOP_PERFORMER' | 'OK';
    note: string;
  }[];
  totalCashVariance: number;
  benchmarkSalesPerHour: number;
  hint: string;
}

export type InsightPayload =
  | InventoryAlertPayload
  | CrossSellPayload
  | CrmChurnPayload
  | PeakHoursPayload
  | FinancialPerformancePayload
  | CalendarBehaviourPayload
  | ShiftPerformancePayload
  | LayoutUtilisationPayload
  | StaffBehaviourPayload;

/** What the merchant can do about an insight, straight from the Smart Card. */
export type InsightActionKind =
  | 'OPEN_INVENTORY'
  | 'OPEN_CUSTOMERS'
  | 'OPEN_REPORTS'
  | 'OPEN_TABLES'
  | 'OPEN_POS'
  | 'CREATE_PROMO'
  | 'SEND_WHATSAPP'
  | 'ASK_ASSISTANT';

export interface InsightAction {
  label: string;
  kind: InsightActionKind;
  params?: Record<string, unknown>;
}

/** One row of `daily_merchant_insights`. */
export interface MerchantInsight {
  id: string;
  merchantId: string;
  insightDate: string; // YYYY-MM-DD
  category: InsightCategory;
  priority: InsightPriority;
  title: string;
  /** One-line plain-Indonesian summary shown on the Smart Card. */
  summary: string;
  /** Supporting metric shown as a badge, e.g. "3 item" or "Rp 1,2 jt". */
  metricLabel: string;
  payload: InsightPayload;
  actions: InsightAction[];
  status: InsightStatus;
  createdAt: string;
}

export interface BatchRunOptions {
  /** Analysis window in days. Default 30. */
  windowDays?: number;
  /** Supplier lead time used for the dynamic reorder point. Default 3. */
  leadTimeDays?: number;
  /** Safety stock as a fraction of lead-time demand. Default 0.5. */
  safetyFactor?: number;
  /** Minimum support for a market-basket pair to be reported. Default 0.05. */
  minSupport?: number;
  /** Minimum confidence for a market-basket pair. Default 0.3. */
  minConfidence?: number;
  /** Days without a visit before a customer counts as at-risk. Default 30. */
  churnDays?: number;
  /**
   * Only surface churned customers in the top N% by lifetime spend. Chasing a
   * Rp 50k one-time buyer with a WhatsApp blast costs more than it returns.
   * Default 0.2 (top 20%), per spec algorithm #3.
   */
  churnValueTopPct?: number;
  /** Payday basket uplift ratio that triggers the calendar insight. Default 1.2. */
  paydayUpliftThreshold?: number;
  /** Minimum orders in EACH window before the calendar insight is trusted. Default 5. */
  minOrdersPerCalendarWindow?: number;
  /** Growth factor applied to the trailing average when auto-deriving a target. Default 1.1. */
  targetGrowthFactor?: number;
  /** Minimum closed shifts before a cashier is flagged. Default 3. */
  minShiftsForJudgement?: number;
  /** Mean cash variance above this % of expected cash raises a flag. Default 2. */
  cashVarianceTolerancePct?: number;
  /** Pin "now" for deterministic tests. Defaults to the snapshot timestamp. */
  now?: Date;
}

export interface BatchRunResult {
  merchantId: string;
  insightDate: string;
  generatedAt: string;
  /** Milliseconds spent computing — proves the zero-LLM path is cheap. */
  durationMs: number;
  insights: MerchantInsight[];
  /** Aggregates reused by the intent engine so it never rescans raw orders. */
  aggregates: MerchantAggregates;
}

/**
 * Pre-computed roll-ups. This is also the ONLY thing ever sent to an LLM —
 * never raw transaction rows.
 */
export interface MerchantAggregates {
  windowDays: number;
  ordersAnalysed: number;
  revenueTotal: number;
  revenueToday: number;
  ordersToday: number;
  avgTicket: number;
  grossMarginPct: number;
  voidRatePct: number;
  discountRatePct: number;
  topProducts: { productId: string; name: string; qty: number; revenue: number }[];
  slowMovers: { productId: string; name: string; qty: number; daysSinceLastSale: number | null }[];
  paymentMix: { method: string; orders: number; revenue: number; sharePct: number }[];
  orderTypeMix: { orderType: string; orders: number; revenue: number; sharePct: number }[];
  categoryMix: { categoryId: string; name: string; qty: number; revenue: number; sharePct: number }[];
  revenueByDay: { date: string; orders: number; revenue: number }[];
  customerCounts: Record<CustomerTier | 'TOTAL', number>;
  stockCritical: number;
  slotsOccupied: number;
  slotsTotal: number;
  staffOnShift: number;
  /** Month-to-date progress against the (possibly auto-derived) revenue target. */
  mtdRevenue: number;
  monthlyTarget: number;
  targetSource: 'MERCHANT' | 'AUTO' | 'NONE';
  runRatePct: number;
  expectedPct: number;
}

/* -------------------------------------------------------------------------- */
/* LAYER 2 — INTENT ROUTING                                                   */
/* -------------------------------------------------------------------------- */

export type IntentName =
  | 'GET_INSIGHT_DIGEST'
  | 'GET_STOCK_CRITICAL'
  | 'GET_STOCK_FORECAST'
  | 'GET_TOP_SELLING_ITEM'
  | 'GET_SLOW_MOVING'
  | 'GET_REVENUE_SUMMARY'
  | 'GET_PROFIT_MARGIN'
  | 'GET_PAYMENT_MIX'
  | 'GET_CROSS_SELL'
  | 'GET_CHURN_CUSTOMERS'
  | 'GET_LOYAL_CUSTOMERS'
  | 'GET_CUSTOMER_DETAIL'
  | 'GET_PEAK_HOURS'
  | 'GET_TABLE_STATUS'
  | 'GET_STAFF_PERFORMANCE'
  | 'GET_ATTENDANCE'
  | 'GET_SHIFT_STATUS'
  | 'GET_SHIFT_PERFORMANCE'
  | 'GET_TARGET_PROGRESS'
  | 'GET_CALENDAR_PATTERN'
  | 'GET_PRODUCT_DETAIL'
  | 'GET_PROMO_LIST'
  /**
   * The question refers to ANOTHER business unit of the same merchant (or asks
   * to combine several). Detected before scoring so it is answered
   * deterministically at Rp 0 instead of being billed to a model that cannot
   * see that data either.
   */
  | 'EXPLAIN_BUSINESS_SCOPE'
  | 'UNKNOWN';

export type IntentPeriod = 'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH' | 'ALL';

export interface IntentEntities {
  period?: IntentPeriod;
  productName?: string;
  customerName?: string;
  staffName?: string;
  limit?: number;
}

export interface ParsedIntent {
  intent: IntentName;
  /** 0..1. Below `INTENT_CONFIDENCE_THRESHOLD` the router falls through to LLM. */
  confidence: number;
  entities: IntentEntities;
  matchedKeywords: string[];
}

/** Router falls through to Layer 3 below this score. */
export const INTENT_CONFIDENCE_THRESHOLD = 0.45;

export type AnswerSource = 'RULE_ENGINE' | 'BATCH_INSIGHT' | 'LLM' | 'PAYWALL' | 'ERROR';

export interface AssistantAnswer {
  source: AnswerSource;
  intent: IntentName;
  title: string;
  /** Markdown. The UI renders **bold**, bullet lists and line breaks. */
  markdown: string;
  /** Structured payload for chart/table rendering. */
  data?: unknown;
  /** Follow-up suggestions rendered as tappable chips. */
  chips?: { label: string; query: string }[];
  /** 0 for every deterministic answer. 1 when an LLM call was billed. */
  costCredits: number;
  latencyMs?: number;
}

/* -------------------------------------------------------------------------- */
/* LAYER 3 — API CONTRACT                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Trimmed snapshot the browser POSTs to the server. The server has no database
 * in this deployment, so the client ships the aggregates it already computed.
 * When Postgres is wired the server ignores this and reads the DB instead.
 */
export interface AssistantQueryRequest {
  merchantId: string;
  /** Free text. Omitted when the user tapped a Quick Chip. */
  query?: string;
  /** Set by Quick Chips to bypass the NL parser entirely (guaranteed Rp 0). */
  intent?: IntentName;
  /** Aggregated context — never raw transactions. */
  aggregates?: MerchantAggregates;
  /** Today's batch insights, so the server can answer from them. */
  insights?: MerchantInsight[];
  /** Set false to hard-disable the paid path for this call. */
  allowLlm?: boolean;
  /**
   * Identifies WHICH business unit and WHO is asking. Injected into the model's
   * system prompt so it can state the scope it is reasoning about — and be told
   * explicitly that it must not reference any other business.
   */
  storeContext?: {
    businessId: string;
    storeName: string;
    businessSector: BusinessSector;
    slotNoun: string;
    userRole: UserRole;
  };
}

export interface AiCreditWallet {
  merchantId: string;
  balance: number;
  monthlyGrant: number;
  usedThisMonth: number;
  periodResetAt: string;
}

export interface AssistantQueryResponse {
  ok: boolean;
  answer: AssistantAnswer;
  credits: AiCreditWallet;
  /** Present when source === 'PAYWALL'. */
  paywall?: {
    title: string;
    message: string;
    ctaLabel: string;
    addOnPriceIdr: number;
    addOnCredits: number;
  };
  /**
   * Dari mana angka dalam jawaban ini berasal.
   *
   * 'DATABASE' — dihitung server dari database pusat, dengan rumus yang sama
   *              persis dengan admin panel. Merchant dan tim support melihat
   *              angka yang identik.
   * 'CLIENT'   — dihitung di perangkat dari localStorage, karena unit bisnis ini
   *              belum pernah tersinkronisasi (atau database sedang tak bisa
   *              dihubungi).
   * 'NONE'     — tidak ada data sama sekali.
   *
   * Ditampilkan ke pengguna. Angka tanpa asal-usul yang jelas adalah persoalan
   * yang mahal untuk ditelusuri belakangan.
   */
  dataSource?: 'DATABASE' | 'CLIENT' | 'NONE';
  /** Bidang mana bersumber dari mana. Lihat FieldSource di server/merchantData. */
  provenance?: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* IMPLEMENTATION CONTRACT (function signatures each module must export)      */
/* -------------------------------------------------------------------------- */
/*
 * snapshot.ts
 *   buildSnapshot(input: SnapshotInput): MerchantSnapshot
 *
 * insights.ts   (Layer 1 — pure, no I/O)
 *   runDailyBatch(s: MerchantSnapshot, o?: BatchRunOptions): BatchRunResult
 *   computeAggregates(s, o?): MerchantAggregates
 *   computeInventoryInsight(s, o?): MerchantInsight | null
 *   computeCrossSellInsight(s, o?): MerchantInsight | null
 *   computeChurnInsight(s, o?): MerchantInsight | null
 *   computePeakHoursInsight(s, o?): MerchantInsight | null
 *   computeFinancialPerformanceInsight(s, o?): MerchantInsight | null
 *   computeCalendarBehaviourInsight(s, o?): MerchantInsight | null
 *   computeShiftPerformanceInsight(s, o?): MerchantInsight | null
 *   computeLayoutInsight(s, o?): MerchantInsight | null
 *   computeStaffBehaviourInsight(s, o?): MerchantInsight | null
 *   resolveMonthlyTarget(s, o?): { target: number; source: 'MERCHANT'|'AUTO'|'NONE' }
 *
 * scheduler.ts  (Layer 1 driver in the browser — runs once per calendar day)
 *   ensureDailyInsights(s: MerchantSnapshot, o?: BatchRunOptions): BatchRunResult
 *   invalidateDailyInsights(merchantId: string): void
 *
 * intents.ts    (Layer 2 — pure, no I/O, no network)
 *   parseIntent(text: string): ParsedIntent
 *   resolveIntent(p: ParsedIntent, s: MerchantSnapshot, b: BatchRunResult): AssistantAnswer | null
 *   resolveIntentFromAggregates(p, a: MerchantAggregates, i: MerchantInsight[], ctx): AssistantAnswer | null
 *   QUICK_CHIPS: { label: string; intent: IntentName; icon: string }[]
 */

export interface SnapshotInput {
  businessId: string;
  merchantId: string;
  tenantId?: string;
  userRole: UserRole;
  settings: StoreSettings;
  categories: Category[];
  products: Product[];
  stockItems: StockItem[];
  inventoryLogs: InventoryLog[];
  orders: Order[];
  customers: Customer[];
  tables: Table[];
  staff: StaffMember[];
  attendance: AttendanceRecord[];
  shifts: Shift[];
  currentShift: Shift;
  promoCodes: PromoCode[];
  now?: Date;
}
