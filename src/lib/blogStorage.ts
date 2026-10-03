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
    ],
    seo: {
      metaTitle: 'Cara Membuka Kafe Modal 10 Juta Sukses & Untung | Blog Harapan Baru',
      metaDescription: 'Panduan lengkap cara memulai bisnis kedai kopi modal 10 juta rupiah. Pelajari perhitungan HPP, pemilihan mesin kopi, dan kontrol resep kasir otomatis.',
      metaKeywords: ['cara buka kafe modal 10 juta', 'bisnis kedai kopi', 'kasir kafe', 'resep hpp kopi', 'new hope pos'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/cara-membuka-kafe-modal-10-juta-sukses',
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
  - **Harga Jual: Rp 18.000 / cup** -> **Laba Kotor: Rp 12.400 / cup (Margin 68.8%)!**

Dengan menggunakan fitur **Resep Bahan Baku (BOM)** di **New Hope POS**, setiap kali kasir menekan tombol jual 1 Cup Kopi Susu, stok biji kopi, susu, dan cup di gudang otomatis terpotong secara akurat.

---

## 3. Manfaatkan Pembayaran QRIS Dinamis
90% pelanggan usia muda di Indonesia lebih memilih membayar menggunakan QRIS. Dengan integrasi QRIS Dinamis di kasir New Hope POS, uang hasil penjualan otomatis cair ke rekening Anda setiap H+1 tanpa risiko salah hitung uang kembalian.
    `,
    isPublished: true,
    isFeatured: true,
    viewCount: 2420,
    likesCount: 142,
    createdAt: '2026-09-25T08:00:00Z',
    updatedAt: '2026-10-01T10:30:00Z',
  },
  {
    id: 'blog-2',
    slug: 'kisah-sukses-warung-kopi-5-cabang',
    title: 'Kisah Sukses Kopi Janji Hati: Dari Satu Gerobak Kayu Hingga Punya 5 Cabang Beromzet Rp 120 Juta',
    excerpt: 'Perjalanan jatuh bangun Mas Danang membangun jaringan kedai kopi lokal dari nol. Rahasia suksesnya: standardisasi rasa resep dan pengawasan omzet cabang secara real-time dari HP.',
    category: 'Kisah Sukses UMKM',
    coverImage: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Danang Wicaksono',
      role: 'Founder Kopi Janji Hati',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    },
    readingTimeMinutes: 6,
    tags: ['Kisah Sukses', 'Inspirasi UMKM', 'Multi Cabang', 'Kopi Kekinian'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Kisah Sukses Kopi Janji Hati: Dari Gerobak Jadi 5 Cabang | Blog Harapan Baru',
      metaDescription: 'Kisah inspiratif wirausaha kedai kopi dari gerobak kecil hingga sukses mengelola 5 cabang omzet ratusan juta dengan sistem kasir multi-outlet.',
      metaKeywords: ['kisah sukses umkm', 'kopi janji hati', 'buka cabang cafe', 'kasir multi cabang'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/kisah-sukses-warung-kopi-5-cabang',
      ogImage: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Kisah Sukses Kopi Janji Hati: Dari Satu Gerobak Menjadi 5 Cabang

Empat tahun lalu, Danang Wicaksono (29 tahun) memulai perjalanan usahanya dengan gerobak kopi kayu sederhana di trotoar kawasan kampus di Yogyakarta. Berbekal kompor gas kecil dan moka pot, ia menjual kopi susu aren seharga Rp 10.000 per cup.

Kini, brand **Kopi Janji Hati** telah memiliki 5 outlet mandiri dengan omzet gabungan mencapai **Rp 120.000.000 per bulan** dan mempekerjakan 14 barista muda.

---

## Titik Balik: Saat Cabang Kedua Mengalami Kebocoran
"Waktu masih satu gerobak, saya jaga sendiri jadi uang kas selalu aman," kenang Danang. "Begitu buka cabang kedua, masalah besar mulai muncul. Stok susu sering habis padahal laporan kasir sedikit. Karyawan saling tunjuk, dan saya stress bolak-balik ngecek toko."

Danang menyadari bahwa bisnis tidak akan bisa berkembang jika sistem pengawasan masih mengandalkan ingatan atau nota kertas.

---

## 3 Pilar Standardisasi yang Menyelamatkan Bisnisnya

### 1. Resep Gramatur Terkunci di Kasir
Danang memasukkan seluruh takaran resep ke dalam New Hope POS. Setiap barista hanya perlu menekan tombol pesanan di layar tablet, dan sistem otomatis memotong stok bahan baku sesuai gramatur standar.

### 2. Multi-Outlet Dashboard Real-Time
Tanpa harus datang ke toko, Danang bisa melihat grafik penjualan ke-5 cabang secara langsung dari smartphone pribadinya setiap jam. Jika ada cabang yang sepi, ia bisa langsung memicu promo kilat.

### 3. Shift Kasir Transparan (Blind Close)
Kasir yang bertugas tidak bisa melihat total uang sistem sebelum mereka menghitung fisik uang di laci. Selisih kas langsung tercatat di laporan harian dan dikirim via notifikasi telegram/WA.

> *"Jangan tunggu bisnis besar baru pakai sistem kasir yang rapi. Justru rapikan sistemnya dulu, baru bisnis Anda bisa membesar tanpa bikin kepala pecah."* — Danang Wicaksono
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 3180,
    likesCount: 215,
    createdAt: '2026-09-28T09:15:00Z',
    updatedAt: '2026-10-02T11:00:00Z',
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
    readingTimeMinutes: 5,
    tags: ['QRIS Dinamis', 'FinTech UMKM', 'Cashless', 'Pembayaran Digital'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Keuntungan QRIS Dinamis di Mesin Kasir POS UMKM | Blog Harapan Baru',
      metaDescription: 'Kenapa pengusaha UMKM harus beralih dari QRIS stiker ke QRIS Dinamis kasir? Simak perbandingannya untuk mencegah penipuan struk palsu dan rekonsiliasi instan.',
      metaKeywords: ['qris dinamis pos', 'pembayaran digital umkm', 'kasir qris otomatis', 'new hope pos payment'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin',
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
    createdAt: '2026-09-20T11:00:00Z',
    updatedAt: '2026-09-29T09:00:00Z',
  },
  {
    id: 'blog-4',
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
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Rahasia Sukses Bisnis Laundry Kiloan Omset Puluhan Juta | Blog Harapan Baru',
      metaDescription: 'Tips praktis mengelola usaha laundry kiloan dan satuan. Pelajari cara mencegah pakaian tertukar dengan pelacakan status cucian dan nota WhatsApp otomatis.',
      metaKeywords: ['bisnis laundry kiloan', 'aplikasi kasir laundry', 'nota wa laundry', 'cara buka usaha laundry', 'new hope pos'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta',
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
    viewCount: 1680,
    likesCount: 94,
    createdAt: '2026-09-18T09:30:00Z',
    updatedAt: '2026-09-24T14:15:00Z',
  },
  {
    id: 'blog-5',
    slug: 'toko-kelontong-modern-saingi-minimarket',
    title: 'Cerita Toko Madura Modern: Trik Bersaing Lawan Waralaba Raksasa Berbekal Barcode Scanner & POS Cepat',
    excerpt: 'Toko sembako tradisional kini bisa melayani secepat minimarket waralaba berkat digitalisasi master produk dan barcode scanner murah via kamera HP.',
    category: 'Ritel & Minimarket',
    coverImage: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'H. Achmad Fauzi',
      role: 'Ketua Paguyuban Toko Kelontong',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
    },
    readingTimeMinutes: 5,
    tags: ['Toko Kelontong', 'Minimarket', 'Barcode Scanner', 'Stok Ritel'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Toko Kelontong Madura Saingi Waralaba Modern | Blog Harapan Baru',
      metaDescription: 'Cara toko kelontong dan ritel tradisional bertransformasi dengan sistem kasir barcode modern untuk mencatat ribuan SKU barang dagangan secara instan.',
      metaKeywords: ['toko sembako modern', 'kasir toko kelontong', 'barcode pos', 'aplikasi kasir toko ritel'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/toko-kelontong-modern-saingi-minimarket',
      ogImage: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Transformasi Toko Kelontong: Bersaing Sejajar dengan Minimarket Waralaba

Banyak pemilik toko kelontong pesimis ketika sebuah minimarket waralaba berlogo merah-biru buka tepat di seberang jalan mereka. Namun, bagi H. Achmad Fauzi, kehadiran kompetitor justru memicu transformasi tokonya: **Toko Berkah Madura**.

---

## Kelemahan Toko Tradisional yang Dibenahi:
1. **Harga Tidak Jelas:** Pelanggan sering bertanya-tanya *"Beras ini berapa, minyak itu berapa?"* karena tidak ada label harga atau scanner.
2. **Antrean Kasir Lambat:** Kasir menghitung manual pakai kalkulator genggam dan mencatat di buku tulis.
3. **Barang Hilang atau Rusak:** Stok barang yang tercecer di rak sering hilang tanpa jejak.

---

## Kunci Perubahan dalam 30 Hari:
- **Scan Barcode Cepat:** Dengan New Hope POS, kasir cukup menodongkan barcode scanner (atau kamera HP) ke kemasan sabun, mie instan, atau susu. Harga langsung muncul di layar.
- **Peringatan Stok Menipis:** Sistem otomatis memberi tahu saat stok gula pasir tersisa kurang dari 5 karung.
- **Pencatatan Utang / Bon Pelanggan Rapi:** Fitur Piutang Pelanggan memudahkan pencatatan siapa yang berutang, lengkap dengan pengingat jatuh tempo via WhatsApp.

Hasilnya? Toko Berkah tetap ramai dikunjungi warga lokal karena harganya lebih bersahabat dan pelayanannya kini secepat kasir minimarket modern!
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 2110,
    likesCount: 165,
    createdAt: '2026-09-15T14:00:00Z',
    updatedAt: '2026-09-22T10:00:00Z',
  },
  {
    id: 'blog-6',
    slug: 'kisah-laundry-sepatu-dan-tas-premium',
    title: 'Cerita Usaha: Modal Sikat & Sabun Khusus, Pemuda 24 Tahun Sukses Raup Rp 30 Juta dari Cuci Sepatu & Tas Mewah',
    excerpt: 'Tren sneakers care membuka peluang usaha jasa dengan margin keuntungan tebal. Simak bagaimana sistem pelabelan tag foto sebelum dan sesudah cuci membangun reputasi bintang 5.',
    category: 'Kisah Sukses UMKM',
    coverImage: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Bima Satria',
      role: 'Founder Kicks & Clean Shoes Care',
      avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150',
    },
    readingTimeMinutes: 5,
    tags: ['Cuci Sepatu', 'Sneakers Care', 'Bisnis Pemuda', 'Jasa Premium'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Bisnis Cuci Sepatu & Tas Omzet Rp 30 Juta | Blog Harapan Baru',
      metaDescription: 'Kisah wirausaha muda merintis jasa pembersihan sepatu sneakers dan tas premium dengan sistem foto before-after di kasir.',
      metaKeywords: ['cuci sepatu sneakers', 'bisnis cuci sepatu', 'laundry tas', 'kasir jasa cuci'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/kisah-laundry-sepatu-dan-tas-premium',
      ogImage: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Dari Garasi Rumah Jadi Bisnis Cuci Sepatu Beromzet Rp 30 Juta

Siapa sangka mencuci sepatu sneakers bisa menghasilkan omzet puluhan juta rupiah setiap bulan? Inilah yang dibuktikan oleh Bima Satria (24 tahun), alumnus teknik yang memilih membuka jasa **Kicks & Clean Shoes Care**.

---

## Mengapa Margin Jasa Cuci Sepatu Sangat Tinggi?
- Cuci Kiloan: Rp 7.000 - Rp 10.000 per kg (Margin tipis).
- **Deep Clean Sepatu Sneakers:** Rp 45.000 - Rp 150.000 per pasang!
- Bahan pembersih khusus (cleaner foam & horsehair brush) hanya membutuhkan biaya sekitar Rp 4.000 per pasang sepatu.
- **Margin keuntungan kotor bisa mencapai 85%!**

---

## Solusi Mengatasi Resiko Sepatu Rusak / Luntur:
Masalah terbesar di bisnis ini adalah komplain dari pemilik sepatu mahal jika terjadi noda atau sobek lama yang dituduhkan ke tempat cuci.

Bima menggunakan fitur **Catatan Inspeksi & Foto Kondisi Awal** di New Hope POS:
1. Saat sepatu diserahkan, staf memfoto kondisi sol dan upper sepatu.
2. Nota digital berisikan foto kondisi awal dikirim langsung ke WhatsApp pelanggan.
3. Pelanggan menyetujui kondisi sebelum sepatu dikerjakan.

Dengan transparansi ini, komplain turun menjadi 0% dan Kicks & Clean dipercaya ribuan komunitas sneakerhead di kotanya.
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 1940,
    likesCount: 138,
    createdAt: '2026-09-12T10:20:00Z',
    updatedAt: '2026-09-17T15:00:00Z',
  },
  {
    id: 'blog-7',
    slug: 'panduan-mengurangi-kebocoran-uang-kasir',
    title: 'Investigasi Kasir: 4 Celah Kebocoran Omzet di Toko & Cara Mengatasinya dengan Fitur Blind Shift',
    excerpt: 'Uang fisik di laci tidak cocok dengan laporan harian? Bongkar modus kecurangan kasir umum dan cara menutup celahnya dengan sistem tutup kasir tertutup.',
    category: 'Panduan Kasir & POS',
    coverImage: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Ratna Kusuma',
      role: 'Audit & Operasional Retail Senior',
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150',
    },
    readingTimeMinutes: 5,
    tags: ['Audit Kasir', 'Blind Shift', 'Cegah Kebocoran', 'Manajemen Keuangan'],
    mediaEmbeds: [],
    seo: {
      metaTitle: '4 Cara Mencegah Kebocoran Uang Kasir di Toko | Blog Harapan Baru',
      metaDescription: 'Pelajari cara mengamankan uang kas toko fisik Anda. Gunakan fitur blind closing shift dan audit log void transaksi untuk melindungi keuntungan bisnis.',
      metaKeywords: ['kebocoran kasir', 'blind shift pos', 'audit kasir toko', 'fitur kasir aman'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/panduan-mengurangi-kebocoran-uang-kasir',
      ogImage: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Menghentikan Kebocoran Kas di Toko: Tips untuk Pemilik Usaha

Banyak pemilik usaha yang bingung: pembeli ramai setiap hari, barang di rak selalu ludes, tetapi saldo di rekening bank di akhir bulan tidak bertambah. Fenomena ini sering kali diakibatkan oleh **kebocoran omzet kasir**.

---

## 4 Modus Kebocoran yang Paling Sering Terjadi:

### 1. Pembatalan Transaksi Diam-diam (Void Unauthorized)
Kasir menerima uang tunai dari pelanggan, tetapi setelah pelanggan pergi tanpa struk, transaksi dibatalkan (*void*) dan uang tunai dimasukkan ke kantong pribadi.
- **Solusi:** Di New Hope POS, tombol *Void* mewajibkan **PIN Otorisasi Manager/Owner** dan setiap pembatalan tercatat di log audit keamanan.

### 2. Memanfaatkan Kembalian yang Tidak Diambil
Pelanggan yang terburu-buru sering tidak mengambil kembalian Rp 1.000 atau Rp 2.000. Kasir yang nakal mengumpulkan akumulasi kembalian ini.

### 3. Mengintip Target Penjualan Saat Tutup Shift
Jika sistem kasir menampilkan *"Hari ini kamu seharusnya punya uang tunai Rp 1.500.000"*, oknum staf yang melihat fisik laci ada Rp 1.550.000 bisa tergoda mengambil selisih Rp 50.000.
- **Solusi: Blind Shift Closing**. Sistem **TIDAK** membocorkan angka target. Kasir wajib menghitung uang fisik terlebih dahulu dan menginput angka riil. Sistem yang akan membandingkan dan melaporkan selisihnya ke owner.

### 4. Tidak Menyerahkan Struk Belanja
Selalu pasang stiker: *"Jika kasir tidak memberikan struk resmi, pesanan Anda GRATIS!"*. Ini memaksa kasir selalu menginput setiap transaksi ke sistem.
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 2750,
    likesCount: 189,
    createdAt: '2026-09-08T08:00:00Z',
    updatedAt: '2026-09-14T11:00:00Z',
  },
  {
    id: 'blog-8',
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
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Cara Mengatur Komisi Kapster Barbershop & Cuci Mobil | Blog Harapan Baru',
      metaDescription: 'Panduan menghitung bagi hasil dan komisi staf jasa barbershop, salon, dan cuci mobil. Gunakan sistem POS dengan fitur penugasan petugas otomatis.',
      metaKeywords: ['komisi kapster barbershop', 'komisi cuci mobil', 'aplikasi kasir barbershop', 'new hope pos'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/tips-mengatur-komisi-kapster-barber-dan-cuci-mobil',
      ogImage: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Cara Menghitung Komisi Staf Jasa yang Adil & Transparan

Dalam bisnis jasa seperti Barbershop, Salon, Carwash, dan Auto Detailing, **kepuasan staf kapster & teknisi cuci** adalah kunci utama kualitas layanan kepada pelanggan.

---

## 1. Skema Komisi yang Paling Banyak Diterapkan
- **Model Bagi Hasil Tetap per Layanan:** Misal potong rambut Rp 45.000 -> Kapster mendapat Rp 15.000 (33.3%).
- **Model Komisi Produk Retail:** Jika kapster berhasil menjual pomade retail Rp 75.000 -> Komisi tambahan Rp 5.000.
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
    viewCount: 1540,
    likesCount: 88,
    createdAt: '2026-09-05T13:45:00Z',
    updatedAt: '2026-09-10T16:20:00Z',
  },
  {
    id: 'blog-9',
    slug: 'rekap-tren-bisnis-umkm-2026',
    title: 'Berita Tren Usaha 2026: 5 Konsep Bisnis Paling Menjanjikan dengan Modal di Bawah 15 Juta',
    excerpt: 'Laporan khusus tren wirausaha di Indonesia: Cloud kitchen mikro, barbershop panggilan, laundry sepatu premium, hingga bakery rumahan yang sedang naik daun.',
    category: 'Tips Bisnis & Strategi',
    coverImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Sintia Paramitha',
      role: 'Analis Bisnis & Tren Konsumen',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
    },
    readingTimeMinutes: 5,
    tags: ['Tren Usaha 2026', 'Ide Bisnis UMKM', 'Modal Kecil', 'Peluang Usaha'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Tren Usaha 2026 Modal di Bawah 15 Juta | Blog Harapan Baru',
      metaDescription: 'Daftar 5 peluang bisnis paling menjanjikan tahun 2026 untuk UMKM dengan modal terjangkau dan potensi ROI cepat.',
      metaKeywords: ['tren bisnis 2026', 'usaha modal 15 juta', 'ide bisnis umkm', 'peluang wirausaha'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/rekap-tren-bisnis-umkm-2026',
      ogImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Laporan Khusus: 5 Ide Bisnis Menguntungkan di Tahun 2026

Pasar konsumen Indonesia di tahun 2026 semakin mengutamakan **kecepatan, kenyamanan digital, dan personalisasi**. Bagi calon wirausahawan dengan modal terbatas (di bawah Rp 15 Juta), berikut adalah sektor usaha yang memiliki potensi pertumbuhan paling menjanjikan:

---

## 1. Cloud Kitchen Mikro (Spesialis Rice Bowl & Salad)
Tidak perlu sewa ruko mahal di pinggir jalan utama. Manfaatkan dapur rumah untuk memasak menu sehat atau comfort food, pasang kasir POS untuk mengelola pesanan ojek online dan takeaway langsung.

## 2. Jasa Perawatan Sepatu & Apparel (Shoe Cleaning)
Pertumbuhan pasar sneakers lokal membuka ceruk pasar yang luas. Anak muda rela membayar Rp 50.000 - Rp 100.000 agar sepatu favorit mereka kembali kinclong seperti baru.

## 3. Kedai Kopi Booth Minimalis di Area Komuter
Lokasi strategis di dekat stasiun KRL, halte TransJakarta, atau area kost mahasiswa dengan menu andalan kopi susu aren dan roti bakar bakar praktis.

## 4. Barbershop Kompak 2 Kursi
Menyasar pasar pria urban yang menginginkan potongan rambut rapi dengan harga terjangkau (Rp 30.000 - Rp 45.000).

## 5. Toko Bakery & Pastry Rumahan Sistem Pre-Order
Kue basah tradisional modern (croissant klepon, pie susu premium) yang dipasarkan lewat media sosial dengan sistem pre-order dan pencatatan kasir terstruktur.
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 2890,
    likesCount: 195,
    createdAt: '2026-09-01T07:30:00Z',
    updatedAt: '2026-09-06T12:00:00Z',
  },
  {
    id: 'blog-10',
    slug: 'kisah-warteg-modern-antre-panjang',
    title: 'Kisah Warteg Kharisma Baru: Ubah Antrean Padat Makan Siang Jadi Cepat dengan Layar Pesanan Dapur',
    excerpt: 'Dari komplain pelanggan karena menu salah antar hingga efisiensi waktu penyajian 3 menit per piring berkat Kitchen Display System (KDS).',
    category: 'Kuliner & F&B',
    coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Budi Santoso',
      role: 'Pengelola Kuliner Nusantara',
      avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150',
    },
    readingTimeMinutes: 4,
    tags: ['Warteg Modern', 'Kitchen Display', 'Kuliner Cepat', 'Efisiensi Dapur'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Kisah Warteg Modern Selesaikan Antrean Jam Makan Siang | Blog Harapan Baru',
      metaDescription: 'Cara restoran dan rumah makan tradisional mempercepat penyajian makanan saat jam makan siang menggunakan layar pesanan dapur terintegrasi.',
      metaKeywords: ['warteg modern', 'kitchen display pos', 'kasir rumah makan', 'antrean restoran'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/kisah-warteg-modern-antre-panjang',
      ogImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Warteg Rasa Resto: Cara Warteg Kharisma Baru Melayani 300 Pelanggan dalam 2 Jam

Jam 12.00 hingga 14.00 siang adalah medan pertempuran bagi setiap pengusaha rumah makan di kawasan perkantoran. Ratusan pekerja lapar datang bersamaan, menginginkan makanan yang lezat, murah, dan yang terpenting: **disajikan dalam hitungan menit**.

---

## Masalah Kertas Bon yang Sering Basah & Tertukar
Sebelum memakai sistem POS, pelayan Warteg Kharisma Baru mencatat pesanan di secarik kertas kecil yang sering terkena kuah sayur atau tertukar antar meja. Koki dapur kebingungan membedakan pesanan bungkus (*takeaway*) dan makan di tempat (*dine-in*).

---

## Kunci Efisiensi 3 Menit:
1. **Pemesanan Cepat di Kasir Depan:** Begitu tamu memilih lauk, kasir cukup mengetuk foto menu di layar touchscreen POS.
2. **Tiket Masuk ke Layar Dapur Otomatis:** Dapur langsung melihat pesanan secara berurutan (*first in, first out*).
3. **Pemberian Nomor Meja Digital:** Makanan diantar tepat sasaran tanpa pelayan harus teriak-teriak memanggil nama pembeli.

Omzet melonjak 40% hanya karena perputaran meja (*table turnover*) menjadi 2 kali lebih cepat dari sebelumnya!
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 1620,
    likesCount: 104,
    createdAt: '2026-08-28T12:00:00Z',
    updatedAt: '2026-09-02T14:30:00Z',
  },
  {
    id: 'blog-11',
    slug: 'kabar-qris-bank-indonesia-transaksi-aman',
    title: 'Kabar FinTech: Panduan Regulasi QRIS 2026 & Standar Keamanan Baru untuk Transaksi Kasir Tanpa Kendala',
    excerpt: 'Memahami batas limit transaksi QRIS terbaru, integrasi settlement H+1, dan tips memastikan mesin kasir Anda selalu online dan terverifikasi Bank Indonesia.',
    category: 'FinTech & QRIS',
    coverImage: 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Rian Ardiansyah',
      role: 'FinTech Solution Specialist',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    },
    readingTimeMinutes: 5,
    tags: ['Regulasi QRIS', 'Bank Indonesia', 'Keamanan Transaksi', 'FinTech 2026'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Panduan Regulasi QRIS 2026 untuk Merchant UMKM | Blog Harapan Baru',
      metaDescription: 'Update regulasi Bank Indonesia mengenai transaksi QRIS merchant, batas limit baru, dan perlindungan keamanan transaksi digital bagi pengusaha kecil.',
      metaKeywords: ['regulasi qris 2026', 'qris bank indonesia', 'qris merchant pos', 'keamanan pembayaran digital'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/kabar-qris-bank-indonesia-transaksi-aman',
      ogImage: 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Berita FinTech: Aturan Baru QRIS 2026 yang Wajib Diketahui Pengusaha

Bank Indonesia bersama Asosiasi Sistem Pembayaran Indonesia (ASPI) terus memperkuat ekosistem pembayaran digital nasional. Di tahun 2026, sejumlah pembaruan regulasi resmi diberlakukan untuk melindungi merchant UMKM.

---

## 3 Poin Penting Regulasi QRIS Terbaru:
1. **Limit Transaksi per Scan Diperluas:** Pelanggan kini dapat membayar hingga Rp 20.000.000 per transaksi QRIS, memudahkan transaksi toko elektronik, grosir, dan servis kendaraan.
2. **Kewajiban Notifikasi Callback Terenkripsi:** Setiap mesin kasir harus menggunakan jalur komunikasi API terenkripsi untuk mencegah intervensi pihak ketiga (*Man-in-the-Middle attack*).
3. **Pemberlakuan Tarif MDR UMKM 0% Khusus Usaha Mikro:** Dukungan pemerintah untuk memastikan pengusaha mikro dapat menikmati transaksi non-tunai tanpa potongan biaya yang memberatkan.

Pastikan aplikasi kasir yang Anda gunakan seperti **New Hope POS** sudah mengantongi sertifikasi kepatuhan standar QRIS Nasional agar operasional toko Anda berjalan aman dan lancar setiap hari.
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 2230,
    likesCount: 153,
    createdAt: '2026-08-24T10:00:00Z',
    updatedAt: '2026-08-30T16:00:00Z',
  },
  {
    id: 'blog-12',
    slug: 'strategi-loyalitas-pelanggan-voucher-diskon',
    title: 'Trik Psikologi Diskon: Cara Bikin Program Loyalitas Member & Poin Belanja yang Bikin Pelanggan Balik Lagi',
    excerpt: 'Pelanggan lama 5 kali lebih murah dipertahankan daripada mencari pelanggan baru. Simak strategi menerapkan kartu member digital dan kupon diskon tepat sasaran.',
    category: 'Tips Bisnis & Strategi',
    coverImage: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&q=80&w=1200',
    author: {
      name: 'Sintia Paramitha',
      role: 'Analis Bisnis & Tren Konsumen',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
    },
    readingTimeMinutes: 4,
    tags: ['Program Member', 'Loyalitas Pelanggan', 'Psikologi Diskon', 'Strategi Penjualan'],
    mediaEmbeds: [],
    seo: {
      metaTitle: 'Strategi Program Member & Loyalitas Pelanggan UMKM | Blog Harapan Baru',
      metaDescription: 'Cara meningkatkan repeat order toko dan kafe Anda dengan program loyalitas pelanggan digital, poin belanja otomatis, dan voucher promo kasir.',
      metaKeywords: ['loyalitas pelanggan pos', 'kartu member digital', 'diskon kasir', 'repeat order umkm'],
      canonicalUrl: 'https://kasir.newhope.space/#blog/strategi-loyalitas-pelanggan-voucher-diskon',
      ogImage: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&q=80&w=1200',
    },
    content: `
# Rahasia Repeat Order: Mengapa Program Member Adalah Mesin Uang Toko Anda

Banyak pemilik toko menghabiskan jutaan rupiah untuk pasang iklan di media sosial demi mendatangkan pelanggan baru, tetapi melupakan pembeli yang sudah pernah datang. Padahal, **80% omzet stabil jangka panjang berasal dari 20% pelanggan setia**!

---

## 3 Trik Membuat Pelanggan Selalu Ingin Kembali:

### 1. Kartu Member Cukup Nomor WhatsApp (Tanpa Kartu Plastik)
Pelanggan malas membawa kartu fisik tebal di dompet. Di New Hope POS, kasir cukup menanyakan nomor WhatsApp pelanggan saat pembayaran. Poin belanja otomatis terkumpul!

### 2. Gamifikasi Poin (Beli 9 Cup, Cup ke-10 Gratis)
Prinsip psikologi *Endowed Progress Effect*: pelanggan yang merasa sudah mengumpulkan 3 dari 10 stempel digital akan cenderung lebih cepat kembali untuk menyelesaikan target hadiahnya.

### 3. Kupon Diskon Khusus di Hari Ulang Tahun
Kirim ucapan selamat ulang tahun via WhatsApp otomatis beserta voucher diskon 20%. Pelanggan merasa dihargai secara personal dan akan mengajak teman-temannya merayakan di toko Anda!
    `,
    isPublished: true,
    isFeatured: false,
    viewCount: 1780,
    likesCount: 112,
    createdAt: '2026-08-20T08:30:00Z',
    updatedAt: '2026-08-25T11:00:00Z',
  },
];

/**
 * Mengambil seluruh postingan blog dari LocalStorage atau default seeding.
 * Dilengkapi auto-merge agar artikel baru selalu muncul bagi pengguna lama.
 */
export function getAllBlogPosts(): BlogPost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_BLOG_POSTS));
      return INITIAL_BLOG_POSTS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const existingIds = new Set(parsed.map((p: BlogPost) => p.id));
      const missingDefaults = INITIAL_BLOG_POSTS.filter((p) => !existingIds.has(p.id));
      if (missingDefaults.length > 0) {
        const merged = [...parsed, ...missingDefaults];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      }
      return parsed;
    }
    return INITIAL_BLOG_POSTS;
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
