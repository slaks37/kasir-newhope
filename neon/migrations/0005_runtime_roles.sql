-- NEON ONLY. Apply as migration owner after full schema restore, before issuing
-- runtime login credentials. Adds new roles/policies; existing grants, owners,
-- RLS flags, tenant records and security-definer functions are untouched.
-- Authorization stays on the server. This role is never a browser/Data API role.
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['newhope_runtime','newhope_auth_runtime','newhope_migrator'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN
      RAISE EXCEPTION 'UNSAFE_EXISTING_MIGRATION_ROLE:%',role_name;
    END IF;
  END LOOP;
END $$;

DO $$ DECLARE s text;r record;target_role text; BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO newhope_runtime,newhope_auth_runtime,newhope_migrator',current_database());
  -- Current app is one native server runtime: billing, POS, admin, AI and MCP
  -- share a Db and transactions across schemas. Per-service roles cannot be
  -- substituted until that architecture is separated; neither schema labels
  -- nor browser claims enforce an SQL boundary.
  FOREACH s IN ARRAY ARRAY['pos','internal','billing','ai','public','contract','mcp_private','blog_mcp_private'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=s) THEN CONTINUE; END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO newhope_runtime',s);
    EXECUTE format('GRANT USAGE,CREATE ON SCHEMA %I TO newhope_migrator',s);
    FOR r IN SELECT c.oid,c.relname,c.relkind,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=s AND c.relkind IN('r','p','v','m','S') LOOP
      IF s='internal' AND r.relname IN('security_acl_rollback','security_acl_rollback_sequence_seq') THEN CONTINUE; END IF;
      IF s='public' AND r.relname IN('schema_migrations','_newhope_neon_role_rollback') THEN CONTINUE; END IF;
      IF r.relkind='S' THEN EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %I.%I TO newhope_runtime',s,r.relname);
      ELSIF r.relkind IN('v','m') THEN EXECUTE format('GRANT SELECT ON %I.%I TO newhope_runtime',s,r.relname);
      ELSE
        IF s='ai' AND r.relname='credit_ledger' THEN
          -- Only hardened owner trigger/functions append credit facts. A
          -- backend query bug must not manufacture a ledger entry directly.
          EXECUTE format('GRANT SELECT ON %I.%I TO newhope_runtime',s,r.relname);
          EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON %I.%I FROM newhope_runtime',s,r.relname);
        ELSIF (s||'.'||r.relname)=ANY(ARRAY['ai.provider_consent_events',
          'internal.internal_access_log','internal.support_actions','internal.privacy_request_events','internal.legal_notice_acknowledgements',
          'pos.cash_ledger','pos.transaction_refunds','pos.transaction_refund_items','pos.financial_authorization_audit',
          'pos.payment_reconciliation_events','pos.inventory_transactions']) THEN
          EXECUTE format('GRANT SELECT,INSERT ON %I.%I TO newhope_runtime',s,r.relname);
        ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I.%I TO newhope_runtime',s,r.relname); END IF;
        IF r.relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=r.oid AND polname='newhope_server_runtime') THEN
          EXECUTE format('CREATE POLICY newhope_server_runtime ON %I.%I TO newhope_runtime USING(true) WITH CHECK(true)',s,r.relname);
        END IF;
      END IF;
    END LOOP;
    -- Reviewed repo RPC/trigger dependencies. No grants to platform extensions.
    FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=s AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO newhope_runtime',r.signature);
    END LOOP;
  END LOOP;
  GRANT USAGE ON SCHEMA newhope_auth TO newhope_auth_runtime;
  FOREACH s IN ARRAY ARRAY['user','account','session','verification','twoFactor','rateLimit','mfa_session_proofs'] LOOP
    IF to_regclass(format('newhope_auth.%I',s)) IS NULL THEN RAISE EXCEPTION 'AUTH_OPERATIONAL_TABLE_MISSING:%',s; END IF;
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON newhope_auth.%I TO newhope_auth_runtime',s);
    IF EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(format('newhope_auth.%I',s)) AND relrowsecurity)
      AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=to_regclass(format('newhope_auth.%I',s)) AND polname='newhope_native_auth') THEN
      EXECUTE format('CREATE POLICY newhope_native_auth ON newhope_auth.%I TO newhope_auth_runtime USING(true) WITH CHECK(true)',s);
    END IF;
  END LOOP;
  -- Owner email/reset lookup needs verified canonical bindings, not financial
  -- tables. Only existing SELECT dependencies enter the auth pool.
  GRANT USAGE ON SCHEMA internal TO newhope_auth_runtime;
  GRANT SELECT ON internal.auth_identity_bindings,internal.users TO newhope_auth_runtime;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='internal.auth_identity_bindings'::regclass AND polname='newhope_auth_binding_read') THEN
    CREATE POLICY newhope_auth_binding_read ON internal.auth_identity_bindings FOR SELECT TO newhope_auth_runtime USING(true);
  END IF;
  -- Identity binding rechecks native verified users through the separate auth
  -- pool. Application role receives no newhope_auth schema/table privileges.
END $$;
-- No default grants for future objects: schema changes must update/reapply
-- this reviewed inventory and rerun negative tests before runtime deployment.
ALTER ROLE newhope_runtime SET statement_timeout='8s';
ALTER ROLE newhope_auth_runtime SET statement_timeout='8s';

