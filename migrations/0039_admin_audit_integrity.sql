-- Only the two admin audit ledgers are affected; no POS triggers or data edits.
ALTER TABLE internal.internal_access_log ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE internal.internal_access_log ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE internal.support_actions ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE internal.support_actions ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE internal.support_actions ADD COLUMN IF NOT EXISTS user_agent text;
CREATE INDEX IF NOT EXISTS internal_access_request ON internal.internal_access_log(request_id);
CREATE INDEX IF NOT EXISTS support_action_request ON internal.support_actions(request_id);

CREATE OR REPLACE FUNCTION internal.reject_admin_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ADMIN_AUDIT_APPEND_ONLY' USING ERRCODE='42501'; END;
$$;
REVOKE ALL ON FUNCTION internal.reject_admin_audit_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS admin_access_append_only ON internal.internal_access_log;
CREATE TRIGGER admin_access_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
 ON internal.internal_access_log FOR EACH STATEMENT EXECUTE FUNCTION internal.reject_admin_audit_mutation();
DROP TRIGGER IF EXISTS admin_support_append_only ON internal.support_actions;
CREATE TRIGGER admin_support_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
 ON internal.support_actions FOR EACH STATEMENT EXECUTE FUNCTION internal.reject_admin_audit_mutation();
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['svc_internal','svc_pos','svc_billing','svc_ai'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON internal.internal_access_log,internal.support_actions FROM %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON internal.internal_access_log,internal.support_actions FROM %I',r);
  END IF;
 END LOOP;
END $$;
