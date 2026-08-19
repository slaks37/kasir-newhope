-- =============================================================================
-- 0014_plan_entitlements.sql
--
-- Menjadikan `billing.plans` sumber kebenaran untuk HARGA, AKSES, dan BENEFIT.
--
-- MASALAH YANG DISELESAIKAN. Sampai sekarang angka paket hidup di tiga tempat
-- yang tidak pernah sepakat: kartu harga di landing page, konstanta SAAS_PLANS
-- di billing-service, dan DEFAULT_PLANS di api/v1/subscription/plans.ts.
-- Tabel `plans` sendiri hanya menyimpan nama dan harga — batas produk, kuota
-- AI, jumlah outlet, dan level dashboard tidak ada kolomnya sama sekali.
--
-- Akibatnya bukan sekadar tidak rapi: tidak ada satu pun tempat yang bisa
-- ditanya "paket ini sebenarnya dapat apa", jadi tidak ada yang bisa
-- menegakkannya. Angka di kartu harga tinggal janji.
--
-- Sesudah migrasi ini, mengubah harga atau batas paket adalah satu UPDATE di
-- satu baris — dan seluruh sistem, termasuk aplikasi kasir, mengikutinya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0014_plan_entitlements.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KOLOM ENTITLEMENT --------------------------------------------------------
--
-- Konvensi -1 = tanpa batas, mengikuti `SaaSPlan.productLimit` di src/types.ts.
-- NULL akan lebih rapi secara teori, tapi setiap pembanding lalu harus menulis
-- `IS NULL OR <=`, dan satu saja yang lupa berarti paket berbayar diam-diam
-- kehilangan batasnya.

ALTER TABLE billing.plans
    ADD COLUMN IF NOT EXISTS product_limit          INT           NOT NULL DEFAULT -1,
    ADD COLUMN IF NOT EXISTS max_outlets            INT           NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS ai_quota_monthly       INT           NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dashboard_access_level VARCHAR(16)   NOT NULL DEFAULT 'BASIC',
    ADD COLUMN IF NOT EXISTS extra_outlet_price_idr NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS price_yearly_idr       NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS module_access          TEXT[]        NOT NULL
        DEFAULT ARRAY['home','overview','pos','customers']::TEXT[],
    ADD COLUMN IF NOT EXISTS sort_order             INT           NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_by             VARCHAR(160);

COMMENT ON COLUMN billing.plans.product_limit IS
    'Maksimum produk per outlet. -1 = tanpa batas. 0 tidak diizinkan — paket yang tidak boleh punya produk sama sekali bukan paket POS.';
COMMENT ON COLUMN billing.plans.module_access IS
    'Modul aplikasi yang DIBUKA paket ini, memakai kosakata PermissionFeature di src/types.ts. Akses efektif seorang staf = irisan dengan izin perannya: paket menentukan apa yang dibeli merchant, peran menentukan siapa boleh memakainya.';
COMMENT ON COLUMN billing.plans.updated_by IS
    'Email admin internal yang terakhir mengubah baris ini. Pertanyaan "siapa yang menurunkan harga paket Pro" harus bisa dijawab tanpa membuka log server.';


