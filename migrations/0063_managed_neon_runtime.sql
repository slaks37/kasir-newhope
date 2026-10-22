-- Additive application authorization/step-up state. Managed neon_auth is untouched.
CREATE TABLE IF NOT EXISTS internal.auth_identity_bindings (
 provider text NOT NULL CHECK(provider IN('supabase','neon','better-auth')),issuer text NOT NULL,provider_subject text NOT NULL,
 canonical_user_id uuid NOT NULL REFERENCES internal.users(id),is_active boolean NOT NULL DEFAULT true,
 verification_ref text NOT NULL CHECK(length(verification_ref)>0),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,issuer,provider_subject),UNIQUE(provider,issuer,canonical_user_id)
);
CREATE TABLE IF NOT EXISTS internal.admin_mfa_factors (
 subject text PRIMARY KEY,secret_cipher text NOT NULL,verified_at timestamptz,last_counter bigint NOT NULL DEFAULT -1,
 recovery_hashes jsonb NOT NULL DEFAULT '[]',failures integer NOT NULL DEFAULT 0,blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS internal.admin_mfa_sessions (
 token_hash text PRIMARY KEY,subject text NOT NULL,bearer_hash text NOT NULL,verified_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,method text NOT NULL CHECK(method IN('TOTP','RECOVERY'))
);
CREATE INDEX IF NOT EXISTS admin_mfa_sessions_subject ON internal.admin_mfa_sessions(subject);
CREATE TABLE IF NOT EXISTS internal.business_files (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES internal.tenants(id),object_key text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),content_type text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10000000),created_by text NOT NULL,
 deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
-- Reapplication also repairs the earlier isolated staging revision, without
-- inventing hashes for any existing file. Missing evidence fails closed.
ALTER TABLE internal.business_files ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE internal.business_files ALTER COLUMN sha256 SET NOT NULL;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='internal.business_files'::regclass AND conname='business_files_sha256_check') THEN
  ALTER TABLE internal.business_files ADD CONSTRAINT business_files_sha256_check CHECK(sha256 ~ '^[a-f0-9]{64}$');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='internal.business_files'::regclass AND conname='business_files_tenant_key_check') THEN
  ALTER TABLE internal.business_files ADD CONSTRAINT business_files_tenant_key_check CHECK(object_key='tenants/'||tenant_id::text||'/'||id::text||'/'||sha256);
 END IF;
END$$;
ALTER TABLE internal.auth_identity_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.admin_mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.admin_mfa_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.business_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.auth_identity_bindings,internal.admin_mfa_factors,internal.admin_mfa_sessions,internal.business_files FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS internal.business_file_events (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES internal.tenants(id),file_id uuid NOT NULL REFERENCES internal.business_files(id),
 actor_subject text NOT NULL,action text NOT NULL CHECK(action IN('UPLOADED','DOWNLOAD_AUTHORIZED','DELETED')),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE internal.business_file_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.business_file_events FROM PUBLIC,anon,authenticated;
