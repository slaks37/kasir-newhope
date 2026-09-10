-- Additive schema only. No backfill, existing view replacement, or POS triggers.
-- Apply using the repository migration runner, after reviewing in staging.
-- Correct only the billing tenant FKs exposed by the full-schema trial test.
-- NO ACTION prevents cascading deletion of billing history; no data is deleted.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.conname,c.conrelid::regclass AS relation FROM pg_constraint c
 WHERE c.contype='f' AND c.conrelid IN ('billing.subscriptions'::regclass,'billing.invoices'::regclass)
 AND c.confrelid='pos.tenants'::regclass
 AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='tenant_id')]::smallint[] LOOP
 EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.relation,r.conname);
 EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(tenant_id) REFERENCES internal.tenants(id) ON DELETE NO ACTION',r.relation,r.conname);
 END LOOP;
END $$;
-- Narrow FK repair validated by the new-tenant catalog test. Only single-column
-- tenant_id references in the sync writer's five tables can match. No row is
-- deleted; NO ACTION preserves billing/operational history on tenant deletion.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.conname,c.conrelid::regclass AS relation FROM pg_constraint c
 WHERE c.contype='f' AND c.conrelid IN ('pos.users'::regclass,'pos.products'::regclass,
 'pos.transactions'::regclass,'pos.transaction_items'::regclass,'pos.sync_receipts'::regclass)
 AND c.confrelid='pos.tenants'::regclass
 AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='tenant_id')]::smallint[] LOOP
 EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.relation,r.conname);
 EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(tenant_id) REFERENCES internal.tenants(id) ON DELETE NO ACTION',r.relation,r.conname);
 END LOOP;
END $$;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS billing_cycle varchar(8) NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('MONTHLY','YEARLY'));
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS extra_outlets integer NOT NULL DEFAULT 0 CHECK (extra_outlets BETWEEN 0 AND 100);
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS recurring_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (recurring_amount >= 0);
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS quote jsonb;
ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS checkout_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_key ON billing.invoices(tenant_id,checkout_key);
ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS reconciliation_note text;
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoice_number ON billing.invoices(invoice_number);
-- Polymorphic resource ID avoids the legacy merchant FK to pos.tenants;
-- historical rows remain unchanged and keep their original foreign key.
ALTER TABLE internal.internal_access_log ADD COLUMN IF NOT EXISTS target_id text;
CREATE TABLE IF NOT EXISTS billing.payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE,
 invoice_number text, gateway_reference text, amount numeric(12,2), currency text,
 outcome text NOT NULL, reason text, payload jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS internal.support_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
 internal_user_id uuid NOT NULL REFERENCES internal.internal_users(id),
 action text NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) >= 10),
 before_state jsonb, after_state jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE billing.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.support_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing.payment_events,internal.support_actions FROM PUBLIC;
-- Contract is private to server roles. UI cannot choose its tenant through it.
CREATE VIEW contract.subscription_operations AS
SELECT s.*,t.is_active AS tenant_active,t.created_at AS tenant_created_at
FROM billing.subscriptions s JOIN internal.tenants t ON t.id=s.tenant_id;
REVOKE ALL ON contract.subscription_operations FROM PUBLIC;
-- Dedicated read models: older migration CASCADEs removed the old aggregate
-- views. New names leave existing consumer views and production rows untouched.
CREATE VIEW contract.admin_sector_summary AS
 SELECT business_sector,count(DISTINCT merchant_id)::int AS merchant_count,
 count(DISTINCT business_id)::int AS business_unit_count,count(*)::int AS transaction_count,
 COALESCE(sum(total_amount),0) AS gross_revenue,COALESCE(avg(total_amount),0) AS avg_basket,
 COALESCE(sum(discount_amount),0) AS total_discount,max(created_at) AS last_transaction_at
 FROM contract.merchant_revenue GROUP BY business_sector;
CREATE VIEW contract.admin_daily_sector_revenue AS
 SELECT business_sector,(created_at AT TIME ZONE 'Asia/Jakarta')::date AS sales_date,count(*)::int AS transaction_count,
 COALESCE(sum(total_amount),0) AS gross_revenue,count(DISTINCT merchant_id)::int AS active_merchants
 FROM contract.merchant_revenue GROUP BY business_sector,(created_at AT TIME ZONE 'Asia/Jakarta')::date;
