-- =============================================================================
-- 0030_mrr_dipisah.sql
--
-- "LANGGANAN AKTIF" BUKAN "UANG SUDAH MASUK".
--
-- contract.subscription_status memberi dua angka: contract_mrr_idr dan
-- recognised_mrr_idr. Keduanya harga paket; bedanya hanya yang kedua disyaratkan
-- status = 'ACTIVE'. Nama "recognised" karena itu menjanjikan sesuatu yang tidak
-- dibuktikannya.
--
-- Langganan bisa ACTIVE sementara fakturnya belum dibayar. Merchant yang
-- pembayarannya gagal tetap ACTIVE sampai periodenya habis — memang disengaja,
-- supaya kasirnya tidak mati di tengah hari kerja karena kartu tertolak. Tapi
-- dashboard yang membaca recognised_mrr_idr akan melaporkannya sebagai
-- pendapatan yang sudah diakui, padahal belum ada rupiah yang masuk.
--
-- Semakin banyak merchant yang menunggak, semakin jauh angka itu dari kas — dan
-- ia bergerak ke arah yang salah persis ketika keadaannya memburuk.
--
-- EMPAT ANGKA, MASING-MASING MENJAWAB PERTANYAAN BERBEDA:
--
--   contracted  Nilai kontrak semua langganan, apa pun statusnya.
--               "Berapa yang seharusnya masuk kalau semuanya membayar."
--   active      Yang langganannya masih berjalan (ACTIVE/TRIAL).
--               "Berapa yang masih memakai layanan."
--   collected   Yang fakturnya BENAR-BENAR dibayar dalam 30 hari terakhir.
--               "Berapa rupiah yang masuk." Ini yang boleh disebut pendapatan.
--   past_due    Aktif tapi periodenya lewat — nilai yang sedang terancam.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0030_mrr_dipisah.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DROP VIEW IF EXISTS contract.subscription_status CASCADE;
CREATE VIEW contract.subscription_status AS
WITH unit_penagihan AS (
    -- Satu unit usaha per merchant yang membawa nominal. Menjumlahkan di semua
    -- unit usaha akan menggandakan MRR pemilik yang punya kafe DAN laundry,
    -- padahal ia membayar satu kali.
    SELECT s.merchant_id,
           (SELECT b.id FROM pos.businesses b
             WHERE b.merchant_id = s.merchant_id
             ORDER BY b.created_at, b.id LIMIT 1) AS business_id
      FROM billing.subscriptions s
),
terbayar AS (
    -- Faktur yang benar-benar lunas dalam 30 hari terakhir, dinormalkan ke
    -- nilai BULANAN. Faktur tahunan dibayar sekali untuk dua belas bulan;
    -- memasukkannya utuh akan membuat satu bulan terlihat dua belas kali lipat.
    SELECT i.subscription_id,
           SUM(CASE WHEN i.billing_cycle = 'YEARLY' THEN i.amount / 12 ELSE i.amount END) AS jumlah
      FROM billing.invoices i
     WHERE i.payment_status = 'PAID'
       AND i.paid_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
     GROUP BY i.subscription_id
)
SELECT b.id                AS business_id,
       s.merchant_id,
       s.status,
       s.current_period_end,
       p.id                AS plan_code,
       p.name              AS plan_name,
       (b.id = u.business_id) AS unit_penagihan,

       -- 1. NILAI KONTRAK. Apa pun statusnya.
       CASE WHEN b.id = u.business_id THEN p.price_idr ELSE 0::numeric END
           AS contracted_mrr_idr,

       -- 2. MASIH BERJALAN. Bukan berarti sudah dibayar.
       CASE WHEN b.id = u.business_id AND s.status IN ('ACTIVE', 'TRIAL')
            THEN p.price_idr ELSE 0::numeric END
           AS active_mrr_idr,

       -- 3. BENAR-BENAR MASUK. Dari faktur lunas, bukan dari status langganan.
       CASE WHEN b.id = u.business_id
            THEN COALESCE(t.jumlah, 0) ELSE 0::numeric END
           AS collected_mrr_idr,

       -- 4. SEDANG TERANCAM. Dua keadaan, dan keduanya harus terhitung:
       --    statusnya memang sudah PAST_DUE, ATAU masih tertulis aktif tapi
       --    periodenya sudah lewat. Menghitung yang kedua saja melewatkan
       --    justru yang sudah jelas menunggak.
       CASE WHEN b.id = u.business_id
             AND (s.status = 'PAST_DUE'
                  OR (s.status IN ('ACTIVE', 'TRIAL')
                      AND s.current_period_end < CURRENT_TIMESTAMP))
            THEN p.price_idr ELSE 0::numeric END
           AS past_due_mrr_idr,

       -- Nama lama dipertahankan supaya pemanggil yang ada tidak patah, TAPI
       -- artinya diluruskan: ia nilai kontrak, bukan pendapatan yang diakui.
       -- Pemakai baru harus memakai salah satu dari empat kolom di atas.
       CASE WHEN b.id = u.business_id THEN p.price_idr ELSE 0::numeric END
           AS contract_mrr_idr
  FROM billing.subscriptions s
  JOIN billing.plans p     ON p.id = s.plan_id
  JOIN pos.businesses b    ON b.merchant_id = s.merchant_id
  JOIN unit_penagihan u    ON u.merchant_id = s.merchant_id
  LEFT JOIN terbayar t     ON t.subscription_id = s.id;

COMMENT ON VIEW contract.subscription_status IS
    'Langganan per business. EMPAT angka MRR yang berbeda: contracted (nilai kontrak), active (masih berjalan), collected (faktur benar-benar lunas 30 hari terakhir), past_due (aktif tapi periodenya lewat). Hanya collected yang boleh disebut pendapatan. Semuanya dihitung sekali per merchant (unit_penagihan = true).';

COMMENT ON COLUMN contract.subscription_status.collected_mrr_idr IS
    'Satu-satunya kolom yang berasal dari uang yang benar-benar diterima. Faktur tahunan dibagi 12 supaya sebanding.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.subscription_status TO svc_backoffice;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_billing') THEN
        GRANT SELECT ON contract.subscription_status TO svc_billing;
    END IF;
END $$;
