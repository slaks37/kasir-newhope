-- =============================================================================
-- 0012_customers.sql
--
-- Memindahkan pelanggan dari localStorage ke database.
--
-- KENAPA INI PERLU. Aplikasi kasir sudah menghitung poin, kunjungan, total
-- belanja, dan tier loyalitas sejak lama — semuanya di localStorage, per
-- perangkat. Akibatnya tiga hal yang tidak kelihatan sampai ditanyakan:
--
--   1. Ganti perangkat atau bersihkan browser, riwayat member hilang dan tidak
--      ada salinan di mana pun untuk dipulihkan.
--   2. `transactions` tidak punya customer_id, jadi tidak ada satu pun cara
--      menjawab "siapa yang belum belanja 60 hari terakhir" dari database.
--      Analisis RFM dan churn pelanggan mustahil, bukan sekadar belum dibuat.
--   3. Tier dihitung di browser dari angka yang hanya browser itu yang tahu.
--      Dua perangkat pada toko yang sama bisa memberi tier berbeda untuk orang
--      yang sama, dan keduanya "benar" menurut datanya masing-masing.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0012_customers.sql
--
-- HARUS dijalankan SESUDAH 0009_service_schemas.sql — tabel ini dibuat langsung
-- di skema `pos`, bukan di `public` lalu dipindahkan.
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. TABEL PELANGGAN ----------------------------------------------------------
--
-- external_ref adalah id sisi klien (`cust-...`). Pola yang sama dipakai
-- products dan users di 0006: server tidak pernah menebak identitas dari nama,
-- dan kiriman ulang dari perangkat yang sama selalu mengenai baris yang sama.

