-- =============================================================================
-- 0006_merchant_activity.sql
--
-- Tiga hal, dalam urutan ini:
--   1. Memasang foreign key yang seharusnya sudah ada sejak 0003/0004.
--   2. Menambahkan klasifikasi SEKTOR BISNIS ke transaksi dan baris penjualan.
--   3. Membuat jejak aktivitas merchant + view yang dibaca admin panel.
--
-- HARUS dijalankan SESUDAH 0005_uuid_keys.sql. 0005 mengubah setiap primary key
-- dan setiap kolom merchant_id/tenant_id menjadi UUID; memasang foreign key
-- sebelum itu akan gagal karena tipenya belum sama.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0006_merchant_activity.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. FOREIGN KEY YANG HILANG --------------------------------------------------
--
-- Komentar di 0003 dan 0004 berargumen memilih VARCHAR justru SUPAYA foreign
-- key ke tenants(id) bisa dipasang — lalu tidak pernah memasangnya. Akibatnya
-- delapan tabel memegang merchant_id/tenant_id yang tidak dijamin siapa pun.
-- Hapus satu tenant, dan insight, saldo kredit AI, serta log health miliknya
-- menjadi baris yatim yang tetap ikut terhitung di query BI.
--
-- Baris yatim yang sudah terlanjur ada dibuang lebih dulu; tanpa itu ADD
-- CONSTRAINT akan ditolak dan seluruh migrasi batal.

DO $$
DECLARE
    -- tabel, kolom, aksi saat tenant induk dihapus
    specs TEXT[][] := ARRAY[
        ['daily_merchant_insights', 'merchant_id', 'CASCADE'],
        ['daily_merchant_insights', 'tenant_id',   'CASCADE'],
        ['merchant_targets',        'merchant_id', 'CASCADE'],
        ['merchant_targets',        'tenant_id',   'CASCADE'],
        ['merchant_ai_credits',     'merchant_id', 'CASCADE'],
        ['merchant_ai_credits',     'tenant_id',   'CASCADE'],
        ['merchant_health_logs',    'merchant_id', 'CASCADE'],
        ['merchant_health_logs',    'tenant_id',   'CASCADE'],
        ['feature_usage_events',    'merchant_id', 'CASCADE'],
        ['feature_usage_events',    'tenant_id',   'CASCADE'],
        ['subscriptions',           'tenant_id',   'CASCADE'],
        ['invoices',                'tenant_id',   'CASCADE'],
        -- Log TIDAK ikut terhapus. Jejak audit dan riwayat biaya harus tetap
        -- ada setelah merchantnya pergi — justru saat itulah biasanya
        -- dibutuhkan. SET NULL, bukan CASCADE.
        ['ai_query_logs',           'merchant_id', 'SET NULL'],
        ['internal_access_log',     'merchant_id', 'SET NULL']
    ];
    s          TEXT[];
    tbl        TEXT;
    col        TEXT;
    act        TEXT;
    fk_name    TEXT;
    orphans    BIGINT;
BEGIN
    FOREACH s SLICE 1 IN ARRAY specs LOOP
        tbl := s[1]; col := s[2]; act := s[3];

        IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;

        fk_name := 'fk_' || tbl || '_' || col;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk_name) THEN CONTINUE; END IF;

        -- SET NULL menuntut kolomnya boleh NULL.
        IF act = 'SET NULL' THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', tbl, col);
        END IF;

        -- Buang yang menunjuk tenant yang tidak ada.
        EXECUTE format(
            'SELECT count(*) FROM %I x WHERE x.%I IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = x.%I)',
            tbl, col, col
        ) INTO orphans;

        IF orphans > 0 THEN
            IF act = 'SET NULL' THEN
                EXECUTE format(
                    'UPDATE %I x SET %I = NULL WHERE x.%I IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = x.%I)',
                    tbl, col, col, col
                );
                RAISE NOTICE '0006: %.% — % baris yatim di-NULL-kan', tbl, col, orphans;
            ELSE
                EXECUTE format(
                    'DELETE FROM %I x WHERE x.%I IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = x.%I)',
                    tbl, col, col
                );
                RAISE NOTICE '0006: %.% — % baris yatim dihapus', tbl, col, orphans;
            END IF;
        END IF;

        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES tenants(id) ON DELETE %s',
            tbl, fk_name, col, act
        );
    END LOOP;
