-- =============================================================================
-- METABASE DASHBOARD CARDS — SaaS Provider Back-Office
-- =============================================================================
-- Paste each block into a Metabase native question against the REPLICA
-- connection using the `bi_readonly` role.
--
-- Every card here is verified to run by `npm run db:verify`, so a query that
-- errors cannot reach the dashboard unnoticed.
--
-- Suggested layout for admin.domainanda.com:
--   Row 1  cards 1-4   platform vitals
--   Row 2  card 5      at-risk merchant table (the CSM work queue)
--   Row 3  cards 6-7   adoption + assistant cost control
-- =============================================================================


-- CARD 1 — MRR berjalan -------------------------------------------------------
-- @display: scalar
SELECT COALESCE(SUM(mrr_idr), 0) AS "MRR Berjalan (Rp)"
  FROM v_merchant_health_latest;


-- CARD 2 — MRR berisiko -------------------------------------------------------
-- @display: scalar
-- Contract value, not recognised revenue: a PAST_DUE merchant is exactly the
-- money a CSM can still save. Using recognised MRR would show 0 here at the
-- precise moment the number is supposed to trigger action.
SELECT COALESCE(SUM(contract_mrr_idr), 0) AS "MRR Berisiko (Rp)"
  FROM v_merchant_health_latest
 WHERE churn_risk_score >= 0.45;


-- CARD 3 — Merchant aktif -----------------------------------------------------
-- @display: scalar
SELECT COUNT(*) AS "Merchant Aktif"
  FROM v_merchant_health_latest
 WHERE subscription_status = 'ACTIVE';


-- CARD 4 — Sebaran kesehatan --------------------------------------------------
-- @display: bar
SELECT health_band AS "Status",
       COUNT(*)    AS "Jumlah Merchant"
  FROM v_merchant_health_latest
 GROUP BY health_band
 ORDER BY CASE health_band
            WHEN 'CRITICAL' THEN 1 WHEN 'AT_RISK' THEN 2
            WHEN 'WATCH'    THEN 3 ELSE 4 END;


-- CARD 5 — Antrean kerja CSM --------------------------------------------------
-- @display: table
-- The one card that actually gets used every morning. Ordered so the most
-- valuable saveable account is at the top, not merely the sickest one.
SELECT h.merchant_id                          AS "Merchant ID",
       t.name                                 AS "Nama Usaha",
       h.health_band                          AS "Status",
       h.churn_risk_score                     AS "Skor Risiko",
       h.days_since_last_txn                  AS "Hari Tanpa Transaksi",
       h.revenue_trend_pct                    AS "Tren Omzet (%)",
       h.subscription_status                  AS "Langganan",
       h.contract_mrr_idr                     AS "Nilai Kontrak (Rp)",
       h.distinct_features_used               AS "Fitur Dipakai"
  FROM v_merchant_health_latest h
  LEFT JOIN tenants t ON t.id = h.merchant_id
 WHERE h.churn_risk_score >= 0.45
 ORDER BY h.contract_mrr_idr DESC, h.churn_risk_score DESC;


-- CARD 6 — Adopsi fitur 30 hari -----------------------------------------------
-- @display: bar
SELECT feature_key      AS "Fitur",
       merchants_using  AS "Merchant Memakai",
       events           AS "Total Pemakaian"
  FROM v_feature_adoption_30d
 ORDER BY merchants_using DESC
 LIMIT 15;


-- CARD 7 — Cost control Smart Assistant ---------------------------------------
-- @display: table
-- The number that protects the margin on a flat-rate plan. If the zero-cost
-- rate drops below 90%, the intent parser is missing vocabulary — that is a
-- product bug to fix, not a reason to buy more credits.
SELECT DATE(asked_at)                                                   AS "Tanggal",
       COUNT(*)                                                         AS "Total Pertanyaan",
       COUNT(*) FILTER (WHERE credits_charged = 0)                      AS "Gratis",
       COALESCE(SUM(credits_charged), 0)                                AS "Credit Terpakai",
       ROUND(100.0 * COUNT(*) FILTER (WHERE credits_charged = 0)
             / NULLIF(COUNT(*), 0), 1)                                  AS "Zero-Cost Rate (%)"
  FROM ai_query_logs
 WHERE asked_at >= CURRENT_DATE - INTERVAL '30 days'
 GROUP BY 1
 ORDER BY 1 DESC;


-- CARD 8 — Jejak akses internal (khusus SUPERADMIN) ---------------------------
-- @display: table
-- Do NOT publish this card on a dashboard shared with Growth or Support.
-- Restrict the Metabase collection to the platform-admin group.
SELECT l.accessed_at        AS "Waktu",
       u.email              AS "Staf Internal",
       l.internal_role      AS "Peran",
       l.action             AS "Aksi",
       l.merchant_id        AS "Merchant",
       l.justification      AS "Alasan"
  FROM internal_access_log l
  JOIN internal_users u ON u.id = l.internal_user_id
 ORDER BY l.accessed_at DESC
 LIMIT 200;
