-- Additive provider expansion; no identity, tenant or ownership rewrites.
ALTER TABLE internal.auth_identity_bindings
  DROP CONSTRAINT auth_identity_bindings_provider_check;
ALTER TABLE internal.auth_identity_bindings
  ADD CONSTRAINT auth_identity_bindings_provider_check
  CHECK(provider IN('supabase','neon','better-auth'));
-- Rollback only after stopping Better Auth writers and confirming zero active
-- or retained better-auth bindings. Reverting this CHECK with such bindings
-- must fail; never delete bindings to make rollback succeed.
