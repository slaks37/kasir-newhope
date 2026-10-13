// Isolated ledger + signed-adapter fixtures; no real PSP calls/configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {Db} from '../../services/shared/db';
import {reconcileMerchantPayment,type LicensedMerchantAdapter} from '../../services/pos/paymentReconciliation';
import {applyTenders} from '../../services/pos/tenders';
const pg=new PGlite();const wrap=(r:any):Db=>({query:async(s,p)=>{const x=await r.query(s,p);return{rows:x.rows,rowCount:x.rows.length||x.affectedRows||0};},exec:async s=>{await r.exec(s);},tx:fn=>pg.transaction(t=>fn(wrap(t))),close:()=>pg.close()});const db=wrap(pg);
await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
for(const file of ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)])await pg.exec(fs.readFileSync(file,'utf8'));
const tenant=randomUUID(),foreign=randomUUID(),merchant=randomUUID(),foreignMerchant=randomUUID(),outlet=randomUUID(),txn=randomUUID(),foreignTxn=randomUUID(),account=randomUUID(),cashier=randomUUID(),foreignCashier=randomUUID();
await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Own','own'),($2,'Foreign','other')",[tenant,foreign]);
await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Own merchant','FNB'),($3,$4,'Foreign merchant','FNB')",[merchant,tenant,foreignMerchant,foreign]);
await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Own outlet')",[outlet,tenant,merchant]);
await db.query("INSERT INTO pos.tenants(id,name) VALUES($1,'Own mirror'),($2,'Foreign mirror')",[tenant,foreign]);
await db.query("INSERT INTO pos.users(id,tenant_id,name,username,role,pin) VALUES($1,$2,'Fixture cashier','fixture-cashier','ADMIN','0000'),($3,$4,'Foreign cashier','foreign-cashier','ADMIN','0000')",[cashier,tenant,foreignCashier,foreign]);
await db.query("INSERT INTO pos.transactions(id,tenant_id,merchant_id,outlet_id,cashier_user_id,client_txn_id,subtotal,total_amount,payment_method,business_sector,order_status,payment_status) VALUES($1,$2,$3,$4,$5,'order-one',10000,10000,'QRIS','FNB','COMPLETED','PAID')",[txn,tenant,merchant,outlet,cashier]);
await db.query("INSERT INTO pos.transactions(id,tenant_id,merchant_id,cashier_user_id,client_txn_id,subtotal,total_amount,payment_method,business_sector,order_status,payment_status) VALUES($1,$2,$3,$4,'foreign-order',10000,10000,'QRIS','FNB','COMPLETED','PAID')",[foreignTxn,foreign,foreignMerchant,foreignCashier]);
await applyTenders(db,{tenantId:tenant,merchantId:merchant,outletId:outlet,actorRef:'own',sector:'FNB'},txn,[{clientPaymentId:'tender-one',method:'QRIS',amount:10000,createdAt:new Date().toISOString(),verificationOrigin:'PROVIDER_VERIFIED'} as any]);
const payment=(await db.query('SELECT * FROM pos.payments WHERE transaction_id=$1',[txn])).rows[0];assert.equal(payment.verification_origin,'CASHIER_RECORDED','Client cannot assert provider verification');
await db.query("INSERT INTO pos.merchant_payment_accounts(id,tenant_id,merchant_id,provider,provider_account_ref,settlement_model,licensed_provider_review_ref,owner_approval_ref,is_active) VALUES($1,$2,$3,'FIXTURE_PSP','merchant-own','MERCHANT_DIRECT','fixture review only, not a real licensed integration','fixture owner approval',true)",[account,tenant,merchant]);
await db.query("INSERT INTO pos.payment_provider_links(tenant_id,merchant_id,account_id,payment_id,provider_payment_ref,order_reference) VALUES($1,$2,$3,$4,'provider-one','order-one')",[tenant,merchant,account,payment.id]);
// This is ONLY a test adapter, not a claimed signing format of any real PSP.
const secret='fixture-signing-secret';let verifications=0;
const adapter:LicensedMerchantAdapter={binding:{tenantId:tenant,merchantId:merchant,accountId:account,provider:'FIXTURE_PSP'},async verifyAndNormalize(raw,headers){verifications++;const expected=createHmac('sha256',secret).update(raw).digest(),actual=Buffer.from(headers.signature||'','hex');if(expected.length!==actual.length||!timingSafeEqual(expected,actual)||Math.abs(Date.now()-Number(headers.timestamp))>300000)return null;return JSON.parse(raw.toString());}};
const base={eventRef:'event-one',accountRef:'merchant-own',paymentRef:'provider-one',orderReference:'order-one',amount:10000,currency:'IDR',status:'PAID'};
const deliver=async(event:any,options:{badSignature?:boolean;expired?:boolean}={})=>{const raw=Buffer.from(JSON.stringify(event));return reconcileMerchantPayment(db,adapter,raw,{signature:options.badSignature?'00':createHmac('sha256',secret).update(raw).digest('hex'),timestamp:String(Date.now()-(options.expired?600000:0))});};
try{
 await assert.rejects(()=>deliver(base,{badSignature:true}),/SIGNATURE/);await assert.rejects(()=>deliver(base,{expired:true}),/TIMESTAMP/);
 assert.equal((await db.query('SELECT count(*)::int n FROM pos.payment_reconciliation_events')).rows[0].n,0);
 for(const [event,reason] of [[{...base,eventRef:'amount-only',paymentRef:undefined,orderReference:undefined},'MISSING_EXPLICIT_PAYMENT_AND_ORDER_REFERENCE'],[{...base,eventRef:'wrong-amount',amount:20000},'AMOUNT_MISMATCH'],[{...base,eventRef:'wrong-currency',currency:'USD'},'CURRENCY_MISMATCH'],[{...base,eventRef:'foreign-reference',orderReference:'foreign-order'},'UNLINKED_PROVIDER_REFERENCE']] as const){const r=await deliver(event);assert.equal(r.outcome,'EXCEPTION');assert.equal(r.reason,reason);}
 assert.equal((await db.query('SELECT verification_origin FROM pos.payments WHERE id=$1',[payment.id])).rows[0].verification_origin,'CASHIER_RECORDED');
 await assert.rejects(()=>deliver({...base,accountRef:'merchant-foreign'}),/ACCOUNT_MISMATCH/);
 const success=await deliver(base);assert.equal(success.outcome,'VERIFIED');assert.equal((await deliver(base)).replayed,true);
 await assert.rejects(()=>deliver({...base,amount:1}),/EVENT_ID_CONFLICT/);
 const verified=(await db.query('SELECT * FROM pos.payments WHERE id=$1',[payment.id])).rows[0];assert.equal(verified.verification_origin,'PROVIDER_VERIFIED');assert.ok(verified.provider_verified_at);assert.equal(Number(verified.amount),10000);
 assert.equal((await db.query('SELECT count(*)::int n FROM pos.cash_ledger')).rows[0].n,0,'No custody or fake cash movements');
 assert.equal((await db.query('SELECT count(*)::int n FROM billing.payment_events')).rows[0].n,0,'Merchant payments cannot activate DOKU subscriptions');
 for(const role of ['anon','authenticated'])await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);await c.query('SELECT * FROM pos.payment_reconciliation_events');}),/permission denied/);
 await assert.rejects(()=>db.exec('DELETE FROM pos.payment_reconciliation_events'),/RECONCILIATION_EVIDENCE_IMMUTABLE/);
 assert.equal(verifications,10);
 console.log('PASS: cashier/provider separation, signed raw-byte adapter boundary, timestamp denial, explicit order/payment linkage, no nominal-only matching, tenant/account/amount/currency isolation, exact replay, immutable exceptions, DOKU separation');
}finally{await pg.close();}
