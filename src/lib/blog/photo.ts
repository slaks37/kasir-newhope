export const BLOG_PHOTO_MAX_CHARS = 650000;
export async function prepareBlogPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error('Gunakan JPG, PNG, atau WebP.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw Error('Foto maksimal 5 MB dan tidak boleh kosong.');
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) throw Error('Resolusi foto terlalu besar atau tidak valid.');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Browser tidak dapat memproses foto.');
    for (const edge of [1600, 1200, 960]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.82, .68, .5]) {
        const encoded = canvas.toDataURL('image/jpeg', quality);
        if (encoded.startsWith('data:image/jpeg;base64,') && encoded.length <= BLOG_PHOTO_MAX_CHARS) return encoded;
      }
    }
    throw Error('Foto masih terlalu besar. Pilih gambar yang lebih sederhana.');
  } finally { URL.revokeObjectURL(url); }
}
