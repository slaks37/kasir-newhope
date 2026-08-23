import React, { useState, useEffect, useCallback } from 'react';
import { BlogPost, BlogCategory } from '../../types/blog';
import {
  getAllBlogPosts,
  getPublishedBlogPosts,
  getBlogPostBySlug,
} from '../../lib/blogStorage';
import { MediaEmbedRenderer } from './MediaEmbedRenderer';
import { AvatarPenulis } from './AvatarPenulis';
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
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Tag,
  Check,
  Building2,
  Coffee,
  Shirt,
  ShoppingBag,
  Store,
  Flame,
  MessageCircle,
  Copy,
} from 'lucide-react';

interface BlogHarapanBaruProps {
  initialSlug?: string | null;
  onBackToHome: () => void;
  onOpenPOS?: () => void;
  onOpenRegister?: () => void;
}

export const BlogHarapanBaru: React.FC<BlogHarapanBaruProps> = ({
  initialSlug,
  onBackToHome,
  onOpenPOS,
  onOpenRegister,
}) => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<BlogCategory>('Semua Kategori');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});

  /*
   * Artikel datang dari SERVER sekarang, bukan localStorage.
   *
   * Sebelumnya tiap peramban punya salinannya sendiri: artikel yang ditulis
   * admin di laptopnya tidak pernah dilihat pengunjung mana pun, dan halaman
   * ini memuat konstanta bawaan. Karena itu pemuatannya kini asinkron, dan
   * kegagalannya harus terlihat — daftar kosong yang diam tidak bisa dibedakan
   * dari "belum ada artikel".
   */
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);

  const reloadPosts = useCallback(() => {
    getPublishedBlogPosts()
      .then((pub) => { setPosts(pub); setGagalMuat(null); })
      .catch((e) => setGagalMuat(e?.message || 'Artikel gagal dimuat.'));
  }, []);

  useEffect(() => {
    reloadPosts();
    window.addEventListener('newhope_blog_updated', reloadPosts);
    return () => window.removeEventListener('newhope_blog_updated', reloadPosts);
  }, [reloadPosts]);

  // Slug dari URL (#blog/slug). Penghitung bacanya dinaikkan SERVER saat
  // artikelnya diambil, jadi tidak ada panggilan terpisah dari sini.
  useEffect(() => {
    let batal = false;
    if (initialSlug) {
      getBlogPostBySlug(initialSlug).then((p) => {
        if (!batal) setSelectedPost(p);
      });
    } else {
      setSelectedPost(null);
    }
    return () => { batal = true; };
  }, [initialSlug]);

  const categories: BlogCategory[] = [
    'Semua Kategori',
    'Kuliner & F&B',
    'Laundry & Jasa',
    'FinTech & QRIS',
    'Tips Bisnis & Strategi',
    'Ritel & Minimarket',
    'Panduan Kasir & POS',
    'Kisah Sukses UMKM',
  ];

  // Filter posts
  const filteredPosts = posts.filter((p) => {
    const matchesCategory =
      selectedCategory === 'Semua Kategori' || p.category === selectedCategory;
    const matchesSearch =
      searchQuery.trim() === '' ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const featuredPost = posts.find((p) => p.isFeatured) || posts[0];

  const handleSelectPost = (p: BlogPost) => {
    setSelectedPost(p);
    // Penghitung baca dinaikkan SERVER saat artikelnya diambil per slug, bukan
    // dari sini. Menghitungnya di klien berarti setiap peramban punya angkanya
    // sendiri — dan angka yang tidak dibagi tidak menghitung apa pun.
    window.location.hash = `blog/${p.slug}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToList = () => {
    setSelectedPost(null);
    window.location.hash = 'blog';
  };

  /*
   * Suka masih tersimpan DI PERANGKAT saja.
   *
   * Menaikkannya di server menuntut endpoint publik yang bisa menulis, dan
   * endpoint seperti itu tanpa pembatasan laju adalah tombol yang bisa ditekan
   * satu juta kali oleh siapa pun. Sampai pembatasnya ada, angkanya jujur
   * disebut sebagai penanda lokal: yang menekan melihat tanda sukanya, dan
   * tidak ada angka palsu yang dilaporkan ke orang lain.
   */
  const handleLikePost = (p: BlogPost, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!likedPosts[p.id]) {
      setLikedPosts((prev) => ({ ...prev, [p.id]: true }));
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const handleShareWhatsApp = (p: BlogPost) => {
    const text = `Baca artikel menarik ini di Blog Harapan Baru: "${p.title}"\n\n${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-amber-500 selection:text-slate-950">
      {/* Dynamic SEO Injector */}
      <BlogSEOHead post={selectedPost || undefined} isListPortal={!selectedPost} />

      {/* 🌟 1. PORTAL HEADER */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-xl border-b border-slate-800 px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToHome}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer"
            title="Kembali ke Beranda"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 rounded-xl font-black shadow-md shadow-amber-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-base lg:text-lg text-white">Blog Harapan Baru</span>
                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full text-[10px] font-black uppercase tracking-wider hidden sm:inline-block">
                  Pusat Edukasi UMKM
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium block">
                Tips Bisnis, Panduan Kasir & Strategi FinTech New Hope POS
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {onOpenPOS && (
            <button
              onClick={onOpenPOS}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 font-bold text-xs transition-all cursor-pointer hidden sm:flex items-center space-x-1.5"
            >
              <Store className="w-4 h-4" />
              <span>Buka Kasir POS</span>
            </button>
          )}

          <button
            onClick={onOpenRegister || onBackToHome}
            className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-slate-950" />
            <span>Coba Gratis 45 Hari</span>
          </button>
        </div>
      </header>

      {/* 📖 ARTICLE DETAIL VIEW */}
      {selectedPost ? (
        <main className="max-w-4xl mx-auto px-4 lg:px-8 py-8 lg:py-12 space-y-8 animate-fade-in">
          {/* Back to Blog Button & Breadcrumbs */}
          <nav aria-label="Breadcrumb" className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-4">
            <button
              onClick={handleBackToList}
              className="inline-flex items-center space-x-1.5 text-amber-400 hover:text-amber-300 font-bold transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Kembali ke Semua Artikel</span>
            </button>

            <div className="hidden sm:flex items-center space-x-1 font-medium">
              <span>Blog Harapan Baru</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              <span className="text-slate-300">{selectedPost.category}</span>
            </div>
          </nav>

          {/* Article Header */}
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-xs font-black uppercase tracking-wide">
                {selectedPost.category}
              </span>
              <span className="text-xs text-slate-400 flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>{selectedPost.readingTimeMinutes} Menit Baca</span>
              </span>
              <span className="text-xs text-slate-400 flex items-center space-x-1">
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                <span>{selectedPost.viewCount} Dilihat</span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
              {selectedPost.title}
            </h1>

            <p className="text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
              {selectedPost.excerpt}
            </p>

            {/* Author Info & Publish Date */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
              <div className="flex items-center space-x-3">
                <AvatarPenulis
                  penulis={selectedPost.author}
                  className="w-11 h-11 text-sm border border-amber-500/40"
                />
                <div>
                  <h4 className="font-extrabold text-sm text-white">{selectedPost.author.name}</h4>
                  <p className="text-[11px] text-slate-400">{selectedPost.author.role}</p>
                </div>
              </div>

              {/* Social Share & Likes */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => handleLikePost(selectedPost, e)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
                    likedPosts[selectedPost.id]
                      ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${likedPosts[selectedPost.id] ? 'fill-rose-500 text-rose-400' : ''}`} />
                  <span>{selectedPost.likesCount}</span>
                </button>

                <button
                  onClick={() => handleShareWhatsApp(selectedPost)}
                  className="p-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer"
                  title="Bagikan ke WhatsApp"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>

                <button
                  onClick={handleCopyLink}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1"
                  title="Salin Tautan Artikel"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedLink ? 'Tersalin!' : 'Salin'}</span>
                </button>
              </div>
            </div>
          </header>

          {/* Featured Cover Image */}
          <div className="rounded-3xl overflow-hidden border border-slate-800 shadow-2xl">
            <img
              src={selectedPost.coverImage}
              alt={selectedPost.title}
              className="w-full h-[320px] sm:h-[450px] object-cover"
            />
          </div>

          {/* Embedded Media Showcase (YouTube / TikTok / IG) */}
          {selectedPost.mediaEmbeds && selectedPost.mediaEmbeds.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-sm font-extrabold text-amber-400 uppercase tracking-wider flex items-center space-x-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <span>Media Tersemat & Video Tutorial:</span>
              </h3>
              <div className="grid grid-cols-1 gap-6">
                {selectedPost.mediaEmbeds.map((emb) => (
                  <MediaEmbedRenderer key={emb.id} embed={emb} />
                ))}
              </div>
            </section>
          )}

          {/* Article Main Body Content */}
          <article className="prose prose-invert max-w-none space-y-6 text-slate-200 text-sm sm:text-base leading-relaxed">
            {selectedPost.content.split('\n\n').map((paragraph, idx) => {
              if (paragraph.startsWith('# ')) {
                return (
                  <h1 key={idx} className="text-2xl sm:text-3xl font-black text-white pt-4">
                    {paragraph.replace('# ', '')}
                  </h1>
                );
              }
              if (paragraph.startsWith('## ')) {
                return (
                  <h2 key={idx} className="text-xl sm:text-2xl font-black text-amber-400 pt-4 border-b border-slate-800 pb-2">
                    {paragraph.replace('## ', '')}
                  </h2>
                );
              }
              if (paragraph.startsWith('### ')) {
                return (
                  <h3 key={idx} className="text-lg font-extrabold text-white pt-2">
                    {paragraph.replace('### ', '')}
                  </h3>
                );
              }
              if (paragraph.startsWith('- ')) {
                return (
                  <ul key={idx} className="list-disc list-inside space-y-1.5 pl-2 text-slate-300">
                    {paragraph.split('\n').map((item, iIdx) => (
                      <li key={iIdx}>{item.replace('- ', '')}</li>
                    ))}
                  </ul>
                );
              }
              return (
                <p key={idx} className="text-slate-300 leading-relaxed font-normal">
                  {paragraph}
                </p>
              );
            })}
          </article>

          {/* Tags & Keywords Cloud */}
          <div className="pt-6 border-t border-slate-800 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase mr-2 flex items-center space-x-1">
              <Tag className="w-3.5 h-3.5" />
              <span>Tagar:</span>
            </span>
            {selectedPost.tags.map((t, idx) => (
              <span
                key={idx}
                className="px-3 py-1 bg-slate-900 border border-slate-800 text-slate-300 text-xs font-bold rounded-lg"
              >
                #{t}
              </span>
            ))}
          </div>

          {/* Bottom In-Article CTA Banner */}
          <div className="bg-gradient-to-r from-amber-500/20 via-slate-900 to-indigo-950/40 border border-amber-500/40 rounded-3xl p-6 lg:p-8 space-y-4 shadow-xl">
            <div className="flex items-center space-x-2 text-amber-400 font-extrabold text-xs uppercase">
              <Sparkles className="w-4 h-4" />
              <span>Solusi Terintegrasi New Hope POS</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-white">
              Siap Menerapkan Sistem Ini di Usaha Anda?
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 font-medium max-w-xl">
              Gunakan New Hope POS untuk mengontrol resep bahan baku, terima QRIS Dinamis otomatis cair H+1, dan akses AI Copilot pintar gratis.
            </p>
            <div className="pt-2 flex flex-wrap gap-3">
              <button
                onClick={onOpenRegister || onBackToHome}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer"
              >
                Mulai Uji Coba Gratis 45 Hari
              </button>
              <button
                onClick={handleBackToList}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition-all cursor-pointer"
              >
                Baca Artikel Lainnya
              </button>
            </div>
          </div>
        </main>
      ) : (
        /* 📚 ALL ARTICLES LIST VIEW */
        <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8 lg:py-12 space-y-10 animate-fade-in">
          {/* Top Headline & Search Section */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-800">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span>Harapan Baru &bull; Media Edukasi UMKM</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
                Inspirasi & Strategi Bisnis Cerdas
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                Temukan tips operasional kafe, laundry, ritel, perbengkelan, dan pengelolaan keuangan kasir modern.
              </p>
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari artikel, topik, atau kata kunci..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
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
                      ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* ⭐ Featured Post Hero Banner */}
          {featuredPost && selectedCategory === 'Semua Kategori' && searchQuery === '' && (
            <div
              onClick={() => handleSelectPost(featuredPost)}
              className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 rounded-3xl border border-slate-800 p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center hover:border-amber-500/50 transition-all cursor-pointer shadow-2xl group"
            >
              <div className="lg:col-span-6 rounded-2xl overflow-hidden border border-slate-800 aspect-video lg:aspect-[4/3]">
                <img
                  src={featuredPost.coverImage}
                  alt={featuredPost.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>

              <div className="lg:col-span-6 space-y-4">
                <div className="flex items-center space-x-2">
                  <span className="px-3 py-1 bg-amber-500 text-slate-950 text-[10px] font-black rounded-full uppercase tracking-wider">
                    ARTIKEL UTAMA
                  </span>
                  <span className="text-xs text-amber-400 font-bold">{featuredPost.category}</span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-white group-hover:text-amber-400 transition-colors leading-tight">
                  {featuredPost.title}
                </h2>

                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed line-clamp-3 font-medium">
                  {featuredPost.excerpt}
                </p>

                <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
                  <div className="flex items-center space-x-2">
                    <AvatarPenulis penulis={featuredPost.author} className="w-7 h-7 text-[10px]" />
                    <span className="font-bold text-white">{featuredPost.author.name}</span>
                  </div>

                  <span className="flex items-center space-x-1 font-bold text-amber-400">
                    <span>Baca Selengkapnya</span>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Grid of Blog Post Cards */}
          {filteredPosts.length === 0 ? (
            <div className="text-center py-16 bg-slate-900/50 rounded-3xl border border-slate-800 space-y-3">
              <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="font-extrabold text-base text-white">Tidak Ada Artikel Ditemukan</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Coba gunakan kata kunci lain atau pilih kategori yang berbeda.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPosts.map((p) => (
                <article
                  key={p.id}
                  onClick={() => handleSelectPost(p)}
                  className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden flex flex-col justify-between hover:border-amber-500/50 hover:shadow-xl transition-all cursor-pointer group"
                >
                  <div className="space-y-4 p-5 sm:p-6">
                    {/* Thumbnail */}
                    <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-950">
                      <img
                        src={p.coverImage}
                        alt={p.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <span className="absolute top-3 left-3 px-2.5 py-1 bg-slate-950/80 backdrop-blur-md text-amber-400 border border-slate-700/80 rounded-lg text-[10px] font-black uppercase">
                        {p.category}
                      </span>
                    </div>

                    {/* Meta info */}
                    <div className="flex items-center space-x-3 text-[11px] text-slate-400 font-medium">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>{p.readingTimeMinutes} mnt baca</span>
                      </span>
                      <span>&bull;</span>
                      <span className="flex items-center space-x-1">
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        <span>{p.viewCount} views</span>
                      </span>
                    </div>

                    {/* Title & Excerpt */}
                    <h3 className="font-extrabold text-base sm:text-lg text-white group-hover:text-amber-400 transition-colors leading-snug line-clamp-2">
                      {p.title}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3 font-medium">
                      {p.excerpt}
                    </p>
                  </div>

                  {/* Card Footer */}
                  <div className="p-5 sm:p-6 pt-0 border-t border-slate-800/80 mt-2 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <AvatarPenulis penulis={p.author} className="w-6 h-6 text-[9px]" />
                      <span className="font-bold text-slate-300 truncate max-w-[120px]">{p.author.name}</span>
                    </div>

                    <button
                      onClick={(e) => handleLikePost(p, e)}
                      className={`p-1.5 rounded-lg border text-[11px] font-bold flex items-center space-x-1 transition-colors cursor-pointer ${
                        likedPosts[p.id] ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${likedPosts[p.id] ? 'fill-rose-500 text-rose-400' : ''}`} />
                      <span>{p.likesCount}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      )}

      {/* 🏛️ FOOTER */}
      <footer className="border-t border-slate-800 mt-16 py-8 px-4 text-center text-xs text-slate-500 space-y-2">
        <p className="font-medium text-slate-400">
          <b>Blog Harapan Baru</b> &bull; Media Resmi Edukasi UMKM oleh <b>New Hope POS</b>.
        </p>
        <p>Hak Cipta &copy; 2026 New Hope POS. Seluruh Hak Cipta Dilindungi Undang-Undang.</p>
      </footer>
    </div>
  );
};
