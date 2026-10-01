-- Repair upgrade from the original customer table; preserve every existing row.
ALTER TABLE pos.customers
  ADD COLUMN IF NOT EXISTS external_ref TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS total_spent NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orders_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_ref ON pos.customers(tenant_id,external_ref);
-- No browser access, service role grants or RLS policies are changed.
-- Replay already-acknowledged cloud CRM metadata, never device sales counters.
INSERT INTO pos.customers(tenant_id,merchant_id,external_ref,name,phone,email,address,notes)
SELECT r.tenant_id,r.merchant_id,r.record_id,
       left(trim(r.value->>'name'),120),nullif(left(r.value->>'phone',32),''),
       nullif(left(r.value->>'email',120),''),left(r.value->>'address',255),left(r.value->>'notes',500)
FROM pos.shared_state_records r
JOIN internal.merchants m ON m.id=r.merchant_id AND m.tenant_id=r.tenant_id
WHERE r.kind='customers' AND NOT r.deleted AND jsonb_typeof(r.value)='object'
  AND jsonb_typeof(r.value->'name')='string' AND length(trim(r.value->>'name'))>0
ON CONFLICT(tenant_id,external_ref) DO UPDATE SET
  name=EXCLUDED.name,phone=EXCLUDED.phone,email=EXCLUDED.email,address=EXCLUDED.address,
  notes=EXCLUDED.notes,updated_at=now()
WHERE pos.customers.merchant_id=EXCLUDED.merchant_id;
