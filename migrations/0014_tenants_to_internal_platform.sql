-- =============================================================================
-- 0014_tenants_to_internal_platform.sql
--
-- Memindahkan entitas Tenant / Merchant Organization dari domain `pos`
-- ke domain platform identitas `internal.tenants`.
--
-- Domain Model:
--   [internal.tenants] (Organisasi / Merchant Platform)
--          │
--          ├──> [internal.memberships] (Relasi Pengguna & Hak Akses)
--          ├──> [pos.products, pos.transactions, pos.ingredients]
--          ├──> [billing.subscriptions, billing.invoices]
--          └──> [ai.merchant_ai_credits, ai.daily_merchant_insights]
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TABEL ORGANISASI TENANT / MERCHANT DI SKEMA INTERNAL --------------------

CREATE TABLE IF NOT EXISTS internal.tenants (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    name               VARCHAR(100) NOT NULL,
    business_sector    VARCHAR(32) NOT NULL DEFAULT 'FNB',
    external_ref       VARCHAR(96),
    owner_user_ref     VARCHAR(64),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_tenants_ext_ref
    ON internal.tenants(external_ref) WHERE external_ref IS NOT NULL;

COMMENT ON TABLE internal.tenants IS
    'Identitas organisasi / merchant platform. Merupakan batas tenant resmi tingkat platform (bukan entitas milik POS).';


-- 2. MIGRASI DATA DARI POS.TENANTS KE INTERNAL.TENANTS -----------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pos' AND table_name = 'tenants') THEN
        INSERT INTO internal.tenants (id, name, business_sector, external_ref, owner_user_ref, is_active, created_at)
        SELECT 
            id, 
            name, 
            COALESCE(business_sector, 'FNB'), 
            external_ref, 
            owner_user_ref, 
            COALESCE(is_active, TRUE), 
            COALESCE(created_at, CURRENT_TIMESTAMP)
          FROM pos.tenants
        ON CONFLICT (id) DO UPDATE SET
            name            = EXCLUDED.name,
            business_sector = EXCLUDED.business_sector,
            external_ref    = EXCLUDED.external_ref,
            owner_user_ref  = EXCLUDED.owner_user_ref,
            is_active       = EXCLUDED.is_active;
    END IF;
END $$;


-- 3. PERBARUI KONTRAK CROSS-DOMAIN (contract.*) -------------------------------

-- 3a. contract.merchant_directory
DROP VIEW IF EXISTS contract.merchant_directory CASCADE;
CREATE VIEW contract.merchant_directory AS
SELECT
    t.id                                              AS merchant_id,
    t.name                                            AS merchant_name,
    t.business_sector,
    t.external_ref                                    AS business_id,
    t.owner_user_ref,
    t.is_active,
    t.created_at                                      AS joined_at,
    COUNT(r.transaction_id)                           AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    MAX(r.created_at)                                 AS last_transaction_at,
    COUNT(DISTINCT r.business_id)                     AS business_unit_count,
    COUNT(DISTINCT r.cashier_user_id)                 AS distinct_cashiers
  FROM internal.tenants t
  LEFT JOIN contract.merchant_revenue r ON r.merchant_id = t.id
 GROUP BY t.id, t.name, t.business_sector, t.external_ref, t.owner_user_ref,
          t.is_active, t.created_at;

-- 3b. contract.product_sales
DROP VIEW IF EXISTS contract.product_sales CASCADE;
CREATE VIEW contract.product_sales AS
SELECT
    i.business_sector,
    r.merchant_id,
    t.name                                            AS merchant_name,
    i.product_id,
    i.product_name,
    i.category_name,
    (ARRAY_AGG(i.product_description ORDER BY r.created_at DESC)
        FILTER (WHERE i.product_description IS NOT NULL))[1] AS product_description,
    SUM(i.quantity)                                   AS units_sold,
    SUM(i.total_price)                                AS revenue,
    SUM(i.unit_cost * i.quantity)                     AS cogs,
    SUM(i.total_price) - SUM(i.unit_cost * i.quantity) AS gross_profit,
    COUNT(DISTINCT i.transaction_id)                  AS appeared_in_transactions,
    MAX(r.created_at)                                 AS last_sold_at
  FROM pos.transaction_items i
  JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
  JOIN internal.tenants t          ON t.id = r.merchant_id
 GROUP BY i.business_sector, r.merchant_id, t.name,
          i.product_id, i.product_name, i.category_name;

-- 3c. contract.catalog
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
    p.stock, p.min_stock_alert,
    p.stock <= p.min_stock_alert                   AS is_low_stock,
    p.is_available, p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM pos.products p
  JOIN internal.tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)    AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(r.created_at)  AS last_sold_at
          FROM pos.transaction_items i
          JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;

