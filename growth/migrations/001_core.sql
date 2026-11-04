-- Explicit, additive installation. Never run automatically in request handlers.
BEGIN;
CREATE SCHEMA IF NOT EXISTS growth;
REVOKE ALL ON SCHEMA growth FROM PUBLIC;
CREATE TABLE IF NOT EXISTS growth.workspaces(id uuid PRIMARY KEY,name text NOT NULL,synthetic boolean NOT NULL DEFAULT false);
INSERT INTO growth.workspaces VALUES('b1b56887-e47e-45ec-9e10-d58d378709ce','New Hope',false) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS growth.operator_grants(workspace_id uuid REFERENCES growth.workspaces,id uuid NOT NULL,can_manage boolean NOT NULL DEFAULT false,is_active boolean NOT NULL DEFAULT true,PRIMARY KEY(workspace_id,id));
ALTER TABLE growth.operator_grants ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS growth.settings(workspace_id uuid PRIMARY KEY REFERENCES growth.workspaces,weights jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS growth.partners(workspace_id uuid NOT NULL REFERENCES growth.workspaces,id uuid NOT NULL DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),kind text NOT NULL,code text NOT NULL CHECK(code~'^[A-Za-z0-9_-]{4,64}$'),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,code));
CREATE TABLE IF NOT EXISTS growth.leads(workspace_id uuid NOT NULL REFERENCES growth.workspaces,id uuid NOT NULL DEFAULT gen_random_uuid(),company text NOT NULL CHECK(length(company) BETWEEN 1 AND 200),contact_name text NOT NULL DEFAULT '',email text,phone text,sector text NOT NULL CHECK(sector IN ('FNB','LAUNDRY','RETAIL','SERVICES','OTHER')),city text NOT NULL DEFAULT '',outlets integer NOT NULL DEFAULT 1 CHECK(outlets BETWEEN 1 AND 10000),tools text NOT NULL DEFAULT '',challenges text NOT NULL DEFAULT '',source text NOT NULL DEFAULT 'manual',owner_id uuid,stage text NOT NULL DEFAULT 'LEAD' CHECK(stage IN ('LEAD','QUALIFIED','DEMO','SIGNUP','TRIAL','ACTIVATED','PQL','PAID','RETAINED','ADVOCATE','LOST')),version integer NOT NULL DEFAULT 1,consent_email boolean NOT NULL DEFAULT false,consent_whatsapp boolean NOT NULL DEFAULT false,consent_ai boolean NOT NULL DEFAULT false,consent_basis text NOT NULL DEFAULT '',consent_at timestamptz,opted_out_at timestamptz,next_followup timestamptz,partner_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,partner_id) REFERENCES growth.partners(workspace_id,id),FOREIGN KEY(workspace_id,owner_id) REFERENCES growth.operator_grants(workspace_id,id),CHECK(NOT(consent_email OR consent_whatsapp OR consent_ai) OR (length(consent_basis)>0 AND consent_at IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS growth_lead_email_unique ON growth.leads(workspace_id,lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS growth_lead_phone_unique ON growth.leads(workspace_id,phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS growth_lead_filter ON growth.leads(workspace_id,stage,sector,created_at DESC);
CREATE INDEX IF NOT EXISTS growth_lead_followup ON growth.leads(workspace_id,next_followup) WHERE next_followup IS NOT NULL;
CREATE TABLE IF NOT EXISTS growth.activities(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),lead_id uuid NOT NULL,actor_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('note','task','meeting','call','stage','consent','draft','identity_review')),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),due_at timestamptz,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,lead_id) REFERENCES growth.leads(workspace_id,id));
CREATE INDEX IF NOT EXISTS growth_activity_lead ON growth.activities(workspace_id,lead_id,created_at DESC);
CREATE TABLE IF NOT EXISTS growth.events(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),lead_id uuid,subject_ref uuid,signal text NOT NULL CHECK(signal IN ('signup','business_setup','outlet_setup','catalog_setup','test_transaction','synced_transaction','report_viewed','repeat_usage','demo_requested','referral','pricing_interest')),event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 200),verified boolean NOT NULL DEFAULT false,origin text NOT NULL CHECK(origin IN ('operator','server','import')),occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,event_key),FOREIGN KEY(workspace_id,lead_id) REFERENCES growth.leads(workspace_id,id),CHECK(occurred_at<=received_at+interval '5 minutes'));
CREATE INDEX IF NOT EXISTS growth_event_lead ON growth.events(workspace_id,lead_id,occurred_at);
CREATE TABLE IF NOT EXISTS growth.identity_reviews(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),lead_id uuid NOT NULL,requested_subject uuid NOT NULL,evidence text NOT NULL,requested_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REJECTED')),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,lead_id) REFERENCES growth.leads(workspace_id,id));
-- No automatic auth UUID linkage, account merges, or merchant grants.
CREATE TABLE IF NOT EXISTS growth.recommendations(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),lead_id uuid NOT NULL,actor_id uuid NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,lead_id) REFERENCES growth.leads(workspace_id,id));
CREATE TABLE IF NOT EXISTS growth.audit(workspace_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,action text NOT NULL,target_id uuid,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspaces','operator_grants','settings','partners','leads','activities','events','identity_reviews','recommendations','audit'] LOOP
  EXECUTE format('ALTER TABLE growth.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE growth.%I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='growth' AND tablename=t AND policyname='growth_workspace') THEN
   IF t='workspaces' THEN
    EXECUTE format('CREATE POLICY growth_workspace ON growth.%I USING(id::text=current_setting(''app.growth_workspace'',true)) WITH CHECK(id::text=current_setting(''app.growth_workspace'',true))',t);
   ELSE
    EXECUTE format('CREATE POLICY growth_workspace ON growth.%I USING(workspace_id::text=current_setting(''app.growth_workspace'',true)) WITH CHECK(workspace_id::text=current_setting(''app.growth_workspace'',true))',t);
   END IF;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA growth FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA growth REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
