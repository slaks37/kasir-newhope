import {randomUUID,createHash} from 'node:crypto';
import type {Db} from '../shared/db';
import {uuidAllowlist} from '../shared/releaseGates';
import {BillingError,createQuote,ensureSubscription,reconcilePayment} from './engine';

/** Private operator workflow. Never callable by merchants or provider callbacks. */
export async function externalPayment(c:Db,tenantId:string,actor:string,action:string,b:any){
 if(process.env.DOKU_PAYMENTS_ENABLED?.trim()==='1')throw new BillingError(409,'PAYMENT_MODES_CONFLICT');
 if(process.env.MANUAL_EXTERNAL_PAYMENTS_ENABLED!=='1')throw new BillingError(503,'EXTERNAL_PAYMENTS_PAUSED');
 let allowed=false;try{allowed=uuidAllowlist(process.env.MANUAL_PAYMENT_PILOT_TENANTS).includes(tenantId.toLowerCase());}catch{/* deny */}
 if(!allowed)throw new BillingError(403,'EXTERNAL_PAYMENT_PILOT_ONLY');
 await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
 if(action==='ISSUE_EXTERNAL_QUOTE'){
  const quote=await createQuote(c,tenantId,b);
  const open=(await c.query(`SELECT a.after_state->'external' AS issued FROM internal.support_actions a
   WHERE a.tenant_id=$1 AND a.action='ISSUE_EXTERNAL_QUOTE' AND a.after_state->'external'->'quote'->>'revision'=$2::text
   AND (a.after_state->'external'->>'expiresAt')::timestamptz>now()
   AND NOT EXISTS(SELECT 1 FROM billing.invoices i WHERE i.id::text=a.after_state->'external'->>'quoteId') ORDER BY a.created_at LIMIT 1`,[tenantId,quote.revision])).rows[0]?.issued;
  if(open){
   if(open.quote.planId!==quote.planId || open.quote.billingCycle!==quote.billingCycle || open.quote.extraOutlets!==quote.extraOutlets)throw new BillingError(409,'OUTSTANDING_EXTERNAL_QUOTE');
   return open;
  }
  if((await c.query("SELECT id FROM billing.invoices WHERE tenant_id=$1 AND quote->>'revision'=$2::text AND (payment_status='PENDING' OR reconciliation_status='REVIEW') LIMIT 1",[tenantId,quote.revision])).rowCount)throw new BillingError(409,'OUTSTANDING_PAYMENT_RECONCILE_FIRST');
  if(quote.amount<=0)throw new BillingError(409,'ZERO_CHARGE_REQUIRES_SUPPORT');
  return {quoteId:randomUUID(),quote,expiresAt:new Date(Date.now()+86400000).toISOString(),provider:'DOKU_PAYMENT_LINK',actor};
 }
 const raw=b.proof||{},proof={brandId:raw.brandId,status:raw.status,currency:raw.currency,confirmation:raw.confirmation,reference:raw.reference,evidenceSha256:raw.evidenceSha256,evidenceId:raw.evidenceId,amount:raw.amount,paidAt:raw.paidAt,invoiceNumber:raw.invoiceNumber},brand=process.env.MANUAL_DOKU_BRAND_ID||'';
 if(!brand || /^BSN-/i.test(brand) || proof.brandId!==brand || proof.status!=='PAID' || proof.currency!=='IDR' ||
   proof.confirmation!=='PROVIDER_DASHBOARD_PAID_VERIFIED' || !/^[A-Za-z0-9._:-]{1,128}$/.test(proof.reference||'') ||
   !/^[a-f0-9]{64}$/.test(proof.evidenceSha256||'') || !/^[A-Za-z0-9._:-]{1,128}$/.test(proof.evidenceId||'') ||
   !Number.isSafeInteger(proof.amount) || proof.amount<=0 || !Number.isFinite(Date.parse(proof.paidAt)) || Date.parse(proof.paidAt)>Date.now()+300000)
  throw new BillingError(400,'EXTERNAL_PAYMENT_PROOF_INVALID');
 const row=(await c.query("SELECT after_state,created_at FROM internal.support_actions WHERE tenant_id=$1 AND action='ISSUE_EXTERNAL_QUOTE' AND after_state->'external'->>'quoteId'=$2",[tenantId,String(b.quoteId||'')])).rows[0];
 const issued=row?.after_state?.external;if(!issued)throw new BillingError(404,'EXTERNAL_QUOTE_NOT_FOUND');
 if(proof.invoiceNumber!=='NHM-'+issued.quoteId || proof.amount!==issued.quote.amount || Date.parse(proof.paidAt)<new Date(row.created_at).getTime()-300000)throw new BillingError(409,'EXTERNAL_PAYMENT_QUOTE_MISMATCH');
 const key='external-doku-'+createHash('sha256').update(JSON.stringify([brand,proof.reference])).digest('hex');
 // Database-wide unique event key also serializes the same provider receipt
 // across different tenants. Lock before checking; no schema/grants changes.
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
 const prior=(await c.query('SELECT * FROM billing.payment_events WHERE event_key=$1',[key])).rows[0];
 const number='NHM-'+issued.quoteId;
 const digest=createHash('sha256').update(JSON.stringify([tenantId,issued.quoteId,proof])).digest('hex');
 if(prior){
  if(prior.invoice_number!==number || prior.payload?.contentDigest!==digest)throw new BillingError(409,'EXTERNAL_RECEIPT_CONFLICT');
  return {quoteId:issued.quoteId,invoiceNumber:number,outcome:prior.outcome,replayed:true,proof};
 }
 if(Date.parse(issued.expiresAt)<Date.now())throw new BillingError(409,'EXTERNAL_QUOTE_EXPIRED_RECONCILE_FIRST');
 if((await c.query('SELECT id FROM billing.invoices WHERE id=$1',[issued.quoteId])).rowCount)throw new BillingError(409,'EXTERNAL_QUOTE_ALREADY_RECORDED');
 const sub=await ensureSubscription(c,tenantId);
 await c.query(`INSERT INTO billing.invoices(id,subscription_id,tenant_id,invoice_number,amount,currency,due_date,quote)
 VALUES($1,$2,$3,$4,$5,'IDR',$6,$7::jsonb)`,[issued.quoteId,sub.id,tenantId,number,issued.quote.amount,issued.expiresAt,JSON.stringify({...issued.quote,paymentIntegration:'EXTERNAL_VERIFIED',provider:'DOKU_PAYMENT_LINK'})]);
 // Reuse the canonical entitlement/revision validator in this SAME transaction.
 // REVIEW (e.g. stale revision) is committed as a real receipt, never a grant.
 const transactional={...c,tx:<T>(fn:(db:Db)=>Promise<T>)=>fn(c)};
 const conflicting=(await c.query("SELECT id FROM billing.invoices WHERE tenant_id=$1 AND id<>$2 AND quote->>'revision'=$3::text AND (payment_status='PENDING' OR reconciliation_status='REVIEW') LIMIT 1",[tenantId,issued.quoteId,issued.quote.revision])).rowCount>0;
 const result=await reconcilePayment(transactional,{validationIssue:conflicting?'EXTERNAL_CONFLICT_REQUIRES_REVIEW':undefined,eventKey:key,invoiceNumber:number,reference:proof.reference,amount:proof.amount,currency:'IDR',success:true,channel:'EXTERNAL_DOKU_PAYMENT_LINK',contentDigest:digest,payload:{status:'SUCCESS'}});
 return {quoteId:issued.quoteId,invoiceNumber:number,outcome:result.outcome,reason:result.reason,proof};
}
