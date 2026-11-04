import {checkoutPilotAllowed} from '../shared/releaseGates';
import {validateDokuPaymentUrl} from '../../api/_doku';

export const FINANCIAL_HOLD_REASONS=['EXTERNAL_CONFLICT_REQUIRES_REVIEW','PROVIDER_REFERENCE_CONFLICT','REFUND_REQUIRES_REVIEW','REVERSAL_REQUIRES_REVIEW','TERMINAL_ORDER_PAYMENT_REQUIRES_REVIEW','RELATED_LATE_PAYMENT_REQUIRES_REVIEW'] as const;
/** Receipt evidence may add another reason, but cannot clear financial holds. */
export function financialReviewHold(i:any):string|undefined {
 return FINANCIAL_HOLD_REASONS.some(reason=>reason===i?.reconciliation_note)?i.reconciliation_note:undefined;
}

/** One policy for creation replay, history and direct invoice responses. */
export function isQrisCheckoutInvoice(i:any):boolean {
 return i?.quote?.paymentIntegration==='DOKU_CHECKOUT' && Array.isArray(i.quote.allowedChannels) &&
  i.quote.allowedChannels.length===1 && i.quote.allowedChannels[0]==='QRIS';
}
export function providerOrderTerminal(i:any):boolean {
 return ['PROVIDER_ORDER_EXPIRED','PROVIDER_CANCELLED','TERMINAL_ORDER_PAYMENT_REQUIRES_REVIEW'].includes(i?.reconciliation_note);
}
export function invoicePaymentUrl(i:any,currentRevision?:number):string|null {
 if(process.env.DOKU_PAYMENTS_ENABLED?.trim()!=='1' || !checkoutPilotAllowed(i?.tenant_id || '') || !isQrisCheckoutInvoice(i) || i.payment_status!=='PENDING' || i.reconciliation_status!=='PENDING' ||
  providerOrderTerminal(i) || ['PROVIDER_EXPIRED','RELATED_LATE_PAYMENT_REQUIRES_REVIEW'].includes(i.reconciliation_note) ||
  !Number.isFinite(new Date(i.due_date).getTime()) || new Date(i.due_date).getTime()<=Date.now() ||
  (currentRevision!==undefined && i.quote.revision!==currentRevision))return null;
 try{return validateDokuPaymentUrl(i.payment_link_url);}catch{return null;}
}
