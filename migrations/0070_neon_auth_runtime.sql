-- Isolated Better Auth core, verified against pinned 1.7.14 migration planner.
-- Additive staging implementation; production auth cutover remains disabled.

create schema if not exists "newhope_auth";

create table if not exists "newhope_auth"."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean, "onboarding" jsonb, "isActive" boolean not null);

create table if not exists "newhope_auth"."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "newhope_auth"."user" ("id") on delete cascade);

create table if not exists "newhope_auth"."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "newhope_auth"."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table if not exists "newhope_auth"."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table if not exists "newhope_auth"."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "newhope_auth"."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create table if not exists "newhope_auth"."rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index if not exists "session_userId_idx" on "newhope_auth"."session" ("userId");

create index if not exists "account_userId_idx" on "newhope_auth"."account" ("userId");

create index if not exists "verification_identifier_idx" on "newhope_auth"."verification" ("identifier");

create index if not exists "twoFactor_secret_idx" on "newhope_auth"."twoFactor" ("secret");

create index if not exists "twoFactor_userId_idx" on "newhope_auth"."twoFactor" ("userId");

CREATE TABLE IF NOT EXISTS newhope_auth.mfa_session_proofs(
 session_id text PRIMARY KEY REFERENCES newhope_auth.session(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES newhope_auth."user"(id) ON DELETE CASCADE,
 method text NOT NULL CHECK(method IN ('totp','recovery')),verified_at timestamptz NOT NULL
);
-- Existing staging auth schemas are extended without importing assurance.
ALTER TABLE newhope_auth."user" ADD COLUMN IF NOT EXISTS onboarding jsonb;
ALTER TABLE newhope_auth.mfa_session_proofs ADD COLUMN IF NOT EXISTS method text;
CREATE TABLE IF NOT EXISTS newhope_auth.registration_intents(
 user_id text PRIMARY KEY REFERENCES newhope_auth."user"(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS newhope_auth.native_transactions(
 id text PRIMARY KEY,challenge text NOT NULL CHECK(length(challenge)=43),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS newhope_auth.native_handoffs(
 code_hash text PRIMARY KEY,transaction_id text NOT NULL REFERENCES newhope_auth.native_transactions(id),
 token_encrypted text NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz
);
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='svc_auth') THEN CREATE ROLE svc_auth NOLOGIN;END IF; IF EXISTS(SELECT FROM pg_roles WHERE rolname='svc_auth' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolreplication)) THEN RAISE EXCEPTION 'UNSAFE_AUTH_RUNTIME_ROLE';END IF;END $$;
REVOKE ALL ON SCHEMA newhope_auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA newhope_auth FROM PUBLIC;
DO $$ DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','svc_internal','svc_pos','svc_billing','svc_ai','svc_backoffice'] LOOP IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON SCHEMA newhope_auth FROM %I',r);EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA newhope_auth FROM %I',r);END IF;END LOOP;END $$;
GRANT USAGE ON SCHEMA newhope_auth,internal TO svc_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA newhope_auth TO svc_auth;
GRANT SELECT ON internal.auth_identity_bindings,internal.users TO svc_auth;
DROP POLICY IF EXISTS auth_identity_auth_read ON internal.auth_identity_bindings;
CREATE POLICY auth_identity_auth_read ON internal.auth_identity_bindings FOR SELECT TO svc_auth USING(true);
DROP POLICY IF EXISTS auth_runtime_user_read ON internal.users;
CREATE POLICY auth_runtime_user_read ON internal.users FOR SELECT TO svc_auth USING(true);
DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='newhope_auth' LOOP
 EXECUTE format('ALTER TABLE newhope_auth.%I ENABLE ROW LEVEL SECURITY',t.tablename);
 EXECUTE format('ALTER TABLE newhope_auth.%I FORCE ROW LEVEL SECURITY',t.tablename);
 EXECUTE format('DROP POLICY IF EXISTS auth_runtime_private ON newhope_auth.%I',t.tablename);
 EXECUTE format('CREATE POLICY auth_runtime_private ON newhope_auth.%I TO svc_auth USING(true) WITH CHECK(true)',t.tablename);
END LOOP;END $$;
-- A non-login definer role can enroll a verified new identity, but the auth
-- runtime never inherits this role or receives generic canonical/mapping writes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='svc_auth_enrollment') THEN
  CREATE ROLE svc_auth_enrollment NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='svc_auth_enrollment' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolreplication)) THEN RAISE EXCEPTION 'UNSAFE_AUTH_ENROLLMENT_ROLE';END IF;
 IF pg_has_role('svc_auth','svc_auth_enrollment','MEMBER') THEN RAISE EXCEPTION 'AUTH_RUNTIME_ENROLLMENT_ROLE_MEMBERSHIP_FORBIDDEN';END IF;
 -- ALTER FUNCTION OWNER requires membership and schema CREATE for the new
 -- owner. Only this trusted migration actor receives membership; CREATE is
 -- removed from the definer once ownership has been transferred.
 IF NOT pg_has_role(current_user,'svc_auth_enrollment','SET') THEN EXECUTE format('GRANT svc_auth_enrollment TO %I WITH INHERIT TRUE, SET TRUE',current_user);END IF;
