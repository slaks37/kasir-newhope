import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {apiTarget,httpsOrigin,parseAuthCallback} from '../../src/platform/runtime/apiPolicy';
import {openCommandStore,type CommandScope} from '../../src/platform/runtime/commandStore';
import {nativeCors} from '../../services/shared/nativeCors';
for(const v of ['http://api.invalid','https://u:p@api.invalid','https://api.invalid/path','https://api.invalid?secret=1'])assert.throws(()=>httpsOrigin(v));
assert.equal(apiTarget('/api/v1/sync/status','capacitor://localhost',true,'https://api.invalid')?.href,'https://api.invalid/api/v1/sync/status');
assert.equal(apiTarget('https://evil.invalid/api/x','https://app.invalid',true,'https://api.invalid'),null);
assert.equal(apiTarget('/assets/file.js','https://app.invalid',true,'https://api.invalid'),null);
assert.equal(apiTarget('/api/test','https://app.invalid',false,'')?.origin,'https://app.invalid');
const callback='space.newhope.kasir://auth/callback';assert.equal(parseAuthCallback(callback+'?code=valid',callback),'valid');
for(const url of ['evil://auth/callback?code=valid',callback+'/extra?code=x',callback+'?code=a&code=b',callback+'#access_token=secret',callback+'?code=a&next=https://evil.invalid'])assert.equal(parseAuthCallback(url,callback),null);
const response=()=>({statusCode:200,headers:{} as Record<string,string>,body:null as any,status(n:number){this.statusCode=n;return this;},json(b:any){this.body=b;return this;},end(){return this;},setHeader(k:string,v:string){this.headers[k]=v;}});
const req={method:'OPTIONS',headers:{origin:'capacitor://localhost','access-control-request-method':'GET','access-control-request-headers':'authorization'}};
delete process.env.NEW_HOPE_NATIVE_ORIGINS;let res=response();assert(nativeCors(req,res,['GET']));assert.equal(res.statusCode,403);
process.env.NEW_HOPE_NATIVE_ORIGINS='capacitor://localhost';res=response();assert(nativeCors(req,res,['GET']));assert.equal(res.statusCode,204);assert.equal(res.headers['Access-Control-Allow-Origin'],req.headers.origin);assert(!res.headers['Access-Control-Allow-Credentials']);
res=response();assert(nativeCors({...req,headers:{...req.headers,'access-control-request-headers':'x-auth-sub'}},res,['GET']));assert.equal(res.statusCode,403);delete process.env.NEW_HOPE_NATIVE_ORIGINS;
const scope:CommandScope={tenantId:'tenant',merchantId:'merchant',outletId:'outlet',moduleId:'retail',actorRef:'cashier',deviceId:'device-A'};
const c={id:'command',scope,payload:JSON.stringify({amount:100}),createdAt:1};let store=await openCommandStore('test');
await Promise.all([store.enqueue(c),store.enqueue(c)]);assert.equal((await store.list(scope)).length,1);
await assert.rejects(()=>store.enqueue({...c,payload:'different'}));store.close();store=await openCommandStore('test');assert.deepEqual(await store.list(scope),[c]);
for(const field of Object.keys(scope))assert.deepEqual(await store.list({...scope,[field]:'other'}),[]);
await assert.rejects(()=>store.acknowledge(c,'wrong'));assert.equal((await store.list(scope)).length,1);await store.acknowledge(c,c.id);assert.deepEqual(await store.list(scope),[]);store.close();
console.log('PASS platform: exact HTTPS/token targets, strict callback, opt-in CORS, transactional journal restart/concurrency/immutable payload/ACK and all six scope dimensions');
// A native preflight does not connect the DB; the actual request still requires a verified principal.
const {createServerlessBoundary}=await import('../../src/server/serverlessBoundary');
const express=(await import('express')).default;let connections=0;
const app=express();app.use(createServerlessBoundary({name:'sync',routes:{'/api/v1/test':['GET']},bodyLimit:'1kb',unavailableError:'UNAVAILABLE',invalidRequestError:'INVALID',register:(a)=>{a.get('/api/v1/test',(req,res)=>res.json({actor:req.headers['x-auth-sub']}));}},async req=>req.headers.authorization==='Bearer verified'?{subject:'real-actor'}:null,async()=>{connections++;return {} as any;}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port+'/api/v1/test';
try{
 process.env.NEW_HOPE_NATIVE_ORIGINS='capacitor://localhost';
 assert.equal((await fetch(url,{method:'OPTIONS',headers:{origin:'capacitor://localhost','access-control-request-method':'GET','access-control-request-headers':'authorization'}})).status,204);assert.equal(connections,0);
 assert.equal((await fetch(url,{headers:{origin:'capacitor://localhost','x-auth-sub':'forged'}})).status,401);assert.equal(connections,0);
 const authorized=await fetch(url,{headers:{origin:'capacitor://localhost',authorization:'Bearer verified','x-auth-sub':'forged'}});assert.equal(authorized.status,200);assert.equal((await authorized.json()).actor,'real-actor');
 console.log('PASS native CORS boundary: preflight without DB, verified Bearer required, forged identity stripped');
}finally{delete process.env.NEW_HOPE_NATIVE_ORIGINS;await new Promise<void>(r=>server.close(()=>r()));}
