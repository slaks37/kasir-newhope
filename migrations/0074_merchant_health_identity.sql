-- Match the canonical production Model-B identity contract. No row rewriting:
-- unresolved historical references require explicit reconciliation before DDL.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM internal.merchant_health_logs h
   LEFT JOIN internal.merchants m ON m.id=h.merchant_id AND m.tenant_id=h.tenant_id WHERE m.id IS NULL)
 THEN RAISE EXCEPTION 'MERCHANT_HEALTH_IDENTITY_RECONCILIATION_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='internal.merchant_health_logs'::regclass AND conname='merchant_health_logs_canonical_merchant_tenant') THEN
  ALTER TABLE internal.merchant_health_logs ADD CONSTRAINT merchant_health_logs_canonical_merchant_tenant
   FOREIGN KEY(merchant_id,tenant_id) REFERENCES internal.merchants(id,tenant_id) ON DELETE CASCADE NOT VALID;
 END IF;
 ALTER TABLE internal.merchant_health_logs VALIDATE CONSTRAINT merchant_health_logs_canonical_merchant_tenant;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='internal.merchant_health_logs'::regclass AND conname='merchant_health_logs_canonical_tenant') THEN
  ALTER TABLE internal.merchant_health_logs ADD CONSTRAINT merchant_health_logs_canonical_tenant
   FOREIGN KEY(tenant_id) REFERENCES internal.tenants(id) ON DELETE CASCADE NOT VALID;
 END IF;
 ALTER TABLE internal.merchant_health_logs VALIDATE CONSTRAINT merchant_health_logs_canonical_tenant;
 ALTER TABLE internal.merchant_health_logs DROP CONSTRAINT IF EXISTS fk_merchant_health_logs_merchant_id;
 ALTER TABLE internal.merchant_health_logs DROP CONSTRAINT IF EXISTS fk_merchant_health_logs_tenant_id;
END $$;
