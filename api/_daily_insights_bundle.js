// src/server/dailyInsightsHandler.ts
import { timingSafeEqual } from "node:crypto";

// services/shared/db.ts
import fs from "node:fs";
import pg from "pg";
pg.types.setTypeParser(1700, (v) => v === null ? null : Number(v));
pg.types.setTypeParser(20, (v) => v === null ? null : Number(v));
function konfigurasiSsl(connectionString) {
  const url = connectionString.toLowerCase();
  const lokal = url.includes("@127.0.0.1") || url.includes("@localhost") || url.includes("sslmode=disable");
  if (lokal) return void 0;
  if (process.env.PGSSLROOTCERT) {
    return { ca: fs.readFileSync(process.env.PGSSLROOTCERT, "utf8"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}
async function connectDb(opts) {
  const connectionString = opts.connectionString || process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5432/postgres";
  const pool = new pg.Pool({
    connectionString,
    ssl: konfigurasiSsl(connectionString),
    // Kecil dengan sengaja. Di pengembangan, keempat service berbagi satu
    // batas koneksi di db-server; pool besar per service akan menghabiskannya
    // dan membuat service yang menyala terakhir gagal tersambung.
    max: opts.max ?? Number(process.env.PGPOOL_MAX || 4),
    idleTimeoutMillis: 3e4,
    connectionTimeoutMillis: 1e4
  });
  void opts.schema;
  pool.on("error", (err) => {
    console.error("[db] koneksi idle bermasalah:", err.message);
  });
  await withRetry(async () => {
    const probe = await pool.connect();
    probe.release();
  });
  const wrap = (runner) => ({
    async query(sql, params) {
      const r = await runner.query(sql, params);
      const rows = r?.rows ?? [];
      return { rows, rowCount: r?.rowCount ?? rows.length };
    },
    async exec(sql) {
      await runner.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
        });
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  });
  return wrap(pool);
}
async function withRetry(fn, attempts = 15) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(250 * 2 ** i, 3e3);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`Database tidak bisa dihubungi setelah ${attempts} percobaan: ${lastErr?.message}`);
}

// src/data/initialData.ts
var INITIAL_BRANCHES = [
  {
    id: "branch-main",
    name: "Cabang Utama",
    address: "",
    latitude: -6.2088,
    longitude: 106.8456,
    allowedRadiusMeters: 200,
    businessSector: "FNB",
    isActive: true,
    notes: "Cabang Utama"
  }
];
var INITIAL_SETTINGS = {
  storeName: "Toko Baru",
  tagline: "",
  address: "",
  phone: "",
  taxRate: 0,
  enableTax: false,
  serviceRate: 0,
  enableService: false,
  currencySymbol: "Rp",
  receiptHeader: "Terima Kasih Atas Kunjungan Anda!",
  receiptFooter: "Semoga Harimu Menyenangkan!",
  storeMode: "FNB",
  autoPrintReceipt: false,
  receiptPaperSize: "80mm",
  loyaltyEarnRate: 1e4,
  loyaltyRedeemRate: 100,
  branches: INITIAL_BRANCHES,
  activeBranchId: "branch-main",
  geofenceEnforcement: "FLEXIBLE"
};
var INITIAL_SHIFT = {
  id: "shift-001",
  cashierName: "Kasir",
  startTime: (/* @__PURE__ */ new Date()).toISOString(),
  initialCash: 0,
  cashSales: 0,
  qrisSales: 0,
  cardSales: 0,
  eWalletSales: 0,
  totalSales: 0,
  expectedCash: 0,
  status: "OPEN"
};
var INITIAL_USERS = [
  {
    id: "usr-admin",
    name: "Pemilik Toko",
    username: "owner",
    role: "ADMIN",
    pin: "1234",
    email: "",
    phone: "",
    status: "ACTIVE",
    createdAt: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
  }
];
var INITIAL_KDS_TICKETS = [
  {
    id: "kds-01",
    orderId: "INV-101",
    orderNumber: 101,
    tableName: "Meja 01",
    orderType: "DINE_IN",
    items: [
      { id: "item-kds-1", name: "Es Kopi Susu Gula Aren", quantity: 2, variantName: "Regular (12oz)", notes: "Less ice, normal sugar" },
      { id: "item-kds-2", name: "Nasi Goreng Special New Hope", quantity: 1, notes: "Pedas level 3, telur setengah matang" }
    ],
    notes: "Prioritas cepat, tamu sedang meeting",
    createdAt: new Date(Date.now() - 1e3 * 60 * 8).toISOString(),
    // 8 menit lalu
    status: "PREPARING"
  },
  {
    id: "kds-02",
    orderId: "INV-102",
    orderNumber: 102,
    tableName: "Meja 04",
    orderType: "DINE_IN",
    items: [
      { id: "item-kds-3", name: "Matcha Latte Ice", quantity: 1, variantName: "Large (16oz)" },
      { id: "item-kds-4", name: "Butter Croissant Premium", quantity: 2, notes: "Dipanaskan oven" }
    ],
    createdAt: new Date(Date.now() - 1e3 * 60 * 3).toISOString(),
    // 3 menit lalu
    status: "PENDING"
  }
];
var INITIAL_CARWASH_QUEUE = [
  {
    id: "cwq-01",
    vehiclePlate: "B 1234 ABC",
    vehicleModel: "Toyota Fortuner Hitam",
    serviceName: "Cuci Mobil Hidrolik + Vakum Interior",
    assignedBayId: "tbl-cw-1",
    assignedBayName: "Bay 01 (Hidrolik Mobil)",
    assignedCrew: ["Joko", "Andi"],
    stage: "CUCI_BUSA",
    enteredAt: new Date(Date.now() - 1e3 * 60 * 20).toISOString(),
    notes: "Perhatikan pembersihan velg racing"
  },
  {
    id: "cwq-02",
    vehiclePlate: "D 5678 XYZ",
    vehicleModel: "Toyota Avanza Silver",
    serviceName: "Cuci Body Salju Cepat",
    assignedBayId: "tbl-cw-4",
    assignedBayName: "Bay 04 (Cuci Busa Salju)",
    assignedCrew: ["Budi"],
    stage: "PENGERINGAN_VAKUM",
    enteredAt: new Date(Date.now() - 1e3 * 60 * 35).toISOString(),
    notes: "Vakum jok karpet belakang"
  },
  {
    id: "cwq-03",
    vehiclePlate: "B 9999 PRO",
    vehicleModel: "Honda HR-V Putih",
    serviceName: "Paket Nano Ceramic Wax Body Protect",
    assignedCrew: ["Deni", "Rian"],
    stage: "ANTRIAN_BAY",
    enteredAt: new Date(Date.now() - 1e3 * 60 * 10).toISOString(),
    notes: "Antri menunggu Bay 01 selesai"
  }
];
var INITIAL_BOOKINGS = [
  {
    id: "bkg-01",
    customerName: "Mas Hendra",
    customerPhone: "081234567890",
    staffId: "stf-bb-1",
    staffName: "Alex",
    serviceId: "prod-bb-1",
    serviceName: "Executive Haircut + Hot Towel & Massage",
    servicePrice: 65e3,
    date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    timeSlot: "10:00",
    durationMinutes: 45,
    status: "CONFIRMED",
    notes: "Model undercut fade natural",
    createdAt: new Date(Date.now() - 1e3 * 60 * 120).toISOString()
  },
  {
    id: "bkg-02",
    customerName: "Pak Anton",
    customerPhone: "081987654321",
    staffId: "stf-bb-2",
    staffName: "Denis",
    serviceId: "prod-bb-3",
    serviceName: "Hair Coloring Premium Fashion Color",
    servicePrice: 15e4,
    date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    timeSlot: "13:00",
    durationMinutes: 90,
    status: "SCHEDULED",
    notes: "Warna Ash Brown, konsultasi dulu",
    createdAt: new Date(Date.now() - 1e3 * 60 * 60).toISOString()
  },
  {
    id: "bkg-03",
    customerName: "Rian Santoso",
    customerPhone: "085678912345",
    staffId: "stf-bb-3",
    staffName: "Budi",
    serviceId: "prod-bb-1",
    serviceName: "Executive Haircut + Hot Towel & Massage",
    servicePrice: 65e3,
    date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    timeSlot: "15:30",
    durationMinutes: 45,
    status: "SCHEDULED",
    notes: "Langganan setia",
    createdAt: new Date(Date.now() - 1e3 * 60 * 30).toISOString()
  }
];

// services/ai/snapshotData.ts
async function loadMerchantSnapshot(db, principal, businessId, now = /* @__PURE__ */ new Date()) {
  if (!principal?.subject || principal.subject === "local-development") throw new Error("AUTHENTICATION_REQUIRED");
  const merchant = (await db.query(`SELECT m.id,m.tenant_id,m.name,m.business_sector
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE m.external_ref=$1 AND t.owner_user_ref=$2`, [businessId, principal.subject])).rows[0];
  if (!merchant) throw new Error("BUSINESS_NOT_OWNED");
  const rows = (await db.query(`SELECT * FROM contract.transaction_log WHERE merchant_id=$1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 50001`, [merchant.id, now.toISOString()])).rows;
  if (rows.length > 5e4) throw new Error("ANALYTICS_HISTORY_TOO_LARGE");
  const items = (await db.query(`SELECT item_id AS id,transaction_id,product_id,product_name,unit_price,unit_cost,quantity,discount_amount,total_price FROM contract.transaction_items_detailed WHERE merchant_id=$1 AND transaction_at <= $2`, [merchant.id, now.toISOString()])).rows;
  const catalog = (await db.query(`SELECT * FROM contract.intelligence_catalog WHERE merchant_id=$1 ORDER BY id`, [merchant.id])).rows;
  const targets = (await db.query(`SELECT monthly_revenue_target FROM contract.business_targets WHERE merchant_id=$1 AND outlet_id IS NULL AND target_type='MONTHLY_REVENUE' ORDER BY updated_at DESC LIMIT 1`, [merchant.id])).rows;
  const byOrder = /* @__PURE__ */ new Map();
  for (const item of items) {
    const list = byOrder.get(item.transaction_id) || [];
    list.push(item);
    byOrder.set(item.transaction_id, list);
  }
  const orders = rows.map((r, index) => ({
    id: r.id,
    orderNumber: index,
    date: new Date(r.created_at).toISOString(),
    items: (byOrder.get(r.id) || []).map((i) => ({ id: i.id, productId: i.product_id, name: i.product_name, selectedModifiers: [], unitPrice: Number(i.unit_price), unitCost: i.unit_cost == null ? void 0 : Number(i.unit_cost), quantity: Number(i.quantity), discountPercent: 0, discountAmount: Number(i.discount_amount || 0), totalPrice: Number(i.total_price) })),
    orderType: r.order_type || "TAKEAWAY",
    subtotal: Number(r.subtotal),
    discountTotal: Number(r.discount_amount || 0),
    taxTotal: Number(r.tax_amount || 0),
    serviceChargeTotal: Number(r.service_charge_amount || 0),
    total: Number(r.total_amount),
    paymentMethod: r.payment_method || "CASH",
    paymentStatus: r.payment_status || "PENDING",
    cashierName: r.cashier_name,
    shiftId: r.shift_id || "",
    status: r.order_status === "COMPLETED" && r.payment_status === "PAID" ? "COMPLETED" : ["VOID", "CANCELLED"].includes(r.order_status) ? "VOID" : "HOLD"
  }));
  const products = catalog.map((p) => ({ id: p.id, sku: p.sku || "", name: p.name, categoryId: p.category_name || "other", price: Number(p.price), costPrice: Number(p.cost_price), stock: Number(p.stock || 0), minStockAlert: Number(p.min_stock_alert || 0), unit: p.unit || "pcs", isAvailable: p.is_available, businessSector: merchant.business_sector }));
  return {
    businessId,
    merchantId: merchant.id,
    tenantId: merchant.tenant_id,
    userRole: "ADMIN",
    generatedAt: now.toISOString(),
    businessSector: merchant.business_sector,
    storeName: merchant.name,
    slotNoun: "Tempat",
    settings: { ...INITIAL_SETTINGS, storeName: merchant.name, businessSector: merchant.business_sector, monthlyRevenueTarget: Number(targets[0]?.monthly_revenue_target) || void 0 },
    orders,
    products,
    categories: [...new Set(products.map((p) => p.categoryId))].map((id) => ({ id, name: id, icon: "", color: "" })),
    stockItems: [],
    inventoryLogs: [],
    customers: [],
    tables: [],
    staff: [],
    attendance: [],
    shifts: [],
    promoCodes: [],
    currentShift: { id: "", cashierName: "", startTime: now.toISOString(), initialCash: 0, cashSales: 0, qrisSales: 0, cardSales: 0, eWalletSales: 0, totalSales: 0, expectedCash: 0, status: "CLOSED" }
  };
}

