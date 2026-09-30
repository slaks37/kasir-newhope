-- Shared operational records. Financial transactions remain in the POS ledger.
CREATE TABLE IF NOT EXISTS pos.shared_state_records (
  tenant_id uuid NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES internal.merchants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  kind text NOT NULL,
  record_id text NOT NULL,
  value jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, kind, record_id),
  CONSTRAINT shared_state_scope CHECK (
    (scope = 'GLOBAL' AND merchant_id IS NULL)
    OR (scope IN ('FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP') AND merchant_id IS NOT NULL)
  ),
  CONSTRAINT shared_state_payload CHECK (value IS NULL OR octet_length(value::text) <= 65536)
);

CREATE INDEX IF NOT EXISTS idx_shared_state_merchant
  ON pos.shared_state_records(merchant_id, scope, kind) WHERE NOT deleted;

ALTER TABLE pos.shared_state_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos.shared_state_records FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_pos') THEN
    GRANT SELECT, INSERT, UPDATE ON pos.shared_state_records TO svc_pos;
    CREATE POLICY shared_state_pos_tenant ON pos.shared_state_records
      TO svc_pos
      USING (
        tenant_id::text = current_setting('app.tenant_id', true)
        AND (merchant_id IS NULL OR merchant_id::text = current_setting('app.merchant_id', true))
      )
      WITH CHECK (
        tenant_id::text = current_setting('app.tenant_id', true)
        AND (merchant_id IS NULL OR merchant_id::text = current_setting('app.merchant_id', true))
      );
  END IF;
END $$;
