-- =============================================================================
-- 0019_variants_modifiers_and_order_snapshots.sql
--
-- Implementasi PRODUCT VARIANTS, MODIFIER INVENTORY BOM, & TRANSACTION SNAPSHOTS:
--
-- Masalah sebelumnya:
--   1. Modifier tidak terhubung ke bahan baku (Extra Shot dijual, kopi tidak berkurang).
--   2. Variant tidak tersimpan di baris transaksi (Latte Large dicatat hanya Latte).
--   3. Baris transaksi tidak mengunci snapshot harga/modal (saat harga menu naik, historical ikut berubah).
--
-- Solusi Arsitektur Baru:
--   1. pos.product_variants: Definisi variasi produk (Ukuran, Rasa, Suhu) per merchant.
--   2. pos.modifiers & pos.modifier_recipes: Definisi modifier dan pemotongan stok bahan baku (Modifier BOM).
--   3. pos.transaction_items: Snapshot permanen nama produk, varian, SKU, harga satuan, dan HPP modal.
--   4. pos.transaction_item_modifiers: Rincian transaksi modifier dengan snapshot harga.
--   5. contract.transaction_items_detailed: Single source of truth untuk audit histori transaksi & HPP riil.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TABEL VARIAN PRODUK (pos.product_variants) -------------------------------

CREATE TABLE IF NOT EXISTS pos.product_variants (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    product_id         UUID NOT NULL REFERENCES pos.products(id) ON DELETE CASCADE,
    variant_name       VARCHAR(100) NOT NULL, -- misal: 'Regular', 'Large', 'Hot', 'Iced'
    sku                VARCHAR(64),
    price_adjustment   NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cost_adjustment    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_variant_name UNIQUE (product_id, variant_name)
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON pos.product_variants(product_id);

COMMENT ON TABLE pos.product_variants IS
    'Varian ukuran, suhu, atau tipe produk dengan penyesuaian harga jual dan HPP modal.';


-- 2. TABEL MODIFIER & RESEP MODIFIER (pos.modifiers & pos.modifier_recipes) ----

CREATE TABLE IF NOT EXISTS pos.modifiers (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    name               VARCHAR(100) NOT NULL, -- misal: 'Extra Shot Espresso', 'Oat Milk Swap', 'Caramel Drizzle'
    price              NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cost_price         NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_merchant_modifier_name UNIQUE (merchant_id, name)
);

CREATE TABLE IF NOT EXISTS pos.modifier_recipes (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    modifier_id        UUID NOT NULL REFERENCES pos.modifiers(id) ON DELETE CASCADE,
    ingredient_id      UUID NOT NULL REFERENCES pos.ingredients(id) ON DELETE CASCADE,
    quantity_required  NUMERIC(12, 4) NOT NULL, -- misal: 8.00 gram biji kopi untuk Extra Shot
    unit               VARCHAR(32) NOT NULL DEFAULT 'gram',
    wastage_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_modifier_ingredient UNIQUE (modifier_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_modifier_recipes_mod ON pos.modifier_recipes(modifier_id);

COMMENT ON TABLE pos.modifiers IS
    'Katalog add-on / modifier tambahan pesanan (Extra Shot, Oat Milk, Topping).';

COMMENT ON TABLE pos.modifier_recipes IS
    'Bill of Materials (BOM) pemotongan stok bahan baku mentah ketika modifier dipesan.';


-- 3. PERLUASAN pos.transaction_items UNTUK SNAPSHOTTING -----------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'variant_id') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN variant_id UUID REFERENCES pos.product_variants(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'product_name_snapshot') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN product_name_snapshot VARCHAR(150);
        UPDATE pos.transaction_items SET product_name_snapshot = product_name WHERE product_name_snapshot IS NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'variant_name_snapshot') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN variant_name_snapshot VARCHAR(120);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'sku_snapshot') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN sku_snapshot VARCHAR(64);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'unit_cost') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'subtotal') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN subtotal NUMERIC(12, 2);
        UPDATE pos.transaction_items SET subtotal = total_price WHERE subtotal IS NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'discount_amount') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'modifier_snapshot') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN modifier_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transaction_items' AND column_name = 'notes') THEN
        ALTER TABLE pos.transaction_items ADD COLUMN notes VARCHAR(255);
    END IF;
END $$;

COMMENT ON TABLE pos.transaction_items IS
    'Rincian baris pesanan kasir dengan snapshot permanen harga, HPP modal, nama varian, dan JSON modifier.';


-- 4. TABEL DETAIL TRANSAKSI MODIFIER (pos.transaction_item_modifiers) ----------

CREATE TABLE IF NOT EXISTS pos.transaction_item_modifiers (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    transaction_item_id    UUID NOT NULL REFERENCES pos.transaction_items(id) ON DELETE CASCADE,
    modifier_id            UUID REFERENCES pos.modifiers(id) ON DELETE SET NULL,
    modifier_name_snapshot VARCHAR(120) NOT NULL,
    unit_price             NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    unit_cost              NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    quantity               NUMERIC(10, 3) NOT NULL DEFAULT 1.0,
    total_price            NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tx_item_mods ON pos.transaction_item_modifiers(transaction_item_id);

COMMENT ON TABLE pos.transaction_item_modifiers IS
    'Pencatatan rincian add-on / modifier per item transaksi dengan snapshot harga historis.';


-- 5. KONTRAK CROSS-DOMAIN RINCIAN TRANSAKSI (contract.transaction_items_detailed)

DROP VIEW IF EXISTS contract.transaction_items_detailed CASCADE;
CREATE VIEW contract.transaction_items_detailed AS
SELECT
    ti.id                                                AS item_id,
    ti.transaction_id,
    t.invoice_number,
    t.tenant_id,
    t.merchant_id,
    m.name                                               AS merchant_name,
    m.business_sector,
    t.outlet_id,
    o.name                                               AS outlet_name,
    ti.product_id,
    COALESCE(ti.product_name_snapshot, ti.product_name)  AS product_name,
    ti.category_name,
    ti.variant_id,
    ti.variant_name_snapshot                             AS variant_name,
    ti.sku_snapshot                                      AS sku,
    ti.unit_price,
    ti.unit_cost,
    ti.quantity,
    ti.subtotal,
    ti.discount_amount,
    ti.total_price,
    ROUND((ti.total_price - (ti.unit_cost * ti.quantity))::numeric, 2) AS gross_profit,
    ti.modifier_snapshot,
    ti.notes,
    t.created_at                                         AS transaction_at
  FROM pos.transaction_items ti
  JOIN pos.transactions t      ON t.id = ti.transaction_id
  JOIN internal.merchants m    ON m.id = t.merchant_id
  LEFT JOIN internal.outlets o ON o.id = t.outlet_id;

COMMENT ON VIEW contract.transaction_items_detailed IS
    'Laporan detail baris item transaksi penjualan dengan snapshot harga, varian, HPP modal riil, dan laba kotor.';


-- 6. HAK AKSES PERAN ---------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.product_variants            TO svc_pos;
        GRANT ALL ON pos.modifiers                   TO svc_pos;
        GRANT ALL ON pos.modifier_recipes            TO svc_pos;
        GRANT ALL ON pos.transaction_item_modifiers  TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT ON contract.transaction_items_detailed TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.transaction_items_detailed TO bi_readonly;
    END IF;
END $$;


-- 7. VIEW KOMPATIBILITAS PUBLIK ----------------------------------------------

CREATE OR REPLACE VIEW public.v_transaction_items_detailed AS
  SELECT * FROM contract.transaction_items_detailed;
