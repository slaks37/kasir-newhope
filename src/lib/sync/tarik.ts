/**
 * Mengambil isi toko dari cloud, lalu memasangnya ke perangkat ini.
 *
 * KENAPA ADA. Sinkronisasi selama ini satu arah — aplikasi mengirim, tidak
 * pernah mengambil. Semua yang terlihat di layar sebenarnya hanya ada di
 * penyimpanan perangkat itu sendiri, dan pemilik yang membuka aplikasi di
 * perangkat lain menemukan tokonya kosong padahal datanya utuh di server.
 *
 * KAPAN DIPANGGIL. Sekali setiap kali aplikasi menyala dengan pengguna yang
 * sudah masuk. Bukan berkala: katalog jarang berubah, dan menariknya
 * terus-menerus hanya menghabiskan kuota kasir tanpa menambah apa pun.
 *
 * ATURAN PENGGABUNGAN — dan ini bagian yang menentukan:
 *
 *   KATALOG, PELANGGAN, CABANG  cloud yang menang. Ketiganya memang dikirim
 *                               utuh oleh perangkat mana pun yang menyuntingnya,
 *                               jadi salinan server selalu yang paling akhir.
 *
 *   ANTRIAN TRANSAKSI           TIDAK PERNAH DISENTUH. Struk yang belum
 *                               terkirim adalah satu-satunya data yang hanya
 *                               ada di perangkat ini; menimpanya berarti
 *                               kehilangan penjualan yang sudah terjadi.
 *
 * Itu sebabnya penarikan ini aman dijalankan kapan saja: yang berisiko hilang
 * justru yang paling dilindungi.
 */

import { fetchToko, type IdentitasToko } from './tokenToko';

export interface IsiToko {
  business: {
    businessId: string;
    storeName: string;
    sector: string;
    clientKey: string;
    ownerRef: string;
    activeOutletId: string | null;
  };
  products: any[];
  customers: any[];
  branches: any[];
  bundles: any[];
  transactions: any[];
  transactionsTruncated: boolean;
  /* Ditambahkan bersama migrasi 0036. Lihat keMeja/keBahan/... di bawah. */
  tables: any[];
  stockItems: any[];
  promoCodes: any[];
  shifts: any[];
  attendance: any[];
  /**
   * `null` bila toko ini belum pernah mengirim pengaturannya.
   *
   * Dibedakan dari objek kosong dengan sengaja: perangkat yang menerima objek
   * kosong lalu memasangnya akan menimpa tarif pajak dan tarif loyalitas yang
   * sedang berlaku di layarnya dengan nol.
   */
  settings: any | null;
  ditarikPada: string;
}

export type HasilTarik =
  | { ok: true; isi: IsiToko }
  | { ok: false; sebab: 'OFFLINE' | 'DITOLAK' | 'GAGAL' };

/** Penanda kapan terakhir berhasil menarik, per toko. */
const KUNCI_TERAKHIR = 'newhope_tarik_terakhir_';

export function tarikTerakhir(businessId: string): string | null {
  try { return localStorage.getItem(KUNCI_TERAKHIR + businessId); } catch { return null; }
}

function catatTarik(businessId: string): void {
  try { localStorage.setItem(KUNCI_TERAKHIR + businessId, new Date().toISOString()); }
  catch { /* penyimpanan penuh: penarikan berikutnya tetap jalan */ }
}

export async function tarikDariCloud(id: IdentitasToko): Promise<HasilTarik> {
  try {
    const res = await fetchToko(
      `/api/v1/sync/pull?businessId=${encodeURIComponent(id.businessId)}`,
      { method: 'GET' },
      id
    );

    // 401/403 bukan kegagalan jaringan: tokennya memang tidak berlaku untuk
    // toko ini. Dibedakan supaya pemanggil tidak mencoba lagi selamanya.
    if (res.status === 401 || res.status === 403) return { ok: false, sebab: 'DITOLAK' };
    if (!res.ok) return { ok: false, sebab: 'GAGAL' };

    const data = await res.json();
    if (!data?.ok) return { ok: false, sebab: 'GAGAL' };

    catatTarik(id.businessId);
    return { ok: true, isi: data as IsiToko };
  } catch {
    // Tidak ada jaringan. Bukan galat yang perlu ditampilkan — aplikasi kasir
    // memang dirancang untuk tetap bekerja tanpa internet.
    return { ok: false, sebab: 'OFFLINE' };
  }
}

/* -------------------------------------------------------------------------- */
/* Penerjemahan bentuk server -> bentuk aplikasi                              */
/* -------------------------------------------------------------------------- */

export function keProduk(baris: any[], sector: string): any[] {
  return baris.map((r) => ({
    id: r.product_id,
    name: r.product_name,
    sku: r.sku ?? '',
    price: Number(r.price) || 0,
    costPrice: Number(r.cost_price) || 0,
    category: r.category_name ?? 'Lainnya',
    description: r.description ?? '',
    stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
    minStockAlert: r.min_stock_alert === null ? null : Number(r.min_stock_alert),
    isAvailable: r.is_available !== false,
    sector,
    businessSector: sector,
  }));
}

