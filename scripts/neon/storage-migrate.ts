import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {createNeonObjectStorage,neonStorageConfig,objectKey,publicObjectUrl} from '../../services/shared/objectStorage';

const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]||fallback;};
const env=parse(fs.readFileSync(arg('--env','.env.neon-storage-restore.local')));
const target=JSON.parse(fs.readFileSync(arg('--target','neon/targets/full-restore.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(arg('--manifest','build/neon/storage-source-manifest.json'),'utf8'));
assert.equal(env.NEON_PROJECT_ID,target.projectId);assert.equal(env.NEON_BRANCH_ID,target.branchId);
assert.equal(target.default,false);assert.equal(target.region,'aws-ap-southeast-1');
assert.notEqual(target.branchId,'br-falling-butterfly-az989m86');
assert.equal(manifest.sourceProjectId,'fqxrhumsgigcgjtlbfuo');
assert.equal(manifest.sourceOrigin,'https://fqxrhumsgigcgjtlbfuo.supabase.co');
const config=neonStorageConfig(env),storage=createNeonObjectStorage(config);
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const evidence:any={version:1,scope:'Public JPEG copy to isolated Neon branch; source and production untouched',projectId:target.projectId,branchId:target.branchId,startedAt:new Date().toISOString(),objects:[],status:'RUNNING'};
async function publicBytes(url:string,maxBytes:number) {
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  assert.equal(r.status,200,'Public object not accessible');assert(/^image\/jpeg(?:;|$)/i.test(r.headers.get('content-type')||''),'Unexpected public content type');
  assert(Number(r.headers.get('content-length')||0)<=maxBytes);assert(r.body);
  const reader=r.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;assert(length<=maxBytes,'Public object too large');chunks.push(part.value);}}finally{await reader.cancel();}
  return new Uint8Array(Buffer.concat(chunks));
}
try {
  let totalBytes=0;const seen=new Set<string>();
  for(const bucket of manifest.buckets) {
    assert.equal(bucket.name,'blog-media');assert.equal(bucket.access,'public_read');assert.equal(bucket.maxBytes,500000);
    for(const object of bucket.objects) {
      const key=objectKey(object.key);assert(!seen.has(key),'Duplicate source object');seen.add(key);
      assert.equal(object.contentType,'image/jpeg');assert(object.bytes>=100&&object.bytes<=500000);
      const sourceUrl=manifest.sourceOrigin+'/storage/v1/object/public/'+bucket.name+'/'+key.split('/').map(encodeURIComponent).join('/');
      const bytes=await publicBytes(sourceUrl,bucket.maxBytes);assert.equal(bytes.length,object.bytes,'Source changed since inventory; recapture snapshot');
      const sha256=hash(bytes),exists=await storage.exists(key,bucket.name);
      if(exists)assert.equal(hash(await storage.download(key,bucket.name)),sha256,'Refuse conflicting existing Neon object');
      else{assert(!process.argv.includes('--verify-only'),'Target object missing');await storage.upload(bytes,key,bucket.name,object.contentType);}
      const targetBytes=await storage.download(key,bucket.name);assert.equal(hash(targetBytes),sha256,'Signed readback checksum mismatch');
      const targetUrl=publicObjectUrl(config,bucket.name,key);
      assert.equal(hash(await publicBytes(targetUrl,bucket.maxBytes)),sha256,'Anonymous public read checksum mismatch');
      totalBytes+=bytes.length;evidence.objects.push({bucket:bucket.name,key,bytes:bytes.length,sha256,sourceUrl,targetUrl,reused:exists});
    }
  }
  evidence.totalBytes=totalBytes;evidence.objectCount=evidence.objects.length;evidence.status='PASS';
  // Anonymous upload must be denied even for public-read buckets. No secrets
  // are present in this request and it writes no object on expected 403.
  const denied=await fetch(publicObjectUrl(config,'blog-media','migration-negative/no-auth.jpg'),{method:'PUT',headers:{'content-type':'image/jpeg'},body:new Uint8Array([255,216,255,217]),signal:AbortSignal.timeout(15000)});
  assert.equal(denied.status,403,'Anonymous object upload must be denied');
  evidence.anonymousWriteDenied=true;
  console.log(JSON.stringify({status:'PASS',branchId:target.branchId,objects:evidence.objectCount,bytes:totalBytes,fullSha256Readback:true,publicReads:true,anonymousWriteDenied:true}));
} catch(e) {evidence.status='FAIL';evidence.failure=e instanceof Error?e.message:'Storage migration failed';throw e;}
finally {
  storage.close();evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});
  fs.writeFileSync('build/neon/storage-copy-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
}
