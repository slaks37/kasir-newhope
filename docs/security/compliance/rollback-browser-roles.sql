-- RUN ONLY AFTER OWNER APPROVAL: this deliberately restores the vulnerable
-- pre-migration browser permissions. Prefer a targeted compatibility grant.
BEGIN;
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM internal.security_acl_rollback WHERE remediation='browser-role-20261012') THEN
    RAISE EXCEPTION 'No rollback snapshot; do not invent grants';
  END IF;
  -- Reverse order removes temporary service EXECUTE grants, then restores PUBLIC.
  FOR r IN SELECT statement FROM internal.security_acl_rollback
    WHERE remediation='browser-role-20261012' ORDER BY sequence DESC
  LOOP EXECUTE r.statement; END LOOP;
  DELETE FROM internal.security_acl_rollback WHERE remediation='browser-role-20261012';
END $$;
COMMIT;
