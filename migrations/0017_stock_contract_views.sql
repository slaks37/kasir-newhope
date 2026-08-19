-- =============================================================================
-- 0017_stock_contract_views.sql
--
-- Membuka bahan baku dan resep BOM untuk konsol internal.
--
-- KENAPA. Panel admin punya tab "Bahan Baku" dan "Resep & Komposisi BOM", tapi
-- keduanya menampilkan array yang ditulis di dalam bundle JavaScript — angka
-- yang terlihat meyakinkan tanpa satu pun baris di database. backoffice-service
-- tidak bisa membacanya sendiri karena `svc_internal` sengaja tidak punya hak
-- baca ke skema `pos`; dua view di bawah ini yang menjembataninya.
--
-- Sengaja HANYA BACA dan sengaja agregat: konsol internal boleh melihat kondisi
-- stok merchant untuk membantu mereka, tapi tidak boleh menyuntingnya. Stok
-- adalah angka yang harus dipertanggungjawabkan merchant sendiri.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0017_stock_contract_views.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. BAHAN BAKU ---------------------------------------------------------------
--
-- `menipis` dihitung di sini, bukan di panel. Kalau ambangnya ditentukan
-- masing-masing layar, dua tampilan akan menyatakan hal berbeda tentang stok
-- yang sama — dan tidak ada cara memutuskan mana yang benar.

DROP VIEW IF EXISTS contract.raw_materials CASCADE;
CREATE VIEW contract.raw_materials AS
SELECT
    i.id,
    i.tenant_id                AS merchant_id,
    t.name                     AS merchant_name,
    t.business_sector,
    t.external_ref             AS business_id,
    i.name,
    i.sku,
    i.unit,
    i.current_stock,
    i.min_stock_alert,
    i.cost_price,
    (i.current_stock * i.cost_price)                       AS nilai_persediaan,
    (i.current_stock <= i.min_stock_alert)                 AS menipis,
    -- Berapa produk memakai bahan ini. Bahan yang menipis dan dipakai delapan
    -- produk adalah masalah yang berbeda dari yang tidak dipakai sama sekali.
    (SELECT COUNT(*) FROM pos.product_recipes r WHERE r.ingredient_id = i.id)::int
                                                           AS dipakai_produk,
    i.updated_at
  FROM pos.ingredients i
  JOIN pos.tenants t ON t.id = i.tenant_id;

COMMENT ON VIEW contract.raw_materials IS
    'Bahan baku per merchant beserta status menipis. Hanya baca — konsol internal tidak boleh menyunting stok merchant.';


-- 2. RESEP / BOM --------------------------------------------------------------
--
-- Satu baris per pasangan produk-bahan, bukan per produk. Panel menampilkannya
-- dikelompokkan, tapi pengelompokan di SQL akan memaksa bentuk tampilan
-- tertentu ke dalam kontrak — dan mengubah tampilannya nanti berarti mengubah
-- kontrak yang dibaca service lain.

DROP VIEW IF EXISTS contract.product_recipes CASCADE;
CREATE VIEW contract.product_recipes AS
SELECT
    r.id,
    r.tenant_id                AS merchant_id,
    t.name                     AS merchant_name,
    t.business_sector,
    p.id                       AS product_id,
    p.name                     AS product_name,
    p.price                    AS product_price,
    i.id                       AS ingredient_id,
    i.name                     AS ingredient_name,
    i.unit                     AS ingredient_unit,
    i.cost_price               AS ingredient_cost_price,
    r.quantity_required,
    -- Biaya bahan untuk satu porsi produk ini. Inilah angka yang membuat resep
    -- berguna: tanpa biayanya, daftar komposisi hanya catatan dapur.
    (r.quantity_required * i.cost_price)                   AS biaya_per_porsi
  FROM pos.product_recipes r
  JOIN pos.tenants t      ON t.id = r.tenant_id
  JOIN pos.products p     ON p.id = r.product_id
  JOIN pos.ingredients i  ON i.id = r.ingredient_id;

COMMENT ON VIEW contract.product_recipes IS
    'Komposisi BOM per produk beserta biaya bahan per porsi. Hanya baca.';


-- 3. HAK AKSES ----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    v   TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            FOREACH v IN ARRAY ARRAY['raw_materials', 'product_recipes'] LOOP
                EXECUTE format('GRANT SELECT ON contract.%I TO %I', v, svc);
            END LOOP;
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.raw_materials    TO bi_readonly;
        GRANT SELECT ON contract.product_recipes TO bi_readonly;
    END IF;
END $$;
