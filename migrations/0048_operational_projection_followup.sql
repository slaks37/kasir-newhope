-- Prepare before deploying the customer projection handler; retain old arbiter.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_merchant_ref ON pos.customers(tenant_id,merchant_id,external_ref);
-- Wrong sector mode is a structural mismatch, never inferred from business names.
UPDATE pos.shared_state_records r SET recovery_value=COALESCE(r.recovery_value,r.value),value=null,deleted=true,
  quarantine_reason='WRONG_STORE_MODE',revision=revision+1,updated_at=now()
WHERE NOT deleted AND kind='store_settings' AND scope<>'GLOBAL' AND value->>'storeMode' IS NOT NULL
  AND value->>'storeMode'<>CASE WHEN scope='FNB' THEN 'FNB' WHEN scope='RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END;
