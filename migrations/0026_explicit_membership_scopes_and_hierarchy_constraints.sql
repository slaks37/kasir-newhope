-- =============================================================================
-- 0026_explicit_membership_scopes_and_hierarchy_constraints.sql
--
-- Penegasan Hirarki Multi-Tenant & Scoped Authorization Model:
-- 1. Penegakan Integritas Hirarki Fisik Database (Composite Unique Constraints)
-- 2. Refactor internal.memberships ke Model Lingkup Akses Eksplisit:
--    - TENANT Scope   : tenant_id (NOT NULL), merchant_id (NULL), outlet_id (NULL)
--    - MERCHANT Scope : tenant_id (NOT NULL), merchant_id (NOT NULL), outlet_id (NULL)
--    - OUTLET Scope   : tenant_id (NOT NULL), merchant_id (NOT NULL), outlet_id (NOT NULL)
-- 3. Check Constraint & Composite Foreign Keys Anti-Cross-Contamination
-- 4. Pembaruan View contract.merchant_staff
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. SINKRONISASI DATA OUTLETS & MERCHANTS ------------------------------------

-- Pastikan semua outlet memiliki tenant_id yang sinkron dengan merchant pemiliknya
UPDATE internal.outlets o
   SET tenant_id = m.tenant_id
  FROM internal.merchants m
 WHERE o.merchant_id = m.id
   AND o.tenant_id != m.tenant_id;

-- 2. COMPOSITE UNIQUE CONSTRAINTS PADA MASTER HIRARKI -------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_merchants_id_tenant') THEN
        ALTER TABLE internal.merchants ADD CONSTRAINT uq_merchants_id_tenant UNIQUE (id, tenant_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_outlets_id_merchant_tenant') THEN
        ALTER TABLE internal.outlets ADD CONSTRAINT uq_outlets_id_merchant_tenant UNIQUE (id, merchant_id, tenant_id);
    END IF;
END $$;


-- 3. REFACTOR INTERNAL.MEMBERSHIPS (SCOPED AUTHORIZATION) ---------------------

DO $$
BEGIN
    -- 3a. Tambahkan kolom scope_type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'internal' AND table_name = 'memberships' AND column_name = 'scope_type') THEN
        ALTER TABLE internal.memberships ADD COLUMN scope_type VARCHAR(20) NOT NULL DEFAULT 'MERCHANT';
    END IF;

    -- 3b. Hapus constraint lama jika ada
    ALTER TABLE internal.memberships DROP CONSTRAINT IF EXISTS uq_tenant_user_membership;
    ALTER TABLE internal.memberships DROP CONSTRAINT IF EXISTS chk_membership_scope_consistency;
    ALTER TABLE internal.memberships DROP CONSTRAINT IF EXISTS fk_membership_merchant_tenant;
    ALTER TABLE internal.memberships DROP CONSTRAINT IF EXISTS fk_membership_outlet_merchant_tenant;
END $$;

-- 3c. Klasifikasikan scope_type untuk data eksisting
-- Jika role adalah kasir/barista/washer/kapster dan merchant memiliki outlet, pasang ke outlet utama
UPDATE internal.memberships m
   SET outlet_id = o.id,
       scope_type = 'OUTLET'
  FROM internal.outlets o
 WHERE m.role IN ('CASHIER', 'BARISTA', 'CHEF', 'WASHER', 'KAPSTER', 'STAFF')
   AND m.merchant_id = o.merchant_id
   AND m.outlet_id IS NULL;

-- Sisanya yang memiliki outlet_id diset ke OUTLET
UPDATE internal.memberships
   SET scope_type = 'OUTLET'
 WHERE outlet_id IS NOT NULL;

-- Yang tidak punya outlet_id tapi punya merchant_id diset ke MERCHANT
UPDATE internal.memberships
   SET scope_type = 'MERCHANT'
 WHERE outlet_id IS NULL AND merchant_id IS NOT NULL;

-- Bersihkan data: jika scope_type = 'MERCHANT', pastikan outlet_id = NULL
UPDATE internal.memberships
   SET outlet_id = NULL
 WHERE scope_type = 'MERCHANT';

-- Bersihkan data: jika scope_type = 'TENANT', pastikan merchant_id = NULL dan outlet_id = NULL
UPDATE internal.memberships
   SET merchant_id = NULL, outlet_id = NULL
 WHERE scope_type = 'TENANT';


-- 4. PENEGAKAN CONSTRAINT KETAT DI INTERNAL.MEMBERSHIPS -----------------------

-- 4a. Check Constraint Integritas Scope
ALTER TABLE internal.memberships ADD CONSTRAINT chk_membership_scope_consistency CHECK (
    (scope_type = 'TENANT'   AND tenant_id IS NOT NULL AND merchant_id IS NULL AND outlet_id IS NULL) OR
    (scope_type = 'MERCHANT' AND tenant_id IS NOT NULL AND merchant_id IS NOT NULL AND outlet_id IS NULL) OR
    (scope_type = 'OUTLET'   AND tenant_id IS NOT NULL AND merchant_id IS NOT NULL AND outlet_id IS NOT NULL)
);

-- 4b. Composite Foreign Keys (Menjamin Hirarki Relasi Fisik 100% Konsisten)
ALTER TABLE internal.memberships 
    ADD CONSTRAINT fk_membership_merchant_tenant 
    FOREIGN KEY (merchant_id, tenant_id) 
    REFERENCES internal.merchants (id, tenant_id) 
    ON DELETE CASCADE;

ALTER TABLE internal.memberships 
    ADD CONSTRAINT fk_membership_outlet_merchant_tenant 
    FOREIGN KEY (outlet_id, merchant_id, tenant_id) 
    REFERENCES internal.outlets (id, merchant_id, tenant_id) 
    ON DELETE CASCADE;

-- 4c. Unique Index untuk Mencegah Duplikasi Grant
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_grant_idx 
    ON internal.memberships (
        user_id, 
        scope_type, 
        tenant_id, 
        COALESCE(merchant_id, '00000000-0000-0000-0000-000000000000'::uuid), 
        COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid), 
        role
    );


-- 5. PEMBARUAN VIEW CONTRACT.MERCHANT_STAFF -----------------------------------

DROP VIEW IF EXISTS contract.merchant_staff CASCADE;
CREATE VIEW contract.merchant_staff AS
SELECT
    m.id                                               AS membership_id,
    m.scope_type,
    m.tenant_id,
    t.name                                             AS tenant_name,
    m.merchant_id,
    b.name                                             AS merchant_name,
    b.business_sector,
    m.outlet_id,
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

CREATE OR REPLACE VIEW public.v_pos_staff AS
  SELECT * FROM contract.merchant_staff;
