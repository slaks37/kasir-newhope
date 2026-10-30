# Blog automation — audit dan kandidat perbaikan 30 Oktober 2026

## A. Penyebab dan bukti

Workflow `LY2WqUqboTtPgBSE` aktif, versi draft/live `c8993641-7af1-4575-b8ff-2a5a4f806ab2`, jadwal `0 0 * * * *`, timezone Asia/Jakarta. Scheduler bekerja. Tidak ada manual execution/replay, aktivasi, perubahan flag LIVE, merge, atau deployment production selama pekerjaan ini.

- **P1:** execution 16446, 12.00 WIB, berhenti di `Store Cover - New Hope API`, HTTP 500/`INTERNAL_ERROR`. `src/server/blogMedia.ts` di base main masih membutuhkan Supabase Storage configuration. Error provider lolos ke catch generik `src/server/blogRoutes.ts`. Pesan Vercel `BLOG_STORAGE_NOT_CONFIGURED` berasal dari laporan pemilik; log pukul 12.00 tidak dapat diambil ulang karena retensi Hobby. Query 50 menit terakhir tidak menemukan pesan itu; itu tidak membantah log lama.
- **P2:** execution 16445, 11.00 WIB, score 93, 934 kata, empat H2, kategori artikel tidak ada; `opportunity.category` = `Tips Bisnis & Strategi`. Menjalankan data node asli pada parser lokal menunjukkan sebelum `qualified:false`, sesudah `qualified:true`, dengan score/kata/H2 tetap. Ini uji parser lokal, bukan replay n8n. Execution 16447 pukul 13.00 juga hijau tetapi audit `rejected_quality` (score 94, 1500 kata, lima H2).
- **P3:** branch quality memang dapat selesai sukses tanpa publikasi. Upload cover sebelumnya berhenti sebelum `Append Opportunities Audit`; result publication memakai status generik `error_http` dan tidak mempunyai execution ID terstruktur.
- **P4:** graf mempunyai sampai enam request gambar berbayar (tiga node, masing-masing maxTries dua), termasuk retry auth/timeout ambigu. Slug unik melindungi slug yang sama, tetapi pemeriksaan title sebelum insert dapat berlomba. Tidak ada durable receipt replay publication; ACK ambigu harus diselesaikan dengan GET slug, bukan POST ulang.

## B. Perubahan

- `src/server/blogStorage.ts`: AWS SDK S3 v3, endpoint akun R2, region auto, conditional `IfNoneMatch:*`, UUID object keys, HTTPS base validation, JPEG/size metadata, deadline 18 detik, maksimal tiga percobaan SDK untuk error transient. Error konfigurasi 503, upload 502, key collision 409; detail provider tidak keluar ke client.
- `blogMedia.ts`: seluruh upload foto admin dan gambar automation memakai adapter R2. Tidak ada fallback Supabase dalam path ini. Guard admin/MFA dan API key tidak diubah. Provider dibuat lazy sehingga aplikasi tetap dapat membaca blog ketika R2 belum tersedia.
- `blogCover.ts`: tetap host allowlist Agnes, tanpa redirect, maksimal 8 MB, 20 MP, output 1200×675 JPEG ≤500 KB. Validasi format nyata menolak SVG yang menyamar sebagai PNG; kegagalan download memiliki kode eksplisit.
- `blogRoutes.ts`: meneruskan error storage yang aman; transaction advisory lock membuat check slug/title dan insert antar automation writers berurutan. Tidak ada migrasi DB. Semua writer lain tetap bergantung pada constraint DB dan kebijakan mereka sendiri; ini bukan global semantic-news deduplication.
- `docs/blog/n8n-r2-review.json`: export lengkap **inactive**, dibuat dari graf live yang dibaca, mempertahankan referensi credential, Agnes models, hourly WIB dan flag LIVE asli. Belum diimport atau dipublish. Parser hanya mengisi kategori absent/null/blank dengan opportunity yang persis cocok dengan approved list; kategori nonempty yang tidak sah tetap ditolak.
- Node baru: `Normalize Discovered`, dua normalizer kegagalan cover, `Check Generated Cover`, `Cover Stored?`, `Classify Validation Retry`, `Retry Validation?`, `Validation Backoff`. Upload body/status diperiksa sebelum attach/publish. Retry validasi hanya 429/500/502/503/504 dan transport transient yang dikenali; dua retry pada 2 dan 4 detik. AI dan publication tidak diulang otomatis.
- Audit tetap memakai kolom Sheets yang sudah ada. `status`: discovered, rejected_quality, validation_failed, cover_generation_failed, cover_upload_failed, publish_failed, published, duplicate_skipped. `raw_analysis` berisi execution ID, WIB timestamp, sumber, artikel, score, validation/cover/publication result, URL, error code/stage dan referensi node pemulihan. Hanya HTTP 201 + ok + isPublished + HTTPS URL menjadi published. Recovery reference menunjuk konten di execution yang sama; tidak menyalin secret header/error request atau temporary signed image URL ke Sheets.

