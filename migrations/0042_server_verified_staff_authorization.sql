-- =============================================================================
-- 0042_server_verified_staff_authorization.sql
--
-- Memindahkan otorisasi void/refund dari UI ke server.
--
-- MASALAHNYA, dan kenapa memindahkan PIN saja tidak cukup.
--
-- Modal PIN manajer di `RecentTransactionsModal.tsx` adalah gerbang di sisi
-- klien. Server tidak pernah memeriksanya: `services/pos/sync.ts` menerima
-- `cashierRole` dari body dan memakainya HANYA sebagai label audit. Terbukti
-- dengan memanggil endpointnya langsung:
--
--   POST /api/v1/sync/transactions  { cashierRole: 'CASHIER', paymentStatus: 'CANCELLED' }
--   -> 200 voided=1
--
-- Kasir tanpa izin `void_order` berhasil membatalkan transaksi.
--
-- KENAPA PERAN DARI SESI TIDAK BISA DIPAKAI. Satu merchant = satu akun
-- Supabase, dan seluruh staf berbagi terminal yang sudah login dengan akun itu.
-- Jadi dari sisi server, kasir dan manajer adalah principal yang SAMA. Peran
-- apa pun yang dikirim klien adalah klaim klien tentang dirinya sendiri —
-- memeriksanya di server tidak menambah keamanan sedikit pun.
--
-- Satu-satunya batas yang nyata di terminal bersama adalah RAHASIA YANG TIDAK
-- DIKETAHUI KASIR: PIN manajer. Karena itu PIN harus diverifikasi server, bukan
-- browser.
--
-- YANG DILAKUKAN MIGRASI INI
--
--   1. `external_ref` pada memberships — supaya `cashierRef` dari perangkat
--      kasir bisa dicocokkan ke baris staf yang benar.
--   2. `pin_hash` menggantikan kolom `pin` yang menyimpan PIN APA ADANYA
--      dengan default '1234'. Format sama dengan sisi klien:
--      `sha256$<salt>$<hash>` (src/lib/auth/pinSecurity.ts), sehingga PIN yang
--      sudah dipakai merchant tetap berlaku tanpa mengaturnya ulang.
--   3. Kolom `pin` lama dikosongkan, BUKAN dihapus — menghapusnya menggagalkan
--      service versi lama yang masih membacanya saat rilis bertahap.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0042_server_verified_staff_authorization.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('internal.memberships') IS NULL THEN
        RAISE NOTICE '0042: internal.memberships tidak ada, dilewati.';
        RETURN;
    END IF;

    -- Penghubung ke identitas staf sisi perangkat (`cashierRef`).
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='internal' AND table_name='memberships' AND column_name='external_ref'
    ) THEN
        ALTER TABLE internal.memberships ADD COLUMN external_ref VARCHAR(96);
    END IF;

    -- PIN ter-hash. NULL berarti staf ini belum bisa mengotorisasi apa pun —
    -- lebih aman daripada nilai bawaan yang bisa ditebak.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='internal' AND table_name='memberships' AND column_name='pin_hash'
    ) THEN
        ALTER TABLE internal.memberships ADD COLUMN pin_hash VARCHAR(160);
    END IF;

    -- Nama tampilan, supaya jejak audit menyebut orang, bukan uuid.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='internal' AND table_name='memberships' AND column_name='display_name'
    ) THEN
        ALTER TABLE internal.memberships ADD COLUMN display_name VARCHAR(100);
    END IF;
END $$;

-- Satu external_ref hanya boleh menunjuk satu staf dalam satu tenant.
DO $$
BEGIN
    IF to_regclass('internal.memberships') IS NULL THEN RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_membership_external_ref') THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_external_ref
            ON internal.memberships (tenant_id, external_ref)
         WHERE external_ref IS NOT NULL;
    END IF;
END $$;

/*
 * PIN APA ADANYA DIBUANG.
 *
 * Kolom `pin` dibuat dengan `DEFAULT '1234'` dan menyimpan PIN tanpa hash.
 * Siapa pun yang bisa membaca tabel — termasuk lewat kebocoran cadangan atau
 * satu query yang salah bocor ke log — mendapatkan PIN otorisasi setiap staf.
 *
 * Nilainya tidak dipindahkan ke `pin_hash`: hash harus dibuat dengan salt acak
 * di sisi yang tahu PIN aslinya, dan '1234' bawaan tidak layak diselamatkan.
 * Merchant menetapkan ulang PIN lewat sinkronisasi staf.
 */
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='internal' AND table_name='memberships' AND column_name='pin'
    ) THEN
        ALTER TABLE internal.memberships ALTER COLUMN pin DROP NOT NULL;
        ALTER TABLE internal.memberships ALTER COLUMN pin DROP DEFAULT;
        UPDATE internal.memberships SET pin = NULL WHERE pin IS NOT NULL;
        COMMENT ON COLUMN internal.memberships.pin IS
            'USANG — PIN apa adanya. Dikosongkan 0042; pakai pin_hash. Dihapus setelah semua service diperbarui.';
    END IF;
END $$;

COMMENT ON COLUMN internal.memberships.pin_hash IS
    'PIN otorisasi ter-hash, format sha256$<salt>$<hash> (sama dengan src/lib/auth/pinSecurity.ts). '
    'NULL = staf ini tidak bisa mengotorisasi void/refund.';
COMMENT ON COLUMN internal.memberships.external_ref IS
    'Id staf sisi perangkat kasir (cashierRef), untuk mencocokkan otorisasi ke baris yang benar.';


-- Hak akses: pos-service yang memverifikasi otorisasi di jalur sinkronisasi.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_pos') THEN
        GRANT SELECT, INSERT, UPDATE ON internal.memberships TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_internal') THEN
        GRANT ALL ON internal.memberships TO svc_internal;
    END IF;
END $$;


-- Direktori staf untuk konsol internal — tanpa membocorkan hash PIN.
DROP VIEW IF EXISTS contract.merchant_staff CASCADE;
CREATE VIEW contract.merchant_staff AS
SELECT
    ms.tenant_id,
    ms.id                                   AS membership_id,
    ms.external_ref                         AS staff_ref,
    COALESCE(ms.display_name, u.full_name)  AS staff_name,
    ms.role,
    ms.is_active,
    (ms.pin_hash IS NOT NULL)               AS bisa_otorisasi,
    ms.created_at
  FROM internal.memberships ms
  LEFT JOIN internal.users u ON u.id = ms.user_id;

COMMENT ON VIEW contract.merchant_staff IS
    'Staf merchant beserta perannya. Hash PIN sengaja TIDAK diekspos — hanya penanda apakah staf bisa mengotorisasi.';

DO $$
DECLARE svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_billing','svc_ai','svc_internal','bi_readonly'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.merchant_staff TO %I', svc);
        END IF;
    END LOOP;
END $$;
