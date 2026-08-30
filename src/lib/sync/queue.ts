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
import { rupiah } from '../money';

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
  /** Staf yang mengotorisasi pembatalan, dan bukti terikat-transaksinya. */
  authorizedByRef?: string;
  authorizationProof?: string;
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
  /**
   * Revisi katalog terakhir yang diterima dari server, 0 kalau belum pernah.
   *
   * Dikirim balik sebagai `baseRevision` pada pengiriman berikutnya supaya
   * server tahu apa yang sudah dan belum dilihat perangkat ini. Selama nilai
   * ini 0, server menolak memensiunkan produk apa pun atas permintaan
   * perangkat ini — sengaja, karena perangkat yang tidak tahu isi server tidak
   * boleh menyimpulkan bahwa yang tidak ia kirim berarti sudah dihapus.
   */
  catalogRevision: number;
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

function writeQueue(businessId: string, rows: SyncPayloadTxn[]): void {
  try {
    localStorage.setItem(queueKey(businessId), JSON.stringify(rows));
  } catch (err) {
    // Kuota localStorage penuh. Tidak boleh diam — ini berarti transaksi
    // berikutnya berisiko hilang.
    console.error('[sync] gagal menulis antrian:', err);
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
      catalogRevision: Number(m.catalogRevision) || 0,
    };
  } catch {
    return {
      lastSyncedAt: null, lastError: null, lastErrorAt: null,
      failures: 0, catalogRevision: 0,
    };
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

/**
 * Mengubah Order aplikasi menjadi bentuk yang diterima server.
 *
 * SETIAP NILAI UANG DIBULATKAN DI SINI, dan itu bukan pengulangan yang sia-sia.
 * Perhitungan di aplikasi sudah bulat sejak seluruhnya lewat src/lib/money.ts,
 * tapi antrian ini juga memuat transaksi yang tersimpan di localStorage SEBELUM
 * perbaikan itu — lengkap dengan pecahan rupiahnya. Ini gerbang terakhir sebelum
 * angka masuk ke pembukuan pusat: riwayat lokal boleh berpecahan, omzet di
 * server tidak.
 */
export function orderToPayload(
  order: Order,
  cashierRole?: string,
  otorisasi?: { authorizedByRef: string; authorizationProof: string }
): SyncPayloadTxn {
  return {
    clientTxnId: order.id,
    invoiceNumber: order.id,
    cashierName: order.cashierName,
    cashierRole,
    subtotal: rupiah(order.subtotal),
    discountAmount: rupiah(order.discountTotal),
    taxAmount: rupiah(order.taxTotal),
    serviceChargeAmount: rupiah(order.serviceChargeTotal || 0),
    totalAmount: rupiah(order.total),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.status === 'VOID' ? 'CANCELLED' : 'COMPLETED',
    ...otorisasi,
    orderType: order.orderType,
    appModule: order.tableId ? 'TABLES' : 'POS',
    createdAt: order.date,
    items: order.items.map((i) => ({
      productRef: i.productId,
      productName: i.variantName ? `${i.name} (${i.variantName})` : i.name,
      unitPrice: rupiah(i.unitPrice),
      // HPP hasil snapshot saat item masuk keranjang. Keranjang lama yang
      // tersimpan sebelum kolom ini ada akan bernilai 0 — margin transaksi itu
      // akan tampak 100% di panel, dan itu memang jujur: HPP-nya tidak pernah
      // tercatat, bukan benar-benar nol.
      unitCost: rupiah(i.unitCost ?? 0),
      quantity: i.quantity,
      totalPrice: rupiah(i.totalPrice),
    })),
  };
}

export function getStatus(businessId: string, inFlight = false): SyncStatus {
  return { ...readMeta(businessId), pending: readQueue(businessId).length, inFlight };
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
 *
 * SATU HAL YANG TIDAK BOLEH DITELAN adalah nomor revisi dari server. Ia
 * dikirim balik pada pengiriman berikutnya sebagai `baseRevision`, dan dari
 * situlah server tahu produk mana yang belum pernah dilihat perangkat ini —
 * satu-satunya hal yang menghalangi tablet yang seharian offline memensiunkan
 * seluruh produk yang dibuat perangkat lain hari itu. Selama revisinya masih
 * 0, server menolak memensiunkan apa pun atas permintaan perangkat ini.
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
        sector: target.sector,
        storeName: target.storeName,
        ownerRef: target.ownerRef,
        baseRevision: readMeta(target.businessId).catalogRevision,
        products,
      }),
    });
    if (!res.ok) return false;

    const hasil = await res.json().catch(() => null);
    const revisi = Number(hasil?.revision);
    // Hanya maju, tidak pernah mundur. Jawaban yang datang tidak berurutan —
    // dua pengiriman yang saling menyusul — tidak boleh menurunkan revisi dan
    // membuat perangkat ini kembali dianggap tidak tahu apa-apa.
    if (Number.isSafeInteger(revisi) && revisi > readMeta(target.businessId).catalogRevision) {
      writeMeta(target.businessId, { catalogRevision: revisi });
    }
    if (Array.isArray(hasil?.konflik) && hasil.konflik.length) {
      // Tidak fatal, tapi juga tidak normal: perubahan perangkat ini kalah oleh
      // versi server yang lebih baru. Kalau ini sering muncul, artinya penjaga
      // revisinya terlalu ketat dan perlu ditinjau — bukan didiamkan.
      console.warn(
        `[sync] ${hasil.konflik.length} produk tidak diperbarui: versi server lebih baru`
      );
    }
    return true;
  } catch {
    return false;
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
  if (existing >= 0) q[existing] = txn;
  else q.push(txn);
  writeQueue(businessId, q);
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
    const res = await fetch('/api/v1/sync/transactions', {
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
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || 'SYNC_FAILED');

    /*
     * `ok: true` SAJA TIDAK CUKUP untuk membuang transaksi.
     *
     * Pemangkasan antrian adalah satu-satunya tempat di seluruh aplikasi yang
     * MENGHAPUS catatan penjualan. Ia hanya boleh terjadi kalau server
     * benar-benar mengakui apa yang ia terima.
     *
     * Ini bukan kehati-hatian teoretis. Permukaan serverless di
     * `api/_gateway.ts` pernah menjawab `{ ok: true, synced: true }` untuk
     * setiap `/api/v1/sync/*` tanpa menulis apa pun — dan blok itu adalah
     * jalur CADANGAN ketika gateway sungguhan tidak terjangkau. Hasilnya:
     * penjualan mulai lenyap tepat ketika backend sedang bermasalah, karena
     * baris di bawah ini menghapusnya atas dasar jawaban yang bohong.
     *
     * Permukaan itu sudah diperbaiki. Pemeriksaan ini tetap dipasang karena
     * yang salah bukan hanya satu permukaan itu, melainkan menganggap
     * `ok: true` sebagai bukti. Server yang jujur SELALU melaporkan berapa
     * yang diterima, diputar ulang, atau dilewati.
     */
    const diakui =
      Number(data.accepted ?? 0) + Number(data.voided ?? 0) + Number(data.skipped ?? 0);
    if (data.replayed !== true && diakui <= 0) {
      throw new Error('SERVER_TIDAK_MENGAKUI_TRANSAKSI');
    }

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
