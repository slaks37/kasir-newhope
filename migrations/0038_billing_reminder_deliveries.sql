-- Private delivery ledger; existing merchant rows and permissions are unchanged.
CREATE TABLE billing.reminder_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES billing.subscriptions(id),
 period_end timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN ('H3','H1')),
 state text NOT NULL CHECK(state IN ('SENDING','SENT','FAILED','REVIEW')),
 payload jsonb NOT NULL,
 first_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_attempt_at timestamptz NOT NULL DEFAULT now(),
 provider_id text,
 error_code text,
 UNIQUE(subscription_id,period_end,kind)
);
ALTER TABLE billing.reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing.reminder_deliveries FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON billing.reminder_deliveries FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_billing') THEN
  GRANT SELECT,INSERT,UPDATE ON billing.reminder_deliveries TO svc_billing;
  CREATE POLICY reminder_delivery_billing ON billing.reminder_deliveries TO svc_billing USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_internal') THEN
  GRANT SELECT ON billing.reminder_deliveries TO svc_internal;
  CREATE POLICY reminder_delivery_internal ON billing.reminder_deliveries FOR SELECT TO svc_internal USING(true);
 END IF;
END $$;
