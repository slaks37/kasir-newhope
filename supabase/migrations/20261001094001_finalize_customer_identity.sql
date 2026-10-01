-- Apply after customer projection handler is live; no customer/ledger data changes.
DROP INDEX IF EXISTS pos.uq_customers_tenant_ref;