## C. Pengujian dan batas bukti

- `npm run verify`: PASS lint, build, runtime dan seluruh suite yang ada; log memiliki 82 baris PASS. Sesudah perubahan akhir batas image/adapter, lint/build diulang dan targeted blog regression dijalankan.
- `npm run test:blog-automation`: PASS parser nyata, kategori valid/invalid, quality/freshness/evidence/duplicate gates, audit status, graph integrity, validation backoff/auth exclusion, mock R2 config/conditional write/failure, API 503, unsupported/oversized media.
- `scripts/dev/test-blog.ts`: PASS API + PGlite, termasuk dua POST bersamaan menghasilkan satu 201, satu 409 dan tepat satu row. Ini database lokal, bukan bukti konkurensi multi-connection Neon production.
- `scripts/dev/test-blog-e2e.mjs`: PASS synthetic Agnes JSON → parser → real validation API → JPEG normalization → mock R2 write → dua publication request → tepat satu row → halaman artikel dan OG image sesuai. AI/image transport dan object store dimock; server lokal HTTP. Ini tidak membuktikan R2 nyata atau hosted HTTPS E2E.
- `scripts/dev/test-blog-photo.ts`: PASS manual photo, guard admin/MFA, unique paths, safe failures.
- n8n connector schema validation: 13 node kandidat yang berubah/baru PASS; seluruh Code node dapat dikompilasi JS lokal. Graf dicek koneksinya. Belum ada hosted n8n execution kandidat.
- Production read-only: `/blog` HTTP 200; tiga URL JPEG lama pada Neon object storage mengembalikan HTTPS 200 image/jpeg. Tidak ada penulisan production. Bukti ini sampel, bukan audit semua gambar.
- `npm audit`: 5 advisori pada dependency existing: body-parser/high, proxy-addr/critical, qs/moderate, source-map-js/high, vite/high. Tidak ada advisori yang dilaporkan untuk SDK R2 baru. Perbaikan dependency lintas aplikasi di luar scope ini.

## D. Infrastruktur dan blocker

Cloudflare read-only API pada akun terhubung mengembalikan **403 / 10042: Please enable R2 through the Cloudflare Dashboard**. R2 belum dapat dipakai dari koneksi ini. Tidak mengaktifkan billing, membuat bucket, atau secret. Pembacaan metadata env Vercel terpotong oleh connector; keberadaan lima env berikut belum terverifikasi dan tidak boleh dianggap tersedia.

```dotenv
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
```

Aktifkan R2 di akun yang dimaksud, buat bucket khusus blog (dan bucket terpisah untuk test), lalu credential object write terbatas pada bucket. Simpan access key/secret hanya di server Vercel, tanpa `VITE_` dan tanpa Git. Public base harus HTTPS stabil yang memetakan root bucket/prefix yang benar; gunakan custom domain publik dengan sertifikat valid. Endpoint S3 untuk write berbeda dari public read URL. Provision bucket/domain di luar request upload; adapter tidak membuat bucket otomatis dan tidak memasang ACL S3. Jangan memasang lifecycle expiration pada published covers. Anonymous upload harus tetap ditolak. Browser CORS tidak diperlukan untuk `<img>` atau write server; jika editor memerlukan canvas cross-origin, batasi origin yang memang dipakai.

No notification destination untuk workflow blog ditemukan pada graf. Ada credential SMTP/WhatsApp pada instance, tetapi keberadaan credential bukan bukti izin tujuan penerima. Failure branches menuju audit Sheets yang sudah digunakan. Pengiriman notifikasi keluar dan error workflow untuk kegagalan RSS/Sheets masih **BLOCKED** sampai tujuan yang diotorisasi dikonfigurasi. Tidak mengirim pesan percobaan.

