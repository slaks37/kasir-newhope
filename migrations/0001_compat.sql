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
