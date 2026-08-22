-- =============================================================================
-- 0030_sector_order_operational_contexts.sql
--
-- Pemisahan Bersih: Financial Transaction Event vs Operational Sector Context
-- 1. pos.transactions: Murni entitas keuangan/komersial universal (Uang, Pajak, Diskon)
-- 2. Entitas Konteks Operasional Spesifik Sektor:
--    - pos.order_context_fnb     (Table, KDS Status, Guest Count, Pager)
--    - pos.order_context_retail  (Scanner ID, Fast Checkout, Bag Qty)
--    - pos.order_context_laundry (Weight Kg, Fragrance, Stage: Washing/Drying/Ironing)
--    - pos.order_context_carwash (Plat Nomor, Kategori Mobil, Bay, Washer Staf)
--    - pos.order_context_barber  (Kapster Stylist, Kursi, Antrean, Tip Staf)
-- 3. View Kontrak Operasional Realtime per Sektor
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. KONTEKS OPERASIONAL F&B (pos.order_context_fnb) --------------------------

CREATE TABLE IF NOT EXISTS pos.order_context_fnb (
    transaction_id         UUID PRIMARY KEY REFERENCES pos.transactions(id) ON DELETE CASCADE,
    table_id               UUID,
    table_name             VARCHAR(64),
    guest_count            INT NOT NULL DEFAULT 1,
    order_type             VARCHAR(32) NOT NULL DEFAULT 'DINE_IN', -- 'DINE_IN', 'TAKEAWAY', 'DELIVERY'
    kds_status             VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'COOKING', 'READY', 'SERVED'
    pager_number           VARCHAR(32),
    notes                  TEXT,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fnb_ctx_kds ON pos.order_context_fnb(kds_status);


-- 2. KONTEKS OPERASIONAL RETAIL (pos.order_context_retail) --------------------

CREATE TABLE IF NOT EXISTS pos.order_context_retail (
    transaction_id         UUID PRIMARY KEY REFERENCES pos.transactions(id) ON DELETE CASCADE,
    scanner_device_id      VARCHAR(64),
    fast_checkout_mode     BOOLEAN NOT NULL DEFAULT FALSE,
    customer_card_number   VARCHAR(64),
    bag_quantity           INT NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- 3. KONTEKS OPERASIONAL LAUNDRY (pos.order_context_laundry) ------------------

CREATE TABLE IF NOT EXISTS pos.order_context_laundry (
    transaction_id         UUID PRIMARY KEY REFERENCES pos.transactions(id) ON DELETE CASCADE,
    weight_kg              NUMERIC(8, 2),
    item_count             INT,
    fragrance_name         VARCHAR(64) DEFAULT 'Standard Fresh',
    service_tier           VARCHAR(32) NOT NULL DEFAULT 'REGULAR', -- 'REGULAR', 'EXPRESS_1DAY', 'EXPRESS_SAME_DAY'
    operational_status     VARCHAR(32) NOT NULL DEFAULT 'RECEIVED', -- 'RECEIVED', 'WASHING', 'DRYING', 'IRONING', 'READY_FOR_PICKUP', 'COMPLETED'
    ready_at               TIMESTAMPTZ,
    picked_up_at           TIMESTAMPTZ,
    rack_location          VARCHAR(64),
    garment_notes          TEXT,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_laundry_ctx_status ON pos.order_context_laundry(operational_status);


-- 4. KONTEKS OPERASIONAL CAR WASH (pos.order_context_carwash) -----------------

CREATE TABLE IF NOT EXISTS pos.order_context_carwash (
    transaction_id         UUID PRIMARY KEY REFERENCES pos.transactions(id) ON DELETE CASCADE,
    license_plate          VARCHAR(32) NOT NULL,
    vehicle_category       VARCHAR(32) NOT NULL DEFAULT 'MEDIUM', -- 'SMALL', 'MEDIUM', 'SUV_LARGE', 'MOTORCYCLE'
    vehicle_model          VARCHAR(64),
    bay_number             VARCHAR(32),
    washer_staff_ids       UUID[], -- Staf pencuci yang ditugaskan
    wash_status            VARCHAR(32) NOT NULL DEFAULT 'IN_QUEUE', -- 'IN_QUEUE', 'WASHING', 'DRYING', 'INSPECTION_READY', 'FINISHED'
    entry_time             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    exit_time              TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_carwash_ctx_plate  ON pos.order_context_carwash(license_plate);
CREATE INDEX IF NOT EXISTS idx_carwash_ctx_status ON pos.order_context_carwash(wash_status);


-- 5. KONTEKS OPERASIONAL BARBERSHOP (pos.order_context_barber) ----------------

CREATE TABLE IF NOT EXISTS pos.order_context_barber (
    transaction_id         UUID PRIMARY KEY REFERENCES pos.transactions(id) ON DELETE CASCADE,
    stylist_user_id        UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    chair_number           VARCHAR(32),
    service_queue_number   INT,
    tip_amount             NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    customer_hair_notes    TEXT,
    service_duration_mins  INT DEFAULT 30,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_barber_ctx_stylist ON pos.order_context_barber(stylist_user_id);


-- 6. VIEW KONTRAK OPERASIONAL REALTIME PER SEKTOR -----------------------------

-- 6a. F&B Live Kitchen & Table Queue
DROP VIEW IF EXISTS contract.live_fnb_orders CASCADE;
CREATE VIEW contract.live_fnb_orders AS
SELECT
    t.id                                               AS transaction_id,
    t.tenant_id,
    t.merchant_id,
    t.outlet_id,
    t.invoice_number,
    t.order_status,
    f.table_name,
    f.guest_count,
    f.order_type,
    f.kds_status,
    f.pager_number,
    f.notes,
    t.total_amount,
    t.created_at
  FROM pos.transactions t
  JOIN pos.order_context_fnb f ON f.transaction_id = t.id
 WHERE t.order_status NOT IN ('CANCELLED', 'VOIDED');

-- 6b. Laundry Live Workshop Queue
DROP VIEW IF EXISTS contract.live_laundry_orders CASCADE;
CREATE VIEW contract.live_laundry_orders AS
SELECT
    t.id                                               AS transaction_id,
    t.tenant_id,
    t.merchant_id,
    t.outlet_id,
    t.invoice_number,
    t.order_status,
    l.weight_kg,
    l.fragrance_name,
    l.service_tier,
    l.operational_status,
    l.ready_at,
    l.rack_location,
    t.total_amount,
    t.created_at
  FROM pos.transactions t
  JOIN pos.order_context_laundry l ON l.transaction_id = t.id
 WHERE t.order_status NOT IN ('CANCELLED', 'VOIDED');

-- 6c. Car Wash Live Bay Queue
DROP VIEW IF EXISTS contract.live_carwash_queue CASCADE;
CREATE VIEW contract.live_carwash_queue AS
SELECT
    t.id                                               AS transaction_id,
    t.tenant_id,
    t.merchant_id,
    t.outlet_id,
    t.invoice_number,
    t.order_status,
    c.license_plate,
    c.vehicle_category,
    c.vehicle_model,
    c.bay_number,
    c.washer_staff_ids,
    c.wash_status,
    c.entry_time,
    t.total_amount
  FROM pos.transactions t
  JOIN pos.order_context_carwash c ON c.transaction_id = t.id
 WHERE t.order_status NOT IN ('CANCELLED', 'VOIDED');

-- 6d. Barbershop Live Queue & Stylist Assignment
DROP VIEW IF EXISTS contract.live_barber_queue CASCADE;
CREATE VIEW contract.live_barber_queue AS
SELECT
    t.id                                               AS transaction_id,
    t.tenant_id,
    t.merchant_id,
    t.outlet_id,
    t.invoice_number,
    t.order_status,
    b.chair_number,
    b.stylist_user_id,
    u.full_name                                        AS stylist_name,
    b.tip_amount,
    b.customer_hair_notes,
    t.total_amount,
    t.created_at
  FROM pos.transactions t
  JOIN pos.order_context_barber b ON b.transaction_id = t.id
  LEFT JOIN internal.users u      ON u.id = b.stylist_user_id
 WHERE t.order_status NOT IN ('CANCELLED', 'VOIDED');
