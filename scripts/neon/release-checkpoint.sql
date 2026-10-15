-- READ ONLY. One statement/MVCC snapshot; no customer rows, identifiers or tokens returned.
-- Local device outboxes and the provider's external queue are NOT observable here.
WITH relations AS MATERIALIZED (
 SELECT n.nspname schema,c.relname name,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=ANY(ARRAY['public','pos','internal','billing','ai','contract','mcp_private','blog_mcp_private']) AND c.relkind='r'
), fingerprints AS MATERIALIZED (
 SELECT r.schema,r.name,(SELECT v::jsonb FROM XMLTABLE('/row' PASSING query_to_xml(format(
 $q$SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(value::text,E'\n' ORDER BY value::text COLLATE "C"),'')))::text v FROM (SELECT (CASE WHEN %L='internal.tenant_identity_recovery' THEN jsonb_set(to_jsonb(t),'{snapshot,memberships}',(SELECT coalesce(jsonb_agg(member-'pin' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(coalesce(to_jsonb(t)#>'{snapshot,memberships}','[]'::jsonb)) WITH ORDINALITY a(member,ord))) ELSE to_jsonb(t) END - ARRAY['password_hash','pin','pin_hash','token_hash']) value FROM %I.%I t WHERE %s) x$q$,
 r.schema||'.'||r.name,r.schema,r.name,CASE WHEN r.schema IN('mcp_private','blog_mcp_private') AND r.name='credentials' OR r.schema='pos' AND r.name IN('financial_approval_grants','financial_pin_credentials') THEN 'false' ELSE 'true' END),false,true,'') COLUMNS v text PATH 'v')) fingerprint FROM relations r
)
SELECT jsonb_build_object('format','newhope-release-checkpoint-v1','sourceProject','fqxrhumsgigcgjtlbfuo','capturedAt',statement_timestamp(),'snapshot',pg_current_snapshot()::text,'sourceFrozen',false,
 'fingerprints',(SELECT jsonb_agg(jsonb_build_object('schema',schema,'name',name,'rows',(fingerprint->>'rows')::int,'digest',fingerprint->>'digest') ORDER BY schema,name) FROM fingerprints),
 'finance',jsonb_build_object(
 'transactions',(SELECT jsonb_build_object('rows',count(*),'amount',coalesce(sum(total_amount),0)::text,'latestAt',max(created_at),'missingClientKeys',count(*) FILTER(WHERE coalesce(client_txn_id,'')='')) FROM pos.transactions),
 'payments',(SELECT jsonb_build_object('rows',count(*),'amount',coalesce(sum(amount),0)::text,'latestAt',max(created_at)) FROM pos.payments),
 'cashLedger',(SELECT jsonb_build_object('rows',count(*),'amount',coalesce(sum(amount),0)::text) FROM pos.cash_ledger),
 'refunds',(SELECT jsonb_build_object('rows',count(*),'amount',coalesce(sum(amount),0)::text) FROM pos.transaction_refunds),
 'subscriptions',(SELECT jsonb_build_object('rows',count(*),'recurringAmount',coalesce(sum(recurring_amount),0)::text) FROM billing.subscriptions),
 'duplicateTransactionClientKeys',(SELECT count(*) FROM (SELECT tenant_id,client_txn_id FROM pos.transactions WHERE coalesce(client_txn_id,'')<>'' GROUP BY 1,2 HAVING count(*)>1) x),
 'duplicatePaymentClientKeys',(SELECT count(*) FROM (SELECT transaction_id,client_payment_id FROM pos.payments WHERE coalesce(client_payment_id,'')<>'' GROUP BY 1,2 HAVING count(*)>1) x)),
 'dokuDatabaseCheckpoint',jsonb_build_object(
 'webhookLogs',(SELECT jsonb_build_object('rows',count(*),'latestProcessedAt',max(processed_at),'unprocessed',count(*) FILTER(WHERE processed_at IS NULL)) FROM billing.webhook_logs),
 'billingEvents',(SELECT jsonb_build_object('rows',count(*),'latestAt',max(created_at)) FROM billing.payment_events),
 'posReconciliationEvents',(SELECT jsonb_build_object('rows',count(*),'latestAt',max(received_at)) FROM pos.payment_reconciliation_events),
 'duplicateWebhookIds',(SELECT count(*) FROM (SELECT event_id FROM billing.webhook_logs GROUP BY event_id HAVING count(*)>1) x),
 'duplicateBillingEventKeys',(SELECT count(*) FROM (SELECT event_key FROM billing.payment_events GROUP BY event_key HAVING count(*)>1) x),
 'duplicatePosEventKeys',(SELECT count(*) FROM (SELECT tenant_id,provider_event_ref FROM pos.payment_reconciliation_events GROUP BY 1,2 HAVING count(*)>1) x),
 'externalProviderQueueVerified',false),
 'clientOfflineQueuesVerified',false,
 'cutoverAllowed',false) checkpoint;
