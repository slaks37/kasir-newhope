# Blog: halaman, SEO, dan otomasi artikel

## Yang berjalan
| URL | Isi |
|---|---|
| `/blog` | Daftar artikel, filter `?kategori=<slug>`, paginasi `?halaman=2` |
| `/blog/<slug>` | Artikel |
| `/sitemap.xml` | Beranda, blog, kategori, dan semua artikel terbit (dinamis dari database) |
| `/rss.xml` | 30 artikel terbaru |
| `/api/v1/blog-automation/*` | REST API otomasi (API key) |
| `/api/v1/blog-automation/mcp` | MCP untuk agen AI (API key) |

Halaman blog dirender di server (`src/server/blogPages.ts`) sebagai HTML lengkap. Google membaca judul, canonical, Open Graph, JSON-LD (`Blog`, `BlogPosting`, `BreadcrumbList`, `FAQPage`), dan isi artikel tanpa menjalankan JavaScript. GTM `GTM-WD7T7WSF` terpasang di setiap halaman blog.

### Lapisan halaman artikel
1. **Header situs**: merek, navigasi, tombol daftar.
2. **Header artikel**: breadcrumb → **satu H1** (field `title`) → ringkasan (`excerpt`) → penulis, tanggal, waktu baca.
3. **Sampul** (`coverImage`).
4. **Isi**: Markdown dari `content`, dengan subjudul `##`/`###` dan daftar isi otomatis di samping (desktop).
5. **FAQ** (`faq`), **tag**, **kotak penulis**, **CTA**.
6. **Artikel terkait** (kategori yang sama dulu).
7. **Footer**.

Judul di dalam `content` (`# ...`) otomatis dibuang bila sama dengan `title`, atau diturunkan menjadi H2. Setiap halaman hanya punya satu H1.

## Menyalakan API otomasi
1. Buat key: `openssl rand -hex 32`.
2. Vercel → Project → Settings → Environment Variables: `BLOG_API_KEYS=<key>` (beberapa key dipisah koma, satu per integrasi, agar bisa dicabut sendiri-sendiri). Lalu redeploy.
3. Pastikan migrasi `supabase/migrations/20261005090000_blog_posts_store.sql` sudah dijalankan di Supabase. Migrasi ini membuat tabel blog bila belum ada, mengaktifkan RLS, dan menutup akses langsung dari browser.

Tanpa `BLOG_API_KEYS`, semua endpoint otomasi menjawab `503 BLOG_API_NOT_CONFIGURED`.

## REST API
Header: `Authorization: Bearer <key>` (atau `X-Api-Key: <key>`).

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/v1/blog-automation/guide` | Kategori, aturan, format |
| GET | `/api/v1/blog-automation/posts?status=published\|draft\|all&category=&limit=&offset=` | Daftar artikel |
| GET | `/api/v1/blog-automation/posts/<slug>` | Isi lengkap |
| POST | `/api/v1/blog-automation/validate` | Cek tanpa menyimpan |
| POST | `/api/v1/blog-automation/posts` | Buat artikel, **langsung terbit** bila lolos (kirim `"publish": false` untuk draft) |
| PUT | `/api/v1/blog-automation/posts/<slug>` | Perbarui (kirim semua field) |
| DELETE | `/api/v1/blog-automation/posts/<slug>` | Tarik dari publik (data tidak dihapus) |

Batas tulis: 120 per jam per key.

```bash
curl -X POST https://kasir.newhope.space/api/v1/blog-automation/posts \
  -H "Authorization: Bearer $BLOG_API_KEY" -H "Content-Type: application/json" \
  -d @artikel.json
```

### Format artikel (`artikel.json`)
```json
{
  "title": "Cara Menghitung HPP Kopi Susu untuk Kedai Kecil",
  "excerpt": "Panduan langkah demi langkah menghitung HPP kopi susu per gelas, lengkap dengan contoh tabel dan kesalahan yang sering terjadi.",
  "category": "Kuliner & F&B",
  "content": "Paragraf pembuka...\n\n## Mengapa HPP penting\n...\n\n## Langkah menghitung HPP\n...\n\n## Kesalahan yang sering terjadi\n...",
  "tags": ["HPP", "Kedai Kopi"],
  "coverImage": "https://.../kopi.jpg",
  "coverAlt": "Barista menakar susu untuk kopi susu",
  "author": { "name": "Tim Editorial New Hope POS", "role": "Editor" },
  "seo": { "focusKeyword": "HPP kopi susu", "metaDescription": "70–170 karakter" },
  "faq": [{ "question": "Berapa HPP ideal kopi susu?", "answer": "Umumnya 30–40% dari harga jual..." }]
}
```

### Aturan (artikel ditolak `422 ARTICLE_REJECTED` bila dilanggar)
- `title` 20–100 karakter, unik. `slug` dibuat dari judul bila kosong, unik.
- `excerpt` 80–300 karakter. `seo.metaDescription` 70–170 karakter (default: dari excerpt).
- `content` minimal **500 kata** dan **3 subjudul `##`**.
- `category` salah satu dari: Tips Bisnis & Strategi, Panduan Kasir & POS, FinTech & QRIS, Kuliner & F&B, Laundry & Jasa, Ritel & Minimarket, Kisah Sukses UMKM.
- `coverImage` dan avatar harus `https`. `tags` maksimal 8, `faq` maksimal 8.
- **Klaim terlarang**: pencairan H+1, deteksi lunas otomatis oleh New Hope, "tanpa biaya admin"/"MDR 0%", omzet/untung yang dijamin.

Peringatan (tidak memblokir) dikembalikan di `warnings`, misalnya di bawah 900 kata, `focusKeyword` tidak ada di judul/subjudul/meta, atau tanpa sampul.

HTML mentah di `content` tidak dirender. Tautan hanya http(s)/mailto/relatif, dan gambar hanya https.

## MCP (Claude, n8n, agen lain)
Endpoint: `https://kasir.newhope.space/api/v1/blog-automation/mcp` (HTTP, JSON-RPC 2.0), header `Authorization: Bearer <key>`.

Tools: `blog_guide`, `list_posts`, `get_post`, `validate_article`, `create_post`, `update_post`, `unpublish_post`.

Claude Code:
```bash
claude mcp add --transport http newhope-blog https://kasir.newhope.space/api/v1/blog-automation/mcp --header "Authorization: Bearer $BLOG_API_KEY"
```

Alur yang disarankan untuk agen: `blog_guide` → tulis → `validate_article` → perbaiki error → `create_post`.

## SEO: hal yang tetap perlu dilakukan manusia
- **Search Console**: login dengan akun pemilik properti, pilih properti `https://kasir.newhope.space`, lalu **Sitemaps → tambahkan `sitemap.xml`**. Pantau "Pages" untuk artikel yang belum terindeks.
- **GTM**: pastikan kontainer `GTM-WD7T7WSF` punya tag GA4 yang terpublikasi. Kode kontainer sudah ada di semua halaman.
- **Kualitas lebih penting dari jumlah.** Kebijakan Google tentang *scaled content abuse* menurunkan peringkat situs yang menerbitkan banyak artikel tipis atau berulang, termasuk artikel buatan AI. Aturan di atas adalah batas bawah. Artikel yang menang biasanya menjawab satu pertanyaan spesifik pemilik usaha dengan contoh angka nyata.
