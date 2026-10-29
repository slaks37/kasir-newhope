import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {S3Client, PutObjectCommand, GetObjectCommand} from '@aws-sdk/client-s3';
import type {BlogMediaProvider} from './blogMedia';

// Credentials are explicit: never use the host's ambient AWS credential chain.
export function createS3BlogMediaProvider(env = process.env): BlogMediaProvider {
  const required = ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_PUBLIC_ORIGIN', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY'] as const;
  if (env.OBJECT_STORAGE_PROVIDER !== 's3' || required.some(key => !env[key])) throw Error('BLOG_OBJECT_STORAGE_NOT_CONFIGURED');
  let endpoint: URL, origin: URL;
  try {
    endpoint = new URL(env.OBJECT_STORAGE_ENDPOINT!);
    origin = new URL(env.OBJECT_STORAGE_PUBLIC_ORIGIN!);
    for (const url of [endpoint, origin]) {
      const localTest = env.NODE_ENV === 'test' && url.protocol === 'http:' && url.hostname === '127.0.0.1';
      if ((!localTest && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error();
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.OBJECT_STORAGE_BUCKET!)) throw Error();
  } catch { throw Error('BLOG_OBJECT_STORAGE_NOT_CONFIGURED'); }
  const client = new S3Client({endpoint: endpoint.href, region: env.OBJECT_STORAGE_REGION || 'auto', forcePathStyle: true, maxAttempts: 1,
    credentials: {accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY!}});
  const bucket = env.OBJECT_STORAGE_BUCKET!;
  return {async upload(bytes, path) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(path) || bytes.length < 100 || bytes.length > 500000) throw Error('INVALID_BLOG_PHOTO');
    const key = `blog-media/${path}`;
    const digest = createHash('sha256').update(bytes).digest('hex');
    const abortSignal = AbortSignal.timeout(18000);
    await client.send(new PutObjectCommand({Bucket: bucket, Key: key, Body: bytes, ContentType: 'image/jpeg', ContentLength: bytes.length,
      CacheControl: 'public, max-age=31536000, immutable', IfNoneMatch: '*', Metadata: {sha256: digest}}), {abortSignal});
    const stored = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}), {abortSignal});
    if (!(stored.Body instanceof Readable) || stored.ContentLength !== bytes.length || stored.ContentType !== 'image/jpeg') {
      if (stored.Body instanceof Readable) stored.Body.destroy();
      throw Error('BLOG_PHOTO_READBACK_FAILED');
    }
    const hash = createHash('sha256');
    let count = 0;
    for await (const chunk of stored.Body as AsyncIterable<Uint8Array>) {
      count += chunk.length;
      if (count > bytes.length) { stored.Body.destroy(); throw Error('BLOG_PHOTO_READBACK_FAILED'); }
      hash.update(chunk);
    }
    if (count !== bytes.length || hash.digest('hex') !== digest) throw Error('BLOG_PHOTO_READBACK_FAILED');
    return new URL(key, origin).href;
  }};
}
