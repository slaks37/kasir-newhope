-- Existing Neon deployments may have an identity registry from before 0069.
-- Keep its provider rows intact and require manifest evidence for Better Auth.
ALTER TABLE internal.auth_identity_bindings
  ADD COLUMN IF NOT EXISTS manifest_digest text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'internal.auth_identity_bindings'::regclass
      AND conname = 'auth_identity_bindings_better_auth_manifest_check'
  ) THEN
    ALTER TABLE internal.auth_identity_bindings
      ADD CONSTRAINT auth_identity_bindings_better_auth_manifest_check
      CHECK (
        (manifest_digest IS NULL OR manifest_digest ~ '^[a-f0-9]{64}$')
        AND (provider <> 'better-auth' OR manifest_digest IS NOT NULL)
      );
  END IF;
END
$$;
