-- =============================================================================
-- 0042_connect_blog_and_customers.sql
-- Menghubungkan Blog Management dan CRM Pelanggan ke PostgreSQL Database
-- =============================================================================

-- 1. TABEL BLOG POSTS (PUBLIC / PORTAL EDUKASI BISNIS) -------------------------

CREATE TABLE IF NOT EXISTS public.blog_posts (
    id                   TEXT PRIMARY KEY,
    slug                 TEXT UNIQUE NOT NULL,
    title                TEXT NOT NULL,
    excerpt              TEXT,
    content              TEXT NOT NULL,
    category             TEXT NOT NULL,
    cover_image          TEXT,
    author_name          TEXT NOT NULL DEFAULT 'Tim Editorial New Hope POS',
    author_role          TEXT NOT NULL DEFAULT 'Business Consultant',
    author_avatar        TEXT,
    reading_time_minutes INTEGER NOT NULL DEFAULT 5,
    tags                 TEXT[] NOT NULL DEFAULT '{}',
    media_embeds         JSONB NOT NULL DEFAULT '[]'::jsonb,
    seo                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_published         BOOLEAN NOT NULL DEFAULT true,
    is_featured          BOOLEAN NOT NULL DEFAULT false,
    view_count           INTEGER NOT NULL DEFAULT 0,
    likes_count          INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON public.blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON public.blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON public.blog_posts(is_published, created_at DESC);

-- Seed artikel awal edukasi bisnis
INSERT INTO public.blog_posts (
    id, slug, title, excerpt, category, cover_image, author_name, author_role, author_avatar,
    reading_time_minutes, tags, media_embeds, seo, is_published, is_featured, view_count, likes_count,
    content, created_at, updated_at
) VALUES
(
    'blog-1',
    'cara-membuka-kafe-modal-10-juta-sukses',
    'Panduan Lengkap: Cara Membuka Kafe & Kedai Kopi Modal 10 Juta dengan Sistem Kasir Otomatis',
    'Langkah praktis memulai bisnis kedai kopi kekinian dengan modal terjangkau, menghitung HPP resep bahan baku, dan mencegah kebocoran omset menggunakan POS modern.',
    'Kuliner & F&B',
    'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=1200',
    'Doni Pratama',
    'Head Barista & Konsultan F&B',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    5,
    ARRAY['Bisnis Kafe', 'Kedai Kopi', 'Modal 10 Juta', 'HPP Kopi', 'Tips F&B'],
    '[{"id":"emb-1","type":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","caption":"Video Tutorial: Simulasi Menghitung HPP Es Kopi Susu Aren per Cup"},{"id":"emb-2","type":"tiktok","url":"https://www.tiktok.com/@tiktok/video/7106594312292453678","caption":"Short Tips: Setup Barista Station yang Efisien untuk Ruang Sempit"}]'::jsonb,
    '{"metaTitle":"Cara Membuka Kafe Modal 10 Juta Sukses & Untung | Blog Harapan Baru","metaDescription":"Panduan lengkap cara memulai bisnis kedai kopi modal 10 juta rupiah. Pelajari perhitungan HPP, pemilihan mesin kopi, dan kontrol resep kasir otomatis.","metaKeywords":["cara buka kafe modal 10 juta","bisnis kedai kopi","kasir kafe","resep hpp kopi","new hope pos"],"canonicalUrl":"https://newhopepos.com/blog/cara-membuka-kafe-modal-10-juta-sukses"}'::jsonb,
    true,
    true,
    1420,
    89,
    '# Panduan Lengkap: Cara Membuka Kafe & Kedai Kopi Modal 10 Juta

Membuka kedai kopi atau *coffee shop* modern tidak selalu membutuhkan modal ratusan juta rupiah. Dengan strategi pemilihan peralatan yang cermat, kontrol resep gramatur yang ketat, dan adopsi sistem kasir digital modern, Anda dapat meluncurkan kedai kopi pertama Anda dengan modal Rp 10 Juta!

---

## 1. Alokasi Anggaran Modal Rp 10 Juta
- **Peralatan Barista & Mesin Kopi:** Rp 4.500.000.
- **Bahan Baku Awal:** Rp 1.800.000.
- **Kemasan:** Rp 700.000.
- **Branding & Banner:** Rp 500.000.
- **Hardware Kasir & Tablet Android:** Rp 1.500.000.
- **Dana Darurat & Operasional:** Rp 1.000.000.

---

## 2. Kunci Keuntungan: Kontrol Resep Gramatur (HPP)
Banyak kedai kopi gulung tikar bukan karena sepi, melainkan karena kebocoran bahan baku. Gunakan fitur Resep (BOM) di New Hope POS agar tiap cup yang terjual otomatis memotong stok bahan baku.',
    '2026-08-15 08:00:00+07',
    '2026-08-20 10:30:00+07'
),
(
    'blog-2',
    'rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta',
    'Rahasia Sukses Bisnis Laundry Kiloan: Cara Atur Status Cucian & Kirim Nota Otomatis via WhatsApp',
    'Strategi menghentikan komplain baju hilang/tertukar dan mendongkrak omset laundry kiloan hingga Rp 25 juta per bulan menggunakan nota digital.',
    'Laundry & Jasa',
    'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&q=80&w=1200',
    'Ibu Hj. Siti Aminah',
    'Owner Dago Express Laundry',
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
    4,
    ARRAY['Bisnis Laundry', 'Laundry Kiloan', 'Nota WhatsApp', 'Tips Usaha Jasa'],
    '[{"id":"emb-3","type":"instagram","url":"https://www.instagram.com/p/C_sample123","caption":"Workflow Packing & Quality Control Laundry Kiloan Bersih & Rapi"}]'::jsonb,
    '{"metaTitle":"Rahasia Sukses Bisnis Laundry Kiloan Omset Puluhan Juta | Blog Harapan Baru","metaDescription":"Tips praktis mengelola usaha laundry kiloan dan satuan. Pelajari cara mencegah pakaian tertukar dengan pelacakan status cucian dan nota WhatsApp otomatis.","metaKeywords":["bisnis laundry kiloan","aplikasi kasir laundry","nota wa laundry","cara buka usaha laundry","new hope pos"],"canonicalUrl":"https://newhopepos.com/blog/rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta"}'::jsonb,
    true,
    false,
    980,
    64,
    '# Rahasia Sukses Bisnis Laundry Kiloan: Bebas Komplain Baju Tertukar

Bisnis laundry adalah salah satu usaha dengan perputaran kas harian (*cashflow*) paling sehat di Indonesia. Namun, kendala terbesar adalah pakaian pelanggan yang hilang atau tertukar.

---

## 1. Terapkan Pelacakan 5 Tahapan Pengerjaan Cucian
1. **Diterima:** Timbang berat kilogram, catat jenis layanan.
2. **Sedang Cuci:** Operator mencatat pemakaian deterjen.
3. **Pengeringan:** Proses di mesin dryer.
4. **Setrika & Packing:** Cek kelengkapan pakaian.
5. **Siap Diambil:** Kirim WhatsApp otomatis ke pelanggan!

---

## 2. Kirim Nota & Notifikasi via WhatsApp
Dengan New Hope POS, saat kasir memasukkan pesanan laundry, nota digital langsung terkirim otomatis ke WhatsApp pelanggan.',
    '2026-08-16 09:30:00+07',
    '2026-08-18 14:15:00+07'
),
(
    'blog-3',
    'revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin',
    'Revolusi QRIS Dinamis di Kasir POS: Kenapa Transaksi Non-Tunai Wajib untuk UMKM di 2026',
    'Kupas tuntas keuntungan QRIS Dinamis dibandingkan QRIS Statis stiker meja, kecepatan transaksi kasir, dan rekonsiliasi otomatis cair H+1.',
    'FinTech & QRIS',
    'https://images.unsplash.com/photo-1556742049-0a67e557b640?auto=format&fit=crop&q=80&w=1200',
    'Rian Ardiansyah',
    'FinTech Solution Specialist',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    6,
    ARRAY['QRIS Dinamis', 'FinTech UMKM', 'Cashless', 'Pembayaran Digital'],
    '[{"id":"emb-4","type":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","caption":"Video Demo: Kecepatan Bayar QRIS Dinamis < 3 Detik di Kasir New Hope POS"}]'::jsonb,
    '{"metaTitle":"Keuntungan QRIS Dinamis di Mesin Kasir POS UMKM | Blog Harapan Baru","metaDescription":"Kenapa pengusaha UMKM harus beralih dari QRIS stiker ke QRIS Dinamis kasir? Simak perbandingannya untuk mencegah penipuan struk palsu dan rekonsiliasi instan.","metaKeywords":["qris dinamis pos","pembayaran digital umkm","kasir qris otomatis","new hope pos payment"],"canonicalUrl":"https://newhopepos.com/blog/revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin"}'::jsonb,
    true,
    false,
    1850,
    120,
    '# Revolusi QRIS Dinamis: Solusi Anti Struk Palsu & Pembayaran Cepat

Di era pembayaran serba non-tunai saat ini, menyediakan QRIS adalah keharusan bagi setiap toko fisik. Namun, banyak pemilik bisnis masih menggunakan QRIS Statis (stiker meja) yang rawan dipalsukan.

---

## ✅ Keunggulan QRIS Dinamis di New Hope POS:
- **Nominal Otomatis:** Barcode QR di layar kasir sudah berisi total tagihan.
- **Deteksi Otomatis Real-time:** Begitu bayar, layar kasir langsung berubah menjadi LUNAS.
- **Struk Kasir Langsung Tercetak.**',
    '2026-08-17 11:00:00+07',
    '2026-08-21 09:00:00+07'
)
ON CONFLICT (id) DO NOTHING;


-- 2. TABEL PELANGGAN (POS & CRM) ---------------------------------------------

CREATE TABLE IF NOT EXISTS pos.customers (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id      UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id    UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    external_ref   TEXT NOT NULL,
    name           TEXT NOT NULL,
    phone          TEXT,
    email          TEXT,
    address        TEXT,
    notes          TEXT,
    total_spent    NUMERIC(15,2) NOT NULL DEFAULT 0,
    orders_count   INTEGER NOT NULL DEFAULT 0,
    last_visit_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_customers_tenant_ref UNIQUE (tenant_id, external_ref)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON pos.customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_merchant ON pos.customers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON pos.customers(phone);


-- 3. HAK AKSES PERAN DATABASE ------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT ALL ON pos.customers TO svc_pos;
        GRANT SELECT ON public.blog_posts TO svc_pos;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_internal') THEN
        GRANT ALL ON public.blog_posts TO svc_internal;
        GRANT SELECT, UPDATE, DELETE ON pos.customers TO svc_internal;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
        GRANT SELECT ON public.blog_posts TO bi_readonly;
        GRANT SELECT ON pos.customers TO bi_readonly;
    END IF;
END $$;
