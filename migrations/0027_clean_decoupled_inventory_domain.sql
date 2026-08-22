-- =============================================================================
-- 0027_clean_decoupled_inventory_domain.sql
--
-- Pemisahan Bersih Domain: "Yang Dijual" (Commercial) != "Yang Disimpan" (Logistical)
-- 1. pos.inventory_items menjadi Master Entitas Fisik Mandiri (Tanpa FK Polimorfik):
--    - Menghapus product_id dan ingredient_id dari pos.inventory_items
--    - Menambahkan item_type (RAW_MATERIAL, SEMI_FINISHED, PACKAGING, CONSUMABLE, RETAIL_FINISHED)
--    - Menambahkan cost_per_unit, is_stockable
-- 2. pos.products menjadi Commercial Sellable Offering:
--    - Menambahkan offering_type (PHYSICAL, MANUFACTURED, SERVICE, BUNDLE)
--    - Menambahkan inventory_item_id (Jembatan 1:1 untuk barang ritel langsung)
-- 3. Hapus trigger polimorfik lama
-- 4. Pembaruan View contract.catalog & contract.stock_status
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. PERLUASAN KOLOM MASTER LOGISTIK (pos.inventory_items) --------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_items' AND column_name = 'item_type') THEN
        ALTER TABLE pos.inventory_items ADD COLUMN item_type VARCHAR(32) NOT NULL DEFAULT 'RAW_MATERIAL';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_items' AND column_name = 'cost_per_unit') THEN
        ALTER TABLE pos.inventory_items ADD COLUMN cost_per_unit NUMERIC(12, 4) NOT NULL DEFAULT 0.0000;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_items' AND column_name = 'is_stockable') THEN
        ALTER TABLE pos.inventory_items ADD COLUMN is_stockable BOOLEAN NOT NULL DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_items' AND column_name = 'updated_at') THEN
        ALTER TABLE pos.inventory_items ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;


-- 2. PERLUASAN KOLOM MASTER KOMERSIAL (pos.products) --------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'products' AND column_name = 'offering_type') THEN
        ALTER TABLE pos.products ADD COLUMN offering_type VARCHAR(32) NOT NULL DEFAULT 'MANUFACTURED';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'products' AND column_name = 'inventory_item_id') THEN
        ALTER TABLE pos.products ADD COLUMN inventory_item_id UUID REFERENCES pos.inventory_items(id) ON DELETE SET NULL;
    END IF;
END $$;


-- 3. MIGRASI & SINKRONISASI RELASI KE JALUR BARU ------------------------------

-- 3a. Hubungkan produk ritel langsung ke inventory_item_id
UPDATE pos.products p
   SET inventory_item_id = i.id
  FROM pos.inventory_items i
 WHERE i.product_id = p.id
   AND p.inventory_item_id IS NULL;

-- 3b. Klasifikasikan offering_type pada pos.products
UPDATE pos.products
   SET offering_type = 'SERVICE'
 WHERE business_sector IN ('CARWASH', 'BARBERSHOP', 'LAUNDRY');

UPDATE pos.products
   SET offering_type = 'PHYSICAL'
 WHERE business_sector = 'RETAIL';

UPDATE pos.products
   SET offering_type = 'MANUFACTURED'
 WHERE business_sector = 'FNB';

-- 3c. Klasifikasikan item_type pada pos.inventory_items
UPDATE pos.inventory_items i
   SET item_type = 'RETAIL_FINISHED',
       cost_per_unit = COALESCE(p.cost_price, 0.00)
  FROM pos.products p
 WHERE i.product_id = p.id
   AND p.offering_type = 'PHYSICAL';

UPDATE pos.inventory_items i
   SET item_type = 'CONSUMABLE',
       cost_per_unit = COALESCE(p.cost_price, 0.00)
  FROM pos.products p
 WHERE i.product_id = p.id
   AND p.offering_type = 'SERVICE';

UPDATE pos.inventory_items i
   SET item_type = 'RAW_MATERIAL',
       cost_per_unit = COALESCE(ing.cost_per_unit, 0.00)
  FROM pos.ingredients ing
 WHERE i.ingredient_id = ing.id;


