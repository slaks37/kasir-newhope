import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Db} from '../../services/shared/db';
import {ensureSubscription} from '../../services/billing/engine';
export async function testBetaPayments(db:Db,base:string,failAudit:(v:boolean)=>void){
 const keys=['MANUAL_EXTERNAL_PAYMENTS_ENABLED','MANUAL_PAYMENT_PILOT_TENANTS','MANUAL_DOKU_BRAND_ID','DOKU_PAYMENTS_ENABLED','DOKU_CHECKOUT_PILOT_TENANTS'];const saved={...process.env};
 const tenant=randomUUID(),other=randomUUID();await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic manual pilot',$2),($3,'Synthetic excluded',$4)",[tenant,randomUUID(),other,randomUUID()]);
 const call=(id:string,body:any,token='test-admin')=>fetch(base+'/api/admin/tenants/'+id+'/support',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({reason:'Verified synthetic provider evidence only',...body})});
 const quoteBody={action:'ISSUE_EXTERNAL_QUOTE',planId:'plan-plus-monthly',billingCycle:'MONTHLY',extraOutlets:0};
 try{
  process.env.DOKU_PAYMENTS_ENABLED='0';delete process.env.MANUAL_EXTERNAL_PAYMENTS_ENABLED;
  assert.equal((await call(tenant,quoteBody)).status,503);
  Object.assign(process.env,{MANUAL_EXTERNAL_PAYMENTS_ENABLED:'1',MANUAL_PAYMENT_PILOT_TENANTS:tenant,MANUAL_DOKU_BRAND_ID:'MCH-synthetic-manual'});
  assert.equal((await call(other,quoteBody)).status,403);assert.equal((await call(tenant,quoteBody,'test-support')).status,403);assert.equal((await call(tenant,quoteBody,'no-mfa')).status,403);
  const issued=await Promise.all([call(tenant,quoteBody),call(tenant,quoteBody)]);const q=(await issued[0].json()).external;assert.equal((await issued[1].json()).external.quoteId,q.quoteId);assert.equal(q.quote.amount,99000);
  const proof={brandId:'MCH-synthetic-manual',status:'PAID',currency:'IDR',confirmation:'PROVIDER_DASHBOARD_PAID_VERIFIED',reference:'synthetic-'+randomUUID(),evidenceSha256:'a'.repeat(64),evidenceId:'private-synthetic-evidence',amount:99000,paidAt:new Date().toISOString(),invoiceNumber:'NHM-'+q.quoteId};
  const verify={action:'VERIFY_EXTERNAL_PAYMENT',quoteId:q.quoteId,proof};
  for(const delta of [{amount:1},{currency:'USD'},{status:'PARTIALLY_PAID'},{brandId:'MCH-other'},{invoiceNumber:'OTHER'},{evidenceSha256:''}])assert.notEqual((await call(tenant,{...verify,proof:{...proof,...delta}})).status,200);
  failAudit(true);try{assert.equal((await call(tenant,verify)).status,500);}finally{failAudit(false);}
  assert.equal((await db.query('SELECT id FROM billing.invoices WHERE id=$1',[q.quoteId])).rowCount,0);assert.equal(Number((await ensureSubscription(db,tenant)).revision),0);
  const firstReceipts=await Promise.all([call(tenant,verify),call(tenant,verify)]);const results=await Promise.all(firstReceipts.map(r=>{assert.equal(r.status,200);return r.json();}));assert.equal(results.filter(r=>!r.external.replayed && r.external.outcome==='APPLIED').length,1);assert.equal(Number((await ensureSubscription(db,tenant)).revision),1);
  const again=await Promise.all([call(tenant,verify),call(tenant,verify)]);for(const r of again){assert.equal(r.status,200);assert.equal((await r.json()).external.replayed,true);}assert.equal(Number((await ensureSubscription(db,tenant)).revision),1);
  assert.equal((await call(tenant,{...verify,proof:{...proof,evidenceId:'changed'}})).status,409);
  // The same provider receipt must not pay another tenant/invoice.
  process.env.MANUAL_PAYMENT_PILOT_TENANTS+=','+other;
  const q2=(await(await call(other,quoteBody)).json()).external;
  assert.equal((await call(other,{...verify,quoteId:q2.quoteId,proof:{...proof,invoiceNumber:'NHM-'+q2.quoteId}})).status,409);
  assert.equal(Number((await ensureSubscription(db,other)).revision),0);
  // Complimentary GRANT_PLAN remains independent from invoices/conversion.
  const before=(await db.query('SELECT id FROM billing.invoices WHERE tenant_id=$1',[other])).rowCount;
  assert.equal((await call(other,{...quoteBody,action:'GRANT_PLAN'})).status,200);
  assert.equal((await db.query('SELECT id FROM billing.invoices WHERE tenant_id=$1',[other])).rowCount,before);
  const late=await(await call(other,{action:'VERIFY_EXTERNAL_PAYMENT',quoteId:q2.quoteId,proof:{...proof,invoiceNumber:'NHM-'+q2.quoteId,reference:'stale-'+randomUUID()}})).json();assert.equal(late.external.outcome,'REVIEW');assert.equal(Number((await ensureSubscription(db,other)).revision),1);
  console.log('PASS beta external payments: flag/pilot/RBAC/MFA, canonical quote/tenant/amount/currency/provider/order, audit rollback, exactly-once fulfillment, global receipt replay conflict, stale revision REVIEW, complimentary grant not paid');
 }finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
}
