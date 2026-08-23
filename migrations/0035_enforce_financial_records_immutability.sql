-- =============================================================================
-- 0035_enforce_financial_records_immutability.sql
--
-- Penegakan Immutabilitas Rekam Medis Finansial (Financial Audit Immutability):
-- 1. Blokir operasi DELETE pada pos.transactions (Transaksi Penjualan Resmi)
-- 2. Blokir operasi DELETE pada pos.payments (Catatan Pembayaran & Settlement)
-- 3. Blokir operasi DELETE pada pos.transaction_items (Rincian Item Struk)
-- 4. Blokir operasi DELETE pada pos.staff_commissions (Komisi Staf Berjalan)
--
-- Seluruh pembatalan finansial setelah checkout & payment WAJIB melalui
-- alur pembatalan (VOID) dengan compensating ledger, bukan penghapusan fisik.
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. FUNGSI PENEGAK IMMUTABILITAS TRANSAKSI -----------------------------------

CREATE OR REPLACE FUNCTION pos.fn_enforce_transaction_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL SECURITY: pos.transactions adalah Catatan Finansial Resmi (Immutable Ledger). Transaksi yang telah di-checkout atau dibayar dilarang keras untuk dihapus (DELETE)! Gunakan mekanisme VOID untuk pembatalan transaksi.'
        USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_transaction_immutability ON pos.transactions;
CREATE TRIGGER trg_enforce_transaction_immutability
BEFORE DELETE ON pos.transactions
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_transaction_immutability();


-- 2. FUNGSI PENEGAK IMMUTABILITAS PEMBAYARAN ----------------------------------

CREATE OR REPLACE FUNCTION pos.fn_enforce_payment_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL SECURITY: pos.payments adalah Catatan Pembayaran Resmi (Immutable Financial Ledger). Pembayaran yang telah tercatat dilarang keras untuk dihapus (DELETE)!'
        USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_payment_immutability ON pos.payments;
CREATE TRIGGER trg_enforce_payment_immutability
BEFORE DELETE ON pos.payments
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_payment_immutability();


-- 3. FUNGSI PENEGAK IMMUTABILITAS RINCIAN ITEM TRANSAKSI ----------------------

CREATE OR REPLACE FUNCTION pos.fn_enforce_transaction_items_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL SECURITY: pos.transaction_items adalah Rincian Struk Resmi dan dilarang keras untuk dihapus (DELETE)!'
        USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_transaction_items_immutability ON pos.transaction_items;
CREATE TRIGGER trg_enforce_transaction_items_immutability
BEFORE DELETE ON pos.transaction_items
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_transaction_items_immutability();


-- 4. FUNGSI PENEGAK IMMUTABILITAS KOMISI STAF ---------------------------------

CREATE OR REPLACE FUNCTION pos.fn_enforce_staff_commissions_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('ACCRUED', 'PAID') THEN
        RAISE EXCEPTION 'CRITICAL SECURITY: pos.staff_commissions yang sudah berstatus ACCRUED atau PAID dilarang keras untuk dihapus (DELETE)! Gunakan status VOIDED untuk pembatalan.'
            USING ERRCODE = '23506';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_staff_commissions_immutability ON pos.staff_commissions;
CREATE TRIGGER trg_enforce_staff_commissions_immutability
BEFORE DELETE ON pos.staff_commissions
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_staff_commissions_immutability();
