-- NEON STAGING/RESTORED SOURCE ONLY. Narrow actual-catalog gap remediation.
-- Never replay all historical migrations against imported customer data.
-- Existing tenant/outlet, transaction, paid subscription, wallet amounts,
-- period dates, usage counters, plans and shared-state values are unchanged.
-- Requires completed source snapshot reconciliation and migration owner.

CREATE TABLE IF NOT EXISTS ai.credit_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES internal.tenants(id) ON DELETE RESTRICT,
 delta integer NOT NULL,
 entry_type varchar(32) NOT NULL CHECK(entry_type IN
 ('MIGRATION_OPENING','MONTHLY_GRANT','MONTHLY_RESET','TOPUP','CONSUMPTION','REFUND','ADJUSTMENT')),
 reference text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(delta<>0 OR entry_type='MIGRATION_OPENING')
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_merchant_created ON ai.credit_ledger(merchant_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neon_source_wallet_opening ON ai.credit_ledger(merchant_id) WHERE entry_type='MIGRATION_OPENING';
-- Derived opening entries only. Do not grant a new allowance, reset a period,
-- rewrite balances or invent historical consumption. Existing ledger entries
-- block a second opening even when this file is reapplied after new AI activity.
INSERT INTO ai.credit_ledger(merchant_id,delta,entry_type,reference)
 SELECT w.merchant_id,w.balance,'MIGRATION_OPENING','NEON_RESTORED_SOURCE_BASELINE_0008'
 FROM ai.merchant_ai_credits w
 WHERE NOT EXISTS(SELECT 1 FROM ai.credit_ledger l WHERE l.merchant_id=w.merchant_id)
 ON CONFLICT(merchant_id) WHERE entry_type='MIGRATION_OPENING' DO NOTHING;

CREATE OR REPLACE FUNCTION ai.fn_record_credit_balance_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ai AS $$
DECLARE v_delta integer;v_type varchar(32);
BEGIN
 IF TG_OP='INSERT' THEN v_delta:=NEW.balance;v_type:='MONTHLY_GRANT';
 ELSE
  v_delta:=NEW.balance-OLD.balance;
  IF v_delta=0 THEN RETURN NEW;END IF;
  v_type:=coalesce(nullif(current_setting('app.ai_credit_ledger_type',true),''),
    CASE WHEN NEW.period_reset_at IS DISTINCT FROM OLD.period_reset_at THEN 'MONTHLY_RESET'
      WHEN v_delta<0 THEN 'CONSUMPTION' ELSE 'ADJUSTMENT' END);
 END IF;
 IF v_type NOT IN('MONTHLY_GRANT','MONTHLY_RESET','TOPUP','CONSUMPTION','REFUND','ADJUSTMENT') THEN
   RAISE EXCEPTION 'INVALID_WALLET_LEDGER_OPERATION';END IF;
 IF v_delta<>0 THEN INSERT INTO ai.credit_ledger(merchant_id,delta,entry_type,reference)
  VALUES(NEW.merchant_id,v_delta,v_type,nullif(current_setting('app.ai_credit_ledger_reference',true),''));END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ai.fn_record_credit_balance_change() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='ai.merchant_ai_credits'::regclass AND tgname='trg_record_credit_balance_change') THEN
  CREATE TRIGGER trg_record_credit_balance_change AFTER INSERT OR UPDATE OF balance,period_reset_at ON ai.merchant_ai_credits
  FOR EACH ROW EXECUTE FUNCTION ai.fn_record_credit_balance_change();END IF;
END $$;
CREATE OR REPLACE FUNCTION ai.fn_enforce_credit_ledger_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI_CREDIT_LEDGER_APPEND_ONLY';END $$;
REVOKE ALL ON FUNCTION ai.fn_enforce_credit_ledger_immutability() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='ai.credit_ledger'::regclass AND tgname='trg_enforce_credit_ledger_immutability') THEN
  CREATE TRIGGER trg_enforce_credit_ledger_immutability BEFORE UPDATE OR DELETE ON ai.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION ai.fn_enforce_credit_ledger_immutability();END IF;
