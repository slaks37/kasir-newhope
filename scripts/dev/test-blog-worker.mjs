import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let handler, reads=0, heads=0;
const bucket={async get(){reads++;return {body:new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.close();}}),size:3,httpEtag:'"abc"'};},async head(){heads++;return {size:3,httpEtag:'"abc"'};}};
vm.runInNewContext(fs.readFileSync('infra/cloudflare/newhope-blog-media/worker.js','utf8'),{addEventListener:(_,fn)=>handler=fn,URL,Response,Headers,BLOG_BUCKET:bucket});
async function request(path,options={}){let response;handler({request:new Request('https://media.example'+path,options),respondWith:r=>response=r});return await response;}
const path='/automation/generated/12345678-1234-1234-1234-123456789abc.jpg';
assert.equal((await request(path)).status,200);
assert.equal((await request(path,{method:'HEAD'})).status,200);assert.equal(heads,1);assert.equal(reads,1);
for(const tag of ['"abc"','W/"abc"','"other", W/"abc"','*'])assert.equal((await request(path,{headers:{'If-None-Match':tag}})).status,304);
assert.equal((await request(path,{headers:{'If-None-Match':'"other"'}})).status,200);
for(const p of ['/','/invalid.jpg',path+'?listing=1','/automation/generated/not-a-uuid.jpg'])assert.equal((await request(p)).status,404);
for(const method of ['POST','PUT','DELETE','OPTIONS'])assert.equal((await request(path,{method})).status,405);
bucket.get=async()=>null;assert.equal((await request(path)).status,404);
bucket.get=async()=>{throw Error('private provider detail');};const r=await request(path);assert.equal(r.status,503);assert.equal(await r.text(),'Unavailable');
console.log('PASS: Worker read-only paths, HEAD metadata, conditional ETag, missing objects, unavailable R2 and sanitized failures');
