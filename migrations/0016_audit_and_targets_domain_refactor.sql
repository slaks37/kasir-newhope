-- =============================================================================
-- 0016_audit_and_targets_domain_refactor.sql
--
-- 1. CROSS-CUTTING PLATFORM AUDIT PLANE:
--    - Memindahkan Audit Log menjadi domain platform cross-cutting di `internal.audit_logs`.
--    - Seluruh service (POS, Billing, AI, Backoffice) meng-emit audit events ke plane ini.
--    - Backoffice / Admin Panel bertindak sebagai CONSUMER/READ dari `contract.activity_log`.
--
-- 2. DOMAIN OWNERSHIP BUSINESS TARGETS:
--    - Memindahkan kepemilikan target bisnis dari `ai.merchant_targets` ke `internal.business_targets`.
--    - AI Copilot (`ai.insights`) hanya bertindak sebagai KONSUMEN data melalui view `contract.business_targets`.
--
-- 3. PEMISAHAN TELEMETRY VS BILLING METERING:
--    - `internal.feature_usage_events` ditegaskan sebagai Product Telemetry & UI Analytics.
--    - Billing metering diverifikasi melalui relasi struktural terverifikasi (contract views).
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. CROSS-CUTTING PLATFORM AUDIT LOGS (internal.audit_logs) ------------------

