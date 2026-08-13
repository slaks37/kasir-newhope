-- =============================================================================
-- 0008_catalog_and_charges.sql
--
-- Dua kekurangan yang sebelumnya ditambal di sisi aplikasi, sekarang diperbaiki
-- di tempat yang benar:
--
--   1. Service charge dilipat ke dalam pajak karena tidak ada kolomnya. Totalnya
--      benar, tapi merchant tidak bisa menjawab "berapa yang saya kutip sebagai
--      service charge bulan ini" — dan itu angka yang dilaporkan ke pajak
--      secara terpisah.
--
--   2. Produk hanya sampai ke database kalau ia TERJUAL. Katalog di panel selalu
--      lebih sedikit daripada yang dilihat merchant, dan produk yang tidak
--      pernah laku — justru yang paling perlu diketahui — tidak pernah muncul
--      sama sekali.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0008_catalog_and_charges.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. SERVICE CHARGE -----------------------------------------------------------

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN transactions.service_charge_amount IS
    'Biaya layanan, terpisah dari tax_amount. Baris yang ditulis sebelum 0008 mencatatnya di dalam tax_amount dan tidak bisa dipisah lagi secara retroaktif.';


-- 2. KATALOG ------------------------------------------------------------------
--
-- Stok tinggal di products, bukan di tabel tersendiri. Alasannya: yang dibutuhkan
-- panel adalah POSISI stok terkini untuk peringatan "menipis", bukan riwayat
-- mutasinya — dan riwayat itu sudah ada di inventory_logs.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS stock             NUMERIC(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_stock_alert   NUMERIC(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unit              VARCHAR(20),
    -- Kapan katalog ini terakhir dikirim perangkat. Membedakan "produk memang
    -- tidak ada" dari "merchant belum pernah menyinkronkan katalognya" — dua
    -- hal yang terlihat identik di layar kalau tidak dicatat.
    ADD COLUMN IF NOT EXISTS catalog_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_products_low_stock
    ON products (tenant_id)
    WHERE stock <= min_stock_alert;


-- 3. VIEW KATALOG -------------------------------------------------------------
--
-- Berbeda dari v_product_sales_by_sector: view itu berangkat dari baris struk,
-- jadi produk yang tidak pernah terjual mustahil muncul di sana. View ini
-- berangkat dari katalog dan menempelkan penjualannya — sehingga nol penjualan
-- justru terlihat.

DROP VIEW IF EXISTS v_catalog_by_sector CASCADE;
CREATE VIEW v_catalog_by_sector AS
SELECT
    p.business_sector,
    p.tenant_id                                    AS merchant_id,
    t.name                                         AS merchant_name,
    p.id                                           AS product_id,
    p.name                                         AS product_name,
    p.sku,
    p.category_name,
    p.description,
    p.price,
    p.cost_price,
    CASE WHEN p.price > 0
         THEN ROUND(((p.price - p.cost_price) / p.price) * 100, 1)
         ELSE 0 END                                AS margin_pct,
    p.stock,
    p.min_stock_alert,
    p.stock <= p.min_stock_alert                   AS is_low_stock,
    p.is_available,
    p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM products p
  JOIN tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)    AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(x.created_at)  AS last_sold_at
          FROM transaction_items i
          JOIN transactions x ON x.id = i.transaction_id
         WHERE x.payment_status <> 'CANCELLED'
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;

COMMENT ON VIEW v_catalog_by_sector IS
    'Seluruh katalog per sektor, termasuk produk yang belum pernah terjual. Berangkat dari products, bukan dari baris struk.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON v_catalog_by_sector TO bi_readonly;
    END IF;
END $$;
