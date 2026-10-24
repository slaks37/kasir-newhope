-- Additive release evidence only. No payment, identity or historical rewrite.
CREATE TABLE IF NOT EXISTS billing.doku_release_acceptances (
 id uuid PRIMARY KEY,
 scope text NOT NULL CHECK(scope IN ('SANDBOX','PILOT','PUBLIC')),
 api_url text NOT NULL CHECK(api_url IN ('https://api.doku.com','https://api-sandbox.doku.com')),
 credential_sha256 text NOT NULL CHECK(credential_sha256 ~ '^[0-9a-f]{64}$'),
 channels text[] NOT NULL CHECK(cardinality(channels)>0 AND cardinality(channels)<=16),
 allowed_tenants uuid[] NOT NULL DEFAULT '{}',
 owner_approval_ref text NOT NULL CHECK(length(owner_approval_ref) BETWEEN 8 AND 200),
 provider_evidence_sha256 text NOT NULL CHECK(provider_evidence_sha256 ~ '^[0-9a-f]{64}$'),
 credentials_verified_at timestamptz NOT NULL,
 webhook_verified_at timestamptz NOT NULL,
 live_payment_verified_at timestamptz,
 approved_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK(expires_at>approved_at),
 CHECK((scope='SANDBOX')=(api_url='https://api-sandbox.doku.com')),
 CHECK(scope<>'PILOT' OR cardinality(allowed_tenants)>0),
 CHECK(scope<>'PUBLIC' OR live_payment_verified_at IS NOT NULL)
);
REVOKE ALL ON billing.doku_release_acceptances FROM PUBLIC;
CREATE INDEX IF NOT EXISTS doku_applied_reference_lookup ON billing.payment_events(gateway_reference) WHERE outcome='APPLIED';
CREATE INDEX IF NOT EXISTS doku_inquiry_probe_lookup ON billing.payment_events(invoice_number,created_at DESC) WHERE payload->>'source'='INQUIRY_PROBE';
DO $$DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','svc_pos','svc_billing','svc_ai','svc_internal','bi_readonly','newhope_clean_runtime'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON billing.doku_release_acceptances FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='newhope_clean_runtime') THEN
  GRANT SELECT ON billing.doku_release_acceptances TO newhope_clean_runtime;
 END IF;
END$$;
