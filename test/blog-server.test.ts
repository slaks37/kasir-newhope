/**
 * Blog di server, bukan di localStorage peramban.
 *
 * Tiga hal yang tidak mungkin sebelum ini: MANAGE_PUBLIC_CONTENT bisa
 * ditegakkan, penerbitan bisa diaudit, dan artikelnya benar-benar sampai ke
 * pengunjung. Yang ketiga paling penting — sebelumnya menulis artikel terasa
 * berhasil dan tidak menerbitkan apa pun ke siapa pun.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bacaPublik from '../api/v1/blog/index';
import { ADA_DB, db, tutupDb, resTiruan } from './helper-db';
import { simpanArtikel, daftarTerbit, hapusArtikel, keSlug, BlogError } from '../src/server/blogRepo';

const d = describe.skipIf(!ADA_DB);

d('blog di server', () => {
  let adminId = '';
  const dibuat: string[] = [];

  beforeAll(async () => {
    const { rows } = await db().query(
      `SELECT id FROM internal.internal_users ORDER BY created_at LIMIT 1`);
    adminId = rows[0]?.id ?? null;
  });

  afterAll(async () => {
    for (const id of dibuat) await hapusArtikel(db() as any, id).catch(() => {});
    await tutupDb();
  });

  const buat = async (b: any) => {
    const { post } = await simpanArtikel(db() as any, b, adminId);
    dibuat.push(post.id);
    return post;
  };

  it('slug diturunkan dari judul bila tidak ditentukan', () => {
    expect(keSlug('Cara Membuka Kafe: Modal 10 Juta!')).toBe('cara-membuka-kafe-modal-10-juta');
  });

  it('DRAF tidak terlihat pengunjung', async () => {
    const post = await buat({
      title: `Draf Uji ${Date.now()}`,
      category: 'Tips Bisnis & Strategi',
      content: 'isi draf',
      isPublished: false,
    });
    const terbit = await daftarTerbit(db() as any);
    expect(terbit.map((p) => p.id)).not.toContain(post.id);
  });

  it('artikel TERBIT sampai ke pengunjung, tanpa autentikasi', async () => {
    const judul = `Terbit Uji ${Date.now()}`;
    const post = await buat({
      title: judul,
      category: 'Panduan Kasir & POS',
      content: 'isi terbit',
      excerpt: 'ringkasan',
      isPublished: true,
    });

    const res = resTiruan();
    await bacaPublik({ method: 'GET', query: {} }, res);
    expect(res._status).toBe(200);
    expect(res._body.posts.map((p: any) => p.id)).toContain(post.id);
  });

  it('membuka satu artikel menaikkan penghitung baca DI SERVER', async () => {
    const post = await buat({
      title: `Hitung Uji ${Date.now()}`,
      category: 'FinTech & QRIS',
      content: 'isi',
      isPublished: true,
    });

    const res = resTiruan();
    await bacaPublik({ method: 'GET', query: { slug: post.slug } }, res);
    expect(res._status).toBe(200);
    expect(res._body.post.slug).toBe(post.slug);

    // Dinaikkan tanpa menunggu balasan, jadi diberi sedikit waktu.
    await new Promise((r) => setTimeout(r, 60));
    const { rows } = await db().query(
      `SELECT view_count FROM internal.blog_posts WHERE id = $1`, [post.id]);
    expect(Number(rows[0].view_count)).toBeGreaterThanOrEqual(1);
  });

  it('slug yang sudah dipakai ditolak sebagai kesalahan penulis, bukan galat server', async () => {
    const judul = `Bentrok Uji ${Date.now()}`;
    const post = await buat({ title: judul, category: 'Kuliner & F&B', isPublished: false });
    await expect(
      simpanArtikel(db() as any, { title: 'Judul lain', slug: post.slug, category: 'Kuliner & F&B' }, adminId)
    ).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
  });

  it('published_at diisi SEKALI, tidak melompat tiap disunting', async () => {
    const post = await buat({
      title: `Waktu Uji ${Date.now()}`,
      category: 'Ritel & Minimarket',
      isPublished: true,
    });
    const { rows: a } = await db().query(
      `SELECT published_at FROM internal.blog_posts WHERE id = $1`, [post.id]);

    await new Promise((r) => setTimeout(r, 30));
    await simpanArtikel(db() as any, {
      title: post.title, category: post.category, content: 'diperbaiki', isPublished: true,
      slug: post.slug,
    }, adminId, post.id);

    const { rows: b } = await db().query(
      `SELECT published_at FROM internal.blog_posts WHERE id = $1`, [post.id]);
    // Kalau melompat, artikel lama naik ke puncak daftar hanya karena ada yang
    // memperbaiki satu huruf.
    expect(new Date(b[0].published_at).getTime()).toBe(new Date(a[0].published_at).getTime());
  });

  it('judul kosong ditolak', async () => {
    await expect(
      simpanArtikel(db() as any, { category: 'Kuliner & F&B' }, adminId)
    ).rejects.toBeInstanceOf(BlogError);
  });
});