CREATE VIEW contract.admin_product_sales AS
 SELECT r.business_sector,r.merchant_id,m.name AS merchant_name,i.product_id,i.product_name,i.category_name,
 max(i.product_description) AS product_description,sum(i.quantity) AS units_sold,
 sum(i.total_price) AS revenue,sum(i.unit_cost*i.quantity) AS cogs,
 sum(i.total_price-i.unit_cost*i.quantity) AS gross_profit,count(DISTINCT i.transaction_id) AS appeared_in_transactions,
 max(r.created_at) AS last_sold_at
 FROM pos.transaction_items i JOIN contract.merchant_revenue r ON r.transaction_id=i.transaction_id
 JOIN internal.merchants m ON m.id=r.merchant_id
 GROUP BY r.business_sector,r.merchant_id,m.name,i.product_id,i.product_name,i.category_name;
CREATE VIEW contract.admin_activity_log AS
 SELECT a.id,a.tenant_id,a.merchant_id,COALESCE(m.business_sector,a.detail->>'businessSector',t.business_sector) AS business_sector,
 COALESCE(m.external_ref,a.detail->>'businessId') AS business_id,a.domain AS app_module,a.event_type,a.severity,
 a.actor_name,a.actor_role,a.amount_idr,a.summary,a.detail,a.occurred_at,a.detail->>'transactionId' AS transaction_id,
 COALESCE(m.name,t.name) AS merchant_name FROM internal.audit_logs a
 LEFT JOIN internal.merchants m ON m.id=a.merchant_id LEFT JOIN internal.tenants t ON t.id=a.tenant_id;
CREATE VIEW contract.admin_activity_by_sector AS
 SELECT business_sector,app_module,event_type,severity,count(*)::int AS event_count,
 count(DISTINCT merchant_id)::int AS merchants_affected,max(occurred_at) AS last_seen_at
 FROM contract.admin_activity_log GROUP BY business_sector,app_module,event_type,severity;
REVOKE ALL ON contract.admin_sector_summary,contract.admin_daily_sector_revenue,contract.admin_product_sales,
 contract.admin_activity_log,contract.admin_activity_by_sector FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON contract.subscription_operations,billing.payment_events,internal.support_actions FROM %I',r);
 EXECUTE format('REVOKE ALL ON contract.admin_sector_summary,contract.admin_daily_sector_revenue,contract.admin_product_sales,contract.admin_activity_log,contract.admin_activity_by_sector FROM %I',r);
 END IF; END LOOP;
 FOREACH r IN ARRAY ARRAY['svc_pos','svc_billing','svc_internal','svc_ai'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('GRANT SELECT ON contract.subscription_operations TO %I',r);
 END IF; END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_billing') THEN
 GRANT SELECT,UPDATE(id) ON internal.tenants TO svc_billing;
 GRANT SELECT ON internal.merchants TO svc_billing;
 GRANT SELECT,INSERT,UPDATE ON internal.outlets TO svc_billing;
 GRANT SELECT,INSERT ON billing.payment_events TO svc_billing;
 CREATE POLICY payment_events_billing ON billing.payment_events TO svc_billing USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_internal') THEN
 GRANT SELECT ON contract.admin_sector_summary,contract.admin_daily_sector_revenue,contract.admin_product_sales,
 contract.admin_activity_log,contract.admin_activity_by_sector,contract.staff_commission_ledger TO svc_internal;
 GRANT USAGE ON SCHEMA billing TO svc_internal;
 GRANT SELECT,INSERT,UPDATE ON billing.subscriptions,billing.invoices TO svc_internal;
 GRANT SELECT ON billing.plans,billing.payment_events TO svc_internal;
 GRANT SELECT,INSERT ON internal.support_actions TO svc_internal;
 CREATE POLICY support_actions_internal ON internal.support_actions TO svc_internal USING(true) WITH CHECK(true);
 CREATE POLICY payment_events_internal ON billing.payment_events FOR SELECT TO svc_internal USING(true);
 END IF;
END $$;
