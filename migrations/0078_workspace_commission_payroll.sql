-- Reuse canonical staff commissions/payrolls. Workspace earnings and adjustments
-- are append-only; paying a slip never rewrites an earned commission.
ALTER TABLE pos.operational_jobs ADD COLUMN IF NOT EXISTS commission_rule jsonb;
ALTER TABLE pos.staff_commissions ADD COLUMN IF NOT EXISTS workspace_source text;
ALTER TABLE pos.staff_commissions ADD COLUMN IF NOT EXISTS original_commission_id uuid REFERENCES pos.staff_commissions(id);
ALTER TABLE pos.staff_payrolls ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES internal.outlets(id);
ALTER TABLE pos.staff_payrolls ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.staff_payrolls ADD COLUMN IF NOT EXISTS cash_event_id uuid REFERENCES pos.cash_ledger(id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_earned_commission ON pos.staff_commissions(job_id,transaction_id,staff_user_id) WHERE workspace_source='EARNING';
CREATE UNIQUE INDEX IF NOT EXISTS workspace_paid_period ON pos.staff_payrolls(tenant_id,merchant_id,outlet_id,module_id,staff_id,period_month) WHERE module_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pos.workspace_commission_rules(
 tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),outlet_id uuid NOT NULL REFERENCES internal.outlets(id),module_id text NOT NULL REFERENCES internal.module_definitions(id),staff_user_id uuid NOT NULL REFERENCES internal.users(id),
 revision bigint NOT NULL CHECK(revision>0),kind text NOT NULL CHECK(kind IN('PERCENTAGE','FIXED_PER_ORDER')),rate numeric(12,2) NOT NULL CHECK(rate>=0 AND rate<=999999999 AND (kind<>'PERCENTAGE' OR rate<=100)),actor_ref text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,merchant_id,outlet_id,module_id,staff_user_id,revision)
);
CREATE TABLE IF NOT EXISTS pos.workspace_payroll_entries(
 payroll_id uuid NOT NULL REFERENCES pos.staff_payrolls(id),commission_id uuid PRIMARY KEY REFERENCES pos.staff_commissions(id)
);
CREATE OR REPLACE FUNCTION pos.guard_workspace_labor() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_TABLE_NAME='operational_jobs' THEN
  IF OLD.module_id IS NOT NULL AND (NEW.commission_rule,NEW.assigned_staff_id) IS DISTINCT FROM (OLD.commission_rule,OLD.assigned_staff_id) AND OLD.status NOT IN('QUEUED','RECEIVED','SCHEDULED') THEN RAISE EXCEPTION 'STARTED_COMMISSION_RULE_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='staff_commissions' THEN IF OLD.workspace_source IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;END IF;END IF;
 IF TG_TABLE_NAME='staff_payrolls' THEN IF OLD.module_id IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;END IF;END IF;
 RAISE EXCEPTION 'WORKSPACE_LABOR_IMMUTABLE' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS workspace_job_commission_guard ON pos.operational_jobs;
CREATE TRIGGER workspace_job_commission_guard BEFORE UPDATE ON pos.operational_jobs FOR EACH ROW EXECUTE FUNCTION pos.guard_workspace_labor();
DROP TRIGGER IF EXISTS workspace_commission_immutable ON pos.staff_commissions;
CREATE TRIGGER workspace_commission_immutable BEFORE UPDATE OR DELETE ON pos.staff_commissions FOR EACH ROW EXECUTE FUNCTION pos.guard_workspace_labor();
DROP TRIGGER IF EXISTS workspace_payroll_immutable ON pos.staff_payrolls;
CREATE TRIGGER workspace_payroll_immutable BEFORE UPDATE OR DELETE ON pos.staff_payrolls FOR EACH ROW EXECUTE FUNCTION pos.guard_workspace_labor();
DROP TRIGGER IF EXISTS workspace_rule_immutable ON pos.workspace_commission_rules;
CREATE TRIGGER workspace_rule_immutable BEFORE UPDATE OR DELETE ON pos.workspace_commission_rules FOR EACH ROW EXECUTE FUNCTION pos.guard_workspace_labor();
DROP TRIGGER IF EXISTS workspace_payroll_entry_immutable ON pos.workspace_payroll_entries;
CREATE TRIGGER workspace_payroll_entry_immutable BEFORE UPDATE OR DELETE ON pos.workspace_payroll_entries FOR EACH ROW EXECUTE FUNCTION pos.guard_workspace_labor();
ALTER TABLE pos.workspace_commission_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_labor_scope ON pos.workspace_commission_rules;
CREATE POLICY workspace_labor_scope ON pos.workspace_commission_rules TO svc_pos USING(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true));
ALTER TABLE pos.staff_payrolls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_labor_scope ON pos.staff_payrolls;
CREATE POLICY workspace_labor_scope ON pos.staff_payrolls TO svc_pos USING(module_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true)) WITH CHECK(module_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true));
ALTER TABLE pos.workspace_payroll_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_labor_scope ON pos.workspace_payroll_entries;
CREATE POLICY workspace_labor_scope ON pos.workspace_payroll_entries TO svc_pos USING(EXISTS(SELECT 1 FROM pos.staff_payrolls p WHERE p.id=payroll_id AND p.module_id IS NOT NULL)) WITH CHECK(EXISTS(SELECT 1 FROM pos.staff_payrolls p JOIN pos.staff_commissions c ON c.id=commission_id WHERE p.id=payroll_id AND p.module_id IS NOT NULL AND c.workspace_source IS NOT NULL AND (p.tenant_id,p.merchant_id,p.outlet_id,p.module_id,p.staff_id)=(c.tenant_id,c.merchant_id,c.outlet_id,c.module_id,c.staff_user_id::text)));
REVOKE ALL ON pos.workspace_commission_rules,pos.workspace_payroll_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON pos.workspace_commission_rules,pos.workspace_payroll_entries TO svc_pos;
REVOKE ALL ON FUNCTION pos.guard_workspace_labor() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON pos.staff_payrolls FROM PUBLIC,anon,authenticated;
-- Catalog-only readiness marker: staff administration receives no POS schema,
-- receipt, financial or commission read privilege merely to enable invitations.
CREATE OR REPLACE FUNCTION internal.workspace_service_workflows_installed() RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION internal.workspace_service_workflows_installed() FROM PUBLIC,anon,authenticated;
