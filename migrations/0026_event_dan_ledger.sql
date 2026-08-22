-- =============================================================================
-- 0026_event_dan_ledger.sql
--
-- Efek transaksi menjadi CATATAN, bukan hasil menimpa angka.
--
-- MASALAH YANG DIPERBAIKI. Penjualan sekarang mengubah empat hal sekaligus,
-- semuanya dengan menimpa nilai yang ada:
--
--     products.stock      -= qty
--     ingredients.stock   -= resep x qty
--     customers.points    += ...
--     customers.total_spent += ...
--
-- Menimpa berarti tidak ada jawaban untuk "kenapa angkanya segini". Saat stok
-- di layar berbeda dari stok di rak, atau member protes poinnya berkurang,
-- satu-satunya yang tersimpan adalah nilai TERAKHIR — bukan urutan kejadian
-- yang menghasilkannya. Pembatalan pun jadi tebakan: mengembalikan sebanyak
-- yang SEHARUSNYA, bukan sebanyak yang dulu benar-benar diambil.
--
-- Ledger membalik arahnya: yang disimpan adalah PERISTIWA, dan saldo dihitung
-- darinya. Void tidak menghapus apa pun — ia menambahkan baris kebalikan, dan
-- riwayatnya tetap bisa dibaca.
--
-- CATATAN TENTANG OTORITAS. Ledger ini TIDAK memindahkan otoritas ke server
-- begitu saja. Kasir yang menjual saat internet mati tetap otoritas pada saat
-- itu — menunggu server berarti antrean berhenti. Yang berubah: perangkat
-- mengirim PERISTIWA, server menyusunnya menjadi saldo, dan saldo server itulah
-- yang menjadi rujukan saat dua perangkat berbeda pendapat. Optimistik di
-- perangkat, otoritatif di server, dan keduanya kini bisa dibandingkan.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0026_event_dan_ledger.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. MODE INVENTORI PADA PRODUK -----------------------------------------------
--
-- `products.stock -= qty` hanya benar kalau produknya memang barang jadi yang
-- dihitung. Untuk Nasi Goreng, stok produknya tidak berarti apa-apa — yang
-- berkurang beras, telur, dan minyak. Untuk potong rambut, tidak ada yang
-- berkurang sama sekali.
--
-- Tanpa pembedaan ini, sistem berpotensi mengurangi DUA KALI: satu dari stok
-- produk yang sebenarnya tidak dilacak, satu lagi dari bahan bakunya.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_mode_enum') THEN
        CREATE TYPE inventory_mode_enum AS ENUM ('NONE', 'STOCK', 'RECIPE');
    END IF;
END $$;

ALTER TABLE pos.products
    ADD COLUMN IF NOT EXISTS inventory_mode inventory_mode_enum NOT NULL DEFAULT 'STOCK';

COMMENT ON COLUMN pos.products.inventory_mode IS
    'NONE: jasa, tidak ada yang berkurang. STOCK: barang jadi, kurangi products.stock. RECIPE: kurangi bahan baku lewat resep, stok produk diabaikan.';

-- Produk yang PUNYA resep jelas berbasis resep. Sisanya biarkan STOCK —
-- menebak NONE untuk mereka akan mematikan pelacakan stok yang sudah berjalan.
UPDATE pos.products p
   SET inventory_mode = 'RECIPE'
 WHERE inventory_mode = 'STOCK'
   AND EXISTS (SELECT 1 FROM pos.product_recipes r WHERE r.product_id = p.id);


-- 2. PERISTIWA DOMAIN ---------------------------------------------------------
--
-- Satu baris per kejadian yang punya akibat. Inilah yang menggantikan rantai
-- FinalizeOrder -> MutateStock -> UpdateShift -> UpdateCustomer: transaksi
-- menerbitkan peristiwa, dan efeknya diturunkan dari sana.

