-- =============================================================================
-- 0015_model_b_tenant_merchant_outlet_hierarchy.sql
--
-- Implementasi MODEL B: Enterprise Multi-Tier Hierarchy
--
-- Struktur Hirarki:
--   Tenant (Holding / Company / Billing Customer)
--      │
--      └── Merchant (Brand / Business Unit / Sektor Usaha)
--             │
--             └── Outlet (Cabang Fisik / Store Branch)
--                    ├── Kasir & Terminal POS
--                    ├── Katalog & Resep BOM
--                    ├── Stok & Bahan Baku
--                    └── Transaksi & Struk
--
-- Keunggulan Bisnis Model B:
--   1. Satu Akun Tenant (1 Tagihan SaaS) dapat memiliki banyak Merchant (mis. Kafe + Laundry).
--   2. Satu Merchant dapat memiliki banyak Outlet (Multi-Cabang: Senayan, Sudirman, BSD).
--   3. Hak akses pengguna (RBAC) dapat dibatasi di level Tenant, Merchant, atau Outlet tertentu.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. ENTITAS UTAMA MODEL B DI SKEMA INTERNAL ----------------------------------

-- 1a. internal.tenants (Tingkat 1: Holding / Enterprise Account / Customer Billing)
CREATE TABLE IF NOT EXISTS internal.tenants (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    name               VARCHAR(150) NOT NULL,
    company_name       VARCHAR(200),
    tax_id             VARCHAR(50),
    owner_user_id      UUID,
    owner_user_ref     VARCHAR(64),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE internal.tenants ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE internal.tenants ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50);
ALTER TABLE internal.tenants ADD COLUMN IF NOT EXISTS owner_user_id UUID;

COMMENT ON TABLE internal.tenants IS
    'Tingkat 1: Akun Holding / Perusahaan / Pelanggan Utama Billing SaaS.';


