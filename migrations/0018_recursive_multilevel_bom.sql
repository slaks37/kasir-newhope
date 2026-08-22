-- =============================================================================
-- 0018_recursive_multilevel_bom.sql
--
-- Implementasi MULTI-LEVEL RECURSIVE BILL OF MATERIALS (BOM):
--
-- Masalah sebelumnya:
--   product_recipes hanya mendukung 1-level flat (Product -> Ingredient).
--
-- Solusi Arsitektur Baru (ERP-Grade Multi-Level BOM):
--   1. Klasifikasi Item: FINISHED_GOOD, SEMI_FINISHED, RAW_MATERIAL, PACKAGING.
--   2. pos.recipes: Definisi formula/resep yang menghasilkan item output (baik Produk Jadi maupun Barang Setengah Jadi).
--   3. pos.recipe_items: Komponen bahan input yang dapat mereferensikan RAW_MATERIAL maupun SEMI_FINISHED item lain (Recursive).
--   4. contract.bom_explosion: Recursive CTE yang otomatis mengurai pohon BOM bertingkat (Level 1, 2, 3+) hingga bahan mentah dasar.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. EXTEND INGREDIENTS & PRODUCTS CLASSIFICATION -----------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'ingredients' AND column_name = 'item_classification') THEN
        ALTER TABLE pos.ingredients ADD COLUMN item_classification VARCHAR(32) NOT NULL DEFAULT 'RAW_MATERIAL'; -- RAW_MATERIAL, SEMI_FINISHED, PACKAGING
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'ingredients' AND column_name = 'cost_per_unit') THEN
        ALTER TABLE pos.ingredients ADD COLUMN cost_per_unit NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'products' AND column_name = 'item_classification') THEN
        ALTER TABLE pos.products ADD COLUMN item_classification VARCHAR(32) NOT NULL DEFAULT 'FINISHED_GOOD'; -- FINISHED_GOOD, SERVICE
    END IF;
END $$;


-- 2. TABEL HEADER FORMULA / RESEP RECURSIVE (pos.recipes) --------------------

CREATE TABLE IF NOT EXISTS pos.recipes (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    output_item_type   VARCHAR(20) NOT NULL DEFAULT 'PRODUCT', -- 'PRODUCT' (Finished Good) | 'INGREDIENT' (Semi-Finished)
    output_item_id     UUID NOT NULL,                          -- ID item yang dihasilkan
    recipe_name        VARCHAR(120) NOT NULL,
    yield_quantity     NUMERIC(12, 4) NOT NULL DEFAULT 1.0000, -- Kuantitas hasil racikan
    yield_unit         VARCHAR(32) NOT NULL DEFAULT 'portion', -- Satuan hasil: portion, ml, gram, batch
    instructions       TEXT,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_output UNIQUE (merchant_id, output_item_type, output_item_id)
);

CREATE INDEX IF NOT EXISTS idx_recipes_merchant ON pos.recipes(merchant_id);
CREATE INDEX IF NOT EXISTS idx_recipes_output   ON pos.recipes(output_item_id);

COMMENT ON TABLE pos.recipes IS
    'Header Formula / Resep BOM. Dapat menghasilkan Produk Jadi (Finished Good) maupun Barang Setengah Jadi (Semi-Finished Prep).';


-- 3. TABEL DETAIL KOMPONEN RESEP (pos.recipe_items) ---------------------------

