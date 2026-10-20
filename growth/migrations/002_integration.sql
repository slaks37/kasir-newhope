-- Growth target only. Explicit installation; never invoked by a request.
BEGIN;
ALTER TABLE growth.events ADD COLUMN IF NOT EXISTS tenant_ref uuid;
ALTER TABLE growth.events ADD COLUMN IF NOT EXISTS source_event_id uuid;
ALTER TABLE growth.events ADD COLUMN IF NOT EXISTS data_class text NOT NULL DEFAULT 'synthetic' CHECK(data_class IN('synthetic','first_party'));
ALTER TABLE growth.leads ADD COLUMN IF NOT EXISTS retention_until timestamptz NOT NULL DEFAULT now()+interval '180 days';
ALTER TABLE growth.leads ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
CREATE TABLE IF NOT EXISTS growth.receipts(workspace_id uuid NOT NULL,source_event_id uuid NOT NULL,payload_hash text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,source_event_id));
CREATE TABLE IF NOT EXISTS growth.link_invites(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),lead_id uuid NOT NULL,token_hash text NOT NULL UNIQUE,created_by uuid NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',claimed_at timestamptz,subject_ref uuid,tenant_ref uuid,consent_version text,approved_at timestamptz,approved_by uuid,revoked_at timestamptz,PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,lead_id) REFERENCES growth.leads(workspace_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS growth_link_subject ON growth.link_invites(workspace_id,subject_ref) WHERE approved_at IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS growth_link_lead ON growth.link_invites(workspace_id,lead_id) WHERE approved_at IS NOT NULL AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS growth.billing_facts(workspace_id uuid NOT NULL,tenant_ref uuid NOT NULL,subject_ref uuid NOT NULL,subscription_id uuid NOT NULL,status text NOT NULL,trial_started_at timestamptz,trial_ends_at timestamptz,period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,monthly_amount numeric(14,2) NOT NULL CHECK(monthly_amount>=0),paid_verified boolean NOT NULL DEFAULT false,data_class text NOT NULL CHECK(data_class IN('synthetic','first_party')),source_seq bigint NOT NULL,source_id uuid NOT NULL,observed_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,tenant_ref));
CREATE TABLE IF NOT EXISTS growth.billing_history(workspace_id uuid NOT NULL,source_event_id uuid NOT NULL,tenant_ref uuid NOT NULL,status text NOT NULL,paid_verified boolean NOT NULL,trial_started_at timestamptz,trial_ends_at timestamptz,period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,data_class text NOT NULL,observed_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,source_event_id));
ALTER TABLE growth.billing_history ADD COLUMN IF NOT EXISTS source_seq bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS growth_billing_history_tenant ON growth.billing_history(workspace_id,tenant_ref,observed_at);
CREATE TABLE IF NOT EXISTS growth.integration_state(workspace_id uuid PRIMARY KEY,source_id uuid NOT NULL,last_run_at timestamptz NOT NULL,backfill_at timestamptz,pending integer NOT NULL,dead integer NOT NULL,oldest_pending timestamptz);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['receipts','link_invites','billing_facts','billing_history','integration_state'] LOOP
 EXECUTE format('ALTER TABLE growth.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE growth.%I FORCE ROW LEVEL SECURITY',t);
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='growth' AND tablename=t AND policyname='growth_workspace') THEN
 EXECUTE format('CREATE POLICY growth_workspace ON growth.%I USING(workspace_id::text=current_setting(''app.growth_workspace'',true)) WITH CHECK(workspace_id::text=current_setting(''app.growth_workspace'',true))',t); END IF;
END LOOP; END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA growth FROM PUBLIC;
COMMIT;
