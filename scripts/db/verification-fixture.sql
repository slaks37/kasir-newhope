-- Disposable verification fixture only; never seed an application database.
INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,features) VALUES
 ('plan-free','Free Trial 45 Hari',1,'MONTHLY',0,'[]'),
 ('plan-plus-monthly','Tier Plus',2,'MONTHLY',99000,'[]'),
 ('plan-pro-monthly','Tier Pro',3,'MONTHLY',299000,'[]') ON CONFLICT(id) DO NOTHING;
INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref,external_ref,created_at)
SELECT public.legacy_uuid('verify:tenant:'||key),name,sector,'verify-owner-'||key,'verify:tenant:'||key,now()-age
FROM (VALUES ('warung','Verification Warung','FNB',interval '120 days'),('kopi','Verification Kopi','FNB',interval '90 days'),('laundry','Verification Laundry','LAUNDRY',interval '200 days')) f(key,name,sector,age)
ON CONFLICT(id) DO NOTHING;
-- Preserve legacy FK dependencies using the same tenant identity, not a second business.
INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref)
SELECT id,name,business_sector,owner_user_ref FROM internal.tenants WHERE external_ref LIKE 'verify:tenant:%' ON CONFLICT(id) DO NOTHING;
INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref)
SELECT public.legacy_uuid('verify:merchant:'||split_part(external_ref,':',3)),id,name,business_sector,'verify:merchant:'||split_part(external_ref,':',3)
FROM internal.tenants WHERE external_ref LIKE 'verify:tenant:%' ON CONFLICT(id) DO NOTHING;
INSERT INTO internal.outlets(id,tenant_id,merchant_id,name)
SELECT public.legacy_uuid('verify:outlet:'||split_part(external_ref,':',3)),tenant_id,id,'Verification outlet'
FROM internal.merchants WHERE external_ref LIKE 'verify:merchant:%' ON CONFLICT(id) DO NOTHING;
INSERT INTO pos.users(id,tenant_id,name,username,role,pin)
SELECT public.legacy_uuid('verify:cashier:'||split_part(external_ref,':',3)),id,'Verification cashier','verify-'||split_part(external_ref,':',3),'ADMIN','fixture-not-an-auth-session'
FROM internal.tenants WHERE external_ref LIKE 'verify:tenant:%' ON CONFLICT(id) DO NOTHING;
INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end)
SELECT public.legacy_uuid('verify:subscription:'||key),public.legacy_uuid('verify:tenant:'||key),plan,status,now()-started,now()+ending
FROM (VALUES ('warung','plan-pro-monthly','ACTIVE',interval '10 days',interval '20 days'),('kopi','plan-pro-monthly','PAST_DUE',interval '40 days',interval '-10 days'),('laundry','plan-plus-monthly','EXPIRED',interval '70 days',interval '-40 days')) f(key,plan,status,started,ending)
ON CONFLICT(id) DO NOTHING;
INSERT INTO pos.transactions(id,tenant_id,merchant_id,outlet_id,cashier_user_id,invoice_number,client_txn_id,subtotal,total_amount,payment_method,payment_status,order_status,business_sector,business_id,created_at)
SELECT public.legacy_uuid('verify:sale:'||key||':'||g),public.legacy_uuid('verify:tenant:'||key),public.legacy_uuid('verify:merchant:'||key),public.legacy_uuid('verify:outlet:'||key),public.legacy_uuid('verify:cashier:'||key),
 'INV-VERIFY-'||key||'-'||g,'verify:sale:'||key||':'||g,amount,amount,'CASH','PAID','COMPLETED',sector,'verify:merchant:'||key,now()-idle-(g||' hours')::interval
FROM (VALUES ('warung','FNB',240,150000,interval '0 days'),('kopi','FNB',60,45000,interval '9 days'),('laundry','LAUNDRY',12,25000,interval '25 days')) f(key,sector,n,amount,idle)
CROSS JOIN LATERAL generate_series(1,f.n) g ON CONFLICT(id) DO NOTHING;
INSERT INTO pos.payments(id,tenant_id,merchant_id,outlet_id,transaction_id,payment_method,payment_status,amount,verification_origin,paid_at,created_at)
SELECT public.legacy_uuid('verify:payment:'||client_txn_id),tenant_id,merchant_id,outlet_id,id,'CASH','PAID',total_amount,'CASHIER_RECORDED',created_at,created_at
FROM pos.transactions WHERE client_txn_id LIKE 'verify:sale:%' ON CONFLICT(id) DO NOTHING;
INSERT INTO internal.feature_usage_events(merchant_id,tenant_id,business_id,feature_key,occurred_at)
SELECT public.legacy_uuid('verify:merchant:'||key),public.legacy_uuid('verify:tenant:'||key),'verify:merchant:'||key,feature,now()-idle
FROM (VALUES ('warung',interval '1 hour',ARRAY['pos.checkout','ai.digest','ai.stock_critical','reports.margin','inventory.restock','crm.loyalty']),('kopi',interval '9 days',ARRAY['pos.checkout','ai.digest'])) f(key,idle,features)
CROSS JOIN LATERAL unnest(features) feature WHERE NOT EXISTS(SELECT 1 FROM internal.feature_usage_events e WHERE e.merchant_id=public.legacy_uuid('verify:merchant:'||key) AND e.feature_key=feature);
