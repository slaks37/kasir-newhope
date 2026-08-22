-- =============================================================================
-- 0017_multi_location_branch_inventory.sql
--
-- Implementasi MULTI-LOCATION / BRANCH-AWARE INVENTORY:
--
-- Domain Model:
--   Master Data (Katalog Produk & Resep BOM) -> Tingkat Merchant / Brand
--   Physical Inventory (Lokasi Gudang & Stok Nyata) -> Tingkat Outlet / Cabang
--
-- Entitas:
--   1. pos.inventory_locations -> Lokasi fisik/gudang per cabang (Gudang Utama, Dapur, Bar, Rak Kasir)
--   2. pos.inventory_balances  -> Stok nyata per cabang/lokasi untuk produk & bahan baku
--   3. pos.inventory_logs      -> Mutasi stok dengan pencatatan outlet_id & location_id
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TABEL LOKASI GUDANG / PENYIMPANAN CABANG (pos.inventory_locations) --------

CREATE TABLE IF NOT EXISTS pos.inventory_locations (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    name               VARCHAR(100) NOT NULL DEFAULT 'Gudang Utama',
    is_primary         BOOLEAN NOT NULL DEFAULT TRUE,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_outlet_location_name UNIQUE (outlet_id, name)
);

CREATE INDEX IF NOT EXISTS idx_inv_loc_outlet ON pos.inventory_locations(outlet_id);

COMMENT ON TABLE pos.inventory_locations IS
    'Titik penyimpanan fisik / gudang di dalam cabang toko (Gudang Utama, Dapur, Bar, Rak Display).';


-- 2. TABEL SALDO STOK PER CABANG & LOKASI (pos.inventory_balances) ------------

