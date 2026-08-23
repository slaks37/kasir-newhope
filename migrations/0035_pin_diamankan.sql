-- =============================================================================
-- 0035_pin_diamankan.sql
--
-- PIN KASIR DISIMPAN APA ADANYA, DAN TIDAK ADA YANG MEMBATASI PERCOBAAN.
--
-- Migrasi 0033 memisahkan kredensial ke tabelnya sendiri dan menulis di
-- ujungnya bahwa pengamanannya belum ada. Ini menyelesaikannya.
--
-- PIN empat angka punya SEPULUH RIBU kemungkinan. Yang menahannya harus
-- pembatasan percobaan, bukan hash saja — menebak 10.000 kemungkinan terhadap
-- hash yang lambat pun tetap selesai dalam hitungan jam. Karena itu keduanya
-- dipasang bersama:
--
--   pin_hash        scrypt, formatnya sama dengan internal_users
--   failed_attempt  penghitung gagal berturut-turut
--   locked_until    penguncian sementara
--
-- Bandingkan dengan internal.internal_users, yang sejak awal punya keduanya.
-- Akun konsol internal dijaga; terminal kasir — yang justru bisa membatalkan
-- transaksi dan mengubah stok — tidak. Ketimpangan itu yang ditutup di sini.
--
-- KOLOM LAMA TIDAK LANGSUNG DIBUANG. `pin` dipertahankan sementara supaya
-- perangkat yang belum diperbarui masih bisa masuk selama masa peralihan;
-- migrasi berikutnya yang membuangnya, setelah semua terminal memakai hash.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0035_pin_diamankan.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

ALTER TABLE pos.auth_users
    ADD COLUMN IF NOT EXISTS pin_hash        TEXT,
    ADD COLUMN IF NOT EXISTS failed_attempt  INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pin_set_at      TIMESTAMPTZ;

COMMENT ON COLUMN pos.auth_users.pin IS
    'USANG. Dipertahankan hanya selama masa peralihan; dibuang setelah semua terminal memakai pin_hash.';
COMMENT ON COLUMN pos.auth_users.pin_hash IS
    'scrypt, format sama dengan internal.internal_users.password_hash.';
COMMENT ON COLUMN pos.auth_users.locked_until IS
    'Terkunci sampai waktu ini. PIN empat angka hanya punya 10.000 kemungkinan — pembatasan percobaan, bukan hash, yang sesungguhnya menahannya.';

-- Penanda peralihan: baris yang PIN-nya belum di-hash mudah ditemukan.
DROP VIEW IF EXISTS contract.staf_pin_belum_aman CASCADE;
CREATE VIEW contract.staf_pin_belum_aman AS
SELECT a.id            AS auth_user_id,
       a.business_id,
       a.login,
       a.is_active,
       (a.pin_hash IS NULL) AS perlu_diamankan
  FROM pos.auth_users a
 WHERE a.pin_hash IS NULL;

COMMENT ON VIEW contract.staf_pin_belum_aman IS
    'Kredensial kasir yang PIN-nya masih tersimpan apa adanya. Harus kosong sebelum kolom pin dibuang.';

DO $$
DECLARE svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_backoffice'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.staf_pin_belum_aman TO %I', svc);
        END IF;
    END LOOP;
END $$;
