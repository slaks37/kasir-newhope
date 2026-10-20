import {getDokuAllowedChannels} from '../../api/_doku';

export type DokuSubscriptionMode='dynamic_qris_checkout'|'checkout';
/** Product selection is explicit. Never silently call a different API product. */
export function dokuSubscriptionPolicy(): {mode:DokuSubscriptionMode;methods:string[];integration:'DOKU_CHECKOUT'} {
  const mode=(process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE || 'dynamic_qris_checkout').trim();
  if(mode!=='dynamic_qris_checkout' && mode!=='checkout')throw new Error('DOKU_SUBSCRIPTION_PRODUCT_UNAVAILABLE');
  const methods=getDokuAllowedChannels();
  if(methods.includes('QRIS_DOKU'))throw new Error('DOKU_CHECKOUT_METHOD_INVALID');
  if(mode==='dynamic_qris_checkout' && (methods.length!==1 || methods[0]!=='QRIS'))throw new Error('DOKU_DYNAMIC_QRIS_SCOPE_REQUIRED');
  return {mode,methods,integration:'DOKU_CHECKOUT'};
}
