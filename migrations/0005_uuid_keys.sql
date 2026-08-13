-- =============================================================================
-- 0005_uuid_keys.sql
-- DECISION: surrogate keys become UUIDv7. Business identifiers stay readable.
-- =============================================================================
--
-- This reverses the position taken in 0003 (decision b) and 0004. That earlier
-- call was "keep VARCHAR(64) because everything already uses it" — correct given
-- what was known then. Two facts since change the answer:
--
--   1. IDs ARE GENERATED ON THE CLIENT, FROM Date.now() ALONE.
--      Fourteen entity types do it: att-, branch-, cust-, inv-, log-, prod-,
--      shift-, slot-, stf-, stk-, sub- and more. The product spec requires the
--      cashier terminal to be OFFLINE-FIRST. Two terminals offline in the same
--      millisecond therefore mint the SAME id. On sync that is a primary-key
--      violation at best and a silent overwrite of someone's transaction at
--      worst. A single-outlet demo never sees it; a 5-outlet Pro merchant will.
--      No amount of care in application code fixes a 48-bit-of-entropy id.
--
--   2. Sequential ids leak and enumerate. 'INV-20260811-0004' printed on a
--      receipt tells anyone holding it exactly how many sales that merchant made
--      that day. 'usr-2' and 'tenant-3' are guessable in URLs shared between
--      merchants and our own support staff.
--
-- And the cost will never be lower than today: there is no deployed Postgres.
-- Merchant data lives in browsers. Every month of delay adds installs whose
-- localStorage holds string ids.
--
-- -----------------------------------------------------------------------------
-- THE RULE (so this is a decision, not a half-measure)
-- -----------------------------------------------------------------------------
--   UUID v7   ->  anything client-generatable, tenant-scoped, or high-volume.
--                 Surrogate keys. Never shown to a human.
--
--   VARCHAR   ->  STATIC CONFIG rows that live in code, are never generated at
--                 runtime, never sync, and are not tenant data. Exactly one
--                 table qualifies: `plans` ('plan-pro-monthly'). Three rows,
--                 referenced by name in server.ts.
--
--   VARCHAR   ->  HUMAN-FACING BUSINESS IDENTIFIERS, kept as their own UNIQUE
--                 column beside the UUID key — never as the key itself:
--                 invoice_number, sku, barcode, plan code.
--                 Support staff and receipts keep something readable; the
--                 database keeps something safe.
--
-- v7 rather than v4: v4 is random, which scatters B-tree inserts and bloats
-- high-write tables like transactions. v7 is time-ordered, so inserts stay
-- local while remaining globally unique. Native in PostgreSQL 18.
--
-- -----------------------------------------------------------------------------
-- SAFETY
-- -----------------------------------------------------------------------------
-- `legacy_uuid()` maps an old string id to a UUID DETERMINISTICALLY. Running
-- this migration twice, or migrating a browser's localStorage separately,
-- produces the same UUID for the same input — so existing data keeps its
-- relationships instead of being orphaned.
--
-- Run inside a transaction:
--   psql "$DATABASE_URL" --single-transaction -f migrations/0005_uuid_keys.sql
-- =============================================================================


-- 1. DETERMINISTIC LEGACY MAPPING --------------------------------------------

CREATE OR REPLACE FUNCTION legacy_uuid(p_legacy TEXT)
RETURNS UUID AS $$
DECLARE
    h TEXT;
BEGIN
    IF p_legacy IS NULL THEN
        RETURN NULL;
    END IF;

    -- Already a UUID? Pass through unchanged so the migration is re-runnable.
    IF p_legacy ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN p_legacy::uuid;
    END IF;

    -- Namespaced md5 so 'usr-1' in this platform can never collide with 'usr-1'
    -- from an unrelated system, and set the version/variant nibbles so the
    -- result is a well-formed v5-style UUID.
    h := md5('newhope-pos:' || p_legacy);

    RETURN (
        substr(h, 1, 8)  || '-' ||
        substr(h, 9, 4)  || '-5' ||
        substr(h, 14, 3) || '-' ||
        to_hex((('x' || substr(h, 17, 2))::bit(8)::int & 63) | 128) || substr(h, 19, 2) || '-' ||
        substr(h, 21, 12)
    )::uuid;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION legacy_uuid IS
    'Stable string-id -> UUID mapping. Same input always yields the same UUID, so server tables and a browser localStorage migration agree without coordination.';


-- 2. PRESERVE HUMAN-FACING IDENTIFIERS ---------------------------------------
-- Before the keys change, copy anything a human reads into its own column.

