-- Applies only to newhope_growth_preview, never the business source database.
DO $$ BEGIN IF current_database()<>'newhope_growth_preview' THEN RAISE EXCEPTION 'PREVIEW_DATABASE_REQUIRED'; END IF; END $$;
GRANT SELECT ON public.blog_posts TO newhope_growth_preview_runtime;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='internal' AND tablename='internal_users' AND policyname='growth_preview_memberships') THEN
  CREATE POLICY growth_preview_memberships ON internal.internal_users FOR SELECT TO newhope_growth_preview_runtime USING(is_active AND role IN ('ROLE_SUPERADMIN','ROLE_INTERNAL_GROWTH'));
 END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='internal' AND tablename='internal_access_log' AND policyname='growth_preview_audit') THEN
  CREATE POLICY growth_preview_audit ON internal.internal_access_log FOR INSERT TO newhope_growth_preview_runtime WITH CHECK(internal_role IN ('ROLE_SUPERADMIN','ROLE_INTERNAL_GROWTH') AND EXISTS(SELECT 1 FROM internal.internal_users u WHERE u.id=internal_user_id AND u.is_active));
 END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='billing' AND tablename='plans' AND policyname='growth_preview_catalog_select') THEN
  CREATE POLICY growth_preview_catalog_select ON billing.plans FOR SELECT TO newhope_growth_preview_runtime USING(true);
  CREATE POLICY growth_preview_catalog_insert ON billing.plans FOR INSERT TO newhope_growth_preview_runtime WITH CHECK(true);
  CREATE POLICY growth_preview_catalog_update ON billing.plans FOR UPDATE TO newhope_growth_preview_runtime USING(true) WITH CHECK(true);
 END IF;
 IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='blog_posts' AND policyname='growth_preview_editorial_read') THEN
  CREATE POLICY growth_preview_editorial_read ON public.blog_posts FOR SELECT TO newhope_growth_preview_runtime USING(true);
 END IF;
END $$;
REVOKE UPDATE ON growth.audit FROM newhope_growth_preview_runtime;
