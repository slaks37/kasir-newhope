# Sampul editorial AI dan sumber berita

Dibuat 8 Oktober 2026 menggunakan ImageGen bawaan, bukan CLI. Gambar adalah ilustrasi konseptual, bukan dokumentasi peristiwa. PNG asli tetap tersimpan di direktori generated_images; JPEG kualitas 80 digunakan untuk web.

- `public/blog/covers/hpp-ingredients-ai.jpg`: landscape editorial still life of Indonesian cafe ingredients, steaming soto, kitchen scale, cost notebook and calculator; natural daylight, textured wood, no logos, no legible text, no yellow background.
- `public/blog/covers/cash-reconciliation-ai.jpg`: landscape editorial still life of Indonesian cafe cashier counter, rupiah notes, calculator, receipt roll, notebook and generic smartphone payment interface; natural daylight, no logos or identifiable people, no yellow background.

Pemilihan sampul otomatis memakai pustaka ilustrasi ini berdasarkan topik. Ini **bukan** pemanggilan API pembuat gambar baru pada setiap publikasi. Foto atau sampul HTTPS yang dikirim penulis tetap dipertahankan. Sampul pustaka diberi label AI di halaman artikel.

API/MCP menerima `sources: [{title,url,publisher,publishedAt}]`. Data disimpan pada `seo.sources` dan dirender sebagai tautan sumber beserta tanggal serta JSON-LD citation. Jangan membuat kutipan ucapan yang tidak dibaca. Panduan bisnis adalah analisis editorial, bukan reproduksi berita.

Automation berita mengirim `sourceRequired: true` dan `sourceFeed` berisi feed yang benar-benar diamati. Server menolak sumber tanpa judul, tautan artikel, atau kecocokan title/link/pubDate pada satu item feed. Metadata beranda media tidak cukup. Feed hanya bukti validasi; tidak disimpan dalam artikel maupun ditampilkan ke publik. Keaslian pengambilan feed tetap menjadi tanggung jawab automation yang memegang API key.
