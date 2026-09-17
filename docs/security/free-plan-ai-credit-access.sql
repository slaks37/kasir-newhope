-- AI credits are server-owned. Browser clients use the authenticated assistant
-- endpoint, which enforces subscription entitlements before charging credits.
BEGIN;
SET lock_timeout='5s';
SET statement_timeout='30s';
REVOKE ALL ON TABLE ai.merchant_ai_credits FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(uuid) FROM PUBLIC;
DO $$ DECLARE target_role text; BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE ai.merchant_ai_credits FROM %I',target_role);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(uuid) FROM %I',target_role);
    END IF;
  END LOOP;
  FOREACH target_role IN ARRAY ARRAY['service_role','svc_ai'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.consume_ai_credit(uuid) TO %I',target_role);
    END IF;
  END LOOP;
END $$;
COMMIT;