Execution source menyimpan konten yang diperlukan untuk resume stage. Export konten dari node parser/cover ke penyimpanan privat sebelum retention memangkas execution. Jangan memulihkan dengan replay workflow live: generasi berbayar dapat terulang dan artikel dapat terbit.

## E. Rilis dan rollback

1. Review PR dan export; simpan versi deployed/backend dan export live n8n sebagai rollback. Jangan publish kandidat sebelum approval production.
2. Siapkan R2 test + env Preview secara privat. Pastikan DB test terisolasi dari production dan publisher test key scoped. Preview dari branch ini tidak mempunyai konfigurasi R2/DB terverifikasi; tidak menyalin env production.
3. Import kandidat sebagai workflow baru **inactive**. Ubah seluruh endpoint New Hope (validate/posts/covers/RSS/repair) ke test host sebelum execution; gunakan credential test, audit test sheet, nonaktifkan schedule selama acceptance. Export membawa flag LIVE asli true: inactive bukan perlindungan dari klik manual. Jangan menjalankan kandidat yang masih menunjuk production.
4. Jalankan synthetic article di test host dengan AI output fixture/pinned, lalu uji Agnes/R2 nyata bila credential test tersedia. Pastikan cover HTTPS GET 200 JPEG, URL persisten, artikel dan OG sama, satu publikasi saat overlap/retry, Sheets final status benar. Jangan menyebut hosted acceptance PASS sebelum bukti ini ada.
5. Setelah bukti lengkap dan **persetujuan production eksplisit**, tambahkan env production, deploy backend yang direview, lalu terapkan patch node ke workflow asli dengan credential refs yang ada. Pertahankan jadwal WIB/flag. Hindari dua workflow aktif. Verifikasi run terjadwal berikut dan URL artikel publik.
6. Rollback: kembalikan backend deployment dan versi n8n sebelumnya sebagai pasangan. Jangan hapus bucket/objek R2 atau mengubah URL lama. Backend lama masih memerlukan konfigurasi Supabase untuk upload baru; rollback tidak otomatis memperbaiki masalah storage asli. Artikel yang sudah dibuat tetap disimpan; koreksi lewat proses editorial yang diotorisasi, jangan mass-delete.
7. Timeout publikasi ambigu: GET slug yang deterministik dan periksa status/URL/isi. Bila ditemukan, catat hasil dan jangan POST ulang. Bila belum jelas, tahan untuk review; tidak ada retry otomatis. Slug/title guard menolak duplikat, bukan replay sukses yang durable.

Untuk rebuild kandidat: ambil export live yang baru, lalu jalankan `node scripts/dev/patch-blog-workflow.mjs path/to/export.json docs/blog/n8n-r2-review.json`. Script mengharapkan graf dasar yang belum dipatch dan fail bila node/anchor tidak cocok. Bandingkan diff serta validasi node sebelum mengimpor.

## F. Acceptance

| Kriteria | Status | Bukti / sisa |
|---|---|---|
| Adapter R2 dan tanpa Supabase upload aktif | PASS | Kode dan mock adapter test; belum dirilis |
| Error konfigurasi jelas | PASS | Cover API 503 BLOG_STORAGE_NOT_CONFIGURED |
| Storage permanen R2 + HTTPS nyata | BLOCKED | R2 belum aktif, env belum terverifikasi |
| Foto admin dan URL lama | PASS | Regression admin + 3 URL lama HTTPS 200 |
| Recovery kategori dan quality gates | PASS | Parser synthetic + data asli 16445, tidak dilemahkan |
| Failure upload/guard publication/audit | PASS | Kandidat + JS/schema tests; belum hosted |
| Hourly Asia/Jakarta | PASS | Live dan export mempertahankan jadwal |
| Retry/overlap/ambiguous timeout | PARTIAL | Bounded validation/SDK, local overlap PASS; belum Neon hosted/durable receipts |
| Notifikasi kegagalan eksternal | BLOCKED | Tujuan penerima belum dikonfigurasi/diotorisasi |
| Qualified article E2E terisolasi | PASS | Real local API/PGlite, AI/R2 transport mocked |
| Agnes + R2 + publish sekali hosted test | BLOCKED | R2/credential test dan hosted acceptance belum tersedia |
| Lint/build/tests | PASS | Full verify + targeted akhir |
| Production tidak diubah | PASS | Hanya read-only checks; tanpa deploy/merge/live replay |

**Status keseluruhan: PARTIAL — kode dan export siap direview; belum siap rilis production.**
