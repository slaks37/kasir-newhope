-- =============================================================================
-- 0034_transaction_log_dipulihkan.sql
--
-- MEMPERBAIKI KERUSAKAN YANG DIBUAT 0033, DAN SATU BUG YANG LEBIH TUA.
--
-- 1. contract.transaction_log KEHILANGAN EMPAT KOLOM.
--
--    0033 membangun ulang view ini hanya untuk mengganti rujukan pos.users
--    menjadi pos.staff_users — dan sambil lalu menulis ulang seluruh daftar
--    kolomnya. Yang hilang: `id`, `merchant_id`, `merchant_name`, `item_count`.
--
--    src/server/repo.ts membaca keempatnya. Halaman Transaksi di panel admin
--    mengembalikan `column x.id does not exist`, bukan daftar transaksi.
--
--    Tidak ada satu tes pun yang menangkapnya: yang ada hanya memeriksa bahwa
--    nama view-nya DISEBUT di dokumentasi, bukan bahwa BENTUKNYA masih dipakai.
--    test/kontrak-panel.test.ts ditambahkan bersama migrasi ini.
--
-- 2. VOID RATE SELALU 0, SEJAK LAMA.
--
--    services/ai/merchantData.ts menghitung:
--
--        COUNT(*) FILTER (WHERE payment_status = 'CANCELLED')
--          FROM contract.transaction_log
--
--    dengan komentar yang menyatakan view ini "mempertahankan payment_status".
--    Ia memang mempertahankan KOLOMNYA — tapi dibangun di atas
--    contract.merchant_revenue, yang WHERE-nya membuang CANCELLED. Jadi
--    pembilangnya tidak pernah bisa lebih dari nol, dan angka void rate yang
--    dipakai skor kesehatan merchant selalu 0,00%.
--
--    Dua pembaca memegang keyakinan yang berlawanan tentang view yang sama:
--    repo.ts mengandalkan CANCELLED sudah dibuang, merchantData.ts
--    mengandalkan CANCELLED masih ada. Keduanya tidak bisa benar.
--
--    Diselesaikan dengan MEMISAHKAN pertanyaannya, bukan dengan memilih salah
--    satu: transaction_log tetap berarti "transaksi yang benar-benar terjadi"
--    (itulah yang dimaksud panel), dan contract.transaction_status menjawab
--    "berapa yang dibatalkan" di atas data mentah.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0034_transaction_log_dipulihkan.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. BENTUK ASLINYA DIPULIHKAN ------------------------------------------------
--
-- Dibangun di atas contract.merchant_revenue, sama seperti sebelum 0033. Itu
-- yang membuat definisi omzet hanya ada di SATU tempat: baris CANCELLED dibuang
-- sekali, di sana, dan tidak diulang oleh setiap pembacanya.

DROP VIEW IF EXISTS contract.transaction_log CASCADE;
CREATE VIEW contract.transaction_log AS
SELECT r.transaction_id                              AS id,
       r.transaction_id,          -- nama baru dari 0033, dipertahankan
       b.merchant_id,
       b.name                                        AS merchant_name,
       r.business_id,
       r.business_sector,
       r.client_key,
       r.app_module,
       r.order_type,
       r.payment_method,
       x.payment_status,
       x.invoice_number,
       r.subtotal,
       r.discount_amount,
       r.tax_amount,
       r.service_charge_amount,
       r.total_amount,
       r.created_at,
       r.cashier_user_id,
       u.name                                        AS cashier_name,
       (SELECT COUNT(*) FROM pos.transaction_items i
         WHERE i.transaction_id = r.transaction_id)  AS item_count
  FROM contract.merchant_revenue r
  JOIN pos.transactions  x ON x.id = r.transaction_id
  JOIN pos.businesses    b ON b.id = r.business_id
  LEFT JOIN pos.staff_users u ON u.id = r.cashier_user_id;

COMMENT ON VIEW contract.transaction_log IS
    'Struk yang BENAR-BENAR terjadi — CANCELLED sudah dibuang oleh merchant_revenue, satu tingkat di bawah. Yang mencari transaksi yang dibatalkan harus membaca contract.transaction_status.';


-- 2. PERTANYAAN YANG BERBEDA, VIEW YANG BERBEDA -------------------------------

DROP VIEW IF EXISTS contract.transaction_status CASCADE;
CREATE VIEW contract.transaction_status AS
SELECT x.id            AS transaction_id,
       x.business_id,
       x.business_sector,
       x.payment_status,
       x.total_amount,
       x.created_at
  FROM pos.transactions x;

COMMENT ON VIEW contract.transaction_status IS
    'SELURUH struk termasuk yang dibatalkan. Satu-satunya permukaan kontrak tempat CANCELLED masih terlihat — dipakai menghitung void rate, yang mustahil dihitung dari transaction_log.';


DO $$
DECLARE svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_ai','svc_billing','svc_backoffice'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format(
              'GRANT SELECT ON contract.transaction_log, contract.transaction_status TO %I', svc);
        END IF;
    END LOOP;
END $$;
