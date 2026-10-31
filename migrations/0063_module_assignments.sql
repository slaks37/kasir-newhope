-- Additive module control plane. No merchant is activated or entitled here.
-- Rollback: disable NEW_HOPE_MODULE_WORKSPACES and assignments; retain all rows.
CREATE TABLE IF NOT EXISTS internal.module_definitions (
  id text PRIMARY KEY CHECK (id IN ('fnb','retail','laundry','carwash','barber')),
  name text NOT NULL,
  sector text NOT NULL CHECK (sector IN ('FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP'))
);
INSERT INTO internal.module_definitions(id,name,sector) VALUES
 ('fnb','New Hope F&B','FNB'),('retail','New Hope Retail','RETAIL'),
 ('laundry','New Hope Laundry','LAUNDRY'),('carwash','New Hope Carwash','CARWASH'),
 ('barber','New Hope Barbershop','BARBERSHOP') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS internal.merchant_modules (
  tenant_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  module_id text NOT NULL REFERENCES internal.module_definitions(id),
  enabled boolean NOT NULL DEFAULT false,
  guard_legacy_apis boolean NOT NULL DEFAULT false,
  CHECK (NOT enabled OR guard_legacy_apis),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,merchant_id,module_id),
  FOREIGN KEY(merchant_id,tenant_id) REFERENCES internal.merchants(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS internal.outlet_modules (
  tenant_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  module_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,merchant_id,outlet_id,module_id),
  FOREIGN KEY(tenant_id,merchant_id,module_id) REFERENCES internal.merchant_modules(tenant_id,merchant_id,module_id),
  FOREIGN KEY(outlet_id,merchant_id,tenant_id) REFERENCES internal.outlets(id,merchant_id,tenant_id)
);
CREATE TABLE IF NOT EXISTS billing.module_entitlements (
  tenant_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  module_id text NOT NULL REFERENCES internal.module_definitions(id),
  enabled boolean NOT NULL DEFAULT false,
  features text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  grant_reference text NOT NULL CHECK (length(grant_reference) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,merchant_id,module_id),
  FOREIGN KEY(merchant_id,tenant_id) REFERENCES internal.merchants(id,tenant_id)
);
ALTER TABLE internal.module_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.merchant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.outlet_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.module_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.module_definitions,internal.merchant_modules,internal.outlet_modules,billing.module_entitlements FROM PUBLIC,anon,authenticated;
-- Remove broad default service grants: activation and entitlements are separate authorities.
REVOKE ALL ON internal.module_definitions,internal.merchant_modules,internal.outlet_modules FROM svc_ai,svc_billing,svc_pos;
REVOKE ALL ON billing.module_entitlements FROM svc_ai,svc_internal,svc_pos;
GRANT USAGE ON SCHEMA billing TO svc_pos;
GRANT SELECT ON internal.module_definitions,internal.merchant_modules,internal.outlet_modules,billing.module_entitlements TO svc_pos;
DROP POLICY IF EXISTS module_definition_service_read ON internal.module_definitions;
CREATE POLICY module_definition_service_read ON internal.module_definitions FOR SELECT TO svc_pos USING (true);
DROP POLICY IF EXISTS module_definition_admin ON internal.module_definitions;
CREATE POLICY module_definition_admin ON internal.module_definitions TO svc_internal USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS merchant_module_service_read ON internal.merchant_modules;
CREATE POLICY merchant_module_service_read ON internal.merchant_modules FOR SELECT TO svc_pos USING (
 tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true));
DROP POLICY IF EXISTS merchant_module_admin ON internal.merchant_modules;
CREATE POLICY merchant_module_admin ON internal.merchant_modules TO svc_internal USING (
 tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true)) WITH CHECK (
 tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true));
DROP POLICY IF EXISTS outlet_module_service_read ON internal.outlet_modules;
CREATE POLICY outlet_module_service_read ON internal.outlet_modules FOR SELECT TO svc_pos USING (
 tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true));
DROP POLICY IF EXISTS outlet_module_admin ON internal.outlet_modules;
CREATE POLICY outlet_module_admin ON internal.outlet_modules TO svc_internal USING (
 tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true)) WITH CHECK (
 tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true));
DROP POLICY IF EXISTS module_entitlement_service_read ON billing.module_entitlements;
CREATE POLICY module_entitlement_service_read ON billing.module_entitlements FOR SELECT TO svc_pos USING (
 tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true));
DROP POLICY IF EXISTS module_entitlement_billing ON billing.module_entitlements;
CREATE POLICY module_entitlement_billing ON billing.module_entitlements TO svc_billing USING (
 tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
