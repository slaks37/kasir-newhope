-- =============================================================================
-- 0044_stock_policy_and_oversell_guard.sql
--
-- Menutup overselling — dengan aturan yang berbeda per sektor, bukan satu
-- aturan seragam.
--
-- MASALAHNYA, dan buktinya.
--
-- `fn_apply_inventory_transaction` (0024) menambahkan delta secara ATOMIK:
--
--   current_stock = pos.inventory_balances.current_stock + EXCLUDED.current_stock
--
-- Itu benar-benar aman terhadap lost update — dua pengurangan bersamaan
-- keduanya tercatat. Tapi atomik BUKAN dijaga: fungsi itu tidak pernah
-- memeriksa apakah hasilnya negatif. Diuji langsung:
--
--   stok awal 1 unit
--   kasir-A: BERHASIL menjual
--   kasir-B: BERHASIL menjual
--   stok akhir: -1
--
-- KENAPA TIDAK CUKUP MENAMBAH `CHECK (current_stock >= 0)`.
--
-- Sistem ini melayani lima sektor dengan sifat stok yang berbeda secara
-- mendasar:
--
--   RETAIL   stok fisik mutlak. Menjual HP terakhir dua kali adalah kesalahan
--            yang harus dicegah, dan pelanggan kedua memang harus ditolak.
--
--   FNB      stok adalah TURUNAN RESEP. "Susu 4 liter" adalah perkiraan yang
--            selalu meleset — tumpah, takaran barista, sisa di kemasan.
--            Menolak menjual kopi karena angka susu di sistem menyentuh nol,
--            padahal kotaknya masih ada di kulkas, jauh lebih merugikan
--            daripada stok yang tercatat minus lalu direkonsiliasi sore hari.
--
--   LAUNDRY, CARWASH, BARBERSHOP  sebagian besar yang dijual adalah JASA.
--            Stoknya (deterjen, sampo, sabun) tidak pernah menghentikan
--            layanan.
--
-- Satu aturan seragam karenanya pasti salah untuk sebagian merchant. Yang
-- dipasang di sini adalah KEBIJAKAN PER MERCHANT dengan nilai bawaan menurut
-- sektornya, dan merchant bisa menimpanya.
--
--   BLOCK  penjualan yang membuat stok negatif DITOLAK (bawaan: RETAIL)
--   WARN   penjualan diterima, stok boleh negatif, tapi SELALU tercatat
--          sebagai selisih yang harus direkonsiliasi (bawaan: sektor lain)
--
-- Yang TIDAK ada adalah pilihan "diamkan". Stok negatif selalu meninggalkan
-- jejak; itulah bedanya dengan keadaan sebelum migrasi ini, di mana ia terjadi
-- tanpa siapa pun tahu.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0044_stock_policy_and_oversell_guard.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KEBIJAKAN PER MERCHANT ----------------------------------------------------
--
-- Kolomnya BOLEH NULL, dan NULL punya arti: "ikut bawaan sektor".
--
-- Rancangan pertama memakai `NOT NULL DEFAULT 'WARN'` lalu satu kali
-- `UPDATE ... WHERE business_sector='RETAIL'` untuk memperbaiki baris yang
-- sudah ada. Itu salah, dan salahnya baru terlihat saat seed dijalankan
-- SETELAH migrasi: merchant RETAIL yang baru dibuat mendapat 'WARN' dari
-- bawaan kolom, karena backfill sekali jalan hanya menyentuh baris yang ada
-- pada saat migrasi berjalan. Toko retail yang mendaftar besok akan boleh
-- menjual barang yang stoknya nol.
--
-- Backfill memperbaiki masa lalu; yang dibutuhkan adalah aturan yang berlaku
-- ke depan. Karena itu bawaannya diturunkan dari sektor SETIAP KALI dibaca,
-- bukan dibekukan sekali saat INSERT.

DO $$
DECLARE
    warisan_not_null BOOLEAN := FALSE;
BEGIN
    IF to_regclass('internal.merchants') IS NULL THEN
        RAISE NOTICE '0044: internal.merchants tidak ada, dilewati.';
        RETURN;
    END IF;

    SELECT (is_nullable = 'NO') INTO warisan_not_null
      FROM information_schema.columns
     WHERE table_schema='internal' AND table_name='merchants' AND column_name='stock_policy';

    IF warisan_not_null IS NULL THEN
        ALTER TABLE internal.merchants ADD COLUMN stock_policy VARCHAR(8);
        warisan_not_null := FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stock_policy') THEN
        ALTER TABLE internal.merchants
            ADD CONSTRAINT chk_stock_policy CHECK (stock_policy IN ('BLOCK', 'WARN'));
    END IF;

    /*
     * Hanya kalau kolomnya diwarisi dari versi AWAL migrasi ini (NOT NULL
     * DEFAULT 'WARN'). Di sana setiap baris memegang 'WARN' karena bawaan
     * kolom, bukan karena ada yang memilihnya — tidak terbedakan, jadi
     * dikembalikan ke NULL supaya bawaan sektor berlaku lagi.
     *
     * Syaratnya penting: tanpa itu, menjalankan ulang migrasi ini akan
     * MENGHAPUS pilihan 'WARN' yang sudah disetel merchant dengan sadar.
     */
    IF warisan_not_null THEN
        ALTER TABLE internal.merchants ALTER COLUMN stock_policy DROP DEFAULT;
        ALTER TABLE internal.merchants ALTER COLUMN stock_policy DROP NOT NULL;
        UPDATE internal.merchants SET stock_policy = NULL WHERE stock_policy = 'WARN';
    END IF;
