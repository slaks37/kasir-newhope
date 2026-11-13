-- Explicit physical drawer bindings. Existing rows/ledger entries are never remapped.
ALTER TABLE pos.cash_registers ADD COLUMN IF NOT EXISTS workspace_modules text[];
ALTER TABLE pos.shifts ADD COLUMN IF NOT EXISTS workspace_modules text[];
ALTER TABLE pos.shifts ADD COLUMN IF NOT EXISTS close_command jsonb;
ALTER TABLE pos.transactions ADD COLUMN IF NOT EXISTS register_id uuid REFERENCES pos.cash_registers(id);
ALTER TABLE pos.transactions ADD COLUMN IF NOT EXISTS register_shift_id uuid REFERENCES pos.shifts(id);
ALTER TABLE pos.cash_ledger ADD COLUMN IF NOT EXISTS register_id uuid REFERENCES pos.cash_registers(id);
ALTER TABLE pos.cash_ledger ADD COLUMN IF NOT EXISTS register_shift_id uuid REFERENCES pos.shifts(id);
CREATE INDEX IF NOT EXISTS register_shift_sales ON pos.transactions(tenant_id,merchant_id,outlet_id,register_shift_id,created_at) WHERE register_shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS register_shift_cash ON pos.cash_ledger(tenant_id,merchant_id,outlet_id,register_shift_id,created_at) WHERE register_shift_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_open_explicit_register_shift ON pos.shifts(register_id) WHERE status='OPEN' AND workspace_modules IS NOT NULL;
CREATE OR REPLACE FUNCTION pos.validate_explicit_register() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.workspace_modules IS NULL THEN
  IF TG_TABLE_NAME='shifts' THEN IF EXISTS(SELECT 1 FROM pos.cash_registers WHERE id=NEW.register_id AND workspace_modules IS NOT NULL) THEN RAISE EXCEPTION 'EXPLICIT_REGISTER_SHIFT_REQUIRED' USING ERRCODE='23514';END IF;END IF;
  RETURN NEW;END IF;
 IF TG_TABLE_NAME='shifts' THEN IF NEW.opened_by_user_id IS NULL THEN RAISE EXCEPTION 'SHIFT_OPERATOR_REQUIRED' USING ERRCODE='23514';END IF;END IF;
 IF cardinality(NEW.workspace_modules)<1 OR cardinality(NEW.workspace_modules)>5 OR cardinality(NEW.workspace_modules)<>(SELECT count(DISTINCT x) FROM unnest(NEW.workspace_modules) x) OR EXISTS(SELECT 1 FROM unnest(NEW.workspace_modules) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM internal.module_definitions WHERE id=x)) OR NOT NEW.module_id=ANY(NEW.workspace_modules) THEN RAISE EXCEPTION 'INVALID_REGISTER_MODULES' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM internal.outlets WHERE id=NEW.outlet_id AND merchant_id=NEW.merchant_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'REGISTER_OUTLET_MISMATCH' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='cash_registers' THEN
 IF TG_OP='UPDATE' AND (NEW.workspace_modules,NEW.name,NEW.status) IS DISTINCT FROM (OLD.workspace_modules,OLD.name,OLD.status) AND EXISTS(SELECT 1 FROM pos.shifts WHERE register_id=OLD.id AND status='OPEN') THEN RAISE EXCEPTION 'REGISTER_HAS_OPEN_SHIFT' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='shifts' THEN
 IF NOT EXISTS(SELECT 1 FROM pos.cash_registers r WHERE r.id=NEW.register_id AND r.tenant_id=NEW.tenant_id AND r.merchant_id=NEW.merchant_id AND r.outlet_id=NEW.outlet_id AND r.workspace_modules=NEW.workspace_modules) THEN RAISE EXCEPTION 'SHIFT_REGISTER_MISMATCH' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text;pred text;BEGIN
 FOREACH tab IN ARRAY ARRAY['cash_registers','shifts'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS zz_explicit_register_scope ON pos.%I',tab);
  EXECUTE format('CREATE TRIGGER zz_explicit_register_scope BEFORE INSERT OR UPDATE ON pos.%I FOR EACH ROW EXECUTE FUNCTION pos.validate_explicit_register()',tab);
  pred:='module_id IS NULL OR (tenant_id::text=current_setting(''app.tenant_id'',true) AND merchant_id::text=current_setting(''app.merchant_id'',true) AND outlet_id::text=current_setting(''app.outlet_id'',true) AND (module_id=current_setting(''app.module_id'',true) OR current_setting(''app.module_id'',true)=ANY(workspace_modules)))';
  EXECUTE format('DROP POLICY IF EXISTS workspace_scope ON pos.%I',tab);
  EXECUTE format('CREATE POLICY workspace_scope ON pos.%I TO svc_pos USING(%s) WITH CHECK(%s)',tab,pred,pred);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION pos.immutable_closed_register_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.workspace_modules IS NOT NULL AND OLD.status='CLOSED' THEN RAISE EXCEPTION 'CLOSED_SHIFT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND OLD.workspace_modules IS NOT NULL AND (NEW.tenant_id,NEW.merchant_id,NEW.outlet_id,NEW.register_id,NEW.workspace_modules,NEW.opened_by_user_id,NEW.opened_at,NEW.client_shift_id,NEW.opening_cash) IS DISTINCT FROM (OLD.tenant_id,OLD.merchant_id,OLD.outlet_id,OLD.register_id,OLD.workspace_modules,OLD.opened_by_user_id,OLD.opened_at,OLD.client_shift_id,OLD.opening_cash) THEN RAISE EXCEPTION 'SHIFT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_closed_register_shift ON pos.shifts;
CREATE TRIGGER immutable_closed_register_shift BEFORE UPDATE OR DELETE ON pos.shifts FOR EACH ROW EXECUTE FUNCTION pos.immutable_closed_register_shift();
CREATE OR REPLACE FUNCTION pos.reject_shift_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN IF EXISTS(SELECT 1 FROM pos.shifts WHERE workspace_modules IS NOT NULL) THEN RAISE EXCEPTION 'SHIFT_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
DROP TRIGGER IF EXISTS immutable_register_history ON pos.shifts;
CREATE TRIGGER immutable_register_history BEFORE TRUNCATE ON pos.shifts FOR EACH STATEMENT EXECUTE FUNCTION pos.reject_shift_truncate();
-- All money remains in cash_ledger. Serialize writes and close on register -> shift.
CREATE OR REPLACE FUNCTION pos.bind_register_money() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE reg uuid:=NULLIF(current_setting('app.register_id',true),'')::uuid;sid uuid:=NULLIF(current_setting('app.register_shift_id',true),'')::uuid;parent record;r record;s record;mod text:=NULLIF(current_setting('app.module_id',true),'');n int;
BEGIN
 IF TG_TABLE_NAME='transactions' THEN
  IF TG_OP='UPDATE' THEN
   IF (NEW.register_id,NEW.register_shift_id) IS DISTINCT FROM(OLD.register_id,OLD.register_shift_id) THEN RAISE EXCEPTION 'TRANSACTION_REGISTER_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;
  END IF;
 ELSE
  IF NEW.transaction_id IS NOT NULL THEN SELECT register_id,register_shift_id INTO parent FROM pos.transactions WHERE id=NEW.transaction_id;IF reg IS NOT NULL AND parent.register_id IS NOT NULL AND reg<>parent.register_id THEN RAISE EXCEPTION 'REGISTER_SCOPE_MISMATCH' USING ERRCODE='23514';END IF;reg:=COALESCE(reg,parent.register_id);END IF;
  IF reg IS NULL AND NEW.event_type='REVERSAL' THEN SELECT register_id INTO reg FROM pos.cash_ledger WHERE id::text=NEW.reference_id AND tenant_id=NEW.tenant_id;END IF;
 END IF;
 reg:=COALESCE(NEW.register_id,reg);sid:=COALESCE(NEW.register_shift_id,sid);
 IF reg IS NULL AND mod IS NOT NULL AND TG_TABLE_NAME='cash_ledger' THEN
  SELECT count(*),(array_agg(id ORDER BY id))[1] INTO n,reg FROM pos.cash_registers WHERE tenant_id=NEW.tenant_id AND merchant_id=NEW.merchant_id AND outlet_id=NEW.outlet_id AND status='ACTIVE' AND mod=ANY(workspace_modules);
  IF n>1 THEN RAISE EXCEPTION 'EXPLICIT_REGISTER_REQUIRED' USING ERRCODE='23514';END IF;
 END IF;
 IF reg IS NULL THEN
  IF mod IS NOT NULL THEN RAISE EXCEPTION 'EXPLICIT_REGISTER_SHIFT_REQUIRED' USING ERRCODE='23514';END IF;
  RETURN NEW;END IF;
 SELECT * INTO r FROM pos.cash_registers WHERE id=reg FOR UPDATE;
 IF NOT FOUND OR mod IS NULL OR r.tenant_id<>NEW.tenant_id OR r.merchant_id<>NEW.merchant_id OR r.outlet_id<>NEW.outlet_id OR NOT mod=ANY(r.workspace_modules) THEN RAISE EXCEPTION 'REGISTER_SCOPE_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM pos.shifts WHERE register_id=reg AND (sid IS NULL AND status='OPEN' OR id=sid) FOR UPDATE;
 IF NOT FOUND OR s.status<>'OPEN' THEN RAISE EXCEPTION 'OPEN_REGISTER_SHIFT_REQUIRED' USING ERRCODE='23514';END IF;
 IF current_setting('app.actor_role',true)='CASHIER' AND s.opened_by_user_id::text IS DISTINCT FROM current_setting('app.actor_ref',true) THEN RAISE EXCEPTION 'SHIFT_OPERATOR_REQUIRED' USING ERRCODE='42501';END IF;
 NEW.register_id:=reg;NEW.register_shift_id:=s.id;
 IF TG_TABLE_NAME='transactions' THEN
  NEW.shift_id:=s.id;
  IF NEW.created_at<s.opened_at OR NEW.created_at>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'SALE_OUTSIDE_SHIFT' USING ERRCODE='23514';END IF;
  NEW.business_date:=(NEW.created_at AT TIME ZONE 'Asia/Jakarta')::date;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS register_transaction_binding ON pos.transactions;
CREATE TRIGGER register_transaction_binding BEFORE INSERT OR UPDATE ON pos.transactions FOR EACH ROW EXECUTE FUNCTION pos.bind_register_money();
DROP TRIGGER IF EXISTS register_cash_binding ON pos.cash_ledger;
CREATE TRIGGER register_cash_binding BEFORE INSERT ON pos.cash_ledger FOR EACH ROW EXECUTE FUNCTION pos.bind_register_money();
CREATE TABLE IF NOT EXISTS pos.shift_variance_events(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),outlet_id uuid NOT NULL REFERENCES internal.outlets(id),shift_id uuid NOT NULL REFERENCES pos.shifts(id),client_command_id text NOT NULL,action text NOT NULL CHECK(action IN('SUBMIT','APPROVE','REJECT')),submission_id uuid REFERENCES pos.shift_variance_events(id),actor_ref text NOT NULL,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,client_command_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_variance_review ON pos.shift_variance_events(submission_id) WHERE action IN('APPROVE','REJECT');
CREATE INDEX IF NOT EXISTS shift_variance_history ON pos.shift_variance_events(shift_id,created_at,id);
ALTER TABLE pos.shift_variance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos.shift_variance_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON pos.shift_variance_events TO svc_pos;
DROP POLICY IF EXISTS shift_variance_scope ON pos.shift_variance_events;
CREATE POLICY shift_variance_scope ON pos.shift_variance_events TO svc_pos USING(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND EXISTS(SELECT 1 FROM pos.shifts s WHERE s.id=shift_id AND s.workspace_modules IS NOT NULL)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND actor_ref=current_setting('app.actor_ref',true) AND EXISTS(SELECT 1 FROM pos.shifts s WHERE s.id=shift_id AND s.status='CLOSED' AND s.workspace_modules IS NOT NULL));
DROP TRIGGER IF EXISTS immutable_variance_event ON pos.shift_variance_events;
CREATE TRIGGER immutable_variance_event BEFORE UPDATE OR DELETE ON pos.shift_variance_events FOR EACH ROW EXECUTE FUNCTION pos.reject_financial_ledger_mutation();
DROP TRIGGER IF EXISTS immutable_variance_truncate ON pos.shift_variance_events;
CREATE TRIGGER immutable_variance_truncate BEFORE TRUNCATE ON pos.shift_variance_events FOR EACH STATEMENT EXECUTE FUNCTION pos.reject_financial_ledger_mutation();
REVOKE ALL ON FUNCTION pos.validate_explicit_register(),pos.immutable_closed_register_shift(),pos.reject_shift_truncate(),pos.bind_register_money() FROM PUBLIC,anon,authenticated;

-- Digital tender writes also serialize against physical close, even without a cash entry.
CREATE OR REPLACE FUNCTION pos.lock_register_payment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t record;s record;BEGIN
 SELECT register_id,register_shift_id INTO t FROM pos.transactions WHERE id=NEW.transaction_id;
 IF t.register_id IS NOT NULL THEN
  PERFORM 1 FROM pos.cash_registers WHERE id=t.register_id FOR UPDATE;
  SELECT status INTO s FROM pos.shifts WHERE id=t.register_shift_id FOR UPDATE;
  IF NOT FOUND OR s.status<>'OPEN' THEN RAISE EXCEPTION 'SHIFT_CLOSED_REQUIRES_REVIEW' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS register_payment_lock ON pos.payments;
CREATE TRIGGER register_payment_lock BEFORE INSERT ON pos.payments FOR EACH ROW EXECUTE FUNCTION pos.lock_register_payment();
REVOKE ALL ON FUNCTION pos.lock_register_payment() FROM PUBLIC,anon,authenticated;
-- Existing permissive legacy policies cannot widen access to explicitly bound cash.
DROP POLICY IF EXISTS registered_cash_scope ON pos.cash_ledger;
CREATE POLICY registered_cash_scope ON pos.cash_ledger AS RESTRICTIVE TO svc_pos USING(register_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true)) WITH CHECK(register_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true));
