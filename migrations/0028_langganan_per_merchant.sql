-- =============================================================================
-- 0028_langganan_per_merchant.sql
--
-- Langganan pindah dari Business ke MERCHANT, dan analitik dipisah menjadi
-- global vs per-sektor.
--
-- MASALAH 1: SATU PEMILIK MEMBAYAR DUA KALI.
--
-- billing.subscriptions dikunci UNIQUE(business_id) — satu langganan per unit
-- usaha. Sejak 0025 ada lapisan Merchant di atasnya, dan pemilik yang punya
-- kafe DAN laundry karena itu menanggung DUA langganan untuk satu bisnis yang
-- sama. Batas outletnya pun terpisah: 2 outlet di kafe dan 2 di laundry,
-- padahal yang dia beli satu paket.
--
-- Itu bukan model yang lazim untuk SaaS POS. Yang lazim:
--
--     Merchant -> Subscription -> Plan
--     Merchant -> Business -> Outlet
--
-- Seluruh business dan outlet berada di bawah satu langganan.
--
-- MASALAH 2: ALGORITMA YANG TIDAK COCOK UNTUK SEKTORNYA.
--
-- LAYOUT_UTILISATION menghitung perputaran meja/bay/kursi. Itu berarti untuk
-- kafe, laundry, dan barbershop — dan tidak berarti apa-apa untuk toko
-- kelontong yang tidak punya meja. Menjalankannya untuk semua sektor
-- menghasilkan insight kosong yang menempati ruang di layar dan membuat
-- merchant belajar mengabaikan kartu insight.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0028_langganan_per_merchant.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. LANGGANAN MENUNJUK MERCHANT ----------------------------------------------

ALTER TABLE billing.subscriptions
    ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES pos.merchants(id) ON DELETE CASCADE;

-- Dijalankan hanya selama kolom lamanya masih ada. Bagian 4 membuangnya, jadi
-- pada pengulangan kedua backfill ini sudah tidak punya sumber — dan tidak
-- perlu, karena semuanya sudah terisi.
DO $backfill$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'billing' AND table_name = 'subscriptions'
           AND column_name = 'business_id'
    ) THEN
        UPDATE billing.subscriptions s
           SET merchant_id = b.merchant_id
          FROM pos.businesses b
         WHERE b.id = s.business_id
           AND s.merchant_id IS DISTINCT FROM b.merchant_id;
    END IF;
END $backfill$;

