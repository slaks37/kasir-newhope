-- =============================================================================
-- 0032_four_lifecycles_and_staff_commissions.sql
--
-- Pemisahan 4 Daur Hidup Independen (4 Decoupled Lifecycles):
-- 1. Sales Order Lifecycle (pos.transactions)
-- 2. Payment Lifecycle (pos.payments)
-- 3. Service Execution Lifecycle (pos.operational_jobs)
-- 4. Staff Commission Lifecycle (pos.staff_commissions)
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TABEL BUKU BESAR KOMISI STAF (pos.staff_commissions) ----------------------

CREATE TABLE IF NOT EXISTS pos.staff_commissions (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    transaction_id         UUID NOT NULL REFERENCES pos.transactions(id) ON DELETE CASCADE,
    job_id                 UUID REFERENCES pos.operational_jobs(id) ON DELETE SET NULL,
    staff_user_id          UUID NOT NULL REFERENCES internal.users(id) ON DELETE CASCADE,
    
    commission_type        VARCHAR(32) NOT NULL DEFAULT 'SERVICE_LABOR', -- 'SERVICE_WASHER', 'SERVICE_KAPSTER', 'PRODUCT_UPSELL', 'TIPS'
    gross_service_amount   NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    commission_rate_pct    NUMERIC(5, 2) DEFAULT 0.00,
    commission_amount      NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    
    -- Daur Hidup Komisi (Commission State Machine)
    status                 VARCHAR(32) NOT NULL DEFAULT 'PENDING_CONDITIONS',
    -- 'PENDING_CONDITIONS' : Menunggu pembayaran lunas DAN pengerjaan servis selesai
    -- 'ACCRUED'            : Syarat terpenuhi! Komisi sah terkunci di buku besar hak staf
    -- 'APPROVED'           : Disetujui Manager saat tutup shift
    -- 'DISBURSED'          : Sudah dibayarkan ke staf (Tunai / Payroll)
    -- 'VOIDED'             : Batal karena transaksi direfund / dibatalkan
    
    accrued_at             TIMESTAMPTZ,
    approved_at            TIMESTAMPTZ,
    disbursed_at           TIMESTAMPTZ,
    notes                  VARCHAR(255),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comm_staff_status ON pos.staff_commissions(staff_user_id, status);
CREATE INDEX IF NOT EXISTS idx_comm_transaction  ON pos.staff_commissions(transaction_id);


-- 2. ENGINE EVALUATOR 4 LIFECYCLE (Evaluasi Status Hak Komisi & Order) --------

CREATE OR REPLACE FUNCTION pos.fn_evaluate_order_and_commission_lifecycles(p_transaction_id UUID)
RETURNS VOID AS $$
DECLARE
    is_paid BOOLEAN := FALSE;
    is_service_done BOOLEAN := TRUE; -- Default true jika transaksi murni ritel tanpa SPK
    job_count INT;
    active_jobs INT;
BEGIN
    IF p_transaction_id IS NULL THEN
        RETURN;
    END IF;

    -- 1. Evaluasi Payment Lifecycle (Apakah sudah ada pembayaran lunas?)
    SELECT EXISTS (
        SELECT 1 FROM pos.payments 
         WHERE transaction_id = p_transaction_id 
           AND payment_status = 'PAID'
    ) INTO is_paid;

    -- 2. Evaluasi Service Execution Lifecycle
    SELECT COUNT(*) INTO job_count 
      FROM pos.operational_jobs 
     WHERE transaction_id = p_transaction_id;

    IF job_count > 0 THEN
        SELECT COUNT(*) INTO active_jobs 
          FROM pos.operational_jobs 
         WHERE transaction_id = p_transaction_id 
           AND status NOT IN ('READY_FOR_PICKUP', 'DELIVERED', 'FINISHED');

        is_service_done := (active_jobs = 0);
    END IF;

    -- 3. Evaluasi Staff Commission Lifecycle:
    -- Komisi hanya berstatus ACCRUED jika: PAYMENT = PAID DAN SERVICE = DONE!
    IF is_paid AND is_service_done THEN
        UPDATE pos.staff_commissions
           SET status = 'ACCRUED',
               accrued_at = COALESCE(accrued_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
         WHERE transaction_id = p_transaction_id
           AND status = 'PENDING_CONDITIONS';

        -- Update status transaksi ke SETTLED (Lunas & Servis Selesai)
        UPDATE pos.transactions
           SET order_status = 'SETTLED',
               completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
         WHERE id = p_transaction_id
           AND order_status IN ('OPEN', 'IN_FULFILLMENT', 'PENDING_PAYMENT');
    END IF;
END;
$$ LANGUAGE plpgsql;


-- 3. TRIGGERS UNTUK PEMBAYARAN & SPK SERVICE ----------------------------------

-- Trigger saat pembayaran berstatus PAID
CREATE OR REPLACE FUNCTION pos.fn_trg_payment_lifecycle_eval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_status = 'PAID' THEN
        PERFORM pos.fn_evaluate_order_and_commission_lifecycles(NEW.transaction_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_lifecycle_eval ON pos.payments;
CREATE TRIGGER trg_payment_lifecycle_eval
AFTER INSERT OR UPDATE OF payment_status ON pos.payments
FOR EACH ROW EXECUTE FUNCTION pos.fn_trg_payment_lifecycle_eval();

-- Trigger saat SPK servis selesai
CREATE OR REPLACE FUNCTION pos.fn_trg_job_lifecycle_eval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('READY_FOR_PICKUP', 'DELIVERED', 'FINISHED') THEN
        PERFORM pos.fn_evaluate_order_and_commission_lifecycles(NEW.transaction_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_lifecycle_eval ON pos.operational_jobs;
CREATE TRIGGER trg_job_lifecycle_eval
AFTER INSERT OR UPDATE OF status ON pos.operational_jobs
FOR EACH ROW EXECUTE FUNCTION pos.fn_trg_job_lifecycle_eval();


-- 4. VIEW KONTRAK REKAPITULASI KOMISI STAF (contract.staff_commission_ledger) --

DROP VIEW IF EXISTS contract.staff_commission_ledger CASCADE;
CREATE VIEW contract.staff_commission_ledger AS
SELECT
    c.id                                               AS commission_id,
    c.tenant_id,
    c.merchant_id,
    m.name                                             AS merchant_name,
    m.business_sector,
    c.outlet_id,
    o.name                                             AS outlet_name,
    c.staff_user_id,
    u.full_name                                        AS staff_name,
    u.email                                            AS staff_email,
    c.transaction_id,
    t.invoice_number,
    t.business_date,
    c.commission_type,
    c.gross_service_amount,
    c.commission_rate_pct,
    c.commission_amount,
    c.status                                           AS commission_status,
    c.accrued_at,
    c.approved_at,
    c.disbursed_at,
    c.created_at
  FROM pos.staff_commissions c
  JOIN internal.merchants m          ON m.id = c.merchant_id
  JOIN internal.outlets o            ON o.id = c.outlet_id
  JOIN internal.users u              ON u.id = c.staff_user_id
  LEFT JOIN pos.transactions t       ON t.id = c.transaction_id;

CREATE OR REPLACE VIEW public.v_staff_commissions AS
  SELECT * FROM contract.staff_commission_ledger;
