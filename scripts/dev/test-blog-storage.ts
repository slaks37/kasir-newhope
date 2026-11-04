import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createR2BlogMediaProvider, blogStorageConfig, BlogStorageError } from '../../src/server/blogStorage';
const bytes=readFileSync('public/blog/covers/hpp-ingredients-ai.jpg');
const env={R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'synthetic-access',R2_SECRET_ACCESS_KEY:'synthetic-secret',R2_BUCKET_NAME:'blog-media-test',R2_PUBLIC_BASE_URL:'https://media.example/blog-media/'};
const path=`automation/generated/${randomUUID()}.jpg`;
let writes=0;
for(const name of Object.keys(env)) {
 const invalid={...env,[name]:''};
 await assert.rejects(()=>createR2BlogMediaProvider(invalid,async()=>{writes++;}).upload(bytes,path),e=>e instanceof BlogStorageError&&e.status===503&&e.code==='BLOG_STORAGE_NOT_CONFIGURED');
}
assert.equal(writes,0);
for(const base of ['http://media.example','https://user:pass@media.example','https://media.example/?token=hidden','https://127.0.0.1','https://localhost','https://a.r2.cloudflarestorage.com'])assert.throws(()=>blogStorageConfig({...env,R2_PUBLIC_BASE_URL:base}));
const objects=new Set<string>();
const provider=createR2BlogMediaProvider(env,async(config,input)=>{
 writes++;assert.equal(config.bucket,env.R2_BUCKET_NAME);assert.equal(input.ContentType,'image/jpeg');assert.equal(input.IfNoneMatch,'*');assert.deepEqual(input.Body,bytes);
 if(objects.has(input.Key!))throw {$metadata:{httpStatusCode:412}};
 objects.add(input.Key!);
});
assert.equal(await provider.upload(bytes,path),'https://media.example/blog-media/'+path);
await assert.rejects(()=>provider.upload(bytes,path),e=>e instanceof BlogStorageError&&e.code==='BLOG_MEDIA_ALREADY_EXISTS');
const manual=`${randomUUID()}/${randomUUID()}.jpg`;assert.ok((await provider.upload(bytes,manual)).endsWith(manual));
for(const bad of ['../secret.jpg','automation/generated/old.jpg','x/../../y.jpg'])await assert.rejects(()=>provider.upload(bytes,bad));
await assert.rejects(()=>provider.upload(Buffer.alloc(500001),path));
for(const status of [401,403,429,500])await assert.rejects(()=>createR2BlogMediaProvider(env,async()=>{throw {$metadata:{httpStatusCode:status},message:'private secret'};}).upload(bytes,path),e=>e instanceof BlogStorageError&&e.code==='BLOG_PHOTO_UPLOAD_FAILED'&&!e.message.includes('private'));
console.log('PASS: R2 config/HTTPS validation, immutable conditional JPEG write, manual/generated paths, size limits, sanitized storage failures (mock writer; no real R2)');
