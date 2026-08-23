-- =============================================================================
-- 0037_kas_harian.sql
--
-- UANG KELUAR TIDAK PUNYA TEMPAT DI SISTEM INI.
--
-- Sampai sekarang aplikasi hanya mengenal satu arah uang: penjualan. Isi laci
-- yang seharusnya dihitung sebagai `modal awal + penjualan tunai`, titik.
-- Di warung yang sesungguhnya, laci kasir dipakai untuk hal lain sepanjang
-- hari:
--
--   - belanja bahan mendadak ("beli telur dulu, kasnya nanti diganti")
--   - bayar ojek, parkir, kasbon karyawan
--   - setoran ke bank di tengah hari
--   - tambahan modal saat kembalian menipis
--
-- Tidak satu pun punya tempat untuk dicatat. Akibatnya SETIAP tutup kas
-- melaporkan selisih — uang yang "hilang" padahal jelas ke mana perginya.
-- Karena selisih kas dipakai untuk menilai kejujuran orang, sistem yang
-- membuat selisih itu tak terhindarkan bukan sekadar tidak lengkap: ia
-- menuduh orang yang tidak melakukan apa-apa.
--
-- YANG TIDAK MASUK KE SINI: PENJUALAN.
--
-- Struk sudah menjadi catatannya, di pos.transactions. Mencatatnya sekali lagi
-- sebagai "kas masuk" adalah cara paling cepat membuat omzet terhitung dua
-- kali — dan omzet yang terhitung dua kali tidak bisa diperbaiki dari layar
-- mana pun setelah dilaporkan ke pemilik. Yang menggabungkan keduanya adalah
-- VIEW di bawah, bukan tabelnya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0037_kas_harian.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. ENTRI KAS ----------------------------------------------------------------
--
-- `amount` SELALU POSITIF, arahnya ditentukan `entry_type`.
--
-- Menyimpan pengeluaran sebagai angka negatif tampak lebih ringkas sampai satu
-- baris lolos dengan tanda terbalik: penjumlahan tetap berjalan, hasilnya
-- tetap masuk akal, dan tidak ada satu pun pemeriksaan yang bisa
-- menangkapnya. CHECK di bawah membuat keadaan itu mustahil ada.

