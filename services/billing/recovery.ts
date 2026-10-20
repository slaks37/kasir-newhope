import {randomUUID} from 'node:crypto';
import type {Db} from '../shared/db';
import {checkDokuOrderStatus,getDokuAllowedChannels,generateDigest} from '../../api/_doku';
import {reconcilePayment} from './engine';

/** Backend inquiry is evidence only when every order field is provider-derived. */
export async function reconcileInvoiceByInquiry(db:Db,inv:any,provider=checkDokuOrderStatus) {
 if(inv.quote?.paymentIntegration && inv.quote.paymentIntegration!=='DOKU_CHECKOUT')return {ok:true,outcome:'UNAVAILABLE'};
 const inquiry=await provider(inv.invoice_number);
 if(!inquiry.ok || inquiry.status==='UNKNOWN')return {ok:true,outcome:'UNAVAILABLE'};
 let allowed:string[]=[];try{allowed=getDokuAllowedChannels();}catch{/* fail closed */}
 const channel=String(inquiry.channelId || '');
 const issue=inquiry.validationIssue || (inquiry.invoiceNumber!==inv.invoice_number?'INQUIRY_INVOICE_MISMATCH':
  inquiry.amount===undefined?'INQUIRY_AMOUNT_MISSING':!inquiry.transactionId?'INQUIRY_REFERENCE_MISSING':
  !channel || !allowed.includes(channel)?'UNAPPROVED_PAYMENT_CHANNEL':
  inquiry.status==='REFUNDED'?'REFUND_REQUIRES_REVIEW':undefined);
 return reconcilePayment(db,{
  eventKey:`inquiry-${generateDigest(JSON.stringify([inv.invoice_number,inquiry.rawResponse])).replace(/[/+=]/g,'')}`,
  invoiceNumber:inv.invoice_number,reference:inquiry.transactionId || 'missing',amount:inquiry.amount ?? 0,
  currency:inquiry.currency || '',success:inquiry.status==='SUCCESS',channel,providerChannel:inquiry.providerChannelId,validationIssue:issue,
  contentDigest:generateDigest(JSON.stringify(inquiry.rawResponse || {})),payload:{status:inquiry.status,channel,source:'INQUIRY'}
 });
}
/** Bounded operator/scheduler entry. No charge, checkout or refund operation. */
export async function recoverPendingPayments(db:Db,options:{limit?:number;budgetMs?:number;provider?:typeof checkDokuOrderStatus}={}) {
 const limit=Math.min(100,Math.max(1,options.limit || 20)),start=Date.now();
 const invoices=(await db.query(`SELECT i.* FROM billing.invoices i LEFT JOIN (SELECT invoice_number,max(created_at) checked_at FROM billing.payment_events
    WHERE payload->>'source'='INQUIRY_PROBE' GROUP BY invoice_number) probes USING(invoice_number)
  WHERE i.payment_status='PENDING' AND i.created_at>now()-interval '30 days'
  ORDER BY coalesce(probes.checked_at,i.created_at),i.id LIMIT $1`,[limit])).rows;
 const summary={checked:0,applied:0,review:0,unavailable:0,deferred:0};
 for(const inv of invoices){
  if(Date.now()-start>=(options.budgetMs ?? 20000)){summary.deferred++;continue;}
  summary.checked++;
  try{
   // Durable scan marker contains no amount/reference or payment proof. Rotate
   // unavailable invoices so they cannot starve newer pending payments.
   await db.query(`INSERT INTO billing.payment_events(event_key,invoice_number,outcome,reason,payload)
    VALUES($1,$2,'UNVERIFIED','STATUS_INQUIRY_ATTEMPT','{"source":"INQUIRY_PROBE"}'::jsonb)`,['probe-'+randomUUID(),inv.invoice_number]);
   const result=await reconcileInvoiceByInquiry(db,inv,options.provider);
   if(result.outcome==='APPLIED')summary.applied++;else if(result.outcome==='REVIEW')summary.review++;else if(result.outcome==='UNAVAILABLE')summary.unavailable++;
  }catch{summary.unavailable++;}
 }
 return summary;
}
