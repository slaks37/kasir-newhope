-- Model-B integrity repair discovered by the canonical db:verify fixture.
-- Do not invent identities or rewrite history; fail closed on missing proof.
DO $$ DECLARE tab text; new_fk text; missing boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['feature_usage_events','merchant_health_logs'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM internal.%I r LEFT JOIN internal.merchants m ON m.id=r.merchant_id AND m.tenant_id=r.tenant_id WHERE m.id IS NULL)',tab) INTO STRICT missing;
  IF missing THEN RAISE EXCEPTION 'PLATFORM_HEALTH_IDENTITY_RECONCILIATION_REQUIRED: %',tab; END IF;
  new_fk:=tab||'_platform_merchant_tenant';
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=format('internal.%I',tab)::regclass AND conname=new_fk) THEN
   EXECUTE format('ALTER TABLE internal.%I ADD CONSTRAINT %I FOREIGN KEY(merchant_id,tenant_id) REFERENCES internal.merchants(id,tenant_id) ON DELETE CASCADE NOT VALID',tab,new_fk);
  END IF;
  EXECUTE format('ALTER TABLE internal.%I VALIDATE CONSTRAINT %I',tab,new_fk);
  EXECUTE format('ALTER TABLE internal.%I DROP CONSTRAINT IF EXISTS %I',tab,'fk_'||tab||'_merchant_id');
  EXECUTE format('ALTER TABLE internal.%I DROP CONSTRAINT IF EXISTS %I',tab,'fk_'||tab||'_tenant_id');
 END LOOP;
END $$;

-- Restore current BI contracts, not the dropped public aliases from 0004.
CREATE OR REPLACE VIEW contract.merchant_health_latest AS
SELECT DISTINCT ON(h.merchant_id)
 h.merchant_id,h.tenant_id,h.log_date,h.daily_revenue,h.days_since_last_txn,h.active_days_last_7,h.revenue_trend_pct,
 h.distinct_features_used,h.support_tickets_count,h.subscription_status,h.mrr_idr,h.contract_mrr_idr,h.churn_risk_score,h.churn_risk_reasons,
 CASE WHEN h.churn_risk_score>=0.70 THEN 'CRITICAL' WHEN h.churn_risk_score>=0.45 THEN 'AT_RISK' WHEN h.churn_risk_score>=0.25 THEN 'WATCH' ELSE 'HEALTHY' END AS health_band
FROM internal.merchant_health_logs h ORDER BY h.merchant_id,h.log_date DESC;
CREATE OR REPLACE VIEW contract.feature_adoption_30d WITH(security_invoker=true) AS
SELECT feature_key,count(DISTINCT merchant_id) AS merchants_using,count(*) AS events,max(occurred_at) AS last_used_at
FROM internal.feature_usage_events WHERE occurred_at>=current_date-interval '30 days' GROUP BY feature_key;
REVOKE ALL ON contract.merchant_health_latest FROM PUBLIC,anon,authenticated;
REVOKE ALL ON contract.feature_adoption_30d FROM PUBLIC,anon,authenticated,svc_pos,svc_ai,svc_billing;
GRANT SELECT ON contract.feature_adoption_30d TO svc_internal,bi_readonly;
