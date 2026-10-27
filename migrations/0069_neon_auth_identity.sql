-- Additive authentication identity registry. Application UUIDs and every
-- historical owner/member/financial actor reference remain unchanged.
CREATE TABLE IF NOT EXISTS internal.auth_identity_bindings (
 provider text NOT NULL CHECK(provider='better-auth'),
 issuer text NOT NULL CHECK(issuer ~ '^https://[^/?#[:space:]]+$'),
 provider_subject text NOT NULL CHECK(length(provider_subject) BETWEEN 1 AND 255),
 canonical_user_id uuid NOT NULL REFERENCES internal.users(id),
 is_active boolean NOT NULL DEFAULT true,
 verification_ref text NOT NULL CHECK(length(verification_ref) BETWEEN 12 AND 200),
 manifest_digest text NOT NULL CHECK(manifest_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,issuer,provider_subject),
 UNIQUE(provider,issuer,canonical_user_id)
);
CREATE TABLE IF NOT EXISTS internal.auth_identity_migration_batches (
 manifest_digest text PRIMARY KEY CHECK(manifest_digest ~ '^[a-f0-9]{64}$'),
 provider text NOT NULL CHECK(provider='better-auth'),issuer text NOT NULL,
 source_snapshot_digest text NOT NULL CHECK(source_snapshot_digest ~ '^[a-f0-9]{64}$'),
 reviewer_ref text NOT NULL CHECK(length(reviewer_ref) BETWEEN 12 AND 200),
 freeze_ref text NOT NULL CHECK(length(freeze_ref) BETWEEN 12 AND 200),
 business_digest text NOT NULL CHECK(business_digest ~ '^[a-f0-9]{64}$'),
 target_digest text NOT NULL CHECK(target_digest ~ '^[a-f0-9]{64}$'),
 mapping_count integer NOT NULL CHECK(mapping_count BETWEEN 1 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS internal.auth_identity_migration_revocations (
 manifest_digest text PRIMARY KEY REFERENCES internal.auth_identity_migration_batches(manifest_digest),
 reviewer_ref text NOT NULL CHECK(length(reviewer_ref) BETWEEN 12 AND 200),
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS internal.auth_identity_enrollment_events (
 canonical_user_id uuid PRIMARY KEY REFERENCES internal.users(id),
 provider text NOT NULL CHECK(provider='better-auth'),issuer text NOT NULL,provider_subject text NOT NULL,
 verification_ref text NOT NULL CHECK(length(verification_ref) BETWEEN 12 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(provider,issuer,provider_subject)
);
CREATE OR REPLACE FUNCTION internal.protect_auth_identity_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='auth_identity_bindings' AND TG_OP='UPDATE' AND
  (to_jsonb(NEW)-'is_active')=(to_jsonb(OLD)-'is_active') THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'AUTH_IDENTITY_EVIDENCE_IMMUTABLE' USING ERRCODE='42501';
END $$;
DO $$ DECLARE tab text;role_name text;BEGIN
 FOREACH tab IN ARRAY ARRAY['auth_identity_bindings','auth_identity_migration_batches','auth_identity_migration_revocations','auth_identity_enrollment_events'] LOOP
  EXECUTE format('ALTER TABLE internal.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON internal.%I FROM PUBLIC',tab);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','svc_pos','svc_billing','svc_ai','svc_backoffice','svc_internal'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON internal.%I FROM %I',tab,role_name);END IF;
  END LOOP;
  EXECUTE format('DROP TRIGGER IF EXISTS auth_identity_evidence_immutable ON internal.%I',tab);
  EXECUTE format('CREATE TRIGGER auth_identity_evidence_immutable BEFORE UPDATE OR DELETE ON internal.%I FOR EACH ROW EXECUTE FUNCTION internal.protect_auth_identity_evidence()',tab);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_internal') THEN
  GRANT SELECT ON internal.auth_identity_bindings TO svc_internal;
  DROP POLICY IF EXISTS auth_identity_internal_read ON internal.auth_identity_bindings;
  CREATE POLICY auth_identity_internal_read ON internal.auth_identity_bindings FOR SELECT TO svc_internal USING(true);
 END IF;
END $$;
REVOKE ALL ON FUNCTION internal.protect_auth_identity_evidence() FROM PUBLIC;
-- No runtime mapping INSERT/UPDATE/DELETE grant. Reviewed maintenance uses the
-- migration owner. Verified new signup has a separate narrowly scoped RPC.
-- Rollback switches the selected auth provider back; retain this registry and
-- its audit evidence. Never delete mappings or rewrite historical actors.
