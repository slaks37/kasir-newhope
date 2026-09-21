-- 0038_staff_attendance_payroll_sync.sql
-- Sinkronisasi presensi (clock-in / clock-out) dan penggajian (payroll slips) staf.
-- Menghubungkan modul Smart Labor POS ke PostgreSQL secara idempotent.

CREATE TABLE IF NOT EXISTS pos.staff_attendances (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID REFERENCES internal.outlets(id) ON DELETE SET NULL,
    client_attendance_id   TEXT NOT NULL,
    staff_id               TEXT NOT NULL,
    staff_name             TEXT NOT NULL,
    staff_role             TEXT NOT NULL,
    clock_in_at            TIMESTAMPTZ NOT NULL,
    clock_out_at           TIMESTAMPTZ,
    shift_notes            TEXT,
    status                 TEXT NOT NULL DEFAULT 'CLOCKED_IN',
    branch_id              TEXT,
    branch_name            TEXT,
    clock_in_geo           JSONB,
    clock_out_geo          JSONB,
    business_sector        TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_staff_attendance_client UNIQUE (tenant_id, client_attendance_id)
);

CREATE TABLE IF NOT EXISTS pos.staff_payrolls (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    client_slip_id         TEXT NOT NULL,
    staff_id               TEXT NOT NULL,
    staff_name             TEXT NOT NULL,
    staff_role             TEXT NOT NULL,
    period_month           TEXT NOT NULL,
    period_start           DATE NOT NULL,
    period_end             DATE NOT NULL,
    days_attended          INT NOT NULL DEFAULT 0,
    base_salary            NUMERIC(14,2) NOT NULL DEFAULT 0,
    allowance              NUMERIC(14,2) NOT NULL DEFAULT 0,
    individual_commission  NUMERIC(14,2) NOT NULL DEFAULT 0,
    team_pool_commission   NUMERIC(14,2) NOT NULL DEFAULT 0,
    daily_target_bonus     NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_earnings         NUMERIC(14,2) NOT NULL DEFAULT 0,
    deductions             NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_salary             NUMERIC(14,2) NOT NULL DEFAULT 0,
    status                 TEXT NOT NULL DEFAULT 'DRAFT',
    paid_at                TIMESTAMPTZ,
    payment_method         TEXT,
    notes                  TEXT,
    business_sector        TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_staff_payroll_client UNIQUE (tenant_id, client_slip_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendances_tenant ON pos.staff_attendances(tenant_id, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_attendances_staff ON pos.staff_attendances(staff_id, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_payrolls_tenant ON pos.staff_payrolls(tenant_id, period_month);
CREATE INDEX IF NOT EXISTS idx_staff_payrolls_staff ON pos.staff_payrolls(staff_id);

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.staff_attendances TO svc_pos;
        GRANT ALL ON pos.staff_payrolls TO svc_pos;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT SELECT ON pos.staff_attendances TO svc_internal;
        GRANT SELECT ON pos.staff_payrolls TO svc_internal;
    END IF;
END $$;
