-- =============================================================================
-- 0023_entitlement_kedaluwarsa.sql
--
-- Menurunkan entitlement merchant yang langganannya mati ke tingkat Free.
--
-- KEADAAN SEBELUM INI, dan bagaimana ketahuannya. Sebuah merchant paket Pro
-- yang periodenya lewat 30 hari — jauh di luar masa tenggang — diuji lewat
-- /api/v1/subscription/status. Yang kembali:
--
--     status efektif : EXPIRED
--     isActive       : false
--     batas produk   : -1  (tanpa batas)
--     batas outlet   : 5
--     dashboard      : ADVANCED
--     modul          : 13 modul terbuka
--
-- Statusnya benar, tapi tidak ada satu pun batas yang ikut turun. Hal yang
-- sama berlaku di contract.merchant_entitlements, yang dibaca penegakan sisi
-- server: hanya ai_quota_effective yang menjadi nol, sementara product_limit,
-- max_outlets, dashboard_access_level, dan module_access diteruskan apa adanya
-- dari paket. Merchant yang berhenti membayar tetap memegang seluruh isi paket
-- termahal.
--
-- YANG DITURUNKAN, DAN KE MANA. Ke tingkat Free, bukan ke nol. Paket Free ada
-- justru untuk keadaan ini; mengunci total berarti Free tidak berarti apa-apa,
-- dan sebuah aplikasi kasir yang mati di tengah pelayanan adalah kerugian yang
-- jauh melampaui tagihan yang belum dibayar.
--
-- MASA TENGGANG TIDAK IKUT TURUN. PAST_DUE adalah merchant yang terlambat, bukan
-- merchant yang berhenti — dan menghukum keterlambatan tiga hari dengan
-- mencabut outletnya akan mematikan toko yang sebenarnya berniat membayar.
--
-- Nilai paketnya tetap dibawa terpisah (kolom *_plan) supaya layar langganan
-- bisa berkata "paket Anda 5 outlet, aktifkan kembali untuk memakainya".
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0023_entitlement_kedaluwarsa.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DROP VIEW IF EXISTS contract.merchant_entitlements CASCADE;

CREATE VIEW contract.merchant_entitlements AS
WITH efektif AS (
    SELECT
        s.tenant_id,
        s.plan_id,
        s.current_period_end,
        CASE
            WHEN s.status = 'CANCELED' THEN 'CANCELED'
            WHEN CURRENT_TIMESTAMP <= s.current_period_end THEN s.status::text
            WHEN CURRENT_TIMESTAMP <= s.current_period_end + INTERVAL '3 days' THEN 'PAST_DUE'
            ELSE 'EXPIRED'
        END AS status_efektif,
        ROW_NUMBER() OVER (PARTITION BY s.tenant_id ORDER BY s.created_at DESC) AS urutan
      FROM billing.subscriptions s
),
-- Tingkat dasar diambil dari baris Free yang sesungguhnya, bukan dari angka
-- yang ditulis ulang di sini. Admin yang menaikkan batas Free menaikkan pula
-- apa yang didapat merchant kedaluwarsa — itu memang satu keputusan yang sama.
dasar AS (
    SELECT product_limit, max_outlets, dashboard_access_level, module_access
      FROM billing.plans WHERE id = 'plan-free'
)
SELECT
    e.tenant_id                AS merchant_id,
    e.plan_id,
    p.name                     AS plan_name,
    p.tier_level,
    e.status_efektif           AS status,
    e.current_period_end,
    (e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')) AS berlaku,

    -- YANG BERLAKU SEKARANG.
    CASE WHEN e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
         THEN p.ai_quota_monthly ELSE 0 END                    AS ai_quota_effective,
    CASE WHEN e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
         THEN p.product_limit ELSE d.product_limit END         AS product_limit,
    CASE WHEN e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
         THEN p.max_outlets ELSE d.max_outlets END             AS max_outlets,
    CASE WHEN e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
         THEN p.dashboard_access_level
         ELSE d.dashboard_access_level END                     AS dashboard_access_level,
    CASE WHEN e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
         THEN p.module_access ELSE d.module_access END         AS module_access,

    -- YANG TERTULIS DI PAKET, untuk ditampilkan saat mengajak memperpanjang.
    p.ai_quota_monthly         AS ai_quota_plan,
    p.product_limit            AS product_limit_plan,
    p.max_outlets              AS max_outlets_plan,
    p.dashboard_access_level   AS dashboard_access_level_plan,
    p.module_access            AS module_access_plan
  FROM efektif e
  JOIN billing.plans p ON p.id = e.plan_id
  CROSS JOIN dasar d
 WHERE e.urutan = 1;

COMMENT ON VIEW contract.merchant_entitlements IS
    'Entitlement yang BERLAKU sekarang. Langganan mati turun ke tingkat Free, bukan ke nol — paket Free ada justru untuk keadaan ini. Masa tenggang TIDAK diturunkan. Nilai paket dibawa terpisah sebagai *_plan.';

-- BANGUN ULANG VIEW YANG BERGANTUNG PADANYA.
--
-- DROP ... CASCADE di atas ikut menjatuhkan contract.merchant_outlet_usage —
-- dan itulah view yang dibaca penegakan batas outlet di jalur sinkron cabang.
-- Tanpa membangunnya kembali, endpoint itu gagal total dan tidak ada satu pun
-- cabang yang bisa disimpan. Ketahuan karena jumlah view kontrak turun dari 22
-- ke 21 setelah migrasi ini dijalankan.
--
-- Sekarang ia otomatis ikut menurun saat langganan mati, karena max_outlets
-- yang dibacanya sudah yang berlaku.

DROP VIEW IF EXISTS contract.merchant_outlet_usage CASCADE;
CREATE VIEW contract.merchant_outlet_usage AS
SELECT t.id                                             AS merchant_id,
       COALESCE(e.max_outlets, 1)                       AS max_outlets,
       COUNT(b.id) FILTER (WHERE b.is_active)::int      AS outlet_aktif,
       GREATEST(
           COALESCE(e.max_outlets, 1)
           - COUNT(b.id) FILTER (WHERE b.is_active)::int,
           0
       )                                                AS sisa_kuota
  FROM pos.tenants t
  LEFT JOIN contract.merchant_entitlements e ON e.merchant_id = t.id
  LEFT JOIN pos.branches b                   ON b.tenant_id  = t.id
 GROUP BY t.id, e.max_outlets;

COMMENT ON VIEW contract.merchant_outlet_usage IS
    'Pemakaian outlet terhadap batas yang BERLAKU. Tanpa langganan, batasnya 1. Langganan mati ikut turun ke batas Free.';


DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT ON contract.merchant_entitlements TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT ON contract.merchant_entitlements TO svc_ai;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.merchant_entitlements TO svc_backoffice;
        GRANT SELECT ON contract.merchant_outlet_usage TO svc_backoffice;
    END IF;
END $$;
