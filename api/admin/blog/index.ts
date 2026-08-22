/**
 * Panel CMS blog — daftar (termasuk draf) dan penerbitan.
 *
 * Menggantikan penyimpanan di localStorage peramban. Yang berubah bukan hanya
 * tempatnya: sampai berkas ini ada, MANAGE_PUBLIC_CONTENT tidak punya tempat
 * untuk ditegakkan, tidak ada yang bisa diaudit, dan artikel yang ditulis admin
 * tidak pernah sampai ke pengunjung mana pun.
 */
import { layaniBaca, layaniTulis } from '../../_lib/adminContext';
import { daftarSemua, simpanArtikel, BlogError } from '../../../src/server/blogRepo';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    return layaniBaca(req, res, 'MANAGE_PUBLIC_CONTENT', (db) =>
      daftarSemua(db).then((rows) => ({ rows }))
    );
  }

  return layaniTulis(req, res, 'MANAGE_PUBLIC_CONTENT', ['POST'], async (db, who) => {
    try {
      const { post, kind } = await simpanArtikel(db, req.body ?? {}, who.id);
      return {
        // Menerbitkan dan menyimpan draf dibedakan di jejak auditnya. Yang
        // pertama mengubah apa yang dibaca publik; yang kedua tidak.
        aksi: post.isPublished ? `BLOG_PUBLISH_${kind}` : `BLOG_DRAFT_${kind}`,
        hasil: { post },
        status: 201,
      };
    } catch (err: any) {
      if (err instanceof BlogError) throw Object.assign(err, { kode: err.code });
      throw err;
    }
  });
}
