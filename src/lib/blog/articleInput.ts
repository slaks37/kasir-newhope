import { BLOG_CATEGORIES, isBlogCategory, slugify, type PublishedBlogCategory } from './categories';
import { readingMinutes, renderArticle } from './markdown';

export type FaqItem = { question: string; answer: string };

/** What automation (API/MCP) sends. Only title, excerpt, content and category are required. */
export type ArticleInput = {
  title?: unknown; slug?: unknown; excerpt?: unknown; content?: unknown; category?: unknown;
  tags?: unknown; coverImage?: unknown; coverAlt?: unknown; isFeatured?: unknown; publish?: unknown;
  author?: { name?: unknown; role?: unknown; avatar?: unknown } | unknown;
  seo?: { metaTitle?: unknown; metaDescription?: unknown; focusKeyword?: unknown; keywords?: unknown } | unknown;
  faq?: unknown;
};

export type ArticleRecord = {
  slug: string; title: string; excerpt: string; content: string; category: PublishedBlogCategory;
  tags: string[]; coverImage: string; isFeatured: boolean; isPublished: boolean; readingTimeMinutes: number;
  author: { name: string; role: string; avatar: string };
  seo: { metaTitle: string; metaDescription: string; metaKeywords: string[]; focusKeyword?: string; coverAlt?: string; faq: FaqItem[] };
};

export type ArticleCheck = { ok: boolean; errors: string[]; warnings: string[]; record?: ArticleRecord; stats: { words: number; h2: number; h3: number } };

export const ARTICLE_RULES = {
  title: [20, 100], excerpt: [80, 300], metaDescription: [70, 170], metaTitleMax: 70,
  minWords: 500, recommendedWords: 900, minH2: 3, maxTags: 8, maxFaq: 8,
} as const;

/**
 * Claims the product cannot back up (see docs/design/2026-10-keputusan-produk.md §3)
 * and promises that are unsafe for a payments/POS brand. Blocking them keeps
 * automated articles from reintroducing what was removed from the site.
 */
const FORBIDDEN_CLAIMS: Array<[RegExp, string]> = [
  [/cair(?:kan)?\s+(?:otomatis\s+)?h\s*\+\s*1|pencairan\s+h\s*\+\s*1/i, 'Klaim pencairan H+1 tidak boleh: dana QRIS mengikuti penyedia milik merchant.'],
  [/(?:new hope|kasir)[^.\n]{0,80}(?:deteksi|mendeteksi)[^.\n]{0,40}(?:lunas|paid)\s+otomatis|lunas\s+otomatis[^.\n]{0,60}new hope/i, 'Klaim deteksi lunas otomatis tidak boleh: QRIS dinamis belum tersedia.'],
  [/tanpa\s+biaya\s+admin|mdr\s*0\s*%/i, 'Klaim tanpa biaya admin / MDR 0% tidak boleh dipakai.'],
  [/dijamin\s+(?:untung|laris|omzet|omset)|garansi\s+(?:omzet|omset|untung)/i, 'Janji hasil usaha yang dijamin tidak boleh dipakai.'],
];

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const between = (value: string, [min, max]: readonly [number, number]) => value.length >= min && value.length <= max;
const httpsUrl = (value: unknown) => (typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(value.trim()) ? value.trim() : '');

