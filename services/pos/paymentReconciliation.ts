import {createHash} from 'node:crypto';
import type {Db} from '../shared/db';
export interface MerchantPaymentEvent{eventRef:string;accountRef:string;paymentRef?:string;orderReference?:string;amount:number;currency:string;status:'PAID'|'SETTLED'|'FAILED'|'PENDING'}
/** A provider-specific server adapter MUST verify raw bytes, signature,
 * timestamp/replay window, merchant account and credential provenance.
 * No browser-facing webhook or generic made-up PSP signature scheme is added.
 */
export interface LicensedMerchantAdapter{
 binding:{tenantId:string;merchantId:string;accountId:string;provider:string};
 verifyAndNormalize:(raw:Buffer,headers:Record<string,string>)=>Promise<MerchantPaymentEvent|null>;
}
export async function reconcileMerchantPayment(db:Db,adapter:LicensedMerchantAdapter,raw:Buffer,headers:Record<string,string>){
 if(raw.length>1048576)throw new Error('PROVIDER_DELIVERY_TOO_LARGE');
 const event=await adapter.verifyAndNormalize(raw,headers);
 if(!event)throw new Error('PROVIDER_SIGNATURE_OR_TIMESTAMP_INVALID');
 if(typeof event.eventRef!=='string'||!event.eventRef||event.eventRef.length>128||typeof event.accountRef!=='string'||!event.accountRef||event.accountRef.length>128||!Number.isFinite(event.amount)||event.amount<=0||Math.abs(event.amount*100-Math.round(event.amount*100))>0.001||
  !Number.isSafeInteger(Math.round(event.amount*100))||typeof event.currency!=='string'||! /^[A-Z]{3}$/.test(event.currency)||
  [event.paymentRef,event.orderReference].some(v=>v!==undefined&&(typeof v!=='string'||!v||v.length>128))||!['PAID','SETTLED','FAILED','PENDING'].includes(event.status))throw new Error('PROVIDER_EVENT_INVALID');
 const eventHash=createHash('sha256').update(JSON.stringify([event.eventRef,event.accountRef,event.paymentRef||null,event.orderReference||null,event.amount,event.currency,event.status])).digest('hex');
 const b=adapter.binding;
 return db.tx(async c=>{
  await c.query("SELECT set_config('app.tenant_id',$1,true)",[b.tenantId]);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payment-account:'+b.accountId]);
  const account=(await c.query(`SELECT * FROM pos.merchant_payment_accounts WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND provider=$4 AND is_active AND settlement_model='MERCHANT_DIRECT'`,[b.accountId,b.tenantId,b.merchantId,b.provider])).rows[0];
  if(!account||account.provider_account_ref!==event.accountRef)throw new Error('PROVIDER_MERCHANT_ACCOUNT_MISMATCH');
  const previous=(await c.query('SELECT * FROM pos.payment_reconciliation_events WHERE account_id=$1 AND provider_event_ref=$2',[b.accountId,event.eventRef])).rows[0];
  if(previous){if(previous.event_hash!==eventHash)throw new Error('PROVIDER_EVENT_ID_CONFLICT');return{outcome:previous.outcome,reason:previous.reason,replayed:true};}
  let reason='PROVIDER_PAYMENT_NOT_SUCCESSFUL',payment:any;
  if(['PAID','SETTLED'].includes(event.status)){
   reason='MISSING_EXPLICIT_PAYMENT_AND_ORDER_REFERENCE';
   // Static QRIS amount alone NEVER resolves a payment/order.
   if(event.paymentRef&&event.orderReference){
    payment=(await c.query(`SELECT p.*,t.client_txn_id,t.order_status FROM pos.payment_provider_links l
     JOIN pos.payments p ON p.id=l.payment_id JOIN pos.transactions t ON t.id=p.transaction_id
     WHERE l.account_id=$1 AND l.tenant_id=$2 AND l.merchant_id=$3 AND l.provider_payment_ref=$4 AND l.order_reference=$5
     AND p.tenant_id=$2 AND p.merchant_id=$3 AND t.tenant_id=$2 AND t.merchant_id=$3 FOR UPDATE OF p,t`,[b.accountId,b.tenantId,b.merchantId,event.paymentRef,event.orderReference])).rows[0];
    reason=!payment?'UNLINKED_PROVIDER_REFERENCE':event.currency!=='IDR'?'CURRENCY_MISMATCH':Number(payment.amount)!==event.amount?'AMOUNT_MISMATCH':
     payment.client_txn_id!==event.orderReference?'ORDER_REFERENCE_MISMATCH':payment.payment_method==='CASH'?'CASH_NOT_PROVIDER_VERIFIABLE':
     !['PAID','SETTLED'].includes(payment.payment_status)||['VOIDED','CANCELLED','REFUNDED'].includes(payment.order_status)?'LEDGER_STATE_REQUIRES_REVIEW':'VERIFIED';
   }
  }
  const outcome=reason==='VERIFIED'?'VERIFIED':'EXCEPTION';
  await c.query(`INSERT INTO pos.payment_reconciliation_events(tenant_id,merchant_id,account_id,provider_event_ref,event_hash,provider_payment_ref,order_reference,amount,currency,outcome,reason,payment_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[b.tenantId,b.merchantId,b.accountId,event.eventRef,eventHash,event.paymentRef||null,event.orderReference||null,event.amount,event.currency,outcome,reason,payment?.id||null]);
  if(outcome==='VERIFIED')await c.query("UPDATE pos.payments SET verification_origin='PROVIDER_VERIFIED',provider_verified_at=now(),verified_provider_event=$2 WHERE id=$1",[payment.id,event.eventRef]);
  // Reconciliation does not move funds, create custody balances, activate SaaS,
  // manufacture cash movements or rewrite settled/void/refund order history.
  return{outcome,reason,replayed:false};
 });
}
