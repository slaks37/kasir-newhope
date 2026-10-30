import { createR2BlogMediaProvider, BlogStorageError } from './blogStorage';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { BLOG_PHOTO_MAX_CHARS } from '../lib/blog/photo';

export interface BlogMediaProvider { upload(bytes: Buffer, path: string): Promise<string> }
export const createBlogMediaProvider = createR2BlogMediaProvider;
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
      if (error instanceof BlogStorageError) { res.status(error.status).json({ ok: false, error: error.code }); return; }
      const code = error instanceof Error ? error.message : '';
      res.status(code === 'BLOG_STORAGE_NOT_CONFIGURED' ? 503 : 502).json({ ok: false, error: ['BLOG_STORAGE_NOT_CONFIGURED', 'BLOG_STORAGE_BUCKET_PRIVATE'].includes(code) ? code : 'BLOG_PHOTO_UPLOAD_FAILED' });
    }
  });
}
