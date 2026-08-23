export type BlogCategory = 
  | 'Semua Kategori'
  | 'Tips Bisnis & Strategi'
  | 'Panduan Kasir & POS'
  | 'FinTech & QRIS'
  | 'Kuliner & F&B'
  | 'Laundry & Jasa'
  | 'Ritel & Minimarket'
  | 'Kisah Sukses UMKM';

export type MediaEmbedType = 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'custom';

export interface BlogMediaEmbed {
  id: string;
  type: MediaEmbedType;
  url: string;
  caption?: string;
}

export interface BlogAuthor {
  name: string;
  role: string;
  /**
   * Opsional. Dulu wajib, dan diisi foto wajah orang asli dari bank foto stok
   * untuk penulis yang tidak ada — foto seseorang yang tidak pernah menulis
   * apa pun di sini, ditampilkan sebagai penulisnya. Tanpa avatar, tampilan
   * blog memakai inisial nama.
   */
  avatar?: string;
}

export interface BlogSEOMetadata {
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string[];
  canonicalUrl?: string;
  ogImage?: string;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: BlogCategory;
  coverImage: string;
  author: BlogAuthor;
  readingTimeMinutes: number;
  tags: string[];
  mediaEmbeds: BlogMediaEmbed[];
  seo: BlogSEOMetadata;
  isPublished: boolean;
  isFeatured?: boolean;
  viewCount: number;
  likesCount: number;
  createdAt: string;
  updatedAt: string;
}
