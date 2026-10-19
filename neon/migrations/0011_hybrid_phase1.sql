-- Neon business-only staging. No auth-runtime tables or identity mappings.
CREATE TABLE IF NOT EXISTS internal.hybrid_source_accounts(
 source_uuid uuid PRIMARY KEY, source_created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS internal.hybrid_phase1_state(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 source_project text NOT NULL CHECK(source_project='fqxrhumsgigcgjtlbfuo'),
 source_cutover_at timestamptz NOT NULL,
 signup_provisioning_enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE internal.hybrid_source_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.hybrid_phase1_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.hybrid_source_accounts,internal.hybrid_phase1_state FROM PUBLIC,anon,authenticated;
-- Runtime SELECT grants are explicit in the phase1 role runner; it cannot alter
-- this inventory/watermark or enable provisioning. Final state requires an
-- approved frozen source capture and source signup-trigger handoff.
