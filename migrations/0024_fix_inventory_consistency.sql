-- =============================================================================
-- 0024_fix_inventory_consistency.sql
--
-- Perbaikan Bug Arsitektural dari 0023:
-- 1. Migrasi Data & Trigger Sinkronisasi untuk pos.inventory_items
-- 2. Refactor pos.inventory_balances agar menunjuk ke inventory_item_id
-- 3. Migrasi historis pos.inventory_logs ke pos.inventory_transactions
-- 4. Trigger Immutable Ledger untuk otomatis update saldo stok
-- 5. Perbaikan View contract.stock_status
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. MIGRASI DATA & TRIGGER SINKRONISASI --------------------------------------

-- 1a. Migrasi data lama dari produk
INSERT INTO pos.inventory_items (tenant_id, merchant_id, product_id, item_name, sku, base_unit)
SELECT tenant_id, tenant_id AS merchant_id, id, name, sku, 'pcs'
  FROM pos.products
 ON CONFLICT (product_id) DO NOTHING;

-- 1b. Migrasi data lama dari bahan baku
INSERT INTO pos.inventory_items (tenant_id, merchant_id, ingredient_id, item_name, sku, base_unit)
SELECT tenant_id, tenant_id AS merchant_id, id, name, sku, unit
  FROM pos.ingredients
 ON CONFLICT (ingredient_id) DO NOTHING;

-- 1c. Fungsi Trigger Sinkronisasi Katalog -> Inventory Items
CREATE OR REPLACE FUNCTION pos.fn_sync_product_to_inventory_item()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO pos.inventory_items (tenant_id, merchant_id, product_id, item_name, sku, base_unit)
        VALUES (NEW.tenant_id, NEW.tenant_id, NEW.id, NEW.name, NEW.sku, 'pcs');
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE pos.inventory_items
           SET item_name = NEW.name,
               sku = NEW.sku
         WHERE product_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pos.fn_sync_ingredient_to_inventory_item()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO pos.inventory_items (tenant_id, merchant_id, ingredient_id, item_name, sku, base_unit)
        VALUES (NEW.tenant_id, NEW.tenant_id, NEW.id, NEW.name, NEW.sku, NEW.unit);
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE pos.inventory_items
           SET item_name = NEW.name,
               sku = NEW.sku,
               base_unit = NEW.unit
         WHERE ingredient_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Hapus trigger lama jika ada
DROP TRIGGER IF EXISTS trg_sync_product_inventory_item ON pos.products;
DROP TRIGGER IF EXISTS trg_sync_ingredient_inventory_item ON pos.ingredients;

CREATE TRIGGER trg_sync_product_inventory_item
AFTER INSERT OR UPDATE OF name, sku ON pos.products
FOR EACH ROW EXECUTE FUNCTION pos.fn_sync_product_to_inventory_item();

CREATE TRIGGER trg_sync_ingredient_inventory_item
AFTER INSERT OR UPDATE OF name, sku, unit ON pos.ingredients
FOR EACH ROW EXECUTE FUNCTION pos.fn_sync_ingredient_to_inventory_item();


-- 2. REFACTOR INVENTORY BALANCES ----------------------------------------------

