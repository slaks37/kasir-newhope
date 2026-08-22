-- =============================================================================
-- 0033_identitas_staf.sql
--
-- `users` MENCAMPUR TIGA KONSEP YANG BERBEDA UMURNYA.
--
--     users { id, business_id, name, username, pin, role, external_ref }
--              └─ kepegawaian ─┘  └─ kredensial ─┘  └ izin ┘
--
-- Ketiganya berubah pada waktu yang berbeda dan karena sebab yang berbeda:
--
--   KREDENSIAL berubah saat PIN bocor atau diganti berkala. Tidak ada
--     hubungannya dengan status kepegawaian.
--   KEPEGAWAIAN berubah saat orang pindah cabang atau berhenti. Orang yang
--     berhenti TIDAK boleh dihapus — struk yang pernah ia buat menunjuk
--     barisnya, dan menghapusnya berarti kehilangan siapa yang melayani.
--   IZIN berubah saat perannya naik, dan seharusnya bisa diubah tanpa
--     menyentuh keduanya.
--
-- Dicampur dalam satu baris, ketiganya harus diperlakukan sama: menonaktifkan
-- login berarti menghapus staf, dan menghapus staf berarti kehilangan riwayat.
--
-- YANG DILAKUKAN:
--
--     pos.auth_users      SIAPA yang boleh masuk (login, PIN)
--     pos.staff_users     SIAPA yang bekerja (dulu pos.users — DIGANTI NAMA,
--                         bukan disalin, supaya FK dari transactions dan
--                         merchant_activity_log ikut tanpa satu baris pun
--                         berpindah dan tanpa satu struk pun kehilangan kasir)
--     pos.roles           katalog peran
--     pos.permissions     katalog izin
--     pos.role_permissions
--     pos.user_roles      staf -> peran (boleh lebih dari satu)
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0033_identitas_staf.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. STAF: GANTI NAMA, BUKAN SALIN ---------------------------------------------
--
-- RENAME mempertahankan OID tabelnya, jadi kedua foreign key yang menunjuk ke
-- sini ikut berpindah sendiri. Menyalin ke tabel baru lalu memindahkan barisnya
-- akan memutus keduanya, dan `transactions.cashier_user_id` yang kehilangan
-- rujukannya berarti seluruh struk lama kehilangan kasirnya.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'pos' AND table_name = 'users')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'pos' AND table_name = 'staff_users') THEN
        ALTER TABLE pos.users RENAME TO staff_users;
    END IF;
END $$;


-- Nama indeks dan constraint ikut diganti. RENAME TABLE tidak menyentuhnya,
-- jadi tabel bernama staff_users akan berisi `users_pkey` dan
-- `uq_users_external_ref` — yang menyesatkan siapa pun yang membaca \d, dan
-- membuat grep "staff_users" melewatkan justru bagian yang mengunci barisnya.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'users_pkey'
                AND relnamespace = 'pos'::regnamespace) THEN
        ALTER INDEX pos.users_pkey RENAME TO staff_users_pkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_users_external_ref'
                AND relnamespace = 'pos'::regnamespace) THEN
        ALTER INDEX pos.uq_users_external_ref RENAME TO uq_staff_employee_code;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_fkey'
                AND conrelid = 'pos.staff_users'::regclass) THEN
        ALTER TABLE pos.staff_users
            RENAME CONSTRAINT users_tenant_id_fkey TO staff_users_business_id_fkey;
    END IF;
END $$;

-- 2. KREDENSIAL DIPISAH --------------------------------------------------------
--
-- Dilingkupi business_id, BUKAN global.
--
-- Login global menuntut email, dan kasir warung tidak punya email perusahaan.
-- Yang sesungguhnya terjadi di lapangan: nama pendek dan PIN empat angka,
-- diketik di terminal di toko itu. "Budi" di dua toko berbeda adalah dua orang
-- berbeda, dan memaksanya menjadi satu identitas global hanya menciptakan
-- bentrokan nama yang tidak pernah ada masalahnya.

CREATE TABLE IF NOT EXISTS pos.auth_users (
    id            UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id   UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    login         VARCHAR(50) NOT NULL,
    -- Nama kolomnya `pin` supaya jujur: yang tersimpan memang PIN kasir, bukan
    -- kata sandi. Penguatannya (hash) urusan lapisan aplikasi dan belum ada —
    -- lihat catatan di ujung berkas ini.
    pin           VARCHAR(64) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, login)
);

