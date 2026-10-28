-- Additive staff administration. Existing memberships and financial actors are
-- not reclassified. Only newly accepted, explicitly reviewed invitations use
-- managed assignments; rollout/checkout flags are untouched.
ALTER TABLE internal.memberships ADD COLUMN IF NOT EXISTS auth_managed boolean NOT NULL DEFAULT false;
ALTER TABLE internal.memberships ADD COLUMN IF NOT EXISTS can_manage_staff boolean NOT NULL DEFAULT false;
ALTER TABLE internal.memberships ADD COLUMN IF NOT EXISTS staff_access_version integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS memberships_staff_id_tenant ON internal.memberships(id,tenant_id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='svc_staff') THEN CREATE ROLE svc_staff NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='svc_staff' AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'UNSAFE_STAFF_ROLE';END IF;
END $$;
CREATE TABLE IF NOT EXISTS internal.staff_invitations(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
 request_key uuid NOT NULL,invited_by uuid NOT NULL REFERENCES internal.users(id),
 email text NOT NULL CHECK(email=lower(email) AND length(email)<=160),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 assignments jsonb NOT NULL CHECK(jsonb_typeof(assignments)='array' AND jsonb_array_length(assignments) BETWEEN 1 AND 32),
 can_manage_staff boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENT','DELIVERY_FAILED','REVOKED','ACCEPTED')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 accepted_by uuid REFERENCES internal.users(id),accepted_at timestamptz,
 UNIQUE(tenant_id,request_key),CHECK((status='ACCEPTED')=(accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_pending_email ON internal.staff_invitations(tenant_id,email) WHERE status IN('PENDING','SENT');
CREATE TABLE IF NOT EXISTS internal.staff_workspace_assignments(
 membership_id uuid NOT NULL,tenant_id uuid NOT NULL,
 merchant_id uuid NOT NULL,outlet_id uuid NOT NULL,module_id text NOT NULL REFERENCES internal.module_definitions(id),
 role text NOT NULL CHECK(role IN('OWNER','ADMIN','MANAGER','CASHIER','BARISTA','CHEF','WASHER','KAPSTER','ACCOUNTANT','STAFF')),
 PRIMARY KEY(membership_id,merchant_id,outlet_id,module_id),
 FOREIGN KEY(membership_id,tenant_id) REFERENCES internal.memberships(id,tenant_id),
 FOREIGN KEY(outlet_id,merchant_id,tenant_id) REFERENCES internal.outlets(id,merchant_id,tenant_id)
);
CREATE TABLE IF NOT EXISTS internal.staff_access_events(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
 actor_id uuid NOT NULL REFERENCES internal.users(id),subject_id uuid REFERENCES internal.users(id),
 invitation_id uuid REFERENCES internal.staff_invitations(id),action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION internal.immutable_staff_access_event() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
 BEGIN RAISE EXCEPTION 'STAFF_AUDIT_IMMUTABLE' USING ERRCODE='42501';END $$;
DROP TRIGGER IF EXISTS immutable_staff_events ON internal.staff_access_events;
CREATE TRIGGER immutable_staff_events BEFORE UPDATE OR DELETE OR TRUNCATE ON internal.staff_access_events FOR EACH STATEMENT EXECUTE FUNCTION internal.immutable_staff_access_event();
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['staff_invitations','staff_workspace_assignments','staff_access_events'] LOOP
  EXECUTE format('ALTER TABLE internal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE internal.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON internal.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','svc_internal','svc_pos','svc_billing','svc_ai','svc_auth'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON internal.%I FROM %I',t,r);END IF;
  END LOOP;
  EXECUTE format('DROP POLICY IF EXISTS staff_tenant ON internal.%I',t);
  EXECUTE format('CREATE POLICY staff_tenant ON internal.%I TO svc_staff USING(tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''app.tenant_id'',true))',t);
 END LOOP;
END $$;
DROP POLICY IF EXISTS staff_accept_token ON internal.staff_invitations;
CREATE POLICY staff_accept_token ON internal.staff_invitations FOR SELECT TO svc_staff USING(token_hash=current_setting('app.staff_invite_hash',true));
GRANT USAGE ON SCHEMA internal TO svc_staff;
DO $$ BEGIN IF to_regclass('public.uuidv7_counter') IS NOT NULL THEN GRANT USAGE ON SEQUENCE public.uuidv7_counter TO svc_staff;END IF;END $$;
GRANT SELECT,INSERT,UPDATE ON internal.staff_invitations TO svc_staff;
GRANT SELECT,INSERT,DELETE ON internal.staff_workspace_assignments TO svc_staff;
GRANT SELECT,INSERT ON internal.staff_access_events TO svc_staff;
GRANT SELECT(id,email,full_name,is_active) ON internal.users TO svc_staff;
GRANT SELECT(id,name,owner_user_ref,is_active,merged_into) ON internal.tenants TO svc_staff;
GRANT SELECT(id,tenant_id,name,is_active) ON internal.merchants TO svc_staff;
GRANT SELECT(id,tenant_id,merchant_id,name,is_active) ON internal.outlets TO svc_staff;
GRANT SELECT(tenant_id,merchant_id,module_id,enabled,workspace_version) ON internal.merchant_modules TO svc_staff;
DROP POLICY IF EXISTS staff_assignment_catalog ON internal.merchant_modules;
CREATE POLICY staff_assignment_catalog ON internal.merchant_modules FOR SELECT TO svc_staff USING(tenant_id::text=current_setting('app.tenant_id',true));
GRANT SELECT(id,user_id,tenant_id,merchant_id,outlet_id,scope_type,role,is_active,auth_managed,can_manage_staff,staff_access_version) ON internal.memberships TO svc_staff;
GRANT INSERT(user_id,tenant_id,scope_type,role,auth_managed,can_manage_staff) ON internal.memberships TO svc_staff;
GRANT UPDATE(is_active,can_manage_staff,staff_access_version) ON internal.memberships TO svc_staff;
CREATE OR REPLACE FUNCTION internal.staff_membership_write_boundary() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
 BEGIN IF current_user='svc_staff' AND (NOT NEW.auth_managed OR TG_OP='INSERT' AND (NEW.role<>'STAFF' OR NEW.scope_type<>'TENANT')) THEN RAISE EXCEPTION 'LEGACY_MEMBERSHIP_REVIEW_REQUIRED' USING ERRCODE='42501';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS staff_membership_boundary ON internal.memberships;
CREATE TRIGGER staff_membership_boundary BEFORE INSERT OR UPDATE ON internal.memberships FOR EACH ROW EXECUTE FUNCTION internal.staff_membership_write_boundary();
GRANT SELECT(auth_managed,can_manage_staff) ON internal.memberships TO svc_pos;
GRANT SELECT ON internal.staff_workspace_assignments TO svc_pos;
DROP POLICY IF EXISTS staff_pos_scope ON internal.staff_workspace_assignments;
CREATE POLICY staff_pos_scope ON internal.staff_workspace_assignments FOR SELECT TO svc_pos USING(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true));
GRANT SELECT(auth_managed) ON internal.memberships TO svc_membership_probe;
CREATE OR REPLACE FUNCTION internal.has_active_staff_assignment(p_subject text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM internal.memberships m WHERE m.user_id::text=p_subject AND (m.is_active OR m.auth_managed));
$$;
REVOKE ALL ON FUNCTION internal.has_active_staff_assignment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.has_active_staff_assignment(text) TO svc_billing;
