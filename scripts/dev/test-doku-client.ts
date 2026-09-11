// Mocked outbound HTTP only; never counts as DOKU sandbox evidence.
import assert from 'node:assert/strict';
import {captureSandboxCheckout} from '../batch/doku-sandbox-evidence';
import {createDokuCheckout,getDokuApiUrl,generateDigest,generateSignature} from '../../api/_doku';

const secret='MOCK_SECRET_NEVER_EXPORT',client='MOCK_CLIENT';
const transport=(async(url:any,init:any)=>{
  assert.equal(url,'https://api-sandbox.doku.com/checkout/v1/payment');
  assert.equal(init.redirect,'error');
  assert.equal(init.headers.Signature,generateSignature(client,init.headers['Request-Id'],init.headers['Request-Timestamp'],'/checkout/v1/payment',generateDigest(init.body),secret));
  return new Response(JSON.stringify({response:{payment:{url:'https://checkout.doku.com/TOKEN_NEVER_EXPORT'}},customer:{email:'PRIVATE_EMAIL'}}),{status:200});
}) as typeof fetch;
const evidence=await captureSandboxCheckout(client,secret,transport);
assert.equal(evidence.result,'PASS');
for(const text of [secret,client,'TOKEN_NEVER_EXPORT','PRIVATE_EMAIL'])assert.ok(!JSON.stringify(evidence).includes(text));
const bad=await captureSandboxCheckout(client,secret,(async()=>new Response(JSON.stringify({error:{message:'PRIVATE_ERROR'}}),{status:400})) as typeof fetch);
assert.equal(bad.result,'NOT PASS');assert.ok(!JSON.stringify(bad).includes('PRIVATE_ERROR'));
await assert.rejects(()=>captureSandboxCheckout('',secret,transport),/CREDENTIALS_REQUIRED/);
const saved={...process.env},savedFetch=globalThis.fetch;
try {
  process.env.DOKU_API_URL='https://not-doku.invalid';assert.throws(getDokuApiUrl,/NOT_ALLOWED/);
  process.env.DOKU_API_URL='https://api-sandbox.doku.com';process.env.DOKU_CLIENT_ID=client;process.env.DOKU_SECRET_KEY=secret;
  globalThis.fetch=(async()=>new Response(JSON.stringify({error:{message:'PRIVATE_PROVIDER_RESPONSE'}}),{status:422})) as typeof fetch;
  await assert.rejects(()=>createDokuCheckout({order:{invoice_number:'test',amount:10000},payment:{payment_due_date:60}}),e=>String(e)==='Error: DOKU_API_ERROR_HTTP_422');
} finally {
  globalThis.fetch=savedFetch;
  for(const key of ['DOKU_API_URL','DOKU_CLIENT_ID','DOKU_SECRET_KEY']) {if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
}
console.log('PASS: canonical outbound signing, sandbox-only evidence target, secret/PII redaction, unsuccessful evidence and provider error sanitization (all HTTP mocked)');
