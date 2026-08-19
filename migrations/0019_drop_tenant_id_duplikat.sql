-- =============================================================================
-- 0019_drop_tenant_id_duplikat.sql
--
-- Membuang kolom `tenant_id` yang selama ini hanya menyalin `merchant_id`.
--
-- 0013 memasang CHECK (merchant_id IS NOT DISTINCT FROM tenant_id) sebagai
-- penjaga sementara, dan menyisakan satu pertanyaan produk:
--
--     "Apakah satu akun boleh memiliki BEBERAPA merchant?"
--
-- Jawabannya: BOLEH. Dan ternyata skema ini sudah memodelkannya sejak awal —
-- satu baris `pos.tenants` per unit usaha, dengan `owner_user_ref` sebagai
-- pemiliknya. Pemilik yang punya kafe dan laundry sekarang punya DUA baris
-- tenants dengan owner_user_ref yang sama, dan `business_id` (`userId_sector`)
-- membedakan keduanya. Jadi `pos.tenants` MEMANG tabel merchant itu; tidak ada
-- tabel baru yang perlu dibuat.
--
-- Artinya `merchant_id` dan `tenant_id` benar-benar sinonim selamanya, dan satu
-- di antaranya harus pergi.
--
-- YANG DIBUANG ADALAH `tenant_id`, BUKAN `merchant_id` — kebalikan dari tebakan
-- di catatan 0013. Alasannya baru terlihat setelah ketujuh tabel diperiksa satu
-- per satu: di SEMUA tabel itu, `merchant_id` yang memikul beban.
--
--     ai.merchant_targets        merchant_id PRIMARY KEY
--     ai.merchant_ai_credits     merchant_id PRIMARY KEY
--     ai.daily_merchant_insights UNIQUE (merchant_id, insight_date, category)
--     internal.merchant_health_logs  UNIQUE (merchant_id, log_date)
--     ai.ai_query_logs           idx (merchant_id, asked_at DESC)
--     internal.feature_usage_events  idx (merchant_id, occurred_at DESC)
--     pos.merchant_activity_log  idx (merchant_id, occurred_at DESC)
--
-- `tenant_id` di tabel-tabel ini tidak pernah menjadi kunci apa pun; ia hanya
-- ikut ditulis. Membuang `merchant_id` berarti membongkar setiap primary key,
-- unique constraint, indeks, foreign key, dan fungsi `consume_ai_credit()` —
-- pekerjaan besar yang menghasilkan skema yang persis sama bagusnya. Membuang
-- `tenant_id` tidak menyentuh satu pun indeks.
--
-- Seluruh permukaan baca (`contract.*`) sudah menamainya `merchant_id`, jadi
-- tidak ada satu pun pemanggil di luar yang berubah.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0019_drop_tenant_id_duplikat.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. VIEW YANG IKUT MENAMPILKAN KOLOMNYA -------------------------------------
--
-- Postgres menolak DROP COLUMN selama ada view yang menyebutnya. View di bawah
-- dibangun ulang tanpa `tenant_id`; kolomnya toh selalu berisi nilai yang sama
-- dengan `merchant_id` di sebelahnya, jadi tidak ada informasi yang hilang.

DROP VIEW IF EXISTS contract.merchant_health_latest CASCADE;
DROP VIEW IF EXISTS public.v_merchant_health_latest CASCADE;


-- 2. BUANG KOLOMNYA -----------------------------------------------------------
--
-- CHECK dari 0013 dan foreign key dari 0006 yang menempel pada kolom ini ikut
-- terhapus sendiri bersama kolomnya — itu perilaku DROP COLUMN, bukan kelalaian.
-- Penjagaan 0013 memang sudah tidak diperlukan begitu kolom keduanya tidak ada:
-- satu kolom tidak bisa menyimpang dari dirinya sendiri.

DO $$
DECLARE
    specs TEXT[][] := ARRAY[
        ['ai',       'daily_merchant_insights'],
        ['ai',       'merchant_targets'],
        ['ai',       'merchant_ai_credits'],
        ['ai',       'ai_query_logs'],
        ['internal', 'feature_usage_events'],
        ['internal', 'merchant_health_logs'],
        ['pos',      'merchant_activity_log']
    ];
    s   TEXT[];
    sch TEXT;
    tbl TEXT;
    menyimpang BOOLEAN;
BEGIN
    FOREACH s SLICE 1 IN ARRAY specs LOOP
        sch := s[1]; tbl := s[2];

        CONTINUE WHEN to_regclass(sch || '.' || tbl) IS NULL;

        -- Pemeriksaan terakhir sebelum kolomnya hilang untuk selamanya. Kalau
        -- ternyata ada baris yang MENYIMPANG, migrasi ini berhenti — baris itu
        -- adalah merchant dengan dua identitas, dan membuang kolomnya diam-diam
        -- akan mengubur buktinya. 0013 memasang CHECK-nya sebagai NOT VALID,
        -- jadi baris lama memang belum pernah diperiksa siapa pun.
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = sch AND table_name = tbl AND column_name = 'tenant_id'
        ) THEN
            EXECUTE format(
                'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE merchant_id IS DISTINCT FROM tenant_id)',
                sch, tbl
            ) INTO menyimpang;

            IF menyimpang THEN
                RAISE EXCEPTION
                    '0019: %.% punya baris dengan merchant_id <> tenant_id. Rekonsiliasi dulu sebelum kolomnya dibuang.',
                    sch, tbl;
            END IF;

            EXECUTE format('ALTER TABLE %I.%I DROP COLUMN tenant_id', sch, tbl);
        END IF;
        RAISE NOTICE '0019: %.%.tenant_id dibuang', sch, tbl;
    END LOOP;
END $$;


-- 3. BANGUN ULANG VIEW --------------------------------------------------------

CREATE VIEW contract.merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id, h.log_date, h.daily_revenue,
       h.days_since_last_txn, h.active_days_last_7, h.revenue_trend_pct,
       h.distinct_features_used, h.support_tickets_count,
       h.subscription_status, h.mrr_idr, h.contract_mrr_idr,
       h.churn_risk_score, h.churn_risk_reasons
  FROM internal.merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;

COMMENT ON VIEW contract.merchant_health_latest IS
    'Skor kesehatan terbaru per merchant. `tenant_id` dibuang di 0019 — ia selalu sama dengan merchant_id.';


-- 4. CATATAN PADA KOLOM YANG TERSISA ------------------------------------------
--
-- Komentar dari 0013 yang menjanjikan pembuangan ini diganti dengan yang
-- menyatakan hasilnya.

COMMENT ON COLUMN ai.merchant_ai_credits.merchant_id IS
    'pos.tenants.id. Satu merchant = satu unit usaha; pemilik dengan beberapa usaha punya beberapa baris tenants dengan owner_user_ref yang sama. Kolom tenant_id yang menyalinnya dibuang di 0019.';

COMMENT ON COLUMN pos.merchant_activity_log.merchant_id IS
    'pos.tenants.id. Sinonim tenant_id; kolom duplikatnya dibuang di 0019.';
