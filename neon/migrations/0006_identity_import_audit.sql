-- Additive audit for reviewed, credential-free identity imports. The migrator
-- applies this after the auth schema. Browser and runtime roles receive no grant.
CREATE TABLE newhope_auth.identity_import_batches (
  id uuid PRIMARY KEY,
  source_project text NOT NULL CHECK (source_project='fqxrhumsgigcgjtlbfuo'),
  source_digest text NOT NULL UNIQUE CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  source_backup_ref text NOT NULL,
  reviewer_ref text NOT NULL,
  issuer text NOT NULL,
  row_count integer NOT NULL CHECK(row_count>0),
  business_digest text NOT NULL CHECK (business_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE newhope_auth.identity_import_items (
  batch_id uuid NOT NULL REFERENCES newhope_auth.identity_import_batches(id),
  canonical_user_id uuid NOT NULL REFERENCES internal.users(id),
  provider_subject text NOT NULL REFERENCES newhope_auth."user"(id),
  email_digest text NOT NULL CHECK (email_digest ~ '^[0-9a-f]{64}$'),
  source_email_verified boolean NOT NULL,
  source_active boolean NOT NULL,
  PRIMARY KEY(batch_id,canonical_user_id)
);
CREATE TABLE newhope_auth.identity_import_revocations (
  batch_id uuid PRIMARY KEY REFERENCES newhope_auth.identity_import_batches(id),
  reviewer_ref text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION newhope_auth.reject_identity_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Identity migration audit is immutable' USING ERRCODE='42501'; END;
$$;
CREATE TRIGGER identity_import_batches_immutable BEFORE UPDATE OR DELETE ON newhope_auth.identity_import_batches
FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_identity_audit_mutation();
CREATE TRIGGER identity_import_items_immutable BEFORE UPDATE OR DELETE ON newhope_auth.identity_import_items
FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_identity_audit_mutation();
CREATE TRIGGER identity_import_revocations_immutable BEFORE UPDATE OR DELETE ON newhope_auth.identity_import_revocations
FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_identity_audit_mutation();
REVOKE ALL ON newhope_auth.identity_import_batches,newhope_auth.identity_import_items,newhope_auth.identity_import_revocations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION newhope_auth.reject_identity_audit_mutation() FROM PUBLIC,anon,authenticated;
ALTER TABLE newhope_auth.identity_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE newhope_auth.identity_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE newhope_auth.identity_import_revocations ENABLE ROW LEVEL SECURITY;
-- No DROP rollback: revoke an individual imported batch through the reviewed
-- identity CLI, preserving audit and all POS, tenant, billing and wallet rows.
