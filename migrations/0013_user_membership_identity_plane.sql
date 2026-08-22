-- =============================================================================
-- 0013_user_membership_identity_plane.sql
--
-- Memindahkan entitas User dari domain `pos` ke bidang identitas terpusat:
--   - internal.users        -> Identitas global pengguna (1 Manusia = 1 User)
--   - internal.memberships  -> Relasi N:M antara User dan Tenant dengan Role & PIN
--
-- Menghilangkan duplikasi akun jika satu orang memiliki banyak toko atau
-- memiliki peran berbeda di toko yang berbeda (mis. Owner di Toko A, Kasir di Toko B).
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TABEL IDENTITAS GLOBAL PENGGUNA -----------------------------------------

CREATE TABLE IF NOT EXISTS internal.users (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    email              VARCHAR(160) NOT NULL UNIQUE,
    full_name          VARCHAR(150) NOT NULL,
    phone              VARCHAR(50),
    avatar_url         TEXT,
    is_platform_user   BOOLEAN NOT NULL DEFAULT FALSE,
    platform_role      VARCHAR(50), -- ROLE_SUPERADMIN, ROLE_INTERNAL_GROWTH, ROLE_INTERNAL_SUPPORT
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE internal.users IS
    'Identitas global pengguna di platform New Hope POS. Independen dari domain POS/Billing.';


-- 2. TABEL MEMBERSHIP / HAK AKSES PER MERCHANT -------------------------------

CREATE TABLE IF NOT EXISTS internal.memberships (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id            UUID NOT NULL REFERENCES internal.users(id) ON DELETE CASCADE,
    tenant_id          UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    role               VARCHAR(32) NOT NULL DEFAULT 'CASHIER', -- OWNER, MANAGER, CASHIER, ACCOUNTANT, STAFF
    pin                VARCHAR(64) NOT NULL DEFAULT '1234',    -- PIN cepat unlock terminal POS/Kiosk
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_user_membership UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON internal.memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user   ON internal.memberships(user_id);

COMMENT ON TABLE internal.memberships IS
    'Penugasan peran pengguna ke merchant tertentu (Multi-Tenant RBAC). Memungkinkan 1 user menjadi Owner di Toko A dan Kasir di Toko B.';


-- 3. MIGRASI DATA DARI TABEL LAMA KE IDENTITAS BARU --------------------------

DO $$
BEGIN
    -- 3a. Migrasi data staf platform dari internal.internal_users
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'internal' AND table_name = 'internal_users') THEN
        INSERT INTO internal.users (id, email, full_name, is_platform_user, platform_role, is_active, created_at)
        SELECT 
            u.id,
            u.email,
            u.full_name,
            TRUE,
            u.role::text,
            u.is_active,
            u.created_at
          FROM internal.internal_users u
        ON CONFLICT (email) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            platform_role = EXCLUDED.platform_role,
            is_platform_user = TRUE;
    END IF;

    -- 3b. Migrasi data kasir/staf dari pos.users
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pos' AND table_name = 'users') THEN
        -- Insert user record untuk setiap staf toko (jika belum ada)
        INSERT INTO internal.users (id, email, full_name, is_active, created_at)
        SELECT 
            u.id,
            COALESCE(NULLIF(u.username, ''), 'user_' || substr(u.id::text, 1, 8)) || '@merchant.internal',
            COALESCE(NULLIF(u.name, ''), 'Staf Kasir'),
            TRUE,
            u.created_at
          FROM pos.users u
        ON CONFLICT (email) DO UPDATE SET
            full_name = EXCLUDED.full_name;

        -- Insert membership
        INSERT INTO internal.memberships (id, user_id, tenant_id, role, pin, is_active, created_at)
        SELECT 
            legacy_uuid(u.id::text || '_mem_' || u.tenant_id::text),
            u.id,
            u.tenant_id,
            COALESCE(u.role, 'CASHIER'),
            COALESCE(u.pin, '1234'),
            TRUE,
            u.created_at
          FROM pos.users u
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
            role = EXCLUDED.role,
            pin = EXCLUDED.pin;
    END IF;
END $$;


-- 4. KONTRAK CROSS-DOMAIN: contract.merchant_staff ---------------------------

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
  JOIN internal.users u ON u.id = m.user_id
  JOIN pos.tenants t    ON t.id = m.tenant_id;

COMMENT ON VIEW contract.merchant_staff IS
    'Daftar staf dan kasir per merchant tanpa mengekspos PIN/password. Sumber tunggal untuk administrasi cabang & backoffice.';


-- 5. HAK AKSES PERAN ---------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    -- Hak akses skema internal untuk svc_internal
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT ALL ON ALL TABLES IN SCHEMA internal TO svc_internal;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA internal TO svc_internal;
    END IF;

    -- Hak baca contract.merchant_staff untuk seluruh service & BI
    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT ON contract.merchant_staff TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.merchant_staff TO bi_readonly;
    END IF;
END $$;


-- 6. VIEW KOMPATIBILITAS PUBLIK ----------------------------------------------

CREATE OR REPLACE VIEW public.v_merchant_staff AS
  SELECT * FROM contract.merchant_staff;

DO $$
DECLARE
    svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON public.v_merchant_staff TO %I', svc);
        END IF;
    END LOOP;
END $$;
