BEGIN;
CREATE TABLE ai.provider_consent_events(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
 actor_ref text NOT NULL,notice_version text NOT NULL,purpose text NOT NULL CHECK(purpose='BUSINESS_ANALYSIS'),
 providers text[] NOT NULL CHECK(providers=ARRAY['Agnes AI','DeepSeek']::text[]),granted boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_consent_latest ON ai.provider_consent_events(merchant_id,actor_ref,created_at DESC,id DESC);
ALTER TABLE ai.provider_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai.provider_consent_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON ai.provider_consent_events TO svc_ai;
CREATE POLICY provider_consent_ai_scope ON ai.provider_consent_events TO svc_ai USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
GRANT ALL ON ai.provider_consent_events TO service_role;
CREATE FUNCTION ai.consent_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'AI_CONSENT_EVIDENCE_IMMUTABLE';END $$;
REVOKE ALL ON FUNCTION ai.consent_evidence_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ai_consent_immutable BEFORE UPDATE OR DELETE ON ai.provider_consent_events FOR EACH ROW EXECUTE FUNCTION ai.consent_evidence_immutable();
CREATE TRIGGER ai_consent_truncate_immutable BEFORE TRUNCATE ON ai.provider_consent_events FOR EACH STATEMENT EXECUTE FUNCTION ai.consent_evidence_immutable();
ALTER TABLE ai.ai_query_logs ADD COLUMN IF NOT EXISTS provider text;
COMMIT;
