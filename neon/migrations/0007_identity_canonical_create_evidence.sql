-- Additive evidence for explicitly reviewed missing canonical profiles.
CREATE TABLE newhope_auth.identity_import_canonical_creates (
  batch_id uuid NOT NULL REFERENCES newhope_auth.identity_import_batches(id),
  canonical_user_id uuid NOT NULL REFERENCES internal.users(id),
  reviewed_target_digest text NOT NULL CHECK(reviewed_target_digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(batch_id,canonical_user_id)
);
CREATE TRIGGER identity_import_canonical_creates_immutable BEFORE UPDATE OR DELETE ON newhope_auth.identity_import_canonical_creates
FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_identity_audit_mutation();
ALTER TABLE newhope_auth.identity_import_canonical_creates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON newhope_auth.identity_import_canonical_creates FROM PUBLIC,anon,authenticated;
-- Canonical profiles are retained during individual batch revocation. No tenant,
-- platform role, membership, trial, wallet or financial mutation is performed.
