import React, { useState, useEffect, useMemo } from 'react';
import { BlogPost, BlogCategory } from '../../types/blog';
import {
  getPublishedBlogPosts,
  getBlogPostBySlug,
  incrementBlogView,
  incrementBlogLikes,
} from '../../lib/blogStorage';
import { MediaEmbedRenderer } from './MediaEmbedRenderer';
import { BlogSEOHead } from './BlogSEOHead';
import {
  BookOpen,
  Search,
  Clock,
  Eye,
  Heart,
  Share2,
  ArrowLeft,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Tag,
  Check,
  Store,
  Flame,
  MessageCircle,
  Copy,
  Calendar,
  TrendingUp,
  Newspaper,
  Award,
  Quote,
  Zap,
  BookmarkCheck,
} from 'lucide-react';

interface BlogHarapanBaruProps {
  initialSlug?: string | null;
  onBackToHome: () => void;
  onOpenLogin?: () => void;
  onOpenRegister?: () => void;
}

const POSTS_PER_PAGE = 6;

export const BlogHarapanBaru: React.FC<BlogHarapanBaruProps> = ({
  initialSlug,
  onBackToHome,
  onOpenLogin,
  onOpenRegister,
}) => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<BlogCategory>('Semua Kategori');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});

  const reloadPosts = async () => {
    try {
      const res = await fetch('/api/v1/blog');
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && Array.isArray(data.posts) && data.posts.length > 0) {
          setPosts(data.posts);
          return;
        }
      }
    } catch {
      // Fallback ke local storage jika serverless route offline
    }
    const pub = getPublishedBlogPosts();
    setPosts(pub);
  };

  useEffect(() => {
    void reloadPosts();
    window.addEventListener('newhope_blog_updated', reloadPosts);
    return () => window.removeEventListener('newhope_blog_updated', reloadPosts);
  }, []);

  // Tangani navigasi slug via hash URL (#blog/slug)
  useEffect(() => {
    let active = true;
    if (initialSlug) {
      const local = getBlogPostBySlug(initialSlug);
      if (local && active) setSelectedPost(local);

      fetch(`/api/v1/blog/${encodeURIComponent(initialSlug)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (active && data?.ok && data.post) {
            setSelectedPost(data.post);
          }
        })
        .catch(() => {});

      if (local) incrementBlogView(local.id);
    } else {
      setSelectedPost(null);
    }
    return () => {
      active = false;
    };
  }, [initialSlug]);

  // Reset ke halaman 1 jika kategori atau kata kunci pencarian berubah
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCategory, searchQuery]);

  const categories: BlogCategory[] = [
    'Semua Kategori',
    'Kisah Sukses UMKM',
    'Kuliner & F&B',
    'Laundry & Jasa',
    'FinTech & QRIS',
    'Ritel & Minimarket',
    'Panduan Kasir & POS',
    'Tips Bisnis & Strategi',
  ];

  // Filter posts
  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      const matchesCategory =
        selectedCategory === 'Semua Kategori' || p.category === selectedCategory;
      const matchesSearch =
        searchQuery.trim() === '' ||
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [posts, selectedCategory, searchQuery]);

  // Featured Post (Kisah Utama)
  const featuredPost = useMemo(() => {
    return posts.find((p) => p.isFeatured) || posts[0];
  }, [posts]);

  // 5 Berita/Kisah Terpopuler untuk Sidebar
  const trendingPosts = useMemo(() => {
    return [...posts]
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 5);
  }, [posts]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / POSTS_PER_PAGE));
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const paginatedPosts = useMemo(() => {
    return filteredPosts.slice(startIndex, startIndex + POSTS_PER_PAGE);
  }, [filteredPosts, startIndex]);

  // Artikel rekomendasi saat membaca detail
  const relatedPosts = useMemo(() => {
    if (!selectedPost) return [];
    return posts
      .filter((p) => p.id !== selectedPost.id)
      .slice(0, 3);
  }, [posts, selectedPost]);

  const handleSelectPost = (p: BlogPost) => {
    setSelectedPost(p);
    incrementBlogView(p.id);
    window.location.hash = `blog/${p.slug}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToList = () => {
    setSelectedPost(null);
    window.location.hash = 'blog';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
    const elem = document.getElementById('portal-cerita');
    if (elem) {
      elem.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 380, behavior: 'smooth' });
    }
  };

  const handleLikePost = (p: BlogPost, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!likedPosts[p.id]) {
      fetch(`/api/v1/blog/${encodeURIComponent(p.id)}/like`, { method: 'POST' }).catch(() => {});
      incrementBlogLikes(p.id);
      setLikedPosts((prev) => ({ ...prev, [p.id]: true }));
      void reloadPosts();
      if (selectedPost && selectedPost.id === p.id) {
        setSelectedPost({ ...selectedPost, likesCount: selectedPost.likesCount + 1 });
      }
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const handleShareWhatsApp = (p: BlogPost) => {
    const text = `Baca cerita menarik ini di Warta Harapan Baru: "${p.title}"\n\n${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const formatIndonesianDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-amber-500 selection:text-slate-950 font-sans">
      {/* Dynamic SEO Injector */}
      <BlogSEOHead post={selectedPost || undefined} isListPortal={!selectedPost} />

      {/* 📰 NEWSPAPER MASTHEAD TOPBAR */}
      <div className="bg-slate-950 text-slate-300 border-b border-slate-800 text-[11px] py-1.5 px-4 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-3">
            <span className="flex items-center space-x-1.5 text-amber-400 font-bold uppercase tracking-wider">
              <Newspaper className="w-3.5 h-3.5" />
              <span>Warta Harapan Baru</span>
            </span>
            <span className="text-slate-600 hidden sm:inline">&bull;</span>
            <span className="text-slate-400 hidden sm:inline flex items-center space-x-1">
              <Calendar className="w-3 h-3" />
              <span>Edisi Digital Mingguan</span>
            </span>
            <span className="text-slate-600 hidden sm:inline">&bull;</span>
            <span className="text-amber-300/80 font-medium hidden md:inline">
              Jurnal Cerita Sukses & Warta FinTech UMKM
            </span>
          </div>

          <div className="flex items-center space-x-4 font-medium">
            <span className="text-slate-400">kasir.newhope.space</span>
          </div>
        </div>
      </div>

      {/* 🌟 1. PORTAL HEADER */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-xl border-b border-slate-200 px-4 lg:px-8 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToHome}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 transition-all cursor-pointer"
            title="Kembali ke Beranda Kasir"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 rounded-xl font-black shadow-md shadow-amber-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-base lg:text-lg text-slate-900 tracking-tight">
                  Warta Harapan Baru
                </span>
                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-full text-[10px] font-black uppercase tracking-wider hidden sm:inline-block">
                  Cerita & Berita
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-medium block">
                Kisah Inspiratif UMKM, Kabar FinTech & Trik Kelola Kasir
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 sm:space-x-3">
          {onOpenLogin && (
            <button
              onClick={onOpenLogin}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-bold text-xs transition-all cursor-pointer hidden sm:flex items-center space-x-1.5"
            >
              <Store className="w-4 h-4 text-amber-600" />
              <span>Masuk Kasir</span>
            </button>
          )}

          <button
            onClick={onOpenRegister || onBackToHome}
            className="px-3.5 sm:px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-slate-950" />
            <span>Coba Gratis 45 Hari</span>
          </button>
        </div>
      </header>

      {/* ⚡ BREAKING NEWS TICKER */}
      {!selectedPost && (
        <div className="bg-amber-50/80 border-b border-amber-200/60 px-4 lg:px-8 py-2 text-xs overflow-hidden">
          <div className="max-w-7xl mx-auto flex items-center space-x-3">
            <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black text-[10px] uppercase rounded-md flex items-center space-x-1 shrink-0">
              <Zap className="w-3 h-3" />
              <span>KABAR UTAMA</span>
            </span>
            <div className="truncate text-slate-700 font-medium text-[11px] sm:text-xs">
              <span className="font-bold text-slate-900">Kisah Sukses:</span> Dari satu gerobak kayu kini miliki 5 cabang kopi omzet 120 juta &bull;
              <span className="font-bold text-slate-900 ml-2">FinTech:</span> Aturan baru QRIS BI 2026 MDR 0% &bull;
              <span className="font-bold text-slate-900 ml-2">Tips Toko:</span> Rahasia blind shift kasir cegah kebocoran modal.
            </div>
          </div>
        </div>
      )}

      {/* 📖 ARTICLE DETAIL VIEW */}
      {selectedPost ? (
        <main className="max-w-4xl mx-auto px-4 lg:px-8 py-8 lg:py-12 space-y-8 animate-fade-in">
          {/* Breadcrumb Navigation */}
          <nav aria-label="Breadcrumb" className="flex items-center justify-between text-xs text-slate-500 border-b border-slate-200 pb-4">
            <button
              onClick={handleBackToList}
              className="inline-flex items-center space-x-1.5 text-amber-600 hover:text-amber-700 font-bold transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Kembali ke Semua Cerita</span>
            </button>

            <div className="hidden sm:flex items-center space-x-1.5 font-medium">
              <span>Warta Harapan Baru</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-700 font-bold">{selectedPost.category}</span>
            </div>
          </nav>

          {/* Article Header */}
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full text-xs font-black uppercase tracking-wide">
                {selectedPost.category}
              </span>
              <span className="text-xs text-slate-500 flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>{formatIndonesianDate(selectedPost.createdAt)}</span>
              </span>
              <span className="text-slate-300">&bull;</span>
              <span className="text-xs text-slate-500 flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{selectedPost.readingTimeMinutes} menit baca</span>
              </span>
              <span className="text-slate-300">&bull;</span>
              <span className="text-xs text-slate-500 flex items-center space-x-1">
                <Eye className="w-3.5 h-3.5 text-slate-400" />
                <span>{selectedPost.viewCount} kali dibaca</span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-slate-900 leading-tight tracking-tight">
              {selectedPost.title}
            </h1>

            {/* Lead Excerpt Box */}
            <div className="p-4 sm:p-5 bg-amber-50/70 border-l-4 border-amber-500 rounded-r-2xl text-slate-700 text-sm sm:text-base font-medium italic leading-relaxed">
              &ldquo;{selectedPost.excerpt}&rdquo;
            </div>

            {/* Author Byline & Social Sharing */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-y border-slate-200">
              <div className="flex items-center space-x-3">
                <img
                  src={selectedPost.author.avatar}
                  alt={selectedPost.author.name}
                  className="w-11 h-11 rounded-full object-cover border-2 border-amber-500 shadow-xs"
                />
                <div>
                  <div className="font-extrabold text-sm text-slate-900">{selectedPost.author.name}</div>
                  <div className="text-xs text-slate-500 font-medium">{selectedPost.author.role}</div>
                </div>
              </div>

              {/* Share & Like Action Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => handleLikePost(selectedPost, e)}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
                    likedPosts[selectedPost.id]
                      ? 'bg-rose-50 border-rose-300 text-rose-600'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                  title="Sukai cerita ini"
                >
                  <Heart className={`w-4 h-4 ${likedPosts[selectedPost.id] ? 'fill-rose-500 text-rose-500' : ''}`} />
                  <span>{selectedPost.likesCount} Suka</span>
                </button>

                <button
                  onClick={() => handleShareWhatsApp(selectedPost)}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
                  title="Bagikan ke WhatsApp"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>

                <button
                  onClick={handleCopyLink}
                  className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                  title="Salin Tautan"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </header>

          {/* Featured Cover Image */}
          <div className="rounded-3xl overflow-hidden border border-slate-200 aspect-video shadow-sm bg-slate-100">
            <img
              src={selectedPost.coverImage}
              alt={selectedPost.title}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Media Embeds (Video / TikTok jika ada) */}
          {selectedPost.mediaEmbeds && selectedPost.mediaEmbeds.length > 0 && (
            <div className="space-y-4 pt-2">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Media Tersemat & Video Edukasi:</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedPost.mediaEmbeds.map((emb) => (
                  <MediaEmbedRenderer key={emb.id} embed={emb} />
                ))}
              </div>
            </div>
          )}

          {/* Article Main Markdown-like Body */}
          <article className="prose prose-slate max-w-none space-y-5 text-slate-800 text-sm sm:text-base leading-relaxed pt-2">
            {selectedPost.content.split('\n\n').map((paragraph, idx) => {
              if (paragraph.startsWith('# ')) {
                return (
                  <h1 key={idx} className="text-2xl sm:text-3xl font-black text-slate-900 pt-4 pb-2 border-b border-slate-200">
                    {paragraph.replace('# ', '')}
                  </h1>
                );
              }
              if (paragraph.startsWith('## ')) {
                return (
                  <h2 key={idx} className="text-xl sm:text-2xl font-black text-amber-700 pt-5 border-b border-slate-200 pb-2">
                    {paragraph.replace('## ', '')}
                  </h2>
                );
              }
              if (paragraph.startsWith('### ')) {
                return (
                  <h3 key={idx} className="text-lg font-extrabold text-slate-900 pt-3">
                    {paragraph.replace('### ', '')}
                  </h3>
                );
              }
              if (paragraph.startsWith('> ')) {
                return (
                  <blockquote key={idx} className="p-4 bg-amber-50/50 border-l-4 border-amber-500 italic text-slate-800 font-medium rounded-r-xl my-4">
                    {paragraph.replace('> ', '')}
                  </blockquote>
                );
              }
              if (paragraph.startsWith('- ')) {
                return (
                  <ul key={idx} className="list-disc list-inside space-y-1.5 pl-2 text-slate-700">
                    {paragraph.split('\n').map((item, iIdx) => (
                      <li key={iIdx}>{item.replace('- ', '')}</li>
                    ))}
                  </ul>
                );
              }
              return (
                <p key={idx} className="text-slate-700 leading-relaxed font-normal">
                  {paragraph}
                </p>
              );
            })}
          </article>

          {/* Tags & Keywords Cloud */}
          <div className="pt-6 border-t border-slate-200 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase mr-2 flex items-center space-x-1">
              <Tag className="w-3.5 h-3.5" />
              <span>Topik:</span>
            </span>
            {selectedPost.tags.map((t, idx) => (
              <span
                key={idx}
                className="px-3 py-1 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-lg shadow-2xs hover:border-amber-400 transition-colors"
              >
                #{t}
              </span>
            ))}
          </div>

          {/* Bottom In-Article CTA Banner */}
          <div className="bg-gradient-to-r from-amber-50 via-amber-100/60 to-orange-50 border border-amber-200 rounded-3xl p-6 lg:p-8 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2 text-amber-800 font-extrabold text-xs uppercase">
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>Solusi Terintegrasi New Hope POS</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-slate-900">
              Siap Menerapkan Sistem Ini di Usaha Anda?
            </h3>
            <p className="text-xs sm:text-sm text-slate-700 font-medium max-w-xl">
              Gunakan New Hope POS untuk mengontrol resep bahan baku, terima QRIS Dinamis otomatis cair H+1, dan akses AI Copilot pintar tanpa kartu kredit.
            </p>
            <div className="pt-2 flex flex-wrap gap-3">
              <button
                onClick={onOpenRegister || onBackToHome}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                Mulai Uji Coba Gratis 45 Hari
              </button>
              <button
                onClick={handleBackToList}
                className="px-5 py-3 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs rounded-xl border border-slate-200 shadow-2xs transition-all cursor-pointer"
              >
                Kembali ke Daftar Cerita
              </button>
            </div>
          </div>

          {/* Recommended / Related Stories */}
          {relatedPosts.length > 0 && (
            <div className="pt-8 border-t border-slate-200 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-900 flex items-center space-x-2">
                  <BookmarkCheck className="w-5 h-5 text-amber-600" />
                  <span>Cerita Inspiratif Lainnya</span>
                </h3>
                <button
                  onClick={handleBackToList}
                  className="text-xs font-bold text-amber-600 hover:text-amber-700"
                >
                  Lihat Semua &rarr;
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {relatedPosts.map((rp) => (
                  <div
                    key={rp.id}
                    onClick={() => handleSelectPost(rp)}
                    className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5 hover:border-amber-400 hover:shadow-sm transition-all cursor-pointer group flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="w-full aspect-video rounded-xl overflow-hidden bg-slate-100">
                        <img
                          src={rp.coverImage}
                          alt={rp.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <span className="text-[10px] font-black uppercase text-amber-700 block">
                        {rp.category}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 line-clamp-2 group-hover:text-amber-600 transition-colors">
                        {rp.title}
                      </h4>
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium pt-2 border-t border-slate-100">
                      {formatIndonesianDate(rp.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      ) : (
        /* 📚 ALL ARTICLES LIST VIEW (EDITORIAL MAGAZINE PORTAL) */
        <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8 lg:py-12 space-y-10 animate-fade-in" id="portal-cerita">
          {/* Top Headline & Search Section */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black uppercase">
                <Flame className="w-3.5 h-3.5 text-amber-600" />
                <span>Pusat Warta & Kisah Nyata UMKM</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
                Kisah Sukses & Berita Bisnis Indonesia
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 font-medium">
                Baca perjalanan inspiratif wirausaha, tren FinTech 2026, panduan operasional kafe, laundry, ritel, dan strategi kasir digital modern.
              </p>
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-80 shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari cerita, topik, atau kata kunci..."
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all shadow-2xs"
              />
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 shadow-sm font-black'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* ⭐ Featured Story Hero Banner (Only on Page 1 without active search) */}
          {currentPage === 1 && featuredPost && selectedCategory === 'Semua Kategori' && searchQuery === '' && (
            <div
              onClick={() => handleSelectPost(featuredPost)}
              className="bg-white rounded-3xl border border-slate-200 p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center hover:border-amber-500 hover:shadow-md transition-all cursor-pointer shadow-xs group"
            >
              <div className="lg:col-span-6 rounded-2xl overflow-hidden border border-slate-200 aspect-video lg:aspect-[4/3] bg-slate-100 relative">
                <img
                  src={featuredPost.coverImage}
                  alt={featuredPost.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <span className="absolute top-3 left-3 px-3 py-1 bg-amber-500 text-slate-950 text-[10px] font-black rounded-lg uppercase tracking-wider shadow-sm">
                  🔥 LAPORAN KHUSUS
                </span>
              </div>

              <div className="lg:col-span-6 space-y-4">
                <div className="flex items-center space-x-2 text-xs">
                  <span className="text-amber-700 font-bold uppercase tracking-wider">{featuredPost.category}</span>
                  <span className="text-slate-300">&bull;</span>
                  <span className="text-slate-500 flex items-center space-x-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{formatIndonesianDate(featuredPost.createdAt)}</span>
                  </span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 group-hover:text-amber-600 transition-colors leading-tight">
                  {featuredPost.title}
                </h2>

                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed line-clamp-3 font-medium">
                  {featuredPost.excerpt}
                </p>

                <div className="flex items-center justify-between pt-4 border-t border-slate-200 text-xs text-slate-500">
                  <div className="flex items-center space-x-2">
                    <img
                      src={featuredPost.author.avatar}
                      alt={featuredPost.author.name}
                      className="w-7 h-7 rounded-full object-cover"
                    />
                    <span className="font-bold text-slate-900">{featuredPost.author.name}</span>
                  </div>

                  <span className="flex items-center space-x-1 font-bold text-amber-600 group-hover:translate-x-1 transition-transform">
                    <span>Baca Kisah Lengkap</span>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 📰 TWO-COLUMN EDITORIAL MAGAZINE LAYOUT */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* LEFT / MAIN COLUMN: Paginated Stories Grid */}
            <div className="lg:col-span-8 space-y-8">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="font-black text-base sm:text-lg text-slate-900 flex items-center space-x-2">
                  <BookOpen className="w-5 h-5 text-amber-600" />
                  <span>Daftar Cerita & Berita</span>
                  {selectedCategory !== 'Semua Kategori' && (
                    <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full">
                      {selectedCategory}
                    </span>
                  )}
                </h3>

                <span className="text-xs text-slate-500 font-medium">
                  {filteredPosts.length} artikel tersedia
                </span>
              </div>

              {filteredPosts.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-3xl border border-slate-200 space-y-3 shadow-xs">
                  <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
                  <h3 className="font-extrabold text-base text-slate-900">Tidak Ada Cerita Ditemukan</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Coba gunakan kata kunci lain atau pilih kategori yang berbeda.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {paginatedPosts.map((p) => (
                    <article
                      key={p.id}
                      onClick={() => handleSelectPost(p)}
                      className="bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col justify-between hover:border-amber-500 hover:shadow-md transition-all cursor-pointer group shadow-xs"
                    >
                      <div className="space-y-4 p-5 sm:p-6">
                        {/* Thumbnail */}
                        <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-100">
                          <img
                            src={p.coverImage}
                            alt={p.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <span className="absolute top-3 left-3 px-2.5 py-1 bg-white/95 backdrop-blur-md text-amber-900 border border-amber-200 rounded-lg text-[10px] font-black uppercase shadow-xs">
                            {p.category}
                          </span>
                        </div>

                        {/* Meta info */}
                        <div className="flex items-center space-x-2 text-[11px] text-slate-500 font-medium">
                          <span>{formatIndonesianDate(p.createdAt)}</span>
                          <span>&bull;</span>
                          <span className="flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{p.readingTimeMinutes} mnt baca</span>
                          </span>
                          <span>&bull;</span>
                          <span className="flex items-center space-x-1">
                            <Eye className="w-3 h-3 text-slate-400" />
                            <span>{p.viewCount} views</span>
                          </span>
                        </div>

                        {/* Title & Excerpt */}
                        <h3 className="font-extrabold text-base text-slate-900 group-hover:text-amber-600 transition-colors leading-snug line-clamp-2">
                          {p.title}
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 font-medium">
                          {p.excerpt}
                        </p>
                      </div>

                      {/* Card Footer */}
                      <div className="p-5 sm:p-6 pt-0 border-t border-slate-100 mt-2 flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          <img
                            src={p.author.avatar}
                            alt={p.author.name}
                            className="w-6 h-6 rounded-full object-cover"
                          />
                          <span className="font-bold text-slate-700 truncate max-w-[120px]">{p.author.name}</span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={(e) => handleLikePost(p, e)}
                            className={`p-1.5 rounded-lg border text-[11px] font-bold flex items-center space-x-1 transition-colors cursor-pointer ${
                              likedPosts[p.id] ? 'bg-rose-50 border-rose-300 text-rose-600' : 'border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                            }`}
                          >
                            <Heart className={`w-3.5 h-3.5 ${likedPosts[p.id] ? 'fill-rose-500 text-rose-500' : ''}`} />
                            <span>{p.likesCount}</span>
                          </button>

                          <span className="p-1.5 rounded-lg bg-amber-50 text-amber-700 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
                            <ChevronRight className="w-4 h-4" />
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {/* 📑 PAGINATION CONTROLS */}
              {totalPages > 1 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
                  <div className="text-xs text-slate-600 font-medium">
                    Menampilkan <span className="font-bold text-slate-900">{startIndex + 1}</span>–<span className="font-bold text-slate-900">{Math.min(startIndex + POSTS_PER_PAGE, filteredPosts.length)}</span> dari <span className="font-bold text-slate-900">{filteredPosts.length}</span> cerita
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {/* Previous Button */}
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center space-x-1 transition-all cursor-pointer ${
                        currentPage === 1
                          ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400'
                          : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 shadow-2xs'
                      }`}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden sm:inline">Sebelumnya</span>
                    </button>

                    {/* Page Numbers */}
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`w-9 h-9 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          currentPage === pageNum
                            ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {pageNum}
                      </button>
                    ))}

                    {/* Next Button */}
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center space-x-1 transition-all cursor-pointer ${
                        currentPage === totalPages
                          ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400'
                          : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 shadow-2xs'
                      }`}
                    >
                      <span className="hidden sm:inline">Selanjutnya</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Sidebar (Kisah Terpopuler & Warta Bisnis) */}
            <aside className="lg:col-span-4 space-y-6">
              {/* Widget 1: 5 Cerita Terpopuler */}
              <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5 shadow-xs">
                <div className="flex items-center space-x-2 pb-3 border-b border-slate-100">
                  <Flame className="w-5 h-5 text-amber-500" />
                  <h3 className="font-black text-sm uppercase tracking-wide text-slate-900">
                    Kisah Paling Populer
                  </h3>
                </div>

                <div className="space-y-4">
                  {trendingPosts.map((tp, idx) => (
                    <div
                      key={tp.id}
                      onClick={() => handleSelectPost(tp)}
                      className="flex items-start space-x-3 group cursor-pointer"
                    >
                      <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs shrink-0 mt-0.5 ${
                        idx === 0
                          ? 'bg-amber-500 text-slate-950'
                          : idx === 1
                          ? 'bg-amber-200 text-amber-950'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {idx + 1}
                      </span>
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-amber-700 block">
                          {tp.category}
                        </span>
                        <h4 className="text-xs font-bold text-slate-900 group-hover:text-amber-600 transition-colors leading-snug line-clamp-2">
                          {tp.title}
                        </h4>
                        <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                          <span>{tp.viewCount} pembaca</span>
                          <span>&bull;</span>
                          <span>{tp.readingTimeMinutes} mnt</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Widget 2: Kutipan Wirausaha Minggu Ini */}
              <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-3xl p-6 text-slate-950 space-y-3 shadow-md shadow-amber-500/10 relative overflow-hidden">
                <Quote className="w-12 h-12 text-slate-950/10 absolute -bottom-2 -right-2" />
                <span className="text-[10px] font-black uppercase tracking-wider bg-slate-950/10 px-2.5 py-1 rounded-md inline-block">
                  KUTIPAN MINGGU INI
                </span>
                <p className="text-xs font-bold leading-relaxed italic">
                  &ldquo;Jangan tunggu bisnis besar baru pakai sistem kasir yang rapi. Justru rapikan sistemnya dulu, baru bisnis Anda bisa membesar tanpa bikin kepala pecah.&rdquo;
                </p>
                <div className="text-[11px] font-black pt-1">
                  — Danang Wicaksono, <span className="font-medium text-slate-900">Founder Kopi Janji Hati</span>
                </div>
              </div>

              {/* Widget 3: Pojok Solusi Kasir New Hope */}
              <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs">
                <div className="flex items-center space-x-2 text-amber-600 text-xs font-black uppercase tracking-wider">
                  <Award className="w-4 h-4" />
                  <span>Kemitraan UMKM</span>
                </div>
                <h4 className="font-black text-sm text-slate-900 leading-snug">
                  Ingin Usaha Anda Masuk di Warta Harapan Baru?
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  Gunakan New Hope POS dan bagikan kisah inspiratif perkembangan outlet Anda kepada ribuan pengusaha di seluruh nusantara.
                </p>
                <button
                  onClick={onOpenRegister || onBackToHome}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Mulai Cerita Anda (Free 45 Hari)
                </button>
              </div>
            </aside>
          </div>
        </main>
      )}

      {/* 🏛️ FOOTER */}
      <footer className="border-t border-slate-200 mt-16 py-8 px-4 text-center text-xs text-slate-500 space-y-2 bg-white">
        <p className="font-medium text-slate-600">
          <b>Warta Harapan Baru</b> &bull; Media Resmi Cerita Sukses & Edukasi FinTech UMKM oleh <b>New Hope POS</b>.
        </p>
        <p>Hak Cipta &copy; 2026 New Hope POS. Seluruh Hak Cipta Dilindungi Undang-Undang.</p>
      </footer>
    </div>
  );
};
