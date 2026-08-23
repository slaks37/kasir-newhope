/**
 * Antrian sinkronisasi transaksi — offline-first.
 *
 * PRINSIP YANG MENENTUKAN SELURUH FILE INI
 *
 * 1. KASIR TIDAK PERNAH MENUNGGU. Transaksi masuk antrian dan selesai. Tidak
 *    ada pengiriman yang memblokir layar bayar; internet mati tidak boleh
 *    membuat pelanggan berdiri menunggu.
 *
 * 2. ANTRIAN BERTAHAN DI DISK. Disimpan di localStorage sebelum apa pun
 *    dikirim. Tab ditutup, laptop mati, browser crash — transaksinya tetap ada
 *    dan terkirim saat dibuka lagi.
 *
 * 3. TIDAK PERNAH HILANG, TIDAK PERNAH GANDA. Baris dibuang dari antrian HANYA
 *    setelah server mengonfirmasi. Kalau server sudah menyimpan tapi
 *    jawabannya tidak sampai, kiriman berikutnya akan mengulang — dan ditolak
 *    server lewat UNIQUE (business_id, client_txn_id). Menggandakan omzet adalah
 *    kerusakan yang tidak bisa diperbaiki dari layar mana pun; kehilangan satu
 *    struk masih bisa dimasukkan ulang manual. Jadi bias file ini selalu ke
 *    arah kirim-ulang, bukan buang.
 *
 * 4. SATU ANTRIAN PER UNIT USAHA. Kunci penyimpanan mengandung businessId
 *    (`${userId}_${sector}`). Kafe dan laundry milik pemilik yang sama punya
 *    antrian terpisah dan tidak akan pernah tertukar.
 */

import type { Order, BusinessSector, Customer, ProductBundle } from '../../types';
import { fetchToko } from './tokenToko';

const QUEUE_PREFIX = 'newhope_sync_queue_';
const META_PREFIX = 'newhope_sync_meta_';

/** Maksimum transaksi per kiriman. Server menolak di atas 500. */
const BATCH_SIZE = 200;

/** Jeda antar percobaan setelah gagal: 5d, 15d, 45d, 2m, 5m — lalu tetap 5m. */
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

export interface SyncPayloadItem {
  productRef: string;
  productName: string;
  productDescription?: string;
  categoryName?: string;
  unitPrice: number;
  unitCost: number;
  quantity: number;
  totalPrice: number;
}

/**
 * Member yang dilekatkan pada satu struk.
 *
 * Angka loyalitasnya ikut dikirim, bukan dihitung ulang server. Kasir offline
 * yang sudah menambahkan poin di layar tidak boleh melihat angkanya berubah
 * setelah sinkron — dan server tidak punya cara menghitung ulang tanpa tahu
 * `loyaltyEarnRate` toko pada saat transaksi itu terjadi.
 */
export interface SyncPayloadCustomer {
  ref: string;
  name: string;
  phone?: string;
  email?: string;
  points: number;
  tier: string;
  totalSpent: number;
  visitCount: number;
  lastVisitAt?: string;
}

export interface SyncPayloadTxn {
  clientTxnId: string;
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
  /** Tidak ada untuk pembelian tanpa member — mayoritas transaksi. */
  customer?: SyncPayloadCustomer;
  items: SyncPayloadItem[];
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
  sector: BusinessSector;
  storeName: string;
  ownerRef: string;
}

const queueKey = (businessId: string) => `${QUEUE_PREFIX}${businessId}`;
const metaKey = (businessId: string) => `${META_PREFIX}${businessId}`;