DO $$
BEGIN
    IF to_regclass('public.transactions') IS NOT NULL THEN
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(32);
        -- The old id WAS the invoice number ('INV-20260811-0004'). Keep it.
        EXECUTE 'UPDATE transactions SET invoice_number = id::text WHERE invoice_number IS NULL';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_invoice_number
            ON transactions (tenant_id, invoice_number);
        COMMENT ON COLUMN transactions.invoice_number IS
            'Human-facing receipt number. Printed, quoted by customers, searched by support. Unique per tenant — deliberately NOT the primary key.';
    END IF;

    IF to_regclass('public.plans') IS NOT NULL THEN
        ALTER TABLE plans ADD COLUMN IF NOT EXISTS code VARCHAR(64);
        EXECUTE 'UPDATE plans SET code = id::text WHERE code IS NULL';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_code ON plans (code);
    END IF;
END $$;


-- 2b. DROP DEPENDENT VIEWS ---------------------------------------------------
-- PostgreSQL refuses to alter a column's type while a view selects it. The BI
-- views from 0004 are rebuilt verbatim in section 6 once the keys are UUID.

DROP VIEW IF EXISTS v_merchant_health_latest;
DROP VIEW IF EXISTS v_platform_mrr;
DROP VIEW IF EXISTS v_feature_adoption_30d;


-- 3. KEY CONVERSION ----------------------------------------------------------
--
-- Driven by an explicit list rather than 20 hand-written blocks: the list is
-- auditable at a glance and cannot drift out of step with itself.
--
-- `plans` is absent on purpose — see THE RULE above.

-- A hand-written column list is guaranteed to miss something: the first attempt
-- omitted transactions.cashier_user_id -> users.id and the migration failed when
-- the foreign key could not be rebuilt across a uuid/varchar mismatch.
--
-- So only the KEYS are declared below. Every column that REFERENCES one of these
-- tables is discovered from pg_constraint and converted automatically, which
-- makes it impossible for the two sides of a foreign key to drift apart.

DO $$
DECLARE
    -- table, column, is_primary
    targets TEXT[][] := ARRAY[
        ['tenants','id','1'],
        ['users','id','1'], ['users','tenant_id','0'],
        ['ingredients','id','1'], ['ingredients','tenant_id','0'],
        ['products','id','1'], ['products','tenant_id','0'],
        ['product_recipes','id','1'], ['product_recipes','tenant_id','0'],
        ['product_recipes','product_id','0'], ['product_recipes','ingredient_id','0'],
        ['transactions','id','1'], ['transactions','tenant_id','0'],
        ['transaction_items','id','1'], ['transaction_items','tenant_id','0'],
        ['transaction_items','transaction_id','0'], ['transaction_items','product_id','0'],
        ['inventory_logs','id','1'], ['inventory_logs','tenant_id','0'],
        ['subscriptions','id','1'], ['subscriptions','tenant_id','0'],
        ['invoices','id','1'], ['invoices','tenant_id','0'], ['invoices','subscription_id','0'],
        ['daily_merchant_insights','id','1'],
        ['daily_merchant_insights','merchant_id','0'], ['daily_merchant_insights','tenant_id','0'],
        ['merchant_targets','merchant_id','1'], ['merchant_targets','tenant_id','0'],
        ['merchant_ai_credits','merchant_id','1'], ['merchant_ai_credits','tenant_id','0'],
        ['batch_job_runs','id','1'], ['batch_job_runs','merchant_id','0'],
        ['ai_query_logs','id','1'], ['ai_query_logs','merchant_id','0'], ['ai_query_logs','tenant_id','0'],
        ['merchant_health_logs','id','1'],
        ['merchant_health_logs','merchant_id','0'], ['merchant_health_logs','tenant_id','0'],
        ['feature_usage_events','merchant_id','0'], ['feature_usage_events','tenant_id','0'],
        ['internal_users','id','1'],
        ['internal_access_log','id','1'], ['internal_access_log','internal_user_id','0'],
        ['internal_access_log','merchant_id','0']
    ];
    t TEXT; c TEXT; idx INT;
    tbl_names TEXT[] := ARRAY[]::TEXT[];
    fk RECORD;
    dropped TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Distinct table names touched by this migration.
    FOR idx IN 1 .. array_length(targets, 1) LOOP
        IF NOT (targets[idx][1] = ANY (tbl_names)) THEN
            tbl_names := tbl_names || targets[idx][1];
        END IF;
    END LOOP;

    -- 3a. Discover every column that REFERENCES a table being converted, and
    --     append it to the conversion set. This is what stops one side of a
    --     foreign key from being left behind as VARCHAR.
    FOR fk IN
        SELECT con.conrelid::regclass::text AS tbl,
               att.attname::text            AS col
          FROM pg_constraint con
          JOIN unnest(con.conkey) AS k(attnum) ON TRUE
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid AND att.attnum = k.attnum
         WHERE con.contype = 'f'
           AND con.confrelid::regclass::text = ANY (tbl_names)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM generate_subscripts(targets, 1) s
             WHERE targets[s][1] = fk.tbl AND targets[s][2] = fk.col
        ) THEN
            targets := targets || ARRAY[ARRAY[fk.tbl, fk.col, '0']];
            RAISE NOTICE '0005: auto-added FK column %.% to the conversion set', fk.tbl, fk.col;
        END IF;
    END LOOP;

    -- 3a-ii. Drop every FK touching a table we are about to rewrite. Postgres
    --        will not let a referenced column change type while one holds it.
    FOR fk IN
        SELECT con.conname, con.conrelid::regclass::text AS tbl,
               pg_get_constraintdef(con.oid) AS def
          FROM pg_constraint con
         WHERE con.contype = 'f'
           AND (con.conrelid::regclass::text = ANY (tbl_names)
             OR con.confrelid::regclass::text = ANY (tbl_names))
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
        dropped := dropped || (fk.tbl || '|' || fk.conname || '|' || fk.def);
    END LOOP;

    -- 3b. Convert each column in place, mapping existing values deterministically.
    FOR idx IN 1 .. array_length(targets, 1) LOOP
        t := targets[idx][1];
        c := targets[idx][2];
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = t AND column_name = c AND data_type <> 'uuid'
        );

        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', t, c);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE UUID USING legacy_uuid(%I::text)', t, c, c);

        IF targets[idx][3] = '1' THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT uuidv7()', t, c);
        END IF;

        RAISE NOTICE '0005: %.% -> uuid', t, c;
    END LOOP;

    -- 3c. Put the foreign keys back exactly as they were.
    FOREACH t IN ARRAY dropped LOOP
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',
                       split_part(t, '|', 1), split_part(t, '|', 2), split_part(t, '|', 3));
    END LOOP;
