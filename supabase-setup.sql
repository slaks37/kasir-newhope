-- =============================================================================
-- New Hope POS — penyiapan database lengkap
--
-- Dihasilkan oleh scripts/db/bundle.mjs. JANGAN disunting langsung; ubah berkas
-- migrasi aslinya lalu jalankan ulang skripnya.
--
-- -----------------------------------------------------------------------------
-- CARA PAKAI DI SUPABASE
-- -----------------------------------------------------------------------------
--   1. Dashboard > SQL Editor > New query
--   2. Tempel SELURUH isi berkas ini
--   3. Run
--
-- Perlu 10-30 detik. Setelah selesai, pilih skema "pos" di Table Editor —
-- skema "public" memang akan tetap kosong, karena semua tabel tinggal di
-- skema per-domain (pos, billing, ai, internal) dan itu memang desainnya.
--
-- -----------------------------------------------------------------------------
-- AMAN DIULANG
-- -----------------------------------------------------------------------------
-- Setiap migrasi idempoten dan pencatatannya memakai ON CONFLICT DO NOTHING,
-- jadi menjalankan berkas ini dua kali tidak merusak apa pun.
--
-- -----------------------------------------------------------------------------
-- CATATAN UNTUK POSTGRESQL < 18 (Supabase saat ini 15-17)
-- -----------------------------------------------------------------------------
-- Bagian 0001 memasang uuidv7() versi plpgsql karena fungsi itu baru bawaan di
-- PostgreSQL 18. Kalau nanti Supabase naik ke 18, penambalnya otomatis
-- dilewati dan implementasi bawaan yang dipakai.
--
-- Beberapa perintah butuh hak yang tidak dimiliki peran `postgres` di Supabase
-- (mis. ALTER DATABASE ... SET search_path). Semuanya sudah dibungkus
-- penangkap error, jadi akan muncul sebagai NOTICE — bukan kegagalan.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename    VARCHAR(160) PRIMARY KEY,
    applied_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);



-- --------------------------------------------------------------------------
-- BAGIAN 01: migrations/0001_compat.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0001_compat.sql
--
-- Lapisan kompatibilitas versi PostgreSQL. HARUS dijalankan paling awal.
--
-- -----------------------------------------------------------------------------
-- MASALAH
-- -----------------------------------------------------------------------------
-- Migrasi 0005 dan 0006 memakai `uuidv7()`. Fungsi itu BAWAAN PostgreSQL 18 dan
-- TIDAK ADA di versi sebelumnya. Database pengembangan di sini memakai PGlite
-- (PostgreSQL 18.3) sehingga tersedia; layanan terkelola seperti Supabase,
-- RDS, dan Cloud SQL umumnya masih di PostgreSQL 15–17.
--
-- Akibatnya seluruh migrasi berhenti di baris pertama yang menyentuhnya, dengan
-- pesan "function uuidv7() does not exist" — dan itu terjadi SETELAH beberapa
-- migrasi lain sudah diterapkan, sehingga database tertinggal setengah jadi.
--
-- -----------------------------------------------------------------------------
-- PENYELESAIAN
-- -----------------------------------------------------------------------------
-- Kalau `uuidv7()` sudah ada, file ini tidak melakukan apa-apa — implementasi
-- bawaan C selalu lebih cepat daripada plpgsql, jadi tidak boleh ditimpa.
-- Kalau belum ada, dibuat implementasi plpgsql yang menghasilkan UUID versi 7
-- sesuai RFC 9562.
--
-- Idempoten, aman diulang.
-- =============================================================================

DO $$
BEGIN
    -- Sudah ada (PostgreSQL 18+)? Jangan disentuh.
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'uuidv7' AND p.pronargs = 0
    ) THEN
        RAISE NOTICE '0001: uuidv7() bawaan tersedia — penambal dilewati.';
        RETURN;
    END IF;

    /*
     * UUID versi 7 menurut RFC 9562:
     *
     *   bit   0..47   stempel waktu Unix dalam milidetik (big-endian)
     *   bit  48..51   versi = 7
     *   bit  52..63   acak (boleh dipakai untuk sub-milidetik)
     *   bit  64..65   varian = 0b10
     *   bit  66..127  acak
     *
     * Bagian waktu di depan itulah gunanya v7: UUID yang dibuat berurutan waktu
     * juga berurutan secara leksikal, sehingga penyisipan tetap berada di ujung
     * kanan B-tree. UUID v4 yang acak penuh menyebar ke seluruh index dan
     * membuat tabel sebesar `transactions` cepat membengkak.
     *
     * Caranya: ambil 16 byte acak, lalu timpa 6 byte pertama dengan stempel
     * waktu dan sisipkan penanda versi + varian. Dengan begitu semua bit yang
     * tidak ditentukan spesifikasi tetap benar-benar acak.
     */
    /*
     * Penghitung untuk 12 bit `rand_a`. Lihat alasannya di dalam fungsi.
     * Sequence dipilih karena TIDAK transaksional — nilainya tetap maju walau
     * transaksi yang memakainya di-rollback, sehingga dua transaksi bersamaan
     * tidak pernah mendapat angka yang sama.
     */
    CREATE SEQUENCE IF NOT EXISTS uuidv7_counter AS BIGINT CYCLE;

    CREATE FUNCTION uuidv7() RETURNS uuid AS $fn$
    DECLARE
        v_time_ms BIGINT;
        v_counter INT;
        v_bytes   BYTEA;
    BEGIN
        v_time_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;

        /*
         * 12 bit `rand_a` diisi PENGHITUNG, bukan bit acak.
         *
         * Kenapa bukan acak: UUID yang lahir dalam milidetik yang sama akan
         * berurutan acak. Diukur langsung — 200 UUID beruntun hanya 52%
         * berurutan leksikal, praktis sama dengan v4. Seluruh alasan memakai v7
         * (locality B-tree pada tabel sebesar `transactions`) hilang di sana.
         *
         * Kenapa bukan presisi sub-milidetik seperti RFC 9562 §6.2 Metode 2:
         * cara itu bergantung pada resolusi jam. PGlite — database pengembangan
         * proyek ini — hanya punya resolusi 1 ms, sehingga bit sub-milidetiknya
         * SELALU nol dan perbaikannya diam-diam tidak bekerja. Penghitung benar
         * di resolusi jam mana pun.
         *
         * Batasnya: 4096 UUID per milidetik (≈4 juta/detik). Di atas itu
         * penghitung berputar dan urutan dalam milidetik itu rusak — jauh di
         * luar beban yang mungkin.
         */
        v_counter := (nextval('uuidv7_counter') % 4096)::INT;

        -- gen_random_bytes butuh pgcrypto; RFC hanya menuntut keacakan yang
        -- memadai untuk 62 bit terakhir, jadi md5(random()) sudah cukup.
        v_bytes := decode(md5(random()::text || clock_timestamp()::text), 'hex');

        -- 6 byte stempel waktu, big-endian.
        v_bytes := set_byte(v_bytes, 0, ((v_time_ms >> 40) & 255)::INT);
        v_bytes := set_byte(v_bytes, 1, ((v_time_ms >> 32) & 255)::INT);
        v_bytes := set_byte(v_bytes, 2, ((v_time_ms >> 24) & 255)::INT);
        v_bytes := set_byte(v_bytes, 3, ((v_time_ms >> 16) & 255)::INT);
        v_bytes := set_byte(v_bytes, 4, ((v_time_ms >>  8) & 255)::INT);
        v_bytes := set_byte(v_bytes, 5, ( v_time_ms        & 255)::INT);

        -- Byte 6: 4 bit atas = versi 7, 4 bit bawah = penghitung bit 11..8.
        v_bytes := set_byte(v_bytes, 6, (112 | ((v_counter >> 8) & 15))::INT);
        -- Byte 7: penghitung bit 7..0.
        v_bytes := set_byte(v_bytes, 7, ( v_counter        & 255)::INT);

        -- Byte 8: 2 bit atas = varian 0b10, 6 bit bawah tetap acak.
        v_bytes := set_byte(v_bytes, 8, ((get_byte(v_bytes, 8) & 63) | 128));

        RETURN encode(v_bytes, 'hex')::uuid;
    END;
    $fn$ LANGUAGE plpgsql VOLATILE;

    RAISE NOTICE '0001: uuidv7() bawaan tidak ada — penambal plpgsql dipasang (PostgreSQL < 18).';
END $$;


-- gen_random_uuid() ada sejak PostgreSQL 13; disediakan hanya bila benar-benar
-- tidak ada, agar migrasi lama tetap bisa dijalankan di instance sangat tua.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.proname = 'gen_random_uuid' AND p.pronargs = 0
    ) THEN
        BEGIN
            CREATE EXTENSION IF NOT EXISTS pgcrypto;
            RAISE NOTICE '0001: pgcrypto dipasang untuk gen_random_uuid().';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '0001: pgcrypto tidak tersedia (%). Lanjut tanpa itu.', SQLERRM;
        END;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0001_compat.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 02: schema.sql
-- --------------------------------------------------------------------------

-- PostgreSQL / Supabase Schema Migration Script for SaaS Subscription Engine
-- New Hope POS SaaS Multi-Tenant Architecture

-- 1. Enum Types for Subscription & Payment Status
CREATE TYPE billing_cycle_enum AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE subscription_status_enum AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED');
CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- 2. Plans Table
CREATE TABLE plans (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    tier_level INT NOT NULL DEFAULT 1, -- 1: Basic, 2: Pro, 3: Enterprise
    billing_cycle billing_cycle_enum NOT NULL DEFAULT 'MONTHLY',
    price_idr NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'IDR',
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Subscriptions Table
CREATE TABLE subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    plan_id VARCHAR(64) NOT NULL REFERENCES plans(id),
    status subscription_status_enum NOT NULL DEFAULT 'TRIAL',
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    grace_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant UNIQUE(tenant_id)
);

