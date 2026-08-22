/**
 * Artikel blog publik — di database, bukan di localStorage peramban.
 *
 * Pemetaan kolom snake_case ke bentuk BlogPost yang dipakai klien dikerjakan di
 * sini, satu kali, supaya tidak ada dua tempat yang menerjemahkan bentuk yang
 * sama dengan aturan sedikit berbeda.
 */

import type { Db } from './db';
import type { BlogPost } from '../types/blog';

/** Nol artikel bukan galat; slug bentrok adalah. */
export class BlogError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'BlogError';
  }
}

const KOLOM = `
  id, slug, title, excerpt, content, category,
  cover_image, author, reading_time_minutes, tags, media_embeds, seo,
  is_published, is_featured, view_count, likes_count,
  published_at, created_at, updated_at`;

function keBlogPost(r: any): BlogPost {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt ?? '',
    content: r.content ?? '',
    category: r.category,
    coverImage: r.cover_image ?? '',
    author: r.author ?? { name: '', role: '', avatar: '' },
    readingTimeMinutes: Number(r.reading_time_minutes ?? 1),
    tags: r.tags ?? [],
    mediaEmbeds: r.media_embeds ?? [],
    seo: r.seo ?? { metaTitle: '', metaDescription: '', metaKeywords: [] },
    isPublished: Boolean(r.is_published),
    isFeatured: Boolean(r.is_featured),
    viewCount: Number(r.view_count ?? 0),
    likesCount: Number(r.likes_count ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Slug dari judul, bila penulis tidak menentukannya sendiri. */
export function keSlug(judul: string): string {
  return judul
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 150);
}

/* --- BACA -------------------------------------------------------------- */

/**
 * Yang dibaca PENGUNJUNG. Dari view, bukan dari tabel.
 *
 * `contract.blog_published` sudah menyaring is_published, jadi draf tidak bisa
 * bocor lewat endpoint yang lupa menambahkan WHERE-nya. Penyaringan yang
 * diletakkan di view berlaku untuk semua pembacanya sekaligus.
 */
export async function daftarTerbit(db: Db, kategori?: string): Promise<BlogPost[]> {
  const { rows } = kategori && kategori !== 'Semua Kategori'
    ? await db.query(
        `SELECT * FROM contract.blog_published WHERE category = $1
          ORDER BY is_featured DESC, published_at DESC NULLS LAST`, [kategori])
    : await db.query(
        `SELECT * FROM contract.blog_published
          ORDER BY is_featured DESC, published_at DESC NULLS LAST`);
  return rows.map((r: any) => keBlogPost({ ...r, is_published: true, created_at: r.updated_at }));
}

export async function satuTerbit(db: Db, slug: string): Promise<BlogPost | null> {
  const { rows } = await db.query(
    `SELECT * FROM contract.blog_published WHERE slug = $1`, [slug]);
  if (!rows.length) return null;
  return keBlogPost({ ...rows[0], is_published: true, created_at: rows[0].updated_at });
}

/** Yang dilihat ADMIN — termasuk draf. */
export async function daftarSemua(db: Db): Promise<BlogPost[]> {
  const { rows } = await db.query(
    `SELECT ${KOLOM} FROM internal.blog_posts ORDER BY updated_at DESC`);
  return rows.map(keBlogPost);
}

/* --- TULIS ------------------------------------------------------------- */

function bacaMasukan(b: any) {
  const title = String(b?.title ?? '').trim();
  if (!title) throw new BlogError('TITLE_REQUIRED', 'Judul wajib diisi.');

  const category = String(b?.category ?? '').trim();
  if (!category) throw new BlogError('CATEGORY_REQUIRED', 'Kategori wajib diisi.');

  return {
    slug: String(b?.slug ?? '').trim() || keSlug(title),
    title: title.slice(0, 240),
    excerpt: String(b?.excerpt ?? '').slice(0, 2000),
    content: String(b?.content ?? ''),
    category: category.slice(0, 60),
    coverImage: b?.coverImage ? String(b.coverImage) : null,
    author: b?.author ?? {},
    readingTimeMinutes: Math.max(1, Math.trunc(Number(b?.readingTimeMinutes) || 1)),
    tags: Array.isArray(b?.tags) ? b.tags.map(String).slice(0, 20) : [],
    mediaEmbeds: Array.isArray(b?.mediaEmbeds) ? b.mediaEmbeds : [],
    seo: b?.seo ?? {},
    isPublished: b?.isPublished === true,
    isFeatured: b?.isFeatured === true,
  };
}

export async function simpanArtikel(
  db: Db,
  body: any,
  olehUserId: string,
  id?: string
): Promise<{ post: BlogPost; kind: 'CREATE' | 'UPDATE' }> {
  const m = bacaMasukan(body);

  try {
    if (id) {
      const { rows } = await db.query(
        `UPDATE internal.blog_posts SET
           slug = $2, title = $3, excerpt = $4, content = $5, category = $6,
           cover_image = $7, author = $8::jsonb, reading_time_minutes = $9,
           tags = $10, media_embeds = $11::jsonb, seo = $12::jsonb,
           is_published = $13, is_featured = $14,
           -- published_at diisi SEKALI, saat pertama kali benar-benar terbit.
           -- Menimpanya di tiap penyuntingan membuat artikel lama melompat ke
           -- puncak daftar hanya karena ada yang memperbaiki satu huruf.
           published_at = CASE WHEN $13 AND published_at IS NULL
                               THEN CURRENT_TIMESTAMP ELSE published_at END,
           published_by = $15,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING ${KOLOM}`,
        [id, m.slug, m.title, m.excerpt, m.content, m.category, m.coverImage,
         JSON.stringify(m.author), m.readingTimeMinutes, m.tags,
         JSON.stringify(m.mediaEmbeds), JSON.stringify(m.seo),
         m.isPublished, m.isFeatured, olehUserId]
      );
      if (!rows.length) throw new BlogError('NOT_FOUND', 'Artikel tidak ditemukan.');
      return { post: keBlogPost(rows[0]), kind: 'UPDATE' };
    }

    const { rows } = await db.query(
      `INSERT INTO internal.blog_posts
         (id, slug, title, excerpt, content, category, cover_image, author,
          reading_time_minutes, tags, media_embeds, seo, is_published, is_featured,
          published_at, published_by)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb,
               $11::jsonb, $12, $13,
               CASE WHEN $12 THEN CURRENT_TIMESTAMP ELSE NULL END, $14)
       RETURNING ${KOLOM}`,
      [m.slug, m.title, m.excerpt, m.content, m.category, m.coverImage,
       JSON.stringify(m.author), m.readingTimeMinutes, m.tags,
       JSON.stringify(m.mediaEmbeds), JSON.stringify(m.seo),
       m.isPublished, m.isFeatured, olehUserId]
    );
    return { post: keBlogPost(rows[0]), kind: 'CREATE' };
  } catch (err: any) {
    if (err instanceof BlogError) throw err;
    // Slug bentrok adalah kesalahan penulis, bukan kerusakan server.
    if (err?.code === '23505') {
      throw new BlogError('SLUG_TAKEN', `Slug "${m.slug}" sudah dipakai artikel lain.`);
    }
    throw err;
  }
}

export async function hapusArtikel(db: Db, id: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM internal.blog_posts WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Penambah penghitung baca. Tidak digerbangi capability — pengunjung anonim
 * yang memicunya — dan sengaja tidak menyentuh kolom lain.
 */
export async function tambahDibaca(db: Db, slug: string): Promise<void> {
  await db.query(
    `UPDATE internal.blog_posts SET view_count = view_count + 1
      WHERE slug = $1 AND is_published`, [slug]);
}