COMMENT ON TABLE pos.auth_users IS
    'Kredensial masuk. Dipisah dari staff_users supaya login bisa dinonaktifkan tanpa menghapus catatan kepegawaian — dan riwayat struk yang menunjuk stafnya tetap utuh.';

ALTER TABLE pos.staff_users
    ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES pos.auth_users(id) ON DELETE SET NULL;

-- Backfill: tiap baris staf melahirkan satu kredensial.
INSERT INTO pos.auth_users (id, business_id, login, pin, created_at)
SELECT uuidv7(), s.business_id, s.username, s.pin, s.created_at
  FROM pos.staff_users s
 WHERE s.auth_user_id IS NULL
   AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='pos' AND table_name='staff_users' AND column_name='username')
ON CONFLICT (business_id, login) DO NOTHING;

UPDATE pos.staff_users s
   SET auth_user_id = a.id
  FROM pos.auth_users a
 WHERE a.business_id = s.business_id
   AND s.auth_user_id IS NULL
   AND a.login = s.username;


-- 3. KEPEGAWAIAN --------------------------------------------------------------

ALTER TABLE pos.staff_users
    -- Pemberi kerja. Manajer bisa melayani kafe DAN laundry milik pemilik yang
    -- sama; business_id tetap ada sebagai penempatan utamanya.
    ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES pos.merchants(id) ON DELETE CASCADE,
    -- AKTIF / CUTI / BERHENTI. Yang berhenti tidak dihapus.
    ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'AKTIF',
    ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

UPDATE pos.staff_users s
   SET merchant_id = b.merchant_id
  FROM pos.businesses b
 WHERE b.id = s.business_id AND s.merchant_id IS DISTINCT FROM b.merchant_id;

UPDATE pos.staff_users SET joined_at = created_at WHERE joined_at IS NULL;

-- merchant_id di sini adalah SALINAN dari businesses.merchant_id, dan salinan
-- yang tidak dijaga akan berbeda suatu hari tanpa ada yang tahu. Foreign key
-- gabungan membuat "berbeda" mustahil, bukan sekadar tidak disarankan: baris
-- staf hanya boleh menyebut pemilik yang memang memiliki unit usahanya.
--
-- Butuh UNIQUE (id, merchant_id) di businesses supaya bisa dirujuk. Redundan
-- terhadap primary key-nya, dan memang hanya itu gunanya.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'uq_businesses_id_merchant'
                      AND conrelid = 'pos.businesses'::regclass) THEN
        ALTER TABLE pos.businesses
            ADD CONSTRAINT uq_businesses_id_merchant UNIQUE (id, merchant_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'fk_staff_merchant_sama_dengan_usaha'
                      AND conrelid = 'pos.staff_users'::regclass) THEN
        ALTER TABLE pos.staff_users
            ADD CONSTRAINT fk_staff_merchant_sama_dengan_usaha
            FOREIGN KEY (business_id, merchant_id)
            REFERENCES pos.businesses (id, merchant_id)
            ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

-- FK gabungan di atas menggantikan rujukan tunggal ke merchants: dua FK yang
-- menjaga hal yang sama berarti yang satu bisa lolos sementara yang lain tidak.
ALTER TABLE pos.staff_users
    DROP CONSTRAINT IF EXISTS staff_users_merchant_id_fkey;

ALTER TABLE pos.staff_users
    DROP CONSTRAINT IF EXISTS ck_staff_status;
ALTER TABLE pos.staff_users
    ADD CONSTRAINT ck_staff_status CHECK (status IN ('AKTIF', 'CUTI', 'BERHENTI'));

COMMENT ON TABLE pos.staff_users IS
    'Catatan KEPEGAWAIAN. Dulu bernama pos.users dan merangkap kredensial serta izin. Baris tidak pernah dihapus saat orang berhenti — transactions.cashier_user_id menunjuk ke sini, dan menghapusnya berarti struk lama kehilangan kasirnya.';


