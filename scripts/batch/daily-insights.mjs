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

/* -------------------------------------------------------------------------- */
/* ALGORITMA 4-9 — DIPISAH GLOBAL vs PER-SEKTOR                               */
/* -------------------------------------------------------------------------- */
/*
 * Enam algoritma di bawah ini melengkapi daftar sembilan yang dideklarasikan
 * di ai.algorithm_scope. Sebelumnya baru tiga yang benar-benar ditulis
 * (INVENTORY_ALERT, CROSS_SELL_OPPORTUNITY, CRM_CHURN) sementara dokumentasi
 * menyebut sembilan — selisih yang membuat merchant menunggu kartu insight
 * yang tidak akan pernah muncul.
 *
 * Tiga di antaranya GLOBAL dan tiga PER-SEKTOR. Yang per-sektor tidak
 * dijalankan di luar sektornya, bukan dijalankan lalu menghasilkan kartu
 * kosong: perputaran meja tidak berarti apa-apa untuk toko kelontong, dan
 * kartu kosong mengajari orang mengabaikan seluruh kolom insight.
 *
 * Semuanya adalah fungsi murni atas data yang sudah dimuat — bisa diuji tanpa
 * database, sama seperti dua algoritma pertama.
 */

/** Jam operasional dibagi tiga shift. Batasnya mengikuti kebiasaan toko di Indonesia. */
const SHIFT = [
  { nama: 'Pagi',  dari: 6,  sampai: 12 },
  { nama: 'Siang', dari: 12, sampai: 18 },
  { nama: 'Malam', dari: 18, sampai: 24 },
];

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
const persen = (n) => `${round(safe(n) * 100, 1)}%`;

/** Transaksi yang benar-benar menghasilkan uang. Yang batal tidak boleh ikut dihitung. */
const selesai = (orders) =>
  orders.filter((o) => String(o.status || '').toUpperCase() === 'COMPLETED');

/** Jam lokal transaksi. Waktu disimpan UTC; toko berpikir dalam waktu setempat. */
function jamLokal(tanggal, offsetJam) {
  const d = toDate(tanggal);
  if (!d) return null;
  return new Date(d.getTime() + offsetJam * 3600_000);
}

/* --- 4. FINANCIAL_PERFORMANCE (global) ------------------------------------ */

/**
 * Omzet dan MARGIN dibanding periode sebelumnya yang sama panjang.
 *
 * Yang dilaporkan margin, bukan omzet saja. Omzet naik sambil margin turun
 * adalah keadaan yang paling sering luput: penjualan terasa ramai, uang di
 * laci bertambah, dan toko justru sedang kehilangan uang per transaksi.
 *
 * Modal diambil dari unit_cost yang tersimpan DI BARIS STRUK, bukan dari harga
 * pokok produk hari ini. Harga bahan berubah; margin bulan lalu harus dihitung
 * dengan modal bulan lalu, kalau tidak angkanya berubah sendiri setiap kali
 * supplier menaikkan harga.
 */
export function computeFinancialPerformance(orders, { windowDays = 30, now = new Date() } = {}) {
  const batasKini = new Date(now.getTime() - windowDays * DAY_MS);
  const batasLalu = new Date(now.getTime() - 2 * windowDays * DAY_MS);

  const ringkas = (dari, sampai) => {
    let omzet = 0, modal = 0, diskon = 0, jumlah = 0;
    const hariBerdagang = new Set();
    for (const o of selesai(orders)) {
      const d = toDate(o.date);
      if (!d || d < dari || d >= sampai) continue;
      jumlah++;
      hariBerdagang.add(d.toISOString().slice(0, 10));
      omzet += Number(o.totalAmount ?? 0);
      diskon += Number(o.discountAmount ?? 0);
      for (const li of o.items || []) {
        modal += Number(li.unitCost ?? li.unit_cost ?? 0) * Number(li.quantity ?? 0);
      }
    }
    const laba = omzet - modal;
    return {
      omzet: round(omzet), modal: round(modal), laba: round(laba), diskon: round(diskon),
      jumlah,
      hariBerdagang: hariBerdagang.size,
      margin: omzet > 0 ? safe(laba / omzet) : 0,
      rataStruk: jumlah > 0 ? round(omzet / jumlah) : 0,
    };
  };

  const kini = ringkas(batasKini, now);
  const lalu = ringkas(batasLalu, batasKini);

  if (kini.jumlah === 0) return null;

  // PEMBANDINGNYA HARUS LAYAK DIBANDINGKAN.
  //
  // Toko yang baru berdagang 38 hari punya periode sebelumnya yang cuma terisi
  // sebagian, dan pembagiannya menghasilkan "omzet naik 314%" — angka yang
  // benar secara aritmetika dan menyesatkan sebagai kalimat. Merchant akan
  // mengambil keputusan dari pertumbuhan yang tidak pernah terjadi.
  //
  // Syaratnya: periode sebelumnya terisi minimal 60% harinya. Di bawah itu
  // angkanya tetap dilaporkan, tapi TANPA klaim pertumbuhan.
  const layakDibanding = lalu.hariBerdagang >= Math.ceil(windowDays * 0.6);

  const deltaOmzet =
    layakDibanding && lalu.omzet > 0 ? safe((kini.omzet - lalu.omzet) / lalu.omzet) : null;
  // Margin dibandingkan dalam POIN PERSENTASE, bukan persen relatif. "Margin
  // turun 10%" ambigu — dari 40% ke 36%, atau dari 40% ke 30%?
  const deltaMarginPp = layakDibanding ? round((kini.margin - lalu.margin) * 100, 1) : null;

  return {
    kini, lalu, windowDays, layakDibanding,
    deltaOmzet: deltaOmzet === null ? null : round(deltaOmzet, 4),
    deltaMarginPp,
    hariPembanding: lalu.hariBerdagang,
  };
}

