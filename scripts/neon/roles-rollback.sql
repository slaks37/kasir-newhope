-- Target Neon only, not Supabase. Stop staging app first. Removes only grants
-- and policy names introduced by 0005; preserves rows, owners, RLS flags and all
-- prior role memberships. Login credentials can be re-bound to prior reviewed
-- runtime config, never the migration-owner connection in production.
DO $$ DECLARE s text;r record; BEGIN
  FOREACH s IN ARRAY ARRAY['pos','internal','billing','ai','public','contract','mcp_private','blog_mcp_private','newhope_auth'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=s) THEN CONTINUE; END IF;
    FOR r IN SELECT c.relname,p.polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=s AND p.polname IN('newhope_server_runtime','newhope_native_auth','newhope_auth_binding_read') LOOP
      EXECUTE format('DROP POLICY %I ON %I.%I',r.polname,s,r.relname);
    END LOOP;
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM newhope_runtime,newhope_auth_runtime',s);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM newhope_runtime,newhope_auth_runtime',s);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM newhope_runtime,newhope_auth_runtime',s);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM newhope_runtime,newhope_auth_runtime,newhope_migrator',s);
  END LOOP;
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM newhope_runtime,newhope_auth_runtime,newhope_migrator',current_database());
END $$;

