-- =============================================================================
-- 0036_secure_entitlements_and_ai_credit_ledger.sql
--
-- Memusatkan dua nilai berbayar yang sebelumnya hanya metadata/aplikasi:
-- batas katalog paket dan saldo AI Credit. Semua perubahan saldo dicatat
-- append-only agar saldo dapat direkonsiliasi terhadap ledger.
-- =============================================================================

-- 1. ENTITLEMENT PRODUK --------------------------------------------------------
ALTER TABLE billing.plans
  ADD COLUMN IF NOT EXISTS product_limit INTEGER NOT NULL DEFAULT -1
  CHECK (product_limit = -1 OR product_limit >= 0);

UPDATE billing.plans
   SET product_limit = CASE id
     WHEN 'plan-free'          THEN 30
     WHEN 'plan-plus-monthly'  THEN 100
     WHEN 'plan-pro-monthly'   THEN -1
     ELSE product_limit
   END;

DROP VIEW IF EXISTS contract.merchant_product_entitlement;
CREATE VIEW contract.merchant_product_entitlement AS
SELECT t.id AS tenant_id,
       COALESCE(p.product_limit, 30) AS product_limit,
       COALESCE(s.status, 'TRIAL') AS subscription_status
  FROM internal.tenants t
  LEFT JOIN LATERAL (
    SELECT * FROM billing.subscriptions
     WHERE tenant_id = t.id
     ORDER BY created_at DESC
     LIMIT 1
  ) s ON TRUE
  LEFT JOIN billing.plans p ON p.id = s.plan_id;

REVOKE ALL ON contract.merchant_product_entitlement FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON contract.merchant_product_entitlement FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
    GRANT SELECT ON contract.merchant_product_entitlement TO svc_pos;
  END IF;
END $$;

-- 2. IMMUTABLE LEDGER AI CREDIT ----------------------------------------------
CREATE TABLE IF NOT EXISTS ai.credit_ledger (
  id              UUID PRIMARY KEY DEFAULT uuidv7(),
  merchant_id     UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
  delta           INTEGER NOT NULL CHECK (delta <> 0),
  entry_type      VARCHAR(32) NOT NULL CHECK (entry_type IN
                    ('OPENING', 'MONTHLY_GRANT', 'MONTHLY_RESET', 'TOPUP',
                     'CONSUMPTION', 'REFUND', 'ADJUSTMENT')),
  reference       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_merchant_created
  ON ai.credit_ledger (merchant_id, created_at DESC);

-- Satu saldo pembuka untuk seluruh dompet yang sudah ada sebelum trigger.
INSERT INTO ai.credit_ledger (merchant_id, delta, entry_type, reference)
SELECT merchant_id, balance, 'OPENING', 'migration-0036'
  FROM ai.merchant_ai_credits
 WHERE balance <> 0
   AND NOT EXISTS (
     SELECT 1 FROM ai.credit_ledger l
      WHERE l.merchant_id = merchant_ai_credits.merchant_id
        AND l.reference = 'migration-0036'
   );

CREATE OR REPLACE FUNCTION ai.fn_record_credit_balance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ai
AS $$
DECLARE
  v_delta INTEGER;
  v_type VARCHAR(32);
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta := NEW.balance;
    v_type := 'MONTHLY_GRANT';
  ELSE
    v_delta := NEW.balance - OLD.balance;
    IF v_delta = 0 THEN RETURN NEW; END IF;
    v_type := COALESCE(
      NULLIF(current_setting('app.ai_credit_ledger_type', true), ''),
      CASE
        WHEN NEW.period_reset_at <> OLD.period_reset_at THEN 'MONTHLY_RESET'
        WHEN v_delta < 0 THEN 'CONSUMPTION'
        ELSE 'ADJUSTMENT'
      END
    );
  END IF;

  IF v_delta <> 0 THEN
    INSERT INTO ai.credit_ledger (merchant_id, delta, entry_type, reference)
    VALUES (
      NEW.merchant_id,
      v_delta,
      v_type,
      NULLIF(current_setting('app.ai_credit_ledger_reference', true), '')
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ai.fn_record_credit_balance_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_record_credit_balance_change ON ai.merchant_ai_credits;
CREATE TRIGGER trg_record_credit_balance_change
AFTER INSERT OR UPDATE OF balance, period_reset_at ON ai.merchant_ai_credits
FOR EACH ROW EXECUTE FUNCTION ai.fn_record_credit_balance_change();

CREATE OR REPLACE FUNCTION ai.fn_enforce_credit_ledger_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI credit ledger is append-only; use a compensating entry instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_credit_ledger_immutability ON ai.credit_ledger;
CREATE TRIGGER trg_enforce_credit_ledger_immutability
BEFORE UPDATE OR DELETE ON ai.credit_ledger
FOR EACH ROW EXECUTE FUNCTION ai.fn_enforce_credit_ledger_immutability();

-- Satu-satunya fungsi tambah kredit. Tipe TOPUP dan reference dicatat pada
-- ledger oleh trigger dalam transaksi yang sama dengan perubahan saldo.
CREATE OR REPLACE FUNCTION ai.add_ai_credit(
  p_merchant_id UUID,
  p_amount INTEGER,
  p_reference TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'credit amount must be positive'; END IF;
  PERFORM set_config('app.ai_credit_ledger_type', 'TOPUP', true);
  PERFORM set_config('app.ai_credit_ledger_reference', COALESCE(p_reference, ''), true);
  UPDATE ai.merchant_ai_credits
     SET balance = balance + p_amount, updated_at = CURRENT_TIMESTAMP
   WHERE merchant_id = p_merchant_id
   RETURNING balance INTO v_balance;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'AI wallet not found'; END IF;
  RETURN v_balance;
END;
$$;

-- Refund selalu diberi tipe khusus, bukan adjustment samar.
CREATE OR REPLACE FUNCTION refund_ai_credit(p_merchant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.ai_credit_ledger_type', 'REFUND', true);
  UPDATE ai.merchant_ai_credits
     SET balance = balance + 1,
         used_this_month = GREATEST(0, used_this_month - 1),
         updated_at = CURRENT_TIMESTAMP
   WHERE merchant_id = p_merchant_id;
END;
$$;

-- View rekonsiliasi: perbedaan selain nol menandakan korupsi historis.
CREATE OR REPLACE VIEW ai.credit_ledger_reconciliation AS
SELECT w.merchant_id,
       w.balance AS wallet_balance,
       COALESCE(SUM(l.delta), 0)::INTEGER AS ledger_balance,
       w.balance - COALESCE(SUM(l.delta), 0)::INTEGER AS difference
  FROM ai.merchant_ai_credits w
  LEFT JOIN ai.credit_ledger l ON l.merchant_id = w.merchant_id
 GROUP BY w.merchant_id, w.balance;

REVOKE ALL ON ai.credit_ledger, ai.credit_ledger_reconciliation FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ai.credit_ledger, ai.credit_ledger_reconciliation FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
    GRANT SELECT, INSERT ON ai.credit_ledger TO svc_ai;
    GRANT SELECT ON ai.credit_ledger_reconciliation TO svc_ai;
    GRANT EXECUTE ON FUNCTION ai.add_ai_credit(UUID, INTEGER, TEXT) TO svc_ai;
  END IF;
END $$;