// src/lib/assistant/periods.ts
var DAY = 864e5;
var WIB = 7 * 36e5;
function businessTime(value) {
  if (value === null || value === void 0 || value === "") return NaN;
  if (typeof value !== "string") return new Date(value).getTime();
  const naive = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(value);
  return Date.parse(naive ? `${value.length === 10 ? value + "T00:00:00" : value.replace(" ", "T")}+07:00` : value);
}
var businessDate = (date) => new Date(businessTime(date) + WIB).toISOString().slice(0, 10);
var businessHour = (date) => new Date(businessTime(date) + WIB).getUTCHours();
var dayStart = (date) => Date.parse(`${date}T00:00:00+07:00`);
var addDate = (date, days) => businessDate(dayStart(date) + days * DAY);
var weekday = (date) => (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();

// src/lib/assistant/businessBrain.ts
var BRAIN_VERSION = "1.0.0";
var n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
var sum = (rows, get) => rows.reduce((a, r) => a + get(r), 0);
var mean = (xs) => xs.length ? sum(xs, (x) => x) / xs.length : 0;
var round = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
var median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : 0;
};
var paid = (o) => o.status === "COMPLETED" && o.paymentStatus === "PAID";
var change = (current, prior) => prior > 0 ? round((current / prior - 1) * 100) : null;
function currentCost(p) {
  if (p.recipeIngredients?.length) {
    if (p.recipeIngredients.some((i) => !Number.isFinite(i.costPerUnit) || i.costPerUnit <= 0 || i.quantity <= 0)) return null;
    return sum(p.recipeIngredients, (i) => i.quantity * i.costPerUnit);
  }
  return Number.isFinite(p.costPrice) && p.costPrice > 0 ? p.costPrice : null;
}
function predict(series, date, method) {
  const samples = method === "WEEKDAY" ? series.filter((d) => weekday(d.date) === weekday(date)).slice(-8) : series.slice(-28);
  const values = samples.map((d) => d.qty);
  const expected = mean(values);
  const deviation = values.length > 1 ? Math.sqrt(sum(values, (v) => (v - expected) ** 2) / (values.length - 1)) : 0;
  const radius = (values.length < 10 ? 2.5 : 2) * deviation * Math.sqrt(1 + 1 / Math.max(1, values.length));
  return { date, expected: round(expected), low: Math.max(0, Math.floor(expected - radius)), high: Math.ceil(expected + radius) };
}
function forecastDemand(p, orders, today) {
  const quantities = /* @__PURE__ */ new Map();
  for (const o of orders) for (const i of o.items) if (i.productId === p.id) {
    const date = businessDate(o.date);
    quantities.set(date, (quantities.get(date) || 0) + Math.max(0, n(i.quantity)));
  }
  const first = [...quantities.keys()].sort()[0];
  const from = first && first > addDate(today, -84) ? first : addDate(today, -84);
  const historyDays = first ? Math.max(0, Math.round((dayStart(today) - dayStart(from)) / DAY)) : 0;
  const series = Array.from({ length: historyDays }, (_, i) => ({ date: addDate(from, i), qty: quantities.get(addDate(from, i)) || 0 }));
  let method = historyDays >= 28 ? "WEEKDAY" : historyDays >= 14 ? "DAILY_MEAN" : "INSUFFICIENT";
  let backtest = null;
  if (historyDays >= 35) {
    const errors = [];
    const baseline = [];
    for (let i = Math.max(28, historyDays - 14); i < historyDays; i++) {
      const training = series.slice(0, i);
      const actual = series[i];
      errors.push(Math.abs(predict(training, actual.date, "WEEKDAY").expected - actual.qty));
      baseline.push(Math.abs(predict(training, actual.date, "DAILY_MEAN").expected - actual.qty));
    }
    backtest = { mae: round(mean(errors)), baselineMae: round(mean(baseline)), points: errors.length };
    if (backtest.mae > backtest.baselineMae) {
      method = "DAILY_MEAN";
      backtest.mae = backtest.baselineMae;
    }
  }
  return {
    productId: p.id,
    name: p.name,
    unit: p.unit,
    historyDays,
    observations: quantities.size,
    method,
    backtest,
    days: method === "INSUFFICIENT" ? [] : Array.from({ length: 7 }, (_, i) => predict(series, addDate(today, i + 1), method)),
    limitations: [
      "Rentang indikatif, bukan jaminan probabilitas. Hari tanpa penjualan dihitung nol; hari tutup dan stockout belum dipisahkan.",
      "Belum memasukkan cuaca, efek kausal promo, atau musim tahunan; perlu data tambahan."
    ]
  };
}
function unitFactor(from, to) {
  const units = { g: ["mass", 1], gram: ["mass", 1], kg: ["mass", 1e3], kilogram: ["mass", 1e3], ml: ["volume", 1], liter: ["volume", 1e3], l: ["volume", 1e3], pcs: ["count", 1], pc: ["count", 1] };
  if (from.toLowerCase() === to.toLowerCase()) return 1;
  const a = units[from.toLowerCase()], b = units[to.toLowerCase()];
  return a && b && a[0] === b[0] ? a[1] / b[1] : null;
}
function buildBusinessBrain(s, source = "CLIENT") {
  const now = businessTime(s.generatedAt);
  const today = businessDate(now);
  const yesterday = addDate(today, -1);
  const valid = s.orders.filter((o) => Number.isFinite(businessTime(o.date)) && businessTime(o.date) <= now);
  const sales = valid.filter(paid);
  const closed = sales.filter((o) => businessDate(o.date) < today);
  const recent = closed.filter((o) => businessDate(o.date) >= addDate(today, -30));
  const yesterdayOrders = closed.filter((o) => businessDate(o.date) === yesterday);
  const firstDate = closed.map((o) => businessDate(o.date)).sort()[0];
  const baselineDates = Array.from({ length: 8 }, (_, i) => addDate(yesterday, -7 * (i + 1))).filter((d) => firstDate && d >= firstDate);
  const baseline = closed.filter((o) => baselineDates.includes(businessDate(o.date)));
  const k = baselineDates.length;
  const baseOrders = k ? baseline.length / k : 0;
  const baseRevenue = k ? sum(baseline, (o) => n(o.total)) / k : 0;
  const baseBasket = baseOrders ? baseRevenue / baseOrders : 0;
  const revenue = sum(yesterdayOrders, (o) => n(o.total));
  const basket = yesterdayOrders.length ? revenue / yesterdayOrders.length : 0;
  const enough = k >= 4;
  const transactionEffect = enough ? (yesterdayOrders.length - baseOrders) * (basket + baseBasket) / 2 : null;
  const basketEffect = enough ? (basket - baseBasket) * (yesterdayOrders.length + baseOrders) / 2 : null;
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const current = sum(yesterdayOrders.filter((o) => businessHour(o.date) === hour), (o) => n(o.total));
    const prior2 = k ? sum(baseline.filter((o) => businessHour(o.date) === hour), (o) => n(o.total)) / k : 0;
    return { hour, current: round(current), baseline: round(prior2), delta: round(current - prior2) };
  }).sort((a, b) => a.delta - b.delta);
  const channels = [...new Set([...baseline, ...yesterdayOrders].map((o) => o.orderType))].map((name) => {
    const current = sum(yesterdayOrders.filter((o) => o.orderType === name), (o) => n(o.total));
    const prior2 = k ? sum(baseline.filter((o) => o.orderType === name), (o) => n(o.total)) / k : 0;
    return { name, current: round(current), baseline: round(prior2), delta: round(current - prior2) };
  }).sort((a, b) => a.delta - b.delta);
  const monthStart = today.slice(0, 8) + "01";
  const mtd = sum(sales.filter((o) => businessDate(o.date) >= monthStart), (o) => n(o.total));
  const completedDays = Number(today.slice(8)) - 1;
  const monthDays = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const closedMtd = sum(closed.filter((o) => businessDate(o.date) >= monthStart), (o) => n(o.total));
  const target = n(s.settings.monthlyRevenueTarget) || null;
  const projected = completedDays >= 7 ? round(closedMtd / completedDays * monthDays) : null;
  const menu = s.products.filter((p) => p.isAvailable).map((p) => {
    const lines = recent.flatMap((o) => o.items.filter((i) => i.productId === p.id).map((i) => ({ i, discountFactor: n(o.subtotal) > 0 ? Math.max(0, 1 - n(o.discountTotal) / n(o.subtotal)) : 1 })));
    const qty = sum(lines, (l) => n(l.i.quantity));
    const lineRevenue = sum(lines, (l) => n(l.i.totalPrice) * l.discountFactor);
    const known = lines.filter((l) => Number.isFinite(l.i.unitCost) && n(l.i.unitCost) > 0);
    const coverage = qty > 0 ? sum(known, (l) => n(l.i.quantity)) / qty * 100 : 0;
    const contribution = coverage === 100 ? lineRevenue - sum(known, (l) => n(l.i.unitCost) * n(l.i.quantity)) : null;
    const cost = currentCost(p);
    return {
      productId: p.id,
      name: p.name,
      quantity: qty,
      revenue: round(lineRevenue),
      contribution: contribution === null ? null : round(contribution),
      unitContribution: contribution !== null && qty > 0 ? round(contribution / qty) : null,
      costCoveragePct: round(coverage),
      currentCost: cost,
      currentMarginPct: cost !== null && p.price > 0 ? round((p.price - cost) / p.price * 100) : null,
      targetMarginPct: p.targetMarginPercent || null,
      quadrant: "UNKNOWN"
    };
  });
  const knownMenu = menu.filter((m) => m.unitContribution !== null);
  const popularity = mean(menu.map((m) => m.quantity));
  const margin = median(knownMenu.map((m) => m.unitContribution));
  for (const m of menu) if (m.unitContribution !== null && recent.length >= 20) m.quadrant = m.quantity >= popularity ? m.unitContribution >= margin ? "STAR" : "PLOWHORSE" : m.unitContribution >= margin ? "PUZZLE" : "DOG";
  menu.sort((a, b) => b.revenue - a.revenue);
  const demand = s.products.filter((p) => p.isAvailable).map((p) => forecastDemand(p, closed, today));
  const required = /* @__PURE__ */ new Map();
  const limitations = [
    "Cakupan satu unit usaha; tidak menyimpulkan usaha atau outlet lain dari data ini.",
    "Omzet memakai total struk; margin kontribusi memakai penjualan setelah diskon, sebelum pajak, service charge dan beban operasional.",
    "Pola historis menunjukkan keterkaitan, bukan membuktikan penyebab atau efek suatu tindakan."
  ];
  for (const f of demand.filter((d) => d.days.length)) {
    const p = s.products.find((p2) => p2.id === f.productId);
    const need = sum(f.days, (d) => d.high);
    if (p.recipeIngredients?.length) for (const ingredient of p.recipeIngredients) {
      const stock = s.stockItems.find((i) => i.id === ingredient.ingredientId);
      const factor = stock ? unitFactor(ingredient.unit, stock.unit) : null;
      if (!stock || factor === null) {
        limitations.push(`Kebutuhan ${ingredient.ingredientName} belum dihitung: bahan atau konversi satuan belum lengkap.`);
        continue;
      }
      const row = required.get(stock.id) || { name: stock.name, unit: stock.unit, demand: 0, stock: stock.stock, cost: stock.costPrice > 0 ? stock.costPrice : null };
      row.demand += need * ingredient.quantity * factor;
      required.set(stock.id, row);
    }
    else if (p.linkedStockItemId) {
      const stock = s.stockItems.find((i) => i.id === p.linkedStockItemId);
      if (!stock || !(p.recipeQty > 0)) {
        limitations.push(`Resep ${p.name} belum lengkap untuk pembelian.`);
        continue;
      }
      const row = required.get(stock.id) || { name: stock.name, unit: stock.unit, demand: 0, stock: stock.stock, cost: stock.costPrice > 0 ? stock.costPrice : null };
      row.demand += need * p.recipeQty;
      required.set(stock.id, row);
    } else required.set(p.id, { name: p.name, unit: p.unit, demand: need, stock: p.stock, cost: currentCost(p) });
  }
  const procurement = [...required].map(([itemId, r]) => {
    const qty = Math.max(0, Math.ceil((r.demand - r.stock) * 100) / 100);
    return {
      itemId,
      name: r.name,
      unit: r.unit,
      demand: round(r.demand),
      onHand: r.stock,
      suggestedQty: qty,
      estimatedCost: r.cost === null ? null : round(qty * r.cost),
      coverageDays: r.demand > 0 ? round((r.stock + qty) / (r.demand / 7)) : null,
      supplier: null
    };
  }).filter((r) => r.suggestedQty > 0).sort((a, b) => (b.estimatedCost || 0) - (a.estimatedCost || 0));
  const defaultCycle = { FNB: 14, RETAIL: 30, LAUNDRY: 14, CARWASH: 21, BARBERSHOP: 35 }[s.businessSector];
  const customers = s.customers.map((c) => {
    const visits = sales.filter((o) => o.customer?.id === c.id).sort((a, b) => businessTime(a.date) - businessTime(b.date));
    const historyDays = visits.length ? Math.max(1, (now - businessTime(visits[0].date)) / DAY) : 0;
    const recency = visits.length ? Math.floor((now - businessTime(visits[visits.length - 1].date)) / DAY) : Number.isFinite(businessTime(c.lastVisit)) ? Math.floor((now - businessTime(c.lastVisit)) / DAY) : 0;
    const gaps = visits.slice(1).map((o, i) => (businessTime(o.date) - businessTime(visits[i].date)) / DAY).filter((g) => g > 0);
    const cycle = gaps.length >= 3 ? Math.max(1, median(gaps)) : defaultCycle;
    const value = sum(visits, (o) => n(o.total));
    const count = /* @__PURE__ */ new Map();
    for (const o of visits) for (const i of o.items) count.set(i.name, (count.get(i.name) || 0) + i.quantity);
    let segment = visits.length <= 1 ? "NEW" : visits.length >= 5 ? "LOYAL" : "POTENTIAL";
    if (visits.length >= 10 && recency <= cycle) segment = "CHAMPION";
    if (visits.length >= 2 && recency > cycle * 2) segment = "AT_RISK";
    if (visits.length >= 2 && recency > cycle * 3) segment = "HIBERNATING";
    if (visits.length >= 2 && recency > cycle * 5) segment = "LOST";
    return {
      id: c.id,
      name: c.name,
      orders: visits.length,
      revenue: round(value),
      avgBasket: visits.length ? round(value / visits.length) : 0,
      recencyDays: recency,
      expectedCycleDays: round(cycle),
      segment,
      historyDays: Math.floor(historyDays),
      favourite: [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      // Explicit observed-rate scenario, not a probabilistic lifetime model.
      projected12m: historyDays >= 90 && visits.length >= 5 ? round(value / historyDays * 365) : null
    };
  }).sort((a, b) => b.revenue - a.revenue);
  const offers = basketOffers(recent, s.products);
  const anomalies = [];
  const prior = valid.filter((o) => businessDate(o.date) >= addDate(today, -60) && businessDate(o.date) < addDate(today, -30));
  const allRecent = valid.filter((o) => businessDate(o.date) >= addDate(today, -30) && businessDate(o.date) < today);
  for (const [label, predicate] of [["Void", (o) => o.status === "VOID"], ["Refund", (o) => o.paymentStatus === "REFUNDED"]]) {
    const count = allRecent.filter(predicate).length;
    const rate = allRecent.length ? count / allRecent.length : 0;
    const priorRate = prior.length ? prior.filter(predicate).length / prior.length : 0;
    if (allRecent.length >= 20 && prior.length >= 20 && count >= 3 && rate > priorRate * 2 && rate - priorRate > 0.03) anomalies.push({ id: label, title: `Lonjakan ${label.toLowerCase()} perlu ditinjau`, evidence: `${count}/${allRecent.length} transaksi (${round(rate * 100)}%) vs ${round(priorRate * 100)}% periode pembanding. Bukan tuduhan fraud.`, severity: "REVIEW" });
  }
  const highDiscount = allRecent.filter((o) => o.subtotal > 0 && o.discountTotal / o.subtotal >= 0.3);
  if (highDiscount.length >= 3) anomalies.push({ id: "discount", title: "Diskon besar berulang", evidence: `${highDiscount.length} transaksi memakai diskon minimal 30%. Periksa otorisasi dan tujuan promo.`, severity: "REVIEW" });
  const shifts = s.shifts.filter((sh) => sh.endTime && Number.isFinite(businessTime(sh.endTime)) && businessTime(sh.endTime) <= now && businessTime(sh.startTime) >= dayStart(addDate(today, -30)));
  const timed = shifts.map((sh) => ({ sh, hours: (businessTime(sh.endTime) - businessTime(sh.startTime)) / 36e5 })).filter((x) => x.hours > 0 && x.hours <= 24);
  const staffedHours = sum(timed, (x) => x.hours);
  const served = sum(timed, (x) => closed.filter((o) => o.shiftId === x.sh.id).length);
  const productivity = timed.length >= 5 && staffedHours > 0 ? served / staffedHours : null;
  const peak = [...Array(24)].map((_, hour) => ({ hour, count: recent.filter((o) => businessHour(o.date) === hour).length })).sort((a, b) => b.count - a.count)[0];
  const variances = timed.filter((x) => Math.abs(n(x.sh.difference)) > 1e4);
  if (variances.length >= 3) anomalies.push({ id: "cash", title: "Selisih kas berulang", evidence: `${variances.length} shift memiliki selisih kas di atas Rp10.000. Verifikasi uang awal, kembalian dan rekonsiliasi; bukan tuduhan.`, severity: "REVIEW" });
  const occupied = s.tables.filter((t) => ["OCCUPIED", "BILLING"].includes(t.status)).length;
  const sector = { title: `Intelligence ${s.businessSector}`, metrics: [], missing: [] };
  if (s.businessSector === "FNB") {
    sector.metrics = [{ label: "Produk dengan resep", value: String(s.products.filter((p) => p.recipeIngredients?.length).length) }, { label: "Meja terisi saat ini", value: `${occupied}/${s.tables.length}` }];
    sector.missing = ["Durasi stockout dan food waste memerlukan pencatatan kejadian."];
  }
  if (s.businessSector === "RETAIL") {
    sector.metrics = [{ label: "SKU tanpa penjualan 30 hari", value: String(menu.filter((p) => p.quantity === 0).length) }];
    sector.missing = ["Kecepatan penjualan belum membedakan hari toko tutup."];
  }
  if (s.businessSector === "LAUNDRY") {
    const pending = valid.filter((o) => o.status !== "VOID" && o.laundryStage && o.laundryStage !== "SELESAI");
    sector.metrics = [{ label: "Pekerjaan belum selesai", value: String(pending.length) }, { label: "Lewat estimasi valid", value: String(pending.filter((o) => o.completionEstimate && Number.isFinite(businessTime(o.completionEstimate)) && businessTime(o.completionEstimate) < now).length) }];
    sector.missing = ["Perkiraan selesai berupa teks bebas tidak dihitung sebagai tanggal."];
  }
  if (s.businessSector === "CARWASH" || s.businessSector === "BARBERSHOP") {
    sector.metrics = [{ label: s.businessSector === "CARWASH" ? "Bay terisi saat ini" : "Kursi terisi saat ini", value: `${occupied}/${s.tables.length}` }];
    sector.missing = ["Prediksi waktu antre membutuhkan timestamp mulai dan selesai layanan."];
  }
  const actions = [];
  if (procurement.length) actions.push({ id: "procurement", kind: "PROCUREMENT", title: "Tinjau draft pembelian 7 hari", reason: `${procurement.length} bahan/produk membutuhkan tambahan berdasarkan batas atas perkiraan.`, draft: procurement.map((p) => `${p.name}: ${p.suggestedQty} ${p.unit}; estimasi biaya ${p.estimatedCost === null ? "belum ada HPP" : p.estimatedCost}`).join("\n") + "\nSupplier, MOQ, jadwal kedatangan dan pesanan masuk perlu dikonfirmasi. Belum dikirim.", metric: "stockCritical" });
  const risk = customers.filter((c) => c.segment === "AT_RISK");
  if (risk.length) actions.push({ id: "crm", kind: "CRM", title: `Draft comeback untuk ${risk.length} pelanggan`, reason: `Pendapatan historis teramati ${round(sum(risk, (c) => c.revenue))}; bukan estimasi uang yang pasti hilang.`, draft: `Audiens (ID): ${risk.map((c) => c.id).join(", ")}
Pesan: Halo, sudah lama tidak bertemu! Yuk mampir lagi untuk menikmati pilihan favoritmu.
Periksa persetujuan pemasaran dan promo sebelum mengirim.`, metric: "orders" });
  const leak = menu.find((m) => m.currentMarginPct !== null && m.targetMarginPct && m.currentMarginPct < m.targetMarginPct);
  if (leak) actions.push({ id: `price:${leak.productId}`, kind: "PRICING", title: `Simulasikan harga ${leak.name}`, reason: `Margin saat ini ${leak.currentMarginPct}% di bawah target ${leak.targetMarginPct}%.`, draft: "Gunakan simulasi harga. Harga katalog tidak diubah otomatis; elastisitas permintaan belum diketahui.", metric: "revenue" });
  if (offers.length) {
    const o = offers[0];
    const a = s.products.find((p) => p.id === o.aId), b = s.products.find((p) => p.id === o.bId);
    const ca = currentCost(a), cb = currentCost(b);
    const normal = a.price + b.price;
    const proposed = Math.round(normal * 0.95);
    const margin2 = ca !== null && cb !== null ? (proposed - ca - cb) / proposed * 100 : null;
    if (margin2 !== null && margin2 >= Math.max(a.targetMarginPercent || 30, b.targetMarginPercent || 30)) actions.push({ id: "promo", kind: "PROMO", title: `Simulasi bundle ${a.name} + ${b.name}`, reason: `Terbeli bersama ${o.count} kali; lift ${o.lift}. Uplift belum terbukti.`, draft: `Harga normal ${normal}; simulasi diskon 5%: ${proposed}. Margin kontribusi estimasi ${round(margin2)}%. Tidak otomatis membuat diskon.`, metric: "revenue" });
  }
  if (productivity && peak.count) actions.push({ id: "workforce", kind: "WORKFORCE", title: "Tinjau kapasitas jam ramai", reason: `Jam ${peak.hour}:00 paling ramai; kapasitas berasal dari ${timed.length} shift kasir lengkap.`, draft: "Periksa jadwal dan jenis pekerjaan bersama supervisor. Data shift kasir bukan total jam kerja seluruh kru; belum dapat menetapkan jumlah pegawai optimal.", metric: "orders" });
  for (const a of anomalies) actions.push({ id: `review:${a.id}`, kind: "REVIEW", title: a.title, reason: a.evidence, draft: "Tinjau struk dan rekonsiliasi bersama penanggung jawab. Catat hasil pemeriksaan; jangan menyimpulkan pelanggaran dari flag statistik saja.", metric: "revenue" });
  if (!enough) limitations.push("Pembanding omzet membutuhkan minimal empat hari sejenis sebelumnya.");
  if (source === "CLIENT") limitations.push("Data perangkat ini; kelengkapan sinkronisasi dan terminal lain belum diverifikasi.");
  limitations.push("Proyeksi nilai pelanggan 12 bulan adalah skenario laju historis, bukan CLV bersih atau prediksi retensi terkalibrasi.");
  return {
    version: BRAIN_VERSION,
    businessId: s.businessId,
    generatedAt: s.generatedAt,
    source,
    period: { from: addDate(today, -30), to: yesterday },
    limitations: [...new Set(limitations)],
    sales: {
      date: yesterday,
      revenue: round(revenue),
      orders: yesterdayOrders.length,
      basket: round(basket),
      baselineDays: k,
      baselineRevenue: round(baseRevenue),
      revenueChangePct: enough ? change(revenue, baseRevenue) : null,
      transactionEffect: transactionEffect === null ? null : round(transactionEffect),
      basketEffect: basketEffect === null ? null : round(basketEffect),
      hours,
      channels,
      mtdRevenue: round(mtd),
      projectedMonthEnd: projected,
      monthlyTarget: target,
      dailyNeeded: target ? round(Math.max(0, target - mtd) / (monthDays - completedDays)) : null
    },
    demand,
    procurement,
    menu,
    customers,
    offers,
    anomalies,
    workforce: { completedShifts: timed.length, excludedShifts: s.shifts.length - timed.length, ordersPerHour: productivity === null ? null : round(productivity), peakHour: peak.count ? peak.hour : null, suggestedStaff: null },
    sector,
    actions
  };
}
function basketOffers(orders, products) {
  const baskets = orders.map((o) => new Set(o.items.map((i) => i.productId)));
  const offers = [];
  if (baskets.length >= 20) {
    const counts = /* @__PURE__ */ new Map();
    const pairs = /* @__PURE__ */ new Map();
    for (const basket of baskets) {
      const ids = [...basket].sort();
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const key = JSON.stringify([ids[i], ids[j]]);
        const old = pairs.get(key);
        pairs.set(key, [ids[i], ids[j], (old?.[2] || 0) + 1]);
      }
    }
    for (const [left, right, count] of pairs.values()) for (const [aId, bId] of [[left, right], [right, left]]) {
      const confidence = count / counts.get(aId);
      const support = count / baskets.length;
      const lift = confidence / (counts.get(bId) / baskets.length);
      const a = products.find((p) => p.id === aId), b = products.find((p) => p.id === bId);
      if (a && b && b.isAvailable && b.stock > 0 && count >= 5 && support >= 0.05 && confidence >= 0.2 && lift > 1.05) offers.push({ aId, bId, aName: a.name, bName: b.name, count, confidence: round(confidence, 4), support: round(support, 4), lift: round(lift) });
    }
  }
  offers.sort((a, b) => b.lift - a.lift || b.count - a.count);
  return offers;
}

