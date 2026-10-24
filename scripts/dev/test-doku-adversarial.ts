import {acceptSyntheticSandbox,futureDokuExpiry} from './doku-synthetic-release';
// Independent black-box payment audit: two app instances, shared PostgreSQL,
// independently signed synthetic notifications. No DOKU network requests.
import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import express from 'express';
import type {Db} from '../../services/shared/db';
import {registerBillingRoutes} from '../../services/billing/routes';
import {ensureSubscription} from '../../services/billing/engine';
import {reconcileInvoiceByInquiry} from '../../services/billing/recovery';

export async function testDokuAdversarial(db:Db){
 const saved={...process.env};const keys=['DOKU_ACCEPTANCE_ID','DOKU_RELEASE_SCOPE','DOKU_CHECKOUT_PILOT_TENANTS','DOKU_API_URL','DOKU_CLIENT_ID','DOKU_SECRET_KEY','DOKU_ALLOWED_CHANNELS','DOKU_PAYMENTS_ENABLED','DOKU_SUBSCRIPTION_PAYMENT_MODE','PUBLIC_APP_URL'];
 Object.assign(process.env,{DOKU_API_URL:'https://api-sandbox.doku.com',DOKU_CLIENT_ID:'MCH-independent-synthetic',DOKU_SECRET_KEY:'independent-synthetic-not-a-key',DOKU_ALLOWED_CHANNELS:'QRIS',DOKU_PAYMENTS_ENABLED:'1',DOKU_SUBSCRIPTION_PAYMENT_MODE:'dynamic_qris_checkout',PUBLIC_APP_URL:'https://audit.example.invalid'});
 await acceptSyntheticSandbox(db);
 let clock=Date.now(),inquiries=0,creations=0,timeout=false;let checkoutHook:((payload:any)=>Promise<void>)|undefined;
 const provider=async()=>{inquiries++;if(timeout)throw Error('SYNTHETIC_TIMEOUT');return{ok:false,status:'UNKNOWN' as const};};
 const servers=await Promise.all([0,1].map(async()=>{
  const app=express();app.use(express.json({verify:(r:any,_s,b)=>{r.rawBody=b;}}));
  registerBillingRoutes(app,db,true,async payload=>{creations++;if(checkoutHook)await checkoutHook(payload);assert.deepEqual(payload.payment.payment_method_types,['QRIS']);return{paymentUrl:'https://sandbox.doku.com/independent-synthetic',rawResponse:{}};},provider,()=>clock);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));return{server,url:'http://127.0.0.1:'+(server.address() as any).port};
 }));
 const failures:string[]=[];const gate=(pass:boolean,label:string)=>{console.log((pass?'PASS':'VULNERABLE')+' independent '+label);if(!pass)failures.push(label);};
 const get=(at:number,owner:string,path:string)=>fetch(servers[at].url+'/api/v1/subscription/'+path,{headers:{'x-auth-sub':owner}});
 const post=(at:number,owner:string,input:any)=>fetch(servers[at].url+'/api/v1/subscription/checkout',{method:'POST',headers:{'content-type':'application/json','x-auth-sub':owner},body:JSON.stringify(input)});
 const make=async()=>{
  const tenant=randomUUID();process.env.DOKU_CHECKOUT_PILOT_TENANTS=[process.env.DOKU_CHECKOUT_PILOT_TENANTS,tenant].filter(Boolean).join(',');const owner=randomUUID();await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Independent synthetic audit',$2)",[tenant,owner]);
  const input={planId:'plan-plus-monthly',billingCycle:'MONTHLY',extraOutlets:0,requestKey:randomUUID()};
  const r=await post(0,owner,input);assert.equal(r.status,200);return{tenant,owner,input,invoice:(await r.json()).invoice};
 };
 const deliver=async(invoice:any,status='SUCCESS',amount=invoice.amount,event=randomUUID(),reference='independent-'+invoice.id,currency='IDR')=>{
  const body=JSON.stringify({service:{id:'QRIS'},acquirer:{id:'DOKU'},channel:{id:'QRIS_DOKU'},order:{invoice_number:invoice.invoiceNumber,amount,currency},transaction:{status},emoney_payment:{approval_code:reference}});
  const timestamp=new Date().toISOString(),digest=createHash('sha256').update(body).digest('base64');
  const components=['Client-Id:MCH-independent-synthetic','Request-Id:'+event,'Request-Timestamp:'+timestamp,'Request-Target:/api/v1/webhooks/doku','Digest:'+digest].join('\n');
  const signature='HMACSHA256='+createHmac('sha256','independent-synthetic-not-a-key').update(components).digest('base64');
  const r=await fetch(servers[1].url+'/api/v1/webhooks/doku',{method:'POST',headers:{'content-type':'application/json','client-id':'MCH-independent-synthetic','request-id':event,'request-timestamp':timestamp,signature},body});assert.equal(r.status,200);return r.json();
 };
 try{
  const legacy=await make();await db.query(`UPDATE billing.invoices SET quote=jsonb_set(quote,'{allowedChannels}','["QRIS","VIRTUAL_ACCOUNT_BCA"]'::jsonb) WHERE id=$1`,[legacy.invoice.id]);
  const snapshot=(await db.query('SELECT quote,payment_link_url FROM billing.invoices WHERE id=$1',[legacy.invoice.id])).rows[0];
  const history=await(await get(0,legacy.owner,'status')).json(),direct=await(await get(1,legacy.owner,'verify?invoiceId='+legacy.invoice.id)).json();
  assert.equal(history.invoices.find((i:any)=>i.id===legacy.invoice.id).paymentLinkUrl,null);assert.equal(direct.invoice.paymentLinkUrl,null);assert.equal((await post(1,legacy.owner,legacy.input)).status,409);
  assert.equal((await deliver(legacy.invoice)).outcome,'REVIEW');assert.equal(Number((await ensureSubscription(db,legacy.tenant)).revision),0);
  assert.deepEqual((await db.query('SELECT quote,payment_link_url FROM billing.invoices WHERE id=$1',[legacy.invoice.id])).rows[0],snapshot);
  console.log('PASS independent previous F1: both instances enforce API/history policy, callback held, original quote and stored URL unchanged');

  const burst=await make(),before=inquiries;clock=Date.now();await get(0,burst.owner,'verify?invoiceId='+burst.invoice.id);
  const poll=(n:number)=>get(n%2,burst.owner,'verify?invoiceId='+burst.invoice.id+'&inquire=1');
  await Promise.all(Array.from({length:12},(_,n)=>poll(n)));assert.equal(inquiries,before);
  clock+=61000;timeout=true;await Promise.all(Array.from({length:12},(_,n)=>poll(n)));timeout=false;assert.equal(inquiries,before+1);
  await Promise.all(Array.from({length:12},(_,n)=>poll(n)));assert.equal(inquiries,before+1);assert.equal((await deliver(burst.invoice)).outcome,'APPLIED');
  console.log('PASS independent previous F2: two instances, 12 concurrent calls, one permitted inquiry, timeout cooldown, webhook independent');

  const expired=await make();await deliver(expired.invoice,'ORDER_EXPIRED');const beforeCreate=creations;
  const replies=await Promise.all([post(0,expired.owner,{...expired.input,requestKey:randomUUID()}),post(1,expired.owner,{...expired.input,requestKey:randomUUID()})]);
  const replacement=await replies.find(r=>r.status===200)!.json();assert.notEqual(replacement.invoice.id,expired.invoice.id);assert.equal(creations,beforeCreate+1);
  assert.equal((await deliver(expired.invoice)).outcome,'REVIEW');assert.equal(Number((await ensureSubscription(db,expired.tenant)).revision),0);
  assert.equal((await db.query('SELECT count(*)::int n FROM billing.invoices WHERE tenant_id=$1',[expired.tenant])).rows[0].n,2);
  console.log('PASS independent previous F3: early expiry, one replacement, old record retained, late receipt flagged without entitlement');

  const foreign=await make();assert.equal((await get(1,foreign.owner,'verify?invoiceId='+legacy.invoice.id)).status,404);
  const forged=await(await post(1,foreign.owner,{...foreign.input,tenantId:legacy.tenant,amount:1})).json();assert.equal(forged.invoice.tenantId,foreign.tenant);assert.equal(forged.invoice.amount,99000);
  const usd=await make();assert.equal((await deliver(usd.invoice,'SUCCESS',usd.invoice.amount,randomUUID(),'usd-proof','USD')).outcome,'REVIEW');assert.equal(Number((await ensureSubscription(db,usd.tenant)).revision),0);
  const missing=await make();assert.equal((await deliver(missing.invoice,'SUCCESS',missing.invoice.amount,randomUUID(),'')).reason,'QRIS_PAYMENT_REFERENCE_MISSING');assert.equal(Number((await ensureSubscription(db,missing.tenant)).revision),0);
  const unsigned=await fetch(servers[0].url+'/api/v1/webhooks/doku',{method:'POST',headers:{'content-type':'application/json','client-id':'MCH-independent-synthetic','request-id':randomUUID(),'request-timestamp':new Date().toISOString(),signature:'HMACSHA256=invalid'},body:'{}'});assert.equal(unsigned.status,401);
  console.log('PASS independent proof/tenant guards: foreign invoice 404, client amount/tenant ignored, USD and absent reference held, invalid HMAC rejected');

  // A malformed-but-authentic provider observation must never erase a hold.
  await deliver(replacement.invoice,'SUCCESS',1);const afterMismatch=await deliver(replacement.invoice);
  gate(afterMismatch.outcome==='REVIEW' && Number((await ensureSubscription(db,expired.tenant)).revision)===0,'A1 reconciliation hold survives amount mismatch followed by valid success');

  const raceTenant=randomUUID();process.env.DOKU_CHECKOUT_PILOT_TENANTS+=','+raceTenant;const raceOwner=randomUUID();await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic checkout race',$2)",[raceTenant,raceOwner]);
  checkoutHook=async payload=>{
   const row=(await db.query('SELECT * FROM billing.invoices WHERE invoice_number=$1',[payload.order.invoice_number])).rows[0];
   await deliver({id:row.id,invoiceNumber:row.invoice_number,amount:Number(row.amount)},'REFUNDED');throw Error('SYNTHETIC_CHECKOUT_RESPONSE_LOST');
  };
  try{assert.equal((await post(0,raceOwner,{planId:'plan-plus-monthly',billingCycle:'MONTHLY',extraOutlets:0,requestKey:randomUUID()})).status,500);}finally{checkoutHook=undefined;}
  const raceRow=(await db.query('SELECT * FROM billing.invoices WHERE tenant_id=$1',[raceTenant])).rows[0];
  const raceLater=await deliver({id:raceRow.id,invoiceNumber:raceRow.invoice_number,amount:Number(raceRow.amount)});
  gate(raceRow.reconciliation_note==='REFUND_REQUIRES_REVIEW' && raceLater.outcome==='REVIEW' && Number((await ensureSubscription(db,raceTenant)).revision)===0,'A1b checkout response failure cannot erase an earlier financial hold');

  for(const state of ['REFUNDED','PARTIAL_REFUNDED','REVERSED','VOIDED']){
   const f=await make();await deliver(f.invoice,state);assert.equal((await db.query('SELECT payload FROM billing.payment_events WHERE invoice_number=$1 ORDER BY created_at DESC LIMIT 1',[f.invoice.invoiceNumber])).rows[0].payload.status,state);await deliver(f.invoice,'PENDING');await deliver(f.invoice,'SUCCESS',1);const later=await deliver(f.invoice);
   gate(later.outcome==='REVIEW' && Number((await ensureSubscription(db,f.tenant)).revision)===0,'A2 '+state+' arriving before SUCCESS cannot grant entitlement');
  }
  const paid=await make();await deliver(paid.invoice);const wrong=await deliver(paid.invoice,'SUCCESS',1);
  gate(wrong.outcome==='REVIEW' && wrong.reason==='AMOUNT_OR_CURRENCY_MISMATCH','A3 already-paid invoice still validates new receipt amount before DUPLICATE');

  const conflicting=await make();await deliver(conflicting.invoice);
  const otherReference=await deliver(conflicting.invoice,'SUCCESS',conflicting.invoice.amount,randomUUID(),'different-payment-'+randomUUID());
  const references=(await db.query('SELECT gateway_reference FROM billing.payment_events WHERE invoice_number=$1',[conflicting.invoice.invoiceNumber])).rows.map((r:any)=>r.gateway_reference);assert.equal(new Set(references).size,2);
  gate(otherReference.outcome==='REVIEW' && otherReference.reason==='PROVIDER_REFERENCE_CONFLICT' && Number((await ensureSubscription(db,conflicting.tenant)).revision)===1,'A5 distinct provider payment references are reconciled, not silently deduplicated');

  const skew=await make(),raw=(await db.query('SELECT * FROM billing.invoices WHERE id=$1',[skew.invoice.id])).rows[0],realNow=Date.now;let skewCalls=0;
  try{
   // PGlite emulates the DB clock in this same VM. Keep that clock on
   // real time while skewing only the application clock; native PG also
   // executes the real clock_timestamp query, never a fabricated timestamp.
   const isolatedClockDb:Db={...db,tx:fn=>db.tx(c=>fn({...c,query:async(sql,params)=>{
    if(!sql.includes('clock_timestamp'))return c.query(sql,params);
    const applicationClock=Date.now;Date.now=realNow;try{return await c.query(sql,params);}finally{Date.now=applicationClock;}
   }}))};
   await reconcileInvoiceByInquiry(isolatedClockDb,raw,async()=>{skewCalls++;return{ok:false,status:'UNKNOWN'};});
   Date.now=()=>realNow()+120000;
   await reconcileInvoiceByInquiry(isolatedClockDb,raw,async()=>{skewCalls++;return{ok:false,status:'UNKNOWN'};});
  }finally{Date.now=realNow;}
  gate(skewCalls===0,'A4 application clock skew cannot skip database-time cooldown');
  const firstReceipt=await make(),secondReceipt=await make(),sharedRef='shared-'+randomUUID();
  assert.equal((await deliver(firstReceipt.invoice,'SUCCESS',firstReceipt.invoice.amount,randomUUID(),sharedRef)).outcome,'APPLIED');
  const reused=await deliver(secondReceipt.invoice,'SUCCESS',secondReceipt.invoice.amount,randomUUID(),sharedRef);
  gate(reused.reason==='PROVIDER_REFERENCE_REUSED'&&Number((await ensureSubscription(db,secondReceipt.tenant)).revision)===0,'one provider receipt cannot activate a second tenant');
  const paidBefore=await ensureSubscription(db,firstReceipt.tenant);
  await deliver(firstReceipt.invoice,'FAILED',firstReceipt.invoice.amount,randomUUID(),'failed-attempt-other-reference');
  assert.equal((await db.query('SELECT reconciliation_status FROM billing.invoices WHERE id=$1',[firstReceipt.invoice.id])).rows[0].reconciliation_status,'APPLIED');
  assert.equal(Number((await ensureSubscription(db,firstReceipt.tenant)).revision),Number(paidBefore.revision));
  await deliver(firstReceipt.invoice,'REFUNDED',firstReceipt.invoice.amount,randomUUID(),sharedRef);
  const held=await ensureSubscription(db,firstReceipt.tenant);assert.equal(held.status,'SUSPENDED');assert.equal(new Date(held.current_period_end).toISOString(),new Date(paidBefore.current_period_end).toISOString());
  console.log('PASS failed attempt after paid cannot erase success; refund preserves paid history/period and holds current paid access for explicit review');
  assert.deepEqual(failures,[],'Independent adversarial findings must all be closed');
  console.log('PASS independent audit: previous 3 defects and 5 adversarial case families; provider MOCK only');
 }finally{
  await Promise.all(servers.map(({server})=>new Promise<void>(r=>server.close(()=>r()))));
  for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
 }
}
