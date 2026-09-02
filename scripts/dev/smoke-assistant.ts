/**
 * Smoke harness for the Smart Assistant engine.
 *
 *   npx tsx scripts/dev/smoke-assistant.ts
 *
 * Feeds the real seed dataset through Layer 1 (batch learning) and Layer 2
 * (intent routing) and prints what a merchant would actually see. Its job is to
 * catch NaN / Infinity / empty-state / crash regressions that `tsc` cannot.
 */

import { BUSINESS_PRESETS } from '../../src/data/businessPresets';
import {
  INITIAL_ATTENDANCE_LOGS,
  INITIAL_CUSTOMERS,
  INITIAL_HISTORICAL_ORDERS,
  INITIAL_PROMO_CODES,
  INITIAL_SETTINGS,
  INITIAL_SHIFT,
  INITIAL_STAFF_MEMBERS,
  INITIAL_STOCK_ITEMS,
} from '../../src/data/initialData';
import { runDailyBatch } from '../../src/lib/assistant/insights';
import {
  parseIntent,
  resolveIntent,
  resolveIntentFromAggregates,
  QUICK_CHIPS,
} from '../../src/lib/assistant/intents';
import { buildSnapshot } from '../../src/lib/assistant/snapshot';
import { IntentName, MerchantSnapshot } from '../../src/lib/assistant/types';
import { belongsToBusiness, makeBusinessId, partitionKey } from '../../src/context/TenantContext';
import { Order, Shift } from '../../src/types';

const preset = BUSINESS_PRESETS.FNB;

/** "Now" is pinned near the seed data so windows actually contain orders. */
const NOW = new Date('2026-08-11T15:00:00');