-- 4. HAPUS RELASI POLIMORFIK USANG DARI pos.inventory_items -------------------

-- Hapus trigger sinkronisasi lama
DROP TRIGGER IF EXISTS trg_sync_product_inventory_item ON pos.products;
DROP TRIGGER IF EXISTS trg_sync_ingredient_inventory_item ON pos.ingredients;
DROP FUNCTION IF EXISTS pos.fn_sync_product_to_inventory_item();
DROP FUNCTION IF EXISTS pos.fn_sync_ingredient_to_inventory_item();

-- Drop view sebelum menghapus kolom polimorfik
DROP VIEW IF EXISTS contract.catalog CASCADE;
DROP VIEW IF EXISTS public.v_pos_products CASCADE;
DROP VIEW IF EXISTS contract.stock_status CASCADE;
DROP VIEW IF EXISTS public.v_stock_status CASCADE;

-- Hapus kolom polymorphic FK
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_items' AND column_name = 'product_id') THEN
        ALTER TABLE pos.inventory_items DROP COLUMN product_id CASCADE;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_items' AND column_name = 'ingredient_id') THEN
        ALTER TABLE pos.inventory_items DROP COLUMN ingredient_id CASCADE;
    END IF;
END $$;


-- 5. REKONSTRUKSI VIEW KONTRAK YANG BERSIH & DECOUPLED ------------------------

-- 5a. contract.catalog (Katalog Komersial Penjualan)
CREATE VIEW contract.catalog AS
SELECT
    p.business_sector,
    p.tenant_id                                    AS merchant_id,
    t.name                                         AS merchant_name,
    p.id                                           AS product_id,
    p.name                                         AS product_name,
    p.sku,
    p.category_name,
    p.description,
    p.offering_type,
    p.price,
    p.cost_price,
    CASE WHEN p.price > 0
         THEN ROUND(((p.price - p.cost_price) / p.price) * 100, 1)
         ELSE 0 END                                AS margin_pct,
    COALESCE(inv.total_stock, 0)                   AS stock,
    COALESCE(inv.total_min_alert, 0)               AS min_stock_alert,
    COALESCE(inv.total_stock, 0) <= COALESCE(inv.total_min_alert, 0) AS is_low_stock,
    p.is_available,
    p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM pos.products p
  JOIN internal.tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        -- Perhitungan stok fisik jika produk menunjuk langsung ke inventory item
        SELECT 
               b.inventory_item_id,
               SUM(b.current_stock)   AS total_stock,
               SUM(b.min_stock_alert) AS total_min_alert
          FROM pos.inventory_balances b
         GROUP BY b.inventory_item_id
       ) inv ON inv.inventory_item_id = p.inventory_item_id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)    AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(r.created_at)  AS last_sold_at
          FROM pos.transaction_items i
          JOIN contract.merchant_revenue r ON r.id = i.transaction_id
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;

CREATE OR REPLACE VIEW public.v_pos_products AS
  SELECT * FROM contract.catalog;


-- 5b. contract.stock_status (Status Fisik Inventarisasi Gudang)
CREATE VIEW contract.stock_status AS
SELECT
    b.tenant_id,
    b.merchant_id,
    m.name                                             AS merchant_name,
    m.business_sector,
    b.outlet_id,
    o.name                                             AS outlet_name,
    b.location_id,
    l.name                                             AS location_name,
    b.inventory_item_id,
    i.item_name,
    i.sku,
    i.base_unit                                        AS unit,
    i.item_type,
    i.cost_per_unit,
    i.is_stockable,
    b.current_stock,
    b.min_stock_alert,
    b.current_stock <= b.min_stock_alert               AS is_low_stock,
    b.updated_at
  FROM pos.inventory_balances b
  JOIN internal.tenants t             ON t.id = b.tenant_id
  JOIN internal.merchants m           ON m.id = b.merchant_id
  JOIN internal.outlets o             ON o.id = b.outlet_id
  JOIN pos.inventory_items i          ON i.id = b.inventory_item_id
  LEFT JOIN pos.inventory_locations l ON l.id = b.location_id;

CREATE OR REPLACE VIEW public.v_stock_status AS
  SELECT * FROM contract.stock_status;
