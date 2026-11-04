-- Uses the real hierarchy and canonical paid net revenue, with scoped joins.
INSERT INTO internal.merchant_health_logs(id,merchant_id,tenant_id,log_date,daily_revenue,daily_transaction_count,active_cashiers_count,login_status,last_activity_at,days_since_last_txn,active_days_last_7,revenue_trend_pct,feature_usage_payload,distinct_features_used,support_tickets_count,subscription_status,mrr_idr,contract_mrr_idr,churn_risk_score,churn_risk_reasons)
WITH agg AS (
 SELECT m.id AS merchant_id,m.tenant_id,max(r.created_at) AS last_txn_at,
 count(r.id) FILTER(WHERE (r.created_at AT TIME ZONE 'Asia/Jakarta')::date=(now() AT TIME ZONE 'Asia/Jakarta')::date) AS txn_today,
 coalesce(sum(r.total_amount) FILTER(WHERE (r.created_at AT TIME ZONE 'Asia/Jakarta')::date=(now() AT TIME ZONE 'Asia/Jakarta')::date),0) AS rev_today,
 count(DISTINCT x.cashier_user_id) FILTER(WHERE (r.created_at AT TIME ZONE 'Asia/Jakarta')::date=(now() AT TIME ZONE 'Asia/Jakarta')::date) AS cashiers_today,
 count(DISTINCT (r.created_at AT TIME ZONE 'Asia/Jakarta')::date) FILTER(WHERE r.created_at>=now()-interval '7 days') AS active_days_7,
 coalesce(sum(r.total_amount) FILTER(WHERE r.created_at>=now()-interval '7 days'),0) AS rev_7d,
 coalesce(sum(r.total_amount) FILTER(WHERE r.created_at<now()-interval '7 days' AND r.created_at>=now()-interval '30 days'),0) AS rev_prior
 FROM internal.merchants m LEFT JOIN contract.merchant_revenue r ON r.merchant_id=m.id AND r.tenant_id=m.tenant_id
 LEFT JOIN pos.transactions x ON x.id=r.id AND x.tenant_id=r.tenant_id AND x.merchant_id=r.merchant_id
 WHERE m.external_ref LIKE 'verify:merchant:%' GROUP BY m.id,m.tenant_id
), feat AS (
 SELECT merchant_id,count(*) AS n,jsonb_object_agg(feature_key,uses) AS payload FROM (
 SELECT merchant_id,feature_key,count(*) AS uses FROM internal.feature_usage_events WHERE occurred_at>=now()-interval '30 days' GROUP BY 1,2
 ) f GROUP BY merchant_id
), calc AS (
 SELECT a.*,coalesce(f.n,0) AS features,coalesce(f.payload,'{}') AS payload,s.status AS sub_status,coalesce(p.price_idr,0) AS plan_price,
 coalesce(extract(day FROM now()-a.last_txn_at)::int,999) AS days_since,
 CASE WHEN rev_prior>0 THEN ((rev_7d/7.0)-(rev_prior/23.0))/(rev_prior/23.0)*100 ELSE 0 END AS trend_pct
 FROM agg a LEFT JOIN LATERAL(SELECT * FROM billing.subscriptions bs WHERE bs.tenant_id=a.tenant_id ORDER BY created_at DESC,id LIMIT 1) s ON true
 LEFT JOIN billing.plans p ON p.id=s.plan_id LEFT JOIN feat f ON f.merchant_id=a.merchant_id
)
SELECT public.legacy_uuid('verify:health:'||merchant_id::text||':'||current_date::text),merchant_id,tenant_id,current_date,rev_today,txn_today,cashiers_today,(days_since<=1),last_txn_at,least(days_since,999),least(active_days_7,7),round(trend_pct,2),payload,features,0,sub_status,
 CASE WHEN sub_status='ACTIVE' THEN plan_price ELSE 0 END,CASE WHEN sub_status IS NOT NULL AND sub_status<>'CANCELED' THEN plan_price ELSE 0 END,
 public.compute_churn_risk(least(days_since,999)::int,least(active_days_7,7)::int,round(trend_pct,2)::numeric,sub_status::varchar,features::int,0::int),'[]'
FROM calc ON CONFLICT(merchant_id,log_date) DO UPDATE SET daily_revenue=excluded.daily_revenue,daily_transaction_count=excluded.daily_transaction_count,active_cashiers_count=excluded.active_cashiers_count,login_status=excluded.login_status,last_activity_at=excluded.last_activity_at,days_since_last_txn=excluded.days_since_last_txn,active_days_last_7=excluded.active_days_last_7,revenue_trend_pct=excluded.revenue_trend_pct,feature_usage_payload=excluded.feature_usage_payload,distinct_features_used=excluded.distinct_features_used,subscription_status=excluded.subscription_status,mrr_idr=excluded.mrr_idr,contract_mrr_idr=excluded.contract_mrr_idr,churn_risk_score=excluded.churn_risk_score,updated_at=now();
