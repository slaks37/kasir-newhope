/** Generated editorial illustrations, not photographs of reported events. */
export function generatedBlogCover(title: string): string {
  return /bahan baku|cabai|per porsi|menu|f&b|kopi|kuliner/i.test(title)
    ? '/blog/covers/hpp-ingredients-ai.jpg'
    : '/blog/covers/cash-reconciliation-ai.jpg';
}
export const GENERATED_COVER_CAPTION = 'Ilustrasi dibuat dengan AI; bukan foto kejadian dalam berita.';