export function buildFinancialRow(merchantId, date, f) {
  if (!f) return null;
  const { kini, deltaOmzet, deltaMarginPp, windowDays, layakDibanding } = f;

  // Margin turun lebih dari 3 poin persentase adalah keadaan yang perlu
  // ditindaklanjuti hari itu juga; sisanya laporan biasa.
  const gawat = layakDibanding && deltaMarginPp <= -3;

  const judul = gawat
    ? `Margin turun ${Math.abs(deltaMarginPp)} poin dibanding periode lalu`
    : layakDibanding
      ? `Omzet ${windowDays} hari ${deltaOmzet >= 0 ? 'naik' : 'turun'} ${persen(Math.abs(deltaOmzet))}`
      : `Omzet ${windowDays} hari ${rupiah(kini.omzet)}`;

  const ekor = !layakDibanding
    ? '. Belum ada periode sebelumnya yang cukup lengkap untuk dibandingkan.'
    : deltaMarginPp === 0
      ? '.'
      : `, ${deltaMarginPp > 0 ? 'naik' : 'turun'} ${Math.abs(deltaMarginPp)} poin.`;

  return {
    id: idFor(merchantId, date, 'FINANCIAL_PERFORMANCE'),
    business_id: merchantId,
    insight_date: date,
    category: 'FINANCIAL_PERFORMANCE',
    priority: gawat ? 1 : 3,
    title: judul,
    summary:
      `${windowDays} hari terakhir: omzet ${rupiah(kini.omzet)} dari ${kini.jumlah} struk ` +
      `(rata-rata ${rupiah(kini.rataStruk)}), laba kotor ${rupiah(kini.laba)} — margin ${persen(kini.margin)}` +
      ekor,
    metric_label: `Margin ${persen(kini.margin)}`,
    payload: { kind: 'FINANCIAL_PERFORMANCE', ...f },
    actions: [{ label: 'Buka Laporan', kind: 'OPEN_REPORTS' }],
  };
}

/* --- 5. OPERATIONAL_PEAK (global) ----------------------------------------- */

/**
 * Jam tersibuk, untuk menentukan kapan orang harus ada di tempat.
 *
 * Yang dihitung rata-rata PER HARI BUKA, bukan total per jam. Total membuat
 * jam yang kebetulan jatuh pada hari ramai terlihat sibuk padahal biasanya
 * sepi — dan jadwal yang dibuat dari situ menempatkan orang di jam yang salah.
 */
export function computeOperationalPeak(orders, { offsetJam = 7, now = new Date() } = {}) {
  const perJam = new Map();      // jam -> { struk, omzet }
  const hariAktifPerJam = new Map(); // jam -> Set(tanggal)

  for (const o of selesai(orders)) {
    const d = jamLokal(o.date, offsetJam);
    if (!d) continue;
    const jam = d.getUTCHours();
    const hari = d.toISOString().slice(0, 10);
    if (!perJam.has(jam)) perJam.set(jam, { struk: 0, omzet: 0 });
    if (!hariAktifPerJam.has(jam)) hariAktifPerJam.set(jam, new Set());
    const s = perJam.get(jam);
    s.struk++;
    s.omzet += Number(o.totalAmount ?? 0);
    hariAktifPerJam.get(jam).add(hari);
  }

  if (perJam.size === 0) return null;

  const hariBuka = new Set();
  for (const o of selesai(orders)) {
    const d = jamLokal(o.date, offsetJam);
    if (d) hariBuka.add(d.toISOString().slice(0, 10));
  }
  const jumlahHari = Math.max(1, hariBuka.size);

  const jam = [...perJam.entries()]
    .map(([jam, s]) => ({
      jam,
      strukPerHari: round(s.struk / jumlahHari, 2),
      omzetPerHari: round(s.omzet / jumlahHari),
      totalStruk: s.struk,
    }))
    .sort((a, b) => b.strukPerHari - a.strukPerHari);

  const rata = round(jam.reduce((n, j) => n + j.strukPerHari, 0) / jam.length, 2);
  const puncak = jam[0];
  const sepi = jam[jam.length - 1];

  return {
    jam,
    puncak,
    sepi,
    rataPerJam: rata,
    // Berapa kali lipat jam puncak dibanding jam rata-rata. Di bawah 1,5 kali
    // sebaran bebannya cukup rata dan tidak ada yang perlu diubah.
    rasioPuncak: rata > 0 ? round(puncak.strukPerHari / rata, 2) : 0,
    hariDihitung: jumlahHari,
  };
}