export function keKategori(baris: any[], sector: string): any[] {
  const nama = Array.from(
    new Set(baris.map((r) => r.category_name).filter(Boolean))
  ) as string[];
  return nama.map((n) => ({
    id: `cat-${n.toLowerCase().replace(/\s+/g, '-')}`,
    name: n,
    // Ikon dan warna tidak disimpan di server: keduanya urusan tampilan, dan
    // menaruhnya di basis data berarti mengubah tema menuntut migrasi.
    icon: 'Package',
    color: 'slate',
    sector,
    businessSector: sector,
  }));
}

export function kePelanggan(baris: any[], sector: string): any[] {
  return baris.map((r) => ({
    id: r.id,
    externalRef: r.external_ref ?? r.id,
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    points: Number(r.points) || 0,
    totalSpent: Number(r.total_spent) || 0,
    visitCount: Number(r.visit_count) || 0,
    tier: r.tier ?? 'BRONZE',
    lastVisitAt: r.last_visit_at ?? null,
    sector,
    businessSector: sector,
  }));
}

export function keCabang(baris: any[], sector: string): any[] {
  return baris.map((r) => ({
    id: r.branch_id,
    externalRef: r.external_ref ?? r.branch_id,
    name: r.name,
    address: r.address ?? '',
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    allowedRadiusMeters: Number(r.allowed_radius_meters) || 200,
    isActive: r.is_active !== false,
    isCurrent: r.sedang_dipakai === true,
    sector,
    businessSector: sector,
  }));
}

/*
 * MEJA. Status dan pesanan yang sedang berjalan TIDAK ikut ditarik — server
 * memang tidak menyimpannya (lihat migrations/0036). Yang datang dari cloud
 * adalah denahnya; status meja tetap milik perangkat yang sedang melayaninya,
 * dan menimpanya dari server berarti meja yang sedang terisi tiba-tiba tampak
 * kosong di tengah jam makan siang.
 */
export function keMeja(baris: any[], sector: string): any[] {
  return baris.map((r) => ({
    id: r.external_ref,
    name: r.name,
    capacity: Number(r.capacity) || 4,
    zone: r.zone ?? 'Utama',
    status: 'AVAILABLE',
    sector,
    businessSector: r.business_sector ?? sector,
  }));
}

export function keBahan(baris: any[], sector: string): any[] {
  return baris.map((r) => ({
    id: r.external_ref,
    name: r.name,
    sku: r.sku ?? '',
    type: r.stock_type ?? 'BAHAN_BAKU',
    categoryId: '',
    categoryName: r.category_name ?? 'Lainnya',
    stock: Number(r.current_stock) || 0,
    minStockAlert: Number(r.min_stock_alert) || 0,
    unit: r.unit ?? 'pcs',
    costPrice: Number(r.cost_price) || 0,
    location: r.location ?? '',
    notes: r.notes ?? '',
    lastUpdated: r.updated_at ?? undefined,
    businessSector: r.business_sector ?? sector,
  }));
}

export function keKodePromo(baris: any[]): any[] {
  return baris.map((r) => ({
    code: r.code,
    discountPercent: Number(r.discount_percent) || 0,
    maxDiscountAmount: Number(r.max_discount_amount) || 0,
    minPurchaseAmount: Number(r.min_purchase_amount) || 0,
    isActive: r.is_active !== false,
    createdAt: r.created_at ?? new Date().toISOString(),
  }));
}

export function keShift(baris: any[], sector: string): any[] {
  return baris.map((r) => ({
    id: r.external_ref,
    cashierName: r.cashier_name,
    startTime: r.opened_at,
    endTime: r.closed_at ?? undefined,
    status: r.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    initialCash: Number(r.initial_cash) || 0,
    cashSales: Number(r.cash_sales) || 0,
    qrisSales: Number(r.qris_sales) || 0,
    cardSales: Number(r.card_sales) || 0,
    eWalletSales: Number(r.ewallet_sales) || 0,
    totalSales: Number(r.total_sales) || 0,
    expectedCash: Number(r.expected_cash) || 0,
    // null dipertahankan sebagai undefined, TIDAK dijadikan nol. "Kas belum
    // dihitung" dan "kas dihitung dan hasilnya nol" adalah dua keadaan yang
    // sangat berbeda bagi orang yang tanda tangan di lembar serah terima.
    actualCash: r.actual_cash === null || r.actual_cash === undefined
      ? undefined : Number(r.actual_cash),
    difference: r.difference === null || r.difference === undefined
      ? undefined : Number(r.difference),
    totalOrders: Number(r.total_orders) || 0,
    notes: r.notes ?? undefined,
    businessSector: r.business_sector ?? sector,
  }));
}