CREATE TABLE IF NOT EXISTS pos.customers (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id       UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    external_ref    VARCHAR(96),
    name            VARCHAR(100) NOT NULL,
    phone           VARCHAR(32),
    email           VARCHAR(160),

    -- Angka loyalitas. Tetap dihitung aplikasi kasir supaya kasir offline
    -- tidak kehilangan fungsi; database menyimpan nilai terakhir yang dikirim,
    -- dan itulah yang dibaca laporan serta batch job.
    points          INT           NOT NULL DEFAULT 0 CHECK (points      >= 0),
    total_spent     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    visit_count     INT           NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
    tier            VARCHAR(16)   NOT NULL DEFAULT 'BRONZE'
                    CHECK (tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM')),
    last_visit_at   TIMESTAMP WITH TIME ZONE,

    -- Disalin dari tenant supaya laporan per sektor tidak perlu join, sama
    -- seperti transactions dan products.
    business_sector VARCHAR(16),
    business_id     VARCHAR(96),

    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.customers IS
    'Member toko: poin, tier, dan rekap belanja. Sumber kebenaran pindah dari localStorage ke sini sejak 0012.';
COMMENT ON COLUMN pos.customers.external_ref IS
    'Id pelanggan di sisi aplikasi kasir. Kunci pencocokan saat sinkronisasi — bukan nama, bukan nomor telepon.';
COMMENT ON COLUMN pos.customers.tier IS
    'Disimpan, bukan dihitung ulang saat dibaca. Ambangnya bisa berubah, dan tier yang pernah diberikan ke pelanggan tidak boleh berubah surut karena aturannya diganti.';

-- Satu external_ref hanya boleh menunjuk satu pelanggan per merchant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_ref
    ON pos.customers (tenant_id, external_ref) WHERE external_ref IS NOT NULL;

-- Nomor telepon SENGAJA tidak unik: kartu keluarga, satu nomor dipakai suami
-- dan istri, dan nomor yang salah ketik lalu diperbaiki. Menjadikannya unik
-- akan menolak pendaftaran member yang sah di depan antrian kasir.
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
    ON pos.customers (tenant_id, phone) WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_last_visit
    ON pos.customers (tenant_id, last_visit_at DESC NULLS LAST);


-- 2. TAUTAN KE TRANSAKSI ------------------------------------------------------
--
-- SET NULL, bukan CASCADE — dan di sini alasannya lebih kuat daripada di
-- product_id.
--
-- Pelanggan berhak meminta datanya dihapus. Dengan CASCADE, memenuhi permintaan
-- itu berarti ikut menghapus struk penjualannya: omzet toko berkurang surut,
-- pembukuan tidak lagi cocok dengan kas, dan laporan pajak yang sudah dikirim
-- menjadi salah. Dengan SET NULL, transaksinya tetap utuh sebagai penjualan —
-- hanya identitas pembelinya yang hilang, yang memang itulah yang diminta.
--
-- Karena itu pula nama pelanggan TIDAK ikut disalin ke baris transaksi.
-- Snapshot nama produk dan nama kasir ada supaya riwayat tetap terbaca; nama
-- pembeli justru satu-satunya hal yang harus benar-benar hilang saat dihapus.

ALTER TABLE pos.transactions
    ADD COLUMN IF NOT EXISTS customer_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_customer') THEN
        ALTER TABLE pos.transactions
            ADD CONSTRAINT fk_transactions_customer
            FOREIGN KEY (customer_id) REFERENCES pos.customers(id) ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON COLUMN pos.transactions.customer_id IS
    'NULL berarti pembelian tanpa member — mayoritas transaksi ritel. Bukan penanda data hilang.';

-- Dipakai setiap query RFM: "transaksi milik pelanggan ini, terbaru dulu".
CREATE INDEX IF NOT EXISTS idx_transactions_customer
    ON pos.transactions (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;


-- 3. PERMUKAAN BACA ANTAR-SERVICE ---------------------------------------------
--
-- ai-service dan backoffice-service tidak punya hak baca ke skema `pos`, dan
-- itu memang batas yang dijaga sejak 0009. Supaya analisis RFM tetap bisa
-- dijalankan tanpa membongkar batas itu, agregatnya disajikan sebagai view
-- kontrak — bukan dengan memberi akses tabel.
--
-- Recency dihitung dari transaksi yang benar-benar tercatat, bukan dari
-- customers.last_visit_at. Keduanya bisa berbeda kalau perangkat kasir belum
-- selesai sinkron, dan yang boleh dipakai mengambil keputusan hanyalah yang
-- sudah ada struknya.

DROP VIEW IF EXISTS contract.customer_rfm CASCADE;
CREATE VIEW contract.customer_rfm AS
SELECT
    c.id                                   AS customer_id,
    c.tenant_id                            AS merchant_id,
    c.business_sector,
    c.business_id,
    c.name,
    c.tier,
    c.points,
    c.total_spent                          AS lifetime_spent_reported,
    COALESCE(SUM(x.total_amount), 0)       AS lifetime_spent_recorded,
    COUNT(x.id)                            AS transaction_count,
    COALESCE(AVG(x.total_amount), 0)       AS avg_basket,
    MAX(x.created_at)                      AS last_transaction_at,
    -- NULL untuk pelanggan yang terdaftar tapi belum pernah bertransaksi.
    -- Itu keadaan yang berbeda dari "sudah lama tidak datang", dan menyamakan
    -- keduanya jadi 0 akan menempatkan member baru di daftar churn.
    CASE WHEN MAX(x.created_at) IS NULL THEN NULL
         ELSE (CURRENT_DATE - MAX(x.created_at)::date)
    END                                    AS days_since_last_transaction
  FROM pos.customers c
  LEFT JOIN pos.transactions x
         ON x.customer_id = c.id
        AND x.payment_status <> 'CANCELLED'
 GROUP BY c.id, c.tenant_id, c.business_sector, c.business_id,
          c.name, c.tier, c.points, c.total_spent;

COMMENT ON VIEW contract.customer_rfm IS
    'Recency/Frequency/Monetary per member. lifetime_spent_reported datang dari perangkat kasir; lifetime_spent_recorded dihitung dari struk yang sudah tersinkron — selisihnya adalah antrian yang belum terkirim.';


-- 4. HAK AKSES ----------------------------------------------------------------
--
-- Mengikuti pola 0009/0011: hanya diberikan kalau perannya memang ada, supaya
-- migrasi ini tetap jalan di database pengembangan yang belum punya peran
-- terpisah.

DO $$
DECLARE
    svc TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.customers TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.customer_rfm TO %I', svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.customer_rfm TO bi_readonly;
    END IF;
END $$;
