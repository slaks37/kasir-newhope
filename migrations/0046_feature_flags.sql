-- =============================================================================
-- 0046_feature_flags.sql
--
-- Peluncuran bertahap (canary) — supaya perubahan yang salah menyentuh lima
-- merchant, bukan seluruhnya.
--
-- KEADAAN SEBELUM INI. Tidak ada bendera fitur sama sekali. Setiap perubahan
-- kode aktif untuk SEMUA merchant pada saat deployment selesai, dan satu-
-- satunya cara mematikannya adalah deployment berikutnya. Untuk aplikasi
-- kasir, "deployment berikutnya" berarti puluhan menit di mana sebagian
-- merchant tidak bisa berjualan.
--
-- YANG DIPASANG DI SINI adalah pemilihan sasaran di beberapa sumbu sekaligus,
-- karena satu sumbu tidak pernah cukup:
--
--   persentase    untuk canary sungguhan: 1% dulu, lihat, lalu 10%
--   sektor        perubahan resep hanya berarti untuk FNB; menyalakannya di
--                 barbershop hanya menambah risiko tanpa menambah informasi
--   tier paket    fitur Pro tidak perlu diuji pada merchant Free
--   daftar putih  merchant sendiri, mitra, dan merchant yang bersedia
--                 mencoba lebih dulu — ini yang paling sering dipakai di hari
--                 pertama
--   daftar hitam  merchant besar yang TIDAK boleh jadi kelinci percobaan,
--                 apa pun hasil undian persentasenya
--
-- URUTAN PENILAIANNYA PENTING, dan ditegakkan di internal.fn_flag_aktif():
-- daftar hitam mengalahkan segalanya, lalu daftar putih, baru penyaring dan
-- undian. Tanpa urutan itu, "jangan pernah nyalakan untuk merchant ini" hanya
-- akan menjadi saran.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0046_feature_flags.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