// src/utils/formatters.ts
function formatRupiah(amount) {
  if (isNaN(amount) || amount === null || amount === void 0) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(amount);
}

// src/lib/assistant/insights.ts
var MS_PER_DAY = 864e5;
var DAYS_OF_COVER_SENTINEL = 999;
var DAY_LABELS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
var SEVERITY_RANK = {
  OUT_OF_STOCK: 0,
  CRITICAL: 1,
  BELOW_ROP: 2,
  WATCH: 3
};
var EMPTY_TIER_COUNTS = {
  BRONZE: 0,
  SILVER: 0,
  GOLD: 0,
  PLATINUM: 0,
  TOTAL: 0
};
function toDate(value) {
  const d = new Date(businessTime(value));
  return Number.isNaN(d.getTime()) ? null : d;
}
function calendarParts(date) {
  const [year, month, day] = businessDate(date).split("-").map(Number);
  return { year, month: month - 1, day };
}
function daysInBusinessMonth(date) {
  const { year, month } = calendarParts(date);
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
function startOfDayTime(d) {
  return dayStart(businessDate(d));
}
function dateKey(d) {
  return businessDate(d);
}
function keyToTime(key) {
  const parts = key.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return dayStart(key);
}
function addDays(time, days) {
  return time + days * MS_PER_DAY;
}
function round2(n2) {
  if (!Number.isFinite(n2)) return 0;
  return Math.round(n2 * 100) / 100;
}
function round1(n2) {
  if (!Number.isFinite(n2)) return 0;
  return Math.round(n2 * 10) / 10;
}
function round0(n2) {
  if (!Number.isFinite(n2)) return 0;
  return Math.round(n2);
}
function safeDiv(a, b, fallback = 0) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return fallback;
  const r = a / b;
  return Number.isFinite(r) ? r : fallback;
}
function pctOf(part, whole) {
  return whole > 0 ? round2(part / whole * 100) : 0;
}
function normName(value) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function num(value, decimals = 1) {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith("-");
  const bare = negative ? fixed.slice(1) : fixed;
  const [intPart, fracPart] = bare.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const hasFraction = !!fracPart && Number(fracPart) !== 0;
  return `${negative ? "-" : ""}${grouped}${hasFraction ? `,${fracPart}` : ""}`;
}
function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}
function shortDate(time) {
  const { day, month } = calendarParts(new Date(time));
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"][month]}`;
}
function resolveOptions(snapshot, options) {
  const now = options?.now && !Number.isNaN(options.now.getTime()) ? options.now : toDate(snapshot.generatedAt) || /* @__PURE__ */ new Date();
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
    windowStart: addDays(todayStart, -(windowDays - 1))
  };
}
function buildCatalog(products) {
  const byId = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  for (const p of products) {
    if (p && p.id) byId.set(p.id, p);
    const n2 = normName(p?.name);
    if (n2 && !byName.has(n2)) byName.set(n2, p);
  }
  return { byId, byName };
}
function datedOrders(orders, opt) {
  const out = [];
  for (const order of orders || []) {
    const date = toDate(order?.date);
    if (!date || date.getTime() > opt.now.getTime()) continue;
    if (order.status === "COMPLETED" && order.paymentStatus !== "PAID") continue;
    const dayTime = startOfDayTime(date);
    out.push({ order, date, time: date.getTime(), dayKey: dateKey(date), dayTime });
  }
  return out.sort((a, b) => a.time - b.time);
}
function inWindow(o, opt) {
  return o.dayTime >= opt.windowStart && o.time <= opt.now.getTime();
}
function linesOf(order, catalog) {
  const out = [];
  for (const item of order?.items || []) {
    if (!item) continue;
    const product = (item.productId ? catalog.byId.get(item.productId) : void 0) || catalog.byName.get(normName(item.name)) || null;
    const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
    const unitPrice = Number.isFinite(item.unitPrice) ? item.unitPrice : product?.price ?? 0;
    const lineTotal = Number.isFinite(item.totalPrice) ? item.totalPrice : unitPrice * qty;
    const key = product?.id || (item.productId ? item.productId : "") || `name:${normName(item.name)}`;
    out.push({
      key: key || `name:${normName(item.name) || "tanpa-nama"}`,
      name: item.name || product?.name || "Item tanpa nama",
      qty,
      unitPrice,
      lineTotal,
      product
    });
  }
  return out;
}
function lineCost(line) {
  const cost = line.product && Number.isFinite(line.product.costPrice) ? line.product.costPrice : line.unitPrice * 0.5;
  return cost * line.qty;
}
function buildInsight(snapshot, opt, category, priority, title, summary, metricLabel, payload, actions) {
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
    status: "ACTIVE",
    createdAt: opt.now.toISOString()
  };
}
function computeAdc(daily, opt, windowLength, firstEverDataTime) {
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
function blendAdc(a7, a14, a30) {
  const parts = [
    { value: a7.adc, weight: 0.5, covered: a7.covered },
    { value: a14.adc, weight: 0.3, covered: a14.covered },
    { value: a30.adc, weight: 0.2, covered: a30.covered }
  ].filter((p) => p.covered);
  const weightSum = parts.reduce((acc, p) => acc + p.weight, 0);
  if (weightSum <= 0) return 0;
  return parts.reduce((acc, p) => acc + p.value * p.weight, 0) / weightSum;
}
function roundToPack(qty) {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (qty < 10) return Math.ceil(qty);
  if (qty < 50) return Math.ceil(qty / 5) * 5;
  if (qty < 200) return Math.ceil(qty / 10) * 10;
  return Math.ceil(qty / 25) * 25;
}
function emptySeries() {
  return { daily: /* @__PURE__ */ new Map(), firstEver: null };
}
function addConsumption(series, dayKeyValue, dayTime, qty) {
  if (qty <= 0) return;
  series.daily.set(dayKeyValue, (series.daily.get(dayKeyValue) || 0) + qty);
  if (series.firstEver === null || dayTime < series.firstEver) series.firstEver = dayTime;
}
function productConsumption(orders, catalog) {
  const map = /* @__PURE__ */ new Map();
  for (const o of orders) {
    if (o.order.status !== "COMPLETED") continue;
    for (const line of linesOf(o.order, catalog)) {
      if (!line.product) continue;
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
function stockItemConsumption(logs, stockItems, now) {
  const byId = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  for (const si of stockItems || []) {
    if (si?.id) byId.set(si.id, si);
    const n2 = normName(si?.name);
    if (n2 && !byName.has(n2)) byName.set(n2, si);
  }
  const map = /* @__PURE__ */ new Map();
  for (const log of logs || []) {
    if (!log) continue;
    if (log.type !== "SALE" && log.type !== "OUT") continue;
    const target = (log.productId ? byId.get(log.productId) : void 0) || byName.get(normName(log.productName));
    if (!target) continue;
    const stamped = toDate(log.timestamp);
    if (!stamped || stamped.getTime() > now.getTime()) continue;
    let series = map.get(target.id);
    if (!series) {
      series = emptySeries();
      map.set(target.id, series);
    }
    addConsumption(series, dateKey(stamped), startOfDayTime(stamped), Math.abs(Number(log.quantity) || 0));
  }
  return map;
}
function computeInventoryInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || [], opt);
  const productSeries = productConsumption(orders, catalog);
  const stockSeries = stockItemConsumption(snapshot.inventoryLogs || [], snapshot.stockItems || [], opt.now);
  const items = [];
  const evaluate = (itemId, name, itemKind, unit, currentStock, minStockAlert, series) => {
    const daily = series?.daily ?? /* @__PURE__ */ new Map();
    const firstEver = series?.firstEver ?? null;
    const w7 = computeAdc(daily, opt, 7, firstEver);
    const w14 = computeAdc(daily, opt, 14, firstEver);
    const w30 = computeAdc(daily, opt, 30, firstEver);
    const adc = blendAdc(w7, w14, w30);
    const trendFactor = w30.adc > 0 ? w7.adc / w30.adc : w7.adc > 0 ? 1.5 : 1;
    const safetyStock = opt.safetyFactor * adc * opt.leadTimeDays;
    const reorderPoint = adc * opt.leadTimeDays + safetyStock;
    const rawCover = adc > 0 ? currentStock / adc : Number.POSITIVE_INFINITY;
    const daysOfCover = Number.isFinite(rawCover) ? Math.min(DAYS_OF_COVER_SENTINEL, Math.max(0, rawCover)) : DAYS_OF_COVER_SENTINEL;
    const suggestedReorderQty = roundToPack(
      Math.max(0, Math.ceil(reorderPoint + adc * opt.leadTimeDays - currentStock))
    );
    let severity = null;
    if (currentStock <= 0) severity = "OUT_OF_STOCK";
    else if (adc > 0 && daysOfCover <= opt.leadTimeDays) severity = "CRITICAL";
    else if (reorderPoint > 0 && currentStock <= reorderPoint) severity = "BELOW_ROP";
    else if (minStockAlert > 0 && currentStock <= minStockAlert) severity = "WATCH";
    if (!severity) return;
    const projectedStockoutDate = adc > 0 && Number.isFinite(rawCover) ? new Date(opt.now.getTime() + Math.min(DAYS_OF_COVER_SENTINEL, rawCover) * MS_PER_DAY).toISOString() : null;
    items.push({
      itemId,
      name,
      itemKind,
      unit: unit || "pcs",
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
      severity
    });
  };
  for (const p of snapshot.products || []) {
    if (!p || !p.id) continue;
    evaluate(
      p.id,
      p.name,
      "PRODUCT",
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
      "STOCK_ITEM",
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
  const outCount = capped.filter((i) => i.severity === "OUT_OF_STOCK").length;
  const criticalCount = capped.filter((i) => i.severity === "CRITICAL").length;
  const ropCount = capped.filter((i) => i.severity === "BELOW_ROP").length;
  const priority = outCount > 0 || criticalCount > 0 ? 1 : ropCount > 0 ? 2 : 3;
  const head = capped[0];
  const headCover = head.avgDailyConsumption > 0 && head.daysOfCover < DAYS_OF_COVER_SENTINEL ? `cukup ${num(head.daysOfCover)} hari lagi` : "belum ada penjualan tercatat";
  const pieces = [];
  if (outCount > 0) pieces.push(`${outCount} item habis`);
  if (criticalCount > 0) pieces.push(`${criticalCount} item kritis`);
  if (ropCount > 0) pieces.push(`${ropCount} item di bawah titik pesan`);
  const watchCount = capped.length - outCount - criticalCount - ropCount;
  if (watchCount > 0) pieces.push(`${watchCount} item perlu dipantau`);
  const summary = `${pieces.join(", ")}. Paling mendesak ${head.name}: sisa ${num(head.currentStock)} ${head.unit}, ${headCover}. Saran pesan ${num(head.suggestedReorderQty, 0)} ${head.unit}.`;
  const title = outCount > 0 ? "Ada stok yang sudah habis" : criticalCount > 0 ? "Stok kritis, pesan hari ini" : "Stok mulai menipis";
  const payload = { kind: "INVENTORY_ALERT", items: capped };
  return buildInsight(snapshot, opt, "INVENTORY_ALERT", priority, title, summary, `${capped.length} item`, payload, [
    { label: "Buka Stok", kind: "OPEN_INVENTORY", params: { focusItemId: head.itemId } },
    { label: "Tanya rincian", kind: "ASK_ASSISTANT", params: { query: "stok apa yang harus saya pesan hari ini?" } }
  ]);
}
function computeCrossSellInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || [], opt).filter(
    (o) => o.order.status === "COMPLETED" && inWindow(o, opt)
  );
  const nameByKey = /* @__PURE__ */ new Map();
  const priceByKey = /* @__PURE__ */ new Map();
  const itemCount = /* @__PURE__ */ new Map();
  const pairCount = /* @__PURE__ */ new Map();
  const baskets = [];
  for (const o of orders) {
    const lines = linesOf(o.order, catalog);
    const keys = [];
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
  const bundlePrice = (a, b) => {
    const pa = priceByKey.get(a) ?? null;
    const pb = priceByKey.get(b) ?? null;
    if (pa === null && pb === null) return null;
    const total = (pa || 0) + (pb || 0);
    return Math.round(total * 0.9 / 500) * 500;
  };
  const all = [];
  pairCount.forEach((coOccurrence, pk) => {
    const [x, y] = pk.split("\0");
    const cx = itemCount.get(x) || 0;
    const cy = itemCount.get(y) || 0;
    if (cx === 0 || cy === 0) return;
    const confXY = safeDiv(coOccurrence, cx);
    const confYX = safeDiv(coOccurrence, cy);
    const [aId, bId, confidence, bCount] = confXY >= confYX ? [x, y, confXY, cy] : [y, x, confYX, cx];
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
      bundlePriceSuggestion: bundlePrice(aId, bId)
    });
  });
  if (all.length === 0) return null;
  const strong = all.filter(
    (p) => p.support >= opt.minSupport && p.confidence >= opt.minConfidence && p.lift > 1
  );
  const relaxed = strong.length === 0;
  const pairs = (relaxed ? [...all].sort((a, b) => b.coOccurrence - a.coOccurrence || b.lift - a.lift) : [...strong].sort((a, b) => b.lift - a.lift || b.coOccurrence - a.coOccurrence)).slice(0, 6);
  if (pairs.length === 0) return null;
  const top = pairs[0];
  const bundleText = top.bundlePriceSuggestion !== null ? ` Coba paket bundling ${formatRupiah(top.bundlePriceSuggestion)}.` : "";
  const summary = relaxed ? `Data masih tipis (${basketCount} transaksi berisi 2 item atau lebih), tapi ${top.aName} dan ${top.bName} sudah ${top.coOccurrence}x dibeli bersamaan.${bundleText}` : `${Math.round(top.confidence * 100)}% pembeli ${top.aName} juga ambil ${top.bName} (${top.coOccurrence}x dari ${basketCount} keranjang, lift ${num(top.lift, 2)}).${bundleText}`;
  const priority = relaxed ? 3 : top.lift >= 1.5 && top.coOccurrence >= 3 ? 2 : 3;
  const payload = { kind: "CROSS_SELL_OPPORTUNITY", basketCount, pairs };
  return buildInsight(
    snapshot,
    opt,
    "CROSS_SELL_OPPORTUNITY",
    priority,
    "Peluang jualan tambahan",
    summary,
    `${pairs.length} pasangan`,
    payload,
    [
      {
        label: "Buat promo bundling",
        kind: "CREATE_PROMO",
        params: { aId: top.aId, bId: top.bId, suggestedPrice: top.bundlePriceSuggestion }
      },
      { label: "Buka kasir", kind: "OPEN_POS", params: { highlightProductId: top.bId } }
    ]
  );
}
function quintile(sorted, value, higherIsBetter) {
  const n2 = sorted.length;
  if (n2 === 0) return 3;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  const percentile = (below + equal / 2) / n2;
  let q = Math.floor(percentile * 5) + 1;
  if (q > 5) q = 5;
  if (q < 1) q = 1;
  return higherIsBetter ? q : 6 - q;
}
function thresholdR(recencyDays) {
  if (recencyDays <= 7) return 5;
  if (recencyDays <= 14) return 4;
  if (recencyDays <= 30) return 3;
  if (recencyDays <= 60) return 2;
  return 1;
}
function thresholdF(frequency) {
  if (frequency >= 10) return 5;
  if (frequency >= 5) return 4;
  if (frequency >= 3) return 3;
  if (frequency >= 2) return 2;
  return 1;
}
function thresholdM(monetary) {
  if (monetary >= 1e6) return 5;
  if (monetary >= 5e5) return 4;
  if (monetary >= 25e4) return 3;
  if (monetary >= 1e5) return 2;
  return 1;
}
function segmentOf(recencyDays, frequency, rScore, fScore, churnDays) {
  if (recencyDays > churnDays * 3) return "LOST";
  if (recencyDays > churnDays) return fScore >= 3 ? "AT_RISK" : "HIBERNATING";
  if (rScore >= 4 && fScore >= 4) return "CHAMPION";
  if (fScore >= 4) return "LOYAL";
  if (frequency <= 1) return "NEW";
  if (rScore >= 4 && fScore <= 2) return "POTENTIAL";
  return fScore >= 3 ? "LOYAL" : "POTENTIAL";
}
function offerFor(segment, stat) {
  const fav = stat.favouriteProduct;
  const favText = fav ? fav : "menu favoritnya";
  const days = Math.round(stat.recencyDays);
  switch (segment) {
    case "LOST":
      return `Sudah ${days} hari tidak mampir. Kirim WA sapaan hangat + voucher 25% untuk ${favText}, sekali ini saja untuk menariknya kembali.`;
    case "HIBERNATING":
      return `Terakhir belanja ${days} hari lalu. Kirim WA promo 20% untuk ${favText} dengan batas 7 hari biar ada alasan datang.`;
    case "AT_RISK":
      return `Pelanggan rutin yang mulai hilang. Kirim WA promo 20% untuk ${favText} \u2014 terakhir belanja ${days} hari lalu.`;
    case "CHAMPION":
      return `Pelanggan terbaik Anda. Beri ucapan terima kasih + bonus poin dobel untuk ${favText} minggu ini.`;
    case "LOYAL":
      return `Sudah langganan. Tawarkan paket hemat ${favText} atau undang jadi member prioritas.`;
    case "POTENTIAL":
      return `Baru mulai sering datang. Kirim kupon kunjungan ke-3 untuk ${favText} biar jadi kebiasaan.`;
    case "NEW":
    default:
      return `Pelanggan baru. Kirim WA ucapan terima kasih + diskon 10% untuk kunjungan berikutnya.`;
  }
}
function buildCustomerStats(snapshot, opt) {
  const catalog = buildCatalog(snapshot.products || []);
  const completed = datedOrders(snapshot.orders || [], opt).filter((o) => o.order.status === "COMPLETED");
  const agg = /* @__PURE__ */ new Map();
  const ensure = (customer) => {
    let row = agg.get(customer.id);
    if (!row) {
      row = { customer, orders: 0, spend: 0, lastTime: null, itemQty: /* @__PURE__ */ new Map() };
      agg.set(customer.id, row);
    } else if (row.customer !== customer) {
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
  const stats = [];
  agg.forEach((row) => {
    const lastVisit = toDate(row.customer.lastVisit);
    const lastVisitTime = lastVisit && lastVisit.getTime() <= opt.now.getTime() ? lastVisit.getTime() : null;
    const mostRecent = row.lastTime !== null && lastVisitTime !== null ? Math.max(row.lastTime, lastVisitTime) : row.lastTime !== null ? row.lastTime : lastVisitTime;
    const frequency = Math.max(row.orders, Number(row.customer.visitCount) || 0);
    const monetary = Math.max(row.spend, Number(row.customer.totalSpent) || 0);
    if (mostRecent === null && frequency <= 0 && monetary <= 0) return;
    const recencyDays = mostRecent === null ? opt.churnDays * 3 + 1 : Math.max(0, Math.floor((opt.todayStart - startOfDayTime(new Date(mostRecent))) / MS_PER_DAY));
    let favouriteProduct = null;
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
      favouriteProduct
    });
  });
  return stats;
}
function computeChurnInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const stats = buildCustomerStats(snapshot, opt);
  if (stats.length === 0) return null;
  const useQuintiles = stats.length >= 5;
  const recencies = stats.map((s) => s.recencyDays);
  const frequencies = stats.map((s) => s.frequency);
  const monetaries = stats.map((s) => s.monetary);
  const rows = stats.map((s) => {
    const rScore = useQuintiles ? quintile(recencies, s.recencyDays, false) : thresholdR(s.recencyDays);
    const fScore = useQuintiles ? quintile(frequencies, s.frequency, true) : thresholdF(s.frequency);
    const mScore = useQuintiles ? quintile(monetaries, s.monetary, true) : thresholdM(s.monetary);
    const segment = segmentOf(s.recencyDays, s.frequency, rScore, fScore, opt.churnDays);
    return {
      customerId: s.customer.id,
      name: s.customer.name || "Tanpa nama",
      phone: s.customer.phone || "",
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
      suggestedOffer: offerFor(segment, s)
    };
  });
  const lapsed = rows.filter(
    (r) => r.segment === "AT_RISK" || r.segment === "HIBERNATING" || r.segment === "LOST"
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
  const atRisk = (highValueLapsed.length > 0 ? highValueLapsed : lapsed).slice().sort((a, b) => b.monetary - a.monetary).slice(0, 10);
  if (atRisk.length === 0) return null;
  const valueAtRisk = atRisk.reduce((acc, r) => acc + r.monetary, 0);
  const top = atRisk[0];
  const lostCount = atRisk.filter((r) => r.segment === "LOST").length;
  const priority = top.monetary >= 5e5 || atRisk.length >= 3 ? 1 : lostCount > 0 ? 2 : 2;
  const summary = `${atRisk.length} pelanggan mulai hilang, total belanja mereka ${formatRupiah(valueAtRisk)}. Paling sayang: ${top.name} (${formatRupiah(top.monetary)}, terakhir ${top.recencyDays} hari lalu).`;
  const payload = { kind: "CRM_CHURN", customers: atRisk };
  return buildInsight(
    snapshot,
    opt,
    "CRM_CHURN",
    priority,
    "Pelanggan lama mulai menghilang",
    summary,
    `${atRisk.length} pelanggan`,
    payload,
    [
      { label: "Kirim WA", kind: "SEND_WHATSAPP", params: { customerId: top.customerId, phone: top.phone, message: top.suggestedOffer } },
      { label: "Buka Pelanggan", kind: "OPEN_CUSTOMERS", params: { filter: "AT_RISK" } }
    ]
  );
}
function computePeakHoursInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const completed = datedOrders(snapshot.orders || [], opt).filter(
    (o) => o.order.status === "COMPLETED" && inWindow(o, opt)
  );
  if (completed.length === 0) return null;
  const hourOrders = new Array(24).fill(0);
  const hourRevenue = new Array(24).fill(0);
  const dowOrders = new Array(7).fill(0);
  const dowRevenue = new Array(7).fill(0);
  let minHour = 23;
  let maxHour = 0;
  for (const o of completed) {
    const h = businessHour(o.date);
    const d = weekday(o.dayKey);
    const total = Number(o.order.total) || 0;
    hourOrders[h] += 1;
    hourRevenue[h] += total;
    dowOrders[d] += 1;
    dowRevenue[d] += total;
    if (h < minHour) minHour = h;
    if (h > maxHour) maxHour = h;
  }
  if (minHour > maxHour) return null;
  const byHour = [];
  for (let h = minHour; h <= maxHour; h += 1) {
    byHour.push({ hour: h, label: hourLabel(h), orders: hourOrders[h], revenue: round0(hourRevenue[h]) });
  }
  const byDayOfWeek = DAY_LABELS.map((label, dayIndex) => ({
    dayIndex,
    label,
    orders: dowOrders[dayIndex],
    revenue: round0(dowRevenue[dayIndex])
  }));
  const activeHours = byHour.filter((h) => h.revenue > 0);
  const meanActive = activeHours.length > 0 ? activeHours.reduce((acc, h) => acc + h.revenue, 0) / activeHours.length : 0;
  const runsOf = (predicate) => {
    const windows = [];
    let start = null;
    let revenue = 0;
    let orders = 0;
    const flush = (endHour) => {
      if (start === null) return;
      windows.push({
        label: `${hourLabel(start)}\u2013${hourLabel(Math.min(23, endHour + 1))}`,
        startHour: start,
        endHour,
        revenue: round0(revenue),
        orders
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
  const quietWindows = meanActive > 0 ? runsOf((h) => h.revenue <= meanActive * 0.5) : [];
  peakWindows.sort((a, b) => b.revenue - a.revenue);
  quietWindows.sort((a, b) => a.revenue - b.revenue);
  const busiestDayEntry = [...byDayOfWeek].sort((a, b) => b.revenue - a.revenue)[0];
  const busiestDay = busiestDayEntry && busiestDayEntry.revenue > 0 ? busiestDayEntry.label : null;
  const peak = peakWindows[0] || null;
  const quiet = quietWindows[0] || null;
  const staffingHint = peak ? `Jam tersibuk ${peak.label} \u2014 ${peak.orders} transaksi, ${formatRupiah(peak.revenue)}. Pastikan kasir dan dapur sudah siap 30 menit sebelumnya${quiet ? `, lalu geser istirahat ke ${quiet.label} yang paling sepi` : ""}${busiestDay ? `. Hari ${busiestDay} paling ramai` : ""}.` : `Transaksi tersebar cukup merata dari ${hourLabel(minHour)} sampai ${hourLabel(Math.min(23, maxHour + 1))}. Belum perlu tambah orang, cukup jaga ritme yang ada${busiestDay ? `; hari ${busiestDay} paling ramai` : ""}.`;
  const topHour = [...byHour].sort((a, b) => b.revenue - a.revenue)[0];
  const summary = peak ? `Puncak omzet di ${peak.label}: ${formatRupiah(peak.revenue)} dari ${peak.orders} transaksi${quiet ? `, sementara ${quiet.label} paling sepi (${formatRupiah(quiet.revenue)})` : ""}.` : `Jam ${topHour.label} paling ramai dengan ${topHour.orders} transaksi (${formatRupiah(topHour.revenue)}), tapi bedanya tipis dengan jam lain.`;
  const priority = peak ? 2 : 3;
  const payload = {
    kind: "OPERATIONAL_PEAK",
    byHour,
    byDayOfWeek,
    peakWindows,
    quietWindows,
    busiestDay,
    staffingHint
  };
  return buildInsight(
    snapshot,
    opt,
    "OPERATIONAL_PEAK",
    priority,
    "Pola jam ramai toko",
    summary,
    peak ? peak.label : topHour.label,
    payload,
    [
      { label: "Lihat laporan", kind: "OPEN_REPORTS", params: { tab: "hourly" } },
      { label: "Tanya jadwal staf", kind: "ASK_ASSISTANT", params: { query: "jam berapa toko paling ramai?" } }
    ]
  );
}
function meanOf(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function stdDevOf(values, mean2) {
  if (values.length === 0) return 0;
  const variance = values.reduce((acc, v) => acc + (v - mean2) * (v - mean2), 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}
function revenueOfMonth(orders, year, month) {
  let total = 0;
  for (const o of orders) {
    if (o.order.status !== "COMPLETED") continue;
    const calendar = calendarParts(o.date);
    if (calendar.year === year && calendar.month === month) {
      total += Number(o.order.total) || 0;
    }
  }
  return total;
}
function resolveMonthlyTarget(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const manual = Number(snapshot.settings?.monthlyRevenueTarget) || 0;
  if (manual > 0) return { target: round0(manual), source: "MERCHANT", monthsUsed: 0 };
  const all = datedOrders(snapshot.orders || [], opt);
  const totals = [];
  const calendar = calendarParts(opt.now);
  for (let back = 1; back <= 3; back++) {
    const ref = new Date(Date.UTC(calendar.year, calendar.month - back, 1));
    const rev = revenueOfMonth(all, ref.getUTCFullYear(), ref.getUTCMonth());
    if (rev > 0) totals.push(rev);
  }
  if (totals.length === 0) return { target: 0, source: "AUTO", monthsUsed: 0 };
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  return { target: round0(avg * opt.targetGrowthFactor), source: "AUTO", monthsUsed: totals.length };
}
function computeFinancialPerformanceInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || [], opt).filter((o) => inWindow(o, opt));
  const days = /* @__PURE__ */ new Map();
  const ensureDay = (key, dayTime) => {
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
        cogs: 0
      };
      days.set(key, row);
    }
    return row;
  };
  for (const o of orders) {
    if (o.order.status === "HOLD") continue;
    const row = ensureDay(o.dayKey, o.dayTime);
    if (o.order.status === "VOID") {
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
  if (tradingDays.length < 4) return null;
  const latest = tradingDays[tradingDays.length - 1];
  const prior = tradingDays.slice(0, -1);
  const anomalies = [];
  const windowLabel = `${prior.length} hari dagang sebelumnya`;
  const evaluate = (metric2, label, actual, priorValues, note) => {
    if (priorValues.length < 3) return;
    const expected = meanOf(priorValues);
    const sd = stdDevOf(priorValues, expected);
    const denominator = sd > 1e-9 ? sd : Math.abs(expected) * 0.15;
    if (denominator <= 1e-9) return;
    let zScore = (actual - expected) / denominator;
    if (!Number.isFinite(zScore)) return;
    zScore = Math.max(-9, Math.min(9, zScore));
    if (Math.abs(zScore) < 1.5) return;
    const deltaPct = expected !== 0 ? (actual - expected) / Math.abs(expected) * 100 : actual !== 0 ? 100 : 0;
    anomalies.push({
      metric: metric2,
      label,
      actual: round2(actual),
      expected: round2(expected),
      deltaPct: round2(deltaPct),
      direction: actual >= expected ? "ABOVE" : "BELOW",
      zScore: round2(zScore),
      window: windowLabel,
      note: note(actual, expected, deltaPct)
    });
  };
  const dayName = shortDate(latest.dayTime);
  evaluate(
    "REVENUE",
    "Omzet harian",
    latest.revenue,
    prior.map((d) => d.revenue),
    (a, e, dp) => `Omzet ${dayName} ${formatRupiah(a)}, biasanya ${formatRupiah(e)} (${dp >= 0 ? "+" : ""}${num(dp)}%).`
  );
  evaluate(
    "AVG_TICKET",
    "Rata-rata struk",
    safeDiv(latest.revenue, latest.completed),
    prior.map((d) => safeDiv(d.revenue, d.completed)),
    (a, e, dp) => `Rata-rata belanja per struk ${formatRupiah(a)}, biasanya ${formatRupiah(e)} (${dp >= 0 ? "+" : ""}${num(dp)}%).`
  );
  evaluate(
    "VOID_RATE",
    "Tingkat void",
    pctOf(latest.voided, latest.completed + latest.voided),
    prior.map((d) => pctOf(d.voided, d.completed + d.voided)),
    (a, e) => `Void ${num(a)}% dari transaksi hari itu, biasanya ${num(e)}%. Cek alasan pembatalannya.`
  );
  evaluate(
    "DISCOUNT_RATE",
    "Tingkat diskon",
    pctOf(latest.discount, latest.subtotal),
    prior.map((d) => pctOf(d.discount, d.subtotal)),
    (a, e) => `Diskon terpakai ${num(a)}% dari subtotal, biasanya ${num(e)}%. Pastikan promonya memang disengaja.`
  );
  evaluate(
    "GROSS_MARGIN",
    "Margin kotor",
    pctOf(latest.lineRevenue - latest.cogs, latest.lineRevenue),
    prior.map((d) => pctOf(d.lineRevenue - d.cogs, d.lineRevenue)),
    (a, e) => `Margin kotor ${num(a)}%, biasanya ${num(e)}%. Cek harga modal dan porsi diskon.`
  );
  const shiftByDay = /* @__PURE__ */ new Map();
  for (const shift of snapshot.shifts || []) {
    if (!shift || shift.difference === void 0 || shift.difference === null) continue;
    const start = toDate(shift.startTime);
    if (!start || start.getTime() > opt.now.getTime()) continue;
    const dayTime = startOfDayTime(start);
    if (dayTime < opt.windowStart) continue;
    const key = dateKey(start);
    shiftByDay.set(key, (shiftByDay.get(key) || 0) + (Number(shift.difference) || 0));
  }
  const cashSeries = [...shiftByDay.entries()].map(([key, value]) => ({ dayTime: keyToTime(key), value })).sort((a, b) => a.dayTime - b.dayTime);
  if (cashSeries.length >= 4) {
    const latestCash = cashSeries[cashSeries.length - 1];
    evaluate(
      "CASH_VARIANCE",
      "Selisih kas",
      latestCash.value,
      cashSeries.slice(0, -1).map((c) => c.value),
      (a, e) => `Selisih kas ${formatRupiah(a)}, biasanya ${formatRupiah(e)}. Cek serah terima shift dan struk tunai.`
    );
  }
  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  const allOrders = datedOrders(snapshot.orders || [], opt);
  const { target, source: targetSource } = resolveMonthlyTarget(snapshot, options);
  const calendar = calendarParts(opt.now);
  const mtdRevenue = round0(revenueOfMonth(allOrders, calendar.year, calendar.month));
  const dayOfMonth = calendar.day;
  const daysInMonth = daysInBusinessMonth(opt.now);
  const expectedPct = round2(pctOf(dayOfMonth, daysInMonth));
  const hasTarget = target > 0;
  const runRatePct = hasTarget ? round2(pctOf(mtdRevenue, target)) : 0;
  const gapPct = hasTarget ? round2(runRatePct - expectedPct) : 0;
  const projectedMonthEnd = dayOfMonth > 0 ? round0(safeDiv(mtdRevenue, dayOfMonth) * daysInMonth) : 0;
  const projectedGapIdr = hasTarget ? round0(projectedMonthEnd - target) : 0;
  const onTrack = hasTarget ? runRatePct >= expectedPct : true;
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const dailyRunRateNeeded = hasTarget && daysLeft > 0 ? round0(Math.max(0, target - mtdRevenue) / daysLeft) : 0;
  if (!hasTarget && anomalies.length === 0) return null;
  const monthLabel = opt.now.toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  const payload = {
    kind: "FINANCIAL_PERFORMANCE",
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
    anomalies
  };
  const autoNote = targetSource === "AUTO" ? " (target otomatis dari rata-rata bulan sebelumnya)" : "";
  let priority = 3;
  let title = "Ringkasan performa keuangan";
  let summary = "";
  let metric = monthLabel;
  if (hasTarget && !onTrack) {
    priority = 1;
    title = "Omzet di bawah pace target bulan ini";
    metric = `${num(runRatePct)}% dari target`;
    summary = `Baru ${num(runRatePct)}% dari target ${formatRupiah(target)}${autoNote}, padahal hari ke-${dayOfMonth} seharusnya sudah ${num(expectedPct)}%. Perlu ${formatRupiah(dailyRunRateNeeded)}/hari selama ${daysLeft} hari tersisa untuk mengejar.`;
  } else if (hasTarget) {
    priority = anomalies.length > 0 && Math.abs(anomalies[0].zScore) >= 2.5 ? 2 : 3;
    title = "Omzet on-track terhadap target";
    metric = `${num(runRatePct)}% dari target`;
    summary = `Sudah ${num(runRatePct)}% dari target ${formatRupiah(target)}${autoNote} di hari ke-${dayOfMonth} (pace seharusnya ${num(expectedPct)}%). Proyeksi akhir bulan ${formatRupiah(projectedMonthEnd)}.`;
  } else {
    const top = anomalies[0];
    priority = Math.abs(top.zScore) >= 2.5 ? 1 : 2;
    title = top.direction === "ABOVE" ? "Ada lonjakan yang perlu dicek" : "Ada penurunan yang perlu dicek";
    metric = `${anomalies.length} sinyal`;
    summary = `${anomalies.length} angka keluar dari kebiasaan pada ${dayName}. Paling menonjol: ${top.label} ${top.direction === "ABOVE" ? "naik" : "turun"} ${num(Math.abs(top.deltaPct))}% dari rata-rata ${prior.length} hari sebelumnya.`;
  }
  if (hasTarget && anomalies.length > 0) {
    summary += ` Ada juga ${anomalies.length} angka harian yang keluar kebiasaan.`;
  }
  return buildInsight(
    snapshot,
    opt,
    "FINANCIAL_PERFORMANCE",
    priority,
    title,
    summary,
    metric,
    payload,
    [
      { label: "Buka laporan", kind: "OPEN_REPORTS", params: { metric: anomalies[0]?.metric ?? "REVENUE", date: dateKey(new Date(latest.dayTime)) } },
      { label: "Tanya strategi", kind: "ASK_ASSISTANT", params: { query: "progres target bulan ini bagaimana?" } }
    ]
  );
}
function computeLayoutInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const tables = (snapshot.tables || []).filter((t) => !!t && !!t.id);
  if (tables.length === 0) return null;
  const noun = snapshot.slotNoun || "Meja";
  const completed = datedOrders(snapshot.orders || [], opt).filter(
    (o) => o.order.status === "COMPLETED" && inWindow(o, opt)
  );
  const byId = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  for (const t of tables) {
    byId.set(t.id, t.id);
    const n2 = normName(t.name);
    if (n2 && !byName.has(n2)) byName.set(n2, t.id);
  }
  const slotOrders = /* @__PURE__ */ new Map();
  const slotRevenue = /* @__PURE__ */ new Map();
  const activeDays = /* @__PURE__ */ new Set();
  for (const o of completed) {
    activeDays.add(o.dayKey);
    const resolved = (o.order.tableId ? byId.get(o.order.tableId) : void 0) || byName.get(normName(o.order.tableName));
    if (!resolved) continue;
    slotOrders.set(resolved, (slotOrders.get(resolved) || 0) + 1);
    slotRevenue.set(resolved, (slotRevenue.get(resolved) || 0) + (Number(o.order.total) || 0));
  }
  const daysActive = Math.max(1, activeDays.size);
  const slots = tables.map((t) => {
    const ordersCount = slotOrders.get(t.id) || 0;
    const revenue = slotRevenue.get(t.id) || 0;
    const capacity = Number(t.capacity) || 0;
    return {
      slotId: t.id,
      name: t.name || noun,
      zone: t.zone || "Tanpa Zona",
      capacity,
      orders: ordersCount,
      revenue: round0(revenue),
      turnover: round2(safeDiv(ordersCount, daysActive)),
      revenuePerSeat: capacity > 0 ? round0(revenue / capacity) : 0,
      status: t.status
    };
  });
  const totalRevenue = slots.reduce((acc, s) => acc + s.revenue, 0);
  const zoneMap = /* @__PURE__ */ new Map();
  for (const s of slots) {
    const row = zoneMap.get(s.zone) || { slots: 0, orders: 0, revenue: 0 };
    row.slots += 1;
    row.orders += s.orders;
    row.revenue += s.revenue;
    zoneMap.set(s.zone, row);
  }
  const zones = [...zoneMap.entries()].map(([zone, row]) => ({
    zone,
    slots: row.slots,
    orders: row.orders,
    revenue: row.revenue,
    sharePct: pctOf(row.revenue, totalRevenue)
  })).sort((a, b) => b.revenue - a.revenue);
  const deadSlots = slots.filter((s) => s.orders === 0).map((s) => s.name);
  const occupiedNow = tables.filter((t) => t.status === "OCCUPIED" || t.status === "BILLING").length;
  const totalSlots = tables.length;
  const ranked = [...slots].sort((a, b) => b.revenue - a.revenue);
  const best = ranked[0];
  const bestZone = zones[0];
  if (totalRevenue <= 0 && deadSlots.length === totalSlots) {
    return null;
  }
  const hint = deadSlots.length > 0 ? `${deadSlots.length} ${noun} belum menghasilkan sama sekali (${deadSlots.slice(0, 3).join(", ")}${deadSlots.length > 3 ? ", dll" : ""}). Arahkan tamu ke sana saat ${best.name} penuh, atau pindahkan menu andalan ke zona ${bestZone ? bestZone.zone : "-"}.` : `Semua ${noun} terpakai. ${best.name} paling produktif (${formatRupiah(best.revenue)} dari ${best.orders} order). Pertimbangkan menambah ${noun} di zona ${bestZone ? bestZone.zone : "-"}.`;
  const summary = `${best.name} menyumbang ${formatRupiah(best.revenue)} dari ${best.orders} order (${num(pctOf(best.revenue, totalRevenue))}% omzet ${noun.toLowerCase()}). ${deadSlots.length} ${noun} masih kosong sepanjang ${opt.windowDays} hari terakhir.`;
  const priority = deadSlots.length > 0 ? 2 : 3;
  const payload = {
    kind: "LAYOUT_UTILISATION",
    slotNoun: noun,
    slots: ranked,
    zones,
    deadSlots,
    occupiedNow,
    totalSlots,
    hint
  };
  return buildInsight(
    snapshot,
    opt,
    "LAYOUT_UTILISATION",
    priority,
    `Pemakaian ${noun} belum merata`,
    summary,
    `${occupiedNow}/${totalSlots} ${noun}`,
    payload,
    [
      { label: `Buka Denah ${noun}`, kind: "OPEN_TABLES", params: { focusSlotId: best.slotId } },
      { label: "Lihat laporan", kind: "OPEN_REPORTS", params: { tab: "layout" } }
    ]
  );
}
function attendanceInWindow(records, opt) {
  const out = [];
  for (const r of records || []) {
    const clockIn = toDate(r?.clockInTime);
    if (!clockIn || clockIn.getTime() > opt.now.getTime()) continue;
    if (startOfDayTime(clockIn) < opt.windowStart) continue;
    out.push(r);
  }
  return out;
}
function computeStaffBehaviourInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const staffList = (snapshot.staff || []).filter((s) => !!s && !!s.id);
  if (staffList.length === 0) return null;
  const catalog = buildCatalog(snapshot.products || []);
  const completed = datedOrders(snapshot.orders || [], opt).filter(
    (o) => o.order.status === "COMPLETED" && inWindow(o, opt)
  );
  const records = attendanceInWindow(snapshot.attendance || [], opt);
  const staffById = /* @__PURE__ */ new Map();
  const staffByName = /* @__PURE__ */ new Map();
  for (const s of staffList) {
    staffById.set(s.id, s.id);
    const n2 = normName(s.name);
    if (n2 && !staffByName.has(n2)) staffByName.set(n2, s.id);
  }
  const agg = /* @__PURE__ */ new Map();
  const ensure = (id) => {
    let row = agg.get(id);
    if (!row) {
      row = { orders: 0, revenue: 0, items: 0, shifts: 0, hours: 0, intervals: [], late: 0, offSite: 0, presentDays: /* @__PURE__ */ new Set() };
      agg.set(id, row);
    }
    return row;
  };
  for (const s of staffList) ensure(s.id);
  for (const o of completed) {
    const resolved = (o.order.servedByStaffId ? staffById.get(o.order.servedByStaffId) : void 0) || staffByName.get(normName(o.order.servedByStaffName));
    if (!resolved) continue;
    const row = ensure(resolved);
    row.orders += 1;
    row.revenue += Number(o.order.total) || 0;
    for (const line of linesOf(o.order, catalog)) row.items += line.qty;
  }
  const operatingDays = /* @__PURE__ */ new Set();
  for (const r of records) {
    const clockIn = toDate(r.clockInTime);
    if (!clockIn) continue;
    const dayKeyValue = dateKey(clockIn);
    operatingDays.add(dayKeyValue);
    const resolved = (r.staffId ? staffById.get(r.staffId) : void 0) || staffByName.get(normName(r.staffName));
    if (!resolved) continue;
    const row = ensure(resolved);
    row.shifts += 1;
    row.presentDays.add(dayKeyValue);
    const clockOut = toDate(r.clockOutTime);
    if (clockOut && clockOut.getTime() <= opt.now.getTime()) {
      const hours = (clockOut.getTime() - clockIn.getTime()) / 36e5;
      if (Number.isFinite(hours) && hours > 0 && hours <= 24) row.intervals.push([clockIn.getTime(), clockOut.getTime()]);
    }
    const h = businessHour(clockIn);
    const m = clockIn.getUTCMinutes();
    if (h > 9 || h === 9 && (m > 0 || clockIn.getUTCSeconds() > 0)) row.late += 1;
    if (r.clockInGeo && r.clockInGeo.isWithinRadius === false) row.offSite += 1;
  }
  const dayDenominator = Math.max(1, operatingDays.size);
  const rows = staffList.map((s) => {
    const row = ensure(s.id);
    const avgTicket = safeDiv(row.revenue, row.orders);
    const itemsPerOrder = safeDiv(row.items, row.orders);
    const intervals = [];
    for (const interval of row.intervals.sort((a, b) => a[0] - b[0])) {
      const last = intervals[intervals.length - 1];
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else intervals.push([...interval]);
    }
    row.hours = intervals.reduce((sum2, [start, end]) => sum2 + (end - start) / 36e5, 0);
    const measuredRevenue = completed.reduce((sum2, o) => {
      const staffId = (o.order.servedByStaffId ? staffById.get(o.order.servedByStaffId) : void 0) || staffByName.get(normName(o.order.servedByStaffName));
      return staffId === s.id && intervals.some(([start, end]) => o.time >= start && o.time <= end) ? sum2 + (Number(o.order.total) || 0) : sum2;
    }, 0);
    const revenuePerHour = safeDiv(measuredRevenue, row.hours);
    const attendanceRatePct = Math.min(100, pctOf(row.presentDays.size, dayDenominator));
    const notes = [];
    if (row.orders > 0) notes.push(`${row.orders} order, rata-rata ${formatRupiah(avgTicket)} per struk`);
    else notes.push("belum ada order atas namanya");
    if (row.hours > 0) notes.push(`${num(row.hours)} jam kerja`);
    if (row.shifts > row.intervals.length) notes.push("Omzet/jam hanya memakai transaksi dalam absensi dengan clock-out valid");
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
      note: `${notes.join(", ")}.`
    };
  });
  const hasActivity = rows.some((r) => r.ordersServed > 0 || r.shiftsWorked > 0);
  if (!hasActivity) return null;
  const withOrders = rows.filter((r) => r.ordersServed >= 1);
  const withHours = withOrders.filter((r) => r.hoursWorked > 0);
  const performerPool = withHours.length > 0 ? withHours : withOrders;
  const topRow = performerPool.length > 0 ? [...performerPool].sort(
    (a, b) => withHours.length > 0 ? b.revenuePerHour - a.revenuePerHour : b.revenue - a.revenue
  )[0] : null;
  const topPerformer = topRow ? topRow.name : null;
  const coachPool = rows.filter((r) => r.ordersServed >= 3);
  let coachRow = null;
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
  const bits = [];
  if (topRow) {
    bits.push(
      topRow.hoursWorked > 0 ? `${topRow.name} paling produktif: ${formatRupiah(topRow.revenuePerHour)} per jam dari ${topRow.ordersServed} order` : `${topRow.name} paling banyak menjual: ${formatRupiah(topRow.revenue)} dari ${topRow.ordersServed} order`
    );
  }
  if (coachRow) bits.push(`${coachRow.name} perlu didampingi (rata-rata ${formatRupiah(coachRow.avgTicket)} per struk)`);
  if (totalLate > 0) bits.push(`${totalLate}x clock-in lewat jam 09:00`);
  if (totalOffSite > 0) bits.push(`${totalOffSite}x absen di luar radius toko`);
  if (bits.length === 0) return null;
  const priority = totalOffSite > 0 ? 1 : coachRow || totalLate > 0 ? 2 : 3;
  const payload = {
    kind: "STAFF_BEHAVIOUR",
    staff: [...rows].sort((a, b) => b.revenue - a.revenue),
    topPerformer,
    needsCoaching
  };
  return buildInsight(
    snapshot,
    opt,
    "STAFF_BEHAVIOUR",
    priority,
    "Catatan kinerja & kehadiran tim",
    `${bits.join(". ")}.`,
    `${rows.filter((r) => r.shiftsWorked > 0 || r.ordersServed > 0).length} staf aktif`,
    payload,
    [
      { label: "Lihat laporan staf", kind: "OPEN_REPORTS", params: { tab: "staff" } },
      { label: "Tanya detail staf", kind: "ASK_ASSISTANT", params: { query: "siapa staf terbaik bulan ini?" } }
    ]
  );
}
function computeAggregates(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const all = datedOrders(snapshot.orders || [], opt);
  const windowed = all.filter((o) => inWindow(o, opt));
  const completed = windowed.filter((o) => o.order.status === "COMPLETED");
  const voided = windowed.filter((o) => o.order.status === "VOID");
  const calendar = calendarParts(opt.now);
  const mtdRevenue = round0(revenueOfMonth(all, calendar.year, calendar.month));
  const daysInThisMonth = daysInBusinessMonth(opt.now);
  const targetInfo = resolveMonthlyTarget(snapshot, options);
  let revenueTotal = 0;
  let subtotalTotal = 0;
  let discountTotal = 0;
  let lineRevenue = 0;
  let cogs = 0;
  let revenueToday = 0;
  let ordersToday = 0;
  const productAgg = /* @__PURE__ */ new Map();
  const paymentAgg = /* @__PURE__ */ new Map();
  const orderTypeAgg = /* @__PURE__ */ new Map();
  const categoryAgg = /* @__PURE__ */ new Map();
  const dayAgg = /* @__PURE__ */ new Map();
  const categoryNameById = /* @__PURE__ */ new Map();
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
      const catId = line.product?.categoryId || "cat-lainnya";
      const cat = categoryAgg.get(catId) || {
        name: categoryNameById.get(catId) || "Lainnya",
        qty: 0,
        revenue: 0
      };
      cat.qty += line.qty;
      cat.revenue += line.lineTotal;
      categoryAgg.set(catId, cat);
    }
  }
  const ordersAnalysed = completed.length;
  const topProducts = [...productAgg.entries()].map(([productId, v]) => ({ productId, name: v.name, qty: round2(v.qty), revenue: round0(v.revenue) })).sort((a, b) => b.revenue - a.revenue || b.qty - a.qty).slice(0, 10);
  const lastSaleByProduct = /* @__PURE__ */ new Map();
  for (const o of all) {
    if (o.order.status !== "COMPLETED") continue;
    for (const line of linesOf(o.order, catalog)) {
      if (!line.product) continue;
      const prev = lastSaleByProduct.get(line.product.id);
      if (prev === void 0 || o.time > prev) lastSaleByProduct.set(line.product.id, o.time);
    }
  }
  const windowQtyByProduct = /* @__PURE__ */ new Map();
  for (const o of completed) {
    for (const line of linesOf(o.order, catalog)) {
      if (!line.product) continue;
      windowQtyByProduct.set(line.product.id, (windowQtyByProduct.get(line.product.id) || 0) + line.qty);
    }
  }
  const slowMovers = (snapshot.products || []).filter((p) => !!p && !!p.id).map((p) => {
    const lastSale = lastSaleByProduct.get(p.id);
    const daysSinceLastSale = lastSale === void 0 ? null : Math.max(0, Math.floor((opt.todayStart - startOfDayTime(new Date(lastSale))) / MS_PER_DAY));
    return {
      productId: p.id,
      name: p.name,
      qty: round2(windowQtyByProduct.get(p.id) || 0),
      daysSinceLastSale
    };
  }).sort((a, b) => {
    if (a.qty !== b.qty) return a.qty - b.qty;
    const av = a.daysSinceLastSale === null ? Number.MAX_SAFE_INTEGER : a.daysSinceLastSale;
    const bv = b.daysSinceLastSale === null ? Number.MAX_SAFE_INTEGER : b.daysSinceLastSale;
    return bv - av;
  }).slice(0, 10);
  const paymentMix = [...paymentAgg.entries()].map(([method, v]) => ({
    method,
    orders: v.orders,
    revenue: round0(v.revenue),
    sharePct: pctOf(v.revenue, revenueTotal)
  })).sort((a, b) => b.revenue - a.revenue);
  const orderTypeMix = [...orderTypeAgg.entries()].map(([orderType, v]) => ({
    orderType,
    orders: v.orders,
    revenue: round0(v.revenue),
    sharePct: pctOf(v.revenue, revenueTotal)
  })).sort((a, b) => b.revenue - a.revenue);
  const categoryMix = [...categoryAgg.entries()].map(([categoryId, v]) => ({
    categoryId,
    name: v.name,
    qty: round2(v.qty),
    revenue: round0(v.revenue),
    sharePct: pctOf(v.revenue, lineRevenue)
  })).sort((a, b) => b.revenue - a.revenue);
  const revenueByDay = [];
  for (let i = opt.windowDays - 1; i >= 0; i -= 1) {
    const t = addDays(opt.todayStart, -i);
    const key = dateKey(new Date(t));
    const row = dayAgg.get(key);
    revenueByDay.push({ date: key, orders: row?.orders || 0, revenue: round0(row?.revenue || 0) });
  }
  const customerCounts = { ...EMPTY_TIER_COUNTS };
  for (const c of snapshot.customers || []) {
    if (!c) continue;
    customerCounts.TOTAL += 1;
    if (c.tier && customerCounts[c.tier] !== void 0) customerCounts[c.tier] += 1;
  }
  const stockCritical = (snapshot.products || []).filter((p) => p && (Number(p.stock) || 0) <= (Number(p.minStockAlert) || 0)).length + (snapshot.stockItems || []).filter((s) => s && (Number(s.stock) || 0) <= (Number(s.minStockAlert) || 0)).length;
  const slotsTotal = (snapshot.tables || []).length;
  const slotsOccupied = (snapshot.tables || []).filter(
    (t) => t && (t.status === "OCCUPIED" || t.status === "BILLING")
  ).length;
  const onShift = /* @__PURE__ */ new Set();
  for (const r of snapshot.attendance || []) {
    const clockIn = toDate(r?.clockInTime);
    if (r && r.status === "CLOCKED_IN" && clockIn && clockIn.getTime() <= opt.now.getTime() && opt.now.getTime() - clockIn.getTime() <= MS_PER_DAY) onShift.add(r.staffId || r.staffName || r.id);
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
    targetSource: targetInfo.target > 0 ? targetInfo.source : "NONE",
    runRatePct: targetInfo.target > 0 ? round2(pctOf(mtdRevenue, targetInfo.target)) : 0,
    expectedPct: round2(pctOf(calendar.day, daysInThisMonth))
  };
}
function isPaydayWindow(day) {
  return day >= 25 || day <= 3;
}
function computeCalendarBehaviourInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const catalog = buildCatalog(snapshot.products || []);
  const orders = datedOrders(snapshot.orders || [], opt).filter(
    (o) => o.order.status === "COMPLETED" && inWindow(o, opt)
  );
  if (orders.length === 0) return null;
  let paydayRevenue = 0;
  let normalRevenue = 0;
  let paydayOrders = 0;
  let normalOrders = 0;
  const paydayDays = /* @__PURE__ */ new Set();
  const normalDays = /* @__PURE__ */ new Set();
  const paydayProducts = /* @__PURE__ */ new Map();
  for (const o of orders) {
    const total = Number(o.order.total) || 0;
    const day = calendarParts(o.date).day;
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
  const cyclesObserved = Math.max(1, Math.round(paydayDays.size / 7));
  if (basketUplift < opt.paydayUpliftThreshold && volumeUplift < opt.paydayUpliftThreshold) {
    return null;
  }
  const topPaydayProducts = [...paydayProducts.values()].sort((a, b) => b.qty - a.qty).slice(0, 5).map((p) => ({ name: p.name, qty: p.qty, revenue: round0(p.revenue) }));
  const calendar = calendarParts(opt.now);
  const nextPayday = new Date(Date.UTC(calendar.year, calendar.month + (calendar.day < 25 ? 0 : 1), 25));
  const upliftPct = round1((basketUplift - 1) * 100);
  const payload = {
    kind: "CALENDAR_BEHAVIOR",
    paydayWindowLabel: "Tanggal 25\u20133 (musim gajian)",
    normalWindowLabel: "Tanggal 4\u201324",
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
    hint: basketUplift >= opt.paydayUpliftThreshold ? `Belanja pelanggan naik ${num(upliftPct)}% saat musim gajian. Siapkan stok dan tawarkan paket bundling mulai tanggal 25.` : `Jumlah transaksi naik ${num((volumeUplift - 1) * 100)}% saat musim gajian walau nilai per struk mirip. Tambah kapasitas layanan, bukan diskon.`
  };
  const priority = basketUplift >= 1.35 || volumeUplift >= 1.35 ? 2 : 3;
  return buildInsight(
    snapshot,
    opt,
    "CALENDAR_BEHAVIOR",
    priority,
    "Pola belanja musim gajian terdeteksi",
    `Rata-rata struk tanggal 25\u20133 ${formatRupiah(paydayAvgBasket)} vs ${formatRupiah(normalAvgBasket)} di tanggal biasa (${basketUplift >= 1 ? "+" : ""}${num(upliftPct)}%). Musim gajian berikutnya mulai ${shortDate(nextPayday.getTime())}.`,
    `${basketUplift >= 1 ? "+" : ""}${num(upliftPct)}% basket`,
    payload,
    [
      { label: "Siapkan promo gajian", kind: "CREATE_PROMO", params: { window: "PAYDAY" } },
      { label: "Lihat laporan", kind: "OPEN_REPORTS", params: { tab: "calendar" } }
    ]
  );
}
function computeShiftPerformanceInsight(snapshot, options) {
  const opt = resolveOptions(snapshot, options);
  const closed = (snapshot.shifts || []).filter((s) => {
    if (!s || s.status !== "CLOSED") return false;
    const start = toDate(s.startTime);
    const end = toDate(s.endTime);
    if (!start || start.getTime() > opt.now.getTime() || end && end.getTime() > opt.now.getTime()) return false;
    return startOfDayTime(start) >= opt.windowStart;
  });
  if (closed.length === 0) return null;
  const byCashier = /* @__PURE__ */ new Map();
  for (const s of closed) {
    const name = (s.cashierName || "Tanpa nama").trim() || "Tanpa nama";
    const acc = byCashier.get(name) || { cashierName: name, shifts: 0, ordersServed: 0, totalSales: 0, timedSales: 0, timedShifts: 0, hours: 0, variances: [], expectedCashTotal: 0 };
    const start = toDate(s.startTime);
    const end = toDate(s.endTime);
    const duration = start && end ? (end.getTime() - start.getTime()) / 36e5 : 0;
    const hours = duration > 0 && duration <= 24 ? duration : 0;
    acc.shifts += 1;
    acc.ordersServed += Number(s.totalOrders) || 0;
    acc.totalSales += Number(s.totalSales) || 0;
    if (hours > 0) {
      acc.timedSales += Number(s.totalSales) || 0;
      acc.timedShifts += 1;
    }
    acc.hours += hours;
    acc.expectedCashTotal += Number(s.expectedCash) || 0;
    if (typeof s.actualCash === "number" && Number.isFinite(s.actualCash)) {
      const variance = typeof s.difference === "number" && Number.isFinite(s.difference) ? s.difference : s.actualCash - (Number(s.expectedCash) || 0);
      acc.variances.push(variance);
    }
    byCashier.set(name, acc);
  }
  const accs = [...byCashier.values()];
  if (accs.length === 0) return null;
  const perHour = accs.map((a) => safeDiv(a.timedSales, a.hours));
  const benchmark = meanOf(perHour.filter((v) => v > 0));
  const sd = stdDevOf(perHour.filter((v) => v > 0), benchmark);
  let bestName = null;
  let bestRate = -1;
  const cashiers = accs.map((a) => {
    const salesPerHour = round0(safeDiv(a.timedSales, a.hours));
    const avgTicket = round0(safeDiv(a.totalSales, a.ordersServed));
    const meanCashVariance = a.variances.length > 0 ? round0(meanOf(a.variances)) : 0;
    const worstCashVariance = a.variances.length > 0 ? round0(a.variances.reduce((w, v) => v < w ? v : w, a.variances[0])) : 0;
    const shortages = a.variances.filter((v) => v < 0).length;
    const shortageRate = a.variances.length > 0 ? round2(shortages / a.variances.length) : 0;
    const avgExpectedCash = safeDiv(a.expectedCashTotal, a.shifts);
    const variancePct = round2(pctOf(Math.abs(meanCashVariance), Math.max(1, avgExpectedCash)));
    const judgeable = a.shifts >= opt.minShiftsForJudgement;
    let flag = "OK";
    let note = "Dalam batas normal.";
    if (judgeable && (variancePct > opt.cashVarianceTolerancePct || shortageRate >= 0.5)) {
      flag = "CASH_VARIANCE";
      note = meanCashVariance < 0 ? `Rata-rata kas kurang ${formatRupiah(Math.abs(meanCashVariance))} per shift (${num(variancePct)}% dari kas seharusnya). Perlu dicek: prosedur serah terima, struk tunai, atau kembalian.` : `Rata-rata kas lebih ${formatRupiah(meanCashVariance)} per shift. Perlu dicek: transaksi yang belum tercatat di kasir.`;
    } else if (a.timedShifts >= opt.minShiftsForJudgement && sd > 0 && salesPerHour > 0 && salesPerHour < benchmark - sd) {
      flag = "LOW_PRODUCTIVITY";
      note = `Omzet per jam ${formatRupiah(salesPerHour)}, di bawah rata-rata tim ${formatRupiah(round0(benchmark))}. Cocok untuk coaching upselling.`;
    }
    if (a.timedShifts < a.shifts) note += " Omzet/jam hanya memakai shift dengan waktu selesai valid (maksimal 24 jam).";
    if (salesPerHour > 0 && salesPerHour > bestRate && flag === "OK" && a.timedShifts >= opt.minShiftsForJudgement) {
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
      note
    };
  });
  for (const c of cashiers) {
    if (bestName && c.cashierName === bestName && cashiers.length > 1) {
      c.flag = "TOP_PERFORMER";
      c.note = `Omzet per jam tertinggi (${formatRupiah(c.salesPerHour)}) dengan kas bersih.`;
    }
  }
  const flagged = cashiers.filter((c) => c.flag === "CASH_VARIANCE");
  const totalCashVariance = round0(cashiers.reduce((acc, c) => acc + c.meanCashVariance * c.shifts, 0));
  const priority = flagged.length > 0 ? 1 : cashiers.length > 1 ? 3 : 3;
  const summary = flagged.length > 0 ? `${flagged.length} kasir punya selisih kas di luar toleransi ${num(opt.cashVarianceTolerancePct)}%. Terbesar: ${flagged[0].cashierName} (rata-rata ${formatRupiah(flagged[0].meanCashVariance)} per shift dari ${flagged[0].shifts} shift).` : `${closed.length} shift tertutup dianalisa, selisih kas semua kasir masih dalam toleransi. Omzet per jam rata-rata ${formatRupiah(round0(benchmark))}.`;
  const payload = {
    kind: "SHIFT_PERFORMANCE",
    shiftsAnalysed: closed.length,
    cashiers: cashiers.sort((a, b) => b.salesPerHour - a.salesPerHour),
    totalCashVariance,
    benchmarkSalesPerHour: round0(benchmark),
    hint: flagged.length > 0 ? "Selisih kas berulang biasanya soal prosedur, bukan niat. Mulai dari cek ulang serah terima shift dan kembalian sebelum mengambil kesimpulan." : "Kas rapi. Fokus berikutnya: naikkan omzet per jam lewat upselling di jam ramai."
  };
  return buildInsight(
    snapshot,
    opt,
    "SHIFT_PERFORMANCE",
    priority,
    flagged.length > 0 ? "Selisih kas shift perlu dicek" : "Rekap kinerja shift kasir",
    summary,
    `${closed.length} shift`,
    payload,
    [
      { label: "Buka laporan shift", kind: "OPEN_REPORTS", params: { tab: "shift" } },
      { label: "Tanya detail kasir", kind: "ASK_ASSISTANT", params: { query: "kinerja shift kasir bagaimana?" } }
    ]
  );
}
function runDailyBatch(snapshot, options) {
  const startedAt = Date.now();
  const opt = resolveOptions(snapshot, options);
  const aggregates = computeAggregates(snapshot, options);
  const produced = [
    computeInventoryInsight(snapshot, options),
    computeCrossSellInsight(snapshot, options),
    computeChurnInsight(snapshot, options),
    computePeakHoursInsight(snapshot, options),
    computeFinancialPerformanceInsight(snapshot, options),
    computeCalendarBehaviourInsight(snapshot, options),
    computeShiftPerformanceInsight(snapshot, options),
    computeLayoutInsight(snapshot, options),
    computeStaffBehaviourInsight(snapshot, options)
  ];
  const insights = produced.filter((i) => i !== null).sort((a, b) => a.priority - b.priority || a.category.localeCompare(b.category));
  return {
    merchantId: snapshot.merchantId,
    insightDate: dateKey(opt.now),
    generatedAt: opt.now.toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    insights,
    aggregates
  };
}

