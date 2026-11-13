-- Explicit personal-staff registration can restrict onboarding, never confer ownership.
-- Existing canonical users and historical owners retain their original behavior.
ALTER TABLE internal.users ADD COLUMN IF NOT EXISTS auth_staff_only boolean NOT NULL DEFAULT false;
GRANT USAGE,CREATE ON SCHEMA internal TO svc_membership_probe;
GRANT SELECT(id,auth_staff_only) ON internal.users TO svc_membership_probe;
DROP POLICY IF EXISTS billing_staff_identity_probe ON internal.users;
CREATE POLICY billing_staff_identity_probe ON internal.users FOR SELECT TO svc_membership_probe USING(true);
CREATE OR REPLACE FUNCTION internal.is_staff_only_identity(p_subject text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM internal.users u WHERE u.id::text=p_subject AND u.auth_staff_only);
$$;
ALTER FUNCTION internal.is_staff_only_identity(text) OWNER TO svc_membership_probe;
REVOKE CREATE ON SCHEMA internal FROM svc_membership_probe;
REVOKE ALL ON FUNCTION internal.is_staff_only_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.is_staff_only_identity(text) TO svc_billing;
GRANT USAGE,CREATE ON SCHEMA newhope_auth TO svc_auth_enrollment;
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
 INSERT INTO internal.users(id,email,full_name,auth_staff_only) VALUES(canonical,u.email,u.name,COALESCE(u.onboarding->>'account_purpose'='STAFF',false));
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
