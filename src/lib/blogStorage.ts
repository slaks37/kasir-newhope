import { BlogPost, BlogCategory } from '../types/blog';
import { newId } from './ids';

const STORAGE_KEY = 'newhope_pos_blog_posts_v1';

export const INITIAL_BLOG_POSTS: BlogPost[] = [
  {
    id: 'blog-1',
    slug: 'cara-membuka-kafe-modal-10-juta-sukses',
    title: 'Panduan Lengkap: Cara Membuka Kafe & Kedai Kopi Modal 10 Juta dengan Sistem Kasir Otomatis',
    excerpt: 'Langkah praktis memulai bisnis kedai kopi kekinian dengan modal terjangkau, menghitung HPP resep bahan baku, dan mencegah kebocoran omset menggunakan POS modern.',
    category: 'Kuliner & F&B',
    coverImage: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Doni Pratama',
      role: 'Head Barista & Konsultan F&B',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    },
    readingTimeMinutes: 5,
    tags: ['Bisnis Kafe', 'Kedai Kopi', 'Modal 10 Juta', 'HPP Kopi', 'Tips F&B'],
    mediaEmbeds: [
      {
        id: 'emb-1',
        type: 'youtube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        caption: 'Video Tutorial: Simulasi Menghitung HPP Es Kopi Susu Aren per Cup',
      },
      {
        id: 'emb-2',
        type: 'tiktok',
        url: 'https://www.tiktok.com/@tiktok/video/7106594312292453678',
        caption: 'Short Tips: Setup Barista Station yang Efisien untuk Ruang Sempit',
      },
    ],
    seo: {
      metaTitle: 'Cara Membuka Kafe Modal 10 Juta Sukses & Untung | Blog Harapan Baru',
      metaDescription: 'Panduan lengkap cara memulai bisnis kedai kopi modal 10 juta rupiah. Pelajari perhitungan HPP, pemilihan mesin kopi, dan kontrol resep kasir otomatis.',
      metaKeywords: ['cara buka kafe modal 10 juta', 'bisnis kedai kopi', 'kasir kafe', 'resep hpp kopi', 'new hope pos'],
      canonicalUrl: 'https://newhopepos.com/blog/cara-membuka-kafe-modal-10-juta-sukses',
      ogImage: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Panduan Lengkap: Cara Membuka Kafe & Kedai Kopi Modal 10 Juta

Membuka kedai kopi atau *coffee shop* modern tidak selalu membutuhkan modal ratusan juta rupiah. Dengan strategi pemilihan peralatan yang cermat, kontrol resep gramatur yang ketat, dan adopsi sistem kasir digital modern, Anda dapat meluncurkan kedai kopi pertama Anda dengan modal Rp 10 Juta!

---

## 1. Alokasi Anggaran Modal Rp 10 Juta
Berikut adalah rincian pembagian modal yang realistis:
- **Peralatan Barista & Mesin Kopi Manual/Espresso:** Rp 4.500.000 (Mesin espresso rumahan modifikasi + Grinder elektrik + Kettle + Dripper).
- **Bahan Baku Awal (Biji Kopi Gayo, Susu UHT, Gula Aren Cair):** Rp 1.800.000.
- **Kemasan (Cup Plastik 16oz, Lid, Straw, Seal):** Rp 700.000.
- **Branding & Banner Sederhana:** Rp 500.000.
- **Hardware Kasir & Tablet Android:** Rp 1.500.000 (Bisa pakai HP/Tablet yang sudah ada!).
- **Dana Darurat & Operasional:** Rp 1.000.000.

---

## 2. Kunci Keuntungan: Kontrol Resep Gramatur (HPP)
Banyak kedai kopi gulung tikar di bulan ke-3 bukan karena sepi, melainkan karena **kebocoran susu dan biji kopi**. 

Setiap gram biji kopi dan mililiter susu harus dihitung:
- 1 Cup Es Kopi Susu Aren Standar:
  - 18 gram Biji Kopi Gayo: Rp 2.000
  - 120 ml Susu Fresh Milk: Rp 2.200
  - 20 ml Gula Aren Murni: Rp 600
  - 1 Pcs Cup + Lid + Sedotan: Rp 800
  - **Total HPP: Rp 5.600 / cup**
  - **Harga Jual: Rp 18.000 / cup** $\rightarrow$ **Laba Kotor: Rp 12.400 / cup (Margin 68.8%)!**

Dengan menggunakan fitur **Resep Bahan Baku (BOM)** di **New Hope POS**, setiap kali kasir menekan tombol jual 1 Cup Kopi Susu, stok biji kopi, susu, dan cup di gudang otomatis terpotong secara akurat.

---

## 3. Manfaatkan Pembayaran QRIS Dinamis
90% pelanggan usia muda di Indonesia lebih memilih membayar menggunakan QRIS. Dengan integrasi QRIS Dinamis di kasir New Hope POS, uang hasil penjualan otomatis cair ke rekening Anda setiap H+1 tanpa risiko salah hitung uang kembalian.
    `,
    isPublished: true,
    isFeatured: true,
    viewCount: 1420,
    likesCount: 89,
    createdAt: '2026-08-15T08:00:00Z',
    updatedAt: '2026-08-20T10:30:00Z',
  },
  {
    id: 'blog-2',
    slug: 'rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta',
    title: 'Rahasia Sukses Bisnis Laundry Kiloan: Cara Atur Status Cucian & Kirim Nota Otomatis via WhatsApp',
    excerpt: 'Strategi menghentikan komplain baju hilang/tertukar dan mendongkrak omset laundry kiloan hingga Rp 25 juta per bulan menggunakan nota digital.',
    category: 'Laundry & Jasa',
    coverImage: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Ibu Hj. Siti Aminah',
      role: 'Owner Dago Express Laundry',
      avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
    },
    readingTimeMinutes: 4,
    tags: ['Bisnis Laundry', 'Laundry Kiloan', 'Nota WhatsApp', 'Tips Usaha Jasa'],
    mediaEmbeds: [
      {
        id: 'emb-3',
        type: 'instagram',
        url: 'https://www.instagram.com/p/C_sample123',
        caption: 'Workflow Packing & Quality Control Laundry Kiloan Bersih & Rapi',
      },
    ],
    seo: {
      metaTitle: 'Rahasia Sukses Bisnis Laundry Kiloan Omset Puluhan Juta | Blog Harapan Baru',
      metaDescription: 'Tips praktis mengelola usaha laundry kiloan dan satuan. Pelajari cara mencegah pakaian tertukar dengan pelacakan status cucian dan nota WhatsApp otomatis.',
      metaKeywords: ['bisnis laundry kiloan', 'aplikasi kasir laundry', 'nota wa laundry', 'cara buka usaha laundry', 'new hope pos'],
      canonicalUrl: 'https://newhopepos.com/blog/rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta',
      ogImage: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Rahasia Sukses Bisnis Laundry Kiloan: Bebas Komplain Baju Tertukar

Bisnis laundry adalah salah satu usaha dengan perputaran kas harian (*cashflow*) paling sehat di Indonesia. Namun, kendala terbesar pemilik laundry adalah **pakaian pelanggan yang hilang atau tertukar** dan **karyawan yang lupa mencatat transaksi**.

---

## 1. Terapkan Pelacakan 5 Tahapan Pengerjaan Cucian
Pastikan setiap kantong cucian memiliki tiket digital yang melacak prosesnya:
1. **Diterima:** Timbang berat kilogram, catat jenis layanan (Cuci Kering Setrika / Cuci Lipat).
2. **Sedang Cuci:** Operator mesin cuci mencatat pemakaian formula biang deterjen.
3. **Pengeringan:** Proses di mesin dryer.
4. **Setrika & Packing:** Cek kelengkapan pakaian dan semprot parfum tahan lama.
5. **Siap Diambil:** Sistem otomatis mengirim pesan WhatsApp ke pelanggan bahwa cucian telah rapi!

---

## 2. Kirim Nota & Notifikasi via WhatsApp
Tinggalkan nota kertas karbon manual yang sering hilang atau sobek terkena air. Dengan New Hope POS, saat kasir memasukkan pesanan laundry, nota digital langsung terkirim otomatis ke WhatsApp pelanggan.

Pelanggan merasa tenang, status cucian transparan, dan loyalitas pelanggan pun meningkat pesat!
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 980,
    likesCount: 64,
    createdAt: '2026-08-16T09:30:00Z',
    updatedAt: '2026-08-18T14:15:00Z',
  },
  {
    id: 'blog-3',
    slug: 'revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin',
    title: 'Revolusi QRIS Dinamis di Kasir POS: Kenapa Transaksi Non-Tunai Wajib untuk UMKM di 2026',
    excerpt: 'Kupas tuntas keuntungan QRIS Dinamis dibandingkan QRIS Statis stiker meja, kecepatan transaksi kasir, dan rekonsiliasi otomatis cair H+1.',
    category: 'FinTech & QRIS',
    coverImage: 'https://images.unsplash.com/photo-1556742049-0a67e557b640?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Rian Ardiansyah',
      role: 'FinTech Solution Specialist',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    },
    readingTimeMinutes: 6,
    tags: ['QRIS Dinamis', 'FinTech UMKM', 'Cashless', 'Pembayaran Digital'],
    mediaEmbeds: [
      {
        id: 'emb-4',
        type: 'youtube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        caption: 'Video Demo: Kecepatan Bayar QRIS Dinamis < 3 Detik di Kasir New Hope POS',
      },
    ],
    seo: {
      metaTitle: 'Keuntungan QRIS Dinamis di Mesin Kasir POS UMKM | Blog Harapan Baru',
      metaDescription: 'Kenapa pengusaha UMKM harus beralih dari QRIS stiker ke QRIS Dinamis kasir? Simak perbandingannya untuk mencegah penipuan struk palsu dan rekonsiliasi instan.',
      metaKeywords: ['qris dinamis pos', 'pembayaran digital umkm', 'kasir qris otomatis', 'new hope pos payment'],
      canonicalUrl: 'https://newhopepos.com/blog/revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin',
      ogImage: 'https://images.unsplash.com/photo-1556742049-0a67e557b640?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Revolusi QRIS Dinamis: Solusi Anti Struk Palsu & Pembayaran Cepat

Di era pembayaran serba non-tunai saat ini, menyediakan QRIS adalah keharusan bagi setiap toko fisik. Namun, banyak pemilik bisnis masih menggunakan **QRIS Statis (Stiker Meja)** yang memiliki banyak kelemahan.

---

## ❌ Kelemahan QRIS Statis (Stiker):
- Pelanggan harus mengetik nominal rupiah secara manual (sering salah ketik atau kurang bayar).
- Kasir harus mengecek mutasi rekening manual di HP owner.
- Rawan modus penipuan "Screenshot Struk Palsu".

---

## ✅ Keunggulan QRIS Dinamis di New Hope POS:
- **Nominal Otomatis:** Barcode QR yang muncul di layar kasir sudah berisi total belanja belanjaan pelanggan.
- **Deteksi Otomatis Real-time:** Begitu pelanggan selesai scan dan bayar di aplikasi mobile banking / e-wallet apa saja (BCA, Mandiri, GoPay, OVO, ShopeePay, Dana), layar kasir otomatis mendeteksi status **LUNAS (PAID)** dalam 1 detik!
- **Struk Kasir Langsung Tercetak:** Kasir tidak perlu lagi meminta bukti transfer.
- **Pencairan H+1 Otomatis:** Dana penjualan otomatis ditransfer ke rekening bank toko Anda setiap pagi.
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 1850,
    likesCount: 120,
    createdAt: '2026-08-17T11:00:00Z',
    updatedAt: '2026-08-21T09:00:00Z',
  },
  {
    id: 'blog-4',
    slug: 'tips-mengatur-komisi-kapster-barber-dan-cuci-mobil',
    title: 'Tips Praktis Mengatur Komisi Staf Barbershop & Teknisi Cuci Mobil Tanpa Ribet',
    excerpt: 'Cara menghitung bagi hasil jasa kapster potong rambut dan tim hidrolik carwash secara transparan, otomatis, dan bebas salah hitung.',
    category: 'Tips Bisnis & Strategi',
    coverImage: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Mas Alex Stylist',
      role: 'Master Barber & Mentor Usaha',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
    },
    readingTimeMinutes: 4,
    tags: ['Bisnis Barbershop', 'Carwash', 'Komisi Karyawan', 'Manajemen Staf'],
    mediaEmbeds: [
      {
        id: 'emb-5',
        type: 'tiktok',
        url: 'https://www.tiktok.com/@tiktok/video/7106594312292453678',
        caption: 'Tutorial Mengatur Komisi Potong Rambut & Layanan Shaving di POS',
      },
    ],
    seo: {
      metaTitle: 'Cara Mengatur Komisi Kapster Barbershop & Cuci Mobil | Blog Harapan Baru',
      metaDescription: 'Panduan menghitung bagi hasil dan komisi staf jasa barbershop, salon, dan cuci mobil. Gunakan sistem POS dengan fitur penugasan petugas otomatis.',
      metaKeywords: ['komisi kapster barbershop', 'komisi cuci mobil', 'aplikasi kasir barbershop', 'new hope pos'],
      canonicalUrl: 'https://newhopepos.com/blog/tips-mengatur-komisi-kapster-barber-dan-cuci-mobil',
      ogImage: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Cara Menghitung Komisi Staf Jasa yang Adil & Transparan

Dalam bisnis jasa seperti Barbershop, Salon, Carwash, dan Auto Detailing, **kepuasan staf kapster & teknisi cuci** adalah kunci utama kualitas layanan kepada pelanggan.

---

## 1. Skema Komisi yang Paling Banyak Diterapkan
- **Model Bagi Hasil Tetap per Layanan:** Misal potong rambut Rp 45.000 $\rightarrow$ Kapster mendapat Rp 15.000 (33.3%).
- **Model Komisi Produk Retail:** Jika kapster berhasil menjual pomade retail Rp 75.000 $\rightarrow$ Komisi tambahan Rp 5.000.
- **Model Tim Hidrolik Carwash:** Komisi Rp 8.000 per mobil dibagi rata ke 2 orang teknisi cuci.

---

## 2. Otomasi dengan Fitur "Pilih Petugas" di Kasir
Jangan biarkan staf Anda mencatat jumlah pengerjaan di buku tulis yang rawan terselip atau manipulasi.

Di New Hope POS:
1. Saat pelanggan bayar di kasir, kasir cukup memilih nama petugas yang melayani (misal: *Mas Alex*).
2. Sistem secara otomatis menghitung akumulasi komisi staf tersebut di shift harian.
3. Setiap malam, owner cukup membuka menu **Laporan Komisi** untuk melihat rekap gaji/bagi hasil harian setiap karyawan dalam 1 detik!
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 760,
    likesCount: 52,
    createdAt: '2026-08-18T13:45:00Z',
    updatedAt: '2026-08-19T16:20:00Z',
  },
];

/**
 * Mengambil seluruh postingan blog dari LocalStorage atau default seeding
 */
export function getAllBlogPosts(): BlogPost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_BLOG_POSTS));
      return INITIAL_BLOG_POSTS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_BLOG_POSTS;
  } catch (err) {
    console.error('Gagal membaca blog posts dari storage:', err);
    return INITIAL_BLOG_POSTS;
  }
}

/**
 * Mengambil daftar artikel yang statusnya PUBLISHED
 */
export function getPublishedBlogPosts(): BlogPost[] {
  const posts = getAllBlogPosts();
  return posts.filter((p) => p.isPublished);
}

/**
 * Mengambil artikel berdasarkan slug SEO
 */
export function getBlogPostBySlug(slug: string): BlogPost | undefined {
  const posts = getAllBlogPosts();
  return posts.find((p) => p.slug === slug);
}

/**
 * Menyimpan artikel baru
 */
export function createBlogPost(post: Omit<BlogPost, 'id' | 'createdAt' | 'updatedAt' | 'viewCount' | 'likesCount'>): BlogPost {
  const posts = getAllBlogPosts();
  const newPost: BlogPost = {
    ...post,
    id: newId('blog'),
    viewCount: 1,
    likesCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updated = [newPost, ...posts];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  window.dispatchEvent(new Event('newhope_blog_updated'));
  return newPost;
}

/**
 * Memperbarui artikel yang ada
 */
export function updateBlogPost(id: string, updates: Partial<BlogPost>): BlogPost | null {
  const posts = getAllBlogPosts();
  const index = posts.findIndex((p) => p.id === id);
  if (index === -1) return null;

  const updatedPost: BlogPost = {
    ...posts[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  posts[index] = updatedPost;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  window.dispatchEvent(new Event('newhope_blog_updated'));
  return updatedPost;
}

/**
 * Menghapus artikel blog
 */
export function deleteBlogPost(id: string): boolean {
  const posts = getAllBlogPosts();
  const filtered = posts.filter((p) => p.id !== id);
  if (filtered.length === posts.length) return false;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  window.dispatchEvent(new Event('newhope_blog_updated'));
  return true;
}

/**
 * Tambah view count
 */
export function incrementBlogView(id: string) {
  const posts = getAllBlogPosts();
  const p = posts.find((item) => item.id === id);
  if (p) {
    p.viewCount = (p.viewCount || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  }
}

/**
 * Tambah likes count
 */
export function incrementBlogLikes(id: string): number {
  const posts = getAllBlogPosts();
  const p = posts.find((item) => item.id === id);
  if (p) {
    p.likesCount = (p.likesCount || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
    window.dispatchEvent(new Event('newhope_blog_updated'));
    return p.likesCount;
  }
  return 0;
}
