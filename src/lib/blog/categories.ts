import type { BlogCategory } from '../../types/blog';

/** Single source for blog categories: admin form, public pages, API validation. */
export const BLOG_CATEGORIES = [
  'Tips Bisnis & Strategi',
  'Panduan Kasir & POS',
  'FinTech & QRIS',
  'Kuliner & F&B',
  'Laundry & Jasa',
  'Ritel & Minimarket',
  'Kisah Sukses UMKM',
] as const satisfies readonly Exclude<BlogCategory, 'Semua Kategori'>[];

export type PublishedBlogCategory = (typeof BLOG_CATEGORIES)[number];

export const isBlogCategory = (value: unknown): value is PublishedBlogCategory =>
  typeof value === 'string' && (BLOG_CATEGORIES as readonly string[]).includes(value);

/** URL-safe slug for anchors, categories and article slugs. */
export function slugify(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' dan ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96).replace(/-+$/g, '');
}

const CATEGORY_SLUGS: Record<PublishedBlogCategory, string> = {
  'Tips Bisnis & Strategi': 'tips-bisnis',
  'Panduan Kasir & POS': 'panduan-kasir',
  'FinTech & QRIS': 'fintech-qris',
  'Kuliner & F&B': 'kuliner-fnb',
  'Laundry & Jasa': 'laundry-jasa',
  'Ritel & Minimarket': 'ritel-minimarket',
  'Kisah Sukses UMKM': 'kisah-sukses',
};
export const categorySlug = (category: string) => (isBlogCategory(category) ? CATEGORY_SLUGS[category] : slugify(category));
export const categoryFromSlug = (slug: string): PublishedBlogCategory | null =>
  BLOG_CATEGORIES.find(category => categorySlug(category) === slug) ?? null;
