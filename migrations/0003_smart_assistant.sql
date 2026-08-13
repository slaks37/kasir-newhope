-- =============================================================================
-- 0003_smart_assistant.sql
-- Smart Assistant Engine — batch learning store, AI credit wallet, audit trail.
--
-- Consistent with schema.sql and schema_hybrid_pos.sql: VARCHAR(64) ids,
-- tenant_id on every row, TIMESTAMP WITH TIME ZONE, JSONB payloads, snake_case.
--
-- Cost-control intent: `daily_merchant_insights` is written ONCE per merchant
-- per night by the cron job, and read thousands of times per day by the app for
-- free. Every read served from this table is an LLM call that never happened.
--
-- -----------------------------------------------------------------------------
-- MIGRATION SAFETY — applying this file over an earlier revision
-- -----------------------------------------------------------------------------
-- An earlier revision of this same file created two Postgres ENUM types
-- (`insight_category_enum`, `insight_status_enum`) and typed
-- `daily_merchant_insights.category` / `.status` against them. That revision may
-- already be deployed. This file is written so that BOTH paths work:
--
--   FRESH DATABASE   Section 1 creates the one remaining enum, Section 2 finds
--                    no table and returns immediately, Section 3 creates
--                    everything with VARCHAR + CHECK.
--
--   UPGRADE IN PLACE Section 2 detects the old enum-typed columns, converts them
--                    to VARCHAR with `USING <col>::text`, renames the two values
--                    that changed (PEAK_HOURS -> OPERATIONAL_PEAK,
--                    FINANCIAL_ANOMALY -> FINANCIAL_PERFORMANCE), then drops the
--                    now-unreferenced enum types. Section 3's
--                    CREATE TABLE IF NOT EXISTS becomes a no-op, and Section 3b
--                    re-asserts the CHECK constraints from a single source of
--                    truth.
--
-- The whole file is idempotent and safe to re-run. Run it inside a transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0003_smart_assistant.sql
--
-- No data is lost by the conversion: every enum label round-trips through
-- ::text unchanged. Rows written by the old revision keep their history; only
-- the two renamed category labels are rewritten in place.
--
-- If the upgrade runs against a database that already holds BOTH an old
-- 'PEAK_HOURS' row and a new 'OPERATIONAL_PEAK' row for the same
-- (merchant_id, insight_date) — impossible in practice, since the old revision
-- could not emit the new label — the rename would violate uq_insight_per_day.
-- In that case delete the stale day and let the nightly job recompute it:
--   DELETE FROM daily_merchant_insights WHERE insight_date < CURRENT_DATE;
-- =============================================================================


-- 1. ENUM TYPES --------------------------------------------------------------
--
-- ARCHITECTURAL DECISION (a): the insight category is NOT a Postgres ENUM.
--
-- The design justifies storing the insight body as JSONB on the grounds of
-- "zero migration overhead" — a new insight shape ships as a code change, not a
-- schema change. A Postgres ENUM on `category` contradicts exactly that: adding
-- a tenth category would require `ALTER TYPE insight_category_enum ADD VALUE
-- '...'`, which IS a migration, cannot be rolled back, and on PostgreSQL < 12
-- cannot even run inside a transaction block — so it cannot be bundled with the
-- rest of a deploy. VARCHAR(40) + CHECK keeps category evolution as cheap as
-- payload evolution: one line in this file, revertible, transactional, and the
-- constraint can be dropped and re-added in the same statement batch.
--
-- The same reasoning applies to `status`.
--
-- `batch_run_status_enum` STAYS an enum: SUCCESS / FAILED / SKIPPED is a
-- genuinely closed set describing how a process terminated. It is not a product
-- taxonomy and will not grow.

DO $$ BEGIN
    CREATE TYPE batch_run_status_enum AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- 2. IN-PLACE UPGRADE FROM THE ENUM REVISION ---------------------------------
-- No-op on a fresh database. See the MIGRATION SAFETY note in the header.

DO $$
DECLARE
    v_category_type TEXT;
    v_status_type   TEXT;
