import assert from 'node:assert/strict';import express from 'express';
import {registerBillingRoutes} from '../../services/billing/routes';import type {Db} from '../../services/shared/db';
const previous=process.env.DOKU_PAYMENTS_ENABLED;process.env.DOKU_PAYMENTS_ENABLED='0';
let dbCalls=0,providerCalls=0;const db={query:async()=>{dbCalls++;throw Error('PAUSED_CHECKOUT_MUST_NOT_QUERY');}} as unknown as Db;
const app=express();app.use(express.json());registerBillingRoutes(app,db,true,async()=>{providerCalls++;throw Error('PAUSED_CHECKOUT_MUST_NOT_CALL_PROVIDER');});
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
try{
 const base='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port;
 for(const value of ['0',' 0\n','invalid','']){
  process.env.DOKU_PAYMENTS_ENABLED=value;
  const r=await fetch(base+'/api/v1/subscription/checkout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,503);assert.equal((await r.json()).error,'PAYMENTS_PAUSED');assert.equal(dbCalls,0);assert.equal(providerCalls,0);
 }
 assert.equal((await fetch(base+'/api/v1/subscription/plans')).status,200);
 console.log('PASS prelaunch payment hold: no database/tenant/invoice/provider writes; plan catalog remains readable');
}finally{await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.DOKU_PAYMENTS_ENABLED;else process.env.DOKU_PAYMENTS_ENABLED=previous;}
