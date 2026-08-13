-- =============================================================================
-- 0009_service_schemas.sql
--
-- Memecah satu skema `public` menjadi empat domain, satu per service.
--
--   pos       -> pos-service        (transaksi, katalog, staf, jejak aktivitas)
--   billing   -> billing-service    (paket, langganan, faktur, webhook)
--   ai        -> ai-service         (insight, kredit, log query, target)
--   internal  -> backoffice-service (identitas internal, audit, health merchant)
--
-- -----------------------------------------------------------------------------
-- KENAPA SATU DATABASE, BUKAN EMPAT
-- -----------------------------------------------------------------------------
-- Empat database membuat pemisahannya murni, tapi menghancurkan satu hal yang
-- sudah dibuktikan bekerja: AI Copilot dan admin panel melaporkan angka yang
-- SAMA PERSIS karena membaca definisi omzet yang sama. Dengan database terpisah,
-- kesamaan itu harus dijaga lewat replikasi event — dan sejak saat itu
-- "berapa omzet saya" punya dua jawaban yang bisa berbeda selama replikasi
-- tertinggal.
--
-- Satu database dengan skema terpisah memberi batas yang NYATA — ditegakkan
-- oleh hak akses, bukan kesepakatan — sambil mempertahankan konsistensi baca.
--
-- -----------------------------------------------------------------------------
-- KONTRAK ANTAR-SERVICE ADALAH VIEW, BUKAN TABEL
-- -----------------------------------------------------------------------------
-- Service lain TIDAK PERNAH diberi akses ke tabel milik service lain. Yang
-- dibagikan hanya view di skema `contract`. Konsekuensinya disengaja: pemilik
-- boleh mengubah bentuk tabelnya kapan saja selama view-nya tetap utuh, dan
-- perubahan yang merusak akan ketahuan saat migrasi dijalankan — bukan saat
-- service lain error di produksi.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0009_service_schemas.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. SKEMA --------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS pos;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS internal;
-- Satu-satunya skema yang boleh dibaca lintas service.
CREATE SCHEMA IF NOT EXISTS contract;

COMMENT ON SCHEMA contract IS
    'Permukaan baca antar-service. Hanya view. Mengubah isinya berarti mengubah kontrak publik — perlakukan seperti API versi.';


-- 2. PEMINDAHAN TABEL ---------------------------------------------------------
--
-- View lama di `public` menunjuk tabel-tabel ini dan akan menghalangi ALTER,
-- jadi dibuang lebih dulu. Semuanya dibangun ulang di Bagian 4 sebagai kontrak.

DROP VIEW IF EXISTS public.v_sector_summary          CASCADE;
DROP VIEW IF EXISTS public.v_merchant_directory      CASCADE;
DROP VIEW IF EXISTS public.v_product_sales_by_sector CASCADE;
DROP VIEW IF EXISTS public.v_activity_by_sector      CASCADE;
DROP VIEW IF EXISTS public.v_daily_sector_revenue    CASCADE;
DROP VIEW IF EXISTS public.v_catalog_by_sector       CASCADE;
DROP VIEW IF EXISTS public.v_merchant_health_latest  CASCADE;
DROP VIEW IF EXISTS public.v_platform_mrr            CASCADE;
DROP VIEW IF EXISTS public.v_feature_adoption_30d    CASCADE;

DO $$
DECLARE
    moves TEXT[][] := ARRAY[
        -- pos
        ['tenants','pos'], ['users','pos'], ['products','pos'], ['ingredients','pos'],
        ['product_recipes','pos'], ['transactions','pos'], ['transaction_items','pos'],
        ['inventory_logs','pos'], ['sync_receipts','pos'], ['merchant_activity_log','pos'],
        -- billing
        ['plans','billing'], ['subscriptions','billing'], ['invoices','billing'],
        ['webhook_logs','billing'],
        -- ai
        ['daily_merchant_insights','ai'], ['merchant_ai_credits','ai'],
        ['ai_query_logs','ai'], ['merchant_targets','ai'], ['batch_job_runs','ai'],
        -- internal
        ['internal_users','internal'], ['internal_access_log','internal'],
        ['feature_usage_events','internal'], ['merchant_health_logs','internal']
    ];
    m TEXT[];