CREATE TABLE IF NOT EXISTS internal.feature_flags (
    key               VARCHAR(64) PRIMARY KEY,
    description       TEXT NOT NULL DEFAULT '',

    -- Sakelar induk. FALSE berarti mati untuk semua, apa pun isi kolom lain.
    -- Inilah tombol yang ditekan saat canary ternyata buruk.
    enabled           BOOLEAN NOT NULL DEFAULT FALSE,

    rollout_percent   SMALLINT NOT NULL DEFAULT 0
                      CHECK (rollout_percent BETWEEN 0 AND 100),

    -- NULL berarti "semua sektor"/"semua tier". Array kosong berarti TIDAK
    -- SATU PUN — perbedaan yang penting dan gampang salah tulis, jadi
    -- fn_flag_aktif() memperlakukan keduanya berbeda dengan sengaja.
    sectors           TEXT[],
    tiers             SMALLINT[],

    allow_tenants     UUID[] NOT NULL DEFAULT '{}',
    deny_tenants      UUID[] NOT NULL DEFAULT '{}',

    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE internal.feature_flags IS
    'Peluncuran bertahap. Lihat internal.fn_flag_aktif() untuk urutan penilaian.';
COMMENT ON COLUMN internal.feature_flags.sectors IS
    'NULL = semua sektor. Array kosong = tidak satu pun sektor.';
COMMENT ON COLUMN internal.feature_flags.tiers IS
    'NULL = semua tier. Array kosong = tidak satu pun tier.';
COMMENT ON COLUMN internal.feature_flags.deny_tenants IS
    'Mengalahkan segalanya, termasuk allow_tenants dan rollout_percent 100.';


-- PEMBAGIAN EMBER YANG STABIL ---------------------------------------------------
--
-- Dua sifat yang harus dipenuhi, dan keduanya sering dilanggar oleh
-- implementasi yang memakai random():
--
--   1. STABIL. Merchant yang sama harus selalu mendapat ember yang sama.
--      Fitur yang berkedip menyala-mati antar permintaan jauh lebih buruk
--      daripada fitur yang mati: kasir melihat tombol yang kadang ada kadang
--      hilang, dan tidak ada yang bisa mereproduksinya.
--
--   2. BERBEDA PER BENDERA. Kunci bendera IKUT di-hash. Kalau tidak, merchant
--      yang kebetulan ada di ember 1-5 akan menjadi kelinci percobaan untuk
--      SETIAP canary selamanya, sementara ember 50-55 tidak pernah mencoba
--      apa pun. Itu bukan peluncuran bertahap, itu memilih korban tetap.

CREATE OR REPLACE FUNCTION internal.fn_flag_bucket(kunci TEXT, tenant UUID)
RETURNS SMALLINT AS $$
    -- hashtext() cepat dan stabil di dalam satu versi PostgreSQL; itu cukup,
    -- karena yang dibutuhkan sebaran yang merata, bukan jaminan kriptografis.
    SELECT (abs(hashtext(kunci || ':' || tenant::text)) % 100)::SMALLINT;
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION internal.fn_flag_bucket(TEXT, UUID) IS
    'Ember 0-99 yang stabil per (bendera, tenant). Kunci bendera ikut di-hash '
    'supaya setiap canary memilih himpunan merchant yang berbeda.';


-- PENILAIAN ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION internal.fn_flag_aktif(kunci TEXT, tenant UUID)
RETURNS BOOLEAN AS $$
DECLARE
    f        internal.feature_flags%ROWTYPE;
    sektor   TEXT;
    tier     SMALLINT;
BEGIN
    SELECT * INTO f FROM internal.feature_flags WHERE key = kunci;

    -- Bendera yang tidak dikenal MATI. Bendera adalah cara menyalakan sesuatu
    -- dengan sengaja; salah ketik namanya tidak boleh berarti menyalakannya.
    IF NOT FOUND OR NOT f.enabled THEN
        RETURN FALSE;
    END IF;

    -- 1. Daftar hitam mengalahkan segalanya.
    IF tenant = ANY(f.deny_tenants) THEN
        RETURN FALSE;
    END IF;

    -- 2. Daftar putih mengalahkan penyaring dan undian.
    IF tenant = ANY(f.allow_tenants) THEN
        RETURN TRUE;
    END IF;

    -- 3. Penyaring sektor dan tier. NULL = semua.
    IF f.sectors IS NOT NULL THEN
        SELECT t.business_sector::text INTO sektor
          FROM internal.tenants t WHERE t.id = tenant;
        IF sektor IS NULL OR NOT (sektor = ANY(f.sectors)) THEN
            RETURN FALSE;
        END IF;
    END IF;

    IF f.tiers IS NOT NULL THEN
        SELECT p.tier_level INTO tier
          FROM billing.subscriptions s
          JOIN billing.plans p ON p.id = s.plan_id
         WHERE s.tenant_id = tenant
         ORDER BY s.created_at DESC LIMIT 1;
        -- Tanpa langganan berarti tier 1 (Free), bukan "lolos semua penyaring".
        tier := COALESCE(tier, 1);
        IF NOT (tier = ANY(f.tiers)) THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- 4. Undian, stabil per (bendera, tenant).
    RETURN internal.fn_flag_bucket(kunci, tenant) < f.rollout_percent;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION internal.fn_flag_aktif(TEXT, UUID) IS
    'Urutan: enabled -> deny -> allow -> sektor -> tier -> undian persentase. '
    'Bendera yang tidak dikenal selalu FALSE.';


-- LAPORAN ------------------------------------------------------------------------

DROP VIEW IF EXISTS contract.feature_flags CASCADE;
CREATE VIEW contract.feature_flags AS
SELECT
    f.key,
    f.description,
    f.enabled,
    f.rollout_percent,
    f.sectors,
    f.tiers,
    cardinality(f.allow_tenants) AS jumlah_daftar_putih,
    cardinality(f.deny_tenants)  AS jumlah_daftar_hitam,
    f.updated_at
  FROM internal.feature_flags f;

COMMENT ON VIEW contract.feature_flags IS
    'Keadaan bendera fitur. Daftar tenant dilaporkan sebagai JUMLAH, bukan '
    'isinya — siapa yang sedang jadi canary bukan urusan service lain.';


-- HAK AKSES ----------------------------------------------------------------------

DO $$
DECLARE svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_billing','svc_ai','svc_internal','bi_readonly'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON internal.feature_flags TO %I', svc);
            EXECUTE format('GRANT SELECT ON contract.feature_flags TO %I', svc);
            EXECUTE format('GRANT EXECUTE ON FUNCTION internal.fn_flag_aktif(TEXT, UUID) TO %I', svc);
            EXECUTE format('GRANT EXECUTE ON FUNCTION internal.fn_flag_bucket(TEXT, UUID) TO %I', svc);
        END IF;
    END LOOP;
    -- Hanya backoffice yang boleh MENGUBAH bendera.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT INSERT, UPDATE, DELETE ON internal.feature_flags TO svc_internal;
    END IF;
END $$;
