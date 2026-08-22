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
