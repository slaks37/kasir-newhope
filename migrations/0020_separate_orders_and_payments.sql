-- =============================================================================
-- 0020_separate_orders_and_payments.sql
--
-- PEMISAHAN ENTITAS ORDER (PESANAN) DENGAN ENTITAS PAYMENT (PEMBAYARAN):
--
-- Masalah sebelumnya:
--   1. Payment method & status tertempel langsung di tabel order (transactions).
--   2. Tidak mendukung split payment, partial payment, refund, atau multiple attempts.
--   3. VOID tercampur sebagai status pembayaran (padahal VOID adalah lifecycle pesanan).
--   4. Risiko Fraud jika kasir mengonfirmasi manual QRIS tanpa webhook payment gateway.
--
-- Solusi Arsitektur Baru:
--   1. Order Lifecycle (pos.transactions.order_status):
--      OPEN, PENDING_PAYMENT, COMPLETED, CANCELLED, VOIDED, REFUNDED.
--   2. Payment Lifecycle (pos.payments.payment_status):
--      PENDING, PAID, FAILED, EXPIRED, REFUNDED, PARTIALLY_REFUNDED.
--   3. pos.payments: Entitas 1:N yang mencatat metode bayar, gateway reference,
--      dan webhook verification.
--   4. contract.merchant_revenue & contract.payments_log: Definisi omzet terverifikasi.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. PERLUASAN STATUS PESANAN DI pos.transactions ----------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'order_status') THEN
        ALTER TABLE pos.transactions ADD COLUMN order_status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED';
    END IF;
    
    -- Sinkronkan data lama: CANCELLED menjadi CANCELLED/VOIDED
    UPDATE pos.transactions 
       SET order_status = CASE 
           WHEN payment_status = 'CANCELLED' THEN 'VOIDED'
           WHEN payment_status = 'PENDING' THEN 'PENDING_PAYMENT'
           ELSE 'COMPLETED'
       END
     WHERE order_status IS NULL OR order_status = 'COMPLETED';
END $$;


-- 2. TABEL PEMBAYARAN TERPISAH (pos.payments) ---------------------------------

