-- =============================================================================
-- 0036_operasional_tersinkron.sql
--
-- ENAM ENTITAS YANG SELAMA INI HANYA ADA DI SATU PERANGKAT.
--
-- Katalog, pelanggan, cabang, dan transaksi sudah punya rumah di server. Yang
-- di bawah ini belum, dan seluruhnya hanya hidup di localStorage peramban yang
-- kebetulan dipakai:
--
--     meja          pos.dining_tables
--     bahan baku    pos.ingredients   (tabelnya SUDAH ADA sejak awal — tidak
--                                      pernah ditulis satu baris pun dari
--                                      aplikasi, karena tidak ada jalannya)
--     kode promo    pos.promo_codes
--     shift kasir   pos.cashier_shifts
--     absensi staf  pos.attendance_records
--     pengaturan    pos.store_settings
--
-- AKIBATNYA HARI INI, dan ini bukan kekhawatiran teoretis:
--
--   - Riwayat peramban dibersihkan -> seluruh denah meja, seluruh bahan baku,
--     seluruh kode promo, dan seluruh catatan absensi hilang tanpa salinan.
--   - Ganti perangkat -> pemilik mulai dari nol, meski katalognya utuh.
--   - Dua kasir di satu toko -> dua denah meja yang berbeda, dua rekap shift
--     yang tidak pernah bertemu.
--   - Panel admin TIDAK BISA menampilkan absensi atau selisih kas shift sama
--     sekali, karena datanya memang tidak pernah sampai.
--
-- SELISIH KAS DAN ABSENSI adalah dua yang paling serius. Keduanya dipakai
-- untuk menilai orang. Angka yang hanya ada di satu perangkat, bisa disunting
-- pemiliknya sendiri, dan lenyap saat cache dibersihkan bukan dasar yang layak
-- untuk itu.
--
-- POLA YANG DIIKUTI SAMA DENGAN 0012 DAN 0018: external_ref menyimpan id sisi
-- klien, UNIQUE per business, sehingga kiriman ulang dari perangkat yang sama
-- memperbarui barisnya alih-alih menggandakannya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0036_operasional_tersinkron.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. MEJA ---------------------------------------------------------------------
--
-- Namanya `dining_tables`, bukan `tables`. "tables" adalah kata yang dipakai
-- information_schema dan hampir setiap alat introspeksi; tabel bernama
-- `pos.tables` membuat setiap kueri katalog sistem harus dibaca dua kali untuk
-- memastikan yang mana yang dimaksud.
--
-- STATUS DAN PESANAN AKTIF TIDAK DISIMPAN. Keduanya berubah setiap beberapa
-- detik dan hanya berarti di perangkat yang sedang melayani meja itu; mengirim
-- keduanya berarti dua kasir saling menimpa status meja sepanjang jam sibuk.
-- Yang disinkronkan adalah DENAH — nama, kapasitas, zona — yang berubah
-- beberapa kali setahun.

