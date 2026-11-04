// Authorized disposable production object only; credentials arrive via stdin, never argv or logs.
import {S3Client,PutObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
const line=await new Promise(resolve=>{const r=readline.createInterface({input:process.stdin});r.once('line',s=>{r.close();resolve(s);});});
const c=JSON.parse(line);assert.equal(c.R2_BUCKET_NAME,'newhope-blog-production');
const client=new S3Client({region:'auto',endpoint:`https://${c.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:c.R2_ACCESS_KEY_ID,secretAccessKey:c.R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',maxAttempts:1});
const Key=`automation/generated/${randomUUID()}.jpg`,Bucket=c.R2_BUCKET_NAME;
const bytes=await sharp({create:{width:1200,height:675,channels:3,background:'#c0dace'}}).jpeg().toBuffer();
const sha=b=>createHash('sha256').update(b).digest('hex');
let uploaded=false;
try {
 await client.send(new PutObjectCommand({Bucket,Key,Body:bytes,ContentType:'image/jpeg',CacheControl:'public, max-age=31536000, immutable',IfNoneMatch:'*'}));uploaded=true;
 const head=await client.send(new HeadObjectCommand({Bucket,Key}));assert.equal(head.ContentLength,bytes.length);assert.equal(head.ContentType,'image/jpeg');
 await assert.rejects(client.send(new PutObjectCommand({Bucket,Key,Body:bytes,IfNoneMatch:'*'})),e=>e.$metadata?.httpStatusCode===412);
 const url=c.R2_PUBLIC_BASE_URL+'/'+Key;
 const get=await fetch(url);assert.equal(get.status,200);assert.equal(get.headers.get('content-type'),'image/jpeg');assert.match(get.headers.get('cache-control'),/immutable/);assert.equal(sha(Buffer.from(await get.arrayBuffer())),sha(bytes));
 assert.equal((await fetch(url,{method:'HEAD'})).status,200);
 assert.equal((await fetch(url,{headers:{'If-None-Match':get.headers.get('etag')}})).status,304);
 for(const method of ['PUT','POST','DELETE','OPTIONS'])assert.equal((await fetch(url,{method})).status,405);
 for(const p of ['/','/invalid.jpg',`/automation/generated/${randomUUID()}.jpg`])assert.equal((await fetch(c.R2_PUBLIC_BASE_URL+p)).status,404);
 console.log(JSON.stringify({status:'PASS',bucket:Bucket,url,contentType:head.ContentType,size:bytes.length,sha256:sha(bytes),get:200,head:200,conditional:304,overwrite:412,anonymousWrites:405,listing:404,missing:404,tlsVerified:true}));
} finally {if(uploaded)await client.send(new DeleteObjectCommand({Bucket,Key}));client.destroy();}
