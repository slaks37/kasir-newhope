-- =============================================================================
-- 0047_activity_log_business_id.sql
--
-- Memperbaiki halaman Jejak Aktivitas di konsol back-office, yang GAGAL TOTAL.
--
-- CACATNYA. `GET /api/admin/activity` menjawab 500 dengan
-- `column a.business_id does not exist`. Kueri di src/server/repo.ts memilih
-- dua kolom yang tidak ada di `contract.activity_log`:
--
--   a.business_id     tidak ada di view MAUPUN di tabel dasarnya
--   a.transaction_id  sama
--
-- Akibatnya seluruh halaman Activity kosong — bukan sebagian, bukan kadang.
-- Tidak ada uji yang menangkapnya karena tidak ada satu pun yang memanggil
-- endpoint admin.
--
-- KENAPA business_id DITAMBAHKAN, BUKAN DIHAPUS DARI KUERI.
--
-- Layar Activity menampilkannya (src/admin/pages/Activity.tsx), dan ia memang
-- informasi yang berguna: satu pemilik bisa menjalankan beberapa unit usaha,
-- dan "merchant" saja tidak membedakan kafe dari laundrynya.
--
-- Nilainya sudah ada, hanya belum dipaparkan: `internal.tenants.external_ref`
-- ADALAH business_id (`usr-budi_FNB`) — itu definisi yang dipakai di seluruh
-- sistem, dari kunci partisi klien sampai endpoint sinkronisasi.
--
-- `transaction_id` TIDAK ditambahkan, karena ia memang tidak pernah dicatat:
-- `internal.audit_logs` tidak punya kolomnya, dan `detail` juga tidak
-- memuatnya. Memaparkan kolom yang selalu NULL hanya memindahkan
-- kebingungannya ke layar. Ia dihapus dari kuerinya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0047_activity_log_business_id.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DROP VIEW IF EXISTS contract.activity_log CASCADE;

CREATE VIEW contract.activity_log AS
SELECT
    a.id,
    a.tenant_id,
    a.merchant_id,
    COALESCE(m.name, t.name, 'Unknown Merchant'::varchar) AS merchant_name,
    m.business_sector,
    -- Kunci partisi unit usaha (`${userId}_${SEKTOR}`). Satu pemilik bisa
    -- menjalankan beberapa unit usaha, dan merchant saja tidak membedakannya.
    t.external_ref                                        AS business_id,
    a.outlet_id,
    a.domain                                              AS app_module,
    a.event_type,
    a.severity,
    a.actor_name,
    a.actor_role,
    a.amount_idr,
    a.summary,
    a.detail,
    a.occurred_at
  FROM internal.audit_logs a
  LEFT JOIN internal.merchants m ON m.id = a.merchant_id
  LEFT JOIN internal.tenants   t ON t.id = a.tenant_id;

COMMENT ON VIEW contract.activity_log IS
    'Jejak aktivitas operasional. business_id diturunkan dari '
    'internal.tenants.external_ref — lihat migrasi 0047.';

DO $$
DECLARE svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_billing','svc_ai','svc_internal','bi_readonly'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.activity_log TO %I', svc);
        END IF;
    END LOOP;
END $$;
