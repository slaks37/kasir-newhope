-- Additive v2 workspaces. No assignment is upgraded and no legacy row is rekeyed.
ALTER TABLE internal.merchant_modules ADD COLUMN IF NOT EXISTS workspace_version smallint NOT NULL DEFAULT 1 CHECK(workspace_version IN(1,2));
ALTER TABLE pos.shared_state_records ADD COLUMN IF NOT EXISTS outlet_id uuid;
ALTER TABLE pos.shared_state_records ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.products ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.transactions ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.sync_receipts ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES internal.outlets(id);
ALTER TABLE pos.sync_receipts ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.sync_receipts ADD COLUMN IF NOT EXISTS actor_ref text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='pos.shared_state_records'::regclass AND conname='workspace_outlet_hierarchy') THEN
  ALTER TABLE pos.shared_state_records ADD CONSTRAINT workspace_outlet_hierarchy FOREIGN KEY(outlet_id,merchant_id,tenant_id) REFERENCES internal.outlets(id,merchant_id,tenant_id);
 END IF;
END $$;
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_state_scope;
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_state_business_namespace;
ALTER TABLE pos.shared_state_records ADD CONSTRAINT shared_state_business_namespace CHECK (
 (module_id IS NULL AND outlet_id IS NULL AND ((scope='GLOBAL' AND merchant_id IS NULL) OR (merchant_id IS NOT NULL AND (scope IN('FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP') OR scope='BUSINESS:'||merchant_id::text)))) OR
 (module_id IS NOT NULL AND outlet_id IS NOT NULL AND merchant_id IS NOT NULL AND scope='WORKSPACE:'||merchant_id::text||':'||outlet_id::text||':'||module_id)
);
ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_settings_sector_mode;
ALTER TABLE pos.shared_state_records ADD CONSTRAINT shared_settings_sector_mode CHECK(module_id IS NOT NULL OR kind<>'store_settings' OR deleted OR scope='GLOBAL' OR scope LIKE 'BUSINESS:%' OR value->>'storeMode' IS NULL OR value->>'storeMode'=CASE WHEN scope='FNB' THEN 'FNB' WHEN scope='RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END);
CREATE OR REPLACE FUNCTION pos.validate_shared_business_namespace() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE business record; expected_mode text; domain_sector text;
BEGIN
 IF NEW.module_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM internal.outlets o WHERE o.id=NEW.outlet_id AND o.merchant_id=NEW.merchant_id AND o.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'WORKSPACE_OUTLET_MISMATCH' USING ERRCODE='23514'; END IF;
  SELECT sector INTO domain_sector FROM internal.module_definitions WHERE id=NEW.module_id;
  IF domain_sector IS NULL OR NEW.scope<>'WORKSPACE:'||NEW.merchant_id::text||':'||NEW.outlet_id::text||':'||NEW.module_id THEN RAISE EXCEPTION 'WORKSPACE_NAMESPACE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NOT NEW.deleted AND (NEW.value->>'moduleId' IS DISTINCT FROM NEW.module_id OR COALESCE(NEW.value->>'outletId',NEW.value->>'branchId') IS DISTINCT FROM NEW.outlet_id::text OR NEW.value->>'businessSector' IS NOT NULL AND NEW.value->>'businessSector'<>domain_sector) THEN RAISE EXCEPTION 'WORKSPACE_PAYLOAD_MISMATCH' USING ERRCODE='23514'; END IF;
  expected_mode:=CASE domain_sector WHEN 'FNB' THEN 'FNB' WHEN 'RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END;
  IF NEW.kind='store_settings' AND NOT NEW.deleted AND NEW.value->>'storeMode' IS NOT NULL AND NEW.value->>'storeMode'<>expected_mode THEN RAISE EXCEPTION 'WORKSPACE_STORE_MODE_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.scope='GLOBAL' THEN RETURN NEW; END IF;
 SELECT m.business_sector,m.external_ref,t.owner_user_ref INTO business FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id WHERE m.id=NEW.merchant_id AND m.tenant_id=NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NAMESPACE_NOT_OWNED' USING ERRCODE='23514'; END IF;
 IF NEW.scope<>'BUSINESS:'||NEW.merchant_id::text AND (NEW.scope<>business.business_sector OR business.external_ref IS DISTINCT FROM business.owner_user_ref||'_'||business.business_sector) THEN RAISE EXCEPTION 'BUSINESS_NAMESPACE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NOT NEW.deleted AND (NEW.value->>'businessSector' IS NOT NULL AND NEW.value->>'businessSector'<>business.business_sector OR NEW.value->>'sector' IS NOT NULL AND NEW.value->>'sector'<>business.business_sector) THEN RAISE EXCEPTION 'BUSINESS_SECTOR_MISMATCH' USING ERRCODE='23514'; END IF;
 expected_mode:=CASE business.business_sector WHEN 'FNB' THEN 'FNB' WHEN 'RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END;
 IF NEW.kind='store_settings' AND NOT NEW.deleted AND NEW.value->>'storeMode' IS NOT NULL AND NEW.value->>'storeMode'<>expected_mode THEN RAISE EXCEPTION 'BUSINESS_STORE_MODE_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_shared_business_namespace ON pos.shared_state_records;
DROP TRIGGER IF EXISTS shared_business_namespace_guard ON pos.shared_state_records;
CREATE TRIGGER shared_business_namespace_guard BEFORE INSERT OR UPDATE ON pos.shared_state_records FOR EACH ROW EXECUTE FUNCTION pos.validate_shared_business_namespace();
DROP POLICY IF EXISTS shared_state_pos_tenant ON pos.shared_state_records;
CREATE POLICY shared_state_pos_tenant ON pos.shared_state_records TO svc_pos USING(
 tenant_id::text=current_setting('app.tenant_id',true) AND (merchant_id IS NULL OR merchant_id::text=current_setting('app.merchant_id',true)) AND
 (module_id IS NULL OR module_id=current_setting('app.module_id',true) AND outlet_id::text=current_setting('app.outlet_id',true))
) WITH CHECK(
 tenant_id::text=current_setting('app.tenant_id',true) AND (merchant_id IS NULL OR merchant_id::text=current_setting('app.merchant_id',true)) AND
 (module_id IS NULL OR module_id=current_setting('app.module_id',true) AND outlet_id::text=current_setting('app.outlet_id',true))
);
CREATE INDEX IF NOT EXISTS shared_workspace_records ON pos.shared_state_records(tenant_id,merchant_id,outlet_id,module_id,kind,record_id) WHERE module_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS module_transaction_period ON pos.transactions(tenant_id,merchant_id,outlet_id,module_id,created_at) WHERE module_id IS NOT NULL;
-- Child financial attribution follows the original canonical transaction.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['payments','transaction_items','transaction_refunds','cash_ledger','inventory_transactions','inventory_balances','inventory_items','staff_commissions'] LOOP
  EXECUTE format('ALTER TABLE pos.%I ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id)',tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION pos.workspace_financial_attribution() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE parent record; linked uuid; BEGIN
 IF TG_TABLE_NAME='transactions' THEN
  IF TG_OP='UPDATE' AND NEW.module_id IS DISTINCT FROM OLD.module_id THEN RAISE EXCEPTION 'FINANCIAL_MODULE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF NEW.module_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM internal.outlets o WHERE o.id=NEW.outlet_id AND o.merchant_id=NEW.merchant_id AND o.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'FINANCIAL_WORKSPACE_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 linked:=NEW.transaction_id;
 IF linked IS NULL THEN RETURN NEW; END IF;
 SELECT tenant_id,merchant_id,outlet_id,module_id INTO parent FROM pos.transactions WHERE id=linked;
 IF parent.module_id IS NOT NULL THEN
  IF NEW.tenant_id<>parent.tenant_id OR NEW.merchant_id<>parent.merchant_id OR NEW.outlet_id IS DISTINCT FROM parent.outlet_id THEN RAISE EXCEPTION 'FINANCIAL_WORKSPACE_MISMATCH' USING ERRCODE='23514'; END IF;
  IF NEW.module_id IS NOT NULL AND NEW.module_id<>parent.module_id THEN RAISE EXCEPTION 'FINANCIAL_MODULE_MISMATCH' USING ERRCODE='23514'; END IF;
  NEW.module_id:=parent.module_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pos.workspace_financial_attribution() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS workspace_transaction_attribution ON pos.transactions;
CREATE TRIGGER workspace_transaction_attribution BEFORE INSERT OR UPDATE ON pos.transactions FOR EACH ROW EXECUTE FUNCTION pos.workspace_financial_attribution();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['payments','transaction_refunds','cash_ledger','staff_commissions'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS workspace_financial_attribution ON pos.%I',tab);
  EXECUTE format('CREATE TRIGGER workspace_financial_attribution BEFORE INSERT ON pos.%I FOR EACH ROW EXECUTE FUNCTION pos.workspace_financial_attribution()',tab);
 END LOOP;
END $$;
-- Append attribution to the existing canonical reporting contract; never recreate a ledger.
DO $$ DECLARE source text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='contract.merchant_revenue'::regclass AND attname='module_id' AND NOT attisdropped) THEN
  SELECT pg_get_viewdef('contract.merchant_revenue'::regclass,true) INTO source;
  source:=regexp_replace(source,';\s*$','');
  EXECUTE 'CREATE OR REPLACE VIEW contract.merchant_revenue AS SELECT r.*,t.module_id FROM ('||source||') r JOIN pos.transactions t ON t.id=r.id AND t.tenant_id=r.tenant_id AND t.merchant_id=r.merchant_id';
 END IF;
END $$;
-- Legacy rows retain their existing behavior; scoped rows require the full context.
ALTER TABLE pos.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_transactions ON pos.transactions;
CREATE POLICY workspace_transactions ON pos.transactions TO svc_pos USING(module_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true)) WITH CHECK(module_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true));
ALTER TABLE pos.sync_receipts ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE pos.transactions ADD COLUMN IF NOT EXISTS module_command_hash text;
ALTER TABLE pos.financial_approval_grants ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.financial_authorization_audit ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
-- A child cannot silently shed or change its canonical module attribution.
CREATE OR REPLACE FUNCTION pos.workspace_item_attribution() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parent record; product record;
BEGIN
 SELECT tenant_id,module_id INTO parent FROM pos.transactions WHERE id=NEW.transaction_id;
 IF parent.module_id IS NOT NULL THEN
  SELECT tenant_id,module_id INTO product FROM pos.products WHERE id=NEW.product_id;
  IF NEW.tenant_id<>parent.tenant_id OR product.tenant_id<>parent.tenant_id OR product.module_id IS DISTINCT FROM parent.module_id OR NEW.module_id IS NOT NULL AND NEW.module_id<>parent.module_id THEN RAISE EXCEPTION 'LINE_WORKSPACE_MISMATCH' USING ERRCODE='23514'; END IF;
  NEW.module_id:=parent.module_id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_item_attribution ON pos.transaction_items;
