-- =============================================================================
-- 0025_restore_contract_catalog.sql
--
-- Perbaikan hilangnya contract.catalog akibat DROP COLUMN CASCADE di 0024.
-- View ini disusun ulang agar murni berorientasi pada `pos.inventory_items`.
-- =============================================================================

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
    COALESCE(inv.total_stock, 0)                   AS stock,
    COALESCE(inv.total_min_alert, 0)               AS min_stock_alert,
    COALESCE(inv.total_stock, 0) <= COALESCE(inv.total_min_alert, 0) AS is_low_stock,
    p.is_available, p.catalog_synced_at,
    COALESCE(s.units_sold, 0)                      AS units_sold,
    COALESCE(s.revenue, 0)                         AS revenue,
    s.last_sold_at
  FROM pos.products p
  JOIN internal.tenants t ON t.id = p.tenant_id
  LEFT JOIN (
        -- Dapatkan inventory_item_id dari tabel directory
        SELECT 
               i.product_id,
               SUM(b.current_stock) AS total_stock,
               SUM(b.min_stock_alert) AS total_min_alert
          FROM pos.inventory_balances b
          JOIN pos.inventory_items i ON i.id = b.inventory_item_id
         WHERE i.product_id IS NOT NULL
         GROUP BY i.product_id
       ) inv ON inv.product_id = p.id
  LEFT JOIN (
        SELECT i.product_id,
               SUM(i.quantity)    AS units_sold,
               SUM(i.total_price) AS revenue,
               MAX(r.created_at)  AS last_sold_at
          FROM pos.transaction_items i
          JOIN contract.merchant_revenue r ON r.id = i.transaction_id
         GROUP BY i.product_id
       ) s ON s.product_id = p.id;

CREATE OR REPLACE VIEW public.v_pos_products AS
  SELECT * FROM contract.catalog;
