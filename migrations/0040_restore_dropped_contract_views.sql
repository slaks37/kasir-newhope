-- =============================================================================
-- 0040_restore_dropped_contract_views.sql
--
-- Memulihkan empat view kontrak yang hilang tanpa suara.
--
-- APA YANG TERJADI. Migrasi 0020 memisahkan pesanan dari pembayaran, dan untuk
-- itu membangun ulang `contract.merchant_revenue`:
--
--   migrations/0020_separate_orders_and_payments.sql:111
--   DROP VIEW IF EXISTS contract.merchant_revenue CASCADE;
--
-- CASCADE ikut menjatuhkan SEMUA view yang membaca darinya. 0020 membangun
-- ulang `merchant_revenue` dan `transaction_log`, tapi tiga turunan lain tidak
-- pernah disebut lagi:
--
--   contract.sector_summary
--   contract.product_sales
--   contract.daily_sector_revenue
--
-- `contract.inventory_movements` hilang dengan cara yang sama pada rantai
-- CASCADE di 0023/0024.
--
-- Kenapa tidak ada yang menyadarinya: satu-satunya pemakai keempat view ini
-- adalah konsol back-office, dan konsol itu dilayani dari data karangan di
-- browser — jadi tidak ada satu pun permintaan yang pernah menyentuhnya.
-- Begitu konsolnya disambungkan ke API sungguhan, dua layar terpentingnya
-- langsung menjawab 500:
--
--   GET /api/admin/overview  -> relation "contract.sector_summary" does not exist
--   GET /api/admin/products  -> relation "contract.product_sales"  does not exist
--
-- Definisi di bawah DISESUAIKAN dengan skema sekarang, bukan disalin mentah
-- dari migrasi lamanya. Dua contohnya:
--
--   · `product_sales` dulu menjoin `internal.tenants` untuk mengambil nama
--     merchant. Sejak Model B (0015) nama itu sudah dibawa `merchant_revenue`
--     sendiri, dan `merchant_id` menunjuk `internal.merchants` — bukan tenants.
--     Join lamanya akan mengembalikan nol baris.
--
--   · `inventory_movements` dulu memakai `ii.product_id IS NOT NULL` untuk
--     menandai item yang berupa produk jadi. Kolom itu sudah tidak ada sejak
--     domain inventori dipisah di 0027; penandanya sekarang `item_type`.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0040_restore_dropped_contract_views.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. RINGKASAN PER SEKTOR ------------------------------------------------------
-- Dipakai konsol untuk kartu ringkasan dan grafik sektor.

DROP VIEW IF EXISTS contract.sector_summary CASCADE;
CREATE VIEW contract.sector_summary AS
SELECT
    r.business_sector,
    COUNT(DISTINCT r.merchant_id)                     AS merchant_count,
    COUNT(DISTINCT r.business_id)                     AS business_unit_count,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    COALESCE(AVG(r.total_amount), 0)                  AS avg_basket,
    COALESCE(SUM(r.discount_amount), 0)               AS total_discount,
    MAX(r.created_at)                                 AS last_transaction_at
  FROM contract.merchant_revenue r
 GROUP BY r.business_sector;

COMMENT ON VIEW contract.sector_summary IS
    'Ringkasan omzet per sektor. Dipulihkan 0040 setelah hilang lewat CASCADE di 0020.';


-- 2. OMZET HARIAN PER SEKTOR ---------------------------------------------------
-- Waktu dikonversi ke Asia/Jakarta lebih dulu: "penjualan hari ini" bagi
-- merchant berarti hari menurut jam tokonya, bukan menurut UTC.

DROP VIEW IF EXISTS contract.daily_sector_revenue CASCADE;
CREATE VIEW contract.daily_sector_revenue AS
SELECT
    r.business_sector,
    (r.created_at AT TIME ZONE 'Asia/Jakarta')::date  AS sales_date,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    COUNT(DISTINCT r.merchant_id)                     AS active_merchants
  FROM contract.merchant_revenue r
 GROUP BY r.business_sector, (r.created_at AT TIME ZONE 'Asia/Jakarta')::date;

COMMENT ON VIEW contract.daily_sector_revenue IS
    'Omzet harian per sektor (zona Asia/Jakarta). Dipulihkan 0040.';


-- 3. PENJUALAN PER PRODUK ------------------------------------------------------
--
-- HPP dijumlahkan dari `unit_cost` yang DISNAPSHOT saat item masuk keranjang,
-- bukan dari harga pokok produk hari ini. Itu disengaja: margin sebuah
-- transaksi harus dihitung dengan biaya yang berlaku saat transaksi terjadi,
-- bukan dengan biaya yang berubah bulan berikutnya.

