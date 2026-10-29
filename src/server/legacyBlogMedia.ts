const BUCKET='blog-media';
export async function uploadLegacyBlogMedia(bytes:Buffer,path:string):Promise<string>{
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
}