END $$;
CREATE OR REPLACE FUNCTION ai.add_ai_credit(p_merchant_id uuid,p_amount integer,p_reference text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,ai AS $$
DECLARE v_balance integer;
BEGIN
 IF p_amount<=0 THEN RAISE EXCEPTION 'POSITIVE_CREDIT_AMOUNT_REQUIRED';END IF;
 PERFORM set_config('app.ai_credit_ledger_type','TOPUP',true);
 PERFORM set_config('app.ai_credit_ledger_reference',coalesce(p_reference,''),true);
 UPDATE ai.merchant_ai_credits SET balance=balance+p_amount,updated_at=now()
 WHERE merchant_id=p_merchant_id RETURNING balance INTO v_balance;
 IF v_balance IS NULL THEN RAISE EXCEPTION 'AI_WALLET_NOT_FOUND';END IF;
 RETURN v_balance;
END $$;
REVOKE ALL ON FUNCTION ai.add_ai_credit(uuid,integer,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE VIEW ai.credit_ledger_reconciliation WITH(security_invoker=true) AS
 SELECT w.merchant_id,w.balance wallet_balance,coalesce(sum(l.delta),0)::integer ledger_balance,
 w.balance-coalesce(sum(l.delta),0)::integer difference
 FROM ai.merchant_ai_credits w LEFT JOIN ai.credit_ledger l ON l.merchant_id=w.merchant_id
 GROUP BY w.merchant_id,w.balance;
ALTER TABLE ai.credit_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai.credit_ledger,ai.credit_ledger_reconciliation FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='newhope_runtime') THEN
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON ai.credit_ledger FROM newhope_runtime;
  GRANT SELECT ON ai.credit_ledger,ai.credit_ledger_reconciliation TO newhope_runtime;
  GRANT EXECUTE ON FUNCTION ai.add_ai_credit(uuid,integer,text) TO newhope_runtime;
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos.shared_state_versions (
 tenant_id uuid NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
 merchant_key uuid NOT NULL,scope text NOT NULL,kind text NOT NULL,
 version bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,merchant_key,scope,kind)
);
CREATE OR REPLACE FUNCTION pos.bump_shared_state_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP IN('UPDATE','DELETE') THEN
  INSERT INTO pos.shared_state_versions(tenant_id,merchant_key,scope,kind)
  VALUES(OLD.tenant_id,coalesce(OLD.merchant_id,'00000000-0000-0000-0000-000000000000'::uuid),OLD.scope,OLD.kind)
  ON CONFLICT(tenant_id,merchant_key,scope,kind) DO UPDATE
  SET version=pos.shared_state_versions.version+1,updated_at=now();END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND (NEW.tenant_id,NEW.merchant_id,NEW.scope,NEW.kind)
 IS DISTINCT FROM (OLD.tenant_id,OLD.merchant_id,OLD.scope,OLD.kind)) THEN
  INSERT INTO pos.shared_state_versions(tenant_id,merchant_key,scope,kind)
  VALUES(NEW.tenant_id,coalesce(NEW.merchant_id,'00000000-0000-0000-0000-000000000000'::uuid),NEW.scope,NEW.kind)
  ON CONFLICT(tenant_id,merchant_key,scope,kind) DO UPDATE
  SET version=pos.shared_state_versions.version+1,updated_at=now();END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION pos.bump_shared_state_version() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='pos.shared_state_records'::regclass AND tgname='shared_state_version_bump') THEN
  CREATE TRIGGER shared_state_version_bump AFTER INSERT OR UPDATE OR DELETE ON pos.shared_state_records
  FOR EACH ROW EXECUTE FUNCTION pos.bump_shared_state_version();END IF;
END $$;
INSERT INTO pos.shared_state_versions(tenant_id,merchant_key,scope,kind)
 SELECT DISTINCT tenant_id,coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid),scope,kind
 FROM pos.shared_state_records ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_shared_state_history ON pos.shared_state_records(tenant_id,kind,updated_at DESC);
ALTER TABLE pos.shared_state_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos.shared_state_versions FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS pos.staff_attendances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
 merchant_id uuid NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
 outlet_id uuid REFERENCES internal.outlets(id) ON DELETE SET NULL,client_attendance_id text NOT NULL,
 staff_id text NOT NULL,staff_name text NOT NULL,staff_role text NOT NULL,
 clock_in_at timestamptz NOT NULL,clock_out_at timestamptz,shift_notes text,
 status text NOT NULL DEFAULT 'CLOCKED_IN',branch_id text,branch_name text,
 clock_in_geo jsonb,clock_out_geo jsonb,business_sector text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT uq_staff_attendance_client UNIQUE(tenant_id,client_attendance_id)
);
CREATE TABLE IF NOT EXISTS pos.staff_payrolls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
 merchant_id uuid NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
 client_slip_id text NOT NULL,staff_id text NOT NULL,staff_name text NOT NULL,staff_role text NOT NULL,
 period_month text NOT NULL,period_start date NOT NULL,period_end date NOT NULL,days_attended integer NOT NULL DEFAULT 0,
 base_salary numeric(14,2) NOT NULL DEFAULT 0,allowance numeric(14,2) NOT NULL DEFAULT 0,
 individual_commission numeric(14,2) NOT NULL DEFAULT 0,team_pool_commission numeric(14,2) NOT NULL DEFAULT 0,
 daily_target_bonus numeric(14,2) NOT NULL DEFAULT 0,gross_earnings numeric(14,2) NOT NULL DEFAULT 0,
 deductions numeric(14,2) NOT NULL DEFAULT 0,net_salary numeric(14,2) NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'DRAFT',paid_at timestamptz,payment_method text,notes text,business_sector text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT uq_staff_payroll_client UNIQUE(tenant_id,client_slip_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_attendances_tenant ON pos.staff_attendances(tenant_id,clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_attendances_staff ON pos.staff_attendances(staff_id,clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_payrolls_tenant ON pos.staff_payrolls(tenant_id,period_month);
CREATE INDEX IF NOT EXISTS idx_staff_payrolls_staff ON pos.staff_payrolls(staff_id);
ALTER TABLE pos.staff_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.staff_payrolls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos.staff_attendances,pos.staff_payrolls FROM PUBLIC,anon,authenticated;
-- No historic subscription/product-limit rewrites, no optional receipt-outcome
-- reinterpretation. Reapply0005 inventory explicitly after this migration.