-- 2. BATASAN YANG MENJAGA LAYAR ADMIN -----------------------------------------
--
-- Panel admin mengirim angka yang diketik manusia. Validasi di formulir bisa
-- dilewati siapa pun yang memanggil endpointnya langsung, jadi aturannya
-- ditegakkan di sini — satu-satunya tempat yang tidak bisa dilewati.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_product_limit') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_product_limit
            CHECK (product_limit = -1 OR product_limit > 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_max_outlets') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_max_outlets
            CHECK (max_outlets >= 1);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_ai_quota') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_ai_quota
            CHECK (ai_quota_monthly >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_dashboard_level') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_dashboard_level
            CHECK (dashboard_access_level IN ('BASIC', 'FULL', 'ADVANCED'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_price_not_negative') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_price_not_negative
            CHECK (price_idr >= 0
                   AND (price_yearly_idr       IS NULL OR price_yearly_idr       >= 0)
                   AND (extra_outlet_price_idr IS NULL OR extra_outlet_price_idr >= 0));
    END IF;

    -- Salah ketik satu nama modul akan diam-diam mencabut akses seluruh
    -- merchant di paket itu. Lebih baik ditolak saat disimpan.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_module_access') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_module_access
            CHECK (module_access <@ ARRAY[
                'home','overview','pos','tables','inventory','customers','reports',
                'ai','settings','void_order','stock_adjustment','user_management',
                'billing_subscription'
            ]::TEXT[]);
    END IF;
END $$;


-- 3. RIWAYAT PERUBAHAN PAKET --------------------------------------------------
--
-- `internal_access_log` mencatat SIAPA membuka apa, tapi tidak menyimpan nilai
-- sebelum dan sesudah. Untuk harga, justru itu yang dibutuhkan: enam bulan lagi
-- pertanyaannya bukan "siapa membuka halaman paket" melainkan "kenapa merchant
-- ini ditagih 99rb padahal daftarnya 149rb".
--
-- Baris lama TIDAK ikut terhapus saat paketnya dihapus. Riwayat harga adalah
-- catatan keuangan; ia harus bertahan melampaui paket yang mencatatkannya.

CREATE TABLE IF NOT EXISTS billing.plan_change_log (
    id          UUID PRIMARY KEY DEFAULT uuidv7(),
    plan_id     VARCHAR(64) NOT NULL,
    changed_by  VARCHAR(160) NOT NULL,
    change_kind VARCHAR(16)  NOT NULL DEFAULT 'UPDATE'
                CHECK (change_kind IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'ACTIVATE')),
    before_json JSONB,
    after_json  JSONB NOT NULL,
    changed_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plan_change_log_plan
    ON billing.plan_change_log (plan_id, changed_at DESC);

COMMENT ON TABLE billing.plan_change_log IS
    'Riwayat harga dan entitlement paket. Sengaja tanpa foreign key ke plans: catatan keuangan harus bertahan setelah paketnya dihapus.';


-- 4. KATALOG AWAL -------------------------------------------------------------
--
-- Angka diambil dari SAAS_PLANS di services/billing/index.ts — katalog yang
-- paling mutakhir saat migrasi ini ditulis, dan yang sama dengan kartu harga di
-- landing page.
--
-- DO UPDATE hanya mengisi kolom entitlement, TIDAK menyentuh harga dan nama.
-- Kalau admin sudah menurunkan harga lewat panel, migrasi yang dijalankan ulang
-- tidak boleh diam-diam mengembalikannya ke daftar.

INSERT INTO billing.plans
    (id, name, tier_level, billing_cycle, price_idr, price_yearly_idr, currency,
     features, is_active, product_limit, max_outlets, ai_quota_monthly,
     dashboard_access_level, extra_outlet_price_idr, module_access, sort_order)
VALUES
    ('plan-free', 'Free Tier', 1, 'MONTHLY', 0, NULL, 'IDR',
     '["Basic POS & Transaksi","Ringkasan Penjualan Harian","1 Outlet / Cabang Toko","Maksimal 30 Produk","AI Analyst (3x / bulan)"]'::jsonb,
     TRUE, 30, 1, 3, 'BASIC', NULL,
     ARRAY['home','overview','pos','customers','ai','settings']::TEXT[], 1),

    ('plan-plus-monthly', 'Tier Plus', 2, 'MONTHLY', 99000, 79000, 'IDR',
     '["Full POS & Transaksi Kasir","Manajemen Inventori Dasar","Laporan & Dashboard Analytics","Maksimal 100 Produk per Outlet","Up to 2 Outlet Terdaftar","AI Analyst (30x / bulan)"]'::jsonb,
     TRUE, 100, 2, 30, 'FULL', 59000,
     ARRAY['home','overview','pos','tables','inventory','customers','reports','ai','settings','void_order','billing_subscription']::TEXT[], 2),

    ('plan-pro-monthly', 'Tier Pro', 3, 'MONTHLY', 299000, 239000, 'IDR',
     '["Full POS & Transaksi Lanjutan","Manajemen Stok Lanjut & Bahan Baku","Multi-Outlet Analytics & Laporan Lengkap","Produk Tidak Terbatas (Unlimited)","Up to 4 Outlet Terdaftar","AI Analyst (90x / bulan)"]'::jsonb,
     TRUE, -1, 4, 90, 'ADVANCED', 49000,
     ARRAY['home','overview','pos','tables','inventory','customers','reports','ai','settings','void_order','stock_adjustment','user_management','billing_subscription']::TEXT[], 3)
ON CONFLICT (id) DO UPDATE SET
    product_limit          = EXCLUDED.product_limit,
    max_outlets            = EXCLUDED.max_outlets,
    ai_quota_monthly       = EXCLUDED.ai_quota_monthly,
    dashboard_access_level = EXCLUDED.dashboard_access_level,
    module_access          = EXCLUDED.module_access,
    sort_order             = EXCLUDED.sort_order
WHERE billing.plans.updated_by IS NULL;


-- 5. PERMUKAAN BACA ANTAR-SERVICE ---------------------------------------------
--
-- Aplikasi kasir dan ai-service perlu tahu isi paket, tapi tidak boleh membaca
-- skema `billing` langsung — batas yang sama seperti seluruh view kontrak lain.

DROP VIEW IF EXISTS contract.plan_catalog CASCADE;
CREATE VIEW contract.plan_catalog AS
SELECT
    p.id,
    p.name,
    p.tier_level,
    p.billing_cycle,
    p.price_idr,
    p.price_yearly_idr,
    p.currency,
    p.features,
    p.product_limit,
    p.max_outlets,
    p.ai_quota_monthly,
    p.dashboard_access_level,
    p.extra_outlet_price_idr,
    p.module_access,
    p.is_active,
    p.sort_order
  FROM billing.plans p
 ORDER BY p.sort_order, p.tier_level;

COMMENT ON VIEW contract.plan_catalog IS
    'Katalog paket beserta entitlementnya. Satu-satunya sumber yang boleh dibaca lintas service — kartu harga, halaman langganan, dan penegakan batas semuanya membacanya dari sini.';


-- 6. HAK AKSES ----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_billing') THEN
        GRANT ALL ON billing.plan_change_log TO svc_billing;
    END IF;

    -- backoffice-service yang menjalankan panel admin; ia perlu menulis paket
    -- dan riwayatnya, tapi TIDAK diberi akses ke langganan dan faktur merchant.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT USAGE ON SCHEMA billing TO svc_internal;
        GRANT SELECT, INSERT, UPDATE ON billing.plans TO svc_internal;
        GRANT SELECT, INSERT ON billing.plan_change_log TO svc_internal;
    END IF;

    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.plan_catalog TO %I', svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.plan_catalog TO bi_readonly;
    END IF;
END $$;
