-- =============================================================================
-- 0022_empat_tier.sql
--
-- Menata ulang katalog menjadi empat tingkatan: Free Trial, Free, Plus, Pro.
--
-- YANG BERUBAH:
--
--   nama    "Free Tier" -> "Free", "Tier Plus" -> "Plus", "Tier Pro" -> "Pro".
--           Kata "Tier" di depan nama tingkatan menjadi mubazir begitu kolomnya
--           sendiri bernama tier_level.
--
--   Pro     4 -> 5 outlet.
--   Plus    tetap 2 outlet.
--
--   baru    plan-free-trial, dan kolom trial_days pada billing.plans.
--
-- ISI FREE TRIAL, dan alasannya.
--
-- Trial diberi entitlement SETARA PLUS, berlaku 14 hari. Dua kemungkinan lain
-- sengaja tidak dipilih:
--
--   - Setara Free. Itu bukan masa percobaan, itu paket Free dengan nama lain;
--     tidak ada yang dicoba dan tidak ada alasan untuk berlangganan sesudahnya.
--
--   - Setara Pro. Menggiurkan, tapi membuat "tingkat yang lebih tinggi tidak
--     pernah memberi lebih sedikit" berhenti berlaku di katalog — trial di
--     urutan bawah memberi lebih banyak daripada Plus di atasnya. Aturan itu
--     yang menjaga panel admin dari membuat paket yang menghukum orang karena
--     meng-upgrade, jadi ia tidak dilanggar demi satu baris.
--
-- Kalau kelak trial memang ingin setara Pro, cukup ubah entitlement-nya di
-- panel admin — tapi ketahuilah bahwa saat itu urutan katalognya tidak lagi
-- monoton, dan tes katalog akan mengatakannya.
--
-- URUTAN tier_level: Free 1, Free Trial 2, Plus 3, Pro 4. Diurut menurut apa
-- yang DIDAPAT, bukan menurut urutan orang menyebutnya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0022_empat_tier.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. BERAPA LAMA MASA PERCOBAAN -----------------------------------------------
--
-- Paket percobaan tanpa durasi tidak berarti apa-apa, dan durasinya harus bisa
-- diubah admin tanpa deploy. 0 = bukan paket percobaan.

ALTER TABLE billing.plans
    ADD COLUMN IF NOT EXISTS trial_days INT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_trial_days') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_trial_days
            CHECK (trial_days >= 0 AND trial_days <= 365);
    END IF;
END $$;

COMMENT ON COLUMN billing.plans.trial_days IS
    'Lama masa percobaan dalam hari. 0 berarti paket biasa. Paket dengan trial_days > 0 tidak boleh berbayar.';

-- Paket percobaan yang berbayar adalah kontradiksi yang hanya akan ketahuan
-- setelah ada yang ditagih.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_plans_trial_gratis') THEN
        ALTER TABLE billing.plans ADD CONSTRAINT ck_plans_trial_gratis
            CHECK (trial_days = 0 OR price_idr = 0);
    END IF;
END $$;


-- 2. TINGKATAN BARU DAN PENAMAAN ----------------------------------------------
--
-- Nama, urutan, dan batas outlet diterapkan TANPA syarat updated_by IS NULL
-- yang dipakai 0014. Ini bukan seed yang tidak boleh menimpa suntingan admin,
-- melainkan penataan katalog yang diminta pemilik sistem. Harga sengaja TIDAK
-- ikut disentuh — itu memang wilayah panel admin.

UPDATE billing.plans SET name = 'Free',  tier_level = 1, sort_order = 1 WHERE id = 'plan-free';
UPDATE billing.plans SET name = 'Plus',  tier_level = 3, sort_order = 3, max_outlets = 2 WHERE id = 'plan-plus-monthly';
UPDATE billing.plans SET name = 'Pro',   tier_level = 4, sort_order = 4, max_outlets = 5 WHERE id = 'plan-pro-monthly';

UPDATE billing.plans
   SET features = '["Full POS & Transaksi Lanjutan","Manajemen Stok Lanjut & Bahan Baku","Multi-Outlet Analytics & Laporan Lengkap","Produk Tidak Terbatas (Unlimited)","Sampai 5 Outlet Terdaftar","AI Analyst (90x / bulan)"]'::jsonb
 WHERE id = 'plan-pro-monthly';


-- 3. PAKET PERCOBAAN ----------------------------------------------------------
--
-- Entitlement-nya sengaja disalin dari Plus dan bukan ditulis ulang sebagai
-- angka baru: dua daftar yang "kebetulan sama" akan berbeda pada suntingan
-- berikutnya, dan trial yang diam-diam lebih kecil dari Plus adalah janji yang
-- tidak ditepati.

INSERT INTO billing.plans
    (id, name, tier_level, billing_cycle, price_idr, price_yearly_idr, currency,
     features, is_active, product_limit, max_outlets, ai_quota_monthly,
     dashboard_access_level, extra_outlet_price_idr, module_access, sort_order, trial_days)
SELECT
    'plan-free-trial', 'Free Trial', 2, 'MONTHLY', 0, NULL, 'IDR',
    '["Coba semua fitur Plus selama 14 hari","Full POS & Transaksi Kasir","Manajemen Inventori Dasar","Laporan & Dashboard Analytics","Maksimal 100 Produk per Outlet","Sampai 2 Outlet Terdaftar","AI Analyst (30x / bulan)","Tanpa kartu kredit"]'::jsonb,
    TRUE, p.product_limit, p.max_outlets, p.ai_quota_monthly,
    p.dashboard_access_level, NULL, p.module_access, 2, 14
  FROM billing.plans p
 WHERE p.id = 'plan-plus-monthly'
ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    tier_level  = EXCLUDED.tier_level,
    sort_order  = EXCLUDED.sort_order,
    trial_days  = EXCLUDED.trial_days;


-- 4. VIEW KONTRAK IKUT MEMBAWA trial_days -------------------------------------

DROP VIEW IF EXISTS contract.plan_catalog CASCADE;
CREATE VIEW contract.plan_catalog AS
SELECT p.id, p.name, p.tier_level, p.billing_cycle, p.price_idr, p.price_yearly_idr,
       p.extra_outlet_price_idr, p.currency, p.features, p.product_limit, p.max_outlets,
       p.ai_quota_monthly, p.dashboard_access_level, p.module_access, p.sort_order,
       p.trial_days, p.is_active
  FROM billing.plans p;

COMMENT ON VIEW contract.plan_catalog IS
    'Katalog paket untuk aplikasi kasir dan ai-service. Hanya baca.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT ON contract.plan_catalog TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT ON contract.plan_catalog TO svc_ai;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.plan_catalog TO svc_backoffice;
    END IF;
END $$;
