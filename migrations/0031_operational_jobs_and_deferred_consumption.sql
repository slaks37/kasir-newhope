-- =============================================================================
-- 0031_operational_jobs_and_deferred_consumption.sql
--
-- Pemisahan Financial Event vs Workshop Operational Work Orders (Deferred Consumption):
-- 1. pos.operational_jobs: Entitas Surat Perintah Kerja (SPK / Work Order Workshop)
-- 2. Daur hidup operasional: QUEUED -> IN_PROGRESS -> QUALITY_CHECK -> READY -> DELIVERED
-- 3. Aturan Konsumsi Stok (BOM Consumption Rule):
--    - Drop-off / Order Masuk (QUEUED): STOK TIDAK BERKURANG
--    - Pengerjaan Dimulai (IN_PROGRESS): STOK BAHAN KIMIA / CONSUMABLE BARU DIPOTONG
--    - Batal sebelum dicuci (CANCELLED): STOK TETAP UTUH AMAN
-- 4. View Kontrak Workshop Live Queue
--
-- Idempoten, aman diulang.
-- =============================================================================

-- 1. TABEL SURAT PERINTAH KERJA WORKSHOP (pos.operational_jobs) ----------------

CREATE TABLE IF NOT EXISTS pos.operational_jobs (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id          UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id        UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id          UUID NOT NULL REFERENCES internal.outlets(id) ON DELETE CASCADE,
    transaction_id     UUID REFERENCES pos.transactions(id) ON DELETE SET NULL,
    
    -- Tipe Pekerjaan Workshop
    job_type           VARCHAR(32) NOT NULL DEFAULT 'LAUNDRY_CYCLE', -- 'LAUNDRY_CYCLE', 'CARWASH_BAY', 'KITCHEN_PREP', 'BARBER_SERVICE'
    job_number         VARCHAR(64) NOT NULL,
    
    -- Mesin / Stasiun & Operator yang Bertugas
    resource_name      VARCHAR(64), -- 'Mesin Cuci Front-Load #01', 'Bay 2 Hidrolik', 'Chair 3'
    assigned_staff_id  UUID REFERENCES internal.users(id) ON DELETE SET NULL,
    
    -- Daur Hidup Pekerjaan (Operational State Machine)
    status             VARCHAR(32) NOT NULL DEFAULT 'QUEUED', 
    -- 'QUEUED'           : Tiket masuk antrean (Stok BELUM dipotong)
    -- 'IN_PROGRESS'      : Mesin mulai berputar / Bay mulai mencuci (STOK BOM DIPOTONG)
    -- 'QUALITY_CHECK'    : Pengeringan / Penyetrikaan / Detailing QC
    -- 'READY_FOR_PICKUP' : Selesai, pakaian di rak siap diambil
    -- 'DELIVERED'        : Serah terima pakaian ke pelanggan selesai
    -- 'CANCELLED'        : Batal pengerjaan (Bebas dari pemotongan stok)
    
    is_bom_consumed    BOOLEAN NOT NULL DEFAULT FALSE,
    consumed_at        TIMESTAMPTZ,
    
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_outlet_job_number UNIQUE (outlet_id, job_number)
);