BEGIN
    IF to_regclass('public.daily_merchant_insights') IS NULL THEN
        RETURN;  -- fresh install; Section 3 builds the correct shape directly.
    END IF;

    SELECT atttypid::regtype::text INTO v_category_type
      FROM pg_attribute
     WHERE attrelid = 'public.daily_merchant_insights'::regclass
       AND attname  = 'category'
       AND NOT attisdropped;

    SELECT atttypid::regtype::text INTO v_status_type
      FROM pg_attribute
     WHERE attrelid = 'public.daily_merchant_insights'::regclass
       AND attname  = 'status'
       AND NOT attisdropped;

    IF v_category_type = 'insight_category_enum' THEN
        ALTER TABLE daily_merchant_insights
            ALTER COLUMN category TYPE VARCHAR(40) USING category::text;
        RAISE NOTICE '0003: category converted insight_category_enum -> VARCHAR(40)';
    END IF;

    IF v_status_type = 'insight_status_enum' THEN
        -- The DEFAULT is enum-typed and blocks the conversion; drop, convert,
        -- restore.
        ALTER TABLE daily_merchant_insights ALTER COLUMN status DROP DEFAULT;
        ALTER TABLE daily_merchant_insights
            ALTER COLUMN status TYPE VARCHAR(16) USING status::text;
        ALTER TABLE daily_merchant_insights ALTER COLUMN status SET DEFAULT 'ACTIVE';
        RAISE NOTICE '0003: status converted insight_status_enum -> VARCHAR(16)';
    END IF;

    -- Category renames from the previous revision. Safe now that the column is
    -- text-typed. Both are pure relabels — payload shape is unchanged for
    -- OPERATIONAL_PEAK; FINANCIAL_PERFORMANCE rows written by the old revision
    -- carry only the `anomalies` half of the payload and will be overwritten by
    -- the next nightly run.
    UPDATE daily_merchant_insights
       SET category = 'OPERATIONAL_PEAK'
     WHERE category = 'PEAK_HOURS';

    UPDATE daily_merchant_insights
       SET category = 'FINANCIAL_PERFORMANCE'
     WHERE category = 'FINANCIAL_ANOMALY';

    -- Nothing references these types any more.
    DROP TYPE IF EXISTS insight_category_enum;
    DROP TYPE IF EXISTS insight_status_enum;
END $$;


-- 3. DAILY BATCH LEARNING OUTPUT --------------------------------------------
--
-- ARCHITECTURAL DECISION (b): ids stay VARCHAR(64). No UUID, no
-- gen_random_uuid().
--
-- Every table already in schema.sql and schema_hybrid_pos.sql uses VARCHAR(64)
-- primary keys holding human-readable, meaningful ids: 'tenant-default',
-- 'prod-fnb-1', 'INV-20260811-001'. `merchant_id` here has to line up with
-- tenants.id / users.id — a UUID column simply cannot carry a foreign key to a
-- VARCHAR(64) column, so switching this one table to UUID would make the join
-- impossible without casting on every query.
--
-- Moving the platform to UUID keys is a defensible change, but it touches every
-- table, every seed, every id-generating call site and every stored id in the
-- browser's localStorage. That is its own epic with its own migration and its
-- own rollback plan — it must not happen as a side effect of shipping the Smart
-- Assistant.

CREATE TABLE IF NOT EXISTS daily_merchant_insights (
    id             VARCHAR(64) PRIMARY KEY,
    merchant_id    VARCHAR(64) NOT NULL,
    tenant_id      VARCHAR(64) NOT NULL,
    insight_date   DATE NOT NULL,
    -- Domain enforced by ck_insight_category (Section 3b), not by a Postgres
    -- ENUM. See decision (a).
    category       VARCHAR(40) NOT NULL,
    priority       SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
    title          VARCHAR(200) NOT NULL,
    summary        TEXT NOT NULL,
    metric_label   VARCHAR(80) NOT NULL DEFAULT '',
    payload        JSONB NOT NULL,
    actions        JSONB NOT NULL DEFAULT '[]'::jsonb,
    status         VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- A re-run of the nightly job must UPDATE, never duplicate. This is what
    -- makes the cron job safely idempotent and re-runnable at any hour.
    CONSTRAINT uq_insight_per_day UNIQUE (merchant_id, insight_date, category)
);


