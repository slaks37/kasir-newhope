-- =============================================================================
-- 0029_unify_modifiers_under_recipe_engine.sql
--
-- Unifikasi Seluruh Engine Konsumsi Stok (Product, Modifier & Service):
-- 1. pos.modifiers dihubungkan langsung ke pos.recipes (recipe_id)
-- 2. Migrasi data pos.modifier_recipes ke pos.recipes & pos.recipe_items
-- 3. Hapus tabel redundan pos.modifier_recipes
-- 4. Semua sektor (F&B, Laundry, Car Wash, Barbershop) memakai engine resep terpadu
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TAMBAH RELASI RESEP PADA MODIFIER (pos.modifiers) -------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'modifiers' AND column_name = 'recipe_id') THEN
        ALTER TABLE pos.modifiers ADD COLUMN recipe_id UUID REFERENCES pos.recipes(id) ON DELETE SET NULL;
    END IF;
END $$;


-- 2. MIGRASI DATA DARI pos.modifier_recipes KE pos.recipes & recipe_items -----

DO $$
DECLARE
    mr RECORD;
    new_rec_id UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pos' AND table_name = 'modifier_recipes') THEN
        FOR mr IN 
            SELECT DISTINCT m.id AS mod_id, m.name AS mod_name, m.tenant_id, m.merchant_id
              FROM pos.modifiers m
              JOIN pos.modifier_recipes r ON r.modifier_id = m.id
        LOOP
            new_rec_id := legacy_uuid(mr.mod_id::text || '_mod_recipe');

            -- Buat header resep untuk modifier
            INSERT INTO pos.recipes (id, tenant_id, merchant_id, recipe_name, yield_quantity, yield_unit)
            VALUES (new_rec_id, mr.tenant_id, mr.merchant_id, 'Resep Modifier: ' || mr.mod_name, 1.0, 'portion')
            ON CONFLICT DO NOTHING;

            -- Hubungkan modifier ke resepnya
            UPDATE pos.modifiers 
               SET recipe_id = new_rec_id 
             WHERE id = mr.mod_id AND recipe_id IS NULL;

            -- Pindahkan item komponen bahan baku ke pos.recipe_items
            INSERT INTO pos.recipe_items (recipe_id, inventory_item_id, quantity, unit, wastage_percentage)
            SELECT new_rec_id, r.inventory_item_id, r.quantity_required, r.unit, r.wastage_percentage
              FROM pos.modifier_recipes r
             WHERE r.modifier_id = mr.mod_id
               AND r.inventory_item_id IS NOT NULL
            ON CONFLICT (recipe_id, inventory_item_id) DO NOTHING;
        END LOOP;

        -- Hapus tabel redundan
        DROP TABLE pos.modifier_recipes CASCADE;
    END IF;
END $$;


-- 3. PEMBARUAN VIEW contract.modifier_directory ------------------------------

DROP VIEW IF EXISTS contract.modifier_directory CASCADE;
CREATE VIEW contract.modifier_directory AS
SELECT
    m.id                                               AS modifier_id,
    m.tenant_id,
    m.merchant_id,
    b.name                                             AS merchant_name,
    m.name                                             AS modifier_name,
    m.price,
    m.cost_price,
    m.is_active,
    m.recipe_id,
    r.recipe_name,
    m.created_at
  FROM pos.modifiers m
  JOIN internal.merchants b          ON b.id = m.merchant_id
  LEFT JOIN pos.recipes r            ON r.id = m.recipe_id;

CREATE OR REPLACE VIEW public.v_pos_modifiers AS
  SELECT * FROM contract.modifier_directory;
