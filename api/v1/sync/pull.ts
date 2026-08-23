/**
 * MENGAMBIL isi toko dari cloud.
 *
 * LUBANG YANG DITUTUP BERKAS INI.
 *
 * Sinkronisasi selama ini SATU ARAH. Aplikasi kasir mengirim katalog, cabang,
 * dan transaksi ke server — tetapi tidak pernah mengambil apa pun kembali.
 * Akibatnya, semua yang tampak di layar sebenarnya hanya ada di penyimpanan
 * perangkat itu sendiri:
 *
 *   - Pemilik membuka aplikasi di ponsel setelah menyiapkan katalog di laptop:
 *     tokonya kosong.
 *   - Kasir kedua di toko yang sama: katalognya sendiri, terpisah.
 *   - Riwayat peramban dibersihkan: seluruh katalog hilang dari pandangan
 *     pemiliknya, padahal datanya masih utuh di server.
 *
 * Server sudah memegang semuanya. Yang tidak ada hanyalah pintu untuk
 * mengambilnya.
 *
 * DIBACA DARI PERMUKAAN KONTRAK, bukan dari tabelnya langsung — sama seperti
 * panel admin. Bentuk tabel boleh berubah tanpa menyeret endpoint ini ikut
 * rusak.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { sslUntuk } from '../../../src/server/sslDb.js';
import { wajibToko } from '../../_lib/tokoContext.js';

/** Transaksi yang ikut ditarik. Cukup untuk laporan, tidak sampai membanjiri. */
const BATAS_TRANSAKSI = 500;

/**
 * Shift dan absensi yang ikut ditarik.
 *
 * Jauh lebih kecil daripada transaksi dan disengaja. Keduanya dibaca untuk
 * rekap, bukan untuk dijalankan ulang di perangkat; menarik absensi setahun ke
 * ponsel kasir hanya memperlambat pembukaan aplikasi tanpa menambah satu pun
 * yang bisa ia lakukan dengannya.
 */
