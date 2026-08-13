/**
 * LAYER 2 — INTENT ROUTER + DETERMINISTIC ANSWER ENGINE
 * =====================================================
 * The "Rp 0" path. Every answer produced here costs zero credits: it is either
 * read straight out of the nightly batch insights (`source: 'BATCH_INSIGHT'`)
 * or computed live from the snapshot with plain arithmetic
 * (`source: 'RULE_ENGINE'`).
 *
 * Pure module: no React, no network, no storage. Only ./types, ../../types and
 * the shared currency formatter are imported, so the exact same code runs in
 * the browser and inside the Express handler.
 */

import {
  AssistantAnswer,
  BatchRunResult,
  CalendarBehaviourPayload,
  FinancialPerformancePayload,
  INTENT_CONFIDENCE_THRESHOLD,
  IntentEntities,
  IntentName,
  IntentPeriod,
  InsightPayload,
  MerchantAggregates,
  MerchantInsight,
  MerchantSnapshot,
  ParsedIntent,
  ShiftPerformancePayload,
} from './types';
import {
  BusinessSector,
  CartItem,
  Order,
  PermissionFeature,
  Product,
  Shift,
  UserRole,
} from '../../types';
import { ROLE_PERMISSIONS } from '../../data/rolePermissions';
import { formatRupiah } from '../../utils/formatters';

/* ========================================================================== */
/* 0. SMALL FORMATTING HELPERS                                                */
/* ========================================================================== */

const DAY_MS = 86_400_000;

/** Indonesian thousand separators for plain counts. */
function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('id-ID');
}

/** One-decimal number, Indonesian comma. */
function dec(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(digits).replace('.', ',');
}

function pct(n: number, digits = 1): string {
  return `${dec(n, digits)}%`;
}

function rp(n: number): string {
  return formatRupiah(Number.isFinite(n) ? n : 0);
}

