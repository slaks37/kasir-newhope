import { S3Client, PutObjectCommand, type PutObjectCommandInput } from '@aws-sdk/client-s3';
import { isIP } from 'node:net';

export class BlogStorageError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function blogStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_BASE_URL'] as const;
  if (names.some(name => !env[name]?.trim())) throw new BlogStorageError(503, 'BLOG_STORAGE_NOT_CONFIGURED');
  let base: URL;
  try { base = new URL(env.R2_PUBLIC_BASE_URL!); } catch { throw new BlogStorageError(503, 'BLOG_STORAGE_INVALID_CONFIG'); }
  if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID!) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET_NAME!) ||
      base.protocol !== 'https:' || base.username || base.password || base.port || base.search || base.hash ||
      isIP(base.hostname.replace(/^\[|\]$/g, '')) || !base.hostname.includes('.') || base.hostname.endsWith('.localhost') ||
      base.hostname.endsWith('.cloudflarestorage.com')) throw new BlogStorageError(503, 'BLOG_STORAGE_INVALID_CONFIG');
  return { account: env.R2_ACCOUNT_ID!, bucket: env.R2_BUCKET_NAME!, base: base.href.replace(/\/$/, ''),
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! } };
}
// Injection is for deterministic tests; production always uses the official SDK.
export type BlogObjectWriter = (config: ReturnType<typeof blogStorageConfig>, input: PutObjectCommandInput) => Promise<unknown>;
const writeObject: BlogObjectWriter = async (config, input) => {
  const client = new S3Client({ region: 'auto', endpoint: `https://${config.account}.r2.cloudflarestorage.com`,
    credentials: config.credentials, maxAttempts: 3, requestChecksumCalculation: 'WHEN_REQUIRED' });
  try { return await client.send(new PutObjectCommand(input), { abortSignal: AbortSignal.timeout(18000) }); }
  finally { client.destroy(); }
};
export function createR2BlogMediaProvider(env: NodeJS.ProcessEnv = process.env, write: BlogObjectWriter = writeObject) {
  return { async upload(bytes: Buffer, path: string): Promise<string> {
    const config = blogStorageConfig(env);
    if (!/^(?:automation\/generated|[a-zA-Z0-9_-]+)\/[a-f0-9-]{36}\.jpg$/.test(path)) throw new BlogStorageError(400, 'INVALID_BLOG_MEDIA_PATH');
    if (bytes.length < 100 || bytes.length > 500000) throw new BlogStorageError(400, 'INVALID_BLOG_PHOTO');
    try {
      await write(config, { Bucket: config.bucket, Key: path, Body: bytes, ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable', IfNoneMatch: '*' });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      throw new BlogStorageError(status === 412 ? 409 : 502, status === 412 ? 'BLOG_MEDIA_ALREADY_EXISTS' : 'BLOG_PHOTO_UPLOAD_FAILED');
    }
    return `${config.base}/${path}`;
  } };
}