-- 3b. CATEGORY / STATUS DOMAIN ----------------------------------------------
--
-- ARCHITECTURAL DECISION (c): the nine categories below are the domain, and
-- they must stay byte-identical to the `InsightCategory` union in
-- src/lib/assistant/types.ts.
--
-- Asserted with DROP + ADD so this block is the single source of truth for both
-- a fresh install and an upgrade, and so adding a tenth category later is a
-- one-line, fully transactional change.
--
--   INVENTORY_ALERT         stok menipis / ROP dinamis
--   CROSS_SELL_OPPORTUNITY  market basket (support / confidence / lift)
--   CRM_CHURN               RFM, pelanggan bernilai yang menghilang
--   OPERATIONAL_PEAK        jam & hari ramai/sepi        (was PEAK_HOURS)
--   FINANCIAL_PERFORMANCE   run-rate vs target + anomali (was FINANCIAL_ANOMALY)
--   CALENDAR_BEHAVIOR       siklus gajian tanggal 25-3 vs 4-24
--   SHIFT_PERFORMANCE       laci kasir: selisih kas + sales/jam
--   LAYOUT_UTILISATION      denah: turnover per meja/rak/bay
--   STAFF_BEHAVIOUR         perilaku staf: layanan + absensi
--
-- STAFF_BEHAVIOUR and SHIFT_PERFORMANCE are deliberately separate: the first is
-- about the person serving the customer (order attribution, clock-ins), the
-- second is about the till session (cash variance, throughput). One merchant can
-- have a warm, punctual barista whose drawer is short every night.

ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_category;
ALTER TABLE daily_merchant_insights ADD  CONSTRAINT ck_insight_category CHECK (
    category IN (
        'INVENTORY_ALERT',
        'CROSS_SELL_OPPORTUNITY',
        'CRM_CHURN',
        'OPERATIONAL_PEAK',
        'FINANCIAL_PERFORMANCE',
        'CALENDAR_BEHAVIOR',
        'SHIFT_PERFORMANCE',
        'LAYOUT_UTILISATION',
        'STAFF_BEHAVIOUR'
    )
);

ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_status;
ALTER TABLE daily_merchant_insights ADD  CONSTRAINT ck_insight_status CHECK (
    status IN ('ACTIVE', 'DISMISSED', 'ACTIONED')
);

COMMENT ON TABLE  daily_merchant_insights IS
    'Pre-calculated nightly insights. Serving a merchant question from this table costs Rp 0; the alternative is a billed LLM call.';
COMMENT ON COLUMN daily_merchant_insights.category IS
    'One of nine values, enforced by ck_insight_category. VARCHAR + CHECK instead of a Postgres ENUM so a new category costs one revertible line, not an ALTER TYPE that cannot run in a transaction on PG < 12.';
COMMENT ON COLUMN daily_merchant_insights.priority IS
    '1=HIGH (act today), 2=MEDIUM, 3=LOW (informational). SMALLINT, not an enum: integers sort naturally in ORDER BY priority.';
COMMENT ON COLUMN daily_merchant_insights.payload IS
    'Category-specific JSON matching the InsightPayload discriminated union in src/lib/assistant/types.ts. Contains aggregates only — never raw transaction rows.';
COMMENT ON COLUMN daily_merchant_insights.status IS
    'ACTIVE | DISMISSED | ACTIONED. DISMISSED and ACTIONED are set by the merchant from the Smart Card UI, so the same advice is not repeated.';

CREATE INDEX IF NOT EXISTS idx_insights_merchant_date
    ON daily_merchant_insights (merchant_id, insight_date DESC);
CREATE INDEX IF NOT EXISTS idx_insights_merchant_active
    ON daily_merchant_insights (merchant_id, status, priority)
    WHERE status = 'ACTIVE';
