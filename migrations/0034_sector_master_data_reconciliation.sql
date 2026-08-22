-- =============================================================================
-- 0034_sector_master_data_reconciliation.sql
--
-- Rekonsiliasi Master Data Sektor Operasional:
-- 1. F&B: pos.tables, pos.kds_stations
-- 2. Car Wash: pos.bays, pos.vehicles
-- 3. Barbershop: pos.chairs
-- 4. General/Laundry: pos.operational_stages
-- 5. Resource Allocation: pos.staff_assignments
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. F&B SECTOR MASTER DATA ---------------------------------------------------

CREATE TABLE IF NOT EXISTS pos.tables (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    table_name             VARCHAR(64) NOT NULL,
    seating_capacity       INT NOT NULL DEFAULT 4,
    status                 VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE', 'OCCUPIED', 'RESERVED', 'UNAVAILABLE'
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_outlet_table_name UNIQUE (outlet_id, table_name)
);

CREATE TABLE IF NOT EXISTS pos.kds_stations (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    station_name           VARCHAR(64) NOT NULL, -- e.g., 'Grill', 'Beverage', 'Assembly'
    status                 VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_outlet_kds_station UNIQUE (outlet_id, station_name)
);


-- 2. CAR WASH SECTOR MASTER DATA ----------------------------------------------

CREATE TABLE IF NOT EXISTS pos.bays (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    bay_name               VARCHAR(64) NOT NULL, -- e.g., 'Bay 1', 'Bay 2'
    status                 VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE', 'IN_USE', 'MAINTENANCE'
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_outlet_bay_name UNIQUE (outlet_id, bay_name)
);

CREATE TABLE IF NOT EXISTS pos.vehicles (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    license_plate          VARCHAR(32) NOT NULL,
    vehicle_category       VARCHAR(32) NOT NULL DEFAULT 'MEDIUM', -- 'SMALL', 'MEDIUM', 'SUV_LARGE', 'MOTORCYCLE'
    vehicle_model          VARCHAR(100),
    customer_id            UUID, -- Can link to a global customers table if/when it exists
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_merchant_license_plate UNIQUE (merchant_id, license_plate)
);


-- 3. BARBERSHOP SECTOR MASTER DATA --------------------------------------------

CREATE TABLE IF NOT EXISTS pos.chairs (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    chair_name             VARCHAR(64) NOT NULL, -- e.g., 'Chair 1', 'Chair 2', 'VIP Room'
    status                 VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE', 'IN_USE', 'MAINTENANCE'
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_outlet_chair_name UNIQUE (outlet_id, chair_name)
);


-- 4. GENERAL / LAUNDRY MASTER DATA --------------------------------------------

CREATE TABLE IF NOT EXISTS pos.operational_stages (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    sector                 VARCHAR(32) NOT NULL, -- e.g., 'LAUNDRY', 'CARWASH'
    stage_name             VARCHAR(64) NOT NULL, -- e.g., 'WASHING', 'DRYING', 'IRONING'
    sequence_order         INT NOT NULL DEFAULT 10,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_merchant_sector_stage UNIQUE (merchant_id, sector, stage_name)
);


-- 5. RESOURCE ALLOCATION & STAFF ASSIGNMENTS ----------------------------------

CREATE TABLE IF NOT EXISTS pos.staff_assignments (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    staff_user_id          UUID NOT NULL REFERENCES internal.users(id) ON DELETE CASCADE,
    assigned_role          VARCHAR(64) NOT NULL, -- e.g., 'WASHER', 'KAPSTER', 'CASHIER', 'CHEF'
    assigned_resource_id   UUID, -- Can be table_id, bay_id, chair_id depending on context
    assigned_resource_type VARCHAR(64), -- e.g., 'BAY', 'CHAIR', 'TABLE'
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    shift_start            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    shift_end              TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_staff_assignment_user ON pos.staff_assignments(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignment_active ON pos.staff_assignments(outlet_id, is_active);


-- 6. PERBARUI FOREIGN KEY DI ORDER CONTEXTS -----------------------------------

-- Catatan: Untuk order_context_fnb, foreign key ke pos.tables (table_id) 
-- sebaiknya ditambahkan setelah proses data cleansing jika ada data lama.
-- ALTER TABLE pos.order_context_fnb ADD CONSTRAINT fk_fnb_table FOREIGN KEY (table_id) REFERENCES pos.tables(id) ON DELETE SET NULL;