/**
 * ABSENSI.
 *
 * `radiusCabang` memetakan id cabang ke radius yang BERLAKU SEKARANG. Server
 * sengaja tidak menyimpan kesimpulan "di dalam radius", hanya jaraknya —
 * karena radius cabang bisa diubah pemilik kapan saja, dan kesimpulan yang
 * sudah tersimpan akan menjadi salah tanpa ada yang menyadarinya. Jadi
 * kesimpulannya dihitung di sini, dari jarak yang tercatat saat itu terhadap
 * radius yang berlaku saat dibaca.
 *
 * Tanpa peta radius, atau untuk cabang yang tidak dikenali, `isWithinRadius`
 * dibiarkan `true`. Menuduh staf keluar radius berdasarkan angka yang tidak
 * kita punya pembandingnya lebih buruk daripada tidak menuduh sama sekali.
 */
export function keAbsensi(
  baris: any[],
  sector: string,
  radiusCabang?: Map<string, number>
): any[] {
  const geo = (lat: any, lon: any, jarak: any, cabangRef: any) => {
    if (lat === null || lat === undefined) return undefined;
    const m = jarak === null || jarak === undefined ? undefined : Number(jarak);
    const radius = cabangRef ? radiusCabang?.get(String(cabangRef)) : undefined;
    return {
      latitude: Number(lat),
      longitude: Number(lon),
      distanceFromBranchMeters: m,
      isWithinRadius: m === undefined || radius === undefined ? true : m <= radius,
    };
  };
  return baris.map((r) => ({
    id: r.external_ref,
    staffId: r.staff_ref ?? '',
    staffName: r.staff_name,
    staffRole: r.staff_role ?? '',
    clockInTime: r.clock_in_at,
    clockOutTime: r.clock_out_at ?? undefined,
    status: r.status === 'CLOCKED_OUT' ? 'CLOCKED_OUT' : 'CLOCKED_IN',
    branchId: r.outlet_ref ?? undefined,
    branchName: r.outlet_name ?? undefined,
    clockInGeo: geo(r.clock_in_lat, r.clock_in_lon, r.clock_in_distance_m, r.outlet_ref),
    clockOutGeo: geo(r.clock_out_lat, r.clock_out_lon, r.clock_out_distance_m, r.outlet_ref),
    shiftNotes: r.shift_notes ?? undefined,
    businessSector: r.business_sector ?? sector,
  }));
}

/**
 * PENGATURAN. Digabung ke pengaturan yang sedang berlaku, tidak menggantikannya.
 *
 * `extra` dituang lebih dulu, lalu kolom-kolomnya menimpa di atasnya: kolom
 * adalah bentuk yang dipahami server dan selalu yang paling benar, sementara
 * `extra` bisa memuat salinan lama dari kunci yang sama yang ikut terkirim
 * sebelum kolomnya ada.
 *
 * `branches`, `activeBranchId`, dan `subscription` TIDAK PERNAH datang dari
 * sini — server menolak menyimpannya (lihat EXTRA_DILARANG). Cabang punya
 * jalur sinkronnya sendiri, dan status langganan ditentukan billing.
 */
export function kePengaturan(r: any, sekarang: any): any {
  if (!r) return sekarang;
  const extra = r.extra && typeof r.extra === 'object' ? r.extra : {};
  const { branches: _b, activeBranchId: _a, subscription: _s, ...extraBersih } = extra as any;

  const angkaAtau = (v: any, bawaan: number) =>
    v === null || v === undefined ? bawaan : Number(v);

  return {
    ...sekarang,
    ...extraBersih,
    storeName: r.store_name ?? sekarang.storeName,
    tagline: r.tagline ?? sekarang.tagline,
    address: r.address ?? sekarang.address,
    phone: r.phone ?? sekarang.phone,
    taxRate: angkaAtau(r.tax_rate, sekarang.taxRate),
    enableTax: Boolean(r.enable_tax),
    serviceRate: angkaAtau(r.service_rate, sekarang.serviceRate),
    enableService: Boolean(r.enable_service),
    enableLoyalty: Boolean(r.enable_loyalty),
    loyaltyEarnRate: angkaAtau(r.loyalty_earn_rate, sekarang.loyaltyEarnRate),
    loyaltyRedeemRate: angkaAtau(r.loyalty_redeem_rate, sekarang.loyaltyRedeemRate),
    monthlyRevenueTarget: r.monthly_revenue_target === null || r.monthly_revenue_target === undefined
      ? sekarang.monthlyRevenueTarget : Number(r.monthly_revenue_target),
    geofenceEnforcement: r.geofence_enforcement ?? sekarang.geofenceEnforcement,
    // Dipertahankan apa adanya dari perangkat: keduanya punya jalur sendiri.
    branches: sekarang.branches,
    activeBranchId: sekarang.activeBranchId,
    subscription: sekarang.subscription,
  };
}