DROP VIEW IF EXISTS contract.product_sales CASCADE;
CREATE VIEW contract.product_sales AS
SELECT
    i.business_sector,
    r.merchant_id,
    r.merchant_name,
    i.product_id,
    i.product_name,
    i.category_name,
    (ARRAY_AGG(i.product_description ORDER BY r.created_at DESC)
        FILTER (WHERE i.product_description IS NOT NULL))[1] AS product_description,
    SUM(i.quantity)                                    AS units_sold,
    SUM(i.total_price)                                 AS revenue,
    SUM(COALESCE(i.unit_cost, 0) * i.quantity)         AS cogs,
    SUM(i.total_price) - SUM(COALESCE(i.unit_cost, 0) * i.quantity) AS gross_profit,
    COUNT(DISTINCT i.transaction_id)                   AS appeared_in_transactions,
    MAX(r.created_at)                                  AS last_sold_at
  FROM pos.transaction_items i
  JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
 GROUP BY i.business_sector, r.merchant_id, r.merchant_name,
          i.product_id, i.product_name, i.category_name;

COMMENT ON VIEW contract.product_sales IS
    'Penjualan dan margin per produk. HPP dari snapshot saat transaksi. Dipulihkan 0040.';


-- 4. MUTASI STOK ---------------------------------------------------------------

DROP VIEW IF EXISTS contract.inventory_movements CASCADE;
CREATE VIEW contract.inventory_movements AS
SELECT
    tx.id                                              AS movement_id,
    tx.tenant_id,
    tx.merchant_id,
    m.name                                             AS merchant_name,
    m.business_sector,
    tx.outlet_id,
    o.name                                             AS outlet_name,
    tx.location_id,
    loc.name                                           AS location_name,
    tx.reference_type                                  AS movement_type,
    (ii.item_type = 'PRODUCT')                         AS is_product,
    ii.item_name,
    ii.sku,
    ii.base_unit                                       AS unit,
    tx.reference_id                                    AS transaction_id,
    tx.quantity_delta,
    tx.reason,
    tx.created_at
  FROM pos.inventory_transactions tx
  JOIN pos.inventory_items ii            ON ii.id = tx.inventory_item_id
  LEFT JOIN internal.merchants m         ON m.id = tx.merchant_id
  LEFT JOIN internal.outlets o           ON o.id = tx.outlet_id
  LEFT JOIN pos.inventory_locations loc  ON loc.id = tx.location_id;

COMMENT ON VIEW contract.inventory_movements IS
    'Mutasi stok lintas outlet dan lokasi. Dipulihkan 0040.';


-- 5. HAK BACA ------------------------------------------------------------------
--
-- View yang dibuat ulang kehilangan seluruh grant lamanya. Tanpa blok ini,
-- konsol menjawab "permission denied for view sector_summary" begitu isolasi
-- peran diaktifkan — kegagalan yang muncul hanya SETELAH pengamanan dinyalakan,
-- dan karena itu paling mudah disalahartikan sebagai kesalahan pengamanannya.

DO $$
DECLARE
    svc  TEXT;
    v    TEXT;
    daftar TEXT[] := ARRAY['sector_summary', 'daily_sector_revenue',
                           'product_sales', 'inventory_movements'];
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal', 'bi_readonly'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN CONTINUE; END IF;
        FOREACH v IN ARRAY daftar LOOP
            EXECUTE format('GRANT SELECT ON contract.%I TO %I', v, svc);
        END LOOP;
    END LOOP;
END $$;


-- 6. PEMERIKSAAN AKHIR ---------------------------------------------------------
--
-- Migrasi ini ada justru KARENA sebuah view hilang tanpa ada yang menyadarinya.
-- Membiarkannya bisa gagal dengan cara yang sama akan konyol.

DO $$
DECLARE
    v      TEXT;
    hilang TEXT[] := '{}';
BEGIN
    FOREACH v IN ARRAY ARRAY['sector_summary', 'daily_sector_revenue',
                             'product_sales', 'inventory_movements',
                             'merchant_revenue', 'transaction_log', 'catalog'] LOOP
        IF to_regclass('contract.' || v) IS NULL THEN
            hilang := hilang || v;
        END IF;
    END LOOP;

    IF array_length(hilang, 1) > 0 THEN
        RAISE EXCEPTION '0040: view kontrak masih hilang: %', array_to_string(hilang, ', ');
    END IF;

    RAISE NOTICE '0040: empat view kontrak dipulihkan dan diverifikasi.';
END $$;
