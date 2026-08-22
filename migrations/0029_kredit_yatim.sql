-- =============================================================================
-- 0029_kredit_yatim.sql
--
-- SATU MERCHANT DIHAPUS MEMATIKAN PENGEMBALIAN KREDIT UNTUK SEMUANYA.
--
-- Dua tabel yang saling menunjuk tidak sepakat soal apa yang terjadi ketika
-- sebuah unit usaha dihapus:
--
--     ai.ai_query_logs.business_id   ON DELETE SET NULL   (nullable)
--     ai.credit_ledger.business_id   ON DELETE CASCADE    (NOT NULL)
--
-- Akibatnya: unit usaha dihapus -> baris ledger-nya ikut hilang, tapi baris
-- ai_query_logs-nya BERTAHAN dengan business_id NULL. Kalau baris itu kebetulan
-- sedang berstatus RESERVED, ia menggantung selamanya — dan
-- ai.bersihkan_cadangan_menggantung() yang seharusnya membereskannya justru
-- MATI di baris itu:
--
--     null value in column "business_id" of relation "credit_ledger"
--
-- Penyapu itu satu transaksi. Satu baris yatim membuat SELURUH sapuan gagal,
-- jadi kredit merchant lain yang menggantung karena proses mati di tengah tidak
-- pernah dikembalikan juga. Satu toko yang dihapus setahun lalu diam-diam
-- menahan kredit semua orang.
--
-- DUA PERBAIKAN, SENGAJA KEDUANYA:
--
--   1. Kedua tabel disamakan: log pertanyaan ikut terhapus bersama unit
--      usahanya, sama seperti ledgernya. Menyimpan log tanpa pemilik tidak
--      menolong siapa pun — dompet yang akan dikreditkan sudah tidak ada.
--   2. Penyapunya tetap dibuat tahan terhadap baris yatim. Perbaikan skema
--      mencegah yang baru; baris yatim yang SUDAH terlanjur ada tetap harus
--      bisa dilewati, dan sapuan tidak boleh berhenti karena satu baris rusak.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0029_kredit_yatim.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. LOG YANG SUDAH YATIM DITUTUP ---------------------------------------------
--
-- Tidak bisa dikembalikan (dompetnya sudah tidak ada) dan tidak boleh terus
-- dicoba. Ditandai REFUNDED supaya keluar dari antrean penyapu, dengan
-- settled_at terisi supaya jelas kapan diputuskan.

UPDATE ai.ai_query_logs
   SET state = 'REFUNDED',
       settled_at = COALESCE(settled_at, CURRENT_TIMESTAMP)
 WHERE business_id IS NULL
   AND state = 'RESERVED';


-- 2. LOG IKUT TERHAPUS BERSAMA UNIT USAHANYA ----------------------------------

ALTER TABLE ai.ai_query_logs
    DROP CONSTRAINT IF EXISTS fk_ai_query_logs_merchant_id;
ALTER TABLE ai.ai_query_logs
    DROP CONSTRAINT IF EXISTS fk_ai_query_logs_business_id;

DELETE FROM ai.ai_query_logs WHERE business_id IS NULL;

ALTER TABLE ai.ai_query_logs
    ADD CONSTRAINT fk_ai_query_logs_business_id
    FOREIGN KEY (business_id) REFERENCES pos.businesses(id) ON DELETE CASCADE;

ALTER TABLE ai.ai_query_logs
    ALTER COLUMN business_id SET NOT NULL;

COMMENT ON COLUMN ai.ai_query_logs.business_id IS
    'Unit usaha yang bertanya. CASCADE, sama seperti ai.credit_ledger — log tanpa pemilik tidak bisa dikembalikan kreditnya dan hanya menyumbat penyapu.';


-- 3. PENYAPU TIDAK BOLEH MATI KARENA SATU BARIS -------------------------------
--
-- Dibangun ulang dengan dua penjagaan. Yang pertama menyaring baris tanpa
-- pemilik; yang kedua menangkap kegagalan tak terduga per baris supaya sisa
-- antreannya tetap diproses. Penyapu yang berhenti pada gangguan pertama sama
-- tidak bergunanya dengan penyapu yang tidak pernah dijalankan.

CREATE OR REPLACE FUNCTION ai.bersihkan_cadangan_menggantung(p_menit INT DEFAULT 15)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    n INT := 0;
    q RECORD;
BEGIN
    FOR q IN
        SELECT l.id FROM ai.ai_query_logs l
         WHERE l.state = 'RESERVED'
           AND l.business_id IS NOT NULL
           AND l.asked_at < CURRENT_TIMESTAMP - (p_menit || ' minutes')::interval
    LOOP
        BEGIN
            IF ai.kembalikan_kredit(q.id, 'Cadangan menggantung, dikembalikan otomatis') THEN
                n := n + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Dicatat, lalu lanjut. Satu baris rusak tidak boleh menahan kredit
            -- merchant lain yang menunggu dikembalikan.
            RAISE WARNING 'cadangan % gagal dikembalikan: %', q.id, SQLERRM;
        END;
    END LOOP;

    RETURN n;
END;
$$;

COMMENT ON FUNCTION ai.bersihkan_cadangan_menggantung IS
    'Mengembalikan kredit yang tercadang tapi tidak pernah selesai. Melewati baris tanpa pemilik dan tidak berhenti pada kegagalan satu baris. Jalankan berkala.';
