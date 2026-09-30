-- Only the trusted billing backend provisions an owner-confirmed business/outlet.
-- Browser roles remain unchanged; ownership is checked by authenticated routes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_billing') THEN
    GRANT INSERT, UPDATE(name) ON internal.tenants TO svc_billing;
    GRANT INSERT, UPDATE(name) ON internal.merchants TO svc_billing;
  END IF;
END $$;
