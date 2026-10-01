/**
 * Durable financial outbox. The server ledger is authoritative; these records
 * are only pending commands and must never be counted as server revenue.
 *
 * PRINSIP YANG MENENTUKAN SELURUH FILE INI
 *
 * 1. SERVER ACKNOWLEDGMENT determines whether a transaction is cloud-synced.
 *    A local write alone means pending, not successfully recorded revenue.
 *
 * 2. ANTRIAN BERTAHAN DI DISK. Disimpan di localStorage sebelum apa pun
 *    dikirim. Tab ditutup, laptop mati, browser crash — transaksinya tetap ada
 *    dan terkirim saat dibuka lagi.
 *
 * 3. TIDAK PERNAH HILANG, TIDAK PERNAH GANDA. Baris dibuang dari antrian HANYA
 *    setelah server mengonfirmasi. Kalau server sudah menyimpan tapi
 *    jawabannya tidak sampai, kiriman berikutnya akan mengulang — dan ditolak
 *    server lewat UNIQUE (tenant_id, client_txn_id). Menggandakan omzet adalah
 *    kerusakan yang tidak bisa diperbaiki dari layar mana pun; kehilangan satu
 *    struk masih bisa dimasukkan ulang manual. Jadi bias file ini selalu ke
 *    arah kirim-ulang, bukan buang.
 *
 * 4. SATU ANTRIAN PER UNIT USAHA. Kunci penyimpanan mengandung businessId
 *    (`${userId}_${sector}`). Kafe dan laundry milik pemilik yang sama punya
 *    antrian terpisah dan tidak akan pernah tertukar.
 */

import type { Order, BusinessSector } from '../../types';

const QUEUE_PREFIX = 'newhope_sync_queue_';
const META_PREFIX = 'newhope_sync_meta_';
const MIGRATION_ACK_PREFIX = 'newhope_legacy_financial_ack_';

/** Maksimum transaksi per kiriman. Server menolak di atas 500. */
const BATCH_SIZE = 200;

/** Jeda antar percobaan setelah gagal: 5d, 15d, 45d, 2m, 5m — lalu tetap 5m. */
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

export interface SyncPayloadItem {
  clientItemId?: string;
  productRef: string;
  productName: string;
  productDescription?: string;
  categoryName?: string;
  unitPrice: number;
  unitCost: number;
  quantity: number;
  totalPrice: number;
}

export interface SyncPayloadTxn {
  tenders?: Array<{clientPaymentId:string;method:string;amount:number;createdAt:string}>;
  shiftId?: string;
  clientTxnId: string;
  branchId?: string;
  invoiceNumber?: string;
  cashierRef?: string;
  cashierName?: string;
  cashierRole?: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  orderType?: string;
  appModule?: string;
  createdAt?: string;
  items: SyncPayloadItem[];
  refunds?: Array<{
    clientRefundId: string;
    occurredAt: string;
    refundMethod: 'CASH' | 'ORIGINAL_METHOD';
    reason: string;
    items: Array<{ clientItemId: string; quantity: number }>;
  }>;
  /** Local migration provenance; never sent as financial data to the API. */
  legacyMigration?: { sourceKey: string; fingerprint: string; originalBranchRef?: string };
}

export interface SyncStatus {
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Kapan kegagalan terakhir terjadi. Dipakai menghitung backoff. */
  lastErrorAt: string | null;
  /** Percobaan gagal berturut-turut. 0 berarti sehat. */
  failures: number;
  inFlight: boolean;
}

type SyncMeta = Omit<SyncStatus, 'pending' | 'inFlight'>;

export interface SyncTarget {
  businessId: string;
  outletId?: string;
  sector: BusinessSector;
  storeName: string;
  ownerRef: string;
}

const queueKey = (businessId: string) => `${QUEUE_PREFIX}${businessId}`;
const metaKey = (businessId: string) => `${META_PREFIX}${businessId}`;

