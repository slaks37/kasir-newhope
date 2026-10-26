import {sharedPurchaseCashCommand} from '../../src/lib/pos/workspacePurchase';
import {enqueue,flush,getStatus,financialWorkspaceKey,type SyncPayloadTxn} from '../../src/lib/sync/queue';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import type {Db} from '../../services/shared/db';
import {createSyncHandler} from '../../src/server/syncHandler';
import {hashFinancialPin} from '../../services/pos/financialAuthorization';
import {resetSchemaFeatureCache} from '../../services/shared/schemaFeatures';
/** Runs the same HTTP workflows locally and with an actual NOBYPASSRLS svc_pos connection. */
export async function workspaceAcceptance(admin:Db,pos:Db){
 const ids={owner:randomUUID(),other:randomUUID(),cashierA:randomUUID(),cashierB:randomUUID(),manager:randomUUID(),admin:randomUUID(),kapster:randomUUID(),tenant:randomUUID(),foreignTenant:randomUUID(),merchant:randomUUID(),sibling:randomUUID(),foreign:randomUUID(),a:randomUUID(),b:randomUUID(),c:randomUUID(),d:randomUUID()};
 for(const subject of ['owner','other','cashierA','cashierB','manager','admin','kapster'] as const)await admin.query('INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,$3)',[ids[subject],ids[subject]+'@fixture.invalid','Synthetic '+subject]);
 await admin.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Workspace fixture',$2),($3,'Foreign workspace fixture',$4)",[ids.tenant,ids.owner,ids.foreignTenant,ids.other]);
 await admin.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,'plan-pro-monthly','ACTIVE',now(),now()+interval '20 days'),($3,$4,'plan-pro-monthly','ACTIVE',now(),now()+interval '20 days')",[randomUUID(),ids.tenant,randomUUID(),ids.foreignTenant]);
 for(const [merchant,tenant,outlets] of [[ids.merchant,ids.tenant,[ids.a,ids.b]],[ids.sibling,ids.tenant,[ids.c]],[ids.foreign,ids.foreignTenant,[ids.d]]] as const){
  await admin.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Synthetic mixed brand','BARBERSHOP',$3)",[merchant,tenant,'workspace-fixture:'+merchant]);
  for(const outlet of outlets)await admin.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Synthetic outlet')",[outlet,tenant,merchant]);
  for(const moduleId of ['barber','retail']){
   await admin.query('INSERT INTO internal.merchant_modules(tenant_id,merchant_id,module_id,enabled,guard_legacy_apis,workspace_version) VALUES($1,$2,$3,true,true,2)',[tenant,merchant,moduleId]);
   await admin.query("INSERT INTO billing.module_entitlements(tenant_id,merchant_id,module_id,enabled,features,expires_at,grant_reference) VALUES($1,$2,$3,true,ARRAY['overview','pos','tables','inventory','reports','settings','customers','labor'],now()+interval '1 day','synthetic-acceptance-only')",[tenant,merchant,moduleId]);
  }
 }
 for(const [user,role,outlet] of [[ids.cashierA,'CASHIER',ids.a],[ids.cashierB,'CASHIER',ids.b],[ids.manager,'MANAGER',null],[ids.admin,'ADMIN',null],[ids.kapster,'KAPSTER',ids.a]] as const)await admin.query('INSERT INTO internal.memberships(user_id,tenant_id,merchant_id,outlet_id,scope_type,role) VALUES($1,$2,$3,$4,$5,$6)',[user,ids.tenant,ids.merchant,outlet,outlet?'OUTLET':'MERCHANT',role]);
 await admin.query('INSERT INTO pos.financial_pin_credentials(tenant_id,approver_ref,pin_hash) VALUES($1,$2,$3)',[ids.tenant,ids.manager,await hashFinancialPin('5926')]);
 const app=express();app.use(express.json());app.use(createSyncHandler(async req=>{const token=String(req.headers.authorization||'').replace('Bearer ','');const subject=(ids as Record<string,string>)[token];return subject?{subject}:null;},async()=>pos));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const base='http://127.0.0.1:'+(server.address() as any).port;
 const scope=(moduleId='retail',outletId=ids.a,businessId=ids.merchant)=>({businessId,outletId,moduleId});
 const request=async(path:string,b?:unknown,token='owner')=>{const response=await fetch(base+path,{method:b?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-auth-role':'OWNER','x-auth-sub':ids.owner},body:b?JSON.stringify(b):undefined});return {status:response.status,data:await response.json()};};
 const state=(s=scope(),kinds='products',token='owner')=>request('/api/v1/sync/modules/state?'+new URLSearchParams({...s,kinds}),undefined,token);
 const save=(s:ReturnType<typeof scope>,kind:string,id:string,value:unknown,token='manager',baseRevision=0)=>request('/api/v1/sync/modules/state',{...s,operations:[{kind,recordId:id,value,baseRevision,deleted:false}]},token);
 const stock=async(s=scope())=>{const r=await state(s);assert.equal(r.status,200,JSON.stringify(r));return Number(r.data.records.find((p:any)=>p.recordId==='same-id')?.value.stock||0);};
 const product={id:'same-id',name:'Synthetic catalog',sku:'fixture',price:100,costPrice:30,stock:9999,inventoryTracked:true};
 const receive={...scope(),action:'RECEIVE',commandId:randomUUID(),lines:[{moduleId:'retail',productRef:'same-id',quantity:10},{moduleId:'barber',productRef:'same-id',quantity:4}]};
 try{
  process.env.NEW_HOPE_MODULE_WORKSPACES='1';resetSchemaFeatureCache();
  const allowed=await request('/api/v1/sync/modules/access?'+new URLSearchParams({businessId:ids.merchant,outletId:ids.a}));assert.equal(allowed.status,200,JSON.stringify(allowed));assert(allowed.data.modules.every((m:any)=>!m.features.includes('labor')&&!m.features.includes('ai')),'Unaccepted v2 labor and AI features remain closed');
  assert.equal((await state(scope(),'payroll_slips')).status,403);
  await assert.rejects(()=>pos.tx(c=>c.query('SELECT * FROM billing.subscriptions')),(e:any)=>e.code==='42501');
  await assert.rejects(()=>pos.tx(c=>c.query('SELECT * FROM internal.audit_logs')),(e:any)=>e.code==='42501');
  await assert.rejects(()=>pos.tx(c=>c.query("SELECT internal.append_merchant_activity($1::uuid,$2::uuid,'SYNC','REJECTED','INFO',NULL,NULL,NULL,NULL,'No scope','{}',NULL)",[ids.merchant,ids.tenant])),/ACTIVITY_SCOPE_MISMATCH/);
  assert.equal((await pos.tx(c=>c.query('SELECT * FROM contract.workspace_subscription_metadata'))).rows.length,0,'No tenant context exposes no subscription metadata');
  const directory=await request('/api/v1/sync/business?workspace=2',undefined,'cashierA');assert.equal(directory.status,200,JSON.stringify(directory));assert.equal(directory.data.businesses.length,1);assert.deepEqual(directory.data.businesses[0].outlets.map((o:any)=>o.outletId),[ids.a]);assert(directory.data.subscription);assert.equal(directory.data.invoices,undefined,'Staff bootstrap cannot expose billing invoices');
  for(const s of [scope(),scope('barber'),scope('retail',ids.c,ids.sibling),scope('retail',ids.d,ids.foreign)]){const r=await save(s,'products','same-id',product,s.businessId===ids.foreign?'other':'owner');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.versions.length,1,JSON.stringify(r));}
  assert.equal(await stock(),0,'Untrusted JSON stock cannot create a balance');
  const open=await request('/api/v1/finance/shift/open',{...scope(),clientShiftId:randomUUID(),cashierName:'Synthetic',initialCash:0},'cashierA');assert.equal(open.status,200,JSON.stringify(open));
  const otherShift=await request('/api/v1/finance/shift?'+new URLSearchParams(scope('barber')),undefined,'cashierA');assert.equal(otherShift.status,200,JSON.stringify(otherShift));assert.equal(otherShift.data.shift,null,'Retail shift never becomes Barber shift');
  let catalog=await state();const current=catalog.data.records.find((p:any)=>p.recordId==='same-id');
  const updated=await save(scope('retail',ids.b),'products','same-id',{...product,price:120,catalogRevision:current.value.catalogRevision},'manager',current.revision);assert.equal(updated.status,200,JSON.stringify(updated));
  assert.equal((await save(scope(),'products','same-id',{...product,price:90,catalogRevision:current.value.catalogRevision},'manager',current.revision)).status,409,'Concurrent outlet catalog edits cannot overwrite a newer module catalog');
  catalog=await state();const latest=catalog.data.records.find((p:any)=>p.recordId==='same-id');assert.equal(latest.value.price,120);assert.equal((await save(scope(),'products','same-id',{...product,catalogRevision:latest.value.catalogRevision},'manager',latest.revision)).status,200);
  const draft={id:'draft',items:[],note:'A retail only'};assert.equal((await save(scope(),'held_orders','draft',draft,'cashierA')).status,200);
  assert.equal((await state(scope('retail',ids.b),'held_orders')).data.records.length,0);assert.equal((await state(scope('barber'),'held_orders')).data.records.length,0);
  assert.equal((await save(scope(),'products','same-id',product,'cashierA')).status,403,'Browser owner headers do not elevate cashier');
  assert.equal((await save(scope('retail',ids.b),'held_orders','stolen',draft,'cashierA')).status,403);
  assert.equal((await save(scope('retail',ids.d,ids.foreign),'held_orders','stolen',draft,'owner')).status,403);
  assert.equal((await save(scope('retail',ids.c,ids.sibling),'held_orders','stolen',draft,'manager')).status,403);
  assert.equal((await save(scope(),'held_orders','wrong', {...draft,moduleId:'barber'},'cashierA')).status,403);
  const stale=await save(scope(),'held_orders','missing',draft,'cashierA',5);assert.equal(stale.data.conflicts.length,1);assert.equal(stale.data.versions.length,0,'Missing base revision never creates a record');
  assert.equal((await save(scope('retail'),'bookings','booking',{id:'booking',status:'PENDING'})).status,403);
  assert.equal((await save(scope('barber'),'bookings','booking',{id:'booking',status:'PENDING'},'kapster')).status,200);
  assert.equal((await state(scope('barber'),'staff_members','kapster')).status,200);
  assert.equal((await state(scope('retail'),'inventory_logs','kapster')).status,403);
  assert.equal((await state(scope('retail'),'store_settings','admin')).status,200);
  assert.equal((await save(scope(),'users',ids.cashierA,{id:ids.cashierA,role:'MANAGER',pin:'sha256$abcdefgh$'+'a'.repeat(64),status:'ACTIVE'},'owner')).status,403);
  let r=await request('/api/v1/sync/modules/inventory',receive,'manager');assert.equal(r.status,200,JSON.stringify(r));assert.equal(await stock(),10);assert.equal(await stock(scope('barber')),4);
  r=await request('/api/v1/sync/modules/inventory',receive,'manager');assert.equal(r.data.replayed,true);assert.equal(await stock(),10);
  assert.equal((await request('/api/v1/sync/modules/inventory',{...receive,lines:[{moduleId:'retail',productRef:'same-id',quantity:99}]},'manager')).status,409);
  assert.equal((await request('/api/v1/sync/modules/inventory',{...receive,commandId:randomUUID()},'cashierA')).status,403);
  const transfer={...scope(),action:'TRANSFER',destinationOutletId:ids.b,commandId:randomUUID(),lines:[{productRef:'same-id',quantity:3}]};
  r=await request('/api/v1/sync/modules/inventory',transfer,'manager');assert.equal(r.status,200,JSON.stringify(r));assert.equal(await stock(),7);assert.equal(await stock(scope('retail',ids.b)),3);
  assert.equal((await request('/api/v1/sync/modules/inventory',transfer,'manager')).data.replayed,true);assert.equal(await stock(),7);
  assert.equal((await request('/api/v1/sync/modules/inventory',{...transfer,commandId:randomUUID(),destinationOutletId:ids.c},'manager')).status,403);assert.equal(await stock(),7,'Denied transfer never removes source stock');
  const sale=(s=scope('retail',ids.b),id=randomUUID(),quantity=1)=>({...s,sector:s.moduleId==='retail'?'RETAIL':'BARBERSHOP',idempotencyKey:randomUUID(),transactions:[{clientTxnId:id,cashierRef:ids.owner,cashierRole:'OWNER',cashierName:'Spoofed owner',createdAt:new Date().toISOString(),subtotal:100*quantity,totalAmount:100*quantity,paymentMethod:'CASH',paymentStatus:'PAID',items:[{clientItemId:'line',productRef:'same-id',productName:'Synthetic catalog',unitPrice:100,unitCost:0,quantity}]}]});
  const delivery=sale();r=await request('/api/v1/sync/transactions',delivery,'cashierB');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.accepted,1,JSON.stringify(r));assert.equal(await stock(scope('retail',ids.b)),2);
  // Simulate a lost response after commit: replay the immutable same envelope over HTTP.
  r=await request('/api/v1/sync/transactions',delivery,'cashierB');assert.equal(r.data.replayed,true);assert.equal(await stock(scope('retail',ids.b)),2);
  assert.equal((await request('/api/v1/sync/transactions',{...delivery,transactions:[{...delivery.transactions[0],subtotal:200,totalAmount:200}]},'cashierB')).status,409,'Same receipt cannot acknowledge a changed payload');
  const collision=await request('/api/v1/sync/transactions',{...delivery,idempotencyKey:randomUUID(),moduleId:'barber',sector:'BARBERSHOP'},'manager');assert.equal(collision.data.rejected[0].error,'TRANSACTION_ID_CONFLICT');
  const oversell=await request('/api/v1/sync/transactions',sale(scope('retail',ids.b),randomUUID(),5),'cashierB');assert.equal(oversell.data.accepted,0);assert.equal(oversell.data.rejected[0].error,'INSUFFICIENT_STOCK_REQUIRES_REVIEW');assert.equal(await stock(scope('retail',ids.b)),2);
  const barberSale=sale(scope('barber'));r=await request('/api/v1/sync/transactions',barberSale,'cashierA');assert.equal(r.data.accepted,1,JSON.stringify(r));assert.equal(await stock(scope('barber')),3);
  const report=async(s=scope('retail',ids.b),token='manager')=>request('/api/v1/reports/summary?'+new URLSearchParams({...s}),undefined,token);
  const retailReport=await report();assert.equal(retailReport.status,200,JSON.stringify(retailReport));assert.equal(retailReport.data.financialSummary.totalNetRevenue,100,JSON.stringify(retailReport.data));
  assert.equal((await report(scope('barber'))).data.financialSummary.totalNetRevenue,100);assert.equal((await report(scope())).data.financialSummary.totalNetRevenue,0);
  assert.equal((await report(scope(),'cashierA')).status,403);
  const provenance=(s:ReturnType<typeof scope>,token='manager')=>request('/api/v1/finance/reconciliation?'+new URLSearchParams(s),undefined,token);
  assert.equal((await provenance(scope(),'cashierA')).status,403,'Cashier cannot read reconciliation reports');
  const retailProvenance=await provenance(scope('retail',ids.b));assert.equal(retailProvenance.status,200,JSON.stringify(retailProvenance));assert.equal(retailProvenance.data.totals.reduce((n:number,r:any)=>n+Number(r.amount),0),100);
  assert.equal((await provenance(scope())).data.totals.length,0,'Payment provenance never mixes another outlet or module');
  const refund={clientRefundId:randomUUID(),occurredAt:new Date().toISOString(),refundMethod:'CASH',reason:'Synthetic return',items:[{clientItemId:'line',quantity:1}]};
  assert.equal((await request('/api/v1/finance/approve',{...scope('retail',ids.b),action:'REFUND',reference:delivery.transactions[0].clientTxnId,reason:refund.reason,command:refund,pin:'5926'},'cashierB')).status,403);
  const approved=await request('/api/v1/finance/approve',{...scope('retail',ids.b),action:'REFUND',reference:delivery.transactions[0].clientTxnId,reason:refund.reason,command:refund,pin:'5926'},'manager');assert.equal(approved.status,200,JSON.stringify(approved));
  const refundBody={...scope('retail',ids.b),clientTxnId:delivery.transactions[0].clientTxnId,refund:{...refund,approvalGrant:approved.data.approvalGrant}};
  r=await request('/api/v1/finance/refund',refundBody,'manager');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.refund.amount,100);assert.equal(await stock(scope('retail',ids.b)),3);
  assert.equal((await request('/api/v1/finance/refund',refundBody,'manager')).data.refund.replayed,true);assert.equal(await stock(scope('retail',ids.b)),3);
  assert([404,409].includes((await request('/api/v1/finance/refund',{...refundBody,moduleId:'barber'},'manager')).status),'Another module cannot use the refund reference or approval');
  assert.equal((await report()).data.financialSummary.totalNetRevenue,0);assert.equal((await report(scope('barber'))).data.financialSummary.totalNetRevenue,100);
  const sharedId=randomUUID(),purchaseAt=new Date().toISOString(),allocations:any[]=[];
  for(const [moduleId,amount]of [['retail',600],['barber',400]] as const){const command=sharedPurchaseCashCommand(sharedId,moduleId,ids.a,moduleId==='retail'?'RETAIL':'BARBERSHOP',amount,purchaseAt,'Synthetic shared purchase');const approval=await request('/api/v1/finance/approve',{...scope(moduleId),action:'CASH_OUT',reference:command.clientEventId,reason:'Synthetic shared purchase',command,pin:'5926'},'manager');assert.equal(approval.status,200,JSON.stringify(approval));allocations.push({moduleId,amount,approvalGrant:approval.data.approvalGrant});}
  const sharedPurchase={...scope(),action:'RECEIVE',commandId:sharedId,lines:[{moduleId:'retail',productRef:'same-id',quantity:1},{moduleId:'barber',productRef:'same-id',quantity:1}],purchase:{totalAmount:1000,occurredAt:purchaseAt,description:'Synthetic shared purchase',allocations}};
  const beforePurchase=[await stock(),await stock(scope('barber'))];
  assert.equal((await request('/api/v1/sync/modules/inventory',{...sharedPurchase,purchase:{...sharedPurchase.purchase,totalAmount:999}},'manager')).status,400);assert.deepEqual([await stock(),await stock(scope('barber'))],beforePurchase,'Invalid allocation rolls back all stock writes');
  assert.equal((await request('/api/v1/sync/modules/inventory',{...sharedPurchase,purchase:{...sharedPurchase.purchase,allocations:allocations.map(a=>a.moduleId==='barber'?{...a,approvalGrant:undefined}:a)}},'manager')).status,403);assert.deepEqual([await stock(),await stock(scope('barber'))],beforePurchase,'Missing one financial approval rolls back both modules and any consumed grant');
  r=await request('/api/v1/sync/modules/inventory',sharedPurchase,'manager');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.financialRecorded,true);assert.equal(r.data.expenses.length,2);assert.equal((await request('/api/v1/sync/modules/inventory',sharedPurchase,'manager')).data.replayed,true);
  const purchaseLedger=(await admin.query("SELECT module_id,amount FROM pos.cash_ledger WHERE tenant_id=$1 AND client_event_id LIKE $2 ORDER BY module_id",[ids.tenant,'purchase:'+sharedId+':%'])).rows;assert.deepEqual(purchaseLedger.map(x=>[x.module_id,Number(x.amount)]),[['barber',-400],['retail',-600]]);assert.equal(purchaseLedger.reduce((n,x)=>n+Number(x.amount),0),-1000);
  assert.equal((await report(scope())).data.cashSummary.expenseBahan,600);assert.equal((await report(scope('barber'))).data.cashSummary.expenseBahan,400);
  const inventoryHistory=await state(scope(),'inventory_logs');assert.equal(inventoryHistory.status,200,JSON.stringify(inventoryHistory));assert(inventoryHistory.data.records.some((l:any)=>l.value.user===ids.manager));assert(inventoryHistory.data.records.every((l:any)=>l.value.moduleId==='retail'&&l.value.outletId===ids.a));
  const actor=(await admin.query('SELECT u.external_ref FROM pos.transactions t JOIN pos.users u ON u.id=t.cashier_user_id WHERE t.client_txn_id=$1',[delivery.transactions[0].clientTxnId])).rows[0];assert.equal(actor.external_ref,ids.cashierB,'Server derives actor from the authenticated session');
  const audit=(await admin.query("SELECT actor_id,actor_name,actor_role,detail FROM internal.audit_logs WHERE tenant_id=$1 AND merchant_id=$2 AND detail->>'moduleId'='retail'",[ids.tenant,ids.merchant])).rows;assert(audit.some(a=>a.actor_id===ids.cashierB&&a.actor_role==='CASHIER'));assert(audit.every(a=>a.actor_name!=='Spoofed owner'),'Audit identity comes from the verified session');
  const attribution=(await admin.query('SELECT module_id FROM pos.payments WHERE transaction_id=(SELECT id FROM pos.transactions WHERE client_txn_id=$1)',[delivery.transactions[0].clientTxnId])).rows;assert(attribution.every(r=>r.module_id==='retail'));
  const disk=new Map<string,string>(),storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),nativeFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>disk.get(k)??null,setItem:(k:string,v:string)=>disk.set(k,String(v)),removeItem:(k:string)=>disk.delete(k)}});
  try{
   const w={tenantId:ids.tenant,merchantId:ids.merchant,outletId:ids.b,moduleId:'retail',actorRef:ids.cashierB},queueId=financialWorkspaceKey(w);
   const payload={...delivery.transactions[0],workspace:w,branchId:ids.b,clientTxnId:randomUUID(),discountAmount:0,taxAmount:0,serviceChargeAmount:0} as SyncPayloadTxn;
   const target={businessId:queueId,workspace:w,outletId:ids.b,sector:'RETAIL' as const,storeName:'Synthetic queue',ownerRef:ids.cashierB};
   const legacyKey='newhope_sync_queue_'+ids.owner+'_BARBERSHOP';disk.set(legacyKey,'legacy source bytes preserved');
   enqueue(queueId,payload);assert.throws(()=>enqueue(queueId,{...payload,branchId:ids.a}),/IMMUTABLE_WORKSPACE_REQUIRED/);
   let network:'offline'|'lost-ack'|'online'='offline';let deliveries=0;
   globalThis.fetch=(async(input:any,init?:RequestInit)=>{if(typeof input!=='string'||!input.startsWith('/api/'))return nativeFetch(input,init);if(network==='offline')throw new TypeError('Synthetic network interruption');deliveries++;const response=await nativeFetch(base+input,{...init,headers:{...init?.headers,authorization:'Bearer cashierB'}});if(network==='lost-ack')throw new TypeError('Synthetic connection lost after server commit');return response;}) as typeof fetch;
   await flush(target,true);assert.equal(getStatus(queueId).pending,1);assert.equal(deliveries,0);
   network='lost-ack';await flush(target,true);assert.equal(getStatus(queueId).pending,1,'Lost ACK retains durable original command');
   const count=async()=>Number((await admin.query('SELECT count(*) n FROM pos.transactions WHERE tenant_id=$1 AND client_txn_id=$2',[ids.tenant,payload.clientTxnId])).rows[0].n);assert.equal(await count(),1);
   network='online';await flush({...target,workspace:{...w,moduleId:'barber'}},true);assert.equal(getStatus(queueId).pending,1,'Another selected module cannot drain the original queue');
   await flush(target,true);assert.equal(getStatus(queueId).pending,0);assert.equal(await count(),1,'Reopen and recovery never duplicate the canonical sale');assert.equal(disk.get(legacyKey),'legacy source bytes preserved');
  }finally{globalThis.fetch=nativeFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else delete (globalThis as any).localStorage;}
  await admin.query('UPDATE internal.memberships SET is_active=false WHERE user_id=$1',[ids.cashierB]);assert.equal((await request('/api/v1/sync/transactions',delivery,'cashierB')).status,403,'A prior receipt never bypasses membership revalidation');
  await admin.query("UPDATE billing.module_entitlements SET expires_at=now()-interval '1 second' WHERE merchant_id=$1 AND module_id='barber'",[ids.merchant]);assert.equal((await state(scope('barber'))).status,403);
  await admin.exec('ALTER TABLE pos.products RENAME COLUMN workspace_payload TO workspace_payload_not_ready');resetSchemaFeatureCache();assert.equal((await state()).status,403,'Partially applied workspace schema cannot fall back to a legacy adapter');await admin.exec('ALTER TABLE pos.products RENAME COLUMN workspace_payload_not_ready TO workspace_payload');resetSchemaFeatureCache();
  process.env.NEW_HOPE_MODULE_WORKSPACES='0';assert.equal((await state()).status,403,'Disabled rollout denies v2 writes and reads');
  for(const path of ['/api/v1/sync/state','/api/v1/reports/summary'])assert.equal((await request(path+'?'+new URLSearchParams({businessId:ids.merchant,outletId:ids.a,sector:'BARBERSHOP',kinds:'products'}))).status,403,'Flag rollback cannot restore a sector-wide legacy path');
  assert.equal((await request('/api/v1/sync/transactions',{...sale(scope('barber')),moduleId:undefined})).status,403,'Flag rollback cannot accept an unscoped legacy checkout');
  return {twoModules:true,twoMerchants:true,twoTenants:true,multipleOutlets:true,independentStaff:true,serverRbac:true,stockReceiveTransfer:true,checkoutRefundReports:true,sharedPurchaseFinancialAttribution:true,lostAckReplay:true,networkInterruptionRecovery:true,immutableOfflineQueue:true,revocation:true};
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));delete process.env.NEW_HOPE_MODULE_WORKSPACES;}
}
