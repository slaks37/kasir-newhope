-- Membership never implies tenant ownership. The legacy owner-onboarding path
-- needs only a boolean, not staff identities, PINs or cross-tenant billing data.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='svc_membership_probe') THEN
  CREATE ROLE svc_membership_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='svc_membership_probe' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolreplication)) THEN RAISE EXCEPTION 'UNSAFE_MEMBERSHIP_PROBE_ROLE';END IF;
 IF pg_has_role('svc_billing','svc_membership_probe','MEMBER') THEN RAISE EXCEPTION 'BILLING_PROBE_ROLE_MEMBERSHIP_FORBIDDEN';END IF;
 IF NOT pg_has_role(current_user,'svc_membership_probe','SET') THEN EXECUTE format('GRANT svc_membership_probe TO %I WITH INHERIT TRUE, SET TRUE',current_user);END IF;
END $$;
GRANT USAGE,CREATE ON SCHEMA internal TO svc_membership_probe;
GRANT SELECT(user_id,is_active) ON internal.memberships TO svc_membership_probe;
DROP POLICY IF EXISTS billing_enrollment_membership_probe ON internal.memberships;
CREATE POLICY billing_enrollment_membership_probe ON internal.memberships FOR SELECT TO svc_membership_probe USING(true);
CREATE OR REPLACE FUNCTION internal.has_active_staff_assignment(p_subject text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM internal.memberships m WHERE m.user_id::text=p_subject AND m.is_active);
$$;
ALTER FUNCTION internal.has_active_staff_assignment(text) OWNER TO svc_membership_probe;
REVOKE CREATE ON SCHEMA internal FROM svc_membership_probe;
REVOKE ALL ON FUNCTION internal.has_active_staff_assignment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.has_active_staff_assignment(text) TO svc_billing;
