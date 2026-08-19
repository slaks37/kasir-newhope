-- =============================================================================
-- 0018_bundles.sql
--
-- Paket bundling promo, dari localStorage ke database.
--
-- KENAPA. Panel admin punya tab "Bundle Set Promo" yang selama ini menampilkan
-- array di dalam bundle JavaScript, dan aplikasi kasir menyimpannya hanya di
-- perangkat. Akibatnya sama seperti pelanggan sebelum 0012: bersihkan browser,
-- seluruh paket promo yang sudah disusun merchant hilang, dan tidak ada
-- salinannya di mana pun.
--
-- Bundle juga menjelaskan angka penjualan yang tanpanya terlihat aneh: dua
-- produk yang terjual bersama dengan harga di bawah jumlah harga satuannya
-- bukan kesalahan input, melainkan paket promo.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0018_bundles.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. PAKET --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.bundles (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id        UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    external_ref     VARCHAR(96),
    name             VARCHAR(100) NOT NULL,
    sku              VARCHAR(50),
    description      VARCHAR(300),

    -- Keduanya DISIMPAN, tidak dihitung ulang dari baris isinya.
    --
    -- Harga satuan produk berubah; kalau harga normal paket dijumlahkan ulang
    -- saat dibaca, diskon promo bulan lalu ikut berubah setiap kali katalog
    -- disunting — alasan yang sama dengan snapshot harga di transaction_items.
    regular_price    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (regular_price >= 0),
    bundle_price     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (bundle_price  >= 0),

    is_available     BOOLEAN NOT NULL DEFAULT TRUE,
    business_sector  VARCHAR(16),
    business_id      VARCHAR(96),
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.bundles IS
    'Paket bundling promo per merchant. Sumber kebenarannya pindah dari localStorage ke sini sejak 0018.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bundles_tenant_ref
    ON pos.bundles (tenant_id, external_ref) WHERE external_ref IS NOT NULL;


-- 2. ISI PAKET ----------------------------------------------------------------
--
-- product_id SET NULL, bukan CASCADE — sama seperti transaction_items. Produk
-- yang dihapus tidak boleh menghapus paket yang pernah memuatnya; nama dan
-- harganya sudah di-snapshot, jadi barisnya tetap terbaca utuh.

CREATE TABLE IF NOT EXISTS pos.bundle_items (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    bundle_id      UUID NOT NULL REFERENCES pos.bundles(id) ON DELETE CASCADE,
    tenant_id      UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    product_id     UUID REFERENCES pos.products(id) ON DELETE SET NULL,
    product_name   VARCHAR(100) NOT NULL,
    quantity       INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal_price NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON pos.bundle_items (bundle_id);


-- 3. PERMUKAAN BACA -----------------------------------------------------------
--
-- Diskon dihitung di sini, bukan di panel. Kalau rumusnya ditulis di layar,
-- dua tampilan bisa menyatakan diskon berbeda untuk paket yang sama.

DROP VIEW IF EXISTS contract.bundles CASCADE;
CREATE VIEW contract.bundles AS
SELECT
    b.id,
    b.tenant_id                AS merchant_id,
    t.name                     AS merchant_name,
    b.business_sector,
    b.business_id,
    b.name,
    b.sku,
    b.description,
    b.regular_price,
    b.bundle_price,
    (b.regular_price - b.bundle_price)                     AS hemat_rupiah,
    CASE WHEN b.regular_price > 0
         THEN ROUND(((b.regular_price - b.bundle_price) / b.regular_price) * 100, 1)
         ELSE 0
    END                                                    AS diskon_persen,
    b.is_available,
    (SELECT COUNT(*) FROM pos.bundle_items i WHERE i.bundle_id = b.id)::int
                                                           AS jumlah_item,
    -- Isi paket ikut dibawa supaya panel tidak perlu satu permintaan lagi per
    -- baris; jumlah paket per merchant kecil, jadi ini aman.
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'product_name',   i.product_name,
                'quantity',       i.quantity,
                'unit_price',     i.unit_price,
                'subtotal_price', i.subtotal_price)
              ORDER BY i.product_name)
         FROM pos.bundle_items i WHERE i.bundle_id = b.id),
      '[]'::jsonb
    )                                                      AS items,
    b.updated_at
  FROM pos.bundles b
  JOIN pos.tenants t ON t.id = b.tenant_id;

COMMENT ON VIEW contract.bundles IS
    'Paket promo beserta isinya dan besar diskonnya. Hanya baca.';


-- 4. HAK AKSES ----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.bundles      TO svc_pos;
        GRANT ALL ON pos.bundle_items TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.bundles TO %I', svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.bundles TO bi_readonly;
    END IF;
END $$;
