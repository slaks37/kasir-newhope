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
-- YANG DIPERBAIKI HANYA PENYAPUNYA, BUKAN SKEMANYA.
--
-- Godaan pertama adalah menyamakan kedua tabel — membuat ai_query_logs ikut
-- CASCADE. Itu KELIRU, dan docs/erd.md menjelaskan kenapa: SET NULL di sana
-- disengaja. "Jejak akses harus tetap ada setelah merchantnya pergi, justru
-- saat itulah biasanya dibutuhkan." Sebuah toko yang menghabiskan ribuan
-- kredit lalu menghapus akunnya adalah persis keadaan yang jejaknya paling
-- perlu dibaca.
--
-- Jadi barisnya tetap disimpan. Yang diperbaiki:
--
--   1. Baris yatim yang menggantung DITUTUP, bukan dihapus. Statusnya menjadi
--      REFUNDED supaya keluar dari antrean penyapu; isinya tetap bisa dibaca.
--   2. Penyapunya melewati baris tanpa pemilik, dan tidak berhenti pada
--      kegagalan satu baris. Penyapu yang mati pada gangguan pertama sama
--      tidak bergunanya dengan penyapu yang tidak pernah dijalankan.
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


-- 2. KENAPA SKEMANYA TIDAK DIUBAH ---------------------------------------------
--
-- business_id di sini tetap NULLABLE dan tetap ON DELETE SET NULL. Itu bukan
-- kelalaian; itu keputusan yang tercatat di docs/erd.md dan masih berlaku.
-- ai.credit_ledger boleh CASCADE karena ia catatan SALDO — tanpa dompetnya, ia
-- tidak punya arti. ai_query_logs catatan BIAYA dan pemakaian, dan justru
-- berguna setelah merchantnya pergi.

COMMENT ON COLUMN ai.ai_query_logs.business_id IS
    'Unit usaha yang bertanya. SET NULL saat unit usahanya dihapus — SENGAJA: jejak biaya harus tetap terbaca setelah merchantnya pergi. Baris tanpa pemilik dilewati penyapu, bukan dihapus.';


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
