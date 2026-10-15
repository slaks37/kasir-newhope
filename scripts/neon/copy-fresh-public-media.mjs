import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {privateFile} from './backup-common.mjs';
// Presigned URLs are prepared by the branch-scoped Neon connector, never logged.
const branch='br-wandering-snow-azcqie4c',bucket='blog-media';
const source='https://fqxrhumsgigcgjtlbfuo.supabase.co',target='https://'+branch+'.storage.c-3.ap-southeast-1.aws.neon.tech';
const manifest=JSON.parse(privateFile('build/neon/fresh-storage-source-manifest.json'));
const uploads=JSON.parse(privateFile('build/neon/fresh-storage-upload-private.json'));
assert.equal(manifest.sourceProjectId,'fqxrhumsgigcgjtlbfuo');assert.equal(manifest.buckets.length,1);assert.equal(manifest.buckets[0].name,bucket);
assert.equal(uploads.length,manifest.buckets[0].objects.length);
const digest=b=>createHash('sha256').update(b).digest('hex');
const evidence={status:'RUNNING',projectId:'steep-sea-66546931',branchId:branch,scope:'Copy existing public JPEGs only; source and production references unchanged; no credential grants',startedAt:new Date().toISOString(),objects:[]};
function keyPath(key){assert(key&&!/[\\\u0000-\u001f\u007f]/.test(key)&&key.split('/').every(p=>p&&p!=='.'&&p!=='..'));return key.split('/').map(encodeURIComponent).join('/');}
async function bytes(response){assert(response.ok,'PUBLIC_OBJECT_HTTP_FAILURE');assert(/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type')||''));assert(Number(response.headers.get('content-length')||0)<=500000);assert(response.body);let length=0;const chunks=[];for await(const chunk of response.body){length+=chunk.length;assert(length<=500000,'PUBLIC_OBJECT_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);}
const request=(url,options={})=>fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),...options});
try{
 for(let i=0;i<uploads.length;i+=4){await Promise.all(uploads.slice(i,i+4).map(async object=>{
  const expected=manifest.buckets[0].objects.find(o=>o.key===object.key);assert(expected);assert.equal(expected.bytes,object.bytes);assert.equal(expected.contentType,'image/jpeg');
  const path=keyPath(object.key),sourceUrl=source+'/storage/v1/object/public/'+bucket+'/'+path,targetUrl=target+'/'+bucket+'/'+path;
  const signed=new URL(object.upload.url);assert.equal(signed.origin,target);assert.equal(decodeURIComponent(signed.pathname),'/' +bucket+'/'+object.key);assert.equal(object.upload.method,'PUT');assert(Date.parse(object.upload.expires_at)>Date.now());
  const data=await bytes(await request(sourceUrl));assert.equal(data.length,object.bytes);assert(data[0]===255&&data[1]===216&&data[2]===255,'JPEG_SIGNATURE_REQUIRED');
  const hash=digest(data),existing=await request(targetUrl);let reused=false;
  if(existing.status===404){const result=await request(signed.href,{method:'PUT',headers:object.upload.headers,body:data});assert(result.ok,'SIGNED_UPLOAD_FAILED');}
  else {assert.equal(digest(await bytes(existing)),hash,'REFUSE_CONFLICTING_EXISTING_TARGET');reused=true;}
  assert.equal(digest(await bytes(await request(targetUrl))),hash,'PUBLIC_READBACK_HASH_MISMATCH');
  evidence.objects.push({key:object.key,bucket,bytes:data.length,sha256:hash,sourceUrl,targetUrl,reused});
 }));}
 const denied=await request(target+'/'+bucket+'/migration-negative/no-auth.jpg',{method:'PUT',headers:{'content-type':'image/jpeg'},body:new Uint8Array([255,216,255,217])});assert.equal(denied.status,403);
 evidence.objects.sort((a,b)=>a.key.localeCompare(b.key));evidence.objectCount=evidence.objects.length;evidence.totalBytes=evidence.objects.reduce((n,o)=>n+o.bytes,0);evidence.anonymousWriteDenied=true;evidence.status='PASS';
 console.log(JSON.stringify({status:'PASS',objects:evidence.objectCount,bytes:evidence.totalBytes,publicReadbackSha256:true,anonymousWriteDenied:true,sourceWrites:0,productionReferenceChanges:0}));
}catch{evidence.status='FAIL';console.log(JSON.stringify({status:'FAIL',objectsVerified:evidence.objects.length,details:'PRIVATE_STORAGE_RECEIPT_ONLY'}));process.exitCode=2;}
finally{evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/fresh-storage-copy-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});}
