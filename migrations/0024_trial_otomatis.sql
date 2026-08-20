-- =============================================================================
-- 0024_trial_otomatis.sql
--
-- Merchant baru langsung mendapat Free Trial.
--
-- KENAPA DI DATABASE, BUKAN DI ENDPOINT PENDAFTARAN. Tidak ada satu endpoint
-- pendaftaran pun: akun dibuat lewat Supabase Auth di sisi klien, sementara
-- baris merchant lahir belakangan dan dari beberapa tempat — jalur sinkron
-- transaksi, jalur sinkron katalog, seed, dan panel admin. Menaruh aturannya di
-- salah satu dari mereka berarti jalur lain melewatkannya, dan merchant yang
-- lahir lewat jalur itu tidak pernah punya masa percobaan tanpa ada yang tahu.
--
-- Trigger pada pos.tenants menjadikannya satu aturan yang tidak bisa dilewati:
-- dari mana pun merchant itu dibuat, langganan percobaannya ikut lahir.
--
-- PAKETNYA DICARI, TIDAK DIPATOK. Yang dipilih adalah paket bertrial_days > 0
-- dengan tier terendah. Mengganti nama atau id paket percobaan di panel admin
-- tidak boleh mematikan pemberian trial — dan mematoknya pada 'plan-free-trial'
-- persis akan begitu.
--
-- TIDAK MENIMPA yang sudah ada. ON CONFLICT DO NOTHING: merchant yang dibuat
-- bersamaan dengan langganannya (seed, migrasi data) tetap memakai miliknya.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0024_trial_otomatis.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

CREATE OR REPLACE FUNCTION billing.beri_trial_merchant_baru()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    paket RECORD;
BEGIN
    SELECT id, trial_days INTO paket
      FROM billing.plans
     WHERE trial_days > 0 AND is_active
     ORDER BY tier_level
     LIMIT 1;

    -- Tidak ada paket percobaan yang dijual: merchant lahir tanpa langganan,
    -- persis seperti sebelumnya. Bukan galat — katalog tanpa trial adalah
    -- pilihan yang sah.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    INSERT INTO billing.subscriptions
        (id, tenant_id, plan_id, status, current_period_start, current_period_end)
    VALUES
        (uuidv7(), NEW.id, paket.id, 'TRIAL',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + (paket.trial_days || ' days')::interval)
    ON CONFLICT (tenant_id) DO NOTHING;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION billing.beri_trial_merchant_baru() IS
    'Memberi langganan percobaan kepada merchant yang baru lahir. Paketnya dicari dari katalog, tidak dipatok pada satu id.';

DROP TRIGGER IF EXISTS trg_trial_merchant_baru ON pos.tenants;
CREATE TRIGGER trg_trial_merchant_baru
    AFTER INSERT ON pos.tenants
    FOR EACH ROW
    EXECUTE FUNCTION billing.beri_trial_merchant_baru();


-- MERCHANT YANG SUDAH TERLANJUR LAHIR TANPA LANGGANAN -------------------------
--
-- Diberi trial yang sama. Tanpa ini, siapa pun yang mendaftar sebelum migrasi
-- ini dijalankan berada dalam keadaan yang paling membingungkan: tidak punya
-- langganan sama sekali, sehingga status.ts menjawab BELUM_BERLANGGANAN dan
-- aplikasinya jatuh ke entitlement darurat — lebih sempit daripada Free.

INSERT INTO billing.subscriptions
    (id, tenant_id, plan_id, status, current_period_start, current_period_end)
SELECT uuidv7(), t.id, p.id, 'TRIAL',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + (p.trial_days || ' days')::interval
  FROM pos.tenants t
 CROSS JOIN LATERAL (
     SELECT id, trial_days FROM billing.plans
      WHERE trial_days > 0 AND is_active ORDER BY tier_level LIMIT 1
 ) p
 WHERE NOT EXISTS (SELECT 1 FROM billing.subscriptions s WHERE s.tenant_id = t.id)
ON CONFLICT (tenant_id) DO NOTHING;
