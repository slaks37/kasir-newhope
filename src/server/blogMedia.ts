import {authProvider} from '../../services/shared/betterAuthConfig';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { BLOG_PHOTO_MAX_CHARS } from '../lib/blog/photo';

const BUCKET = 'blog-media';
export interface BlogMediaProvider { upload(bytes: Buffer, path: string): Promise<string> }
export function createBlogMediaProvider(): BlogMediaProvider {
  return { async upload(bytes, path) {
    if(authProvider()==='neon') {
      const {createS3BlogMediaProvider}=await import('./s3BlogMedia');
      return createS3BlogMediaProvider().upload(bytes,path);
    }
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw Error('BLOG_STORAGE_NOT_CONFIGURED');
    const {createClient}=await import('@supabase/supabase-js');
    const signal = AbortSignal.timeout(18000);
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal }) } });
    const bucket = await client.storage.getBucket(BUCKET);
    if (bucket.error) {
      if (!/bucket not found/i.test(bucket.error.message)) throw Error('BLOG_STORAGE_UNAVAILABLE');
      const created = await client.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 500000, allowedMimeTypes: ['image/jpeg'] });
      if (created.error) {
        const existing = await client.storage.getBucket(BUCKET);
        if (existing.error || !existing.data.public) throw Error('BLOG_STORAGE_UNAVAILABLE');
      }
    } else if (!bucket.data.public) throw Error('BLOG_STORAGE_BUCKET_PRIVATE');
    const uploaded = await client.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (uploaded.error) throw Error('BLOG_PHOTO_UPLOAD_FAILED');
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } };
}
export function decodeBlogPhoto(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > BLOG_PHOTO_MAX_CHARS) throw Error('INVALID_BLOG_PHOTO');
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw Error('INVALID_BLOG_PHOTO');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.toString('base64') !== match[1] || bytes.length < 100 || bytes.length > 500000 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw Error('INVALID_BLOG_PHOTO');
  return bytes;
}
export function registerBlogMediaRoutes(app: Express, guard: any, provider = createBlogMediaProvider()) {
  app.post('/api/admin/blog/media', guard('VIEW_SECTOR_ANALYTICS'), async (req: any, res) => {
    if (req.internal?.role !== 'ROLE_SUPERADMIN') { res.status(403).json({ ok: false, error: 'CAPABILITY_DENIED' }); return; }
    let bytes: Buffer;
    try { bytes = decodeBlogPhoto(req.body?.photo); } catch { res.status(400).json({ ok: false, error: 'INVALID_BLOG_PHOTO' }); return; }
    try {
      const url = await provider.upload(bytes, `${req.internal.id}/${randomUUID()}.jpg`);
      res.status(201).json({ ok: true, url });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      res.status(['BLOG_STORAGE_NOT_CONFIGURED','BLOG_OBJECT_STORAGE_NOT_CONFIGURED'].includes(code) ? 503 : 502).json({ ok: false, error: ['BLOG_STORAGE_NOT_CONFIGURED','BLOG_OBJECT_STORAGE_NOT_CONFIGURED', 'BLOG_STORAGE_BUCKET_PRIVATE'].includes(code) ? code : 'BLOG_PHOTO_UPLOAD_FAILED' });
    }
  });
}
