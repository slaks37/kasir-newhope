// Isolated real PostgreSQL engine. No .env, cloud DB, emails, or paid requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import { SAAS_PLANS, DAY_MS, addBillingPeriod } from '../../src/config/saasPlans';
import { billingQuote, subscriptionAccess, lifecycleStage } from '../../src/config/subscriptionPolicy';
import { ensureSubscription, subscriptionStatus, reconcilePayment, createQuote, assertTenantWritable, assertOutletCapacity } from '../../services/billing/engine';
import { pastikanPaket } from '../../services/billing/store';
import { registerAdminRoutes } from '../../src/server/adminRoutes';
import { registerBillingRoutes } from '../../services/billing/routes';
import { registerSyncRoutes } from '../../services/pos/sync';
import type { Db } from '../../services/shared/db';
import { generateDigest, generateSignature } from '../../api/_doku';
import { mergeServerOutlets } from '../../src/lib/sync/outlets';
import { INITIAL_BRANCHES } from '../../src/data/initialData';

async function main(){
 const pg=new PGlite();
 let failAudit=false;
 const wrap=(runner:any):Db=>({query:async(sql,params)=>{if(failAudit && sql.includes('INSERT INTO internal.support_actions'))throw new Error('TEST_AUDIT_UNAVAILABLE');const r=await runner.query(sql,params);return{rows:r.rows,rowCount:r.rows.length || r.affectedRows || 0};},exec:async(sql)=>{await runner.exec(sql);},tx:async(fn)=>pg.transaction(t=>fn(wrap(t))),close:()=>pg.close()});
 const db=wrap(pg);
 await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
 const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
 for(const file of files){try{await pg.exec(fs.readFileSync(file,'utf8'));}catch(e){throw new Error('Migration '+file+': '+(e as Error).message);}}
 console.log('PASS: all migrations apply to isolated PGlite');
 // Simulate exposed schema usage; sensitive new tables/views must remain denied.
 await pg.exec('GRANT USAGE ON SCHEMA contract,billing,internal TO anon,authenticated;');
 for(const role of ['anon','authenticated']) for(const table of ['billing.payment_events','internal.support_actions','contract.subscription_operations','contract.admin_activity_log']) {
  await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);await c.query('SELECT * FROM '+table);}),/permission denied/);
 }
 const outletRow={id:randomUUID(),name:'Real outlet',address:'Address',latitude:1,longitude:2,radius_meters:100,business_sector:'FNB',is_active:true};
 assert.equal(mergeServerOutlets(INITIAL_BRANCHES,[outletRow]).length,1);
 assert.equal(mergeServerOutlets([{...INITIAL_BRANCHES[0],name:'My offline draft'}],[outletRow]).length,2);
 assert.equal(mergeServerOutlets(mergeServerOutlets([], [outletRow]),[outletRow]).length,1);
 await pastikanPaket(db,SAAS_PLANS);
 const tenant=randomUUID(),other=randomUUID(),merchant=randomUUID();
 await db.query(`INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Test Merchant','owner-one'),($2,'Other Tenant','owner-two')`,[tenant,other]);
 await db.query(`INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Test Brand','FNB','test-brand')`,[merchant,tenant]);
 const sub=await ensureSubscription(db,tenant),again=await ensureSubscription(db,tenant);
 assert.equal(sub.id,again.id);assert.equal(new Date(sub.current_period_end).getTime()-new Date(sub.current_period_start).getTime(),45*DAY_MS);
 assert.equal((await subscriptionStatus(db,tenant)).daysLeft,45);
 const epoch=Date.parse('2026-01-01T00:00:00Z'),s={status:'TRIAL',currentPeriodEnd:new Date(epoch+45*DAY_MS).toISOString()};
 assert.equal(subscriptionAccess(s,epoch+45*DAY_MS-1).accessMode,'FULL');
 assert.equal(subscriptionAccess(s,epoch+45*DAY_MS).accessMode,'READ_ONLY');
 assert.equal(subscriptionAccess(s,epoch+59*DAY_MS).accessMode,'RESTRICTED');
 assert.equal(subscriptionAccess({...s,status:'SUSPENDED'},epoch).accessMode,'RESTRICTED');
 assert.equal(lifecycleStage(3),'ACTIVATION');assert.equal(lifecycleStage(43),'FINAL_REMINDER');
 assert.equal(addBillingPeriod(new Date('2026-01-31T18:30:00Z'),'MONTHLY').toISOString(),'2026-02-28T18:30:00.000Z');
 assert.equal(addBillingPeriod(new Date('2024-02-29T00:00:00Z'),'YEARLY').toISOString(),'2025-02-28T00:00:00.000Z');
 for(const [plan,monthly,yearly] of [['plan-plus-monthly',99000,950400],['plan-pro-monthly',299000,2978040]] as const){
  assert.equal(billingQuote(sub,{planId:plan,billingCycle:'MONTHLY',extraOutlets:0},0).amount,monthly);
  assert.equal(billingQuote(sub,{planId:plan,billingCycle:'YEARLY',extraOutlets:0},0).amount,yearly);
  assert.equal(billingQuote(sub,{planId:plan,billingCycle:'YEARLY',extraOutlets:1},0).amount,yearly+760320);
 }
 assert.throws(()=>billingQuote(sub,{planId:'wrong'},0),/INVALID_PAID_PLAN/);
 assert.throws(()=>billingQuote(sub,{planId:'plan-free'},0),/INVALID_PAID_PLAN/);
 assert.throws(()=>billingQuote(sub,{planId:'plan-plus-monthly',extraOutlets:-1},0),/INVALID_EXTRA/);
 assert.throws(()=>billingQuote(sub,{planId:'plan-plus-monthly'},3),/OUTLET_LIMIT/);
 console.log('PASS: persistent 45-day trial, exact 45/59-day boundaries, lifecycle, prices and outlet quotes');
 for(let n=0;n<2;n++){
  await db.tx(async c=>{await assertOutletCapacity(c,tenant);await c.query('INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,$4)',[randomUUID(),tenant,merchant,'Outlet '+n]);});
 }
 await assert.rejects(()=>db.tx(c=>assertOutletCapacity(c,tenant)),/OUTLET_LIMIT_REACHED/);
 await db.query("UPDATE billing.subscriptions SET current_period_end=now()-interval '1 day',grace_period_end=now()+interval '13 days' WHERE id=$1",[sub.id]);
 await assert.rejects(()=>assertTenantWritable(db,tenant),/SUBSCRIPTION_READ_ONLY/);
 await db.query('UPDATE billing.subscriptions SET current_period_end=$2,grace_period_end=$3 WHERE id=$1',[sub.id,sub.current_period_end,sub.grace_period_end]);
 const q=await createQuote(db,tenant,{planId:'plan-pro-monthly',billingCycle:'YEARLY',extraOutlets:1});
 const invoice=randomUUID(),number='TEST-'+invoice;
 await db.query(`INSERT INTO billing.invoices(id,tenant_id,subscription_id,invoice_number,amount,currency,due_date,quote) VALUES($1,$2,$3,$4,$5,'IDR',now()+interval '1 day',$6)`,[invoice,tenant,sub.id,number,q.amount,JSON.stringify(q)]);
 const notice={eventKey:'payment-1',invoiceNumber:number,reference:'gateway-1',amount:q.amount,currency:'IDR',success:true};
 assert.equal((await reconcilePayment(db,{...notice,eventKey:'bad-amount',amount:1})).outcome,'REVIEW');
 assert.equal((await ensureSubscription(db,tenant)).status,'TRIAL');
 assert.equal((await reconcilePayment(db,notice)).outcome,'APPLIED');
 const paid=await ensureSubscription(db,tenant);
 assert.equal(paid.plan_id,'plan-pro-monthly');assert.equal(paid.billing_cycle,'YEARLY');assert.equal(paid.extra_outlets,1);
 assert.equal(new Date(paid.current_period_end).toISOString(),q.periodEnd);
 assert.equal((await reconcilePayment(db,notice)).outcome,'DUPLICATE');
 assert.equal((await reconcilePayment(db,{...notice,eventKey:'retry-new-id'})).outcome,'DUPLICATE');
 assert.equal(new Date((await ensureSubscription(db,tenant)).current_period_end).toISOString(),q.periodEnd);
 const stale=randomUUID();await db.query(`INSERT INTO billing.invoices(id,tenant_id,subscription_id,invoice_number,amount,due_date,quote) VALUES($1,$2,$3,'STALE',$4,now(),$5)`,[stale,tenant,sub.id,q.amount,JSON.stringify(q)]);
 assert.equal((await reconcilePayment(db,{...notice,eventKey:'stale',invoiceNumber:'STALE'})).reason,'STALE_SUBSCRIPTION_REVISION');
 assert.equal((await ensureSubscription(db,other)).status,'TRIAL');
 console.log('PASS: outlet cap, server read-only, amount mismatch, annual activation + add-on, duplicate and stale payment, tenant isolation');
 const admin=randomUUID();await db.query(`INSERT INTO internal.internal_users(id,email,full_name,role,sso_subject) VALUES($1,'operator@test.invalid','Operator','ROLE_SUPERADMIN','admin-sub')`,[admin]);
 await db.query(`INSERT INTO internal.internal_users(id,email,full_name,role,sso_subject) VALUES($1,'support@test.invalid','Support','ROLE_INTERNAL_SUPPORT','support-sub')`,[randomUUID()]);
 const app=express();app.use(express.json({verify:(req:any,_res,buf)=>{req.rawBody=buf;}}));
 registerAdminRoutes(app,async()=>db,async req=>req.headers.authorization==='Bearer test-admin'?{subject:'admin-sub'}:req.headers.authorization==='Bearer merchant'?{subject:'owner-one'}:req.headers.authorization==='Bearer test-support'?{subject:'support-sub'}:null);
 let checkoutCalls=0;
 registerBillingRoutes(app,db,true,async payload=>{checkoutCalls++;return{paymentUrl:'https://checkout.test.invalid/'+payload.order.invoice_number,rawResponse:{}};});
 registerSyncRoutes(app,db);
 app.use((err:any,_req:any,res:any,_next:any)=>res.status(500).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url='http://127.0.0.1:'+(server.address() as any).port;
 try{
  assert.equal((await fetch(url+'/api/admin/me',{headers:{'x-internal-user':'operator@test.invalid'}})).status,401);
  assert.equal((await fetch(url+'/api/admin/me',{headers:{authorization:'Bearer merchant'}})).status,403);
  assert.equal((await fetch(url+'/api/admin/me',{headers:{authorization:'Bearer test-admin'}})).status,200);
  for(const path of ['overview','merchants','merchants/'+merchant,'transactions','products','catalog','activity','activity/breakdown','access-audit','staff-commissions']) {
   const response=await fetch(url+'/api/admin/'+path,{headers:{authorization:'Bearer test-admin'}});
   assert.equal(response.status,200,path+': '+await response.text());
  }
  const report=await fetch(url+'/api/admin/subscriptions',{headers:{authorization:'Bearer test-admin'}});assert.equal(report.status,200);assert.equal((await report.json()).summary.active,1);
  const sync=await fetch(url+'/api/v1/sync/catalog',{method:'POST',headers:{'x-auth-sub':'owner-three','content-type':'application/json'},body:JSON.stringify({businessId:'owner-three_FNB',sector:'FNB',storeName:'Fresh Merchant',products:[{id:'product-test',name:'Test Product',price:20000,costPrice:5000,unit:'pcs'}]})});
  assert.equal(sync.status,200,'real catalog sync: '+await sync.text());
  const product=(await db.query("SELECT id,tenant_id,merchant_id,outlet_id FROM pos.products WHERE external_ref='product-test'")).rows[0];
  const stockItem=randomUUID(),location=randomUUID();
  await db.query('INSERT INTO pos.inventory_items(id,tenant_id,merchant_id,item_name) VALUES($1,$2,$3,$4)',[stockItem,product.tenant_id,product.merchant_id,'Test stock']);
  await db.query('INSERT INTO pos.inventory_locations(id,tenant_id,merchant_id,outlet_id) VALUES($1,$2,$3,$4)',[location,product.tenant_id,product.merchant_id,product.outlet_id]);
  await db.query('INSERT INTO pos.inventory_balances(tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,current_stock) VALUES($1,$2,$3,$4,$5,10)',[product.tenant_id,product.merchant_id,product.outlet_id,location,stockItem]);
  await db.query('UPDATE pos.products SET inventory_item_id=$2 WHERE id=$1',[product.id,stockItem]);
  const saleBody={businessId:'owner-three_FNB',sector:'FNB',storeName:'Fresh Merchant',idempotencyKey:'real-sale-batch',transactions:[{clientTxnId:'real-sale-1',subtotal:20000,totalAmount:20000,paymentMethod:'CASH',paymentStatus:'PAID',createdAt:new Date().toISOString(),items:[{productRef:'product-test',productName:'Test Product',unitPrice:20000,unitCost:5000,quantity:1}]}]};
  const sendSale=()=>fetch(url+'/api/v1/sync/transactions',{method:'POST',headers:{'x-auth-sub':'owner-three','content-type':'application/json'},body:JSON.stringify(saleBody)});
  const sale=await sendSale();assert.equal(sale.status,200,'sale sync: '+await sale.clone().text());assert.equal((await sale.json()).accepted,1);
  const saleReplay=await sendSale();assert.equal(saleReplay.status,200);assert.equal((await saleReplay.json()).replayed,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pos.transactions WHERE client_txn_id='real-sale-1'")).rows[0].n,1);
  assert.equal(Number((await db.query('SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id=$1',[stockItem])).rows[0].current_stock),9);
  const totals=await fetch(url+'/api/admin/overview',{headers:{authorization:'Bearer test-admin'}});
  const overview=await totals.json();assert.equal(Number(overview.totals.gross_profit),15000,JSON.stringify(overview));
  assert.equal(Number(overview.totals.gross_revenue),20000);
  console.log('PASS: real POS sale reaches monitoring with correct revenue/profit; repeat sync does not duplicate it; outlet hydration preserves drafts');
  const log=await fetch(url+'/api/v1/sync/activity',{method:'POST',headers:{'x-auth-sub':'owner-three','content-type':'application/json'},body:JSON.stringify({businessId:'owner-three_FNB',eventType:'TEST_OPERATION',summary:'Real activity round trip',appModule:'POS'})});
  assert.equal(log.status,200,'activity sync: '+await log.text());
  const activity=await fetch(url+'/api/admin/activity',{headers:{authorization:'Bearer test-admin'}});assert.ok((await activity.json()).rows.some((r:any)=>r.event_type==='TEST_OPERATION'));
  const response=await fetch(url+'/api/v1/subscription/status?tenantId='+other,{headers:{'x-auth-sub':'owner-one'}});assert.equal(response.status,200);assert.equal((await response.json()).subscription.tenantId,tenant);
  const outletId=(await db.query('SELECT id FROM internal.outlets WHERE tenant_id=$1 LIMIT 1',[tenant])).rows[0].id;
  const stolenOutlet=await fetch(url+'/api/v1/subscription/outlets',{method:'POST',headers:{'x-auth-sub':'owner-three','content-type':'application/json'},body:JSON.stringify({id:outletId,name:'Cannot take another tenant outlet',businessSector:'FNB'})});
  assert.equal(stolenOutlet.status,403);
  const foreignReplay=await fetch(url+'/api/v1/sync/transactions',{method:'POST',headers:{'x-auth-sub':'owner-one','content-type':'application/json'},body:JSON.stringify({...saleBody,businessId:'test-brand'})});
  assert.equal(foreignReplay.status,409);
  assert.equal((await fetch(url+'/api/v1/subscription/simulate-payment',{method:'POST'})).status,403);
  assert.equal((await fetch(url+'/api/v1/webhooks/doku',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  const note=await fetch(url+'/api/admin/tenants/'+tenant+'/support',{method:'POST',headers:{authorization:'Bearer test-admin','content-type':'application/json'},body:JSON.stringify({action:'NOTE',reason:'Test support ticket 123'})});assert.equal(note.status,200,await note.text());
  assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.support_actions')).rows[0].n,1);
  const payments=await fetch(url+'/api/admin/payments',{headers:{authorization:'Bearer test-admin'}});assert.equal(payments.status,200);
  const act=async(action:string,extra:any={},who='test-admin',target=other)=>fetch(url+'/api/admin/tenants/'+target+'/support',{method:'POST',headers:{authorization:'Bearer '+who,'content-type':'application/json'},body:JSON.stringify({action,reason:'Test ticket for regression',...extra})});
  assert.equal((await act('GRANT_PLAN',{planId:'plan-plus-monthly'},'test-support')).status,403);
  assert.equal((await act('NOTE',{},'test-support')).status,200);
  assert.equal((await fetch(url+'/api/admin/transactions',{headers:{authorization:'Bearer test-support'}})).status,400);
  const beforeExtend=await ensureSubscription(db,other);
  failAudit=true;assert.equal((await act('EXTEND_TRIAL',{days:7})).status,500);failAudit=false;
  assert.equal(new Date((await ensureSubscription(db,other)).current_period_end).toISOString(),new Date(beforeExtend.current_period_end).toISOString());
  assert.equal((await act('EXTEND_TRIAL',{days:7})).status,200);
  assert.equal((await act('GRANT_PLAN',{planId:'plan-plus-monthly',billingCycle:'MONTHLY',extraOutlets:2})).status,200);
  assert.equal((await ensureSubscription(db,other)).extra_outlets,2);
  // Dummy gateway settings are scoped to this test process. No network call to DOKU.
  process.env.DOKU_CLIENT_ID='test-client';process.env.DOKU_SECRET_KEY='test-secret';process.env.PUBLIC_APP_URL='https://test.invalid';
  const checkoutBody={planId:'plan-plus-monthly',billingCycle:'YEARLY',extraOutlets:2,requestKey:randomUUID()};
  const checkout=()=>fetch(url+'/api/v1/subscription/checkout',{method:'POST',headers:{'x-auth-sub':'owner-two','content-type':'application/json'},body:JSON.stringify(checkoutBody)});
  const first=await checkout();assert.equal(first.status,200,await first.clone().text());const invoiceData=await first.json();
  const replay=await checkout();assert.equal(replay.status,200);assert.equal((await replay.json()).invoice.id,invoiceData.invoice.id);assert.equal(checkoutCalls,1);
  const raw=JSON.stringify({order:{invoice_number:invoiceData.invoice.invoiceNumber,amount:invoiceData.invoice.amount,currency:'IDR'},transaction:{status:'SUCCESS'}});
  const timestamp=new Date().toISOString();
  const headers={'content-type':'application/json','client-id':'test-client','request-id':'signed-event','request-timestamp':timestamp,
   signature:generateSignature('test-client','signed-event',timestamp,'/api/v1/webhooks/doku',generateDigest(raw),'test-secret')};
  const signed=await fetch(url+'/api/v1/webhooks/doku',{method:'POST',headers,body:raw});assert.equal(signed.status,200);assert.equal((await signed.json()).outcome,'APPLIED');
  assert.equal((await ensureSubscription(db,other)).billing_cycle,'YEARLY');
  assert.equal((await fetch(url+'/api/v1/webhooks/doku',{method:'POST',headers,body:raw.replace('SUCCESS','FAILED')})).status,401);
  console.log('PASS: support RBAC, failed-audit rollback, trial extension, manual plan grant, checkout idempotency, real signed webhook and tamper rejection');
  console.log('PASS: forged admin rejected, merchant cannot become admin, authenticated reports, tenant query ignored, simulation/webhook rejected, durable support audit');
  await db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_billing');assert.equal((await subscriptionStatus(c,tenant)).subscription.tenantId,tenant);await assertOutletCapacity(c,tenant);});
  await db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_internal');assert.ok((await c.query('SELECT * FROM contract.admin_activity_log')).rowCount>0);assert.ok((await c.query('SELECT * FROM billing.payment_events')).rowCount>0);assert.ok((await c.query('SELECT * FROM internal.support_actions')).rowCount>0);});
  console.log('PASS: billing and internal service roles can read their authorized data');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
