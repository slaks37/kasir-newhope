-- Additive; rollout with server/UI together after staging. No legacy PIN import.
BEGIN;
CREATE TABLE IF NOT EXISTS pos.financial_pin_credentials (
  tenant_id uuid NOT NULL REFERENCES internal.tenants(id), approver_ref text NOT NULL,
  pin_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,approver_ref)
);
CREATE TABLE IF NOT EXISTS pos.financial_pin_attempts (
  tenant_id uuid NOT NULL REFERENCES internal.tenants(id), actor_ref text NOT NULL,
  failures int NOT NULL DEFAULT 0, attempts int NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,actor_ref)
);
CREATE TABLE IF NOT EXISTS pos.financial_approval_grants (
  token_hash text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
  merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
  outlet_id uuid NOT NULL REFERENCES internal.outlets(id), actor_ref text NOT NULL,
  approver_ref text NOT NULL, action text NOT NULL, reference text NOT NULL,
  reason text NOT NULL, command_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS pos.financial_authorization_audit (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL,
  merchant_id uuid NOT NULL, outlet_id uuid NOT NULL, actor_ref text NOT NULL,
  approver_ref text NOT NULL, action text NOT NULL, reference text NOT NULL,
  reason text NOT NULL, command_hash text NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(), grant_hash text NOT NULL UNIQUE
);
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['financial_pin_credentials','financial_pin_attempts',
    'financial_approval_grants','financial_authorization_audit']
  LOOP
    EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON pos.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT ALL ON pos.%I TO service_role',tab);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_pos') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON pos.%I TO svc_pos',tab);
      EXECUTE format('CREATE POLICY financial_approval_pos_scope ON pos.%I TO svc_pos
        USING(tenant_id::text=current_setting(''app.tenant_id'',true))
        WITH CHECK(tenant_id::text=current_setting(''app.tenant_id'',true))',tab);
    END IF;
  END LOOP;
END $$;
GRANT DELETE ON pos.financial_approval_grants TO svc_pos;
CREATE OR REPLACE FUNCTION pos.reject_authorization_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_AUTHORIZATION_AUDIT_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION pos.reject_authorization_audit_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_financial_authorization_audit BEFORE UPDATE OR DELETE
ON pos.financial_authorization_audit FOR EACH ROW EXECUTE FUNCTION pos.reject_authorization_audit_mutation();
CREATE TRIGGER immutable_financial_authorization_audit_truncate BEFORE TRUNCATE
ON pos.financial_authorization_audit FOR EACH STATEMENT EXECUTE FUNCTION pos.reject_authorization_audit_mutation();
COMMIT;
