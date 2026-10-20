import {validateDokuPaymentUrl} from '../../api/_doku';

/** One policy for creation replay, history and direct invoice responses. */
export function isQrisCheckoutInvoice(i:any):boolean {
 return i?.quote?.paymentIntegration==='DOKU_CHECKOUT' && Array.isArray(i.quote.allowedChannels) &&
  i.quote.allowedChannels.length===1 && i.quote.allowedChannels[0]==='QRIS';
}
export function providerOrderTerminal(i:any):boolean {
 return ['PROVIDER_ORDER_EXPIRED','PROVIDER_CANCELLED','TERMINAL_ORDER_PAYMENT_REQUIRES_REVIEW'].includes(i?.reconciliation_note);
}
export function invoicePaymentUrl(i:any,currentRevision?:number):string|null {
 if(!isQrisCheckoutInvoice(i) || i.payment_status!=='PENDING' || i.reconciliation_status!=='PENDING' ||
  providerOrderTerminal(i) || ['PROVIDER_EXPIRED','RELATED_LATE_PAYMENT_REQUIRES_REVIEW'].includes(i.reconciliation_note) ||
  !Number.isFinite(new Date(i.due_date).getTime()) || new Date(i.due_date).getTime()<=Date.now() ||
  (currentRevision!==undefined && i.quote.revision!==currentRevision))return null;
 try{return validateDokuPaymentUrl(i.payment_link_url);}catch{return null;}
}
