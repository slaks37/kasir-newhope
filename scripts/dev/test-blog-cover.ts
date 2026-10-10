import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import sharp from 'sharp';
import { createCoverImporter, coverUrl } from '../../src/server/blogCover';
import { registerBlogRoutes } from '../../src/server/blogRoutes';
import type { Db } from '../../services/shared/db';

const fixture=readFileSync('public/blog/covers/hpp-ingredients-ai.jpg');
const validUrl='https://storage.googleapis.com/agnes-aigc/cover.png';
assert.equal(coverUrl('https://platform-outputs.agnes-ai.space/images/t2i/task/output.png').hostname,'platform-outputs.agnes-ai.space');
for(const url of ['http://storage.googleapis.com/agnes-aigc/x.png','https://127.0.0.1/x','https://storage.googleapis.com/other/x','https://storage.googleapis.com.evil.test/agnes-aigc/x','https://user:pass@storage.googleapis.com/agnes-aigc/x','https://storage.googleapis.com:8443/agnes-aigc/x','https://storage.googleapis.com/agnes-aigc/../other/x'])assert.throws(()=>coverUrl(url));
let uploaded=0, fetched=0;
const importer=createCoverImporter({async upload(bytes,path){uploaded++;const meta=await sharp(bytes).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,675);assert.equal(meta.format,'jpeg');assert.ok(bytes.length<=500000);assert.equal(meta.exif,undefined);assert.match(path,/^automation\/generated\/[\w-]+\.jpg$/);return 'https://storage.test/'+path;}},async(_url,options)=>{fetched++;assert.equal(options?.redirect,'error');return new Response(fixture,{headers:{'content-type':'image/jpeg'}});});
await assert.rejects(()=>importer({imageUrl:'https://localhost/x'}));assert.equal(fetched,0);
const result=await importer({imageUrl:validUrl,alt:'Ilustrasi\n biaya bahan'});assert.equal(result.coverGenerated,true);assert.equal(result.coverAlt,'Ilustrasi biaya bahan');
await importer({imageUrl:validUrl});assert.equal(uploaded,2);
for(const response of [new Response('x',{status:302}),new Response('x',{headers:{'content-type':'text/html'}}),new Response('x',{headers:{'content-type':'image/png','content-length':'8000001'}}),new Response('broken',{headers:{'content-type':'image/png'}})]) {
 const bad=createCoverImporter({async upload(){throw Error('Must not upload');}},async()=>response);
 await assert.rejects(()=>bad({imageUrl:validUrl}));
}
const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(8_000_001));c.close();}});
await assert.rejects(()=>createCoverImporter({async upload(){throw Error('Must not upload');}},async()=>new Response(stream,{headers:{'content-type':'image/png'}}))({imageUrl:validUrl}),/COVER_TOO_LARGE/);

// Actual API guard + compare-and-set maintenance. Covers only: no content/status write.
process.env.BLOG_API_KEYS='test-cover-key-01234567890123456789';
let changed=false,updates=0,imports=0;
const oldCover='https://kasir.example/blog/covers/cash-reconciliation-ai.jpg';
const db={async query(sql:string,params:unknown[]){
 if(sql.startsWith('SELECT id'))return {rows:changed?[]:[{id:'post'}],rowCount:changed?0:1};
 assert.match(sql,/UPDATE public.blog_posts SET cover_image=/);assert.ok(!sql.includes('content=')&&!sql.includes('is_published='));
 assert.equal(params[2],'existing-post');assert.equal(params[3],oldCover);updates++;return {rows:[{slug:'existing-post'}],rowCount:1};
}} as unknown as Db;
const app=express();app.use(express.json());registerBlogRoutes(app,async()=>db,async input=>{imports++;return importer(input);});
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base='http://127.0.0.1:'+(server.address() as any).port;
const call=async(body:unknown,key=process.env.BLOG_API_KEYS)=>{const r=await fetch(base+'/api/v1/blog-automation/covers',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
try{
 assert.equal((await call({imageUrl:validUrl},'wrong')).status,401);assert.equal(imports,0);
 assert.equal((await call({imageUrl:validUrl,slug:'existing-post',expectedCover:'https://photo.example/manual.jpg'})).status,400);assert.equal(imports,0);
 changed=true;assert.equal((await call({imageUrl:validUrl,slug:'existing-post',expectedCover:oldCover})).status,409);assert.equal(imports,0);
 changed=false;const repair=await call({imageUrl:validUrl,slug:'existing-post',expectedCover:oldCover});assert.equal(repair.status,201);assert.equal(repair.body.repairedSlug,'existing-post');assert.equal(updates,1);
 const created=await call({imageUrl:validUrl});assert.equal(created.status,201);assert.equal(created.body.coverGenerated,true);assert.equal(updates,1);
 assert.equal((await call({imageUrl:'https://localhost/secret'})).status,400);
 console.log('PASS: cover URL boundary, bounded download, real JPEG normalization, immutable upload, API key guard, concurrent/manual cover protection, cover-only repair');
}finally{await new Promise<void>(r=>server.close(()=>r()));}