-- Kept: the GIN index makes payload interrogation cheap without a schema
-- change, e.g. "which merchants have an OUT_OF_STOCK item tonight?"
--   WHERE payload @> '{"items":[{"severity":"OUT_OF_STOCK"}]}'
CREATE INDEX IF NOT EXISTS idx_insights_payload_gin
    ON daily_merchant_insights USING GIN (payload);


-- 4. MERCHANT REVENUE TARGET -------------------------------------------------
--
-- WHERE THIS LIVES — decision and rationale.
--
-- CHOSEN: a new dedicated table, `merchant_targets`.
-- REJECTED: adding the column to a store-settings table.
--
-- Why: there is no `store_settings` table in Postgres to add a column to.
-- StoreSettings (src/types.ts, field `monthlyRevenueTarget?: number`) currently
-- lives entirely in the browser's localStorage as one JSON blob; schema.sql and
-- schema_hybrid_pos.sql never model it. Blocking the FINANCIAL_PERFORMANCE card
-- on "first design and migrate the whole settings table" would be the tail
-- wagging the dog, and hanging the column off `tenants` would mix a business
-- goal that changes every quarter into an identity table that never changes.
--
-- A one-column keyed table is also the honest shape: the target is per merchant,
-- optional, and mutable independently of everything else in settings.
--
-- When a real `store_settings` table eventually lands, THIS table stays the
-- canonical source for the target and the settings row reads from it — do not
-- duplicate the value in two places.
--
-- NULL is meaningful, not missing data: NULL means "merchant never set one", and
-- the batch engine then auto-derives a target from the trailing 3 complete
-- months x 1.1 and reports targetSource = 'AUTO'. See resolveMonthlyTarget() in
-- src/lib/assistant/insights.ts and MerchantAggregates.targetSource
-- ('MERCHANT' | 'AUTO' | 'NONE') in src/lib/assistant/types.ts.