// src/config/freePlanPolicy.ts
var FREE_PLAN_ID = "plan-free-lifetime";
var FREE_PRODUCT_LIMIT = 10;
function isFreePlan(sub, now = Date.now()) {
  if (!sub || sub.isActive === false || ["SUSPENDED", "CANCELED", "CANCELLED"].includes(sub.status)) return false;
  if (sub.status === "FREE" || sub.planId === FREE_PLAN_ID) return true;
  const trial = ["TRIAL", "TRIALING"].includes(sub.status) || sub.planId === "plan-free" && ["EXPIRED", "PAST_DUE"].includes(sub.status);
  const end = Date.parse(sub.currentPeriodEnd);
  return trial && Number.isFinite(end) && now >= end;
}
function validateFreeSelection(value) {
  const v = value;
  const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 160;
  if (!v || !Array.isArray(v.productIds) || v.productIds.length > FREE_PRODUCT_LIMIT || !v.productIds.every(validId) || new Set(v.productIds).size !== v.productIds.length || !validId(v.branchId) || !["FNB", "RETAIL", "LAUNDRY", "BARBERSHOP", "CARWASH"].includes(v.sector || "")) throw new Error("INVALID_FREE_SELECTION");
  return { productIds: [...v.productIds], branchId: v.branchId, sector: v.sector };
}

