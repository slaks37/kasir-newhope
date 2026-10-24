import {getDokuAllowedChannels} from '../../api/_doku';

export type DokuSubscriptionMode='dynamic_qris_checkout'|'checkout';
export const SUPPORTED_SUBSCRIPTION_METHODS=['QRIS','VIRTUAL_ACCOUNT_BCA','VIRTUAL_ACCOUNT_BANK_MANDIRI','VIRTUAL_ACCOUNT_BANK_SYARIAH_MANDIRI','VIRTUAL_ACCOUNT_DOKU','VIRTUAL_ACCOUNT_BRI','VIRTUAL_ACCOUNT_BNI','VIRTUAL_ACCOUNT_BANK_PERMATA','VIRTUAL_ACCOUNT_BANK_CIMB','VIRTUAL_ACCOUNT_BANK_DANAMON','VIRTUAL_ACCOUNT_BTN','VIRTUAL_ACCOUNT_BNC','VIRTUAL_ACCOUNT_BSS','VIRTUAL_ACCOUNT_BJB'] as const;
/** Product selection is explicit. Never silently call a different API product. */
export function dokuSubscriptionPolicy(): {mode:DokuSubscriptionMode;methods:string[];integration:'DOKU_CHECKOUT'} {
  const mode=(process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE || 'dynamic_qris_checkout').trim();
  if(mode!=='dynamic_qris_checkout' && mode!=='checkout')throw new Error('DOKU_SUBSCRIPTION_PRODUCT_UNAVAILABLE');
  const methods=getDokuAllowedChannels();
  if(methods.includes('QRIS_DOKU'))throw new Error('DOKU_CHECKOUT_METHOD_INVALID');
  if(methods.some(x=>!SUPPORTED_SUBSCRIPTION_METHODS.includes(x as typeof SUPPORTED_SUBSCRIPTION_METHODS[number])))throw new Error('DOKU_CHECKOUT_METHOD_UNSUPPORTED');
  // Other documented VA methods are prepared, never implicitly enabled.
  // Runtime still needs matching provider evidence and specific owner approval.
  if(mode==='dynamic_qris_checkout'&&(methods.length!==1||methods[0]!=='QRIS'))throw new Error('DOKU_DYNAMIC_QRIS_SCOPE_REQUIRED');
  return {mode,methods,integration:'DOKU_CHECKOUT'};
}