function makeSnapshot(overrides: Partial<Parameters<typeof buildSnapshot>[0]> = {}): MerchantSnapshot {
  // Keep the partition key consistent with whatever sector the override sets,
  // otherwise the isolation assertions below would test a mismatched tenant.
  const sector = overrides.settings?.businessSector || INITIAL_SETTINGS.businessSector || 'FNB';
  return buildSnapshot({
    businessId: makeBusinessId('usr-1', sector),
    merchantId: 'usr-1',
    userRole: 'ADMIN',
    settings: INITIAL_SETTINGS,
    categories: preset.categories,
    products: preset.products,
    stockItems: INITIAL_STOCK_ITEMS,
    inventoryLogs: [],
    orders: INITIAL_HISTORICAL_ORDERS,
    customers: INITIAL_CUSTOMERS,
    tables: preset.tables,
    staff: INITIAL_STAFF_MEMBERS,
    attendance: INITIAL_ATTENDANCE_LOGS,
    shifts: [],
    currentShift: INITIAL_SHIFT,
    promoCodes: INITIAL_PROMO_CODES,
    now: NOW,
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */

const problems: string[] = [];

/** Recursively assert no NaN / Infinity / undefined-as-number leaked out. */
function assertFinite(label: string, value: unknown, path = ''): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) problems.push(`${label}${path} = ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertFinite(label, v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFinite(label, v, `${path}.${k}`);
  }
}

function section(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

/* -------------------------------------------------------------------------- */
/* 1. LAYER 1 — batch learning against the real seed dataset                   */
/* -------------------------------------------------------------------------- */

section('LAYER 1 — runDailyBatch() on the real seed dataset');

const snapshot = makeSnapshot();
const batch = runDailyBatch(snapshot, { now: NOW });

console.log(
  `merchant=${batch.merchantId} date=${batch.insightDate} durationMs=${batch.durationMs} insights=${batch.insights.length}`
);
assertFinite('batch', batch.aggregates);

console.log('\n--- Aggregates ---');
const a = batch.aggregates;
console.log({
  ordersAnalysed: a.ordersAnalysed,
  revenueTotal: a.revenueTotal,
  avgTicket: a.avgTicket,
  grossMarginPct: a.grossMarginPct,
  voidRatePct: a.voidRatePct,
  stockCritical: a.stockCritical,
  slots: `${a.slotsOccupied}/${a.slotsTotal}`,
  topProduct: a.topProducts[0]?.name ?? '(none)',
  paymentMix: a.paymentMix.map((p) => `${p.method} ${p.sharePct}%`).join(', '),
});

console.log('\n--- Insight cards ---');
for (const ins of batch.insights) {
  assertFinite(`insight:${ins.category}`, ins.payload);
  console.log(`\n[P${ins.priority}] ${ins.category} — ${ins.title}`);
  console.log(`   badge : ${ins.metricLabel}`);
  console.log(`   summary: ${ins.summary}`);
  console.log(`   actions: ${ins.actions.map((x) => `${x.kind}(${x.label})`).join(' | ') || '(none)'}`);

  const p = ins.payload;
  switch (p.kind) {
    case 'INVENTORY_ALERT':
      p.items.slice(0, 3).forEach((it) =>
        console.log(
          `      · ${it.name} [${it.severity}] stok ${it.currentStock}${it.unit} adc=${it.avgDailyConsumption} cover=${it.daysOfCover}d rop=${it.reorderPoint} order=${it.suggestedReorderQty}`
        )
      );
      break;
    case 'CROSS_SELL_OPPORTUNITY':
      p.pairs.slice(0, 3).forEach((x) =>
        console.log(
          `      · ${x.aName} + ${x.bName} co=${x.coOccurrence} sup=${x.support} conf=${x.confidence} lift=${x.lift}`
        )
      );
      break;
    case 'CRM_CHURN':
      p.customers.slice(0, 3).forEach((c) =>
        console.log(
          `      · ${c.name} [${c.segment}] R${c.rScore}F${c.fScore}M${c.mScore} recency=${c.recencyDays}d spend=${c.monetary}`
        )
      );
      break;
    case 'OPERATIONAL_PEAK':
      console.log(`      · peak: ${p.peakWindows.map((w) => w.label).join(', ') || '(none)'}`);
      console.log(`      · quiet: ${p.quietWindows.map((w) => w.label).join(', ') || '(none)'}`);
      console.log(`      · busiestDay=${p.busiestDay} hint=${p.staffingHint}`);
      break;
    case 'FINANCIAL_PERFORMANCE':
      console.log(
        `      · MTD ${p.mtdRevenue} / target ${p.monthlyTarget} (${p.targetSource}) runRate ${p.runRatePct}% vs expected ${p.expectedPct}%`
      );
      p.anomalies.forEach((x) =>
        console.log(`      · ${x.metric} ${x.direction} ${x.deltaPct}% z=${x.zScore} — ${x.note}`)
      );
      break;

    case 'CALENDAR_BEHAVIOR':
      console.log(
        `      · payday ${p.paydayAvgBasket} vs normal ${p.normalAvgBasket} = ${p.basketUplift}x (volume ${p.volumeUplift}x)`
      );
      break;

    case 'SHIFT_PERFORMANCE':
      p.cashiers.slice(0, 4).forEach((c) =>
        console.log(`      · ${c.cashierName} ${c.shifts}sh Rp${c.salesPerHour}/jam selisih=${c.meanCashVariance} [${c.flag}]`)
      );
      break;
    case 'LAYOUT_UTILISATION':
      console.log(`      · occupied ${p.occupiedNow}/${p.totalSlots}, dead: ${p.deadSlots.join(', ') || '(none)'}`);
      p.zones.slice(0, 3).forEach((z) => console.log(`      · zona ${z.zone}: ${z.orders} order (${z.sharePct}%)`));
      break;
    case 'STAFF_BEHAVIOUR':
      console.log(`      · top=${p.topPerformer} coaching=${p.needsCoaching}`);
      p.staff.slice(0, 3).forEach((s) =>
        console.log(
          `      · ${s.name} orders=${s.ordersServed} rev/h=${s.revenuePerHour} late=${s.lateClockIns} offsite=${s.offSiteClockIns} attend=${s.attendanceRatePct}%`
        )
      );
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Degenerate inputs — the crash surface                                    */
/* -------------------------------------------------------------------------- */

section('LAYER 1 — degenerate inputs (empty store, all-void, single order)');

const emptyOrders: Order[] = [];
const allVoid: Order[] = INITIAL_HISTORICAL_ORDERS.map((o) => ({ ...o, status: 'VOID' as const }));
const singleOrder: Order[] = [INITIAL_HISTORICAL_ORDERS[0]];

const cases: { name: string; snap: MerchantSnapshot }[] = [
  { name: 'brand-new store (no orders at all)', snap: makeSnapshot({ orders: emptyOrders }) },
  { name: 'every order voided', snap: makeSnapshot({ orders: allVoid }) },
  { name: 'exactly one order', snap: makeSnapshot({ orders: singleOrder }) },
  {
    name: 'no catalog, no customers, no tables, no staff',
    snap: makeSnapshot({
      products: [],
      categories: [],
      stockItems: [],
      customers: [],
      tables: [],
      staff: [],
      attendance: [],
      orders: emptyOrders,
    }),
  },
  {
    name: 'order with zero items and no customer',
    snap: makeSnapshot({
      orders: [{ ...INITIAL_HISTORICAL_ORDERS[0], items: [], customer: undefined, total: 0, subtotal: 0 }],
    }),
  },
];

for (const c of cases) {
  try {
    const r = runDailyBatch(c.snap, { now: NOW });
    assertFinite(`degenerate[${c.name}]`, r.aggregates);
    r.insights.forEach((i) => assertFinite(`degenerate[${c.name}]:${i.category}`, i.payload));
    console.log(`  OK   ${c.name.padEnd(46)} -> ${r.insights.length} insight, revenue=${r.aggregates.revenueTotal}`);
  } catch (err) {
    problems.push(`runDailyBatch threw on "${c.name}": ${(err as Error).message}`);
    console.log(`  FAIL ${c.name} -> ${(err as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 2b. The three new algorithms need data the seed set does not contain        */
/* -------------------------------------------------------------------------- */

section('LAYER 1 — algorithms #5 (target), #6 (payday), #7 (shift)');

const iso = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

/** Orders spanning payday (25-3) and normal (4-24) windows, with a real uplift. */
function calendarOrders(): Order[] {
  const base = INITIAL_HISTORICAL_ORDERS[0] || {
    id: 'base-order',
    items: [{ id: 'p-1', name: 'Produk Test', quantity: 1, unitPrice: 10000, totalPrice: 10000 }],
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    total: 10000,
    subtotal: 10000,
    date: new Date().toISOString(),
  };
  const out: Order[] = [];
  const mk = (y: number, m: number, d: number, total: number, n: number) => {
    for (let i = 0; i < n; i++) {
      out.push({
        ...base,
        id: `CAL-${y}${m}${d}-${i}`,
        date: iso(y, m, d, 10 + i),
        total,
        subtotal: total,
        status: 'COMPLETED',
        customer: undefined,
        items: [{ ...(base.items[0] || { id: 'p-1', name: 'Produk Test' }), quantity: 1, totalPrice: total, unitPrice: total }],
      } as any);
    }
  };
  // Normal window (4-24 July): small baskets.
  for (const d of [14, 16, 18, 20, 22, 24]) mk(2026, 7, d, 60000, 2);
  // Payday window (25-31 July + 1-3 Aug): visibly bigger baskets.
  for (const d of [25, 27, 29, 31]) mk(2026, 7, d, 105000, 2);
  for (const d of [1, 2, 3]) mk(2026, 8, d, 110000, 2);
  // Normal window (4-11 Aug).
  for (const d of [5, 7, 9, 11]) mk(2026, 8, d, 62000, 2);
  return out;
}

/** Closed shifts: one clean cashier, one persistently short. */
function shiftFixture(): Shift[] {
  const mk = (
    id: string,
    cashier: string,
    day: number,
    sales: number,
    orders: number,
    expected: number,
    actual: number
  ): Shift => ({
    id,
    cashierName: cashier,
    startTime: iso(2026, 8, day, 8, 0),
    endTime: iso(2026, 8, day, 16, 0),
    initialCash: 500000,
    cashSales: expected - 500000,
    qrisSales: 0,
    cardSales: 0,
    eWalletSales: 0,
    totalSales: sales,
    expectedCash: expected,
    actualCash: actual,
    difference: actual - expected,
    totalOrders: orders,
    status: 'CLOSED',
  });
  return [
    mk('s1', 'Ahmad Kasir', 4, 2400000, 30, 2000000, 1999000),
    mk('s2', 'Ahmad Kasir', 5, 2600000, 33, 2100000, 2101000),
    mk('s3', 'Ahmad Kasir', 6, 2500000, 31, 2050000, 2050000),
    // Rina: short on every single shift, ~3.5% of expected cash.
    mk('s4', 'Rina Kasir', 7, 1400000, 24, 1200000, 1158000),
    mk('s5', 'Rina Kasir', 8, 1350000, 23, 1150000, 1109000),
    mk('s6', 'Rina Kasir', 9, 1300000, 22, 1100000, 1062000),
  ];
}

const richSnap = makeSnapshot({
  orders: [...INITIAL_HISTORICAL_ORDERS, ...calendarOrders()],
  shifts: shiftFixture(),
});
const richBatch = runDailyBatch(richSnap, { now: NOW });
assertFinite('rich', richBatch.aggregates);
richBatch.insights.forEach((i) => assertFinite(`rich:${i.category}`, i.payload));

console.log(`insights: ${richBatch.insights.map((i) => i.category).join(', ')}`);

for (const want of ['CALENDAR_BEHAVIOR', 'SHIFT_PERFORMANCE', 'FINANCIAL_PERFORMANCE'] as const) {
  const ins = richBatch.insights.find((i) => i.category === want);
  if (!ins) {
    problems.push(`expected a ${want} insight from the fixture but got none`);
    console.log(`  MISSING ${want}`);
    continue;
  }
  console.log(`\n  [P${ins.priority}] ${want} — ${ins.title}`);
  console.log(`     ${ins.summary}`);
  const p = ins.payload;
  if (p.kind === 'CALENDAR_BEHAVIOR') {
    console.log(`     payday ${p.paydayAvgBasket} vs normal ${p.normalAvgBasket} = uplift ${p.basketUplift}x`);
    if (p.basketUplift <= 1) problems.push('calendar: uplift should be > 1 for this fixture');
  }
  if (p.kind === 'SHIFT_PERFORMANCE') {
    p.cashiers.forEach((c) =>
      console.log(`     ${c.cashierName}: ${c.shifts} shift, Rp${c.salesPerHour}/jam, selisih ${c.meanCashVariance}, ${c.flag}`)
    );
    const rina = p.cashiers.find((c) => c.cashierName === 'Rina Kasir');
    if (!rina || rina.flag !== 'CASH_VARIANCE') {
      problems.push('shift: Rina is short on every shift and must be flagged CASH_VARIANCE');
    }
    if (p.cashiers.some((c) => c.note.toLowerCase().includes('curi') || c.note.toLowerCase().includes('maling'))) {
      problems.push('shift: wording must stay an operational finding, never a theft accusation');
    }
  }
  if (p.kind === 'FINANCIAL_PERFORMANCE') {
    console.log(`     MTD ${p.mtdRevenue} / target ${p.monthlyTarget} (${p.targetSource}) — runRate ${p.runRatePct}% vs expected ${p.expectedPct}%`);
    if (p.monthlyTarget > 0 && p.targetSource === 'AUTO' && !ins.summary.includes('otomatis')) {
      problems.push('financial: an AUTO target must be disclosed as automatic in the summary');
    }
  }
}

// Merchant-set target must win over the auto-derived one.
const manualSnap = makeSnapshot({
  orders: [...INITIAL_HISTORICAL_ORDERS, ...calendarOrders()],
  settings: { ...INITIAL_SETTINGS, monthlyRevenueTarget: 9_000_000 },
});
const manualBatch = runDailyBatch(manualSnap, { now: NOW });
const fin = manualBatch.insights.find((i) => i.category === 'FINANCIAL_PERFORMANCE');
if (fin && fin.payload.kind === 'FINANCIAL_PERFORMANCE') {
  console.log(`\n  manual target -> ${fin.payload.monthlyTarget} (${fin.payload.targetSource}), runRate ${fin.payload.runRatePct}%`);
  if (fin.payload.targetSource !== 'MERCHANT') problems.push('financial: merchant-set target must take precedence');
  if (fin.payload.monthlyTarget !== 9_000_000) problems.push('financial: merchant target value not honoured');
} else {
  problems.push('financial: no card produced even with an explicit merchant target');
}

// Degenerate: one cashier, one shift, no closed shifts, no payday data.
for (const [label, snap] of [
  ['no closed shifts', makeSnapshot({ shifts: [] })],
  ['single shift only', makeSnapshot({ shifts: [shiftFixture()[0]] })],
  ['zero target, zero history', makeSnapshot({ orders: [] })],
] as [string, MerchantSnapshot][]) {
  try {
    const r = runDailyBatch(snap, { now: NOW });
    r.insights.forEach((i) => assertFinite(`degenerate2[${label}]:${i.category}`, i.payload));
    console.log(`  OK   ${label.padEnd(28)} -> ${r.insights.length} insight`);
  } catch (err) {
    problems.push(`runDailyBatch threw on "${label}": ${(err as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 3. LAYER 2 — intent routing over realistic merchant phrasing                */
/* -------------------------------------------------------------------------- */

section('LAYER 2 — parseIntent() + resolveIntent()');

/** [query, expected intent | null when it SHOULD fall through to the LLM] */
const probes: [string, string | null][] = [
  ['stok apa yang mau habis?', 'GET_STOCK_CRITICAL'],
  ['menu apa yang paling laku minggu ini', 'GET_TOP_SELLING_ITEM'],
  ['berapa omset hari ini', 'GET_REVENUE_SUMMARY'],
  ['produk apa yang sering dibeli bareng', 'GET_CROSS_SELL'],
  ['pelanggan mana yang sudah lama tidak datang', 'GET_CHURN_CUSTOMERS'],
  ['siapa pelanggan paling setia', 'GET_LOYAL_CUSTOMERS'],
  ['jam berapa toko paling ramai', 'GET_PEAK_HOURS'],
  ['berapa meja yang kosong sekarang', 'GET_TABLE_STATUS'],
  ['gimana kinerja staf saya', 'GET_STAFF_PERFORMANCE'],
  ['siapa saja yang sudah absen hari ini', 'GET_ATTENDANCE'],
  ['berapa margin keuntungan bulan ini', 'GET_PROFIT_MARGIN'],
  ['metode pembayaran apa yang paling sering dipakai', 'GET_PAYMENT_MIX'],
  ['produk apa yang kurang laku', 'GET_SLOW_MOVING'],
  ['ada promo aktif apa aja', 'GET_PROMO_LIST'],
  ['ringkasan kondisi toko dong', 'GET_INSIGHT_DIGEST'],
  ['prediksi stok 3 hari ke depan', 'GET_STOCK_FORECAST'],
  ['selisih kas shift kemarin berapa', 'GET_SHIFT_STATUS'],

  // --- informal / abbreviated phrasing a real kasir would type -------------
  ['stok menipis apa aja', 'GET_STOCK_CRITICAL'],
  ['barang apa yg perlu restock', 'GET_STOCK_CRITICAL'],
  ['cek stok dong', 'GET_STOCK_CRITICAL'],
  ['omzet minggu ini brp', 'GET_REVENUE_SUMMARY'],
  ['penjualan kemarin gimana', 'GET_REVENUE_SUMMARY'],
  ['menu terlaris apa', 'GET_TOP_SELLING_ITEM'],
  ['top 5 produk terlaris', 'GET_TOP_SELLING_ITEM'],
  ['untung bersih berapa bulan ini', 'GET_PROFIT_MARGIN'],
  ['pelanggan loyal siapa aja', 'GET_LOYAL_CUSTOMERS'],
  ['member yang jarang datang', 'GET_CHURN_CUSTOMERS'],
  ['jam sepi kapan', 'GET_PEAK_HOURS'],
  ['hari teramai apa', 'GET_PEAK_HOURS'],
  ['meja kosong ada berapa', 'GET_TABLE_STATUS'],
  ['okupansi meja gimana', 'GET_TABLE_STATUS'],
  ['staf terbaik siapa', 'GET_STAFF_PERFORMANCE'],
  ['siapa yang belum clock in', 'GET_ATTENDANCE'],
  ['kode promo aktif', 'GET_PROMO_LIST'],
  ['briefing pagi dong', 'GET_INSIGHT_DIGEST'],
  ['qris berapa persen', 'GET_PAYMENT_MIX'],
  ['produk yang jarang terjual', 'GET_SLOW_MOVING'],
  ['kapan biji kopi habis', 'GET_STOCK_FORECAST'],
  ['tutup kasir berapa setoran', 'GET_SHIFT_STATUS'],

  // --- the three new intents ----------------------------------------------
  ['progres target bulan ini gimana', 'GET_TARGET_PROGRESS'],
  ['omzet sudah capai target belum', 'GET_TARGET_PROGRESS'],
  ['run rate bulan ini', 'GET_TARGET_PROGRESS'],
  ['pola gajian pelanggan gimana', 'GET_CALENDAR_PATTERN'],
  ['tanggal muda lebih ramai ga', 'GET_CALENDAR_PATTERN'],
  ['kinerja shift kasir gimana', 'GET_SHIFT_PERFORMANCE'],
  ['ada selisih kas ga', 'GET_SHIFT_PERFORMANCE'],
  ['kasir mana yang paling produktif', 'GET_SHIFT_PERFORMANCE'],

  // These MUST fall through to Layer 3 — they are genuinely strategic.
  ['buatkan strategi marketing untuk meningkatkan penjualan mie goreng', null],
  ['menurutmu kenapa penjualan bulan ini turun ya?', null],
  ['tolong bikinin caption instagram buat promo akhir pekan', null],
  ['saran dong biar pelanggan balik lagi', null],
  ['bagaimana cara bersaing dengan kompetitor sebelah', null],
  ['', null],
];

let matched = 0;
let fellThrough = 0;
let wrong = 0;

for (const [q, expected] of probes) {
  const parsed = parseIntent(q);
  const deterministic = parsed.intent !== 'UNKNOWN' && parsed.confidence >= 0.45;
  const answer = deterministic ? resolveIntent(parsed, snapshot, batch) : null;

  const label = q === '' ? '(empty string)' : q;
  if (expected === null) {
    if (deterministic) {
      wrong++;
      problems.push(`"${label}" should fall through to LLM but matched ${parsed.intent} @${parsed.confidence}`);
      console.log(`  WRONG  ${label}\n         -> ${parsed.intent} @${parsed.confidence.toFixed(2)} (expected fall-through)`);
    } else {
      fellThrough++;
      console.log(`  ->LLM  ${label}`);
    }
    continue;
  }

  if (parsed.intent !== expected || !deterministic) {
    wrong++;
    problems.push(`"${label}" -> ${parsed.intent} @${parsed.confidence.toFixed(2)}, expected ${expected}`);
    console.log(`  WRONG  ${label}\n         -> ${parsed.intent} @${parsed.confidence.toFixed(2)} (expected ${expected})`);
    continue;
  }
  if (!answer) {
    wrong++;
    problems.push(`"${label}" parsed as ${expected} but resolveIntent returned null`);
    console.log(`  NULL   ${label} -> parsed ${expected} but no answer`);
    continue;
  }

  matched++;
  const firstLine = answer.markdown.split('\n').find((l) => l.trim().length > 0) ?? '';
  console.log(`  OK     ${label}\n         [${answer.source}] ${answer.title} :: ${firstLine.slice(0, 90)}`);

  if (answer.costCredits !== 0) problems.push(`"${label}" charged ${answer.costCredits} credits on the free path`);
  if (/NaN|Infinity|undefined|null/.test(answer.markdown)) {
    problems.push(`"${label}" answer markdown contains a placeholder/NaN token`);
  }
  // Only markers the UI renderer understands may be emitted, otherwise the
  // merchant sees raw punctuation (this shipped once with literal _underscores_).
  const unsupported = answer.markdown.match(/(?:^|\s)(#{1,6}\s|```|\|\s*-{3,}|\[[^\]]*\]\()/);
  if (unsupported) {
    problems.push(`"${label}" uses markdown the UI cannot render: ${JSON.stringify(unsupported[1])}`);
  }
  // Follow-up chips must round-trip through the parser.
  for (const chip of answer.chips ?? []) {
    const back = parseIntent(chip.query);
    if (back.intent === 'UNKNOWN' || back.confidence < 0.45) {
      problems.push(`chip "${chip.label}" (query="${chip.query}") does not round-trip through parseIntent`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Quick chips must all resolve                                            */
/* -------------------------------------------------------------------------- */

section('LAYER 2 — server-side path (resolveIntentFromAggregates)');

/*
 * The server answers from aggregates + insight cards only. Any intent that
 * returns null here escalates to the BILLED LLM — so a gap in this function is
 * a direct cost leak, not just a missing feature.
 */
const serverCtx = {
  storeName: richSnap.storeName,
  businessSector: richSnap.businessSector,
  slotNoun: richSnap.slotNoun,
};
let serverOk = 0;
for (const [q, expected] of probes) {
  if (expected === null) continue;
  const parsed = parseIntent(q);
  if (parsed.intent === 'UNKNOWN' || parsed.confidence < 0.45) continue;
  const ans = resolveIntentFromAggregates(parsed, richBatch.aggregates, richBatch.insights, serverCtx);
  if (!ans) {
    problems.push(`server path: "${q}" (${parsed.intent}) returned null -> would escalate to the paid LLM`);
    console.log(`  LEAK ${parsed.intent.padEnd(24)} ${q}`);
  } else {
    if (ans.costCredits !== 0) problems.push(`server path: ${parsed.intent} charged ${ans.costCredits} credits`);
    if (/NaN|Infinity|undefined/.test(ans.markdown)) {
      problems.push(`server path: ${parsed.intent} rendered NaN/Infinity/undefined`);
    }
    serverOk++;
  }
}
console.log(`  ${serverOk} intents answered server-side at Rp 0`);

section('LAYER 2 — QUICK_CHIPS bypass');

for (const chip of QUICK_CHIPS) {
  const parsed = { intent: chip.intent, confidence: 1, entities: {}, matchedKeywords: [] as string[] };
  const answer = resolveIntent(parsed, snapshot, batch);
  if (!answer) {
    problems.push(`QUICK_CHIP "${chip.label}" (${chip.intent}) resolved to null`);
    console.log(`  FAIL ${chip.label} (${chip.intent}) -> null`);
  } else {
    console.log(`  OK   ${chip.label.padEnd(24)} ${chip.intent.padEnd(24)} [${answer.source}] ${answer.title}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Empty store must still answer every chip without crashing                */
/* -------------------------------------------------------------------------- */

section('LAYER 2 — every chip against a brand-new empty store');

const emptySnap = makeSnapshot({
  orders: [],
  customers: [],
  products: [],
  stockItems: [],
  tables: [],
  staff: [],
  attendance: [],
});
const emptyBatch = runDailyBatch(emptySnap, { now: NOW });
for (const chip of QUICK_CHIPS) {
  try {
    const answer = resolveIntent(
      { intent: chip.intent, confidence: 1, entities: {}, matchedKeywords: [] },
      emptySnap,
      emptyBatch
    );
    if (!answer) {
      problems.push(`empty store: chip ${chip.intent} returned null`);
      console.log(`  FAIL ${chip.intent} -> null`);
    } else if (/NaN|Infinity/.test(answer.markdown)) {
      problems.push(`empty store: chip ${chip.intent} rendered NaN/Infinity`);
      console.log(`  FAIL ${chip.intent} -> NaN/Infinity in output`);
    } else {
      console.log(`  OK   ${chip.intent.padEnd(24)} ${answer.markdown.split('\n')[0].slice(0, 70)}`);
    }
  } catch (err) {
    problems.push(`empty store: chip ${chip.intent} threw: ${(err as Error).message}`);
    console.log(`  THROW ${chip.intent} -> ${(err as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Input must not be mutated                                               */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Staff must be separated per business sector                                */
/* -------------------------------------------------------------------------- */

section('Sector isolation — staff roster must never mix sectors');

const SECTORS = ['FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP'] as const;

for (const sector of SECTORS) {
  const roster = INITIAL_STAFF_MEMBERS.filter((s) => (s.sector || 'FNB') === sector);
  const foreign = roster.filter((s) => s.sector !== sector);

  if (foreign.length > 0) {
    problems.push(`sector ${sector}: roster contains ${foreign.length} staff from another sector`);
  }
  // Every sector must have someone, otherwise "Pilih Petugas" is a dead end —
  // there is no add-staff UI in the app yet.
  if (roster.length === 0) {
    problems.push(`sector ${sector}: no staff at all — the operator picker would be empty and unusable`);
  }

  // The staff-performance insight must only ever see this sector's people.
  const snap = makeSnapshot({
    settings: { ...INITIAL_SETTINGS, businessSector: sector },
    staff: roster,
  });
  const res = runDailyBatch(snap, { now: NOW });
  const staffCard = res.insights.find((i) => i.category === 'STAFF_BEHAVIOUR');
  if (staffCard && staffCard.payload.kind === 'STAFF_BEHAVIOUR') {
    const names = new Set(roster.map((s) => s.name));
    const leaked = staffCard.payload.staff.filter((s) => !names.has(s.name));
    if (leaked.length > 0) {
      problems.push(`sector ${sector}: STAFF_BEHAVIOUR leaked ${leaked.map((l) => l.name).join(', ')}`);
    }
  }

  console.log(`  ${sector.padEnd(11)} ${String(roster.length).padStart(2)} staf — ${roster.map((s) => s.name).join(', ')}`);
}

const totalSeed = INITIAL_STAFF_MEMBERS.length;
const summed = SECTORS.reduce(
  (acc, sec) => acc + INITIAL_STAFF_MEMBERS.filter((s) => (s.sector || 'FNB') === sec).length,
  0
);
if (summed !== totalSeed) {
  problems.push(`staff roster: ${totalSeed - summed} staff belong to no known sector`);
}
console.log(`  total ${totalSeed} staf, semuanya terpetakan ke satu sektor: ${summed === totalSeed}`);

/* -------------------------------------------------------------------------- */
/* Tenant partition: businessId must isolate accounts AND businesses           */
/* -------------------------------------------------------------------------- */

section('Tenant partition — businessId isolates account × business');

{
  // Same sector, two different accounts => different partitions.
  const a = makeBusinessId('usr-1', 'FNB');
  const b = makeBusinessId('usr-2', 'FNB');
  // Same account, two different businesses => different partitions.
  const c = makeBusinessId('usr-1', 'LAUNDRY');

  if (a === b) problems.push('partition: two accounts in the same sector collide');
  if (a === c) problems.push('partition: two sectors of one account collide');
  console.log(`  usr-1/FNB=${a}  usr-2/FNB=${b}  usr-1/LAUNDRY=${c}`);

  // Storage keys must not overlap between partitions.
  const keysA = new Set(['orders', 'customers', 'promo_codes'].map((e) => partitionKey(a, e)));
  const overlap = ['orders', 'customers', 'promo_codes']
    .map((e) => partitionKey(c, e))
    .filter((k) => keysA.has(k));
  if (overlap.length > 0) problems.push(`partition: storage keys overlap: ${overlap.join(', ')}`);
  console.log(`  contoh key: ${partitionKey(a, 'orders')} vs ${partitionKey(c, 'orders')}`);

  // A staff row stamped for one business must be invisible to the other.
  const stamped = { id: 'x', name: 'Sari', role: 'Waiter', sector: 'FNB' as const, businessId: a };
  if (!belongsToBusiness(stamped, { businessId: a, sector: 'FNB' })) {
    problems.push('partition: a row stamped for its own business was rejected');
  }
  if (belongsToBusiness(stamped, { businessId: c, sector: 'LAUNDRY' })) {
    problems.push('partition: a row from another business was accepted — LEAK');
  }

  // buildSnapshot must drop foreign staff even if the caller passes them in.
  const leaky = makeSnapshot({
    staff: [
      { id: 's-own', name: 'Doni', role: 'Barista', sector: 'FNB', isAvailable: true },
      { id: 's-foreign', name: 'Mas Alex', role: 'Kapster', sector: 'BARBERSHOP', isAvailable: true },
    ],
  });
  const leaked = leaky.staff.filter((s) => s.sector !== 'FNB');
  if (leaked.length > 0) {
    problems.push(`buildSnapshot: leaked ${leaked.map((s) => s.name).join(', ')} from another business`);
  }
  console.log(`  buildSnapshot menyaring staf asing: ${leaked.length === 0} (tersisa ${leaky.staff.map((s) => s.name).join(', ')})`);

  // The snapshot must carry the scope the AI prompt is built from.
  if (!leaky.businessId) problems.push('snapshot: businessId missing — AI prompt could not state its scope');
  if (!leaky.userRole) problems.push('snapshot: userRole missing — AI prompt could not adapt to the role');
  console.log(`  snapshot scope: businessId=${leaky.businessId} role=${leaky.userRole}`);
}

/* -------------------------------------------------------------------------- */
/* RBAC: the assistant must not answer around a locked tab                     */
/* -------------------------------------------------------------------------- */

section('RBAC — role gate must match ROLE_PERMISSIONS');

{
  const SENSITIVE: [IntentName, string][] = [
    ['GET_PROFIT_MARGIN', 'margin & HPP'],
    ['GET_TARGET_PROGRESS', 'progres target'],
    ['GET_SHIFT_PERFORMANCE', 'selisih kas antar kasir'],
    ['GET_STAFF_PERFORMANCE', 'kinerja staf'],
    ['GET_STOCK_CRITICAL', 'stok kritis'],
    ['GET_PAYMENT_MIX', 'komposisi pembayaran'],
  ];

  const cashierSnap: MerchantSnapshot = { ...richSnap, userRole: 'CASHIER' };
  const adminSnap: MerchantSnapshot = { ...richSnap, userRole: 'ADMIN' };

  for (const [intent, label] of SENSITIVE) {
    const parsed = { intent, confidence: 1, entities: {}, matchedKeywords: [] as string[] };

    const asCashier = resolveIntent(parsed, cashierSnap, richBatch);
    const asAdmin = resolveIntent(parsed, adminSnap, richBatch);

    const blocked = !!asCashier && /hak akses|dibatasi peran/i.test(asCashier.markdown);
    if (!blocked) {
      problems.push(`RBAC: CASHIER got ${label} (${intent}) — assistant bypasses the locked tab`);
    }
    if (!asAdmin || /dibatasi peran/i.test(asAdmin.markdown)) {
      problems.push(`RBAC: ADMIN was wrongly denied ${intent}`);
    }
    // A refusal must not leak the very numbers it is refusing to show.
    if (asCashier && /Rp\s?[\d.]{4,}/.test(asCashier.markdown)) {
      problems.push(`RBAC: the refusal for ${intent} still contained a currency figure`);
    }
    console.log(`  ${intent.padEnd(24)} CASHIER=${blocked ? 'ditolak' : 'BOCOR'}  ADMIN=${asAdmin ? 'ok' : 'null'}`);
  }

  // The same gate must apply on the server path.
  const srvCtx = {
    businessId: richSnap.businessId,
    storeName: richSnap.storeName,
    businessSector: richSnap.businessSector,
    slotNoun: richSnap.slotNoun,
    userRole: 'CASHIER' as const,
  };
  const srv = resolveIntentFromAggregates(
    { intent: 'GET_PROFIT_MARGIN', confidence: 1, entities: {}, matchedKeywords: [] },
    richBatch.aggregates,
    richBatch.insights,
    srvCtx
  );
  if (!srv || !/hak akses|dibatasi peran/i.test(srv.markdown)) {
    problems.push('RBAC: server path let a CASHIER read margin — direct API bypasses the gate');
  }
  console.log(`  server path CASHIER margin: ${srv && /dibatasi peran|hak akses/i.test(srv.markdown) ? 'ditolak' : 'BOCOR'}`);

  // Un-gated operational intents must still work for a cashier.
  const stillWorks = resolveIntent(
    { intent: 'GET_REVENUE_SUMMARY', confidence: 1, entities: {}, matchedKeywords: [] },
    cashierSnap,
    richBatch
  );
  if (!stillWorks || /dibatasi peran/i.test(stillWorks.markdown)) {
    problems.push('RBAC: cashier lost access to an intent they legitimately need (revenue today)');
  }
  console.log(`  GET_REVENUE_SUMMARY tetap terbuka untuk CASHIER: ${!!stillWorks && !/dibatasi peran/i.test(stillWorks.markdown)}`);
}

section('Purity — engines must not mutate the snapshot');

const orderIdsBefore = INITIAL_HISTORICAL_ORDERS.map((o) => o.id).join(',');
const productIdsBefore = preset.products.map((p) => p.id).join(',');
runDailyBatch(makeSnapshot(), { now: NOW });
if (INITIAL_HISTORICAL_ORDERS.map((o) => o.id).join(',') !== orderIdsBefore) {
  problems.push('runDailyBatch reordered the caller\'s orders array (in-place sort)');
}
if (preset.products.map((p) => p.id).join(',') !== productIdsBefore) {
  problems.push('runDailyBatch reordered the caller\'s products array (in-place sort)');
}
console.log(`  orders array intact  : ${INITIAL_HISTORICAL_ORDERS.map((o) => o.id).join(',') === orderIdsBefore}`);
console.log(`  products array intact: ${preset.products.map((p) => p.id).join(',') === productIdsBefore}`);

/* -------------------------------------------------------------------------- */

section('RESULT');
console.log(`intents matched      : ${matched}/${probes.filter(([, e]) => e !== null).length}`);
console.log(`correct fall-throughs: ${fellThrough}/${probes.filter(([, e]) => e === null).length}`);
console.log(`wrong                : ${wrong}`);
console.log(`problems             : ${problems.length}`);
if (problems.length) {
  console.log('\n--- PROBLEMS ---');
  problems.forEach((p, i) => console.log(`${String(i + 1).padStart(3)}. ${p}`));
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