CREATE INDEX IF NOT EXISTS idx_jobs_outlet_status ON pos.operational_jobs(outlet_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_transaction   ON pos.operational_jobs(transaction_id);


-- 2. TRIGGER LOGIKA PENUNDAAN KONSUMSI STOK (Deferred BOM Trigger) ------------

CREATE OR REPLACE FUNCTION pos.fn_handle_operational_job_consumption()
RETURNS TRIGGER AS $$
DECLARE
    r_item RECORD;
    t_rec RECORD;
    laundry_ctx RECORD;
    detergent_id UUID;
    softener_id UUID;
    weight NUMERIC(8,2) := 5.0;
    loc_id UUID;
BEGIN
    -- Hanya eksekusi ketika status berubah ke IN_PROGRESS dan belum pernah dikonsumsi
    IF NEW.status = 'IN_PROGRESS' AND OLD.status != 'IN_PROGRESS' AND NEW.is_bom_consumed = FALSE THEN
        
        -- Dapatkan lokasi gudang cabang utama
        SELECT id INTO loc_id 
          FROM pos.inventory_locations 
         WHERE outlet_id = NEW.outlet_id 
         ORDER BY is_primary DESC 
         LIMIT 1;

        -- Kasus Khusus: Laundry Cycle Job
        IF NEW.job_type = 'LAUNDRY_CYCLE' AND NEW.transaction_id IS NOT NULL THEN
            -- Ambil data berat dari order_context_laundry jika ada
            SELECT weight_kg INTO weight 
              FROM pos.order_context_laundry 
             WHERE transaction_id = NEW.transaction_id;
            
            IF weight IS NULL OR weight <= 0 THEN
                weight := 5.0; -- Default fallback berat
            END IF;

            -- Cari bahan kimia deterjen & softener di inventory
            SELECT id INTO detergent_id 
              FROM pos.inventory_items 
             WHERE merchant_id = NEW.merchant_id 
               AND (sku ILIKE '%DET%' OR item_name ILIKE '%Deterjen%') 
             LIMIT 1;

            SELECT id INTO softener_id 
              FROM pos.inventory_items 
             WHERE merchant_id = NEW.merchant_id 
               AND (sku ILIKE '%SOFT%' OR item_name ILIKE '%Softener%' OR item_name ILIKE '%Pewangi%') 
             LIMIT 1;

            -- Potong Deterjen (15 ml per kg) jika item ditemukan
            IF detergent_id IS NOT NULL AND loc_id IS NOT NULL THEN
                INSERT INTO pos.inventory_transactions (
                    tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, 
                    quantity_delta, reference_type, reference_id, reason
                ) VALUES (
                    NEW.tenant_id, NEW.merchant_id, NEW.outlet_id, loc_id, detergent_id,
                    -(weight * 15.0), 'JOB_CONSUMPTION', NEW.id::text, 'Pemakaian Deterjen Siklus Cuci SPK: ' || NEW.job_number
                );
            END IF;

            -- Potong Softener (10 ml per kg) jika item ditemukan
            IF softener_id IS NOT NULL AND loc_id IS NOT NULL THEN
                INSERT INTO pos.inventory_transactions (
                    tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, 
                    quantity_delta, reference_type, reference_id, reason
                ) VALUES (
                    NEW.tenant_id, NEW.merchant_id, NEW.outlet_id, loc_id, softener_id,
                    -(weight * 10.0), 'JOB_CONSUMPTION', NEW.id::text, 'Pemakaian Softener Siklus Cuci SPK: ' || NEW.job_number
                );
            END IF;
        END IF;

        -- Tandai bahwa stok telah terpotong untuk SPK ini
        NEW.is_bom_consumed := TRUE;
        NEW.consumed_at := CURRENT_TIMESTAMP;
        NEW.started_at := COALESCE(NEW.started_at, CURRENT_TIMESTAMP);
    END IF;

    -- Update timestamp selesai jika status beralih ke READY / DELIVERED
    IF NEW.status IN ('READY_FOR_PICKUP', 'DELIVERED') AND OLD.status NOT IN ('READY_FOR_PICKUP', 'DELIVERED') THEN
        NEW.completed_at := COALESCE(NEW.completed_at, CURRENT_TIMESTAMP);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operational_job_consumption ON pos.operational_jobs;

CREATE TRIGGER trg_operational_job_consumption
BEFORE UPDATE OF status ON pos.operational_jobs
FOR EACH ROW EXECUTE FUNCTION pos.fn_handle_operational_job_consumption();


-- 3. VIEW KONTRAK MONITOR SPK WORKSHOP (contract.workshop_jobs_board) ---------

DROP VIEW IF EXISTS contract.workshop_jobs_board CASCADE;
CREATE VIEW contract.workshop_jobs_board AS
SELECT
    j.id                                               AS job_id,
    j.tenant_id,
    j.merchant_id,
    m.name                                             AS merchant_name,
    m.business_sector,
    j.outlet_id,
    o.name                                             AS outlet_name,
    j.job_type,
    j.job_number,
    j.transaction_id,
    t.invoice_number,
    t.total_amount,
    j.resource_name,
    j.assigned_staff_id,
    u.full_name                                        AS assigned_staff_name,
    j.status                                           AS job_status,
    j.is_bom_consumed,
    j.consumed_at,
    j.started_at,
    j.completed_at,
    j.created_at                                       AS received_at
  FROM pos.operational_jobs j
  JOIN internal.merchants m           ON m.id = j.merchant_id
  JOIN internal.outlets o             ON o.id = j.outlet_id
  LEFT JOIN pos.transactions t        ON t.id = j.transaction_id
  LEFT JOIN internal.users u          ON u.id = j.assigned_staff_id;

CREATE OR REPLACE VIEW public.v_workshop_jobs AS
  SELECT * FROM contract.workshop_jobs_board;
