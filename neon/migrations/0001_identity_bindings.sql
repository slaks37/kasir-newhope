-- NEON PILOT ONLY. Additive; no tenant, ledger or Supabase auth row rewrites.
CREATE TABLE internal.auth_identity_bindings (
 provider text NOT NULL CHECK(provider IN('supabase','neon')),
 issuer text NOT NULL, provider_subject text NOT NULL,
 canonical_user_id uuid NOT NULL REFERENCES internal.users(id),
 is_active boolean NOT NULL DEFAULT true,
 verification_ref text NOT NULL CHECK(length(verification_ref)>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,issuer,provider_subject),
 UNIQUE(provider,issuer,canonical_user_id)
);
ALTER TABLE internal.auth_identity_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.auth_identity_bindings FROM PUBLIC,anon,authenticated;
-- No browser Data API; bootstrap owner is the pilot runtime. Role separation
-- and explicit verified binding import are production cutover gates.
