-- =============================================================================
-- 0027_kredit_ai_ledger.sql
--
-- Kredit AI: mesin keadaan + ledger, menggantikan `balance -= 1` / `balance += 1`.
--
-- MASALAH YANG DIPERBAIKI. Alurnya sekarang dua perintah terpisah:
--
--     consume_ai_credit()  ->  panggil LLM  ->  gagal  ->  refund_ai_credit()
--
-- Kalau proses mati SETELAH LLM menjawab tapi SEBELUM jawabannya tercatat,
-- yang tersisa adalah kredit terpotong, jawaban hilang, dan tidak ada apa pun
-- yang menandai bahwa keduanya berhubungan. Merchant membayar untuk sesuatu
-- yang tidak pernah ia terima, dan tidak ada cara menemukannya kembali karena
-- pemotongan tidak menyimpan alasannya.
--
-- Kiriman ulang memperburuknya: pertanyaan yang sama dikirim dua kali memotong
-- dua kredit, karena tidak ada kunci yang menghubungkan percobaan kedua dengan
-- yang pertama.
--
-- SESUDAH MIGRASI INI:
--
--     RESERVED  --commit-->  SUCCEEDED
--        |
--        +-----refund---->  REFUNDED
--
-- Setiap perpindahan meninggalkan baris ledger. Saldo dihitung darinya, dan
-- cadangan yang menggantung bisa ditemukan serta dikembalikan tanpa menebak.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0027_kredit_ai_ledger.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KEADAAN SEBUAH PERTANYAAN ------------------------------------------------

ALTER TABLE ai.ai_query_logs
    ADD COLUMN IF NOT EXISTS state VARCHAR(16) NOT NULL DEFAULT 'SUCCEEDED';

ALTER TABLE ai.ai_query_logs
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

ALTER TABLE ai.ai_query_logs
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ai_query_state') THEN
        ALTER TABLE ai.ai_query_logs ADD CONSTRAINT ck_ai_query_state
            CHECK (state IN ('RESERVED', 'SUCCEEDED', 'FAILED', 'REFUNDED'));
    END IF;
END $$;