END $$;

COMMENT ON COLUMN internal.merchants.stock_policy IS
    'NULL  = ikut bawaan sektor (RETAIL -> BLOCK, sektor lain -> WARN). '
    'BLOCK = penjualan yang membuat stok negatif ditolak. '
    'WARN  = diterima tapi selalu tercatat sebagai selisih. '
    'Baca lewat internal.fn_stock_policy(), jangan baca kolomnya langsung. '
    'Lihat migrasi 0044.';


-- 1b. BAWAAN MENURUT SEKTOR ----------------------------------------------------
--
-- Satu fungsi, dipakai trigger maupun laporan. Menaruh aturan ini di dua tempat
-- berarti suatu saat keduanya berbeda pendapat tentang apakah sebuah penjualan
-- boleh lewat.

CREATE OR REPLACE FUNCTION internal.fn_stock_policy(
    sektor   TEXT,
    pilihan  TEXT DEFAULT NULL
) RETURNS TEXT AS $$
    SELECT COALESCE(
        pilihan,
        CASE WHEN sektor = 'RETAIL' THEN 'BLOCK' ELSE 'WARN' END
    );
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION internal.fn_stock_policy(TEXT, TEXT) IS
    'Kebijakan stok yang BERLAKU: pilihan merchant kalau ada, kalau tidak bawaan '
    'sektornya. RETAIL menjual barang fisik sehingga stok negatif adalah kesalahan; '
    'sektor lain menjual jasa atau memakai stok turunan resep yang selalu meleset.';


-- 2. CATATAN SELISIH -----------------------------------------------------------
--
-- Stok negatif yang diizinkan tetap harus bisa ditemukan. Tanpa tabel ini,
-- "WARN" berarti "diamkan", dan itu persis keadaan yang sedang diperbaiki.

