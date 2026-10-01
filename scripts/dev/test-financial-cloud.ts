// Real isolated PostgreSQL engine and HTTP boundary. Never connects to production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import type { Db } from '../../services/shared/db';
import { createSyncHandler } from '../../src/server/syncHandler';
import { ensureSubscription } from '../../services/billing/engine';
import { pastikanPaket } from '../../services/billing/store';
import { SAAS_PLANS } from '../../src/config/saasPlans';
import { transactionLog, sectorSummary } from '../../src/server/repo';

const pg=new PGlite();
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},exec:async sql=>{await runner.exec(sql);},tx:async fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
const db=wrap(pg),owner=randomUUID(),other=randomUUID(),tenant=randomUUID(),merchant=randomUUID(),outlet=randomUUID(),inactive=randomUUID();
const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
await pg.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
for(const file of files)await pg.exec(fs.readFileSync(file,'utf8'));
await pg.exec(fs.readFileSync('docs/security/free-plan-selection.sql','utf8'));
await pastikanPaket(db,SAAS_PLANS);
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Owner')",[owner,owner+'@fixture.invalid']);
await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,owner_user_id) VALUES($1,'Cloud fixture',$2::text,$2::uuid)",[tenant,owner]);
await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Cloud brand','FNB',$3)",[merchant,tenant,owner+'_FNB']);
await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,is_active) VALUES($1,$3,$4,'Active',true),($2,$3,$4,'Deferred',false)",[outlet,inactive,tenant,merchant]);
await ensureSubscription(db,tenant);
const app=express();app.use(express.json());app.use(createSyncHandler(async req=>req.headers.authorization==='Bearer owner'?{subject:owner}:req.headers.authorization==='Bearer other'?{subject:other}:null,async()=>db));
const server=app.listen(0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const base='http://127.0.0.1:'+(server.address() as any).port;
const post=async(path:string,body:any,token='owner')=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
const get=async(path:string,token='owner')=>{const response=await fetch(base+path,{headers:{authorization:'Bearer '+token}});return {status:response.status,data:await response.json()};};
const query=`outletId=${outlet}&sector=FNB&from=2026-10-01&to=2026-10-01`;
const tx={clientTxnId:'sale-device-A',cashierRef:owner,cashierName:'Owner',subtotal:55000,totalAmount:55000,paymentMethod:'CASH',paymentStatus:'PAID',createdAt:'2026-09-30T17:00:00.000Z',items:[{clientItemId:'line-A',productRef:'p-A',productName:'Product',unitPrice:27500,unitCost:10000,quantity:2,totalPrice:55000}]};
const body={businessId:owner+'_FNB',sector:'FNB',outletId:outlet,storeName:'Cloud fixture',transactions:[tx]};
try{
  const tableOp={kind:'tables',recordId:'conflict',baseRevision:0,deleted:false,value:{id:'conflict',name:'Server table'}};
  assert.equal((await post('/api/v1/sync/state',{sector:'FNB',operations:[tableOp]})).status,200);
  const batch=await post('/api/v1/sync/state',{sector:'FNB',operations:[{...tableOp,value:{...tableOp.value,name:'Stale table'}},
    ...Array.from({length:60},(_,i)=>({kind:'tables',recordId:'batch-'+i,baseRevision:0,deleted:false,value:{id:'batch-'+i,name:'Table '+i}}))]});
  assert.equal(batch.status,200,JSON.stringify(batch));assert.equal(batch.data.versions.length,60);assert.equal(batch.data.conflicts.length,1);
  const laundryMerchant=randomUUID(),laundryOutlet=randomUUID();
  await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Laundry','LAUNDRY',$3)",[laundryMerchant,tenant,owner+'_LAUNDRY']);
  await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,is_active) VALUES($1,$2,$3,'Laundry',true)",[laundryOutlet,tenant,laundryMerchant]);
  const productOp={kind:'products',recordId:'generic-product',baseRevision:0,deleted:false,value:{id:'generic-product',name:'Same name',price:100,costPrice:30}};
  for(const sector of ['FNB','LAUNDRY'])assert.equal((await post('/api/v1/sync/state',{sector,operations:[productOp]})).data.versions.length,1);
  const identities=(await db.query("SELECT id,merchant_id FROM pos.products WHERE tenant_id=$1 AND external_ref='generic-product'",[tenant])).rows;
  assert.equal(identities.length,2);assert.notEqual(identities[0].id,identities[1].id);
  const replay=await post('/api/v1/sync/state',{sector:'FNB',operations:[productOp]});assert.equal(replay.data.versions[0].revision,1,'Lost ACK does not create a new revision');
  const wrong=await post('/api/v1/sync/state',{sector:'FNB',operations:[{...productOp,recordId:'prod-ld-12',value:{...productOp.value,id:'prod-ld-12',name:'Cleaning & Sanitasi Helm Fullface'}}]});
  assert.equal(wrong.status,200);assert.equal(wrong.data.rejected[0].error,'WRONG_SCOPE');
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM pos.shared_state_records WHERE tenant_id=$1 AND scope='FNB' AND record_id='prod-ld-12'",[tenant])).rows[0].n,0);
  assert.equal((await post('/api/v1/sync/catalog',{businessId:owner+'_FNB',sector:'FNB',products:[]})).status,409,'Projection cannot independently own state');
  const scopedCustomer={kind:'customers',recordId:'same-customer',baseRevision:0,deleted:false,value:{id:'same-customer',name:'Same customer'}};
  assert.equal((await post('/api/v1/sync/state',{sector:'LAUNDRY',operations:[scopedCustomer]})).data.versions.length,1);
  const proof=(await get('/api/v1/sync/state?sector=FNB&legacyCandidates='+encodeURIComponent(JSON.stringify([{kind:'customers',recordId:'same-customer'}])))).data;
  assert.equal(proof.scopeProof,true);assert.equal(proof.foreignRecords[0].scope,'LAUNDRY');
  assert.equal((await post('/api/v1/sync/state',{sector:'FNB',operations:[scopedCustomer]})).data.versions.length,1,'A deliberate new edit has its own merchant projection');
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM pos.customers WHERE tenant_id=$1 AND external_ref='same-customer'",[tenant])).rows[0].n,2);
  const sectorBeforeSale=(await sectorSummary(db)).find((row:any)=>row.business_sector==='FNB');
  assert.equal(sectorBeforeSale.business_unit_count,1,'Registered businesses exist before their first sale');
  assert.equal(sectorBeforeSale.active_outlet_count,1,'Active outlet count is independent of sales; deferred outlets excluded');
  assert.equal(sectorBeforeSale.transaction_count,0);
  const customerOperation={kind:'customers',recordId:'cloud-customer',baseRevision:0,deleted:false,
    value:{id:'cloud-customer',name:'Cloud customer',totalSpent:999999999,visitCount:999}};
  const customerSync=await post('/api/v1/sync/state',{sector:'FNB',outletId:outlet,operations:[customerOperation]});
  assert.equal(customerSync.status,200,JSON.stringify(customerSync));
  const customerMirror=(await db.query('SELECT name,total_spent,orders_count FROM pos.customers WHERE tenant_id=$1 AND external_ref=$2',[tenant,'cloud-customer'])).rows[0];
  assert.equal(customerMirror.name,'Cloud customer');assert.equal(Number(customerMirror.total_spent),0);
  assert.equal(customerMirror.orders_count,0,'Client CRM statistics cannot become financial totals');
  const staleCustomer=await post('/api/v1/sync/state',{sector:'FNB',outletId:outlet,operations:[{...customerOperation,value:{...customerOperation.value,name:'Stale device'}}]});
  assert.equal(staleCustomer.status,200);assert.equal(staleCustomer.data.conflicts.length,1);
  assert.equal((await db.query('SELECT name FROM pos.customers WHERE tenant_id=$1 AND external_ref=$2',[tenant,'cloud-customer'])).rows[0].name,'Cloud customer');
  const legacyCustomer=await post('/api/v1/sync/customers',{businessId:owner+'_FNB',sector:'FNB',customers:[{id:'cloud-customer',name:'Stale snapshot',totalSpent:999999}]});
  assert.equal(legacyCustomer.status,409,'Unversioned snapshots must not overwrite cloud CRM');
  const archivedCustomer=await post('/api/v1/sync/state',{sector:'FNB',outletId:outlet,operations:[{...customerOperation,baseRevision:1,deleted:true,value:null}]});
  assert.equal(archivedCustomer.status,200);
  assert.ok((await db.query('SELECT archived_at FROM pos.customers WHERE tenant_id=$1 AND external_ref=$2',[tenant,'cloud-customer'])).rows[0].archived_at);
  const restoredCustomer=await post('/api/v1/sync/state',{sector:'FNB',outletId:outlet,operations:[{...customerOperation,baseRevision:2}]});
  assert.equal(restoredCustomer.status,200);
  assert.equal((await db.query('SELECT archived_at FROM pos.customers WHERE tenant_id=$1 AND external_ref=$2',[tenant,'cloud-customer'])).rows[0].archived_at,null);
  const sale=await post('/api/v1/sync/transactions',body);assert.equal(sale.status,200,JSON.stringify(sale));assert.equal(sale.data.accepted,1);
  const deviceA=await get('/api/v1/reports/summary?'+query),deviceB=await get('/api/v1/reports/summary?'+query);
  assert.equal(deviceA.status,200,JSON.stringify(deviceA));assert.equal(deviceB.status,200,JSON.stringify(deviceB));
  assert.equal(deviceA.data.financialSummary.totalNetRevenue,55000);assert.deepEqual(deviceA.data.financialSummary,deviceB.data.financialSummary);
  assert.equal(deviceA.data.financialSummary.totalCOGS,20000);
  const history=await get('/api/v1/reports/transactions?'+query);assert.equal(history.status,200,JSON.stringify(history));assert.equal(history.data.transactions[0].id,tx.clientTxnId);assert.equal(history.data.transactions[0].items[0].id,'line-A');
  const retry=await post('/api/v1/sync/transactions',body);assert.equal(retry.status,200,JSON.stringify(retry));
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos.transactions WHERE tenant_id=$1',[tenant])).rows[0].n,1);
  assert.equal((await get('/api/v1/reports/summary?'+query)).data.cashSummary.cashSales,55000);
  assert.equal((await transactionLog(db,{tenantId:tenant,merchantId:merchant,outletId:outlet,from:'2026-10-01',to:'2026-10-01'})).revenueAmount,55000);
  const changed=await post('/api/v1/sync/transactions',{...body,transactions:[{...tx,totalAmount:55001,subtotal:55001}]});assert.equal(changed.status,409);
  assert.equal((await get('/api/v1/reports/summary?'+query,'other')).status,403);
  assert.equal((await get('/api/v1/reports/summary?'+query+'&timezone=Mars/Test')).status,400);
  assert.equal((await get('/api/v1/reports/summary?'+query.replace('2026-10-01','2026-02-30'))).status,400);
  assert.equal((await post('/api/v1/sync/transactions',{...body,outletId:inactive,transactions:[{...tx,clientTxnId:'deferred'}]})).status,409);
  const scope={sector:'FNB',outletId:outlet};
  const refund={clientRefundId:'refund-A',occurredAt:'2026-10-01T05:00:00Z',refundMethod:'CASH',reason:'Return one',items:[{clientItemId:'line-A',quantity:1}]};
  const firstRefund=await post('/api/v1/finance/refund',{...scope,clientTxnId:tx.clientTxnId,refund});assert.equal(firstRefund.status,200,JSON.stringify(firstRefund));assert.equal(firstRefund.data.refund.amount,27500);
  assert.equal((await post('/api/v1/finance/refund',{...scope,clientTxnId:tx.clientTxnId,refund})).data.refund.replayed,true);
  const afterRefund=(await get('/api/v1/reports/summary?'+query)).data;assert.equal(afterRefund.financialSummary.totalNetRevenue,27500);assert.equal(afterRefund.financialSummary.totalCOGS,10000);assert.equal(afterRefund.cashSummary.expectedCashInDrawer,27500);
  const refundTooMuch=await post('/api/v1/finance/refund',{...scope,clientTxnId:tx.clientTxnId,refund:{...refund,clientRefundId:'refund-bad',items:[{clientItemId:'line-A',quantity:2}]}});assert.equal(refundTooMuch.status,409);
  const last=await post('/api/v1/finance/refund',{...scope,clientTxnId:tx.clientTxnId,refund:{...refund,clientRefundId:'refund-last'}});assert.equal(last.status,200,JSON.stringify(last));
  const full=(await get('/api/v1/reports/summary?'+query)).data;assert.equal(full.financialSummary.totalNetRevenue,0);assert.equal(full.financialSummary.totalRefunds,55000);assert.equal(full.cashSummary.expectedCashInDrawer,0);
  const admin=await transactionLog(db,{tenantId:tenant,merchantId:merchant,outletId:outlet,from:'2026-10-01',to:'2026-10-01'});assert.equal(admin.revenueAmount,0);assert.equal(admin.refundAmount,55000);assert.equal(admin.total,1);
  const second={...tx,clientTxnId:'void-A',items:[{...tx.items[0],clientItemId:'void-line'}]};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[second]})).status,200);
  const voidBody={...body,transactions:[{...second,paymentStatus:'CANCELLED'}]};assert.equal((await post('/api/v1/sync/transactions',voidBody)).status,200);assert.equal((await post('/api/v1/sync/transactions',voidBody)).status,200);
  assert.equal((await get('/api/v1/reports/summary?'+query)).data.financialSummary.totalNetRevenue,0);
  assert.equal((await transactionLog(db,{merchantId:merchant})).counts.voided,1);
  const cash={...scope,clientEventId:'cash-A',type:'CASH_OUT',amount:5000,category:'OPERASIONAL',description:'Expense',occurredAt:'2026-10-01T10:00:00Z'};
  assert.equal((await post('/api/v1/finance/cash',cash)).status,200);assert.equal((await post('/api/v1/finance/cash',cash)).data.replayed,true);
  assert.equal((await post('/api/v1/finance/cash',{...cash,amount:6000})).status,409);
  assert.equal((await get('/api/v1/reports/summary?'+query)).data.cashSummary.expectedCashInDrawer,-5000);
  const reversal={...scope,clientEventId:'reverse-A',originalEventId:'cash-A',reason:'Correction'};
  assert.equal((await post('/api/v1/finance/cash/reverse',reversal)).status,200);assert.equal((await post('/api/v1/finance/cash/reverse',reversal)).data.replayed,true);
  // Ledger cannot be rewritten by any caller.
  await assert.rejects(()=>db.query('UPDATE pos.cash_ledger SET amount=0 WHERE tenant_id=$1',[tenant]),/append-only/);
  await db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_pos');await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",[tenant,merchant]);const r=await c.query('SELECT SUM(total_amount) AS revenue FROM contract.merchant_revenue WHERE tenant_id=$1',[tenant]);assert.equal(Number(r.rows[0].revenue),0);});
  // Split tender: a pending receipt becomes SETTLED once both payments cover it.
  const split={...tx,clientTxnId:'split-A',paymentStatus:'PENDING',paymentMethod:'QRIS'};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[split]})).status,200);
  const splitId=(await db.query('SELECT id FROM pos.transactions WHERE client_txn_id=$1',[split.clientTxnId])).rows[0].id;
  for(const method of ['QRIS','TRANSFER'])await db.query(`INSERT INTO pos.payments(id,tenant_id,merchant_id,outlet_id,transaction_id,payment_method,payment_status,amount) VALUES($1,$2,$3,$4,$5,$6,'SETTLED',27500)`,[randomUUID(),tenant,merchant,outlet,splitId,method]);
  assert.equal((await db.query('SELECT order_status FROM pos.transactions WHERE id=$1',[splitId])).rows[0].order_status,'SETTLED');
  const splitReport=(await get('/api/v1/reports/summary?'+query)).data;assert.equal(splitReport.financialSummary.totalNetRevenue,55000);assert.equal(splitReport.paymentBreakdown.QRIS,27500);assert.equal(splitReport.paymentBreakdown.TRANSFER,27500);
  // UTC and Jakarta boundaries resolve to the same canonical view with explicit local dates.
  const utc=(await get('/api/v1/reports/summary?'+query+'&timezone=UTC')).data;assert.equal(utc.financialSummary.totalNetRevenue,0);
  const laterQuery=query.replaceAll('2026-10-01','2026-10-02');
  const tenderOne={clientPaymentId:'tender-one',method:'CASH',amount:27500,createdAt:'2026-10-02T01:00:00Z'};
  const mixed={...tx,clientTxnId:'api-split',paymentStatus:'PENDING',createdAt:'2026-10-02T01:00:00Z',tenders:[tenderOne]};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[mixed]})).status,200);
  const partial=(await get('/api/v1/reports/summary?'+laterQuery)).data;
  assert.equal(partial.financialSummary.totalNetRevenue,0);assert.equal(partial.cashSummary.cashSales,27500);
  const fullyPaid={...mixed,tenders:[tenderOne,{clientPaymentId:'tender-two',method:'QRIS',amount:27500,createdAt:'2026-10-02T02:00:00Z'}]};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[fullyPaid]})).status,200);
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[fullyPaid]})).status,200);
  const mixedReport=(await get('/api/v1/reports/summary?'+laterQuery)).data;
  assert.equal(mixedReport.financialSummary.totalNetRevenue,55000);assert.equal(mixedReport.paymentBreakdown.CASH,27500);assert.equal(mixedReport.paymentBreakdown.QRIS,27500);
  assert.equal((await get('/api/v1/reports/transactions?'+laterQuery)).data.transactions[0].paymentTenders.length,2);
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[{...fullyPaid,tenders:[{...tenderOne,method:'TRANSFER'}]}]})).status,409);
  const discountQuery=query.replaceAll('2026-10-01','2026-10-03');
  const discounted={...tx,clientTxnId:'discount-sale',createdAt:'2026-10-03T01:00:00Z',subtotal:100000,discountAmount:30000,taxAmount:7000,serviceChargeAmount:3500,totalAmount:80500,
    items:[{...tx.items[0],clientItemId:'discount-line',unitPrice:50000,totalPrice:70000}]};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[discounted]})).status,200);
  const discountedRefund=await post('/api/v1/finance/refund',{...scope,clientTxnId:discounted.clientTxnId,refund:{...refund,clientRefundId:'discount-refund',occurredAt:'2026-10-03T02:00:00Z',items:[{clientItemId:'discount-line',quantity:1}]}});
  assert.equal(discountedRefund.status,200,JSON.stringify(discountedRefund));assert.equal(discountedRefund.data.refund.amount,40250);
  const discountedSummary=(await get('/api/v1/reports/summary?'+discountQuery)).data;
  assert.equal(discountedSummary.financialSummary.totalNetRevenue,40250);assert.equal(discountedSummary.financialSummary.totalTax,3500);assert.equal(discountedSummary.financialSummary.totalCOGS,10000);
  assert.equal(discountedSummary.dailySales[0].profit,26750);
  const kiloQuery=query.replaceAll('2026-10-01','2026-10-04');
  const kilo={...tx,clientTxnId:'decimal-quantity',createdAt:'2026-10-04T01:00:00Z',subtotal:30000,totalAmount:30000,items:[{...tx.items[0],clientItemId:'kilo-line',unitPrice:12000,unitCost:4000,quantity:2.5,totalPrice:30000}]};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[kilo]})).status,200);
  assert.equal((await get('/api/v1/reports/transactions?'+kiloQuery)).data.transactions[0].items[0].quantity,2.5);
  assert.equal((await get('/api/v1/reports/summary?'+kiloQuery)).data.financialSummary.totalCOGS,10000);
  const kiloRefund=await post('/api/v1/finance/refund',{...scope,clientTxnId:kilo.clientTxnId,refund:{...refund,clientRefundId:'kilo-refund',occurredAt:'2026-10-04T02:00:00Z',items:[{clientItemId:'kilo-line',quantity:0.5}]}});
  assert.equal(kiloRefund.status,200,JSON.stringify(kiloRefund));assert.equal(kiloRefund.data.refund.amount,6000);
  assert.equal((await get('/api/v1/reports/summary?'+kiloQuery)).data.financialSummary.totalCOGS,8000);
  // Contract readers retain derived access, never gain raw financial table access.
  for(const role of ['svc_ai','svc_internal']){
    assert.equal((await db.query("SELECT has_table_privilege($1,'pos.transactions','SELECT') AS allowed",[role])).rows[0].allowed,false);
    await db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);
      const r=await c.query('SELECT COUNT(*)::int AS n FROM contract.merchant_revenue WHERE tenant_id=$1',[tenant]);
      assert.ok(r.rows[0].n>0);
      await c.query('SELECT * FROM contract.refund_totals WHERE tenant_id=$1',[tenant]);
      await c.query('SELECT * FROM contract.transaction_items_detailed WHERE tenant_id=$1',[tenant]);
    });
  }
  for(const role of ['anon','authenticated']){
    assert.equal((await db.query("SELECT has_table_privilege($1,'contract.merchant_revenue','SELECT') AS allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("SELECT has_table_privilege($1,'pos.cash_ledger','SELECT') AS allowed",[role])).rows[0].allowed,false);
  }
  const opened=await post('/api/v1/finance/shift/open',{...scope,clientShiftId:'cloud-shift',initialCash:10000,cashierName:'Owner'});
  assert.equal(opened.status,200,JSON.stringify(opened));
  const shiftDate=new Date().toISOString();
  const shiftSale={...fullyPaid,clientTxnId:'shift-split',createdAt:shiftDate,
    tenders:[{...tenderOne,clientPaymentId:'shift-cash',createdAt:shiftDate},{clientPaymentId:'shift-qris',method:'QRIS',amount:27500,createdAt:shiftDate}]};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[shiftSale]})).status,200);
  const shift=(await get('/api/v1/finance/shift?sector=FNB&outletId='+outlet)).data.shift;
  assert.equal(shift.cashSales,27500);assert.equal(shift.qrisSales,27500);assert.equal(shift.eWalletSales,0);assert.equal(shift.expectedCash,37500);
  const splitRefund=await post('/api/v1/finance/refund',{...scope,clientTxnId:shiftSale.clientTxnId,
    refund:{...refund,clientRefundId:'shift-refund',occurredAt:new Date().toISOString(),refundMethod:'ORIGINAL_METHOD'}});
  assert.equal(splitRefund.status,200,JSON.stringify(splitRefund));
  assert.equal((await get('/api/v1/finance/shift?sector=FNB&outletId='+outlet)).data.shift.expectedCash,23750,'Original-method split refunds reverse only the cash share');
  const allTime=await get('/api/v1/reports/summary?sector=FNB&outletId='+outlet);
  assert.equal(allTime.status,200,JSON.stringify(allTime));assert.ok(allTime.data.financialSummary.totalNetRevenue>0);
  // Reproduce an older version's wrong FNB projection, with a real historical
  // sale referring to its primary ID. Repair must never rewrite the ledger.
  const oldProduct=randomUUID();
  await db.query(`INSERT INTO pos.products(id,tenant_id,merchant_id,outlet_id,name,sku,price,cost_price,external_ref,business_sector)
    VALUES($1,$2,$3,$4,'Cleaning & Sanitasi Helm Fullface','OLD-LD-12',100,30,'prod-ld-12','FNB')`,[oldProduct,tenant,merchant,outlet]);
  await db.query(`INSERT INTO pos.shared_state_records(tenant_id,merchant_id,scope,kind,record_id,value,revision,deleted)
    VALUES($1,$2,'FNB','products','prod-ld-12',$3,1,false)`,[tenant,merchant,JSON.stringify({id:'prod-ld-12',name:'Cleaning & Sanitasi Helm Fullface',price:100,costPrice:30})]);
  const oldSale={...tx,clientTxnId:'historical-wrong-product',items:[{...tx.items[0],productRef:'prod-ld-12',productName:'Cleaning & Sanitasi Helm Fullface'}]};
  assert.equal((await post('/api/v1/sync/transactions',{...body,transactions:[oldSale]})).status,200);
  const financialBytes=async()=>JSON.stringify((await db.query(`SELECT * FROM (SELECT 'transactions' kind,to_jsonb(t) value FROM pos.transactions t WHERE tenant_id=$1
    UNION ALL SELECT 'cash',to_jsonb(c) FROM pos.cash_ledger c WHERE tenant_id=$1
    UNION ALL SELECT 'items',to_jsonb(i) FROM pos.transaction_items i WHERE tenant_id=$1) financial ORDER BY kind,value::text`,[tenant])).rows);
  const beforeRepair=await financialBytes();await pg.exec(fs.readFileSync('migrations/0046_operational_scope_repair.sql','utf8'));
  assert.equal(await financialBytes(),beforeRepair,'Every financial row remains byte-equivalent across operational repair');
  const repaired=(await db.query('SELECT id,sync_quarantined,sync_recovery_snapshot FROM pos.products WHERE id=$1',[oldProduct])).rows[0];
  assert.equal(repaired.sync_quarantined,true);assert.equal(repaired.sync_recovery_snapshot.id,oldProduct);
  assert.ok((await db.query('SELECT product_id FROM pos.transaction_items WHERE product_id=$1',[oldProduct])).rows.length,'Historical financial references remain intact');
  const recovered=(await get('/api/v1/sync/state?sector=FNB')).data.records.find((r:any)=>r.recordId==='prod-ld-12');
  assert.equal(recovered.deleted,true);assert.equal(recovered.recoveryValue.name,'Cleaning & Sanitasi Helm Fullface');
  assert.equal((await get('/api/v1/sync/catalog?businessId='+owner+'_FNB&sector=FNB')).data.products.some((p:any)=>p.id==='prod-ld-12'),false);
  console.log('PASS: 60/61 partial commit, merchant-scoped identities, exact replay, server-side wrong-scope backups and byte-equivalent financial ledger');
  console.log('PASS: Device A → PostgreSQL → Device B → Admin equality; retry, immutable cash, refund, void, SETTLED split tender, tenant/outlet isolation and timezone');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close();}