-- 4. PERAN DAN IZIN ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.roles (
    code        VARCHAR(32) PRIMARY KEY,
    name        VARCHAR(60) NOT NULL,
    description TEXT,
    -- Peran bawaan produk tidak boleh dihapus merchant.
    is_system   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pos.permissions (
    code        VARCHAR(40) PRIMARY KEY,
    name        VARCHAR(80) NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS pos.role_permissions (
    role_code       VARCHAR(32) NOT NULL REFERENCES pos.roles(code) ON DELETE CASCADE,
    permission_code VARCHAR(40) NOT NULL REFERENCES pos.permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS pos.user_roles (
    staff_user_id UUID NOT NULL REFERENCES pos.staff_users(id) ON DELETE CASCADE,
    role_code     VARCHAR(32) NOT NULL REFERENCES pos.roles(code) ON DELETE CASCADE,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by    UUID REFERENCES pos.staff_users(id) ON DELETE SET NULL,
    PRIMARY KEY (staff_user_id, role_code)
);

COMMENT ON TABLE pos.user_roles IS
    'Staf -> peran. Tabel penghubung, bukan kolom, supaya satu orang bisa memegang lebih dari satu peran tanpa menambah kolom baru setiap kali.';

-- Katalog izin: SAMA PERSIS dengan PermissionFeature di src/types.ts.
INSERT INTO pos.permissions (code, name, description) VALUES
    ('home',                 'Beranda',              'Layar depan aplikasi kasir'),
    ('overview',             'Ringkasan',            'Ringkasan penjualan harian'),
    ('pos',                  'Kasir',                'Membuat transaksi'),
    ('tables',               'Meja',                 'Pengaturan meja dan pesanan di tempat'),
    ('inventory',            'Inventori',            'Katalog produk dan stok'),
    ('customers',            'Pelanggan',            'Data member dan poin'),
    ('reports',              'Laporan',              'Laporan penjualan dan laba'),
    ('ai',                   'AI Copilot',           'Asisten analitik'),
    ('settings',             'Pengaturan',           'Pengaturan toko'),
    ('void_order',           'Batalkan Transaksi',   'Membatalkan struk yang sudah dibuat'),
    ('stock_adjustment',     'Penyesuaian Stok',     'Mengubah stok di luar penjualan'),
    ('user_management',      'Kelola Staf',          'Menambah dan mengubah akun staf'),
    ('billing_subscription', 'Langganan',            'Melihat dan mengubah paket langganan')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO pos.roles (code, name, description, is_system) VALUES
    ('ADMIN',   'Pemilik / Admin', 'Akses penuh atas satu unit usaha.', TRUE),
    ('MANAGER', 'Manajer',         'Sama dengan Admin kecuali yang menyangkut langganan.', TRUE),
    ('CASHIER', 'Kasir',           'Melayani penjualan; tidak melihat laporan laba dan tidak mengubah stok.', TRUE)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- Pemetaan peran -> izin, dipindahkan dari src/data/rolePermissions.ts.
--
-- SATU PERBEDAAN YANG DISENGAJA. Di berkas TypeScript, ADMIN dan MANAGER punya
-- daftar izin yang PERSIS SAMA — artinya salah satunya dekoratif, dan merchant
-- yang menurunkan seseorang dari Admin ke Manajer sebenarnya tidak mengubah
-- apa pun. Memindahkannya ke data membuat itu terlihat, jadi diperbaiki di
-- sini: `billing_subscription` dicabut dari MANAGER. Mengubah paket langganan
-- adalah keputusan pemilik, bukan keputusan operasional.
DELETE FROM pos.role_permissions WHERE role_code IN ('ADMIN', 'MANAGER', 'CASHIER');

INSERT INTO pos.role_permissions (role_code, permission_code)
SELECT 'ADMIN', code FROM pos.permissions;

INSERT INTO pos.role_permissions (role_code, permission_code)
SELECT 'MANAGER', code FROM pos.permissions WHERE code <> 'billing_subscription';

INSERT INTO pos.role_permissions (role_code, permission_code)
SELECT 'CASHIER', code FROM pos.permissions
 WHERE code IN ('home', 'overview', 'pos', 'tables', 'customers', 'ai');

-- Backfill peran dari kolom lama.
INSERT INTO pos.user_roles (staff_user_id, role_code)
SELECT s.id, UPPER(s.role)
  FROM pos.staff_users s
 WHERE EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='pos' AND table_name='staff_users' AND column_name='role')
   AND UPPER(s.role) IN (SELECT code FROM pos.roles)
ON CONFLICT DO NOTHING;

-- Staf yang perannya tidak dikenali TIDAK dibiarkan tanpa peran: tanpa satu
-- baris pun di user_roles, ia kehilangan seluruh akses sekaligus — termasuk
-- kasir yang sedang bertugas saat migrasi dijalankan.
INSERT INTO pos.user_roles (staff_user_id, role_code)
SELECT s.id, 'CASHIER' FROM pos.staff_users s
 WHERE NOT EXISTS (SELECT 1 FROM pos.user_roles r WHERE r.staff_user_id = s.id)
ON CONFLICT DO NOTHING;


-- 5. KOLOM LAMA DIBUANG --------------------------------------------------------
--
-- Selama username, pin, dan role masih ada di staff_users, dua sumber kebenaran
-- hidup berdampingan — dan yang satu akan menyimpang dari yang lain tanpa ada
-- yang menyadari. Dibuang SETELAH backfill di atas.

DROP VIEW IF EXISTS contract.transaction_log CASCADE;

ALTER TABLE pos.staff_users
    DROP COLUMN IF EXISTS username,
    DROP COLUMN IF EXISTS pin,
    DROP COLUMN IF EXISTS role;

-- external_ref -> employee_code. Namanya sekarang menyebut apa isinya.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='pos' AND table_name='staff_users'
                  AND column_name='external_ref')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='pos' AND table_name='staff_users'
                          AND column_name='employee_code') THEN
        ALTER TABLE pos.staff_users RENAME COLUMN external_ref TO employee_code;
    END IF;