CREATE TABLE IF NOT EXISTS internal.audit_logs (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID,
    merchant_id        UUID,
    outlet_id          UUID,
    actor_id           UUID,
    actor_name         VARCHAR(120),
    actor_role         VARCHAR(50),
    domain             VARCHAR(32) NOT NULL DEFAULT 'PLATFORM', -- POS, BILLING, AI, BACKOFFICE, AUTH, SETTINGS
    event_type         VARCHAR(64) NOT NULL,                    -- TRANSACTION_VOID, SUBSCRIPTION_UPGRADE, etc.
    severity           VARCHAR(16) NOT NULL DEFAULT 'INFO',     -- INFO, WARNING, CRITICAL
    amount_idr         NUMERIC(15,2),
    summary            TEXT NOT NULL,
    detail             JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant   ON internal.audit_logs(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant ON internal.audit_logs(merchant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_domain   ON internal.audit_logs(domain, occurred_at DESC);

COMMENT ON TABLE internal.audit_logs IS
    'Cross-cutting platform audit log. Tempat penampungan seluruh audit event dari POS, Billing, AI, dan Backoffice.';


-- 1b. Migrasi data lama dari pos.merchant_activity_log ke internal.audit_logs
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pos' AND table_name = 'merchant_activity_log') THEN
        INSERT INTO internal.audit_logs (id, merchant_id, actor_name, actor_role, domain, event_type, severity, amount_idr, summary, detail, occurred_at)
        SELECT 
            id,
            merchant_id,
            actor_name,
            actor_role,
            COALESCE(app_module, 'POS'),
            event_type,
            severity,
            amount_idr,
            summary,
            detail,
            occurred_at
          FROM pos.merchant_activity_log
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;


-- 2. DOMAIN BUSINESS TARGETS (internal.business_targets) ----------------------

CREATE TABLE IF NOT EXISTS internal.business_targets (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID,
    merchant_id        UUID NOT NULL,
    outlet_id          UUID,
    target_type        VARCHAR(50) NOT NULL DEFAULT 'MONTHLY_REVENUE', -- MONTHLY_REVENUE, DAILY_SALES, INVENTORY_TURNOVER
    target_value       NUMERIC(15,2) NOT NULL CHECK (target_value > 0),
    currency           VARCHAR(10) NOT NULL DEFAULT 'IDR',
    effective_period   VARCHAR(32),                                    -- e.g. 2026-08
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_merchant_target_type UNIQUE(merchant_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_business_targets_merchant ON internal.business_targets(merchant_id);

COMMENT ON TABLE internal.business_targets IS
    'Target performa bisnis merchant (omzet, penjualan, stok). Dimiliki oleh domain bisnis/merchant, bukan milik AI.';


-- 2b. Migrasi data lama dari ai.merchant_targets ke internal.business_targets
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'ai' AND table_name = 'merchant_targets') THEN
        INSERT INTO internal.business_targets (id, merchant_id, tenant_id, target_type, target_value, currency, updated_at)
        SELECT 
            legacy_uuid(merchant_id::text || '_monthly_target'),
            merchant_id,
            tenant_id,
            'MONTHLY_REVENUE',
            monthly_revenue_target,
            currency,
            updated_at
          FROM ai.merchant_targets
         WHERE monthly_revenue_target IS NOT NULL AND monthly_revenue_target > 0
        ON CONFLICT (merchant_id, target_type) DO UPDATE SET
            target_value = EXCLUDED.target_value,
            updated_at   = EXCLUDED.updated_at;
    END IF;
END $$;


-- 3. PERBARUI KONTRAK CROSS-DOMAIN (contract.*) -------------------------------

-- 3a. contract.activity_log (Membaca dari Platform Audit Plane)
DROP VIEW IF EXISTS contract.activity_log CASCADE;
CREATE VIEW contract.activity_log AS
SELECT
    a.id,
    a.tenant_id,
    a.merchant_id,
    COALESCE(m.name, t.name, 'Unknown Merchant')       AS merchant_name,
    m.business_sector,
    a.outlet_id,
    a.domain                                           AS app_module,
    a.event_type,
    a.severity,
    a.actor_name,
    a.actor_role,
    a.amount_idr,
    a.summary,
    a.detail,
    a.occurred_at
  FROM internal.audit_logs a
  LEFT JOIN internal.merchants m ON m.id = a.merchant_id
  LEFT JOIN internal.tenants t   ON t.id = a.tenant_id;

COMMENT ON VIEW contract.activity_log IS
    'Antarmuka baca seluruh audit log platform. Backoffice bertindak sebagai pembaca view ini.';


-- 3b. contract.business_targets (Antarmuka target bisnis untuk AI Copilot & Reporting)
DROP VIEW IF EXISTS contract.business_targets CASCADE;
CREATE VIEW contract.business_targets AS
SELECT
    b.id                                               AS target_id,
    b.tenant_id,
    b.merchant_id,
    m.name                                             AS merchant_name,
    m.business_sector,
    b.outlet_id,
    b.target_type,
    b.target_value                                     AS monthly_revenue_target,
    b.target_value,
    b.currency,
    b.effective_period,
    b.updated_at
  FROM internal.business_targets b
  JOIN internal.merchants m ON m.id = b.merchant_id;

COMMENT ON VIEW contract.business_targets IS
    'Sumber tunggal target performa bisnis merchant. AI Copilot membaca data ini dari contract.';


-- 3c. View Kompatibilitas untuk ai.merchant_targets
CREATE OR REPLACE VIEW ai.merchant_targets AS
SELECT
    merchant_id,
    tenant_id,
    target_value                                       AS monthly_revenue_target,
    currency,
    updated_at
  FROM internal.business_targets
 WHERE target_type = 'MONTHLY_REVENUE';


-- 4. HAK AKSES PERAN ---------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    -- Semua service berhak melakukan INSERT ke platform audit log
    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT INSERT ON internal.audit_logs TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT ON contract.activity_log TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT ON contract.business_targets TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    -- svc_internal memiliki hak penuh
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT ALL ON internal.audit_logs TO svc_internal;
        GRANT ALL ON internal.business_targets TO svc_internal;
    END IF;

    -- BI Readonly
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.activity_log TO bi_readonly;
        GRANT SELECT ON contract.business_targets TO bi_readonly;
    END IF;
END $$;


-- 5. VIEW PUBLIK TERKOMPATIBILITAS -------------------------------------------

CREATE OR REPLACE VIEW public.v_activity_log AS
  SELECT * FROM contract.activity_log;

CREATE OR REPLACE VIEW public.v_business_targets AS
  SELECT * FROM contract.business_targets;
