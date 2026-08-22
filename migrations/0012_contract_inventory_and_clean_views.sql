-- =============================================================================
-- 0012_contract_inventory_and_clean_views.sql
--
-- 1. Menambahkan view kontrak `contract.inventory_movements` untuk domain stok.
-- 2. Membersihkan view pintasan (bypass views) yang mengekspos tabel mentah
--    ke skema public (seperti v_pos_users yang mengekspos PIN).
-- 3. Memastikan skema public hanya memiliki view teranotasi dan tersanitasi
--    yang merujuk ke skema `contract`.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. KONTRAK INVENTORI & MUTASI STOK -----------------------------------------

DROP VIEW IF EXISTS contract.inventory_movements CASCADE;
CREATE VIEW contract.inventory_movements AS
SELECT
    l.id                                               AS movement_id,
    l.tenant_id                                        AS merchant_id,
    t.name                                             AS merchant_name,
    t.business_sector,
    l.ingredient_id,
    i.name                                             AS ingredient_name,
    i.sku                                              AS ingredient_sku,
    i.unit                                             AS ingredient_unit,
    l.transaction_id,
    l.quantity_changed,
    l.previous_stock,
    l.new_stock,
    l.reason,
    l.created_at
  FROM pos.inventory_logs l
  JOIN pos.tenants t          ON t.id = l.tenant_id
  LEFT JOIN pos.ingredients i ON i.id = l.ingredient_id;

COMMENT ON VIEW contract.inventory_movements IS
    'Definisi tunggal mutasi stok dan inventori lintas merchant. Sumber data resmi untuk audit stok, AI inventory assistant, dan backoffice.';


-- 2. PEMBERSIHAN VIEW BYPASS DI PUBLIC ---------------------------------------
-- View yang melakukan `SELECT * FROM pos.*` atau `SELECT * FROM billing.*`
-- membocorkan kolom rahasia (seperti pin kasir di pos.users).

DROP VIEW IF EXISTS public.v_pos_transactions        CASCADE;
DROP VIEW IF EXISTS public.v_pos_products            CASCADE;
DROP VIEW IF EXISTS public.v_pos_tenants             CASCADE;
DROP VIEW IF EXISTS public.v_pos_users               CASCADE;
DROP VIEW IF EXISTS public.v_billing_plans           CASCADE;
DROP VIEW IF EXISTS public.v_billing_subscriptions   CASCADE;
DROP VIEW IF EXISTS public.v_ai_insights             CASCADE;


-- 3. VIEW KOMPATIBILITAS PUBLIK BERSIH (HANYA MERUJUK CONTRACT) -------------

CREATE OR REPLACE VIEW public.v_merchant_directory AS
  SELECT * FROM contract.merchant_directory;

CREATE OR REPLACE VIEW public.v_merchant_revenue AS
  SELECT * FROM contract.merchant_revenue;

CREATE OR REPLACE VIEW public.v_catalog AS
  SELECT * FROM contract.catalog;

CREATE OR REPLACE VIEW public.v_stock_status AS
  SELECT * FROM contract.stock_status;

CREATE OR REPLACE VIEW public.v_subscription_status AS
  SELECT * FROM contract.subscription_status;

CREATE OR REPLACE VIEW public.v_transaction_log AS
  SELECT * FROM contract.transaction_log;

CREATE OR REPLACE VIEW public.v_inventory_movements AS
  SELECT * FROM contract.inventory_movements;


-- 4. HAK AKSES PERAN ---------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT ON contract.inventory_movements TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.inventory_movements TO bi_readonly;
    END IF;

    -- Grant SELECT on sanitized public views to standard roles
    FOREACH svc IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON public.v_merchant_directory TO %I', svc);
            EXECUTE format('GRANT SELECT ON public.v_merchant_revenue TO %I', svc);
            EXECUTE format('GRANT SELECT ON public.v_catalog TO %I', svc);
            EXECUTE format('GRANT SELECT ON public.v_stock_status TO %I', svc);
            EXECUTE format('GRANT SELECT ON public.v_subscription_status TO %I', svc);
            EXECUTE format('GRANT SELECT ON public.v_transaction_log TO %I', svc);
            EXECUTE format('GRANT SELECT ON public.v_inventory_movements TO %I', svc);
        END IF;
    END LOOP;
END $$;
