-- =============================================================================
-- 0004_internal_backoffice.sql
-- SaaS PROVIDER back-office: merchant health monitoring, churn risk, feature
-- adoption, internal identity plane, and the read-only surface for the BI tool.
--
-- Applies on top of schema.sql, schema_hybrid_pos.sql and 0003_smart_assistant.sql.
-- Idempotent; run inside a transaction:
--   psql "$DATABASE_URL" --single-transaction -f migrations/0004_internal_backoffice.sql
--
-- -----------------------------------------------------------------------------
-- DEVIATION FROM SPEC (deliberate, same reasoning as 0003 decision (b))
-- -----------------------------------------------------------------------------
-- The spec writes:
--     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     merchant_id UUID NOT NULL,
--
-- This migration uses VARCHAR(64) instead. Reason: every table already deployed
-- (tenants, users, products, transactions, inventory_logs, daily_merchant_insights)
-- uses VARCHAR(64) primary keys holding meaningful ids — 'tenant-default',
-- 'usr-1', 'prod-fnb-1'. A UUID `merchant_id` here could not carry a foreign key
-- to tenants(id), so the single most important join in the whole BI layer
-- (health -> merchant) would need a cast on every query and could never be
-- enforced by the database.
--
-- Migrating the platform to UUID keys is defensible, but it is its own epic:
-- every table, every seed, every id-generating call site, and every id already
-- persisted in merchants' browsers. It must not happen as a side effect of
-- shipping the back-office. Flagged for an explicit decision.
-- =============================================================================


-- 1. INTERNAL IDENTITY PLANE -------------------------------------------------
--
-- SECURITY DECISION: our staff do NOT live in `users`.
--
-- `users` holds MERCHANT staff — cashiers, store managers, owners. If an
-- internal role like SUPERADMIN were just another value in that table's role
-- column, then any bug in merchant-side role handling (a bad UPDATE, a leaked
-- admin PIN, a mass-assignment in a settings form) would become a path to full
-- cross-merchant access to every tenant on the platform.
--
-- Internal staff therefore get a physically separate table, their own auth, and
-- no row-level relationship to any tenant. A merchant user can never be
-- "promoted" into this table by any merchant-facing code path.

