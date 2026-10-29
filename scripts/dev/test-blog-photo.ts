import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prepareBlogPhoto, BLOG_PHOTO_MAX_CHARS } from '../../src/lib/blog/photo';
import { createBlogMediaProvider,decodeBlogPhoto, type BlogMediaProvider } from '../../src/server/blogMedia';
import { registerAdminRoutes } from '../../src/server/adminRoutes';
import type { Db } from '../../services/shared/db';

for (const file of [{type:'image/svg+xml',size:100},{type:'image/png',size:0},{type:'image/jpeg',size:5*1024*1024+1}]) await assert.rejects(()=>prepareBlogPhoto(file as File));
let released=0,attempts=0;
const canvas={width:0,height:0,getContext:()=>({fillStyle:'',fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,'+'A'.repeat(++attempts<4?700000:10000)};
Object.defineProperty(globalThis,'window',{value:{Image:class {src='';naturalWidth=3200;naturalHeight=1600;async decode(){}}}});
Object.defineProperty(globalThis,'document',{value:{createElement:()=>canvas}});
URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{released++;};
assert.ok((await prepareBlogPhoto({type:'image/png',size:100} as File)).length<=BLOG_PHOTO_MAX_CHARS);
assert.deepEqual([canvas.width,canvas.height,released],[1200,600,1]);
canvas.getContext=()=>null as any;
await assert.rejects(()=>prepareBlogPhoto({type:'image/png',size:100} as File));assert.equal(released,2);
const bytes=readFileSync('public/blog/covers/hpp-ingredients-ai.jpg');
const previousProvider=process.env.AUTH_PROVIDER,capturedFetch=globalThis.fetch;let storageCalls=0;
try{process.env.AUTH_PROVIDER='neon';globalThis.fetch=async()=>{storageCalls++;throw Error('UNEXPECTED_STORAGE_REQUEST');};await assert.rejects(()=>createBlogMediaProvider().upload(bytes,'fixture/photo.jpg'),/BLOG_OBJECT_STORAGE_NOT_CONFIGURED/);assert.equal(storageCalls,0,'Neon selection never falls back to Supabase Storage');}finally{globalThis.fetch=capturedFetch;if(previousProvider===undefined)delete process.env.AUTH_PROVIDER;else process.env.AUTH_PROVIDER=previousProvider;}
const photo='data:image/jpeg;base64,'+bytes.toString('base64');
assert.deepEqual(decodeBlogPhoto(photo),bytes);
for(const value of [null,'data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,AAAA',photo+'!', 'data:image/jpeg;base64,'+Buffer.alloc(500001).toString('base64')])assert.throws(()=>decodeBlogPhoto(value));

// Real admin guard, injected membership DB and Storage boundary. No production data.
const adminId=randomUUID(),now=Math.floor(Date.now()/1000),uploads:string[]=[];
let fail='';
const provider:BlogMediaProvider={async upload(data,path){assert.deepEqual(data,bytes);uploads.push(path);if(fail)throw Error(fail);return 'https://storage.test.invalid/'+path;}};
const db={async query(sql:string,params?:unknown[]){
  if(sql.includes('FROM internal.internal_users')) return {rows:[{id:adminId,email:'admin@test.invalid',full_name:'Admin',role:params?.[0]==='growth'?'ROLE_INTERNAL_GROWTH':'ROLE_SUPERADMIN'}],rowCount:1};
  return {rows:[],rowCount:0};
}} as Db;
const app=express();app.use(express.json({limit:'1mb'}));
registerAdminRoutes(app,async()=>db,async req=>{
  const token=String(req.headers.authorization||'');
  return token?{subject:token,aal:token==='no-mfa'?'aal1':'aal2',mfaVerifiedAt:token==='stale'?now-700:now}:null;
},undefined,provider);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+(server.address() as any).port;
async function call(token='admin',value:any=photo){const response=await fetch(base+'/api/admin/blog/media',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:token}:{})},body:JSON.stringify({photo:value})});return {status:response.status,body:await response.json()};}
try {
  assert.equal((await call('')).status,401);
  for(const token of ['growth','no-mfa','stale'])assert.equal((await call(token)).status,403);
  assert.equal(uploads.length,0);
  assert.equal((await call('admin','data:image/svg+xml;base64,PHN2Zz4=')).status,400);
  const first=await call();assert.equal(first.status,201);assert.match(first.body.url,/^https:\/\/storage\.test\.invalid\//);
  await call();assert.equal(uploads.length,2);assert.notEqual(uploads[0],uploads[1]);assert.ok(uploads.every(path=>path.startsWith(adminId+'/')&&path.endsWith('.jpg')));
  fail='BLOG_STORAGE_NOT_CONFIGURED';assert.equal((await call()).status,503);
  fail='secret-provider-detail';const failed=await call();assert.equal(failed.status,502);assert.equal(failed.body.error,'BLOG_PHOTO_UPLOAD_FAILED');
  console.log('PASS: blog photo compression, validation, cleanup, real admin/MFA guard, immutable scoped upload, safe failure');
} finally {await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
