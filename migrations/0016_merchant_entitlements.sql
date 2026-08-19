-- =============================================================================
-- 0016_merchant_entitlements.sql
--
-- Satu tempat untuk menjawab "merchant ini sedang berhak atas apa".
--
-- MASALAHNYA. Kuota AI di `services/ai/wallet.ts` adalah konstanta 30 untuk
-- semua orang. Paket Free yang dijual dengan janji 3× sebulan mendapat 30, dan
-- paket Pro yang dijual 90× juga mendapat 30 — jadi merchant yang membayar Rp
-- 299rb menerima kuota yang persis sama dengan yang tidak membayar sama sekali.
--
-- Kolomnya sudah ada sejak 0014. Yang belum ada adalah cara ai-service
-- MEMBACANYA: `svc_ai` sengaja tidak punya hak baca ke skema `billing`, jadi ia
-- tidak bisa menempuh subscriptions -> plans sendiri. View kontrak ini yang
-- menjembataninya, tanpa membongkar batas antar-service.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0016_merchant_entitlements.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. ENTITLEMENT EFEKTIF PER MERCHANT -----------------------------------------
--
-- KEDALUWARSA DIHITUNG, TIDAK DISIMPAN. Aturan yang sama dipakai billing-service
-- dan /api/v1/subscription/status: menyimpannya menuntut cron yang mengubah
-- status tepat waktu, dan cron yang telat semenit berarti merchant kedaluwarsa
-- masih mendapat kuota penuh.
--
-- MASA TENGGANG TETAP MENDAPAT KUOTA. PAST_DUE adalah merchant yang terlambat
-- bayar, bukan yang berhenti berlangganan — mematikan AI-nya di hari pertama
-- keterlambatan adalah cara mengubah keterlambatan menjadi pembatalan.

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
        -- Satu merchant seharusnya punya satu langganan. Kalau ternyata lebih,
        -- yang terbaru yang berlaku — bukan hasil penjumlahan, yang akan
        -- memberi kuota ganda kepada baris duplikat yang justru keliru.
        ROW_NUMBER() OVER (PARTITION BY s.tenant_id ORDER BY s.created_at DESC) AS urutan
      FROM billing.subscriptions s
)
SELECT
    e.tenant_id                AS merchant_id,
    e.plan_id,
    p.name                     AS plan_name,
    p.tier_level,
    e.status_efektif           AS status,
    e.current_period_end,
    (e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')) AS berlaku,
    -- Kuota EFEKTIF: nol begitu langganannya benar-benar mati. Nilai daftar
    -- paketnya tetap dibawa terpisah supaya layar langganan bisa menampilkan
    -- "paket Anda 90×/bulan, aktifkan kembali untuk memakainya".
    CASE WHEN e.status_efektif IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
         THEN p.ai_quota_monthly ELSE 0 END AS ai_quota_effective,
    p.ai_quota_monthly         AS ai_quota_plan,
    p.product_limit,
    p.max_outlets,
    p.dashboard_access_level,
    p.module_access
  FROM efektif e
  JOIN billing.plans p ON p.id = e.plan_id
 WHERE e.urutan = 1;

COMMENT ON VIEW contract.merchant_entitlements IS
    'Hak yang sedang berlaku per merchant, dengan kedaluwarsa dihitung dari current_period_end. Dibaca ai-service untuk menentukan kuota kredit; satu-satunya jalan sah dari sisi AI ke isi paket.';


-- 2. HAK AKSES ----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.merchant_entitlements TO %I', svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.merchant_entitlements TO bi_readonly;
    END IF;
END $$;


-- 3. DOMPET YANG SUDAH TERLANJUR DIBUAT DENGAN 30 ------------------------------
--
-- Baris yang sudah ada memakai monthly_grant = 30 bawaan lama. Yang diperbaiki
-- hanya JATAHNYA; saldo berjalan TIDAK diturunkan.
--
-- Alasannya: kredit yang sudah ada di tangan merchant bisa saja hasil pembelian
-- add-on, dan menurunkannya di tengah periode berarti mengambil sesuatu yang
-- sudah dibayar. Jatah yang lebih kecil berlaku mulai periode berikutnya —
-- itu cukup untuk menghentikan pemberian gratis, tanpa menagih balik.

UPDATE ai.merchant_ai_credits w
   SET monthly_grant = e.ai_quota_effective,
       updated_at    = CURRENT_TIMESTAMP
  FROM contract.merchant_entitlements e
 WHERE e.merchant_id = w.merchant_id
   AND w.monthly_grant <> e.ai_quota_effective;
