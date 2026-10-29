import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createS3BlogMediaProvider} from '../../src/server/s3BlogMedia';

// Actual SDK signing/HTTP/streaming against a synthetic loopback store. Not R2 acceptance.
const objects = new Map<string, Buffer>();
let corrupt = false, puts = 0, gets = 0;
const server = createServer(async (req, res) => {
  const key = new URL(req.url!, 'http://localhost').pathname;
  assert.match(req.headers.authorization || '', /^AWS4-HMAC-SHA256 /);
  if (req.method === 'PUT') {
    puts++;
    assert.equal(req.headers['if-none-match'], '*');
    assert.equal(req.headers['content-type'], 'image/jpeg');
    if (objects.has(key)) {res.writeHead(412, {'content-type':'application/xml'});res.end('<Error><Code>PreconditionFailed</Code></Error>');return;}
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    objects.set(key, Buffer.concat(chunks));
    res.writeHead(200);res.end();return;
  }
  gets++;
  const bytes = Buffer.from(objects.get(key)!);
  if (corrupt) bytes[0] ^= 1;
  res.writeHead(200, {'content-type':'image/jpeg','content-length':bytes.length});res.end(bytes);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
const env = {NODE_ENV:'test', OBJECT_STORAGE_PROVIDER:'s3', OBJECT_STORAGE_ENDPOINT:endpoint, OBJECT_STORAGE_BUCKET:'fixture-media', OBJECT_STORAGE_PUBLIC_ORIGIN:'https://media.example.invalid', OBJECT_STORAGE_ACCESS_KEY_ID:'synthetic-key', OBJECT_STORAGE_SECRET_ACCESS_KEY:'synthetic-secret'};
try {
  for (const bad of [{OBJECT_STORAGE_PROVIDER:''},{OBJECT_STORAGE_SECRET_ACCESS_KEY:''},{OBJECT_STORAGE_ENDPOINT:'http://external.invalid'}, {OBJECT_STORAGE_PUBLIC_ORIGIN:'https://user:pass@example.invalid'}, {OBJECT_STORAGE_PUBLIC_ORIGIN:'https://example.invalid/path'}, {OBJECT_STORAGE_BUCKET:'../escape'}]) assert.throws(() => createS3BlogMediaProvider({...env,...bad}), /NOT_CONFIGURED/);
  const provider = createS3BlogMediaProvider(env);
  const path = `${randomUUID()}/${randomUUID()}.jpg`, bytes = Buffer.alloc(120, 42);
  await assert.rejects(() => provider.upload(bytes, '../escape.jpg'), /INVALID_BLOG_PHOTO/);
  assert.equal(puts, 0);
  assert.equal(await provider.upload(bytes, path), `https://media.example.invalid/blog-media/${path}`);
  assert.equal(gets, 1);
  await assert.rejects(() => provider.upload(Buffer.alloc(120, 43), path));
  assert.equal(gets, 1, 'failed conditional write never returns an existing object');
  assert.deepEqual([...objects.values()][0], bytes, 'duplicate cannot overwrite');
  corrupt = true;
  await assert.rejects(() => provider.upload(bytes, `${randomUUID()}/${randomUUID()}.jpg`), /READBACK_FAILED/);
  assert.equal(puts, 3, 'SDK does not retry uncertain writes');
  console.log('PASS S3 synthetic HTTP: signed requests, explicit configuration, immutable writes, duplicate rejection and full readback hash');
} finally {await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));}
