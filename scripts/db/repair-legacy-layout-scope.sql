-- Idempotent, operational-only repair of legacy preset provenance. Never move
-- rows to another merchant, seed replacements, or modify ledger/outbox data.
-- Run in a transaction. The existing recovery_value keeps the original JSON;
-- the original row/ID remain as a revisioned tombstone for old device ACKs.
WITH provenance AS (
  SELECT r.tenant_id,r.scope,r.kind,r.record_id,
    CASE substring(r.record_id from '^(?:cat|tbl)-(fnb|ld|rt|cw|bb)-')
      WHEN 'fnb' THEN 'FNB' WHEN 'ld' THEN 'LAUNDRY' WHEN 'rt' THEN 'RETAIL'
      WHEN 'cw' THEN 'CARWASH' WHEN 'bb' THEN 'BARBERSHOP' END AS origin_sector,
    m.business_sector
  FROM pos.shared_state_records r
  JOIN internal.merchants m ON m.id=r.merchant_id AND m.tenant_id=r.tenant_id
  WHERE NOT r.deleted AND
    ((r.kind='categories' AND r.record_id ~ '^cat-(fnb|ld|rt|cw|bb)-[0-9]+$') OR
     (r.kind='tables' AND r.record_id ~ '^tbl-(ld|rt|cw|bb)-[md]?[0-9]+$'))
)
UPDATE pos.shared_state_records r
SET recovery_value=COALESCE(r.recovery_value,r.value),value=NULL,deleted=true,
  quarantine_reason='WRONG_SECTOR:'||p.origin_sector,
  revision=r.revision+1,updated_at=now()
FROM provenance p
WHERE p.origin_sector IS NOT NULL AND p.origin_sector<>p.business_sector AND
  (r.tenant_id,r.scope,r.kind,r.record_id)=(p.tenant_id,p.scope,p.kind,p.record_id)
RETURNING r.tenant_id,r.merchant_id,r.kind,r.record_id,r.revision,r.recovery_value IS NOT NULL AS backed_up;
