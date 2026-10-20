import type {Db} from '../shared/db';
import {checkDokuOrderStatus,getDokuAllowedChannels,generateDigest} from '../../api/_doku';
import {reconcilePayment} from './engine';

/** Backend inquiry is evidence only when every order field is provider-derived. */
export async function reconcileInvoiceByInquiry(db:Db,inv:any,provider=checkDokuOrderStatus) {
 const inquiry=await provider(inv.invoice_number);
 if(!inquiry.ok || inquiry.status==='UNKNOWN')return {ok:true,outcome:'UNAVAILABLE'};
 let allowed:string[]=[];try{allowed=getDokuAllowedChannels();}catch{/* fail closed */}
 const channel=String(inquiry.channelId || '');
 const issue=inquiry.invoiceNumber!==inv.invoice_number?'INQUIRY_INVOICE_MISMATCH':
  inquiry.amount===undefined?'INQUIRY_AMOUNT_MISSING':!inquiry.transactionId?'INQUIRY_REFERENCE_MISSING':
  !channel || !allowed.includes(channel)?'UNAPPROVED_PAYMENT_CHANNEL':
  inquiry.status==='REFUNDED'?'REFUND_REQUIRES_REVIEW':undefined;
 return reconcilePayment(db,{
  eventKey:`inquiry-${generateDigest(JSON.stringify([inv.invoice_number,inquiry.rawResponse])).replace(/[/+=]/g,'')}`,
  invoiceNumber:inv.invoice_number,reference:inquiry.transactionId || 'missing',amount:inquiry.amount ?? 0,
  currency:inquiry.currency || '',success:inquiry.status==='SUCCESS',channel,validationIssue:issue,
  contentDigest:generateDigest(JSON.stringify(inquiry.rawResponse || {})),payload:{status:inquiry.status,channel,source:'INQUIRY'}
 });
}
/** Bounded operator/scheduler entry. No charge, checkout or refund operation. */
export async function recoverPendingPayments(db:Db,options:{limit?:number;budgetMs?:number;provider?:typeof checkDokuOrderStatus}={}) {
 const limit=Math.min(100,Math.max(1,options.limit || 20)),start=Date.now();
 const invoices=(await db.query(`SELECT * FROM billing.invoices WHERE payment_status='PENDING'
  AND created_at>now()-interval '30 days' ORDER BY created_at,id LIMIT $1`,[limit])).rows;
 const summary={checked:0,applied:0,review:0,unavailable:0,deferred:0};
 for(const inv of invoices){
  if(Date.now()-start>=(options.budgetMs ?? 20000)){summary.deferred++;continue;}
  summary.checked++;
  try{const result=await reconcileInvoiceByInquiry(db,inv,options.provider);
   if(result.outcome==='APPLIED')summary.applied++;else if(result.outcome==='REVIEW')summary.review++;else if(result.outcome==='UNAVAILABLE')summary.unavailable++;
  }catch{summary.unavailable++;}
 }
 return summary;
}
