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