END $$;


-- 6. PERMUKAAN BACA ------------------------------------------------------------

DROP VIEW IF EXISTS contract.staff_directory CASCADE;
CREATE VIEW contract.staff_directory AS
SELECT s.id                AS staff_user_id,
       s.business_id,
       s.merchant_id,
       s.name,
       s.employee_code,
       s.status,
       s.joined_at,
       s.left_at,
       a.login,
       a.is_active         AS login_aktif,
       a.last_login_at,
       COALESCE(
           (SELECT array_agg(r.role_code ORDER BY r.role_code)
              FROM pos.user_roles r WHERE r.staff_user_id = s.id),
           '{}'
       )                   AS roles
  FROM pos.staff_users s
  LEFT JOIN pos.auth_users a ON a.id = s.auth_user_id;

COMMENT ON VIEW contract.staff_directory IS
    'Staf beserta status kepegawaian, kredensial, dan perannya — tiga hal yang dulu satu baris. PIN sengaja TIDAK ikut.';

DROP VIEW IF EXISTS contract.staff_permissions CASCADE;
CREATE VIEW contract.staff_permissions AS
SELECT DISTINCT
       ur.staff_user_id,
       s.business_id,
       rp.permission_code
  FROM pos.user_roles ur
  JOIN pos.staff_users s     ON s.id = ur.staff_user_id
  JOIN pos.role_permissions rp ON rp.role_code = ur.role_code
 WHERE s.status = 'AKTIF';

COMMENT ON VIEW contract.staff_permissions IS
    'Izin EFEKTIF per staf, gabungan dari semua perannya. Staf non-AKTIF tidak menghasilkan baris — berhenti bekerja berarti kehilangan akses, tanpa barisnya perlu dihapus.';

-- transaction_log dibangun ulang: ia membaca pos.users yang sudah berganti nama.
DROP VIEW IF EXISTS contract.transaction_log CASCADE;
CREATE VIEW contract.transaction_log AS
SELECT t.id                AS transaction_id,
       t.business_id,
       t.business_sector,
       t.client_key,
       t.invoice_number,
       t.subtotal,
       t.discount_amount,
       t.tax_amount,
       t.service_charge_amount,
       t.total_amount,
       t.payment_method,
       t.payment_status,
       t.order_type,
       t.app_module,
       t.created_at,
       t.cashier_user_id,
       u.name              AS cashier_name
  FROM pos.transactions t
  LEFT JOIN pos.staff_users u ON u.id = t.cashier_user_id;

DO $$
DECLARE svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_ai','svc_billing','svc_backoffice'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format(
              'GRANT SELECT ON contract.staff_directory, contract.staff_permissions, contract.transaction_log TO %I', svc);
        END IF;
    END LOOP;
END $$;


-- YANG BELUM ------------------------------------------------------------------
--
-- PIN masih disimpan APA ADANYA, sama seperti sebelum migrasi ini. Memisahkan
-- kredensial ke tabelnya sendiri TIDAK membuatnya lebih aman — ia hanya
-- membuat tempat yang benar untuk memperbaikinya nanti ada. PIN empat angka
-- punya sepuluh ribu kemungkinan; yang menahannya harus pembatasan percobaan,
-- bukan hash saja. Keduanya belum ada, dan menuliskannya di sini supaya tidak
-- terlihat seolah sudah selesai.