// src/config/saasPlans.ts
var TRIAL_PLAN_ID = "plan-free";
var TRIAL_DAYS = 45;
var TRIAL_READ_ONLY_DAYS = 14;
var DAY_MS = 864e5;
var SAAS_PLANS = [
  {
    id: FREE_PLAN_ID,
    name: "Free Selamanya",
    tierLevel: 1,
    billingCycle: "MONTHLY",
    priceIdr: 0,
    currency: "IDR",
    maxOutlets: 1,
    isActive: true,
    productLimit: 10,
    aiQuotaMonthly: 0,
    dashboardAccessLevel: "BASIC",
    features: ["Otomatis setelah trial 45 hari", "10 produk pilihan owner", "1 cabang pilihan owner", "Hanya akun owner", "Tanpa AI", "Data lainnya tetap disimpan"]
  },
  {
    id: TRIAL_PLAN_ID,
    name: "Free Trial 45 Hari",
    tierLevel: 1,
    billingCycle: "MONTHLY",
    priceIdr: 0,
    currency: "IDR",
    maxOutlets: 2,
    isActive: true,
    isTrial: true,
    trialDays: TRIAL_DAYS,
    gracePeriodDays: TRIAL_READ_ONLY_DAYS,
    productLimit: -1,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: "ADVANCED",
    features: [
      "Seluruh fitur Tier Pro selama 45 hari",
      "Hingga 2 outlet",
      "Produk dan pengguna tidak terbatas",
      "Kuota AI trial terbatas",
      "WhatsApp assisted melalui wa.me",
      "Tanpa kartu kredit (berlaku 1x per akun toko)",
      "Setelah trial: Free selamanya dengan 10 produk, 1 cabang, owner saja, tanpa AI"
    ]
  },
  {
    id: "plan-plus-monthly",
    name: "Tier Plus",
    tierLevel: 2,
    billingCycle: "MONTHLY",
    priceIdr: 99e3,
    priceYearlyIdr: 79200,
    annualDiscountPercent: 20,
    currency: "IDR",
    maxOutlets: 2,
    isActive: true,
    productLimit: -1,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: "FULL",
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
    features: [
      "POS, transaksi, QRIS, dan struk",
      "2 outlet termasuk dalam paket",
      "Produk dan kategori tidak terbatas",
      "Inventori dan workflow sektor dasar",
      "Pelanggan, shift, kas, dan laporan omzet",
      "AI Analyst kuota dasar",
      "Support standar"
    ]
  },
  {
    id: "plan-pro-monthly",
    name: "Tier Pro",
    tierLevel: 3,
    billingCycle: "MONTHLY",
    priceIdr: 299e3,
    priceYearlyIdr: 248170,
    annualDiscountPercent: 17,
    currency: "IDR",
    maxOutlets: 4,
    isActive: true,
    productLimit: -1,
    aiQuotaMonthly: 90,
    dashboardAccessLevel: "ADVANCED",
    extraOutletPriceIdr: 79200,
    extraOutletYearlyIdr: 63360,
    features: [
      "Semua fitur Tier Plus",
      "4 outlet termasuk dalam paket",
      "Inventori multi-location, transfer stok, dan recursive BOM",
      "Smart Labor, absensi, komisi, bonus, dan payroll",
      "Workflow vertikal lengkap untuk tiap sektor",
      "WhatsApp Lifecycle Center",
      "Advanced AI Business Analyst dan laporan lintas outlet",
      "Priority support"
    ]
  }
];
var PAID_SAAS_PLANS = SAAS_PLANS.filter((plan) => plan.priceIdr > 0);