CREATE TABLE IF NOT EXISTS pos.inventory_balances (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    location_id        UUID REFERENCES pos.inventory_locations(id) ON DELETE CASCADE,
    item_type          VARCHAR(20) NOT NULL DEFAULT 'INGREDIENT', -- 'PRODUCT' | 'INGREDIENT'
    item_id            UUID NOT NULL,                             -- pos.products.id atau pos.ingredients.id
    current_stock      NUMERIC(12, 3) NOT NULL DEFAULT 0,
    min_stock_alert    NUMERIC(12, 3) NOT NULL DEFAULT 10,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inv_balance UNIQUE (outlet_id, location_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_bal_outlet_item ON pos.inventory_balances(outlet_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_merchant    ON pos.inventory_balances(merchant_id);

COMMENT ON TABLE pos.inventory_balances IS
    'Kuantitas stok fisik riil per cabang/outlet dan per lokasi gudang (Branch-Aware Inventory Balance).';


-- 3. PERLUASAN AUDIT MUTASI STOK (pos.inventory_logs) -------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_logs' AND column_name = 'outlet_id') THEN
        ALTER TABLE pos.inventory_logs ADD COLUMN outlet_id UUID REFERENCES internal.outlets(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_logs' AND column_name = 'location_id') THEN
        ALTER TABLE pos.inventory_logs ADD COLUMN location_id UUID REFERENCES pos.inventory_locations(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_logs' AND column_name = 'movement_type') THEN
        ALTER TABLE pos.inventory_logs ADD COLUMN movement_type VARCHAR(32) NOT NULL DEFAULT 'SALE_DEDUCTION'; -- RESTOCK, SALE_DEDUCTION, WASTAGE, TRANSFER_IN, TRANSFER_OUT, AUDIT_ADJUSTMENT
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_logs' AND column_name = 'item_type') THEN
        ALTER TABLE pos.inventory_logs ADD COLUMN item_type VARCHAR(20) NOT NULL DEFAULT 'INGREDIENT';
    END IF;
END $$;


-- 4. INISIALISASI DATA AWAL LOKASI & SALDO STOK -------------------------------

DO $$
DECLARE
    o_rec RECORD;
    p_rec RECORD;
    i_rec RECORD;
    loc_id UUID;
BEGIN
    -- Buat gudang default untuk setiap outlet
    FOR o_rec IN SELECT id, tenant_id, merchant_id FROM internal.outlets LOOP
        loc_id := legacy_uuid(o_rec.id::text || '_loc_main');
        
        INSERT INTO pos.inventory_locations (id, tenant_id, merchant_id, outlet_id, name, is_primary)
        VALUES (loc_id, o_rec.tenant_id, o_rec.merchant_id, o_rec.id, 'Gudang Utama', TRUE)
        ON CONFLICT (outlet_id, name) DO NOTHING;

        -- Inisialisasi saldo stok bahan baku per outlet
        FOR i_rec IN SELECT id, tenant_id, current_stock, min_stock_alert FROM pos.ingredients WHERE tenant_id = o_rec.tenant_id OR tenant_id = o_rec.merchant_id LOOP
            INSERT INTO pos.inventory_balances (tenant_id, merchant_id, outlet_id, location_id, item_type, item_id, current_stock, min_stock_alert)
            VALUES (o_rec.tenant_id, o_rec.merchant_id, o_rec.id, loc_id, 'INGREDIENT', i_rec.id, COALESCE(i_rec.current_stock, 50), COALESCE(i_rec.min_stock_alert, 10))
            ON CONFLICT (outlet_id, location_id, item_type, item_id) DO NOTHING;
        END LOOP;

        -- Inisialisasi saldo stok produk jadi per outlet
        FOR p_rec IN SELECT id, tenant_id, stock, min_stock_alert FROM pos.products WHERE tenant_id = o_rec.tenant_id OR tenant_id = o_rec.merchant_id LOOP
            INSERT INTO pos.inventory_balances (tenant_id, merchant_id, outlet_id, location_id, item_type, item_id, current_stock, min_stock_alert)
            VALUES (o_rec.tenant_id, o_rec.merchant_id, o_rec.id, loc_id, 'PRODUCT', p_rec.id, COALESCE(p_rec.stock, 25), COALESCE(p_rec.min_stock_alert, 5))
            ON CONFLICT (outlet_id, location_id, item_type, item_id) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;


-- 5. KONTRAK CROSS-DOMAIN STOK & MUTASI (contract.*) --------------------------

-- 5a. contract.stock_status (Branch-Aware & Location-Aware)
DROP VIEW IF EXISTS contract.stock_status CASCADE;
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
    b.item_type,
    b.item_id,
    COALESCE(p.name, i.name)                           AS item_name,
    COALESCE(p.sku, i.sku)                             AS sku,
    COALESCE(p.category_name, 'Bahan Baku')           AS category_name,
    COALESCE(i.unit, p.unit, 'pcs')                    AS unit,
    b.current_stock,
    b.min_stock_alert,
    b.current_stock <= b.min_stock_alert               AS is_low_stock,
    COALESCE(p.is_available, TRUE)                     AS is_available,
    b.updated_at
  FROM pos.inventory_balances b
  JOIN internal.tenants t            ON t.id = b.tenant_id
  JOIN internal.merchants m          ON m.id = b.merchant_id
  JOIN internal.outlets o            ON o.id = b.outlet_id
  LEFT JOIN pos.inventory_locations l ON l.id = b.location_id
  LEFT JOIN pos.products p           ON p.id = b.item_id AND b.item_type = 'PRODUCT'
  LEFT JOIN pos.ingredients i        ON i.id = b.item_id AND b.item_type = 'INGREDIENT';

COMMENT ON VIEW contract.stock_status IS
    'Status dan kuantitas stok terperinci per cabang (outlet) dan per gudang penyimpanan (location).';


-- 5b. contract.inventory_movements (Branch-Aware Movement Log)
DROP VIEW IF EXISTS contract.inventory_movements CASCADE;
CREATE VIEW contract.inventory_movements AS
SELECT
    l.id                                               AS movement_id,
    l.tenant_id,
    l.merchant_id,
    m.name                                             AS merchant_name,
    m.business_sector,
    l.outlet_id,
    o.name                                             AS outlet_name,
    l.location_id,
    loc.name                                           AS location_name,
    l.movement_type,
    l.item_type,
    COALESCE(l.ingredient_id, l.item_id)               AS item_id,
    COALESCE(i.name, p.name)                           AS item_name,
    COALESCE(i.sku, p.sku)                             AS sku,
    COALESCE(i.unit, p.unit, 'pcs')                    AS unit,
    l.transaction_id,
    l.quantity_changed,
    l.previous_stock,
    l.new_stock,
    l.reason,
    l.created_at
  FROM pos.inventory_logs l
  LEFT JOIN internal.merchants m           ON m.id = l.merchant_id
  LEFT JOIN internal.outlets o             ON o.id = l.outlet_id
  LEFT JOIN pos.inventory_locations loc   ON loc.id = l.location_id
  LEFT JOIN pos.ingredients i              ON i.id = COALESCE(l.ingredient_id, l.item_id)
  LEFT JOIN pos.products p                 ON p.id = l.item_id;

COMMENT ON VIEW contract.inventory_movements IS
    'Riwayat mutasi keluar/masuk stok terperinci per cabang, per transaksi, dan per jenis mutasi (Restock, Penjualan, Spoilage).';


-- 6. HAK AKSES PERAN ---------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.inventory_locations TO svc_pos;
        GRANT ALL ON pos.inventory_balances  TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT ON contract.stock_status TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT ON contract.inventory_movements TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.stock_status TO bi_readonly;
        GRANT SELECT ON contract.inventory_movements TO bi_readonly;
    END IF;
END $$;


-- 7. VIEW KOMPATIBILITAS PUBLIK ----------------------------------------------

CREATE OR REPLACE VIEW public.v_stock_status AS
  SELECT * FROM contract.stock_status;

CREATE OR REPLACE VIEW public.v_inventory_movements AS
  SELECT * FROM contract.inventory_movements;