CREATE TABLE IF NOT EXISTS pos.dining_tables (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id      UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    external_ref     VARCHAR(96),
    name             VARCHAR(60) NOT NULL,
    capacity         SMALLINT NOT NULL DEFAULT 4 CHECK (capacity > 0),
    zone             VARCHAR(60),
    business_sector  VARCHAR(16),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.dining_tables IS
    'Denah meja per unit usaha. Status meja dan pesanan yang sedang berjalan sengaja TIDAK disimpan di sini — keduanya hanya berarti di perangkat yang melayani meja itu.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_dining_tables_ref
    ON pos.dining_tables (business_id, external_ref) WHERE external_ref IS NOT NULL;


-- 2. BAHAN BAKU ---------------------------------------------------------------
--
-- Tabelnya sudah ada sejak migrasi pertama dan tidak pernah menerima satu baris
-- pun. Yang hilang bukan tabelnya melainkan external_ref: tanpa itu tidak ada
-- cara mencocokkan `stk-...` di perangkat dengan baris di sini, sehingga setiap
-- kiriman akan menggandakan seluruh daftar bahan.

ALTER TABLE pos.ingredients ADD COLUMN IF NOT EXISTS external_ref    VARCHAR(96);
ALTER TABLE pos.ingredients ADD COLUMN IF NOT EXISTS stock_type      VARCHAR(20);
ALTER TABLE pos.ingredients ADD COLUMN IF NOT EXISTS category_name   VARCHAR(80);
ALTER TABLE pos.ingredients ADD COLUMN IF NOT EXISTS location        VARCHAR(80);
ALTER TABLE pos.ingredients ADD COLUMN IF NOT EXISTS notes           VARCHAR(300);
ALTER TABLE pos.ingredients ADD COLUMN IF NOT EXISTS business_sector VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ingredients_ref
    ON pos.ingredients (business_id, external_ref) WHERE external_ref IS NOT NULL;

COMMENT ON COLUMN pos.ingredients.external_ref IS
    'Id sisi klien (stk-...). Tanpa ini setiap kiriman menggandakan seluruh daftar bahan.';


-- 3. KODE PROMO ---------------------------------------------------------------
--
-- `code` yang menjadi kunci alaminya, bukan external_ref: di sisi klien kode
-- promo memang tidak punya id sendiri — kodenya ITU identitasnya. Dua baris
-- "HEMAT10" di satu toko tidak punya arti apa pun kecuali kebingungan tentang
-- mana yang berlaku.

CREATE TABLE IF NOT EXISTS pos.promo_codes (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id         UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    code                VARCHAR(40) NOT NULL,
    discount_percent    NUMERIC(5,2) NOT NULL DEFAULT 0
                        CHECK (discount_percent >= 0 AND discount_percent <= 100),
    max_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (max_discount_amount >= 0),
    min_purchase_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_purchase_amount >= 0),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.promo_codes IS
    'Kode promo per unit usaha. Kuncinya kodenya sendiri — di sisi klien kode promo tidak punya id lain.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_codes_kode
    ON pos.promo_codes (business_id, upper(code));


-- 4. SHIFT KASIR --------------------------------------------------------------
--
-- SELISIH KAS DISIMPAN, TIDAK DIHITUNG ULANG SAAT DIBACA.
--
-- Alasannya sama dengan snapshot harga di transaction_items: `expected_cash`
-- adalah kesimpulan yang diambil pada saat shift ditutup, dari angka yang
-- berlaku saat itu. Menghitungnya ulang dari transaksi bulan lalu akan
-- mengubah selisih kas yang sudah ditandatangani orang — dan selisih kas
-- dipakai untuk menuduh orang mengambil uang. Angka yang bisa berubah sendiri
-- setelah dicatat tidak layak dipakai untuk itu.

CREATE TABLE IF NOT EXISTS pos.cashier_shifts (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id      UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    external_ref     VARCHAR(96),
    -- Staf yang membuka shift. SET NULL, bukan CASCADE: staf yang berhenti
    -- tidak boleh menghapus rekap kas yang pernah ia tutup.
    cashier_user_id  UUID REFERENCES pos.staff_users(id) ON DELETE SET NULL,
    cashier_name     VARCHAR(100) NOT NULL,
    opened_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    closed_at        TIMESTAMP WITH TIME ZONE,
    status           VARCHAR(10) NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'CLOSED')),
    initial_cash     NUMERIC(14,2) NOT NULL DEFAULT 0,
    cash_sales       NUMERIC(14,2) NOT NULL DEFAULT 0,
    qris_sales       NUMERIC(14,2) NOT NULL DEFAULT 0,
    card_sales       NUMERIC(14,2) NOT NULL DEFAULT 0,
    ewallet_sales    NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_sales      NUMERIC(14,2) NOT NULL DEFAULT 0,
    expected_cash    NUMERIC(14,2) NOT NULL DEFAULT 0,
    actual_cash      NUMERIC(14,2),
    difference       NUMERIC(14,2),
    total_orders     INTEGER NOT NULL DEFAULT 0,
    notes            VARCHAR(500),
    business_sector  VARCHAR(16),
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.cashier_shifts IS
    'Rekap buka/tutup kas per shift. Selisihnya disimpan sebagai kesimpulan saat penutupan, bukan dihitung ulang saat dibaca.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_shifts_ref
    ON pos.cashier_shifts (business_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_waktu
    ON pos.cashier_shifts (business_id, opened_at DESC);


-- 5. ABSENSI ------------------------------------------------------------------
--
-- Koordinat masuk dan pulang ikut disimpan karena geofence sudah ditegakkan di
-- klien, dan penegakan yang buktinya hanya ada di perangkat yang ditegakkan
-- bukan penegakan. Yang disimpan angka mentahnya, bukan kesimpulan
-- "di dalam radius" — radius cabang bisa diubah pemilik nanti, dan kesimpulan
-- lama akan ikut berubah tanpa ada yang menyadarinya.

CREATE TABLE IF NOT EXISTS pos.attendance_records (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id         UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    external_ref        VARCHAR(96),
    staff_user_id       UUID REFERENCES pos.staff_users(id) ON DELETE SET NULL,
    staff_ref           VARCHAR(96),
    staff_name          VARCHAR(100) NOT NULL,
    staff_role          VARCHAR(40),
    clock_in_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    clock_out_at        TIMESTAMP WITH TIME ZONE,
    status              VARCHAR(16) NOT NULL DEFAULT 'CLOCKED_IN'
                        CHECK (status IN ('CLOCKED_IN', 'CLOCKED_OUT')),
    outlet_id           UUID REFERENCES pos.outlets(id) ON DELETE SET NULL,
    outlet_ref          VARCHAR(96),
    outlet_name         VARCHAR(100),
    clock_in_lat        NUMERIC(10,7),
    clock_in_lon        NUMERIC(10,7),
    clock_in_distance_m INTEGER,
    clock_out_lat       NUMERIC(10,7),
    clock_out_lon       NUMERIC(10,7),
    clock_out_distance_m INTEGER,
    shift_notes         VARCHAR(500),
    business_sector     VARCHAR(16),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.attendance_records IS
    'Absensi masuk/pulang staf berikut koordinatnya. Koordinat disimpan mentah, bukan kesimpulan "dalam radius" — radius cabang bisa diubah kemudian.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_ref
    ON pos.attendance_records (business_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_waktu
    ON pos.attendance_records (business_id, clock_in_at DESC);


-- 6. PENGATURAN TOKO ----------------------------------------------------------
--
-- SATU BARIS PER UNIT USAHA, dan bentuknya campuran: kolom untuk yang dibaca
-- server, satu jsonb untuk sisanya.
--
-- Kolomnya bukan pilihan gaya. `tax_rate`, `service_rate`, dan tarif loyalitas
-- dipakai laporan dan Smart Assistant di sisi server; menyembunyikannya di
-- dalam jsonb berarti setiap kueri laporan harus tahu bentuk objek pengaturan
-- versi klien — kontrak yang berubah setiap kali ada kolom baru di layar
-- Pengaturan.
--
-- Sisanya masuk `extra` apa adanya. Pengaturan adalah bagian aplikasi yang
-- paling sering bertambah, dan memaksa migrasi baru untuk setiap sakelar
-- berarti sakelar itu akan disimpan di localStorage saja — persis keadaan yang
-- sedang diperbaiki berkas ini.

CREATE TABLE IF NOT EXISTS pos.store_settings (
    business_id           UUID PRIMARY KEY REFERENCES pos.businesses(id) ON DELETE CASCADE,
    store_name            VARCHAR(100),
    tagline               VARCHAR(200),
    address               VARCHAR(300),
    phone                 VARCHAR(40),
    tax_rate              NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    enable_tax            BOOLEAN NOT NULL DEFAULT FALSE,
    service_rate          NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (service_rate >= 0),
    enable_service        BOOLEAN NOT NULL DEFAULT FALSE,
    enable_loyalty        BOOLEAN NOT NULL DEFAULT FALSE,
    loyalty_earn_rate     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (loyalty_earn_rate >= 0),
    loyalty_redeem_rate   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (loyalty_redeem_rate >= 0),
    monthly_revenue_target NUMERIC(14,2),
    geofence_enforcement  VARCHAR(10)
                          CHECK (geofence_enforcement IS NULL
                                 OR geofence_enforcement IN ('STRICT', 'FLEXIBLE')),
    -- Sisa pengaturan apa adanya. TIDAK memuat kredensial apa pun: yang
    -- dikirim ke sini hanya preferensi tampilan dan struk.
    extra                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.store_settings IS
    'Pengaturan toko, satu baris per unit usaha. Yang dibaca server jadi kolom; sisanya di extra supaya sakelar baru tidak perlu migrasi.';


-- 7. PERMUKAAN KONTRAK ---------------------------------------------------------
--
-- Panel admin dan layanan lain membaca dari sini, bukan dari tabelnya
-- langsung — sama seperti seluruh permukaan contract yang lain. Bentuk tabel
-- boleh berubah tanpa menyeret pembacanya ikut rusak.

CREATE OR REPLACE VIEW contract.dining_tables AS
SELECT
    b.client_key                AS business_id,
    m.name                      AS merchant_name,
    t.external_ref              AS table_ref,
    t.name                      AS table_name,
    t.capacity,
    t.zone,
    t.business_sector,
    t.is_active,
    t.updated_at
  FROM pos.dining_tables t
  JOIN pos.businesses  b ON b.id = t.business_id
  LEFT JOIN pos.merchants m ON m.id = b.merchant_id;

CREATE OR REPLACE VIEW contract.ingredients AS
SELECT
    b.client_key                AS business_id,
    i.external_ref              AS ingredient_ref,
    i.name                      AS ingredient_name,
    i.sku,
    i.stock_type,
    i.category_name,
    i.current_stock,
    i.min_stock_alert,
    i.unit,
    i.cost_price,
    i.location,
    -- Dihitung di sini, bukan di setiap pembacanya. "Stok menipis" pernah
    -- berarti dua hal berbeda di dua layar yang berbeda.
    (i.current_stock <= i.min_stock_alert) AS stok_menipis,
    i.business_sector,
    i.updated_at
  FROM pos.ingredients i
  JOIN pos.businesses b ON b.id = i.business_id;

CREATE OR REPLACE VIEW contract.promo_codes AS
SELECT
    b.client_key                AS business_id,
    p.code,
    p.discount_percent,
    p.max_discount_amount,
    p.min_purchase_amount,
    p.is_active,
    p.created_at,
    p.updated_at
  FROM pos.promo_codes p
  JOIN pos.businesses b ON b.id = p.business_id;

-- REKAP KAS. `difference` sengaja ditampilkan APA ADANYA dari yang tersimpan,
-- bukan dihitung ulang sebagai actual - expected: kalau perangkat mengirim
-- angka yang tidak konsisten, itu FAKTA tentang perangkat itu dan harus
-- terlihat, bukan ditutupi perhitungan ulang yang selalu rapi.
CREATE OR REPLACE VIEW contract.cashier_shifts AS
SELECT
    b.client_key                AS business_id,
    m.name                      AS merchant_name,
    s.external_ref              AS shift_ref,
    s.cashier_name,
    s.opened_at,
    s.closed_at,
    s.status,
    s.initial_cash,
    s.cash_sales,
    s.qris_sales,
    s.card_sales,
    s.ewallet_sales,
    s.total_sales,
    s.expected_cash,
    s.actual_cash,
    s.difference,
    s.total_orders,
    s.notes,
    s.business_sector
  FROM pos.cashier_shifts s
  JOIN pos.businesses  b ON b.id = s.business_id
  LEFT JOIN pos.merchants m ON m.id = b.merchant_id;

CREATE OR REPLACE VIEW contract.attendance AS
SELECT
    b.client_key                AS business_id,
    m.name                      AS merchant_name,
    a.external_ref              AS attendance_ref,
    a.staff_name,
    a.staff_role,
    a.clock_in_at,
    a.clock_out_at,
    a.status,
    a.outlet_name,
    a.clock_in_distance_m,
    a.clock_out_distance_m,
    -- Lama kerja dalam menit. Absensi yang belum ditutup bernilai NULL, bukan
    -- nol: "belum pulang" dan "bekerja nol menit" adalah dua hal berbeda, dan
    -- keduanya pernah tercampur di layar rekap.
    CASE WHEN a.clock_out_at IS NOT NULL
         THEN ROUND(EXTRACT(EPOCH FROM (a.clock_out_at - a.clock_in_at)) / 60)::INTEGER
    END                         AS menit_kerja,
    a.shift_notes,
    a.business_sector
  FROM pos.attendance_records a
  JOIN pos.businesses  b ON b.id = a.business_id
  LEFT JOIN pos.merchants m ON m.id = b.merchant_id;

CREATE OR REPLACE VIEW contract.store_settings AS
SELECT
    b.client_key                AS business_id,
    COALESCE(s.store_name, b.name) AS store_name,
    s.tagline,
    s.address,
    s.phone,
    s.tax_rate,
    s.enable_tax,
    s.service_rate,
    s.enable_service,
    s.enable_loyalty,
    s.loyalty_earn_rate,
    s.loyalty_redeem_rate,
    s.monthly_revenue_target,
    s.geofence_enforcement,
    s.extra,
    s.updated_at
  FROM pos.store_settings s
  JOIN pos.businesses b ON b.id = s.business_id;
