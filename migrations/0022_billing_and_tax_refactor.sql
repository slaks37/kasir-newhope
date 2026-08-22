-- =============================================================================
-- 0022_billing_and_tax_refactor.sql
--
-- Penyempurnaan Skema Sesuai Audit Arsitektur:
--
-- 1. pos.transaction_adjustments
--    Memisahkan tax_amount, discount_amount, service_charge menjadi record
--    spesifik per transaksi (DISCOUNT, TAX, SERVICE_CHARGE, ROUNDING)
--    agar semantiknya lebih kaya dan scalable.
--
-- 2. billing.subscriptions (Lifecycle & Source of Truth)
--    Mengubah tipe enum subscriptions.status menjadi VARCHAR(32) agar 
--    mendukung lifecycle nyata SaaS:
--    TRIALING, ACTIVE, PAST_DUE, GRACE_PERIOD, CANCELLED, EXPIRED, SUSPENDED.
--    Memastikan sistem bertumpu pada tabel ini, bukan denormalisasi di merchants.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TRANSACTION ADJUSTMENTS (TAX, DISCOUNT, FEE, ROUNDING) -------------------

CREATE TABLE IF NOT EXISTS pos.transaction_adjustments (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    transaction_id UUID NOT NULL REFERENCES pos.transactions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    adjustment_type VARCHAR(32) NOT NULL, -- DISCOUNT, TAX, SERVICE_CHARGE, ROUNDING
    amount NUMERIC(12, 2) NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_txn_adjustments_txn
    ON pos.transaction_adjustments(transaction_id);

COMMENT ON TABLE pos.transaction_adjustments IS
    'Mencatat komponen tambahan pada struk/invoice seperti Pajak (PB1/PPN), Service Charge, Diskon, dan Pembulatan (Rounding). Semantik terpisah dari total transaksi mentah.';


-- 2. SAAS SUBSCRIPTION LIFECYCLE ----------------------------------------------

DO $$
BEGIN
    -- Menghapus constraint/tipe enum dan beralih ke VARCHAR untuk fleksibilitas lifecycle.
    -- (Tidak bisa langsung alter type kalau ada dependency, jadi konversi ke varchar)
    -- Drop dependent views first
    EXECUTE 'DROP VIEW IF EXISTS contract.tenant_directory CASCADE';
    EXECUTE 'DROP VIEW IF EXISTS contract.subscription_status CASCADE';
    EXECUTE 'DROP VIEW IF EXISTS public.v_billing_subscriptions CASCADE';
    EXECUTE 'DROP VIEW IF EXISTS public.v_subscription_status CASCADE';

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'billing' 
          AND table_name = 'subscriptions' 
          AND data_type = 'USER-DEFINED'
    ) THEN
        ALTER TABLE billing.subscriptions 
            ALTER COLUMN status TYPE VARCHAR(32) USING status::text;
    END IF;
    
    -- Pastikan default constraint diperbarui
    ALTER TABLE billing.subscriptions 
        ALTER COLUMN status SET DEFAULT 'TRIALING';
        
END $$;

COMMENT ON COLUMN billing.subscriptions.status IS
    'Source of Truth status SaaS. Lifecycle: TRIALING, ACTIVE, PAST_DUE, GRACE_PERIOD, CANCELLED, EXPIRED, SUSPENDED.';

-- 3. PERBAIKAN KONTRAK YANG BERGANTUNG PADA SUBSCRIPTION STATUS ---------------

-- Memastikan contract.subscription_status mendukung tipe varchar
DROP VIEW IF EXISTS contract.subscription_status CASCADE;
CREATE VIEW contract.subscription_status AS
SELECT s.tenant_id                    AS merchant_id,
       s.status::text                 AS status,
       s.current_period_end,
       p.id                           AS plan_code,
       p.name                         AS plan_name,
       p.price_idr                    AS contract_mrr_idr,
       CASE WHEN s.status::text IN ('ACTIVE', 'TRIALING', 'PAST_DUE') THEN p.price_idr ELSE 0 END AS recognised_mrr_idr
  FROM billing.subscriptions s
  JOIN billing.plans p ON p.id = s.plan_id;

COMMENT ON VIEW contract.subscription_status IS
    'Membuka status langganan untuk backoffice. PAST_DUE tetap dihitung sebagai MRR yang bisa dipulihkan.';

-- Memperbarui contract.merchant_health_latest (snapshot kesehatan harian)
DROP VIEW IF EXISTS contract.merchant_health_latest CASCADE;
CREATE VIEW contract.merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id, h.tenant_id, h.log_date, h.daily_revenue,
       h.days_since_last_txn, h.active_days_last_7, h.revenue_trend_pct,
       h.distinct_features_used, h.support_tickets_count,
       h.subscription_status, h.mrr_idr, h.contract_mrr_idr,
       h.churn_risk_score, h.churn_risk_reasons
  FROM internal.merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;

COMMENT ON COLUMN contract.merchant_health_latest.subscription_status IS
    'HANYA SNAPSHOT DENORMALISASI. Jangan jadikan Source of Truth untuk akses fitur. Baca contract.subscription_status atau API billing untuk status asli.';

-- Memperbarui contract.tenant_directory
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
    s.status::text                                    AS subscription_status,
    p.name                                            AS plan_name,
    COALESCE(p.price_idr, 0)                          AS contract_mrr_idr
  FROM internal.tenants t
  LEFT JOIN internal.merchants m     ON m.tenant_id = t.id
  LEFT JOIN internal.outlets o       ON o.tenant_id = t.id
  LEFT JOIN billing.subscriptions s  ON s.tenant_id = t.id
  LEFT JOIN billing.plans p          ON p.id = s.plan_id
 GROUP BY t.id, t.name, t.company_name, t.is_active, t.created_at,
          s.status, p.name, p.price_idr;