CREATE TRIGGER workspace_item_attribution BEFORE INSERT ON pos.transaction_items FOR EACH ROW EXECUTE FUNCTION pos.workspace_item_attribution();
CREATE OR REPLACE FUNCTION pos.workspace_stock_attribution() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item record;
BEGIN
 SELECT tenant_id,merchant_id,module_id INTO item FROM pos.inventory_items WHERE id=NEW.inventory_item_id;
 IF item.module_id IS NOT NULL THEN
  IF NEW.tenant_id<>item.tenant_id OR NEW.merchant_id<>item.merchant_id OR NEW.module_id IS NOT NULL AND NEW.module_id<>item.module_id OR NOT EXISTS(SELECT 1 FROM internal.outlets WHERE id=NEW.outlet_id AND tenant_id=item.tenant_id AND merchant_id=item.merchant_id) OR NOT EXISTS(SELECT 1 FROM pos.inventory_locations WHERE id=NEW.location_id AND tenant_id=item.tenant_id AND merchant_id=item.merchant_id AND outlet_id=NEW.outlet_id) THEN RAISE EXCEPTION 'STOCK_WORKSPACE_MISMATCH' USING ERRCODE='23514'; END IF;
  NEW.module_id:=item.module_id;
  IF TG_TABLE_NAME='inventory_transactions' THEN NEW.actor_ref:=COALESCE(NEW.actor_ref,NULLIF(current_setting('app.actor_ref',true),''));END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['inventory_transactions','inventory_balances'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS workspace_stock_attribution ON pos.%I',tab);
  EXECUTE format('CREATE TRIGGER workspace_stock_attribution BEFORE INSERT OR UPDATE ON pos.%I FOR EACH ROW EXECUTE FUNCTION pos.workspace_stock_attribution()',tab);
 END LOOP;
END $$;
-- Product and stock masters are merchant/module catalogs; balances are outlet scoped.
DO $$ DECLARE tab text; pred text; BEGIN
 FOREACH tab IN ARRAY ARRAY['products','inventory_items','inventory_balances','inventory_transactions','payments','transaction_refunds','cash_ledger','staff_commissions'] LOOP
  pred:='module_id IS NULL OR (tenant_id::text=current_setting(''app.tenant_id'',true) AND merchant_id::text=current_setting(''app.merchant_id'',true) AND module_id=current_setting(''app.module_id'',true)';
  IF tab NOT IN ('products','inventory_items') THEN pred:=pred||' AND outlet_id::text=current_setting(''app.outlet_id'',true)'; END IF;
  pred:=pred||')';
  EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('DROP POLICY IF EXISTS workspace_scope ON pos.%I',tab);
  EXECUTE format('CREATE POLICY workspace_scope ON pos.%I TO svc_pos USING(%s) WITH CHECK(%s)',tab,pred,pred);
 END LOOP;
END $$;
-- Receipts are metadata only: all money/stock continues to use the existing ledgers.
CREATE TABLE IF NOT EXISTS pos.workspace_commands(
 tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
 command_id text NOT NULL CHECK(length(command_id) BETWEEN 1 AND 128),actor_ref text NOT NULL,request_hash text NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,command_id)
);
ALTER TABLE pos.workspace_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos.workspace_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON pos.workspace_commands TO svc_pos;
DROP POLICY IF EXISTS workspace_commands_scope ON pos.workspace_commands;
CREATE POLICY workspace_commands_scope ON pos.workspace_commands TO svc_pos USING(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true));
REVOKE ALL ON FUNCTION pos.workspace_item_attribution(),pos.workspace_stock_attribution() FROM PUBLIC,anon,authenticated;
ALTER TABLE pos.shifts ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.cash_registers ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
CREATE OR REPLACE FUNCTION pos.workspace_context_attribution() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE context_module text:=NULLIF(current_setting('app.module_id',true),'');
BEGIN
 IF context_module IS NOT NULL THEN
  IF NEW.tenant_id::text IS DISTINCT FROM current_setting('app.tenant_id',true) OR NEW.merchant_id::text IS DISTINCT FROM current_setting('app.merchant_id',true) OR NEW.outlet_id::text IS DISTINCT FROM current_setting('app.outlet_id',true) OR NEW.module_id IS NOT NULL AND NEW.module_id<>context_module THEN RAISE EXCEPTION 'WORKSPACE_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
  NEW.module_id:=context_module;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; pred text; BEGIN
 FOREACH tab IN ARRAY ARRAY['shifts','cash_registers','cash_ledger'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS workspace_scoped_context ON pos.%I',tab);
  EXECUTE format('CREATE TRIGGER workspace_scoped_context BEFORE INSERT ON pos.%I FOR EACH ROW EXECUTE FUNCTION pos.workspace_context_attribution()',tab);
  IF tab<>'cash_ledger' THEN
   pred:='module_id IS NULL OR (tenant_id::text=current_setting(''app.tenant_id'',true) AND merchant_id::text=current_setting(''app.merchant_id'',true) AND outlet_id::text=current_setting(''app.outlet_id'',true) AND module_id=current_setting(''app.module_id'',true))';
   EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY',tab);
   EXECUTE format('DROP POLICY IF EXISTS workspace_scope ON pos.%I',tab);
   EXECUTE format('CREATE POLICY workspace_scope ON pos.%I TO svc_pos USING(%s) WITH CHECK(%s)',tab,pred,pred);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION pos.workspace_context_attribution() FROM PUBLIC,anon,authenticated;
ALTER TABLE pos.products ADD COLUMN IF NOT EXISTS workspace_revision bigint NOT NULL DEFAULT 1 CHECK(workspace_revision>0);
ALTER TABLE pos.transaction_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_items_scope ON pos.transaction_items;
CREATE POLICY workspace_items_scope ON pos.transaction_items TO svc_pos USING(module_id IS NULL OR EXISTS(SELECT 1 FROM pos.transactions t WHERE t.id=transaction_id AND t.tenant_id=transaction_items.tenant_id AND t.module_id=transaction_items.module_id)) WITH CHECK(module_id IS NULL OR EXISTS(SELECT 1 FROM pos.transactions t WHERE t.id=transaction_id AND t.tenant_id=transaction_items.tenant_id AND t.module_id=transaction_items.module_id));
CREATE OR REPLACE FUNCTION pos.workspace_module_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NEW.module_id IS DISTINCT FROM OLD.module_id THEN RAISE EXCEPTION 'MODULE_ATTRIBUTION_IMMUTABLE' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['products','inventory_items','inventory_transactions','payments','transaction_items','transaction_refunds','cash_ledger','staff_commissions','shifts','cash_registers'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS workspace_module_immutable ON pos.%I',tab);
  EXECUTE format('CREATE TRIGGER workspace_module_immutable BEFORE UPDATE ON pos.%I FOR EACH ROW EXECUTE FUNCTION pos.workspace_module_immutable()',tab);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION pos.workspace_module_immutable() FROM PUBLIC,anon,authenticated;

ALTER TABLE pos.products ADD COLUMN IF NOT EXISTS workspace_payload jsonb;

GRANT SELECT(logo_url) ON internal.merchants TO svc_pos;
ALTER TABLE pos.inventory_transactions ADD COLUMN IF NOT EXISTS actor_ref text;
-- Read-only staff bootstrap contract; no raw billing-table or invoice grant.
CREATE OR REPLACE VIEW contract.workspace_subscription_metadata WITH(security_barrier=true) AS
 SELECT s.id,s.tenant_id,s.plan_id,s.status,s.current_period_start,s.current_period_end,s.grace_period_end,
 s.billing_cycle,s.extra_outlets,s.trial_started_at,s.trial_ends_at,s.has_used_trial,to_jsonb(s)->'free_selection' AS free_selection
 FROM billing.subscriptions s WHERE s.tenant_id::text=current_setting('app.tenant_id',true);
REVOKE ALL ON contract.workspace_subscription_metadata FROM PUBLIC,anon,authenticated;
GRANT SELECT ON contract.workspace_subscription_metadata TO svc_pos;
-- POS may append a validated merchant event, never read or rewrite the audit table.
CREATE OR REPLACE FUNCTION internal.append_merchant_activity(p_merchant uuid,p_tenant uuid,p_domain text,p_event text,p_severity text,p_actor uuid,p_actor_name text,p_actor_role text,p_amount numeric,p_summary text,p_detail jsonb,p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;ctx_module text:=NULLIF(current_setting('app.module_id',true),'');ctx_actor text:=NULLIF(current_setting('app.actor_ref',true),'');
BEGIN
 IF p_tenant::text IS DISTINCT FROM current_setting('app.tenant_id',true) OR p_merchant::text IS DISTINCT FROM current_setting('app.merchant_id',true) OR NOT EXISTS(SELECT 1 FROM internal.merchants WHERE id=p_merchant AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'ACTIVITY_SCOPE_MISMATCH' USING ERRCODE='42501';END IF;
 IF ctx_module IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM internal.outlets WHERE id::text=current_setting('app.outlet_id',true) AND merchant_id=p_merchant AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'ACTIVITY_OUTLET_MISMATCH' USING ERRCODE='42501';END IF;
  SELECT id,full_name INTO p_actor,p_actor_name FROM internal.users WHERE id::text=ctx_actor AND is_active;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'ACTIVITY_ACTOR_REQUIRED' USING ERRCODE='42501';END IF;
  p_actor_role:=current_setting('app.actor_role',true);
  p_detail:=COALESCE(p_detail,'{}'::jsonb)||jsonb_build_object('moduleId',ctx_module,'outletId',current_setting('app.outlet_id',true),'actorRef',ctx_actor);
 END IF;
 INSERT INTO internal.audit_logs(merchant_id,tenant_id,domain,event_type,severity,actor_id,actor_name,actor_role,amount_idr,summary,detail,occurred_at)
 VALUES(p_merchant,p_tenant,p_domain,p_event,p_severity,p_actor,p_actor_name,p_actor_role,p_amount,p_summary,p_detail,COALESCE(p_at,now())) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION internal.append_merchant_activity(uuid,uuid,text,text,text,uuid,text,text,numeric,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION internal.append_merchant_activity(uuid,uuid,text,text,text,uuid,text,text,numeric,text,jsonb,timestamptz) TO svc_pos;
-- PostgreSQL17's existing UUIDv7 compatibility function needs only nextval.
-- Qualify its sequence so SECURITY DEFINER callers can keep an empty search_path.
-- Existing UUIDs and sequence state are never rewritten/reset; PostgreSQL18 native UUIDv7 is untouched.
DO $$ DECLARE definition text;service text; BEGIN
 IF to_regclass('public.uuidv7_counter') IS NOT NULL AND to_regprocedure('public.uuidv7()') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.uuidv7()'::regprocedure) INTO definition;
  definition:=replace(definition,'nextval(''uuidv7_counter'')','nextval(''public.uuidv7_counter'')');
  EXECUTE definition;
  ALTER FUNCTION public.uuidv7() SET search_path=pg_catalog;
  FOREACH service IN ARRAY ARRAY['svc_pos','svc_billing','svc_internal','svc_ai'] LOOP
   EXECUTE format('GRANT USAGE ON SEQUENCE public.uuidv7_counter TO %I',service);
  END LOOP;
 END IF;
END $$;