-- Pemilik dengan beberapa usaha bisa terlanjur punya beberapa langganan.
-- Yang dipertahankan adalah yang paketnya PALING TINGGI — menurunkan orang ke
-- paket termurah karena kebetulan itu yang tersimpan belakangan adalah cara
-- kehilangan pelanggan.
DELETE FROM billing.subscriptions s
 WHERE s.merchant_id IS NOT NULL
   AND s.id <> (
       SELECT s2.id FROM billing.subscriptions s2
         JOIN billing.plans p ON p.id = s2.plan_id
        WHERE s2.merchant_id = s.merchant_id
        ORDER BY p.tier_level DESC, s2.created_at DESC
        LIMIT 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_merchant
    ON billing.subscriptions (merchant_id)
 WHERE merchant_id IS NOT NULL;

COMMENT ON COLUMN billing.subscriptions.merchant_id IS
    'Pemilik yang berlangganan. SATU langganan menanggung SELURUH business dan outlet miliknya.';


-- 2. ENTITLEMENT MENGIKUTI MERCHANT -------------------------------------------
--
-- Dibangun ulang supaya tiap business menemukan langganan lewat merchantnya,
-- bukan lewat baris langganannya sendiri yang mungkin sudah tidak ada.

DROP VIEW IF EXISTS contract.merchant_entitlements CASCADE;
CREATE VIEW contract.merchant_entitlements AS
WITH efektif AS (
    SELECT b.id                       AS business_id,
           b.merchant_id,
           s.plan_id,
           s.current_period_end,
           CASE
               WHEN s.status = 'CANCELED' THEN 'CANCELED'
               WHEN s.current_period_end IS NULL THEN s.status::text
               WHEN CURRENT_TIMESTAMP <= s.current_period_end THEN s.status::text
               WHEN CURRENT_TIMESTAMP <= s.current_period_end + INTERVAL '3 days' THEN 'PAST_DUE'
               ELSE 'EXPIRED'
           END AS status_efektif
      FROM pos.businesses b
      LEFT JOIN billing.subscriptions s ON s.merchant_id = b.merchant_id
)
SELECT e.business_id,
       e.merchant_id,
       COALESCE(e.plan_id, 'plan-free')                       AS plan_id,
       COALESCE(p.name, f.name)                               AS plan_name,
       COALESCE(p.tier_level, f.tier_level)                    AS tier_level,
       COALESCE(e.status_efektif, 'NONE')                      AS status,
       e.current_period_end,
       (COALESCE(e.status_efektif, 'NONE') IN ('ACTIVE', 'TRIAL', 'PAST_DUE')) AS berlaku,
       -- Kuota AI hangus saat langganan mati, tapi TIDAK saat masa tenggang:
       -- merchant yang terlambat bayar sehari belum kehilangan haknya.
       CASE WHEN COALESCE(e.status_efektif, 'NONE') IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
            THEN COALESCE(p.ai_quota_monthly, 0) ELSE 0 END    AS ai_quota_effective,
       COALESCE(p.ai_quota_monthly, f.ai_quota_monthly)        AS ai_quota_plan,
       CASE WHEN COALESCE(e.status_efektif, 'NONE') IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
            THEN COALESCE(p.product_limit, f.product_limit) ELSE f.product_limit END AS product_limit,
       CASE WHEN COALESCE(e.status_efektif, 'NONE') IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
            THEN COALESCE(p.max_outlets, f.max_outlets) ELSE f.max_outlets END       AS max_outlets,
       CASE WHEN COALESCE(e.status_efektif, 'NONE') IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
            THEN COALESCE(p.dashboard_access_level, f.dashboard_access_level)
            ELSE f.dashboard_access_level END                  AS dashboard_access_level,
       CASE WHEN COALESCE(e.status_efektif, 'NONE') IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
            THEN COALESCE(p.module_access, f.module_access)
            ELSE f.module_access END                           AS module_access,

       -- YANG TERTULIS DI PAKET, untuk ditampilkan saat mengajak memperpanjang:
       -- "paket Anda 5 outlet, aktifkan kembali untuk memakainya". Dibaca oleh
       -- layar langganan; menghilangkannya membuat layar itu gagal memuat.
       COALESCE(p.product_limit, f.product_limit)              AS product_limit_plan,
       COALESCE(p.max_outlets, f.max_outlets)                  AS max_outlets_plan,
       COALESCE(p.dashboard_access_level, f.dashboard_access_level)
                                                               AS dashboard_access_level_plan,
       COALESCE(p.module_access, f.module_access)              AS module_access_plan
  FROM efektif e
  LEFT JOIN billing.plans p ON p.id = e.plan_id
  CROSS JOIN LATERAL (SELECT * FROM billing.plans WHERE id = 'plan-free') f;

COMMENT ON VIEW contract.merchant_entitlements IS
    'Entitlement yang BERLAKU per business, diturunkan dari langganan MERCHANT-nya. Satu langganan menanggung seluruh business milik pemilik yang sama.';


-- 3. ALGORITMA GLOBAL vs PER-SEKTOR -------------------------------------------
--
-- Daftar ini yang menentukan algoritma mana dijalankan untuk sektor mana.
-- Disimpan sebagai tabel, bukan ditulis di kode batch: menambah sektor baru
-- atau memindahkan sebuah algoritma tidak boleh menuntut deploy ulang.

CREATE TABLE IF NOT EXISTS ai.algorithm_scope (
    category    VARCHAR(40) PRIMARY KEY,
    -- NULL = berlaku untuk SEMUA sektor.
    sectors     TEXT[],
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    -- Sudah ditulis di batch, atau baru dideklarasikan?
    implemented BOOLEAN NOT NULL DEFAULT FALSE,
    note        TEXT
);

INSERT INTO ai.algorithm_scope (category, sectors, implemented, note) VALUES
    ('INVENTORY_ALERT',        NULL, TRUE,
     'Global. Semua sektor punya sesuatu yang bisa habis.'),
    ('CROSS_SELL_OPPORTUNITY', NULL, TRUE,
     'Global. Analisis keranjang berlaku di mana pun ada lebih dari satu item per struk.'),
    ('CRM_CHURN',              NULL, TRUE,
     'Global. Semua sektor punya pelanggan berulang.'),
    ('FINANCIAL_PERFORMANCE',  NULL, TRUE,
     'Global. Omzet dan margin dibanding periode sebelumnya yang sama panjang.'),
    ('OPERATIONAL_PEAK',       NULL, TRUE,
     'Global. Jam tersibuk, dihitung per hari buka.'),
    ('CALENDAR_BEHAVIOR',      NULL, TRUE,
     'Global. Hari terbaik dan terburuk dalam seminggu.'),
    ('SHIFT_PERFORMANCE',      ARRAY['FNB','RETAIL','CARWASH'], TRUE,
     'Butuh shift bergantian. Barbershop dan laundry kecil sering satu orang sepanjang hari.'),
    ('LAYOUT_UTILISATION',     ARRAY['FNB','LAUNDRY','BARBERSHOP'], TRUE,
     'Tekanan tempat, didekati dari pesanan dilayani di tempat. Meja belum jadi entitas, jadi perputaran meja yang sesungguhnya belum bisa dihitung.'),
    ('STAFF_BEHAVIOUR',        ARRAY['FNB','RETAIL','BARBERSHOP'], TRUE,
     'Butuh minimal dua staf dengan cukup struk untuk dibandingkan.')
ON CONFLICT (category) DO UPDATE SET
    sectors = EXCLUDED.sectors,
    implemented = EXCLUDED.implemented,
    note = EXCLUDED.note;

COMMENT ON TABLE ai.algorithm_scope IS
    'Algoritma mana berlaku untuk sektor mana, dan mana yang benar-benar sudah ditulis. implemented=false berarti kategorinya dideklarasikan tapi batch belum menghasilkannya.';

DROP VIEW IF EXISTS contract.algorithm_coverage CASCADE;
CREATE VIEW contract.algorithm_coverage AS
SELECT b.id                                  AS business_id,
       b.business_sector,
       a.category,
       a.implemented,
       (a.sectors IS NULL OR b.business_sector = ANY(a.sectors)) AS berlaku_untuk_sektor
  FROM pos.businesses b
 CROSS JOIN ai.algorithm_scope a
 WHERE a.is_active;

COMMENT ON VIEW contract.algorithm_coverage IS
    'Menjawab dengan jujur: insight apa yang SEHARUSNYA muncul untuk sebuah merchant, dan mana yang belum ditulis.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT ON ai.algorithm_scope, contract.algorithm_coverage TO svc_ai;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.algorithm_coverage TO svc_backoffice;
    END IF;
END $$;


-- 4. business_id DIBUANG DARI LANGGANAN ---------------------------------------
--
-- Selama kolomnya masih ada — apalagi dengan UNIQUE(business_id) — model
-- lamanya masih bisa dipakai tanpa disadari. Satu INSERT yang lupa mengisi
-- merchant_id menghasilkan langganan kedua yang tidak terlihat oleh
-- contract.merchant_entitlements, dan merchant yang baru membayar tetap
-- terkunci. Menghapus kolomnya membuat jalan itu tidak ada lagi.
--
-- Yang hilang tidak ada: siapa yang membayar = merchant, dan apa yang ditagih
-- per unit usaha tetap tercatat di billing.invoices.business_id.

-- Baris tanpa merchant tidak bisa dipakai model baru dan tidak bisa dibaca
-- entitlement mana pun. Tidak seharusnya ada (FK ke businesses + backfill di
-- atas), tapi kalau ada, ia hanya akan menghalangi NOT NULL.
DELETE FROM billing.subscriptions WHERE merchant_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'billing' AND table_name = 'subscriptions'
           AND column_name = 'business_id'
    ) THEN
        -- Dibangun ulang lebih dulu: view ini membaca s.business_id.
        DROP VIEW IF EXISTS contract.subscription_status CASCADE;
        ALTER TABLE billing.subscriptions DROP COLUMN business_id CASCADE;
    END IF;
