-- Internal membership is provisioned by a database operator, not runtime APIs.
-- No membership rows or role assignments are changed by this migration.
ALTER TABLE internal.internal_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.internal_users FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','svc_pos','svc_ai','svc_billing'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON internal.internal_users FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_internal') THEN
  REVOKE ALL ON internal.internal_users FROM svc_internal;
  GRANT SELECT ON internal.internal_users TO svc_internal;
  CREATE POLICY admin_runtime_read_membership ON internal.internal_users FOR SELECT TO svc_internal USING (true);
 END IF;
END $$;
