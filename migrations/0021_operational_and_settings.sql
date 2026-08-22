-- =============================================================================
-- 0021_operational_and_settings.sql
--
-- OPERATIONAL ENHANCEMENTS:
-- 1. Enhanced Transaction Dates (business_date, completed_at, dll)
-- 2. Shift Management (cash_registers, shifts)
-- 3. Attendance (terpisah dari shift)
-- 4. Settings Refactoring (internal.merchant_settings, pos.branch_settings, dll)
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. EXTEND pos.transactions DATES -------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'business_date') THEN
        ALTER TABLE pos.transactions ADD COLUMN business_date DATE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'completed_at') THEN
        ALTER TABLE pos.transactions ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'cancelled_at') THEN
        ALTER TABLE pos.transactions ADD COLUMN cancelled_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'voided_at') THEN
        ALTER TABLE pos.transactions ADD COLUMN voided_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions' AND column_name = 'shift_id') THEN
        ALTER TABLE pos.transactions ADD COLUMN shift_id UUID;
    END IF;

    -- Backfill default dates for existing data
    UPDATE pos.transactions SET 
        business_date = created_at::date,
        completed_at = created_at
    WHERE business_date IS NULL;
END $$;


-- 2. CASH REGISTERS & SHIFTS -------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.cash_registers (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    name               VARCHAR(100) NOT NULL,
    status             VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cash_registers_outlet ON pos.cash_registers(outlet_id);

CREATE TABLE IF NOT EXISTS pos.shifts (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    register_id        UUID NOT NULL REFERENCES pos.cash_registers(id) ON DELETE RESTRICT,
    opened_by_user_id  UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    closed_by_user_id  UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    business_date      DATE NOT NULL,
    opening_cash       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    closing_cash       NUMERIC(12, 2),
    expected_cash      NUMERIC(12, 2),
    cash_difference    NUMERIC(12, 2),
    status             VARCHAR(32) NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED
    opened_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shifts_register ON pos.shifts(register_id);
CREATE INDEX IF NOT EXISTS idx_shifts_business_date ON pos.shifts(business_date);

-- Add foreign key to transactions now that shifts exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_transactions_shift') THEN
        ALTER TABLE pos.transactions ADD CONSTRAINT fk_transactions_shift FOREIGN KEY (shift_id) REFERENCES pos.shifts(id) ON DELETE SET NULL;
    END IF;
END $$;


-- 3. ATTENDANCE --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS internal.attendances (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID REFERENCES internal.outlets(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES internal.users(id) ON DELETE CASCADE,
    business_date      DATE NOT NULL,
    clock_in_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out_at       TIMESTAMPTZ,
    clock_in_notes     TEXT,
    clock_out_notes    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendances_user ON internal.attendances(user_id);
CREATE INDEX IF NOT EXISTS idx_attendances_date ON internal.attendances(business_date);


-- 4. SETTINGS REFACTORING ----------------------------------------------------

CREATE TABLE IF NOT EXISTS internal.merchant_settings (
    merchant_id        UUID PRIMARY KEY REFERENCES internal.merchants(id) ON DELETE CASCADE,
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    timezone           VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    currency           VARCHAR(10) NOT NULL DEFAULT 'IDR',
    language           VARCHAR(10) NOT NULL DEFAULT 'id',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos.branch_settings (
    outlet_id          UUID PRIMARY KEY REFERENCES internal.outlets(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    operating_hours    JSONB NOT NULL DEFAULT '{}'::jsonb,
    default_order_type VARCHAR(32) NOT NULL DEFAULT 'DINE_IN',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos.pos_settings (
    outlet_id          UUID PRIMARY KEY REFERENCES internal.outlets(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    auto_print_receipt BOOLEAN NOT NULL DEFAULT TRUE,
    require_pin_void   BOOLEAN NOT NULL DEFAULT TRUE,
    require_pin_refund BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos.tax_settings (
    merchant_id        UUID PRIMARY KEY REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID REFERENCES internal.outlets(id) ON DELETE CASCADE,
    tax_percentage     NUMERIC(5, 2) NOT NULL DEFAULT 11.00,
    tax_inclusive      BOOLEAN NOT NULL DEFAULT FALSE,
    service_charge_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos.receipt_settings (
    merchant_id        UUID PRIMARY KEY REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID REFERENCES internal.outlets(id) ON DELETE CASCADE,
    logo_url           VARCHAR(255),
    header_text        TEXT,
    footer_text        TEXT,
    social_media       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- 5. UPDATE VIEWS WITH NEW DATES ---------------------------------------------

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
    x.business_date,
    x.completed_at,
    x.cancelled_at,
    x.voided_at,
    x.shift_id,
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

CREATE OR REPLACE VIEW public.v_transaction_log AS
  SELECT * FROM contract.transaction_log;


-- 6. HAK AKSES PERAN ---------------------------------------------------------
DO $$
DECLARE
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.cash_registers     TO svc_pos;
        GRANT ALL ON pos.shifts             TO svc_pos;
        GRANT ALL ON pos.branch_settings    TO svc_pos;
        GRANT ALL ON pos.pos_settings       TO svc_pos;
        GRANT ALL ON pos.tax_settings       TO svc_pos;
        GRANT ALL ON pos.receipt_settings   TO svc_pos;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT ALL ON internal.attendances       TO svc_internal;
        GRANT ALL ON internal.merchant_settings TO svc_internal;
    END IF;

    -- Cross-domain grants
    FOREACH svc IN ARRAY services LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('GRANT SELECT ON contract.transaction_log TO %I', 'svc_' || svc);
        END IF;
    END LOOP;
END $$;