export function buildPeakRow(merchantId, date, p) {
  if (!p || p.rasioPuncak < 1.5) return null;
  const jj = (n) => `${String(n).padStart(2, '0')}.00`;

  return {
    id: idFor(merchantId, date, 'OPERATIONAL_PEAK'),
    business_id: merchantId,
    insight_date: date,
    category: 'OPERATIONAL_PEAK',
    priority: p.rasioPuncak >= 2.5 ? 2 : 3,
    title: `Jam tersibuk ${jj(p.puncak.jam)}–${jj(p.puncak.jam + 1)}`,
    summary:
      `Rata-rata ${p.puncak.strukPerHari} struk per hari di jam itu — ${p.rasioPuncak}x jam biasa ` +
      `(${p.rataPerJam} struk). Paling sepi jam ${jj(p.sepi.jam)}.`,
    metric_label: `${p.rasioPuncak}x jam biasa`,
    payload: { kind: 'OPERATIONAL_PEAK', ...p },
    actions: [{ label: 'Buka Laporan', kind: 'OPEN_REPORTS' }],
  };
}

/* --- 6. CALENDAR_BEHAVIOR (global) ---------------------------------------- */

/**
 * Hari terbaik dan terburuk dalam seminggu.
 *
 * Sama seperti jam: dibagi jumlah kemunculan hari itu, bukan dijumlahkan.
 * Jendela 30 hari memuat lima hari Senin dan empat hari Selasa — menjumlahkan
 * saja sudah cukup untuk membuat Senin selalu menang.
 */
export function computeCalendarBehavior(orders, { offsetJam = 7 } = {}) {
  const perHari = new Map();   // 0-6 -> { omzet, struk, tanggal:Set }

  for (const o of selesai(orders)) {
    const d = jamLokal(o.date, offsetJam);
    if (!d) continue;
    const dow = d.getUTCDay();
    if (!perHari.has(dow)) perHari.set(dow, { omzet: 0, struk: 0, tanggal: new Set() });
    const s = perHari.get(dow);
    s.omzet += Number(o.totalAmount ?? 0);
    s.struk++;
    s.tanggal.add(d.toISOString().slice(0, 10));
  }

  if (perHari.size < 3) return null;   // seminggu belum terwakili

  const hari = [...perHari.entries()]
    .map(([dow, s]) => ({
      dow,
      nama: NAMA_HARI[dow],
      omzetPerHari: round(s.omzet / Math.max(1, s.tanggal.size)),
      strukPerHari: round(s.struk / Math.max(1, s.tanggal.size), 2),
      kemunculan: s.tanggal.size,
    }))
    .sort((a, b) => b.omzetPerHari - a.omzetPerHari);

  const terbaik = hari[0];
  const terburuk = hari[hari.length - 1];
  const akhirPekan = hari.filter((h) => h.dow === 0 || h.dow === 6);
  const hariKerja = hari.filter((h) => h.dow >= 1 && h.dow <= 5);

  const rerata = (xs) => (xs.length ? round(xs.reduce((n, h) => n + h.omzetPerHari, 0) / xs.length) : 0);

  return {
    hari,
    terbaik,
    terburuk,
    omzetAkhirPekan: rerata(akhirPekan),
    omzetHariKerja: rerata(hariKerja),
    // Berapa kali lipat hari terbaik dibanding terburuk.
    rasio: terburuk.omzetPerHari > 0 ? round(terbaik.omzetPerHari / terburuk.omzetPerHari, 2) : 0,
  };
}

export function buildCalendarRow(merchantId, date, c) {
  if (!c || c.rasio < 1.4) return null;   // sebarannya rata, tidak ada yang perlu dikatakan

  return {
    id: idFor(merchantId, date, 'CALENDAR_BEHAVIOR'),
    business_id: merchantId,
    insight_date: date,
    category: 'CALENDAR_BEHAVIOR',
    priority: 3,
    title: `${c.terbaik.nama} ${c.rasio}x lebih ramai dari ${c.terburuk.nama}`,
    summary:
      `${c.terbaik.nama} rata-rata ${rupiah(c.terbaik.omzetPerHari)} per hari, ` +
      `${c.terburuk.nama} hanya ${rupiah(c.terburuk.omzetPerHari)}. ` +
      `Akhir pekan ${rupiah(c.omzetAkhirPekan)} vs hari kerja ${rupiah(c.omzetHariKerja)}.`,
    metric_label: `${c.terbaik.nama} tertinggi`,
    payload: { kind: 'CALENDAR_BEHAVIOR', ...c },
    actions: [{ label: 'Buat promo', kind: 'CREATE_PROMO' }],
  };
}