// src/config/subscriptionPolicy.ts
function subscriptionAccess(sub, now = Date.now()) {
  if (isFreePlan(sub, now)) return { accessMode: "FULL", status: "FREE", daysLeft: 0, graceDaysLeft: 0 };
  const end = Date.parse(sub.currentPeriodEnd);
  const grace = sub.gracePeriodEnd ? Date.parse(sub.gracePeriodEnd) : end + 14 * DAY_MS;
  const terminal = ["EXPIRED", "CANCELED", "CANCELLED", "SUSPENDED"].includes(sub.status);
  const accessMode = terminal || !Number.isFinite(end) || now >= grace ? "RESTRICTED" : now >= end ? "READ_ONLY" : "FULL";
  return {
    accessMode,
    status: accessMode === "RESTRICTED" ? "EXPIRED" : accessMode === "READ_ONLY" ? "PAST_DUE" : sub.status === "TRIALING" ? "TRIAL" : sub.status,
    daysLeft: Math.max(0, Math.ceil((end - now) / DAY_MS)),
    graceDaysLeft: Math.max(0, Math.ceil((grace - Math.max(now, end)) / DAY_MS))
  };
}

// services/billing/freePlan.ts
async function freePlanState(db, tenantId) {
  const { rows } = await db.query("SELECT * FROM contract.free_plan_entitlements WHERE tenant_id=$1", [tenantId]);
  const s = rows[0];
  if (!s || !s.is_active) return { free: false };
  const free = isFreePlan({ status: s.status, planId: s.plan_id, currentPeriodEnd: new Date(s.current_period_end).toISOString() });
  return { free, ownerId: s.owner_user_ref, selection: free && s.free_selection ? validateFreeSelection(s.free_selection) : void 0 };
}

