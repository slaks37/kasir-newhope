import { Marked, type Tokens } from 'marked';
import { slugify } from './categories';

export type ArticleHeading = { level: 2 | 3; text: string; id: string };

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeUrl = (href: string, images = false) => {
  const value = href.trim();
  if (images) return /^https:\/\//i.test(value) ? value : null;
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(value) ? value : null;
};
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/**
 * Article body as stored (Markdown). Normalises the shapes found in existing
 * content: escaped "\n" sequences, Windows line endings, a leading "# Title"
 * that repeats the page H1, and H1s inside the body (demoted to H2 so a page
 * has exactly one H1).
 */
export function normalizeArticleMarkdown(markdown: string, title = ''): string {
  let text = String(markdown || '').replace(/\r\n?/g, '\n');
  if (!text.includes('\n') && text.includes('\\n')) text = text.replace(/\\n/g, '\n');
  text = text.trim();
  const first = /^#\s+(.+)\n?/.exec(text);
  if (first && title && similar(first[1], title)) text = text.slice(first[0].length).trim();
  return text.replace(/^#\s+/gm, '## ');
}

function similar(a: string, b: string) {
  const x = slugify(a), y = slugify(b);
  return !!x && !!y && (x === y || y.startsWith(x) || x.startsWith(y));
}

/**
 * Markdown → HTML for the public article. Raw HTML in the source is escaped,
 * links are limited to http(s)/mailto/relative, images to https, external links
 * get rel="noopener nofollow". Headings get stable ids for the table of contents.
 */
export function renderArticle(markdown: string, title = ''): { html: string; headings: ArticleHeading[]; words: number } {
  const source = normalizeArticleMarkdown(markdown, title);
  const headings: ArticleHeading[] = [];
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) { return escapeHtml(text); },
      heading(this: any, { tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const level = Math.min(Math.max(depth, 2), 4) as 2 | 3 | 4;
        const text = plain(inner);
        const base = slugify(text) || 'bagian';
        const n = (used.get(base) ?? 0) + 1; used.set(base, n);
        const id = n > 1 ? `${base}-${n}` : base;
        if (level === 2 || level === 3) headings.push({ level, text, id });
        return `<h${level} id="${id}">${inner}</h${level}>\n`;
      },
      link(this: any, { href, title: linkTitle, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        if (!url) return inner;
        const external = /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?kasir\.newhope\.space/i.test(url);
        return `<a href="${escapeHtml(url)}"${linkTitle ? ` title="${escapeHtml(linkTitle)}"` : ''}${external ? ' rel="noopener nofollow" target="_blank"' : ''}>${inner}</a>`;
      },
      image({ href, title: imageTitle, text }: Tokens.Image) {
        const url = safeUrl(href, true);
        if (!url) return '';
        const caption = imageTitle || text;
        return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(text || '')}" loading="lazy" decoding="async">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
      },
      table(this: any, token: Tokens.Table) {
        const cell = (c: Tokens.TableCell) => this.parser.parseInline(c.tokens);
        const head = token.header.map(c => `<th>${cell(c)}</th>`).join('');
        const body = token.rows.map(r => `<tr>${r.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  const html = marked.parse(source, { async: false }) as string;
  const words = plain(html).split(/\s+/).filter(Boolean).length;
  return { html, headings, words };
}

export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 200));
