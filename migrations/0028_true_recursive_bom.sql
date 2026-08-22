-- =============================================================================
-- 0028_true_recursive_bom.sql
--
-- Implementasi TRUE RECURSIVE BILL OF MATERIALS (BOM) & TYPE-SAFE INVENTORY LINK:
-- 1. pos.recipes:
--    - output_product_id (FK pos.products) untuk Produk Komersial Jadi
--    - output_inventory_item_id (FK pos.inventory_items) untuk Olahan Semi-Finished
--    - CHECK constraint eksklusif (Tepat 1 output target)
-- 2. pos.recipe_items:
--    - inventory_item_id (FK pos.inventory_items NOT NULL)
-- 3. pos.modifier_recipes:
--    - inventory_item_id (FK pos.inventory_items NOT NULL)
-- 4. contract.bom_explosion (Recursive CTE Multi-Level BOM Solver)
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. REFACTOR TABEL HEADER RESEP (pos.recipes) --------------------------------

DO $$
BEGIN
    -- Unique constraint SKU per merchant
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_merchant_inventory_sku') THEN
        -- Hapus duplikat jika ada sebelum pasang constraint
        DELETE FROM pos.inventory_items a USING pos.inventory_items b
         WHERE a.id > b.id AND a.merchant_id = b.merchant_id AND a.sku = b.sku;

        ALTER TABLE pos.inventory_items ADD CONSTRAINT uq_merchant_inventory_sku UNIQUE (merchant_id, sku);
    END IF;

    -- Tambahkan FK output terpisah
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'recipes' AND column_name = 'output_product_id') THEN
        ALTER TABLE pos.recipes ADD COLUMN output_product_id UUID REFERENCES pos.products(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'recipes' AND column_name = 'output_inventory_item_id') THEN
        ALTER TABLE pos.recipes ADD COLUMN output_inventory_item_id UUID REFERENCES pos.inventory_items(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Migrasi data lama output_item_id ke kolom FK baru
UPDATE pos.recipes
   SET output_product_id = output_item_id
 WHERE output_item_type = 'PRODUCT'
   AND output_product_id IS NULL;

UPDATE pos.recipes
   SET output_inventory_item_id = output_item_id
 WHERE output_item_type = 'INGREDIENT'
   AND output_inventory_item_id IS NULL;

-- Bersihkan kolom & constraint polimorfik lama
ALTER TABLE pos.recipes DROP CONSTRAINT IF EXISTS uq_recipe_output;
ALTER TABLE pos.recipes DROP CONSTRAINT IF EXISTS chk_recipe_output_target;

-- Pasang CHECK constraint bahwa resep harus menghasilkan salah satu (Product atau Inventory Item)
ALTER TABLE pos.recipes ADD CONSTRAINT chk_recipe_output_target CHECK (
    (output_product_id IS NOT NULL AND output_inventory_item_id IS NULL) OR
    (output_product_id IS NULL AND output_inventory_item_id IS NOT NULL)
);

-- Unique constraint per merchant & output (Standard UNIQUE in Postgres allows multiple NULLs)
ALTER TABLE pos.recipes DROP CONSTRAINT IF EXISTS uq_recipe_merchant_output_product;
ALTER TABLE pos.recipes DROP CONSTRAINT IF EXISTS uq_recipe_merchant_output_inv;

ALTER TABLE pos.recipes ADD CONSTRAINT uq_recipe_merchant_output_product UNIQUE (merchant_id, output_product_id);
ALTER TABLE pos.recipes ADD CONSTRAINT uq_recipe_merchant_output_inv UNIQUE (merchant_id, output_inventory_item_id);

-- Hapus kolom legacy dari pos.recipes
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'recipes' AND column_name = 'output_item_id') THEN
        ALTER TABLE pos.recipes DROP COLUMN output_item_id CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'recipes' AND column_name = 'output_item_type') THEN
        ALTER TABLE pos.recipes DROP COLUMN output_item_type CASCADE;
    END IF;
END $$;


-- 2. REFACTOR KOMPONEN RESEP (pos.recipe_items) --------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'recipe_items' AND column_name = 'inventory_item_id') THEN
        ALTER TABLE pos.recipe_items ADD COLUMN inventory_item_id UUID REFERENCES pos.inventory_items(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Migrasi input_item_id ke inventory_item_id
UPDATE pos.recipe_items ri
   SET inventory_item_id = ri.input_item_id
 WHERE ri.inventory_item_id IS NULL
   AND EXISTS (SELECT 1 FROM pos.inventory_items i WHERE i.id = ri.input_item_id);

-- Bersihkan data yatim (jika ada) lalu kunci constraint
DELETE FROM pos.recipe_items WHERE inventory_item_id IS NULL;

ALTER TABLE pos.recipe_items DROP CONSTRAINT IF EXISTS uq_recipe_item;
ALTER TABLE pos.recipe_items DROP CONSTRAINT IF EXISTS uq_recipe_inventory_item;

ALTER TABLE pos.recipe_items ADD CONSTRAINT uq_recipe_inventory_item UNIQUE (recipe_id, inventory_item_id);

-- Hapus kolom legacy dari pos.recipe_items
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'recipe_items' AND column_name = 'input_item_id') THEN
        ALTER TABLE pos.recipe_items DROP COLUMN input_item_id CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'recipe_items' AND column_name = 'input_item_type') THEN
        ALTER TABLE pos.recipe_items DROP COLUMN input_item_type CASCADE;
    END IF;
