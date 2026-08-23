/**
 * GET /api/v1/blog — artikel untuk PENGUNJUNG.
 *
 * Tanpa autentikasi: ini permukaan publik. Yang menjaganya bukan token
 * melainkan sumbernya — `contract.blog_published` sudah menyaring
 * `is_published`, jadi draf tidak bisa bocor lewat berkas ini walaupun ada yang
 * lupa menuliskan syaratnya.
 */
type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { daftarTerbit, satuTerbit, tambahDibaca } from '../../../src/server/blogRepo';
import { sslUntuk } from '../../../src/server/sslDb.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    pool = new pg.Pool({
      connectionString: url,
      ssl: sslUntuk(url),
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const db = getPool() as any;
  const slug = String(req.query?.slug ?? '').trim();

  try {
    if (slug) {
      const post = await satuTerbit(db, slug);
      if (!post) return res.status(404).json({ ok: false, error: 'POST_NOT_FOUND' });
      // Penghitung baca dinaikkan setelah artikelnya ditemukan, dan
      // kegagalannya tidak boleh menjatuhkan permintaan — pengunjung datang
      // untuk membaca, bukan untuk dihitung.
      tambahDibaca(db, slug).catch(() => {});
      return res.status(200).json({ ok: true, post });
    }

    const kategori = String(req.query?.category ?? '').trim() || undefined;
    return res.status(200).json({ ok: true, posts: await daftarTerbit(db, kategori) });
  } catch (err: any) {
    console.error('[blog] gagal memuat artikel:', err?.message);
    return res.status(503).json({ ok: false, error: 'BLOG_UNAVAILABLE' });
  }
}
