// Current release authorization is QRIS only, including operator configuration.
import assert from 'node:assert/strict';
import {dokuSubscriptionPolicy} from '../../services/billing/dokuSubscriptionPolicy';
import {assertDokuReadiness} from '../../services/billing/paymentReadiness';
import type {Db} from '../../services/shared/db';
export async function testDokuFallback(db:Db){
 const saved={...process.env};
 try{
  process.env.DOKU_PAYMENTS_ENABLED='1';
  for(const mode of ['checkout','dynamic_qris_checkout'])for(const channels of ['VIRTUAL_ACCOUNT_BRI','VIRTUAL_ACCOUNT_BCA','QRIS,VIRTUAL_ACCOUNT_BRI']){
   process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE=mode;process.env.DOKU_ALLOWED_CHANNELS=channels;
   assert.throws(()=>dokuSubscriptionPolicy(),/DOKU_(QRIS_ONLY_APPROVED|DYNAMIC_QRIS_SCOPE_REQUIRED)/);
   await assert.rejects(()=>assertDokuReadiness(db,'00000000-0000-4000-8000-000000000001'),/DOKU_(QRIS_ONLY_APPROVED|DYNAMIC_QRIS_SCOPE_REQUIRED)/);
  }
  process.env.DOKU_ALLOWED_CHANNELS='QRIS';
  assert.deepEqual(dokuSubscriptionPolicy().methods,['QRIS']);
  console.log('PASS: VA/mixed-channel configuration is refused in both modes; current owner authorization is QRIS only');
 }finally{for(const k of new Set([...Object.keys(saved),...Object.keys(process.env)])){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
}
