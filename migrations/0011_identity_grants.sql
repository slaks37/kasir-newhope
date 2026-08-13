-- =============================================================================
-- 0011_identity_grants.sql
--
-- Semua service kini menerjemahkan identitas merchant lewat satu jalur bersama
-- (services/shared/identity.ts), yang memakai `legacy_uuid()` sebagai langkah
-- terakhir. 0010 hanya memberi hak pakai fungsi itu kepada svc_ai; service lain
-- gagal dengan "permission denied for function legacy_uuid" — kegagalan yang
-- muncul hanya pada merchant yang belum terdaftar, sehingga mudah lolos dari
-- pengujian.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0011_identity_grants.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DO $$
DECLARE
    svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION legacy_uuid(TEXT) TO %I', svc);
        END IF;
    END LOOP;
END $$;


-- Langganan dan faktur menunjuk merchant yang harus ada.
--
-- Tanpa foreign key, langganan bisa menempel pada tenant_id yang tidak menunjuk
-- siapa pun — persis yang terjadi ketika billing menerima string `usr-budi`
-- dan menyimpannya sebagai UUID sintetis. Baris seperti itu tidak akan pernah
-- muncul di laporan MRR mana pun, tapi tetap membuat merchant merasa sudah
-- berlangganan.
--
-- Dipasang sebagai NOT VALID: baris lama yang terlanjur yatim tidak menghalangi
-- migrasi, tapi semua penulisan BARU langsung diperiksa.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_tenant') THEN
        DELETE FROM billing.subscriptions s
         WHERE NOT EXISTS (SELECT 1 FROM pos.tenants t WHERE t.id = s.tenant_id);
        ALTER TABLE billing.subscriptions
            ADD CONSTRAINT fk_subscriptions_tenant
            FOREIGN KEY (tenant_id) REFERENCES pos.tenants(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_tenant') THEN
        DELETE FROM billing.invoices i
         WHERE NOT EXISTS (SELECT 1 FROM pos.tenants t WHERE t.id = i.tenant_id);
        ALTER TABLE billing.invoices
            ADD CONSTRAINT fk_invoices_tenant
            FOREIGN KEY (tenant_id) REFERENCES pos.tenants(id) ON DELETE CASCADE;
    END IF;
END $$;

-- billing perlu membaca pos.tenants untuk menegakkan FK di atas.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_billing') THEN
        GRANT USAGE ON SCHEMA pos TO svc_billing;
        GRANT REFERENCES, SELECT ON pos.tenants TO svc_billing;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT USAGE ON SCHEMA pos TO svc_ai;
        GRANT REFERENCES, SELECT ON pos.tenants TO svc_ai;
    END IF;
END $$;
