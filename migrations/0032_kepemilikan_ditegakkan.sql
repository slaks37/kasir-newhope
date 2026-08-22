-- =============================================================================
-- 0032_kepemilikan_ditegakkan.sql
--
-- MATRIKS KEPEMILIKAN BERHENTI MENJADI KONVENSI.
--
-- Dokumentasi.md menuliskan pembagian di dalam `billing`:
--
--     panel internal  ->  MENULIS billing.plans, billing.plan_change_log
--                         (katalog: keputusan produk)
--     hanya P2        ->  MENULIS billing.subscriptions, billing.invoices
--                         (keadaan uang: hanya dari pembayaran bertanda tangan)
--
-- Sampai migrasi ini, yang menegakkannya hanya peninjauan kode. svc_backoffice
-- memegang GRANT tingkat SKEMA — artinya secara teknis ia bisa menyalakan
-- langganan siapa pun. Kalau satu akun internal jebol, itu menjadi cara memberi
-- paket termahal tanpa uang berpindah, dan tidak akan muncul di rekonsiliasi
-- mana pun karena tidak ada faktur yang dilanggarnya.
--
-- Aturan yang hanya ditulis di dokumen adalah aturan yang akan dilanggar oleh
-- orang yang tidak membaca dokumen itu.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0032_kepemilikan_ditegakkan.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        RAISE NOTICE 'svc_backoffice belum ada — hak akses dilewati.';
        RETURN;
    END IF;

    -- Dicabut lebih dulu, lalu diberikan yang tepat. REVOKE dulu penting:
    -- GRANT tingkat skema dari 0009 tidak hilang hanya karena ada GRANT
    -- tingkat tabel yang lebih sempit di sebelahnya.
    REVOKE ALL ON ALL TABLES IN SCHEMA billing FROM svc_backoffice;

    -- BACA seluruh billing. Panel memang menampilkan langganan dan tagihan.
    GRANT SELECT ON ALL TABLES IN SCHEMA billing TO svc_backoffice;

    -- TULIS hanya katalog.
    GRANT INSERT, UPDATE ON billing.plans           TO svc_backoffice;
    GRANT INSERT          ON billing.plan_change_log TO svc_backoffice;

    -- subscriptions, invoices, webhook_logs: TIDAK. Sengaja tidak disebut.
END $$;

-- Service billing memiliki skemanya, jadi ia menulis seluruhnya.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_billing') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO svc_billing;
        ALTER DEFAULT PRIVILEGES IN SCHEMA billing
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_billing;
    END IF;
END $$;

-- Tabel billing yang DIBUAT KEMUDIAN tidak boleh diam-diam bisa ditulis panel.
-- Tanpa baris ini, migrasi berikutnya yang menambah tabel di billing akan
-- memberi svc_backoffice hak tulis lewat default privileges lama.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        ALTER DEFAULT PRIVILEGES IN SCHEMA billing
            REVOKE INSERT, UPDATE, DELETE ON TABLES FROM svc_backoffice;
        ALTER DEFAULT PRIVILEGES IN SCHEMA billing
            GRANT SELECT ON TABLES TO svc_backoffice;
    END IF;
END $$;

COMMENT ON TABLE billing.subscriptions IS
    'Keadaan langganan. HANYA ditulis jalur pembayaran (penerbitan faktur + webhook bertanda tangan). Panel internal punya SELECT saja — ditegakkan GRANT di 0032, bukan konvensi.';
COMMENT ON TABLE billing.invoices IS
    'Tagihan. HANYA ditulis jalur pembayaran. Panel internal punya SELECT saja.';
COMMENT ON TABLE billing.plans IS
    'Katalog paket. Ditulis PANEL INTERNAL — menetapkan harga dan batas adalah keputusan produk.';
