import assert from 'node:assert/strict';
import type {Express} from 'express';
import {createNativeApiHandler} from '../../api/_runtime';

function response(){
  return {code:200,body:undefined as any,headers:{} as Record<string,string>,
    setHeader(key:string,value:string){this.headers[key]=value;},
    status(code:number){this.code=code;return this;},
    json(body:any){this.body=body;return this;}};
}
let builds=0;
const offline=createNativeApiHandler(async()=>null,async()=>{builds++;throw Error('Database offline');});
for(const url of ['/api/admin/merchants','/api/admin/me','/api/v1/subscription/status',
  '/api/v1/subscription/plans/private','/api/health/private']){
  const req={url,method:'GET',headers:{'x-auth-sub':'forged','x-auth-email-verified':'true','x-internal-user':'admin','x-newhope-gateway-token':'forged'}};
  const res=response();await offline(req,res);
  assert.equal(res.code,401,url);assert.equal(res.body.error,'AUTHENTICATION_REQUIRED');
  assert.deepEqual(req.headers,{},'Forged identity is removed before runtime initialization');
  assert.equal(res.headers['Cache-Control'],'no-store');
}
assert.equal(builds,0,'Anonymous requests never connect or seed the DB, including when it is offline');

const observed:Array<{url:string;subject:string|undefined}>=[];
const app=((req:any,res:any)=>{observed.push({url:req.url,subject:req.headers['x-auth-sub']});res.json({ok:true});}) as unknown as Express;
const authenticated=createNativeApiHandler(async req=>req.headers.authorization==='Bearer A'?{subject:'owner-A'}:
  req.headers.authorization==='Bearer B'?{subject:'owner-B'}:null,async()=>{builds++;return app;});
for(const token of ['A','B']){
  const res=response();await authenticated({url:'/api/admin/merchants',method:'GET',headers:{authorization:'Bearer '+token,'x-auth-sub':'forged'}},res);
  assert.equal(res.code,200);
}
assert.equal(builds,1,'Warm runtime is reused without caching a user principal');
assert.deepEqual(observed.map(row=>row.subject),['owner-A','owner-B']);
const denied=response();await authenticated({url:'/api/admin/merchants',method:'GET',headers:{}},denied);
assert.equal(denied.code,401,'A warm authenticated runtime does not authorize an anonymous request');
assert.equal(observed.length,2);
const publicOnly=createNativeApiHandler(async()=>{throw Error('Public route must not require bearer');},async()=>app);
for(const url of ['/api/v1/subscription/plans','/api/v1/webhooks/doku','/api/health']){
  const res=response();await publicOnly({url,method:'GET',headers:{'x-auth-sub':'forged'}},res);
  assert.equal(res.code,200);assert.equal(observed.at(-1)?.subject,undefined);
}
let attempts=0;
const retry=createNativeApiHandler(async()=>({subject:'owner-A'}),async()=>{if(++attempts===1)throw Error('Database offline');return app;});
const failed=response();await retry({url:'/api/admin/me',method:'GET',headers:{}},failed);assert.equal(failed.code,503);
const recovered=response();await retry({url:'/api/admin/me',method:'GET',headers:{}},recovered);assert.equal(recovered.code,200);assert.equal(attempts,2);
console.log('PASS: native admin/private API authenticates before DB initialization; exact public allowlist, forged-header rejection, account-isolated warm runtime and startup retry');
