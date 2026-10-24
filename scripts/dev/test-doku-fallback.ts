// Explicit documented VA fallback, isolated synthetic provider only. No activation.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import express from 'express';
import type {Db} from '../../services/shared/db';import {registerBillingRoutes} from '../../services/billing/routes';import {ensureSubscription} from '../../services/billing/engine';
import {generateSignature,generateDigest,DOKU_NOTIFICATION_PATH} from '../../api/_doku';import {acceptSyntheticSandbox} from './doku-synthetic-release';
export async function testDokuFallback(db:Db){
 const saved={...process.env},tenant=randomUUID(),owner=randomUUID();
 Object.assign(process.env,{DOKU_API_URL:'https://api-sandbox.doku.com',DOKU_CLIENT_ID:'MCH-fallback-synthetic',DOKU_SECRET_KEY:'synthetic-fallback-key',DOKU_ALLOWED_CHANNELS:'VIRTUAL_ACCOUNT_BRI',DOKU_SUBSCRIPTION_PAYMENT_MODE:'checkout',DOKU_PAYMENTS_ENABLED:'1',DOKU_CHECKOUT_PILOT_TENANTS:tenant,PUBLIC_APP_URL:'https://fallback.test.invalid'});
 await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic VA acceptance',$2)",[tenant,owner]);
 const app=express();app.use(express.json({verify:(req:any,_res,b)=>{req.rawBody=b;}}));let creates=0;
 registerBillingRoutes(app,db,true,async p=>{creates++;assert.deepEqual(p.payment.payment_method_types,['VIRTUAL_ACCOUNT_BRI']);assert.equal(p.order.amount,99000);return{paymentUrl:'https://sandbox.doku.com/va-synthetic',rawResponse:{}};});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 const checkout=()=>fetch(base+'/api/v1/subscription/checkout',{method:'POST',headers:{'content-type':'application/json','x-auth-sub':owner},body:JSON.stringify({planId:'plan-plus-monthly',billingCycle:'MONTHLY',extraOutlets:0,requestKey})});
 const requestKey=randomUUID();
 const notify=async(invoice:any,reference?:string)=>{const id=randomUUID(),time=new Date().toISOString(),raw=JSON.stringify({service:{id:'VIRTUAL_ACCOUNT'},acquirer:{id:'BRI'},channel:{id:'VIRTUAL_ACCOUNT_BRI'},transaction:{status:'SUCCESS',original_request_id:reference},order:{invoice_number:invoice.invoiceNumber,amount:invoice.amount}});const r=await fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:{'content-type':'application/json','client-id':'MCH-fallback-synthetic','request-id':id,'request-timestamp':time,signature:generateSignature('MCH-fallback-synthetic',id,time,DOKU_NOTIFICATION_PATH,generateDigest(raw),'synthetic-fallback-key')},body:raw});assert.equal(r.status,200);return r.json();};
 try{
  process.env.DOKU_ACCEPTANCE_ID=randomUUID();assert.equal((await checkout()).status,503);assert.equal(creates,0);
  await acceptSyntheticSandbox(db);const c=await checkout();assert.equal(c.status,200);const invoice=(await c.json()).invoice;assert.equal(creates,1);
  assert.equal((await notify(invoice)).reason,'PAYMENT_REFERENCE_MISSING');assert.equal(Number((await ensureSubscription(db,tenant)).revision),0);
  assert.equal((await notify(invoice,'synthetic-bri-proof')).outcome,'APPLIED');const sub=await ensureSubscription(db,tenant);assert.equal(sub.status,'ACTIVE');assert.equal(Number(sub.revision),1);
  assert.equal((await notify(invoice,'synthetic-bri-proof')).outcome,'DUPLICATE');assert.equal(Number((await ensureSubscription(db,tenant)).revision),1);
  console.log('PASS documented VA-BRI fallback: no implicit activation; matching independent sandbox acceptance required; exact frozen method/price, missing-reference review, one fulfillment and duplicate prevention; MOCK only');
 }finally{await new Promise<void>(r=>server.close(()=>r()));for(const key of new Set([...Object.keys(saved),...Object.keys(process.env)])){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
}
