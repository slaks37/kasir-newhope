import React, { useState, useEffect, useCallback } from 'react';
import { BlogPost, BlogCategory, MediaEmbedType, BlogMediaEmbed } from '../../types/blog';
import {
  getAllBlogPosts,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
} from '../../lib/blogStorage';
import { newId } from '../../lib/ids';
import {
  BookOpen,
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Sparkles,
  Save,
  X,
  Play,
  Share2,
  Music2,
  Video,
  Globe,
  Tag,
  Clock,
  Layers,
} from 'lucide-react';

const CATEGORIES: BlogCategory[] = [
  'Tips Bisnis & Strategi',
  'Panduan Kasir & POS',
  'FinTech & QRIS',
  'Kuliner & F&B',
  'Laundry & Jasa',
  'Ritel & Minimarket',
  'Kisah Sukses UMKM',
];

export const BlogManagement: React.FC = () => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Form Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<BlogCategory>('Tips Bisnis & Strategi');
  const [coverImage, setCoverImage] = useState('');
  const [authorName, setAuthorName] = useState('Tim Editorial New Hope POS');
  const [authorRole, setAuthorRole] = useState('Business Consultant');
  const [authorAvatar, setAuthorAvatar] = useState('https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150');
  const [readingTime, setReadingTime] = useState(5);
  const [tagsInput, setTagsInput] = useState('Tips Bisnis, UMKM, Kasir POS');
  const [isPublished, setIsPublished] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);

  // Media embeds
  const [mediaEmbeds, setMediaEmbeds] = useState<BlogMediaEmbed[]>([]);
  const [newEmbedType, setNewEmbedType] = useState<MediaEmbedType>('youtube');
  const [newEmbedUrl, setNewEmbedUrl] = useState('');
  const [newEmbedCaption, setNewEmbedCaption] = useState('');

  // SEO Fields
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [metaKeywordsInput, setMetaKeywordsInput] = useState('');

  /*
   * Artikel disimpan di SERVER sekarang, bukan localStorage peramban.
   *
   * Yang berubah bukan hanya tempatnya. Sebelumnya menulis artikel selalu
   * "berhasil" tanpa menerbitkan apa pun ke pengunjung mana pun, dan tidak ada
   * capability yang bisa ditegakkan. Sekarang tiap mutasi menuntut alasan
   * tertulis dan tercatat di internal_access_log — jadi galatnya harus
   * ditampilkan, bukan ditelan.
   */
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);

  const reloadPosts = useCallback(() => {
    getAllBlogPosts()
      .then((list) => { setPosts(list); setGalat(null); })
      .catch((e) => setGalat(e?.message || 'Daftar artikel gagal dimuat.'));
  }, []);

  useEffect(() => {
    reloadPosts();
  }, [reloadPosts]);

  // Helper auto slug generator
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (!editingPostId) {
      const generatedSlug = newTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
      setSlug(generatedSlug);
      setMetaTitle(`${newTitle} | Blog Harapan Baru`);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingPostId(null);
    setTitle('');
    setSlug('');
    setExcerpt('');
    setContent('');
    setCategory('Tips Bisnis & Strategi');
    setCoverImage('https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=1200');
    setAuthorName('Tim Editorial New Hope POS');
    setAuthorRole('Business Consultant');
    setAuthorAvatar('https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150');
    setReadingTime(5);
    setTagsInput('Tips Bisnis, UMKM, Kasir POS');
    setIsPublished(true);
    setIsFeatured(false);
    setMediaEmbeds([]);
    setMetaTitle('');
    setMetaDescription('');
    setMetaKeywordsInput('');
    setShowModal(true);
  };

  const handleOpenEditModal = (p: BlogPost) => {
    setEditingPostId(p.id);
    setTitle(p.title);
    setSlug(p.slug);
    setExcerpt(p.excerpt);
    setContent(p.content);
    setCategory(p.category);
    setCoverImage(p.coverImage);
    setAuthorName(p.author.name);
    setAuthorRole(p.author.role);
    setAuthorAvatar(p.author.avatar ?? '');
    setReadingTime(p.readingTimeMinutes);
    setTagsInput(p.tags.join(', '));
    setIsPublished(p.isPublished);
    setIsFeatured(!!p.isFeatured);
    setMediaEmbeds(p.mediaEmbeds || []);
    setMetaTitle(p.seo.metaTitle);
    setMetaDescription(p.seo.metaDescription);
    setMetaKeywordsInput(p.seo.metaKeywords.join(', '));
    setShowModal(true);
  };

  const handleAddMediaEmbed = () => {
    if (!newEmbedUrl.trim()) return;
    const newEmb: BlogMediaEmbed = {
      id: newId('emb'),
      type: newEmbedType,
      url: newEmbedUrl.trim(),
      caption: newEmbedCaption.trim() || undefined,
    };
    setMediaEmbeds([...mediaEmbeds, newEmb]);
    setNewEmbedUrl('');
    setNewEmbedCaption('');
  };

  const handleRemoveMediaEmbed = (id: string) => {
    setMediaEmbeds(mediaEmbeds.filter((m) => m.id !== id));
  };

  const handleSavePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) {
      alert('Judul artikel dan Slug URL wajib diisi.');
      return;
    }

    const tagsArray = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const keywordsArray = metaKeywordsInput
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const postPayload = {
      title: title.trim(),
      slug: slug.trim(),
      excerpt: excerpt.trim(),
      content: content.trim(),
      category,
      coverImage: coverImage.trim() || 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=1200',
      author: {
        name: authorName.trim() || 'Tim Editorial',
        role: authorRole.trim() || 'Business Consultant',
        avatar: authorAvatar.trim() || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      },
      readingTimeMinutes: Number(readingTime) || 5,
      tags: tagsArray.length > 0 ? tagsArray : ['UMKM', 'New Hope POS'],
      mediaEmbeds,
      seo: {
        metaTitle: metaTitle.trim() || `${title} | Blog Harapan Baru`,
        metaDescription: metaDescription.trim() || excerpt.trim(),
        metaKeywords: keywordsArray.length > 0 ? keywordsArray : tagsArray,
        canonicalUrl: `https://newhopepos.com/#blog/${slug.trim()}`,
        ogImage: coverImage.trim(),
      },
      isPublished,
      isFeatured,
    };

    // Alasan tertulis WAJIB: menerbitkan ke halaman depan berkepekaan
    // DANGEROUS, dan server menolak permintaan tanpa x-justification.
    const alasan = window.prompt(
      isPublished
        ? 'Alasan menerbitkan artikel ini? (tercatat di jejak audit)'
        : 'Alasan menyimpan perubahan ini? (tercatat di jejak audit)'
    );
    if (!alasan?.trim()) return;

    setMenyimpan(true);
    try {
      if (editingPostId) {
        await updateBlogPost(editingPostId, postPayload, alasan.trim());
      } else {
        await createBlogPost(postPayload, alasan.trim());
      }
      setShowModal(false);
      setGalat(null);
      reloadPosts();
    } catch (e: any) {
      // Ditampilkan, tidak ditelan. Penyimpanan yang gagal diam-diam adalah
      // cara kehilangan tulisan tanpa ada yang tahu.
      setGalat(e?.message || 'Artikel gagal disimpan.');
    } finally {
      setMenyimpan(false);
    }
  };

  const handleDeletePost = async (p: BlogPost) => {
    if (!window.confirm(`Apakah Anda yakin ingin menghapus artikel "${p.title}"?`)) return;
    const alasan = window.prompt('Alasan menghapus artikel ini? (tercatat di jejak audit)');
    if (!alasan?.trim()) return;
    try {
      await deleteBlogPost(p.id, alasan.trim());
      setGalat(null);
      reloadPosts();
    } catch (e: any) {
      setGalat(e?.message || 'Artikel gagal dihapus.');
    }
  };

  const filteredPosts = posts.filter((p) => {
    const matchesCat = selectedCategory === 'ALL' || p.category === selectedCategory;
    const matchesSearch =
      searchQuery.trim() === '' ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.slug.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/*
        * Galat DITAMPILKAN, bukan ditelan.
        *
        * Server menolak mutasi tanpa alasan tertulis, menolak slug yang sudah
        * dipakai, dan menolak pemanggil tanpa MANAGE_PUBLIC_CONTENT. Ketiganya
        * harus terbaca penulis — penyimpanan yang gagal diam-diam adalah cara
        * kehilangan tulisan tanpa ada yang tahu.
        */}
      {galat && (
        <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-5 py-4 rounded-2xl text-xs font-semibold flex items-start justify-between gap-4">
          <span>{galat}</span>
          <button
            onClick={() => setGalat(null)}
            className="text-rose-400 hover:text-rose-200 font-black shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-3xl text-white shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 bg-amber-500 text-slate-950 rounded-2xl font-black shadow-lg shadow-amber-500/20">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">CMS Blog Harapan Baru</h1>
            <p className="text-xs text-slate-400">
              Kelola artikel edukasi, panduan kasir, optimasi SEO Google, dan sematan media.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <a
            href="/#blog"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-2"
          >
            <Eye className="w-4 h-4 text-amber-400" />
            <span>Lihat Blog Publik</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center space-x-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tulis Artikel Baru</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari judul artikel atau slug..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto">
          <span className="text-xs text-slate-500 font-bold">Kategori:</span>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none"
          >
            <option value="ALL">Semua Kategori ({posts.length})</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Articles Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4">Artikel & Slug SEO</th>
                <th className="py-3.5 px-4">Kategori</th>
                <th className="py-3.5 px-4">Penulis</th>
                <th className="py-3.5 px-4 text-center">Media Embed</th>
                <th className="py-3.5 px-4 text-center">Views / Likes</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {filteredPosts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    Belum ada artikel yang cocok dengan pencarian Anda.
                  </td>
                </tr>
              ) : (
                filteredPosts.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3.5 px-4 max-w-sm">
                      <div className="flex items-start space-x-3">
                        <img
                          src={p.coverImage}
                          alt={p.title}
                          className="w-12 h-12 rounded-xl object-cover shrink-0 bg-slate-200 dark:bg-slate-800"
                        />
                        <div className="min-w-0">
                          <p className="font-extrabold text-slate-900 dark:text-white truncate">
                            {p.title}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            /{p.slug}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 rounded-full font-bold text-[10px]">
                        {p.category}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                      {p.author.name}
                    </td>

                    <td className="py-3.5 px-4 text-center">
                      {p.mediaEmbeds && p.mediaEmbeds.length > 0 ? (
                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded font-bold text-[10px]">
                          {p.mediaEmbeds.length} Embed
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">-</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-center font-mono text-slate-600 dark:text-slate-400">
                      {p.viewCount} / {p.likesCount}
                    </td>

                    <td className="py-3.5 px-4 text-center">
                      {p.isPublished ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 rounded-full font-bold text-[10px]">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Publik</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full font-bold text-[10px]">
                          <XCircle className="w-3 h-3 text-slate-400" />
                          <span>Draft</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleOpenEditModal(p)}
                          className="p-2 text-slate-600 hover:text-amber-500 dark:text-slate-400 dark:hover:text-amber-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Edit Artikel"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDeletePost(p)}
                          className="p-2 text-slate-600 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Hapus Artikel"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 📝 CREATE / EDIT BLOG POST MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-4xl w-full p-6 lg:p-8 space-y-6 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-amber-500 text-slate-950 rounded-xl font-bold">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">
                    {editingPostId ? 'Edit Artikel Blog' : 'Tulis Artikel Blog Baru'}
                  </h3>
                  <p className="text-xs text-slate-400">Harapan Baru Media Edukasi UMKM</p>
                </div>
              </div>

              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePost} className="space-y-6">
              {/* Row 1: Title & Slug */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300">Judul Artikel (H1) *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Contoh: Cara Membuka Kafe Modal 10 Juta..."
                    required
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300">SEO URL Slug *</label>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="cara-membuka-kafe-modal-10-juta"
                    required
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-amber-400 font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Row 2: Category & Cover Image */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300">Kategori Artikel *</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as BlogCategory)}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300">Cover Image URL *</label>
                  <input
                    type="url"
                    value={coverImage}
                    onChange={(e) => setCoverImage(e.target.value)}
                    placeholder="https://images.unsplash.com/..."
                    required
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Row 3: Excerpt */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300">Ringkasan Artikel (Excerpt / Meta Description) *</label>
                <textarea
                  rows={2}
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Deskripsi singkat yang memikat pembaca dan ditampilkan di Google Search snippet..."
                  required
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Row 4: Main Content (Markdown) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span>Isi Artikel Konten (Markdown Format) *</span>
                  <span className="text-[11px] text-slate-400 font-normal">Gunakan # H1, ## H2, - List</span>
                </label>
                <textarea
                  rows={8}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="# Judul Pembahasan&#10;&#10;Paragraf penjelasan artikel...&#10;&#10;## Sub Judul&#10;- Poin 1&#10;- Poin 2"
                  required
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 leading-relaxed"
                />
              </div>

              {/* 🎥 MEDIA EMBEDS ASSISTANT */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
                    <Video className="w-4 h-4" />
                    <span>Sematan Media (YouTube, TikTok, Instagram)</span>
                  </span>
                  <span className="text-[11px] text-slate-400">Total {mediaEmbeds.length} Media</span>
                </div>

                {/* Add new embed row */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2">
                  <div className="sm:col-span-3">
                    <select
                      value={newEmbedType}
                      onChange={(e) => setNewEmbedType(e.target.value as MediaEmbedType)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none"
                    >
                      <option value="youtube">YouTube (Video / Shorts)</option>
                      <option value="tiktok">TikTok Video</option>
                      <option value="instagram">Instagram (Post / Reel)</option>
                      <option value="twitter">X / Twitter</option>
                    </select>
                  </div>

                  <div className="sm:col-span-5">
                    <input
                      type="url"
                      value={newEmbedUrl}
                      onChange={(e) => setNewEmbedUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <input
                      type="text"
                      value={newEmbedCaption}
                      onChange={(e) => setNewEmbedCaption(e.target.value)}
                      placeholder="Keterangan video..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-1">
                    <button
                      type="button"
                      onClick={handleAddMediaEmbed}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Existing Embeds List */}
                {mediaEmbeds.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {mediaEmbeds.map((emb) => (
                      <div key={emb.id} className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2 truncate">
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[10px] uppercase font-bold">
                            {emb.type}
                          </span>
                          <span className="text-slate-300 font-mono truncate max-w-xs">{emb.url}</span>
                          {emb.caption && <span className="text-slate-500 italic">({emb.caption})</span>}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveMediaEmbed(emb.id)}
                          className="p-1 text-rose-400 hover:text-rose-300 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 🔍 SEO GOOGLE OPTIMIZATION FIELDS */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <span className="text-xs font-extrabold text-blue-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <Globe className="w-4 h-4" />
                  <span>Optimasi SEO Google & Rich Snippets</span>
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-400">Meta Title Tag (Google Header)</label>
                    <input
                      type="text"
                      value={metaTitle}
                      onChange={(e) => setMetaTitle(e.target.value)}
                      placeholder="Judul menarik di Google (Maks 60 karakter)..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-400">Meta Keywords (Pisahkan dengan koma)</label>
                    <input
                      type="text"
                      value={metaKeywordsInput}
                      onChange={(e) => setMetaKeywordsInput(e.target.value)}
                      placeholder="cara buka kafe, pos umkm, kasir gratis, hpp"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Author & Settings Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400">Nama Penulis</label>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400">Tagar / Tags (Pisahkan koma)</label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
                  />
                </div>

                <div className="flex items-center space-x-6 pt-5">
                  <label className="flex items-center space-x-2 text-xs font-bold text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPublished}
                      onChange={(e) => setIsPublished(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    <span>Publikasikan Artikel</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs font-bold text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFeatured}
                      onChange={(e) => setIsFeatured(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    <span>Artikel Utama (Hero)</span>
                  </label>
                </div>
              </div>

              {/* Save & Cancel Buttons */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Batal
                </button>

                <button
                  type="submit"
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all flex items-center space-x-2 cursor-pointer"
                 disabled={menyimpan}>
                  <Save className="w-4 h-4" />
                  <span>{editingPostId ? 'Simpan Perubahan' : 'Terbitkan Artikel Sekarang'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlogManagement;