/* --- 7. SHIFT_PERFORMANCE (FNB, RETAIL, CARWASH) -------------------------- */

/**
 * Perbandingan antar shift.
 *
 * Hanya untuk sektor yang benar-benar bergiliran. Barbershop dan laundry kecil
 * sering dijaga satu orang sepanjang hari — "shift mana yang lebih baik"
 * bukan pertanyaan yang bisa dijawab di sana, dan jawabannya hanya akan
 * mengulang OPERATIONAL_PEAK dengan kata lain.
 */
export function computeShiftPerformance(orders, { offsetJam = 7 } = {}) {
  const per = SHIFT.map((s) => ({ ...s, omzet: 0, struk: 0, tanggal: new Set() }));

  for (const o of selesai(orders)) {
    const d = jamLokal(o.date, offsetJam);
    if (!d) continue;
    const jam = d.getUTCHours();
    const blok = per.find((s) => jam >= s.dari && jam < s.sampai);
    if (!blok) continue;             // dini hari: di luar jam kerja mana pun
    blok.omzet += Number(o.totalAmount ?? 0);
    blok.struk++;
    blok.tanggal.add(d.toISOString().slice(0, 10));
  }

  const aktif = per
    .filter((s) => s.struk > 0)
    .map((s) => ({
      nama: s.nama,
      dari: s.dari,
      sampai: s.sampai,
      omzetPerHari: round(s.omzet / Math.max(1, s.tanggal.size)),
      strukPerHari: round(s.struk / Math.max(1, s.tanggal.size), 2),
      rataStruk: s.struk > 0 ? round(s.omzet / s.struk) : 0,
      hariBeroperasi: s.tanggal.size,
    }))
    .sort((a, b) => b.omzetPerHari - a.omzetPerHari);

  if (aktif.length < 2) return null;   // satu shift saja: tidak ada pembanding

  const terbaik = aktif[0];
  const terlemah = aktif[aktif.length - 1];
  return {
    shift: aktif,
    terbaik,
    terlemah,
    rasio: terlemah.omzetPerHari > 0 ? round(terbaik.omzetPerHari / terlemah.omzetPerHari, 2) : 0,
  };
}

export function buildShiftRow(merchantId, date, s) {
  if (!s || s.rasio < 1.5) return null;

  return {
    id: idFor(merchantId, date, 'SHIFT_PERFORMANCE'),
    business_id: merchantId,
    insight_date: date,
    category: 'SHIFT_PERFORMANCE',
    priority: s.rasio >= 3 ? 2 : 3,
    title: `Shift ${s.terlemah.nama} tertinggal dari shift ${s.terbaik.nama}`,
    summary:
      `Shift ${s.terbaik.nama} rata-rata ${rupiah(s.terbaik.omzetPerHari)} per hari ` +
      `(${s.terbaik.strukPerHari} struk), shift ${s.terlemah.nama} ${rupiah(s.terlemah.omzetPerHari)} ` +
      `(${s.terlemah.strukPerHari} struk) — selisih ${s.rasio}x.`,
    metric_label: `${s.rasio}x selisih shift`,
    payload: { kind: 'SHIFT_PERFORMANCE', ...s },
    actions: [{ label: 'Buka Laporan', kind: 'OPEN_REPORTS' }],
  };
}

/* --- 8. LAYOUT_UTILISATION (FNB, LAUNDRY, BARBERSHOP) --------------------- */

/**
 * Tekanan pada TEMPAT: berapa banyak pelanggan yang dilayani di lokasi, dan
 * kapan tekanannya memuncak.
 *
 * BATAS YANG JUJUR: sistem ini belum menyimpan meja, bay, atau kursi sebagai
 * entitas, jadi perputaran meja yang sesungguhnya tidak bisa dihitung. Yang
 * dihitung di sini adalah pesanan yang dilayani DI TEMPAT (order_type DINE_IN)
 * per jam — pendekatan terdekat yang datanya benar-benar ada. Begitu meja
 * menjadi entitas, algoritma ini yang diganti, bukan ditambah di sebelahnya.
 *
 * Bedanya dengan OPERATIONAL_PEAK: yang itu tentang berapa ORANG yang harus
 * ada; yang ini tentang apakah TEMPATNYA cukup.
 */