export function checkArticle(input: ArticleInput): ArticleCheck {
  const errors: string[] = [], warnings: string[] = [];
  const title = text(input.title, 160);
  const excerpt = text(input.excerpt, 400);
  const content = typeof input.content === 'string' ? input.content : '';
  const slug = slugify(text(input.slug, 120) || title);
  const seoIn = (input.seo && typeof input.seo === 'object' ? input.seo : {}) as Record<string, unknown>;
  const authorIn = (input.author && typeof input.author === 'object' ? input.author : {}) as Record<string, unknown>;

  if (!between(title, ARTICLE_RULES.title)) errors.push(`title harus ${ARTICLE_RULES.title[0]}–${ARTICLE_RULES.title[1]} karakter (sekarang ${title.length}).`);
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push('slug tidak valid: hanya huruf kecil, angka dan tanda hubung.');
  if (!between(excerpt, ARTICLE_RULES.excerpt)) errors.push(`excerpt harus ${ARTICLE_RULES.excerpt[0]}–${ARTICLE_RULES.excerpt[1]} karakter (sekarang ${excerpt.length}).`);
  if (!isBlogCategory(input.category)) errors.push(`category harus salah satu dari: ${BLOG_CATEGORIES.join(', ')}.`);
  if (content.length > 120_000) errors.push('content melebihi 120.000 karakter.');

  const rendered = renderArticle(content, title);
  const h2 = rendered.headings.filter(h => h.level === 2).length, h3 = rendered.headings.filter(h => h.level === 3).length;
  if (rendered.words < ARTICLE_RULES.minWords) errors.push(`content terlalu tipis: ${rendered.words} kata (minimal ${ARTICLE_RULES.minWords}).`);
  else if (rendered.words < ARTICLE_RULES.recommendedWords) warnings.push(`content ${rendered.words} kata; ${ARTICLE_RULES.recommendedWords}+ kata biasanya lebih kompetitif.`);
  if (h2 < ARTICLE_RULES.minH2) errors.push(`content butuh minimal ${ARTICLE_RULES.minH2} subjudul H2 (## ...), sekarang ${h2}.`);
  if (/^#\s+/m.test(content)) warnings.push('H1 (# ...) di dalam content diubah menjadi H2; judul halaman memakai field title.');
  if (/<\s*(script|iframe|style)/i.test(content)) warnings.push('HTML mentah (script/iframe/style) tidak dirender dan tampil sebagai teks.');
  for (const [pattern, message] of FORBIDDEN_CLAIMS) if (pattern.test(`${title}\n${excerpt}\n${content}`)) errors.push(message);

  const metaTitle = text(seoIn.metaTitle, 120) || title;
  if (metaTitle.length > ARTICLE_RULES.metaTitleMax) warnings.push(`seo.metaTitle ${metaTitle.length} karakter; Google biasanya memotong di atas ±${ARTICLE_RULES.metaTitleMax}.`);
  let metaDescription = text(seoIn.metaDescription, 300);
  if (!metaDescription) metaDescription = excerpt.length > 160 ? excerpt.slice(0, 157).replace(/\s+\S*$/, '') + '…' : excerpt;
  else if (!between(metaDescription, ARTICLE_RULES.metaDescription)) errors.push(`seo.metaDescription harus ${ARTICLE_RULES.metaDescription[0]}–${ARTICLE_RULES.metaDescription[1]} karakter.`);

  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map(t => text(t, 40)).filter(Boolean))] : [];
  if (tags.length > ARTICLE_RULES.maxTags) errors.push(`tags maksimal ${ARTICLE_RULES.maxTags}.`);
  const keywords = Array.isArray(seoIn.keywords) ? [...new Set(seoIn.keywords.map(k => text(k, 60)).filter(Boolean))].slice(0, 10) : tags;
  const focusKeyword = text(seoIn.focusKeyword, 60);
  if (focusKeyword) {
    const k = focusKeyword.toLowerCase();
    if (!title.toLowerCase().includes(k)) warnings.push('focusKeyword tidak ada di title.');
    if (!rendered.headings.some(h => h.text.toLowerCase().includes(k))) warnings.push('focusKeyword tidak ada di subjudul mana pun.');
    if (!metaDescription.toLowerCase().includes(k)) warnings.push('focusKeyword tidak ada di meta description.');
  }

  const coverImage = httpsUrl(input.coverImage);
  if (input.coverImage && !coverImage) errors.push('coverImage harus URL https.');
  if (!coverImage) warnings.push('Tanpa coverImage, pratinjau di Google/WhatsApp memakai gambar bawaan.');

  const faqIn = Array.isArray(input.faq) ? input.faq : [];
  if (faqIn.length > ARTICLE_RULES.maxFaq) errors.push(`faq maksimal ${ARTICLE_RULES.maxFaq} pertanyaan.`);
  const faq = faqIn.slice(0, ARTICLE_RULES.maxFaq).map(item => ({ question: text((item as FaqItem)?.question, 200), answer: text((item as FaqItem)?.answer, 800) }));
  if (faq.some(f => f.question.length < 10 || f.answer.length < 20)) errors.push('Setiap faq butuh question (≥10 karakter) dan answer (≥20 karakter).');

  const avatar = httpsUrl(authorIn.avatar);
  const record: ArticleRecord = {
    slug, title, excerpt, content: content.trim(), category: (isBlogCategory(input.category) ? input.category : BLOG_CATEGORIES[0]),
    tags, coverImage, isFeatured: input.isFeatured === true, isPublished: input.publish !== false,
    readingTimeMinutes: readingMinutes(rendered.words),
    author: { name: text(authorIn.name, 80) || 'Tim Editorial New Hope POS', role: text(authorIn.role, 80) || 'Editor', avatar },
    seo: { metaTitle, metaDescription, metaKeywords: keywords, ...(focusKeyword ? { focusKeyword } : {}), ...(text(input.coverAlt, 160) ? { coverAlt: text(input.coverAlt, 160) } : {}), faq },
  };
  return { ok: errors.length === 0, errors, warnings, record: errors.length ? undefined : record, stats: { words: rendered.words, h2, h3 } };
}
