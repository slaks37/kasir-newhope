-- =============================================================================
-- 0038_identity_plane_grants.sql
--
-- Melengkapi hak akses IDENTITY PLANE, dan menuliskan batasnya secara eksplisit.
--
-- KENAPA ADA YANG KURANG. 0014 memberi `svc_pos` hak tulis atas
-- `internal.tenants`, dan 0015 menyusul untuk `merchants` dan `outlets` —
-- ketiganya memang di-provision oleh jalur sinkronisasi kasir, bukan oleh
-- back-office. Tapi `internal.users` dibuat lebih dulu di 0013, sebelum pola
-- itu ada, dan tidak pernah ikut disebut.
--
-- Akibatnya tidak pernah terlihat karena kelima service selama ini memakai satu
-- kredensial dengan hak penuh. Begitu isolasi peran benar-benar diaktifkan
-- (`scripts/db/setup-service-roles.mjs`), jalur sinkronisasi akan berhenti
-- tepat di resolusi kasir:
--
--   permission denied for table users
--
-- Yaitu kegagalan yang hanya muncul SETELAH pengamanan dinyalakan — jenis yang
-- paling mudah disalahartikan sebagai "isolasinya tidak bisa dipakai" lalu
-- dibatalkan lagi.
--
-- APA ITU IDENTITY PLANE. Empat tabel di skema `internal` bukan milik
-- backoffice-service semata:
--
--   tenants · merchants · outlets · users
--
-- Semua service membacanya, dan semua service punya foreign key ke sana —
-- yang menuntut hak REFERENCES, bukan sekadar SELECT. Hanya `svc_pos` yang
-- menulis, karena identitas merchant lahir saat perangkat kasir pertama kali
-- menyinkronkan, bukan saat seseorang mendaftarkannya di back-office.
--
-- Sisa skema `internal` — internal_users, internal_access_log, audit_logs,
-- merchant_health_logs — TETAP tertutup. Di situlah identitas staf penyedia dan
-- jejak aksesnya berada, dan tidak ada service lain yang punya alasan membacanya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0038_identity_plane_grants.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DO $$
DECLARE
    svc          TEXT;
    tabel        TEXT;
    semua_peran  TEXT[] := ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal'];
    plane        TEXT[] := ARRAY['tenants', 'merchants', 'outlets', 'users'];
BEGIN
    FOREACH svc IN ARRAY semua_peran LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            RAISE NOTICE '0038: peran % belum ada, dilewati.', svc;
            CONTINUE;
        END IF;

        -- Tanpa USAGE pada skemanya, hak tabel apa pun tidak berarti.
        EXECUTE format('GRANT USAGE ON SCHEMA internal TO %I', svc);

        FOREACH tabel IN ARRAY plane LOOP
            IF to_regclass('internal.' || tabel) IS NULL THEN CONTINUE; END IF;

            -- REFERENCES bukan tambahan opsional: tanpa itu, foreign key dari
            -- tabel milik service ke identity plane tidak bisa dibuat sama
            -- sekali, dan migrasi berikutnya yang memasangnya akan gagal.
            EXECUTE format('GRANT SELECT, REFERENCES ON internal.%I TO %I', tabel, svc);
        END LOOP;
    END LOOP;

    -- Hanya pos-service yang MENULIS identitas. Identitas merchant lahir dari
    -- sinkronisasi perangkat kasir; tidak ada layar back-office yang membuatnya.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        FOREACH tabel IN ARRAY plane LOOP
            IF to_regclass('internal.' || tabel) IS NULL THEN CONTINUE; END IF;
            EXECUTE format('GRANT INSERT, UPDATE ON internal.%I TO svc_pos', tabel);
        END LOOP;

        -- Sequence untuk kolom serial, bila ada. Tabel identity plane memakai
        -- uuidv7() sehingga umumnya tidak perlu — tapi diam-diam gagal saat
        -- suatu kolom berubah jadi serial adalah kegagalan yang mahal dicari.
        EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA internal TO svc_pos';
    END IF;

    -- DELETE sengaja TIDAK diberikan ke siapa pun selain pemiliknya. Menghapus
    -- tenant memicu CASCADE ke seluruh pembukuan merchant; itu keputusan
    -- back-office, bukan efek samping yang bisa dipicu jalur sinkronisasi.
END $$;


-- Menjadikan batasnya terbaca dari database, bukan hanya dari dokumen.
DO $$
BEGIN
    IF to_regclass('internal.users') IS NOT NULL THEN
        COMMENT ON TABLE internal.users IS
            'IDENTITY PLANE — dibaca semua service, ditulis hanya svc_pos '
            '(resolusi kasir di jalur sinkronisasi). Lihat migrasi 0038.';
    END IF;
    IF to_regclass('internal.tenants') IS NOT NULL THEN
        COMMENT ON TABLE internal.tenants IS
            'IDENTITY PLANE — dibaca semua service, ditulis hanya svc_pos '
            '(provisioning saat sinkronisasi pertama). Lihat migrasi 0038.';
    END IF;
    IF to_regclass('internal.internal_users') IS NOT NULL THEN
        COMMENT ON TABLE internal.internal_users IS
            'TERTUTUP — identitas staf penyedia SaaS. Hanya svc_internal.';
    END IF;
END $$;