export function computeLayoutUtilisation(orders, { offsetJam = 7 } = {}) {
  const ditempat = [];
  let totalSelesai = 0;

  for (const o of selesai(orders)) {
    totalSelesai++;
    const jenis = String(o.orderType || o.order_type || '').toUpperCase();
    if (jenis === 'DINE_IN') ditempat.push(o);
  }

  if (totalSelesai === 0 || ditempat.length === 0) return null;

  const perJam = new Map();
  const hari = new Set();
  for (const o of ditempat) {
    const d = jamLokal(o.date, offsetJam);
    if (!d) continue;
    const jam = d.getUTCHours();
    perJam.set(jam, (perJam.get(jam) || 0) + 1);
    hari.add(d.toISOString().slice(0, 10));
  }
  if (perJam.size === 0) return null;

  const jumlahHari = Math.max(1, hari.size);
  const jam = [...perJam.entries()]
    .map(([jam, n]) => ({ jam, perHari: round(n / jumlahHari, 2) }))
    .sort((a, b) => b.perHari - a.perHari);

  const puncak = jam[0];
  const rata = round(jam.reduce((n, j) => n + j.perHari, 0) / jam.length, 2);

  return {
    porsiDitempat: round(ditempat.length / totalSelesai, 4),
    totalDitempat: ditempat.length,
    totalTransaksi: totalSelesai,
    jam,
    puncak,
    rataPerJam: rata,
    tekananPuncak: rata > 0 ? round(puncak.perHari / rata, 2) : 0,
    hariDihitung: jumlahHari,
    // Dicatat di payload supaya pembacanya tahu ini pendekatan, bukan hitungan
    // meja yang sesungguhnya.
    basis: 'ORDER_TYPE_DINE_IN',
  };
}

export function buildLayoutRow(merchantId, date, l) {
  // Di bawah 30% dilayani di tempat, kapasitas ruang bukan kendalanya.
  if (!l || l.porsiDitempat < 0.3) return null;
  const jj = (n) => `${String(n).padStart(2, '0')}.00`;

  return {
    id: idFor(merchantId, date, 'LAYOUT_UTILISATION'),
    business_id: merchantId,
    insight_date: date,
    category: 'LAYOUT_UTILISATION',
    priority: l.tekananPuncak >= 2.5 ? 2 : 3,
    title: `Tekanan tempat tertinggi jam ${jj(l.puncak.jam)}`,
    summary:
      `${persen(l.porsiDitempat)} pesanan dilayani di tempat. ` +
      `Jam ${jj(l.puncak.jam)}–${jj(l.puncak.jam + 1)} rata-rata ${l.puncak.perHari} pelanggan di lokasi ` +
      `— ${l.tekananPuncak}x jam biasa.`,
    metric_label: `${persen(l.porsiDitempat)} di tempat`,
    payload: { kind: 'LAYOUT_UTILISATION', ...l },
    actions: [{ label: 'Buka Laporan', kind: 'OPEN_REPORTS' }],
  };
}

/* --- 9. STAFF_BEHAVIOUR (FNB, RETAIL, BARBERSHOP) ------------------------- */

/**
 * Perbandingan antar kasir: rata-rata nilai struk dan seberapa sering memberi
 * diskon.
 *
 * Butuh minimal dua kasir dengan cukup transaksi. Membandingkan orang dari
 * lima struk menghasilkan tuduhan, bukan informasi — itu sebabnya ada ambang
 * MIN_STRUK, dan itu sebabnya yang dilaporkan selisih, bukan peringkat.
 *
 * Diskon tinggi BUKAN otomatis kecurangan. Bisa saja satu orang memang
 * ditugasi melayani pelanggan langganan. Karena itu kalimatnya mengajak
 * memeriksa, bukan menyimpulkan.
 */
const MIN_STRUK_STAF = 20;

export function computeStaffBehaviour(orders) {
  const per = new Map();

  for (const o of selesai(orders)) {
    const kasir = o.cashierUserId || o.cashier_user_id;
    if (!kasir) continue;
    if (!per.has(kasir)) per.set(kasir, { kasir, nama: o.cashierName || o.cashier_name || null, struk: 0, omzet: 0, diskon: 0, strukBerdiskon: 0 });
    const s = per.get(kasir);
    s.struk++;
    s.omzet += Number(o.totalAmount ?? 0);
    const d = Number(o.discountAmount ?? 0);
    s.diskon += d;
    if (d > 0) s.strukBerdiskon++;
  }

  const staf = [...per.values()]
    .filter((s) => s.struk >= MIN_STRUK_STAF)
    .map((s) => ({
      kasir: s.kasir,
      nama: s.nama,
      struk: s.struk,
      omzet: round(s.omzet),
      rataStruk: round(s.omzet / s.struk),
      porsiBerdiskon: round(s.strukBerdiskon / s.struk, 4),
      rataDiskon: s.strukBerdiskon > 0 ? round(s.diskon / s.strukBerdiskon) : 0,
    }))
    .sort((a, b) => b.rataStruk - a.rataStruk);

  if (staf.length < 2) return null;

  const tertinggi = staf[0];
  const terendah = staf[staf.length - 1];
  const rataDiskonTim = round(staf.reduce((n, s) => n + s.porsiBerdiskon, 0) / staf.length, 4);
  // Yang paling sering memberi diskon, dan seberapa jauh dari kebiasaan timnya.
  const palingSeringDiskon = [...staf].sort((a, b) => b.porsiBerdiskon - a.porsiBerdiskon)[0];

  return {
    staf,
    tertinggi,
    terendah,
    rataDiskonTim,
    palingSeringDiskon,
    selisihRataStruk: terendah.rataStruk > 0 ? round(tertinggi.rataStruk / terendah.rataStruk, 2) : 0,
  };
}

