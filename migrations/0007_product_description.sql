-- =============================================================================
-- 0007_product_description.sql
--
-- Deskripsi produk: dari katalog merchant sampai ke baris struk.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0007_product_description.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KATALOG ------------------------------------------------------------------
--
-- VARCHAR(300), bukan TEXT. Ini teks yang harus muat di kartu produk kasir dan
-- di struk termal 58mm; batas yang dipaksakan database membuat pemotongan
-- terjadi saat pengetikan — di tempat penulisnya masih bisa memperbaiki
-- kalimat — bukan saat pencetakan, ketika satu-satunya pilihan tinggal
-- memotong di tengah kata.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS description VARCHAR(300);

COMMENT ON COLUMN products.description IS
    'Deskripsi produk yang tampil di kartu kasir dan struk digital. Opsional; NULL, bukan string kosong, ketika tidak diisi.';


-- 2. SNAPSHOT DI BARIS STRUK --------------------------------------------------
--
-- Alasannya sama persis dengan product_name, unit_price, dan unit_cost di 0006:
-- struk adalah catatan tentang apa yang dijual PADA SAAT ITU. Kalau deskripsi
-- di-join dari katalog, mengubah satu kalimat pemasaran hari ini akan menulis
-- ulang setiap struk yang pernah dicetak — termasuk yang sudah dipegang
-- pelanggan.

ALTER TABLE transaction_items
    ADD COLUMN IF NOT EXISTS product_description VARCHAR(300);

COMMENT ON COLUMN transaction_items.product_description IS
    'Salinan deskripsi saat transaksi terjadi. Sengaja tidak di-join ke products.';


-- 3. PENCARIAN ----------------------------------------------------------------
--
-- Panel dan aplikasi kasir sama-sama mencari produk lewat ILIKE '%kata%'.
-- Pola berawalan wildcard tidak bisa memakai index B-tree biasa sama sekali —
-- Postgres akan memindai seluruh tabel. Index trigram melayaninya.
--
-- pg_trgm tidak selalu tersedia (PGlite, atau Postgres terkelola yang membatasi
-- ekstensi), jadi kegagalannya ditangkap dan dilewati. Tanpa index, pencarian
-- tetap benar — hanya lebih lambat pada katalog besar.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE INDEX IF NOT EXISTS idx_products_search_trgm
        ON products USING GIN ((name || ' ' || COALESCE(description, '')) gin_trgm_ops);

    RAISE NOTICE '0007: index trigram pencarian produk dibuat';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '0007: pg_trgm tidak tersedia (%) — pencarian tetap jalan tanpa index', SQLERRM;
END $$;


-- 4. VIEW PRODUK TERJUAL ------------------------------------------------------
-- Dibangun ulang agar deskripsi ikut terbawa ke admin panel.

DROP VIEW IF EXISTS v_product_sales_by_sector CASCADE;
CREATE VIEW v_product_sales_by_sector AS
SELECT
    i.business_sector,
    x.tenant_id                                       AS merchant_id,
    t.name                                            AS merchant_name,
    i.product_id,
    i.product_name,
    i.category_name,
    -- Deskripsi terbaru yang tercatat di struk, bukan yang ada di katalog
    -- sekarang: sebuah produk boleh saja sudah dihapus dari katalog.
    (ARRAY_AGG(i.product_description ORDER BY x.created_at DESC)
        FILTER (WHERE i.product_description IS NOT NULL))[1] AS product_description,
    SUM(i.quantity)                                   AS units_sold,
    SUM(i.total_price)                                AS revenue,
    SUM(i.unit_cost * i.quantity)                     AS cogs,
    SUM(i.total_price) - SUM(i.unit_cost * i.quantity) AS gross_profit,
    COUNT(DISTINCT i.transaction_id)                  AS appeared_in_transactions,
    MAX(x.created_at)                                 AS last_sold_at
  FROM transaction_items i
  JOIN transactions x ON x.id = i.transaction_id
  JOIN tenants      t ON t.id = x.tenant_id
 WHERE x.payment_status <> 'CANCELLED'
 GROUP BY i.business_sector, x.tenant_id, t.name,
          i.product_id, i.product_name, i.category_name;

COMMENT ON VIEW v_product_sales_by_sector IS
    'Produk apa saja yang terjual, per sektor per merchant. Nama dan deskripsi diambil dari snapshot baris struk, bukan dari katalog.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON v_product_sales_by_sector TO bi_readonly;
    END IF;
END $$;