DO $$ BEGIN
    CREATE TYPE internal_role_enum AS ENUM (
        'ROLE_SUPERADMIN',        -- full access incl. licence + billing writes
        'ROLE_INTERNAL_GROWTH',   -- MRR/GMV, churn cohorts, adoption. Read-only.
        'ROLE_INTERNAL_SUPPORT'   -- single-merchant troubleshooting. Read-only, audited.
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS internal_users (
    id             VARCHAR(64) PRIMARY KEY,
    email          VARCHAR(160) NOT NULL UNIQUE,
    full_name      VARCHAR(120) NOT NULL,
    role           internal_role_enum NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    -- Auth belongs to the identity provider (SSO), not to us. We store only the
    -- subject claim so a revoked SSO account instantly loses access.
    sso_subject    VARCHAR(200) UNIQUE,
    last_login_at  TIMESTAMP WITH TIME ZONE,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE internal_users IS
    'Employees of the SaaS provider. Deliberately separate from `users` (merchant staff) so merchant-side role bugs can never yield platform-wide access.';


-- 2. INTERNAL ACCESS AUDIT ---------------------------------------------------
--
-- Support staff can read a merchant's private business data. That power needs a
-- receipt: every internal read of tenant-scoped data writes a row here.
-- Without it there is no way to answer "who looked at this merchant's revenue?".

CREATE TABLE IF NOT EXISTS internal_access_log (
    id                VARCHAR(64) PRIMARY KEY,
    internal_user_id  VARCHAR(64) NOT NULL REFERENCES internal_users(id),
    internal_role     internal_role_enum NOT NULL,
    -- NULL for aggregate/platform-wide views that touch no single merchant.
    merchant_id       VARCHAR(64),
    action            VARCHAR(80) NOT NULL,   -- e.g. VIEW_MERCHANT_HEALTH
    resource          VARCHAR(120),           -- endpoint or report name
    justification     TEXT,                   -- required for SUPPORT deep-reads
    ip_address        VARCHAR(64),
    accessed_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_log_merchant  ON internal_access_log (merchant_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_user      ON internal_access_log (internal_user_id, accessed_at DESC);

COMMENT ON TABLE internal_access_log IS
    'Append-only receipt of every internal read of merchant data. Never UPDATE or DELETE.';


-- 3. FEATURE ADOPTION EVENT STREAM -------------------------------------------
--
-- Raw, append-only. The nightly job folds this into
-- merchant_health_logs.feature_usage_payload; keeping the raw stream means a new
-- adoption question can be answered retroactively without new instrumentation.

CREATE TABLE IF NOT EXISTS feature_usage_events (
    id            BIGSERIAL PRIMARY KEY,
    merchant_id   VARCHAR(64) NOT NULL,
    tenant_id     VARCHAR(64) NOT NULL,
    -- Partition key from TenantContext: `${userId}_${sector}`. Lets us see WHICH
    -- of a merchant's businesses adopted a feature, not just that someone did.
    business_id   VARCHAR(96),
    user_role     VARCHAR(32),
    feature_key   VARCHAR(80) NOT NULL,       -- 'ai.quick_chip.stock_critical'
    occurred_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_feature_events_merchant_time
    ON feature_usage_events (merchant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_events_key_time
    ON feature_usage_events (feature_key, occurred_at DESC);

COMMENT ON COLUMN feature_usage_events.metadata IS
    'Non-PII only. Never store customer names, phone numbers, or transaction contents here.';


-- 4. MERCHANT HEALTH LOGS (the table named in the spec) -----------------------

CREATE TABLE IF NOT EXISTS merchant_health_logs (
    id                      VARCHAR(64) PRIMARY KEY,
    merchant_id             VARCHAR(64) NOT NULL,
    tenant_id               VARCHAR(64) NOT NULL,
    log_date                DATE NOT NULL,

    daily_revenue           NUMERIC(15,2) NOT NULL DEFAULT 0,
    daily_transaction_count INT NOT NULL DEFAULT 0,
    active_cashiers_count   INT NOT NULL DEFAULT 0,

    -- Kept for spec compatibility: "did anyone sign in on this date".
    login_status            BOOLEAN NOT NULL DEFAULT TRUE,
    -- Added because a per-day boolean cannot express *drift*, which is the
    -- actual churn signal. These are what the risk score reads.
    last_activity_at        TIMESTAMP WITH TIME ZONE,
    days_since_last_txn     INT NOT NULL DEFAULT 0,
    active_days_last_7      INT NOT NULL DEFAULT 0,
    revenue_trend_pct       NUMERIC(6,2) NOT NULL DEFAULT 0,  -- 7d avg vs prior 23d avg

    feature_usage_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
    distinct_features_used  INT NOT NULL DEFAULT 0,
    support_tickets_count   INT NOT NULL DEFAULT 0,

    subscription_status     VARCHAR(20),
    -- Recognised: what is actually being collected right now (ACTIVE only).
    mrr_idr                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    -- Contract value regardless of payment state. "MRR at risk" must use this:
    -- a PAST_DUE merchant is recoverable revenue, and counting it as zero makes
    -- the urgency metric read 0 exactly when things are worst.
    contract_mrr_idr        NUMERIC(15,2) NOT NULL DEFAULT 0,

    churn_risk_score        NUMERIC(3,2) NOT NULL DEFAULT 0.00
                            CHECK (churn_risk_score >= 0 AND churn_risk_score <= 1),
    -- Why the score is what it is. A number a CSM cannot explain is a number
    -- they will not act on.
    churn_risk_reasons      JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_merchant_daily_health UNIQUE (merchant_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_health_merchant_date ON merchant_health_logs (merchant_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_health_churn_score   ON merchant_health_logs (churn_risk_score DESC);
-- The query the growth team actually runs: today's at-risk list.
CREATE INDEX IF NOT EXISTS idx_health_date_risk     ON merchant_health_logs (log_date DESC, churn_risk_score DESC);

COMMENT ON TABLE merchant_health_logs IS
    'One row per merchant per day. Written by the nightly job against the READ REPLICA; read by the internal BI tool. Never queried by the POS.';


-- 5. CHURN RISK SCORING ------------------------------------------------------
--
-- Explainable weighted model, not a black box. Every component is something a
-- CSM can act on, and the weights are visible so they can be argued with.
--
--   recency        0.40  no transactions = the strongest signal we have
--   activity       0.20  nobody signing in
--   revenue trend  0.15  still trading but shrinking
--   billing        0.15  PAST_DUE / EXPIRED
--   adoption       0.05  using one feature only = shallow, easy to replace
--   support        0.05  repeated tickets = friction
--
-- Returns 0.00 - 1.00.

CREATE OR REPLACE FUNCTION compute_churn_risk(
    p_days_since_last_txn  INT,
    p_active_days_last_7   INT,
    p_revenue_trend_pct    NUMERIC,
    p_subscription_status  VARCHAR,
    p_distinct_features    INT,
    p_support_tickets      INT
) RETURNS NUMERIC AS $$
DECLARE
    v_recency   NUMERIC := 0;
    v_activity  NUMERIC := 0;
    v_trend     NUMERIC := 0;
    v_billing   NUMERIC := 0;
    v_adoption  NUMERIC := 0;
    v_support   NUMERIC := 0;
BEGIN
    -- Recency: 0 at same-day, saturates at 14 days of silence.
    v_recency := LEAST(GREATEST(COALESCE(p_days_since_last_txn, 0), 0) / 14.0, 1.0);

    -- Activity: 7 active days = healthy, 0 = nobody opened the app.
    v_activity := 1.0 - (LEAST(GREATEST(COALESCE(p_active_days_last_7, 0), 0), 7) / 7.0);

    -- Trend: only decline counts. -50% or worse saturates.
    v_trend := LEAST(GREATEST(-COALESCE(p_revenue_trend_pct, 0), 0) / 50.0, 1.0);

    v_billing := CASE COALESCE(p_subscription_status, '')
                     WHEN 'EXPIRED'  THEN 1.0
                     WHEN 'PAST_DUE' THEN 0.7
                     WHEN 'CANCELED' THEN 1.0
                     WHEN 'TRIAL'    THEN 0.3   -- not yet committed
                     ELSE 0.0
                 END;

    -- Adoption: 5+ distinct features is sticky.
    v_adoption := 1.0 - (LEAST(GREATEST(COALESCE(p_distinct_features, 0), 0), 5) / 5.0);

    -- Support: 3+ tickets in the window saturates.
    v_support := LEAST(GREATEST(COALESCE(p_support_tickets, 0), 0) / 3.0, 1.0);

    RETURN ROUND(LEAST(
        v_recency  * 0.40 +
        v_activity * 0.20 +
        v_trend    * 0.15 +
        v_billing  * 0.15 +
        v_adoption * 0.05 +
        v_support  * 0.05
    , 1.0), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION compute_churn_risk IS
    'Explainable churn score 0.00-1.00. Weights are intentionally visible so the growth team can challenge them; recompute history after any change.';


-- 6. BI READ SURFACE ---------------------------------------------------------
--
-- The BI tool (Metabase/Retool/Appsmith) connects to the READ REPLICA using a
-- role that can only SELECT, and only from these views. Pointing a BI tool at
-- raw tables on the primary is how an analyst's accidental cross join takes the
-- cashier terminals down mid-service.

CREATE OR REPLACE VIEW v_merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id,
       h.tenant_id,
       h.log_date,
       h.daily_revenue,
       h.daily_transaction_count,
       h.active_cashiers_count,
       h.days_since_last_txn,
       h.active_days_last_7,
       h.revenue_trend_pct,
       h.distinct_features_used,
       h.support_tickets_count,
       h.subscription_status,
       h.mrr_idr,
       h.contract_mrr_idr,
       h.churn_risk_score,
       h.churn_risk_reasons,
       CASE
           WHEN h.churn_risk_score >= 0.70 THEN 'CRITICAL'
           WHEN h.churn_risk_score >= 0.45 THEN 'AT_RISK'
           WHEN h.churn_risk_score >= 0.25 THEN 'WATCH'
           ELSE 'HEALTHY'
       END AS health_band
  FROM merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;

COMMENT ON VIEW v_merchant_health_latest IS 'Most recent health row per merchant. The back-office landing table.';

CREATE OR REPLACE VIEW v_platform_mrr AS
SELECT date_trunc('month', s.current_period_start)::date AS month,
       COUNT(*) FILTER (WHERE s.status = 'ACTIVE')       AS active_subscriptions,
       COUNT(*) FILTER (WHERE s.status = 'TRIAL')        AS trials,
       COUNT(*) FILTER (WHERE s.status = 'PAST_DUE')     AS past_due,
       COALESCE(SUM(p.price_idr) FILTER (WHERE s.status = 'ACTIVE'), 0) AS mrr_idr
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
 GROUP BY 1
 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW v_feature_adoption_30d AS
SELECT e.feature_key,
       COUNT(DISTINCT e.merchant_id) AS merchants_using,
       COUNT(*)                      AS events,
       MAX(e.occurred_at)            AS last_used_at
  FROM feature_usage_events e
 WHERE e.occurred_at >= CURRENT_DATE - INTERVAL '30 days'
 GROUP BY e.feature_key
 ORDER BY merchants_using DESC;


-- 7. READ-REPLICA / OLAP ISOLATION -------------------------------------------
--
-- Physical separation is a deployment concern (streaming replication or a
-- managed read replica), but the ACCESS boundary is enforced here:
--
--   1. Provision the replica from the primary.
--   2. Point the BI tool and the nightly health job at the REPLICA only.
--   3. The POS API keeps its own credentials against the PRIMARY and must never
--      be handed `bi_readonly`.
--
-- A replica cannot accept writes, so this role is defence in depth for the case
-- where someone points it at the primary by mistake.

DO $$ BEGIN
    CREATE ROLE bi_readonly NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO bi_readonly;
GRANT SELECT ON v_merchant_health_latest, v_platform_mrr, v_feature_adoption_30d TO bi_readonly;
GRANT SELECT ON merchant_health_logs, feature_usage_events TO bi_readonly;

-- Explicitly NOT granted: users, transactions, transaction_items, customers.
-- Internal analytics runs on aggregates; raw merchant transaction rows and
-- end-customer PII stay out of the BI tool entirely.
REVOKE ALL ON internal_access_log FROM bi_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO bi_readonly;


-- 8. SEED --------------------------------------------------------------------

INSERT INTO internal_users (id, email, full_name, role)
VALUES ('int-root', 'ops@newhopepos.id', 'Platform Root', 'ROLE_SUPERADMIN')
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- ROLLBACK (uncomment to revert)
-- =============================================================================
-- DROP VIEW IF EXISTS v_feature_adoption_30d;
-- DROP VIEW IF EXISTS v_platform_mrr;
-- DROP VIEW IF EXISTS v_merchant_health_latest;
-- DROP FUNCTION IF EXISTS compute_churn_risk(INT, INT, NUMERIC, VARCHAR, INT, INT);
-- DROP TABLE IF EXISTS merchant_health_logs;
-- DROP TABLE IF EXISTS feature_usage_events;
-- DROP TABLE IF EXISTS internal_access_log;
-- DROP TABLE IF EXISTS internal_users;
-- DROP TYPE IF EXISTS internal_role_enum;
-- DROP ROLE IF EXISTS bi_readonly;