CREATE TABLE IF NOT EXISTS pos.recipe_items (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    recipe_id          UUID NOT NULL REFERENCES pos.recipes(id) ON DELETE CASCADE,
    input_item_type    VARCHAR(20) NOT NULL DEFAULT 'INGREDIENT', -- 'RAW_MATERIAL' | 'SEMI_FINISHED' | 'INGREDIENT' | 'PRODUCT'
    input_item_id      UUID NOT NULL,                             -- ID bahan baku mentah atau item setengah jadi
    quantity           NUMERIC(12, 4) NOT NULL,                   -- Kuantitas pemakaian
    unit               VARCHAR(32) NOT NULL DEFAULT 'gram',       -- Satuan: gram, ml, shot, pcs
    wastage_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,       -- Toleransi susut proses (%)
    notes              VARCHAR(255),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recipe_item UNIQUE (recipe_id, input_item_type, input_item_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON pos.recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_input  ON pos.recipe_items(input_item_id);

COMMENT ON TABLE pos.recipe_items IS
    'Komponen detail bahan input BOM. Dapat mereferensikan bahan mentah dasar maupun resep setengah jadi lainnya (Recursive BOM).';


-- 4. MIGRASI DATA DARI pos.product_recipes LAMA KE pos.recipes & recipe_items -

DO $$
DECLARE
    pr RECORD;
    rec_id UUID;
BEGIN
    FOR pr IN 
        SELECT DISTINCT product_id, tenant_id FROM pos.product_recipes
    LOOP
        rec_id := legacy_uuid(pr.product_id::text || '_recipe');
        
        INSERT INTO pos.recipes (id, tenant_id, merchant_id, output_item_type, output_item_id, recipe_name, yield_quantity, yield_unit)
        VALUES (rec_id, pr.tenant_id, pr.tenant_id, 'PRODUCT', pr.product_id, 'Resep Standar Produk', 1.0, 'portion')
        ON CONFLICT (merchant_id, output_item_type, output_item_id) DO UPDATE 
        SET updated_at = CURRENT_TIMESTAMP;

        INSERT INTO pos.recipe_items (recipe_id, input_item_type, input_item_id, quantity, unit)
        SELECT rec_id, 'INGREDIENT', ingredient_id, quantity_required, unit
          FROM pos.product_recipes
         WHERE product_id = pr.product_id
        ON CONFLICT (recipe_id, input_item_type, input_item_id) DO NOTHING;
    END LOOP;
END $$;


-- 5. KONTRAK RECURSIVE BOM EXPLOSION (contract.bom_explosion) -----------------

DROP VIEW IF EXISTS contract.bom_explosion CASCADE;
CREATE VIEW contract.bom_explosion AS
WITH RECURSIVE bom_tree AS (
    -- LEVEL 1: Bahan input langsung untuk Produk Jadi (Finished Good)
    SELECT
        r.tenant_id,
        r.merchant_id,
        r.output_item_id                                     AS root_product_id,
        r.output_item_type                                   AS root_product_type,
        r.recipe_name                                        AS root_recipe_name,
        r.id                                                 AS recipe_id,
        ri.id                                                AS recipe_item_id,
        ri.input_item_type,
        ri.input_item_id,
        ri.quantity                                          AS step_quantity,
        ri.quantity                                          AS total_effective_quantity,
        ri.unit,
        ri.wastage_percentage,
        1                                                    AS bom_level,
        ARRAY[r.output_item_id]                              AS path
    FROM pos.recipes r
    JOIN pos.recipe_items ri ON ri.recipe_id = r.id
    WHERE r.is_active = TRUE

    UNION ALL

    -- LEVEL 2+: Rekursif mengurai jika input_item_id adalah SEMI_FINISHED yang memiliki sub-resep
    SELECT
        parent.tenant_id,
        parent.merchant_id,
        parent.root_product_id,
        parent.root_product_type,
        parent.root_recipe_name,
        sub_r.id                                             AS recipe_id,
        sub_ri.id                                            AS recipe_item_id,
        sub_ri.input_item_type,
        sub_ri.input_item_id,
        sub_ri.quantity                                      AS step_quantity,
        (parent.total_effective_quantity * (sub_ri.quantity / NULLIF(sub_r.yield_quantity, 0))) 
          * (1.0 + (sub_ri.wastage_percentage / 100.0))      AS total_effective_quantity,
        sub_ri.unit,
        sub_ri.wastage_percentage,
        parent.bom_level + 1                                 AS bom_level,
        parent.path || sub_r.output_item_id                  AS path
    FROM bom_tree parent
    JOIN pos.recipes sub_r ON sub_r.output_item_id = parent.input_item_id AND sub_r.is_active = TRUE
    JOIN pos.recipe_items sub_ri ON sub_ri.recipe_id = sub_r.id
    WHERE NOT (sub_r.output_item_id = ANY(parent.path))
      AND parent.bom_level < 10
)
SELECT
    b.tenant_id,
    b.merchant_id,
    b.root_product_id,
    p.name                                                   AS root_product_name,
    p.sku                                                    AS root_product_sku,
    b.root_recipe_name,
    b.bom_level,
    b.recipe_id,
    b.recipe_item_id,
    b.input_item_type,
    b.input_item_id,
    COALESCE(i.name, sp.name, 'Item ' || b.input_item_id::text) AS input_item_name,
    COALESCE(i.sku, sp.sku, '')                              AS input_item_sku,
    COALESCE(i.item_classification, 'RAW_MATERIAL')          AS input_item_classification,
    b.step_quantity,
    b.total_effective_quantity,
    b.unit,
    b.wastage_percentage,
    COALESCE(i.cost_per_unit, 0.00)                          AS unit_cost,
    ROUND((b.total_effective_quantity * COALESCE(i.cost_per_unit, 0.00))::numeric, 2) AS estimated_cost
FROM bom_tree b
LEFT JOIN pos.products p    ON p.id = b.root_product_id
LEFT JOIN pos.ingredients i ON i.id = b.input_item_id
LEFT JOIN pos.products sp   ON sp.id = b.input_item_id;

COMMENT ON VIEW contract.bom_explosion IS
    'Penguraian pohon Bill of Materials (BOM) bertingkat secara rekursif (Level 1, Level 2, Level 3+) dari produk jadi hingga bahan mentah.';


-- 6. HAK AKSES PERAN DATABASE ------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.recipes      TO svc_pos;
        GRANT ALL ON pos.recipe_items TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT ON contract.bom_explosion TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.bom_explosion TO bi_readonly;
    END IF;
END $$;


-- 7. VIEW KOMPATIBILITAS PUBLIK ----------------------------------------------

CREATE OR REPLACE VIEW public.v_bom_explosion AS
  SELECT * FROM contract.bom_explosion;
