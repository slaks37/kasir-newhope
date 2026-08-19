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