END $$;

ALTER TABLE billing.subscriptions ALTER COLUMN merchant_id SET NOT NULL;

-- Indeks parsial di bagian 1 dinaikkan menjadi CONSTRAINT penuh: merchant_id
-- sudah NOT NULL, jadi klausa WHERE-nya tidak berguna lagi, dan ON CONFLICT
-- (merchant_id) hanya mau memakai indeks unik tanpa predikat.
--
-- Constraint memiliki indeks bernama sama, jadi DROP INDEX ditolak setelah
-- pengulangan pertama. Constraint dibuang lebih dulu; kalau yang ada masih
-- indeks lepas, DROP INDEX-lah yang mengurusnya.
ALTER TABLE billing.subscriptions
    DROP CONSTRAINT IF EXISTS uq_subscriptions_merchant;
DROP INDEX IF EXISTS billing.uq_subscriptions_merchant;
ALTER TABLE billing.subscriptions
    ADD CONSTRAINT uq_subscriptions_merchant UNIQUE (merchant_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_merchant_status
    ON billing.subscriptions (merchant_id, status);

-- Dilaporkan per BUSINESS supaya laporan pendapatan lama tetap bisa dibaca,
-- tapi MRR-nya tidak digandakan: pemilik dengan tiga unit usaha membayar satu
-- langganan, jadi hanya SATU barisnya yang membawa nominal.
DROP VIEW IF EXISTS contract.subscription_status CASCADE;
CREATE VIEW contract.subscription_status AS
SELECT b.id                AS business_id,
       s.merchant_id,
       s.status,
       s.current_period_end,
       p.id                AS plan_code,
       p.name              AS plan_name,
       (b.id = (SELECT b2.id FROM pos.businesses b2
                 WHERE b2.merchant_id = s.merchant_id
                 ORDER BY b2.created_at, b2.id LIMIT 1)) AS unit_penagihan,
       CASE WHEN b.id = (SELECT b2.id FROM pos.businesses b2
                          WHERE b2.merchant_id = s.merchant_id
                          ORDER BY b2.created_at, b2.id LIMIT 1)
            THEN p.price_idr ELSE 0::numeric END         AS contract_mrr_idr,
       CASE WHEN s.status = 'ACTIVE'
             AND b.id = (SELECT b2.id FROM pos.businesses b2
                          WHERE b2.merchant_id = s.merchant_id
                          ORDER BY b2.created_at, b2.id LIMIT 1)
            THEN p.price_idr ELSE 0::numeric END         AS recognised_mrr_idr
  FROM billing.subscriptions s
  JOIN billing.plans p ON p.id = s.plan_id
  JOIN pos.businesses b ON b.merchant_id = s.merchant_id;

COMMENT ON VIEW contract.subscription_status IS
    'Langganan per business. MRR hanya dihitung sekali per merchant (unit_penagihan = true) — satu pemilik dengan beberapa unit usaha membayar satu kali.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.subscription_status TO svc_backoffice;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_billing') THEN
        GRANT SELECT ON contract.subscription_status TO svc_billing;
    END IF;
