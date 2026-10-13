-- REVIEW/STAGING REQUIRED. No row changes and no RLS changes to existing tables.
-- Frontend uses Auth only; services use direct SQL. Do not deploy with a browser
-- database login. Preserve all existing service grants and PUBLIC function use.
BEGIN;
CREATE TABLE IF NOT EXISTS internal.security_acl_rollback (
  remediation text NOT NULL, sequence bigint GENERATED ALWAYS AS IDENTITY,
  statement text NOT NULL, PRIMARY KEY(remediation,sequence)
);
REVOKE ALL ON internal.security_acl_rollback FROM PUBLIC,anon,authenticated;
ALTER TABLE internal.security_acl_rollback ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record; a record; backend record; s text; object_type text; identity text;
  role_sql text; tag constant text := 'browser-role-20261012';
BEGIN
  IF EXISTS(SELECT 1 FROM internal.security_acl_rollback WHERE remediation=tag) THEN
    RAISE EXCEPTION 'Remediation already applied; review snapshot rather than overwriting rollback';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles role_entry ON role_entry.oid=m.member
    WHERE role_entry.rolname IN('anon','authenticated')) THEN
    RAISE EXCEPTION 'Browser role inheritance must be reviewed before revocation';
  END IF;
  -- No PUBLIC relation grants were present in the audited deployment. If drift
  -- adds them, stop: revoking them could change a backend dependency.
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl_entry
    WHERE n.nspname IN('public','pos','internal','billing','ai','contract') AND acl_entry.grantee=0) THEN
    RAISE EXCEPTION 'Unexpected PUBLIC relation grants; review backend dependencies';
  END IF;
  FOR r IN SELECT c.*,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN('public','pos','internal','billing','ai','contract')
      AND c.relkind IN('r','p','v','m','S') AND c.relname<>'security_acl_rollback'
  LOOP
    object_type:=CASE WHEN r.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END;
    identity:=format('%I.%I',r.nspname,r.relname);
    FOR a IN SELECT x.*,g.rolname FROM aclexplode(r.relacl) x JOIN pg_roles g ON g.oid=x.grantee
      WHERE g.rolname IN('anon','authenticated')
    LOOP
      INSERT INTO internal.security_acl_rollback(remediation,statement) VALUES(tag,
        format('GRANT %s ON %s %s TO %I%s;',a.privilege_type,object_type,identity,a.rolname,
          CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
    END LOOP;
    EXECUTE format('REVOKE ALL ON %s %s FROM anon,authenticated',object_type,identity);
    FOR a IN SELECT att.attname,x.*,g.rolname FROM pg_attribute att
      CROSS JOIN LATERAL aclexplode(att.attacl) x JOIN pg_roles g ON g.oid=x.grantee
      WHERE att.attrelid=r.oid AND g.rolname IN('anon','authenticated')
    LOOP
      INSERT INTO internal.security_acl_rollback(remediation,statement) VALUES(tag,
        format('GRANT %s(%I) ON TABLE %s TO %I%s;',a.privilege_type,a.attname,identity,a.rolname,
          CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
      EXECUTE format('REVOKE %s(%I) ON TABLE %s FROM %I',a.privilege_type,a.attname,identity,a.rolname);
    END LOOP;
  END LOOP;
  FOR r IN SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN('public','pos','internal','billing','ai','contract') AND p.prokind='f'
  LOOP
    identity:=format('%I.%I(%s)',r.nspname,r.proname,pg_get_function_identity_arguments(r.oid));
    FOR a IN SELECT x.*,g.rolname FROM aclexplode(COALESCE(r.proacl,acldefault('f',r.proowner))) x
      LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE x.grantee=0 OR g.rolname IN('anon','authenticated')
    LOOP
      role_sql:=CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(a.rolname) END;
      INSERT INTO internal.security_acl_rollback(remediation,statement) VALUES(tag,
        format('GRANT EXECUTE ON FUNCTION %s TO %s%s;',identity,role_sql,
          CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
    END LOOP;
    -- Preserve existing effective EXECUTE for service roles when removing PUBLIC.
    FOR backend IN SELECT rolname FROM pg_roles WHERE rolname IN
      ('service_role','svc_pos','svc_billing','svc_ai','svc_internal','bi_readonly','supabase_auth_admin')
    LOOP
      IF has_function_privilege(backend.rolname,r.oid,'EXECUTE') AND NOT EXISTS(
        SELECT 1 FROM aclexplode(r.proacl) x JOIN pg_roles g ON g.oid=x.grantee WHERE g.rolname=backend.rolname)
      THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',identity,backend.rolname);
        INSERT INTO internal.security_acl_rollback(remediation,statement) VALUES(tag,
          format('REVOKE EXECUTE ON FUNCTION %s FROM %I;',identity,backend.rolname));
      END IF;
    END LOOP;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',identity);
  END LOOP;
  -- Snapshot only this migration owner's defaults. supabase_admin defaults need
  -- separate owner-level review; do not impersonate a managed platform role.
  FOR r IN SELECT d.*,n.nspname FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
    WHERE d.defaclrole=current_user::regrole AND n.nspname IN('public','pos','internal','billing','ai','contract')
  LOOP
    object_type:=CASE r.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS' END;
    IF object_type IS NULL THEN CONTINUE; END IF;
    FOR a IN SELECT x.*,g.rolname FROM aclexplode(r.defaclacl) x LEFT JOIN pg_roles g ON g.oid=x.grantee
      WHERE x.grantee=0 OR g.rolname IN('anon','authenticated')
    LOOP
      role_sql:=CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(a.rolname) END;
      INSERT INTO internal.security_acl_rollback(remediation,statement) VALUES(tag,
        format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT %s ON %s TO %s%s;',
          r.nspname,a.privilege_type,object_type,role_sql,
          CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
    END LOOP;
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON %s FROM anon,authenticated',r.nspname,object_type);
  END LOOP;
  -- PostgreSQL's implicit PUBLIC execute default is global, not schema-local.
  -- Capture it and stop future functions silently becoming anonymous endpoints.
  FOR a IN SELECT x.*,g.rolname FROM aclexplode(COALESCE(
    (SELECT defaclacl FROM pg_default_acl WHERE defaclrole=current_user::regrole AND defaclnamespace=0 AND defaclobjtype='f'),
    acldefault('f',current_user::regrole))) x LEFT JOIN pg_roles g ON g.oid=x.grantee
    WHERE x.grantee=0 OR g.rolname IN('anon','authenticated')
  LOOP
    role_sql:=CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(a.rolname) END;
    INSERT INTO internal.security_acl_rollback(remediation,statement) VALUES(tag,
      format('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO %s%s;',role_sql,
        CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
  END LOOP;
  ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
END $$;
COMMIT;