CREATE TABLE IF NOT EXISTS pos.domain_events (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id    UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    event_type     VARCHAR(40) NOT NULL,
    -- Transaksi yang menjadi sumber peristiwa, bila ada.
    transaction_id UUID REFERENCES pos.transactions(id) ON DELETE SET NULL,
    occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Perangkat yang menerbitkannya. Saat dua perangkat berbeda pendapat,
    -- inilah yang menjawab siapa mencatat apa.
    device_ref     VARCHAR(128),
    -- Kunci idempotensi dari sisi klien. Kiriman ulang tidak boleh
    -- menghasilkan efek kedua.
    idempotency_key VARCHAR(128) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_events_idem
    ON pos.domain_events (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_domain_events_business_time
    ON pos.domain_events (business_id, occurred_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_domain_event_type') THEN
        ALTER TABLE pos.domain_events ADD CONSTRAINT ck_domain_event_type
            CHECK (event_type IN ('ORDER_PAID', 'ORDER_VOIDED', 'STOCK_ADJUSTED', 'STOCK_RECEIVED'));
    END IF;
END $$;

COMMENT ON TABLE pos.domain_events IS
    'Append-only. Peristiwa yang punya akibat; efeknya diturunkan menjadi baris ledger.';


-- 3. LEDGER PERSEDIAAN --------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.inventory_ledger (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id    UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    event_id       UUID REFERENCES pos.domain_events(id) ON DELETE SET NULL,

    -- Produk jadi dan bahan baku hidup di dua tabel berbeda, jadi jenisnya
    -- ikut disimpan. Tanpa itu, id yang sama di dua tabel akan tertukar.
    item_type      VARCHAR(16) NOT NULL,
    item_id        UUID NOT NULL,
    item_name      VARCHAR(160) NOT NULL,

    -- NEGATIF untuk yang keluar, POSITIF untuk yang masuk. Tidak ada kolom
    -- "arah" terpisah: satu angka bertanda tidak bisa bertentangan dengan
    -- dirinya sendiri.
    delta          NUMERIC(14, 3) NOT NULL,
    unit           VARCHAR(24),

    reason         VARCHAR(24) NOT NULL,
    transaction_id UUID REFERENCES pos.transactions(id) ON DELETE SET NULL,
    note           TEXT,
    occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inv_ledger_item_type') THEN
        ALTER TABLE pos.inventory_ledger ADD CONSTRAINT ck_inv_ledger_item_type
            CHECK (item_type IN ('PRODUCT', 'INGREDIENT'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inv_ledger_reason') THEN
        ALTER TABLE pos.inventory_ledger ADD CONSTRAINT ck_inv_ledger_reason
            CHECK (reason IN ('SALE', 'RECIPE_CONSUMPTION', 'VOID_REVERSAL',
                              'ADJUSTMENT', 'RESTOCK', 'OPENING_BALANCE'));
    END IF;
    -- Delta nol adalah baris yang tidak mengubah apa pun. Membiarkannya masuk
    -- hanya membuat riwayat lebih panjang tanpa menambah keterangan.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inv_ledger_delta') THEN
        ALTER TABLE pos.inventory_ledger ADD CONSTRAINT ck_inv_ledger_delta
            CHECK (delta <> 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inv_ledger_item
    ON pos.inventory_ledger (business_id, item_type, item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_txn
    ON pos.inventory_ledger (transaction_id);

COMMENT ON TABLE pos.inventory_ledger IS
    'Append-only. Saldo stok adalah jumlah delta di sini, bukan angka yang ditimpa.';


-- 4. LEDGER LOYALITAS ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.loyalty_ledger (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id    UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES pos.customers(id) ON DELETE CASCADE,
    event_id       UUID REFERENCES pos.domain_events(id) ON DELETE SET NULL,

    delta_points   INT NOT NULL DEFAULT 0,
    delta_spent    NUMERIC(14, 2) NOT NULL DEFAULT 0,
    delta_visits   INT NOT NULL DEFAULT 0,

    reason         VARCHAR(24) NOT NULL,
    transaction_id UUID REFERENCES pos.transactions(id) ON DELETE SET NULL,
    note           TEXT,
    occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loy_ledger_reason') THEN
        ALTER TABLE pos.loyalty_ledger ADD CONSTRAINT ck_loy_ledger_reason
            CHECK (reason IN ('EARN', 'REDEEM', 'VOID_REVERSAL',
                              'ADJUSTMENT', 'EXPIRY', 'OPENING_BALANCE'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_loy_ledger_customer
    ON pos.loyalty_ledger (business_id, customer_id, occurred_at DESC);

COMMENT ON TABLE pos.loyalty_ledger IS
    'Append-only. Menjawab "kenapa poin saya segini" — pertanyaan yang tidak bisa dijawab angka yang ditimpa.';


-- 5. SALDO SEBAGAI TURUNAN ----------------------------------------------------
--
-- View, bukan tabel. Saldo yang disimpan sebagai kolom akan menyimpang dari
-- ledgernya cepat atau lambat, dan begitu itu terjadi tidak ada cara memilih
-- mana yang benar.

DROP VIEW IF EXISTS contract.stock_balance CASCADE;
CREATE VIEW contract.stock_balance AS
SELECT l.business_id,
       l.item_type,
       l.item_id,
       MAX(l.item_name)          AS item_name,
       MAX(l.unit)               AS unit,
       SUM(l.delta)              AS saldo,
       MAX(l.occurred_at)        AS terakhir_bergerak,
       COUNT(*)::int             AS jumlah_mutasi
  FROM pos.inventory_ledger l
 GROUP BY l.business_id, l.item_type, l.item_id;

COMMENT ON VIEW contract.stock_balance IS
    'Saldo stok menurut server: jumlah seluruh mutasi. Ini rujukan saat dua perangkat berbeda pendapat.';

DROP VIEW IF EXISTS contract.loyalty_balance CASCADE;
CREATE VIEW contract.loyalty_balance AS
SELECT l.business_id,
       l.customer_id,
       c.name                    AS customer_name,
       SUM(l.delta_points)::int  AS poin,
       SUM(l.delta_spent)        AS total_belanja,
       SUM(l.delta_visits)::int  AS kunjungan,
       MAX(l.occurred_at)        AS terakhir_bergerak
  FROM pos.loyalty_ledger l
  JOIN pos.customers c ON c.id = l.customer_id
 GROUP BY l.business_id, l.customer_id, c.name;

COMMENT ON VIEW contract.loyalty_balance IS
    'Saldo poin menurut server, dihitung dari ledger.';


-- 6. SELISIH PERANGKAT vs SERVER ----------------------------------------------
--
-- Inilah yang membuat "optimistik di perangkat, otoritatif di server" bisa
-- ditegakkan tanpa menghentikan kasir: keduanya dicatat, dan selisihnya bisa
-- dilihat. Tanpa view ini, penyimpangan multi-perangkat hanya ketahuan saat
-- ada yang mengeluh.

DROP VIEW IF EXISTS contract.stock_drift CASCADE;
CREATE VIEW contract.stock_drift AS
SELECT p.business_id,
       'PRODUCT'::varchar          AS item_type,
       p.id                        AS item_id,
       p.name                      AS item_name,
       p.stock                     AS saldo_perangkat,
       COALESCE(b.saldo, 0)        AS saldo_server,
       p.stock - COALESCE(b.saldo, 0) AS selisih
  FROM pos.products p
  LEFT JOIN contract.stock_balance b
         ON b.item_id = p.id AND b.item_type = 'PRODUCT'
 WHERE p.inventory_mode = 'STOCK';

COMMENT ON VIEW contract.stock_drift IS
    'Selisih antara stok yang diyakini perangkat dan saldo menurut ledger server. Selisih bukan galat — ia antrian yang belum terkirim, atau perangkat yang perlu direkonsiliasi.';


-- 7. HAK AKSES ----------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT, INSERT ON pos.domain_events, pos.inventory_ledger, pos.loyalty_ledger TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.stock_balance, contract.loyalty_balance, contract.stock_drift TO svc_backoffice;
    END IF;
END $$;
