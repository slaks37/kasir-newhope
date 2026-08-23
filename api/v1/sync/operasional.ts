/**
 * SINKRONISASI DATA OPERASIONAL.
 *
 * Enam entitas yang sebelum ini hanya hidup di localStorage satu peramban:
 * denah meja, bahan baku, kode promo, rekap shift kas, absensi staf, dan
 * pengaturan toko. Alasan lengkapnya ada di migrations/0036.
 *
 * KENAPA ENDPOINT SENDIRI, BUKAN DITUMPANGKAN KE /sync/catalog.
 *
 * Katalog dikirim ulang setiap kali stok satu produk berubah — artinya pada
 * setiap penjualan. Menumpangkan absensi dan rekap kas di kiriman yang sama
 * berarti keduanya ikut dikirim ratusan kali sehari, dan satu katalog yang
 * ditahan batas paket akan menahan absensi hari itu bersamanya. Keduanya
 * berubah pada irama yang sama sekali berbeda, jadi keduanya berdiri sendiri.
 *
 * SEMUA BAGIAN OPSIONAL. Klien boleh mengirim hanya yang berubah; bagian yang
 * tidak disertakan tidak disentuh sama sekali. Ini penting: mengirim array
 * kosong dan "tidak mengirim" harus berarti hal yang berbeda, kalau tidak,
 * perangkat yang belum sempat memuat absensinya akan menghapus absensi yang
 * dikirim perangkat lain.
 *
 * TIDAK ADA YANG DIHAPUS DARI SERVER. Endpoint ini hanya menyisipkan dan
 * memperbarui. Penghapusan perlu jalurnya sendiri yang bisa membedakan
 * "dihapus pemilik" dari "belum sempat termuat di perangkat ini" — dan sampai
 * jalur itu ada, kehilangan diam-diam jauh lebih mahal daripada baris basi.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { wajibToko } from '../../_lib/tokoContext.js';
import { sslUntuk } from '../../../src/server/sslDb.js';

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

/** Batas jumlah baris per bagian. Menahan kiriman yang salah bentuk. */
const BATAS_BARIS = 2000;

const teks = (v: unknown, n: number): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, n) : null;
};
const angka = (v: unknown, bawaan = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : bawaan;
};
const waktu = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Kunci pengaturan yang TIDAK boleh masuk kolom `extra`.
 *
 * `subscription` disaring karena status langganan ditentukan billing, bukan
 * perangkat kasir. Salinan yang tersimpan di localStorage bisa basi, bisa
 * disunting siapa pun yang membuka devtools, dan menyimpannya di sini
 * menciptakan sumber kebenaran kedua yang akan bertentangan dengan yang asli.
 * `branches` disaring karena cabang punya tabel sendiri (pos.outlets) dan
 * jalur sinkronnya sendiri — dua salinan cabang yang bisa berbeda adalah
 * persoalan yang tidak perlu diadakan.
 */
