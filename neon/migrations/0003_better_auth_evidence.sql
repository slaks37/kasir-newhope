CREATE TABLE newhope_auth.mfa_session_proofs (
 session_id text PRIMARY KEY REFERENCES newhope_auth.session(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES newhope_auth."user"(id) ON DELETE CASCADE,
 verified_at timestamptz NOT NULL
);
ALTER TABLE newhope_auth.mfa_session_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA newhope_auth FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA newhope_auth FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA newhope_auth FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA newhope_auth FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA newhope_auth REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA newhope_auth REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated;
