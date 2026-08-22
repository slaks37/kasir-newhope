/**
 * PUT / DELETE satu artikel blog.
 *
 * Keduanya lewat layaniTulis, jadi keduanya menuntut alasan tertulis dan
 * tercatat — termasuk saat gagal. Menerbitkan ke halaman depan adalah tindakan
 * berkepekaan DANGEROUS: yang melakukannya mengubah apa yang dibaca calon
 * pelanggan, dan itu harus punya nama di belakangnya.
 */
import { layaniTulis } from '../../_lib/adminContext';
import { simpanArtikel, hapusArtikel, BlogError } from '../../../src/server/blogRepo';

export default async function handler(req: any, res: any) {
  return layaniTulis(req, res, 'MANAGE_PUBLIC_CONTENT', ['PUT', 'DELETE'], async (db, who) => {
    const postId = String(req.query?.postId ?? '').trim();
    if (!postId) throw Object.assign(new Error('postId wajib diisi.'), { kode: 'POST_ID_REQUIRED' });

    if (req.method === 'DELETE') {
      const terhapus = await hapusArtikel(db, postId);
      if (!terhapus) throw Object.assign(new Error('Artikel tidak ditemukan.'), { kode: 'NOT_FOUND' });
      return { aksi: 'BLOG_DELETE', hasil: { deleted: true } };
    }

    try {
      const { post } = await simpanArtikel(db, req.body ?? {}, who.id, postId);
      return {
        aksi: post.isPublished ? 'BLOG_PUBLISH_UPDATE' : 'BLOG_DRAFT_UPDATE',
        hasil: { post },
      };
    } catch (err: any) {
      if (err instanceof BlogError) throw Object.assign(err, { kode: err.code });
      throw err;
    }
  });
}
