-- Business data is accessed via the authenticated server API, not browser SQL.
-- Keep RLS enabled and server grants unchanged. No rows or balances are modified.
BEGIN;
SET lock_timeout = '5s';
SET statement_timeout = '30s';
DO $$
DECLARE
  target record;
  browser_role text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('ai', 'ai_query_logs', 'p_ai_query_logs_all'),
    ('ai', 'daily_merchant_insights', 'p_daily_merchant_insights_all'),
    ('ai', 'merchant_ai_credits', 'p_merchant_ai_credits_all'),
    ('billing', 'invoices', 'p_invoices_all'),
    ('billing', 'plans', 'p_plans_all'),
    ('billing', 'subscriptions', 'p_subscriptions_all'),
    ('pos', 'merchant_activity_log', 'p_merchant_activity_log_all'),
    ('pos', 'products', 'p_products_all'),
    ('pos', 'tenants', 'p_tenants_all'),
    ('pos', 'transaction_items', 'p_transaction_items_all'),
    ('pos', 'transactions', 'p_transactions_all'),
    ('pos', 'users', 'p_users_all')
  ) AS targets(schema_name, table_name, policy_name) LOOP
    -- The permissive policies were created only on the hosted database.
    -- Fresh local databases may not have them; never create an allow-all policy.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = target.schema_name
      AND tablename = target.table_name AND policyname = target.policy_name) THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I TO service_role',
        target.policy_name, target.schema_name, target.table_name);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC', target.schema_name, target.table_name);
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM %I',
          target.schema_name, target.table_name, browser_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