END $$;


-- 1b. FOREIGN KEY RIWAYAT YANG MEMBLOKIR PENGHAPUSAN --------------------------
--
-- Memasang FK di Bagian 1 memunculkan cacat yang selama ini tidak terlihat:
-- satu merchant TIDAK BISA DIHAPUS SAMA SEKALI.
--
-- Rantainya: DELETE tenants -> CASCADE ke products -> ditolak, karena
-- transaction_items.product_id menunjuk products dengan NO ACTION. Hal yang
-- sama terjadi pada transactions.cashier_user_id -> users.
--
-- CASCADE bukan jawabannya: menghapus produk tidak boleh melenyapkan riwayat
-- penjualannya. Jawabannya SET NULL, dan itu memang aman di sini karena baris
-- struk sudah menyimpan salinan sendiri — product_name, unit_price, unit_cost.
-- Riwayat tetap terbaca lengkap setelah katalognya hilang.
--
-- Tanpa bagian ini, permintaan penghapusan data dari merchant tidak bisa
-- dipenuhi tanpa mengetik SQL manual.

DO $$
DECLARE
    specs TEXT[][] := ARRAY[
        ['transaction_items', 'product_id',      'products',    'transaction_items_product_id_fkey'],
        ['transactions',      'cashier_user_id', 'users',       'transactions_cashier_user_id_fkey'],
        ['inventory_logs',    'ingredient_id',   'ingredients', 'inventory_logs_ingredient_id_fkey']
    ];
    s       TEXT[];
    newname TEXT;
BEGIN
    FOREACH s SLICE 1 IN ARRAY specs LOOP
        IF to_regclass('public.' || s[1]) IS NULL THEN CONTINUE; END IF;

        newname := 'fk_' || s[1] || '_' || s[2] || '_hist';
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = newname) THEN CONTINUE; END IF;

        -- Nama constraint bawaan Postgres; buang kalau masih ada.
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = s[4]) THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', s[1], s[4]);
        END IF;

        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', s[1], s[2]);
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL',
            s[1], newname, s[2], s[3]
        );
        RAISE NOTICE '0006: %.% -> ON DELETE SET NULL (riwayat dipertahankan)', s[1], s[2];
    END LOOP;
END $$;


-- 2. KLASIFIKASI SEKTOR BISNIS ------------------------------------------------
--
-- Sektor SUDAH ada di tenants.business_sector, jadi menyalinnya ke transaksi
-- terlihat seperti duplikasi. Bukan, karena dua alasan:
--
--   a. Ini fakta historis. Merchant yang pindah dari LAUNDRY ke FNB tidak
--      mengubah kenyataan bahwa transaksi tahun lalu adalah transaksi laundry.
--      Kalau di-join ke tenants, seluruh riwayat penjualan ikut berubah label.
--   b. Satu akun boleh menjalankan beberapa sektor sekaligus (business_id =
--      `${userId}_${sector}` di TenantContext). Satu baris di tenants tidak
--      bisa menjawab "transaksi ini dari kafe atau dari laundrynya".
--
-- app_module dicatat karena gratis saat menulis. Sektor tetap sumbu utama.