const EXTRA_DILARANG = new Set(['subscription', 'branches', 'activeBranchId']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body ?? {};
  const { businessId, sector } = body;
  if (!businessId) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId wajib' });
  }

  const toko = await wajibToko(req, res, businessId);
  if (!toko) return;

  const ambil = (nama: string): any[] | null =>
    Array.isArray(body[nama]) ? body[nama].slice(0, BATAS_BARIS) : null;

  const meja = ambil('tables');
  const bahan = ambil('stockItems');
  const promo = ambil('promoCodes');
  const shift = ambil('shifts');
  const absensi = ambil('attendance');
  const kas = ambil('cashEntries');
  const pengaturan = body.settings && typeof body.settings === 'object' ? body.settings : null;

  const db = getPool();
  const client = await db.connect();
  const tersimpan: Record<string, number> = {};

  try {
    await client.query('BEGIN');

    // Unit usahanya HARUS sudah ada. Berbeda dengan /sync/catalog, endpoint ini
    // tidak melahirkannya: pendaftaran toko punya pintunya sendiri di
    // /api/v1/auth/session, dan membuat pintu kedua berarti dua aturan
    // identitas yang bisa berbeda — kekeliruan yang persis pernah terjadi
    // antara sync/catalog dan sync/transactions.
    const bis = await client.query(
      `SELECT id FROM pos.businesses WHERE client_key = $1`,
      [businessId]
    );
    if (!bis.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'BUSINESS_NOT_FOUND' });
    }
    const tenantId = bis.rows[0].id;

    /* -- MEJA ------------------------------------------------------------- */
    if (meja) {
      let n = 0;
      for (const t of meja) {
        const ref = teks(t?.id, 96);
        const nama = teks(t?.name, 60);
        if (!ref || !nama) continue;
        await client.query(
          `INSERT INTO pos.dining_tables
             (business_id, external_ref, name, capacity, zone, business_sector, is_active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, CURRENT_TIMESTAMP)
           ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name,
                         capacity = EXCLUDED.capacity,
                         zone = EXCLUDED.zone,
                         business_sector = EXCLUDED.business_sector,
                         updated_at = CURRENT_TIMESTAMP`,
          [tenantId, ref, nama, Math.max(1, Math.trunc(angka(t?.capacity, 4))),
           teks(t?.zone, 60), teks(t?.businessSector, 16) ?? teks(sector, 16)]
        );
        n++;
      }
      tersimpan.tables = n;
    }

    /* -- BAHAN BAKU ------------------------------------------------------- */
    if (bahan) {
      let n = 0;
      for (const s of bahan) {
        const ref = teks(s?.id, 96);
        const nama = teks(s?.name, 100);
        if (!ref || !nama) continue;
        await client.query(
          `INSERT INTO pos.ingredients
             (business_id, external_ref, name, sku, current_stock, min_stock_alert,
              unit, cost_price, stock_type, category_name, location, notes,
              business_sector, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CURRENT_TIMESTAMP)
           ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name,
                         sku = EXCLUDED.sku,
                         current_stock = EXCLUDED.current_stock,
                         min_stock_alert = EXCLUDED.min_stock_alert,
                         unit = EXCLUDED.unit,
                         cost_price = EXCLUDED.cost_price,
                         stock_type = EXCLUDED.stock_type,
                         category_name = EXCLUDED.category_name,
                         location = EXCLUDED.location,
                         notes = EXCLUDED.notes,
                         business_sector = EXCLUDED.business_sector,
                         updated_at = CURRENT_TIMESTAMP`,
          [tenantId, ref, nama, teks(s?.sku, 50),
           angka(s?.stock), angka(s?.minStockAlert, 10),
           teks(s?.unit, 20) ?? 'pcs', angka(s?.costPrice),
           teks(s?.type, 20), teks(s?.categoryName, 80), teks(s?.location, 80),
           teks(s?.notes, 300), teks(s?.businessSector, 16) ?? teks(sector, 16)]
        );
        n++;
      }
      tersimpan.stockItems = n;
    }

    /* -- KODE PROMO ------------------------------------------------------- */
    if (promo) {
      let n = 0;
      for (const p of promo) {
        const kode = teks(p?.code, 40);
        if (!kode) continue;
        await client.query(
          `INSERT INTO pos.promo_codes
             (business_id, code, discount_percent, max_discount_amount,
              min_purchase_amount, is_active, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6, CURRENT_TIMESTAMP)
           ON CONFLICT (business_id, upper(code))
           DO UPDATE SET discount_percent = EXCLUDED.discount_percent,
                         max_discount_amount = EXCLUDED.max_discount_amount,
                         min_purchase_amount = EXCLUDED.min_purchase_amount,
                         is_active = EXCLUDED.is_active,
                         updated_at = CURRENT_TIMESTAMP`,
          [tenantId, kode,
           Math.min(100, Math.max(0, angka(p?.discountPercent))),
           Math.max(0, angka(p?.maxDiscountAmount)),
           Math.max(0, angka(p?.minPurchaseAmount)),
           p?.isActive ?? true]
        );
        n++;
      }
      tersimpan.promoCodes = n;
    }

    /* -- SHIFT KAS -------------------------------------------------------- */
    if (shift) {
      let n = 0;
      for (const s of shift) {
        const ref = teks(s?.id, 96);
        const buka = waktu(s?.startTime);
        if (!ref || !buka) continue;

        const status = String(s?.status ?? '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN';
        const aktual = s?.actualCash === undefined || s?.actualCash === null
          ? null : angka(s.actualCash);

        await client.query(
          `INSERT INTO pos.cashier_shifts
             (business_id, external_ref, cashier_name, opened_at, closed_at, status,
              initial_cash, cash_sales, qris_sales, card_sales, ewallet_sales,
              total_sales, expected_cash, actual_cash, difference, total_orders,
              notes, business_sector, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, CURRENT_TIMESTAMP)
           ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET cashier_name = EXCLUDED.cashier_name,
                         closed_at = EXCLUDED.closed_at,
                         status = EXCLUDED.status,
                         initial_cash = EXCLUDED.initial_cash,
                         cash_sales = EXCLUDED.cash_sales,
                         qris_sales = EXCLUDED.qris_sales,
                         card_sales = EXCLUDED.card_sales,
                         ewallet_sales = EXCLUDED.ewallet_sales,
                         total_sales = EXCLUDED.total_sales,
                         expected_cash = EXCLUDED.expected_cash,
                         actual_cash = EXCLUDED.actual_cash,
                         difference = EXCLUDED.difference,
                         total_orders = EXCLUDED.total_orders,
                         notes = EXCLUDED.notes,
                         updated_at = CURRENT_TIMESTAMP`,
          [tenantId, ref, teks(s?.cashierName, 100) ?? 'Kasir', buka,
           waktu(s?.endTime), status,
           angka(s?.initialCash), angka(s?.cashSales), angka(s?.qrisSales),
           angka(s?.cardSales), angka(s?.eWalletSales), angka(s?.totalSales),
           angka(s?.expectedCash), aktual,
           s?.difference === undefined || s?.difference === null ? null : angka(s.difference),
           Math.max(0, Math.trunc(angka(s?.totalOrders))),
           teks(s?.notes, 500), teks(s?.businessSector, 16) ?? teks(sector, 16)]
        );
        n++;
      }
      tersimpan.shifts = n;
    }

    /* -- ABSENSI ---------------------------------------------------------- */
    if (absensi) {
      let n = 0;
      for (const a of absensi) {
        const ref = teks(a?.id, 96);
        const masuk = waktu(a?.clockInTime);
        const nama = teks(a?.staffName, 100);
        if (!ref || !masuk || !nama) continue;

        const keluar = waktu(a?.clockOutTime);
        // Statusnya diturunkan dari ADA-TIDAKNYA waktu pulang, tidak dipercaya
        // apa adanya dari perangkat. Baris berstatus CLOCKED_IN yang punya
        // waktu pulang pernah muncul di data lapangan, dan rekap jam kerja
        // membacanya sebagai orang yang belum pulang sejak minggu lalu.
        const status = keluar ? 'CLOCKED_OUT' : 'CLOCKED_IN';

        await client.query(
          `INSERT INTO pos.attendance_records
             (business_id, external_ref, staff_ref, staff_name, staff_role,
              clock_in_at, clock_out_at, status, outlet_ref, outlet_name,
              clock_in_lat, clock_in_lon, clock_in_distance_m,
              clock_out_lat, clock_out_lon, clock_out_distance_m,
              shift_notes, business_sector, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, CURRENT_TIMESTAMP)
           ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET staff_name = EXCLUDED.staff_name,
                         staff_role = EXCLUDED.staff_role,
                         clock_out_at = EXCLUDED.clock_out_at,
                         status = EXCLUDED.status,
                         outlet_ref = EXCLUDED.outlet_ref,
                         outlet_name = EXCLUDED.outlet_name,
                         clock_out_lat = EXCLUDED.clock_out_lat,
                         clock_out_lon = EXCLUDED.clock_out_lon,
                         clock_out_distance_m = EXCLUDED.clock_out_distance_m,
                         shift_notes = EXCLUDED.shift_notes,
                         updated_at = CURRENT_TIMESTAMP`,
          [tenantId, ref, teks(a?.staffId, 96), nama, teks(a?.staffRole, 40),
           masuk, keluar, status,
           teks(a?.branchId, 96), teks(a?.branchName, 100),
           a?.clockInGeo?.latitude ?? null, a?.clockInGeo?.longitude ?? null,
           a?.clockInGeo?.distanceFromBranchMeters ?? null,
           a?.clockOutGeo?.latitude ?? null, a?.clockOutGeo?.longitude ?? null,
           a?.clockOutGeo?.distanceFromBranchMeters ?? null,
           teks(a?.shiftNotes, 500), teks(a?.businessSector, 16) ?? teks(sector, 16)]
        );
        n++;
      }
      tersimpan.attendance = n;
    }

    /* -- KAS HARIAN ------------------------------------------------------- */
    //
    // Modal awal, uang masuk non-penjualan, dan pengeluaran. PENJUALAN TIDAK
    // ADA DI SINI — struk sudah menjadi catatannya di pos.transactions, dan
    // mencatatnya sekali lagi sebagai kas masuk membuat omzet terhitung dua
    // kali. Yang menggabungkan keduanya adalah contract.daily_cash.
    if (kas) {
      let n = 0;
      for (const e of kas) {
        const ref = teks(e?.id, 96);
        const kapan = waktu(e?.waktu);
        const jenis = String(e?.jenis ?? '').toUpperCase();
        if (!ref || !kapan) continue;
        if (!['MODAL_AWAL', 'MASUK', 'KELUAR'].includes(jenis)) continue;

        // Nilai nol atau negatif ditolak, bukan disimpan sebagai nol. Arah
        // uang ditentukan `entry_type`; angka bertanda yang lolos ke sini akan
        // MENAMBAH kas ketika seharusnya mengurangi, dan hasilnya tetap
        // tampak masuk akal sehingga tidak ada yang memeriksanya.
        const jumlah = Math.abs(angka(e?.jumlah));
        if (!(jumlah > 0)) continue;

        await client.query(
          `INSERT INTO pos.cash_entries
             (business_id, external_ref, entry_type, amount, category, note,
              occurred_at, shift_ref, recorded_by_ref, recorded_by_name,
              business_sector, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CURRENT_TIMESTAMP)
           ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
           DO UPDATE SET entry_type = EXCLUDED.entry_type,
                         amount = EXCLUDED.amount,
                         category = EXCLUDED.category,
                         note = EXCLUDED.note,
                         occurred_at = EXCLUDED.occurred_at,
                         shift_ref = EXCLUDED.shift_ref,
                         recorded_by_ref = EXCLUDED.recorded_by_ref,
                         recorded_by_name = EXCLUDED.recorded_by_name,
                         updated_at = CURRENT_TIMESTAMP`,
          [tenantId, ref, jenis, jumlah,
           teks(e?.kategori, 80) ?? 'Lainnya', teks(e?.keterangan, 300),
           kapan, teks(e?.shiftId, 96),
           teks(e?.dicatatOlehId, 96), teks(e?.dicatatOleh, 100),
           teks(e?.businessSector, 16) ?? teks(sector, 16)]
        );
        n++;
      }
      tersimpan.cashEntries = n;
    }

    /* -- PENGATURAN ------------------------------------------------------- */
    if (pengaturan) {
      const extra: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(pengaturan)) {
        if (EXTRA_DILARANG.has(k)) continue;
        extra[k] = v;
      }

      await client.query(
        `INSERT INTO pos.store_settings
           (business_id, store_name, tagline, address, phone,
            tax_rate, enable_tax, service_rate, enable_service,
            enable_loyalty, loyalty_earn_rate, loyalty_redeem_rate,
            monthly_revenue_target, geofence_enforcement, extra, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CURRENT_TIMESTAMP)
         ON CONFLICT (business_id) DO UPDATE SET
           store_name = EXCLUDED.store_name,
           tagline = EXCLUDED.tagline,
           address = EXCLUDED.address,
           phone = EXCLUDED.phone,
           tax_rate = EXCLUDED.tax_rate,
           enable_tax = EXCLUDED.enable_tax,
           service_rate = EXCLUDED.service_rate,
           enable_service = EXCLUDED.enable_service,
           enable_loyalty = EXCLUDED.enable_loyalty,
           loyalty_earn_rate = EXCLUDED.loyalty_earn_rate,
           loyalty_redeem_rate = EXCLUDED.loyalty_redeem_rate,
           monthly_revenue_target = EXCLUDED.monthly_revenue_target,
           geofence_enforcement = EXCLUDED.geofence_enforcement,
           extra = EXCLUDED.extra,
           updated_at = CURRENT_TIMESTAMP`,
        [tenantId,
         teks(pengaturan.storeName, 100), teks(pengaturan.tagline, 200),
         teks(pengaturan.address, 300), teks(pengaturan.phone, 40),
         Math.max(0, angka(pengaturan.taxRate)), Boolean(pengaturan.enableTax),
         Math.max(0, angka(pengaturan.serviceRate)), Boolean(pengaturan.enableService),
         Boolean(pengaturan.enableLoyalty),
         Math.max(0, angka(pengaturan.loyaltyEarnRate)),
         Math.max(0, angka(pengaturan.loyaltyRedeemRate)),
         pengaturan.monthlyRevenueTarget === undefined || pengaturan.monthlyRevenueTarget === null
           ? null : angka(pengaturan.monthlyRevenueTarget),
         ['STRICT', 'FLEXIBLE'].includes(String(pengaturan.geofenceEnforcement ?? '').toUpperCase())
           ? String(pengaturan.geofenceEnforcement).toUpperCase() : null,
         JSON.stringify(extra)]
      );
      tersimpan.settings = 1;
    }

    await client.query('COMMIT');
    return res.status(200).json({ ok: true, tersimpan });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[API Sync Operasional Error]:', err);
    return res.status(500).json({ ok: false, error: 'OPERASIONAL_SYNC_FAILED' });
  } finally {
    client.release();
  }
}
