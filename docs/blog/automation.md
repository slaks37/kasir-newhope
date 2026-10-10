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

### Memastikan artikel benar-benar terbit dari Make

- Header harus berisi **string kunci**, bukan objek connection atau teks `[object Object]`. Header yang salah menghasilkan `401 INVALID_API_KEY`; artikel tidak disimpan.
- Run Make berwarna hijau bukan bukti publikasi bila HTTP error hanya dicatat lalu diabaikan. Setelah pencatatan error, hentikan run sebagai gagal untuk kegagalan autentikasi/server.
- Konfirmasi publikasi dengan respons `201`, `ok: true`, `post.isPublished: true`, dan URL `post.url`. Draft tidak boleh diberi status published.
- `422` memerlukan perbaikan isi artikel. `409` memerlukan pemeriksaan artikel yang sudah ada, bukan publikasi ulang dengan slug acak.
- Verifikasi artikel di `/blog/<slug>`, daftar `/blog`, `/sitemap.xml`, dan `/rss.xml`. Cache publik dapat menunda tampilan terbaru; jangan membuat salinan artikel untuk mengatasi cache.
- Secret Vercel tidak dapat dibaca kembali. Jika kunci hilang, rotasi dengan persetujuan pemilik dan perbarui seluruh connector blog yang memakai kunci lama, lalu redeploy. Jangan memasukkan kunci ke Git atau log.

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


## ChatGPT Blog — OAuth editorial

Endpoint: `https://kasir.newhope.space/api/blog-mcp`. Tambahkan aplikasi MCP khusus
melalui pengaturan ChatGPT dan pilih **OAuth**. Discovery mengumumkan issuer
`https://kasir.newhope.space/api/blog-mcp/oauth` dan scope `blog:write`.
Tidak diperlukan API key n8n pada ChatGPT.

Superadmin masuk melalui `/admin/blog-connect`, memverifikasi MFA, lalu meninjau
izin membaca artikel/draft, membuat, memperbarui, menerbitkan, dan menarik artikel.
Kelola/cabut koneksi di `/admin/blog-connections` atau menu Integrasi admin.
Persetujuan berlaku 30 hari; access token satu jam; refresh token berotasi dan replay
mencabut seluruh koneksi. Tokens disimpan sebagai hash SHA-256 di schema privat
`blog_mcp_private`. Setiap panggilan memeriksa membership Superadmin aktif.

`create_post` dan `update_post` memakai `publish:false` secara default. Kirim
`publish:true` hanya atas perintah publikasi eksplisit dari pengguna. Artikel
harus melewati aturan kualitas REST API yang sama. Simpan dan audit berjalan dalam
satu transaksi. Konektor POS `/api/mcp` tetap read-only dengan audience/token lain;
API key n8n/Make dan JWT POS tidak diterima sebagai token editorial.

Deploy: jalankan migrasi `supabase/migrations/20261009234039_blog_editorial_oauth.sql`,
`npm run test:blog-mcp`, `npm run test:mcp`, `npm run lint`, dan `npm run build`.
`BLOG_MCP_PUBLIC_ORIGIN` opsional, default `https://kasir.newhope.space`;
`BLOG_MCP_ENABLED=false` menghentikan seluruh endpoint editorial bila dibutuhkan.
Koneksi dalam akun ChatGPT baru selesai setelah persetujuan OAuth nyata dan uji tool
berhasil; deployment endpoint tidak otomatis membuat akun terhubung.