END $$;


-- 5. TRIAL OTOMATIS MENGIKUTI MERCHANT ----------------------------------------
--
-- Trigger dari 0024/0025 menyisipkan langganan dengan business_id. Kolom itu
-- baru saja dibuang, jadi tanpa penulisan ulang di sini SETIAP pendaftaran
-- merchant baru akan gagal — dan gagalnya di trigger, artinya INSERT ke
-- pos.businesses ikut dibatalkan. Orang tidak akan bisa mendaftar sama sekali.
--
-- Perubahan perilakunya disengaja: trial diberikan sekali per PEMILIK. Unit
-- usaha kedua milik orang yang sama masuk ke langganan yang sudah ada, bukan
-- memulai masa percobaan baru — kalau tidak, trial 45 hari bisa diperpanjang
-- tanpa batas hanya dengan membuat unit usaha baru.

CREATE OR REPLACE FUNCTION billing.beri_trial_merchant_baru()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    paket RECORD;
BEGIN
    IF NEW.merchant_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT id, trial_days INTO paket
      FROM billing.plans
     WHERE trial_days > 0 AND is_active
     ORDER BY tier_level
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    INSERT INTO billing.subscriptions
        (id, merchant_id, plan_id, status, current_period_start, current_period_end)
    VALUES
        (uuidv7(), NEW.merchant_id, paket.id, 'TRIAL',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + (paket.trial_days || ' days')::interval)
    ON CONFLICT (merchant_id) DO NOTHING;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION billing.beri_trial_merchant_baru() IS
    'Memberi masa percobaan sekali per MERCHANT. Unit usaha kedua milik pemilik yang sama ikut langganan yang ada, bukan memulai trial baru.';

