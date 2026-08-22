-- =============================================================================
-- 0033_resilient_payments_and_immutable_compensating_ledger.sql
--
-- 1. Resilient Payment Lifecycle (Intent, Attempts, Split Tender & Async QRIS):
--    - Status: CREATED -> PENDING -> AUTHORIZED -> SETTLED -> FAILED -> EXPIRED -> REFUNDED
--    - Evaluator Lintas Split Tender: Menghitung akumulasi pembayaran lunas vs total tagihan
-- 2. Physical Ledger Immutability & Compensating Reversals:
--    - Blokir UPDATE & DELETE fisik pada pos.inventory_transactions (Append-Only Enforcer)
--    - Stored Procedure pos.fn_void_transaction_with_compensating_reversals
--    - Entri pembalik mutasi riil (+x VOID_REVERSAL) tanpa pernah mengotak-atik baris historis
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. REFACTOR TABEL PEMBAYARAN (pos.payments) ---------------------------------

DO $$
BEGIN
    -- Tambahkan Payment Intent ID (untuk pengelompokan attempt pembayaran)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'payments' AND column_name = 'payment_intent_id') THEN
        ALTER TABLE pos.payments ADD COLUMN payment_intent_id UUID DEFAULT uuidv7();
    END IF;

    -- Tambahkan Nomor Percobaan (Attempt Number)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'payments' AND column_name = 'attempt_number') THEN
        ALTER TABLE pos.payments ADD COLUMN attempt_number INT NOT NULL DEFAULT 1;
    END IF;

    -- Tambahkan Timestamp Daur Hidup Async
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'payments' AND column_name = 'settled_at') THEN
        ALTER TABLE pos.payments ADD COLUMN settled_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'payments' AND column_name = 'expired_at') THEN
        ALTER TABLE pos.payments ADD COLUMN expired_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'payments' AND column_name = 'refunded_at') THEN
        ALTER TABLE pos.payments ADD COLUMN refunded_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'payments' AND column_name = 'failure_reason') THEN
        ALTER TABLE pos.payments ADD COLUMN failure_reason VARCHAR(255);
    END IF;

    -- Validasi State Machine Payment
    ALTER TABLE pos.payments DROP CONSTRAINT IF EXISTS chk_payment_lifecycle_status;
    ALTER TABLE pos.payments ADD CONSTRAINT chk_payment_lifecycle_status CHECK (
        payment_status IN ('CREATED', 'PENDING', 'AUTHORIZED', 'SETTLED', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED')
    );
END $$;


-- 2. UPDATE EVALUATOR MULTI-TENDER & SETTLEMENT -------------------------------

CREATE OR REPLACE FUNCTION pos.fn_evaluate_order_and_commission_lifecycles(p_transaction_id UUID)
RETURNS VOID AS $$
DECLARE
    order_total NUMERIC(12, 2) := 0.00;
    settled_total NUMERIC(12, 2) := 0.00;
    is_fully_paid BOOLEAN := FALSE;
    is_service_done BOOLEAN := TRUE;
    job_count INT;
    active_jobs INT;
BEGIN
    IF p_transaction_id IS NULL THEN
        RETURN;
    END IF;

    -- Ambil total tagihan order
    SELECT total_amount INTO order_total
      FROM pos.transactions
     WHERE id = p_transaction_id;

    -- Hitung akumulasi pembayaran yang sudah SETTLED / PAID (Aman untuk Split Tender!)
    SELECT COALESCE(SUM(amount), 0.00) INTO settled_total
      FROM pos.payments
     WHERE transaction_id = p_transaction_id
       AND payment_status IN ('SETTLED', 'PAID');

    is_fully_paid := (settled_total >= order_total AND order_total > 0);

    -- Evaluasi Pekerjaan Fisik / Service
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

    -- Jika Lunas Terbayar DAN Servis Selesai -> Komisi Accrued & Order Settled
    IF is_fully_paid AND is_service_done THEN
        UPDATE pos.staff_commissions
           SET status = 'ACCRUED',
               accrued_at = COALESCE(accrued_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
         WHERE transaction_id = p_transaction_id
           AND status = 'PENDING_CONDITIONS';

        UPDATE pos.transactions
           SET order_status = 'SETTLED',
               completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
         WHERE id = p_transaction_id
           AND order_status IN ('OPEN', 'IN_FULFILLMENT', 'PENDING_PAYMENT');
    END IF;
END;
$$ LANGUAGE plpgsql;


-- Update Trigger Evaluator pada Pembayaran
CREATE OR REPLACE FUNCTION pos.fn_trg_payment_lifecycle_eval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_status IN ('SETTLED', 'PAID') THEN
        PERFORM pos.fn_evaluate_order_and_commission_lifecycles(NEW.transaction_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pos.fn_enforce_inventory_ledger_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL: pos.inventory_transactions adalah Immutable Financial Ledger (Append-Only). Operasi UPDATE atau DELETE dilarang keras secara fisik! Gunakan entri mutasi pembalik kompensasi (VOID_REVERSAL / ADJUSTMENT).'
        USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_inventory_ledger_immutability ON pos.inventory_transactions;
CREATE TRIGGER trg_enforce_inventory_ledger_immutability
BEFORE UPDATE OR DELETE ON pos.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_inventory_ledger_immutability();


-- 4. STORED PROCEDURE VOID DENGAN COMPENSATING REVERSAL -----------------------

CREATE OR REPLACE FUNCTION pos.fn_void_transaction_with_compensating_reversals(
    p_transaction_id UUID,
    p_void_reason TEXT,
    p_voided_by_user_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    tx RECORD;
    inv_mut RECORD;
    reversal_count INT := 0;
BEGIN
    -- Validasi keberadaan transaksi
    SELECT * INTO tx FROM pos.transactions WHERE id = p_transaction_id;
    IF tx.id IS NULL THEN
        RAISE EXCEPTION 'Transaksi dengan ID % tidak ditemukan.', p_transaction_id;
    END IF;

    IF tx.order_status = 'VOIDED' THEN
        RAISE EXCEPTION 'Transaksi % sudah berstatus VOIDED.', tx.invoice_number;
    END IF;

    -- 1. Tandai transaksi sebagai VOIDED
    UPDATE pos.transactions
       SET order_status = 'VOIDED',
           voided_at = CURRENT_TIMESTAMP
     WHERE id = p_transaction_id;

    -- 2. Cari seluruh mutasi inventaris keluar (pengurangan) yang terkait order ini
    FOR inv_mut IN
        SELECT * 
          FROM pos.inventory_transactions
         WHERE (reference_id = p_transaction_id::text OR reference_id = tx.invoice_number)
           AND quantity_delta < 0
           AND reference_type NOT IN ('VOID_REVERSAL')
    LOOP
        -- Buat baris mutasi pembalik baru (Compensating Ledger Record: +x)
        INSERT INTO pos.inventory_transactions (
            tenant_id,
            merchant_id,
            outlet_id,
            location_id,
            inventory_item_id,
            quantity_delta,
            reference_type,
            reference_id,
            reason,
            performed_by
        ) VALUES (
            inv_mut.tenant_id,
            inv_mut.merchant_id,
            inv_mut.outlet_id,
            inv_mut.location_id,
            inv_mut.inventory_item_id,
            ABS(inv_mut.quantity_delta), -- Nilai positif pembalik
            'VOID_REVERSAL',
            p_transaction_id::text,
            'Pembalik Mutasi Void Order ' || tx.invoice_number || ': ' || COALESCE(p_void_reason, 'Pembatalan Kasir'),
            p_voided_by_user_id
        );
        reversal_count := reversal_count + 1;
    END LOOP;

    -- 3. Batalkan seluruh komisi staf yang terkait
    UPDATE pos.staff_commissions
       SET status = 'VOIDED',
           notes = 'Dibatalkan karena order void: ' || COALESCE(p_void_reason, ''),
           updated_at = CURRENT_TIMESTAMP
     WHERE transaction_id = p_transaction_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'invoice_number', tx.invoice_number,
        'order_status', 'VOIDED',
        'reversal_mutations_created', reversal_count
    );
END;
$$ LANGUAGE plpgsql;