-- 4. Invoices / Transactions Table
CREATE TABLE invoices (
    id VARCHAR(64) PRIMARY KEY,
    subscription_id VARCHAR(64) NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'IDR',
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    payment_gateway_ref VARCHAR(128),
    payment_link_url TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Webhook Logs Table (For Idempotency)
CREATE TABLE webhook_logs (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(128) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for High Performance Lookup
CREATE INDEX idx_subscriptions_tenant_status ON subscriptions(tenant_id, status);
CREATE INDEX idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);

INSERT INTO public.schema_migrations (filename) VALUES ('schema.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 03: schema_hybrid_pos.sql
-- --------------------------------------------------------------------------

-- PostgreSQL Schema Migration Script for Hybrid Multi-Tenant POS Platform
-- Includes Bill of Materials (BOM) Recipe Stock Deduction & Analytics Indexes

-- 1. Tenants & Users (Multi-Tenancy & Access Control)
CREATE TABLE tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    business_sector VARCHAR(32) NOT NULL DEFAULT 'FNB',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL,
    pin VARCHAR(64) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'CASHIER', -- ADMIN, MANAGER, CASHIER
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT idx_tenant_username UNIQUE(tenant_id, username)
);

-- 2. Raw Materials & Ingredients (Inventory Management)
CREATE TABLE ingredients (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(50),
    current_stock NUMERIC(12, 3) NOT NULL DEFAULT 0,
    min_stock_alert NUMERIC(12, 3) NOT NULL DEFAULT 10,
    unit VARCHAR(20) NOT NULL, -- gram, ml, pcs, kg, porsi
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Products Catalog
CREATE TABLE products (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(50) NOT NULL,
    category_id VARCHAR(64),
    price NUMERIC(12, 2) NOT NULL,
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bill of Materials (Product Recipe Mapping BOM)
CREATE TABLE product_recipes (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id VARCHAR(64) NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12, 3) NOT NULL, -- e.g. 100g beras per 1 nasi goreng
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT idx_product_ingredient UNIQUE(product_id, ingredient_id)
);

-- 5. Financial Transactions & Line Items
CREATE TABLE transactions (
    id VARCHAR(64) PRIMARY KEY, -- e.g. INV-20260811-001
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cashier_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    subtotal NUMERIC(12, 2) NOT NULL,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL, -- CASH, QRIS, CARD, EDC
    payment_status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transaction_items (
    id VARCHAR(64) PRIMARY KEY,
    transaction_id VARCHAR(64) NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id),
    product_name VARCHAR(100) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    quantity INT NOT NULL,
    total_price NUMERIC(12, 2) NOT NULL
);

-- 6. Inventory Deduction Log Audit Trail
CREATE TABLE inventory_logs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    ingredient_id VARCHAR(64) NOT NULL REFERENCES ingredients(id),
    transaction_id VARCHAR(64) REFERENCES transactions(id),
    quantity_changed NUMERIC(12, 3) NOT NULL, -- negative value for deduction
    previous_stock NUMERIC(12, 3) NOT NULL,
    new_stock NUMERIC(12, 3) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- High-Performance Analytics Indexes
CREATE INDEX idx_transactions_tenant_date ON transactions(tenant_id, created_at DESC);
CREATE INDEX idx_transaction_items_tenant_product ON transaction_items(tenant_id, product_id);
CREATE INDEX idx_inventory_logs_tenant_ingredient ON inventory_logs(tenant_id, ingredient_id, created_at DESC);

INSERT INTO public.schema_migrations (filename) VALUES ('schema_hybrid_pos.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 04: migrations/0003_smart_assistant.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0003_smart_assistant.sql
-- Smart Assistant Engine — batch learning store, AI credit wallet, audit trail.
--
-- Consistent with schema.sql and schema_hybrid_pos.sql: VARCHAR(64) ids,
-- tenant_id on every row, TIMESTAMP WITH TIME ZONE, JSONB payloads, snake_case.
--
-- Cost-control intent: `daily_merchant_insights` is written ONCE per merchant
-- per night by the cron job, and read thousands of times per day by the app for
-- free. Every read served from this table is an LLM call that never happened.
--
-- -----------------------------------------------------------------------------
-- MIGRATION SAFETY — applying this file over an earlier revision
-- -----------------------------------------------------------------------------
-- An earlier revision of this same file created two Postgres ENUM types
-- (`insight_category_enum`, `insight_status_enum`) and typed
-- `daily_merchant_insights.category` / `.status` against them. That revision may
-- already be deployed. This file is written so that BOTH paths work:
--
--   FRESH DATABASE   Section 1 creates the one remaining enum, Section 2 finds
--                    no table and returns immediately, Section 3 creates
--                    everything with VARCHAR + CHECK.
--
--   UPGRADE IN PLACE Section 2 detects the old enum-typed columns, converts them
--                    to VARCHAR with `USING <col>::text`, renames the two values
--                    that changed (PEAK_HOURS -> OPERATIONAL_PEAK,
--                    FINANCIAL_ANOMALY -> FINANCIAL_PERFORMANCE), then drops the
--                    now-unreferenced enum types. Section 3's
--                    CREATE TABLE IF NOT EXISTS becomes a no-op, and Section 3b
--                    re-asserts the CHECK constraints from a single source of
--                    truth.
--
-- The whole file is idempotent and safe to re-run. Run it inside a transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0003_smart_assistant.sql
--
-- No data is lost by the conversion: every enum label round-trips through
-- ::text unchanged. Rows written by the old revision keep their history; only
-- the two renamed category labels are rewritten in place.
--
-- If the upgrade runs against a database that already holds BOTH an old
-- 'PEAK_HOURS' row and a new 'OPERATIONAL_PEAK' row for the same
-- (merchant_id, insight_date) — impossible in practice, since the old revision
-- could not emit the new label — the rename would violate uq_insight_per_day.
-- In that case delete the stale day and let the nightly job recompute it:
--   DELETE FROM daily_merchant_insights WHERE insight_date < CURRENT_DATE;
-- =============================================================================


-- 1. ENUM TYPES --------------------------------------------------------------
--
-- ARCHITECTURAL DECISION (a): the insight category is NOT a Postgres ENUM.
--
-- The design justifies storing the insight body as JSONB on the grounds of
-- "zero migration overhead" — a new insight shape ships as a code change, not a
-- schema change. A Postgres ENUM on `category` contradicts exactly that: adding
-- a tenth category would require `ALTER TYPE insight_category_enum ADD VALUE
-- '...'`, which IS a migration, cannot be rolled back, and on PostgreSQL < 12
-- cannot even run inside a transaction block — so it cannot be bundled with the
-- rest of a deploy. VARCHAR(40) + CHECK keeps category evolution as cheap as
-- payload evolution: one line in this file, revertible, transactional, and the
-- constraint can be dropped and re-added in the same statement batch.
--
-- The same reasoning applies to `status`.
--
-- `batch_run_status_enum` STAYS an enum: SUCCESS / FAILED / SKIPPED is a
-- genuinely closed set describing how a process terminated. It is not a product
-- taxonomy and will not grow.

DO $$ BEGIN
    CREATE TYPE batch_run_status_enum AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- 2. IN-PLACE UPGRADE FROM THE ENUM REVISION ---------------------------------
-- No-op on a fresh database. See the MIGRATION SAFETY note in the header.

DO $$
DECLARE
    v_category_type TEXT;
    v_status_type   TEXT;
BEGIN
    IF to_regclass('public.daily_merchant_insights') IS NULL THEN
        RETURN;  -- fresh install; Section 3 builds the correct shape directly.
    END IF;

    SELECT atttypid::regtype::text INTO v_category_type
      FROM pg_attribute
     WHERE attrelid = 'public.daily_merchant_insights'::regclass
       AND attname  = 'category'
       AND NOT attisdropped;

    SELECT atttypid::regtype::text INTO v_status_type
      FROM pg_attribute
     WHERE attrelid = 'public.daily_merchant_insights'::regclass
       AND attname  = 'status'
       AND NOT attisdropped;

    IF v_category_type = 'insight_category_enum' THEN
        ALTER TABLE daily_merchant_insights
            ALTER COLUMN category TYPE VARCHAR(40) USING category::text;
        RAISE NOTICE '0003: category converted insight_category_enum -> VARCHAR(40)';
    END IF;

    IF v_status_type = 'insight_status_enum' THEN
        -- The DEFAULT is enum-typed and blocks the conversion; drop, convert,
        -- restore.
        ALTER TABLE daily_merchant_insights ALTER COLUMN status DROP DEFAULT;
        ALTER TABLE daily_merchant_insights
            ALTER COLUMN status TYPE VARCHAR(16) USING status::text;
        ALTER TABLE daily_merchant_insights ALTER COLUMN status SET DEFAULT 'ACTIVE';
        RAISE NOTICE '0003: status converted insight_status_enum -> VARCHAR(16)';
    END IF;

    -- Category renames from the previous revision. Safe now that the column is
    -- text-typed. Both are pure relabels — payload shape is unchanged for
    -- OPERATIONAL_PEAK; FINANCIAL_PERFORMANCE rows written by the old revision
    -- carry only the `anomalies` half of the payload and will be overwritten by
    -- the next nightly run.
    UPDATE daily_merchant_insights
       SET category = 'OPERATIONAL_PEAK'
     WHERE category = 'PEAK_HOURS';

    UPDATE daily_merchant_insights
       SET category = 'FINANCIAL_PERFORMANCE'
     WHERE category = 'FINANCIAL_ANOMALY';

    -- Nothing references these types any more.
    DROP TYPE IF EXISTS insight_category_enum;
    DROP TYPE IF EXISTS insight_status_enum;
END $$;


-- 3. DAILY BATCH LEARNING OUTPUT --------------------------------------------
--
-- ARCHITECTURAL DECISION (b): ids stay VARCHAR(64). No UUID, no
-- gen_random_uuid().
--
-- Every table already in schema.sql and schema_hybrid_pos.sql uses VARCHAR(64)
-- primary keys holding human-readable, meaningful ids: 'tenant-default',
-- 'prod-fnb-1', 'INV-20260811-001'. `merchant_id` here has to line up with
-- tenants.id / users.id — a UUID column simply cannot carry a foreign key to a
-- VARCHAR(64) column, so switching this one table to UUID would make the join
-- impossible without casting on every query.
--
-- Moving the platform to UUID keys is a defensible change, but it touches every
-- table, every seed, every id-generating call site and every stored id in the
-- browser's localStorage. That is its own epic with its own migration and its
-- own rollback plan — it must not happen as a side effect of shipping the Smart
-- Assistant.

CREATE TABLE IF NOT EXISTS daily_merchant_insights (
    id             VARCHAR(64) PRIMARY KEY,
    merchant_id    VARCHAR(64) NOT NULL,
    tenant_id      VARCHAR(64) NOT NULL,
    insight_date   DATE NOT NULL,
    -- Domain enforced by ck_insight_category (Section 3b), not by a Postgres
    -- ENUM. See decision (a).
    category       VARCHAR(40) NOT NULL,
    priority       SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
    title          VARCHAR(200) NOT NULL,
    summary        TEXT NOT NULL,
    metric_label   VARCHAR(80) NOT NULL DEFAULT '',
    payload        JSONB NOT NULL,
    actions        JSONB NOT NULL DEFAULT '[]'::jsonb,
    status         VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- A re-run of the nightly job must UPDATE, never duplicate. This is what
    -- makes the cron job safely idempotent and re-runnable at any hour.
    CONSTRAINT uq_insight_per_day UNIQUE (merchant_id, insight_date, category)
);


-- 3b. CATEGORY / STATUS DOMAIN ----------------------------------------------
--
-- ARCHITECTURAL DECISION (c): the nine categories below are the domain, and
-- they must stay byte-identical to the `InsightCategory` union in
-- src/lib/assistant/types.ts.
--
-- Asserted with DROP + ADD so this block is the single source of truth for both
-- a fresh install and an upgrade, and so adding a tenth category later is a
-- one-line, fully transactional change.
--
--   INVENTORY_ALERT         stok menipis / ROP dinamis
--   CROSS_SELL_OPPORTUNITY  market basket (support / confidence / lift)
--   CRM_CHURN               RFM, pelanggan bernilai yang menghilang
--   OPERATIONAL_PEAK        jam & hari ramai/sepi        (was PEAK_HOURS)
--   FINANCIAL_PERFORMANCE   run-rate vs target + anomali (was FINANCIAL_ANOMALY)
--   CALENDAR_BEHAVIOR       siklus gajian tanggal 25-3 vs 4-24
--   SHIFT_PERFORMANCE       laci kasir: selisih kas + sales/jam
--   LAYOUT_UTILISATION      denah: turnover per meja/rak/bay
--   STAFF_BEHAVIOUR         perilaku staf: layanan + absensi
--
-- STAFF_BEHAVIOUR and SHIFT_PERFORMANCE are deliberately separate: the first is
-- about the person serving the customer (order attribution, clock-ins), the
-- second is about the till session (cash variance, throughput). One merchant can
-- have a warm, punctual barista whose drawer is short every night.

ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_category;
ALTER TABLE daily_merchant_insights ADD  CONSTRAINT ck_insight_category CHECK (
    category IN (
        'INVENTORY_ALERT',
        'CROSS_SELL_OPPORTUNITY',
        'CRM_CHURN',
        'OPERATIONAL_PEAK',
        'FINANCIAL_PERFORMANCE',
        'CALENDAR_BEHAVIOR',
        'SHIFT_PERFORMANCE',
        'LAYOUT_UTILISATION',
        'STAFF_BEHAVIOUR'
    )
);

ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_status;
ALTER TABLE daily_merchant_insights ADD  CONSTRAINT ck_insight_status CHECK (
    status IN ('ACTIVE', 'DISMISSED', 'ACTIONED')
);

COMMENT ON TABLE  daily_merchant_insights IS
    'Pre-calculated nightly insights. Serving a merchant question from this table costs Rp 0; the alternative is a billed LLM call.';
COMMENT ON COLUMN daily_merchant_insights.category IS
    'One of nine values, enforced by ck_insight_category. VARCHAR + CHECK instead of a Postgres ENUM so a new category costs one revertible line, not an ALTER TYPE that cannot run in a transaction on PG < 12.';
COMMENT ON COLUMN daily_merchant_insights.priority IS
    '1=HIGH (act today), 2=MEDIUM, 3=LOW (informational). SMALLINT, not an enum: integers sort naturally in ORDER BY priority.';
COMMENT ON COLUMN daily_merchant_insights.payload IS
    'Category-specific JSON matching the InsightPayload discriminated union in src/lib/assistant/types.ts. Contains aggregates only — never raw transaction rows.';
COMMENT ON COLUMN daily_merchant_insights.status IS
    'ACTIVE | DISMISSED | ACTIONED. DISMISSED and ACTIONED are set by the merchant from the Smart Card UI, so the same advice is not repeated.';

CREATE INDEX IF NOT EXISTS idx_insights_merchant_date
    ON daily_merchant_insights (merchant_id, insight_date DESC);
CREATE INDEX IF NOT EXISTS idx_insights_merchant_active
    ON daily_merchant_insights (merchant_id, status, priority)
    WHERE status = 'ACTIVE';
-- Kept: the GIN index makes payload interrogation cheap without a schema
-- change, e.g. "which merchants have an OUT_OF_STOCK item tonight?"
--   WHERE payload @> '{"items":[{"severity":"OUT_OF_STOCK"}]}'
CREATE INDEX IF NOT EXISTS idx_insights_payload_gin
    ON daily_merchant_insights USING GIN (payload);


-- 4. MERCHANT REVENUE TARGET -------------------------------------------------
--
-- WHERE THIS LIVES — decision and rationale.
--
-- CHOSEN: a new dedicated table, `merchant_targets`.
-- REJECTED: adding the column to a store-settings table.
--
-- Why: there is no `store_settings` table in Postgres to add a column to.
-- StoreSettings (src/types.ts, field `monthlyRevenueTarget?: number`) currently
-- lives entirely in the browser's localStorage as one JSON blob; schema.sql and
-- schema_hybrid_pos.sql never model it. Blocking the FINANCIAL_PERFORMANCE card
-- on "first design and migrate the whole settings table" would be the tail
-- wagging the dog, and hanging the column off `tenants` would mix a business
-- goal that changes every quarter into an identity table that never changes.
--
-- A one-column keyed table is also the honest shape: the target is per merchant,
-- optional, and mutable independently of everything else in settings.
--
-- When a real `store_settings` table eventually lands, THIS table stays the
-- canonical source for the target and the settings row reads from it — do not
-- duplicate the value in two places.
--
-- NULL is meaningful, not missing data: NULL means "merchant never set one", and
-- the batch engine then auto-derives a target from the trailing 3 complete
-- months x 1.1 and reports targetSource = 'AUTO'. See resolveMonthlyTarget() in
-- src/lib/assistant/insights.ts and MerchantAggregates.targetSource
-- ('MERCHANT' | 'AUTO' | 'NONE') in src/lib/assistant/types.ts.

CREATE TABLE IF NOT EXISTS merchant_targets (
    merchant_id            VARCHAR(64) PRIMARY KEY,
    tenant_id              VARCHAR(64) NOT NULL,
    -- NUMERIC(14,2): IDR has no minor unit in practice but the rest of the
    -- schema stores money as NUMERIC(12,2); 14 digits leaves headroom for a
    -- monthly target in the tens of billions without changing the type later.
    monthly_revenue_target NUMERIC(14, 2)
                           CHECK (monthly_revenue_target IS NULL
                                  OR monthly_revenue_target > 0),
    currency               VARCHAR(10) NOT NULL DEFAULT 'IDR',
    updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  merchant_targets IS
    'Optional per-merchant business goals for the Smart Assistant. Separate from tenants/settings so a quarterly goal can change without touching identity data.';
COMMENT ON COLUMN merchant_targets.monthly_revenue_target IS
    'Target omzet bulanan (IDR). NULL = merchant has not set one; the batch engine then derives avg(trailing 3 complete months) x 1.1 and flags targetSource=AUTO, so the card is useful on day 1 instead of permanently empty.';
COMMENT ON COLUMN merchant_targets.merchant_id IS
    'Matches tenants.id / users.id. VARCHAR(64) precisely so this FK relationship remains possible — see decision (b) in the header.';

CREATE INDEX IF NOT EXISTS idx_merchant_targets_tenant
    ON merchant_targets (tenant_id);


-- 5. AI CREDIT WALLET (the paid Layer 3 gate) -------------------------------

CREATE TABLE IF NOT EXISTS merchant_ai_credits (
    merchant_id      VARCHAR(64) PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    balance          INT NOT NULL DEFAULT 30 CHECK (balance >= 0),
    monthly_grant    INT NOT NULL DEFAULT 30 CHECK (monthly_grant >= 0),
    used_this_month  INT NOT NULL DEFAULT 0 CHECK (used_this_month >= 0),
    period_reset_at  TIMESTAMP WITH TIME ZONE NOT NULL
                     DEFAULT (date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  merchant_ai_credits IS
    'Hard quota for Layer 3. Deterministic answers never touch this table, so routine usage can never drain it.';
COMMENT ON COLUMN merchant_ai_credits.balance IS
    'CHECK (balance >= 0) is the last line of defence: even a buggy caller cannot push a merchant into negative credit.';


-- 6. AUDIT TRAIL — proves the >=90% zero-cost objective is being met ---------

CREATE TABLE IF NOT EXISTS ai_query_logs (
    id                 VARCHAR(64) PRIMARY KEY,
    merchant_id        VARCHAR(64) NOT NULL,
    tenant_id          VARCHAR(64) NOT NULL,
    asked_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    query_text         TEXT,
    resolved_intent    VARCHAR(64),
    source             VARCHAR(20) NOT NULL
                       CHECK (source IN ('RULE_ENGINE','BATCH_INSIGHT','LLM','PAYWALL','ERROR')),
    credits_charged    INT NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
    latency_ms         INT,
    model              VARCHAR(64),
    prompt_tokens      INT,
    completion_tokens  INT
);

COMMENT ON TABLE ai_query_logs IS
    'One row per assistant question. zero-cost rate = count(credits_charged = 0) / count(*). Drops below 90% mean the intent parser is missing vocabulary — fix the parser, do not buy more credits.';
COMMENT ON COLUMN ai_query_logs.model IS
    'Model id actually billed, e.g. deepseek-chat. NULL for every deterministic answer.';
COMMENT ON COLUMN ai_query_logs.resolved_intent IS
    'IntentName from src/lib/assistant/types.ts. VARCHAR, not an enum: the intent vocabulary grows every time the parser learns a new phrase.';

CREATE INDEX IF NOT EXISTS idx_ai_query_logs_merchant
    ON ai_query_logs (merchant_id, asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_source
    ON ai_query_logs (source, asked_at DESC);


-- 7. BATCH JOB OBSERVABILITY ------------------------------------------------

CREATE TABLE IF NOT EXISTS batch_job_runs (
    id                VARCHAR(64) PRIMARY KEY,
    job_name          VARCHAR(64) NOT NULL,
    merchant_id       VARCHAR(64),
    started_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at       TIMESTAMP WITH TIME ZONE,
    status            batch_run_status_enum NOT NULL DEFAULT 'SUCCESS',
    insights_written  INT NOT NULL DEFAULT 0,
    duration_ms       INT,
    error_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_job_runs_recent
    ON batch_job_runs (job_name, started_at DESC);


-- 8. ATOMIC CREDIT CONSUMPTION ----------------------------------------------

/*
 * Prevents this race:
 *   request A reads balance = 1
 *   request B reads balance = 1
 *   both decide "there is credit", both call the LLM, both write balance = 0
 *   -> the merchant paid for one credit and received two billed calls.
 *
 * Doing the check and the decrement in ONE statement means the second caller's
 * WHERE clause simply matches no rows and it gets FALSE.
 */
CREATE OR REPLACE FUNCTION consume_ai_credit(p_merchant_id VARCHAR(64))
RETURNS BOOLEAN AS $$
DECLARE
    v_new_balance INT;
BEGIN
    UPDATE merchant_ai_credits
       SET balance         = balance - 1,
           used_this_month = used_this_month + 1,
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id
       AND balance > 0
    RETURNING balance INTO v_new_balance;

    RETURN v_new_balance IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION consume_ai_credit IS
    'Atomically spends one AI credit. Returns FALSE when the merchant is out of quota — the caller must then show the paywall and MUST NOT call the model.';

/* Refund path for a model call that failed after the credit was taken. */
CREATE OR REPLACE FUNCTION refund_ai_credit(p_merchant_id VARCHAR(64))
RETURNS VOID AS $$
BEGIN
    UPDATE merchant_ai_credits
       SET balance         = balance + 1,
           used_this_month = GREATEST(0, used_this_month - 1),
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refund_ai_credit IS
    'Gives the credit back when the model call failed after the debit. Billing a call that never produced an answer is a bug, not revenue.';

/* Monthly grant reset — safe to run daily, only touches expired periods. */
CREATE OR REPLACE FUNCTION reset_ai_credits_monthly()
RETURNS INT AS $$
DECLARE
    v_rows INT;
BEGIN
    UPDATE merchant_ai_credits
       SET balance         = monthly_grant,
           used_this_month = 0,
           period_reset_at = date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month',
           updated_at      = CURRENT_TIMESTAMP
     WHERE period_reset_at <= CURRENT_TIMESTAMP;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reset_ai_credits_monthly IS
    'Idempotent monthly grant refill. Safe to run every night — the WHERE clause only matches periods that have actually expired.';


-- 9. SEED --------------------------------------------------------------------

INSERT INTO merchant_ai_credits (merchant_id, tenant_id, balance, monthly_grant)
VALUES ('tenant-default', 'tenant-default', 30, 30)
ON CONFLICT (merchant_id) DO NOTHING;

-- No target seeded on purpose: the demo merchant must exercise the AUTO path,
-- which is what nearly every real merchant will hit on day 1.
INSERT INTO merchant_targets (merchant_id, tenant_id, monthly_revenue_target)
VALUES ('tenant-default', 'tenant-default', NULL)
ON CONFLICT (merchant_id) DO NOTHING;


-- =============================================================================
-- ROLLBACK (uncomment to revert this migration)
-- =============================================================================
-- DROP FUNCTION IF EXISTS reset_ai_credits_monthly();
-- DROP FUNCTION IF EXISTS refund_ai_credit(VARCHAR);
-- DROP FUNCTION IF EXISTS consume_ai_credit(VARCHAR);
-- DROP TABLE IF EXISTS batch_job_runs;
-- DROP TABLE IF EXISTS ai_query_logs;
-- DROP TABLE IF EXISTS merchant_ai_credits;
-- DROP TABLE IF EXISTS merchant_targets;
-- DROP TABLE IF EXISTS daily_merchant_insights;
-- DROP TYPE  IF EXISTS batch_run_status_enum;
--
-- `insight_category_enum` and `insight_status_enum` are intentionally absent:
-- this revision no longer creates them, and Section 2 drops them if an earlier
-- revision left them behind. Dropping the tables above therefore leaves nothing
-- orphaned.
--
-- PARTIAL ROLLBACK — going back to the enum revision WITHOUT losing rows
-- (only needed if some other deployed code still expects the enum types):
--
-- CREATE TYPE insight_status_enum AS ENUM ('ACTIVE','DISMISSED','ACTIONED');
-- CREATE TYPE insight_category_enum AS ENUM (
--     'INVENTORY_ALERT','CROSS_SELL_OPPORTUNITY','CRM_CHURN','PEAK_HOURS',
--     'FINANCIAL_ANOMALY','LAYOUT_UTILISATION','STAFF_BEHAVIOUR');
-- DELETE FROM daily_merchant_insights
--  WHERE category IN ('CALENDAR_BEHAVIOR','SHIFT_PERFORMANCE');  -- no old label
-- UPDATE daily_merchant_insights SET category='PEAK_HOURS'
--  WHERE category='OPERATIONAL_PEAK';
-- UPDATE daily_merchant_insights SET category='FINANCIAL_ANOMALY'
--  WHERE category='FINANCIAL_PERFORMANCE';
-- ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_category;
-- ALTER TABLE daily_merchant_insights DROP CONSTRAINT IF EXISTS ck_insight_status;
-- ALTER TABLE daily_merchant_insights
--     ALTER COLUMN category TYPE insight_category_enum USING category::insight_category_enum;
-- ALTER TABLE daily_merchant_insights ALTER COLUMN status DROP DEFAULT;
-- ALTER TABLE daily_merchant_insights
--     ALTER COLUMN status TYPE insight_status_enum USING status::insight_status_enum;
-- ALTER TABLE daily_merchant_insights ALTER COLUMN status SET DEFAULT 'ACTIVE';
--
-- The DELETE is unavoidable and is the whole point of decision (a): an ENUM
-- makes adding a category a migration AND makes removing one destructive.

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0003_smart_assistant.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 05: migrations/0004_internal_backoffice.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0004_internal_backoffice.sql
-- SaaS PROVIDER back-office: merchant health monitoring, churn risk, feature
-- adoption, internal identity plane, and the read-only surface for the BI tool.
--
-- Applies on top of schema.sql, schema_hybrid_pos.sql and 0003_smart_assistant.sql.
-- Idempotent; run inside a transaction:
--   psql "$DATABASE_URL" --single-transaction -f migrations/0004_internal_backoffice.sql
--
-- -----------------------------------------------------------------------------
-- DEVIATION FROM SPEC (deliberate, same reasoning as 0003 decision (b))
-- -----------------------------------------------------------------------------
-- The spec writes:
--     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     merchant_id UUID NOT NULL,
--
-- This migration uses VARCHAR(64) instead. Reason: every table already deployed
-- (tenants, users, products, transactions, inventory_logs, daily_merchant_insights)
-- uses VARCHAR(64) primary keys holding meaningful ids — 'tenant-default',
-- 'usr-1', 'prod-fnb-1'. A UUID `merchant_id` here could not carry a foreign key
-- to tenants(id), so the single most important join in the whole BI layer
-- (health -> merchant) would need a cast on every query and could never be
-- enforced by the database.
--
-- Migrating the platform to UUID keys is defensible, but it is its own epic:
-- every table, every seed, every id-generating call site, and every id already
-- persisted in merchants' browsers. It must not happen as a side effect of
-- shipping the back-office. Flagged for an explicit decision.
-- =============================================================================


-- 1. INTERNAL IDENTITY PLANE -------------------------------------------------
--
-- SECURITY DECISION: our staff do NOT live in `users`.
--
-- `users` holds MERCHANT staff — cashiers, store managers, owners. If an
-- internal role like SUPERADMIN were just another value in that table's role
-- column, then any bug in merchant-side role handling (a bad UPDATE, a leaked
-- admin PIN, a mass-assignment in a settings form) would become a path to full
-- cross-merchant access to every tenant on the platform.
--
-- Internal staff therefore get a physically separate table, their own auth, and
-- no row-level relationship to any tenant. A merchant user can never be
-- "promoted" into this table by any merchant-facing code path.

DO $$ BEGIN
    CREATE TYPE internal_role_enum AS ENUM (
        'ROLE_SUPERADMIN',        -- full access incl. licence + billing writes
        'ROLE_INTERNAL_GROWTH',   -- MRR/GMV, churn cohorts, adoption. Read-only.
        'ROLE_INTERNAL_SUPPORT'   -- single-merchant troubleshooting. Read-only, audited.
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS internal_users (
    id             VARCHAR(64) PRIMARY KEY,
    email          VARCHAR(160) NOT NULL UNIQUE,
    full_name      VARCHAR(120) NOT NULL,
    role           internal_role_enum NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    -- Auth belongs to the identity provider (SSO), not to us. We store only the
    -- subject claim so a revoked SSO account instantly loses access.
    sso_subject    VARCHAR(200) UNIQUE,
    last_login_at  TIMESTAMP WITH TIME ZONE,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE internal_users IS
    'Employees of the SaaS provider. Deliberately separate from `users` (merchant staff) so merchant-side role bugs can never yield platform-wide access.';


-- 2. INTERNAL ACCESS AUDIT ---------------------------------------------------
--
-- Support staff can read a merchant's private business data. That power needs a
-- receipt: every internal read of tenant-scoped data writes a row here.
-- Without it there is no way to answer "who looked at this merchant's revenue?".

CREATE TABLE IF NOT EXISTS internal_access_log (
    id                VARCHAR(64) PRIMARY KEY,
    internal_user_id  VARCHAR(64) NOT NULL REFERENCES internal_users(id),
    internal_role     internal_role_enum NOT NULL,
    -- NULL for aggregate/platform-wide views that touch no single merchant.
    merchant_id       VARCHAR(64),
    action            VARCHAR(80) NOT NULL,   -- e.g. VIEW_MERCHANT_HEALTH
    resource          VARCHAR(120),           -- endpoint or report name
    justification     TEXT,                   -- required for SUPPORT deep-reads
    ip_address        VARCHAR(64),
    accessed_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_log_merchant  ON internal_access_log (merchant_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_user      ON internal_access_log (internal_user_id, accessed_at DESC);

COMMENT ON TABLE internal_access_log IS
    'Append-only receipt of every internal read of merchant data. Never UPDATE or DELETE.';


-- 3. FEATURE ADOPTION EVENT STREAM -------------------------------------------
--
-- Raw, append-only. The nightly job folds this into
-- merchant_health_logs.feature_usage_payload; keeping the raw stream means a new
-- adoption question can be answered retroactively without new instrumentation.

CREATE TABLE IF NOT EXISTS feature_usage_events (
    id            BIGSERIAL PRIMARY KEY,
    merchant_id   VARCHAR(64) NOT NULL,
    tenant_id     VARCHAR(64) NOT NULL,
    -- Partition key from TenantContext: `${userId}_${sector}`. Lets us see WHICH
    -- of a merchant's businesses adopted a feature, not just that someone did.
    business_id   VARCHAR(96),
    user_role     VARCHAR(32),
    feature_key   VARCHAR(80) NOT NULL,       -- 'ai.quick_chip.stock_critical'
    occurred_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_feature_events_merchant_time
    ON feature_usage_events (merchant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_events_key_time
    ON feature_usage_events (feature_key, occurred_at DESC);

COMMENT ON COLUMN feature_usage_events.metadata IS
    'Non-PII only. Never store customer names, phone numbers, or transaction contents here.';


-- 4. MERCHANT HEALTH LOGS (the table named in the spec) -----------------------

CREATE TABLE IF NOT EXISTS merchant_health_logs (
    id                      VARCHAR(64) PRIMARY KEY,
    merchant_id             VARCHAR(64) NOT NULL,
    tenant_id               VARCHAR(64) NOT NULL,
    log_date                DATE NOT NULL,

    daily_revenue           NUMERIC(15,2) NOT NULL DEFAULT 0,
    daily_transaction_count INT NOT NULL DEFAULT 0,
    active_cashiers_count   INT NOT NULL DEFAULT 0,

    -- Kept for spec compatibility: "did anyone sign in on this date".
    login_status            BOOLEAN NOT NULL DEFAULT TRUE,
    -- Added because a per-day boolean cannot express *drift*, which is the
    -- actual churn signal. These are what the risk score reads.
    last_activity_at        TIMESTAMP WITH TIME ZONE,
    days_since_last_txn     INT NOT NULL DEFAULT 0,
    active_days_last_7      INT NOT NULL DEFAULT 0,
    revenue_trend_pct       NUMERIC(6,2) NOT NULL DEFAULT 0,  -- 7d avg vs prior 23d avg

    feature_usage_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
    distinct_features_used  INT NOT NULL DEFAULT 0,
    support_tickets_count   INT NOT NULL DEFAULT 0,

    subscription_status     VARCHAR(20),
    -- Recognised: what is actually being collected right now (ACTIVE only).
    mrr_idr                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    -- Contract value regardless of payment state. "MRR at risk" must use this:
    -- a PAST_DUE merchant is recoverable revenue, and counting it as zero makes
    -- the urgency metric read 0 exactly when things are worst.
    contract_mrr_idr        NUMERIC(15,2) NOT NULL DEFAULT 0,

    churn_risk_score        NUMERIC(3,2) NOT NULL DEFAULT 0.00
                            CHECK (churn_risk_score >= 0 AND churn_risk_score <= 1),
    -- Why the score is what it is. A number a CSM cannot explain is a number
    -- they will not act on.
    churn_risk_reasons      JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_merchant_daily_health UNIQUE (merchant_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_health_merchant_date ON merchant_health_logs (merchant_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_health_churn_score   ON merchant_health_logs (churn_risk_score DESC);
-- The query the growth team actually runs: today's at-risk list.
CREATE INDEX IF NOT EXISTS idx_health_date_risk     ON merchant_health_logs (log_date DESC, churn_risk_score DESC);

COMMENT ON TABLE merchant_health_logs IS
    'One row per merchant per day. Written by the nightly job against the READ REPLICA; read by the internal BI tool. Never queried by the POS.';


-- 5. CHURN RISK SCORING ------------------------------------------------------
--
-- Explainable weighted model, not a black box. Every component is something a
-- CSM can act on, and the weights are visible so they can be argued with.
--
--   recency        0.40  no transactions = the strongest signal we have
--   activity       0.20  nobody signing in
--   revenue trend  0.15  still trading but shrinking
--   billing        0.15  PAST_DUE / EXPIRED
--   adoption       0.05  using one feature only = shallow, easy to replace
--   support        0.05  repeated tickets = friction
--
-- Returns 0.00 - 1.00.

CREATE OR REPLACE FUNCTION compute_churn_risk(
    p_days_since_last_txn  INT,
    p_active_days_last_7   INT,
    p_revenue_trend_pct    NUMERIC,
    p_subscription_status  VARCHAR,
    p_distinct_features    INT,
    p_support_tickets      INT
) RETURNS NUMERIC AS $$
DECLARE
    v_recency   NUMERIC := 0;
    v_activity  NUMERIC := 0;
    v_trend     NUMERIC := 0;
    v_billing   NUMERIC := 0;
    v_adoption  NUMERIC := 0;
    v_support   NUMERIC := 0;
BEGIN
    -- Recency: 0 at same-day, saturates at 14 days of silence.
    v_recency := LEAST(GREATEST(COALESCE(p_days_since_last_txn, 0), 0) / 14.0, 1.0);

    -- Activity: 7 active days = healthy, 0 = nobody opened the app.
    v_activity := 1.0 - (LEAST(GREATEST(COALESCE(p_active_days_last_7, 0), 0), 7) / 7.0);

    -- Trend: only decline counts. -50% or worse saturates.
    v_trend := LEAST(GREATEST(-COALESCE(p_revenue_trend_pct, 0), 0) / 50.0, 1.0);

    v_billing := CASE COALESCE(p_subscription_status, '')
                     WHEN 'EXPIRED'  THEN 1.0
                     WHEN 'PAST_DUE' THEN 0.7
                     WHEN 'CANCELED' THEN 1.0
                     WHEN 'TRIAL'    THEN 0.3   -- not yet committed
                     ELSE 0.0
                 END;

    -- Adoption: 5+ distinct features is sticky.
    v_adoption := 1.0 - (LEAST(GREATEST(COALESCE(p_distinct_features, 0), 0), 5) / 5.0);

    -- Support: 3+ tickets in the window saturates.
    v_support := LEAST(GREATEST(COALESCE(p_support_tickets, 0), 0) / 3.0, 1.0);

    RETURN ROUND(LEAST(
        v_recency  * 0.40 +
        v_activity * 0.20 +
        v_trend    * 0.15 +
        v_billing  * 0.15 +
        v_adoption * 0.05 +
        v_support  * 0.05
    , 1.0), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION compute_churn_risk IS
    'Explainable churn score 0.00-1.00. Weights are intentionally visible so the growth team can challenge them; recompute history after any change.';


-- 6. BI READ SURFACE ---------------------------------------------------------
--
-- The BI tool (Metabase/Retool/Appsmith) connects to the READ REPLICA using a
-- role that can only SELECT, and only from these views. Pointing a BI tool at
-- raw tables on the primary is how an analyst's accidental cross join takes the
-- cashier terminals down mid-service.

CREATE OR REPLACE VIEW v_merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id,
       h.tenant_id,
       h.log_date,
       h.daily_revenue,
       h.daily_transaction_count,
       h.active_cashiers_count,
       h.days_since_last_txn,
       h.active_days_last_7,
       h.revenue_trend_pct,
       h.distinct_features_used,
       h.support_tickets_count,
       h.subscription_status,
       h.mrr_idr,
       h.contract_mrr_idr,
       h.churn_risk_score,
       h.churn_risk_reasons,
       CASE
           WHEN h.churn_risk_score >= 0.70 THEN 'CRITICAL'
           WHEN h.churn_risk_score >= 0.45 THEN 'AT_RISK'
           WHEN h.churn_risk_score >= 0.25 THEN 'WATCH'
           ELSE 'HEALTHY'
       END AS health_band
  FROM merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;

COMMENT ON VIEW v_merchant_health_latest IS 'Most recent health row per merchant. The back-office landing table.';

CREATE OR REPLACE VIEW v_platform_mrr AS
SELECT date_trunc('month', s.current_period_start)::date AS month,
       COUNT(*) FILTER (WHERE s.status = 'ACTIVE')       AS active_subscriptions,
       COUNT(*) FILTER (WHERE s.status = 'TRIAL')        AS trials,
       COUNT(*) FILTER (WHERE s.status = 'PAST_DUE')     AS past_due,
       COALESCE(SUM(p.price_idr) FILTER (WHERE s.status = 'ACTIVE'), 0) AS mrr_idr
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
 GROUP BY 1
 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW v_feature_adoption_30d AS
SELECT e.feature_key,
       COUNT(DISTINCT e.merchant_id) AS merchants_using,
       COUNT(*)                      AS events,
       MAX(e.occurred_at)            AS last_used_at
  FROM feature_usage_events e
 WHERE e.occurred_at >= CURRENT_DATE - INTERVAL '30 days'
 GROUP BY e.feature_key
 ORDER BY merchants_using DESC;


-- 7. READ-REPLICA / OLAP ISOLATION -------------------------------------------
--
-- Physical separation is a deployment concern (streaming replication or a
-- managed read replica), but the ACCESS boundary is enforced here:
--
--   1. Provision the replica from the primary.
--   2. Point the BI tool and the nightly health job at the REPLICA only.
--   3. The POS API keeps its own credentials against the PRIMARY and must never
--      be handed `bi_readonly`.
--
-- A replica cannot accept writes, so this role is defence in depth for the case
-- where someone points it at the primary by mistake.

DO $$ BEGIN
    CREATE ROLE bi_readonly NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO bi_readonly;
GRANT SELECT ON v_merchant_health_latest, v_platform_mrr, v_feature_adoption_30d TO bi_readonly;
GRANT SELECT ON merchant_health_logs, feature_usage_events TO bi_readonly;

-- Explicitly NOT granted: users, transactions, transaction_items, customers.
-- Internal analytics runs on aggregates; raw merchant transaction rows and
-- end-customer PII stay out of the BI tool entirely.
REVOKE ALL ON internal_access_log FROM bi_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO bi_readonly;


-- 8. SEED --------------------------------------------------------------------

INSERT INTO internal_users (id, email, full_name, role)
VALUES ('int-root', 'ops@newhopepos.id', 'Platform Root', 'ROLE_SUPERADMIN')
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- ROLLBACK (uncomment to revert)
-- =============================================================================
-- DROP VIEW IF EXISTS v_feature_adoption_30d;
-- DROP VIEW IF EXISTS v_platform_mrr;
-- DROP VIEW IF EXISTS v_merchant_health_latest;
-- DROP FUNCTION IF EXISTS compute_churn_risk(INT, INT, NUMERIC, VARCHAR, INT, INT);
-- DROP TABLE IF EXISTS merchant_health_logs;
-- DROP TABLE IF EXISTS feature_usage_events;
-- DROP TABLE IF EXISTS internal_access_log;
-- DROP TABLE IF EXISTS internal_users;
-- DROP TYPE IF EXISTS internal_role_enum;
-- DROP ROLE IF EXISTS bi_readonly;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0004_internal_backoffice.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 06: migrations/0005_uuid_keys.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0005_uuid_keys.sql
-- DECISION: surrogate keys become UUIDv7. Business identifiers stay readable.
-- =============================================================================
--
-- This reverses the position taken in 0003 (decision b) and 0004. That earlier
-- call was "keep VARCHAR(64) because everything already uses it" — correct given
-- what was known then. Two facts since change the answer:
--
--   1. IDs ARE GENERATED ON THE CLIENT, FROM Date.now() ALONE.
--      Fourteen entity types do it: att-, branch-, cust-, inv-, log-, prod-,
--      shift-, slot-, stf-, stk-, sub- and more. The product spec requires the
--      cashier terminal to be OFFLINE-FIRST. Two terminals offline in the same
--      millisecond therefore mint the SAME id. On sync that is a primary-key
--      violation at best and a silent overwrite of someone's transaction at
--      worst. A single-outlet demo never sees it; a 5-outlet Pro merchant will.
--      No amount of care in application code fixes a 48-bit-of-entropy id.
--
--   2. Sequential ids leak and enumerate. 'INV-20260811-0004' printed on a
--      receipt tells anyone holding it exactly how many sales that merchant made
--      that day. 'usr-2' and 'tenant-3' are guessable in URLs shared between
--      merchants and our own support staff.
--
-- And the cost will never be lower than today: there is no deployed Postgres.
-- Merchant data lives in browsers. Every month of delay adds installs whose
-- localStorage holds string ids.
--
-- -----------------------------------------------------------------------------
-- THE RULE (so this is a decision, not a half-measure)
-- -----------------------------------------------------------------------------
--   UUID v7   ->  anything client-generatable, tenant-scoped, or high-volume.
--                 Surrogate keys. Never shown to a human.
--
--   VARCHAR   ->  STATIC CONFIG rows that live in code, are never generated at
--                 runtime, never sync, and are not tenant data. Exactly one
--                 table qualifies: `plans` ('plan-pro-monthly'). Three rows,
--                 referenced by name in server.ts.
--
--   VARCHAR   ->  HUMAN-FACING BUSINESS IDENTIFIERS, kept as their own UNIQUE
--                 column beside the UUID key — never as the key itself:
--                 invoice_number, sku, barcode, plan code.
--                 Support staff and receipts keep something readable; the
--                 database keeps something safe.
--
-- v7 rather than v4: v4 is random, which scatters B-tree inserts and bloats
-- high-write tables like transactions. v7 is time-ordered, so inserts stay
-- local while remaining globally unique. Native in PostgreSQL 18.
--
-- -----------------------------------------------------------------------------
-- SAFETY
-- -----------------------------------------------------------------------------
-- `legacy_uuid()` maps an old string id to a UUID DETERMINISTICALLY. Running
-- this migration twice, or migrating a browser's localStorage separately,
-- produces the same UUID for the same input — so existing data keeps its
-- relationships instead of being orphaned.
--
-- Run inside a transaction:
--   psql "$DATABASE_URL" --single-transaction -f migrations/0005_uuid_keys.sql
-- =============================================================================


-- 1. DETERMINISTIC LEGACY MAPPING --------------------------------------------

CREATE OR REPLACE FUNCTION legacy_uuid(p_legacy TEXT)
RETURNS UUID AS $$
DECLARE
    h TEXT;
BEGIN
    IF p_legacy IS NULL THEN
        RETURN NULL;
    END IF;

    -- Already a UUID? Pass through unchanged so the migration is re-runnable.
    IF p_legacy ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN p_legacy::uuid;
    END IF;

    -- Namespaced md5 so 'usr-1' in this platform can never collide with 'usr-1'
    -- from an unrelated system, and set the version/variant nibbles so the
    -- result is a well-formed v5-style UUID.
    h := md5('newhope-pos:' || p_legacy);

    RETURN (
        substr(h, 1, 8)  || '-' ||
        substr(h, 9, 4)  || '-5' ||
        substr(h, 14, 3) || '-' ||
        to_hex((('x' || substr(h, 17, 2))::bit(8)::int & 63) | 128) || substr(h, 19, 2) || '-' ||
        substr(h, 21, 12)
    )::uuid;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION legacy_uuid IS
    'Stable string-id -> UUID mapping. Same input always yields the same UUID, so server tables and a browser localStorage migration agree without coordination.';


-- 2. PRESERVE HUMAN-FACING IDENTIFIERS ---------------------------------------
-- Before the keys change, copy anything a human reads into its own column.

DO $$
BEGIN
    IF to_regclass('public.transactions') IS NOT NULL THEN
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(32);
        -- The old id WAS the invoice number ('INV-20260811-0004'). Keep it.
        EXECUTE 'UPDATE transactions SET invoice_number = id::text WHERE invoice_number IS NULL';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_invoice_number
            ON transactions (tenant_id, invoice_number);
        COMMENT ON COLUMN transactions.invoice_number IS
            'Human-facing receipt number. Printed, quoted by customers, searched by support. Unique per tenant — deliberately NOT the primary key.';
    END IF;

    IF to_regclass('public.plans') IS NOT NULL THEN
        ALTER TABLE plans ADD COLUMN IF NOT EXISTS code VARCHAR(64);
        EXECUTE 'UPDATE plans SET code = id::text WHERE code IS NULL';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_code ON plans (code);
    END IF;
END $$;


-- 2b. DROP DEPENDENT VIEWS ---------------------------------------------------
-- PostgreSQL refuses to alter a column's type while a view selects it. The BI
-- views from 0004 are rebuilt verbatim in section 6 once the keys are UUID.

DROP VIEW IF EXISTS v_merchant_health_latest;
DROP VIEW IF EXISTS v_platform_mrr;
DROP VIEW IF EXISTS v_feature_adoption_30d;


-- 3. KEY CONVERSION ----------------------------------------------------------
--
-- Driven by an explicit list rather than 20 hand-written blocks: the list is
-- auditable at a glance and cannot drift out of step with itself.
--
-- `plans` is absent on purpose — see THE RULE above.

-- A hand-written column list is guaranteed to miss something: the first attempt
-- omitted transactions.cashier_user_id -> users.id and the migration failed when
-- the foreign key could not be rebuilt across a uuid/varchar mismatch.
--
-- So only the KEYS are declared below. Every column that REFERENCES one of these
-- tables is discovered from pg_constraint and converted automatically, which
-- makes it impossible for the two sides of a foreign key to drift apart.

DO $$
DECLARE
    -- table, column, is_primary
    targets TEXT[][] := ARRAY[
        ['tenants','id','1'],
        ['users','id','1'], ['users','tenant_id','0'],
        ['ingredients','id','1'], ['ingredients','tenant_id','0'],
        ['products','id','1'], ['products','tenant_id','0'],
        ['product_recipes','id','1'], ['product_recipes','tenant_id','0'],
        ['product_recipes','product_id','0'], ['product_recipes','ingredient_id','0'],
        ['transactions','id','1'], ['transactions','tenant_id','0'],
        ['transaction_items','id','1'], ['transaction_items','tenant_id','0'],
        ['transaction_items','transaction_id','0'], ['transaction_items','product_id','0'],
        ['inventory_logs','id','1'], ['inventory_logs','tenant_id','0'],
        ['subscriptions','id','1'], ['subscriptions','tenant_id','0'],
        ['invoices','id','1'], ['invoices','tenant_id','0'], ['invoices','subscription_id','0'],
        ['daily_merchant_insights','id','1'],
        ['daily_merchant_insights','merchant_id','0'], ['daily_merchant_insights','tenant_id','0'],
        ['merchant_targets','merchant_id','1'], ['merchant_targets','tenant_id','0'],
        ['merchant_ai_credits','merchant_id','1'], ['merchant_ai_credits','tenant_id','0'],
        ['batch_job_runs','id','1'], ['batch_job_runs','merchant_id','0'],
        ['ai_query_logs','id','1'], ['ai_query_logs','merchant_id','0'], ['ai_query_logs','tenant_id','0'],
        ['merchant_health_logs','id','1'],
        ['merchant_health_logs','merchant_id','0'], ['merchant_health_logs','tenant_id','0'],
        ['feature_usage_events','merchant_id','0'], ['feature_usage_events','tenant_id','0'],
        ['internal_users','id','1'],
        ['internal_access_log','id','1'], ['internal_access_log','internal_user_id','0'],
        ['internal_access_log','merchant_id','0']
    ];
    t TEXT; c TEXT; idx INT;
    tbl_names TEXT[] := ARRAY[]::TEXT[];
    fk RECORD;
    dropped TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Distinct table names touched by this migration.
    FOR idx IN 1 .. array_length(targets, 1) LOOP
        IF NOT (targets[idx][1] = ANY (tbl_names)) THEN
            tbl_names := tbl_names || targets[idx][1];
        END IF;
    END LOOP;

    -- 3a. Discover every column that REFERENCES a table being converted, and
    --     append it to the conversion set. This is what stops one side of a
    --     foreign key from being left behind as VARCHAR.
    FOR fk IN
        SELECT con.conrelid::regclass::text AS tbl,
               att.attname::text            AS col
          FROM pg_constraint con
          JOIN unnest(con.conkey) AS k(attnum) ON TRUE
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid AND att.attnum = k.attnum
         WHERE con.contype = 'f'
           AND con.confrelid::regclass::text = ANY (tbl_names)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM generate_subscripts(targets, 1) s
             WHERE targets[s][1] = fk.tbl AND targets[s][2] = fk.col
        ) THEN
            targets := targets || ARRAY[ARRAY[fk.tbl, fk.col, '0']];
            RAISE NOTICE '0005: auto-added FK column %.% to the conversion set', fk.tbl, fk.col;
        END IF;
    END LOOP;

    -- 3a-ii. Drop every FK touching a table we are about to rewrite. Postgres
    --        will not let a referenced column change type while one holds it.
    FOR fk IN
        SELECT con.conname, con.conrelid::regclass::text AS tbl,
               pg_get_constraintdef(con.oid) AS def
          FROM pg_constraint con
         WHERE con.contype = 'f'
           AND (con.conrelid::regclass::text = ANY (tbl_names)
             OR con.confrelid::regclass::text = ANY (tbl_names))
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
        dropped := dropped || (fk.tbl || '|' || fk.conname || '|' || fk.def);
    END LOOP;

    -- 3b. Convert each column in place, mapping existing values deterministically.
    FOR idx IN 1 .. array_length(targets, 1) LOOP
        t := targets[idx][1];
        c := targets[idx][2];
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = t AND column_name = c AND data_type <> 'uuid'
        );

        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', t, c);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE UUID USING legacy_uuid(%I::text)', t, c, c);

        IF targets[idx][3] = '1' THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT uuidv7()', t, c);
        END IF;

        RAISE NOTICE '0005: %.% -> uuid', t, c;
    END LOOP;

    -- 3c. Put the foreign keys back exactly as they were.
    FOREACH t IN ARRAY dropped LOOP
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',
                       split_part(t, '|', 1), split_part(t, '|', 2), split_part(t, '|', 3));
    END LOOP;
END $$;


-- 4. PLAN REFERENCES ---------------------------------------------------------
-- `subscriptions.plan_id` still points at the readable plan code, which is
-- correct: plans are static config, not tenant data.

COMMENT ON COLUMN subscriptions.plan_id IS
    'References plans.id, which stays a readable code (plan-pro-monthly) by design. See THE RULE in 0005.';


-- 6. REBUILD BI VIEWS --------------------------------------------------------
-- Identical to 0004 §6; recreated here because the key conversion required
-- dropping them. Keep the two definitions in step.

CREATE OR REPLACE VIEW v_merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id, h.tenant_id, h.log_date,
       h.daily_revenue, h.daily_transaction_count, h.active_cashiers_count,
       h.days_since_last_txn, h.active_days_last_7, h.revenue_trend_pct,
       h.distinct_features_used, h.support_tickets_count,
       h.subscription_status, h.mrr_idr, h.contract_mrr_idr,
       h.churn_risk_score, h.churn_risk_reasons,
       CASE
           WHEN h.churn_risk_score >= 0.70 THEN 'CRITICAL'
           WHEN h.churn_risk_score >= 0.45 THEN 'AT_RISK'
           WHEN h.churn_risk_score >= 0.25 THEN 'WATCH'
           ELSE 'HEALTHY'
       END AS health_band
  FROM merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;

CREATE OR REPLACE VIEW v_platform_mrr AS
SELECT date_trunc('month', s.current_period_start)::date AS month,
       COUNT(*) FILTER (WHERE s.status = 'ACTIVE')   AS active_subscriptions,
       COUNT(*) FILTER (WHERE s.status = 'TRIAL')    AS trials,
       COUNT(*) FILTER (WHERE s.status = 'PAST_DUE') AS past_due,
       COALESCE(SUM(p.price_idr) FILTER (WHERE s.status = 'ACTIVE'), 0) AS mrr_idr
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
 GROUP BY 1
 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW v_feature_adoption_30d AS
SELECT e.feature_key,
       COUNT(DISTINCT e.merchant_id) AS merchants_using,
       COUNT(*)                      AS events,
       MAX(e.occurred_at)            AS last_used_at
  FROM feature_usage_events e
 WHERE e.occurred_at >= CURRENT_DATE - INTERVAL '30 days'
 GROUP BY e.feature_key
 ORDER BY merchants_using DESC;

GRANT SELECT ON v_merchant_health_latest, v_platform_mrr, v_feature_adoption_30d TO bi_readonly;


-- 5. APPLICATION CONTRACT ----------------------------------------------------
--
-- The client must stop minting ids from Date.now(). Replace every
-- `${prefix}-${Date.now()}` with crypto.randomUUID() (available in every browser
-- this POS targets, and in Node 19+). Until that ships, `legacy_uuid()` keeps
-- old rows addressable, but two offline terminals can still collide BEFORE the
-- data reaches Postgres — the collision happens in localStorage, where this
-- migration cannot reach.
--
-- Tracking: src/lib/ids.ts provides newId(); see scripts/dev/check-source-hygiene.mjs
-- which fails the build if a `-${Date.now()}` id pattern reappears.


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- There is no clean automatic rollback: legacy_uuid() is one-way (md5).
-- To revert, restore from the pre-migration backup. Take one first:
--   pg_dump "$DATABASE_URL" -Fc -f pre-0005.dump
-- DROP FUNCTION IF EXISTS legacy_uuid(TEXT);

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0005_uuid_keys.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 07: migrations/0006_merchant_activity.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0006_merchant_activity.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 08: migrations/0007_product_description.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0007_product_description.sql
--
-- Deskripsi produk: dari katalog merchant sampai ke baris struk.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0007_product_description.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KATALOG ------------------------------------------------------------------
--
-- VARCHAR(300), bukan TEXT. Ini teks yang harus muat di kartu produk kasir dan
-- di struk termal 58mm; batas yang dipaksakan database membuat pemotongan
-- terjadi saat pengetikan — di tempat penulisnya masih bisa memperbaiki
-- kalimat — bukan saat pencetakan, ketika satu-satunya pilihan tinggal
-- memotong di tengah kata.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS description VARCHAR(300);

COMMENT ON COLUMN products.description IS
    'Deskripsi produk yang tampil di kartu kasir dan struk digital. Opsional; NULL, bukan string kosong, ketika tidak diisi.';


-- 2. SNAPSHOT DI BARIS STRUK --------------------------------------------------
--
-- Alasannya sama persis dengan product_name, unit_price, dan unit_cost di 0006:
-- struk adalah catatan tentang apa yang dijual PADA SAAT ITU. Kalau deskripsi
-- di-join dari katalog, mengubah satu kalimat pemasaran hari ini akan menulis
-- ulang setiap struk yang pernah dicetak — termasuk yang sudah dipegang
-- pelanggan.

ALTER TABLE transaction_items
    ADD COLUMN IF NOT EXISTS product_description VARCHAR(300);

COMMENT ON COLUMN transaction_items.product_description IS
    'Salinan deskripsi saat transaksi terjadi. Sengaja tidak di-join ke products.';


-- 3. PENCARIAN ----------------------------------------------------------------
--
-- Panel dan aplikasi kasir sama-sama mencari produk lewat ILIKE '%kata%'.
-- Pola berawalan wildcard tidak bisa memakai index B-tree biasa sama sekali —
-- Postgres akan memindai seluruh tabel. Index trigram melayaninya.
--
-- pg_trgm tidak selalu tersedia (PGlite, atau Postgres terkelola yang membatasi
-- ekstensi), jadi kegagalannya ditangkap dan dilewati. Tanpa index, pencarian
-- tetap benar — hanya lebih lambat pada katalog besar.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE INDEX IF NOT EXISTS idx_products_search_trgm
        ON products USING GIN ((name || ' ' || COALESCE(description, '')) gin_trgm_ops);

    RAISE NOTICE '0007: index trigram pencarian produk dibuat';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '0007: pg_trgm tidak tersedia (%) — pencarian tetap jalan tanpa index', SQLERRM;
END $$;


-- 4. VIEW PRODUK TERJUAL ------------------------------------------------------
-- Dibangun ulang agar deskripsi ikut terbawa ke admin panel.

DROP VIEW IF EXISTS v_product_sales_by_sector CASCADE;
CREATE VIEW v_product_sales_by_sector AS
SELECT
    i.business_sector,
    x.tenant_id                                       AS merchant_id,
    t.name                                            AS merchant_name,
    i.product_id,
    i.product_name,
    i.category_name,
    -- Deskripsi terbaru yang tercatat di struk, bukan yang ada di katalog
    -- sekarang: sebuah produk boleh saja sudah dihapus dari katalog.
    (ARRAY_AGG(i.product_description ORDER BY x.created_at DESC)
        FILTER (WHERE i.product_description IS NOT NULL))[1] AS product_description,
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
    'Produk apa saja yang terjual, per sektor per merchant. Nama dan deskripsi diambil dari snapshot baris struk, bukan dari katalog.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON v_product_sales_by_sector TO bi_readonly;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0007_product_description.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 09: migrations/0008_catalog_and_charges.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0008_catalog_and_charges.sql
--
-- Dua kekurangan yang sebelumnya ditambal di sisi aplikasi, sekarang diperbaiki
-- di tempat yang benar:
--
--   1. Service charge dilipat ke dalam pajak karena tidak ada kolomnya. Totalnya
--      benar, tapi merchant tidak bisa menjawab "berapa yang saya kutip sebagai
--      service charge bulan ini" — dan itu angka yang dilaporkan ke pajak
--      secara terpisah.
--
--   2. Produk hanya sampai ke database kalau ia TERJUAL. Katalog di panel selalu
--      lebih sedikit daripada yang dilihat merchant, dan produk yang tidak
--      pernah laku — justru yang paling perlu diketahui — tidak pernah muncul
--      sama sekali.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0008_catalog_and_charges.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. SERVICE CHARGE -----------------------------------------------------------

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN transactions.service_charge_amount IS
    'Biaya layanan, terpisah dari tax_amount. Baris yang ditulis sebelum 0008 mencatatnya di dalam tax_amount dan tidak bisa dipisah lagi secara retroaktif.';


-- 2. KATALOG ------------------------------------------------------------------
--
-- Stok tinggal di products, bukan di tabel tersendiri. Alasannya: yang dibutuhkan
-- panel adalah POSISI stok terkini untuk peringatan "menipis", bukan riwayat
-- mutasinya — dan riwayat itu sudah ada di inventory_logs.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS stock             NUMERIC(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_stock_alert   NUMERIC(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unit              VARCHAR(20),
    -- Kapan katalog ini terakhir dikirim perangkat. Membedakan "produk memang
    -- tidak ada" dari "merchant belum pernah menyinkronkan katalognya" — dua
    -- hal yang terlihat identik di layar kalau tidak dicatat.
    ADD COLUMN IF NOT EXISTS catalog_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_products_low_stock
    ON products (tenant_id)
    WHERE stock <= min_stock_alert;


-- 3. VIEW KATALOG -------------------------------------------------------------
--
-- Berbeda dari v_product_sales_by_sector: view itu berangkat dari baris struk,
-- jadi produk yang tidak pernah terjual mustahil muncul di sana. View ini
-- berangkat dari katalog dan menempelkan penjualannya — sehingga nol penjualan
-- justru terlihat.

DROP VIEW IF EXISTS v_catalog_by_sector CASCADE;
CREATE VIEW v_catalog_by_sector AS
SELECT
    p.business_sector,
    p.tenant_id                                    AS merchant_id,
    t.name                                         AS merchant_name,
    p.id                                           AS product_id,
    p.name                                         AS product_name,
    p.sku,
    p.category_name,
    p.description,
    p.price,
    p.cost_price,
    CASE WHEN p.price > 0
         THEN ROUND(((p.price - p.cost_price) / p.price) * 100, 1)
         ELSE 0 END                                AS margin_pct,
    p.stock,
    p.min_stock_alert,
    p.stock <= p.min_stock_alert                   AS is_low_stock,
    p.is_available,
    p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM products p
  JOIN tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)    AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(x.created_at)  AS last_sold_at
          FROM transaction_items i
          JOIN transactions x ON x.id = i.transaction_id
         WHERE x.payment_status <> 'CANCELLED'
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;

COMMENT ON VIEW v_catalog_by_sector IS
    'Seluruh katalog per sektor, termasuk produk yang belum pernah terjual. Berangkat dari products, bukan dari baris struk.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON v_catalog_by_sector TO bi_readonly;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0008_catalog_and_charges.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 10: migrations/0009_service_schemas.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0009_service_schemas.sql
--
-- Memecah satu skema `public` menjadi empat domain, satu per service.
--
--   pos       -> pos-service        (transaksi, katalog, staf, jejak aktivitas)
--   billing   -> billing-service    (paket, langganan, faktur, webhook)
--   ai        -> ai-service         (insight, kredit, log query, target)
--   internal  -> backoffice-service (identitas internal, audit, health merchant)
--
-- -----------------------------------------------------------------------------
-- KENAPA SATU DATABASE, BUKAN EMPAT
-- -----------------------------------------------------------------------------
-- Empat database membuat pemisahannya murni, tapi menghancurkan satu hal yang
-- sudah dibuktikan bekerja: AI Copilot dan admin panel melaporkan angka yang
-- SAMA PERSIS karena membaca definisi omzet yang sama. Dengan database terpisah,
-- kesamaan itu harus dijaga lewat replikasi event — dan sejak saat itu
-- "berapa omzet saya" punya dua jawaban yang bisa berbeda selama replikasi
-- tertinggal.
--
-- Satu database dengan skema terpisah memberi batas yang NYATA — ditegakkan
-- oleh hak akses, bukan kesepakatan — sambil mempertahankan konsistensi baca.
--
-- -----------------------------------------------------------------------------
-- KONTRAK ANTAR-SERVICE ADALAH VIEW, BUKAN TABEL
-- -----------------------------------------------------------------------------
-- Service lain TIDAK PERNAH diberi akses ke tabel milik service lain. Yang
-- dibagikan hanya view di skema `contract`. Konsekuensinya disengaja: pemilik
-- boleh mengubah bentuk tabelnya kapan saja selama view-nya tetap utuh, dan
-- perubahan yang merusak akan ketahuan saat migrasi dijalankan — bukan saat
-- service lain error di produksi.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0009_service_schemas.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. SKEMA --------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS pos;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS internal;
-- Satu-satunya skema yang boleh dibaca lintas service.
CREATE SCHEMA IF NOT EXISTS contract;

COMMENT ON SCHEMA contract IS
    'Permukaan baca antar-service. Hanya view. Mengubah isinya berarti mengubah kontrak publik — perlakukan seperti API versi.';


-- 2. PEMINDAHAN TABEL ---------------------------------------------------------
--
-- View lama di `public` menunjuk tabel-tabel ini dan akan menghalangi ALTER,
-- jadi dibuang lebih dulu. Semuanya dibangun ulang di Bagian 4 sebagai kontrak.

DROP VIEW IF EXISTS public.v_sector_summary          CASCADE;
DROP VIEW IF EXISTS public.v_merchant_directory      CASCADE;
DROP VIEW IF EXISTS public.v_product_sales_by_sector CASCADE;
DROP VIEW IF EXISTS public.v_activity_by_sector      CASCADE;
DROP VIEW IF EXISTS public.v_daily_sector_revenue    CASCADE;
DROP VIEW IF EXISTS public.v_catalog_by_sector       CASCADE;
DROP VIEW IF EXISTS public.v_merchant_health_latest  CASCADE;
DROP VIEW IF EXISTS public.v_platform_mrr            CASCADE;
DROP VIEW IF EXISTS public.v_feature_adoption_30d    CASCADE;

DO $$
DECLARE
    moves TEXT[][] := ARRAY[
        -- pos
        ['tenants','pos'], ['users','pos'], ['products','pos'], ['ingredients','pos'],
        ['product_recipes','pos'], ['transactions','pos'], ['transaction_items','pos'],
        ['inventory_logs','pos'], ['sync_receipts','pos'], ['merchant_activity_log','pos'],
        -- billing
        ['plans','billing'], ['subscriptions','billing'], ['invoices','billing'],
        ['webhook_logs','billing'],
        -- ai
        ['daily_merchant_insights','ai'], ['merchant_ai_credits','ai'],
        ['ai_query_logs','ai'], ['merchant_targets','ai'], ['batch_job_runs','ai'],
        -- internal
        ['internal_users','internal'], ['internal_access_log','internal'],
        ['feature_usage_events','internal'], ['merchant_health_logs','internal']
    ];
    m TEXT[];
BEGIN
    FOREACH m SLICE 1 IN ARRAY moves LOOP
        IF to_regclass('public.' || m[1]) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', m[1], m[2]);
            RAISE NOTICE '0009: public.% -> %.%', m[1], m[2], m[1];
        END IF;
    END LOOP;
END $$;

-- schema_migrations tetap di public: dimiliki alat migrasi, bukan service.


-- 3. FUNGSI -------------------------------------------------------------------
-- legacy_uuid dan compute_churn_risk dipakai lintas domain; biarkan di public
-- dan pastikan search_path setiap service menyertakannya.


-- 4. KONTRAK ------------------------------------------------------------------
--
-- Inilah satu-satunya yang boleh dibaca service lain.

-- 4a. Sumber angka omzet TUNGGAL untuk seluruh platform.
--
-- Sebelum pemecahan ini, AI Copilot dan admin panel sama-sama menulis SQL
-- omzetnya sendiri dan saya menjaganya tetap identik secara manual — satu kata
-- berbeda dan keduanya diam-diam melaporkan angka berbeda. Sekarang keduanya
-- WAJIB lewat view ini. Kesamaannya menjadi sifat struktural, bukan disiplin.
DROP VIEW IF EXISTS contract.merchant_revenue CASCADE;
CREATE VIEW contract.merchant_revenue AS
SELECT
    x.tenant_id                                       AS merchant_id,
    x.business_sector,
    x.business_id,
    x.id                                              AS transaction_id,
    x.total_amount,
    x.subtotal,
    x.discount_amount,
    x.tax_amount,
    x.service_charge_amount,
    x.payment_method,
    x.app_module,
    x.order_type,
    x.cashier_user_id,
    x.created_at
  FROM pos.transactions x
 WHERE x.payment_status <> 'CANCELLED';

COMMENT ON VIEW contract.merchant_revenue IS
    'Definisi tunggal "transaksi yang dihitung sebagai omzet". Semua service WAJIB memakai ini, tidak boleh menyaring payment_status sendiri.';


DROP VIEW IF EXISTS contract.merchant_directory CASCADE;
CREATE VIEW contract.merchant_directory AS
SELECT
    t.id                                              AS merchant_id,
    t.name                                            AS merchant_name,
    t.business_sector,
    t.external_ref                                    AS business_id,
    t.owner_user_ref,
    t.is_active,
    t.created_at                                      AS joined_at,
    COUNT(r.transaction_id)                           AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    MAX(r.created_at)                                 AS last_transaction_at,
    COUNT(DISTINCT r.business_id)                     AS business_unit_count,
    COUNT(DISTINCT r.cashier_user_id)                 AS distinct_cashiers
  FROM pos.tenants t
  LEFT JOIN contract.merchant_revenue r ON r.merchant_id = t.id
 GROUP BY t.id, t.name, t.business_sector, t.external_ref, t.owner_user_ref,
          t.is_active, t.created_at;


DROP VIEW IF EXISTS contract.sector_summary CASCADE;
CREATE VIEW contract.sector_summary AS
SELECT
    r.business_sector,
    COUNT(DISTINCT r.merchant_id)                     AS merchant_count,
    COUNT(DISTINCT r.business_id)                     AS business_unit_count,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    COALESCE(AVG(r.total_amount), 0)                  AS avg_basket,
    COALESCE(SUM(r.discount_amount), 0)               AS total_discount,
    MAX(r.created_at)                                 AS last_transaction_at
  FROM contract.merchant_revenue r
 GROUP BY r.business_sector;


DROP VIEW IF EXISTS contract.daily_sector_revenue CASCADE;
CREATE VIEW contract.daily_sector_revenue AS
SELECT
    r.business_sector,
    (r.created_at AT TIME ZONE 'Asia/Jakarta')::date  AS sales_date,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    COUNT(DISTINCT r.merchant_id)                     AS active_merchants
  FROM contract.merchant_revenue r
 GROUP BY r.business_sector, (r.created_at AT TIME ZONE 'Asia/Jakarta')::date;


DROP VIEW IF EXISTS contract.product_sales CASCADE;
CREATE VIEW contract.product_sales AS
SELECT
    i.business_sector,
    r.merchant_id,
    t.name                                            AS merchant_name,
    i.product_id,
    i.product_name,
    i.category_name,
    (ARRAY_AGG(i.product_description ORDER BY r.created_at DESC)
        FILTER (WHERE i.product_description IS NOT NULL))[1] AS product_description,
    SUM(i.quantity)                                   AS units_sold,
    SUM(i.total_price)                                AS revenue,
    SUM(i.unit_cost * i.quantity)                     AS cogs,
    SUM(i.total_price) - SUM(i.unit_cost * i.quantity) AS gross_profit,
    COUNT(DISTINCT i.transaction_id)                  AS appeared_in_transactions,
    MAX(r.created_at)                                 AS last_sold_at
  FROM pos.transaction_items i
  JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
  JOIN pos.tenants t               ON t.id = r.merchant_id
 GROUP BY i.business_sector, r.merchant_id, t.name,
          i.product_id, i.product_name, i.category_name;


DROP VIEW IF EXISTS contract.catalog CASCADE;
CREATE VIEW contract.catalog AS
SELECT
    p.business_sector,
    p.tenant_id                                    AS merchant_id,
    t.name                                         AS merchant_name,
    p.id                                           AS product_id,
    p.name                                         AS product_name,
    p.sku, p.category_name, p.description, p.price, p.cost_price,
    CASE WHEN p.price > 0
         THEN ROUND(((p.price - p.cost_price) / p.price) * 100, 1)
         ELSE 0 END                                AS margin_pct,
    p.stock, p.min_stock_alert,
    p.stock <= p.min_stock_alert                   AS is_low_stock,
    p.is_available, p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM pos.products p
  JOIN pos.tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)   AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(r.created_at)  AS last_sold_at
          FROM pos.transaction_items i
          JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;


DROP VIEW IF EXISTS contract.activity_by_sector CASCADE;
CREATE VIEW contract.activity_by_sector AS
SELECT a.business_sector, a.app_module, a.event_type, a.severity,
       COUNT(*)                      AS event_count,
       COUNT(DISTINCT a.merchant_id) AS merchants_affected,
       MAX(a.occurred_at)            AS last_seen_at
  FROM pos.merchant_activity_log a
 GROUP BY a.business_sector, a.app_module, a.event_type, a.severity;


-- Log transaksi untuk admin panel. Nama merchant dan kasir ikut di-join di sini,
-- bukan di service pemanggil: kalau tidak, backoffice butuh akses ke pos.tenants
-- dan pos.users — dan seluruh batas ini runtuh demi dua kolom nama.
DROP VIEW IF EXISTS contract.transaction_log CASCADE;
CREATE VIEW contract.transaction_log AS
SELECT
    r.transaction_id                                  AS id,
    r.merchant_id,
    t.name                                            AS merchant_name,
    r.business_sector,
    r.business_id,
    r.app_module,
    r.order_type,
    r.payment_method,
    r.total_amount, r.subtotal, r.discount_amount,
    r.tax_amount, r.service_charge_amount,
    r.created_at,
    x.invoice_number,
    x.payment_status,
    u.name                                            AS cashier_name,
    (SELECT COUNT(*) FROM pos.transaction_items i WHERE i.transaction_id = r.transaction_id)
                                                      AS item_count
  FROM contract.merchant_revenue r
  JOIN pos.transactions x ON x.id = r.transaction_id
  JOIN pos.tenants      t ON t.id = r.merchant_id
  LEFT JOIN pos.users   u ON u.id = r.cashier_user_id;


DROP VIEW IF EXISTS contract.transaction_items CASCADE;
CREATE VIEW contract.transaction_items AS
SELECT i.transaction_id, i.product_name, i.product_description, i.category_name,
       i.business_sector, i.quantity, i.unit_price, i.unit_cost, i.total_price
  FROM pos.transaction_items i;


DROP VIEW IF EXISTS contract.activity_log CASCADE;
CREATE VIEW contract.activity_log AS
SELECT a.id, a.merchant_id, t.name AS merchant_name,
       a.business_sector, a.business_id, a.app_module, a.event_type, a.severity,
       a.actor_name, a.actor_role, a.transaction_id, a.amount_idr,
       a.summary, a.detail, a.occurred_at
  FROM pos.merchant_activity_log a
  JOIN pos.tenants t ON t.id = a.merchant_id;


-- Ringkasan stok untuk AI Copilot. Tanpa view ini, ai-service harus membaca
-- pos.products langsung hanya untuk menghitung berapa produk yang menipis.
DROP VIEW IF EXISTS contract.stock_status CASCADE;
CREATE VIEW contract.stock_status AS
SELECT p.tenant_id                                    AS merchant_id,
       p.business_sector,
       p.id                                           AS product_id,
       p.name                                         AS product_name,
       p.stock, p.min_stock_alert, p.is_available, p.catalog_synced_at,
       p.stock <= p.min_stock_alert                   AS is_low_stock
  FROM pos.products p;


-- Billing membuka status langganan; backoffice butuh untuk MRR dan churn.
DROP VIEW IF EXISTS contract.subscription_status CASCADE;
CREATE VIEW contract.subscription_status AS
SELECT s.tenant_id                    AS merchant_id,
       s.status,
       s.current_period_end,
       p.id                           AS plan_code,
       p.name                         AS plan_name,
       p.price_idr                    AS contract_mrr_idr,
       CASE WHEN s.status = 'ACTIVE' THEN p.price_idr ELSE 0 END AS recognised_mrr_idr
  FROM billing.subscriptions s
  JOIN billing.plans p ON p.id = s.plan_id;


DROP VIEW IF EXISTS contract.merchant_health_latest CASCADE;
CREATE VIEW contract.merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id, h.tenant_id, h.log_date, h.daily_revenue,
       h.days_since_last_txn, h.active_days_last_7, h.revenue_trend_pct,
       h.distinct_features_used, h.support_tickets_count,
       h.subscription_status, h.mrr_idr, h.contract_mrr_idr,
       h.churn_risk_score, h.churn_risk_reasons
  FROM internal.merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;


-- 5. PERAN & HAK AKSES --------------------------------------------------------
--
-- Di sinilah batasnya berhenti menjadi kesepakatan dan menjadi aturan. Tiap
-- service login sebagai perannya sendiri; menyentuh tabel milik service lain
-- akan ditolak Postgres, bukan sekadar ditegur saat code review.

DO $$
DECLARE
    r RECORD;
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    FOREACH svc IN ARRAY services LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', 'svc_' || svc);
        END IF;

        -- Penuh atas skema sendiri.
        EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', svc, 'svc_' || svc);
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO %I', svc, 'svc_' || svc);
        EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO %I', svc, 'svc_' || svc);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO %I', svc, 'svc_' || svc);

        -- Baca saja atas kontrak bersama.
        EXECUTE format('GRANT USAGE ON SCHEMA contract TO %I', 'svc_' || svc);
        EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA contract TO %I', 'svc_' || svc);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA contract GRANT SELECT ON TABLES TO %I',
            'svc_' || svc);

        -- Fungsi bersama di public.
        EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', 'svc_' || svc);
    END LOOP;

    -- View kontrak harus membaca tabel dasarnya. View di PostgreSQL berjalan
    -- dengan hak PEMBUATNYA (security definer secara implisit), jadi pemberian
    -- di atas sudah cukup — tanpa itu setiap SELECT lintas domain gagal.

    -- Metabase / BI: baca kontrak saja, tidak pernah tabel mentah.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT USAGE ON SCHEMA contract TO bi_readonly;
        GRANT SELECT ON ALL TABLES IN SCHEMA contract TO bi_readonly;
        ALTER DEFAULT PRIVILEGES IN SCHEMA contract GRANT SELECT ON TABLES TO bi_readonly;
    END IF;
END $$;


-- 6. KOMPATIBILITAS ------------------------------------------------------------
--
-- Skrip batch dan alat lama masih menulis `SELECT ... FROM transactions` tanpa
-- prefiks skema. search_path di bawah menjaganya tetap jalan sampai semuanya
-- dipindahkan. Ini jembatan, bukan tujuan akhir — hapus setelah tidak ada lagi
-- pemanggil tanpa prefiks.

DO $$
BEGIN
    EXECUTE format(
        'ALTER DATABASE %I SET search_path TO pos, billing, ai, internal, contract, public',
        current_database()
    );
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE '0009: tidak bisa mengubah search_path database; setel per koneksi.';
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0009_service_schemas.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 11: migrations/0010_credit_uuid.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0010_credit_uuid.sql
--
-- Memperbaiki dua cacat yang saling menutupi sejak 0005.
--
-- 1. `merchant_ai_credits.merchant_id` diubah 0005 menjadi UUID, tapi fungsi
--    `consume_ai_credit(VARCHAR)` dan `refund_ai_credit(VARCHAR)` tidak ikut
--    diubah. Setiap pemanggilan gagal dengan "operator does not exist:
--    uuid = character varying".
--
--    Cacat ini tidak pernah muncul selama dompet kredit masih disimpan di
--    memori — fungsinya memang tidak pernah dipanggil. Begitu dompet
--    dipindahkan ke database, seluruh jalur kredit AI mati.
--
-- 2. AI Copilot mengenali merchant lewat string bebas (`usr-budi`), bukan UUID
--    tenant. `legacy_uuid()` dari 0005 memetakannya secara deterministik: input
--    sama selalu menghasilkan UUID sama, sehingga dompet tetap milik merchant
--    yang sama lintas restart dan lintas replika.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0010_credit_uuid.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

-- Versi VARCHAR dibuang; membiarkannya berarti pemanggil bisa memilih fungsi
-- yang salah tanpa peringatan apa pun.
DROP FUNCTION IF EXISTS consume_ai_credit(VARCHAR);
DROP FUNCTION IF EXISTS refund_ai_credit(VARCHAR);

CREATE OR REPLACE FUNCTION consume_ai_credit(p_merchant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_new_balance INT;
BEGIN
    -- Satu pernyataan, atomik. Dua request bersamaan pada saldo terakhir:
    -- satu mendapat TRUE, satu mendapat FALSE. Membaca-lalu-menulis dari
    -- aplikasi akan membiarkan keduanya lolos dan memberi satu panggilan LLM
    -- gratis setiap kali terjadi.
    UPDATE ai.merchant_ai_credits
       SET balance         = balance - 1,
           used_this_month = used_this_month + 1,
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id
       AND balance > 0
    RETURNING balance INTO v_new_balance;

    RETURN v_new_balance IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION consume_ai_credit(UUID) IS
    'Memakai satu kredit AI secara atomik. FALSE berarti kuota habis — pemanggil WAJIB menampilkan paywall dan TIDAK BOLEH memanggil model.';

CREATE OR REPLACE FUNCTION refund_ai_credit(p_merchant_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE ai.merchant_ai_credits
       SET balance         = balance + 1,
           used_this_month = GREATEST(0, used_this_month - 1),
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refund_ai_credit(UUID) IS
    'Mengembalikan kredit ketika panggilan model gagal SETELAH kredit terpotong.';


-- Hak pakai untuk peran ai-service. Tanpa ini fungsinya ada tapi ditolak.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT EXECUTE ON FUNCTION consume_ai_credit(UUID) TO svc_ai;
        GRANT EXECUTE ON FUNCTION refund_ai_credit(UUID)  TO svc_ai;
        GRANT EXECUTE ON FUNCTION legacy_uuid(TEXT)       TO svc_ai;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0010_credit_uuid.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 12: migrations/0011_identity_grants.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0011_identity_grants.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 13: migrations/0012_customers.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0012_customers.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 14: migrations/0013_merchant_tenant_invariant.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0013_merchant_tenant_invariant.sql
--
-- Mengunci kenyataan bahwa `merchant_id` dan `tenant_id` adalah SINONIM.
--
-- INI BUKAN PERBAIKAN AKHIRNYA. Perbaikan akhirnya adalah membuang salah satu
-- kolom, dan itu menuntut satu keputusan produk yang belum diambil:
--
--   Apakah satu akun boleh memiliki BEBERAPA merchant?
--
--   - Tidak  -> keduanya memang sinonim selamanya. Buang `merchant_id`,
--               sisakan `tenant_id`, dan seluruh domain 0003/0004 ikut ringkas.
--   - Ya     -> `merchants` harus menjadi tabel tersendiri SEKARANG, sebelum
--               ada data produksi. `business_id` (`userId_sector`) sudah
--               menyiratkan arah ini.
--
-- Sampai keputusan itu diambil, yang berbahaya bukan duplikasinya — melainkan
-- tidak adanya yang mencegah keduanya MENYIMPANG. Dua kolom yang seharusnya
-- sama tapi diam-diam berbeda menghasilkan merchant yang punya dua identitas:
-- transaksinya di satu id, kreditnya di id lain, dan tidak ada satu pun error
-- yang muncul. Kerusakan seperti itu baru ketahuan berbulan-bulan kemudian,
-- saat angkanya sudah tidak bisa direkonsiliasi.
--
-- Ditinjau saat migrasi ini ditulis: SETIAP penulisan di seluruh repo mengisi
-- keduanya dari satu parameter yang sama (`VALUES ($1, $1, ...)`) — wallet.ts,
-- ai_query_logs, activity.ts, seed, dan ketiga batch job. Jadi batasan ini
-- hanya menuliskan apa yang sudah benar hari ini.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0013_merchant_tenant_invariant.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- NOT VALID, pola yang sama seperti foreign key di 0011.
--
-- Baris lama yang terlanjur menyimpang TIDAK menghalangi migrasi ini — kalau
-- ada, justru itu temuan yang perlu ditangani sendiri, bukan alasan menunda
-- penjagaan untuk penulisan baru. Semua INSERT dan UPDATE setelah ini langsung
-- diperiksa.
--
-- Untuk memvalidasi baris lama nanti (akan gagal bila ada yang menyimpang):
--   ALTER TABLE ai.merchant_ai_credits VALIDATE CONSTRAINT ck_credits_merchant_is_tenant;

DO $$
DECLARE
    -- skema, tabel, nama batasan
    specs TEXT[][] := ARRAY[
        ['ai',       'daily_merchant_insights', 'ck_insights_merchant_is_tenant'],
        ['ai',       'merchant_targets',        'ck_targets_merchant_is_tenant'],
        ['ai',       'merchant_ai_credits',     'ck_credits_merchant_is_tenant'],
        ['ai',       'ai_query_logs',           'ck_query_logs_merchant_is_tenant'],
        ['internal', 'feature_usage_events',    'ck_feature_events_merchant_is_tenant'],
        ['internal', 'merchant_health_logs',    'ck_health_merchant_is_tenant'],
        ['pos',      'merchant_activity_log',   'ck_activity_merchant_is_tenant']
    ];
    s   TEXT[];
    sch TEXT;
    tbl TEXT;
    con TEXT;
BEGIN
    FOREACH s SLICE 1 IN ARRAY specs LOOP
        sch := s[1]; tbl := s[2]; con := s[3];

        CONTINUE WHEN to_regclass(sch || '.' || tbl) IS NULL;
        CONTINUE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = con);

        -- Kolomnya nullable di beberapa tabel (log audit sengaja SET NULL saat
        -- merchantnya dihapus), jadi NULL harus lolos. `IS NOT DISTINCT FROM`
        -- memperlakukan NULL = NULL sebagai benar; `=` biasa menghasilkan NULL
        -- dan batasan CHECK meloloskan NULL — kebetulan hasilnya sama, tapi
        -- yang pertama menyatakan maksudnya.
        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I '
            'CHECK (merchant_id IS NOT DISTINCT FROM tenant_id) NOT VALID',
            sch, tbl, con
        );
        RAISE NOTICE '0013: %.% dijaga oleh %', sch, tbl, con;
    END LOOP;
END $$;


COMMENT ON COLUMN ai.merchant_ai_credits.tenant_id IS
    'Selalu sama dengan merchant_id — dijaga ck_credits_merchant_is_tenant sejak 0013. Salah satunya harus dibuang begitu diputuskan apakah satu akun boleh punya banyak merchant.';

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0013_merchant_tenant_invariant.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 15: migrations/0014_plan_entitlements.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0014_plan_entitlements.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 16: migrations/0015_admin_auth.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0015_admin_auth.sql
--
-- Memberi konsol internal autentikasi yang sesungguhnya.
--
-- KEADAAN SEBELUM INI, dan kenapa harus berubah sekarang. Panel admin
-- memeriksa password di dalam bundle JavaScript (`src/admin/api.ts`), lalu
-- menyimpan email pemakai di localStorage sebagai satu-satunya bukti identitas.
-- Dua akibatnya:
--
--   1. Password ada di setiap salinan bundle yang pernah ter-deploy. Siapa pun
--      yang membuka /admin bisa membacanya dari sumber halaman.
--   2. `api.me()` memberi ROLE_SUPERADMIN kepada email yang TIDAK dikenal, jadi
--      satu baris di konsol browser cukup untuk melewati layar login sama
--      sekali — password di atas bahkan tidak diperlukan.
--
-- Selama panel hanya menampilkan data contoh, itu "hanya" memalukan. Begitu
-- panel bisa MENGUBAH HARGA, ia menjadi lubang yang berdampak uang. Migrasi ini
-- adalah separuh database dari penutupannya; separuh sisanya ada di
-- src/server/adminAuth.ts.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0015_admin_auth.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KREDENSIAL ---------------------------------------------------------------
--
-- Hash memakai scrypt dari pustaka bawaan Node — tidak ada dependensi baru, dan
-- scrypt memang dirancang mahal di memori sehingga menebak massal jadi tidak
-- ekonomis. Formatnya `scrypt$N$r$p$salt$hash`, disimpan sebagai satu string
-- supaya parameternya ikut tersimpan: menaikkan biaya kerja nanti tidak
-- membatalkan password yang sudah ada.
--
-- NULL berarti akun belum bisa dipakai login. Itu keadaan awal yang benar:
-- akun yang di-seed tanpa password TIDAK boleh bisa masuk sampai seseorang
-- benar-benar menetapkannya lewat `npm run admin:password`.

ALTER TABLE internal.internal_users
    ADD COLUMN IF NOT EXISTS password_hash      VARCHAR(255),
    ADD COLUMN IF NOT EXISTS password_set_at    TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_login_at      TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN internal.internal_users.password_hash IS
    'scrypt$N$r$p$salt$hash. NULL = akun belum bisa login sama sekali; tetapkan dengan `npm run admin:password`.';
COMMENT ON COLUMN internal.internal_users.locked_until IS
    'Diisi setelah percobaan gagal beruntun. Menunda, bukan mengunci permanen — mengunci permanen menjadikan formulir login alat untuk mematikan akun orang lain.';


-- 2. PENGUNCIAN SEMENTARA -----------------------------------------------------

CREATE OR REPLACE FUNCTION internal.catat_login_gagal(p_email TEXT)
RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql
AS $$
DECLARE
    gagal INT;
    sampai TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Penundaan bertingkat: lima percobaan pertama gratis, sesudahnya jeda
    -- berlipat sampai maksimum 15 menit. Cukup untuk membuat penebakan otomatis
    -- tidak ada gunanya, tanpa mengunci admin yang benar-benar lupa passwordnya.
    UPDATE internal.internal_users
       SET failed_login_count = failed_login_count + 1,
           locked_until = CASE
               WHEN failed_login_count + 1 >= 5
               THEN CURRENT_TIMESTAMP + LEAST(
                        INTERVAL '15 minutes',
                        INTERVAL '1 minute' * POWER(2, LEAST(failed_login_count - 3, 4))
                    )
               ELSE locked_until
           END
     WHERE lower(email) = lower(p_email)
    RETURNING failed_login_count, locked_until INTO gagal, sampai;

    RETURN sampai;
END $$;

CREATE OR REPLACE FUNCTION internal.catat_login_berhasil(p_email TEXT)
RETURNS VOID
LANGUAGE SQL
AS $$
    UPDATE internal.internal_users
       SET last_login_at = CURRENT_TIMESTAMP,
           failed_login_count = 0,
           locked_until = NULL
     WHERE lower(email) = lower(p_email);
$$;


-- 3. HAK AKSES ----------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT EXECUTE ON FUNCTION internal.catat_login_gagal(TEXT)    TO svc_internal;
        GRANT EXECUTE ON FUNCTION internal.catat_login_berhasil(TEXT) TO svc_internal;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0015_admin_auth.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 17: migrations/0016_merchant_entitlements.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0016_merchant_entitlements.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 18: migrations/0017_stock_contract_views.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0017_stock_contract_views.sql
--
-- Membuka bahan baku dan resep BOM untuk konsol internal.
--
-- KENAPA. Panel admin punya tab "Bahan Baku" dan "Resep & Komposisi BOM", tapi
-- keduanya menampilkan array yang ditulis di dalam bundle JavaScript — angka
-- yang terlihat meyakinkan tanpa satu pun baris di database. backoffice-service
-- tidak bisa membacanya sendiri karena `svc_internal` sengaja tidak punya hak
-- baca ke skema `pos`; dua view di bawah ini yang menjembataninya.
--
-- Sengaja HANYA BACA dan sengaja agregat: konsol internal boleh melihat kondisi
-- stok merchant untuk membantu mereka, tapi tidak boleh menyuntingnya. Stok
-- adalah angka yang harus dipertanggungjawabkan merchant sendiri.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0017_stock_contract_views.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. BAHAN BAKU ---------------------------------------------------------------
--
-- `menipis` dihitung di sini, bukan di panel. Kalau ambangnya ditentukan
-- masing-masing layar, dua tampilan akan menyatakan hal berbeda tentang stok
-- yang sama — dan tidak ada cara memutuskan mana yang benar.

DROP VIEW IF EXISTS contract.raw_materials CASCADE;
CREATE VIEW contract.raw_materials AS
SELECT
    i.id,
    i.tenant_id                AS merchant_id,
    t.name                     AS merchant_name,
    t.business_sector,
    t.external_ref             AS business_id,
    i.name,
    i.sku,
    i.unit,
    i.current_stock,
    i.min_stock_alert,
    i.cost_price,
    (i.current_stock * i.cost_price)                       AS nilai_persediaan,
    (i.current_stock <= i.min_stock_alert)                 AS menipis,
    -- Berapa produk memakai bahan ini. Bahan yang menipis dan dipakai delapan
    -- produk adalah masalah yang berbeda dari yang tidak dipakai sama sekali.
    (SELECT COUNT(*) FROM pos.product_recipes r WHERE r.ingredient_id = i.id)::int
                                                           AS dipakai_produk,
    i.updated_at
  FROM pos.ingredients i
  JOIN pos.tenants t ON t.id = i.tenant_id;

COMMENT ON VIEW contract.raw_materials IS
    'Bahan baku per merchant beserta status menipis. Hanya baca — konsol internal tidak boleh menyunting stok merchant.';


-- 2. RESEP / BOM --------------------------------------------------------------
--
-- Satu baris per pasangan produk-bahan, bukan per produk. Panel menampilkannya
-- dikelompokkan, tapi pengelompokan di SQL akan memaksa bentuk tampilan
-- tertentu ke dalam kontrak — dan mengubah tampilannya nanti berarti mengubah
-- kontrak yang dibaca service lain.

DROP VIEW IF EXISTS contract.product_recipes CASCADE;
CREATE VIEW contract.product_recipes AS
SELECT
    r.id,
    r.tenant_id                AS merchant_id,
    t.name                     AS merchant_name,
    t.business_sector,
    p.id                       AS product_id,
    p.name                     AS product_name,
    p.price                    AS product_price,
    i.id                       AS ingredient_id,
    i.name                     AS ingredient_name,
    i.unit                     AS ingredient_unit,
    i.cost_price               AS ingredient_cost_price,
    r.quantity_required,
    -- Biaya bahan untuk satu porsi produk ini. Inilah angka yang membuat resep
    -- berguna: tanpa biayanya, daftar komposisi hanya catatan dapur.
    (r.quantity_required * i.cost_price)                   AS biaya_per_porsi
  FROM pos.product_recipes r
  JOIN pos.tenants t      ON t.id = r.tenant_id
  JOIN pos.products p     ON p.id = r.product_id
  JOIN pos.ingredients i  ON i.id = r.ingredient_id;

COMMENT ON VIEW contract.product_recipes IS
    'Komposisi BOM per produk beserta biaya bahan per porsi. Hanya baca.';


-- 3. HAK AKSES ----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    v   TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            FOREACH v IN ARRAY ARRAY['raw_materials', 'product_recipes'] LOOP
                EXECUTE format('GRANT SELECT ON contract.%I TO %I', v, svc);
            END LOOP;
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.raw_materials    TO bi_readonly;
        GRANT SELECT ON contract.product_recipes TO bi_readonly;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0017_stock_contract_views.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 19: migrations/0018_bundles.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0018_bundles.sql
--
-- Paket bundling promo, dari localStorage ke database.
--
-- KENAPA. Panel admin punya tab "Bundle Set Promo" yang selama ini menampilkan
-- array di dalam bundle JavaScript, dan aplikasi kasir menyimpannya hanya di
-- perangkat. Akibatnya sama seperti pelanggan sebelum 0012: bersihkan browser,
-- seluruh paket promo yang sudah disusun merchant hilang, dan tidak ada
-- salinannya di mana pun.
--
-- Bundle juga menjelaskan angka penjualan yang tanpanya terlihat aneh: dua
-- produk yang terjual bersama dengan harga di bawah jumlah harga satuannya
-- bukan kesalahan input, melainkan paket promo.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0018_bundles.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. PAKET --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.bundles (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id        UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    external_ref     VARCHAR(96),
    name             VARCHAR(100) NOT NULL,
    sku              VARCHAR(50),
    description      VARCHAR(300),

    -- Keduanya DISIMPAN, tidak dihitung ulang dari baris isinya.
    --
    -- Harga satuan produk berubah; kalau harga normal paket dijumlahkan ulang
    -- saat dibaca, diskon promo bulan lalu ikut berubah setiap kali katalog
    -- disunting — alasan yang sama dengan snapshot harga di transaction_items.
    regular_price    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (regular_price >= 0),
    bundle_price     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (bundle_price  >= 0),

    is_available     BOOLEAN NOT NULL DEFAULT TRUE,
    business_sector  VARCHAR(16),
    business_id      VARCHAR(96),
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.bundles IS
    'Paket bundling promo per merchant. Sumber kebenarannya pindah dari localStorage ke sini sejak 0018.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bundles_tenant_ref
    ON pos.bundles (tenant_id, external_ref) WHERE external_ref IS NOT NULL;


-- 2. ISI PAKET ----------------------------------------------------------------
--
-- product_id SET NULL, bukan CASCADE — sama seperti transaction_items. Produk
-- yang dihapus tidak boleh menghapus paket yang pernah memuatnya; nama dan
-- harganya sudah di-snapshot, jadi barisnya tetap terbaca utuh.

CREATE TABLE IF NOT EXISTS pos.bundle_items (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    bundle_id      UUID NOT NULL REFERENCES pos.bundles(id) ON DELETE CASCADE,
    tenant_id      UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    product_id     UUID REFERENCES pos.products(id) ON DELETE SET NULL,
    product_name   VARCHAR(100) NOT NULL,
    quantity       INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal_price NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON pos.bundle_items (bundle_id);


-- 3. PERMUKAAN BACA -----------------------------------------------------------
--
-- Diskon dihitung di sini, bukan di panel. Kalau rumusnya ditulis di layar,
-- dua tampilan bisa menyatakan diskon berbeda untuk paket yang sama.

DROP VIEW IF EXISTS contract.bundles CASCADE;
CREATE VIEW contract.bundles AS
SELECT
    b.id,
    b.tenant_id                AS merchant_id,
    t.name                     AS merchant_name,
    b.business_sector,
    b.business_id,
    b.name,
    b.sku,
    b.description,
    b.regular_price,
    b.bundle_price,
    (b.regular_price - b.bundle_price)                     AS hemat_rupiah,
    CASE WHEN b.regular_price > 0
         THEN ROUND(((b.regular_price - b.bundle_price) / b.regular_price) * 100, 1)
         ELSE 0
    END                                                    AS diskon_persen,
    b.is_available,
    (SELECT COUNT(*) FROM pos.bundle_items i WHERE i.bundle_id = b.id)::int
                                                           AS jumlah_item,
    -- Isi paket ikut dibawa supaya panel tidak perlu satu permintaan lagi per
    -- baris; jumlah paket per merchant kecil, jadi ini aman.
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'product_name',   i.product_name,
                'quantity',       i.quantity,
                'unit_price',     i.unit_price,
                'subtotal_price', i.subtotal_price)
              ORDER BY i.product_name)
         FROM pos.bundle_items i WHERE i.bundle_id = b.id),
      '[]'::jsonb
    )                                                      AS items,
    b.updated_at
  FROM pos.bundles b
  JOIN pos.tenants t ON t.id = b.tenant_id;

COMMENT ON VIEW contract.bundles IS
    'Paket promo beserta isinya dan besar diskonnya. Hanya baca.';


-- 4. HAK AKSES ----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.bundles      TO svc_pos;
        GRANT ALL ON pos.bundle_items TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.bundles TO %I', svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.bundles TO bi_readonly;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0018_bundles.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 20: migrations/0019_drop_tenant_id_duplikat.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0019_drop_tenant_id_duplikat.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 21: migrations/0020_branches.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0020_branches.sql
--
-- Memindahkan cabang dari localStorage ke database, supaya batas outlet paket
-- bisa benar-benar ditegakkan.
--
-- KENAPA INI PERLU. `max_outlets` sudah ada di billing.plans sejak 0014, sudah
-- bisa disunting admin, dan sudah ditolak aplikasi kasir lewat
-- bolehTambahOutlet(). Tapi cabang tidak pernah meninggalkan browser: seluruh
-- daftarnya hidup di StoreSettings.branches di localStorage. Akibatnya
-- penegakannya persis sekuat tombol Simpan di layar Pengaturan — siapa pun yang
-- menyunting localStorage, atau memakai perangkat kedua yang salinannya belum
-- pernah melihat cabang pertama, melewatinya tanpa hambatan.
--
-- Ini masalah yang sama dengan batas produk yang baru ditutup di jalur sinkron,
-- dan penutupannya menuntut satu hal yang belum ada: tempat di server untuk
-- menghitung cabang.
--
-- Tiga akibat lain yang ikut selesai:
--
--   1. Ganti perangkat, daftar cabang hilang. Tidak ada salinan di mana pun.
--   2. Panel admin tidak bisa menjawab "merchant ini punya berapa outlet"
--      selain dengan menebak.
--   3. Geofence absensi staf memakai koordinat yang hanya diketahui satu
--      browser. Dua perangkat bisa punya radius berbeda untuk cabang yang sama.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0020_branches.sql
--
-- HARUS dijalankan SESUDAH 0009_service_schemas.sql.
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. TABEL CABANG -------------------------------------------------------------
--
-- external_ref adalah id sisi klien (`branch-...`), pola yang sama dengan
-- products, users, dan customers: server tidak menebak identitas dari nama, dan
-- kiriman ulang dari perangkat yang sama selalu mengenai baris yang sama.

CREATE TABLE IF NOT EXISTS pos.branches (
    id                    UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id             UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    external_ref          VARCHAR(96),

    name                  VARCHAR(120) NOT NULL,
    address               VARCHAR(300) NOT NULL DEFAULT '',

    -- Koordinat geofence absensi. NUMERIC, bukan FLOAT: selisih pembulatan
    -- pada derajat ke-6 sudah bernilai belasan sentimeter, dan radius yang
    -- dipakai di sini bisa serapat 50 meter.
    latitude              NUMERIC(10, 7),
    longitude             NUMERIC(10, 7),
    allowed_radius_meters INT NOT NULL DEFAULT 200
                          CHECK (allowed_radius_meters BETWEEN 10 AND 50000),

    business_sector       VARCHAR(16),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    notes                 TEXT,

    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Kunci idempotensi sinkron. Parsial karena external_ref boleh NULL untuk
-- cabang yang kelak dibuat langsung di server.
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_external
    ON pos.branches (tenant_id, external_ref)
 WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branches_tenant
    ON pos.branches (tenant_id, is_active);

COMMENT ON TABLE pos.branches IS
    'Cabang/outlet milik merchant. Jumlah baris AKTIF di sini yang dibatasi billing.plans.max_outlets.';
COMMENT ON COLUMN pos.branches.is_active IS
    'Cabang nonaktif TIDAK dihitung terhadap batas paket. Menutup cabang harus membebaskan kuotanya, kalau tidak merchant terkunci oleh cabang yang sudah tidak dipakai.';


-- 2. CABANG YANG SEDANG DIPAKAI -----------------------------------------------
--
-- Disimpan pada tenants, bukan pada branches, karena "sedang dipakai" adalah
-- satu nilai per merchant. Menyimpannya sebagai boolean di tiap baris cabang
-- memungkinkan dua cabang sama-sama aktif, dan tidak ada jawaban benar saat
-- itu terjadi.

ALTER TABLE pos.tenants
    ADD COLUMN IF NOT EXISTS active_branch_id UUID
    REFERENCES pos.branches(id) ON DELETE SET NULL;


-- 3. PERMUKAAN BACA -----------------------------------------------------------
--
-- Dinamai merchant_id seperti seluruh permukaan kontrak yang lain.

DROP VIEW IF EXISTS contract.branches CASCADE;
CREATE VIEW contract.branches AS
SELECT b.tenant_id                    AS merchant_id,
       b.id                           AS branch_id,
       b.external_ref,
       b.name,
       b.address,
       b.latitude,
       b.longitude,
       b.allowed_radius_meters,
       b.business_sector,
       b.is_active,
       (t.active_branch_id = b.id)    AS sedang_dipakai,
       b.created_at,
       b.updated_at
  FROM pos.branches b
  JOIN pos.tenants  t ON t.id = b.tenant_id;

COMMENT ON VIEW contract.branches IS
    'Cabang per merchant untuk panel admin dan laporan. Hanya baca.';


-- 4. PEMAKAIAN OUTLET TERHADAP BATAS PAKET ------------------------------------
--
-- Jawaban satu baris untuk "merchant ini sudah pakai berapa dari jatahnya",
-- supaya panel admin dan endpoint sinkron membaca angka yang sama.

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
    'Pemakaian outlet terhadap batas paket. Tanpa langganan, batasnya 1 — merchant yang belum berlangganan bukan merchant dengan paket termahal.';


-- 5. HAK AKSES ----------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON pos.branches TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.branches TO svc_backoffice;
        GRANT SELECT ON contract.merchant_outlet_usage TO svc_backoffice;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0020_branches.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 22: migrations/0021_doku_pembayaran.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0021_doku_pembayaran.sql
--
-- Menyiapkan billing.invoices untuk pembayaran lewat DOKU Checkout.
--
-- KENAPA INI PERLU. Aktivasi langganan dipicu notifikasi dari DOKU, dan
-- notifikasi itu hanya membawa satu hal yang menghubungkannya kembali ke kita:
-- `invoice_number`. Tanpa kolom itu, satu-satunya cara mencocokkan pembayaran
-- dengan merchant adalah mempercayai `tenantId` yang ikut di badan notifikasi —
-- artinya mempercayai pihak luar untuk memberi tahu siapa yang harus
-- diaktifkan.
--
-- Yang benar sebaliknya: KITA yang menerbitkan invoice_number sebelum
-- memanggil DOKU, dan notifikasi hanya dipakai untuk MENEMUKAN baris yang sudah
-- kita tulis sendiri. Tanda tangan menjamin pesannya asli; baris ini yang
-- menjamin uangnya mendarat di merchant yang benar.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0021_doku_pembayaran.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. NOMOR FAKTUR -------------------------------------------------------------
--
-- UNIK per merchant, bukan global: dua merchant boleh punya INV-0001 masing-
-- masing. Yang dikirim ke DOKU diberi awalan yang membuatnya unik global (lihat
-- api/_lib/doku.ts), tapi keunikan di sini yang menjaga kita dari mencocokkan
-- notifikasi ke faktur milik orang lain.

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_number
    ON billing.invoices (invoice_number)
 WHERE invoice_number IS NOT NULL;

COMMENT ON COLUMN billing.invoices.invoice_number IS
    'Nomor yang dikirim ke payment gateway dan dikembalikan lagi lewat notifikasi. Satu-satunya kunci yang menghubungkan pembayaran ke faktur — jangan pernah mencocokkan lewat tenant_id dari badan notifikasi.';


-- 2. PAKET YANG DIBELI FAKTUR INI ---------------------------------------------
--
-- TIDAK bisa disimpulkan dari subscription_id. Saat merchant meng-upgrade,
-- langganannya masih menunjuk paket LAMA sampai pembayarannya lunas — dan itu
-- memang benar, karena paket baru belum dibayar. Tanpa kolom ini, notifikasi
-- yang masuk tidak tahu paket mana yang harus diaktifkan, dan merchant membayar
-- Pro tapi mendapat perpanjangan Free.

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS plan_id VARCHAR(64) REFERENCES billing.plans(id);

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(10) NOT NULL DEFAULT 'MONTHLY';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_invoices_cycle') THEN
        ALTER TABLE billing.invoices ADD CONSTRAINT ck_invoices_cycle
            CHECK (billing_cycle IN ('MONTHLY', 'YEARLY'));
    END IF;
END $$;


-- 3. KEDALUWARSA SESI PEMBAYARAN ----------------------------------------------
--
-- QR dari DOKU punya masa berlaku. Menyimpannya membuat layar langganan bisa
-- menjawab "QR ini masih bisa dipakai atau harus dibuat ulang" tanpa memanggil
-- DOKU lagi — dan membuat faktur menggantung bisa dibersihkan tanpa menebak.

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- 3b. STATUS "KEDALUWARSA" ----------------------------------------------------
--
-- QR yang habis masa berlakunya BUKAN pembayaran yang gagal. Yang pertama
-- berarti merchant belum sempat membayar dan tinggal membuat QR baru; yang
-- kedua berarti pembayarannya ditolak dan perlu ditelusuri. Menyamakan
-- keduanya membuat staf support tidak bisa membedakan tanpa membuka log
-- gateway.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'payment_status_enum' AND e.enumlabel = 'EXPIRED'
    ) THEN
        ALTER TYPE payment_status_enum ADD VALUE 'EXPIRED';
    END IF;
END $$;


-- 4. FOREIGN KEY GANDA --------------------------------------------------------
--
-- Tabel ini punya DUA foreign key yang identik ke tenants: fk_invoices_tenant
-- dan fk_invoices_tenant_id, keduanya (tenant_id) -> tenants(id) ON DELETE
-- CASCADE. Peninggalan dua migrasi yang menambahkannya dengan nama berbeda.
-- Tidak berbahaya, tapi setiap penulisan diperiksa dua kali untuk aturan yang
-- sama persis.

ALTER TABLE billing.invoices DROP CONSTRAINT IF EXISTS fk_invoices_tenant_id;


-- 5. NOTIFIKASI DOKU YANG SUDAH DIPROSES --------------------------------------
--
-- billing.webhook_logs sudah menjaga idempotensi lewat event_id. DOKU tidak
-- mengirim event_id; yang unik per notifikasi adalah header Request-Id. Kolom
-- ini menegaskan asalnya supaya dua gateway yang kelak dipakai bersamaan tidak
-- saling menimpa idempotensinya.

ALTER TABLE billing.webhook_logs
    ADD COLUMN IF NOT EXISTS provider VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX IF NOT EXISTS idx_webhook_logs_provider
    ON billing.webhook_logs (provider, processed_at DESC);


-- 6. PERMUKAAN BACA -----------------------------------------------------------

DROP VIEW IF EXISTS contract.merchant_invoices CASCADE;
CREATE VIEW contract.merchant_invoices AS
SELECT i.tenant_id            AS merchant_id,
       t.name                 AS merchant_name,
       i.id                   AS invoice_id,
       i.invoice_number,
       i.plan_id,
       COALESCE(p.name, '-')  AS plan_name,
       i.billing_cycle,
       i.amount,
       i.currency,
       i.payment_status,
       i.payment_gateway_ref,
       i.paid_at,
       i.due_date,
       i.expires_at,
       i.created_at
  FROM billing.invoices i
  JOIN pos.tenants  t ON t.id = i.tenant_id
  LEFT JOIN billing.plans p ON p.id = i.plan_id;

COMMENT ON VIEW contract.merchant_invoices IS
    'Faktur langganan per merchant untuk panel admin. Hanya baca.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.merchant_invoices TO svc_backoffice;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0021_doku_pembayaran.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 23: migrations/0022_empat_tier.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0022_empat_tier.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 24: migrations/0023_entitlement_kedaluwarsa.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0023_entitlement_kedaluwarsa.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 25: migrations/0024_trial_otomatis.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0024_trial_otomatis.sql
--
-- Merchant baru langsung mendapat Free Trial.
--
-- KENAPA DI DATABASE, BUKAN DI ENDPOINT PENDAFTARAN. Tidak ada satu endpoint
-- pendaftaran pun: akun dibuat lewat Supabase Auth di sisi klien, sementara
-- baris merchant lahir belakangan dan dari beberapa tempat — jalur sinkron
-- transaksi, jalur sinkron katalog, seed, dan panel admin. Menaruh aturannya di
-- salah satu dari mereka berarti jalur lain melewatkannya, dan merchant yang
-- lahir lewat jalur itu tidak pernah punya masa percobaan tanpa ada yang tahu.
--
-- Trigger pada pos.tenants menjadikannya satu aturan yang tidak bisa dilewati:
-- dari mana pun merchant itu dibuat, langganan percobaannya ikut lahir.
--
-- PAKETNYA DICARI, TIDAK DIPATOK. Yang dipilih adalah paket bertrial_days > 0
-- dengan tier terendah. Mengganti nama atau id paket percobaan di panel admin
-- tidak boleh mematikan pemberian trial — dan mematoknya pada 'plan-free-trial'
-- persis akan begitu.
--
-- TIDAK MENIMPA yang sudah ada. ON CONFLICT DO NOTHING: merchant yang dibuat
-- bersamaan dengan langganannya (seed, migrasi data) tetap memakai miliknya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0024_trial_otomatis.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

CREATE OR REPLACE FUNCTION billing.beri_trial_merchant_baru()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    paket RECORD;
BEGIN
    SELECT id, trial_days INTO paket
      FROM billing.plans
     WHERE trial_days > 0 AND is_active
     ORDER BY tier_level
     LIMIT 1;

    -- Tidak ada paket percobaan yang dijual: merchant lahir tanpa langganan,
    -- persis seperti sebelumnya. Bukan galat — katalog tanpa trial adalah
    -- pilihan yang sah.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    INSERT INTO billing.subscriptions
        (id, tenant_id, plan_id, status, current_period_start, current_period_end)
    VALUES
        (uuidv7(), NEW.id, paket.id, 'TRIAL',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + (paket.trial_days || ' days')::interval)
    ON CONFLICT (tenant_id) DO NOTHING;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION billing.beri_trial_merchant_baru() IS
    'Memberi langganan percobaan kepada merchant yang baru lahir. Paketnya dicari dari katalog, tidak dipatok pada satu id.';

DROP TRIGGER IF EXISTS trg_trial_merchant_baru ON pos.tenants;
CREATE TRIGGER trg_trial_merchant_baru
    AFTER INSERT ON pos.tenants
    FOR EACH ROW
    EXECUTE FUNCTION billing.beri_trial_merchant_baru();


-- MERCHANT YANG SUDAH TERLANJUR LAHIR TANPA LANGGANAN -------------------------
--
-- Diberi trial yang sama. Tanpa ini, siapa pun yang mendaftar sebelum migrasi
-- ini dijalankan berada dalam keadaan yang paling membingungkan: tidak punya
-- langganan sama sekali, sehingga status.ts menjawab BELUM_BERLANGGANAN dan
-- aplikasinya jatuh ke entitlement darurat — lebih sempit daripada Free.

INSERT INTO billing.subscriptions
    (id, tenant_id, plan_id, status, current_period_start, current_period_end)
SELECT uuidv7(), t.id, p.id, 'TRIAL',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + (p.trial_days || ' days')::interval
  FROM pos.tenants t
 CROSS JOIN LATERAL (
     SELECT id, trial_days FROM billing.plans
      WHERE trial_days > 0 AND is_active ORDER BY tier_level LIMIT 1
 ) p
 WHERE NOT EXISTS (SELECT 1 FROM billing.subscriptions s WHERE s.tenant_id = t.id)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0024_trial_otomatis.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 26: migrations/0025_hierarki_identitas.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0025_hierarki_identitas.sql
--
-- Menegakkan satu kosakata identitas: Merchant -> Business -> Outlet -> Terminal.
--
-- MASALAH YANG DIPERBAIKI. Satu konsep yang sama dipanggil dengan TIGA nama
-- berbeda tergantung skema mana yang menyimpannya:
--
--     pos.*, billing.*      -> tenant_id
--     ai.*, internal.*      -> merchant_id
--     contract.*            -> merchant_id
--
-- Sementara nama `business_id` justru dipakai untuk hal yang sama sekali lain:
-- kunci partisi penyimpanan di sisi klien (`usr-1_FNB`).
--
-- Selama satu tabel hanya memakai satu kolom, ini "hanya" membingungkan. Tapi
-- setiap kueri lintas skema harus mengingat nama mana yang berlaku di mana, dan
-- satu kekeliruan menghasilkan JOIN yang diam-diam kosong — bukan galat.
--
-- SESUDAH MIGRASI INI:
--
--     business_id (lama, userId_sector)  -> client_key
--     tenant_id                          -> business_id
--     merchant_id                        -> business_id
--     pos.tenants                        -> pos.businesses
--     pos.branches                       -> pos.outlets
--     (baru)                             -> pos.merchants   (di atas businesses)
--     (baru)                             -> pos.terminals   (di bawah outlets)
--
-- ALTER ... RENAME dipakai, BUKAN membuat kolom baru lalu menyalin. Postgres
-- ikut memperbarui foreign key, indeks, constraint, dan definisi view secara
-- otomatis — sehingga tidak ada jendela waktu ketika dua kolom hidup bersamaan
-- dan bisa menyimpang.
--
-- `sector` TETAP kolom biasa, bukan bagian identitas. Ia klasifikasi: sebuah
-- usaha bisa berganti sektor tanpa menjadi usaha yang berbeda.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0025_hierarki_identitas.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. business_id LAMA -> client_key -------------------------------------------
--
-- Didahulukan supaya namanya kosong sebelum tenant_id pindah ke sana.
-- Nilainya `usr-1_FNB`: kunci tempat aplikasi kasir menyimpan datanya di
-- localStorage, dan kunci yang dipakai perangkat untuk mengenali dirinya saat
-- sinkron. Itu memang berguna — yang keliru hanya namanya, yang membuatnya
-- tampak seperti identitas usaha.

DO $$
DECLARE t RECORD;
BEGIN
    FOR t IN
        SELECT table_schema AS s, table_name AS n
          FROM information_schema.columns
         WHERE column_name = 'business_id'
           AND table_schema IN ('pos', 'ai', 'internal', 'billing')
    LOOP
        EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN business_id TO client_key', t.s, t.n);
        RAISE NOTICE '0025: %.%.business_id -> client_key', t.s, t.n;
    END LOOP;
END $$;


-- 2. tenant_id DAN merchant_id -> business_id ---------------------------------
--
-- Keduanya selalu menunjuk hal yang sama: satu unit usaha. 0019 sudah
-- memastikan tidak ada tabel yang memegang keduanya sekaligus, jadi keduanya
-- bisa mendarat pada satu nama tanpa tabrakan.

DO $$
DECLARE t RECORD;
BEGIN
    FOR t IN
        SELECT table_schema AS s, table_name AS n, column_name AS c
          FROM information_schema.columns
         WHERE column_name IN ('tenant_id', 'merchant_id')
           AND table_schema IN ('pos', 'ai', 'internal', 'billing')
    LOOP
        EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO business_id', t.s, t.n, t.c);
        RAISE NOTICE '0025: %.%.% -> business_id', t.s, t.n, t.c;
    END LOOP;
END $$;


-- 2b. external_ref PADA BUSINESS -> client_key ---------------------------------
--
-- Nilainya persis sama dengan kolom business_id lama di tabel lain
-- (`usr-1_FNB`), jadi namanya harus sama juga. Dua nama untuk satu nilai adalah
-- awal dari dua nilai yang berbeda.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='pos' AND table_name='tenants'
                  AND column_name='external_ref') THEN
        ALTER TABLE pos.tenants RENAME COLUMN external_ref TO client_key;
    END IF;
END $$;


-- 3. TABEL -> nama kanonik ----------------------------------------------------

DO $$
BEGIN
    IF to_regclass('pos.tenants') IS NOT NULL AND to_regclass('pos.businesses') IS NULL THEN
        ALTER TABLE pos.tenants RENAME TO businesses;
    END IF;

    IF to_regclass('pos.branches') IS NOT NULL AND to_regclass('pos.outlets') IS NULL THEN
        ALTER TABLE pos.branches RENAME TO outlets;
    END IF;
END $$;

-- Kolom penunjuk outlet aktif ikut menyesuaikan namanya.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='pos' AND table_name='businesses'
                  AND column_name='active_branch_id') THEN
        ALTER TABLE pos.businesses RENAME COLUMN active_branch_id TO active_outlet_id;
    END IF;
END $$;


-- 4. MERCHANT — pemilik akun, di ATAS business --------------------------------
--
-- Inilah lapisan yang selama ini tidak punya tabel: pemilik yang memiliki kafe
-- DAN laundry. Sebelumnya keduanya hanya terhubung lewat `owner_user_ref` yang
-- sama — sebuah string, tanpa baris, tanpa foreign key, dan tanpa tempat untuk
-- menyimpan apa pun yang berlaku bagi pemiliknya (langganan bersama, penagihan
-- terpusat, kontak resmi).

CREATE TABLE IF NOT EXISTS pos.merchants (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    -- Akun pemilik dari penyedia autentikasi. Satu akun = satu merchant.
    owner_user_ref  VARCHAR(64) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    email           VARCHAR(160),
    phone           VARCHAR(32),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_merchants_owner
    ON pos.merchants (owner_user_ref);

COMMENT ON TABLE pos.merchants IS
    'Pemilik akun. Satu merchant boleh memiliki beberapa business (kafe + laundry).';

ALTER TABLE pos.businesses
    ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES pos.merchants(id) ON DELETE CASCADE;

COMMENT ON COLUMN pos.businesses.merchant_id IS
    'Pemilik usaha ini. Nama merchant_id di sini berarti PEMILIK — berbeda dari pemakaian lama sebelum 0019, ketika ia hanya salinan tenant_id.';

-- Backfill: tiap owner_user_ref yang sudah ada menjadi satu merchant.
INSERT INTO pos.merchants (id, owner_user_ref, name)
SELECT uuidv7(), b.owner_user_ref,
       -- Nama merchant belum pernah ditanyakan ke siapa pun. Memakai nama usaha
       -- pertamanya lebih jujur daripada mengarang "Merchant #4".
       MIN(b.name)
  FROM pos.businesses b
 WHERE b.owner_user_ref IS NOT NULL
 GROUP BY b.owner_user_ref
ON CONFLICT (owner_user_ref) DO NOTHING;

UPDATE pos.businesses b
   SET merchant_id = m.id
  FROM pos.merchants m
 WHERE m.owner_user_ref = b.owner_user_ref
   AND b.merchant_id IS DISTINCT FROM m.id;

CREATE INDEX IF NOT EXISTS idx_businesses_merchant ON pos.businesses (merchant_id);


-- 5. TERMINAL — perangkat kasir di sebuah outlet ------------------------------
--
-- Aplikasi sudah mengirim `x-device-id` pada beberapa permintaan, tapi tidak
-- ada tempat untuk menyimpannya. Akibatnya "kasir mana yang mencetak struk ini"
-- hanya bisa dijawab lewat nama orang, bukan perangkat — padahal saat kas tidak
-- cocok, yang perlu ditelusuri justru perangkatnya.

CREATE TABLE IF NOT EXISTS pos.terminals (
    id            UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id   UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    outlet_id     UUID REFERENCES pos.outlets(id) ON DELETE SET NULL,
    -- Nilai x-device-id yang dikirim aplikasi kasir.
    device_ref    VARCHAR(128) NOT NULL,
    name          VARCHAR(120) NOT NULL DEFAULT 'Kasir',
    last_seen_at  TIMESTAMP WITH TIME ZONE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_terminals_device
    ON pos.terminals (business_id, device_ref);

CREATE INDEX IF NOT EXISTS idx_terminals_outlet ON pos.terminals (outlet_id);

COMMENT ON TABLE pos.terminals IS
    'Perangkat kasir. device_ref adalah x-device-id yang sudah dikirim aplikasi.';


-- 6. PERMUKAAN BACA HIERARKI --------------------------------------------------

DROP VIEW IF EXISTS contract.business_hierarchy CASCADE;
CREATE VIEW contract.business_hierarchy AS
SELECT m.id            AS merchant_id,
       m.owner_user_ref,
       m.name          AS merchant_name,
       b.id            AS business_id,
       b.name          AS business_name,
       b.business_sector,
       b.client_key,
       o.id            AS outlet_id,
       o.name          AS outlet_name,
       o.is_active     AS outlet_active,
       t.id            AS terminal_id,
       t.name          AS terminal_name,
       t.device_ref
  FROM pos.merchants  m
  JOIN pos.businesses b ON b.merchant_id = m.id
  LEFT JOIN pos.outlets   o ON o.business_id = b.id
  LEFT JOIN pos.terminals t ON t.outlet_id   = o.id;

COMMENT ON VIEW contract.business_hierarchy IS
    'Merchant -> Business -> Outlet -> Terminal dalam satu baris. Hanya baca.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.business_hierarchy TO svc_backoffice;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT, INSERT, UPDATE ON pos.merchants, pos.terminals TO svc_pos;
    END IF;
END $$;


-- 6b. KOLOM KELUARAN VIEW KONTRAK ---------------------------------------------
--
-- ALTER TABLE ... RENAME memperbarui referensi DI DALAM view, tapi TIDAK nama
-- kolom yang view itu KELUARKAN — alias tetap seperti saat view dibuat. Jadi
-- tabelnya sudah memakai business_id sementara contract.* masih menyajikan
-- merchant_id, dan setiap pemanggil lintas service memilih nama yang salah.
--
-- contract.business_hierarchy dikecualikan: di sana merchant_id memang berarti
-- PEMILIK, dan itu memang kolom yang berbeda.

-- Urutannya sama seperti pada tabel: business_id LAMA (kunci partisi klien)
-- harus menyingkir lebih dulu, atau rename kedua menabrak nama yang terpakai.
DO $$
DECLARE v RECORD;
BEGIN
    FOR v IN
        SELECT table_name AS n
          FROM information_schema.columns
         WHERE table_schema = 'contract'
           AND column_name = 'business_id'
           AND table_name <> 'business_hierarchy'
    LOOP
        EXECUTE format('ALTER VIEW contract.%I RENAME COLUMN business_id TO client_key', v.n);
    END LOOP;

    FOR v IN
        SELECT table_name AS n
          FROM information_schema.columns
         WHERE table_schema = 'contract'
           AND column_name = 'merchant_id'
           AND table_name <> 'business_hierarchy'
    LOOP
        EXECUTE format('ALTER VIEW contract.%I RENAME COLUMN merchant_id TO business_id', v.n);
        RAISE NOTICE '0025: contract.%.merchant_id -> business_id', v.n;
    END LOOP;
END $$;


-- 7. BADAN FUNGSI TIDAK IKUT DI-RENAME ----------------------------------------
--
-- ALTER ... RENAME memperbarui foreign key, indeks, dan view, tapi TIDAK badan
-- fungsi PL/pgSQL — bagi Postgres itu hanya teks. Fungsi yang masih menyebut
-- tenant_id/merchant_id akan gagal saat dipanggil, bukan saat migrasi
-- dijalankan, sehingga kerusakannya baru muncul di produksi.

CREATE OR REPLACE FUNCTION billing.beri_trial_merchant_baru()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    paket RECORD;
BEGIN
    SELECT id, trial_days INTO paket
      FROM billing.plans
     WHERE trial_days > 0 AND is_active
     ORDER BY tier_level
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    INSERT INTO billing.subscriptions
        (id, business_id, plan_id, status, current_period_start, current_period_end)
    VALUES
        (uuidv7(), NEW.id, paket.id, 'TRIAL',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + (paket.trial_days || ' days')::interval)
    ON CONFLICT (business_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trial_merchant_baru ON pos.businesses;
CREATE TRIGGER trg_trial_merchant_baru
    AFTER INSERT ON pos.businesses
    FOR EACH ROW
    EXECUTE FUNCTION billing.beri_trial_merchant_baru();


-- Nama parameter tidak bisa diubah lewat CREATE OR REPLACE; fungsinya harus
-- dibuang lebih dulu. Tipe parameter juga naik dari VARCHAR(64) ke UUID —
-- kolomnya sudah UUID sejak 0010, dan tanda tangan lama memaksa Postgres
-- melakukan cast implisit pada setiap panggilan.
DROP FUNCTION IF EXISTS consume_ai_credit(VARCHAR);
DROP FUNCTION IF EXISTS consume_ai_credit(UUID);
DROP FUNCTION IF EXISTS refund_ai_credit(VARCHAR);
DROP FUNCTION IF EXISTS refund_ai_credit(UUID);

CREATE OR REPLACE FUNCTION consume_ai_credit(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    sisa INT;
BEGIN
    -- Satu UPDATE atomik. Membaca saldo lalu menulisnya di pernyataan terpisah
    -- membuka jendela ketika dua permintaan sama-sama melihat saldo 1 dan
    -- keduanya lolos: merchant membayar satu kredit dan mendapat dua panggilan.
    UPDATE ai.merchant_ai_credits
       SET balance         = balance - 1,
           used_this_month = used_this_month + 1,
           updated_at      = CURRENT_TIMESTAMP
     WHERE business_id = p_business_id
       AND balance > 0
    RETURNING balance INTO sisa;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION refund_ai_credit(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ai.merchant_ai_credits
       SET balance         = balance + 1,
           used_this_month = GREATEST(0, used_this_month - 1),
           updated_at      = CURRENT_TIMESTAMP
     WHERE business_id = p_business_id;

    RETURN FOUND;
END;
$$;


-- 8. MERCHANT UNTUK BUSINESS YANG LAHIR KEMUDIAN ------------------------------
--
-- Backfill di bagian 4 hanya menjangkau business yang sudah ada saat migrasi
-- dijalankan. Business lahir dari beberapa jalur — sinkron transaksi, sinkron
-- katalog, seed, panel admin — dan menaruh penautan merchant di salah satunya
-- berarti jalur lain menghasilkan business yatim: punya pemilik menurut
-- owner_user_ref, tapi tidak muncul di hierarki mana pun.
--
-- Alasannya sama dengan trigger trial di 0024, dan obatnya sama.

CREATE OR REPLACE FUNCTION pos.tautkan_merchant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    id_merchant UUID;
BEGIN
    IF NEW.owner_user_ref IS NULL OR NEW.merchant_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO pos.merchants (id, owner_user_ref, name)
    VALUES (uuidv7(), NEW.owner_user_ref, NEW.name)
    ON CONFLICT (owner_user_ref) DO UPDATE
        -- DO UPDATE, bukan DO NOTHING: RETURNING tidak mengembalikan baris pada
        -- DO NOTHING, dan tanpa id-nya business ini tetap yatim.
        SET updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO id_merchant;

    NEW.merchant_id := id_merchant;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tautkan_merchant ON pos.businesses;
CREATE TRIGGER trg_tautkan_merchant
    BEFORE INSERT ON pos.businesses
    FOR EACH ROW
    EXECUTE FUNCTION pos.tautkan_merchant();

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0025_hierarki_identitas.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 27: migrations/0026_event_dan_ledger.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0026_event_dan_ledger.sql
--
-- Efek transaksi menjadi CATATAN, bukan hasil menimpa angka.
--
-- MASALAH YANG DIPERBAIKI. Penjualan sekarang mengubah empat hal sekaligus,
-- semuanya dengan menimpa nilai yang ada:
--
--     products.stock      -= qty
--     ingredients.stock   -= resep x qty
--     customers.points    += ...
--     customers.total_spent += ...
--
-- Menimpa berarti tidak ada jawaban untuk "kenapa angkanya segini". Saat stok
-- di layar berbeda dari stok di rak, atau member protes poinnya berkurang,
-- satu-satunya yang tersimpan adalah nilai TERAKHIR — bukan urutan kejadian
-- yang menghasilkannya. Pembatalan pun jadi tebakan: mengembalikan sebanyak
-- yang SEHARUSNYA, bukan sebanyak yang dulu benar-benar diambil.
--
-- Ledger membalik arahnya: yang disimpan adalah PERISTIWA, dan saldo dihitung
-- darinya. Void tidak menghapus apa pun — ia menambahkan baris kebalikan, dan
-- riwayatnya tetap bisa dibaca.
--
-- CATATAN TENTANG OTORITAS. Ledger ini TIDAK memindahkan otoritas ke server
-- begitu saja. Kasir yang menjual saat internet mati tetap otoritas pada saat
-- itu — menunggu server berarti antrean berhenti. Yang berubah: perangkat
-- mengirim PERISTIWA, server menyusunnya menjadi saldo, dan saldo server itulah
-- yang menjadi rujukan saat dua perangkat berbeda pendapat. Optimistik di
-- perangkat, otoritatif di server, dan keduanya kini bisa dibandingkan.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0026_event_dan_ledger.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. MODE INVENTORI PADA PRODUK -----------------------------------------------
--
-- `products.stock -= qty` hanya benar kalau produknya memang barang jadi yang
-- dihitung. Untuk Nasi Goreng, stok produknya tidak berarti apa-apa — yang
-- berkurang beras, telur, dan minyak. Untuk potong rambut, tidak ada yang
-- berkurang sama sekali.
--
-- Tanpa pembedaan ini, sistem berpotensi mengurangi DUA KALI: satu dari stok
-- produk yang sebenarnya tidak dilacak, satu lagi dari bahan bakunya.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_mode_enum') THEN
        CREATE TYPE inventory_mode_enum AS ENUM ('NONE', 'STOCK', 'RECIPE');
    END IF;
END $$;

ALTER TABLE pos.products
    ADD COLUMN IF NOT EXISTS inventory_mode inventory_mode_enum NOT NULL DEFAULT 'STOCK';

COMMENT ON COLUMN pos.products.inventory_mode IS
    'NONE: jasa, tidak ada yang berkurang. STOCK: barang jadi, kurangi products.stock. RECIPE: kurangi bahan baku lewat resep, stok produk diabaikan.';

-- Produk yang PUNYA resep jelas berbasis resep. Sisanya biarkan STOCK —
-- menebak NONE untuk mereka akan mematikan pelacakan stok yang sudah berjalan.
UPDATE pos.products p
   SET inventory_mode = 'RECIPE'
 WHERE inventory_mode = 'STOCK'
   AND EXISTS (SELECT 1 FROM pos.product_recipes r WHERE r.product_id = p.id);


-- 2. PERISTIWA DOMAIN ---------------------------------------------------------
--
-- Satu baris per kejadian yang punya akibat. Inilah yang menggantikan rantai
-- FinalizeOrder -> MutateStock -> UpdateShift -> UpdateCustomer: transaksi
-- menerbitkan peristiwa, dan efeknya diturunkan dari sana.

CREATE TABLE IF NOT EXISTS pos.domain_events (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id    UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    event_type     VARCHAR(40) NOT NULL,
    -- Transaksi yang menjadi sumber peristiwa, bila ada.
    transaction_id UUID REFERENCES pos.transactions(id) ON DELETE SET NULL,
    occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Perangkat yang menerbitkannya. Saat dua perangkat berbeda pendapat,
    -- inilah yang menjawab siapa mencatat apa.
    device_ref     VARCHAR(128),
    -- Kunci idempotensi dari sisi klien. Kiriman ulang tidak boleh
    -- menghasilkan efek kedua.
    idempotency_key VARCHAR(128) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_events_idem
    ON pos.domain_events (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_domain_events_business_time
    ON pos.domain_events (business_id, occurred_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_domain_event_type') THEN
        ALTER TABLE pos.domain_events ADD CONSTRAINT ck_domain_event_type
            CHECK (event_type IN ('ORDER_PAID', 'ORDER_VOIDED', 'STOCK_ADJUSTED', 'STOCK_RECEIVED'));
    END IF;
END $$;

COMMENT ON TABLE pos.domain_events IS
    'Append-only. Peristiwa yang punya akibat; efeknya diturunkan menjadi baris ledger.';


-- 3. LEDGER PERSEDIAAN --------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.inventory_ledger (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id    UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    event_id       UUID REFERENCES pos.domain_events(id) ON DELETE SET NULL,

    -- Produk jadi dan bahan baku hidup di dua tabel berbeda, jadi jenisnya
    -- ikut disimpan. Tanpa itu, id yang sama di dua tabel akan tertukar.
    item_type      VARCHAR(16) NOT NULL,
    item_id        UUID NOT NULL,
    item_name      VARCHAR(160) NOT NULL,

    -- NEGATIF untuk yang keluar, POSITIF untuk yang masuk. Tidak ada kolom
    -- "arah" terpisah: satu angka bertanda tidak bisa bertentangan dengan
    -- dirinya sendiri.
    delta          NUMERIC(14, 3) NOT NULL,
    unit           VARCHAR(24),

    reason         VARCHAR(24) NOT NULL,
    transaction_id UUID REFERENCES pos.transactions(id) ON DELETE SET NULL,
    note           TEXT,
    occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inv_ledger_item_type') THEN
        ALTER TABLE pos.inventory_ledger ADD CONSTRAINT ck_inv_ledger_item_type
            CHECK (item_type IN ('PRODUCT', 'INGREDIENT'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inv_ledger_reason') THEN
        ALTER TABLE pos.inventory_ledger ADD CONSTRAINT ck_inv_ledger_reason
            CHECK (reason IN ('SALE', 'RECIPE_CONSUMPTION', 'VOID_REVERSAL',
                              'ADJUSTMENT', 'RESTOCK', 'OPENING_BALANCE'));
    END IF;
    -- Delta nol adalah baris yang tidak mengubah apa pun. Membiarkannya masuk
    -- hanya membuat riwayat lebih panjang tanpa menambah keterangan.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inv_ledger_delta') THEN
        ALTER TABLE pos.inventory_ledger ADD CONSTRAINT ck_inv_ledger_delta
            CHECK (delta <> 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inv_ledger_item
    ON pos.inventory_ledger (business_id, item_type, item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_txn
    ON pos.inventory_ledger (transaction_id);

COMMENT ON TABLE pos.inventory_ledger IS
    'Append-only. Saldo stok adalah jumlah delta di sini, bukan angka yang ditimpa.';


-- 4. LEDGER LOYALITAS ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.loyalty_ledger (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id    UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES pos.customers(id) ON DELETE CASCADE,
    event_id       UUID REFERENCES pos.domain_events(id) ON DELETE SET NULL,

    delta_points   INT NOT NULL DEFAULT 0,
    delta_spent    NUMERIC(14, 2) NOT NULL DEFAULT 0,
    delta_visits   INT NOT NULL DEFAULT 0,

    reason         VARCHAR(24) NOT NULL,
    transaction_id UUID REFERENCES pos.transactions(id) ON DELETE SET NULL,
    note           TEXT,
    occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loy_ledger_reason') THEN
        ALTER TABLE pos.loyalty_ledger ADD CONSTRAINT ck_loy_ledger_reason
            CHECK (reason IN ('EARN', 'REDEEM', 'VOID_REVERSAL',
                              'ADJUSTMENT', 'EXPIRY', 'OPENING_BALANCE'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_loy_ledger_customer
    ON pos.loyalty_ledger (business_id, customer_id, occurred_at DESC);

COMMENT ON TABLE pos.loyalty_ledger IS
    'Append-only. Menjawab "kenapa poin saya segini" — pertanyaan yang tidak bisa dijawab angka yang ditimpa.';


-- 5. SALDO SEBAGAI TURUNAN ----------------------------------------------------
--
-- View, bukan tabel. Saldo yang disimpan sebagai kolom akan menyimpang dari
-- ledgernya cepat atau lambat, dan begitu itu terjadi tidak ada cara memilih
-- mana yang benar.

DROP VIEW IF EXISTS contract.stock_balance CASCADE;
CREATE VIEW contract.stock_balance AS
SELECT l.business_id,
       l.item_type,
       l.item_id,
       MAX(l.item_name)          AS item_name,
       MAX(l.unit)               AS unit,
       SUM(l.delta)              AS saldo,
       MAX(l.occurred_at)        AS terakhir_bergerak,
       COUNT(*)::int             AS jumlah_mutasi
  FROM pos.inventory_ledger l
 GROUP BY l.business_id, l.item_type, l.item_id;

COMMENT ON VIEW contract.stock_balance IS
    'Saldo stok menurut server: jumlah seluruh mutasi. Ini rujukan saat dua perangkat berbeda pendapat.';

DROP VIEW IF EXISTS contract.loyalty_balance CASCADE;
CREATE VIEW contract.loyalty_balance AS
SELECT l.business_id,
       l.customer_id,
       c.name                    AS customer_name,
       SUM(l.delta_points)::int  AS poin,
       SUM(l.delta_spent)        AS total_belanja,
       SUM(l.delta_visits)::int  AS kunjungan,
       MAX(l.occurred_at)        AS terakhir_bergerak
  FROM pos.loyalty_ledger l
  JOIN pos.customers c ON c.id = l.customer_id
 GROUP BY l.business_id, l.customer_id, c.name;

COMMENT ON VIEW contract.loyalty_balance IS
    'Saldo poin menurut server, dihitung dari ledger.';


-- 6. SELISIH PERANGKAT vs SERVER ----------------------------------------------
--
-- Inilah yang membuat "optimistik di perangkat, otoritatif di server" bisa
-- ditegakkan tanpa menghentikan kasir: keduanya dicatat, dan selisihnya bisa
-- dilihat. Tanpa view ini, penyimpangan multi-perangkat hanya ketahuan saat
-- ada yang mengeluh.

DROP VIEW IF EXISTS contract.stock_drift CASCADE;
CREATE VIEW contract.stock_drift AS
SELECT p.business_id,
       'PRODUCT'::varchar          AS item_type,
       p.id                        AS item_id,
       p.name                      AS item_name,
       p.stock                     AS saldo_perangkat,
       COALESCE(b.saldo, 0)        AS saldo_server,
       p.stock - COALESCE(b.saldo, 0) AS selisih
  FROM pos.products p
  LEFT JOIN contract.stock_balance b
         ON b.item_id = p.id AND b.item_type = 'PRODUCT'
 WHERE p.inventory_mode = 'STOCK';

COMMENT ON VIEW contract.stock_drift IS
    'Selisih antara stok yang diyakini perangkat dan saldo menurut ledger server. Selisih bukan galat — ia antrian yang belum terkirim, atau perangkat yang perlu direkonsiliasi.';


-- 7. HAK AKSES ----------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT, INSERT ON pos.domain_events, pos.inventory_ledger, pos.loyalty_ledger TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.stock_balance, contract.loyalty_balance, contract.stock_drift TO svc_backoffice;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0026_event_dan_ledger.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 28: migrations/0027_kredit_ai_ledger.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0027_kredit_ai_ledger.sql
--
-- Kredit AI: mesin keadaan + ledger, menggantikan `balance -= 1` / `balance += 1`.
--
-- MASALAH YANG DIPERBAIKI. Alurnya sekarang dua perintah terpisah:
--
--     consume_ai_credit()  ->  panggil LLM  ->  gagal  ->  refund_ai_credit()
--
-- Kalau proses mati SETELAH LLM menjawab tapi SEBELUM jawabannya tercatat,
-- yang tersisa adalah kredit terpotong, jawaban hilang, dan tidak ada apa pun
-- yang menandai bahwa keduanya berhubungan. Merchant membayar untuk sesuatu
-- yang tidak pernah ia terima, dan tidak ada cara menemukannya kembali karena
-- pemotongan tidak menyimpan alasannya.
--
-- Kiriman ulang memperburuknya: pertanyaan yang sama dikirim dua kali memotong
-- dua kredit, karena tidak ada kunci yang menghubungkan percobaan kedua dengan
-- yang pertama.
--
-- SESUDAH MIGRASI INI:
--
--     RESERVED  --commit-->  SUCCEEDED
--        |
--        +-----refund---->  REFUNDED
--
-- Setiap perpindahan meninggalkan baris ledger. Saldo dihitung darinya, dan
-- cadangan yang menggantung bisa ditemukan serta dikembalikan tanpa menebak.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0027_kredit_ai_ledger.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KEADAAN SEBUAH PERTANYAAN ------------------------------------------------

ALTER TABLE ai.ai_query_logs
    ADD COLUMN IF NOT EXISTS state VARCHAR(16) NOT NULL DEFAULT 'SUCCEEDED';

ALTER TABLE ai.ai_query_logs
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

ALTER TABLE ai.ai_query_logs
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ai_query_state') THEN
        ALTER TABLE ai.ai_query_logs ADD CONSTRAINT ck_ai_query_state
            CHECK (state IN ('RESERVED', 'SUCCEEDED', 'FAILED', 'REFUNDED'));
    END IF;
END $$;

-- Kunci idempotensi: percobaan kedua atas pertanyaan yang sama harus mengenai
-- baris yang sama, bukan membuat cadangan baru.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_query_idem
    ON ai.ai_query_logs (business_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;

-- Cadangan yang menggantung dicari lewat indeks ini, bukan dengan memindai
-- seluruh riwayat pertanyaan.
CREATE INDEX IF NOT EXISTS idx_ai_query_reserved
    ON ai.ai_query_logs (state, asked_at)
 WHERE state = 'RESERVED';

COMMENT ON COLUMN ai.ai_query_logs.state IS
    'RESERVED: kredit sudah dipotong, jawaban belum pasti. SUCCEEDED: selesai. REFUNDED: dikembalikan.';


-- 2. LEDGER KREDIT ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai.credit_ledger (
    id           UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id  UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    -- NEGATIF saat kredit dipakai, POSITIF saat diberikan atau dikembalikan.
    delta        INT NOT NULL,
    reason       VARCHAR(24) NOT NULL,
    query_id     UUID REFERENCES ai.ai_query_logs(id) ON DELETE SET NULL,
    note         TEXT,
    occurred_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_ledger_reason') THEN
        ALTER TABLE ai.credit_ledger ADD CONSTRAINT ck_credit_ledger_reason
            CHECK (reason IN ('MONTHLY_GRANT', 'RESERVE', 'REFUND', 'TOPUP',
                              'EXPIRY', 'ADJUSTMENT', 'OPENING_BALANCE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_ledger_delta') THEN
        ALTER TABLE ai.credit_ledger ADD CONSTRAINT ck_credit_ledger_delta
            CHECK (delta <> 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_business
    ON ai.credit_ledger (business_id, occurred_at DESC);

COMMENT ON TABLE ai.credit_ledger IS
    'Append-only. Menjawab "kenapa kredit saya berkurang" — pertanyaan yang tidak bisa dijawab saldo yang ditimpa.';


-- 3. CADANGKAN KREDIT ---------------------------------------------------------
--
-- Satu pernyataan atomik: memotong saldo DAN mencatat alasannya. Memisahkan
-- keduanya membuka jendela ketika kredit sudah hilang tapi belum ada yang tahu
-- untuk apa.

CREATE OR REPLACE FUNCTION ai.cadangkan_kredit(
    p_business_id UUID,
    p_query_id    UUID,
    p_idem_key    VARCHAR(128)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    sudah_dicadangkan BOOLEAN;
BEGIN
    -- Percobaan ulang atas pertanyaan yang sama TIDAK memotong lagi.
    --
    -- Yang diperiksa adalah LEDGER, bukan ai_query_logs. Pemanggil menyisipkan
    -- baris pertanyaannya lebih dulu, jadi memeriksa tabel itu berarti selalu
    -- menemukan barisnya sendiri dan keluar tanpa memotong apa pun — kredit
    -- tidak pernah berkurang, dan seluruh kuota menjadi tak terbatas.
    --
    -- Ledger hanya berisi apa yang benar-benar terjadi, jadi ia jawaban yang
    -- benar untuk "apakah ini sudah pernah dipotong".
    SELECT EXISTS (
        SELECT 1 FROM ai.credit_ledger
         WHERE query_id = p_query_id AND reason = 'RESERVE'
    ) INTO sudah_dicadangkan;

    IF sudah_dicadangkan THEN
        RETURN TRUE;
    END IF;

    UPDATE ai.merchant_ai_credits
       SET balance         = balance - 1,
           used_this_month = used_this_month + 1,
           updated_at      = CURRENT_TIMESTAMP
     WHERE business_id = p_business_id
       AND balance > 0;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    INSERT INTO ai.credit_ledger (id, business_id, delta, reason, query_id, note)
    VALUES (uuidv7(), p_business_id, -1, 'RESERVE', p_query_id,
            'Dicadangkan sebelum memanggil model');

    RETURN TRUE;
END;
$$;


-- 4. SELESAIKAN ATAU KEMBALIKAN ------------------------------------------------

CREATE OR REPLACE FUNCTION ai.selesaikan_kredit(p_query_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ai.ai_query_logs
       SET state = 'SUCCEEDED', settled_at = CURRENT_TIMESTAMP
     WHERE id = p_query_id AND state = 'RESERVED';

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION ai.kembalikan_kredit(p_query_id UUID, p_alasan TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
BEGIN
    -- HANYA dari RESERVED. Mengembalikan kredit untuk pertanyaan yang sudah
    -- SUCCEEDED berarti merchant mendapat jawaban gratis; mengembalikannya dua
    -- kali berarti saldo bertambah dari udara.
    UPDATE ai.ai_query_logs
       SET state = 'REFUNDED', settled_at = CURRENT_TIMESTAMP
     WHERE id = p_query_id AND state = 'RESERVED'
    RETURNING business_id INTO r;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE ai.merchant_ai_credits
       SET balance         = balance + 1,
           used_this_month = GREATEST(0, used_this_month - 1),
           updated_at      = CURRENT_TIMESTAMP
     WHERE business_id = r.business_id;

    INSERT INTO ai.credit_ledger (id, business_id, delta, reason, query_id, note)
    VALUES (uuidv7(), r.business_id, 1, 'REFUND', p_query_id,
            COALESCE(p_alasan, 'Panggilan model gagal'));

    RETURN TRUE;
END;
$$;


-- 5. CADANGAN YANG MENGGANTUNG ------------------------------------------------
--
-- Proses yang mati di tengah meninggalkan RESERVED selamanya. Inilah yang
-- menemukannya — dan tanpa ini, satu-satunya cara mengetahuinya adalah menunggu
-- merchant mengeluh saldonya berkurang tanpa jawaban.

CREATE OR REPLACE FUNCTION ai.bersihkan_cadangan_menggantung(p_menit INT DEFAULT 15)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    n INT := 0;
    q RECORD;
BEGIN
    FOR q IN
        SELECT id FROM ai.ai_query_logs
         WHERE state = 'RESERVED'
           AND asked_at < CURRENT_TIMESTAMP - (p_menit || ' minutes')::interval
    LOOP
        IF ai.kembalikan_kredit(q.id, 'Cadangan menggantung, dikembalikan otomatis') THEN
            n := n + 1;
        END IF;
    END LOOP;

    RETURN n;
END;
$$;

COMMENT ON FUNCTION ai.bersihkan_cadangan_menggantung IS
    'Mengembalikan kredit yang tercadang tapi tidak pernah selesai. Jalankan berkala.';


-- 6. PERMUKAAN BACA -----------------------------------------------------------

DROP VIEW IF EXISTS contract.ai_credit_ledger CASCADE;
CREATE VIEW contract.ai_credit_ledger AS
SELECT l.business_id,
       SUM(l.delta)::int                                        AS saldo_ledger,
       SUM(l.delta) FILTER (WHERE l.reason = 'RESERVE')::int     AS terpakai,
       SUM(l.delta) FILTER (WHERE l.reason = 'REFUND')::int      AS dikembalikan,
       MAX(l.occurred_at)                                        AS terakhir_bergerak
  FROM ai.credit_ledger l
 GROUP BY l.business_id;

DROP VIEW IF EXISTS contract.ai_credit_drift CASCADE;
CREATE VIEW contract.ai_credit_drift AS
SELECT c.business_id,
       c.balance                       AS saldo_tersimpan,
       COALESCE(l.saldo_ledger, 0)
         + c.monthly_grant             AS saldo_menurut_ledger,
       (SELECT COUNT(*)::int FROM ai.ai_query_logs q
         WHERE q.business_id = c.business_id AND q.state = 'RESERVED') AS menggantung
  FROM ai.merchant_ai_credits c
  LEFT JOIN contract.ai_credit_ledger l ON l.business_id = c.business_id;

COMMENT ON VIEW contract.ai_credit_drift IS
    'Selisih saldo tersimpan vs ledger, dan jumlah cadangan yang menggantung. Selisih berarti ada yang tidak tercatat.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT, INSERT ON ai.credit_ledger TO svc_ai;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.ai_credit_ledger, contract.ai_credit_drift TO svc_backoffice;
    END IF;
END $$;


-- 7. KESEGARAN DATA PADA INSIGHT ----------------------------------------------
--
-- contract.merchant_revenue dihitung saat ditanya — selalu terkini. Sementara
-- daily_merchant_insights dihasilkan batch pukul 01:00, jadi isinya berumur
-- sampai 24 jam.
--
-- Tanpa menandai bedanya, asisten bisa menjawab "omzet Anda hari ini turun 20%"
-- memakai angka SEMALAM, dan merchant mengambil keputusan atas dasar itu.
-- Kesalahan seperti ini tidak pernah terlihat sebagai galat — angkanya nyata,
-- hanya saja bukan angka hari ini.

DROP VIEW IF EXISTS contract.insight_freshness CASCADE;
CREATE VIEW contract.insight_freshness AS
SELECT i.business_id,
       i.category,
       i.insight_date,
       i.updated_at,
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - i.updated_at)) / 3600 AS umur_jam,
       -- Batasnya 26 jam, bukan 24: batch berjalan sekali sehari, dan yang
       -- terlambat sejam belum tentu basi. Yang lewat dari itu sudah pasti
       -- melewatkan satu putaran.
       (CURRENT_TIMESTAMP - i.updated_at) > INTERVAL '26 hours' AS basi,
       'BATCH'::varchar AS sumber
  FROM ai.daily_merchant_insights i
 WHERE i.status = 'ACTIVE';

COMMENT ON VIEW contract.insight_freshness IS
    'Umur tiap insight. Yang basi tidak boleh disajikan sebagai keadaan hari ini — angkanya nyata, tapi bukan angka sekarang.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT ON contract.insight_freshness TO svc_ai;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0027_kredit_ai_ledger.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 29: migrations/0028_langganan_per_merchant.sql
-- --------------------------------------------------------------------------

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

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0028_langganan_per_merchant.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 30: migrations/0029_kredit_yatim.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0029_kredit_yatim.sql
--
-- SATU MERCHANT DIHAPUS MEMATIKAN PENGEMBALIAN KREDIT UNTUK SEMUANYA.
--
-- Dua tabel yang saling menunjuk tidak sepakat soal apa yang terjadi ketika
-- sebuah unit usaha dihapus:
--
--     ai.ai_query_logs.business_id   ON DELETE SET NULL   (nullable)
--     ai.credit_ledger.business_id   ON DELETE CASCADE    (NOT NULL)
--
-- Akibatnya: unit usaha dihapus -> baris ledger-nya ikut hilang, tapi baris
-- ai_query_logs-nya BERTAHAN dengan business_id NULL. Kalau baris itu kebetulan
-- sedang berstatus RESERVED, ia menggantung selamanya — dan
-- ai.bersihkan_cadangan_menggantung() yang seharusnya membereskannya justru
-- MATI di baris itu:
--
--     null value in column "business_id" of relation "credit_ledger"
--
-- Penyapu itu satu transaksi. Satu baris yatim membuat SELURUH sapuan gagal,
-- jadi kredit merchant lain yang menggantung karena proses mati di tengah tidak
-- pernah dikembalikan juga. Satu toko yang dihapus setahun lalu diam-diam
-- menahan kredit semua orang.
--
-- YANG DIPERBAIKI HANYA PENYAPUNYA, BUKAN SKEMANYA.
--
-- Godaan pertama adalah menyamakan kedua tabel — membuat ai_query_logs ikut
-- CASCADE. Itu KELIRU, dan docs/erd.md menjelaskan kenapa: SET NULL di sana
-- disengaja. "Jejak akses harus tetap ada setelah merchantnya pergi, justru
-- saat itulah biasanya dibutuhkan." Sebuah toko yang menghabiskan ribuan
-- kredit lalu menghapus akunnya adalah persis keadaan yang jejaknya paling
-- perlu dibaca.
--
-- Jadi barisnya tetap disimpan. Yang diperbaiki:
--
--   1. Baris yatim yang menggantung DITUTUP, bukan dihapus. Statusnya menjadi
--      REFUNDED supaya keluar dari antrean penyapu; isinya tetap bisa dibaca.
--   2. Penyapunya melewati baris tanpa pemilik, dan tidak berhenti pada
--      kegagalan satu baris. Penyapu yang mati pada gangguan pertama sama
--      tidak bergunanya dengan penyapu yang tidak pernah dijalankan.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0029_kredit_yatim.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. LOG YANG SUDAH YATIM DITUTUP ---------------------------------------------
--
-- Tidak bisa dikembalikan (dompetnya sudah tidak ada) dan tidak boleh terus
-- dicoba. Ditandai REFUNDED supaya keluar dari antrean penyapu, dengan
-- settled_at terisi supaya jelas kapan diputuskan.

UPDATE ai.ai_query_logs
   SET state = 'REFUNDED',
       settled_at = COALESCE(settled_at, CURRENT_TIMESTAMP)
 WHERE business_id IS NULL
   AND state = 'RESERVED';


-- 2. KENAPA SKEMANYA TIDAK DIUBAH ---------------------------------------------
--
-- business_id di sini tetap NULLABLE dan tetap ON DELETE SET NULL. Itu bukan
-- kelalaian; itu keputusan yang tercatat di docs/erd.md dan masih berlaku.
-- ai.credit_ledger boleh CASCADE karena ia catatan SALDO — tanpa dompetnya, ia
-- tidak punya arti. ai_query_logs catatan BIAYA dan pemakaian, dan justru
-- berguna setelah merchantnya pergi.

COMMENT ON COLUMN ai.ai_query_logs.business_id IS
    'Unit usaha yang bertanya. SET NULL saat unit usahanya dihapus — SENGAJA: jejak biaya harus tetap terbaca setelah merchantnya pergi. Baris tanpa pemilik dilewati penyapu, bukan dihapus.';


-- 3. PENYAPU TIDAK BOLEH MATI KARENA SATU BARIS -------------------------------
--
-- Dibangun ulang dengan dua penjagaan. Yang pertama menyaring baris tanpa
-- pemilik; yang kedua menangkap kegagalan tak terduga per baris supaya sisa
-- antreannya tetap diproses. Penyapu yang berhenti pada gangguan pertama sama
-- tidak bergunanya dengan penyapu yang tidak pernah dijalankan.

CREATE OR REPLACE FUNCTION ai.bersihkan_cadangan_menggantung(p_menit INT DEFAULT 15)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    n INT := 0;
    q RECORD;
BEGIN
    FOR q IN
        SELECT l.id FROM ai.ai_query_logs l
         WHERE l.state = 'RESERVED'
           AND l.business_id IS NOT NULL
           AND l.asked_at < CURRENT_TIMESTAMP - (p_menit || ' minutes')::interval
    LOOP
        BEGIN
            IF ai.kembalikan_kredit(q.id, 'Cadangan menggantung, dikembalikan otomatis') THEN
                n := n + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Dicatat, lalu lanjut. Satu baris rusak tidak boleh menahan kredit
            -- merchant lain yang menunggu dikembalikan.
            RAISE WARNING 'cadangan % gagal dikembalikan: %', q.id, SQLERRM;
        END;
    END LOOP;

    RETURN n;
END;
$$;

COMMENT ON FUNCTION ai.bersihkan_cadangan_menggantung IS
    'Mengembalikan kredit yang tercadang tapi tidak pernah selesai. Melewati baris tanpa pemilik dan tidak berhenti pada kegagalan satu baris. Jalankan berkala.';

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0029_kredit_yatim.sql')
  ON CONFLICT (filename) DO NOTHING;


-- --------------------------------------------------------------------------
-- BAGIAN 31: migrations/0030_mrr_dipisah.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0030_mrr_dipisah.sql
--
-- "LANGGANAN AKTIF" BUKAN "UANG SUDAH MASUK".
--
-- contract.subscription_status memberi dua angka: contract_mrr_idr dan
-- recognised_mrr_idr. Keduanya harga paket; bedanya hanya yang kedua disyaratkan
-- status = 'ACTIVE'. Nama "recognised" karena itu menjanjikan sesuatu yang tidak
-- dibuktikannya.
--
-- Langganan bisa ACTIVE sementara fakturnya belum dibayar. Merchant yang
-- pembayarannya gagal tetap ACTIVE sampai periodenya habis — memang disengaja,
-- supaya kasirnya tidak mati di tengah hari kerja karena kartu tertolak. Tapi
-- dashboard yang membaca recognised_mrr_idr akan melaporkannya sebagai
-- pendapatan yang sudah diakui, padahal belum ada rupiah yang masuk.
--
-- Semakin banyak merchant yang menunggak, semakin jauh angka itu dari kas — dan
-- ia bergerak ke arah yang salah persis ketika keadaannya memburuk.
--
-- EMPAT ANGKA, MASING-MASING MENJAWAB PERTANYAAN BERBEDA:
--
--   contracted  Nilai kontrak semua langganan, apa pun statusnya.
--               "Berapa yang seharusnya masuk kalau semuanya membayar."
--   active      Yang langganannya masih berjalan (ACTIVE/TRIAL).
--               "Berapa yang masih memakai layanan."
--   collected   Yang fakturnya BENAR-BENAR dibayar dalam 30 hari terakhir.
--               "Berapa rupiah yang masuk." Ini yang boleh disebut pendapatan.
--   past_due    Aktif tapi periodenya lewat — nilai yang sedang terancam.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0030_mrr_dipisah.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DROP VIEW IF EXISTS contract.subscription_status CASCADE;
CREATE VIEW contract.subscription_status AS
WITH unit_penagihan AS (
    -- Satu unit usaha per merchant yang membawa nominal. Menjumlahkan di semua
    -- unit usaha akan menggandakan MRR pemilik yang punya kafe DAN laundry,
    -- padahal ia membayar satu kali.
    SELECT s.merchant_id,
           (SELECT b.id FROM pos.businesses b
             WHERE b.merchant_id = s.merchant_id
             ORDER BY b.created_at, b.id LIMIT 1) AS business_id
      FROM billing.subscriptions s
),
terbayar AS (
    -- Faktur yang benar-benar lunas dalam 30 hari terakhir, dinormalkan ke
    -- nilai BULANAN. Faktur tahunan dibayar sekali untuk dua belas bulan;
    -- memasukkannya utuh akan membuat satu bulan terlihat dua belas kali lipat.
    SELECT i.subscription_id,
           SUM(CASE WHEN i.billing_cycle = 'YEARLY' THEN i.amount / 12 ELSE i.amount END) AS jumlah
      FROM billing.invoices i
     WHERE i.payment_status = 'PAID'
       AND i.paid_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
     GROUP BY i.subscription_id
)
SELECT b.id                AS business_id,
       s.merchant_id,
       s.status,
       s.current_period_end,
       p.id                AS plan_code,
       p.name              AS plan_name,
       (b.id = u.business_id) AS unit_penagihan,

       -- 1. NILAI KONTRAK. Apa pun statusnya.
       CASE WHEN b.id = u.business_id THEN p.price_idr ELSE 0::numeric END
           AS contracted_mrr_idr,

       -- 2. MASIH BERJALAN. Bukan berarti sudah dibayar.
       CASE WHEN b.id = u.business_id AND s.status IN ('ACTIVE', 'TRIAL')
            THEN p.price_idr ELSE 0::numeric END
           AS active_mrr_idr,

       -- 3. BENAR-BENAR MASUK. Dari faktur lunas, bukan dari status langganan.
       CASE WHEN b.id = u.business_id
            THEN COALESCE(t.jumlah, 0) ELSE 0::numeric END
           AS collected_mrr_idr,

       -- 4. SEDANG TERANCAM. Dua keadaan, dan keduanya harus terhitung:
       --    statusnya memang sudah PAST_DUE, ATAU masih tertulis aktif tapi
       --    periodenya sudah lewat. Menghitung yang kedua saja melewatkan
       --    justru yang sudah jelas menunggak.
       CASE WHEN b.id = u.business_id
             AND (s.status = 'PAST_DUE'
                  OR (s.status IN ('ACTIVE', 'TRIAL')
                      AND s.current_period_end < CURRENT_TIMESTAMP))
            THEN p.price_idr ELSE 0::numeric END
           AS past_due_mrr_idr,

       -- Nama lama dipertahankan supaya pemanggil yang ada tidak patah, TAPI
       -- artinya diluruskan: ia nilai kontrak, bukan pendapatan yang diakui.
       -- Pemakai baru harus memakai salah satu dari empat kolom di atas.
       CASE WHEN b.id = u.business_id THEN p.price_idr ELSE 0::numeric END
           AS contract_mrr_idr
  FROM billing.subscriptions s
  JOIN billing.plans p     ON p.id = s.plan_id
  JOIN pos.businesses b    ON b.merchant_id = s.merchant_id
  JOIN unit_penagihan u    ON u.merchant_id = s.merchant_id
  LEFT JOIN terbayar t     ON t.subscription_id = s.id;

COMMENT ON VIEW contract.subscription_status IS
    'Langganan per business. EMPAT angka MRR yang berbeda: contracted (nilai kontrak), active (masih berjalan), collected (faktur benar-benar lunas 30 hari terakhir), past_due (aktif tapi periodenya lewat). Hanya collected yang boleh disebut pendapatan. Semuanya dihitung sekali per merchant (unit_penagihan = true).';

COMMENT ON COLUMN contract.subscription_status.collected_mrr_idr IS
    'Satu-satunya kolom yang berasal dari uang yang benar-benar diterima. Faktur tahunan dibagi 12 supaya sebanding.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.subscription_status TO svc_backoffice;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_billing') THEN
        GRANT SELECT ON contract.subscription_status TO svc_billing;
    END IF;
END $$;

INSERT INTO public.schema_migrations (filename) VALUES ('migrations/0030_mrr_dipisah.sql')
  ON CONFLICT (filename) DO NOTHING;


-- ==========================================================================
-- SELESAI. Verifikasi dengan:
--
--   SELECT table_schema, COUNT(*) FROM information_schema.tables
--    WHERE table_schema IN ('pos','billing','ai','internal','contract')
--      AND table_type = 'BASE TABLE'
--    GROUP BY table_schema ORDER BY 1;
--
-- Harusnya: ai=5  billing=4  internal=4  pos=11
-- ==========================================================================