-- Trigger merchant (0025) berjalan BEFORE INSERT dan mengisi NEW.merchant_id;
-- trigger ini AFTER INSERT, jadi kolom itu pasti sudah terisi saat dibaca.
DROP TRIGGER IF EXISTS trg_trial_merchant_baru ON pos.businesses;
CREATE TRIGGER trg_trial_merchant_baru
    AFTER INSERT ON pos.businesses
    FOR EACH ROW
    EXECUTE FUNCTION billing.beri_trial_merchant_baru();

-- Pemilik yang sudah ada tapi belum punya langganan sama sekali.
INSERT INTO billing.subscriptions
    (id, merchant_id, plan_id, status, current_period_start, current_period_end)
SELECT uuidv7(), m.id, p.id, 'TRIAL',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + (p.trial_days || ' days')::interval
  FROM pos.merchants m
 CROSS JOIN LATERAL (
     SELECT id, trial_days FROM billing.plans
      WHERE trial_days > 0 AND is_active ORDER BY tier_level LIMIT 1
 ) p
 WHERE NOT EXISTS (SELECT 1 FROM billing.subscriptions s WHERE s.merchant_id = m.id)
ON CONFLICT (merchant_id) DO NOTHING;


-- 6. KUOTA OUTLET DIHITUNG SEMERCHANT -----------------------------------------
--
-- DUA HAL SEKALIGUS DI SINI.
--
-- Pertama, perbaikan: DROP ... CASCADE pada contract.merchant_entitlements di
-- bagian 2 ikut menjatuhkan view ini, dan view inilah yang dibaca penegakan
-- batas outlet di jalur sinkron cabang. Tanpa dibangun kembali, endpoint itu
-- gagal total dan TIDAK SATU PUN cabang bisa disimpan. Pola yang sama pernah
-- terjadi di 0023 dan tercatat di sana; kali ini ketahuan karena view kontrak
-- yang membacanya hilang dari daftar.
--
-- Kedua, perubahan yang memang dimaksud: outlet dihitung untuk SELURUH unit
-- usaha milik merchant, bukan per unit usaha. Kalau tidak, "Pro = 5 outlet"
-- bisa dilipatgandakan hanya dengan membuka unit usaha kedua — pemilik dengan
-- kafe dan laundry akan mendapat 10 outlet dari satu langganan.
--
-- Bentuk kolomnya sengaja dipertahankan (business_id, max_outlets,
-- outlet_aktif, sisa_kuota) supaya pemanggilnya tidak perlu berubah; yang
-- berubah hanya cakupan hitungannya.

DROP VIEW IF EXISTS contract.merchant_outlet_usage CASCADE;
CREATE VIEW contract.merchant_outlet_usage AS
WITH per_merchant AS (
    SELECT b.merchant_id,
           COUNT(o.id) FILTER (WHERE o.is_active)::int AS outlet_aktif
      FROM pos.businesses b
      LEFT JOIN pos.outlets o ON o.business_id = b.id
     GROUP BY b.merchant_id
)
SELECT b.id                                   AS business_id,
       b.merchant_id,
       COALESCE(e.max_outlets, 1)             AS max_outlets,
       COALESCE(pm.outlet_aktif, 0)           AS outlet_aktif,
       GREATEST(COALESCE(e.max_outlets, 1) - COALESCE(pm.outlet_aktif, 0), 0) AS sisa_kuota
  FROM pos.businesses b
  LEFT JOIN contract.merchant_entitlements e ON e.business_id = b.id
  LEFT JOIN per_merchant pm                  ON pm.merchant_id = b.merchant_id;

COMMENT ON VIEW contract.merchant_outlet_usage IS
    'Pemakaian outlet terhadap batas yang BERLAKU. Dihitung untuk SELURUH unit usaha milik merchant yang sama — satu langganan, satu jatah outlet. Tanpa langganan, batasnya 1.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT ON contract.merchant_entitlements, contract.merchant_outlet_usage TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT ON contract.merchant_entitlements TO svc_ai;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.merchant_entitlements, contract.merchant_outlet_usage TO svc_backoffice;
    END IF;
END $$;
