-- =============================================================================
-- 0045_catalog_revision.sql
--
-- Menutup KEHILANGAN DATA pada sinkronisasi katalog.
--
-- MASALAHNYA.
--
-- `POST /api/v1/sync/catalog` menerima katalog UTUH dari satu perangkat lalu
-- memperlakukannya sebagai kebenaran mutlak:
--
--   1. setiap produk yang dikirim MENIMPA baris di server;
--   2. setiap produk yang TIDAK dikirim di-set `is_available = FALSE`.
--
-- Keduanya benar kalau hanya ada satu perangkat. Sistem ini justru menjual
-- paket 2 dan 4 outlet, dan aplikasinya offline-first — perangkat bisa berhari-
-- hari tidak tersambung sambil tetap melayani penjualan.
--
-- Akibatnya, dengan dua perangkat:
--
--   Senin  09:00  tablet-B mati / offline, katalognya membeku
--   Senin  10:00  pemilik menambah 12 produk baru dari tablet-A
--   Senin  10:05  pemilik menaikkan harga Kopi Susu dari 18.000 ke 22.000
--   Selasa 08:00  tablet-B menyala, mengirim katalog Senin 09:00
--
--                 -> 12 produk baru: is_available = FALSE, hilang dari SEMUA
--                    perangkat dan dari laporan
--                 -> Kopi Susu kembali 18.000, tanpa satu pun jejak
--
-- Tidak ada pesan kesalahan. Tidak ada yang tahu sampai ada yang bertanya ke
-- mana perginya produk-produk itu.
--
-- YANG DIPASANG DI SINI.
--
-- Nomor revisi milik SERVER, bukan cap waktu milik klien. Jam tablet kasir
-- tidak bisa dipercaya untuk mengurutkan kejadian antar perangkat — tablet
-- dengan tanggal salah setahun bukan hal langka, dan satu jam yang meleset
-- akan membuat aturan "yang paling baru menang" justru memilih yang paling
-- lama.
--
--   internal.tenants.catalog_revision  penghitung naik, satu per pengiriman
--   pos.products.revision              nilai penghitung saat baris ini berubah
--
-- Perangkat mengirim `baseRevision`, yaitu revisi terakhir yang PERNAH ia
-- terima dari server. Server lalu tahu persis apa yang belum dilihat perangkat
-- itu, tanpa membandingkan jam siapa pun.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0045_catalog_revision.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. PENGHITUNG PER TENANT ------------------------------------------------------

DO $$
BEGIN
    IF to_regclass('internal.tenants') IS NULL THEN
        RAISE NOTICE '0045: internal.tenants tidak ada, dilewati.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='internal' AND table_name='tenants' AND column_name='catalog_revision'
    ) THEN
        ALTER TABLE internal.tenants
            ADD COLUMN catalog_revision BIGINT NOT NULL DEFAULT 0;
    END IF;
END $$;

COMMENT ON COLUMN internal.tenants.catalog_revision IS
    'Penghitung revisi katalog milik server, naik satu setiap pengiriman katalog. '
    'Dipakai sebagai pengganti cap waktu klien, yang tidak bisa dipercaya untuk '
    'mengurutkan kejadian antar perangkat. Lihat migrasi 0045.';


-- 2. REVISI PER PRODUK ----------------------------------------------------------

DO $$
BEGIN
    IF to_regclass('pos.products') IS NULL THEN
        RAISE NOTICE '0045: pos.products tidak ada, dilewati.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='pos' AND table_name='products' AND column_name='revision'
    ) THEN
        ALTER TABLE pos.products ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
    END IF;
END $$;

/*
 * Indeks menopang dua penyaringan yang dilakukan setiap pengiriman katalog:
 * "baris mana yang belum dilihat perangkat ini" dan "baris mana yang boleh
 * dipensiunkan". Tanpa indeks, keduanya memindai seluruh produk tenant pada
 * setiap sinkronisasi — dan sinkronisasi katalog terjadi jauh lebih sering
 * daripada perubahan katalog.
 */
CREATE INDEX IF NOT EXISTS idx_products_tenant_revision
    ON pos.products (tenant_id, revision);

COMMENT ON COLUMN pos.products.revision IS
    'Nilai internal.tenants.catalog_revision saat baris ini terakhir berubah. '
    'Baris dengan revision > baseRevision milik perangkat BELUM PERNAH dilihat '
    'perangkat itu, jadi ketidakhadirannya dalam kiriman bukan berarti dihapus. '
    'Lihat migrasi 0045.';


-- 3. BASIS PERANGKAT YANG SUDAH ADA ---------------------------------------------
--
-- Produk yang sudah ada sebelum migrasi ini diberi revisi 0, sama seperti
-- perangkat yang belum pernah melapor. Yang penting bukan angkanya, melainkan
-- bahwa keduanya konsisten: perangkat lama mengirim baseRevision 0, produk lama
-- berevisi 0, sehingga aturan "revision <= baseRevision" memperlakukannya
-- sebagai sudah-dilihat — persis seperti keadaan sebelum migrasi ini.


-- 4. HAK AKSES -------------------------------------------------------------------

DO $$
DECLARE svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_ai','svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT, UPDATE ON internal.tenants TO %I', svc);
        END IF;
    END LOOP;
END $$;
