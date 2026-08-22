-- =============================================================================
-- 0023_merchant_audit_and_inventory.sql
--
-- Penyempurnaan Skema Sesuai Audit Arsitektur:
--
-- 1. pos.merchant_audit_logs
--    Memisahkan audit aktivitas kasir/manajer dari platform_audit_logs.
--
-- 2. pos.inventory_items & pos.inventory_transactions (Immutable Ledger)
--    Menyatukan produk dan bahan baku ke dalam satu Directory ID untuk gudang,
--    lalu merombak mutasi stok agar murni sebagai immutable ledger 
--    (SALE, PURCHASE, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT, WASTE, PRODUCTION, RETURN).
--
-- 3. Penghapusan kolom `stock` mentah dari katalog (products & ingredients).
--    Semua kalkulasi berpusat pada `inventory_balances` & `inventory_transactions`.
--
-- 4. Entitas Customer & Loyalty (pos.customers, pos.loyalty_accounts, pos.loyalty_transactions).
--    Kepemilikan jelas di tingkat tenant/merchant. Poin loyalitas menggunakan ledger.
--
-- 5. Bundel Komponen Transaksi (pos.transaction_item_components).
--    Pencatatan rincian paket "Combo" di transaksi untuk pemotongan stok akurat.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. MERCHANT AUDIT LOGS ------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.merchant_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES pos.users(id) ON DELETE SET NULL,
    actor_name VARCHAR(120),
    actor_role VARCHAR(64),
    action_type VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128),
    delta_snapshot JSONB,
    details TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_audit_logs_merchant ON pos.merchant_audit_logs(merchant_id, occurred_at DESC);

COMMENT ON TABLE pos.merchant_audit_logs IS
    'Audit trail operasional merchant (Cashier void order, Manager change price, dsb).';

COMMENT ON TABLE internal.audit_logs IS
    'Platform Audit Logs: Jejak aktivitas sistem dan platform lintas-domain.';


-- 2. UNIFIED INVENTORY DIRECTORY & IMMUTABLE TRANSACTIONS ---------------------

CREATE TABLE IF NOT EXISTS pos.inventory_items (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    product_id UUID REFERENCES pos.products(id) ON DELETE CASCADE,
    ingredient_id UUID REFERENCES pos.ingredients(id) ON DELETE CASCADE,
    item_name VARCHAR(120) NOT NULL,
    sku VARCHAR(64),
    base_unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_inventory_item_xor CHECK (
        (product_id IS NOT NULL AND ingredient_id IS NULL) OR
        (product_id IS NULL AND ingredient_id IS NOT NULL)
    ),
    CONSTRAINT uq_inv_item_product UNIQUE(product_id),
    CONSTRAINT uq_inv_item_ingredient UNIQUE(ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_inv_items_merchant ON pos.inventory_items(merchant_id);

COMMENT ON TABLE pos.inventory_items IS
    'Jembatan persatuan (Directory) katalog produk dan bahan baku untuk modul gudang/inventori.';

-- Mengubah pos.inventory_logs menjadi pos.inventory_transactions (Immutable Ledger)
-- Kita rename tabel lama jika ada, lalu modifikasi. Tapi lebih aman buat tabel baru jika strukturnya jauh beda.
-- Namun, untuk kemudahan, kita buat pos.inventory_transactions sebagai entitas baru yang ideal.

CREATE TABLE IF NOT EXISTS pos.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES pos.inventory_locations(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES pos.inventory_items(id) ON DELETE CASCADE,
    quantity_delta NUMERIC(12, 4) NOT NULL, -- (+/-)
    reference_type VARCHAR(64) NOT NULL, -- SALE, PURCHASE, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT, WASTE, PRODUCTION, RETURN
    reference_id VARCHAR(128),
    reason TEXT,
    performed_by UUID REFERENCES pos.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_inv_tx_location ON pos.inventory_transactions(location_id, inventory_item_id);

COMMENT ON TABLE pos.inventory_transactions IS
    'Buku besar (Ledger) pergerakan mutasi stok fisik. Immutable. Kuantitas direpresentasikan sebagai delta.';


-- 3. MENGHAPUS KOLOM STOK MENTAH DARI KATALOG ---------------------------------

DO $$
BEGIN
    -- Drop dependent views first
    EXECUTE 'DROP VIEW IF EXISTS public.v_pos_products CASCADE';
    EXECUTE 'DROP VIEW IF EXISTS contract.catalog CASCADE';
    EXECUTE 'DROP VIEW IF EXISTS contract.stock_status CASCADE';

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'products' AND column_name = 'stock') THEN
        ALTER TABLE pos.products DROP COLUMN stock CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'products' AND column_name = 'min_stock_alert') THEN
        ALTER TABLE pos.products DROP COLUMN min_stock_alert CASCADE;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'ingredients' AND column_name = 'current_stock') THEN
        ALTER TABLE pos.ingredients DROP COLUMN current_stock CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'ingredients' AND column_name = 'min_stock_alert') THEN
        ALTER TABLE pos.ingredients DROP COLUMN min_stock_alert CASCADE;
    END IF;
