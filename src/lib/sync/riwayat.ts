/**
 * RIWAYAT TRANSAKSI DARI SERVER.
 *
 * MASALAH YANG DISELESAIKAN.
 *
 * `POSContext` menyimpan order ke localStorage dan memangkasnya ke 50 terbaru.
 * Pemangkasan itu benar — batas localStorage 5 MB tidak muat sebulan penjualan,
 * dan `JSON.stringify` seluruh riwayat pada setiap transaksi akan menahan kasir
 * di depan pelanggan. Datanya juga tidak hilang: antrian sinkronisasi sudah
 * mengirimnya ke server.
 *
 * Yang belum ada adalah JALAN PULANGNYA. Layar Laporan membaca `orders` dari
 * state saja, jadi sesudah muat ulang halaman filter "Bulan Ini" menjumlahkan
 * paling banyak 50 transaksi lalu menampilkan hasilnya sebagai omzet bulan itu.
 * Tanpa tanda apa pun. Merchant membaca angka yang lebih kecil dari kenyataan
 * dan tidak punya cara mengetahuinya — kelas kesalahan yang paling buruk,
 * karena ia terlihat seperti laporan yang baik-baik saja.
 *
 * KENAPA TETAP DIGABUNG DENGAN DATA LOKAL.
 *
 * Server bukan pengganti state lokal, melainkan pelengkapnya. Transaksi yang
 * baru saja dibayar masih mengantri dan belum ada di server; kalau layar ini
 * beralih sepenuhnya ke server, penjualan lima menit terakhir justru hilang
 * dari laporan. Karena itu keduanya digabung dan `id` dipakai sebagai kunci —
 * ia sama dengan `client_txn_id` di server (lihat `orderToPayload`), jadi satu
 * transaksi tidak pernah terhitung dua kali.
 */

import type { Order, PaymentMethod, PaymentStatus, OrderType, BusinessSector } from '../../types';

export interface HasilRiwayat {
  /** Order gabungan server + lokal, terbaru lebih dulu. */
  orders: Order[];
  /** Server terjangkau dan menjawab. */
  dariServer: boolean;
  /** Server memotong hasil di batas baris — laporannya BELUM lengkap. */
  terpotong: boolean;
  /** Terisi kalau pengambilan gagal; layar wajib mengatakannya. */
  error: string | null;
}

interface BarisServer {
  id: string;
  client_txn_id: string | null;
  receipt_number: string | null;
  created_at: string;
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  service_charge_amount: string | number;
  total_amount: string | number;
  payment_method: string;
  payment_status: string;
  order_status: string;
  order_type: string | null;
  cashier_name: string | null;
  business_sector: string | null;
  items: Array<{ name: string; qty: string | number; price: string | number; total: string | number }>;
}

/** PostgreSQL NUMERIC datang sebagai string. `Number()` langsung menghasilkan NaN diam-diam. */
const angka = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Baris server -> Order aplikasi.
 *
 * Beberapa medan memang TIDAK ADA di server (meja, pelanggan, catatan, medan
 * khusus laundry) karena tidak pernah dikirim. Dibiarkan kosong, bukan diisi
 * tebakan: laporan omzet tidak membutuhkannya, dan nilai karangan akan muncul
 * di layar sebagai kalau itu data sungguhan.
 */
function keOrder(r: BarisServer): Order {
  const status: Order['status'] =
    r.order_status === 'CANCELLED' || r.payment_status === 'CANCELLED' ? 'VOID' : 'COMPLETED';

  return {
    id: r.client_txn_id || r.receipt_number || r.id,
    orderNumber: 0,
    date: new Date(r.created_at).toISOString(),
    items: (Array.isArray(r.items) ? r.items : []).map((i, idx) => ({
      id: `${r.id}-${idx}`,
      // `productId` kosong disengaja: server menyimpan NAMA produk pada baris
      // struk, bukan tautan ke katalog — supaya mengganti nama atau menghapus
      // produk tidak menulis ulang struk yang sudah tercetak.
      productId: '',
      name: String(i.name ?? ''),
      selectedModifiers: [],
      unitPrice: angka(i.price),
      quantity: angka(i.qty),
      discountPercent: 0,
      discountAmount: 0,
      totalPrice: angka(i.total),
    })),
    orderType: (r.order_type || 'DINE_IN') as OrderType,
    subtotal: angka(r.subtotal),
    discountTotal: angka(r.discount_amount),
    taxTotal: angka(r.tax_amount),
    serviceChargeTotal: angka(r.service_charge_amount),
    total: angka(r.total_amount),
    paymentMethod: (r.payment_method || 'CASH') as PaymentMethod,
    paymentStatus: (status === 'VOID' ? 'CANCELLED' : 'PAID') as PaymentStatus,
    cashierName: r.cashier_name || '—',
    shiftId: '',
    status,
    businessSector: (r.business_sector || undefined) as BusinessSector | undefined,
  };
}

/** Rentang tanggal untuk satu pilihan filter di layar Laporan. */
export function rentangUntuk(filter: 'today' | 'week' | 'month' | 'all'): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  if (filter === 'today') from.setHours(0, 0, 0, 0);
  else if (filter === 'week') from.setDate(from.getDate() - 7);
  else if (filter === 'month') from.setDate(from.getDate() - 30);
  // 'all' dibatasi 365 hari, bukan tak terbatas. Server menolak rentang di atas
  // 400 hari, dan "semua" yang gagal total lebih buruk daripada "setahun".
  else from.setDate(from.getDate() - 365);
  return { from, to };
}

/**
 * Mengambil riwayat dan menggabungkannya dengan order lokal.
 *
 * TIDAK PERNAH MELEMPAR. Layar Laporan harus tetap menampilkan data lokal
 * ketika server tidak terjangkau — aplikasi ini offline-first, dan kasir di
 * warung dengan sinyal buruk tetap berhak melihat penjualannya hari itu.
 * Kegagalannya dilaporkan lewat `error`, bukan lewat layar kosong.
 */
export async function ambilRiwayat(
  businessId: string,
  filter: 'today' | 'week' | 'month' | 'all',
  lokal: Order[]
): Promise<HasilRiwayat> {
  const { from, to } = rentangUntuk(filter);
  const dalamRentang = lokal.filter((o) => {
    const t = new Date(o.date).getTime();
    return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
  });

  try {
    const q = new URLSearchParams({
      businessId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const res = await fetch(`/api/v1/reports/orders?${q}`);
    if (!res.ok) {
      return {
        orders: dalamRentang, dariServer: false, terpotong: false,
        error: `server menjawab ${res.status}`,
      };
    }

    const body = await res.json();
    if (!body?.ok || !Array.isArray(body.orders)) {
      return { orders: dalamRentang, dariServer: false, terpotong: false, error: 'jawaban server tidak dikenali' };
    }

    const dariServer: Order[] = body.orders.map(keOrder);

    // Lokal menang untuk id yang sama: ia lebih baru, dan memuat medan yang
    // tidak pernah dikirim ke server.
    const idLokal = new Set(dalamRentang.map((o) => o.id));
    const gabungan = [...dalamRentang, ...dariServer.filter((o) => !idLokal.has(o.id))];
    gabungan.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      orders: gabungan,
      dariServer: body.synced !== false,
      terpotong: body.terpotong === true,
      error: null,
    };
  } catch {
    return { orders: dalamRentang, dariServer: false, terpotong: false, error: 'tidak tersambung' };
  }
}