-- 1b. internal.merchants (Tingkat 2: Brand / Business Unit / Unit Usaha Sektor)
CREATE TABLE IF NOT EXISTS internal.merchants (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    name               VARCHAR(150) NOT NULL,
    business_sector    VARCHAR(32) NOT NULL DEFAULT 'FNB', -- FNB, RETAIL, LAUNDRY, BARBERSHOP, CARWASH
    external_ref       VARCHAR(96),                        -- Ref id format: userId_sector
    tagline            VARCHAR(255),
    logo_url           TEXT,
    monthly_target     NUMERIC(15,2) DEFAULT 50000000,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_merchants_ext_ref
    ON internal.merchants(external_ref) WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_internal_merchants_tenant
    ON internal.merchants(tenant_id);

COMMENT ON TABLE internal.merchants IS
    'Tingkat 2: Unit Usaha / Brand / Lini Bisnis di bawah naungan Tenant.';


-- 1c. internal.outlets (Tingkat 3: Cabang Toko Fisik / Outlet Geofenced)
CREATE TABLE IF NOT EXISTS internal.outlets (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    name               VARCHAR(150) NOT NULL,
    code               VARCHAR(50),
    address            TEXT,
    phone              VARCHAR(50),
    latitude           NUMERIC(10,7),
    longitude          NUMERIC(10,7),
    radius_meters      INT NOT NULL DEFAULT 100,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_internal_outlets_merchant
    ON internal.outlets(merchant_id);

COMMENT ON TABLE internal.outlets IS
    'Tingkat 3: Lokasi fisik toko / cabang kasir dengan konfigurasi geofencing.';


-- 2. MIGRASI DATA DARI STRUKTUR LAMA KE MODEL B ------------------------------

DO $$
DECLARE
    t_rec RECORD;
BEGIN
    -- Pastikan setiap tenant memiliki entitas merchant & default outlet
    FOR t_rec IN SELECT id, name, business_sector, external_ref, owner_user_ref, is_active, created_at FROM internal.tenants LOOP
        -- Insert atau update merchant
        INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref, is_active, created_at)
        VALUES (
            t_rec.id, -- untuk kompatibilitas data lama, id merchant = id tenant lama
            t_rec.id,
            t_rec.name,
            COALESCE(t_rec.business_sector, 'FNB'),
            t_rec.external_ref,
            t_rec.is_active,
            t_rec.created_at
        )
        ON CONFLICT (id) DO UPDATE SET
            name            = EXCLUDED.name,
            business_sector = EXCLUDED.business_sector,
            external_ref    = EXCLUDED.external_ref;

        -- Insert default outlet cabang utama jika belum ada
        INSERT INTO internal.outlets (id, tenant_id, merchant_id, name, is_active, created_at)
        VALUES (
            legacy_uuid(t_rec.id::text || '_outlet_main'),
            t_rec.id,
            t_rec.id,
            t_rec.name || ' (Cabang Utama)',
            TRUE,
            t_rec.created_at
        )
        ON CONFLICT (id) DO NOTHING;
    END LOOP;
END $$;


-- 3. PERLUASAN SKEMA OPERASIONAL POS DENGAN MERCHANT_ID & OUTLET_ID ----------

DO $$
BEGIN
    -- pos.products
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'products' AND column_name = 'merchant_id') THEN
        ALTER TABLE pos.products ADD COLUMN merchant_id UUID REFERENCES internal.merchants(id) ON DELETE CASCADE;
        UPDATE pos.products SET merchant_id = tenant_id WHERE merchant_id IS NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'products' AND column_name = 'outlet_id') THEN
        ALTER TABLE pos.products ADD COLUMN outlet_id UUID REFERENCES internal.outlets(id) ON DELETE SET NULL;
    END IF;

    -- pos.ingredients
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'ingredients' AND column_name = 'merchant_id') THEN
        ALTER TABLE pos.ingredients ADD COLUMN merchant_id UUID REFERENCES internal.merchants(id) ON DELETE CASCADE;
        UPDATE pos.ingredients SET merchant_id = tenant_id WHERE merchant_id IS NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'ingredients' AND column_name = 'outlet_id') THEN
        ALTER TABLE pos.ingredients ADD COLUMN outlet_id UUID REFERENCES internal.outlets(id) ON DELETE SET NULL;
    END IF;

    -- pos.transactions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'merchant_id') THEN
        ALTER TABLE pos.transactions ADD COLUMN merchant_id UUID REFERENCES internal.merchants(id) ON DELETE CASCADE;
        UPDATE pos.transactions SET merchant_id = tenant_id WHERE merchant_id IS NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'outlet_id') THEN
        ALTER TABLE pos.transactions ADD COLUMN outlet_id UUID REFERENCES internal.outlets(id) ON DELETE SET NULL;
    END IF;

    -- internal.memberships
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'internal' AND table_name = 'memberships' AND column_name = 'merchant_id') THEN
        ALTER TABLE internal.memberships ADD COLUMN merchant_id UUID REFERENCES internal.merchants(id) ON DELETE CASCADE;
        UPDATE internal.memberships SET merchant_id = tenant_id WHERE merchant_id IS NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'internal' AND table_name = 'memberships' AND column_name = 'outlet_id') THEN
        ALTER TABLE internal.memberships ADD COLUMN outlet_id UUID REFERENCES internal.outlets(id) ON DELETE SET NULL;
    END IF;
END $$;


-- 4. KONTRAK CROSS-DOMAIN MODEL B (contract.*) --------------------------------

-- 4a. contract.tenant_directory (Daftar Holding / Pelanggan Billing)
DROP VIEW IF EXISTS contract.tenant_directory CASCADE;
CREATE VIEW contract.tenant_directory AS
SELECT
    t.id                                              AS tenant_id,
    t.name                                            AS tenant_name,
    t.company_name,
    t.is_active,
    t.created_at                                      AS joined_at,
    COUNT(DISTINCT m.id)                              AS merchant_count,
    COUNT(DISTINCT o.id)                              AS outlet_count,
    s.status                                          AS subscription_status,
    p.name                                            AS plan_name,
    COALESCE(p.price_idr, 0)                          AS contract_mrr_idr
  FROM internal.tenants t
  LEFT JOIN internal.merchants m     ON m.tenant_id = t.id
  LEFT JOIN internal.outlets o       ON o.tenant_id = t.id
  LEFT JOIN billing.subscriptions s  ON s.tenant_id = t.id
  LEFT JOIN billing.plans p          ON p.id = s.plan_id
 GROUP BY t.id, t.name, t.company_name, t.is_active, t.created_at,
          s.status, p.name, p.price_idr;

