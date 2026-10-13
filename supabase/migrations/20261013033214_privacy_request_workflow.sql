BEGIN;
CREATE TABLE internal.privacy_requests(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
 actor_ref text NOT NULL,client_request_id uuid NOT NULL,request_type text NOT NULL CHECK(request_type IN('ACCESS','CORRECTION','DELETION','EXPORT','CONSENT_WITHDRAWAL')),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),status text NOT NULL DEFAULT 'RECEIVED' CHECK(status IN('RECEIVED','IDENTITY_CHECK','LEGAL_HOLD_REVIEW','IN_PROGRESS','COMPLETED','DECLINED')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,actor_ref,client_request_id)
);
CREATE TABLE internal.privacy_request_events(
 id uuid PRIMARY KEY DEFAULT uuidv7(),request_id uuid NOT NULL REFERENCES internal.privacy_requests(id),tenant_id uuid NOT NULL,
 actor_ref text NOT NULL,event text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE internal.legal_notice_acknowledgements(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id uuid NOT NULL REFERENCES internal.tenants(id),actor_ref text NOT NULL,
 terms_version text NOT NULL,privacy_version text NOT NULL,acknowledged_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,actor_ref,terms_version,privacy_version)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['privacy_requests','privacy_request_events','legal_notice_acknowledgements'] LOOP
  EXECUTE format('ALTER TABLE internal.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON internal.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT,INSERT ON internal.%I TO svc_pos',tab);
  EXECUTE format('CREATE POLICY privacy_owner_scope ON internal.%I TO svc_pos USING(tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK(tenant_id::text=current_setting(''app.tenant_id'',true))',tab);
  EXECUTE format('GRANT SELECT,INSERT ON internal.%I TO svc_internal',tab);
  EXECUTE format('CREATE POLICY privacy_support_scope ON internal.%I TO svc_internal USING(true) WITH CHECK(true)',tab);
  EXECUTE format('GRANT ALL ON internal.%I TO service_role',tab);
 END LOOP;
END $$;
GRANT UPDATE ON internal.privacy_requests TO svc_internal;
CREATE FUNCTION internal.privacy_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'PRIVACY_EVIDENCE_IMMUTABLE';END $$;
REVOKE ALL ON FUNCTION internal.privacy_evidence_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_events_immutable BEFORE UPDATE OR DELETE ON internal.privacy_request_events FOR EACH ROW EXECUTE FUNCTION internal.privacy_evidence_immutable();
CREATE TRIGGER privacy_events_truncate_immutable BEFORE TRUNCATE ON internal.privacy_request_events FOR EACH STATEMENT EXECUTE FUNCTION internal.privacy_evidence_immutable();
CREATE TRIGGER notice_ack_immutable BEFORE UPDATE OR DELETE ON internal.legal_notice_acknowledgements FOR EACH ROW EXECUTE FUNCTION internal.privacy_evidence_immutable();
CREATE TRIGGER notice_ack_truncate_immutable BEFORE TRUNCATE ON internal.legal_notice_acknowledgements FOR EACH STATEMENT EXECUTE FUNCTION internal.privacy_evidence_immutable();
COMMIT;
