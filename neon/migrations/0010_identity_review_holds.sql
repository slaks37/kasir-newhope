-- Isolated staging preparation only. Never resolves ownership by email.
CREATE TABLE IF NOT EXISTS newhope_auth.identity_review_holds (
 source_project text NOT NULL CHECK(source_project='fqxrhumsgigcgjtlbfuo'),
 source_subject uuid PRIMARY KEY,
 conflicting_canonical_id uuid,
 reason text NOT NULL CHECK(reason IN('CANONICAL_UUID_EVIDENCE_MISSING','DIFFERENT_UUID_CANONICAL_EMAIL_COLLISION')),
 source_backup_sha256 text NOT NULL CHECK(source_backup_sha256 ~ '^[0-9a-f]{64}$'),
 authorization_ref text NOT NULL CHECK(length(authorization_ref)>=12),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newhope_auth.identity_review_resolutions (
 source_subject uuid PRIMARY KEY REFERENCES newhope_auth.identity_review_holds(source_subject),
 verified_ownership_evidence_sha256 text NOT NULL CHECK(verified_ownership_evidence_sha256 ~ '^[0-9a-f]{64}$'),
 owner_approval_ref text NOT NULL CHECK(length(owner_approval_ref)>=12),
 resolution text NOT NULL CHECK(resolution IN('VERIFIED_SEPARATE_ACCOUNT','VERIFIED_EXPLICIT_MAPPING')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE newhope_auth.identity_review_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE newhope_auth.identity_review_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON newhope_auth.identity_review_holds,newhope_auth.identity_review_resolutions FROM PUBLIC,anon,authenticated;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='newhope_runtime') THEN
  REVOKE ALL ON newhope_auth.identity_review_holds,newhope_auth.identity_review_resolutions FROM newhope_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='newhope_auth_runtime') THEN
  REVOKE ALL ON newhope_auth.identity_review_holds,newhope_auth.identity_review_resolutions FROM newhope_auth_runtime;
 END IF;
END$$;
CREATE OR REPLACE FUNCTION newhope_auth.reject_unverified_identity_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,newhope_auth AS $$
DECLARE subject text;active boolean;BEGIN
 IF TG_TABLE_SCHEMA='newhope_auth' THEN subject:=NEW.id;active:=NEW."isActive";
 ELSE
  IF NEW.provider NOT IN('better-auth','neon') THEN RETURN NEW;END IF;
  subject:=NEW.provider_subject;active:=NEW.is_active;
 END IF;
 IF active AND EXISTS(SELECT 1 FROM newhope_auth.identity_review_holds h
  WHERE h.source_subject::text=subject AND NOT EXISTS(SELECT 1 FROM newhope_auth.identity_review_resolutions r WHERE r.source_subject=h.source_subject)) THEN
  RAISE EXCEPTION 'IDENTITY_VERIFIED_OWNERSHIP_REQUIRED' USING ERRCODE='42501';
 END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION newhope_auth.reject_identity_hold_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 RAISE EXCEPTION 'IDENTITY_REVIEW_AUDIT_IMMUTABLE' USING ERRCODE='42501';
END$$;
REVOKE ALL ON FUNCTION newhope_auth.reject_unverified_identity_activation(),newhope_auth.reject_identity_hold_mutation() FROM PUBLIC,anon,authenticated;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='newhope_auth.user'::regclass AND tgname='identity_hold_user_activation') THEN
  CREATE TRIGGER identity_hold_user_activation BEFORE INSERT OR UPDATE ON newhope_auth."user" FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_unverified_identity_activation();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='internal.auth_identity_bindings'::regclass AND tgname='identity_hold_binding_activation') THEN
  CREATE TRIGGER identity_hold_binding_activation BEFORE INSERT OR UPDATE ON internal.auth_identity_bindings FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_unverified_identity_activation();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='newhope_auth.identity_review_holds'::regclass AND tgname='identity_holds_immutable') THEN
  CREATE TRIGGER identity_holds_immutable BEFORE UPDATE OR DELETE ON newhope_auth.identity_review_holds FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_identity_hold_mutation();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='newhope_auth.identity_review_resolutions'::regclass AND tgname='identity_resolutions_immutable') THEN
  CREATE TRIGGER identity_resolutions_immutable BEFORE UPDATE OR DELETE ON newhope_auth.identity_review_resolutions FOR EACH ROW EXECUTE FUNCTION newhope_auth.reject_identity_hold_mutation();
 END IF;
END$$;
