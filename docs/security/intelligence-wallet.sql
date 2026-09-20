-- Reviewed maintenance SQL: preserve all balances and logs. Transactional,
-- idempotent, fail closed if a legacy row cannot resolve to a canonical tenant.
BEGIN;
ALTER TABLE ai.ai_query_logs ADD COLUMN IF NOT EXISTS business_id text;
CREATE INDEX IF NOT EXISTS ai_query_logs_business_time ON ai.ai_query_logs(merchant_id,business_id,asked_at DESC);
DO $$
DECLARE table_name text; column_name text; fk record; orphan boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['merchant_ai_credits','ai_query_logs'] LOOP
    FOREACH column_name IN ARRAY ARRAY['merchant_id','tenant_id'] LOOP
      EXECUTE format(
        'SELECT EXISTS(SELECT 1 FROM ai.%I w LEFT JOIN internal.tenants t ON t.id=w.%I WHERE w.%I IS NOT NULL AND t.id IS NULL)',
        table_name,column_name,column_name) INTO orphan;
      IF orphan THEN RAISE EXCEPTION 'Unresolved legacy identity in ai.%.%; reconcile before applying',table_name,column_name; END IF;
    END LOOP;
  END LOOP;
  -- Replace only outdated tenant FKs, not arbitrary application constraints.
  FOR fk IN
    SELECT c.conname,c.conrelid::regclass AS relation,a.attname,c.confdeltype
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.contype='f' AND c.confrelid='pos.tenants'::regclass
        AND c.conrelid IN ('ai.merchant_ai_credits'::regclass,'ai.ai_query_logs'::regclass)
        AND array_length(c.conkey,1)=1 AND a.attname IN ('merchant_id','tenant_id')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',fk.relation,fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES internal.tenants(id) ON DELETE %s',
      fk.relation,fk.conname,fk.attname,CASE WHEN fk.confdeltype='c' THEN 'CASCADE' ELSE 'NO ACTION' END);
  END LOOP;
END $$;
COMMIT;
