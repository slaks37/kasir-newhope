-- =============================================================================
-- 0041_audit_log_targets_merchant.sql
--
-- Jejak akses internal menunjuk granularitas yang salah sejak Model B.
--
-- MASALAHNYA. `internal.internal_access_log.merchant_id` dimaksudkan menjawab
-- "siapa membuka pembukuan merchant mana". Sebelum 0015, "merchant" dan
-- "tenant" adalah hal yang sama, jadi foreign key ke tabel tenant sudah benar.
--
-- 0015 memecahnya menjadi TENANT (akun pemilik) -> MERCHANT (unit usaha per
-- sektor) -> OUTLET. Sejak itu `contract.merchant_directory.merchant_id`
-- mengembalikan id `internal.merchants`, dan konsol meneruskannya apa adanya ke
-- `/api/admin/merchants/:merchantId`. Foreign key-nya tidak ikut dipindahkan.
--
-- Akibatnya SETIAP penulisan audit yang menyebut satu merchant gagal:
--
--   [audit] gagal mencatat akses internal: insert or update on table
--           "internal_access_log" violates foreign key constraint
--           "fk_internal_access_log_merchant_id"
--
-- Dan gagalnya SENYAP. `recordAccess()` sengaja menangkap error agar kegagalan
-- audit tidak menjatuhkan request — keputusan yang benar, tapi berarti satu-
-- satunya jejak yang tersisa adalah satu baris di log server. Konsol tetap
-- melayani permintaannya; yang hilang justru catatan bahwa permintaan itu
-- pernah terjadi.
--
-- Ironisnya justru baris DENIED dan BLOCKED yang selamat: keduanya dicatat
-- tanpa target merchant, sehingga tidak menyentuh foreign key ini sama sekali.
-- Jadi yang tercatat hanyalah percobaan yang GAGAL, dan setiap akses yang
-- BERHASIL menguap.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0041_audit_log_targets_merchant.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DO $$
DECLARE
    yatim BIGINT;
BEGIN
    IF to_regclass('internal.internal_access_log') IS NULL THEN
        RAISE NOTICE '0041: internal_access_log tidak ada, dilewati.';
        RETURN;
    END IF;

    -- Sudah menunjuk merchants? Tidak ada yang perlu dikerjakan.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_internal_access_log_merchant_id'
           AND confrelid = 'internal.merchants'::regclass
    ) THEN
        RAISE NOTICE '0041: sudah menunjuk internal.merchants.';
        RETURN;
    END IF;

    ALTER TABLE internal.internal_access_log
        DROP CONSTRAINT IF EXISTS fk_internal_access_log_merchant_id;

    /*
     * Baris lama menyimpan id TENANT. Setelah FK dipindahkan, id itu tidak
     * menunjuk merchant mana pun.
     *
     * Di-NULL-kan, TIDAK dihapus. Baris audit menyatakan bahwa seseorang pernah
     * mengakses sesuatu pada waktu tertentu — dan pernyataan itu tetap benar
     * meski targetnya tidak bisa lagi ditentukan. Menghapusnya berarti membuang
     * bukti; mengosongkan targetnya hanya mengakui apa yang memang tidak
     * diketahui.
     */
    EXECUTE '
        SELECT count(*) FROM internal.internal_access_log l
         WHERE l.merchant_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM internal.merchants m WHERE m.id = l.merchant_id)
    ' INTO yatim;

    IF yatim > 0 THEN
        UPDATE internal.internal_access_log l
           SET merchant_id = NULL
         WHERE l.merchant_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM internal.merchants m WHERE m.id = l.merchant_id);
        RAISE NOTICE '0041: % baris audit lama di-NULL-kan targetnya (barisnya dipertahankan)', yatim;
    END IF;

    -- SET NULL, bukan CASCADE: merchant yang pergi tidak boleh menghapus jejak
    -- siapa saja yang pernah membuka pembukuannya. Justru saat itulah catatan
    -- ini paling mungkin dibutuhkan.
    ALTER TABLE internal.internal_access_log
        ADD CONSTRAINT fk_internal_access_log_merchant_id
        FOREIGN KEY (merchant_id) REFERENCES internal.merchants(id) ON DELETE SET NULL;

    RAISE NOTICE '0041: jejak akses kini menunjuk internal.merchants.';
END $$;


COMMENT ON COLUMN internal.internal_access_log.merchant_id IS
    'Unit usaha yang dibuka (internal.merchants), bukan akun pemiliknya. '
    'SET NULL saat merchant dihapus — jejak akses bertahan lebih lama daripada merchantnya.';
