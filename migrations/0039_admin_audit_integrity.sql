-- Only the two admin audit ledgers are affected; no POS triggers or data edits.
ALTER TABLE internal.internal_access_log ADD COLUMN request_id uuid;
ALTER TABLE internal.internal_access_log ADD COLUMN user_agent text;
ALTER TABLE internal.support_actions ADD COLUMN request_id uuid;
ALTER TABLE internal.support_actions ADD COLUMN ip_address text;
ALTER TABLE internal.support_actions ADD COLUMN user_agent text;
CREATE INDEX internal_access_request ON internal.internal_access_log(request_id);
CREATE INDEX support_action_request ON internal.support_actions(request_id);

CREATE FUNCTION internal.reject_admin_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ADMIN_AUDIT_APPEND_ONLY' USING ERRCODE='42501'; END;
$$;
REVOKE ALL ON FUNCTION internal.reject_admin_audit_mutation() FROM PUBLIC;
CREATE TRIGGER admin_access_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
 ON internal.internal_access_log FOR EACH STATEMENT EXECUTE FUNCTION internal.reject_admin_audit_mutation();
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
