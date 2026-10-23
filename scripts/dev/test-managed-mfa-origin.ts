import assert from 'node:assert/strict';
import express from 'express';
import {registerNeonAdminMfa} from '../../src/server/neonAdminMfa';
import type {Db} from '../../services/shared/db';
const names=['AUTH_PROVIDER','FULL_NEON_CLEAN_START','FULL_NEON_TARGET','VERCEL_ENV','VERCEL_URL','APP_URL','PUBLIC_APP_URL'] as const;
const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
Object.assign(process.env,{AUTH_PROVIDER:'neon',FULL_NEON_CLEAN_START:'1',FULL_NEON_TARGET:'production',VERCEL_ENV:'production',VERCEL_URL:'kasir-newhope-synthetic-slaks37s-projects.vercel.app',APP_URL:'https://kasir.newhope.space',PUBLIC_APP_URL:'https://kasir.newhope.space'});
let reads=0;const app=express();app.use(express.json());
const db={query:async()=>{reads++;return {rows:[],rowCount:0};}} as unknown as Db;
registerNeonAdminMfa(app,async()=>db,()=> (req:any,res:any,next:any)=>{if(req.headers.authorization!=='Bearer synthetic-admin')return res.status(401).json({ok:false});req.adminPrincipal={subject:'synthetic-admin'};next();});
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const address=server.address();assert(address&&typeof address==='object');
const request=async(origin:string,authorized=true)=>fetch('http://127.0.0.1:'+address.port+'/api/admin/mfa/status',{method:'POST',headers:{origin,'content-type':'application/json',...(authorized?{authorization:'Bearer synthetic-admin'}:{})},body:'{}'});
try{
 const immutable='https://'+process.env.VERCEL_URL;
 assert.equal((await request(immutable)).status,200);assert.equal(reads,1);
 assert.equal((await request(immutable,false)).status,401);assert.equal(reads,1,'Origin permission never replaces membership authentication');
 for(const origin of ['https://kasir-newhope-other-slaks37s-projects.vercel.app','https://foreign.vercel.app','https://kasir-newhope-synthetic-otherteam.vercel.app',immutable+'.evil.invalid','http://'+process.env.VERCEL_URL,immutable+'/path','https://evil.invalid'])assert.equal((await request(origin)).status,403);
 assert.equal(reads,1,'Rejected origins never read MFA data');
 process.env.VERCEL_ENV='preview';assert.equal((await request(immutable)).status,403);
 process.env.VERCEL_ENV='production';process.env.FULL_NEON_CLEAN_START='0';assert.equal((await request(immutable)).status,403);
 process.env.FULL_NEON_CLEAN_START='1';process.env.VERCEL_URL='foreign.vercel.app';assert.equal((await request('https://foreign.vercel.app')).status,403);
 assert.equal((await request('https://kasir.newhope.space')).status,200);
 console.log('PASS production MFA origin: exact own immutable project/team URL, canonical domain, membership required, other deployments/teams/schemes/path/foreign origins denied, no DB access on denial');
}finally{await new Promise<void>(r=>server.close(()=>r()));for(const k of names){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