-- 2a. Tambahkan kolom inventory_item_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_balances' AND column_name = 'inventory_item_id') THEN
        ALTER TABLE pos.inventory_balances ADD COLUMN inventory_item_id UUID REFERENCES pos.inventory_items(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2b. Migrasi relasi
UPDATE pos.inventory_balances b
   SET inventory_item_id = i.id
  FROM pos.inventory_items i
 WHERE b.inventory_item_id IS NULL
   AND (
       (b.item_type = 'PRODUCT' AND b.item_id = i.product_id) OR
       (b.item_type = 'INGREDIENT' AND b.item_id = i.ingredient_id)
   );

-- 2c. Validasi & Drop kolom polimorfik usang (pastikan tidak NULL)
DO $$
BEGIN
    -- Hapus entri yatim piatu
    DELETE FROM pos.inventory_balances WHERE inventory_item_id IS NULL;
    
    ALTER TABLE pos.inventory_balances ALTER COLUMN inventory_item_id SET NOT NULL;
    
    -- Ubah constraint unik
    ALTER TABLE pos.inventory_balances DROP CONSTRAINT IF EXISTS uq_inv_balance;
    ALTER TABLE pos.inventory_balances ADD CONSTRAINT uq_inv_balance UNIQUE (outlet_id, location_id, inventory_item_id);

    -- Hapus view yang bergantung
    EXECUTE 'DROP VIEW IF EXISTS contract.stock_status CASCADE';
    EXECUTE 'DROP VIEW IF EXISTS public.v_stock_status CASCADE';

    -- Hapus kolom usang
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_balances' AND column_name = 'item_type') THEN
        ALTER TABLE pos.inventory_balances DROP COLUMN item_type CASCADE;
        ALTER TABLE pos.inventory_balances DROP COLUMN item_id CASCADE;
    END IF;
END $$;


-- 3. MIGRASI HISTORIS & HAPUS INVENTORY LOGS ----------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pos' AND table_name = 'inventory_logs') THEN
        -- Insert data lama (jika ada) ke inventory_transactions
        INSERT INTO pos.inventory_transactions (tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, quantity_delta, reference_type, reference_id, reason, performed_by, created_at)
        SELECT 
            l.tenant_id, 
            COALESCE(l.merchant_id, l.tenant_id), 
            l.outlet_id, 
            l.location_id, 
            i.id,
            l.quantity_changed,
            COALESCE(l.movement_type, 'ADJUSTMENT'),
            l.transaction_id::varchar,
            l.reason,
            NULL,
            l.created_at
          FROM pos.inventory_logs l
          JOIN pos.inventory_items i ON (
              (l.item_type = 'PRODUCT' AND l.item_id = i.product_id) OR
              (l.item_type = 'INGREDIENT' AND l.item_id = i.ingredient_id)
          );

        -- Hapus view lama yang mungkin bergantung
        EXECUTE 'DROP VIEW IF EXISTS contract.inventory_movements CASCADE';
        EXECUTE 'DROP VIEW IF EXISTS public.v_inventory_movements CASCADE';

        -- Drop table
        DROP TABLE pos.inventory_logs CASCADE;
    END IF;
END $$;


-- 4. TRIGGER IMMUTABLE LEDGER UNTUK TRANSACTIONS -> BALANCES ------------------

CREATE OR REPLACE FUNCTION pos.fn_apply_inventory_transaction()
RETURNS TRIGGER AS $$
BEGIN
    -- Upsert ke inventory_balances
    INSERT INTO pos.inventory_balances (
        tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, current_stock, updated_at
    ) VALUES (
        NEW.tenant_id, NEW.merchant_id, NEW.outlet_id, NEW.location_id, NEW.inventory_item_id, NEW.quantity_delta, CURRENT_TIMESTAMP
    )
    ON CONFLICT (outlet_id, location_id, inventory_item_id)
    DO UPDATE SET 
        current_stock = pos.inventory_balances.current_stock + EXCLUDED.current_stock,
        updated_at = CURRENT_TIMESTAMP;
        
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_inventory_transaction ON pos.inventory_transactions;

CREATE TRIGGER trg_apply_inventory_transaction
AFTER INSERT ON pos.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION pos.fn_apply_inventory_transaction();


-- 5. PERBAIKAN VIEW -----------------------------------------------------------

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
    i.product_id IS NOT NULL                           AS is_product,
    b.current_stock,
    b.min_stock_alert,
    b.current_stock <= b.min_stock_alert               AS is_low_stock,
    b.updated_at
  FROM pos.inventory_balances b
  JOIN internal.tenants t            ON t.id = b.tenant_id
  JOIN internal.merchants m          ON m.id = b.merchant_id
  JOIN internal.outlets o            ON o.id = b.outlet_id
  JOIN pos.inventory_items i         ON i.id = b.inventory_item_id
  LEFT JOIN pos.inventory_locations l ON l.id = b.location_id;

CREATE OR REPLACE VIEW public.v_stock_status AS
  SELECT * FROM contract.stock_status;

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

CREATE OR REPLACE VIEW public.v_inventory_movements AS
  SELECT * FROM contract.inventory_movements;