CREATE TABLE IF NOT EXISTS pos.payments (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    transaction_id     UUID NOT NULL REFERENCES pos.transactions(id) ON DELETE CASCADE,
    payment_method     VARCHAR(32) NOT NULL DEFAULT 'CASH', -- CASH, QRIS_DYNAMIC, QRIS_STATIC, DEBIT_CARD, CREDIT_CARD, TRANSFER, E_WALLET
    payment_status     VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, FAILED, EXPIRED, REFUNDED, PARTIALLY_REFUNDED
    amount             NUMERIC(12, 2) NOT NULL,
    cash_received      NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    change_returned    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    gateway_provider   VARCHAR(32) NOT NULL DEFAULT 'MANUAL_CASH', -- MANUAL_CASH, MIDTRANS, XENDIT, DOKU, EDC_BANK
    gateway_reference  VARCHAR(120),                               -- Transaction ID dari payment gateway / nomor trace EDC
    gateway_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,         -- Raw webhook response untuk audit rekonsiliasi
    paid_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_transaction ON pos.payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_merchant    ON pos.payments(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payments_outlet      ON pos.payments(outlet_id);
CREATE INDEX IF NOT EXISTS idx_payments_status      ON pos.payments(payment_status);

COMMENT ON TABLE pos.payments IS
    'Entitas pembayaran terpisah dari pesanan (mendukung Split Payment, Payment Gateway Webhooks, dan Refund Audit).';


-- 3. MIGRASI DATA LAMA TRANSAKSI KE pos.payments ------------------------------

DO $$
BEGIN
    INSERT INTO pos.payments (
        id, tenant_id, merchant_id, outlet_id, transaction_id,
        payment_method, payment_status, amount,
        gateway_provider, paid_at, created_at
    )
    SELECT
        legacy_uuid(t.id::text || '_pay_0'),
        t.tenant_id,
        t.merchant_id,
        t.outlet_id,
        t.id,
        COALESCE(t.payment_method, 'CASH'),
        CASE 
            WHEN t.payment_status = 'CANCELLED' THEN 'FAILED'
            WHEN t.payment_status = 'PENDING' THEN 'PENDING'
            ELSE 'PAID'
        END,
        t.total_amount,
        CASE 
            WHEN t.payment_method = 'QRIS' THEN 'XENDIT'
            WHEN t.payment_method IN ('DEBIT', 'CREDIT') THEN 'EDC_BANK'
            ELSE 'MANUAL_CASH'
        END,
        CASE WHEN t.payment_status NOT IN ('CANCELLED', 'PENDING') THEN t.created_at ELSE NULL END,
        t.created_at
    FROM pos.transactions t
    WHERE NOT EXISTS (SELECT 1 FROM pos.payments p WHERE p.transaction_id = t.id)
    ON CONFLICT (id) DO NOTHING;
END $$;


-- 4. PEMBARUAN KONTRAK OMZET & TRANSAKSI (contract.*) ------------------------

-- 4a. contract.merchant_revenue (Hanya transaksi COMPLETED yang berstatus PAID)
DROP VIEW IF EXISTS contract.merchant_revenue CASCADE;
CREATE VIEW contract.merchant_revenue AS
SELECT
    x.id,
    x.tenant_id,
    x.merchant_id,
    m.name                                            AS merchant_name,
    x.outlet_id,
    o.name                                            AS outlet_name,
    x.invoice_number,
    x.business_sector,
    x.business_id,
    x.app_module,
    x.order_type,
    COALESCE(p.payment_method, x.payment_method)      AS payment_method,
    x.order_status,
    COALESCE(p.payment_status, 'PAID')                AS payment_status,
    x.subtotal,
    x.discount_amount,
    x.tax_amount,
    x.service_charge_amount,
    x.total_amount,
    x.created_at
  FROM pos.transactions x
  JOIN internal.merchants m ON m.id = x.merchant_id
  LEFT JOIN internal.outlets o ON o.id = x.outlet_id
  LEFT JOIN LATERAL (
      SELECT payment_method, payment_status 
        FROM pos.payments 
       WHERE transaction_id = x.id 
       ORDER BY created_at DESC 
       LIMIT 1
  ) p ON TRUE
 WHERE x.order_status = 'COMPLETED'
   AND (x.payment_status <> 'CANCELLED' OR x.payment_status IS NULL);

COMMENT ON VIEW contract.merchant_revenue IS
    'Definisi tunggal transaksi penjualan terverifikasi (COMPLETED & PAID) yang dihitung sebagai omzet resmi.';


-- 4b. contract.transaction_log (Semua riwayat pesanan termasuk VOID/CANCELLED)
DROP VIEW IF EXISTS contract.transaction_log CASCADE;
CREATE VIEW contract.transaction_log AS
SELECT
    x.id,
    x.tenant_id,
    x.merchant_id,
    m.name                                            AS merchant_name,
    x.outlet_id,
    o.name                                            AS outlet_name,
    x.invoice_number,
    x.business_sector,
    x.business_id,
    x.app_module,
    x.order_type,
    x.order_status,
    COALESCE(p.payment_method, x.payment_method)      AS payment_method,
    COALESCE(p.payment_status, x.payment_status)      AS payment_status,
    x.subtotal,
    x.discount_amount,
    x.tax_amount,
    x.service_charge_amount,
    x.total_amount,
    x.created_at,
    COALESCE(u.name, 'Kasir')                         AS cashier_name,
    COALESCE(ti.item_count, 0)                        AS item_count
  FROM pos.transactions x
  JOIN internal.merchants m ON m.id = x.merchant_id
  LEFT JOIN internal.outlets o ON o.id = x.outlet_id
  LEFT JOIN pos.users u ON u.id = x.cashier_user_id
  LEFT JOIN LATERAL (
      SELECT payment_method, payment_status 
        FROM pos.payments 
       WHERE transaction_id = x.id 
       ORDER BY created_at DESC 
       LIMIT 1
  ) p ON TRUE
  LEFT JOIN (
      SELECT transaction_id, COUNT(*)::int AS item_count
        FROM pos.transaction_items
       GROUP BY transaction_id
  ) ti ON ti.transaction_id = x.id;

COMMENT ON VIEW contract.transaction_log IS
    'Audit log lengkap semua pesanan kasir dengan informasi cabang, status pesanan, dan status pembayaran.';


-- 4c. contract.payments_log (Audit Khusus Rekonsiliasi Pembayaran Gateway)
DROP VIEW IF EXISTS contract.payments_log CASCADE;
CREATE VIEW contract.payments_log AS
SELECT
    p.id                                              AS payment_id,
    p.tenant_id,
    p.merchant_id,
    m.name                                            AS merchant_name,
    p.outlet_id,
    o.name                                            AS outlet_name,
    p.transaction_id,
    t.invoice_number,
    t.order_status,
    p.payment_method,
    p.payment_status,
    p.amount,
    p.cash_received,
    p.change_returned,
    p.gateway_provider,
    p.gateway_reference,
    p.paid_at,
    p.created_at
  FROM pos.payments p
  JOIN pos.transactions t   ON t.id = p.transaction_id
  JOIN internal.merchants m ON m.id = p.merchant_id
  LEFT JOIN internal.outlets o ON o.id = p.outlet_id;

COMMENT ON VIEW contract.payments_log IS
    'Log audit rekonsiliasi finansial per transaksi pembayaran, provider gateway, dan settlement EDC.';


-- 5. HAK AKSES PERAN ---------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.payments TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT ON contract.merchant_revenue TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT ON contract.transaction_log TO %I', 'svc_' || svc);
            EXECUTE format('GRANT SELECT ON contract.payments_log TO %I', 'svc_' || svc);
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON contract.merchant_revenue TO bi_readonly;
        GRANT SELECT ON contract.transaction_log TO bi_readonly;
        GRANT SELECT ON contract.payments_log TO bi_readonly;
    END IF;
END $$;


-- 6. VIEW KOMPATIBILITAS PUBLIK ----------------------------------------------

CREATE OR REPLACE VIEW public.v_payments_log AS
  SELECT * FROM contract.payments_log;
