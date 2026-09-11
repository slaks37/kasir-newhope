// Local integration assertions only. Not DOKU sandbox/ASPI evidence.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Db} from '../../services/shared/db';
import {ensureSubscription,createQuote} from '../../services/billing/engine';
import {generateDigest,generateSignature,verifyDokuWebhookSignature,DOKU_NOTIFICATION_PATH} from '../../api/_doku';
import {verifyDokuWebhookSignature as serviceVerify} from '../../services/billing/doku';

export async function testDokuNotifications(db:Db,base:string,failPayment:(value:boolean)=>void) {
  assert.equal(serviceVerify,verifyDokuWebhookSignature);
  const fixture=async(planId='plan-plus-monthly',billingCycle='MONTHLY')=>{
    const tenant=randomUUID();await db.query('INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,$2,$3)',[tenant,'Webhook local fixture',randomUUID()]);
    const sub=await ensureSubscription(db,tenant),quote={...await createQuote(db,tenant,{planId,billingCycle,extraOutlets:0}),allowedChannels:['VIRTUAL_ACCOUNT_BCA']};
    const id=randomUUID(),number='NH-'+id;
    await db.query(`INSERT INTO billing.invoices(id,tenant_id,subscription_id,invoice_number,amount,currency,due_date,quote)
      VALUES($1,$2,$3,$4,$5,'IDR',now()+interval '1 day',$6)`,[id,tenant,sub.id,number,quote.amount,JSON.stringify(quote)]);
    const body={order:{invoice_number:number,amount:quote.amount,currency:'IDR'},transaction:{status:'SUCCESS'},channel:{id:'VIRTUAL_ACCOUNT_BCA'},customer:{email:'do-not-store@test.invalid',name:'PRIVATE CUSTOMER'},future_field:{token:'DO_NOT_STORE'}};
    return {tenant,id,number,sub,quote,body};
  };
  const headers=(raw:string,id:string=randomUUID(),time=new Date().toISOString(),client='test-client')=>({'content-type':'application/json','client-id':client,'request-id':id,'request-timestamp':time,
    signature:generateSignature(client,id,time,DOKU_NOTIFICATION_PATH,generateDigest(raw),'test-secret')});
  const send=(body:any,extra:Record<string,string>={},id=randomUUID(),time=new Date().toISOString())=>{
    const raw=JSON.stringify(body);return fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:{...headers(raw,id,time),...extra},body:raw});
  };
  const f=await fixture(),raw=JSON.stringify(f.body),h=headers(raw);
  for(const bad of [{...h,signature:'invalid'},{...h,'client-id':'other-client'},headers(raw,randomUUID(),new Date(Date.now()-14*3600_000).toISOString()),headers(raw,randomUUID(),new Date(Date.now()+6*60_000).toISOString()),headers(raw,'x'.repeat(129)),headers(raw,randomUUID(),'not-a-date')]) {
    assert.equal((await fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:bad,body:raw})).status,401);
  }
  assert.equal(verifyDokuWebhookSignature({...h,'request-id':[h['request-id']]},raw,DOKU_NOTIFICATION_PATH),false);
  assert.equal(verifyDokuWebhookSignature(h,raw,'/wrong-path'),false);
  assert.equal((await fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:h,body:raw+' '})).status,401);
  // FAILURE is an attempt, not final invoice/subscription state.
  const failed=await send({...f.body,transaction:{status:'FAILED'}});assert.equal((await failed.json()).outcome,'FAILED');
  assert.equal((await db.query('SELECT reconciliation_status FROM billing.invoices WHERE id=$1',[f.id])).rows[0].reconciliation_status,'PENDING');
  assert.equal((await ensureSubscription(db,f.tenant)).status,'TRIAL');
  for(const [body,reason] of [
    [{...f.body,channel:{id:'UNCONFIRMED'}},'UNAPPROVED_PAYMENT_CHANNEL'],
    [{...f.body,transaction:{status:'PENDING'}},'UNKNOWN_PAYMENT_STATUS'],
    [{...f.body,order:{...f.body.order,amount:1}},'AMOUNT_OR_CURRENCY_MISMATCH'],
    [{...f.body,order:{...f.body.order,currency:'USD'}},'AMOUNT_OR_CURRENCY_MISMATCH'],
    [{...f.body,order:{...f.body.order,invoice_number:'UNKNOWN'}},'INVOICE_NOT_FOUND']
  ] as const) {
    const response=await send(body);assert.equal(response.status,200);const result=await response.json();assert.equal(result.outcome,'REVIEW');assert.equal(result.reason,reason);
    assert.equal((await ensureSubscription(db,f.tenant)).status,'TRIAL');
  }
  assert.equal((await send({...f.body,order:{...f.body.order,amount:null}})).status,400);
  delete process.env.DOKU_ALLOWED_CHANNELS;assert.equal((await send(f.body)).status,503);process.env.DOKU_ALLOWED_CHANNELS='VIRTUAL_ACCOUNT_BCA';
  const rollbackKey=randomUUID();failPayment(true);
  try {assert.equal((await send(f.body,{},rollbackKey)).status,500);} finally {failPayment(false);}
  assert.equal((await db.query('SELECT id FROM billing.payment_events WHERE event_key=$1',[rollbackKey])).rowCount,0);
  assert.notEqual((await db.query('SELECT payment_status FROM billing.invoices WHERE id=$1',[f.id])).rows[0].payment_status,'PAID');
  assert.equal((await ensureSubscription(db,f.tenant)).status,'TRIAL');
  const success=await send(f.body,{},rollbackKey);assert.equal((await success.json()).outcome,'APPLIED');
  assert.equal((await (await send(f.body,{},rollbackKey)).json()).outcome,'DUPLICATE');
  assert.equal((await send({...f.body,order:{...f.body.order,amount:2}},{},rollbackKey)).status,409);
  assert.equal((await (await send(f.body)).json()).outcome,'DUPLICATE');
  const stored=(await db.query('SELECT payload FROM billing.payment_events WHERE event_key=$1',[rollbackKey])).rows[0].payload;
  assert.ok(stored.contentDigest);assert.ok(!JSON.stringify(stored).includes('PRIVATE'));assert.ok(!JSON.stringify(stored).includes('DO_NOT_STORE'));assert.ok(!('customer' in stored));
  // Fresh first receipt on DOKU's final 12h retry still works. VA omits currency
  // in official non-SNAP examples; this IDR checkout route defaults it to IDR.
  const late=await fixture();const {currency,...order}=late.body.order;
  assert.equal((await (await send({...late.body,order},{},randomUUID(),new Date(Date.now()-12*3600_000).toISOString())).json()).outcome,'APPLIED');
  for(const plan of ['plan-plus-monthly','plan-pro-monthly']) for(const cycle of ['MONTHLY','YEARLY']) {
    const t=await fixture(plan,cycle),response=await send(t.body);assert.equal((await response.json()).outcome,'APPLIED');
    const actual=await ensureSubscription(db,t.tenant);assert.equal(actual.plan_id,plan);assert.equal(actual.billing_cycle,cycle);
    assert.equal(new Date(actual.current_period_end).toISOString(),t.quote.periodEnd);
  }
  console.log('PASS: DOKU non-SNAP signature/client/path/raw-body/timestamp checks, channel/status, FAILED then SUCCESS, idempotency conflicts, sanitized log, rollback, 12h retry and Plus/Pro monthly/yearly');
}