BEGIN
    FOREACH m SLICE 1 IN ARRAY moves LOOP
        IF to_regclass('public.' || m[1]) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', m[1], m[2]);
            RAISE NOTICE '0009: public.% -> %.%', m[1], m[2], m[1];
        END IF;
    END LOOP;
END $$;

-- schema_migrations tetap di public: dimiliki alat migrasi, bukan service.


-- 3. FUNGSI -------------------------------------------------------------------
-- legacy_uuid dan compute_churn_risk dipakai lintas domain; biarkan di public
-- dan pastikan search_path setiap service menyertakannya.


-- 4. KONTRAK ------------------------------------------------------------------
--
-- Inilah satu-satunya yang boleh dibaca service lain.

-- 4a. Sumber angka omzet TUNGGAL untuk seluruh platform.
--
-- Sebelum pemecahan ini, AI Copilot dan admin panel sama-sama menulis SQL
-- omzetnya sendiri dan saya menjaganya tetap identik secara manual — satu kata
-- berbeda dan keduanya diam-diam melaporkan angka berbeda. Sekarang keduanya
-- WAJIB lewat view ini. Kesamaannya menjadi sifat struktural, bukan disiplin.
DROP VIEW IF EXISTS contract.merchant_revenue CASCADE;
CREATE VIEW contract.merchant_revenue AS
SELECT
    x.tenant_id                                       AS merchant_id,
    x.business_sector,
    x.business_id,
    x.id                                              AS transaction_id,
    x.total_amount,
    x.subtotal,
    x.discount_amount,
    x.tax_amount,
    x.service_charge_amount,
    x.payment_method,
    x.app_module,
    x.order_type,
    x.cashier_user_id,
    x.created_at
  FROM pos.transactions x
 WHERE x.payment_status <> 'CANCELLED';

COMMENT ON VIEW contract.merchant_revenue IS
    'Definisi tunggal "transaksi yang dihitung sebagai omzet". Semua service WAJIB memakai ini, tidak boleh menyaring payment_status sendiri.';


DROP VIEW IF EXISTS contract.merchant_directory CASCADE;
CREATE VIEW contract.merchant_directory AS
SELECT
    t.id                                              AS merchant_id,
    t.name                                            AS merchant_name,
    t.business_sector,
    t.external_ref                                    AS business_id,
    t.owner_user_ref,
    t.is_active,
    t.created_at                                      AS joined_at,
    COUNT(r.transaction_id)                           AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    MAX(r.created_at)                                 AS last_transaction_at,
    COUNT(DISTINCT r.business_id)                     AS business_unit_count,
    COUNT(DISTINCT r.cashier_user_id)                 AS distinct_cashiers
  FROM pos.tenants t
  LEFT JOIN contract.merchant_revenue r ON r.merchant_id = t.id
 GROUP BY t.id, t.name, t.business_sector, t.external_ref, t.owner_user_ref,
          t.is_active, t.created_at;


DROP VIEW IF EXISTS contract.sector_summary CASCADE;
CREATE VIEW contract.sector_summary AS
SELECT
    r.business_sector,
    COUNT(DISTINCT r.merchant_id)                     AS merchant_count,
    COUNT(DISTINCT r.business_id)                     AS business_unit_count,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    COALESCE(AVG(r.total_amount), 0)                  AS avg_basket,
    COALESCE(SUM(r.discount_amount), 0)               AS total_discount,
    MAX(r.created_at)                                 AS last_transaction_at
  FROM contract.merchant_revenue r
 GROUP BY r.business_sector;


DROP VIEW IF EXISTS contract.daily_sector_revenue CASCADE;
CREATE VIEW contract.daily_sector_revenue AS
SELECT
    r.business_sector,
    (r.created_at AT TIME ZONE 'Asia/Jakarta')::date  AS sales_date,
    COUNT(*)                                          AS transaction_count,
    COALESCE(SUM(r.total_amount), 0)                  AS gross_revenue,
    COUNT(DISTINCT r.merchant_id)                     AS active_merchants
  FROM contract.merchant_revenue r
 GROUP BY r.business_sector, (r.created_at AT TIME ZONE 'Asia/Jakarta')::date;


