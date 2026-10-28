import assert from 'node:assert/strict';
import { createSyncHandler } from '../../src/server/syncHandler';
import { createBillingHandler } from '../../src/server/billingHandler';
import { AuthUnavailableError } from '../../services/shared/auth';
import { Readable } from 'node:stream';
let connections=0;
const handler=createSyncHandler(async()=>null,async()=>{connections++;throw new Error('Unexpected database connection');});
for(const [url,method,status] of [
  ['/api/v1/sync/business','POST',401],
  ['/api/v1/sync/catalog','POST',401],
  ['/api/v1/sync/transactions','POST',401],
  ['/api/v1/sync/activity','POST',401],
  ['/api/v1/sync/receipt-logo','GET',401],
  ['/api/v1/sync/receipt-logo','PUT',401],
  ['/api/v1/sync/receipt-logo','POST',405],
  ['/api/v1/sync/catalog','GET',401],
  ['/api/v1/sync/catalog','DELETE',405],
  ['/api/v1/sync/attendance','POST',401],
  ['/api/v1/sync/payroll','POST',401],
  ['/api/v1/sync/payroll','GET',405],
  ['/api/v1/sync/state','GET',401],
  ['/api/v1/sync/state','POST',401],
  ['/api/v1/sync/state','DELETE',405],
  ['/api/admin/merchants','POST',404],
  ['/api/v1/sync/../admin','POST',404],
] as const){
  let actual=0;
  const response={setHeader(){},status(n:number){actual=n;return this;},json(){return this;}};
  await handler({url,method,headers:{'x-auth-sub':'forged-owner','x-internal-user':'admin','x-newhope-gateway-token':'forged'}},response);
  assert.equal(actual,status,url);
}
assert.equal(connections,0);
for (const make of [createSyncHandler, createBillingHandler]) {
  const authDown=make(async()=>{throw new AuthUnavailableError();},async()=>{connections++;throw new Error('Unexpected DB access');});
  let code=0,error='';
  await authDown({url:make===createSyncHandler?'/api/v1/sync/state':'/api/v1/subscription/status',method:'GET',headers:{authorization:'Bearer x'}},
    {setHeader(){},status(n:number){code=n;return this;},json(b:any){error=b.error;return this;}});
  assert.deepEqual([code,error],[503,'AUTH_UNAVAILABLE'],'Auth outage on the serverless boundary is retryable, not 401');
}
assert.equal(connections,0);
const billing=createBillingHandler(async()=>null,async()=>{connections++;throw new Error('Unexpected DB access');});
for (const [url,method,status] of [
  ['/api/v1/subscription/outlets','POST',401],
  ['/api/v1/subscription/outlets','GET',401],
  ['/api/v1/subscription/outlets','DELETE',405],
  ['/api/v1/subscription/start-trial','POST',401],
  ['/api/v1/subscription/status','GET',401],
  ['/api/v1/subscription/checkout','POST',401],
  ['/api/v1/subscription/verify','GET',401],
  ['/api/v1/subscription/prorated-upgrade','POST',401],
  ['/api/v1/subscription/free-plan','POST',401],
  ['/api/v1/subscription/checkout','GET',405],
  ['/api/v1/subscription/simulate-payment','POST',404],
  ['/api/v1/webhooks/doku','GET',405],
  ['/api/admin/merchants','GET',404],
] as const) {
  let actual=0;
  await billing({url,method,headers:{'x-auth-sub':'forged-owner'}},{setHeader(){},status(n:number){actual=n;return this;},json(){return this;}});
  assert.equal(actual,status,url);
}
assert.equal(connections,0);
// Public routes never trust forged identity headers and reach the same billing runtime.
const seen:Array<Record<string,unknown>>=[];
const fakeDb={query:async()=>({rows:[],rowCount:0}),close:async()=>{}} as any;
const call=(handler:any,req:any)=>new Promise<{code:number;body:any}>(resolve=>{let code=200;const res:any={setHeader(){},set(){return res;},status(n:number){code=n;return res;},json(b:any){resolve({code,body:b});return res;}};void handler(req,res);});
const publicBilling=createBillingHandler(async()=>{throw new Error('Public routes must not authenticate');},async()=>fakeDb);
{
  const req:any={url:'/api/v1/subscription/plans',method:'GET',headers:{'x-auth-sub':'forged','x-auth-email-verified':'true'}};
  const {code,body}=await call(publicBilling,req);
  seen.push(req.headers);assert.equal(code,200);assert.equal(body.ok,true);assert.ok(Array.isArray(body.plans));
  assert.deepEqual(req.headers,{},'Forged identity headers are removed on public routes');
}
// The DOKU webhook keeps the exact bytes for signature verification, even when unsigned bytes are rejected.
{
  const raw=Buffer.from('{"order":{"invoice_number":"NH-x","amount":"1"}}');
  const stream:any=Readable.from([raw]);stream.url='/api/v1/webhooks/doku';stream.method='POST';stream.headers={'x-auth-sub':'forged'};
  const {code,body}=await call(publicBilling,stream);
  assert.ok(Buffer.isBuffer(stream.rawBody)&&stream.rawBody.equals(raw),'Raw webhook bytes are preserved');
  assert.equal(code,401);assert.equal(body.error,'INVALID_WEBHOOK_SIGNATURE');
}
console.log('PASS: POS boundary rejects anonymous/forged identity, wrong method and admin paths before DB access, answers 503 on Auth outage; billing entry serves plans/checkout/verify/webhook from services/billing with raw webhook bytes');
