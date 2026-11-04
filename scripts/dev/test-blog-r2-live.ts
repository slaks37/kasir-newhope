// Explicit opt-in: only the dedicated staging bucket. Credentials arrive over stdin.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createR2BlogMediaProvider, blogStorageConfig } from '../../src/server/blogStorage';

const line = createInterface({ input: process.stdin });
const env = JSON.parse(await new Promise<string>(resolve => line.once('line', resolve)));
line.close();
assert.equal(env.R2_BUCKET_NAME, 'newhope-blog-staging');
const config = blogStorageConfig(env);
const provider = createR2BlogMediaProvider(env);
const client = new S3Client({ region: 'auto', endpoint: `https://${config.account}.r2.cloudflarestorage.com`, credentials: config.credentials });
const path = `automation/generated/${randomUUID()}.jpg`;
const bytes = await sharp('public/blog/covers/hpp-ingredients-ai.jpg').resize(1200,675).jpeg({quality:80}).toBuffer();
const report: Record<string, unknown> = { bucket: config.bucket, testedAt: new Date().toISOString(), checks: [] };
const checks = report.checks as string[];
try {
  const url = await provider.upload(bytes, path);
  report.imageUrl = url; checks.push('real SDK upload');
  const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: path }));
  assert.equal(head.ContentType, 'image/jpeg'); assert.equal(head.ContentLength, bytes.length);
  assert.match(head.CacheControl || '', /immutable/); checks.push('object existence, metadata and cache');
  try {
  const response = await fetch(url);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(downloaded, bytes);
  const image = await sharp(downloaded).metadata();
  assert.equal(image.width,1200); assert.equal(image.height,675);
  report.sha256 = createHash('sha256').update(downloaded).digest('hex');
  checks.push('public HTTPS 200 and exact JPEG integrity');
  } catch (error) {
    report.httpsFailure = { code: (error as any).cause?.code, message: (error as Error).message };
  }
  await assert.rejects(provider.upload(bytes,path), {status:409,code:'BLOG_MEDIA_ALREADY_EXISTS'});
  checks.push('conditional overwrite rejected');
  await assert.rejects(provider.upload(bytes,'../invalid.jpg'),{status:400,code:'INVALID_BLOG_MEDIA_PATH'});
  checks.push('invalid path rejected');
  await assert.rejects(createR2BlogMediaProvider({...env,R2_SECRET_ACCESS_KEY:'invalid-test-secret'}).upload(bytes,`automation/generated/${randomUUID()}.jpg`),{status:502,code:'BLOG_PHOTO_UPLOAD_FAILED'});
  checks.push('real authentication failure sanitized');
  const unsigned = await fetch(`https://${config.account}.r2.cloudflarestorage.com/${config.bucket}/${path}`, {method:'PUT',body:bytes});
  assert.ok(unsigned.status === 400 || unsigned.status === 401 || unsigned.status === 403);
  checks.push('anonymous S3 write rejected');
  report.status = report.httpsFailure ? 'PARTIAL' : 'PASS';
} catch (e) { report.status='FAIL'; report.error = {name:(e as Error).name,code:(e as any).code,message:(e as Error).message}; process.exitCode=1;
} finally {
  if (process.env.KEEP_R2_TEST_OBJECT !== '1') {
    await client.send(new DeleteObjectCommand({Bucket:config.bucket,Key:path}));
    report.disposableObjectDeleted=true;
  } else {
    report.disposableObjectDeleted=false;
    report.retainedForRemoteVerification=true;
  }
  client.destroy();
  fs.mkdirSync('../../outputs',{recursive:true});
  fs.writeFileSync('../../outputs/newhope-r2-live-test.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