END $$;


-- 4. PLAN REFERENCES ---------------------------------------------------------
-- `subscriptions.plan_id` still points at the readable plan code, which is
-- correct: plans are static config, not tenant data.

COMMENT ON COLUMN subscriptions.plan_id IS
    'References plans.id, which stays a readable code (plan-pro-monthly) by design. See THE RULE in 0005.';


-- 6. REBUILD BI VIEWS --------------------------------------------------------
-- Identical to 0004 §6; recreated here because the key conversion required
-- dropping them. Keep the two definitions in step.

CREATE OR REPLACE VIEW v_merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id, h.tenant_id, h.log_date,
       h.daily_revenue, h.daily_transaction_count, h.active_cashiers_count,
       h.days_since_last_txn, h.active_days_last_7, h.revenue_trend_pct,
       h.distinct_features_used, h.support_tickets_count,
       h.subscription_status, h.mrr_idr, h.contract_mrr_idr,
       h.churn_risk_score, h.churn_risk_reasons,
       CASE
           WHEN h.churn_risk_score >= 0.70 THEN 'CRITICAL'
           WHEN h.churn_risk_score >= 0.45 THEN 'AT_RISK'
           WHEN h.churn_risk_score >= 0.25 THEN 'WATCH'
           ELSE 'HEALTHY'
       END AS health_band
  FROM merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;

CREATE OR REPLACE VIEW v_platform_mrr AS
SELECT date_trunc('month', s.current_period_start)::date AS month,
       COUNT(*) FILTER (WHERE s.status = 'ACTIVE')   AS active_subscriptions,
       COUNT(*) FILTER (WHERE s.status = 'TRIAL')    AS trials,
       COUNT(*) FILTER (WHERE s.status = 'PAST_DUE') AS past_due,
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

GRANT SELECT ON v_merchant_health_latest, v_platform_mrr, v_feature_adoption_30d TO bi_readonly;


-- 5. APPLICATION CONTRACT ----------------------------------------------------
--
-- The client must stop minting ids from Date.now(). Replace every
-- `${prefix}-${Date.now()}` with crypto.randomUUID() (available in every browser
-- this POS targets, and in Node 19+). Until that ships, `legacy_uuid()` keeps
-- old rows addressable, but two offline terminals can still collide BEFORE the
-- data reaches Postgres — the collision happens in localStorage, where this
-- migration cannot reach.
--
-- Tracking: src/lib/ids.ts provides newId(); see scripts/dev/check-source-hygiene.mjs
-- which fails the build if a `-${Date.now()}` id pattern reappears.


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- There is no clean automatic rollback: legacy_uuid() is one-way (md5).
-- To revert, restore from the pre-migration backup. Take one first:
--   pg_dump "$DATABASE_URL" -Fc -f pre-0005.dump
-- DROP FUNCTION IF EXISTS legacy_uuid(TEXT);
