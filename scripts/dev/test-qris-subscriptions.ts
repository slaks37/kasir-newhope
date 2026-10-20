// Application-level QRIS tests only. Every provider request is intercepted.
// Does not claim QRIS Sandbox support or any real payment/merchant approval.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import type {Db} from '../../services/shared/db';
import {recoverPendingPayments} from '../../services/billing/recovery';
import {registerBillingRoutes} from '../../services/billing/routes';
import {createDokuCheckout,checkDokuOrderStatus,generateDigest,generateSignature,DOKU_NOTIFICATION_PATH} from '../../api/_doku';
import {ensureSubscription,invoicePaymentState} from '../../services/billing/engine';
import {safeReturnPath,moduleForPath} from '../../src/lib/navigation/routes';
import {checkoutRequestKey,isVerifiedInvoicePayment,isDokuHostedUrl} from '../../src/lib/subscriptionPayment';

export async function testQrisSubscriptions(db:Db) {
 const saved={...process.env},nativeFetch=globalThis.fetch;
 const keys=['DOKU_SUBSCRIPTION_PAYMENT_MODE','DOKU_PAYMENTS_ENABLED','DOKU_API_URL','DOKU_CLIENT_ID','DOKU_SECRET_KEY','DOKU_ALLOWED_CHANNELS','PUBLIC_APP_URL'];
 process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE='dynamic_qris_checkout';
 process.env.DOKU_API_URL='https://api-sandbox.doku.com';process.env.DOKU_CLIENT_ID='MCH-synthetic';
 process.env.DOKU_SECRET_KEY='synthetic-not-a-credential';process.env.DOKU_ALLOWED_CHANNELS='QRIS';process.env.PUBLIC_APP_URL='https://app.test.invalid';
 let inquiry:any={},providerCalls=0,providerTimeout=false,failActivation=false,failDb=false;
 const wrapped=(current:Db):Db=>({...current,query:async(sql,params)=>{
  if(failDb || failActivation && sql.includes('UPDATE billing.subscriptions SET plan_id'))throw new Error('SYNTHETIC_DATABASE_UNAVAILABLE');
  return current.query(sql,params);
 },tx:fn=>current.tx(c=>fn(wrapped(c)))});
 const app=express();app.use(express.json({verify:(req:any,_res,buf)=>{req.rawBody=buf;}}));
 registerBillingRoutes(app,wrapped(db),true,createDokuCheckout,checkDokuOrderStatus);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+(server.address() as any).port;
 const make=async()=>{
  const tenant=randomUUID(),owner='qris-'+randomUUID();await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic subscription QA',$2)",[tenant,owner]);
  return {tenant,owner};
 };
 const post=(owner:string,body:any)=>fetch(base+'/api/v1/subscription/checkout',{method:'POST',headers:{'x-auth-sub':owner,'content-type':'application/json'},body:JSON.stringify(body)});
 const input=()=>({planId:'plan-plus-monthly',billingCycle:'MONTHLY',extraOutlets:0,requestKey:randomUUID(),amount:1,tenantId:randomUUID(),paymentMode:'direct_dynamic_qris',payment_method_types:['VIRTUAL_ACCOUNT_BCA']});
 const verify=(owner:string,id:string)=>fetch(base+'/api/v1/subscription/verify?invoiceId='+id,{headers:{'x-auth-sub':owner}});
 const notify=(invoice:any,status='SUCCESS',event=randomUUID(),amount=invoice.amount)=>{
  const raw=JSON.stringify({order:{invoice_number:invoice.invoiceNumber,amount,currency:'IDR'},transaction:{status,original_request_id:'reference-'+invoice.id},channel:{id:'QRIS'}});
  const time=new Date().toISOString();return fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:{'content-type':'application/json','client-id':'MCH-synthetic','request-id':event,'request-timestamp':time,
   signature:generateSignature('MCH-synthetic',event,time,DOKU_NOTIFICATION_PATH,generateDigest(raw),'synthetic-not-a-credential')},body:raw});
 };
 globalThis.fetch=(async(url:any,init:any)=>{
  if(String(url).startsWith('https://api-sandbox.doku.com/')){
   if(init.method==='GET')return new Response(JSON.stringify(inquiry),{status:200});
   providerCalls++;if(providerTimeout)throw new Error('SYNTHETIC_PROVIDER_TIMEOUT');
   const payload=JSON.parse(init.body);assert.deepEqual(payload.payment.payment_method_types,['QRIS']);
   const callback=new URL(payload.order.callback_url);assert.equal(callback.pathname,'/subscription');assert.equal(moduleForPath(callback.pathname),'payment');assert.equal(safeReturnPath(callback.pathname+callback.search),callback.pathname+callback.search);assert.ok(callback.searchParams.get('invoice'));
   assert.equal(payload.order.amount,99000);assert.equal(payload.order.currency,'IDR');
   assert.equal(init.redirect,'error');
   assert.equal(init.headers.Signature,generateSignature('MCH-synthetic',init.headers['Request-Id'],init.headers['Request-Timestamp'],'/checkout/v1/payment',generateDigest(init.body),'synthetic-not-a-credential'));
   const stored=(await db.query('SELECT id FROM billing.invoices WHERE invoice_number=$1',[payload.order.invoice_number])).rows[0];
   assert.ok(stored,'Intent must precede provider call');assert.equal(callback.searchParams.get('invoice'),stored.id);
   return new Response(JSON.stringify({response:{order:{invoice_number:payload.order.invoice_number,amount:payload.order.amount},payment:{url:'https://sandbox.doku.com/checkout-link-v2/synthetic'}}}),{status:200});
  }
  if(String(url).startsWith(base))return nativeFetch(url,init);
  throw new Error('UNEXPECTED_EXTERNAL_REQUEST');
 }) as typeof fetch;
 try {
  // Fail closed before provisioning a tenant or creating a provider order.
  const before=(await db.query('SELECT count(*)::int n FROM internal.tenants')).rows[0].n;
  delete process.env.DOKU_PAYMENTS_ENABLED;
  assert.equal((await post('unprovisioned-qa',input())).status,503);
  assert.equal((await db.query('SELECT count(*)::int n FROM internal.tenants')).rows[0].n,before);assert.equal(providerCalls,0);
  process.env.DOKU_PAYMENTS_ENABLED='1';process.env.DOKU_CLIENT_ID='BSN-synthetic';
  const a=await make();assert.equal((await post(a.owner,input())).status,503);assert.equal(providerCalls,0);process.env.DOKU_CLIENT_ID='MCH-synthetic';
  console.log('PASS QRIS 1: explicit activation and Brand ID guards; no provisioning/provider side effects when paused');
  const body=input(),responses=await Promise.all([post(a.owner,body),post(a.owner,body)]);
  assert.ok(responses.some(r=>r.status===200));const first=await responses.find(r=>r.status===200)!.json();
  assert.equal(providerCalls,1);assert.equal(first.invoice.amount,99000);assert.equal(first.invoice.tenantId,a.tenant);assert.equal(first.quote.paymentMode,'dynamic_qris_checkout');assert.equal(first.quote.paymentIntegration,'DOKU_CHECKOUT');
  assert.equal((await (await post(a.owner,body)).json()).invoice.id,first.invoice.id);
  assert.equal((await post(a.owner,{...body,planId:'plan-pro-monthly'})).status,409);
  console.log('PASS QRIS 2: server pricing, outbound QRIS-only scope, intent persistence, concurrent retry key deduplication');
  const foreign=await make();assert.equal((await verify(foreign.owner,first.invoice.id)).status,404);
  assert.equal((await verify(a.owner,randomUUID())).status,404);
  console.log('PASS QRIS 3: cross-tenant and unknown invoices cannot report another subscription as paid');
  const valid={order:{invoice_number:first.invoice.invoiceNumber,amount:99000,currency:'IDR'},transaction:{status:'SUCCESS',original_request_id:'inquiry-'+first.invoice.id},channel:{id:'QRIS'}};
  for(const bad of [
   {...valid,order:{...valid.order,amount:1}}, {...valid,order:{invoice_number:valid.order.invoice_number}},
   {...valid,order:{...valid.order,currency:'USD'}}, {...valid,order:{...valid.order,invoice_number:'WRONG'}},
   {...valid,channel:{id:'VIRTUAL_ACCOUNT_BCA'}}, {...valid,transaction:{status:'SUCCESS'}}
  ]) {inquiry=bad;assert.equal((await (await verify(a.owner,first.invoice.id)).json()).paid,false);}
  assert.equal((await ensureSubscription(db,a.tenant)).status,'TRIAL');
  console.log('PASS QRIS 4: authoritative inquiry rejects wrong/missing amount, invoice, currency, channel or provider reference');
  inquiry=valid;const recovered=await (await verify(a.owner,first.invoice.id)).json();assert.equal(isVerifiedInvoicePayment(recovered),true);
  const active=await ensureSubscription(db,a.tenant);assert.equal(active.status,'ACTIVE');
  await verify(a.owner,first.invoice.id);assert.equal(Number((await ensureSubscription(db,a.tenant)).revision),Number(active.revision));
  console.log('PASS QRIS 5: delayed/missing webhook recovers from verified inquiry and page refresh never extends twice');
  const b=await make(),bInvoice=(await (await post(b.owner,input())).json()).invoice;inquiry={};
  for(const [providerStatus,display] of [['PENDING','PENDING'],['FAILED','FAILED'],['ORDER_EXPIRED','EXPIRED'],['CANCELLED','CANCELLED']]) {
   assert.equal((await notify(bInvoice,providerStatus)).status,200);
   const result=await (await verify(b.owner,bInvoice.id)).json();assert.equal(result.paid,false);assert.equal(result.invoice.paymentStatus,display);
  }
  console.log('PASS QRIS 6: pending/failed/expired/cancelled attempts remain unpaid with accurate user-facing observations');
  const event=randomUUID();failActivation=true;
  assert.equal((await notify(bInvoice,'SUCCESS',event)).status,500);failActivation=false;
  assert.equal((await db.query('SELECT id FROM billing.payment_events WHERE event_key=$1',[event])).rowCount,0);
  assert.equal((await ensureSubscription(db,b.tenant)).status,'TRIAL');
  assert.equal((await (await notify(bInvoice,'SUCCESS',event)).json()).outcome,'APPLIED');
  assert.equal((await (await notify(bInvoice,'SUCCESS',event)).json()).outcome,'DUPLICATE');
  assert.equal((await (await notify(bInvoice)).json()).outcome,'DUPLICATE');
  assert.equal((await notify(bInvoice,'SUCCESS',event,1)).status,409);
  console.log('PASS QRIS 7: entitlement failure rolls back invoice and receipt; exact retry and new delivery ID cannot fulfill twice');
  const c=await make(),cInvoice=(await (await post(c.owner,input())).json()).invoice;
  failDb=true;assert.equal((await notify(cInvoice)).status,500);failDb=false;
  assert.equal((await (await notify(cInvoice)).json()).outcome,'APPLIED');
  console.log('PASS QRIS 8: database outage returns non-2xx; later signed delivery activates without any browser session');
  const d=await make(),dBody=input();providerTimeout=true;
  assert.equal((await post(d.owner,dBody)).status,500);providerTimeout=false;
  const calls=providerCalls;assert.equal((await post(d.owner,dBody)).status,409);assert.equal(providerCalls,calls);
  const dRaw=(await db.query('SELECT * FROM billing.invoices WHERE tenant_id=$1',[d.tenant])).rows[0];
  inquiry={...valid,order:{...valid.order,invoice_number:dRaw.invoice_number},transaction:{status:'SUCCESS',original_request_id:'timeout-'+dRaw.id}};
  assert.equal((await (await verify(d.owner,dRaw.id)).json()).paid,true);
  console.log('PASS QRIS 9: ambiguous Checkout timeout preserves invoice, blocks duplicate creation, recovers by inquiry');
  const e=await make(),eBody=input(),e1=(await (await post(e.owner,eBody)).json()).invoice;
  const repeated=await (await post(e.owner,input())).json();assert.equal(repeated.invoice.id,e1.id);
  assert.equal((await post(e.owner,{...input(),planId:'plan-pro-monthly'})).status,409);
  // Rehearse pre-existing historical concurrent invoices as well: only one
  // may apply even if two provider successes arrive concurrently.
  const legacyId=randomUUID();await db.query(`INSERT INTO billing.invoices(id,subscription_id,tenant_id,invoice_number,amount,currency,due_date,quote)
   SELECT $1,subscription_id,tenant_id,$2,amount,currency,due_date,quote FROM billing.invoices WHERE id=$3`,[legacyId,'NH-'+legacyId,e1.id]);
  await Promise.all([notify(e1),notify({...e1,id:legacyId,invoiceNumber:'NH-'+legacyId})]);
  assert.equal(Number((await ensureSubscription(db,e.tenant)).revision),1);
  assert.equal((await db.query("SELECT count(*)::int n FROM billing.invoices WHERE tenant_id=$1 AND payment_status='PAID'",[e.tenant])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM billing.invoices WHERE tenant_id=$1 AND reconciliation_note='STALE_SUBSCRIPTION_REVISION'",[e.tenant])).rows[0].n,1);
  console.log('PASS QRIS 10: distinct checkout keys reuse a single payable invoice; conflicting plan blocked; historical concurrent payments never double apply');
  assert.equal((await (await notify(first.invoice,'REFUNDED')).json()).reason,'REFUND_REQUIRES_REVIEW');
  assert.equal((await db.query('SELECT payment_status FROM billing.invoices WHERE id=$1',[first.invoice.id])).rows[0].payment_status,'PAID');
  assert.equal((await ensureSubscription(db,a.tenant)).status,'ACTIVE');
  console.log('PASS QRIS 11: refund/reversal requires operator reconciliation; no invented refund or silent entitlement revocation');
  assert.equal(invoicePaymentState({payment_status:'PENDING',due_date:'2020-01-01'}),'EXPIRED');
  assert.equal(isVerifiedInvoicePayment({ok:true,paid:false,status:'ACTIVE'}),false);
  assert.equal(isVerifiedInvoicePayment({ok:true,paid:true,invoice:{paymentStatus:'PAID',reconciliationStatus:'REVIEW'}}),false);
  for(const url of ['https://evil.invalid','https://sandbox.doku.com.evil.invalid','javascript:alert(1)','https://x:y@checkout.doku.com'])assert.equal(isDokuHostedUrl(url),false);
  const memory=new Map<string,string>(),priorStorage=globalThis.sessionStorage;
  Object.defineProperty(globalThis,'sessionStorage',{value:{getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v)},configurable:true});
  try{const k=checkoutRequestKey('owner','plan','MONTHLY',0);assert.equal(checkoutRequestKey('owner','plan','MONTHLY',0),k);assert.notEqual(checkoutRequestKey('other','plan','MONTHLY',0),k);}
  finally{Object.defineProperty(globalThis,'sessionStorage',{value:priorStorage,configurable:true});}
  const unattended=await make(),unattendedInvoice=(await (await post(unattended.owner,input())).json()).invoice;
  await db.query("UPDATE billing.invoices SET created_at=now()-interval '29 days' WHERE id=$1",[unattendedInvoice.id]);
  const workerProvider=async(number:string)=>number===unattendedInvoice.invoiceNumber?{ok:true,status:'SUCCESS' as const,invoiceNumber:number,amount:99000,currency:'IDR',transactionId:'worker-'+unattendedInvoice.id,channelId:'QRIS',rawResponse:{source:'synthetic-worker',number}}:{ok:false,status:'UNKNOWN' as const};
  const batch=await recoverPendingPayments(db,{limit:1,provider:workerProvider});assert.equal(batch.applied,1);
  assert.equal((await ensureSubscription(db,unattended.tenant)).status,'ACTIVE');
  assert.equal((await recoverPendingPayments(db,{limit:100,provider:workerProvider})).applied,0);
  console.log('PASS QRIS 13: bounded background/operator inquiry fulfills without browser and safely repeats');
  console.log('PASS QRIS 12: refresh retry intent is owner-scoped; UI success requires applied invoice; redirect hosts fail closed');

  // Official non-SNAP QRIS envelope: QRIS_DOKU + approval_code, no
  // original_request_id. Schema-shaped fixture only; no provider payment.
  const signedBody=(body:any,event=randomUUID(),hoursOld=0)=>{
    const raw=JSON.stringify(body),time=new Date(Date.now()-hoursOld*3600000).toISOString();
    return fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:{'content-type':'application/json','client-id':'MCH-synthetic','request-id':event,'request-timestamp':time,
      signature:generateSignature('MCH-synthetic',event,time,DOKU_NOTIFICATION_PATH,generateDigest(raw),'synthetic-not-a-credential')},body:raw});
  };
  const official=(invoice:any)=>({service:{id:'QRIS'},acquirer:{id:'DOKU'},channel:{id:'QRIS_DOKU'},
    order:{invoice_number:invoice.invoiceNumber,amount:invoice.amount},transaction:{status:'SUCCESS',date:new Date().toISOString()},
    emoney_payment:{approval_code:'approval-'+invoice.id},customer:{name:'SYNTHETIC_CUSTOMER_DO_NOT_STORE',email:'private-do-not-store@example.invalid'},
    additional_info:{origin:{product:'QRIS',system:'snap-adapter',apiFormat:'SNAP',source:'DIRECT'}}});
  const q=await make(),qInvoice=(await (await post(q.owner,input())).json()).invoice,qBody=official(qInvoice);
  const qEvent=randomUUID();process.env.DOKU_PAYMENTS_ENABLED='0';
  assert.equal((await (await signedBody(qBody,qEvent,12)).json()).outcome,'APPLIED');
  assert.equal((await (await signedBody(qBody)).json()).outcome,'DUPLICATE');
  process.env.DOKU_PAYMENTS_ENABLED='1';
  const receipt=(await db.query('SELECT gateway_reference,payload FROM billing.payment_events WHERE event_key=$1',[qEvent])).rows[0];
  assert.equal(receipt.gateway_reference,qBody.emoney_payment.approval_code);assert.equal(receipt.payload.channel,'QRIS');assert.equal(receipt.payload.providerChannel,'QRIS_DOKU');
  assert.ok(!JSON.stringify(receipt).includes('SYNTHETIC_CUSTOMER'));assert.ok(!JSON.stringify(receipt).includes('private-do-not-store'));
  assert.equal(Number((await ensureSubscription(db,q.tenant)).revision),1);
  console.log('PASS QRIS 14: documented QRIS_DOKU envelope, stable approval reference, raw-channel audit, 12h delivery and duplicate while new Checkout paused');
  const r=await make(),rInvoice=(await (await post(r.owner,input())).json()).invoice,rBody=official(rInvoice);
  for(const malformed of [{...rBody,service:{id:'CREDIT_CARD'}},{...rBody,acquirer:{id:'OTHER'}},{...rBody,service:undefined}]) {
    const result=await (await signedBody(malformed)).json();assert.equal(result.outcome,'REVIEW');assert.equal(result.reason,'QRIS_CHANNEL_IDENTITY_MISMATCH');
  }
  for(const emoney of [undefined,{approval_code:{}},{approval_code:'x'.repeat(129)}]) {
    const result=await (await signedBody({...rBody,emoney_payment:emoney})).json();assert.equal(result.outcome,'REVIEW');assert.equal(result.reason,'QRIS_PAYMENT_REFERENCE_MISSING');
  }
  assert.equal((await ensureSubscription(db,r.tenant)).status,'TRIAL');
  assert.equal((await signedBody(rBody,randomUUID(),14)).status,401);
  const snap=await fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:{'content-type':'application/json','X-PARTNER-ID':'synthetic','X-SIGNATURE':'not-a-non-SNAP-envelope'},body:JSON.stringify(rBody)});assert.equal(snap.status,401);
  console.log('PASS QRIS 15: service/acquirer confusion, absent or malformed stable reference, stale signature and native SNAP headers fail closed');
  inquiry=rBody;assert.equal((await (await verify(r.owner,rInvoice.id)).json()).paid,true);
  assert.equal((await db.query('SELECT payment_gateway_ref FROM billing.invoices WHERE id=$1',[rInvoice.id])).rows[0].payment_gateway_ref,rBody.emoney_payment.approval_code);
  console.log('PASS QRIS 16: authenticated inquiry normalizes documented provider channel and approval reference without local amount substitution');
  const existingTenants=(await db.query('SELECT count(*)::int n FROM internal.tenants')).rows[0].n,initialCalls=providerCalls;
  for(const [mode,methods,error] of [
    ['direct_dynamic_qris','QRIS','DOKU_SUBSCRIPTION_PRODUCT_UNAVAILABLE'],['dynamic_qris_checkout','QRIS,VIRTUAL_ACCOUNT_BCA','DOKU_DYNAMIC_QRIS_SCOPE_REQUIRED'],
    ['checkout','QRIS_DOKU','DOKU_CHECKOUT_METHOD_INVALID'],['typo','QRIS','DOKU_SUBSCRIPTION_PRODUCT_UNAVAILABLE']
  ]) {
    process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE=mode;process.env.DOKU_ALLOWED_CHANNELS=methods;
    const denied=await post('must-not-be-provisioned',input());assert.equal(denied.status,503);assert.equal((await denied.json()).error,error);
  }
  assert.equal(providerCalls,initialCalls);assert.equal((await db.query('SELECT count(*)::int n FROM internal.tenants')).rows[0].n,existingTenants);
  process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE='dynamic_qris_checkout';process.env.DOKU_ALLOWED_CHANNELS='QRIS';
  console.log('PASS QRIS 17: primary Dynamic QRIS scope, explicit Checkout fallback policy, unsupported Direct product never calls guessed endpoints or provisions tenants');
  const rotation=[] as string[];
  for(let i=0;i<2;i++) {const owner=await make(),inv=(await (await post(owner.owner,input())).json()).invoice;rotation.push(inv.invoiceNumber);await db.query("UPDATE billing.invoices SET created_at=now()-interval '29 days' WHERE id=$1",[inv.id]);}
  const scanned:string[]=[];
  for(let i=0;i<2;i++)await recoverPendingPayments(db,{limit:1,provider:async number=>{scanned.push(number);return{ok:false,status:'UNKNOWN'};}});
  assert.equal(new Set(scanned).size,2);assert.deepEqual([...scanned].sort(),rotation.sort());
  const probes=(await db.query("SELECT amount,gateway_reference,outcome FROM billing.payment_events WHERE invoice_number=$1 AND payload->>'source'='INQUIRY_PROBE'",[scanned[0]])).rows;
  assert.ok(probes.length>0);assert.equal(probes[0].amount,null);assert.equal(probes[0].gateway_reference,null);assert.equal(probes[0].outcome,'UNVERIFIED');
  console.log('PASS QRIS 18: durable bounded inquiry rotation prevents unavailable old invoices starving newer ones; scan markers never claim payment');

 } finally {
  globalThis.fetch=nativeFetch;for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
}