END $$;
GRANT USAGE,CREATE ON SCHEMA newhope_auth TO svc_auth_enrollment;
GRANT USAGE ON SCHEMA internal TO svc_auth_enrollment;
GRANT SELECT ON newhope_auth."user",newhope_auth.registration_intents TO svc_auth_enrollment;
GRANT UPDATE(consumed_at) ON newhope_auth.registration_intents TO svc_auth_enrollment;
GRANT SELECT,INSERT ON internal.users,internal.auth_identity_bindings TO svc_auth_enrollment;
GRANT INSERT ON internal.auth_identity_enrollment_events TO svc_auth_enrollment;
DROP POLICY IF EXISTS auth_enrollment_user_read ON newhope_auth."user";
CREATE POLICY auth_enrollment_user_read ON newhope_auth."user" FOR SELECT TO svc_auth_enrollment USING(true);
DROP POLICY IF EXISTS auth_enrollment_intent_read ON newhope_auth.registration_intents;
CREATE POLICY auth_enrollment_intent_read ON newhope_auth.registration_intents FOR SELECT TO svc_auth_enrollment USING(true);
DROP POLICY IF EXISTS auth_enrollment_intent_consume ON newhope_auth.registration_intents;
CREATE POLICY auth_enrollment_intent_consume ON newhope_auth.registration_intents FOR UPDATE TO svc_auth_enrollment USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS auth_enrollment_canonical_read ON internal.users;
CREATE POLICY auth_enrollment_canonical_read ON internal.users FOR SELECT TO svc_auth_enrollment USING(true);
DROP POLICY IF EXISTS auth_enrollment_canonical_insert ON internal.users;
CREATE POLICY auth_enrollment_canonical_insert ON internal.users FOR INSERT TO svc_auth_enrollment WITH CHECK(NOT is_platform_user AND platform_role IS NULL AND is_active);
DROP POLICY IF EXISTS auth_enrollment_mapping_read ON internal.auth_identity_bindings;
CREATE POLICY auth_enrollment_mapping_read ON internal.auth_identity_bindings FOR SELECT TO svc_auth_enrollment USING(true);
DROP POLICY IF EXISTS auth_enrollment_mapping_insert ON internal.auth_identity_bindings;
CREATE POLICY auth_enrollment_mapping_insert ON internal.auth_identity_bindings FOR INSERT TO svc_auth_enrollment WITH CHECK(provider='better-auth' AND verification_ref='verified-new-signup' AND is_active);
DROP POLICY IF EXISTS auth_enrollment_event_insert ON internal.auth_identity_enrollment_events;
CREATE POLICY auth_enrollment_event_insert ON internal.auth_identity_enrollment_events FOR INSERT TO svc_auth_enrollment WITH CHECK(provider='better-auth' AND verification_ref='verified-new-signup');
-- The auth role cannot repoint an existing binding or claim an existing owner by email.
CREATE OR REPLACE FUNCTION newhope_auth.enroll_new_identity(p_user text,p_issuer text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u record;canonical uuid;
BEGIN
 IF p_issuer IS NULL OR length(p_issuer)>2048 OR p_issuer !~ '^https://[^/?#@[:space:]]+$' OR p_user IS NULL OR length(p_user) NOT BETWEEN 1 AND 255 THEN RETURN NULL;END IF;
 SELECT a.* INTO u FROM newhope_auth."user" a JOIN newhope_auth.registration_intents i ON i.user_id=a.id
 WHERE a.id=p_user AND a."emailVerified" AND a."isActive" AND i.consumed_at IS NULL FOR UPDATE OF i;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF EXISTS(SELECT FROM internal.users WHERE lower(email)=lower(u.email)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT FROM internal.auth_identity_bindings WHERE provider='better-auth' AND issuer=p_issuer AND provider_subject=p_user) THEN RETURN NULL;END IF;
 canonical:=gen_random_uuid();
 INSERT INTO internal.users(id,email,full_name) VALUES(canonical,u.email,u.name);
 INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,is_active,verification_ref,manifest_digest)
 VALUES('better-auth',p_issuer,p_user,canonical,true,'verified-new-signup',encode(sha256(convert_to(p_issuer||chr(10)||p_user,'UTF8')),'hex'));
 INSERT INTO internal.auth_identity_enrollment_events(canonical_user_id,provider,issuer,provider_subject,verification_ref) VALUES(canonical,'better-auth',p_issuer,p_user,'verified-new-signup');
 UPDATE newhope_auth.registration_intents SET consumed_at=now() WHERE user_id=p_user;
 RETURN canonical;
END $$;
ALTER FUNCTION newhope_auth.enroll_new_identity(text,text) OWNER TO svc_auth_enrollment;
REVOKE CREATE ON SCHEMA newhope_auth FROM svc_auth_enrollment;
REVOKE ALL ON FUNCTION newhope_auth.enroll_new_identity(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION newhope_auth.enroll_new_identity(text,text) TO svc_auth;