CREATE TABLE IF NOT EXISTS merchant_targets (
    merchant_id            VARCHAR(64) PRIMARY KEY,
    tenant_id              VARCHAR(64) NOT NULL,
    -- NUMERIC(14,2): IDR has no minor unit in practice but the rest of the
    -- schema stores money as NUMERIC(12,2); 14 digits leaves headroom for a
    -- monthly target in the tens of billions without changing the type later.
    monthly_revenue_target NUMERIC(14, 2)
                           CHECK (monthly_revenue_target IS NULL
                                  OR monthly_revenue_target > 0),
    currency               VARCHAR(10) NOT NULL DEFAULT 'IDR',
    updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  merchant_targets IS
    'Optional per-merchant business goals for the Smart Assistant. Separate from tenants/settings so a quarterly goal can change without touching identity data.';
COMMENT ON COLUMN merchant_targets.monthly_revenue_target IS
    'Target omzet bulanan (IDR). NULL = merchant has not set one; the batch engine then derives avg(trailing 3 complete months) x 1.1 and flags targetSource=AUTO, so the card is useful on day 1 instead of permanently empty.';
COMMENT ON COLUMN merchant_targets.merchant_id IS
    'Matches tenants.id / users.id. VARCHAR(64) precisely so this FK relationship remains possible — see decision (b) in the header.';

CREATE INDEX IF NOT EXISTS idx_merchant_targets_tenant
    ON merchant_targets (tenant_id);


-- 5. AI CREDIT WALLET (the paid Layer 3 gate) -------------------------------

CREATE TABLE IF NOT EXISTS merchant_ai_credits (
    merchant_id      VARCHAR(64) PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    balance          INT NOT NULL DEFAULT 30 CHECK (balance >= 0),
    monthly_grant    INT NOT NULL DEFAULT 30 CHECK (monthly_grant >= 0),
    used_this_month  INT NOT NULL DEFAULT 0 CHECK (used_this_month >= 0),
    period_reset_at  TIMESTAMP WITH TIME ZONE NOT NULL
                     DEFAULT (date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  merchant_ai_credits IS
    'Hard quota for Layer 3. Deterministic answers never touch this table, so routine usage can never drain it.';
COMMENT ON COLUMN merchant_ai_credits.balance IS
    'CHECK (balance >= 0) is the last line of defence: even a buggy caller cannot push a merchant into negative credit.';


-- 6. AUDIT TRAIL — proves the >=90% zero-cost objective is being met ---------

CREATE TABLE IF NOT EXISTS ai_query_logs (
    id                 VARCHAR(64) PRIMARY KEY,
    merchant_id        VARCHAR(64) NOT NULL,
    tenant_id          VARCHAR(64) NOT NULL,
    asked_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    query_text         TEXT,
    resolved_intent    VARCHAR(64),
    source             VARCHAR(20) NOT NULL
                       CHECK (source IN ('RULE_ENGINE','BATCH_INSIGHT','LLM','PAYWALL','ERROR')),
    credits_charged    INT NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
    latency_ms         INT,
    model              VARCHAR(64),
    prompt_tokens      INT,
    completion_tokens  INT
);

COMMENT ON TABLE ai_query_logs IS
    'One row per assistant question. zero-cost rate = count(credits_charged = 0) / count(*). Drops below 90% mean the intent parser is missing vocabulary — fix the parser, do not buy more credits.';
COMMENT ON COLUMN ai_query_logs.model IS
    'Model id actually billed, e.g. deepseek-chat. NULL for every deterministic answer.';
COMMENT ON COLUMN ai_query_logs.resolved_intent IS
    'IntentName from src/lib/assistant/types.ts. VARCHAR, not an enum: the intent vocabulary grows every time the parser learns a new phrase.';

CREATE INDEX IF NOT EXISTS idx_ai_query_logs_merchant
    ON ai_query_logs (merchant_id, asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_source
    ON ai_query_logs (source, asked_at DESC);


-- 7. BATCH JOB OBSERVABILITY ------------------------------------------------

CREATE TABLE IF NOT EXISTS batch_job_runs (
    id                VARCHAR(64) PRIMARY KEY,
    job_name          VARCHAR(64) NOT NULL,
    merchant_id       VARCHAR(64),
    started_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at       TIMESTAMP WITH TIME ZONE,
    status            batch_run_status_enum NOT NULL DEFAULT 'SUCCESS',
    insights_written  INT NOT NULL DEFAULT 0,
    duration_ms       INT,
    error_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_job_runs_recent
    ON batch_job_runs (job_name, started_at DESC);


-- 8. ATOMIC CREDIT CONSUMPTION ----------------------------------------------

/*
 * Prevents this race:
 *   request A reads balance = 1
 *   request B reads balance = 1
 *   both decide "there is credit", both call the LLM, both write balance = 0
 *   -> the merchant paid for one credit and received two billed calls.
 *
 * Doing the check and the decrement in ONE statement means the second caller's
 * WHERE clause simply matches no rows and it gets FALSE.
 */
CREATE OR REPLACE FUNCTION consume_ai_credit(p_merchant_id VARCHAR(64))
RETURNS BOOLEAN AS $$
DECLARE
    v_new_balance INT;
BEGIN
    UPDATE merchant_ai_credits
       SET balance         = balance - 1,
           used_this_month = used_this_month + 1,
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id
       AND balance > 0
    RETURNING balance INTO v_new_balance;

    RETURN v_new_balance IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION consume_ai_credit IS
    'Atomically spends one AI credit. Returns FALSE when the merchant is out of quota — the caller must then show the paywall and MUST NOT call the model.';

/* Refund path for a model call that failed after the credit was taken. */
CREATE OR REPLACE FUNCTION refund_ai_credit(p_merchant_id VARCHAR(64))
RETURNS VOID AS $$
BEGIN
    UPDATE merchant_ai_credits
       SET balance         = balance + 1,
           used_this_month = GREATEST(0, used_this_month - 1),
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refund_ai_credit IS
    'Gives the credit back when the model call failed after the debit. Billing a call that never produced an answer is a bug, not revenue.';

/* Monthly grant reset — safe to run daily, only touches expired periods. */
CREATE OR REPLACE FUNCTION reset_ai_credits_monthly()
RETURNS INT AS $$
DECLARE
    v_rows INT;
BEGIN
    UPDATE merchant_ai_credits
       SET balance         = monthly_grant,
           used_this_month = 0,
           period_reset_at = date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month',
           updated_at      = CURRENT_TIMESTAMP
     WHERE period_reset_at <= CURRENT_TIMESTAMP;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reset_ai_credits_monthly IS
    'Idempotent monthly grant refill. Safe to run every night — the WHERE clause only matches periods that have actually expired.';


-- 9. SEED --------------------------------------------------------------------

INSERT INTO merchant_ai_credits (merchant_id, tenant_id, balance, monthly_grant)
VALUES ('tenant-default', 'tenant-default', 30, 30)
ON CONFLICT (merchant_id) DO NOTHING;

-- No target seeded on purpose: the demo merchant must exercise the AUTO path,
-- which is what nearly every real merchant will hit on day 1.
INSERT INTO merchant_targets (merchant_id, tenant_id, monthly_revenue_target)
VALUES ('tenant-default', 'tenant-default', NULL)
ON CONFLICT (merchant_id) DO NOTHING;


-- =============================================================================
-- ROLLBACK (uncomment to revert this migration)
-- =============================================================================
-- DROP FUNCTION IF EXISTS reset_ai_credits_monthly();
-- DROP FUNCTION IF EXISTS refund_ai_credit(VARCHAR);
-- DROP FUNCTION IF EXISTS consume_ai_credit(VARCHAR);
-- DROP TABLE IF EXISTS batch_job_runs;
-- DROP TABLE IF EXISTS ai_query_logs;
-- DROP TABLE IF EXISTS merchant_ai_credits;
-- DROP TABLE IF EXISTS merchant_targets;
-- DROP TABLE IF EXISTS daily_merchant_insights;
-- DROP TYPE  IF EXISTS batch_run_status_enum;
--
-- `insight_category_enum` and `insight_status_enum` are intentionally absent:
-- this revision no longer creates them, and Section 2 drops them if an earlier
-- revision left them behind. Dropping the tables above therefore leaves nothing
-- orphaned.
--
-- PARTIAL ROLLBACK — going back to the enum revision WITHOUT losing rows
-- (only needed if some other deployed code still expects the enum types):
--
-- CREATE TYPE insight_status_enum AS ENUM ('ACTIVE','DISMISSED','ACTIONED');
-- CREATE TYPE insight_category_enum AS ENUM (
--     'INVENTORY_ALERT','CROSS_SELL_OPPORTUNITY','CRM_CHURN','PEAK_HOURS',
--     'FINANCIAL_ANOMALY','LAYOUT_UTILISATION','STAFF_BEHAVIOUR');
-- DELETE FROM daily_merchant_insights
--  WHERE category IN ('CALENDAR_BEHAVIOR','SHIFT_PERFORMANCE');  -- no old label
-- UPDATE daily_merchant_insights SET category='PEAK_HOURS'
--  WHERE category='OPERATIONAL_PEAK';
-- UPDATE daily_merchant_insights SET category='FINANCIAL_ANOMALY'
--  WHERE category='FINANCIAL_PERFORMANCE';
-- ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_category;
-- ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_status;
-- ALTER TABLE daily_merchant_insights
--     ALTER COLUMN category TYPE insight_category_enum USING category::insight_category_enum;
-- ALTER TABLE daily_merchant_insights ALTER COLUMN status DROP DEFAULT;
-- ALTER TABLE daily_merchant_insights
--     ALTER COLUMN status TYPE insight_status_enum USING status::insight_status_enum;
-- ALTER TABLE daily_merchant_insights ALTER COLUMN status SET DEFAULT 'ACTIVE';
--
-- The DELETE is unavoidable and is the whole point of decision (a): an ENUM
-- makes adding a category a migration AND makes removing one destructive.