-- Kunci idempotensi: percobaan kedua atas pertanyaan yang sama harus mengenai
-- baris yang sama, bukan membuat cadangan baru.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_query_idem
    ON ai.ai_query_logs (business_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;

-- Cadangan yang menggantung dicari lewat indeks ini, bukan dengan memindai
-- seluruh riwayat pertanyaan.
CREATE INDEX IF NOT EXISTS idx_ai_query_reserved
    ON ai.ai_query_logs (state, asked_at)
 WHERE state = 'RESERVED';

COMMENT ON COLUMN ai.ai_query_logs.state IS
    'RESERVED: kredit sudah dipotong, jawaban belum pasti. SUCCEEDED: selesai. REFUNDED: dikembalikan.';


-- 2. LEDGER KREDIT ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai.credit_ledger (
    id           UUID PRIMARY KEY DEFAULT uuidv7(),
    business_id  UUID NOT NULL REFERENCES pos.businesses(id) ON DELETE CASCADE,
    -- NEGATIF saat kredit dipakai, POSITIF saat diberikan atau dikembalikan.
    delta        INT NOT NULL,
    reason       VARCHAR(24) NOT NULL,
    query_id     UUID REFERENCES ai.ai_query_logs(id) ON DELETE SET NULL,
    note         TEXT,
    occurred_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_ledger_reason') THEN
        ALTER TABLE ai.credit_ledger ADD CONSTRAINT ck_credit_ledger_reason
            CHECK (reason IN ('MONTHLY_GRANT', 'RESERVE', 'REFUND', 'TOPUP',
                              'EXPIRY', 'ADJUSTMENT', 'OPENING_BALANCE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_credit_ledger_delta') THEN
        ALTER TABLE ai.credit_ledger ADD CONSTRAINT ck_credit_ledger_delta
            CHECK (delta <> 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_business
    ON ai.credit_ledger (business_id, occurred_at DESC);

COMMENT ON TABLE ai.credit_ledger IS
    'Append-only. Menjawab "kenapa kredit saya berkurang" — pertanyaan yang tidak bisa dijawab saldo yang ditimpa.';


-- 3. CADANGKAN KREDIT ---------------------------------------------------------
--
-- Satu pernyataan atomik: memotong saldo DAN mencatat alasannya. Memisahkan
-- keduanya membuka jendela ketika kredit sudah hilang tapi belum ada yang tahu
-- untuk apa.

CREATE OR REPLACE FUNCTION ai.cadangkan_kredit(
    p_business_id UUID,
    p_query_id    UUID,
    p_idem_key    VARCHAR(128)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    sudah_dicadangkan BOOLEAN;
BEGIN
    -- Percobaan ulang atas pertanyaan yang sama TIDAK memotong lagi.
    --
    -- Yang diperiksa adalah LEDGER, bukan ai_query_logs. Pemanggil menyisipkan
    -- baris pertanyaannya lebih dulu, jadi memeriksa tabel itu berarti selalu
    -- menemukan barisnya sendiri dan keluar tanpa memotong apa pun — kredit
    -- tidak pernah berkurang, dan seluruh kuota menjadi tak terbatas.
    --
    -- Ledger hanya berisi apa yang benar-benar terjadi, jadi ia jawaban yang
    -- benar untuk "apakah ini sudah pernah dipotong".
    SELECT EXISTS (
        SELECT 1 FROM ai.credit_ledger
         WHERE query_id = p_query_id AND reason = 'RESERVE'
    ) INTO sudah_dicadangkan;

    IF sudah_dicadangkan THEN
        RETURN TRUE;
    END IF;

    UPDATE ai.merchant_ai_credits
       SET balance         = balance - 1,
           used_this_month = used_this_month + 1,
           updated_at      = CURRENT_TIMESTAMP
     WHERE business_id = p_business_id
       AND balance > 0;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    INSERT INTO ai.credit_ledger (id, business_id, delta, reason, query_id, note)
    VALUES (uuidv7(), p_business_id, -1, 'RESERVE', p_query_id,
            'Dicadangkan sebelum memanggil model');

    RETURN TRUE;
END;
$$;


-- 4. SELESAIKAN ATAU KEMBALIKAN ------------------------------------------------

CREATE OR REPLACE FUNCTION ai.selesaikan_kredit(p_query_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ai.ai_query_logs
       SET state = 'SUCCEEDED', settled_at = CURRENT_TIMESTAMP
     WHERE id = p_query_id AND state = 'RESERVED';

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION ai.kembalikan_kredit(p_query_id UUID, p_alasan TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
BEGIN
    -- HANYA dari RESERVED. Mengembalikan kredit untuk pertanyaan yang sudah
    -- SUCCEEDED berarti merchant mendapat jawaban gratis; mengembalikannya dua
    -- kali berarti saldo bertambah dari udara.
    UPDATE ai.ai_query_logs
       SET state = 'REFUNDED', settled_at = CURRENT_TIMESTAMP
     WHERE id = p_query_id AND state = 'RESERVED'
    RETURNING business_id INTO r;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE ai.merchant_ai_credits
       SET balance         = balance + 1,
           used_this_month = GREATEST(0, used_this_month - 1),
           updated_at      = CURRENT_TIMESTAMP
     WHERE business_id = r.business_id;

    INSERT INTO ai.credit_ledger (id, business_id, delta, reason, query_id, note)
    VALUES (uuidv7(), r.business_id, 1, 'REFUND', p_query_id,
            COALESCE(p_alasan, 'Panggilan model gagal'));

    RETURN TRUE;
END;
$$;


-- 5. CADANGAN YANG MENGGANTUNG ------------------------------------------------
--
-- Proses yang mati di tengah meninggalkan RESERVED selamanya. Inilah yang
-- menemukannya — dan tanpa ini, satu-satunya cara mengetahuinya adalah menunggu
-- merchant mengeluh saldonya berkurang tanpa jawaban.

CREATE OR REPLACE FUNCTION ai.bersihkan_cadangan_menggantung(p_menit INT DEFAULT 15)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    n INT := 0;
    q RECORD;
BEGIN
    FOR q IN
        SELECT id FROM ai.ai_query_logs
         WHERE state = 'RESERVED'
           AND asked_at < CURRENT_TIMESTAMP - (p_menit || ' minutes')::interval
    LOOP
        IF ai.kembalikan_kredit(q.id, 'Cadangan menggantung, dikembalikan otomatis') THEN
            n := n + 1;
        END IF;
    END LOOP;

    RETURN n;
END;
$$;

COMMENT ON FUNCTION ai.bersihkan_cadangan_menggantung IS
    'Mengembalikan kredit yang tercadang tapi tidak pernah selesai. Jalankan berkala.';


-- 6. PERMUKAAN BACA -----------------------------------------------------------

DROP VIEW IF EXISTS contract.ai_credit_ledger CASCADE;
CREATE VIEW contract.ai_credit_ledger AS
SELECT l.business_id,
       SUM(l.delta)::int                                        AS saldo_ledger,
       SUM(l.delta) FILTER (WHERE l.reason = 'RESERVE')::int     AS terpakai,
       SUM(l.delta) FILTER (WHERE l.reason = 'REFUND')::int      AS dikembalikan,
       MAX(l.occurred_at)                                        AS terakhir_bergerak
  FROM ai.credit_ledger l
 GROUP BY l.business_id;

DROP VIEW IF EXISTS contract.ai_credit_drift CASCADE;
CREATE VIEW contract.ai_credit_drift AS
SELECT c.business_id,
       c.balance                       AS saldo_tersimpan,
       COALESCE(l.saldo_ledger, 0)
         + c.monthly_grant             AS saldo_menurut_ledger,
       (SELECT COUNT(*)::int FROM ai.ai_query_logs q
         WHERE q.business_id = c.business_id AND q.state = 'RESERVED') AS menggantung
  FROM ai.merchant_ai_credits c
  LEFT JOIN contract.ai_credit_ledger l ON l.business_id = c.business_id;

COMMENT ON VIEW contract.ai_credit_drift IS
    'Selisih saldo tersimpan vs ledger, dan jumlah cadangan yang menggantung. Selisih berarti ada yang tidak tercatat.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT, INSERT ON ai.credit_ledger TO svc_ai;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.ai_credit_ledger, contract.ai_credit_drift TO svc_backoffice;
    END IF;
END $$;


-- 7. KESEGARAN DATA PADA INSIGHT ----------------------------------------------
--
-- contract.merchant_revenue dihitung saat ditanya — selalu terkini. Sementara
-- daily_merchant_insights dihasilkan batch pukul 01:00, jadi isinya berumur
-- sampai 24 jam.
--
-- Tanpa menandai bedanya, asisten bisa menjawab "omzet Anda hari ini turun 20%"
-- memakai angka SEMALAM, dan merchant mengambil keputusan atas dasar itu.
-- Kesalahan seperti ini tidak pernah terlihat sebagai galat — angkanya nyata,
-- hanya saja bukan angka hari ini.

DROP VIEW IF EXISTS contract.insight_freshness CASCADE;
CREATE VIEW contract.insight_freshness AS
SELECT i.business_id,
       i.category,
       i.insight_date,
       i.updated_at,
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - i.updated_at)) / 3600 AS umur_jam,
       -- Batasnya 26 jam, bukan 24: batch berjalan sekali sehari, dan yang
       -- terlambat sejam belum tentu basi. Yang lewat dari itu sudah pasti
       -- melewatkan satu putaran.
       (CURRENT_TIMESTAMP - i.updated_at) > INTERVAL '26 hours' AS basi,
       'BATCH'::varchar AS sumber
  FROM ai.daily_merchant_insights i
 WHERE i.status = 'ACTIVE';

COMMENT ON VIEW contract.insight_freshness IS
    'Umur tiap insight. Yang basi tidak boleh disajikan sebagai keadaan hari ini — angkanya nyata, tapi bukan angka sekarang.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT SELECT ON contract.insight_freshness TO svc_ai;
    END IF;
END $$;