export function buildStaffRow(merchantId, date, s) {
  if (!s) return null;

  // Menonjol kalau diskonnya dua kali kebiasaan tim DAN setidaknya satu dari
  // lima struknya berdiskon — dua syarat, supaya tim yang memang jarang
  // berdiskon tidak menghasilkan tuduhan dari selisih yang sangat kecil.
  const menonjol =
    s.palingSeringDiskon.porsiBerdiskon >= 0.2 &&
    s.rataDiskonTim > 0 &&
    s.palingSeringDiskon.porsiBerdiskon >= 2 * s.rataDiskonTim;

  if (!menonjol && s.selisihRataStruk < 1.4) return null;

  const siapa = (x) => x.nama || `Kasir ${String(x.kasir).slice(0, 8)}`;

  return {
    id: idFor(merchantId, date, 'STAFF_BEHAVIOUR'),
    business_id: merchantId,
    insight_date: date,
    category: 'STAFF_BEHAVIOUR',
    priority: menonjol ? 2 : 3,
    title: menonjol
      ? `Pola diskon ${siapa(s.palingSeringDiskon)} berbeda dari tim`
      : `Selisih nilai struk antar kasir ${s.selisihRataStruk}x`,
    summary: menonjol
      ? `${persen(s.palingSeringDiskon.porsiBerdiskon)} struk ${siapa(s.palingSeringDiskon)} memakai diskon ` +
        `(rata-rata tim ${persen(s.rataDiskonTim)}), rata-rata ${rupiah(s.palingSeringDiskon.rataDiskon)} per struk. ` +
        `Belum tentu keliru — periksa apakah memang ditugasi melayani pelanggan langganan.`
      : `${siapa(s.tertinggi)} rata-rata ${rupiah(s.tertinggi.rataStruk)} per struk, ` +
        `${siapa(s.terendah)} ${rupiah(s.terendah.rataStruk)} dari ${s.terendah.struk} struk.`,
    metric_label: menonjol ? persen(s.palingSeringDiskon.porsiBerdiskon) : `${s.selisihRataStruk}x`,
    payload: { kind: 'STAFF_BEHAVIOUR', ...s },
    actions: [{ label: 'Buka Laporan', kind: 'OPEN_REPORTS' }],
  };
}


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

/**
 * Cakupan bawaan bila tabel ai.algorithm_scope tidak bisa dibaca — mode
 * --dry-run, atau database yang belum menerapkan 0028.
 *
 * Nilainya SAMA dengan yang disisipkan migrasi itu. Kalau berbeda, dry-run
 * akan menjanjikan kartu yang tidak muncul di produksi.
 */
export const CAKUPAN_BAWAAN = {
  INVENTORY_ALERT: null,
  CROSS_SELL_OPPORTUNITY: null,
  CRM_CHURN: null,
  FINANCIAL_PERFORMANCE: null,
  OPERATIONAL_PEAK: null,
  CALENDAR_BEHAVIOR: null,
  SHIFT_PERFORMANCE: ['FNB', 'RETAIL', 'CARWASH'],
  LAYOUT_UTILISATION: ['FNB', 'LAUNDRY', 'BARBERSHOP'],
  STAFF_BEHAVIOUR: ['FNB', 'RETAIL', 'BARBERSHOP'],
};

/**
 * Apakah kategori ini berlaku untuk sektor merchant tersebut.
 *
 * `null` berarti global. Daftarnya datang dari database supaya memindahkan
 * sebuah algoritma antar sektor tidak menuntut deploy ulang — cakupan adalah
 * keputusan produk, bukan keputusan kode.
 */
export function berlakuUntukSektor(category, sector, cakupan = CAKUPAN_BAWAAN) {
  if (!(category in cakupan)) return false;
  const sektor = cakupan[category];
  if (sektor === null || sektor === undefined) return true;
  return sektor.includes(String(sector || '').toUpperCase());
}