-- 4b. contract.merchant_directory (Daftar Brand / Business Unit)
DROP VIEW IF EXISTS contract.merchant_directory CASCADE;
CREATE VIEW contract.merchant_directory AS
SELECT
    m.id                                              AS merchant_id,
    m.tenant_id,
    t.name                                            AS tenant_name,
    m.name                                            AS merchant_name,
    m.business_sector,
    m.external_ref                                    AS business_id,
    m.is_active,
    m.created_at                                      AS joined_at,
    COUNT(DISTINCT o.id)                              AS outlet_count,
    COUNT(r.id)                                       AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    MAX(r.created_at)                                 AS last_transaction_at
  FROM internal.merchants m
  JOIN internal.tenants t            ON t.id = m.tenant_id
  LEFT JOIN internal.outlets o       ON o.merchant_id = m.id
  LEFT JOIN pos.transactions r ON r.merchant_id = m.id
 GROUP BY m.id, m.tenant_id, t.name, m.name, m.business_sector,
          m.external_ref, m.is_active, m.created_at;

-- 4c. contract.outlet_directory (Daftar Cabang Toko)
DROP VIEW IF EXISTS contract.outlet_directory CASCADE;
CREATE VIEW contract.outlet_directory AS
SELECT
    o.id                                              AS outlet_id,
    o.merchant_id,
    o.tenant_id,
    t.name                                            AS tenant_name,
    m.name                                            AS merchant_name,
    m.business_sector,
    o.name                                            AS outlet_name,
    o.address,
    o.latitude,
    o.longitude,
    o.radius_meters,
    o.is_active,
    o.created_at
  FROM internal.outlets o
  JOIN internal.merchants m ON m.id = o.merchant_id
  JOIN internal.tenants t   ON t.id = o.tenant_id;

-- 4d. contract.merchant_revenue (Definisi Tunggal Omzet)
DROP VIEW IF EXISTS contract.merchant_revenue CASCADE;
CREATE VIEW contract.merchant_revenue AS
SELECT
    x.tenant_id,
    COALESCE(x.merchant_id, x.tenant_id)              AS merchant_id,
    x.outlet_id,
    x.business_sector,
    x.business_id,
    x.id                                              AS transaction_id,
    x.total_amount,
    x.subtotal,
    x.discount_amount,
    x.tax_amount,
    x.service_charge_amount,
    x.payment_method,
    x.app_module,
    x.order_type,
    x.cashier_user_id,
    x.created_at
  FROM pos.transactions x
 WHERE x.payment_status <> 'CANCELLED';

-- 4e. contract.merchant_staff (Daftar Staf & Hak Akses Hirarkis)
DROP VIEW IF EXISTS contract.merchant_staff CASCADE;
CREATE VIEW contract.merchant_staff AS
SELECT
    m.id                                               AS membership_id,
    m.tenant_id,
    m.merchant_id,
    m.outlet_id,
    t.name                                             AS tenant_name,
    b.name                                             AS merchant_name,
    o.name                                             AS outlet_name,
    u.id                                               AS user_id,
    u.full_name                                        AS staff_name,
    u.email                                            AS staff_email,
    u.phone                                            AS staff_phone,
    m.role,
    m.is_active,
    m.created_at                                       AS joined_at
  FROM internal.memberships m
  JOIN internal.users u              ON u.id = m.user_id
  JOIN internal.tenants t            ON t.id = m.tenant_id
  LEFT JOIN internal.merchants b     ON b.id = m.merchant_id
  LEFT JOIN internal.outlets o       ON o.id = m.outlet_id;


-- 5. HAK AKSES PERAN ---------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT ALL ON internal.merchants TO svc_internal;
        GRANT ALL ON internal.outlets   TO svc_internal;
    END IF;

    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT, REFERENCES ON internal.merchants TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT, REFERENCES ON internal.outlets   TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT ON contract.tenant_directory      TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT ON contract.outlet_directory      TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT INSERT, UPDATE ON internal.merchants TO svc_pos;
        GRANT INSERT, UPDATE ON internal.outlets   TO svc_pos;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.tenant_directory TO bi_readonly;
        GRANT SELECT ON contract.outlet_directory TO bi_readonly;
    END IF;
END $$;


-- 6. VIEW KOMPATIBILITAS PUBLIK ----------------------------------------------

CREATE OR REPLACE VIEW public.v_tenant_directory AS
  SELECT * FROM contract.tenant_directory;

CREATE OR REPLACE VIEW public.v_merchant_directory AS
  SELECT * FROM contract.merchant_directory;

CREATE OR REPLACE VIEW public.v_outlet_directory AS
  SELECT * FROM contract.outlet_directory;

CREATE OR REPLACE VIEW public.v_merchant_staff AS
  SELECT * FROM contract.merchant_staff;
