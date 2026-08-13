-- =============================================================================
-- 0010_credit_uuid.sql
--
-- Memperbaiki dua cacat yang saling menutupi sejak 0005.
--
-- 1. `merchant_ai_credits.merchant_id` diubah 0005 menjadi UUID, tapi fungsi
--    `consume_ai_credit(VARCHAR)` dan `refund_ai_credit(VARCHAR)` tidak ikut
--    diubah. Setiap pemanggilan gagal dengan "operator does not exist:
--    uuid = character varying".
--
--    Cacat ini tidak pernah muncul selama dompet kredit masih disimpan di
--    memori — fungsinya memang tidak pernah dipanggil. Begitu dompet
--    dipindahkan ke database, seluruh jalur kredit AI mati.
--
-- 2. AI Copilot mengenali merchant lewat string bebas (`usr-budi`), bukan UUID
--    tenant. `legacy_uuid()` dari 0005 memetakannya secara deterministik: input
--    sama selalu menghasilkan UUID sama, sehingga dompet tetap milik merchant
--    yang sama lintas restart dan lintas replika.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0010_credit_uuid.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

-- Versi VARCHAR dibuang; membiarkannya berarti pemanggil bisa memilih fungsi
-- yang salah tanpa peringatan apa pun.
DROP FUNCTION IF EXISTS consume_ai_credit(VARCHAR);
DROP FUNCTION IF EXISTS refund_ai_credit(VARCHAR);

CREATE OR REPLACE FUNCTION consume_ai_credit(p_merchant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_new_balance INT;
BEGIN
    -- Satu pernyataan, atomik. Dua request bersamaan pada saldo terakhir:
    -- satu mendapat TRUE, satu mendapat FALSE. Membaca-lalu-menulis dari
    -- aplikasi akan membiarkan keduanya lolos dan memberi satu panggilan LLM
    -- gratis setiap kali terjadi.
    UPDATE ai.merchant_ai_credits
       SET balance         = balance - 1,
           used_this_month = used_this_month + 1,
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id
       AND balance > 0
    RETURNING balance INTO v_new_balance;

    RETURN v_new_balance IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION consume_ai_credit(UUID) IS
    'Memakai satu kredit AI secara atomik. FALSE berarti kuota habis — pemanggil WAJIB menampilkan paywall dan TIDAK BOLEH memanggil model.';

CREATE OR REPLACE FUNCTION refund_ai_credit(p_merchant_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE ai.merchant_ai_credits
       SET balance         = balance + 1,
           used_this_month = GREATEST(0, used_this_month - 1),
           updated_at      = CURRENT_TIMESTAMP
     WHERE merchant_id = p_merchant_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refund_ai_credit(UUID) IS
    'Mengembalikan kredit ketika panggilan model gagal SETELAH kredit terpotong.';


-- Hak pakai untuk peran ai-service. Tanpa ini fungsinya ada tapi ditolak.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ai') THEN
        GRANT EXECUTE ON FUNCTION consume_ai_credit(UUID) TO svc_ai;
        GRANT EXECUTE ON FUNCTION refund_ai_credit(UUID)  TO svc_ai;
        GRANT EXECUTE ON FUNCTION legacy_uuid(TEXT)       TO svc_ai;
    END IF;
END $$;
