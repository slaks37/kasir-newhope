# New Hope POS

POS multi-sektor untuk Kafe/Resto, Laundry, Ritel, Carwash, dan Barbershop, dengan konsol admin SaaS dan analisis bisnis.

**Status produk dan batasan:** baca [audit menyeluruh](docs/architecture/product-audit-2026-10-04.md). Adanya halaman, tombol, atau tes fixture bukan bukti semua integrasi produksi sudah tervalidasi.

## Arsitektur yang digunakan

- React/Vite: halaman publik, autentikasi, workspace POS, dan aplikasi admin yang dimuat terpisah.
- Supabase Auth memverifikasi identitas. Backend memeriksa membership, tenant, bisnis, outlet, dan entitlement. Admin juga memerlukan role internal dan MFA.
- PostgreSQL adalah sumber transaksi, refund/void, cash ledger, dan laporan. Shared operational state menyimpan versi produk/kategori/meja/customer; tabel domain adalah proyeksi, bukan pemilik identitas kedua.
- Perangkat menyimpan cache, draft, recovery snapshot, dan outbox tahan-reload. Financial outbox tidak dihapus otomatis. Data salah sektor dikarantina, bukan dipindahkan diam-diam.
- Pengembangan menjalankan gateway dan layanan POS, AI, billing, backoffice. Produksi Vercel memakai native API handlers/bundles; jangan menganggap kelima proses lokal berjalan identik di Vercel.
- SQL menyebut skema secara eksplisit. Pemisahan akses ditentukan oleh role/grant koneksi database; opsi `schema` sendiri **tidak** membuat isolasi role.

Tidak ada React Query, Zustand, atau Redux kedua: identitas memakai Context yang ada, state terpilih memakai store yang ada, dan refresh/coalescing memakai coordinator yang sama.

## Menjalankan lokal

Gunakan database pengembangan khusus. Jangan menyalin kredensial produksi ke lingkungan demo.

```sh
npm ci
npm run dev
```

POS: `http://localhost:3000`; admin: `http://localhost:3000/admin`.
Orkestrator lokal menjalankan PGlite wire server, migrasi, lalu layanan. Periksa target `DATABASE_URL` sebelum menjalankan perintah database.

| Perintah | Kegunaan |
|---|---|
| `npm run lint` | Higiene sumber dan type-check |
| `npm run verify` | Regresi lintas modul, build, dan kontrak cron |
| `npm run test:runtime` | Deadline request, pemulihan auth, rollback migrasi |
| `npm run build` | SPA, layanan lokal, dan native API bundles |
| `npm run db:migrate` | Migrasi pada target yang sudah diperiksa |
| `npm run db:seed` / `db:reseed` / `db:reset` | **Hanya demo lokal**; dapat mengisi ulang/menghapus data |

Jangan menjalankan seed/reset atau seluruh bootstrap demo pada database pelanggan. Migrasi produksi harus ditinjau, diuji pada salinan staging, dicadangkan, lalu diperiksa dengan role runtime yang sebenarnya.

## Aturan bisnis

- Trial 45 hari; setelah habis menjadi Free: satu outlet yang dipilih owner, maksimal 10 produk, satu akun owner, AI nonaktif. Data berlebih tetap disimpan.
- Plus/Pro, periode bulanan/tahunan, kapasitas outlet dan add-on mengikuti [konfigurasi paket](src/config/saasPlans.ts) dan [kebijakan akses](src/config/subscriptionPolicy.ts). Jumlah bisnis bukan jumlah outlet berlisensi.
- DOKU Checkout memerlukan konfigurasi server. Redirect browser tidak membuktikan pembayaran berhasil; settlement mengikuti verifikasi dan rekonsiliasi server.
- AI deterministik tidak memakai token provider tetapi tetap tunduk pada entitlement. Analisis DeepSeek berbayar memerlukan persetujuan dan wallet member di server. Kredit aplikasi bukan batas biaya provider yang presisi.
- Reset password dikirim ke email owner yang terverifikasi. Admin tidak dapat membaca password, mengganti identitas owner sembarangan, atau melewati MFA.

## Koneksi dan operasi produksi

Rahasia database, Supabase service role, DOKU, Resend, DeepSeek, dan cron harus server-only, bukan variabel `VITE_`. Variabel browser Supabase hanya URL dan public/anon key.

Runtime Vercel mengalihkan endpoint Supabase **shared pooler** port 5432 ke mode transaksi 6543, mempertahankan host/credential. Query tidak bergantung pada session `search_path`; scope RLS memakai transaksi lokal. Migrator memakai koneksi tersendiri, bukan runtime HTTP. Lihat [pool config](services/shared/poolConfig.ts).

Untuk TLS terverifikasi, konfigurasi `PGSSLROOTCERT` dengan CA yang sesuai. Fallback TLS lama tanpa verifikasi sertifikat masih ada; enkripsi saja bukan bukti verifikasi identitas server.

Penjadwalan produksi mempunyai satu otoritas: `vercel.json`, dilindungi `CRON_SECRET` dan `CRON_ENABLED_JOBS`. Workflow GitHub batch hanya manual/dry-run. Jangan mengaktifkan pengiriman pengingat atau job lain tanpa peninjauan dampak.

Workflow `Product regression gate` memeriksa PR dan push main. Ini belum berarti branch protection atau deployment gate Vercel sudah dikonfigurasi; keduanya perlu diverifikasi terpisah.

## Dokumentasi

- [Peta produk, root cause, dan prioritas sisa](docs/architecture/product-audit-2026-10-04.md)
- [Workspace dan isolasi bisnis](docs/architecture/workspace-refactor.md)
- [Online-first: sumber data dan batasan](docs/online-first-progress.md)
- [Keamanan customer support](docs/security/client-support.md)
- [AI intelligence dan catatan rollout bertanggal](docs/ai-intelligence.md)
- [ERD historis](docs/erd.md) — cocokkan dengan migrasi terbaru, bukan jumlah tabel lama.

## Lisensi

[Apache License 2.0](LICENSE).