// services/billing/engine.ts
var BillingError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function assertTenantWritable(db, tenantId) {
  const free = await freePlanState(db, tenantId);
  if (free.free) {
    if (!free.selection) throw new BillingError(403, "FREE_SELECTION_REQUIRED");
    return;
  }
  const { rows } = await db.query(`SELECT t.is_active,t.created_at,s.status,s.current_period_end,s.grace_period_end
    FROM internal.tenants t LEFT JOIN contract.subscription_operations s ON s.tenant_id=t.id WHERE t.id=$1`, [tenantId]);
  const s = rows[0];
  if (!s) throw new BillingError(403, "TENANT_NOT_FOUND");
  const end = s.current_period_end || new Date(Date.parse(s.created_at) + TRIAL_DAYS * DAY_MS).toISOString();
  const access = subscriptionAccess({ status: s.status || "TRIAL", currentPeriodEnd: new Date(end).toISOString(), gracePeriodEnd: s.grace_period_end ? new Date(s.grace_period_end).toISOString() : void 0 });
  if (!s.is_active || access.accessMode !== "FULL") throw new BillingError(403, "SUBSCRIPTION_READ_ONLY");
}

// services/ai/entitlement.ts
async function assertAiAvailable(db, tenantId) {
  if ((await freePlanState(db, tenantId)).free) throw new BillingError(403, "AI_DISABLED_ON_FREE");
  const row = (await db.query(`SELECT t.created_at,s.status,s.plan_id,s.current_period_end
    FROM internal.tenants t LEFT JOIN contract.subscription_operations s ON s.tenant_id=t.id WHERE t.id=$1`, [tenantId])).rows[0];
  if (!row) throw new BillingError(403, "TENANT_NOT_FOUND");
  if (isFreePlan({
    status: row.status || "TRIAL",
    planId: row.plan_id,
    currentPeriodEnd: new Date(row.current_period_end || Date.parse(row.created_at) + TRIAL_DAYS * DAY_MS).toISOString()
  }))
    throw new BillingError(403, "AI_DISABLED_ON_FREE");
  await assertTenantWritable(db, tenantId);
}

