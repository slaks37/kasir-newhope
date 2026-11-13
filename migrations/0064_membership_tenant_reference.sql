-- Repair a verified legacy FK: memberships still referenced pos.tenants even
-- after the platform hierarchy moved to internal.tenants (0014/0015/0026).
-- No record IDs or memberships are rewritten. Abort on missing identity proof.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM internal.memberships m LEFT JOIN internal.tenants t ON t.id=m.tenant_id WHERE t.id IS NULL) THEN
    RAISE EXCEPTION 'MEMBERSHIP_TENANT_RECONCILIATION_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='internal.memberships'::regclass
    AND conname='membership_platform_tenant_fk') THEN
    ALTER TABLE internal.memberships ADD CONSTRAINT membership_platform_tenant_fk
      FOREIGN KEY(tenant_id) REFERENCES internal.tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
  ALTER TABLE internal.memberships VALIDATE CONSTRAINT membership_platform_tenant_fk;
  -- New validated FK is present before removing the obsolete constraint.
  ALTER TABLE internal.memberships DROP CONSTRAINT IF EXISTS memberships_tenant_id_fkey;
END $$;