DROP VIEW IF EXISTS contract.product_sales CASCADE;
CREATE VIEW contract.product_sales AS
SELECT
    i.business_sector,
    r.merchant_id,
    t.name                                            AS merchant_name,
    i.product_id,
    i.product_name,
    i.category_name,
    (ARRAY_AGG(i.product_description ORDER BY r.created_at DESC)
        FILTER (WHERE i.product_description IS NOT NULL))[1] AS product_description,
    SUM(i.quantity)                                   AS units_sold,
    SUM(i.total_price)                                AS revenue,
    SUM(i.unit_cost * i.quantity)                     AS cogs,
    SUM(i.total_price) - SUM(i.unit_cost * i.quantity) AS gross_profit,
    COUNT(DISTINCT i.transaction_id)                  AS appeared_in_transactions,
    MAX(r.created_at)                                 AS last_sold_at
  FROM pos.transaction_items i
  JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
  JOIN pos.tenants t               ON t.id = r.merchant_id
 GROUP BY i.business_sector, r.merchant_id, t.name,
          i.product_id, i.product_name, i.category_name;


DROP VIEW IF EXISTS contract.catalog CASCADE;
CREATE VIEW contract.catalog AS
SELECT
    p.business_sector,
    p.tenant_id                                    AS merchant_id,
    t.name                                         AS merchant_name,
    p.id                                           AS product_id,
    p.name                                         AS product_name,
    p.sku, p.category_name, p.description, p.price, p.cost_price,
    CASE WHEN p.price > 0
         THEN ROUND(((p.price - p.cost_price) / p.price) * 100, 1)
         ELSE 0 END                                AS margin_pct,
    p.stock, p.min_stock_alert,
    p.stock <= p.min_stock_alert                   AS is_low_stock,
    p.is_available, p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM pos.products p
  JOIN pos.tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)   AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(r.created_at)  AS last_sold_at
          FROM pos.transaction_items i
          JOIN contract.merchant_revenue r ON r.transaction_id = i.transaction_id
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;


DROP VIEW IF EXISTS contract.activity_by_sector CASCADE;
CREATE VIEW contract.activity_by_sector AS
SELECT a.business_sector, a.app_module, a.event_type, a.severity,
       COUNT(*)                      AS event_count,
       COUNT(DISTINCT a.merchant_id) AS merchants_affected,
       MAX(a.occurred_at)            AS last_seen_at
  FROM pos.merchant_activity_log a
 GROUP BY a.business_sector, a.app_module, a.event_type, a.severity;


-- Log transaksi untuk admin panel. Nama merchant dan kasir ikut di-join di sini,
-- bukan di service pemanggil: kalau tidak, backoffice butuh akses ke pos.tenants
-- dan pos.users — dan seluruh batas ini runtuh demi dua kolom nama.
DROP VIEW IF EXISTS contract.transaction_log CASCADE;
CREATE VIEW contract.transaction_log AS
SELECT
    r.transaction_id                                  AS id,
    r.merchant_id,
    t.name                                            AS merchant_name,
    r.business_sector,
    r.business_id,
    r.app_module,
    r.order_type,
    r.payment_method,
    r.total_amount, r.subtotal, r.discount_amount,
    r.tax_amount, r.service_charge_amount,
    r.created_at,
    x.invoice_number,
    x.payment_status,
    u.name                                            AS cashier_name,
    (SELECT COUNT(*) FROM pos.transaction_items i WHERE i.transaction_id = r.transaction_id)
                                                      AS item_count
  FROM contract.merchant_revenue r
  JOIN pos.transactions x ON x.id = r.transaction_id
  JOIN pos.tenants      t ON t.id = r.merchant_id
  LEFT JOIN pos.users   u ON u.id = r.cashier_user_id;


DROP VIEW IF EXISTS contract.transaction_items CASCADE;
CREATE VIEW contract.transaction_items AS
SELECT i.transaction_id, i.product_name, i.product_description, i.category_name,
       i.business_sector, i.quantity, i.unit_price, i.unit_cost, i.total_price
  FROM pos.transaction_items i;


DROP VIEW IF EXISTS contract.activity_log CASCADE;
CREATE VIEW contract.activity_log AS
SELECT a.id, a.merchant_id, t.name AS merchant_name,
       a.business_sector, a.business_id, a.app_module, a.event_type, a.severity,
       a.actor_name, a.actor_role, a.transaction_id, a.amount_idr,
       a.summary, a.detail, a.occurred_at
  FROM pos.merchant_activity_log a
  JOIN pos.tenants t ON t.id = a.merchant_id;