// services/ai/dailyBrief.ts
async function computeDailyBrief(db, principal, businessId, now = /* @__PURE__ */ new Date()) {
  const identity = (await db.query(`SELECT m.id,m.tenant_id FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id WHERE m.external_ref=$1 AND t.owner_user_ref=$2`, [businessId, principal.subject])).rows[0];
  if (!identity) throw new Error("BUSINESS_NOT_OWNED");
  await assertAiAvailable(db, identity.tenant_id);
  const snapshot = await loadMerchantSnapshot(db, principal, businessId, now);
  const brain = buildBusinessBrain(snapshot, "DATABASE");
  const batch = runDailyBatch(snapshot, { now });
  return {
    version: BRAIN_VERSION,
    businessId,
    merchantId: identity.id,
    generatedAt: now.toISOString(),
    sales: brain.sales,
    insights: batch.insights.filter((i) => !["CRM_CHURN", "LAYOUT_UTILISATION", "STAFF_BEHAVIOUR", "SHIFT_PERFORMANCE"].includes(i.category)),
    limitations: ["Data pusat: transaksi dan katalog yang sudah disinkronkan. Data pelanggan, resep, stok bahan dan shift belum tersedia di adapter pusat; gunakan panel perangkat untuk domain tersebut."]
  };
}
async function cacheDailyBrief(db, document) {
  await db.query(
    `INSERT INTO ai.business_intelligence_cache(merchant_id,algorithm_version,generated_at,document)
    VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(merchant_id) DO UPDATE SET algorithm_version=EXCLUDED.algorithm_version,generated_at=EXCLUDED.generated_at,document=EXCLUDED.document`,
    [document.merchantId, document.version, document.generatedAt, JSON.stringify(document)]
  );
}

// src/server/dailyInsightsHandler.ts
function createDailyInsightsHandler(connect = () => connectDb({ schema: "ai", max: 2 })) {
  let database;
  return async (req, res) => {
    const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
    const actual = String(req.headers.authorization || "");
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.status(401).json({ ok: false, error: "UNAUTHORIZED_CRON" });
    try {
      database ??= connect().catch((e) => {
        database = void 0;
        throw e;
      });
      const db = await database;
      const merchants = (await db.query(`SELECT m.id,m.external_ref,t.owner_user_ref FROM internal.merchants m
        JOIN internal.tenants t ON t.id=m.tenant_id LEFT JOIN ai.business_intelligence_cache c ON c.merchant_id=m.id
        WHERE m.external_ref IS NOT NULL AND t.owner_user_ref IS NOT NULL
        ORDER BY c.generated_at ASC NULLS FIRST,m.id LIMIT 25`)).rows;
      let written = 0, skipped = 0, failed = 0;
      for (const m of merchants) {
        try {
          const document = await computeDailyBrief(db, { subject: m.owner_user_ref }, m.external_ref);
          await cacheDailyBrief(db, document);
          written++;
        } catch (e) {
          const skip = ["AI_DISABLED_ON_FREE", "TENANT_SUSPENDED", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_REQUIRED"].includes(e.message);
          if (skip) skipped++;
          else failed++;
          await db.query(
            `INSERT INTO ai.business_intelligence_cache(merchant_id,algorithm_version,generated_at,document)
            VALUES($1,'unavailable',now(),$2::jsonb) ON CONFLICT(merchant_id) DO UPDATE
            SET algorithm_version=EXCLUDED.algorithm_version,generated_at=EXCLUDED.generated_at,document=EXCLUDED.document`,
            [m.id, JSON.stringify({ status: skip ? "SKIPPED" : "UNAVAILABLE" })]
          );
        }
      }
      return res.status(failed ? 503 : 200).json({ ok: failed === 0, job: "daily-insights", processed: merchants.length, written, skipped, failed, scope: "up to 25 businesses per run" });
    } catch {
      return res.status(503).json({ ok: false, error: "DAILY_INSIGHTS_UNAVAILABLE" });
    }
  };
}
var dailyInsightsHandler_default = createDailyInsightsHandler();
export {
  createDailyInsightsHandler,
  dailyInsightsHandler_default as default
};