function readQueue(businessId: string): SyncPayloadTxn[] {
  const raw = localStorage.getItem(queueKey(businessId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as SyncPayloadTxn[];
  } catch { /* Preserve the original bytes for manual recovery. */ }
  throw new Error('LOCAL_QUEUE_CORRUPT');
}
export const getPendingTransactions = (businessId:string):SyncPayloadTxn[] => readQueue(businessId);

function writeQueue(businessId: string, rows: SyncPayloadTxn[]): void {
  try {
    localStorage.setItem(queueKey(businessId), JSON.stringify(rows));
  } catch (err) {
    console.error('[sync] gagal menulis antrian:', err);
    throw new Error('LOCAL_QUEUE_WRITE_FAILED');
  }
}

function readMeta(businessId: string): SyncMeta {
  try {
    const raw = localStorage.getItem(metaKey(businessId));
    const m = raw ? JSON.parse(raw) : {};
    return {
      lastSyncedAt: m.lastSyncedAt ?? null,
      lastError: m.lastError ?? null,
      lastErrorAt: m.lastErrorAt ?? null,
      failures: Number(m.failures) || 0,
    };
  } catch {
    return { lastSyncedAt: null, lastError: null, lastErrorAt: null, failures: 0 };
  }
}

function writeMeta(businessId: string, m: Partial<SyncMeta>): void {
  try {
    localStorage.setItem(metaKey(businessId), JSON.stringify({ ...readMeta(businessId), ...m }));
  } catch {
    /* meta boleh hilang; antriannya yang penting */
  }
}

/** Canonical encoding also detects an update made while an older revision is in flight. */
export function financialPayloadFingerprint(txn: SyncPayloadTxn): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]));
    return value;
  };
  const { legacyMigration: _provenance, ...payload } = txn;
  return JSON.stringify(canonical(payload));
}

export function isLegacyTransactionAcknowledged(businessId: string, sourceKey: string, id: string, fingerprint: string): boolean {
  try {
    const ack = JSON.parse(localStorage.getItem(`${MIGRATION_ACK_PREFIX}${businessId}`) || '{}');
    return ack[sourceKey]?.[id] === fingerprint;
  } catch { return false; }
}

function acknowledgeLegacyTransactions(businessId: string, batch: SyncPayloadTxn[]): void {
  const migrated = batch.filter(txn => txn.legacyMigration);
  if (!migrated.length) return;
  const key = `${MIGRATION_ACK_PREFIX}${businessId}`;
  let ack: Record<string, Record<string, string>>;
  try { ack = JSON.parse(localStorage.getItem(key) || '{}'); }
  catch { throw new Error('LOCAL_MIGRATION_CHECKPOINT_CORRUPT'); }
  for (const txn of migrated) {
    const source = txn.legacyMigration!;
    ack[source.sourceKey] = { ...ack[source.sourceKey], [txn.clientTxnId]: source.fingerprint };
  }
  try { localStorage.setItem(key, JSON.stringify(ack)); }
  catch { throw new Error('LOCAL_MIGRATION_CHECKPOINT_WRITE_FAILED'); }
}

/** Call only after a successful, authenticated financial read from this business. */
export function markCloudRead(businessId: string, readAt = new Date().toISOString()): SyncStatus {
  writeMeta(businessId, { lastSyncedAt: readAt });
  return getStatus(businessId);
}

/**
 * Kunci idempotensi yang stabil untuk satu kumpulan transaksi.
 *
 * Diturunkan dari isi batch, bukan dari waktu atau angka acak: mengirim ulang
 * kumpulan yang SAMA harus menghasilkan kunci yang sama agar server mengenalinya
 * sebagai pengulangan.
 *
 * STATUS DAN TOTAL IKUT DI-HASH, bukan hanya id. Ini bukan kehati-hatian
 * berlebih — pembatalan transaksi dikirim dengan clientTxnId yang sama persis
 * dengan penjualannya. Kalau hanya id yang di-hash, batch void menghasilkan
 * kunci identik dengan batch penjualan, server menjawab "sudah pernah diterima",
 * dan pembatalannya hilang tanpa jejak: antrian kosong, tidak ada error, tapi
 * uang yang sudah dikembalikan ke pelanggan tetap terhitung sebagai omzet.
 */
