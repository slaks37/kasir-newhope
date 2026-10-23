-- Clean-start only: legacy analytics called a tenant a merchant. Do not guess
-- mappings in a populated database. Refuse orphan relationships explicitly.
DO $$ DECLARE tab text; col text; fk record; orphan boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['merchant_health_logs','feature_usage_events'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM internal.%I x LEFT JOIN internal.merchants m ON m.id=x.merchant_id AND m.tenant_id=x.tenant_id WHERE m.id IS NULL)',tab) INTO orphan;
  IF orphan THEN RAISE EXCEPTION 'CLEAN_RUNTIME_ANALYTICS_OWNERSHIP_REVIEW_REQUIRED'; END IF;
  EXECUTE format('ALTER TABLE internal.%I DROP CONSTRAINT IF EXISTS %I',tab,tab||'_canonical_merchant_tenant');
  FOREACH col IN ARRAY ARRAY['tenant_id','merchant_id'] LOOP
   FOR fk IN SELECT c.conname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.conrelid=format('internal.%I',tab)::regclass AND c.contype='f' AND array_length(c.conkey,1)=1 AND a.attname=col LOOP
     EXECUTE format('ALTER TABLE internal.%I DROP CONSTRAINT %I',tab,fk.conname);
   END LOOP;
  END LOOP;
  EXECUTE format('ALTER TABLE internal.%I ADD CONSTRAINT %I FOREIGN KEY(tenant_id) REFERENCES internal.tenants(id) ON DELETE CASCADE',tab,tab||'_canonical_tenant');
  EXECUTE format('ALTER TABLE internal.%I ADD CONSTRAINT %I FOREIGN KEY(merchant_id,tenant_id) REFERENCES internal.merchants(id,tenant_id) ON DELETE CASCADE',tab,tab||'_canonical_merchant_tenant');
 END LOOP;
END $$;