CREATE TABLE IF NOT EXISTS pos.stock_discrepancies (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id           UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id         UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id           UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    inventory_item_id   UUID NOT NULL REFERENCES pos.inventory_items(id) ON DELETE CASCADE,
    location_id         UUID,
    stok_sebelum        NUMERIC(14,3) NOT NULL,
    delta               NUMERIC(14,3) NOT NULL,
    stok_sesudah        NUMERIC(14,3) NOT NULL,
    reference_type      VARCHAR(32),
    reference_id        VARCHAR(96),
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_disc_merchant
    ON pos.stock_discrepancies (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_disc_belum_beres
    ON pos.stock_discrepancies (merchant_id) WHERE resolved_at IS NULL;

COMMENT ON TABLE pos.stock_discrepancies IS
    'Setiap kali stok menjadi negatif pada merchant berkebijakan WARN. '
    'Penjualannya tetap diterima; selisihnya menunggu rekonsiliasi.';


-- 3. PENJAGA DI TRIGGER --------------------------------------------------------
--
-- Ditegakkan di DATABASE, bukan di aplikasi. Aplikasi kasir bukan satu-satunya
-- penulis: skrip batch, penyesuaian manual, dan integrasi mana pun menulis ke
-- tabel yang sama. Penjaga di lapisan aplikasi hanya menjaga satu pintu.
--
-- Tetap ATOMIK: pemeriksaan dan penulisan terjadi dalam satu pernyataan UPSERT
-- yang sama, di bawah row lock yang sama. Dua kasir bersamaan tidak bisa
-- sama-sama melihat "stok masih 1".

CREATE OR REPLACE FUNCTION pos.fn_apply_inventory_transaction()
RETURNS TRIGGER AS $$
DECLARE
    stok_sesudah  NUMERIC(14,3);
    stok_sebelum  NUMERIC(14,3);
    kebijakan     VARCHAR(8);
    nama_item     TEXT;
BEGIN
    /*
     * UPSERT dulu, periksa hasilnya kemudian.
     *
     * Membaca saldo lebih dulu lalu memutuskan akan mengulang kesalahan yang
     * sama: dua transaksi bersamaan sama-sama membaca "1", sama-sama lolos.
     * Di sini penambahannya yang menentukan — RETURNING mengembalikan nilai
     * SETELAH baris terkunci dan diperbarui, jadi hanya satu yang bisa melihat
     * hasil non-negatif.
     */
    INSERT INTO pos.inventory_balances (
        tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, current_stock, updated_at
    ) VALUES (
        NEW.tenant_id, NEW.merchant_id, NEW.outlet_id, NEW.location_id,
        NEW.inventory_item_id, NEW.quantity_delta, CURRENT_TIMESTAMP
    )
    ON CONFLICT (outlet_id, location_id, inventory_item_id)
    DO UPDATE SET
        current_stock = pos.inventory_balances.current_stock + EXCLUDED.current_stock,
        updated_at = CURRENT_TIMESTAMP
    RETURNING current_stock INTO stok_sesudah;

    -- Penambahan stok tidak pernah bermasalah; keluar lebih awal.
    IF NEW.quantity_delta >= 0 OR stok_sesudah >= 0 THEN
        RETURN NEW;
    END IF;

    stok_sebelum := stok_sesudah - NEW.quantity_delta;

    SELECT internal.fn_stock_policy(m.business_sector::text, m.stock_policy) INTO kebijakan
      FROM internal.merchants m WHERE m.id = NEW.merchant_id;

    -- Merchant tidak ditemukan sama sekali: tolak. Menulis pergerakan stok
    -- untuk merchant yang tidak ada adalah kerusakan data, bukan penjualan
    -- yang perlu diloloskan.
    IF kebijakan IS NULL THEN
        RAISE EXCEPTION 'MERCHANT_TIDAK_DIKENAL: %', NEW.merchant_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF kebijakan = 'BLOCK' THEN
        SELECT i.item_name INTO nama_item
          FROM pos.inventory_items i WHERE i.id = NEW.inventory_item_id;

        /*
         * Pesan menyebut ANGKANYA, bukan sekadar "stok tidak cukup".
         *
         * Kasir yang melihat "stok tidak cukup" tidak tahu harus berbuat apa.
         * Kasir yang melihat "sisa 1, diminta 3" tahu bahwa ia bisa menjual
         * satu, atau bahwa angka di sistem perlu disesuaikan.
         */
        RAISE EXCEPTION
            'STOK_TIDAK_CUKUP: % — sisa %, diminta %',
            COALESCE(nama_item, NEW.inventory_item_id::text),
            stok_sebelum, ABS(NEW.quantity_delta)
            USING ERRCODE = 'check_violation';
    END IF;

    -- WARN: penjualan diterima, selisihnya dicatat supaya bisa ditemukan.
    INSERT INTO pos.stock_discrepancies (
        tenant_id, merchant_id, outlet_id, inventory_item_id, location_id,
        stok_sebelum, delta, stok_sesudah, reference_type, reference_id
    ) VALUES (
        NEW.tenant_id, NEW.merchant_id, NEW.outlet_id, NEW.inventory_item_id, NEW.location_id,
        stok_sebelum, NEW.quantity_delta, stok_sesudah, NEW.reference_type, NEW.reference_id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 4. LAPORAN SELISIH -----------------------------------------------------------

DROP VIEW IF EXISTS contract.stock_discrepancies CASCADE;
CREATE VIEW contract.stock_discrepancies AS
SELECT
    d.id,
    d.tenant_id,
    d.merchant_id,
    m.name                AS merchant_name,
    m.business_sector,
    o.name                AS outlet_name,
    i.item_name,
    i.sku,
    i.base_unit           AS unit,
    d.stok_sebelum,
    d.delta,
    d.stok_sesudah,
    d.reference_type,
    d.reference_id,
    d.resolved_at,
    (d.resolved_at IS NULL) AS belum_direkonsiliasi,
    d.created_at
  FROM pos.stock_discrepancies d
  JOIN internal.merchants m     ON m.id = d.merchant_id
  LEFT JOIN internal.outlets o  ON o.id = d.outlet_id
  LEFT JOIN pos.inventory_items i ON i.id = d.inventory_item_id;

COMMENT ON VIEW contract.stock_discrepancies IS
    'Stok yang menjadi negatif pada merchant berkebijakan WARN. Menunggu rekonsiliasi.';


-- 5. HAK AKSES -----------------------------------------------------------------

DO $$
DECLARE svc TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_pos') THEN
        GRANT ALL ON pos.stock_discrepancies TO svc_pos;
        GRANT SELECT ON internal.merchants TO svc_pos;
    END IF;
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_billing','svc_ai','svc_internal','bi_readonly'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION internal.fn_stock_policy(TEXT, TEXT) TO %I', svc);
        END IF;
    END LOOP;
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_billing','svc_ai','svc_internal','bi_readonly'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.stock_discrepancies TO %I', svc);
        END IF;
    END LOOP;
END $$;
