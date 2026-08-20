-- =============================================================================
-- 0021_doku_pembayaran.sql
--
-- Menyiapkan billing.invoices untuk pembayaran lewat DOKU Checkout.
--
-- KENAPA INI PERLU. Aktivasi langganan dipicu notifikasi dari DOKU, dan
-- notifikasi itu hanya membawa satu hal yang menghubungkannya kembali ke kita:
-- `invoice_number`. Tanpa kolom itu, satu-satunya cara mencocokkan pembayaran
-- dengan merchant adalah mempercayai `tenantId` yang ikut di badan notifikasi —
-- artinya mempercayai pihak luar untuk memberi tahu siapa yang harus
-- diaktifkan.
--
-- Yang benar sebaliknya: KITA yang menerbitkan invoice_number sebelum
-- memanggil DOKU, dan notifikasi hanya dipakai untuk MENEMUKAN baris yang sudah
-- kita tulis sendiri. Tanda tangan menjamin pesannya asli; baris ini yang
-- menjamin uangnya mendarat di merchant yang benar.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0021_doku_pembayaran.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. NOMOR FAKTUR -------------------------------------------------------------
--
-- UNIK per merchant, bukan global: dua merchant boleh punya INV-0001 masing-
-- masing. Yang dikirim ke DOKU diberi awalan yang membuatnya unik global (lihat
-- api/_lib/doku.ts), tapi keunikan di sini yang menjaga kita dari mencocokkan
-- notifikasi ke faktur milik orang lain.

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_number
    ON billing.invoices (invoice_number)
 WHERE invoice_number IS NOT NULL;

COMMENT ON COLUMN billing.invoices.invoice_number IS
    'Nomor yang dikirim ke payment gateway dan dikembalikan lagi lewat notifikasi. Satu-satunya kunci yang menghubungkan pembayaran ke faktur — jangan pernah mencocokkan lewat tenant_id dari badan notifikasi.';


-- 2. PAKET YANG DIBELI FAKTUR INI ---------------------------------------------
--
-- TIDAK bisa disimpulkan dari subscription_id. Saat merchant meng-upgrade,
-- langganannya masih menunjuk paket LAMA sampai pembayarannya lunas — dan itu
-- memang benar, karena paket baru belum dibayar. Tanpa kolom ini, notifikasi
-- yang masuk tidak tahu paket mana yang harus diaktifkan, dan merchant membayar
-- Pro tapi mendapat perpanjangan Free.

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS plan_id VARCHAR(64) REFERENCES billing.plans(id);

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(10) NOT NULL DEFAULT 'MONTHLY';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_invoices_cycle') THEN
        ALTER TABLE billing.invoices ADD CONSTRAINT ck_invoices_cycle
            CHECK (billing_cycle IN ('MONTHLY', 'YEARLY'));
    END IF;
END $$;


-- 3. KEDALUWARSA SESI PEMBAYARAN ----------------------------------------------
--
-- QR dari DOKU punya masa berlaku. Menyimpannya membuat layar langganan bisa
-- menjawab "QR ini masih bisa dipakai atau harus dibuat ulang" tanpa memanggil
-- DOKU lagi — dan membuat faktur menggantung bisa dibersihkan tanpa menebak.

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- 3b. STATUS "KEDALUWARSA" ----------------------------------------------------
--
-- QR yang habis masa berlakunya BUKAN pembayaran yang gagal. Yang pertama
-- berarti merchant belum sempat membayar dan tinggal membuat QR baru; yang
-- kedua berarti pembayarannya ditolak dan perlu ditelusuri. Menyamakan
-- keduanya membuat staf support tidak bisa membedakan tanpa membuka log
-- gateway.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'payment_status_enum' AND e.enumlabel = 'EXPIRED'
    ) THEN
        ALTER TYPE payment_status_enum ADD VALUE 'EXPIRED';
    END IF;
END $$;


-- 4. FOREIGN KEY GANDA --------------------------------------------------------
--
-- Tabel ini punya DUA foreign key yang identik ke tenants: fk_invoices_tenant
-- dan fk_invoices_tenant_id, keduanya (tenant_id) -> tenants(id) ON DELETE
-- CASCADE. Peninggalan dua migrasi yang menambahkannya dengan nama berbeda.
-- Tidak berbahaya, tapi setiap penulisan diperiksa dua kali untuk aturan yang
-- sama persis.

ALTER TABLE billing.invoices DROP CONSTRAINT IF EXISTS fk_invoices_tenant_id;


-- 5. NOTIFIKASI DOKU YANG SUDAH DIPROSES --------------------------------------
--
-- billing.webhook_logs sudah menjaga idempotensi lewat event_id. DOKU tidak
-- mengirim event_id; yang unik per notifikasi adalah header Request-Id. Kolom
-- ini menegaskan asalnya supaya dua gateway yang kelak dipakai bersamaan tidak
-- saling menimpa idempotensinya.

ALTER TABLE billing.webhook_logs
    ADD COLUMN IF NOT EXISTS provider VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX IF NOT EXISTS idx_webhook_logs_provider
    ON billing.webhook_logs (provider, processed_at DESC);


-- 6. PERMUKAAN BACA -----------------------------------------------------------

DROP VIEW IF EXISTS contract.merchant_invoices CASCADE;
CREATE VIEW contract.merchant_invoices AS
SELECT i.tenant_id            AS merchant_id,
       t.name                 AS merchant_name,
       i.id                   AS invoice_id,
       i.invoice_number,
       i.plan_id,
       COALESCE(p.name, '-')  AS plan_name,
       i.billing_cycle,
       i.amount,
       i.currency,
       i.payment_status,
       i.payment_gateway_ref,
       i.paid_at,
       i.due_date,
       i.expires_at,
       i.created_at
  FROM billing.invoices i
  JOIN pos.tenants  t ON t.id = i.tenant_id
  LEFT JOIN billing.plans p ON p.id = i.plan_id;

COMMENT ON VIEW contract.merchant_invoices IS
    'Faktur langganan per merchant untuk panel admin. Hanya baca.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT ON contract.merchant_invoices TO svc_backoffice;
    END IF;
END $$;