function readQueue(businessId: string): SyncPayloadTxn[] {
  try {
    const raw = localStorage.getItem(queueKey(businessId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Antrian rusak lebih buruk daripada antrian kosong: kalau JSON-nya tidak
    // bisa dibaca, tidak ada yang bisa diselamatkan dari sana.
    return [];
  }
}

/**
 * Mengembalikan false bila antrian TIDAK jadi tersimpan.
 *
 * Dulu fungsi ini void dan hanya mencetak ke console. Akibatnya, saat kuota
 * localStorage penuh, `enqueue` tampak berhasil, `pending` tetap 0, dan
 * transaksinya lenyap tanpa satu pun jalur kode yang bisa tahu — kasir melihat
 * struk tercetak dan menganggap penjualannya tercatat. Sudah dibuktikan di
 * test/antrian-sinkron.test.ts sebelum perbaikan ini.
 *
 * Antrian yang awet SAMPAI penyimpanannya penuh bukan antrian yang awet.
 */
/**
 * Penanda DI MEMORI bahwa penyimpanan menolak tulisan.
 *
 * Tidak bisa hanya mengandalkan writeMeta: kalau localStorage benar-benar
 * penuh, penanda itu sendiri gagal ditulis, dan peringatannya ikut hilang
 * bersama transaksinya. Penanda di memori bertahan selama tab terbuka — cukup
 * lama untuk sampai ke layar kasir, yang memang satu-satunya tujuannya.
 */
const penyimpananPenuh = new Set<string>();

function writeQueue(businessId: string, rows: SyncPayloadTxn[]): boolean {
  try {
    localStorage.setItem(queueKey(businessId), JSON.stringify(rows));
    penyimpananPenuh.delete(businessId);
    return true;
  } catch (err) {
    console.error('[sync] gagal menulis antrian:', err);
    penyimpananPenuh.add(businessId);
    // Dicoba juga ke penyimpanan supaya peringatannya bertahan setelah tab
    // dibuka ulang. Boleh gagal — penanda di memori sudah menahannya.
    writeMeta(businessId, {
      lastError: PENYIMPANAN_PENUH,
      lastErrorAt: new Date().toISOString(),
    });
    return false;
  }
}

/** Kode galat yang dikenali Header untuk menampilkan peringatan khusus. */
export const PENYIMPANAN_PENUH = 'PENYIMPANAN_PENUH';

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
function batchKey(businessId: string, txns: SyncPayloadTxn[]): string {
  const parts = txns
    .map((t) => `${t.clientTxnId}|${t.paymentStatus}|${t.totalAmount}`)
    .sort();
  // FNV-1a 32-bit. Cukup untuk membedakan batch; bukan fungsi kriptografis dan
  // tidak dipakai untuk keamanan apa pun.
  let h = 0x811c9dc5;
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return `${businessId}:${parts.length}:${h.toString(16)}`;
}

/** Mengubah Order aplikasi menjadi bentuk yang diterima server. */
export function orderToPayload(order: Order, cashierRole?: string): SyncPayloadTxn {
  const dibatalkan = order.status === 'VOID';

  return {
    clientTxnId: order.id,
    invoiceNumber: order.id,
    cashierName: order.cashierName,
    cashierRole,
    subtotal: order.subtotal,
    discountAmount: order.discountTotal,
    taxAmount: order.taxTotal,
    serviceChargeAmount: order.serviceChargeTotal || 0,
    totalAmount: order.total,
    paymentMethod: order.paymentMethod,
    paymentStatus: dibatalkan ? 'CANCELLED' : 'COMPLETED',
    orderType: order.orderType,
    appModule: order.tableId ? 'TABLES' : 'POS',
    createdAt: order.date,
    // TIDAK dikirim pada pembatalan. `order.customer` adalah potret member
    // SEBELUM struk ini dibayar, dan pembatalan selalu menyusul belakangan —
    // mengirimnya berarti menimpa poin terkini di server dengan angka lama.
    // Pembatalan hanya perlu mengubah status transaksinya.
    customer:
      order.customer && !dibatalkan
        ? {
            ref: order.customer.id,
            name: order.customer.name,
            phone: order.customer.phone,
            email: order.customer.email,
            points: order.customer.points,
            tier: order.customer.tier,
            totalSpent: order.customer.totalSpent,
            visitCount: order.customer.visitCount,
            lastVisitAt: order.customer.lastVisit,
          }
        : undefined,
    items: order.items.map((i) => ({
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
  };
}

export function getStatus(businessId: string, inFlight = false): SyncStatus {
  const meta = readMeta(businessId);
  // Penanda di memori menang atas apa pun yang terbaca dari penyimpanan:
  // kalau penyimpanan sedang menolak tulisan, isinya sudah pasti basi.
  if (penyimpananPenuh.has(businessId)) meta.lastError = PENYIMPANAN_PENUH;
  return { ...meta, pending: readQueue(businessId).length, inFlight };
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
export interface CatalogPayload {
  products: Array<{
    id: string;
    name: string;
    sku?: string;
    price: number;
    costPrice: number;
    stock: number;
    minStockAlert: number;
    unit?: string;
    description?: string;
    categoryName?: string;
    isAvailable?: boolean;
  }>;
  /**
   * Member toko, TERMASUK yang belum pernah bertransaksi.
   *
   * Baris pelanggan dulu hanya lahir dari pembelian pertama, jadi member yang
   * sudah didaftarkan tapi belum belanja tidak pernah sampai ke server — dan
   * justru merekalah yang paling ingin dihubungi merchant.
   */
  customers?: Customer[];
  /** Paket bundling promo beserta isinya. */
  bundles?: ProductBundle[];
}

export async function pushCatalog(
  target: SyncTarget,
  payload: CatalogPayload
): Promise<boolean> {
  try {
    const res = await fetchToko('/api/v1/sync/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: target.businessId,
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        products: payload.products,
        customers: payload.customers ?? [],
        bundles: payload.bundles ?? [],
      }),
    }, { businessId: target.businessId, ownerRef: target.ownerRef, storeName: target.storeName, sector: target.sector });
    return res.ok;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* SINKRONISASI CABANG                                                         */
/* -------------------------------------------------------------------------- */

export interface BranchPayload {
  id: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  allowedRadiusMeters?: number;
  businessSector?: string;
  isActive?: boolean;
  notes?: string;
}

export interface HasilSinkronCabang {
  ok: boolean;
  /** Cabang yang server tolak karena batas paket, berikut alasannya. */
  ditolak: Array<{ ref: string; nama: string; alasan: string }>;
  maxOutlets: number;
  activeOutlets: number;
}

/**
 * Mengirim seluruh daftar cabang, bukan yang berubah saja.
 *
 * Servernya yang memutuskan mana yang muat dalam batas paket, karena hanya
 * server yang tahu berapa cabang yang sudah tersimpan dari perangkat LAIN.
 * Perangkat kedua yang menghitung dari salinan localStorage-nya sendiri selalu
 * menghitung terlalu sedikit.
 *
 * Yang ditolak dikembalikan berikut alasannya supaya layar Pengaturan bisa
 * menyampaikannya apa adanya — penolakan yang tidak terlihat hanya menghasilkan
 * cabang yang "tersimpan" di satu perangkat dan tidak ada di mana pun lagi.
 */
export async function pushBranches(
  target: SyncTarget,
  branches: BranchPayload[],
  activeBranchRef?: string
): Promise<HasilSinkronCabang> {
  const kosong: HasilSinkronCabang = { ok: false, ditolak: [], maxOutlets: 0, activeOutlets: 0 };
  try {
    const res = await fetchToko('/api/v1/sync/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: target.businessId,
        branches,
        activeBranchRef,
      }),
    }, { businessId: target.businessId, ownerRef: target.ownerRef, storeName: target.storeName, sector: target.sector });
    if (!res.ok) return kosong;

    const d = await res.json();
    return {
      ok: Boolean(d?.ok),
      ditolak: Array.isArray(d?.rejected) ? d.rejected : [],
      maxOutlets: Number(d?.maxOutlets ?? 0),
      activeOutlets: Number(d?.activeOutlets ?? 0),
    };
  } catch {
    // Gagal jaringan bukan penolakan paket. Layar Pengaturan tidak boleh
    // menuduh merchant melewati batas hanya karena internetnya putus.
    return kosong;
  }
}

/**
 * Memasukkan satu transaksi ke antrian.
 *
 * Menulis ke disk SEBELUM apa pun dikirim. Kalau proses mati tepat setelah
 * baris ini, transaksinya tetap terkirim nanti.
 */
/**
 * Mengembalikan true bila transaksi benar-benar tersimpan di penyimpanan yang
 * bertahan setelah tab ditutup. False berarti ia TIDAK akan pernah terkirim,
 * dan pemanggilnya wajib memberi tahu kasir.
 */
export function enqueue(businessId: string, txn: SyncPayloadTxn): boolean {
  const q = readQueue(businessId);
  // Anti-ganda di sisi klien juga. Menekan "bayar" dua kali, atau void yang
  // masuk untuk transaksi yang masih mengantri, tidak boleh menghasilkan dua
  // baris — yang terakhir menang karena statusnya lebih baru.
  const existing = q.findIndex((t) => t.clientTxnId === txn.clientTxnId);
  if (existing >= 0) q[existing] = txn;
  else q.push(txn);
  return writeQueue(businessId, q);
}

let flushing = new Set<string>();

/**
 * Mengirim antrian. Aman dipanggil kapan saja dan sesering apa pun.
 *
 * Mengembalikan status terbaru. Tidak pernah melempar — pemanggilnya adalah
 * jalur transaksi kasir, dan kegagalan sinkronisasi tidak boleh menjatuhkan
 * penjualan.
 */
export async function flush(target: SyncTarget): Promise<SyncStatus> {
  const { businessId } = target;

  // Satu pengiriman per unit usaha pada satu waktu. Dua pengiriman paralel akan
  // sama-sama membaca antrian yang sama lalu saling menimpa saat memangkasnya.
  if (flushing.has(businessId)) return getStatus(businessId, true);

  const all = readQueue(businessId);
  if (all.length === 0) return getStatus(businessId);

  const meta = readMeta(businessId);

  // Hormati backoff. Percobaan tanpa jeda saat server sedang bermasalah hanya
  // memperparah keadaannya.
  if (meta.failures > 0 && meta.lastErrorAt) {
    const wait = BACKOFF_MS[Math.min(meta.failures - 1, BACKOFF_MS.length - 1)];
    const since = Date.now() - new Date(meta.lastErrorAt).getTime();
    if (Number.isFinite(since) && since >= 0 && since < wait) return getStatus(businessId);
  }

  flushing.add(businessId);
  const batch = all.slice(0, BATCH_SIZE);

  try {
    const res = await fetchToko('/api/v1/sync/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: batchKey(businessId, batch),
        businessId,
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        transactions: batch,
      }),
    }, { businessId, ownerRef: target.ownerRef, storeName: target.storeName, sector: target.sector });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || 'SYNC_FAILED');

    // Baru sekarang aman memangkas — dan hanya baris yang benar-benar dikirim.
    // Transaksi yang masuk antrian SELAMA pengiriman berlangsung harus tetap
    // tinggal, jadi antrian dibaca ulang, bukan memakai `all` yang sudah basi.
    const current = readQueue(businessId);
    const sent = new Set(batch.map((t) => t.clientTxnId));
    writeQueue(
      businessId,
      current.filter((t) => !sent.has(t.clientTxnId))
    );

    writeMeta(businessId, {
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
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