const BATAS_RIWAYAT = 200;

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    pool = new pg.Pool({
      connectionString: url,
      ssl: sslUntuk(url),
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const diminta = String(
    req.query?.businessId ?? req.body?.businessId ?? ''
  ).trim();

  const toko = await wajibToko(req, res, diminta);
  if (!toko) return;

  const db = getPool();
  const id = toko.businessId;

  try {
    const [
      usaha, katalog, pelanggan, cabang, bundel, transaksi,
      meja, bahan, promo, shift, absensi, pengaturan,
    ] = await Promise.all([
      db.query(
        `SELECT b.id, b.name, b.business_sector, b.client_key, b.owner_user_ref,
                b.active_outlet_id
           FROM pos.businesses b WHERE b.id = $1`, [id]),

      db.query(
        `SELECT product_id, product_name, sku, category_name, description,
                price, cost_price, stock, min_stock_alert, is_available
           FROM contract.catalog
          WHERE business_id = $1
          ORDER BY category_name NULLS LAST, product_name`, [id]),

      db.query(
        `SELECT id, external_ref, name, phone, email, points, total_spent,
                visit_count, tier, last_visit_at
           FROM pos.customers WHERE business_id = $1 ORDER BY name`, [id]),

      db.query(
        `SELECT branch_id, external_ref, name, address, latitude, longitude,
                allowed_radius_meters, is_active, sedang_dipakai
           FROM contract.branches WHERE business_id = $1 ORDER BY name`, [id]),

      db.query(
        `SELECT id, name, sku, description, bundle_price, is_available, items
           FROM contract.bundles WHERE business_id = $1 ORDER BY name`, [id]),

      // Struk yang benar-benar terjadi. Yang dibatalkan sengaja tidak ikut:
      // transaction_log memang sudah menyaringnya satu tingkat di bawah.
      db.query(
        `SELECT id, invoice_number, total_amount, subtotal, discount_amount,
                tax_amount, service_charge_amount, payment_method, payment_status,
                order_type, app_module, created_at, cashier_name, item_count
           FROM contract.transaction_log
          WHERE business_id = $1
          ORDER BY created_at DESC
          LIMIT ${BATAS_TRANSAKSI}`, [id]),

      /* -- YANG DITAMBAHKAN 0036 ----------------------------------------- */
      //
      // Keenamnya dulu hanya ada di localStorage satu peramban. Tanpa bagian
      // ini, mengirimnya ke server tidak ada gunanya: data yang bisa naik tapi
      // tidak bisa turun tetap hilang saat perangkatnya berganti.

      db.query(
        `SELECT external_ref, name, capacity, zone, business_sector, is_active
           FROM pos.dining_tables WHERE business_id = $1 ORDER BY name`, [id]),

      db.query(
        `SELECT external_ref, name, sku, current_stock, min_stock_alert, unit,
                cost_price, stock_type, category_name, location, notes,
                business_sector, updated_at
           FROM pos.ingredients WHERE business_id = $1 ORDER BY name`, [id]),

      db.query(
        `SELECT code, discount_percent, max_discount_amount, min_purchase_amount,
                is_active, created_at
           FROM pos.promo_codes WHERE business_id = $1 ORDER BY code`, [id]),

      db.query(
        `SELECT external_ref, cashier_name, opened_at, closed_at, status,
                initial_cash, cash_sales, qris_sales, card_sales, ewallet_sales,
                total_sales, expected_cash, actual_cash, difference,
                total_orders, notes, business_sector
           FROM pos.cashier_shifts WHERE business_id = $1
          ORDER BY opened_at DESC LIMIT ${BATAS_RIWAYAT}`, [id]),

      db.query(
        `SELECT external_ref, staff_ref, staff_name, staff_role,
                clock_in_at, clock_out_at, status, outlet_ref, outlet_name,
                clock_in_lat, clock_in_lon, clock_in_distance_m,
                clock_out_lat, clock_out_lon, clock_out_distance_m,
                shift_notes, business_sector
           FROM pos.attendance_records WHERE business_id = $1
          ORDER BY clock_in_at DESC LIMIT ${BATAS_RIWAYAT}`, [id]),

      db.query(
        `SELECT store_name, tagline, address, phone, tax_rate, enable_tax,
                service_rate, enable_service, enable_loyalty, loyalty_earn_rate,
                loyalty_redeem_rate, monthly_revenue_target,
                geofence_enforcement, extra, updated_at
           FROM pos.store_settings WHERE business_id = $1`, [id]),
    ]);

    if (!usaha.rows.length) {
      // Token sah tapi tokonya sudah tidak ada — dihapus setelah token terbit.
      return res.status(404).json({ ok: false, error: 'STORE_NOT_FOUND' });
    }

    const u = usaha.rows[0];
    return res.status(200).json({
      ok: true,
      ditarikPada: new Date().toISOString(),
      business: {
        businessId: u.id,
        storeName: u.name,
        sector: u.business_sector,
        clientKey: u.client_key,
        ownerRef: u.owner_user_ref,
        activeOutletId: u.active_outlet_id,
      },
      products: katalog.rows,
      customers: pelanggan.rows,
      branches: cabang.rows,
      bundles: bundel.rows,
      transactions: transaksi.rows,
      tables: meja.rows,
      stockItems: bahan.rows,
      promoCodes: promo.rows,
      shifts: shift.rows,
      attendance: absensi.rows,
      // `null` bila toko ini belum pernah mengirim pengaturannya — dan itu
      // BERBEDA dari objek kosong. Perangkat yang menerima objek kosong akan
      // menimpa pajak dan tarif loyalitas yang sedang berlaku di layarnya
      // dengan nol.
      settings: pengaturan.rows[0] ?? null,
      // Dilaporkan supaya aplikasi tahu daftarnya terpotong, bukan menyangka
      // toko ini memang hanya punya 500 struk.
      transactionsTruncated: transaksi.rows.length === BATAS_TRANSAKSI,
    });
  } catch (err: any) {
    console.error('[sync/pull]', err?.message);
    return res.status(500).json({ ok: false, error: 'PULL_FAILED' });
  }
}
