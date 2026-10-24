// Official Checkout contract exercised through mock HTTPS transport only.
import assert from 'node:assert/strict';import {createHmac,createHash} from 'node:crypto';
import {createDokuCheckout,parseDokuExpiry,verifyDokuWebhookSignature,DOKU_NOTIFICATION_PATH,generateSignature,generateDigest} from '../../api/_doku';
import {futureDokuExpiry} from './doku-synthetic-release';
import {paymentUiState,paymentStateLabels,isVerifiedInvoicePayment} from '../../src/lib/subscriptionPayment';
const saved={...process.env},nativeFetch=globalThis.fetch;let calls=0;
const payload={order:{invoice_number:'NH-contract-synthetic',amount:99000,currency:'IDR',auto_redirect:true,callback_url:'https://app.example.invalid/subscription?invoice=synthetic'},payment:{payment_due_date:60,payment_method_types:['QRIS']}};
try{
 Object.assign(process.env,{DOKU_API_URL:'https://api-sandbox.doku.com',DOKU_CLIENT_ID:'MCH-contract-synthetic',DOKU_SECRET_KEY:'synthetic-contract-key'});
 let body:any={response:{order:payload.order,payment:{url:'https://sandbox.doku.com/checkout-link-v2/synthetic',expired_date:futureDokuExpiry(),payment_method_types:['QRIS']}}};
 globalThis.fetch=(async(url:any,init:any)=>{
  calls++;assert.equal(url,'https://api-sandbox.doku.com/checkout/v1/payment');assert.equal(init.headers['Request-Id'],payload.order.invoice_number);assert.equal(init.redirect,'error');
  const digest=createHash('sha256').update(init.body).digest('base64');const text=['Client-Id:MCH-contract-synthetic','Request-Id:'+init.headers['Request-Id'],'Request-Timestamp:'+init.headers['Request-Timestamp'],'Request-Target:/checkout/v1/payment','Digest:'+digest].join('\n');
  assert.equal(init.headers.Signature,'HMACSHA256='+createHmac('sha256','synthetic-contract-key').update(text).digest('base64'));
  return new Response(JSON.stringify(body),{status:200});
 }) as typeof fetch;
 const valid=await createDokuCheckout(payload);assert(valid.expiresAt&&Date.parse(valid.expiresAt)>Date.now());
 for(const expiry of [undefined,'20260230010101','not-a-date','20000101000000']){body.response.payment.expired_date=expiry;await assert.rejects(()=>createDokuCheckout(payload),/EXPIRY_INVALID/);}
 body.response.payment.expired_date=futureDokuExpiry();
 for(const methods of [[],['QRIS','VIRTUAL_ACCOUNT_BCA'],['VIRTUAL_ACCOUNT_BCA'],'QRIS']){body.response.payment.payment_method_types=methods;await assert.rejects(()=>createDokuCheckout(payload),/METHOD_MISMATCH/);}
 body.response.payment.payment_method_types=['QRIS'];body.response.order={...payload.order,amount:1};await assert.rejects(()=>createDokuCheckout(payload),/ORDER_MISMATCH/);
 body.response.order=payload.order;for(const url of ['https://evil.invalid/pay','https://checkout.doku.com/live-token','https://user:pass@sandbox.doku.com/pay','http://sandbox.doku.com/pay']){body.response.payment.url=url;await assert.rejects(()=>createDokuCheckout(payload),/URL_INVALID/);}
 assert.equal(parseDokuExpiry('20261024120000'),'2026-10-24T05:00:00.000Z');
 const raw='{"order": {"amount":99000}}',time=new Date().toISOString(),headers={'client-id':'MCH-contract-synthetic','request-id':'synthetic-delivery','request-timestamp':time,signature:generateSignature('MCH-contract-synthetic','synthetic-delivery',time,DOKU_NOTIFICATION_PATH,generateDigest(raw),'synthetic-contract-key')};
 assert(verifyDokuWebhookSignature(headers,Buffer.from(raw),DOKU_NOTIFICATION_PATH));assert(!verifyDokuWebhookSignature(headers,JSON.stringify(JSON.parse(raw)),DOKU_NOTIFICATION_PATH));
 assert(!verifyDokuWebhookSignature({...headers,'request-id':['a','b']},raw,DOKU_NOTIFICATION_PATH));assert(!verifyDokuWebhookSignature(headers,raw,DOKU_NOTIFICATION_PATH+'?x=1'));
 const old=new Date(Date.now()-14*3600000).toISOString();assert(!verifyDokuWebhookSignature({...headers,'request-timestamp':old},raw,DOKU_NOTIFICATION_PATH));
 assert.equal(paymentUiState({ok:true,paid:true,status:'ACTIVE'}),'PAYMENT_NOT_STARTED');assert(!isVerifiedInvoicePayment({ok:true,paid:true,status:'ACTIVE'}));
 assert.equal(paymentUiState({invoice:{paymentStatus:'PAID',reconciliationStatus:'REVIEW'}}),'PAYMENT_REVIEW_REQUIRED');
 for(const s of ['EXPIRED','FAILED','PENDING'])assert.equal(paymentUiState({invoice:{paymentStatus:s,reconciliationStatus:'PENDING'}}),({EXPIRED:'PAYMENT_EXPIRED',FAILED:'PAYMENT_FAILED',PENDING:'AWAITING_PAYMENT'} as any)[s]);
 assert.equal(Object.keys(paymentStateLabels).length,9);
 console.log('PASS DOKU contract: independent HMAC, deterministic request, echoed amount/method/origin/UTC+7 expiry, exact raw bytes, duplicate headers, stale timestamp, all nine UI states; MOCK only ('+calls+' intercepted requests)');
}finally{globalThis.fetch=nativeFetch;for(const k of ['DOKU_API_URL','DOKU_CLIENT_ID','DOKU_SECRET_KEY']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
