-- Stop stale deployments from reintroducing incompatible store modes.
UPDATE pos.shared_state_records r SET recovery_value=COALESCE(r.recovery_value,r.value),value=null,deleted=true,
  quarantine_reason='WRONG_STORE_MODE',revision=revision+1,updated_at=now()
WHERE NOT deleted AND kind='store_settings' AND scope<>'GLOBAL' AND value->>'storeMode' IS NOT NULL
  AND value->>'storeMode'<>CASE WHEN scope='FNB' THEN 'FNB' WHEN scope='RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='pos.shared_state_records'::regclass AND conname='shared_settings_sector_mode') THEN
    ALTER TABLE pos.shared_state_records ADD CONSTRAINT shared_settings_sector_mode CHECK (
      kind<>'store_settings' OR deleted OR scope='GLOBAL' OR value->>'storeMode' IS NULL
      OR value->>'storeMode'=CASE WHEN scope='FNB' THEN 'FNB' WHEN scope='RETAIL' THEN 'RETAIL' ELSE 'SERVICE' END
    );
  END IF;
END $$;