/** Safe division — the single most common crash source in this data set. */
function div(a: number, b: number): number {
  if (!b || !Number.isFinite(b) || b === 0) return 0;
  const r = a / b;
  return Number.isFinite(r) ? r : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Coerce anything that reaches the renderer into a finite number.
 * Batch payloads are produced by a separate module and a single NaN there would
 * otherwise be printed to the merchant as "NaN" or "Rp NaN".
 */
function safe(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const MONTH_LABELS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/** Order.date is sometimes an ISO string without a timezone suffix. */
function toMs(value: string | undefined | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function clockLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "25 Agustus 2026" — never locale-dependent, never "Invalid Date". */
function longDate(ms: number): string {
  if (!Number.isFinite(ms)) return '-';
  const d = new Date(ms);
  const month = MONTH_LABELS[d.getMonth()] || '';
  return `${d.getDate()} ${month} ${d.getFullYear()}`.trim();
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/* ========================================================================== */
/* 1. TEXT NORMALISATION                                                      */
/* ========================================================================== */

/** Chat-spelling folds: informal / abbreviated Indonesian -> canonical token. */
const SPELLING_FOLD: Record<string, string> = {
  yg: 'yang',
  yng: 'yang',
  gmn: 'bagaimana',
  gmna: 'bagaimana',
  gimana: 'bagaimana',
  gmana: 'bagaimana',
  bgmn: 'bagaimana',
  gimna: 'bagaimana',
  brp: 'berapa',
  brapa: 'berapa',
  brpa: 'berapa',
  tdk: 'tidak',
  gak: 'tidak',
  ga: 'tidak',
  gk: 'tidak',
  nggak: 'tidak',
  ngga: 'tidak',
  engga: 'tidak',
  enggak: 'tidak',
  kagak: 'tidak',
  sdh: 'sudah',
  udh: 'sudah',
  udah: 'sudah',
  dah: 'sudah',
  blm: 'belum',
  belom: 'belum',
  hr: 'hari',
  hri: 'hari',
  bln: 'bulan',
  mgg: 'minggu',
  mggu: 'minggu',
  mingu: 'minggu',
  skrg: 'sekarang',
  skrng: 'sekarang',
  krywn: 'karyawan',
  staff: 'staf',
  stok: 'stok',
  stock: 'stok',
  omzet: 'omset',
  omset: 'omset',
  prodak: 'produk',
  produck: 'produk',
  pelangan: 'pelanggan',
  plgn: 'pelanggan',
  knp: 'kenapa',
  knapa: 'kenapa',
  napa: 'kenapa',
  mngp: 'mengapa',
  sy: 'saya',
  dgn: 'dengan',
  utk: 'untuk',
  untk: 'untuk',
  bs: 'bisa',
  aj: 'saja',
  aja: 'saja',
  donk: 'dong',
  jm: 'jam',
  brg: 'barang',
  discount: 'diskon',
  cust: 'pelanggan',
  customer: 'pelanggan',
  member: 'member',
  tgl: 'tanggal',
  lg: 'lagi',
  lgi: 'lagi',
  tp: 'tapi',
  pnjualan: 'penjualan',
  keuntungn: 'keuntungan',
};

/** Multi-word rewrites applied after punctuation stripping. */
const PHRASE_FOLD: [RegExp, string][] = [
  [/\be\s+wallet\b/g, 'ewallet'],
  [/\be\s+money\b/g, 'ewallet'],
  [/\bdompet\s+digital\b/g, 'ewallet'],
  [/\bbest\s+seller\b/g, 'best seller'],
  [/\bhari\s+ini\b/g, 'hari ini'],
  [/\bcross\s+sell(ing)?\b/g, 'cross sell'],
  [/\bslow\s+moving\b/g, 'slow moving'],
  [/\blow\s+stock\b/g, 'low stock'],
  [/\bpeak\s+hours?\b/g, 'peak hour'],
  [/\bre\s+stock\b/g, 'restock'],
  [/\bre\s+order\b/g, 'reorder'],
  [/\bclock\s+in\b/g, 'clock in'],
  [/\bclock\s+out\b/g, 'clock out'],
];

function normalise(raw: string): string {
  let t = (raw || '').toLowerCase();
  // Strip everything that is not a letter, digit or whitespace.
  t = t.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t
    .split(' ')
    .map((w) => SPELLING_FOLD[w] || w)
    .join(' ');
  for (const [re, to] of PHRASE_FOLD) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

/* ========================================================================== */
/* 2. KEYWORD TABLES                                                          */
/* ========================================================================== */

interface IntentRule {
  /** Highly distinctive words / phrases. Weight 3 — one match is enough. */
  strong: string[];
  /** Generic supporting words. Weight 1 — never enough on their own. */
  weak: string[];
}

// EXPLAIN_BUSINESS_SCOPE is not keyword-scored — it is detected structurally by
// `detectCrossBusinessReference` before scoring runs.
const RULES: Record<Exclude<IntentName, 'UNKNOWN' | 'EXPLAIN_BUSINESS_SCOPE'>, IntentRule> = {
  GET_INSIGHT_DIGEST: {
    strong: [
      'ringkasan',
      'rangkuman',
      'insight',
      'briefing',
      'apa yang penting',
      'kondisi toko',
      'bagaimana toko',
      'keadaan toko',
      'update toko',
      'laporan singkat',
      'overview',
      'digest',
      'ada apa hari ini',
      'summary',
    ],
    weak: ['toko', 'penting', 'kabar', 'situasi', 'highlight'],
  },
  GET_STOCK_CRITICAL: {
    strong: [
      'stok menipis',
      'stok kritis',
      'stok habis',
      'stok kosong',
      'barang mau habis',
      'barang habis',
      'menipis',
      'restock',
      'reorder',
      'sisa stok',
      'low stock',
      'out of stock',
      'perlu belanja',
      'harus beli lagi',
      'stok aman',
      'stok minim',
      'kehabisan',
      'cek stok',
      'lihat stok',
      'kondisi stok',
      'status stok',
    ],
    weak: ['stok', 'habis', 'barang', 'gudang', 'bahan', 'inventory', 'inventaris', 'kritis'],
  },
  GET_STOCK_FORECAST: {
    strong: [
      'prediksi stok',
      'prediksi',
      'perkiraan stok',
      'perkiraan',
      'kapan habis',
      'forecast',
      'berapa hari lagi',
      'bertahan berapa',
      'cukup untuk berapa hari',
      'proyeksi stok',
      'estimasi stok',
      'stok bertahan',
      'days of cover',
    ],
    weak: ['stok', 'hari', 'lagi', 'cukup', 'bertahan', 'sampai'],
  },
  GET_TOP_SELLING_ITEM: {
    strong: [
      'terlaris',
      'best seller',
      'bestseller',
      'paling laku',
      'paling laris',
      'menu favorit',
      'produk favorit',
      'produk teratas',
      'top produk',
      'top menu',
      'top selling',
      'paling banyak terjual',
      'item terlaris',
      'jagoan',
      'andalan',
    ],
    weak: ['laris', 'favorit', 'teratas', 'terbaik', 'produk', 'menu', 'item', 'terjual'],
  },
  GET_SLOW_MOVING: {
    strong: [
      'kurang laku',
      'tidak laku',
      'kurang laris',
      'tidak laris',
      'slow moving',
      'produk mati',
      'menu mati',
      'jarang terjual',
      'jarang laku',
      'paling sedikit terjual',
      'dead stock',
      'stok mengendap',
      'mengendap',
      'sepi peminat',
    ],
    weak: ['sedikit', 'jarang', 'sepi', 'lambat', 'produk', 'menu'],
  },
  GET_REVENUE_SUMMARY: {
    strong: [
      'omset',
      'omzet',
      'pendapatan',
      'revenue',
      'penjualan',
      'berapa penjualan',
      'laku berapa',
      'total jualan',
      'jualan hari ini',
      'pemasukan',
      'hasil penjualan',
      'sales',
      'transaksi hari ini',
      'berapa masuk',
    ],
    weak: ['jualan', 'total', 'transaksi', 'uang', 'masuk', 'ramai'],
  },
  GET_PROFIT_MARGIN: {
    strong: [
      'profit',
      'laba',
      'margin',
      'keuntungan',
      'untung',
      'hpp',
      'harga pokok',
      'modal',
      'laba bersih',
      'laba kotor',
      'gross margin',
      'berapa untung',
    ],
    weak: ['bersih', 'kotor', 'cost', 'biaya', 'selisih'],
  },
  GET_PAYMENT_MIX: {
    strong: [
      'metode bayar',
      'metode pembayaran',
      'cara bayar',
      'pembayaran',
      'qris',
      'tunai',
      'cash',
      'kartu',
      'ewallet',
      'gopay',
      'ovo',
      'shopeepay',
      'debit',
      'non tunai',
      'bayar pakai apa',
    ],
    weak: ['bayar', 'metode', 'transfer'],
  },
  GET_CROSS_SELL: {
    strong: [
      'bundling',
      'bundle',
      'paket hemat',
      'cross sell',
      'dibeli bersama',
      'dibeli bareng',
      'sering dibeli bareng',
      'sering dibeli bersama',
      'kombinasi',
      'kombo',
      'market basket',
      'beli bareng',
      'dipasangkan',
      'pasangan produk',
    ],
    weak: ['paket', 'bersama', 'bareng', 'gabung', 'promo bundling'],
  },
  GET_TARGET_PROGRESS: {
    strong: [
      'target bulan ini',
      'capai target',
      'mencapai target',
      'run rate',
      'runrate',
      'target omzet',
      'target omset',
      'target penjualan',
      'kejar target',
      'sesuai target',
      'progres target',
      'progress target',
      'sudah berapa persen',
      'proyeksi akhir bulan',
    ],
    weak: ['target', 'capai', 'kejar', 'proyeksi', 'persen', 'progres'],
  },
  GET_CALENDAR_PATTERN: {
    strong: [
      'pola gajian',
      'musim gajian',
      'siklus gajian',
      'tanggal muda',
      'tanggal tua',
      'payday',
      'akhir bulan',
      'awal bulan',
      'pola kalender',
      'pola belanja bulanan',
    ],
    weak: ['gajian', 'kalender', 'siklus', 'musiman', 'bulanan'],
  },
  GET_SHIFT_PERFORMANCE: {
    strong: [
      'kinerja shift',
      'performa shift',
      'performa kasir',
      'kinerja kasir',
      'selisih kas',
      'kas kurang',
      'kas lebih',
      'shift terbaik',
      'kasir terbaik',
      'produktivitas kasir',
      'omzet per jam',
      'kasir paling produktif',
    ],
    weak: ['selisih', 'kas', 'setoran', 'produktif'],
  },
  GET_CHURN_CUSTOMERS: {
    strong: [
      'pelanggan hilang',
      'churn',
      'sudah lama tidak',
      'lama tidak datang',
      'lama tidak belanja',
      'pelanggan tidak kembali',
      'tidak kembali',
      'winback',
      'win back',
      'jarang datang',
      'pelanggan kabur',
      'menghilang',
      'at risk',
      'berisiko hilang',
    ],
    weak: ['hilang', 'lama', 'kembali', 'pelanggan', 'jarang', 'kabur'],
  },
  GET_LOYAL_CUSTOMERS: {
    strong: [
      'pelanggan setia',
      'pelanggan loyal',
      'loyal',
      'member terbaik',
      'pelanggan terbaik',
      'vip',
      'champion',
      'pelanggan top',
      'top pelanggan',
      'pelanggan paling sering',
      'paling banyak belanja',
      'pembeli terbesar',
      'setia',
    ],
    weak: ['pelanggan', 'member', 'terbaik', 'sering', 'tier', 'poin'],
  },
  GET_CUSTOMER_DETAIL: {
    strong: [
      'pelanggan bernama',
      'member bernama',
      'riwayat pelanggan',
      'detail pelanggan',
      'info pelanggan',
      'data pelanggan',
      'profil pelanggan',
      'riwayat belanja',
      'cek member',
      'cek pelanggan',
    ],
    weak: ['pelanggan', 'member', 'riwayat', 'detail', 'profil', 'kontak'],
  },
  GET_PEAK_HOURS: {
    strong: [
      'jam sibuk',
      'peak hour',
      'jam ramai',
      'jam sepi',
      'kapan ramai',
      'kapan sepi',
      'hari teramai',
      'hari paling ramai',
      'jam paling ramai',
      'waktu ramai',
      'rush hour',
      'jam berapa ramai',
      'pola kunjungan',
    ],
    weak: ['jam', 'ramai', 'sepi', 'sibuk', 'waktu', 'hari'],
  },
  GET_TABLE_STATUS: {
    strong: [
      'meja',
      'denah',
      'layout',
      'okupansi',
      'okupasi',
      'bay',
      'kursi',
      'rak',
      'lorong',
      'mesin',
      'berapa meja kosong',
      'meja kosong',
      'slot kosong',
      'floor plan',
      'station',
    ],
    weak: ['slot', 'kosong', 'terisi', 'display', 'zona', 'area', 'pit'],
  },
  GET_STAFF_PERFORMANCE: {
    strong: [
      'kinerja staf',
      'performa staf',
      'performa karyawan',
      'kinerja karyawan',
      'staf terbaik',
      'karyawan terbaik',
      'kapster',
      'barista',
      'penjualan per staf',
      'produktivitas staf',
      'siapa paling banyak jual',
      'staf paling',
      'ranking staf',
    ],
    weak: ['staf', 'karyawan', 'kasir', 'pegawai', 'kinerja', 'performa', 'tim'],
  },
  GET_ATTENDANCE: {
    strong: [
      'absensi',
      'presensi',
      'clock in',
      'clock out',
      'kehadiran',
      'siapa masuk',
      'siapa yang masuk',
      'siapa kerja',
      'absen',
      'jam masuk',
      'telat',
      'terlambat',
      'geofence',
      'lokasi absen',
    ],
    weak: ['masuk', 'hadir', 'pulang', 'shift pagi', 'kerja'],
  },
  GET_SHIFT_STATUS: {
    strong: [
      'shift',
      'kasir buka',
      'tutup kasir',
      'buka kasir',
      'setoran',
      'selisih kas',
      'saldo kas',
      'closing kasir',
      'tutup buku',
      'kas laci',
      'uang laci',
      'expected cash',
      'shift berjalan',
    ],
    weak: ['kas', 'laci', 'buka', 'tutup', 'kasir'],
  },
  GET_PRODUCT_DETAIL: {
    strong: [
      'info produk',
      'detail produk',
      'data produk',
      'harga produk',
      'stok produk',
      'harga',
      'berapa harga',
      'cek produk',
      'cek harga',
      'spesifikasi produk',
      'kartu produk',
    ],
    weak: ['produk', 'menu', 'item', 'barang', 'sku', 'satuan'],
  },
  GET_PROMO_LIST: {
    strong: [
      'promo',
      'diskon aktif',
      'voucher',
      'kode promo',
      'kupon',
      'promosi',
      'potongan harga',
      'daftar promo',
      'promo berjalan',
      'diskon berjalan',
    ],
    weak: ['diskon', 'potongan', 'kode', 'aktif'],
  },
};

/** Phrases that mean "give me judgement / strategy" — Layer 3 territory. */
const ADVISORY_PATTERNS: RegExp[] = [
  /\bstrategi\b/,
  /\bbagaimana cara\b/,
  /\bcara meningkatkan\b/,
  /\bcara menaikkan\b/,
  /\bcara menambah\b/,
  /\bcara mengatasi\b/,
  /\bkenapa\b/,
  /\bmengapa\b/,
  /\bsaran\b/,
  /\bsarankan\b/,
  /\bmasukan\b/,
  /\brekomendasi\b/,
  /\bmenurutmu\b/,
  /\bmenurut kamu\b/,
  /\bmenurut anda\b/,
  /\bpendapatmu\b/,
  /\bbuatkan\b/,
  /\bbikinkan\b/,
  /\bbuatin\b/,
  /\bbikinin\b/,
  /\btolong buat\b/,
  /\bide\b/,
  /\bsebaiknya\b/,
  /\bharus(nya)? (saya|kita|aku)\b/,
  /\bapakah (perlu|sebaiknya|bagus)\b/,
  /\banalisa mendalam\b/,
  /\bjelaskan kenapa\b/,
  /\bwhy\b/,
  /\bstrategy\b/,
  /\bhow (do|can|should)\b/,
  /\brecommend\b/,
  /\bsuggest\b/,
  /\bwhat should\b/,
  /\bopini\b/,
  /\bplan(ning)? (marketing|bisnis)\b/,
  /\bmarketing\b/,
];

/* ========================================================================== */
/* 3. ENTITY EXTRACTION                                                       */
/* ========================================================================== */

const PERIOD_PATTERNS: [RegExp, IntentPeriod][] = [
  [/\bkemarin\b|\byesterday\b|\bkmrn\b/, 'YESTERDAY'],
  [/\bhari ini\b|\btoday\b|\bsekarang\b|\bhr ini\b/, 'TODAY'],
  [/\bminggu ini\b|\bseminggu\b|\bpekan ini\b|\bsepekan\b|\b7 hari\b|\bweek\b|\bmingguan\b/, 'WEEK'],
  [/\bbulan ini\b|\bsebulan\b|\b30 hari\b|\bmonth\b|\bbulanan\b/, 'MONTH'],
  [/\bsemua waktu\b|\bsepanjang\b|\ball time\b|\bkeseluruhan\b|\bselamanya\b|\bsejak awal\b/, 'ALL'],
];

/** Intents whose natural default window is "hari ini". */
const TODAY_DEFAULT_INTENTS: IntentName[] = [
  'GET_REVENUE_SUMMARY',
  'GET_PAYMENT_MIX',
  'GET_SHIFT_STATUS',
  'GET_ATTENDANCE',
  'GET_TABLE_STATUS',
  'GET_INSIGHT_DIGEST',
];

const NAME_STOPWORDS = new Set([
  'ini',
  'itu',
  'apa',
  'apa saja',
  'yang',
  'berapa',
  'saya',
  'kita',
  'aku',
  'kamu',
  'di',
  'ke',
  'dari',
  'pada',
  'untuk',
  'dan',
  'atau',
  'dong',
  'ya',
  'sih',
  'saja',
  'bagaimana',
  'kenapa',
  'mengapa',
  'kapan',
  'siapa',
  'mana',
  'bernama',
  'nama',
  'namanya',
  'detail',
  'info',
  'data',
  'riwayat',
  'profil',
  'cek',
  'lihat',
  'tampilkan',
  'terlaris',
  'laris',
  'laku',
  'terbaik',
  'teratas',
  'terbanyak',
  'paling',
  'favorit',
  'setia',
  'loyal',
  'vip',
  'top',
  'baru',
  'lama',
  'hilang',
  'churn',
  'aktif',
  'kritis',
  'menipis',
  'habis',
  'kosong',
  'sibuk',
  'ramai',
  'sepi',
  'masuk',
  'keluar',
  'sudah',
  'belum',
  'tidak',
  'datang',
  'sering',
  'jarang',
  'rata',
  'total',
  'harga',
  'stok',
  'jual',
  'terjual',
  'hari',
  'minggu',
  'bulan',
  'kemarin',
  'sekarang',
  'punya',
  'ada',
  'mau',
  'bisa',
  'tolong',
  'kurang',
  'per',
  'semua',
  'daftar',
  'list',
  'status',
  'jumlah',
]);

const NAME_FILLERS = new Set(['bernama', 'nama', 'namanya', 'atas', 'an', 'dengan', 'si', 'pak', 'bu', 'mas', 'mbak']);

const PRODUCT_CUES = ['produk', 'menu', 'item', 'barang', 'sku', 'harga'];
const CUSTOMER_CUES = ['pelanggan', 'member', 'pembeli', 'customer', 'langganan'];
const STAFF_CUES = ['staf', 'karyawan', 'kasir', 'kapster', 'barista', 'pegawai', 'terapis'];

function captureAfterCue(tokens: string[], cues: string[]): string | undefined {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!cues.includes(tokens[i])) continue;
    let j = i + 1;
    while (j < tokens.length && NAME_FILLERS.has(tokens[j])) j++;
    const picked: string[] = [];
    while (j < tokens.length && picked.length < 4) {
      const tok = tokens[j];
      if (NAME_STOPWORDS.has(tok) || NAME_FILLERS.has(tok)) break;
      picked.push(tok);
      j++;
    }
    if (picked.length > 0) return picked.join(' ');
  }
  return undefined;
}

function extractLimit(text: string): number | undefined {
  const m1 = /\btop\s*(\d{1,2})\b/.exec(text);
  if (m1) return clamp(parseInt(m1[1], 10), 1, 20);
  const m2 = /\b(\d{1,2})\s*(besar|teratas|terbaik|terlaris|terbanyak|item|produk|menu|pelanggan|staf)\b/.exec(text);
  if (m2) return clamp(parseInt(m2[1], 10), 1, 20);
  const m3 = /\b(\d{1,2})\s*(?:saja|aja)?\s*$/.exec(text);
  if (m3 && !/\bhari\b|\bjam\b|\bbulan\b/.test(text)) return clamp(parseInt(m3[1], 10), 1, 20);
  return undefined;
}

function extractQuoted(raw: string): string | undefined {
  const m = /["'“”‘’]([^"'“”‘’]{2,40})["'“”‘’]/.exec(raw);
  if (m && m[1].trim()) return m[1].trim();
  return undefined;
}

/* ========================================================================== */
/* 4. parseIntent                                                             */
/* ========================================================================== */

/**
 * Signals that span other words, so `text.includes(phrase)` can never see them.
 * Each entry adds `by` to an intent's score when the pattern fires.
 */
const PATTERN_BOOSTS: { re: RegExp; intent: IntentName; by: number; label: string }[] = [
  // "kapan biji kopi habis", "habis kapan ya stoknya"
  { re: /\bkapan\b[\s\S]{0,30}\bhabis\b|\bhabis\b[\s\S]{0,20}\bkapan\b/, intent: 'GET_STOCK_FORECAST', by: 3, label: 'pola:kapan-habis' },
  // "berapa hari lagi stok beras cukup"
  { re: /\bberapa hari\b[\s\S]{0,30}\b(stok|cukup|bertahan|habis)\b/, intent: 'GET_STOCK_FORECAST', by: 3, label: 'pola:berapa-hari' },
  // "jam berapa toko paling ramai", "jam berapa paling sepi"
  { re: /\bjam\b[\s\S]{0,25}\b(ramai|sibuk|sepi|padat)\b/, intent: 'GET_PEAK_HOURS', by: 3, label: 'pola:jam-ramai' },
  // "berapa meja yang masih kosong"
  { re: /\b(meja|slot|bay|kursi|rak)\b[\s\S]{0,25}\b(kosong|terisi|dipakai|tersedia)\b/, intent: 'GET_TABLE_STATUS', by: 3, label: 'pola:slot-kosong' },
  // "pelanggan yang sudah lama tidak belanja"
  { re: /\b(pelanggan|member|customer)\b[\s\S]{0,30}\b(lama tidak|tidak pernah|belum pernah|gak pernah|ga balik|tidak balik)\b/, intent: 'GET_CHURN_CUSTOMERS', by: 3, label: 'pola:pelanggan-hilang' },
  // "produk apa yang sering dibeli bersamaan"
  { re: /\b(dibeli|beli|dipesan)\b[\s\S]{0,20}\b(bersama|bersamaan|bareng|barengan|sekaligus)\b/, intent: 'GET_CROSS_SELL', by: 3, label: 'pola:dibeli-bareng' },
  // "target bulan ini kekejar ga", "target sudah tercapai belum"
  { re: /\btarget\b[\s\S]{0,25}\b(tercapai|kekejar|kejar|aman|meleset|belum|sudah)\b/, intent: 'GET_TARGET_PROGRESS', by: 3, label: 'pola:target-tercapai' },
  // "tanggal muda / tanggal tua"
  { re: /\b(tanggal|tgl)\s*(muda|tua)\b/, intent: 'GET_CALENDAR_PATTERN', by: 3, label: 'pola:tanggal-muda' },
  // "kas kurang", "uang laci selisih", "kas hilang"
  { re: /\b(kas|uang)\b[\s\S]{0,20}\b(kurang|lebih|selisih|hilang)\b/, intent: 'GET_SHIFT_PERFORMANCE', by: 3, label: 'pola:kas-selisih' },
  // "kinerja shift kasir", "performa kasir mana" — must outrank GET_SHIFT_STATUS,
  // which is about the shift running right now, not a comparison between people.
  { re: /\b(kinerja|performa|produktivitas|produktif|terbaik|bandingkan)\b[\s\S]{0,25}\b(shift|kasir)\b|\b(shift|kasir)\b[\s\S]{0,25}\b(kinerja|performa|produktivitas|produktif|paling produktif)\b/, intent: 'GET_SHIFT_PERFORMANCE', by: 4, label: 'pola:kinerja-shift' },
];

function matchRule(text: string, tokens: Set<string>, rule: IntentRule): { score: number; hits: string[] } {
  let score = 0;
  const hits: string[] = [];
  for (const s of rule.strong) {
    const hit = s.includes(' ') ? text.includes(s) : tokens.has(s);
    if (hit) {
      score += 3;
      hits.push(s);
    }
  }
  for (const w of rule.weak) {
    const hit = w.includes(' ') ? text.includes(w) : tokens.has(w);
    if (hit) {
      score += 1;
      hits.push(w);
    }
  }
  return { score, hits };
}

/**
 * Score -> confidence.
 *
 * A strong (phrase) hit scores 3, a weak (token) hit scores 1, so score === 2
 * means TWO DISTINCT domain keywords co-occurred — e.g. "stok" + "habis" in
 * "stok apa yang mau habis?", or "jam" + "ramai" in "jam berapa toko paling
 * ramai". That is real evidence and must stay on the free deterministic path;
 * scoring it below INTENT_CONFIDENCE_THRESHOLD leaked ordinary questions to the
 * billed LLM, which is exactly the cost leakage this architecture exists to
 * prevent. A single generic token (score 1, e.g. "produk" on its own) stays
 * below the threshold on purpose.
 */
function scoreToConfidence(score: number): number {
  if (score <= 0) return 0;
  if (score === 1) return 0.25;
  if (score === 2) return 0.55;
  if (score === 3) return 0.62;
  return Math.min(0.95, 0.62 + 0.08 * (score - 3));
}

export function parseIntent(text: string): ParsedIntent {
  const empty: ParsedIntent = { intent: 'UNKNOWN', confidence: 0, entities: {}, matchedKeywords: [] };
  if (!text || !text.trim()) return empty;

  const norm = normalise(text);
  if (!norm) return empty;

  const tokenList = norm.split(' ');
  const tokens = new Set(tokenList);

  /* --- entities ---------------------------------------------------------- */
  const entities: IntentEntities = {};
  for (const [re, p] of PERIOD_PATTERNS) {
    if (re.test(norm)) {
      entities.period = p;
      break;
    }
  }
  const limit = extractLimit(norm);
  if (limit !== undefined) entities.limit = limit;

  const quoted = extractQuoted(text);
  const productName = captureAfterCue(tokenList, PRODUCT_CUES);
  const customerName = captureAfterCue(tokenList, CUSTOMER_CUES);
  const staffName = captureAfterCue(tokenList, STAFF_CUES);
  if (productName) entities.productName = productName;
  if (customerName) entities.customerName = customerName;
  if (staffName) entities.staffName = staffName;

  /* --- scoring ----------------------------------------------------------- */
  const scored: { intent: IntentName; score: number; hits: string[] }[] = [];
  // EXPLAIN_BUSINESS_SCOPE has no RULES entry — it is detected structurally,
  // not by keyword scoring — so it must be excluded from this walk too.
  (Object.keys(RULES) as Exclude<IntentName, 'UNKNOWN' | 'EXPLAIN_BUSINESS_SCOPE'>[]).forEach(
    (intent) => {
      const { score, hits } = matchRule(norm, tokens, RULES[intent]);
      if (score > 0) scored.push({ intent, score, hits });
    }
  );

  // Quoted text is a strong hint that the merchant is naming one entity.
  if (quoted) {
    const q = normalise(quoted);
    if (q) {
      if (CUSTOMER_CUES.some((c) => tokens.has(c))) entities.customerName = q;
      else if (STAFF_CUES.some((c) => tokens.has(c))) entities.staffName = q;
      else entities.productName = q;
    }
  }

  // Named-entity boosts: a captured name makes the *detail* intents concrete.
  const boost = (intent: IntentName, by: number, label: string) => {
    const row = scored.find((s) => s.intent === intent);
    if (row) {
      row.score += by;
      row.hits.push(label);
    } else {
      scored.push({ intent, score: by, hits: [label] });
    }
  };
  if (entities.customerName && CUSTOMER_CUES.some((c) => tokens.has(c))) {
    boost('GET_CUSTOMER_DETAIL', 3, `nama:${entities.customerName}`);
  }
  if (entities.productName && PRODUCT_CUES.some((c) => tokens.has(c))) {
    boost('GET_PRODUCT_DETAIL', 3, `nama:${entities.productName}`);
  }
  if (entities.staffName && STAFF_CUES.some((c) => tokens.has(c))) {
    boost('GET_STAFF_PERFORMANCE', 2, `nama:${entities.staffName}`);
  }

  // Discontinuous phrase patterns that plain substring matching cannot see.
  // "kapan biji kopi habis" is a forecast question, not a low-stock question,
  // even though "kapan habis" never appears as contiguous text.
  for (const { re, intent, by, label } of PATTERN_BOOSTS) {
    if (re.test(norm)) boost(intent, by, label);
  }

  if (scored.length === 0) {
    return { intent: 'UNKNOWN', confidence: 0, entities, matchedKeywords: [] };
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored.length > 1 ? scored[1].score : 0;

  let confidence = scoreToConfidence(best.score);
  // Genuine ambiguity between two equally-strong intents softens the score --
  // but only mildly. When two intents tie we still understood the domain, and
  // both candidates are free data lookups; escalating a tie to the billed LLM
  // would charge the merchant for a question we could answer for nothing.
  if (runnerUp === best.score) confidence = Math.round(confidence * 0.9 * 100) / 100;

  /* --- advisory suppression --------------------------------------------- */
  const isAdvisory = ADVISORY_PATTERNS.some((re) => re.test(norm));
  if (isAdvisory && best.score < 9) {
    return {
      intent: 'UNKNOWN',
      confidence: Math.min(Math.round(confidence * 0.35 * 100) / 100, INTENT_CONFIDENCE_THRESHOLD - 0.1),
      entities,
      matchedKeywords: best.hits,
    };
  }

  // Default period depends on whether the question is operational or analytical.
  if (!entities.period) {
    entities.period = TODAY_DEFAULT_INTENTS.includes(best.intent) ? 'TODAY' : 'MONTH';
  }

  return {
    intent: best.intent,
    confidence: Math.round(confidence * 100) / 100,
    entities,
    matchedKeywords: Array.from(new Set(best.hits)),
  };
}

/* ========================================================================== */
/* 5. CANONICAL FOLLOW-UP CHIPS (every query round-trips through parseIntent)  */
/* ========================================================================== */

const Q = {
  digest: { label: 'Ringkasan toko', query: 'ringkasan kondisi toko' },
  stock: { label: 'Stok menipis', query: 'stok menipis apa saja' },
  forecast: { label: 'Prediksi stok', query: 'prediksi stok kapan habis' },
  top: { label: 'Produk terlaris', query: 'produk terlaris bulan ini' },
  slow: { label: 'Kurang laku', query: 'produk kurang laku bulan ini' },
  revenue: { label: 'Omset hari ini', query: 'omset hari ini' },
  revenueMonth: { label: 'Omset bulan ini', query: 'omset bulan ini' },
  margin: { label: 'Margin untung', query: 'berapa margin keuntungan bulan ini' },
  payment: { label: 'Metode bayar', query: 'metode pembayaran paling sering' },
  cross: { label: 'Ide bundling', query: 'bundling produk sering dibeli bersama' },
  churn: { label: 'Pelanggan hilang', query: 'pelanggan sudah lama tidak datang' },
  loyal: { label: 'Pelanggan setia', query: 'pelanggan setia teratas' },
  peak: { label: 'Jam ramai', query: 'jam ramai toko' },
  staff: { label: 'Kinerja staf', query: 'kinerja staf terbaik' },
  attendance: { label: 'Absensi', query: 'absensi kehadiran hari ini' },
  shift: { label: 'Shift kasir', query: 'status shift kasir sekarang' },
  promo: { label: 'Promo aktif', query: 'promo diskon aktif' },
};

function slotChip(slotNoun: string): { label: string; query: string } {
  const noun = slotNoun && slotNoun.trim() ? slotNoun.trim() : 'Meja';
  return { label: `Status ${noun}`, query: `status ${noun} kosong sekarang` };
}

function productChip(name: string): { label: string; query: string } {
  return { label: `Detail ${name}`, query: `info produk ${name}` };
}

function customerChip(name: string): { label: string; query: string } {
  return { label: `Riwayat ${name}`, query: `riwayat pelanggan bernama ${name}` };
}

/* ========================================================================== */
/* 6. QUICK CHIPS                                                             */
/* ========================================================================== */

/**
 * RBAC FOR THE ASSISTANT.
 *
 * The sidebar already hides Reports and Inventory from a CASHIER, but without
 * this map the assistant happily answers "berapa margin dan HPP toko?" for the
 * same user — turning the Copilot into a way around the permission model.
 *
 * Only intents whose data lives behind a locked tab are listed. Revenue for
 * today is deliberately NOT gated: the header already shows the running shift
 * total to every role, so hiding it here would be inconsistent theatre.
 */
export const INTENT_PERMISSION: Partial<Record<IntentName, PermissionFeature>> = {
  GET_PROFIT_MARGIN: 'reports',
  GET_TARGET_PROGRESS: 'reports',
  GET_PAYMENT_MIX: 'reports',
  GET_CALENDAR_PATTERN: 'reports',
  GET_SHIFT_PERFORMANCE: 'reports',
  GET_STAFF_PERFORMANCE: 'reports',
  GET_STOCK_CRITICAL: 'inventory',
  GET_STOCK_FORECAST: 'inventory',
  GET_SLOW_MOVING: 'inventory',
  GET_PRODUCT_DETAIL: 'inventory',
};

/** Human-readable reason shown when a role may not see an answer. */
function permissionDenied(
  intent: IntentName,
  role: UserRole,
  feature: PermissionFeature,
  startedAt: number
): AssistantAnswer {
  const featureLabel: Record<string, string> = {
    reports: 'Laporan & Analitik',
    inventory: 'Produk & Stok',
  };
  return answer(
    intent,
    'RULE_ENGINE',
    'Akses dibatasi peran',
    [
      `**Data ini hanya untuk Manager atau Pemilik**`,
      `Peran Anda saat ini **${role}**, dan menu **${featureLabel[feature] || feature}** tidak termasuk hak aksesnya — jadi saya juga tidak boleh membacakan angkanya di sini.`,
      ``,
      `Silakan minta Manager/Pemilik membukanya, atau gunakan akun dengan hak akses tersebut.`,
    ],
    { denied: true, requiredFeature: feature, role },
    [Q.revenue, Q.digest, Q.loyal],
    startedAt
  );
}

/** Returns null when allowed, or the refusal answer when the role lacks access. */
function enforceRole(
  intent: IntentName,
  role: UserRole | undefined,
  startedAt: number
): AssistantAnswer | null {
  const feature = INTENT_PERMISSION[intent];
  if (!feature) return null;
  const granted = ROLE_PERMISSIONS[role || 'ADMIN'] || [];
  if (granted.includes(feature)) return null;
  return permissionDenied(intent, role || 'ADMIN', feature, startedAt);
}

export const QUICK_CHIPS: { label: string; intent: IntentName; icon: string }[] = [
  { label: 'Ringkasan Hari Ini', intent: 'GET_INSIGHT_DIGEST', icon: 'Sparkles' },
  { label: 'Stok Menipis', intent: 'GET_STOCK_CRITICAL', icon: 'PackageSearch' },
  { label: 'Produk Terlaris', intent: 'GET_TOP_SELLING_ITEM', icon: 'TrendingUp' },
  { label: 'Omset Hari Ini', intent: 'GET_REVENUE_SUMMARY', icon: 'Wallet' },
  { label: 'Jam Ramai', intent: 'GET_PEAK_HOURS', icon: 'Clock' },
  { label: 'Pelanggan Setia', intent: 'GET_LOYAL_CUSTOMERS', icon: 'Users' },
  { label: 'Progres Target', intent: 'GET_TARGET_PROGRESS', icon: 'Target' },
  { label: 'Pola Gajian', intent: 'GET_CALENDAR_PATTERN', icon: 'CalendarDays' },
  { label: 'Status Denah', intent: 'GET_TABLE_STATUS', icon: 'LayoutGrid' },
  { label: 'Kinerja Staf', intent: 'GET_STAFF_PERFORMANCE', icon: 'UserCheck' },
];

/* ========================================================================== */
/* 7. SHARED COMPUTATION HELPERS (snapshot path)                              */
/* ========================================================================== */

interface Win {
  start: number;
  end: number;
  label: string;
  days: number;
}

function resolveWindow(period: IntentPeriod | undefined, nowMs: number): Win {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  switch (period) {
    case 'YESTERDAY':
      return { start: startOfToday - DAY_MS, end: startOfToday - 1, label: 'kemarin', days: 1 };
    case 'WEEK':
      return { start: startOfToday - 6 * DAY_MS, end: startOfToday + DAY_MS - 1, label: '7 hari terakhir', days: 7 };
    case 'MONTH':
      return { start: startOfToday - 29 * DAY_MS, end: startOfToday + DAY_MS - 1, label: '30 hari terakhir', days: 30 };
    case 'ALL':
      return { start: 0, end: startOfToday + DAY_MS - 1, label: 'sepanjang waktu', days: 0 };
    case 'TODAY':
    default:
      return { start: startOfToday, end: startOfToday + DAY_MS - 1, label: 'hari ini', days: 1 };
  }
}

function ordersIn(orders: Order[], win: Win, status?: Order['status']): Order[] {
  const out: Order[] = [];
  for (const o of orders) {
    if (status && o.status !== status) continue;
    const t = toMs(o.date);
    if (t === null) continue;
    if (t < win.start || t > win.end) continue;
    out.push(o);
  }
  return out;
}

function lineRevenue(item: CartItem): number {
  if (Number.isFinite(item.totalPrice) && item.totalPrice > 0) return item.totalPrice;
  const gross = (item.unitPrice || 0) * (item.quantity || 0);
  return Math.max(0, gross - (item.discountAmount || 0));
}

interface ProductAgg {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  lastSoldMs: number | null;
}

/**
 * Roll orders up per product line. The catalog is *enrichment only* — seed
 * orders reference product ids that no longer exist, so the line's own
 * name/unitPrice is always the source of truth.
 */
function aggregateProducts(orders: Order[], products: Product[]): ProductAgg[] {
  const byId = new Map<string, Product>();
  for (const p of products) byId.set(p.id, p);
  const map = new Map<string, ProductAgg>();
  for (const o of orders) {
    const t = toMs(o.date);
    const items = Array.isArray(o.items) ? o.items : [];
    for (const item of items) {
      const catalog = item.productId ? byId.get(item.productId) : undefined;
      const key = item.productId || `name:${(item.name || 'Tanpa nama').toLowerCase()}`;
      const name = catalog?.name || item.name || 'Item tanpa nama';
      const row = map.get(key) || { productId: key, name, qty: 0, revenue: 0, lastSoldMs: null };
      row.name = name;
      row.qty += item.quantity || 0;
      row.revenue += lineRevenue(item);
      if (t !== null && (row.lastSoldMs === null || t > row.lastSoldMs)) row.lastSoldMs = t;
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function revenueOf(orders: Order[]): number {
  let sum = 0;
  for (const o of orders) sum += Number.isFinite(o.total) ? o.total : 0;
  return sum;
}

function answer(
  intent: IntentName,
  source: 'RULE_ENGINE' | 'BATCH_INSIGHT',
  title: string,
  lines: string[],
  data: unknown,
  chips: { label: string; query: string }[],
  startedAt: number
): AssistantAnswer {
  return {
    source,
    intent,
    title,
    markdown: lines.filter((l) => l !== undefined && l !== null).join('\n'),
    data,
    chips: chips.slice(0, 3),
    costCredits: 0,
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
}

/** Case-insensitive substring first, then best token-overlap match. */
function fuzzyFind<T>(needle: string, rows: T[], nameOf: (r: T) => string): T | null {
  if (!needle || rows.length === 0) return null;
  const q = needle.toLowerCase().trim();
  if (!q) return null;
  for (const r of rows) {
    if (nameOf(r).toLowerCase() === q) return r;
  }
  for (const r of rows) {
    if (nameOf(r).toLowerCase().includes(q)) return r;
  }
  const qTokens = q.split(' ').filter(Boolean);
  let bestRow: T | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const nTokens = nameOf(r).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    let s = 0;
    for (const qt of qTokens) {
      for (const nt of nTokens) {
        if (nt === qt) s += 2;
        else if (nt.startsWith(qt) || qt.startsWith(nt)) s += 1;
      }
    }
    if (s > bestScore) {
      bestScore = s;
      bestRow = r;
    }
  }
  return bestScore >= 2 ? bestRow : null;
}

function findPayload<K extends InsightPayload['kind']>(
  insights: MerchantInsight[],
  kind: K
): Extract<InsightPayload, { kind: K }> | null {
  for (const ins of insights) {
    if (ins && ins.payload && ins.payload.kind === kind) {
      return ins.payload as Extract<InsightPayload, { kind: K }>;
    }
  }
  return null;
}

function insightOf(insights: MerchantInsight[], kind: InsightPayload['kind']): MerchantInsight | null {
  for (const ins of insights) {
    if (ins && ins.payload && ins.payload.kind === kind) return ins;
  }
  return null;
}

/* ========================================================================== */
/* 8. resolveIntent — the snapshot-backed engine                              */
/* ========================================================================== */

export function resolveIntent(
  p: ParsedIntent,
  s: MerchantSnapshot,
  b: BatchRunResult
): AssistantAnswer | null {
  if (!p || p.intent === 'UNKNOWN') return null;

  const t0 = Date.now();

  // RBAC before data: the assistant must not become a way around a locked tab.
  const denied = enforceRole(p.intent, s.userRole, t0);
  if (denied) return denied;

  const nowMs = toMs(s.generatedAt) ?? Date.now();
  const win = resolveWindow(p.entities.period, nowMs);
  const limit = clamp(p.entities.limit ?? 5, 1, 20);
  const insights = Array.isArray(b?.insights) ? b.insights : [];
  const agg = b?.aggregates;
  const slot = s.slotNoun && s.slotNoun.trim() ? s.slotNoun.trim() : 'Meja';
  const orders = Array.isArray(s.orders) ? s.orders : [];
  const completedAll = orders.filter((o) => o.status === 'COMPLETED');

  switch (p.intent) {
    /* ---------------------------------------------------------------- */
    case 'GET_INSIGHT_DIGEST': {
      const today = ordersIn(completedAll, resolveWindow('TODAY', nowMs));
      const revToday = revenueOf(today);
      const ranked = [...insights].sort((a, c) => a.priority - c.priority).slice(0, 4);

      if (ranked.length === 0 && completedAll.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Ringkasan ${s.storeName}`,
          [
            `**Belum ada data yang bisa diringkas**`,
            `Belum ada transaksi selesai yang tercatat, jadi belum ada pola yang bisa saya baca.`,
            `- Produk terdaftar: ${num(s.products.length)}`,
            `- Pelanggan terdaftar: ${num(s.customers.length)}`,
            ``,
            `Langkah pertama: catat penjualan hari ini lewat POS, walau cuma satu transaksi. Besok saya sudah bisa kasih ringkasan yang berguna.`,
          ],
          { insights: [], revenueToday: 0 },
          [Q.stock, Q.promo, slotChip(slot)],
          t0
        );
      }

      const lines: string[] = [
        `**Ringkasan ${s.storeName} — ${new Date(nowMs).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}**`,
        `Omset hari ini **${rp(revToday)}** dari ${num(today.length)} transaksi. Rata-rata per struk ${rp(div(revToday, today.length))}.`,
      ];
      if (ranked.length > 0) {
        lines.push(`**Yang perlu Anda lihat:**`);
        for (const ins of ranked) {
          const flag = ins.priority === 1 ? 'PENTING' : ins.priority === 2 ? 'Perhatian' : 'Info';
          lines.push(`- [${flag}] ${ins.title} — ${ins.summary} (${ins.metricLabel})`);
        }
      } else {
        lines.push(`- Tidak ada peringatan khusus hari ini. Semua terlihat normal.`);
      }
      const top = ranked[0];
      lines.push(``);
      lines.push(
        top
          ? `Tindakan hari ini: mulai dari "${top.title}" karena itu yang paling cepat berdampak ke uang masuk.`
          : `Tindakan hari ini: cek stok menipis sebelum jam ramai supaya tidak kehilangan penjualan.`
      );

      return answer(
        p.intent,
        'BATCH_INSIGHT',
        `Ringkasan ${s.storeName}`,
        lines,
        { insights: ranked, revenueToday: revToday, ordersToday: today.length, aggregates: agg },
        [Q.stock, Q.top, Q.revenue],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_STOCK_CRITICAL': {
      const payload = findPayload(insights, 'INVENTORY_ALERT');
      type Row = {
        name: string;
        unit: string;
        stock: number;
        min: number;
        severity: string;
        suggestedQty: number;
        daysOfCover: number | null;
      };
      let rows: Row[] = [];
      let source: 'BATCH_INSIGHT' | 'RULE_ENGINE' = 'RULE_ENGINE';

      if (payload && payload.items.length > 0) {
        source = 'BATCH_INSIGHT';
        rows = payload.items
          .filter((i) => i.severity !== 'WATCH')
          .map((i) => ({
            name: i.name,
            unit: i.unit,
            stock: i.currentStock,
            min: i.reorderPoint,
            severity: i.severity,
            suggestedQty: i.suggestedReorderQty,
            daysOfCover: Number.isFinite(i.daysOfCover) ? i.daysOfCover : null,
          }));
      }
      if (rows.length === 0) {
        source = 'RULE_ENGINE';
        const fromProducts: Row[] = s.products
          .filter((pr) => pr.stock <= (pr.minStockAlert || 0))
          .map((pr) => ({
            name: pr.name,
            unit: pr.unit || 'pcs',
            stock: pr.stock,
            min: pr.minStockAlert || 0,
            severity: pr.stock <= 0 ? 'OUT_OF_STOCK' : 'BELOW_ROP',
            suggestedQty: Math.max(1, Math.ceil((pr.minStockAlert || 1) * 2 - pr.stock)),
            daysOfCover: null,
          }));
        const fromStock: Row[] = s.stockItems
          .filter((si) => si.stock <= (si.minStockAlert || 0))
          .map((si) => ({
            name: si.name,
            unit: si.unit || 'pcs',
            stock: si.stock,
            min: si.minStockAlert || 0,
            severity: si.stock <= 0 ? 'OUT_OF_STOCK' : 'BELOW_ROP',
            suggestedQty: Math.max(1, Math.ceil((si.minStockAlert || 1) * 2 - si.stock)),
            daysOfCover: null,
          }));
        rows = [...fromProducts, ...fromStock];
      }

      if (s.products.length === 0 && s.stockItems.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Stok Menipis',
          [
            `**Belum ada item di daftar stok**`,
            `Saya belum bisa memantau stok karena katalog produk dan bahan baku masih kosong.`,
            ``,
            `Langkah pertama: tambahkan produk beserta stok awal dan batas minimum di menu Inventaris.`,
          ],
          { items: [] },
          [Q.top, Q.digest, Q.promo],
          t0
        );
      }

      if (rows.length === 0) {
        return answer(
          p.intent,
          source,
          'Stok Menipis',
          [
            `**Stok aman, tidak ada yang kritis**`,
            `Dari ${num(s.products.length)} produk dan ${num(s.stockItems.length)} bahan baku, semuanya masih di atas batas minimum.`,
            ``,
            `Tetap cek lagi besok pagi — barang cepat habis di jam ramai. Anda bisa tanya "prediksi stok kapan habis" untuk lihat proyeksinya.`,
          ],
          { items: [] },
          [Q.forecast, Q.top, Q.digest],
          t0
        );
      }

      rows.sort((a, c) => {
        const rank = (sev: string) => (sev === 'OUT_OF_STOCK' ? 0 : sev === 'CRITICAL' ? 1 : 2);
        if (rank(a.severity) !== rank(c.severity)) return rank(a.severity) - rank(c.severity);
        return a.stock - c.stock;
      });
      const shown = rows.slice(0, limit);
      const outCount = rows.filter((r) => r.severity === 'OUT_OF_STOCK').length;

      const lines: string[] = [
        `**${num(rows.length)} item perlu segera dibelanjakan**`,
        outCount > 0
          ? `${num(outCount)} di antaranya sudah benar-benar habis — penjualannya berhenti sekarang juga.`
          : `Belum ada yang habis total, tapi semuanya sudah di bawah batas aman.`,
      ];
      for (const r of shown) {
        const cover = r.daysOfCover !== null && r.daysOfCover > 0 ? `, cukup ~${dec(r.daysOfCover)} hari lagi` : '';
        lines.push(
          `- **${r.name}** — sisa ${num(r.stock)} ${r.unit} (batas ${num(r.min)})${cover}. Saran beli ${num(r.suggestedQty)} ${r.unit}.`
        );
      }
      if (rows.length > shown.length) lines.push(`- ...dan ${num(rows.length - shown.length)} item lain.`);
      lines.push(``);
      lines.push(
        `Tindakan: buat satu daftar belanja untuk ${shown.length > 0 ? `"${shown[0].name}"` : 'item teratas'} dan kawan-kawan hari ini juga, sebelum jam ramai berikutnya.`
      );

      return answer(p.intent, source, 'Stok Menipis', lines, { items: rows }, [Q.forecast, Q.top, Q.digest], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_STOCK_FORECAST': {
      const payload = findPayload(insights, 'INVENTORY_ALERT');
      type FRow = {
        name: string;
        unit: string;
        stock: number;
        adc: number;
        daysOfCover: number;
        stockoutDate: string | null;
      };
      let rows: FRow[] = [];
      let source: 'BATCH_INSIGHT' | 'RULE_ENGINE' = 'RULE_ENGINE';

      if (payload && payload.items.length > 0) {
        source = 'BATCH_INSIGHT';
        rows = payload.items.map((i) => ({
          name: i.name,
          unit: i.unit,
          stock: i.currentStock,
          adc: i.avgDailyConsumption,
          daysOfCover: Number.isFinite(i.daysOfCover) ? i.daysOfCover : 0,
          stockoutDate: i.projectedStockoutDate,
        }));
      } else {
        // Live forecast: blend order lines and inventory logs over 30 days.
        const fWin = resolveWindow('MONTH', nowMs);
        const soldByProduct = new Map<string, number>();
        for (const o of ordersIn(completedAll, fWin)) {
          for (const item of o.items || []) {
            if (!item.productId) continue;
            soldByProduct.set(item.productId, (soldByProduct.get(item.productId) || 0) + (item.quantity || 0));
          }
        }
        const movedById = new Map<string, number>();
        for (const log of s.inventoryLogs || []) {
          if (log.type !== 'SALE' && log.type !== 'OUT') continue;
          const t = toMs(log.timestamp);
          if (t === null || t < fWin.start || t > fWin.end) continue;
          movedById.set(log.productId, (movedById.get(log.productId) || 0) + Math.abs(log.quantity || 0));
        }
        const candidates: { id: string; name: string; unit: string; stock: number }[] = [
          ...s.products.map((pr) => ({ id: pr.id, name: pr.name, unit: pr.unit || 'pcs', stock: pr.stock })),
          ...s.stockItems.map((si) => ({ id: si.id, name: si.name, unit: si.unit || 'pcs', stock: si.stock })),
        ];
        for (const c of candidates) {
          const used = Math.max(soldByProduct.get(c.id) || 0, movedById.get(c.id) || 0);
          const adc = div(used, 30);
          if (adc <= 0) continue;
          const cover = div(c.stock, adc);
          rows.push({
            name: c.name,
            unit: c.unit,
            stock: c.stock,
            adc,
            daysOfCover: cover,
            stockoutDate: cover > 0 ? new Date(nowMs + cover * DAY_MS).toISOString().slice(0, 10) : null,
          });
        }
      }

      if (rows.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Prediksi Stok',
          [
            `**Belum cukup data untuk memprediksi**`,
            `Prediksi butuh riwayat pemakaian minimal beberapa hari. Saat ini belum ada pergerakan stok yang tercatat.`,
            ``,
            `Langkah pertama: pastikan setiap penjualan dicatat lewat POS supaya pemakaian stok ikut terekam. Sementara itu, pantau manual lewat "stok menipis".`,
          ],
          { items: [] },
          [Q.stock, Q.top, Q.digest],
          t0
        );
      }

      rows.sort((a, c) => a.daysOfCover - c.daysOfCover);
      const shown = rows.slice(0, limit);
      const urgent = rows.filter((r) => r.daysOfCover <= 7).length;

      const lines: string[] = [
        `**Prediksi kapan stok habis (berdasarkan pemakaian 30 hari terakhir)**`,
        urgent > 0
          ? `${num(urgent)} item diperkirakan habis dalam 7 hari ke depan.`
          : `Semua item masih aman lebih dari seminggu ke depan.`,
      ];
      for (const r of shown) {
        const when = r.stockoutDate ? ` (sekitar ${r.stockoutDate})` : '';
        lines.push(
          `- **${r.name}** — sisa ${num(r.stock)} ${r.unit}, terpakai ~${dec(r.adc, 1)} ${r.unit}/hari, habis dalam **${dec(r.daysOfCover)} hari**${when}.`
        );
      }
      lines.push(``);
      lines.push(
        `Tindakan: pesan ulang **${shown[0].name}** sekarang, jangan tunggu habis — biasanya supplier butuh 2-3 hari untuk kirim.`
      );

      return answer(p.intent, source, 'Prediksi Stok', lines, { items: rows }, [Q.stock, Q.top, Q.digest], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_TOP_SELLING_ITEM': {
      const inWin = ordersIn(completedAll, win);
      const rows = aggregateProducts(inWin, s.products).filter((r) => r.qty > 0);

      if (rows.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Produk Terlaris',
          [
            `**Belum ada penjualan ${win.label}**`,
            completedAll.length === 0
              ? `Sampai sekarang belum ada transaksi selesai yang tercatat sama sekali.`
              : `Periode ${win.label} kosong, tapi ada ${num(completedAll.length)} transaksi di periode lain.`,
            ``,
            `Coba tanya lagi dengan periode lebih lebar, misalnya "produk terlaris bulan ini".`,
          ],
          { items: [], period: win.label },
          [Q.revenueMonth, Q.slow, Q.digest],
          t0
        );
      }

      rows.sort((a, c) => c.qty - a.qty || c.revenue - a.revenue);
      const shown = rows.slice(0, limit);
      const totalQty = rows.reduce((acc, r) => acc + r.qty, 0);
      const totalRev = rows.reduce((acc, r) => acc + r.revenue, 0);
      const leader = shown[0];

      const lines: string[] = [
        `**Produk terlaris ${win.label}**`,
        `Total ${num(totalQty)} item terjual senilai ${rp(totalRev)} dari ${num(inWin.length)} transaksi.`,
      ];
      shown.forEach((r, i) => {
        lines.push(
          `${i + 1}. **${r.name}** — ${num(r.qty)} terjual, ${rp(r.revenue)} (${pct(div(r.revenue, totalRev) * 100)} dari omset)`
        );
      });
      lines.push(``);
      lines.push(
        `Tindakan: pastikan stok **${leader.name}** tidak pernah kosong, dan pajang di posisi paling depan menu — satu produk ini menyumbang ${pct(div(leader.revenue, totalRev) * 100)} omset Anda.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        'Produk Terlaris',
        lines,
        { period: win.label, items: shown, totalQty, totalRevenue: totalRev },
        [productChip(leader.name), Q.cross, Q.slow],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_SLOW_MOVING': {
      const inWin = ordersIn(completedAll, win.days === 1 ? resolveWindow('MONTH', nowMs) : win);
      const effWin = win.days === 1 ? resolveWindow('MONTH', nowMs) : win;
      const sold = aggregateProducts(inWin, s.products);
      const soldById = new Map(sold.map((r) => [r.productId, r]));

      if (s.products.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Produk Kurang Laku',
          [
            `**Katalog produk masih kosong**`,
            `Saya belum bisa membandingkan produk mana yang lambat karena belum ada produk terdaftar.`,
            ``,
            `Langkah pertama: daftarkan menu atau barang jualan Anda di menu Inventaris.`,
          ],
          { items: [] },
          [Q.digest, Q.revenue, Q.promo],
          t0
        );
      }

      const rows = s.products.map((pr) => {
        const hit = soldById.get(pr.id);
        return {
          productId: pr.id,
          name: pr.name,
          qty: hit?.qty || 0,
          revenue: hit?.revenue || 0,
          stock: pr.stock,
          unit: pr.unit || 'pcs',
          tiedUpValue: pr.stock * (pr.costPrice || 0),
          daysSinceLastSale: hit?.lastSoldMs ? Math.floor(div(nowMs - hit.lastSoldMs, DAY_MS)) : null,
        };
      });
      rows.sort((a, c) => a.qty - c.qty || c.tiedUpValue - a.tiedUpValue);
      const shown = rows.slice(0, limit);
      const zero = rows.filter((r) => r.qty === 0);
      const tiedUp = zero.reduce((acc, r) => acc + r.tiedUpValue, 0);

      const lines: string[] = [
        `**Produk paling lambat bergerak (${effWin.label})**`,
        zero.length > 0
          ? `${num(zero.length)} produk sama sekali tidak terjual, modal mengendap sekitar ${rp(tiedUp)}.`
          : `Semua produk masih terjual, ini yang paling pelan.`,
      ];
      for (const r of shown) {
        const last =
          r.daysSinceLastSale === null
            ? 'belum pernah terjual di periode ini'
            : `terakhir laku ${num(r.daysSinceLastSale)} hari lalu`;
        lines.push(`- **${r.name}** — ${num(r.qty)} terjual, sisa stok ${num(r.stock)} ${r.unit}, ${last}.`);
      }
      lines.push(``);
      lines.push(
        `Tindakan: bikin promo bundling **${shown[0].name}** dengan produk terlaris Anda, atau turunkan stoknya di pembelian berikutnya supaya modal tidak nganggur.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        'Produk Kurang Laku',
        lines,
        { period: effWin.label, items: shown, zeroSaleCount: zero.length, tiedUpValue: tiedUp },
        [Q.cross, Q.top, Q.promo],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_REVENUE_SUMMARY': {
      const inWin = ordersIn(completedAll, win);
      const voided = ordersIn(orders, win, 'VOID');
      const held = ordersIn(orders, win, 'HOLD');
      const rev = revenueOf(inWin);
      const discount = inWin.reduce((acc, o) => acc + (o.discountTotal || 0), 0);
      const avg = div(rev, inWin.length);

      const span = win.days > 0 ? win.days : 1;
      const prevWin: Win = {
        start: win.start - span * DAY_MS,
        end: win.start - 1,
        label: 'periode sebelumnya',
        days: span,
      };
      const prevOrders = ordersIn(completedAll, prevWin);
      const prevRev = revenueOf(prevOrders);
      const deltaPct = prevRev > 0 ? (div(rev - prevRev, prevRev) * 100) : 0;

      if (inWin.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Omset ${win.label}`,
          [
            `**Belum ada penjualan ${win.label}**`,
            completedAll.length === 0
              ? `Belum ada satu pun transaksi selesai di sistem.`
              : `Periode ${win.label} masih kosong. Transaksi terakhir tercatat di luar periode ini.`,
            held.length > 0 ? `- Ada ${num(held.length)} order berstatus HOLD yang belum diselesaikan.` : `- Tidak ada order tertahan.`,
            ``,
            held.length > 0
              ? `Tindakan: selesaikan dulu ${num(held.length)} order HOLD itu — uangnya belum masuk ke laporan.`
              : `Tindakan: buka POS dan catat transaksi pertama hari ini supaya laporan mulai terisi.`,
          ],
          { period: win.label, revenue: 0, orders: 0 },
          [Q.revenueMonth, Q.top, Q.digest],
          t0
        );
      }

      const lines: string[] = [
        `**Omset ${win.label}: ${rp(rev)}**`,
        `Dari ${num(inWin.length)} transaksi selesai, rata-rata ${rp(avg)} per struk.`,
        prevRev > 0
          ? `- Dibanding periode sebelumnya (${rp(prevRev)}): ${deltaPct >= 0 ? 'naik' : 'turun'} ${pct(Math.abs(deltaPct))}.`
          : `- Belum ada pembanding periode sebelumnya.`,
        `- Diskon yang diberikan: ${rp(discount)} (${pct(div(discount, rev + discount) * 100)} dari nilai kotor).`,
        `- Order dibatalkan (VOID): ${num(voided.length)}${held.length > 0 ? `, tertahan (HOLD): ${num(held.length)}` : ''}.`,
      ];
      const topProd = aggregateProducts(inWin, s.products).sort((a, c) => c.revenue - a.revenue)[0];
      if (topProd) lines.push(`- Penyumbang terbesar: **${topProd.name}** (${rp(topProd.revenue)}).`);
      lines.push(``);
      lines.push(
        deltaPct < -5 && prevRev > 0
          ? `Tindakan: omset turun ${pct(Math.abs(deltaPct))}. Cek jam ramai dan pastikan stok produk andalan tidak kosong di jam itu.`
          : `Tindakan: pertahankan ritme ini — pastikan stok produk andalan aman untuk jam ramai berikutnya.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        `Omset ${win.label}`,
        lines,
        {
          period: win.label,
          revenue: rev,
          orders: inWin.length,
          avgTicket: avg,
          discount,
          voided: voided.length,
          held: held.length,
          previousRevenue: prevRev,
          deltaPct,
        },
        [Q.top, Q.payment, Q.margin],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PROFIT_MARGIN': {
      const inWin = ordersIn(completedAll, win);
      const byId = new Map(s.products.map((pr) => [pr.id, pr]));
      let knownRev = 0;
      let knownCost = 0;
      let unknownRev = 0;
      const perProduct = new Map<string, { name: string; revenue: number; cost: number }>();

      for (const o of inWin) {
        for (const item of o.items || []) {
          const rev = lineRevenue(item);
          const catalog = item.productId ? byId.get(item.productId) : undefined;
          if (catalog && Number.isFinite(catalog.costPrice) && catalog.costPrice > 0) {
            const cost = catalog.costPrice * (item.quantity || 0);
            knownRev += rev;
            knownCost += cost;
            const row = perProduct.get(catalog.id) || { name: catalog.name, revenue: 0, cost: 0 };
            row.revenue += rev;
            row.cost += cost;
            perProduct.set(catalog.id, row);
          } else {
            unknownRev += rev;
          }
        }
      }

      if (inWin.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Margin ${win.label}`,
          [
            `**Belum ada penjualan ${win.label}**`,
            `Margin butuh transaksi untuk dihitung, dan periode ini masih kosong.`,
            ``,
            `Coba periode yang lebih lebar: "berapa margin keuntungan bulan ini".`,
          ],
          { period: win.label },
          [Q.revenueMonth, Q.top, Q.digest],
          t0
        );
      }

      if (knownRev <= 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Margin ${win.label}`,
          [
            `**Harga modal (HPP) belum terisi**`,
            `Omset ${win.label} tercatat ${rp(revenueOf(inWin))}, tapi tidak ada produk terjual yang punya harga modal, jadi margin belum bisa dihitung.`,
            ``,
            `Langkah pertama: isi kolom Harga Modal di menu Inventaris untuk produk-produk terlaris Anda dulu.`,
          ],
          { period: win.label, revenue: revenueOf(inWin), coveragePct: 0 },
          [Q.top, Q.revenue, Q.digest],
          t0
        );
      }

      const grossProfit = knownRev - knownCost;
      const marginPct = div(grossProfit, knownRev) * 100;
      const coverage = div(knownRev, knownRev + unknownRev) * 100;
      const ranked = Array.from(perProduct.values())
        .map((r) => ({ ...r, profit: r.revenue - r.cost, marginPct: div(r.revenue - r.cost, r.revenue) * 100 }))
        .sort((a, c) => c.profit - a.profit);
      const best = ranked[0];
      const worst = ranked[ranked.length - 1];

      const lines: string[] = [
        `**Margin kotor ${win.label}: ${pct(marginPct)}**`,
        `Omset ${rp(knownRev)} dikurangi modal ${rp(knownCost)} = laba kotor **${rp(grossProfit)}**.`,
        `- Perhitungan mencakup ${pct(coverage)} dari total penjualan (sisanya produk tanpa data harga modal).`,
      ];
      if (best) lines.push(`- Penyumbang laba terbesar: **${best.name}** ${rp(best.profit)} (margin ${pct(best.marginPct)}).`);
      if (worst && ranked.length > 1) lines.push(`- Margin paling tipis: **${worst.name}** hanya ${pct(worst.marginPct)}.`);
      lines.push(``);
      lines.push(
        marginPct < 30
          ? `Tindakan: margin di bawah 30% cukup tipis. Naikkan harga ${worst ? `**${worst.name}**` : 'produk bermargin tipis'} sedikit, atau cari supplier lebih murah.`
          : `Tindakan: dorong penjualan **${best ? best.name : 'produk bermargin tebal'}** lewat bundling — di situ laba Anda paling besar.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        `Margin ${win.label}`,
        lines,
        { period: win.label, revenue: knownRev, cost: knownCost, grossProfit, marginPct, coveragePct: coverage, byProduct: ranked.slice(0, limit) },
        [Q.top, Q.revenue, Q.cross],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PAYMENT_MIX': {
      const inWin = ordersIn(completedAll, win);
      if (inWin.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Metode Pembayaran ${win.label}`,
          [
            `**Belum ada pembayaran ${win.label}**`,
            `Belum ada transaksi selesai di periode ini, jadi belum ada pola pembayaran yang bisa dibaca.`,
            ``,
            `Coba tanya "metode pembayaran bulan ini" untuk lihat periode yang lebih lebar.`,
          ],
          { period: win.label, mix: [] },
          [Q.revenueMonth, Q.digest, Q.top],
          t0
        );
      }
      const map = new Map<string, { method: string; orders: number; revenue: number }>();
      for (const o of inWin) {
        const key = o.paymentMethod || 'LAINNYA';
        const row = map.get(key) || { method: key, orders: 0, revenue: 0 };
        row.orders += 1;
        row.revenue += o.total || 0;
        map.set(key, row);
      }
      const total = revenueOf(inWin);
      const rows = Array.from(map.values())
        .map((r) => ({ ...r, sharePct: div(r.revenue, total) * 100 }))
        .sort((a, c) => c.revenue - a.revenue);
      const leader = rows[0];
      const cashRow = rows.find((r) => r.method === 'CASH');
      const cashShare = cashRow ? cashRow.sharePct : 0;

      const lines: string[] = [
        `**Metode pembayaran ${win.label}**`,
        `Dari ${num(inWin.length)} transaksi senilai ${rp(total)}:`,
      ];
      for (const r of rows) {
        lines.push(`- **${r.method}** — ${num(r.orders)} transaksi, ${rp(r.revenue)} (${pct(r.sharePct)})`);
      }
      lines.push(``);
      lines.push(
        cashShare > 60
          ? `Tindakan: ${pct(cashShare)} masih tunai. Pasang QRIS di posisi yang mudah terlihat supaya antrean kasir lebih cepat dan uang kembalian tidak jadi masalah.`
          : `Tindakan: ${leader.method} mendominasi (${pct(leader.sharePct)}). Pastikan alat pembayarannya selalu siap dan sinyalnya stabil di jam ramai.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        `Metode Pembayaran ${win.label}`,
        lines,
        { period: win.label, mix: rows, total },
        [Q.revenue, Q.shift, Q.peak],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_CROSS_SELL': {
      const payload = findPayload(insights, 'CROSS_SELL_OPPORTUNITY');
      type Pair = { aName: string; bName: string; coOccurrence: number; confidence: number; lift: number; bundlePrice: number | null };
      let pairs: Pair[] = [];
      let source: 'BATCH_INSIGHT' | 'RULE_ENGINE' = 'RULE_ENGINE';
      let basketCount = 0;

      if (payload && payload.pairs.length > 0) {
        source = 'BATCH_INSIGHT';
        basketCount = payload.basketCount;
        pairs = payload.pairs.map((pr) => ({
          aName: pr.aName,
          bName: pr.bName,
          coOccurrence: pr.coOccurrence,
          confidence: pr.confidence,
          lift: pr.lift,
          bundlePrice: pr.bundlePriceSuggestion,
        }));
      } else {
        const baskets = ordersIn(completedAll, resolveWindow('MONTH', nowMs)).filter(
          (o) => (o.items || []).length >= 2
        );
        basketCount = baskets.length;
        const counts = new Map<string, number>();
        const singles = new Map<string, number>();
        const names = new Map<string, string>();
        for (const o of baskets) {
          const keys = Array.from(
            new Set(
              (o.items || []).map((it) => {
                const k = it.productId || `name:${(it.name || '').toLowerCase()}`;
                names.set(k, it.name || k);
                return k;
              })
            )
          ).sort();
          for (const k of keys) singles.set(k, (singles.get(k) || 0) + 1);
          for (let i = 0; i < keys.length; i++) {
            for (let j = i + 1; j < keys.length; j++) {
              const pk = `${keys[i]}||${keys[j]}`;
              counts.set(pk, (counts.get(pk) || 0) + 1);
            }
          }
        }
        pairs = Array.from(counts.entries())
          .map(([pk, co]) => {
            const [a, bKey] = pk.split('||');
            const conf = div(co, singles.get(a) || 0);
            const pb = div(singles.get(bKey) || 0, basketCount);
            return {
              aName: names.get(a) || a,
              bName: names.get(bKey) || bKey,
              coOccurrence: co,
              confidence: conf,
              lift: pb > 0 ? div(conf, pb) : 0,
              bundlePrice: null,
            };
          })
          .filter((pr) => pr.coOccurrence >= 2)
          .sort((a, c) => c.coOccurrence - a.coOccurrence || c.lift - a.lift);
      }

      if (pairs.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Peluang Bundling',
          [
            `**Belum ada pola beli bareng yang jelas**`,
            basketCount === 0
              ? `Belum ada struk berisi 2 item atau lebih, jadi belum ada kombinasi yang bisa dianalisa.`
              : `Baru ada ${num(basketCount)} struk multi-item — belum cukup untuk menyimpulkan pasangan produk.`,
            ``,
            `Tindakan: coba tawarkan satu paket sederhana (produk terlaris + minuman/pelengkap) selama seminggu, lalu tanya saya lagi.`,
          ],
          { pairs: [], basketCount },
          [Q.top, Q.promo, Q.slow],
          t0
        );
      }

      const shown = pairs.slice(0, limit);
      const lines: string[] = [
        `**Produk yang sering dibeli bersamaan**`,
        `Dari ${num(basketCount)} struk berisi lebih dari satu item:`,
      ];
      for (const pr of shown) {
        const price = pr.bundlePrice ? ` — saran harga paket ${rp(pr.bundlePrice)}` : '';
        lines.push(
          `- **${pr.aName}** + **${pr.bName}** — ${num(pr.coOccurrence)}x bareng, ${pct(pr.confidence * 100)} pembeli ${pr.aName} juga ambil ${pr.bName}${price}.`
        );
      }
      lines.push(``);
      lines.push(
        `Tindakan: buat paket "${shown[0].aName} + ${shown[0].bName}" dengan potongan tipis, lalu tampilkan sebagai saran otomatis di kasir.`
      );

      return answer(p.intent, source, 'Peluang Bundling', lines, { pairs: shown, basketCount }, [Q.promo, Q.top, Q.slow], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_CHURN_CUSTOMERS': {
      const payload = findPayload(insights, 'CRM_CHURN');
      type CRow = { name: string; phone: string; tier: string; recencyDays: number; monetary: number; segment: string; offer: string };
      let rows: CRow[] = [];
      let source: 'BATCH_INSIGHT' | 'RULE_ENGINE' = 'RULE_ENGINE';

      if (payload && payload.customers.length > 0) {
        source = 'BATCH_INSIGHT';
        rows = payload.customers
          .filter((c) => c.segment === 'AT_RISK' || c.segment === 'HIBERNATING' || c.segment === 'LOST')
          .map((c) => ({
            name: c.name,
            phone: c.phone,
            tier: c.tier,
            recencyDays: c.recencyDays,
            monetary: c.monetary,
            segment: c.segment,
            offer: c.suggestedOffer,
          }));
      }
      if (rows.length === 0) {
        source = 'RULE_ENGINE';
        rows = s.customers
          .map((c) => {
            const last = toMs(c.lastVisit);
            const recency = last === null ? 999 : Math.floor(div(nowMs - last, DAY_MS));
            return {
              name: c.name,
              phone: c.phone,
              tier: c.tier,
              recencyDays: recency,
              monetary: c.totalSpent || 0,
              segment: recency > 90 ? 'LOST' : recency > 60 ? 'HIBERNATING' : 'AT_RISK',
              offer: 'Kirim voucher potongan untuk kunjungan berikutnya',
            };
          })
          .filter((c) => c.recencyDays >= 30 && c.monetary > 0);
      }

      if (s.customers.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Pelanggan Berisiko Hilang',
          [
            `**Belum ada data pelanggan**`,
            `Database pelanggan masih kosong, jadi belum ada yang bisa dipantau.`,
            ``,
            `Langkah pertama: mulai catat nama dan nomor HP pembeli di kasir. Cukup untuk yang belanja di atas nominal tertentu dulu.`,
          ],
          { customers: [] },
          [Q.digest, Q.revenue, Q.promo],
          t0
        );
      }

      if (rows.length === 0) {
        return answer(
          p.intent,
          source,
          'Pelanggan Berisiko Hilang',
          [
            `**Kabar baik: tidak ada pelanggan yang menghilang**`,
            `Dari ${num(s.customers.length)} pelanggan terdaftar, semuanya masih aktif berkunjung dalam 30 hari terakhir.`,
            ``,
            `Tindakan: jaga ritme ini. Coba lihat "pelanggan setia teratas" untuk tahu siapa yang layak diberi apresiasi.`,
          ],
          { customers: [] },
          [Q.loyal, Q.promo, Q.digest],
          t0
        );
      }

      rows.sort((a, c) => c.monetary - a.monetary || c.recencyDays - a.recencyDays);
      const shown = rows.slice(0, limit);
      const valueAtRisk = rows.reduce((acc, r) => acc + r.monetary, 0);

      const lines: string[] = [
        `**${num(rows.length)} pelanggan mulai menjauh**`,
        `Total belanja mereka selama ini ${rp(valueAtRisk)} — itu nilai yang berisiko hilang.`,
      ];
      for (const r of shown) {
        lines.push(
          `- **${r.name}** (${r.tier}) — terakhir datang ${num(r.recencyDays)} hari lalu, total belanja ${rp(r.monetary)}. ${r.offer}`
        );
      }
      lines.push(``);
      lines.push(
        `Tindakan: kirim WhatsApp personal ke **${shown[0].name}** hari ini — sapa namanya, tawarkan voucher kecil. Satu pesan jauh lebih murah daripada cari pelanggan baru.`
      );

      return answer(
        p.intent,
        source,
        'Pelanggan Berisiko Hilang',
        lines,
        { customers: shown, totalAtRisk: rows.length, valueAtRisk },
        [customerChip(shown[0].name), Q.loyal, Q.promo],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_LOYAL_CUSTOMERS': {
      const payload = findPayload(insights, 'CRM_CHURN');
      type LRow = { name: string; tier: string; visits: number; monetary: number; avgTicket: number; favourite: string | null; segment: string };
      let rows: LRow[] = [];
      let source: 'BATCH_INSIGHT' | 'RULE_ENGINE' = 'RULE_ENGINE';

      if (payload && payload.customers.length > 0) {
        const champs = payload.customers.filter((c) => c.segment === 'CHAMPION' || c.segment === 'LOYAL');
        if (champs.length > 0) {
          source = 'BATCH_INSIGHT';
          rows = champs.map((c) => ({
            name: c.name,
            tier: c.tier,
            visits: c.frequency,
            monetary: c.monetary,
            avgTicket: c.avgTicket,
            favourite: c.favouriteProduct,
            segment: c.segment,
          }));
        }
      }
      if (rows.length === 0) {
        source = 'RULE_ENGINE';
        rows = s.customers
          .filter((c) => (c.visitCount || 0) > 0 || (c.totalSpent || 0) > 0)
          .map((c) => ({
            name: c.name,
            tier: c.tier,
            visits: c.visitCount || 0,
            monetary: c.totalSpent || 0,
            avgTicket: div(c.totalSpent || 0, c.visitCount || 0),
            favourite: null,
            segment: c.tier,
          }));
      }

      if (rows.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Pelanggan Setia',
          [
            `**Belum ada pelanggan dengan riwayat belanja**`,
            s.customers.length === 0
              ? `Database pelanggan masih kosong.`
              : `Ada ${num(s.customers.length)} pelanggan terdaftar, tapi belum ada yang tercatat berbelanja.`,
            ``,
            `Langkah pertama: pilih nama pelanggan saat menutup transaksi di POS supaya riwayatnya terkumpul.`,
          ],
          { customers: [] },
          [Q.digest, Q.revenue, Q.promo],
          t0
        );
      }

      rows.sort((a, c) => c.monetary - a.monetary || c.visits - a.visits);
      const shown = rows.slice(0, limit);
      const totalSpent = rows.reduce((acc, r) => acc + r.monetary, 0);
      const topShare = div(shown.reduce((acc, r) => acc + r.monetary, 0), totalSpent) * 100;

      const lines: string[] = [
        `**Pelanggan paling berharga**`,
        `${num(shown.length)} nama teratas menyumbang ${pct(topShare)} dari total belanja pelanggan terdaftar (${rp(totalSpent)}).`,
      ];
      shown.forEach((r, i) => {
        const fav = r.favourite ? `, favoritnya ${r.favourite}` : '';
        lines.push(
          `${i + 1}. **${r.name}** (${r.tier}) — ${num(r.visits)} kunjungan, ${rp(r.monetary)}, rata-rata ${rp(r.avgTicket)}${fav}`
        );
      });
      lines.push(``);
      lines.push(
        `Tindakan: beri **${shown[0].name}** perlakuan khusus — sapa namanya, siapkan menu favoritnya, atau kirim voucher ulang tahun. Pelanggan seperti ini yang menjaga omset tetap stabil.`
      );

      return answer(
        p.intent,
        source,
        'Pelanggan Setia',
        lines,
        { customers: shown, totalCustomers: rows.length, totalSpent },
        [customerChip(shown[0].name), Q.churn, Q.promo],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_CUSTOMER_DETAIL': {
      const wanted = p.entities.customerName || '';
      if (s.customers.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Detail Pelanggan',
          [
            `**Belum ada pelanggan terdaftar**`,
            `Saya belum bisa mencari "${wanted || 'pelanggan'}" karena database pelanggan masih kosong.`,
            ``,
            `Langkah pertama: tambahkan pelanggan lewat menu Pelanggan, atau simpan nomor HP-nya saat transaksi.`,
          ],
          { customer: null },
          [Q.digest, Q.revenue, Q.promo],
          t0
        );
      }
      const found = wanted ? fuzzyFind(wanted, s.customers, (c) => c.name) : null;
      if (!found) {
        const sample = s.customers.slice(0, 6).map((c) => c.name);
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Detail Pelanggan',
          [
            `**Pelanggan "${wanted || '(tanpa nama)'}" tidak ketemu**`,
            `Saya cek ${num(s.customers.length)} pelanggan terdaftar dan tidak ada yang cocok.`,
            `Nama yang ada di database antara lain:`,
            ...sample.map((n) => `- ${n}`),
            ``,
            `Coba tulis ulang, misalnya: "riwayat pelanggan bernama ${sample[0]}".`,
          ],
          { customer: null, available: s.customers.map((c) => c.name) },
          [customerChip(sample[0]), Q.loyal, Q.churn],
          t0
        );
      }

      const history = completedAll.filter((o) => o.customer && o.customer.id === found.id);
      const spentHere = revenueOf(history);
      const prodRows = aggregateProducts(history, s.products).sort((a, c) => c.qty - a.qty);
      const fav = prodRows[0];
      const lastMs = toMs(found.lastVisit);
      const recency = lastMs === null ? null : Math.floor(div(nowMs - lastMs, DAY_MS));

      const lines: string[] = [
        `**${found.name} — ${found.tier}**`,
        `${num(found.visitCount || 0)} kunjungan, total belanja ${rp(found.totalSpent || 0)}, poin ${num(found.points || 0)}.`,
        `- Rata-rata per kunjungan: ${rp(div(found.totalSpent || 0, found.visitCount || 0))}`,
        `- Terakhir datang: ${recency === null ? 'belum tercatat' : recency === 0 ? 'hari ini' : `${num(recency)} hari lalu`}`,
        `- Kontak: ${found.phone || 'belum ada nomor'}`,
        fav
          ? `- Paling sering dibeli: **${fav.name}** (${num(fav.qty)}x)`
          : `- Belum ada riwayat item yang tercatat atas nama ini.`,
        history.length > 0 ? `- Transaksi tercatat di sistem: ${num(history.length)} senilai ${rp(spentHere)}` : '',
        ``,
        recency !== null && recency > 30
          ? `Tindakan: sudah ${num(recency)} hari tidak datang. Kirim WhatsApp ke ${found.phone || 'nomornya'} dengan tawaran ${fav ? fav.name : 'menu favorit'}.`
          : `Tindakan: pelanggan ini masih aktif. Siapkan ${fav ? `**${fav.name}**` : 'menu favoritnya'} dan sapa namanya saat datang.`,
      ];

      return answer(
        p.intent,
        'RULE_ENGINE',
        `Detail Pelanggan: ${found.name}`,
        lines.filter((l) => l !== ''),
        { customer: found, orders: history.length, spent: spentHere, favourite: fav || null, recencyDays: recency },
        [Q.loyal, Q.churn, Q.promo],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PEAK_HOURS': {
      const payload = findPayload(insights, 'OPERATIONAL_PEAK');
      let byHour: { hour: number; label: string; orders: number; revenue: number }[] = [];
      let byDay: { dayIndex: number; label: string; orders: number; revenue: number }[] = [];
      let staffingHint = '';
      let source: 'BATCH_INSIGHT' | 'RULE_ENGINE' = 'RULE_ENGINE';

      if (payload && payload.byHour.length > 0) {
        source = 'BATCH_INSIGHT';
        byHour = payload.byHour;
        byDay = payload.byDayOfWeek;
        staffingHint = payload.staffingHint || '';
      } else {
        const base = ordersIn(completedAll, resolveWindow('MONTH', nowMs));
        const hours = new Map<number, { orders: number; revenue: number }>();
        const days = new Map<number, { orders: number; revenue: number }>();
        for (const o of base) {
          const t = toMs(o.date);
          if (t === null) continue;
          const d = new Date(t);
          const h = d.getHours();
          const dw = d.getDay();
          const hr = hours.get(h) || { orders: 0, revenue: 0 };
          hr.orders += 1;
          hr.revenue += o.total || 0;
          hours.set(h, hr);
          const dr = days.get(dw) || { orders: 0, revenue: 0 };
          dr.orders += 1;
          dr.revenue += o.total || 0;
          days.set(dw, dr);
        }
        byHour = Array.from(hours.entries())
          .map(([hour, v]) => ({ hour, label: `${String(hour).padStart(2, '0')}:00`, orders: v.orders, revenue: v.revenue }))
          .sort((a, c) => a.hour - c.hour);
        byDay = Array.from(days.entries())
          .map(([dayIndex, v]) => ({ dayIndex, label: DAY_LABELS[dayIndex], orders: v.orders, revenue: v.revenue }))
          .sort((a, c) => a.dayIndex - c.dayIndex);
      }

      if (byHour.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Jam Ramai',
          [
            `**Belum ada pola jam yang bisa dibaca**`,
            `Butuh transaksi tercatat selama beberapa hari untuk melihat kapan toko ramai.`,
            ``,
            `Langkah pertama: catat setiap transaksi lewat POS, termasuk yang kecil. Dalam seminggu polanya sudah kelihatan.`,
          ],
          { byHour: [], byDayOfWeek: [] },
          [Q.revenue, Q.digest, Q.top],
          t0
        );
      }

      const hotHours = [...byHour].sort((a, c) => c.orders - a.orders || c.revenue - a.revenue);
      const coldHours = [...byHour].filter((h) => h.orders > 0).sort((a, c) => a.orders - c.orders);
      const hotDays = [...byDay].sort((a, c) => c.revenue - a.revenue);
      const top1 = hotHours[0];

      const lines: string[] = [
        `**Kapan toko paling ramai**`,
        `Jam tersibuk: **${top1.label}** dengan ${num(top1.orders)} transaksi (${rp(top1.revenue)}).`,
      ];
      hotHours.slice(0, Math.min(3, hotHours.length)).forEach((h, i) => {
        lines.push(`${i + 1}. ${h.label} — ${num(h.orders)} transaksi, ${rp(h.revenue)}`);
      });
      if (hotDays.length > 0) lines.push(`- Hari teramai: **${hotDays[0].label}** (${rp(hotDays[0].revenue)}).`);
      if (coldHours.length > 0) lines.push(`- Paling sepi: ${coldHours[0].label} (${num(coldHours[0].orders)} transaksi).`);
      lines.push(``);
      lines.push(
        staffingHint ||
          `Tindakan: tambah satu orang di jam ${top1.label} dan siapkan stok sebelum jam itu. Untuk jam sepi ${coldHours.length > 0 ? coldHours[0].label : ''}, coba promo happy hour.`
      );

      return answer(
        p.intent,
        source,
        'Jam Ramai',
        lines,
        { byHour, byDayOfWeek: byDay, busiestHour: top1, busiestDay: hotDays[0] || null },
        [Q.staff, Q.revenue, Q.promo],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_TABLE_STATUS': {
      const tables = Array.isArray(s.tables) ? s.tables : [];
      if (tables.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Status ${slot}`,
          [
            `**Belum ada ${slot.toLowerCase()} yang terdaftar**`,
            `Denah masih kosong, jadi belum ada okupansi yang bisa saya laporkan.`,
            ``,
            `Langkah pertama: buka menu Denah dan tambahkan ${slot.toLowerCase()} beserta kapasitasnya.`,
          ],
          { slotNoun: slot, slots: [] },
          [Q.digest, Q.revenue, Q.peak],
          t0
        );
      }

      const occupied = tables.filter((tb) => tb.status === 'OCCUPIED');
      const billing = tables.filter((tb) => tb.status === 'BILLING');
      const reserved = tables.filter((tb) => tb.status === 'RESERVED');
      const available = tables.filter((tb) => tb.status === 'AVAILABLE');
      const inUse = occupied.length + billing.length;
      const occPct = div(inUse, tables.length) * 100;
      const activeValue = tables.reduce((acc, tb) => acc + (tb.activeOrder?.totalAmount || 0), 0);
      const layout = findPayload(insights, 'LAYOUT_UTILISATION');

      const lines: string[] = [
        `**Okupansi ${slot}: ${num(inUse)} dari ${num(tables.length)} terpakai (${pct(occPct)})**`,
        `- Kosong siap pakai: ${num(available.length)}`,
        `- Sedang dipakai: ${num(occupied.length)}${billing.length > 0 ? `, menunggu bayar: ${num(billing.length)}` : ''}${reserved.length > 0 ? `, dipesan: ${num(reserved.length)}` : ''}`,
      ];
      if (activeValue > 0) lines.push(`- Nilai tagihan yang sedang berjalan: ${rp(activeValue)}`);
      const busy = occupied.slice(0, 3);
      for (const tb of busy) {
        const since = toMs(tb.occupiedSince);
        const mins = since === null ? null : Math.floor(div(nowMs - since, 60000));
        lines.push(
          `- **${tb.name}** (${tb.zone}, ${num(tb.capacity)} orang)${tb.customerName ? ` — ${tb.customerName}` : ''}${mins !== null ? `, sudah ${num(mins)} menit` : ''}${tb.activeOrder ? `, tagihan ${rp(tb.activeOrder.totalAmount)}` : ''}`
        );
      }
      if (layout && layout.deadSlots.length > 0) {
        lines.push(`- Jarang terpakai: ${layout.deadSlots.slice(0, 3).join(', ')}`);
      }
      lines.push(``);
      lines.push(
        occPct >= 80
          ? `Tindakan: hampir penuh. Percepat proses bayar di ${billing.length > 0 ? billing[0].name : slot.toLowerCase()} supaya antrean tidak menumpuk.`
          : available.length > 0
            ? `Tindakan: masih ada ${num(available.length)} ${slot.toLowerCase()} kosong. Arahkan tamu ke zona yang sepi supaya pelayanan lebih merata.`
            : `Tindakan: semua sedang terpakai — siapkan area tunggu untuk tamu berikutnya.`
      );

      return answer(
        p.intent,
        layout ? 'BATCH_INSIGHT' : 'RULE_ENGINE',
        `Status ${slot}`,
        lines,
        {
          slotNoun: slot,
          total: tables.length,
          occupied: occupied.length,
          billing: billing.length,
          reserved: reserved.length,
          available: available.length,
          occupancyPct: occPct,
          activeValue,
          slots: tables,
        },
        [Q.peak, Q.revenue, Q.staff],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_STAFF_PERFORMANCE': {
      const payload = findPayload(insights, 'STAFF_BEHAVIOUR');
      type SRow = { name: string; role: string; orders: number; revenue: number; avgTicket: number; note: string };
      let rows: SRow[] = [];
      let source: 'BATCH_INSIGHT' | 'RULE_ENGINE' = 'RULE_ENGINE';

      if (payload && payload.staff.length > 0) {
        source = 'BATCH_INSIGHT';
        rows = payload.staff.map((st) => ({
          name: st.name,
          role: st.role,
          orders: st.ordersServed,
          revenue: st.revenue,
          avgTicket: st.avgTicket,
          note: st.note || '',
        }));
      } else {
        const base = ordersIn(completedAll, win.days === 1 ? resolveWindow('MONTH', nowMs) : win);
        const map = new Map<string, SRow>();
        for (const o of base) {
          const name = o.servedByStaffName || o.cashierName || 'Tidak tercatat';
          const staffRow = s.staff.find((st) => st.name === name);
          const row = map.get(name) || { name, role: staffRow?.role || 'Kasir', orders: 0, revenue: 0, avgTicket: 0, note: '' };
          row.orders += 1;
          row.revenue += o.total || 0;
          map.set(name, row);
        }
        rows = Array.from(map.values()).map((r) => ({ ...r, avgTicket: div(r.revenue, r.orders) }));
      }

      if (rows.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Kinerja Staf',
          [
            `**Belum ada penjualan yang bisa dikaitkan ke staf**`,
            s.staff.length === 0
              ? `Belum ada staf terdaftar di sistem.`
              : `Ada ${num(s.staff.length)} staf terdaftar, tapi belum ada transaksi selesai yang mencatat siapa yang melayani.`,
            ``,
            `Langkah pertama: pastikan kasir memilih nama staf saat menutup transaksi supaya kinerjanya bisa diukur.`,
          ],
          { staff: [] },
          [Q.attendance, Q.revenue, Q.digest],
          t0
        );
      }

      // If a staff name was mentioned, spotlight that person.
      const spotlight = p.entities.staffName ? fuzzyFind(p.entities.staffName, rows, (r) => r.name) : null;
      rows.sort((a, c) => c.revenue - a.revenue || c.orders - a.orders);
      const shown = rows.slice(0, limit);
      const totalRev = rows.reduce((acc, r) => acc + r.revenue, 0);
      const best = rows[0];

      const lines: string[] = [
        spotlight ? `**Kinerja ${spotlight.name}**` : `**Kinerja staf ${win.days === 1 ? '30 hari terakhir' : win.label}**`,
        spotlight
          ? `${spotlight.role} — melayani ${num(spotlight.orders)} transaksi senilai ${rp(spotlight.revenue)}, rata-rata ${rp(spotlight.avgTicket)} per struk (${pct(div(spotlight.revenue, totalRev) * 100)} dari total tim).`
          : `Total ${rp(totalRev)} dari ${num(rows.length)} orang.`,
      ];
      shown.forEach((r, i) => {
        const note = r.note ? ` — ${r.note}` : '';
        lines.push(
          `${i + 1}. **${r.name}** (${r.role}) — ${num(r.orders)} transaksi, ${rp(r.revenue)}, rata-rata ${rp(r.avgTicket)}${note}`
        );
      });
      if (payload && payload.needsCoaching) lines.push(`- Perlu pendampingan: ${payload.needsCoaching}`);
      lines.push(``);
      lines.push(
        `Tindakan: minta **${best.name}** berbagi cara menawarkan ke rekan lain — selisih rata-rata struk antar staf biasanya soal kebiasaan menawarkan tambahan, bukan bakat.`
      );

      return answer(
        p.intent,
        source,
        'Kinerja Staf',
        lines,
        { staff: shown, spotlight, totalRevenue: totalRev, period: win.label },
        [Q.attendance, Q.peak, Q.revenue],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_ATTENDANCE': {
      const records = Array.isArray(s.attendance) ? s.attendance : [];
      const dayWin = win.days === 1 ? win : resolveWindow('TODAY', nowMs);
      const todays = records.filter((r) => {
        const t = toMs(r.clockInTime);
        return t !== null && t >= dayWin.start && t <= dayWin.end;
      });

      if (records.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Absensi',
          [
            `**Belum ada catatan absensi**`,
            `Belum ada satu pun staf yang clock in lewat sistem.`,
            ``,
            `Langkah pertama: minta tim mulai clock in dari menu Absensi setiap datang. Data ini yang nanti dipakai untuk hitung jam kerja.`,
          ],
          { records: [] },
          [Q.staff, Q.shift, Q.digest],
          t0
        );
      }

      if (todays.length === 0) {
        const lastRec = [...records].sort((a, c) => (toMs(c.clockInTime) || 0) - (toMs(a.clockInTime) || 0))[0];
        const lastMs = toMs(lastRec.clockInTime);
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Absensi ${dayWin.label}`,
          [
            `**Belum ada yang absen ${dayWin.label}**`,
            `Catatan terakhir atas nama **${lastRec.staffName}** pada ${lastMs ? `${dateLabel(lastMs)} pukul ${clockLabel(lastMs)}` : 'waktu yang tidak terbaca'}.`,
            `- Total catatan absensi tersimpan: ${num(records.length)}`,
            ``,
            `Tindakan: ingatkan tim untuk clock in lewat aplikasi begitu sampai di lokasi, supaya jam kerja tercatat rapi.`,
          ],
          { records: [], lastRecord: lastRec },
          [Q.staff, Q.shift, Q.digest],
          t0
        );
      }

      const stillIn = todays.filter((r) => r.status === 'CLOCKED_IN');
      const done = todays.filter((r) => r.status === 'CLOCKED_OUT');
      const offSite = todays.filter((r) => r.clockInGeo && r.clockInGeo.isWithinRadius === false);

      const lines: string[] = [
        `**Absensi ${dayWin.label}: ${num(todays.length)} orang tercatat**`,
        `${num(stillIn.length)} masih bekerja, ${num(done.length)} sudah pulang.`,
      ];
      for (const r of todays.slice(0, limit)) {
        const inMs = toMs(r.clockInTime);
        const outMs = toMs(r.clockOutTime);
        const dur = inMs !== null && outMs !== null ? ` (${dec(div(outMs - inMs, 3_600_000))} jam)` : '';
        const geo = r.clockInGeo && r.clockInGeo.isWithinRadius === false ? ' — absen di luar radius toko' : '';
        lines.push(
          `- **${r.staffName}** (${r.staffRole}) masuk ${inMs !== null ? clockLabel(inMs) : '-'}${outMs !== null ? `, pulang ${clockLabel(outMs)}` : ', belum pulang'}${dur}${geo}`
        );
      }
      if (offSite.length > 0) lines.push(`- Perlu dicek: ${num(offSite.length)} absen dilakukan di luar radius toko.`);
      lines.push(``);
      lines.push(
        offSite.length > 0
          ? `Tindakan: konfirmasi langsung ke ${offSite[0].staffName} soal absen di luar radius, lalu perketat pengaturan geofence bila perlu.`
          : `Tindakan: cocokkan jam masuk ini dengan jam ramai toko — kalau ramai jam ${new Date(nowMs).getHours()}:00, pastikan orangnya sudah siap sebelum itu.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        `Absensi ${dayWin.label}`,
        lines,
        { records: todays, stillIn: stillIn.length, done: done.length, offSite: offSite.length },
        [Q.staff, Q.shift, Q.peak],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    /* ---------------------------------------------------------------- */
    case 'GET_TARGET_PROGRESS': {
      const fin = findPayload(insights, 'FINANCIAL_PERFORMANCE');
      if (!fin || fin.monthlyTarget <= 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Progres Target',
          [
            `**Belum ada target omzet yang bisa dipantau**`,
            `Target bulanan belum diisi, dan riwayat penjualan belum cukup untuk menghitung target otomatis (butuh minimal satu bulan penuh).`,
            ``,
            `Dua pilihan: isi target omzet bulanan di Pengaturan, atau terus catat transaksi — setelah satu bulan penuh saya hitungkan targetnya otomatis dari rata-rata.`,
          ],
          { target: null },
          [Q.revenueMonth, Q.digest, Q.margin],
          t0
        );
      }

      const autoNote =
        fin.targetSource === 'AUTO'
          ? ` _(target otomatis dari rata-rata bulan sebelumnya, bukan angka yang Anda tetapkan)_`
          : '';
      const lines: string[] = [
        `**Progres target ${fin.monthLabel}: ${dec(fin.runRatePct, 1)}%**`,
        `Omzet berjalan ${rp(fin.mtdRevenue)} dari target ${rp(fin.monthlyTarget)}.${autoNote}`,
        `- Hari ke-${fin.dayOfMonth} dari ${fin.daysInMonth} — pace normal seharusnya ${dec(fin.expectedPct, 1)}%`,
        `- Selisih terhadap pace: **${fin.gapPct >= 0 ? '+' : ''}${dec(fin.gapPct, 1)} poin** (${fin.onTrack ? 'di depan' : 'tertinggal'})`,
        `- Proyeksi akhir bulan bila ritme ini bertahan: **${rp(fin.projectedMonthEnd)}** (${fin.projectedGapIdr >= 0 ? 'lebih' : 'kurang'} ${rp(Math.abs(fin.projectedGapIdr))} dari target)`,
        ``,
        fin.onTrack
          ? `Tindakan: ritme sudah aman. Jaga stok produk terlaris supaya tidak kehilangan penjualan di sisa bulan.`
          : `Tindakan: perlu ${rp(fin.dailyRunRateNeeded)} per hari di sisa bulan untuk mengejar target. Dorong lewat jam ramai dan paket bundling.`,
      ];

      return answer(p.intent, 'BATCH_INSIGHT', 'Progres Target', lines, fin, [Q.revenueMonth, Q.top, Q.cross], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_CALENDAR_PATTERN': {
      const cal = findPayload(insights, 'CALENDAR_BEHAVIOR');
      if (!cal) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Pola Gajian',
          [
            `**Pola musim gajian belum bisa disimpulkan**`,
            `Untuk membandingkan tanggal muda (25–3) dengan tanggal biasa (4–24), saya butuh minimal 5 transaksi di masing-masing periode dalam 30 hari terakhir.`,
            ``,
            `Tindakan: lanjutkan mencatat transaksi seperti biasa. Begitu satu siklus gajian penuh terlewati, polanya muncul otomatis di sini.`,
          ],
          { calendar: null },
          [Q.revenueMonth, Q.peak, Q.digest],
          t0
        );
      }

      const upliftPct = (cal.basketUplift - 1) * 100;
      const volPct = (cal.volumeUplift - 1) * 100;
      const lines: string[] = [
        `**Pola belanja musim gajian**`,
        `- ${cal.paydayWindowLabel}: rata-rata struk **${rp(cal.paydayAvgBasket)}** (${num(cal.paydayOrders)} transaksi, ${dec(cal.paydayOrdersPerDay, 1)}/hari)`,
        `- ${cal.normalWindowLabel}: rata-rata struk **${rp(cal.normalAvgBasket)}** (${num(cal.normalOrders)} transaksi, ${dec(cal.normalOrdersPerDay, 1)}/hari)`,
        `- Selisih nilai belanja: **${upliftPct >= 0 ? '+' : ''}${dec(upliftPct, 0)}%** | selisih jumlah transaksi: **${volPct >= 0 ? '+' : ''}${dec(volPct, 0)}%**`,
      ];
      if (cal.topPaydayProducts.length > 0) {
        lines.push(
          `- Paling laris saat gajian: ${cal.topPaydayProducts.slice(0, 3).map((x) => `**${x.name}** (${num(x.qty)})`).join(', ')}`
        );
      }
      lines.push(``);
      lines.push(`Tindakan: ${cal.hint} Musim gajian berikutnya mulai ${cal.nextPaydayWindowStart}.`);

      return answer(p.intent, 'BATCH_INSIGHT', 'Pola Gajian', lines, cal, [Q.top, Q.cross, Q.revenueMonth], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_SHIFT_PERFORMANCE': {
      const sp = findPayload(insights, 'SHIFT_PERFORMANCE');
      if (!sp || sp.cashiers.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Kinerja Shift',
          [
            `**Belum ada shift tertutup untuk dibandingkan**`,
            `Perbandingan antar kasir baru bisa dihitung dari shift yang sudah ditutup lengkap dengan hasil hitung kas fisik.`,
            ``,
            `Tindakan: biasakan tutup shift lewat menu Kasir dan isi jumlah uang laci sebenarnya. Setelah beberapa shift, selisih kas dan omzet per jam per kasir muncul di sini.`,
          ],
          { shiftPerformance: null },
          [Q.shift, Q.staff, Q.digest],
          t0
        );
      }

      const flagged = sp.cashiers.filter((c) => c.flag === 'CASH_VARIANCE');
      const lines: string[] = [
        `**Kinerja ${num(sp.cashiers.length)} kasir dari ${num(sp.shiftsAnalysed)} shift tertutup**`,
        `Omzet per jam rata-rata tim: ${rp(sp.benchmarkSalesPerHour)}.`,
      ];
      for (const c of sp.cashiers.slice(0, limit)) {
        const varLabel =
          c.meanCashVariance === 0
            ? 'kas pas'
            : `${c.meanCashVariance < 0 ? 'kurang' : 'lebih'} ${rp(Math.abs(c.meanCashVariance))}/shift`;
        lines.push(
          `- **${c.cashierName}** — ${num(c.shifts)} shift, ${rp(c.salesPerHour)}/jam, ${varLabel}${c.flag === 'TOP_PERFORMER' ? ' _(terbaik)_' : c.flag === 'CASH_VARIANCE' ? ' _(perlu dicek)_' : c.flag === 'LOW_PRODUCTIVITY' ? ' _(produktivitas rendah)_' : ''}`
        );
      }
      lines.push(``);
      lines.push(
        flagged.length > 0
          ? `Tindakan: ${flagged[0].note} ${sp.hint}`
          : `Tindakan: ${sp.hint}`
      );

      return answer(p.intent, 'BATCH_INSIGHT', 'Kinerja Shift', lines, sp, [Q.shift, Q.staff, Q.revenueMonth], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_SHIFT_STATUS': {
      const cur = s.currentShift;
      if (!cur) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Status Shift',
          [
            `**Belum ada shift yang dibuka**`,
            `Kasir belum membuka shift, jadi penjualan hari ini belum punya wadah setoran.`,
            ``,
            `Langkah pertama: buka shift di menu Kasir dan isi modal awal laci.`,
          ],
          { shift: null },
          [Q.revenue, Q.attendance, Q.digest],
          t0
        );
      }

      const startMs = toMs(cur.startTime);
      const endMs = toMs(cur.endTime);
      const hours = startMs !== null ? div((endMs ?? nowMs) - startMs, 3_600_000) : 0;
      const shiftOrders = completedAll.filter((o) => o.shiftId === cur.id);
      const shiftRevenue = revenueOf(shiftOrders);
      const expected = cur.expectedCash || (cur.initialCash || 0) + (cur.cashSales || 0);
      const diff = typeof cur.difference === 'number' ? cur.difference : cur.actualCash !== undefined ? cur.actualCash - expected : null;

      const lines: string[] = [
        `**Shift ${cur.status === 'OPEN' ? 'sedang berjalan' : 'sudah ditutup'} — ${cur.cashierName}`.concat('**'),
        `Mulai ${startMs !== null ? clockLabel(startMs) : '-'}${endMs !== null ? ` sampai ${clockLabel(endMs)}` : ' (masih buka)'}, sudah ${dec(hours)} jam.`,
        `- Penjualan shift: ${rp(cur.totalSales || shiftRevenue)} dari ${num(cur.totalOrders ?? shiftOrders.length)} transaksi`,
        `- Tunai ${rp(cur.cashSales || 0)} | QRIS ${rp(cur.qrisSales || 0)} | Kartu ${rp(cur.cardSales || 0)} | E-wallet ${rp(cur.eWalletSales || 0)}`,
        `- Modal awal ${rp(cur.initialCash || 0)}, kas yang seharusnya ada di laci: **${rp(expected)}**`,
      ];
      if (cur.actualCash !== undefined) {
        lines.push(
          `- Kas dihitung ${rp(cur.actualCash)} → selisih **${diff !== null && diff < 0 ? '-' : ''}${rp(Math.abs(diff || 0))}** ${diff === 0 ? '(pas)' : diff !== null && diff < 0 ? '(kurang)' : '(lebih)'}`
        );
      }
      lines.push(``);
      lines.push(
        diff !== null && Math.abs(diff) > 0
          ? `Tindakan: telusuri selisih ${rp(Math.abs(diff))} — biasanya dari kembalian atau transaksi yang lupa dicatat. Cek struk di jam ramai lebih dulu.`
          : cur.status === 'OPEN'
            ? `Tindakan: sebelum tutup, hitung fisik uang laci dan cocokkan dengan ${rp(expected)}.`
            : `Tindakan: shift sudah ditutup rapi. Buka shift baru sebelum transaksi berikutnya supaya setoran tidak tercampur.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        'Status Shift',
        lines,
        { shift: cur, hours, orders: shiftOrders.length, revenue: shiftRevenue, expectedCash: expected, difference: diff },
        [Q.payment, Q.revenue, Q.attendance],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PRODUCT_DETAIL': {
      const wanted = p.entities.productName || '';
      if (s.products.length === 0 && s.stockItems.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Detail Produk',
          [
            `**Katalog masih kosong**`,
            `Belum ada produk atau bahan baku terdaftar, jadi "${wanted || 'produk'}" tidak bisa dicari.`,
            ``,
            `Langkah pertama: tambahkan produk beserta harga jual, harga modal, dan stok awal di menu Inventaris.`,
          ],
          { product: null },
          [Q.digest, Q.revenue, Q.promo],
          t0
        );
      }

      const catalog: { id: string; name: string; price: number; cost: number; stock: number; unit: string; min: number; kind: 'PRODUCT' | 'STOCK_ITEM' }[] = [
        ...s.products.map((pr) => ({
          id: pr.id,
          name: pr.name,
          price: pr.price,
          cost: pr.costPrice || 0,
          stock: pr.stock,
          unit: pr.unit || 'pcs',
          min: pr.minStockAlert || 0,
          kind: 'PRODUCT' as const,
        })),
        ...s.stockItems.map((si) => ({
          id: si.id,
          name: si.name,
          price: 0,
          cost: si.costPrice || 0,
          stock: si.stock,
          unit: si.unit || 'pcs',
          min: si.minStockAlert || 0,
          kind: 'STOCK_ITEM' as const,
        })),
      ];

      const found = wanted ? fuzzyFind(wanted, catalog, (c) => c.name) : null;
      if (!found) {
        const sample = catalog.slice(0, 6).map((c) => c.name);
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Detail Produk',
          [
            `**Produk "${wanted || '(tanpa nama)'}" tidak ketemu**`,
            `Saya cek ${num(catalog.length)} item di katalog dan tidak ada yang cocok.`,
            `Beberapa yang tersedia:`,
            ...sample.map((n) => `- ${n}`),
            ``,
            `Coba tulis ulang, misalnya: "info produk ${sample[0]}".`,
          ],
          { product: null, available: catalog.map((c) => c.name) },
          [productChip(sample[0]), Q.top, Q.stock],
          t0
        );
      }

      const monthWin = resolveWindow('MONTH', nowMs);
      const sold = aggregateProducts(ordersIn(completedAll, monthWin), s.products).find(
        (r) => r.productId === found.id || r.name.toLowerCase() === found.name.toLowerCase()
      );
      const margin = found.price > 0 ? div(found.price - found.cost, found.price) * 100 : 0;
      const lastLog = (s.inventoryLogs || [])
        .filter((l) => l.productId === found.id)
        .sort((a, c) => (toMs(c.timestamp) || 0) - (toMs(a.timestamp) || 0))[0];

      const lines: string[] = [
        `**${found.name}**${found.kind === 'STOCK_ITEM' ? ' (bahan baku)' : ''}`,
        found.price > 0
          ? `Harga jual ${rp(found.price)}, modal ${rp(found.cost)} → margin ${pct(margin)} (${rp(found.price - found.cost)} per ${found.unit}).`
          : `Harga modal ${rp(found.cost)} per ${found.unit}.`,
        `- Stok sekarang: **${num(found.stock)} ${found.unit}** (batas minimum ${num(found.min)})${found.stock <= found.min ? ' — sudah di bawah batas aman' : ''}`,
        sold
          ? `- Terjual 30 hari terakhir: ${num(sold.qty)} ${found.unit} senilai ${rp(sold.revenue)}`
          : `- Belum ada penjualan tercatat dalam 30 hari terakhir`,
        lastLog
          ? `- Mutasi terakhir: ${lastLog.type} ${num(lastLog.quantity)} (${lastLog.previousStock} → ${lastLog.newStock}) oleh ${lastLog.user}`
          : `- Belum ada riwayat mutasi stok`,
        ``,
        found.stock <= found.min
          ? `Tindakan: stok ${found.name} sudah menyentuh batas. Pesan ulang minimal ${num(Math.max(1, found.min * 2 - found.stock))} ${found.unit} hari ini.`
          : sold && sold.qty > 0
            ? `Tindakan: item ini bergerak. Pastikan stok tidak turun di bawah ${num(found.min)} ${found.unit} menjelang jam ramai.`
            : `Tindakan: belum ada yang beli sebulan ini. Coba masukkan ke paket bundling atau kurangi porsi pembelian berikutnya.`,
      ];

      return answer(
        p.intent,
        'RULE_ENGINE',
        `Detail Produk: ${found.name}`,
        lines,
        { product: found, sold: sold || null, marginPct: margin, lastLog: lastLog || null },
        [Q.stock, Q.top, Q.cross],
        t0
      );
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PROMO_LIST': {
      const promos = Array.isArray(s.promoCodes) ? s.promoCodes : [];
      const active = promos.filter((pc) => pc.isActive);
      const monthWin = resolveWindow('MONTH', nowMs);
      const monthOrders = ordersIn(completedAll, monthWin);
      const discountGiven = monthOrders.reduce((acc, o) => acc + (o.discountTotal || 0), 0);
      const discountedOrders = monthOrders.filter((o) => (o.discountTotal || 0) > 0).length;

      if (promos.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Promo & Diskon',
          [
            `**Belum ada kode promo yang dibuat**`,
            `Daftar promo masih kosong.`,
            discountGiven > 0
              ? `- Tapi ada ${rp(discountGiven)} diskon manual yang diberikan kasir dalam 30 hari terakhir.`
              : `- Belum ada diskon yang diberikan dalam 30 hari terakhir.`,
            ``,
            `Langkah pertama: buat satu kode promo sederhana (misal potongan 10% dengan batas maksimal) untuk mendorong pembelian di jam sepi.`,
          ],
          { promos: [], discountGiven },
          [Q.cross, Q.peak, Q.slow],
          t0
        );
      }

      const lines: string[] = [
        `**${num(active.length)} promo aktif dari ${num(promos.length)} kode terdaftar**`,
      ];
      for (const pc of active.slice(0, limit)) {
        const minBuy = pc.minPurchaseAmount ? `, minimal belanja ${rp(pc.minPurchaseAmount)}` : '';
        lines.push(
          `- **${pc.code}** — potongan ${pct(pc.discountPercent, 0)} (maksimal ${rp(pc.maxDiscountAmount)})${minBuy}`
        );
      }
      if (active.length === 0) lines.push(`- Semua kode sedang dinonaktifkan.`);
      const inactive = promos.length - active.length;
      if (inactive > 0) lines.push(`- ${num(inactive)} kode nonaktif tersimpan sebagai arsip.`);
      lines.push(
        `- 30 hari terakhir: diskon terpakai ${rp(discountGiven)} di ${num(discountedOrders)} transaksi (${pct(div(discountedOrders, monthOrders.length) * 100)} dari semua struk).`
      );
      lines.push(``);
      lines.push(
        active.length === 0
          ? `Tindakan: aktifkan kembali satu kode promo untuk jam sepi — lebih baik diskon terkontrol daripada potongan dadakan di kasir.`
          : `Tindakan: batasi promo ke jam sepi saja. Kalau diskon sudah lewat 10% dari omset, marginnya yang kena.`
      );

      return answer(
        p.intent,
        'RULE_ENGINE',
        'Promo & Diskon',
        lines,
        { promos, active: active.length, discountGiven, discountedOrders },
        [Q.cross, Q.margin, Q.slow],
        t0
      );
    }

    default:
      return null;
  }
}

/* ========================================================================== */
/* 9. resolveIntentFromAggregates — server-side variant                       */
/* ========================================================================== */

export function resolveIntentFromAggregates(
  p: ParsedIntent,
  a: MerchantAggregates,
  insights: MerchantInsight[],
  ctx: {
    businessId?: string;
    storeName: string;
    businessSector: BusinessSector;
    slotNoun: string;
    userRole?: UserRole;
  }
): AssistantAnswer | null {
  if (!p || p.intent === 'UNKNOWN' || !a) return null;

  const t0 = Date.now();

  // Same RBAC gate as the in-app path — a direct API call must not bypass it.
  const denied = enforceRole(p.intent, ctx?.userRole, t0);
  if (denied) return denied;

  const list = Array.isArray(insights) ? insights : [];
  const limit = clamp(p.entities.limit ?? 5, 1, 20);
  const slot = ctx?.slotNoun && ctx.slotNoun.trim() ? ctx.slotNoun.trim() : 'Meja';
  const store = ctx?.storeName || 'toko Anda';
  const windowLabel = `${num(a.windowDays || 30)} hari terakhir`;
  const isToday = p.entities.period === 'TODAY' || p.entities.period === undefined;

  switch (p.intent) {
    /* ---------------------------------------------------------------- */
    case 'GET_INSIGHT_DIGEST': {
      const ranked = [...list].sort((x, y) => x.priority - y.priority).slice(0, 4);
      if (ranked.length === 0 && a.ordersAnalysed === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Ringkasan ${store}`,
          [
            `**Belum ada data yang bisa diringkas**`,
            `Belum ada transaksi selesai dalam ${windowLabel}, jadi belum ada pola yang bisa saya baca.`,
            ``,
            `Langkah pertama: catat penjualan hari ini lewat POS, walau cuma satu transaksi.`,
          ],
          { insights: [] },
          [Q.stock, Q.promo, slotChip(slot)],
          t0
        );
      }
      const lines: string[] = [
        `**Ringkasan ${store}**`,
        `Hari ini ${rp(a.revenueToday)} dari ${num(a.ordersToday)} transaksi. Dalam ${windowLabel}: ${rp(a.revenueTotal)} (${num(a.ordersAnalysed)} transaksi, rata-rata ${rp(a.avgTicket)}).`,
      ];
      if (ranked.length > 0) {
        lines.push(`**Yang perlu Anda lihat:**`);
        for (const ins of ranked) {
          const flag = ins.priority === 1 ? 'PENTING' : ins.priority === 2 ? 'Perhatian' : 'Info';
          lines.push(`- [${flag}] ${ins.title} — ${ins.summary} (${ins.metricLabel})`);
        }
      } else {
        lines.push(`- Tidak ada peringatan khusus. Margin kotor ${pct(a.grossMarginPct)}, void ${pct(a.voidRatePct)}.`);
      }
      lines.push(``);
      lines.push(
        ranked[0]
          ? `Tindakan hari ini: mulai dari "${ranked[0].title}" — itu yang paling cepat berdampak ke uang masuk.`
          : `Tindakan hari ini: cek stok menipis sebelum jam ramai supaya tidak kehilangan penjualan.`
      );
      return answer(p.intent, 'BATCH_INSIGHT', `Ringkasan ${store}`, lines, { insights: ranked, aggregates: a }, [Q.stock, Q.top, Q.revenue], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_STOCK_CRITICAL': {
      const payload = findPayload(list, 'INVENTORY_ALERT');
      if (!payload || payload.items.length === 0) {
        if (a.stockCritical > 0) {
          return answer(
            p.intent,
            'RULE_ENGINE',
            'Stok Menipis',
            [
              `**${num(a.stockCritical)} item sudah di bawah batas aman**`,
              `Detail per item belum ikut terkirim ke server, tapi jumlahnya sudah terekam.`,
              ``,
              `Tindakan: buka menu Inventaris dan urutkan berdasarkan sisa stok — ${num(a.stockCritical)} item paling atas yang perlu dibelanjakan hari ini.`,
            ],
            { count: a.stockCritical, items: [] },
            [Q.forecast, Q.top, Q.digest],
            t0
          );
        }
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Stok Menipis',
          [
            `**Stok aman, tidak ada yang kritis**`,
            `Tidak ada item yang menyentuh batas minimum saat data ini dikirim.`,
            ``,
            `Tetap cek lagi besok pagi. Anda bisa tanya "prediksi stok kapan habis" untuk lihat proyeksinya.`,
          ],
          { count: 0, items: [] },
          [Q.forecast, Q.top, Q.digest],
          t0
        );
      }
      const rows = payload.items.filter((i) => i.severity !== 'WATCH');
      const use = rows.length > 0 ? rows : payload.items;
      const shown = use.slice(0, limit);
      const outCount = use.filter((i) => i.severity === 'OUT_OF_STOCK').length;
      const lines: string[] = [
        `**${num(use.length)} item perlu segera dibelanjakan**`,
        outCount > 0
          ? `${num(outCount)} di antaranya sudah benar-benar habis — penjualannya berhenti sekarang juga.`
          : `Belum ada yang habis total, tapi semuanya sudah di bawah batas aman.`,
      ];
      for (const i of shown) {
        lines.push(
          `- **${i.name}** — sisa ${num(i.currentStock)} ${i.unit}, cukup ~${dec(i.daysOfCover)} hari lagi. Saran beli ${num(i.suggestedReorderQty)} ${i.unit}.`
        );
      }
      lines.push(``);
      lines.push(`Tindakan: susun daftar belanja untuk **${shown[0].name}** dan kawan-kawan hari ini juga.`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Stok Menipis', lines, { items: use }, [Q.forecast, Q.top, Q.digest], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_STOCK_FORECAST': {
      const payload = findPayload(list, 'INVENTORY_ALERT');
      if (!payload || payload.items.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Prediksi Stok',
          [
            `**Belum cukup data untuk memprediksi**`,
            `Belum ada riwayat pemakaian stok yang terkirim, jadi proyeksi belum bisa dibuat.`,
            ``,
            `Langkah pertama: pastikan setiap penjualan dicatat lewat POS supaya pemakaian stok ikut terekam.`,
          ],
          { items: [] },
          [Q.stock, Q.top, Q.digest],
          t0
        );
      }
      const rows = [...payload.items].sort((x, y) => x.daysOfCover - y.daysOfCover);
      const shown = rows.slice(0, limit);
      const urgent = rows.filter((i) => i.daysOfCover <= 7).length;
      const lines: string[] = [
        `**Prediksi kapan stok habis**`,
        urgent > 0
          ? `${num(urgent)} item diperkirakan habis dalam 7 hari ke depan.`
          : `Semua item masih aman lebih dari seminggu ke depan.`,
      ];
      for (const i of shown) {
        const when = i.projectedStockoutDate ? ` (sekitar ${i.projectedStockoutDate})` : '';
        const trend = i.trendFactor > 1.15 ? ', pemakaian sedang naik' : i.trendFactor < 0.85 ? ', pemakaian melambat' : '';
        lines.push(
          `- **${i.name}** — sisa ${num(i.currentStock)} ${i.unit}, terpakai ~${dec(i.avgDailyConsumption)} ${i.unit}/hari, habis dalam **${dec(i.daysOfCover)} hari**${when}${trend}.`
        );
      }
      lines.push(``);
      lines.push(`Tindakan: pesan ulang **${shown[0].name}** sekarang, jangan tunggu habis — supplier biasanya butuh 2-3 hari.`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Prediksi Stok', lines, { items: rows }, [Q.stock, Q.top, Q.digest], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_TOP_SELLING_ITEM': {
      const rows = Array.isArray(a.topProducts) ? a.topProducts : [];
      if (rows.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Produk Terlaris',
          [
            `**Belum ada penjualan dalam ${windowLabel}**`,
            `Belum ada item terjual yang bisa diurutkan.`,
            ``,
            `Langkah pertama: catat transaksi lewat POS. Setelah beberapa struk masuk, peringkat ini langsung terisi.`,
          ],
          { items: [] },
          [Q.revenueMonth, Q.slow, Q.digest],
          t0
        );
      }
      const shown = rows.slice(0, limit);
      const totalRev = rows.reduce((acc, r) => acc + r.revenue, 0);
      const totalQty = rows.reduce((acc, r) => acc + r.qty, 0);
      const lines: string[] = [
        `**Produk terlaris ${windowLabel}**`,
        `Total ${num(totalQty)} item terjual senilai ${rp(totalRev)} dari ${num(a.ordersAnalysed)} transaksi.`,
      ];
      shown.forEach((r, i) => {
        lines.push(`${i + 1}. **${r.name}** — ${num(r.qty)} terjual, ${rp(r.revenue)} (${pct(div(r.revenue, totalRev) * 100)})`);
      });
      lines.push(``);
      lines.push(
        `Tindakan: jangan pernah biarkan **${shown[0].name}** kosong dan pajang paling depan — produk ini penyumbang omset terbesar Anda.`
      );
      return answer(p.intent, 'RULE_ENGINE', 'Produk Terlaris', lines, { items: shown, totalRevenue: totalRev }, [productChip(shown[0].name), Q.cross, Q.slow], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_SLOW_MOVING': {
      const rows = Array.isArray(a.slowMovers) ? a.slowMovers : [];
      if (rows.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Produk Kurang Laku',
          [
            `**Tidak ada produk yang mandek**`,
            `Semua produk di katalog masih bergerak dalam ${windowLabel}.`,
            ``,
            `Tindakan: pertahankan komposisi menu seperti sekarang, dan cek lagi setelah menambah produk baru.`,
          ],
          { items: [] },
          [Q.top, Q.cross, Q.promo],
          t0
        );
      }
      const shown = rows.slice(0, limit);
      const zero = rows.filter((r) => r.qty === 0).length;
      const lines: string[] = [
        `**Produk paling lambat bergerak (${windowLabel})**`,
        zero > 0 ? `${num(zero)} produk sama sekali tidak terjual.` : `Semua masih terjual, ini yang paling pelan.`,
      ];
      for (const r of shown) {
        const last = r.daysSinceLastSale === null ? 'belum pernah terjual' : `terakhir laku ${num(r.daysSinceLastSale)} hari lalu`;
        lines.push(`- **${r.name}** — ${num(r.qty)} terjual, ${last}.`);
      }
      lines.push(``);
      lines.push(`Tindakan: bundling **${shown[0].name}** dengan produk terlaris, atau kurangi jumlah pembelian berikutnya.`);
      return answer(p.intent, 'RULE_ENGINE', 'Produk Kurang Laku', lines, { items: shown, zeroSaleCount: zero }, [Q.cross, Q.top, Q.promo], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_REVENUE_SUMMARY': {
      if (a.ordersAnalysed === 0 && a.ordersToday === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Omset',
          [
            `**Belum ada penjualan tercatat**`,
            `Tidak ada transaksi selesai dalam ${windowLabel}.`,
            ``,
            `Langkah pertama: buka POS dan catat transaksi pertama hari ini supaya laporan mulai terisi.`,
          ],
          { revenue: 0, orders: 0 },
          [Q.top, Q.digest, Q.promo],
          t0
        );
      }
      const days = Array.isArray(a.revenueByDay) ? a.revenueByDay : [];
      const bestDay = [...days].sort((x, y) => y.revenue - x.revenue)[0];
      const avgPerDay = div(a.revenueTotal, days.length || a.windowDays || 1);
      const lines: string[] = isToday
        ? [
            `**Omset hari ini: ${rp(a.revenueToday)}**`,
            `Dari ${num(a.ordersToday)} transaksi, rata-rata ${rp(div(a.revenueToday, a.ordersToday))} per struk.`,
            `- Rata-rata harian dalam ${windowLabel}: ${rp(avgPerDay)} — hari ini ${a.revenueToday >= avgPerDay ? 'di atas' : 'di bawah'} rata-rata.`,
          ]
        : [
            `**Omset ${windowLabel}: ${rp(a.revenueTotal)}**`,
            `Dari ${num(a.ordersAnalysed)} transaksi, rata-rata ${rp(a.avgTicket)} per struk.`,
            `- Rata-rata per hari: ${rp(avgPerDay)}. Hari ini baru ${rp(a.revenueToday)}.`,
          ];
      if (bestDay) lines.push(`- Hari terbaik: ${bestDay.date} dengan ${rp(bestDay.revenue)} (${num(bestDay.orders)} transaksi).`);
      lines.push(`- Diskon ${pct(a.discountRatePct)} dari omset, order dibatalkan ${pct(a.voidRatePct)}.`);
      lines.push(``);
      lines.push(
        a.voidRatePct > 5
          ? `Tindakan: angka void ${pct(a.voidRatePct)} tergolong tinggi. Cek alasan pembatalan di laporan — biasanya salah input menu.`
          : `Tindakan: pertahankan ritme ini dan pastikan stok produk andalan aman menjelang jam ramai.`
      );
      return answer(p.intent, 'RULE_ENGINE', 'Omset', lines, { aggregates: a, bestDay: bestDay || null }, [Q.top, Q.payment, Q.margin], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PROFIT_MARGIN': {
      if (a.ordersAnalysed === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Margin Keuntungan',
          [
            `**Belum ada penjualan untuk dihitung**`,
            `Margin butuh transaksi, dan ${windowLabel} masih kosong.`,
            ``,
            `Langkah pertama: catat transaksi lewat POS dan pastikan harga modal tiap produk sudah terisi.`,
          ],
          { marginPct: 0 },
          [Q.top, Q.revenue, Q.digest],
          t0
        );
      }
      const grossProfit = a.revenueTotal * (a.grossMarginPct / 100);
      const lines: string[] = [
        `**Margin kotor ${windowLabel}: ${pct(a.grossMarginPct)}**`,
        `Dari omset ${rp(a.revenueTotal)}, laba kotor sekitar **${rp(grossProfit)}** (modal ${rp(a.revenueTotal - grossProfit)}).`,
        `- Rata-rata per struk ${rp(a.avgTicket)}, laba kotor per struk sekitar ${rp(div(grossProfit, a.ordersAnalysed))}.`,
        `- Diskon menggerus ${pct(a.discountRatePct)} dari omset.`,
      ];
      const anomaly = findPayload(list, 'FINANCIAL_PERFORMANCE');
      const marginAnomaly = anomaly?.anomalies.find((an) => an.metric === 'GROSS_MARGIN');
      if (marginAnomaly) lines.push(`- Catatan: ${marginAnomaly.note}`);
      lines.push(``);
      lines.push(
        a.grossMarginPct < 30
          ? `Tindakan: margin di bawah 30% cukup tipis. Tinjau harga jual produk terlaris atau tekan diskon yang ${pct(a.discountRatePct)} itu.`
          : `Tindakan: dorong produk bermargin tebal lewat bundling — di situ laba Anda paling besar.`
      );
      return answer(p.intent, 'RULE_ENGINE', 'Margin Keuntungan', lines, { marginPct: a.grossMarginPct, grossProfit, revenue: a.revenueTotal }, [Q.top, Q.revenue, Q.cross], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PAYMENT_MIX': {
      const rows = Array.isArray(a.paymentMix) ? a.paymentMix : [];
      if (rows.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Metode Pembayaran',
          [
            `**Belum ada pembayaran tercatat**`,
            `Tidak ada transaksi selesai dalam ${windowLabel}.`,
            ``,
            `Langkah pertama: catat transaksi lewat POS supaya komposisi tunai vs non-tunai bisa terbaca.`,
          ],
          { mix: [] },
          [Q.revenueMonth, Q.digest, Q.top],
          t0
        );
      }
      const sorted = [...rows].sort((x, y) => y.revenue - x.revenue);
      const cash = sorted.find((r) => r.method === 'CASH');
      const lines: string[] = [`**Metode pembayaran ${windowLabel}**`, `Dari ${num(a.ordersAnalysed)} transaksi senilai ${rp(a.revenueTotal)}:`];
      for (const r of sorted) {
        lines.push(`- **${r.method}** — ${num(r.orders)} transaksi, ${rp(r.revenue)} (${pct(r.sharePct)})`);
      }
      lines.push(``);
      lines.push(
        cash && cash.sharePct > 60
          ? `Tindakan: ${pct(cash.sharePct)} masih tunai. Pasang QRIS di posisi mudah terlihat supaya antrean lebih cepat.`
          : `Tindakan: ${sorted[0].method} mendominasi (${pct(sorted[0].sharePct)}). Pastikan alatnya siap dan sinyalnya stabil di jam ramai.`
      );
      return answer(p.intent, 'RULE_ENGINE', 'Metode Pembayaran', lines, { mix: sorted, total: a.revenueTotal }, [Q.revenue, Q.peak, Q.margin], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_CROSS_SELL': {
      const payload = findPayload(list, 'CROSS_SELL_OPPORTUNITY');
      if (!payload || payload.pairs.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Peluang Bundling',
          [
            `**Belum ada pola beli bareng yang jelas**`,
            `Belum cukup struk berisi 2 item atau lebih untuk menyimpulkan pasangan produk.`,
            ``,
            `Tindakan: coba tawarkan satu paket sederhana (produk terlaris + pelengkap) selama seminggu, lalu tanya saya lagi.`,
          ],
          { pairs: [] },
          [Q.top, Q.promo, Q.slow],
          t0
        );
      }
      const shown = payload.pairs.slice(0, limit);
      const lines: string[] = [
        `**Produk yang sering dibeli bersamaan**`,
        `Dari ${num(payload.basketCount)} struk berisi lebih dari satu item:`,
      ];
      for (const pr of shown) {
        const price = pr.bundlePriceSuggestion ? ` — saran harga paket ${rp(pr.bundlePriceSuggestion)}` : '';
        lines.push(
          `- **${pr.aName}** + **${pr.bName}** — ${num(pr.coOccurrence)}x bareng, ${pct(pr.confidence * 100)} pembeli ${pr.aName} juga ambil ${pr.bName} (lift ${dec(pr.lift, 2)})${price}.`
        );
      }
      lines.push(``);
      lines.push(`Tindakan: buat paket "${shown[0].aName} + ${shown[0].bName}" dengan potongan tipis, lalu munculkan sebagai saran otomatis di kasir.`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Peluang Bundling', lines, { pairs: shown, basketCount: payload.basketCount }, [Q.promo, Q.top, Q.slow], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_CHURN_CUSTOMERS': {
      const payload = findPayload(list, 'CRM_CHURN');
      if (!payload || payload.customers.length === 0) {
        const total = a.customerCounts?.TOTAL ?? 0;
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Pelanggan Berisiko Hilang',
          [
            total === 0 ? `**Belum ada data pelanggan**` : `**Tidak ada pelanggan yang menghilang**`,
            total === 0
              ? `Database pelanggan masih kosong, jadi belum ada yang bisa dipantau.`
              : `Dari ${num(total)} pelanggan terdaftar, tidak ada yang masuk kategori berisiko.`,
            ``,
            total === 0
              ? `Langkah pertama: mulai catat nama dan nomor HP pembeli di kasir.`
              : `Tindakan: lihat "pelanggan setia teratas" untuk tahu siapa yang layak diberi apresiasi.`,
          ],
          { customers: [] },
          [Q.loyal, Q.promo, Q.digest],
          t0
        );
      }
      const rows = payload.customers.filter((c) => c.segment === 'AT_RISK' || c.segment === 'HIBERNATING' || c.segment === 'LOST');
      const use = rows.length > 0 ? rows : payload.customers;
      const shown = [...use].sort((x, y) => y.monetary - x.monetary).slice(0, limit);
      const valueAtRisk = use.reduce((acc, c) => acc + c.monetary, 0);
      const lines: string[] = [
        `**${num(use.length)} pelanggan mulai menjauh**`,
        `Total belanja mereka selama ini ${rp(valueAtRisk)} — itu nilai yang berisiko hilang.`,
      ];
      for (const c of shown) {
        lines.push(`- **${c.name}** (${c.tier}) — terakhir datang ${num(c.recencyDays)} hari lalu, total ${rp(c.monetary)}. ${c.suggestedOffer}`);
      }
      lines.push(``);
      lines.push(`Tindakan: kirim WhatsApp personal ke **${shown[0].name}** hari ini. Satu pesan jauh lebih murah daripada cari pelanggan baru.`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Pelanggan Berisiko Hilang', lines, { customers: shown, valueAtRisk }, [customerChip(shown[0].name), Q.loyal, Q.promo], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_LOYAL_CUSTOMERS': {
      const payload = findPayload(list, 'CRM_CHURN');
      const champs = payload ? payload.customers.filter((c) => c.segment === 'CHAMPION' || c.segment === 'LOYAL') : [];
      if (champs.length === 0) {
        const total = a.customerCounts?.TOTAL ?? 0;
        const tiers = (['PLATINUM', 'GOLD', 'SILVER', 'BRONZE'] as const).map((tier) => ({
          tier,
          count: a.customerCounts?.[tier] ?? 0,
        }));
        if (total === 0) {
          return answer(
            p.intent,
            'RULE_ENGINE',
            'Pelanggan Setia',
            [
              `**Belum ada pelanggan terdaftar**`,
              `Database pelanggan masih kosong.`,
              ``,
              `Langkah pertama: pilih nama pelanggan saat menutup transaksi di POS supaya riwayatnya terkumpul.`,
            ],
            { customers: [] },
            [Q.digest, Q.revenue, Q.promo],
            t0
          );
        }
        const lines: string[] = [
          `**Komposisi pelanggan: ${num(total)} orang terdaftar**`,
          `Rincian per tingkat keanggotaan:`,
          ...tiers.map((t) => `- ${t.tier}: ${num(t.count)} pelanggan`),
          ``,
          `Detail nama per pelanggan belum terkirim ke server. Tindakan: buka menu Pelanggan dan urutkan berdasarkan total belanja untuk melihat siapa yang paling berharga.`,
        ];
        return answer(p.intent, 'RULE_ENGINE', 'Pelanggan Setia', lines, { tiers, total }, [Q.churn, Q.promo, Q.digest], t0);
      }
      const shown = [...champs].sort((x, y) => y.monetary - x.monetary).slice(0, limit);
      const totalSpent = champs.reduce((acc, c) => acc + c.monetary, 0);
      const lines: string[] = [
        `**Pelanggan paling berharga**`,
        `${num(champs.length)} pelanggan masuk kategori setia, total belanja ${rp(totalSpent)}.`,
      ];
      shown.forEach((c, i) => {
        const fav = c.favouriteProduct ? `, favoritnya ${c.favouriteProduct}` : '';
        lines.push(`${i + 1}. **${c.name}** (${c.tier}) — ${num(c.frequency)} kunjungan, ${rp(c.monetary)}, rata-rata ${rp(c.avgTicket)}${fav}`);
      });
      lines.push(``);
      lines.push(`Tindakan: beri **${shown[0].name}** perlakuan khusus — sapa namanya dan siapkan menu favoritnya. Pelanggan seperti ini yang menjaga omset stabil.`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Pelanggan Setia', lines, { customers: shown, totalSpent }, [customerChip(shown[0].name), Q.churn, Q.promo], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_PEAK_HOURS': {
      const payload = findPayload(list, 'OPERATIONAL_PEAK');
      if (!payload || payload.byHour.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Jam Ramai',
          [
            `**Belum ada pola jam yang bisa dibaca**`,
            `Butuh transaksi tercatat selama beberapa hari untuk melihat kapan toko ramai.`,
            ``,
            `Langkah pertama: catat setiap transaksi lewat POS, termasuk yang kecil. Dalam seminggu polanya sudah kelihatan.`,
          ],
          { byHour: [] },
          [Q.revenue, Q.digest, Q.top],
          t0
        );
      }
      const hot = [...payload.byHour].sort((x, y) => y.orders - x.orders);
      const top1 = hot[0];
      const lines: string[] = [
        `**Kapan toko paling ramai**`,
        `Jam tersibuk: **${top1.label}** dengan ${num(top1.orders)} transaksi (${rp(top1.revenue)}).`,
      ];
      hot.slice(0, 3).forEach((h, i) => lines.push(`${i + 1}. ${h.label} — ${num(h.orders)} transaksi, ${rp(h.revenue)}`));
      if (payload.busiestDay) lines.push(`- Hari teramai: **${payload.busiestDay}**.`);
      if (payload.quietWindows.length > 0) {
        const q = payload.quietWindows[0];
        lines.push(`- Paling sepi: ${q.label} (${num(q.orders)} transaksi).`);
      }
      lines.push(``);
      lines.push(payload.staffingHint || `Tindakan: tambah satu orang di jam ${top1.label} dan siapkan stok sebelum jam itu.`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Jam Ramai', lines, { byHour: payload.byHour, byDayOfWeek: payload.byDayOfWeek, peakWindows: payload.peakWindows }, [Q.staff, Q.revenue, Q.promo], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_TABLE_STATUS': {
      const payload = findPayload(list, 'LAYOUT_UTILISATION');
      const total = payload ? payload.totalSlots : a.slotsTotal;
      const occupied = payload ? payload.occupiedNow : a.slotsOccupied;
      if (!total) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          `Status ${slot}`,
          [
            `**Belum ada ${slot.toLowerCase()} yang terdaftar**`,
            `Denah masih kosong, jadi belum ada okupansi yang bisa saya laporkan.`,
            ``,
            `Langkah pertama: buka menu Denah dan tambahkan ${slot.toLowerCase()} beserta kapasitasnya.`,
          ],
          { slotNoun: slot, slots: [] },
          [Q.digest, Q.revenue, Q.peak],
          t0
        );
      }
      const occPct = div(occupied, total) * 100;
      const lines: string[] = [
        `**Okupansi ${slot}: ${num(occupied)} dari ${num(total)} terpakai (${pct(occPct)})**`,
        `- Kosong siap pakai: ${num(Math.max(0, total - occupied))}`,
      ];
      if (payload) {
        const busiest = [...payload.slots].sort((x, y) => y.revenue - x.revenue).slice(0, 3);
        for (const sl of busiest) {
          lines.push(`- **${sl.name}** (${sl.zone}) — ${num(sl.orders)} order, ${rp(sl.revenue)}, ${rp(sl.revenuePerSeat)}/kursi`);
        }
        if (payload.deadSlots.length > 0) lines.push(`- Nyaris tak terpakai: ${payload.deadSlots.slice(0, 3).join(', ')}`);
      }
      lines.push(``);
      lines.push(
        payload?.hint ||
          (occPct >= 80
            ? `Tindakan: hampir penuh. Percepat proses bayar supaya antrean tidak menumpuk.`
            : `Tindakan: masih ada ruang kosong. Arahkan tamu ke zona yang sepi supaya pelayanan lebih merata.`)
      );
      return answer(p.intent, payload ? 'BATCH_INSIGHT' : 'RULE_ENGINE', `Status ${slot}`, lines, { slotNoun: slot, total, occupied, occupancyPct: occPct, layout: payload }, [Q.peak, Q.revenue, Q.staff], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_TARGET_PROGRESS': {
      // Aggregates carry the run-rate figures directly, so this stays free even
      // when the caller shipped no insight cards at all.
      const fin = findPayload(list, 'FINANCIAL_PERFORMANCE');
      const target = fin?.monthlyTarget ?? a.monthlyTarget;
      const source = fin?.targetSource ?? a.targetSource;
      if (!target || target <= 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Progres Target',
          [
            `**Belum ada target omzet yang bisa dipantau**`,
            `Target bulanan belum diisi dan riwayat penjualan belum cukup untuk menghitung target otomatis.`,
            ``,
            `Isi target omzet bulanan di Pengaturan, atau lanjutkan mencatat transaksi sampai satu bulan penuh.`,
          ],
          { target: null },
          [Q.revenueMonth, Q.digest, Q.margin],
          t0
        );
      }
      const runRate = fin?.runRatePct ?? a.runRatePct;
      const expected = fin?.expectedPct ?? a.expectedPct;
      const mtd = fin?.mtdRevenue ?? a.mtdRevenue;
      const onTrack = runRate >= expected;
      const autoNote = source === 'AUTO' ? ` _(target otomatis, bukan angka yang Anda tetapkan)_` : '';
      const lines: string[] = [
        `**Progres target: ${dec(runRate, 1)}%**`,
        `Omzet berjalan ${rp(mtd)} dari target ${rp(target)}.${autoNote}`,
        `- Pace normal saat ini ${dec(expected, 1)}% — posisi Anda ${onTrack ? '**di depan**' : '**tertinggal**'} ${dec(Math.abs(runRate - expected), 1)} poin.`,
      ];
      if (fin) {
        lines.push(`- Proyeksi akhir bulan: **${rp(fin.projectedMonthEnd)}**`);
        if (!fin.onTrack && fin.dailyRunRateNeeded > 0) {
          lines.push(`- Perlu ${rp(fin.dailyRunRateNeeded)}/hari untuk mengejar.`);
        }
      }
      lines.push(``);
      lines.push(
        onTrack
          ? `Tindakan: ritme aman. Jaga ketersediaan produk terlaris sampai akhir bulan.`
          : `Tindakan: dorong penjualan di jam ramai dan tawarkan paket bundling untuk menaikkan nilai per struk.`
      );
      return answer(p.intent, fin ? 'BATCH_INSIGHT' : 'RULE_ENGINE', 'Progres Target', lines, { target, runRate, expected, mtd }, [Q.revenueMonth, Q.top, Q.cross], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_CALENDAR_PATTERN': {
      const cal = findPayload(list, 'CALENDAR_BEHAVIOR');
      if (!cal) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Pola Gajian',
          [
            `**Pola musim gajian belum bisa disimpulkan**`,
            `Perbandingan tanggal muda (25–3) dengan tanggal biasa (4–24) butuh minimal 5 transaksi di masing-masing periode.`,
            ``,
            `Tindakan: lanjutkan mencatat transaksi. Setelah satu siklus gajian penuh, polanya muncul otomatis.`,
          ],
          { calendar: null },
          [Q.revenueMonth, Q.peak, Q.digest],
          t0
        );
      }
      const upliftPct = (cal.basketUplift - 1) * 100;
      const lines: string[] = [
        `**Pola belanja musim gajian**`,
        `- ${cal.paydayWindowLabel}: rata-rata struk **${rp(cal.paydayAvgBasket)}**`,
        `- ${cal.normalWindowLabel}: rata-rata struk **${rp(cal.normalAvgBasket)}**`,
        `- Selisih: **${upliftPct >= 0 ? '+' : ''}${dec(upliftPct, 0)}%**`,
      ];
      if (cal.topPaydayProducts.length > 0) {
        lines.push(`- Paling laris saat gajian: ${cal.topPaydayProducts.slice(0, 3).map((x) => `**${x.name}**`).join(', ')}`);
      }
      lines.push(``);
      lines.push(`Tindakan: ${cal.hint}`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Pola Gajian', lines, cal, [Q.top, Q.cross, Q.revenueMonth], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_SHIFT_PERFORMANCE': {
      const sp = findPayload(list, 'SHIFT_PERFORMANCE');
      if (!sp || sp.cashiers.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Kinerja Shift',
          [
            `**Belum ada shift tertutup untuk dibandingkan**`,
            `Perbandingan antar kasir dihitung dari shift yang sudah ditutup beserta hasil hitung kas fisik.`,
            ``,
            `Tindakan: biasakan tutup shift lewat menu Kasir dan isi jumlah uang laci sebenarnya.`,
          ],
          { shiftPerformance: null },
          [Q.shift, Q.staff, Q.digest],
          t0
        );
      }
      const flagged = sp.cashiers.filter((c) => c.flag === 'CASH_VARIANCE');
      const lines: string[] = [
        `**Kinerja ${num(sp.cashiers.length)} kasir dari ${num(sp.shiftsAnalysed)} shift tertutup**`,
        `Omzet per jam rata-rata tim: ${rp(sp.benchmarkSalesPerHour)}.`,
      ];
      for (const c of sp.cashiers.slice(0, limit)) {
        const varLabel =
          c.meanCashVariance === 0
            ? 'kas pas'
            : `${c.meanCashVariance < 0 ? 'kurang' : 'lebih'} ${rp(Math.abs(c.meanCashVariance))}/shift`;
        lines.push(`- **${c.cashierName}** — ${num(c.shifts)} shift, ${rp(c.salesPerHour)}/jam, ${varLabel}${c.flag === 'CASH_VARIANCE' ? ' _(perlu dicek)_' : c.flag === 'TOP_PERFORMER' ? ' _(terbaik)_' : ''}`);
      }
      lines.push(``);
      lines.push(flagged.length > 0 ? `Tindakan: ${flagged[0].note}` : `Tindakan: ${sp.hint}`);
      return answer(p.intent, 'BATCH_INSIGHT', 'Kinerja Shift', lines, sp, [Q.shift, Q.staff, Q.revenueMonth], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_STAFF_PERFORMANCE': {
      const payload = findPayload(list, 'STAFF_BEHAVIOUR');
      if (!payload || payload.staff.length === 0) {
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Kinerja Staf',
          [
            `**Belum ada data kinerja staf**`,
            `Belum ada transaksi selesai yang mencatat siapa yang melayani. Saat ini ${num(a.staffOnShift)} orang tercatat sedang bertugas.`,
            ``,
            `Langkah pertama: pastikan kasir memilih nama staf saat menutup transaksi supaya kinerjanya bisa diukur.`,
          ],
          { staff: [] },
          [Q.attendance, Q.revenue, Q.digest],
          t0
        );
      }
      const shown = [...payload.staff].sort((x, y) => y.revenue - x.revenue).slice(0, limit);
      const totalRev = payload.staff.reduce((acc, st) => acc + st.revenue, 0);
      const lines: string[] = [
        `**Kinerja staf ${windowLabel}**`,
        `Total ${rp(totalRev)} dari ${num(payload.staff.length)} orang.`,
      ];
      shown.forEach((st, i) => {
        lines.push(
          `${i + 1}. **${st.name}** (${st.role}) — ${num(st.ordersServed)} transaksi, ${rp(st.revenue)}, rata-rata ${rp(st.avgTicket)}, ${rp(st.revenuePerHour)}/jam`
        );
      });
      if (payload.needsCoaching) lines.push(`- Perlu pendampingan: ${payload.needsCoaching}`);
      lines.push(``);
      lines.push(
        `Tindakan: minta **${payload.topPerformer || shown[0].name}** berbagi cara menawarkan ke rekan lain — selisih rata-rata struk biasanya soal kebiasaan menawarkan tambahan.`
      );
      return answer(p.intent, 'BATCH_INSIGHT', 'Kinerja Staf', lines, { staff: shown, topPerformer: payload.topPerformer }, [Q.attendance, Q.peak, Q.revenue], t0);
    }

    /* ---------------------------------------------------------------- */
    case 'GET_ATTENDANCE': {
      const payload = findPayload(list, 'STAFF_BEHAVIOUR');
      if (!payload || payload.staff.length === 0) {
        // Raw attendance rows never leave the device, so the model could not
        // answer this either — returning null would bill a credit for nothing.
        return answer(
          p.intent,
          'RULE_ENGINE',
          'Perlu dibuka di aplikasi',
          [
            `**Pertanyaan ini butuh catatan absensi staf**`,
            `Data absensi tidak ikut dikirim ke server — hanya ringkasan angka yang keluar dari perangkat Anda, demi menjaga privasi staf.`,
            ``,
            `Buka halaman **Smart Assistant** di aplikasi kasir dan tanyakan hal yang sama. Jawabannya lengkap, seketika, dan tetap **tanpa memotong AI Credit**.`,
          ],
          { requiresSnapshot: true, intent: p.intent },
          [Q.staff, Q.shift, Q.digest],
          t0
        );
      }
      const rows = [...payload.staff].sort((x, y) => y.attendanceRatePct - x.attendanceRatePct);
      const late = rows.filter((st) => st.lateClockIns > 0);
      const offSite = rows.filter((st) => st.offSiteClockIns > 0);
      const lines: string[] = [
        `**Ringkasan kehadiran tim**`,
        `${num(a.staffOnShift)} orang tercatat bertugas saat ini. Data absensi ${windowLabel}:`,
      ];
      for (const st of rows.slice(0, limit)) {
        lines.push(
          `- **${st.name}** (${st.role}) — ${num(st.shiftsWorked)} shift, ${dec(st.hoursWorked)} jam, kehadiran ${pct(st.attendanceRatePct)}${st.lateClockIns > 0 ? `, telat ${num(st.lateClockIns)}x` : ''}${st.offSiteClockIns > 0 ? `, absen luar radius ${num(st.offSiteClockIns)}x` : ''}`
        );
      }
      lines.push(``);
      lines.push(
        offSite.length > 0
          ? `Tindakan: konfirmasi ke ${offSite[0].name} soal absen di luar radius toko, lalu perketat pengaturan geofence bila perlu.`
          : late.length > 0
            ? `Tindakan: bicarakan pelan-pelan dengan ${late[0].name} soal jam masuk — telat 15 menit di jam ramai berarti antrean panjang.`
            : `Tindakan: kehadiran tim rapi. Cocokkan jadwal masuk dengan jam ramai supaya tenaganya tidak terbuang di jam sepi.`
      );
      return answer(p.intent, 'BATCH_INSIGHT', 'Kehadiran Tim', lines, { staff: rows, lateCount: late.length, offSiteCount: offSite.length }, [Q.staff, Q.peak, Q.digest], t0);
    }

    /* ---------------------------------------------------------------- */
    /*
     * These genuinely need raw rows that MerchantAggregates never carries
     * (individual customers, product records, the live shift, promo codes,
     * attendance logs).
     *
     * Returning null here used to escalate them to the BILLED LLM — but the
     * model receives the very same aggregates, so it could not answer either.
     * The merchant paid one credit for a guaranteed hallucination or shrug.
     *
     * Answering deterministically at Rp 0 is both cheaper and more honest: the
     * in-app path (resolveIntent, which has the full snapshot) handles all of
     * these perfectly, so we tell the merchant exactly that.
     */
    case 'GET_CUSTOMER_DETAIL':
    case 'GET_PRODUCT_DETAIL':
    case 'GET_SHIFT_STATUS':
    case 'GET_PROMO_LIST': {
      const needs: Record<string, string> = {
        GET_CUSTOMER_DETAIL: 'riwayat pelanggan per orang',
        GET_PRODUCT_DETAIL: 'detail produk per item',
        GET_SHIFT_STATUS: 'status shift kasir yang sedang berjalan',
        GET_PROMO_LIST: 'daftar kode promo',
      };
      const what = needs[p.intent] || 'data rinci toko';
      return answer(
        p.intent,
        'RULE_ENGINE',
        'Perlu dibuka di aplikasi',
        [
          `**Pertanyaan ini butuh ${what}**`,
          `Data itu tidak ikut dikirim ke server — hanya ringkasan angka yang keluar dari perangkat Anda, demi menjaga privasi pelanggan dan staf.`,
          ``,
          `Buka halaman **Smart Assistant** langsung di aplikasi kasir dan tanyakan hal yang sama. Di sana jawabannya lengkap, seketika, dan tetap **tanpa memotong AI Credit**.`,
        ],
        { requiresSnapshot: true, intent: p.intent },
        [Q.digest, Q.revenue, Q.stock],
        t0
      );
    }

    default:
      return null;
  }
}