-- Ringkasan stok untuk AI Copilot. Tanpa view ini, ai-service harus membaca
-- pos.products langsung hanya untuk menghitung berapa produk yang menipis.
DROP VIEW IF EXISTS contract.stock_status CASCADE;
CREATE VIEW contract.stock_status AS
SELECT p.tenant_id                                    AS merchant_id,
       p.business_sector,
       p.id                                           AS product_id,
       p.name                                         AS product_name,
       p.stock, p.min_stock_alert, p.is_available, p.catalog_synced_at,
       p.stock <= p.min_stock_alert                   AS is_low_stock
  FROM pos.products p;


-- Billing membuka status langganan; backoffice butuh untuk MRR dan churn.
DROP VIEW IF EXISTS contract.subscription_status CASCADE;
CREATE VIEW contract.subscription_status AS
SELECT s.tenant_id                    AS merchant_id,
       s.status,
       s.current_period_end,
       p.id                           AS plan_code,
       p.name                         AS plan_name,
       p.price_idr                    AS contract_mrr_idr,
       CASE WHEN s.status = 'ACTIVE' THEN p.price_idr ELSE 0 END AS recognised_mrr_idr
  FROM billing.subscriptions s
  JOIN billing.plans p ON p.id = s.plan_id;


DROP VIEW IF EXISTS contract.merchant_health_latest CASCADE;
CREATE VIEW contract.merchant_health_latest AS
SELECT DISTINCT ON (h.merchant_id)
       h.merchant_id, h.tenant_id, h.log_date, h.daily_revenue,
       h.days_since_last_txn, h.active_days_last_7, h.revenue_trend_pct,
       h.distinct_features_used, h.support_tickets_count,
       h.subscription_status, h.mrr_idr, h.contract_mrr_idr,
       h.churn_risk_score, h.churn_risk_reasons
  FROM internal.merchant_health_logs h
 ORDER BY h.merchant_id, h.log_date DESC;


-- 5. PERAN & HAK AKSES --------------------------------------------------------
--
-- Di sinilah batasnya berhenti menjadi kesepakatan dan menjadi aturan. Tiap
-- service login sebagai perannya sendiri; menyentuh tabel milik service lain
-- akan ditolak Postgres, bukan sekadar ditegur saat code review.

DO $$
DECLARE
    r RECORD;
    svc TEXT;
    services TEXT[] := ARRAY['pos','billing','ai','internal'];
BEGIN
    FOREACH svc IN ARRAY services LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || svc) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', 'svc_' || svc);
        END IF;

        -- Penuh atas skema sendiri.
        EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', svc, 'svc_' || svc);
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO %I', svc, 'svc_' || svc);
        EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO %I', svc, 'svc_' || svc);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO %I', svc, 'svc_' || svc);

        -- Baca saja atas kontrak bersama.
        EXECUTE format('GRANT USAGE ON SCHEMA contract TO %I', 'svc_' || svc);
        EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA contract TO %I', 'svc_' || svc);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA contract GRANT SELECT ON TABLES TO %I',
            'svc_' || svc);

        -- Fungsi bersama di public.
        EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', 'svc_' || svc);
    END LOOP;

    -- View kontrak harus membaca tabel dasarnya. View di PostgreSQL berjalan
    -- dengan hak PEMBUATNYA (security definer secara implisit), jadi pemberian
    -- di atas sudah cukup — tanpa itu setiap SELECT lintas domain gagal.

    -- Metabase / BI: baca kontrak saja, tidak pernah tabel mentah.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT USAGE ON SCHEMA contract TO bi_readonly;
        GRANT SELECT ON ALL TABLES IN SCHEMA contract TO bi_readonly;
        ALTER DEFAULT PRIVILEGES IN SCHEMA contract GRANT SELECT ON TABLES TO bi_readonly;
    END IF;
END $$;


-- 6. KOMPATIBILITAS ------------------------------------------------------------
--
-- Skrip batch dan alat lama masih menulis `SELECT ... FROM transactions` tanpa
-- prefiks skema. search_path di bawah menjaganya tetap jalan sampai semuanya
-- dipindahkan. Ini jembatan, bukan tujuan akhir — hapus setelah tidak ada lagi
-- pemanggil tanpa prefiks.

DO $$
BEGIN
    EXECUTE format(
        'ALTER DATABASE %I SET search_path TO pos, billing, ai, internal, contract, public',
        current_database()
    );
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE '0009: tidak bisa mengubah search_path database; setel per koneksi.';
END $$;