-- 3d. contract.transaction_log
DROP VIEW IF EXISTS contract.transaction_log CASCADE;
CREATE VIEW contract.transaction_log AS
SELECT
    r.transaction_id                                  AS id,
    r.merchant_id,
    t.name                                            AS merchant_name,
    r.business_sector,
    r.business_id,
    r.app_module,
    r.order_type,
    r.payment_method,
    r.total_amount, r.subtotal, r.discount_amount,
    r.tax_amount, r.service_charge_amount,
    r.created_at,
    x.invoice_number,
    x.payment_status,
    u.full_name                                       AS cashier_name,
    (SELECT COUNT(*) FROM pos.transaction_items i WHERE i.transaction_id = r.transaction_id)
                                                      AS item_count
  FROM contract.merchant_revenue r
  JOIN pos.transactions  x ON x.id = r.transaction_id
  JOIN internal.tenants  t ON t.id = r.merchant_id
  LEFT JOIN internal.users u ON u.id = r.cashier_user_id;

-- 3e. contract.activity_log
DROP VIEW IF EXISTS contract.activity_log CASCADE;
CREATE VIEW contract.activity_log AS
SELECT a.id, a.merchant_id, t.name AS merchant_name,
       a.business_sector, a.business_id, a.app_module, a.event_type, a.severity,
       a.actor_name, a.actor_role, a.transaction_id, a.amount_idr,
       a.summary, a.detail, a.occurred_at
  FROM pos.merchant_activity_log a
  JOIN internal.tenants t ON t.id = a.merchant_id;

-- 3f. contract.inventory_movements
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
  JOIN internal.tenants t     ON t.id = l.tenant_id
  LEFT JOIN pos.ingredients i ON i.id = l.ingredient_id;

-- 3g. contract.merchant_staff
DROP VIEW IF EXISTS contract.merchant_staff CASCADE;
CREATE VIEW contract.merchant_staff AS
SELECT
    m.id                                               AS membership_id,
    m.tenant_id                                        AS merchant_id,
    t.name                                             AS merchant_name,
    t.business_sector,
    u.id                                               AS user_id,
    u.full_name                                        AS staff_name,
    u.email                                            AS staff_email,
    u.phone                                            AS staff_phone,
    m.role,
    m.is_active,
    m.created_at                                       AS joined_at
  FROM internal.memberships m
  JOIN internal.users u    ON u.id = m.user_id
  JOIN internal.tenants t  ON t.id = m.tenant_id;


-- 4. HAK AKSES PERAN UNTUK INTERNAL.TENANTS -----------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    -- svc_internal memiliki hak penuh
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT ALL ON TABLE internal.tenants TO svc_internal;
    END IF;

    -- Semua service memiliki hak SELECT dan REFERENCES pada internal.tenants
    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT USAGE ON SCHEMA internal TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT, REFERENCES ON internal.tenants TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    -- svc_pos juga memiliki hak INSERT & UPDATE untuk pendaftaran tenant saat sinkronisasi kasir
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT INSERT, UPDATE ON internal.tenants TO svc_pos;
    END IF;

    -- Bi readonly
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON internal.tenants TO bi_readonly;
    END IF;
END $$;


-- 5. PERBARUI VIEW PUBLIK TERKOMPATIBILITAS -----------------------------------

CREATE OR REPLACE VIEW public.v_merchant_directory AS
  SELECT * FROM contract.merchant_directory;

CREATE OR REPLACE VIEW public.v_catalog AS
  SELECT * FROM contract.catalog;

CREATE OR REPLACE VIEW public.v_transaction_log AS
  SELECT * FROM contract.transaction_log;

CREATE OR REPLACE VIEW public.v_inventory_movements AS
  SELECT * FROM contract.inventory_movements;

CREATE OR REPLACE VIEW public.v_merchant_staff AS
  SELECT * FROM contract.merchant_staff;