CREATE TABLE IF NOT EXISTS pos.cash_entries (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id     UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    external_ref    VARCHAR(96),
    entry_type      VARCHAR(16) NOT NULL
                    CHECK (entry_type IN ('MODAL_AWAL', 'MASUK', 'KELUAR')),
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    category        VARCHAR(80) NOT NULL DEFAULT 'Lainnya',
    note            VARCHAR(300),
    occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Shift yang sedang berjalan. SET NULL, bukan CASCADE: rekap shift yang
    -- dihapus tidak boleh menghapus bukti belanjanya.
    shift_id        UUID REFERENCES pos.cashier_shifts(id) ON DELETE SET NULL,
    shift_ref       VARCHAR(96),

    -- Siapa yang mencatat. Ini yang ditelusuri lebih dulu saat kas tidak cocok,
    -- jadi ia harus bertahan setelah orangnya berhenti bekerja.
    recorded_by     UUID REFERENCES pos.staff_users(id) ON DELETE SET NULL,
    recorded_by_ref VARCHAR(96),
    recorded_by_name VARCHAR(100),

    business_sector VARCHAR(16),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pos.cash_entries IS
    'Pergerakan uang tunai di laci yang BUKAN penjualan: modal awal, kas masuk lain, dan pengeluaran. Penjualan tetap hanya di pos.transactions supaya omzet tidak terhitung dua kali.';

COMMENT ON COLUMN pos.cash_entries.amount IS
    'Selalu positif. Arah uang ditentukan entry_type, bukan tanda angkanya.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_entries_ref
    ON pos.cash_entries (business_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_entries_waktu
    ON pos.cash_entries (business_id, occurred_at DESC);


-- 2. PERMUKAAN KONTRAK --------------------------------------------------------

CREATE OR REPLACE VIEW contract.cash_entries AS
SELECT
    b.client_key                AS business_id,
    m.name                      AS merchant_name,
    e.external_ref              AS entry_ref,
    e.entry_type,
    e.amount,
    -- Arah uang sebagai angka bertanda, DIHITUNG DI SINI dan hanya di sini.
    -- Setiap pembaca yang menurunkannya sendiri dari entry_type adalah satu
    -- kesempatan lagi untuk membalik tandanya.
    CASE WHEN e.entry_type = 'KELUAR' THEN -e.amount ELSE e.amount END AS amount_signed,
    e.category,
    e.note,
    e.occurred_at,
    e.shift_ref,
    e.recorded_by_name,
    e.business_sector
  FROM pos.cash_entries e
  JOIN pos.businesses  b ON b.id = e.business_id
  LEFT JOIN pos.merchants m ON m.id = b.merchant_id;


-- 3. REKAP HARIAN: OMZET + KAS DALAM SATU BARIS --------------------------------
--
-- INI PERTANYAAN YANG SELAMA INI TIDAK BISA DIJAWAB SISTEM MANA PUN DI SINI:
-- "hari ini masuk berapa, keluar berapa, dan di laci seharusnya ada berapa?"
--
-- OMZET DAN KAS DIBEDAKAN, dan pembedaan itu adalah seluruh gunanya view ini.
-- Omzet adalah semua penjualan apa pun cara bayarnya; kas hanya yang berbentuk
-- uang tunai. QRIS Rp 1 juta menambah omzet dan TIDAK menambah satu rupiah pun
-- isi laci. Menyamakan keduanya membuat pemilik mengira uangnya hilang.
--
-- Batas harinya `Asia/Jakarta`, sama dengan daily_sector_revenue. Memakai UTC
-- akan memindahkan penjualan sesudah pukul 07.00 WIB ke hari berikutnya, dan
-- rekap tutup kas malam hari tidak akan pernah cocok dengan laci.

CREATE OR REPLACE VIEW contract.daily_cash AS
WITH hari_jual AS (
    SELECT
        t.business_id,
        (t.created_at AT TIME ZONE 'Asia/Jakarta')::date        AS tanggal,
        SUM(t.total_amount)                                     AS omzet,
        SUM(t.total_amount) FILTER (WHERE upper(t.payment_method) IN ('CASH', 'TUNAI'))
                                                                AS omzet_tunai,
        COUNT(*)                                                AS jumlah_transaksi
      FROM pos.transactions t
     WHERE t.payment_status <> 'CANCELLED'
     GROUP BY 1, 2
),
hari_kas AS (
    SELECT
        e.business_id,
        (e.occurred_at AT TIME ZONE 'Asia/Jakarta')::date        AS tanggal,
        SUM(e.amount) FILTER (WHERE e.entry_type = 'MODAL_AWAL') AS modal_awal,
        SUM(e.amount) FILTER (WHERE e.entry_type = 'MASUK')      AS masuk_lain,
        SUM(e.amount) FILTER (WHERE e.entry_type = 'KELUAR')     AS keluar
      FROM pos.cash_entries e
     GROUP BY 1, 2
)
SELECT
    b.client_key                          AS business_id,
    m.name                                AS merchant_name,
    COALESCE(j.tanggal, k.tanggal)        AS tanggal,
    COALESCE(j.omzet, 0)                  AS omzet,
    COALESCE(j.omzet_tunai, 0)            AS omzet_tunai,
    COALESCE(j.omzet, 0) - COALESCE(j.omzet_tunai, 0) AS omzet_non_tunai,
    COALESCE(j.jumlah_transaksi, 0)       AS jumlah_transaksi,
    COALESCE(k.modal_awal, 0)             AS modal_awal,
    COALESCE(k.masuk_lain, 0)             AS kas_masuk_lain,
    COALESCE(k.keluar, 0)                 AS kas_keluar,
    -- Isi laci yang SEHARUSNYA ada. Sengaja TIDAK dijaga agar >= 0: saldo
    -- negatif berarti pengeluaran melebihi apa yang pernah masuk, dan itu
    -- keadaan yang harus terlihat, bukan dibulatkan supaya layarnya rapi.
      COALESCE(k.modal_awal, 0)
    + COALESCE(j.omzet_tunai, 0)
    + COALESCE(k.masuk_lain, 0)
    - COALESCE(k.keluar, 0)               AS saldo_kas_seharusnya
  FROM hari_jual j
  FULL OUTER JOIN hari_kas k
    ON k.business_id = j.business_id AND k.tanggal = j.tanggal
  JOIN pos.businesses  b ON b.id = COALESCE(j.business_id, k.business_id)
  LEFT JOIN pos.merchants m ON m.id = b.merchant_id;

COMMENT ON VIEW contract.daily_cash IS
    'Omzet dan kas satu hari dalam satu baris. FULL OUTER JOIN disengaja: hari yang hanya berisi pengeluaran tanpa penjualan tetap muncul — justru hari seperti itu yang paling perlu terlihat.';
