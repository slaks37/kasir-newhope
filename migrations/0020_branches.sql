-- =============================================================================
-- 0020_branches.sql
--
-- Memindahkan cabang dari localStorage ke database, supaya batas outlet paket
-- bisa benar-benar ditegakkan.
--
-- KENAPA INI PERLU. `max_outlets` sudah ada di billing.plans sejak 0014, sudah
-- bisa disunting admin, dan sudah ditolak aplikasi kasir lewat
-- bolehTambahOutlet(). Tapi cabang tidak pernah meninggalkan browser: seluruh
-- daftarnya hidup di StoreSettings.branches di localStorage. Akibatnya
-- penegakannya persis sekuat tombol Simpan di layar Pengaturan — siapa pun yang
-- menyunting localStorage, atau memakai perangkat kedua yang salinannya belum
-- pernah melihat cabang pertama, melewatinya tanpa hambatan.
--
-- Ini masalah yang sama dengan batas produk yang baru ditutup di jalur sinkron,
-- dan penutupannya menuntut satu hal yang belum ada: tempat di server untuk
-- menghitung cabang.
--
-- Tiga akibat lain yang ikut selesai:
--
--   1. Ganti perangkat, daftar cabang hilang. Tidak ada salinan di mana pun.
--   2. Panel admin tidak bisa menjawab "merchant ini punya berapa outlet"
--      selain dengan menebak.
--   3. Geofence absensi staf memakai koordinat yang hanya diketahui satu
--      browser. Dua perangkat bisa punya radius berbeda untuk cabang yang sama.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0020_branches.sql
--
-- HARUS dijalankan SESUDAH 0009_service_schemas.sql.
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. TABEL CABANG -------------------------------------------------------------
--
-- external_ref adalah id sisi klien (`branch-...`), pola yang sama dengan
-- products, users, dan customers: server tidak menebak identitas dari nama, dan
-- kiriman ulang dari perangkat yang sama selalu mengenai baris yang sama.

CREATE TABLE IF NOT EXISTS pos.branches (
    id                    UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id             UUID NOT NULL REFERENCES pos.tenants(id) ON DELETE CASCADE,
    external_ref          VARCHAR(96),

    name                  VARCHAR(120) NOT NULL,
    address               VARCHAR(300) NOT NULL DEFAULT '',

    -- Koordinat geofence absensi. NUMERIC, bukan FLOAT: selisih pembulatan
    -- pada derajat ke-6 sudah bernilai belasan sentimeter, dan radius yang
    -- dipakai di sini bisa serapat 50 meter.
    latitude              NUMERIC(10, 7),
    longitude             NUMERIC(10, 7),
    allowed_radius_meters INT NOT NULL DEFAULT 200
                          CHECK (allowed_radius_meters BETWEEN 10 AND 50000),

    business_sector       VARCHAR(16),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    notes                 TEXT,

    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Kunci idempotensi sinkron. Parsial karena external_ref boleh NULL untuk
-- cabang yang kelak dibuat langsung di server.
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_external
    ON pos.branches (tenant_id, external_ref)
 WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branches_tenant
    ON pos.branches (tenant_id, is_active);

COMMENT ON TABLE pos.branches IS
    'Cabang/outlet milik merchant. Jumlah baris AKTIF di sini yang dibatasi billing.plans.max_outlets.';
COMMENT ON COLUMN pos.branches.is_active IS
    'Cabang nonaktif TIDAK dihitung terhadap batas paket. Menutup cabang harus membebaskan kuotanya, kalau tidak merchant terkunci oleh cabang yang sudah tidak dipakai.';


-- 2. CABANG YANG SEDANG DIPAKAI -----------------------------------------------
--
-- Disimpan pada tenants, bukan pada branches, karena "sedang dipakai" adalah
-- satu nilai per merchant. Menyimpannya sebagai boolean di tiap baris cabang
-- memungkinkan dua cabang sama-sama aktif, dan tidak ada jawaban benar saat
-- itu terjadi.

ALTER TABLE pos.tenants
    ADD COLUMN IF NOT EXISTS active_branch_id UUID
    REFERENCES pos.branches(id) ON DELETE SET NULL;


-- 3. PERMUKAAN BACA -----------------------------------------------------------
--
-- Dinamai merchant_id seperti seluruh permukaan kontrak yang lain.

DROP VIEW IF EXISTS contract.branches CASCADE;
CREATE VIEW contract.branches AS
SELECT b.tenant_id                    AS merchant_id,
       b.id                           AS branch_id,
       b.external_ref,
       b.name,
       b.address,
       b.latitude,
       b.longitude,
       b.allowed_radius_meters,
       b.business_sector,
       b.is_active,
       (t.active_branch_id = b.id)    AS sedang_dipakai,
       b.created_at,
       b.updated_at
  FROM pos.branches b
  JOIN pos.tenants  t ON t.id = b.tenant_id;

COMMENT ON VIEW contract.branches IS
    'Cabang per merchant untuk panel admin dan laporan. Hanya baca.';


-- 4. PEMAKAIAN OUTLET TERHADAP BATAS PAKET ------------------------------------
--
-- Jawaban satu baris untuk "merchant ini sudah pakai berapa dari jatahnya",
-- supaya panel admin dan endpoint sinkron membaca angka yang sama.

DROP VIEW IF EXISTS contract.merchant_outlet_usage CASCADE;
CREATE VIEW contract.merchant_outlet_usage AS
SELECT t.id                                             AS merchant_id,
       COALESCE(e.max_outlets, 1)                       AS max_outlets,
       COUNT(b.id) FILTER (WHERE b.is_active)::int      AS outlet_aktif,
       GREATEST(
           COALESCE(e.max_outlets, 1)
           - COUNT(b.id) FILTER (WHERE b.is_active)::int,
           0
       )                                                AS sisa_kuota
  FROM pos.tenants t
  LEFT JOIN contract.merchant_entitlements e ON e.merchant_id = t.id
  LEFT JOIN pos.branches b                   ON b.tenant_id  = t.id
 GROUP BY t.id, e.max_outlets;

COMMENT ON VIEW contract.merchant_outlet_usage IS
    'Pemakaian outlet terhadap batas paket. Tanpa langganan, batasnya 1 — merchant yang belum berlangganan bukan merchant dengan paket termahal.';


-- 5. HAK AKSES ----------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON pos.branches TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.branches TO svc_backoffice;
        GRANT SELECT ON contract.merchant_outlet_usage TO svc_backoffice;
    END IF;
END $$;
