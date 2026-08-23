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
