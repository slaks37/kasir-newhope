-- Deploy only after the versioned catalog API is live. No table data changes.
DROP INDEX IF EXISTS pos.uq_products_external_ref;
