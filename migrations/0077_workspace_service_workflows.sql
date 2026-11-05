-- Operational metadata only. Receipts continue to reference canonical POS transactions.
ALTER TABLE pos.operational_jobs ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.operational_jobs ADD COLUMN IF NOT EXISTS workspace_revision bigint NOT NULL DEFAULT 1 CHECK(workspace_revision>0);
ALTER TABLE pos.operational_jobs ADD COLUMN IF NOT EXISTS workspace_payload jsonb;
CREATE TABLE IF NOT EXISTS pos.workspace_job_receipts(
 tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
 outlet_id uuid NOT NULL REFERENCES internal.outlets(id),module_id text NOT NULL REFERENCES internal.module_definitions(id),
 job_id uuid NOT NULL REFERENCES pos.operational_jobs(id),transaction_id uuid PRIMARY KEY REFERENCES pos.transactions(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pos.workspace_job_events(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
 outlet_id uuid NOT NULL REFERENCES internal.outlets(id),module_id text NOT NULL REFERENCES internal.module_definitions(id),
 job_id uuid NOT NULL REFERENCES pos.operational_jobs(id),command_id text NOT NULL,actor_ref text NOT NULL,
 action text NOT NULL,previous_status text,status text NOT NULL,revision bigint NOT NULL,detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(job_id,revision)
);
-- Legacy heuristic chemical consumption is not used by explicit workspace jobs.
DROP TRIGGER IF EXISTS trg_operational_job_consumption ON pos.operational_jobs;
CREATE TRIGGER trg_operational_job_consumption BEFORE UPDATE OF status ON pos.operational_jobs FOR EACH ROW WHEN(NEW.module_id IS NULL) EXECUTE FUNCTION pos.fn_handle_operational_job_consumption();
DROP TRIGGER IF EXISTS trg_job_lifecycle_eval ON pos.operational_jobs;
CREATE TRIGGER trg_job_lifecycle_eval AFTER INSERT OR UPDATE OF status ON pos.operational_jobs FOR EACH ROW WHEN(NEW.module_id IS NULL) EXECUTE FUNCTION pos.fn_trg_job_lifecycle_eval();
CREATE OR REPLACE FUNCTION pos.validate_workspace_job() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.module_id IS NOT NULL AND (NEW.workspace_payload IS NULL OR NOT EXISTS(SELECT 1 FROM internal.outlets o WHERE o.id=NEW.outlet_id AND o.tenant_id=NEW.tenant_id AND o.merchant_id=NEW.merchant_id)) THEN RAISE EXCEPTION 'JOB_WORKSPACE_MISMATCH' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND OLD.module_id IS NOT NULL AND (NEW.tenant_id,NEW.merchant_id,NEW.outlet_id,NEW.module_id,NEW.job_number,NEW.workspace_payload) IS DISTINCT FROM(OLD.tenant_id,OLD.merchant_id,OLD.outlet_id,OLD.module_id,OLD.job_number,OLD.workspace_payload) THEN RAISE EXCEPTION 'JOB_INTAKE_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_job_guard ON pos.operational_jobs;
CREATE TRIGGER workspace_job_guard BEFORE INSERT OR UPDATE ON pos.operational_jobs FOR EACH ROW EXECUTE FUNCTION pos.validate_workspace_job();
CREATE OR REPLACE FUNCTION pos.validate_workspace_job_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pos.operational_jobs j JOIN pos.transactions t ON t.id=NEW.transaction_id WHERE j.id=NEW.job_id AND j.tenant_id=NEW.tenant_id AND j.merchant_id=NEW.merchant_id AND j.outlet_id=NEW.outlet_id AND j.module_id=NEW.module_id AND t.tenant_id=j.tenant_id AND t.merchant_id=j.merchant_id AND t.outlet_id=j.outlet_id AND t.module_id=j.module_id) THEN RAISE EXCEPTION 'JOB_RECEIPT_WORKSPACE_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_job_receipt_guard ON pos.workspace_job_receipts;
CREATE TRIGGER workspace_job_receipt_guard BEFORE INSERT ON pos.workspace_job_receipts FOR EACH ROW EXECUTE FUNCTION pos.validate_workspace_job_receipt();
DO $$ DECLARE tab text;pred text; BEGIN
 FOREACH tab IN ARRAY ARRAY['operational_jobs','workspace_job_receipts','workspace_job_events'] LOOP
  pred:='tenant_id::text=current_setting(''app.tenant_id'',true) AND merchant_id::text=current_setting(''app.merchant_id'',true) AND outlet_id::text=current_setting(''app.outlet_id'',true) AND module_id=current_setting(''app.module_id'',true)';
  IF tab='operational_jobs' THEN pred:='module_id IS NULL OR ('||pred||')';END IF;
  EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('DROP POLICY IF EXISTS workspace_job_scope ON pos.%I',tab);
  EXECUTE format('CREATE POLICY workspace_job_scope ON pos.%I TO svc_pos USING(%s) WITH CHECK(%s)',tab,pred,pred);
 END LOOP;
END $$;
REVOKE ALL ON pos.workspace_job_receipts,pos.workspace_job_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON pos.workspace_job_receipts,pos.workspace_job_events TO svc_pos;
DROP TRIGGER IF EXISTS immutable_job_receipts ON pos.workspace_job_receipts;
CREATE TRIGGER immutable_job_receipts BEFORE UPDATE OR DELETE ON pos.workspace_job_receipts FOR EACH ROW EXECUTE FUNCTION pos.immutable_recipe_consumption();
DROP TRIGGER IF EXISTS immutable_job_events ON pos.workspace_job_events;
CREATE TRIGGER immutable_job_events BEFORE UPDATE OR DELETE ON pos.workspace_job_events FOR EACH ROW EXECUTE FUNCTION pos.immutable_recipe_consumption();
REVOKE ALL ON FUNCTION pos.validate_workspace_job(),pos.validate_workspace_job_receipt() FROM PUBLIC,anon,authenticated;
ALTER TABLE pos.transaction_items ADD COLUMN IF NOT EXISTS workspace_options jsonb;
-- Scheduling sees a staff member's other outlets/modules without exposing their
-- records through an API. Serialize each staff calendar across workspace locks.
CREATE OR REPLACE FUNCTION pos.workspace_staff_conflict(p_staff uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NULLIF(current_setting('app.tenant_id',true),'') IS NULL OR NULLIF(current_setting('app.merchant_id',true),'') IS NULL THEN RAISE EXCEPTION 'WORKSPACE_CONTEXT_REQUIRED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('job-staff:'||p_staff::text,0));
 RETURN EXISTS(SELECT 1 FROM pos.operational_jobs j WHERE j.tenant_id::text=current_setting('app.tenant_id',true) AND j.assigned_staff_id=p_staff AND j.module_id IS NOT NULL AND j.status NOT IN('CANCELLED','CLOSED','COLLECTED','DELIVERED','COMPLETED') AND (p_exclude IS NULL OR j.id<>p_exclude) AND (p_start IS NULL OR p_end IS NULL OR j.workspace_payload->>'scheduledStart' IS NULL OR j.workspace_payload->>'scheduledEnd' IS NULL OR p_start<(j.workspace_payload->>'scheduledEnd')::timestamptz AND p_end>(j.workspace_payload->>'scheduledStart')::timestamptz));
END $$;
REVOKE ALL ON FUNCTION pos.workspace_staff_conflict(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pos.workspace_staff_conflict(uuid,timestamptz,timestamptz,uuid) TO svc_pos;
DROP TRIGGER IF EXISTS workspace_job_delete_guard ON pos.operational_jobs;
CREATE TRIGGER workspace_job_delete_guard BEFORE DELETE ON pos.operational_jobs FOR EACH ROW WHEN(OLD.module_id IS NOT NULL) EXECUTE FUNCTION pos.immutable_recipe_consumption();
CREATE OR REPLACE FUNCTION pos.validate_workspace_job_event() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pos.operational_jobs j WHERE j.id=NEW.job_id AND (j.tenant_id,j.merchant_id,j.outlet_id,j.module_id,j.workspace_revision,j.status)=(NEW.tenant_id,NEW.merchant_id,NEW.outlet_id,NEW.module_id,NEW.revision,NEW.status)) OR NEW.actor_ref IS DISTINCT FROM current_setting('app.actor_ref',true) OR NEW.action NOT IN('CREATE','ASSIGN','TRANSITION') THEN RAISE EXCEPTION 'JOB_EVENT_WORKSPACE_MISMATCH' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_job_event_guard ON pos.workspace_job_events;
CREATE TRIGGER workspace_job_event_guard BEFORE INSERT ON pos.workspace_job_events FOR EACH ROW EXECUTE FUNCTION pos.validate_workspace_job_event();
REVOKE ALL ON FUNCTION pos.validate_workspace_job_event() FROM PUBLIC,anon,authenticated;