async function batchKey(businessId: string, txns: SyncPayloadTxn[]): Promise<string> {
  const parts = txns
    .map(financialPayloadFingerprint)
    .sort();
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({businessId,parts})));
  return `sync:${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}

/** Mengubah Order aplikasi menjadi bentuk yang diterima server. */
export function orderToPayload(order: Order, cashierRole?: string): SyncPayloadTxn {
  // Historical clients stored net subtotal. Normalize only that known layout;
  // preserve the actual amount paid, never recalculate from today's catalogue.
  const expected = order.subtotal-order.discountTotal+order.taxTotal+(order.serviceChargeTotal||0);
  const subtotal = Math.abs(expected-order.total)>0.02 &&
    Math.abs(order.subtotal+order.taxTotal+(order.serviceChargeTotal||0)-order.total)<=0.02
    ? order.subtotal+order.discountTotal : order.subtotal;
  return {
    clientTxnId: order.id,
    branchId: order.branchId,
    invoiceNumber: order.invoiceNumber || order.id,
    cashierName: order.cashierName,
    cashierRef: order.userId,
    cashierRole,
    subtotal,
    discountAmount: order.discountTotal,
    taxAmount: order.taxTotal,
    serviceChargeAmount: order.serviceChargeTotal || 0,
    totalAmount: order.total,
    paymentMethod: order.paymentMethod,
    ...(order.paymentTenders?.length?{tenders:order.paymentTenders}:{}),
    paymentStatus: order.paymentStatus==='CANCELLED' ? 'CANCELLED' : order.refunds?.length ? 'COMPLETED' : order.status === 'VOID' ? 'CANCELLED' : order.paymentStatus === 'PENDING' ? 'PENDING' : 'COMPLETED',
    orderType: order.orderType,
    appModule: order.tableId ? 'TABLES' : 'POS',
    createdAt: order.date,
    shiftId: order.shiftId,
    items: order.items.map((i) => ({
      clientItemId: i.id,
      productRef: i.productId,
      productName: i.variantName ? `${i.name} (${i.variantName})` : i.name,
      unitPrice: i.unitPrice,
      // HPP hasil snapshot saat item masuk keranjang. Keranjang lama yang
      // tersimpan sebelum kolom ini ada akan bernilai 0 — margin transaksi itu
      // akan tampak 100% di panel, dan itu memang jujur: HPP-nya tidak pernah
      // tercatat, bukan benar-benar nol.
      unitCost: i.unitCost ?? 0,
      quantity: i.quantity,
      totalPrice: i.totalPrice,
    })),
    ...(order.refunds?.length ? { refunds: order.refunds.map(refund => ({
      clientRefundId: refund.id,
      occurredAt: refund.timestamp,
      refundMethod: refund.refundMethod,
      reason: refund.reason,
      items: refund.items.map(item => ({ clientItemId: item.cartItemId, quantity: item.quantity })),
    })) } : {}),
  };
}

export function getStatus(businessId: string, inFlight = false): SyncStatus {
  const meta = readMeta(businessId);
  try { return { ...meta, pending: readQueue(businessId).length, inFlight }; }
  catch(error) { return { ...meta, pending: 1,
    lastError:error instanceof Error && error.message==='LOCAL_QUEUE_CORRUPT'?'LOCAL_QUEUE_CORRUPT':'LOCAL_QUEUE_READ_FAILED',
    failures:Math.max(1,meta.failures), inFlight }; }
}

/**
 * Mengirim seluruh katalog satu unit usaha.
 *
 * TIDAK memakai antrian transaksi, dan itu disengaja. Katalog bersifat
 * "keadaan terkini", bukan "kejadian": kiriman terakhir selalu benar dan
 * kiriman yang gagal tidak perlu diulang — cukup ditunggu kiriman berikutnya.
 * Memasukkannya ke antrian yang sama justru berisiko menahan transaksi di
 * belakang katalog yang gagal terkirim.
 *
 * Karena itu kegagalannya ditelan diam-diam: tidak ada yang bisa hilang.
 */
export async function pushCatalog(
  target: SyncTarget,
  products: Array<{
    id: string;
    name: string;
    sku?: string;
    price: number;
    costPrice: number;
    unit?: string;
    description?: string;
    categoryName?: string;
    isAvailable?: boolean;
  }>
): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/sync/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: target.businessId,
        outletId: target.outletId,
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        products,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mengirim daftar pelanggan / CRM satu unit usaha ke database.
 *
 * Seperti pushCatalog, pelanggan bersifat "keadaan terkini", sehingga
 * dikirim langsung di luar antrian transaksi kasir tanpa memblokir kasir.
 */
export async function pushCustomers(
  target: SyncTarget,
  customers: Array<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
    totalSpent?: number;
    ordersCount?: number;
    lastVisitAt?: string;
  }>
): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/sync/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: target.businessId,
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        customers,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mengirim riwayat presensi/absensi staf ke database.
 */
export async function pushAttendance(
  target: SyncTarget,
  attendances: Array<{
    id: string;
    staffId: string;
    staffName: string;
    staffRole: string;
    clockInTime: string;
    clockOutTime?: string;
    shiftNotes?: string;
    status: string;
    branchId?: string;
    branchName?: string;
    clockInGeo?: any;
    clockOutGeo?: any;
  }>
): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/sync/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: target.businessId,
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        attendances,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mengirim slip gaji staf dari modul Smart Labor ke database.
 */
export async function pushPayroll(
  target: SyncTarget,
  payrollSlips: Array<any>
): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/sync/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: target.businessId,
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        payrollSlips,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mengambil katalog produk & kategori dari database server (Pull Sync).
 * Digunakan saat kasir pertama kali membuka aplikasi atau ganti perangkat.
 */
export async function pullCatalog(
  target: SyncTarget
): Promise<{ products: any[]; categories: any[] } | null> {
  try {
    const qs = new URLSearchParams({
      businessId: target.businessId,
      sector: target.sector,
    });
    const res = await fetch(`/api/v1/sync/catalog?${qs.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok && Array.isArray(data.products)) {
      return { products: data.products, categories: data.categories || [] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Memasukkan satu transaksi ke antrian.
 *
 * Menulis ke disk SEBELUM apa pun dikirim. Kalau proses mati tepat setelah
 * baris ini, transaksinya tetap terkirim nanti.
 */
export function enqueue(businessId: string, txn: SyncPayloadTxn): void {
  const q = readQueue(businessId);
  // Anti-ganda di sisi klien juga. Menekan "bayar" dua kali, atau void yang
  // masuk untuk transaksi yang masih mengantri, tidak boleh menghasilkan dua
  // baris — yang terakhir menang karena statusnya lebih baru.
  const existing = q.findIndex((t) => t.clientTxnId === txn.clientTxnId);
  if (existing >= 0) q[existing] = { ...txn, legacyMigration: txn.legacyMigration || q[existing].legacyMigration };
  else q.push(txn);
  writeQueue(businessId, q);
}

/** A historical snapshot must never overwrite a newer pending void or payment. */
export function enqueueLegacyTransaction(businessId: string, txn: SyncPayloadTxn): 'queued' | 'conflict' {
  const q = readQueue(businessId);
  const existing = q.findIndex(row => row.clientTxnId === txn.clientTxnId);
  if (existing >= 0 && financialPayloadFingerprint(q[existing]) !== financialPayloadFingerprint(txn)) {
    const previous = q[existing];
    const explicitOutletResolution = previous.legacyMigration?.sourceKey === txn.legacyMigration?.sourceKey &&
      previous.legacyMigration?.originalBranchRef === txn.legacyMigration?.originalBranchRef &&
      financialPayloadFingerprint({ ...previous, branchId: undefined }) === financialPayloadFingerprint({ ...txn, branchId: undefined });
    if (!explicitOutletResolution) return 'conflict';
    q[existing] = txn;
  }
  if (existing >= 0) q[existing] = { ...q[existing], legacyMigration: txn.legacyMigration };
  else q.push(txn);
  writeQueue(businessId, q);
  return 'queued';
}

let flushing = new Set<string>();

/**
 * Mengirim antrian. Aman dipanggil kapan saja dan sesering apa pun.
 *
 * Mengembalikan status terbaru. Tidak pernah melempar — pemanggilnya adalah
 * jalur transaksi kasir, dan kegagalan sinkronisasi tidak boleh menjatuhkan
 * penjualan.
 */
export async function flush(target: SyncTarget, force = false): Promise<SyncStatus> {
  const { businessId } = target;

  // Satu pengiriman per unit usaha pada satu waktu. Dua pengiriman paralel akan
  // sama-sama membaca antrian yang sama lalu saling menimpa saat memangkasnya.
  if (flushing.has(businessId)) return getStatus(businessId, true);

  let all: SyncPayloadTxn[];
  try { all = readQueue(businessId); }
  catch { return getStatus(businessId); }
  if (all.length === 0) return getStatus(businessId);

  const meta = readMeta(businessId);

  // Entitlement is a durable business decision, not a transient network error.
  // Only an explicit retry (outlet-updated event) can resume this queue.
  if (!force && meta.lastError?.startsWith('OUTLET_SETUP_REQUIRED')) return getStatus(businessId);

  // Hormati backoff. Percobaan tanpa jeda saat server sedang bermasalah hanya
  // memperparah keadaannya.
  if (!force && meta.failures > 0 && meta.lastErrorAt) {
    const wait = BACKOFF_MS[Math.min(meta.failures - 1, BACKOFF_MS.length - 1)];
    const since = Date.now() - new Date(meta.lastErrorAt).getTime();
    if (Number.isFinite(since) && since >= 0 && since < wait) return getStatus(businessId);
  }

  const ready = all.filter(txn => !txn.legacyMigration || /^[0-9a-f-]{36}$/i.test(txn.branchId || ''));
  if (!ready.length) {
    writeMeta(businessId, { lastError: 'LEGACY_OUTLET_MAPPING_REQUIRED', failures: Math.max(1, meta.failures), lastErrorAt: new Date().toISOString() });
    return getStatus(businessId);
  }
  flushing.add(businessId);
  const firstOutlet = ready[0]?.branchId || target.outletId;
  const batch = ready.filter(txn => (txn.branchId || target.outletId) === firstOutlet).slice(0, BATCH_SIZE);

  try {
    const res = await fetch('/api/v1/sync/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: await batchKey(`${businessId}:${firstOutlet || 'legacy'}`, batch),
        businessId,
        outletId: firstOutlet,
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        transactions: batch.map(({ legacyMigration: _provenance, ...txn }) => txn),
      }),
    });

    if (!res.ok) {
      const failure = await res.json().catch(() => null);
      throw new Error(failure?.error ? `${failure.error} (HTTP ${res.status})` : `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || 'SYNC_FAILED');

    // Baru sekarang aman memangkas — dan hanya baris yang benar-benar dikirim.
    // Transaksi yang masuk antrian SELAMA pengiriman berlangsung harus tetap
    // tinggal, jadi antrian dibaca ulang, bukan memakai `all` yang sudah basi.
    const current = readQueue(businessId);
    acknowledgeLegacyTransactions(businessId, batch);
    const sent = new Map(batch.map((t) => [t.clientTxnId, financialPayloadFingerprint(t)]));
    writeQueue(
      businessId,
      current.filter((t) => sent.get(t.clientTxnId) !== financialPayloadFingerprint(t))
    );

    writeMeta(businessId, {
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      lastErrorAt: null,
      failures: 0,
    });
  } catch (err) {
    // Antrian TIDAK disentuh. Ini yang membuat kegagalan jaringan tidak pernah
    // memakan transaksi.
    writeMeta(businessId, {
      lastError: (err as Error).message || 'Gagal menghubungi server',
      lastErrorAt: new Date().toISOString(),
      failures: meta.failures + 1,
    });
  } finally {
    flushing.delete(businessId);
  }

  const after = getStatus(businessId);
  // Masih ada sisa dan pengiriman barusan berhasil? Lanjutkan tanpa menunggu
  // pemicu berikutnya.
  if (after.pending > 0 && after.failures === 0) {
    return flush(target);
  }
  return after;
}