export function buildInsightRows(merchantId, date, data) {
  const {
    reorder, basket, lapsedCustomers,
    orders = [],
    // Tanpa pembanding terpisah, financial jatuh kembali ke jendela berjalan —
    // hasilnya "tidak ada perbandingan", bukan angka yang salah.
    ordersPembanding = orders,
    sector = null,
    cakupan = CAKUPAN_BAWAAN,
    windowDays = 30,
    now = new Date(),
    offsetJam = 7,
  } = data;

  const rows = [];
  /** Kartu hanya ditambahkan bila kategorinya berlaku untuk sektor ini. */
  const tambah = (category, row) => {
    if (row && berlakuUntukSektor(category, sector, cakupan)) rows.push(row);
  };

  const churn = buildChurnRow(merchantId, date, lapsedCustomers);
  if (churn) tambah('CRM_CHURN', churn);

  if (reorder.length > 0) {
    const urgent = reorder.filter((r) => r.severity === 'OUT_OF_STOCK' || r.severity === 'CRITICAL');
    tambah('INVENTORY_ALERT', {
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
    tambah('CROSS_SELL_OPPORTUNITY', {
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

  // Enam algoritma sisanya. Semuanya dihitung dari `orders` yang sudah dimuat,
  // jadi tidak ada query tambahan per kategori — satu pemuatan data, sembilan
  // kategori.
  tambah('FINANCIAL_PERFORMANCE',
    buildFinancialRow(merchantId, date, computeFinancialPerformance(ordersPembanding, { windowDays, now })));
  tambah('OPERATIONAL_PEAK',
    buildPeakRow(merchantId, date, computeOperationalPeak(orders, { offsetJam, now })));
  tambah('CALENDAR_BEHAVIOR',
    buildCalendarRow(merchantId, date, computeCalendarBehavior(orders, { offsetJam })));
  tambah('SHIFT_PERFORMANCE',
    buildShiftRow(merchantId, date, computeShiftPerformance(orders, { offsetJam })));
  tambah('LAYOUT_UTILISATION',
    buildLayoutRow(merchantId, date, computeLayoutUtilisation(orders, { offsetJam })));
  tambah('STAFF_BEHAVIOUR',
    buildStaffRow(merchantId, date, computeStaffBehaviour(orders)));

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
  // Dua kali jendela. FINANCIAL_PERFORMANCE membandingkan periode berjalan
  // dengan periode SEBELUMNYA yang sama panjang; kalau yang dimuat hanya satu
  // jendela, pembandingnya selalu kosong dan setiap merchant terlihat tumbuh
  // tak terhingga di bulan pertamanya.
  const sejakBanding = new Date(Date.now() - 2 * windowDays * DAY_MS).toISOString();
  const orders = await client.query(
    `SELECT id, created_at AS date, payment_status, total_amount, discount_amount,
            order_type, cashier_user_id
       FROM transactions WHERE business_id = $1 AND created_at >= $2`,
    [merchantId, sejakBanding]);
  const items = await client.query('SELECT transaction_id, product_id, product_name AS name, quantity, unit_price, unit_cost FROM transaction_items WHERE business_id = $1', [merchantId]);

  // Nama kasir dibaca sekali, bukan di-join per transaksi. Insight staf
  // menyebut nama; id UUID di kartu tidak menolong siapa pun.
  const kasir = await client.query(
    'SELECT id, name FROM staff_users WHERE business_id = $1', [merchantId]);
  const namaKasir = new Map(kasir.rows.map((u) => [u.id, u.name]));

  // Sektor menentukan algoritma mana yang dijalankan.
  const usaha = await client.query(
    'SELECT business_sector FROM businesses WHERE id = $1', [merchantId]);
  const sector = usaha.rows[0]?.business_sector ?? null;

  // Cakupan dibaca dari tabel, bukan dipatok di kode. Kalau tabelnya belum ada
  // (database yang belum menerapkan 0028), dipakai cakupan bawaan yang isinya
  // sama — job tetap berjalan, tidak mati karena satu tabel.
  let cakupan = CAKUPAN_BAWAAN;
  try {
    const scope = await client.query(
      'SELECT category, sectors FROM ai.algorithm_scope WHERE is_active');
    if (scope.rows.length) {
      cakupan = Object.fromEntries(scope.rows.map((r) => [r.category, r.sectors]));
    }
  } catch {
    log('WARN  ai.algorithm_scope tidak terbaca — memakai cakupan bawaan.');
  }
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

  const semuaOrder = orders.rows.map((o) => ({
    ...o,
    status: o.payment_status === 'COMPLETED' ? 'COMPLETED' : o.payment_status,
    totalAmount: Number(o.total_amount ?? 0),
    discountAmount: Number(o.discount_amount ?? 0),
    orderType: o.order_type,
    cashierUserId: o.cashier_user_id,
    cashierName: namaKasir.get(o.cashier_user_id) ?? null,
    items: (itemsByTx.get(o.id) || []).map((li) => ({
      ...li,
      unitCost: Number(li.unit_cost ?? 0),
    })),
  }));

  return {
    lapsedCustomers: lapsed.rows,
    products: products.rows,
    stockItems: stockItems.rows,
    inventoryLogs: logs.rows,
    sector,
    cakupan,
    // Jendela berjalan — dipakai delapan dari sembilan algoritma.
    orders: semuaOrder.filter((o) => {
      const d = toDate(o.date);
      return d && d >= new Date(since);
    }),
    // Dua jendela penuh — HANYA untuk FINANCIAL_PERFORMANCE, yang memang perlu
    // periode sebelumnya sebagai pembanding. Memberikannya ke algoritma lain
    // akan diam-diam menggandakan jendela analisis mereka.
    ordersPembanding: semuaOrder,
  };
}

/* -------------------------------------------------------------------------- */
/* DEMO DATASET (dry-run)                                                     */
/* -------------------------------------------------------------------------- */

function demoData() {
  const day = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
  /**
   * Jam ditentukan supaya dry-run benar-benar menguji jam sibuk, shift, dan
   * hari — bukan hanya menghasilkan angka nol untuk tiga algoritma itu.
   * Waktu disimpan UTC dan toko berpikir WIB (UTC+7), jadi jam WIB dikurangi 7.
   */
  const jam = (n, jamWib) => {
    const d = new Date(Date.now() - n * DAY_MS);
    d.setUTCHours(jamWib - 7, 0, 0, 0);
    return d.toISOString();
  };
  const line = (productId, name, quantity, unitPrice, unitCost) =>
    ({ productId, name, quantity, unitPrice, unitCost });
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
    sector: 'FNB',
    // 60 hari: 30 berjalan + 30 pembanding, supaya FINANCIAL_PERFORMANCE punya
    // periode sebelumnya untuk dibandingkan. Harga modal naik di paruh kedua,
    // jadi dry-run menunjukkan margin yang menyusut — keadaan yang justru
    // paling perlu terlihat.
    orders: Array.from({ length: 60 }, (_, i) => {
      const baru = i < 30;                       // 30 hari terakhir
      const modalKopi = baru ? 10000 : 8000;     // supplier menaikkan harga
      return [
        { id: `t${i}a`, date: jam(i, 12), status: 'COMPLETED', orderType: 'DINE_IN',
          cashierUserId: 'u1', cashierName: 'Andi',
          totalAmount: 119000, discountAmount: 0,
          items: [line('p1', 'Kopi Susu Gula Aren', 3, 25000, modalKopi),
                  line('p2', 'Butter Croissant', 2, 22000, 7000)] },
        { id: `t${i}b`, date: jam(i, 9), status: 'COMPLETED', orderType: 'TAKEAWAY',
          cashierUserId: 'u1', cashierName: 'Andi',
          totalAmount: 50000, discountAmount: 0,
          items: [line('p1', 'Kopi Susu Gula Aren', 2, 25000, modalKopi)] },
        { id: `t${i}c`, date: jam(i, 12), status: 'COMPLETED', orderType: 'DINE_IN',
          cashierUserId: 'u2', cashierName: 'Sari',
          totalAmount: 54000, discountAmount: 6000,
          items: [line('p3', 'Nasi Goreng Spesial', 1, 35000, 14000),
                  line('p1', 'Kopi Susu Gula Aren', 1, 25000, modalKopi)] },
        { id: `t${i}d`, date: jam(i, 20), status: 'COMPLETED', orderType: 'DINE_IN',
          cashierUserId: 'u2', cashierName: 'Sari',
          totalAmount: 25000, discountAmount: 5000,
          items: [line('p1', 'Kopi Susu Gula Aren', 1, 25000, modalKopi)] },
      ];
    }).flat(),
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
    const rows = buildInsightRows(args.merchantId, insightDate, {
      reorder, basket,
      lapsedCustomers: data.lapsedCustomers,
      orders: data.orders,
      ordersPembanding: data.ordersPembanding ?? data.orders,
      sector: data.sector,
      cakupan: data.cakupan,
      windowDays: args.windowDays,
    });

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
    const rows = buildInsightRows(args.merchantId, insightDate, {
      reorder, basket,
      lapsedCustomers: data.lapsedCustomers,
      orders: data.orders,
      ordersPembanding: data.ordersPembanding,
      sector: data.sector,
      cakupan: data.cakupan,
      windowDays: args.windowDays,
    });

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

/*
 * HANYA berjalan bila berkas ini yang DIJALANKAN, bukan diimpor.
 *
 * Tanpa penjagaan ini, `import { computeOperationalPeak } from '...'` di berkas
 * tes ikut menjalankan seluruh batch — termasuk process.exit(1) saat tidak ada
 * DATABASE_URL, yang mematikan proses tes di tengah jalan.
 */
const dijalankanLangsung =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (dijalankanLangsung) {
  main().catch((err) => {
    log('FATAL', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
