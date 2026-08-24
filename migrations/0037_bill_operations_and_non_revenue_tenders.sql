-- =============================================================================
-- 0037_bill_operations_and_non_revenue_tenders.sql
--
-- Menutup celah domain F&B klasik (Bill Rack / Split / Join / Move / House Use)
-- TANPA melanggar tiga invarian yang sudah berlaku di sistem ini:
--
--   INVARIAN 1 (0035) : pos.transactions / transaction_items / payments IMMUTABLE.
--                       Maka Split & Join TIDAK boleh memindahkan baris item.
--                       Keduanya dimodelkan sebagai transaksi baru + jejak
--                       silsilah (lineage) + buku besar operasi append-only.
--
--   INVARIAN 2 (0020) : contract.merchant_revenue adalah definisi TUNGGAL omzet.
--                       Maka bill non-pendapatan (House Use, Compliment, Staff
--                       Meal) WAJIB punya penanda sendiri, bukan sekadar metode
--                       bayar, supaya tidak menggelembungkan omzet di AI Copilot,
--                       admin panel, dan internal.business_targets sekaligus.
--
--   INVARIAN 3 (Dok. Arsitektur §3) : aksi berisiko tinggi butuh Step-Up
--                       Authorization Manager. Maka operasi Change Price /
--                       Tax Exempt / Void Item ditegakkan di level database,
--                       bukan sekadar dipercayakan ke UI kasir.
--
-- Isi:
--   1. pos.transactions.revenue_impact  (SALE vs HOUSE_USE / COMPLIMENT / ...)
--   2. Silsilah bill: split_from_transaction_id, merged_into_transaction_id,
--      dan status pesanan baru 'MERGED'
--   3. pos.bill_operations              (buku besar operasi bill, append-only)
--   4. pos.tender_types                 (master tender: kas, voucher, deposit,
--                                        member charge, house use)
--   5. pos.customer_deposits + pos.deposit_movements (buku besar liabilitas)
--   6. View kontrak: merchant_revenue (diperbaiki), non_revenue_log,
--      bill_operations_log, tender_settlement, customer_deposit_balances
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. KLASIFIKASI DAMPAK PENDAPATAN (pos.transactions.revenue_impact) ----------
--
-- SISTEM POS lama mengenal "House Use": bill yang ditandatangani manajemen dan
-- TIDAK termasuk revenue penjualan. Kalau ini hanya jadi metode pembayaran,
-- angkanya tetap masuk omzet — karena contract.merchant_revenue menyaring
-- berdasarkan order_status, bukan berdasarkan jenis tender.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'pos' AND table_name = 'transactions'
                      AND column_name = 'revenue_impact') THEN
        ALTER TABLE pos.transactions
            ADD COLUMN revenue_impact VARCHAR(32) NOT NULL DEFAULT 'SALE';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transaction_revenue_impact') THEN
        ALTER TABLE pos.transactions
            ADD CONSTRAINT chk_transaction_revenue_impact CHECK (revenue_impact IN (
                'SALE',          -- Penjualan normal. Satu-satunya yang jadi omzet.
                'HOUSE_USE',     -- Konsumsi internal manajemen / staf level tertentu.
                'COMPLIMENT',    -- Gratis untuk tamu (service recovery, undangan).
                'STAFF_MEAL',    -- Jatah makan karyawan.
                'INTERNAL_TRANSFER' -- Mutasi antar outlet, bukan penjualan ke pelanggan.
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_revenue_impact
    ON pos.transactions(merchant_id, revenue_impact);

COMMENT ON COLUMN pos.transactions.revenue_impact IS
    'Dampak transaksi terhadap omzet. Hanya SALE yang masuk contract.merchant_revenue. Bill non-pendapatan tetap memotong stok BOM dan tetap tercatat, tapi tidak pernah dihitung sebagai penjualan.';


-- 2. SILSILAH BILL (Split / Join) ---------------------------------------------
--
-- Split Bill tidak memecah baris item yang sudah ada (dilarang 0035). Yang
-- terjadi: bill induk ditutup, lalu N bill anak dibuat dengan snapshot itemnya
-- masing-masing dan menunjuk balik ke induknya. Join Bill kebalikannya:
-- beberapa bill sumber berubah status menjadi 'MERGED' dan menunjuk ke bill
-- gabungan. Karena contract.merchant_revenue hanya menghitung order_status
-- 'COMPLETED', bill yang sudah di-merge otomatis tidak pernah dihitung dua kali.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'pos' AND table_name = 'transactions'
                      AND column_name = 'split_from_transaction_id') THEN
        ALTER TABLE pos.transactions
            ADD COLUMN split_from_transaction_id UUID REFERENCES pos.transactions(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'pos' AND table_name = 'transactions'
                      AND column_name = 'merged_into_transaction_id') THEN
        ALTER TABLE pos.transactions
            ADD COLUMN merged_into_transaction_id UUID REFERENCES pos.transactions(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_split_from
    ON pos.transactions(split_from_transaction_id) WHERE split_from_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_merged_into
    ON pos.transactions(merged_into_transaction_id) WHERE merged_into_transaction_id IS NOT NULL;

COMMENT ON COLUMN pos.transactions.split_from_transaction_id IS
    'Bill ini adalah pecahan dari bill induk tersebut (Split Bill). Induk berstatus SPLIT dan tidak lagi dihitung sebagai omzet.';
COMMENT ON COLUMN pos.transactions.merged_into_transaction_id IS
    'Bill ini sudah digabung ke bill tujuan tersebut (Join Bill). Statusnya MERGED sehingga tidak dihitung ganda.';

-- Sebuah bill tidak mungkin sekaligus jadi pecahan dan hasil gabungan dirinya.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transaction_lineage_not_self') THEN
        ALTER TABLE pos.transactions
            ADD CONSTRAINT chk_transaction_lineage_not_self CHECK (
                (split_from_transaction_id IS NULL OR split_from_transaction_id <> id) AND
                (merged_into_transaction_id IS NULL OR merged_into_transaction_id <> id)
            );
    END IF;
END $$;


-- 3. BUKU BESAR OPERASI BILL (pos.bill_operations) ----------------------------
--
-- Satu tabel append-only untuk seluruh menu "Modifikasi Transaksi" pada POS
-- klasik: Split, Join, Move Item, Move Table, Covers, Segment, Change Price,
-- Tax, Void Item, Discount. Alasannya jejak: kalau harga satu item diubah
-- kasir jam 21:14, yang dicari auditor besok pagi adalah siapa yang menyetujui,
-- bukan sekadar angka akhirnya.

CREATE TABLE IF NOT EXISTS pos.bill_operations (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID REFERENCES internal.outlets(id) ON DELETE SET NULL,

    operation_type         VARCHAR(32) NOT NULL,
    source_transaction_id  UUID NOT NULL REFERENCES pos.transactions(id) ON DELETE RESTRICT,
    target_transaction_id  UUID REFERENCES pos.transactions(id) ON DELETE RESTRICT,
    transaction_item_id    UUID,

    before_value           JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_value            JSONB NOT NULL DEFAULT '{}'::jsonb,
    amount_delta           NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    performed_by_user_id   UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    approved_by_user_id    UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    reason                 VARCHAR(255),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_bill_operation_type CHECK (operation_type IN (
        'SPLIT_BILL',        -- Pisah bill jadi beberapa tagihan
        'JOIN_BILL',         -- Gabung beberapa bill jadi satu
        'MOVE_ITEM',         -- Pindah item ke bill/meja lain
        'MOVE_TABLE',        -- Pindah seluruh bill ke slot lain
        'CHANGE_COVERS',     -- Koreksi jumlah tamu (statistik cover)
        'CHANGE_SEGMENT',    -- Dine In <-> Takeaway <-> Delivery <-> Event
        'CHANGE_PRICE',      -- Override harga jual satu item
        'TAX_EXEMPT',        -- Pembebasan pajak atas bill
        'VOID_ITEM',         -- Batalkan satu item (bukan seluruh bill)
        'DISCOUNT_OVERRIDE', -- Diskon manual di luar promo terdaftar
        'REOPEN_BILL',       -- Buka kembali bill yang sudah ditutup
        'REPRINT_BILL'       -- Copy Bill / cetak ulang tagihan sementara
    ))
);

CREATE INDEX IF NOT EXISTS idx_bill_ops_source   ON pos.bill_operations(source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bill_ops_target   ON pos.bill_operations(target_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bill_ops_merchant ON pos.bill_operations(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_ops_type     ON pos.bill_operations(operation_type);

COMMENT ON TABLE pos.bill_operations IS
    'Buku besar append-only seluruh modifikasi bill (Split, Join, Move, Change Price, Void Item). Melengkapi internal.audit_logs dengan detail level-bill yang tidak dimiliki audit platform.';


-- 3a. Penegakan Step-Up Authorization di level database ------------------------

CREATE OR REPLACE FUNCTION pos.fn_guard_bill_operation()
RETURNS TRIGGER AS $$
BEGIN
    -- Aksi berisiko tinggi wajib membawa persetujuan Manager (Dok. Arsitektur §3).
    IF NEW.operation_type IN ('CHANGE_PRICE', 'TAX_EXEMPT', 'VOID_ITEM', 'DISCOUNT_OVERRIDE', 'REOPEN_BILL')
       AND NEW.approved_by_user_id IS NULL THEN
        RAISE EXCEPTION 'STEP-UP AUTHORIZATION REQUIRED: operasi bill "%" wajib disetujui Manager (approved_by_user_id tidak boleh NULL).', NEW.operation_type
            USING ERRCODE = '42501';
    END IF;

    -- Operasi yang memindahkan nilai wajib menyebut bill tujuan, kalau tidak
    -- ada uang yang menguap tanpa lawan jejak.
    IF NEW.operation_type IN ('SPLIT_BILL', 'JOIN_BILL', 'MOVE_ITEM')
       AND NEW.target_transaction_id IS NULL THEN
        RAISE EXCEPTION 'INTEGRITAS BILL: operasi "%" wajib menyebut target_transaction_id.', NEW.operation_type
            USING ERRCODE = '23502';
    END IF;

    -- Aksi berisiko tinggi juga wajib membawa alasan yang bisa dibaca manusia.
    IF NEW.operation_type IN ('CHANGE_PRICE', 'TAX_EXEMPT', 'VOID_ITEM', 'DISCOUNT_OVERRIDE')
       AND (NEW.reason IS NULL OR btrim(NEW.reason) = '') THEN
        RAISE EXCEPTION 'AUDIT: operasi bill "%" wajib menyertakan reason.', NEW.operation_type
            USING ERRCODE = '23502';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_bill_operation ON pos.bill_operations;
CREATE TRIGGER trg_guard_bill_operation
BEFORE INSERT ON pos.bill_operations
FOR EACH ROW EXECUTE FUNCTION pos.fn_guard_bill_operation();


-- 3b. Append-only enforcer (pola sama dengan 0033 & 0035) ---------------------

CREATE OR REPLACE FUNCTION pos.fn_enforce_bill_operations_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL SECURITY: pos.bill_operations bersifat append-only. Baris jejak operasi bill dilarang di-UPDATE maupun di-DELETE.'
        USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bill_operations_no_update ON pos.bill_operations;
CREATE TRIGGER trg_bill_operations_no_update
BEFORE UPDATE ON pos.bill_operations
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_bill_operations_append_only();

DROP TRIGGER IF EXISTS trg_bill_operations_no_delete ON pos.bill_operations;
CREATE TRIGGER trg_bill_operations_no_delete
BEFORE DELETE ON pos.bill_operations
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_bill_operations_append_only();


-- 4. MASTER TENDER (pos.tender_types) -----------------------------------------
--
-- POS klasik membedakan Cash, Card, Voucher, Deposit, Member, dan House Use.
-- Tiga terakhir bukan uang masuk laci. Kalau sistem hanya menyimpan string
-- payment_method, rekonsiliasi shift ikut salah: expected_cash menghitung
-- voucher sebagai kas, dan kasir yang jujur terlihat seperti kurang setor.

CREATE TABLE IF NOT EXISTS pos.tender_types (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id            UUID REFERENCES internal.merchants(id) ON DELETE CASCADE, -- NULL = bawaan platform
    code                   VARCHAR(32) NOT NULL,
    label                  VARCHAR(64) NOT NULL,
    tender_class           VARCHAR(32) NOT NULL,

    affects_cash_drawer    BOOLEAN NOT NULL DEFAULT FALSE, -- Menambah expected_cash saat tutup shift?
    counts_as_revenue      BOOLEAN NOT NULL DEFAULT TRUE,  -- Boleh masuk omzet?
    settles_immediately    BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = piutang / liabilitas
    requires_reference     BOOLEAN NOT NULL DEFAULT FALSE, -- 4 digit kartu, nomor seri voucher
    requires_approval      BOOLEAN NOT NULL DEFAULT FALSE, -- Butuh PIN Manager
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tender_class CHECK (tender_class IN (
        'CASH', 'CARD', 'DIGITAL', 'TRANSFER',
        'VOUCHER', 'DEPOSIT', 'MEMBER_CHARGE', 'HOUSE_USE', 'COMPLIMENT'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_platform_code
    ON pos.tender_types(code) WHERE merchant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_merchant_code
    ON pos.tender_types(merchant_id, code) WHERE merchant_id IS NOT NULL;

COMMENT ON TABLE pos.tender_types IS
    'Master jenis tender. merchant_id NULL berarti bawaan platform; baris merchant menimpa bawaan dengan code yang sama.';

-- Bawaan platform. Perhatikan affects_cash_drawer: hanya CASH.
INSERT INTO pos.tender_types (merchant_id, code, label, tender_class, affects_cash_drawer, counts_as_revenue, settles_immediately, requires_reference, requires_approval)
SELECT * FROM (VALUES
    (NULL::UUID, 'CASH',          'Tunai',              'CASH',          TRUE,  TRUE,  TRUE,  FALSE, FALSE),
    (NULL::UUID, 'QRIS',          'QRIS',               'DIGITAL',       FALSE, TRUE,  TRUE,  TRUE,  FALSE),
    (NULL::UUID, 'DEBIT_CARD',    'Kartu Debit',        'CARD',          FALSE, TRUE,  TRUE,  TRUE,  FALSE),
    (NULL::UUID, 'CREDIT_CARD',   'Kartu Kredit',       'CARD',          FALSE, TRUE,  TRUE,  TRUE,  FALSE),
    (NULL::UUID, 'E_WALLET',      'Dompet Digital',     'DIGITAL',       FALSE, TRUE,  TRUE,  TRUE,  FALSE),
    (NULL::UUID, 'TRANSFER',      'Transfer Bank',      'TRANSFER',      FALSE, TRUE,  TRUE,  TRUE,  FALSE),
    (NULL::UUID, 'VOUCHER',       'Voucher',            'VOUCHER',       FALSE, TRUE,  TRUE,  TRUE,  TRUE),
    (NULL::UUID, 'DEPOSIT',       'Potong Deposit',     'DEPOSIT',       FALSE, TRUE,  TRUE,  FALSE, FALSE),
    (NULL::UUID, 'MEMBER_CHARGE', 'Tagih ke Member',    'MEMBER_CHARGE', FALSE, TRUE,  FALSE, TRUE,  TRUE),
    (NULL::UUID, 'HOUSE_USE',     'House Use',          'HOUSE_USE',     FALSE, FALSE, TRUE,  FALSE, TRUE),
    (NULL::UUID, 'COMPLIMENT',    'Compliment',         'COMPLIMENT',    FALSE, FALSE, TRUE,  FALSE, TRUE)
) AS v(merchant_id, code, label, tender_class, affects_cash_drawer, counts_as_revenue, settles_immediately, requires_reference, requires_approval)
WHERE NOT EXISTS (
    SELECT 1 FROM pos.tender_types t WHERE t.merchant_id IS NULL AND t.code = v.code
);


-- 5. BUKU BESAR LIABILITAS PELANGGAN (Deposit / Voucher / Member) -------------
--
-- Deposit yang diterima hari ini bukan pendapatan hari ini — itu utang jasa.
-- Tanpa buku besar terpisah, uang muka tercatat sebagai omzet dua kali:
-- sekali saat diterima, sekali saat dipakai membayar bill.

CREATE TABLE IF NOT EXISTS pos.customer_deposits (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID REFERENCES internal.outlets(id) ON DELETE SET NULL,
    customer_id            UUID REFERENCES pos.customers(id) ON DELETE RESTRICT,

    account_type           VARCHAR(32) NOT NULL DEFAULT 'DEPOSIT', -- DEPOSIT, VOUCHER, MEMBER_CREDIT
    reference_code         VARCHAR(64),  -- Nomor seri voucher / nomor kartu member
    balance                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status                 VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, EXHAUSTED, EXPIRED, CLOSED
    expires_at             TIMESTAMPTZ,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_deposit_account_type CHECK (account_type IN ('DEPOSIT', 'VOUCHER', 'MEMBER_CREDIT')),
    CONSTRAINT chk_deposit_status       CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CLOSED')),
    CONSTRAINT chk_deposit_non_negative CHECK (balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_customer_deposits_customer ON pos.customer_deposits(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_deposits_merchant ON pos.customer_deposits(merchant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_deposit_reference
    ON pos.customer_deposits(merchant_id, reference_code) WHERE reference_code IS NOT NULL;

COMMENT ON TABLE pos.customer_deposits IS
    'Saldo liabilitas per pelanggan: uang muka (Deposit), voucher, dan plafon member. Bukan pendapatan sampai benar-benar dipakai membayar bill.';


CREATE TABLE IF NOT EXISTS pos.deposit_movements (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID REFERENCES internal.outlets(id) ON DELETE SET NULL,
    deposit_account_id     UUID NOT NULL REFERENCES pos.customer_deposits(id) ON DELETE RESTRICT,
    transaction_id         UUID REFERENCES pos.transactions(id) ON DELETE RESTRICT,
    payment_id             UUID REFERENCES pos.payments(id) ON DELETE RESTRICT,

    movement_type          VARCHAR(32) NOT NULL, -- TOPUP, REDEEM, REFUND, EXPIRE, ADJUSTMENT
    -- Positif menambah saldo (TOPUP/REFUND), negatif mengurangi (REDEEM/EXPIRE).
    amount                 NUMERIC(12, 2) NOT NULL,
    balance_after          NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    performed_by_user_id   UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    approved_by_user_id    UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    notes                  VARCHAR(255),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_deposit_movement_type CHECK (movement_type IN ('TOPUP', 'REDEEM', 'REFUND', 'EXPIRE', 'ADJUSTMENT')),
    CONSTRAINT chk_deposit_movement_amount_nonzero CHECK (amount <> 0)
);

CREATE INDEX IF NOT EXISTS idx_deposit_movements_account     ON pos.deposit_movements(deposit_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_movements_transaction ON pos.deposit_movements(transaction_id);

COMMENT ON TABLE pos.deposit_movements IS
    'Mutasi append-only saldo liabilitas pelanggan. balance_after diisi trigger, bukan oleh aplikasi, supaya dua terminal kasir yang menebus voucher bersamaan tidak saling menimpa.';


-- 5a. Trigger saldo: hitung di database, bukan di aplikasi --------------------

CREATE OR REPLACE FUNCTION pos.fn_apply_deposit_movement()
RETURNS TRIGGER AS $$
DECLARE
    v_balance NUMERIC(12, 2);
BEGIN
    -- Kunci baris akun supaya dua terminal tidak menghitung dari saldo basi.
    SELECT balance INTO v_balance
      FROM pos.customer_deposits
     WHERE id = NEW.deposit_account_id
       FOR UPDATE;

    IF v_balance IS NULL THEN
        RAISE EXCEPTION 'Akun deposit % tidak ditemukan.', NEW.deposit_account_id
            USING ERRCODE = '23503';
    END IF;

    v_balance := v_balance + NEW.amount;

    IF v_balance < 0 THEN
        RAISE EXCEPTION 'SALDO TIDAK CUKUP: penebusan % melebihi saldo akun deposit %.', ABS(NEW.amount), NEW.deposit_account_id
            USING ERRCODE = '23514';
    END IF;

    NEW.balance_after := v_balance;

    UPDATE pos.customer_deposits
       SET balance    = v_balance,
           status     = CASE WHEN v_balance = 0 AND status = 'ACTIVE' THEN 'EXHAUSTED'
                             WHEN v_balance > 0 AND status = 'EXHAUSTED' THEN 'ACTIVE'
                             ELSE status END,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = NEW.deposit_account_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_deposit_movement ON pos.deposit_movements;
CREATE TRIGGER trg_apply_deposit_movement
BEFORE INSERT ON pos.deposit_movements
FOR EACH ROW EXECUTE FUNCTION pos.fn_apply_deposit_movement();


CREATE OR REPLACE FUNCTION pos.fn_enforce_deposit_movements_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL SECURITY: pos.deposit_movements adalah buku besar liabilitas append-only. Gunakan mutasi pembalik (REFUND/ADJUSTMENT), bukan UPDATE atau DELETE.'
        USING ERRCODE = '23506';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deposit_movements_no_update ON pos.deposit_movements;
CREATE TRIGGER trg_deposit_movements_no_update
BEFORE UPDATE ON pos.deposit_movements
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_deposit_movements_append_only();

DROP TRIGGER IF EXISTS trg_deposit_movements_no_delete ON pos.deposit_movements;
CREATE TRIGGER trg_deposit_movements_no_delete
BEFORE DELETE ON pos.deposit_movements
FOR EACH ROW EXECUTE FUNCTION pos.fn_enforce_deposit_movements_append_only();


-- 6. VIEW KONTRAK --------------------------------------------------------------

-- 6a. contract.merchant_revenue — DIPERBAIKI, bukan dirombak.
--
-- CREATE OR REPLACE (bukan DROP CASCADE) dipakai dengan sengaja: daftar kolom
-- lama dipertahankan persis, revenue_impact ditambahkan di paling belakang.
-- Dengan begitu contract.catalog, contract.sector_summary dan konsumen lain
-- yang nge-JOIN ke view ini tidak ikut hancur.
CREATE OR REPLACE VIEW contract.merchant_revenue AS
SELECT
    x.id                                              AS transaction_id,
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
    x.created_at,
    x.revenue_impact
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
   AND (x.payment_status <> 'CANCELLED' OR x.payment_status IS NULL)
   AND x.revenue_impact = 'SALE'
   AND x.merged_into_transaction_id IS NULL;

COMMENT ON VIEW contract.merchant_revenue IS
    'Definisi tunggal omzet resmi: transaksi COMPLETED, tidak dibatalkan, berdampak SALE, dan belum digabung ke bill lain. House Use, Compliment, dan bill hasil merge tidak pernah masuk sini.';


-- 6b. contract.non_revenue_log — yang dikeluarkan dari omzet tetap terlihat.
DROP VIEW IF EXISTS contract.non_revenue_log CASCADE;
CREATE VIEW contract.non_revenue_log AS
SELECT
    x.id                                              AS transaction_id,
    x.tenant_id,
    x.merchant_id,
    m.name                                            AS merchant_name,
    x.outlet_id,
    o.name                                            AS outlet_name,
    x.invoice_number,
    x.business_sector,
    x.business_date,
    x.revenue_impact,
    x.order_status,
    x.subtotal,
    x.discount_amount,
    x.total_amount,
    x.cashier_user_id,
    u.full_name                                       AS cashier_name,
    x.created_at
  FROM pos.transactions x
  JOIN internal.merchants m ON m.id = x.merchant_id
  LEFT JOIN internal.outlets o ON o.id = x.outlet_id
  LEFT JOIN internal.users u ON u.id = x.cashier_user_id
 WHERE x.revenue_impact <> 'SALE'
   AND x.order_status = 'COMPLETED';

COMMENT ON VIEW contract.non_revenue_log IS
    'Bill yang sengaja dikeluarkan dari omzet (House Use, Compliment, Staff Meal). Tetap memotong stok, jadi ini permukaan untuk mengukur biaya konsumsi internal.';


-- 6c. contract.bill_operations_log — jejak modifikasi bill lintas domain.
DROP VIEW IF EXISTS contract.bill_operations_log CASCADE;
CREATE VIEW contract.bill_operations_log AS
SELECT
    b.id,
    b.tenant_id,
    b.merchant_id,
    m.name                                            AS merchant_name,
    b.outlet_id,
    o.name                                            AS outlet_name,
    b.operation_type,
    b.source_transaction_id,
    src.invoice_number                                AS source_invoice_number,
    b.target_transaction_id,
    tgt.invoice_number                                AS target_invoice_number,
    b.transaction_item_id,
    b.amount_delta,
    b.before_value,
    b.after_value,
    b.performed_by_user_id,
    pu.full_name                                      AS performed_by_name,
    b.approved_by_user_id,
    au.full_name                                      AS approved_by_name,
    b.reason,
    b.created_at
  FROM pos.bill_operations b
  JOIN internal.merchants m ON m.id = b.merchant_id
  LEFT JOIN internal.outlets o ON o.id = b.outlet_id
  LEFT JOIN pos.transactions src ON src.id = b.source_transaction_id
  LEFT JOIN pos.transactions tgt ON tgt.id = b.target_transaction_id
  LEFT JOIN internal.users pu ON pu.id = b.performed_by_user_id
  LEFT JOIN internal.users au ON au.id = b.approved_by_user_id;

COMMENT ON VIEW contract.bill_operations_log IS
    'Permukaan baca lintas domain untuk seluruh modifikasi bill, lengkap dengan siapa yang melakukan dan siapa yang menyetujui.';


-- 6d. contract.tender_settlement — dasar rekonsiliasi tutup shift yang benar.
DROP VIEW IF EXISTS contract.tender_settlement CASCADE;
CREATE VIEW contract.tender_settlement AS
SELECT
    x.tenant_id,
    x.merchant_id,
    x.outlet_id,
    x.shift_id,
    x.business_date,
    COALESCE(p.payment_method, x.payment_method)      AS tender_code,
    COALESCE(tt.label, COALESCE(p.payment_method, x.payment_method)) AS tender_label,
    COALESCE(tt.tender_class, 'CASH')                 AS tender_class,
    COALESCE(tt.affects_cash_drawer, FALSE)           AS affects_cash_drawer,
    COALESCE(tt.counts_as_revenue, TRUE)              AS counts_as_revenue,
    COUNT(*)::INT                                     AS bill_count,
    SUM(COALESCE(p.amount, x.total_amount))           AS tender_amount
  FROM pos.transactions x
  LEFT JOIN pos.payments p ON p.transaction_id = x.id AND p.payment_status IN ('PAID', 'SETTLED')
  LEFT JOIN LATERAL (
      SELECT label, tender_class, affects_cash_drawer, counts_as_revenue
        FROM pos.tender_types t
       WHERE t.code = COALESCE(p.payment_method, x.payment_method)
         AND (t.merchant_id = x.merchant_id OR t.merchant_id IS NULL)
         AND t.is_active
       ORDER BY t.merchant_id NULLS LAST
       LIMIT 1
  ) tt ON TRUE
 WHERE x.order_status = 'COMPLETED'
   AND x.merged_into_transaction_id IS NULL
 GROUP BY x.tenant_id, x.merchant_id, x.outlet_id, x.shift_id, x.business_date,
          COALESCE(p.payment_method, x.payment_method),
          tt.label, tt.tender_class, tt.affects_cash_drawer, tt.counts_as_revenue;

COMMENT ON VIEW contract.tender_settlement IS
    'Rincian tender per shift. affects_cash_drawer memisahkan uang yang benar-benar ada di laci dari voucher, deposit, dan house use — supaya selisih kas kasir tidak salah tuduh.';


-- 6e. contract.customer_deposit_balances — posisi liabilitas berjalan.
DROP VIEW IF EXISTS contract.customer_deposit_balances CASCADE;
CREATE VIEW contract.customer_deposit_balances AS
SELECT
    d.id                                              AS deposit_account_id,
    d.tenant_id,
    d.merchant_id,
    m.name                                            AS merchant_name,
    d.outlet_id,
    d.customer_id,
    c.name                                            AS customer_name,
    c.phone                                           AS customer_phone,
    d.account_type,
    d.reference_code,
    d.balance,
    d.status,
    d.expires_at,
    d.updated_at
  FROM pos.customer_deposits d
  JOIN internal.merchants m ON m.id = d.merchant_id
  LEFT JOIN pos.customers c ON c.id = d.customer_id;

COMMENT ON VIEW contract.customer_deposit_balances IS
    'Posisi liabilitas deposit/voucher/member per pelanggan. Dibaca backoffice untuk laporan utang jasa, tanpa memberi akses tulis ke skema pos.';


-- 7. HAK AKSES -----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
BEGIN
    -- Pemilik domain: hanya pos-service yang boleh menulis.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT, INSERT ON pos.bill_operations   TO svc_pos;
        GRANT SELECT, INSERT ON pos.deposit_movements TO svc_pos;
        GRANT SELECT, INSERT, UPDATE ON pos.customer_deposits TO svc_pos;
        GRANT SELECT, INSERT, UPDATE ON pos.tender_types      TO svc_pos;
    END IF;

    -- Konsumen lintas domain membaca lewat contract, tidak pernah lewat pos.*
    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.non_revenue_log TO %I', svc);
            EXECUTE format('GRANT SELECT ON contract.bill_operations_log TO %I', svc);
            EXECUTE format('GRANT SELECT ON contract.tender_settlement TO %I', svc);
            EXECUTE format('GRANT SELECT ON contract.customer_deposit_balances TO %I', svc);
        END IF;
    END LOOP;

    -- Klien anonim/publik tidak pernah menyentuh buku besar finansial.
    FOREACH svc IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('REVOKE ALL ON pos.bill_operations, pos.deposit_movements, pos.customer_deposits FROM %I', svc);
        END IF;
    END LOOP;
END $$;
