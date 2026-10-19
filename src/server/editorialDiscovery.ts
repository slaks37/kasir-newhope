import type { Db } from '../../services/shared/db';
import { siteUrl } from './blogPages';

export type EditorialCandidate = { title: string; slug?: string; keyword?: string; category?: string; sourceUrls?: string[] };
export const normalizeEditorial = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('id').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const stop = new Set('cara untuk dan di ke dari yang dengan pada anda bisnis usaha umkm panduan tips mengapa bagaimana'.split(' '));
const tokens = (s: string) => new Set(normalizeEditorial(s).split(' ').filter(t => t.length > 1 && !stop.has(t)));
const overlap = (a: Set<string>, b: Set<string>) => { const shared = [...a].filter(t => b.has(t)); return { shared, jaccard: shared.length / (new Set([...a, ...b]).size || 1) }; };
const source = (s: string) => { try { const u = new URL(s); if (!['http:', 'https:'].includes(u.protocol)) return ''; u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/.test(k)) u.searchParams.delete(k); u.searchParams.sort(); return u.toString().replace(/\/$/, ''); } catch { return ''; } };

/** One SELECT gives a complete statement snapshot, without offset drift or an RSS cap.
 * Only published metadata is read. A failed retrieval can never produce UNIQUE.
 */
export async function discoverEditorial(db: Db | (() => Promise<Db>), candidate: EditorialCandidate) {
  const base = { candidateTitle: candidate.title, candidateKeyword: candidate.keyword || '' };
  if (typeof candidate.title !== 'string' || !normalizeEditorial(candidate.title) || candidate.title.length > 300 ||
    [candidate.slug, candidate.keyword, candidate.category].some(v => v !== undefined && (typeof v !== 'string' || v.length > 300)) ||
    (candidate.sourceUrls !== undefined && (!Array.isArray(candidate.sourceUrls) || candidate.sourceUrls.length > 20 || candidate.sourceUrls.some(v => typeof v !== 'string' || v.length > 2048))))
    return { ...base, classification: 'INCONCLUSIVE', matches: [], archive: { complete: false, count: 0 }, explanation: 'Invalid candidate metadata.' };
  try {
    const { rows } = await (typeof db === 'function' ? await db() : db).query(`SELECT id, slug, title, category, seo FROM public.blog_posts WHERE is_published = true ORDER BY created_at DESC, id DESC`);
    const title = normalizeEditorial(candidate.title), ts = tokens(candidate.title), keywords = tokens(candidate.keyword || '');
    const urls = new Set((candidate.sourceUrls || []).map(source).filter(Boolean));
    const matches = rows.flatMap(p => {
      const seo = typeof p.seo === 'string' ? JSON.parse(p.seo) : (p.seo || {});
      const similarity = overlap(ts, tokens(p.title));
      const keyword = overlap(keywords, tokens([seo.focusKeyword || '', ...(seo.metaKeywords || [])].join(' ')));
      const sameCategory = Boolean(candidate.category && normalizeEditorial(candidate.category) === normalizeEditorial(p.category));
      const sources = (seo.sources || []).map((s: { url: string }) => source(s.url)).filter((s: string) => s && urls.has(s));
      const exact = title === normalizeEditorial(p.title) || Boolean(candidate.slug && normalizeEditorial(candidate.slug) === normalizeEditorial(p.slug));
      const near = similarity.shared.length >= 3 && similarity.jaccard >= 0.65;
      const topic = similarity.shared.length >= 2 && similarity.jaccard >= 0.4 || keyword.shared.length >= 2 && keyword.jaccard >= 0.6 && (sameCategory || similarity.shared.length >= 1);
      if (!exact && !near && !topic && !sources.length) return [];
      return [{ title: p.title, slug: p.slug, url: siteUrl() + '/blog/' + encodeURIComponent(p.slug), classification: exact ? 'EXACT_DUPLICATE' : 'TOPIC_OVERLAP',
        indicators: { titleJaccard: similarity.jaccard, sharedTitleTokens: similarity.shared, keywordJaccard: keyword.jaccard, sharedKeywordTokens: keyword.shared, sameCategory, sharedSourceUrls: sources },
        explanation: exact ? 'Normalized title or slug matches.' : sources.length ? 'Stored source URL matches; editorial review required.' : near ? 'Near-duplicate title tokens.' : 'Shared topic tokens or keyword and category evidence.' }];
    });
    return { ...base, classification: matches.some(m => m.classification === 'EXACT_DUPLICATE') ? 'EXACT_DUPLICATE' : matches.length ? 'TOPIC_OVERLAP' : 'UNIQUE', matches,
      archive: { complete: true, count: rows.length }, explanation: 'All published records retrieved in one database statement. Rule-based matches require editorial judgment; UNIQUE means no rule matched.' };
  } catch {
    console.warn('[editorial-discovery] published archive unavailable');
    return { ...base, classification: 'INCONCLUSIVE', matches: [], archive: { complete: false, count: 0 }, explanation: 'Published archive retrieval or metadata parsing failed. Retry before making an editorial decision.' };
  }
}
