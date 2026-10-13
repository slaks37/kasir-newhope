BEGIN;
-- Historical rows are NOT relabelled provider-verified. No historical backfill.
ALTER TABLE pos.payments ADD COLUMN verification_origin text NOT NULL DEFAULT 'LEGACY_UNVERIFIED' CHECK(verification_origin IN('LEGACY_UNVERIFIED','CASHIER_RECORDED','PROVIDER_VERIFIED'));
ALTER TABLE pos.payments ADD COLUMN provider_verified_at timestamptz;
ALTER TABLE pos.payments ADD COLUMN verified_provider_event text;
CREATE TABLE pos.merchant_payment_accounts(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
 provider text NOT NULL CHECK(provider<>'NEW_HOPE'),provider_account_ref text NOT NULL,
 settlement_model text NOT NULL CHECK(settlement_model='MERCHANT_DIRECT'),
 licensed_provider_review_ref text NOT NULL CHECK(length(licensed_provider_review_ref)>0),owner_approval_ref text NOT NULL CHECK(length(owner_approval_ref)>0),
 is_active boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(provider,provider_account_ref)
);
CREATE TABLE pos.payment_provider_links(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL,merchant_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES pos.merchant_payment_accounts(id),
 payment_id uuid NOT NULL REFERENCES pos.payments(id),provider_payment_ref text NOT NULL,order_reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,provider_payment_ref),UNIQUE(payment_id)
);
CREATE TABLE pos.payment_reconciliation_events(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL,merchant_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES pos.merchant_payment_accounts(id),
 provider_event_ref text NOT NULL,event_hash text NOT NULL,provider_payment_ref text,order_reference text,
 amount numeric(18,2),currency text,outcome text NOT NULL CHECK(outcome IN('VERIFIED','EXCEPTION')),reason text NOT NULL,
 payment_id uuid REFERENCES pos.payments(id),received_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,provider_event_ref)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['merchant_payment_accounts','payment_provider_links','payment_reconciliation_events'] LOOP
  EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON pos.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT,INSERT ON pos.%I TO svc_pos',tab);
  EXECUTE format('CREATE POLICY provider_reconciliation_pos_scope ON pos.%I TO svc_pos USING(tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''app.tenant_id'',true))',tab);
  EXECUTE format('GRANT ALL ON pos.%I TO service_role',tab);
 END LOOP;
END $$;
CREATE FUNCTION pos.reconciliation_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'RECONCILIATION_EVIDENCE_IMMUTABLE';END $$;
REVOKE ALL ON FUNCTION pos.reconciliation_evidence_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER payment_reconciliation_immutable BEFORE UPDATE OR DELETE ON pos.payment_reconciliation_events FOR EACH ROW EXECUTE FUNCTION pos.reconciliation_evidence_immutable();
CREATE TRIGGER payment_reconciliation_truncate_immutable BEFORE TRUNCATE ON pos.payment_reconciliation_events FOR EACH STATEMENT EXECUTE FUNCTION pos.reconciliation_evidence_immutable();
COMMIT;