END $$;


-- 3. REFACTOR MODIFIER RECIPES (pos.modifier_recipes) -------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pos' AND table_name = 'modifier_recipes') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'modifier_recipes' AND column_name = 'inventory_item_id') THEN
            ALTER TABLE pos.modifier_recipes ADD COLUMN inventory_item_id UUID REFERENCES pos.inventory_items(id) ON DELETE CASCADE;
        END IF;

        -- Update relasi jika ada kolom ingredient_id lama
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'modifier_recipes' AND column_name = 'ingredient_id') THEN
            UPDATE pos.modifier_recipes mr
               SET inventory_item_id = mr.ingredient_id
             WHERE mr.inventory_item_id IS NULL
               AND EXISTS (SELECT 1 FROM pos.inventory_items i WHERE i.id = mr.ingredient_id);
        END IF;
    END IF;
END $$;


-- 4. KONTRAK RECURSIVE BOM EXPLOSION (contract.bom_explosion) -----------------

DROP VIEW IF EXISTS contract.bom_explosion CASCADE;
CREATE VIEW contract.bom_explosion AS
WITH RECURSIVE bom_tree AS (
    -- ANCHOR: Level 1 - Input langsung untuk Produk Komersial Jadi (Finished Good)
    SELECT
        r.tenant_id,
        r.merchant_id,
        r.output_product_id                                  AS root_product_id,
        p.name                                               AS root_product_name,
        r.id                                                 AS recipe_id,
        r.recipe_name,
        ri.id                                                AS recipe_item_id,
        ri.inventory_item_id,
        i.item_name                                          AS component_item_name,
        i.sku                                                AS component_sku,
        i.item_type                                          AS component_item_type,
        ri.quantity                                          AS step_quantity,
        ri.quantity::NUMERIC                                 AS total_effective_quantity,
        ri.unit,
        ri.wastage_percentage,
        1                                                    AS bom_level,
        ARRAY[r.output_product_id::text]                     AS path
    FROM pos.recipes r
    JOIN pos.products p        ON p.id = r.output_product_id
    JOIN pos.recipe_items ri   ON ri.recipe_id = r.id
    JOIN pos.inventory_items i ON i.id = ri.inventory_item_id
    WHERE r.is_active = TRUE
      AND r.output_product_id IS NOT NULL

    UNION ALL

    -- RECURSIVE MEMBER: Level 2+ - Mengurai bahan jika component_item_type adalah SEMI_FINISHED yang memiliki sub-resep
    SELECT
        parent.tenant_id,
        parent.merchant_id,
        parent.root_product_id,
        parent.root_product_name,
        sub_r.id                                             AS recipe_id,
        sub_r.recipe_name,
        sub_ri.id                                            AS recipe_item_id,
        sub_ri.inventory_item_id,
        sub_i.item_name                                      AS component_item_name,
        sub_i.sku                                            AS component_sku,
        sub_i.item_type                                      AS component_item_type,
        sub_ri.quantity                                      AS step_quantity,
        (parent.total_effective_quantity * (sub_ri.quantity / NULLIF(sub_r.yield_quantity, 0)) * (1.0 + (sub_ri.wastage_percentage / 100.0)))::NUMERIC AS total_effective_quantity,
        sub_ri.unit,
        sub_ri.wastage_percentage,
        parent.bom_level + 1                                 AS bom_level,
        parent.path || sub_r.output_inventory_item_id::text  AS path
    FROM bom_tree parent
    JOIN pos.recipes sub_r           ON sub_r.output_inventory_item_id = parent.inventory_item_id
    JOIN pos.recipe_items sub_ri     ON sub_ri.recipe_id = sub_r.id
    JOIN pos.inventory_items sub_i   ON sub_i.id = sub_ri.inventory_item_id
    WHERE sub_r.is_active = TRUE
      AND parent.component_item_type = 'SEMI_FINISHED'
      AND NOT (sub_r.output_inventory_item_id::text = ANY(parent.path)) -- Cycle Prevention
)
SELECT 
    tenant_id,
    merchant_id,
    root_product_id,
    root_product_name,
    recipe_id,
    recipe_name,
    recipe_item_id,
    inventory_item_id,
    component_item_name,
    component_sku,
    component_item_type,
    step_quantity,
    total_effective_quantity,
    unit,
    wastage_percentage,
    bom_level
FROM bom_tree;

CREATE OR REPLACE VIEW public.v_bom_explosion AS
  SELECT * FROM contract.bom_explosion;