END $$;


-- 4. KEPEMILIKAN CUSTOMER & LOYALTY -------------------------------------------

CREATE TABLE IF NOT EXISTS pos.customers (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(32),
    email VARCHAR(120),
    tier VARCHAR(32) NOT NULL DEFAULT 'BRONZE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_customers_merchant ON pos.customers(merchant_id);

CREATE TABLE IF NOT EXISTS pos.loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES pos.customers(id) ON DELETE CASCADE,
    current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_loyalty_customer UNIQUE(customer_id)
);

CREATE TABLE IF NOT EXISTS pos.loyalty_transactions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    loyalty_account_id UUID NOT NULL REFERENCES pos.loyalty_accounts(id) ON DELETE CASCADE,
    points_delta NUMERIC(12, 2) NOT NULL, -- (+/-)
    reference_type VARCHAR(64) NOT NULL, -- EARN_PURCHASE, REDEEM_ORDER, ADJUSTMENT, EXPIRATION
    reference_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- 5. BUNDLE COMPONENT BREAKDOWN (ORDER) ---------------------------------------

CREATE TABLE IF NOT EXISTS pos.transaction_item_components (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    transaction_item_id UUID NOT NULL REFERENCES pos.transaction_items(id) ON DELETE CASCADE,
    component_item_id UUID NOT NULL REFERENCES pos.inventory_items(id) ON DELETE CASCADE,
    quantity NUMERIC(10, 4) NOT NULL DEFAULT 1.0,
    unit_cost_snapshot NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tx_item_components ON pos.transaction_item_components(transaction_item_id);

COMMENT ON TABLE pos.transaction_item_components IS
    'Pemecahan rincian produk bundle dalam pesanan kasir agar mutasi stok bisa dipotong per komponen.';


-- 6. PERBAIKAN VIEW -----------------------------------------------------------

-- Perbaiki contract.stock_status (Tanpa bergantung pada p.is_available yang mungkin dihapus, atau menyesuaikan join)
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
    COALESCE(p.category_name, 'Bahan Baku')            AS category_name,
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

-- contract.inventory_movements akan disesuaikan dengan pos.inventory_transactions (Immutable Ledger)
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
    ii.product_id IS NOT NULL                          AS is_product,
    ii.item_name,
    ii.sku,
    ii.base_unit                                       AS unit,
    tx.reference_id                                    AS transaction_id,
    tx.quantity_delta,
    tx.reason,
    tx.created_at
  FROM pos.inventory_transactions tx
  JOIN pos.inventory_items ii              ON ii.id = tx.inventory_item_id
  LEFT JOIN internal.merchants m           ON m.id = tx.merchant_id
  LEFT JOIN internal.outlets o             ON o.id = tx.outlet_id
  LEFT JOIN pos.inventory_locations loc    ON loc.id = tx.location_id;

CREATE OR REPLACE VIEW public.v_stock_status AS
  SELECT * FROM contract.stock_status;

CREATE OR REPLACE VIEW public.v_inventory_movements AS
  SELECT * FROM contract.inventory_movements;

-- Memperbarui contract.catalog agar menghitung stok dari inventory_balances (agregat semua cabang)
DROP VIEW IF EXISTS contract.catalog CASCADE;
CREATE VIEW contract.catalog AS
SELECT
    p.business_sector,
    p.tenant_id                                    AS merchant_id,
    t.name                                         AS merchant_name,
    p.id                                           AS product_id,
    p.name                                         AS product_name,
    p.sku, p.category_name, p.description, p.price, p.cost_price,
    CASE WHEN p.price > 0
         THEN ROUND(((p.price - p.cost_price) / p.price) * 100, 1)
         ELSE 0 END                                AS margin_pct,
    COALESCE(inv.total_stock, 0)                   AS stock,
    COALESCE(inv.total_min_alert, 0)               AS min_stock_alert,
    COALESCE(inv.total_stock, 0) <= COALESCE(inv.total_min_alert, 0) AS is_low_stock,
    p.is_available, p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM pos.products p
  JOIN internal.tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        SELECT item_id,
               SUM(current_stock) AS total_stock,
               SUM(min_stock_alert) AS total_min_alert
          FROM pos.inventory_balances
         WHERE item_type = 'PRODUCT'
         GROUP BY item_id
       ) inv ON inv.item_id = p.id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)    AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(r.created_at)  AS last_sold_at
          FROM pos.transaction_items i
          JOIN contract.merchant_revenue r ON r.id = i.transaction_id
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;

