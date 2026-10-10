import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createBlogMediaProvider, type BlogMediaProvider } from './blogMedia';

export class CoverError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
// Agnes' documented output bucket. Arbitrary URLs and redirects must never
// become an authenticated server-side fetch to private services.
export function coverUrl(value: unknown): URL {
  let url: URL;
  try { url = new URL(String(value || '')); } catch { throw new CoverError(400, 'INVALID_COVER_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    !((url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/agnes-aigc/')) ||
      (url.hostname === 'apihub.agnes-ai.com' && url.pathname.startsWith('/storage/images/')))) {
    throw new CoverError(400, 'INVALID_COVER_URL');
  }
  return url;
}
export function createCoverImporter(provider: BlogMediaProvider = createBlogMediaProvider(), fetchImage: typeof fetch = fetch) {
  return async (input: { imageUrl?: unknown; alt?: unknown }) => {
    const url = coverUrl(input.imageUrl);
    const response = await fetchImage(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok || !/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get('content-type') || '') ||
      Number(response.headers.get('content-length') || 0) > 8_000_000 || !response.body) throw new CoverError(422, 'COVER_DOWNLOAD_REJECTED');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 8_000_000) throw new CoverError(422, 'COVER_TOO_LARGE');
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    let bytes: Buffer;
    try {
      bytes = await sharp(Buffer.concat(chunks), { limitInputPixels: 20_000_000, animated: false })
        .rotate().resize(1200, 675, { fit: 'cover' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    } catch { throw new CoverError(422, 'INVALID_COVER_IMAGE'); }
    if (bytes.length > 500000) throw new CoverError(422, 'COVER_TOO_LARGE');
    const coverImage = await provider.upload(bytes, `automation/generated/${randomUUID()}.jpg`);
    const coverAlt = typeof input.alt === 'string' ? input.alt.replace(/[\u0000-\u001f]/g, '').trim().slice(0,160) : '';
    return { coverImage, coverAlt, coverGenerated: true, coverModel: 'agnes-image-2.1-flash' };
  };
}