DO $$ BEGIN
    CREATE TYPE business_sector_enum AS ENUM
        ('FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS business_sector VARCHAR(16),
    ADD COLUMN IF NOT EXISTS business_id     VARCHAR(96),
    ADD COLUMN IF NOT EXISTS app_module      VARCHAR(24) NOT NULL DEFAULT 'POS',
    ADD COLUMN IF NOT EXISTS order_type      VARCHAR(16),
    ADD COLUMN IF NOT EXISTS invoice_number  VARCHAR(64);

-- Baris lama: ambil sektor dari tenant pemiliknya. Tebakan terbaik yang ada,
-- dan hanya berlaku sekali karena setelah ini kolomnya selalu diisi penulis.
UPDATE transactions x
   SET business_sector = t.business_sector
  FROM tenants t
 WHERE t.id = x.tenant_id
   AND x.business_sector IS NULL;

UPDATE transactions SET business_sector = 'FNB' WHERE business_sector IS NULL;

ALTER TABLE transactions ALTER COLUMN business_sector SET NOT NULL;

DO $$ BEGIN
    ALTER TABLE transactions ADD CONSTRAINT ck_txn_sector
        CHECK (business_sector IN ('FNB','LAUNDRY','RETAIL','CARWASH','BARBERSHOP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE transactions ADD CONSTRAINT ck_txn_module
        CHECK (app_module IN ('POS','TABLES','INVENTORY','CUSTOMERS','REPORTS','AI','SETTINGS','SYNC'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nomor struk unik per tenant, bukan unik global: dua merchant berbeda boleh
-- sama-sama punya INV-0001.
CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_invoice_per_tenant
    ON transactions (tenant_id, invoice_number)
    WHERE invoice_number IS NOT NULL;

-- Sektor disalin juga ke baris item. Tanpa ini, "produk apa saja yang terjual
-- di laundry" harus menjoin transaction_items -> transactions untuk setiap
-- baris, dan itu query terpanas di admin panel.
ALTER TABLE transaction_items
    ADD COLUMN IF NOT EXISTS business_sector VARCHAR(16),
    ADD COLUMN IF NOT EXISTS category_name   VARCHAR(100),
    ADD COLUMN IF NOT EXISTS unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0;

UPDATE transaction_items i
   SET business_sector = x.business_sector
  FROM transactions x
 WHERE x.id = i.transaction_id
   AND i.business_sector IS NULL;

UPDATE transaction_items SET business_sector = 'FNB' WHERE business_sector IS NULL;
ALTER TABLE transaction_items ALTER COLUMN business_sector SET NOT NULL;

DO $$ BEGIN
    ALTER TABLE transaction_items ADD CONSTRAINT ck_item_sector
        CHECK (business_sector IN ('FNB','LAUNDRY','RETAIL','CARWASH','BARBERSHOP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Produk juga: katalog laundry dan katalog kafe tidak boleh tercampur di
-- laporan, persis seperti daftar petugas.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS business_sector VARCHAR(16),
    ADD COLUMN IF NOT EXISTS business_id     VARCHAR(96),
    ADD COLUMN IF NOT EXISTS category_name   VARCHAR(100);

UPDATE products p
   SET business_sector = t.business_sector
  FROM tenants t
 WHERE t.id = p.tenant_id AND p.business_sector IS NULL;
UPDATE products SET business_sector = 'FNB' WHERE business_sector IS NULL;

CREATE INDEX IF NOT EXISTS idx_txn_sector_time
    ON transactions (business_sector, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_tenant_sector_time
    ON transactions (tenant_id, business_sector, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_business_time
    ON transactions (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_sector_product
    ON transaction_items (business_sector, product_id);


-- 3. JEJAK AKTIVITAS MERCHANT -------------------------------------------------
--
-- "Log transaksi seluruhnya" lebih luas daripada tabel transactions. Stok
-- disesuaikan, harga diubah, shift dibuka, kasir gagal login, diskon
-- di-override — semuanya kejadian yang perlu terlihat di admin panel, dan tidak
-- satu pun berupa penjualan.
--
-- Append-only. Tidak pernah di-UPDATE, tidak pernah di-DELETE.

CREATE TABLE IF NOT EXISTS merchant_activity_log (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Sumbu klasifikasi utama.
    business_sector  VARCHAR(16) NOT NULL,
    -- Partition key TenantContext: `${userId}_${sector}`. Membedakan kafe dan
    -- laundry milik pemilik yang sama.
    business_id      VARCHAR(96),
    app_module       VARCHAR(24) NOT NULL,

    event_type       VARCHAR(48) NOT NULL,   -- SALE, STOCK_ADJUST, PRICE_CHANGE, ...
    severity         VARCHAR(12) NOT NULL DEFAULT 'INFO',

    actor_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name       VARCHAR(100),           -- snapshot; staf bisa dihapus
    actor_role       VARCHAR(24),

    -- Diisi kalau kejadiannya memang sebuah penjualan.
    transaction_id   UUID REFERENCES transactions(id) ON DELETE SET NULL,
    amount_idr       NUMERIC(15,2),

    summary          VARCHAR(240) NOT NULL,
    detail           JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
    ALTER TABLE merchant_activity_log ADD CONSTRAINT ck_activity_sector
        CHECK (business_sector IN ('FNB','LAUNDRY','RETAIL','CARWASH','BARBERSHOP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE merchant_activity_log ADD CONSTRAINT ck_activity_severity
        CHECK (severity IN ('INFO','NOTICE','WARNING','CRITICAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE merchant_activity_log ADD CONSTRAINT ck_activity_module
        CHECK (app_module IN ('POS','TABLES','INVENTORY','CUSTOMERS','REPORTS','AI','SETTINGS','SYNC','AUTH'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_activity_merchant_time
    ON merchant_activity_log (merchant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_sector_time
    ON merchant_activity_log (business_sector, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_type_time
    ON merchant_activity_log (event_type, occurred_at DESC);
-- Peringatan dan kejadian kritis jauh lebih jarang daripada INFO; index parsial
-- menjaga "tampilkan masalah saja" tetap murah.
CREATE INDEX IF NOT EXISTS idx_activity_problems
    ON merchant_activity_log (occurred_at DESC)
    WHERE severity IN ('WARNING', 'CRITICAL');
CREATE INDEX IF NOT EXISTS idx_activity_detail
    ON merchant_activity_log USING GIN (detail);

COMMENT ON TABLE merchant_activity_log IS
    'Jejak append-only setiap kejadian penting di sisi merchant, diklasifikasikan per sektor bisnis. Jangan pernah UPDATE atau DELETE.';


-- 3b. PEMETAAN ID KLIEN -------------------------------------------------------
--
-- Aplikasi kasir sudah punya id sendiri di localStorage sejak sebelum ada
-- database. Id itu tidak boleh menjadi primary key di sini (lihat 0005), tapi
-- harus tetap bisa dicari — kalau tidak, setiap sinkronisasi akan membuat
-- merchant, staf, dan produk BARU untuk data yang sama.
--
-- external_ref adalah id sisi klien. UNIQUE-nya per tenant, kecuali pada
-- tenants sendiri yang memakai business_id (`${userId}_${sector}`) dan memang
-- unik secara global.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS external_ref   VARCHAR(96),
    ADD COLUMN IF NOT EXISTS owner_user_ref VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_external_ref
    ON tenants (external_ref) WHERE external_ref IS NOT NULL;

ALTER TABLE users    ADD COLUMN IF NOT EXISTS external_ref VARCHAR(96);
ALTER TABLE products ADD COLUMN IF NOT EXISTS external_ref VARCHAR(96);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_external_ref
    ON users (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_external_ref
    ON products (tenant_id, external_ref) WHERE external_ref IS NOT NULL;

-- Id transaksi versi klien. Inilah yang membuat pengiriman ulang antrian
-- offline tidak menggandakan omzet: percobaan kedua menabrak index ini dan
-- dilewati, bukan disisipkan lagi.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_txn_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_client_id
    ON transactions (tenant_id, client_txn_id) WHERE client_txn_id IS NOT NULL;


-- 4. IDEMPOTENSI SINKRONISASI OFFLINE ----------------------------------------
--
-- Kasir offline mengirim ulang antrian transaksinya saat internet kembali, dan
-- pengiriman ulang itu bisa terjadi berkali-kali. Tanpa kunci idempotensi,
-- omzet satu hari bisa terhitung dua atau tiga kali lipat.

CREATE TABLE IF NOT EXISTS sync_receipts (
    idempotency_key  VARCHAR(120) PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_id      VARCHAR(96),
    rows_accepted    INT NOT NULL DEFAULT 0,
    rows_duplicate   INT NOT NULL DEFAULT 0,
    received_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_receipts_tenant
    ON sync_receipts (tenant_id, received_at DESC);


-- 5. VIEW UNTUK ADMIN PANEL ---------------------------------------------------
--
-- Semua dikelompokkan per sektor. Panel tidak boleh menulis SQL agregat
-- sendiri: kalau logika "omzet" berbeda antara panel dan batch job, dua angka
-- resmi akan saling bertentangan dan tidak ada yang tahu mana yang benar.

DROP VIEW IF EXISTS v_sector_summary CASCADE;
CREATE VIEW v_sector_summary AS
SELECT
    x.business_sector,
    COUNT(DISTINCT x.tenant_id)                       AS merchant_count,
    COUNT(DISTINCT x.business_id)                     AS business_unit_count,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(x.total_amount), 0)                  AS gross_revenue,
    COALESCE(AVG(x.total_amount), 0)                  AS avg_basket,
    COALESCE(SUM(x.discount_amount), 0)               AS total_discount,
    MAX(x.created_at)                                 AS last_transaction_at
  FROM transactions x
 WHERE x.payment_status <> 'CANCELLED'
 GROUP BY x.business_sector;

COMMENT ON VIEW v_sector_summary IS
    'Ringkasan lima sektor bisnis. Sumber angka tunggal untuk kartu ringkasan admin panel.';


DROP VIEW IF EXISTS v_merchant_directory CASCADE;
CREATE VIEW v_merchant_directory AS
SELECT
    t.id                                              AS merchant_id,
    t.name                                            AS merchant_name,
    t.business_sector,
    t.is_active,
    t.created_at                                      AS joined_at,
    COUNT(x.id)                                       AS transaction_count,
    COALESCE(SUM(x.total_amount), 0)                  AS gross_revenue,
    MAX(x.created_at)                                 AS last_transaction_at,
    COUNT(DISTINCT x.business_id)                     AS business_unit_count,
    COUNT(DISTINCT x.cashier_user_id)                 AS distinct_cashiers
  FROM tenants t
  LEFT JOIN transactions x
         ON x.tenant_id = t.id
        AND x.payment_status <> 'CANCELLED'
 GROUP BY t.id, t.name, t.business_sector, t.is_active, t.created_at;

COMMENT ON VIEW v_merchant_directory IS
    'Satu baris per merchant. LEFT JOIN disengaja: merchant yang belum pernah bertransaksi justru yang paling perlu terlihat.';


DROP VIEW IF EXISTS v_product_sales_by_sector CASCADE;
CREATE VIEW v_product_sales_by_sector AS
SELECT
    i.business_sector,
    x.tenant_id                                       AS merchant_id,
    t.name                                            AS merchant_name,
    i.product_id,
    i.product_name,
    i.category_name,
    SUM(i.quantity)                                   AS units_sold,
    SUM(i.total_price)                                AS revenue,
    SUM(i.unit_cost * i.quantity)                     AS cogs,
    SUM(i.total_price) - SUM(i.unit_cost * i.quantity) AS gross_profit,
    COUNT(DISTINCT i.transaction_id)                  AS appeared_in_transactions,
    MAX(x.created_at)                                 AS last_sold_at
  FROM transaction_items i
  JOIN transactions x ON x.id = i.transaction_id
  JOIN tenants      t ON t.id = x.tenant_id
 WHERE x.payment_status <> 'CANCELLED'
 GROUP BY i.business_sector, x.tenant_id, t.name,
          i.product_id, i.product_name, i.category_name;

COMMENT ON VIEW v_product_sales_by_sector IS
    'Produk apa saja yang terjual, per sektor per merchant. product_name dari snapshot baris struk, bukan dari katalog, supaya ganti nama produk tidak menulis ulang riwayat.';


DROP VIEW IF EXISTS v_activity_by_sector CASCADE;
CREATE VIEW v_activity_by_sector AS
SELECT
    a.business_sector,
    a.app_module,
    a.event_type,
    a.severity,
    COUNT(*)                                          AS event_count,
    COUNT(DISTINCT a.merchant_id)                     AS merchants_affected,
    MAX(a.occurred_at)                                AS last_seen_at
  FROM merchant_activity_log a
 GROUP BY a.business_sector, a.app_module, a.event_type, a.severity;


DROP VIEW IF EXISTS v_daily_sector_revenue CASCADE;
CREATE VIEW v_daily_sector_revenue AS
SELECT
    x.business_sector,
    (x.created_at AT TIME ZONE 'Asia/Jakarta')::date  AS sales_date,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(x.total_amount), 0)                  AS gross_revenue,
    COUNT(DISTINCT x.tenant_id)                       AS active_merchants
  FROM transactions x
 WHERE x.payment_status <> 'CANCELLED'
 GROUP BY x.business_sector, (x.created_at AT TIME ZONE 'Asia/Jakarta')::date;

COMMENT ON VIEW v_daily_sector_revenue IS
    'Omzet harian per sektor dalam WIB. Tanpa konversi zona waktu, penjualan setelah pukul 17:00 WIB jatuh ke tanggal berikutnya menurut UTC.';


-- 6. AKSES BACA UNTUK BI ------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON v_sector_summary, v_merchant_directory,
                        v_product_sales_by_sector, v_activity_by_sector,
                        v_daily_sector_revenue
              TO bi_readonly;
    END IF;
END $$;
