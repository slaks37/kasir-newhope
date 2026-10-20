-- Business-source installation, separate from CRM migrations. Owner-reviewed staging only.
-- Transactional capture: no network/CRM calls, no exception swallowing. A failed local
-- insert aborts the business commit; do not claim zero write overhead or silent durability.
BEGIN;
CREATE SCHEMA IF NOT EXISTS growth_source;
REVOKE ALL ON SCHEMA growth_source FROM PUBLIC;
CREATE TABLE IF NOT EXISTS growth_source.config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),source_id uuid NOT NULL DEFAULT gen_random_uuid(),data_class text NOT NULL DEFAULT 'synthetic' CHECK(data_class IN('synthetic','first_party')),enabled boolean NOT NULL DEFAULT false,backfill_at timestamptz);
INSERT INTO growth_source.config(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS growth_source.outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigserial UNIQUE,source_id uuid NOT NULL,tenant_ref uuid,subject_ref uuid NOT NULL,kind text NOT NULL CHECK(kind IN('signal','subscription','ownership')),payload jsonb NOT NULL,data_class text NOT NULL CHECK(data_class IN('synthetic','first_party')),occurred_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz,delivered_at timestamptz,dead_at timestamptz,last_error text);
ALTER TABLE growth_source.outbox ALTER COLUMN tenant_ref DROP NOT NULL;
ALTER TABLE growth_source.outbox DROP CONSTRAINT IF EXISTS outbox_tenant_scope;
ALTER TABLE growth_source.outbox ADD CONSTRAINT outbox_tenant_scope CHECK(tenant_ref IS NOT NULL OR COALESCE(kind='signal' AND payload->>'signal'='signup',false));
ALTER TABLE growth_source.outbox DROP CONSTRAINT IF EXISTS outbox_kind_check;
ALTER TABLE growth_source.outbox ADD CONSTRAINT outbox_kind_check CHECK(kind IN('signal','subscription','ownership'));
CREATE TABLE IF NOT EXISTS growth_source.milestones(tenant_ref uuid NOT NULL,signal text NOT NULL,resource_id text NOT NULL,PRIMARY KEY(tenant_ref,signal,resource_id));
CREATE INDEX IF NOT EXISTS growth_source_pending ON growth_source.outbox(available_at,seq) WHERE delivered_at IS NULL AND dead_at IS NULL;
-- Billing proof is restricted to matched APPLIED/VERIFIED provider events and invoice
-- quote/current subscription period. CRM PAID, cash POS sales and manual invoices do not qualify.
CREATE OR REPLACE FUNCTION growth_source.subscription_payload(tid uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('subscriptionId',s.id,'status',s.status,'trialStart',s.trial_started_at,'trialEnd',s.trial_ends_at,'periodStart',s.current_period_start,'periodEnd',s.current_period_end,'monthlyAmount',CASE WHEN s.billing_cycle='YEARLY' THEN s.recurring_amount/12 ELSE s.recurring_amount END,'paidVerified',EXISTS(
 SELECT 1 FROM billing.invoices i JOIN billing.payment_events e ON e.invoice_number=i.invoice_number AND e.gateway_reference=i.payment_gateway_ref AND e.amount=i.amount AND e.currency=i.currency
 WHERE i.subscription_id=s.id AND i.tenant_id=s.tenant_id AND i.payment_status='PAID' AND i.reconciliation_status='APPLIED' AND i.paid_at IS NOT NULL AND i.currency='IDR' AND i.amount>0 AND e.outcome='APPLIED' AND e.reason='VERIFIED'
 AND i.quote->>'periodStart' IS NOT NULL AND (i.quote->>'periodStart')::timestamptz=s.current_period_start AND (i.quote->>'periodEnd')::timestamptz=s.current_period_end AND (i.quote->>'recurringAmount')::numeric=s.recurring_amount AND i.quote->>'planId'=s.plan_id::text AND i.quote->>'billingCycle'=s.billing_cycle))
 FROM billing.subscriptions s WHERE s.tenant_id=tid
$$;
CREATE OR REPLACE FUNCTION growth_source.capture_document(relation_name text,j jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE tid uuid; sub text; sig text; body jsonb; cfg growth_source.config%ROWTYPE;
BEGIN
 SELECT * INTO cfg FROM growth_source.config WHERE singleton;
 IF NOT cfg.enabled THEN RETURN; END IF;
 IF relation_name='tenants' THEN tid:=(j->>'id')::uuid; ELSE tid:=(j->>'tenant_id')::uuid; END IF;
 SELECT owner_user_ref INTO sub FROM internal.tenants WHERE id=tid AND is_active AND merged_into IS NULL;
 IF sub IS NULL OR sub !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN; END IF;
 CASE relation_name
 WHEN 'tenants' THEN sig:='business_setup';
 WHEN 'merchants' THEN sig:='business_setup';
 WHEN 'outlets' THEN IF NOT coalesce((j->>'is_active')::boolean,true) THEN RETURN; END IF; sig:='outlet_setup';
 WHEN 'products' THEN IF coalesce((j->>'sync_quarantined')::boolean,false) THEN RETURN; END IF; sig:='catalog_setup';
 WHEN 'transactions' THEN IF NOT EXISTS(SELECT 1 FROM contract.merchant_revenue r JOIN pos.transactions tx ON tx.id=r.id WHERE r.id=(j->>'id')::uuid AND r.tenant_id=tid AND r.total_amount>0 AND tx.client_txn_id IS NOT NULL) THEN RETURN; END IF; sig:='synced_transaction';
 WHEN 'payments' THEN IF NOT EXISTS(SELECT 1 FROM contract.merchant_revenue r JOIN pos.transactions tx ON tx.id=r.id WHERE r.id=(j->>'transaction_id')::uuid AND r.tenant_id=tid AND r.total_amount>0 AND tx.client_txn_id IS NOT NULL) THEN RETURN; END IF; j:=j||jsonb_build_object('id',j->>'transaction_id');sig:='synced_transaction';
 WHEN 'subscriptions' THEN body:=growth_source.subscription_payload(tid);
 WHEN 'invoices' THEN body:=growth_source.subscription_payload(tid);
 ELSE RETURN;
 END CASE;
 IF sig IS NOT NULL THEN
 INSERT INTO growth_source.milestones VALUES(tid,sig,j->>'id') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 body:=jsonb_build_object('signal',sig,'resource',j->>'id'); END IF;
 IF body IS NOT NULL THEN INSERT INTO growth_source.outbox(source_id,tenant_ref,subject_ref,kind,payload,data_class) VALUES(cfg.source_id,tid,sub::uuid,CASE WHEN sig IS NULL THEN 'subscription' ELSE 'signal' END,body,cfg.data_class); END IF;
 RETURN;
END $$;
CREATE OR REPLACE FUNCTION growth_source.capture_row() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE cfg growth_source.config%ROWTYPE; oldj jsonb; newj jsonb; subject_value text;
BEGIN
 IF TG_TABLE_NAME='tenants' AND TG_OP='UPDATE' THEN
 oldj:=to_jsonb(OLD);newj:=to_jsonb(NEW);
 IF oldj->>'owner_user_ref' IS DISTINCT FROM newj->>'owner_user_ref' OR oldj->>'is_active' IS DISTINCT FROM newj->>'is_active' OR oldj->>'merged_into' IS DISTINCT FROM newj->>'merged_into' THEN
 SELECT * INTO cfg FROM growth_source.config WHERE singleton;
 subject_value:=COALESCE(oldj->>'owner_user_ref',newj->>'owner_user_ref');
 IF cfg.enabled AND subject_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
 INSERT INTO growth_source.outbox(source_id,tenant_ref,subject_ref,kind,payload,data_class) VALUES(cfg.source_id,NEW.id,subject_value::uuid,'ownership',jsonb_build_object('currentSubject',CASE WHEN NEW.is_active AND NEW.merged_into IS NULL THEN NEW.owner_user_ref ELSE NULL END),cfg.data_class);
 END IF;
 END IF; END IF;
 PERFORM growth_source.capture_document(TG_TABLE_NAME,to_jsonb(NEW)); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION growth_source.capture_row(),growth_source.capture_document(text,jsonb),growth_source.subscription_payload(uuid) FROM PUBLIC;
DO $$ DECLARE rel text; BEGIN FOREACH rel IN ARRAY ARRAY['internal.tenants','internal.merchants','internal.outlets','pos.products','pos.transactions','pos.payments','billing.subscriptions','billing.invoices'] LOOP
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=rel::regclass AND tgname='growth_capture') THEN
 EXECUTE format('CREATE TRIGGER growth_capture AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION growth_source.capture_row()',rel); END IF;
END LOOP; END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA growth_source FROM PUBLIC;
COMMIT;
