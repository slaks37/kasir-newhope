# New Hope POS

Sistem kasir multi-sektor untuk **Kafe/Resto, Laundry, Ritel, Carwash, dan Barbershop**, dengan AI Copilot, langganan SaaS (DOKU), dan konsol internal untuk penyedia SaaS.

Kasir bekerja **offline-first**: penjualan disimpan dulu di perangkat lalu disinkronkan ke PostgreSQL. Laporan, admin, dan AI membaca angka yang sama dari ledger server.

---

## Menjalankan secara lokal

```bash
npm install
npm run dev        # database + migrasi + auth lokal + 5 service
npm run db:seed    # (terminal kedua) 6 merchant demo, ±3.500 transaksi
```

Buka `http://localhost:3000` (kasir) dan `http://localhost:3000/admin` (konsol internal).

- **Database**: PGlite (PostgreSQL dalam WASM) yang menyajikan protokol wire Postgres, jadi service memakai driver `pg` biasa. Tidak perlu Docker.
- **Login lokal**: bila `SUPABASE_URL` kosong, `npm run dev` menjalankan `services/dev-auth`, yaitu tiruan Supabase Auth khusus pengembangan. Ia memprovisi akun lewat trigger signup yang sama dengan produksi (`docs/security/supabase-auth-signup.sql`). Daftar akun baru di `/register`, atau pakai akun demo dari `db:seed`: `demo-<nama>@newhope.local` / `Demo-pass-123`. Service ini menolak jalan saat `NODE_ENV=production` dan hanya listen di `127.0.0.1`. MFA admin (TOTP) tidak didukung secara lokal.
- **Seeder** mengisi data lewat API asli (signup → `sync/state` → `sync/transactions` → `sync/activity`), sehingga data demo selalu melewati aturan bisnis yang sama dengan kasir sungguhan. Aman dijalankan ulang.
- `npm run db:reset` menghapus database lokal. Setelah itu jalankan `npm run dev`, lalu `npm run db:seed`.

---

## Arsitektur

Kode yang sama dijalankan dalam dua topologi.

**1. Microservice (lokal / Docker / server sendiri)**

```
gateway :3000  ──┬─ pos        :3101  skema pos       transaksi, katalog, state, laporan, kas
  SPA + auth     ├─ ai         :3102  skema ai        copilot, LLM, kredit AI
                 ├─ billing    :3103  skema billing   langganan, faktur, webhook DOKU
                 └─ backoffice :3104  skema internal  konsol penyedia
                        ↓
                 contract.*  ← view bersama, satu-satunya permukaan baca lintas domain
```

Gateway memverifikasi token Supabase (`GET /auth/v1/user`) lalu meneruskan principal ke service dengan `INTERNAL_GATEWAY_TOKEN`. Service menolak request yang tidak datang dari gateway. Header identitas dari browser selalu dibuang.

**2. Vercel (produksi saat ini)**: SPA statis + fungsi serverless di `api/`. Setiap fungsi adalah *boundary* kecil (`src/server/serverlessBoundary.ts`) dengan urutan: allowlist path/method → autentikasi → buang header palsu → baru membuka koneksi DB. Request anonim tidak pernah menyentuh database.

| Path | Entry | Isi |
|---|---|---|
| `/api/v1/sync/*`, `/api/v1/reports/*`, `/api/v1/finance/*` | `syncHandler` | services/pos |
| `/api/v1/subscription/*`, `/api/v1/webhooks/doku` | `billingHandler` | services/billing |
| `/api/v1/assistant/*` | `assistantHandler` | services/ai |
| `/api/admin/*`, `/api/v1/blog*` | `adminHandler` | konsol internal & blog publik |
| `/api/cron/*` | handler cron | Vercel Cron (dijaga `CRON_SECRET` + `CRON_ENABLED_JOBS`) |

Bundle `api/_*_bundle.js` di-commit karena Vercel menjalankannya apa adanya. Bangun ulang dengan `npm run build:api`; CI menolak PR yang bundle-nya basi.

### Batas data
- Setiap service login sebagai perannya sendiri (`svc_pos`, `svc_ai`, …). Lintas domain hanya lewat view `contract.*`.
- Omzet di laporan, admin, dan AI berasal dari satu view kanonik: `contract.merchant_revenue`.
- Hierarki **tenant (pemilik) → merchant (unit usaha) → outlet (cabang)**. Laporan selalu di-scope ke outlet milik pemilik yang login.
- Batas waktu query: `SET LOCAL statement_timeout` per transaksi + default per peran service (8 dtk, `DB_STATEMENT_TIMEOUT_MS`), di bawah timeout gateway 10 dtk.

### Sinkronisasi kasir
- **Transaksi** (`POST /api/v1/sync/transactions`): batch idempoten. Setiap penjualan diterima atau ditolak **sendiri-sendiri**. Penjualan yang ditolak (total tidak cocok, diedit setelah terkirim, dst.) masuk **karantina** di Sync Center dan tidak menahan penjualan lain. Nomor struk yang bentrok antar perangkat dinomori ulang, tidak ditolak.
- **State operasional** (`/api/v1/sync/state`): produk, kategori, pelanggan, meja, setting, dll. dengan revisi per record (konflik ditampilkan, tidak ditimpa diam-diam).
  - Snapshot dimuat per halaman 5.000 record (`?paged=1&cursor=…`). Bila data berubah di tengah pemuatan, klien mengulang dari awal, sehingga snapshot tidak pernah setengah lama setengah baru.
  - Polling hanya membaca `pos.shared_state_versions`, yang dinaikkan trigger setiap kali record berubah. Tidak ada lagi pemindaian seluruh baris.
  - Riwayat hanya dikirim jendela terbarunya (mis. 2.000 log stok terakhir, tiket dapur 3 hari, operasi order 120 hari; lihat `HISTORY_WINDOWS`). Baris lama tetap di database untuk audit dan laporan.
- **Refresh saat offline**: build produksi memasang service worker (`src/pwa/serviceWorker.ts`) yang menyimpan `index.html` dan file `/assets/*` ber-hash. API, `/admin`, dan Supabase tidak pernah melewatinya. Data offline (antrean penjualan, snapshot toko) tetap disimpan aplikasi di `localStorage`.
- **Kas & refund**: outbox keuangan terpisah dengan ledger yang tidak bisa diubah (koreksi = entri pembalik).

### Pembayaran
- **Di kasir**: Tunai, QRIS statis toko, kartu, dan transfer dicatat oleh kasir, **tanpa** integrasi payment gateway. Status lunas adalah konfirmasi kasir.
- **Langganan SaaS**: DOKU Checkout. Invoice disimpan sebelum checkout, pembayaran diaktifkan oleh **webhook DOKU bertanda tangan** (diverifikasi dari byte asli), dan `verify` hanya melaporkan lunas bila ledger benar-benar menerapkannya. Tidak ada endpoint simulasi pembayaran.

---

## Perintah

| Perintah | Kegunaan |
|---|---|
| `npm run dev` | Seluruh sistem lokal (database + migrasi + auth lokal + 5 service) |
| `npm run db:seed` | Data demo lewat API asli (saat `npm run dev` berjalan) |
| `npm run db:reset` | Hapus database lokal |
| `npm run db:migrate` | Terapkan migrasi ke `DATABASE_URL` |
| `npm run lint` | Hygiene + typecheck `src`, `services`, `api`, `scripts` |
| `npm test` | Seluruh suite test (PostgreSQL in-process, tanpa jaringan) |
| `npm run build` | SPA + service + bundle Vercel |
| `npm run build:api` | Hanya bundle Vercel `api/_*_bundle.js` |

---

## Menyambung ke PostgreSQL sungguhan (Supabase, RDS, Neon)

Isi `DATABASE_URL` di `.env`, lalu `npm run db:migrate` dan `npm run dev`.

Untuk Supabase, pakai **Session pooler** (port 5432) untuk migrasi dan service jangka panjang. Fungsi Vercel otomatis memakai transaction pooler (6543), karena pengaturan sesi yang dipakai bersifat lokal per transaksi.

Instalasi Postgres non-Supabase didukung: `migrations/0001_compat.sql` menyediakan `uuidv7()` untuk Postgres < 18 dan membuat peran `anon`/`authenticated`/`service_role` (NOLOGIN, tanpa hak) yang dirujuk migrasi lanjutan.

Tabel besar di produksi: index baru dibuat dengan `CREATE INDEX CONCURRENTLY` secara manual lebih dulu (lihat [runbook](docs/operations/runbook-2026-10-stabilization.md)).

---

## Produksi (Docker)

```bash
docker compose up --build
```

Database di sini adalah PostgreSQL 18 sungguhan. **Belum diuji end-to-end di lingkungan produksi.** Topologi yang berjalan di produksi saat ini adalah Vercel + Supabase. Sebelum memakai Docker di produksi: ganti `POSTGRES_PASSWORD` default, hapus publikasi port 5432, dan isi `INTERNAL_GATEWAY_TOKEN`.

---

## Keamanan (ringkas)

- **Merchant**: Supabase Auth. Server memverifikasi token ke Auth API, bukan mempercayai payload JWT.
- **Konsol internal**: Supabase Auth + keanggotaan `internal.internal_users` + **MFA (aal2)** untuk aksi sensitif. Penautan akun admin lewat email hanya untuk email terverifikasi dan akun yang belum terikat. Penautan tidak pernah mengubah role atau mengaktifkan ulang admin yang dinonaktifkan.
- **Browser tidak punya akses SQL langsung** ke data bisnis. Semua lewat API (`docs/security/restrict-browser-rls-policies.sql`).
- Override PIN supervisor di kasir (mis. void tanpa izin `void_order`) diverifikasi **di perangkat**. Nama penyetuju dicatat di catatan order dan log perangkat. Belum ada penegakan sisi server, dan hash PIN ikut tersinkron ke perangkat. Usulan perbaikannya ada di [dokumen keputusan produk §2](docs/design/2026-10-keputusan-produk.md).

---

## Konfigurasi

Salin `.env.example` menjadi `.env`. Setiap variabel dijelaskan di sana.

AI Copilot: Layer aturan dan analitik berjalan tanpa kunci. Pertanyaan terbuka memakai `AGNES_API_KEY` (utama) atau `DEEPSEEK_API_KEY` (cadangan).

---

## Dokumentasi

- [`Dokumentasi.md`](Dokumentasi.md): arsitektur, hierarki data, alur kasir end-to-end
- [`docs/operations/runbook-2026-10-stabilization.md`](docs/operations/runbook-2026-10-stabilization.md): langkah rilis perbaikan Oktober 2026 dan pemeriksaan pasca-rilis
- [`docs/qa/2026-10-04-qa-report.md`](docs/qa/2026-10-04-qa-report.md): hasil QA (logic, data, performa, load) dan status perbaikannya
- [`docs/blog/automation.md`](docs/blog/automation.md): blog server-rendered, SEO, dan API/MCP otomasi artikel
- [`docs/design/2026-10-keputusan-produk.md`](docs/design/2026-10-keputusan-produk.md): tiga keputusan produk yang menunggu jawaban (stok ledger, PIN server, QRIS dinamis)
- [`docs/cloud-financial-architecture.md`](docs/cloud-financial-architecture.md): ledger keuangan
- [`docs/operations/sync-center-repair.md`](docs/operations/sync-center-repair.md): pemulihan data sinkronisasi
- [`docs/smart-assistant-architecture.md`](docs/smart-assistant-architecture.md): arsitektur AI Copilot
- [`docs/erd.md`](docs/erd.md): ERD inti (lihat catatan cakupan di dalamnya)

---

## Lisensi

[Apache License 2.0](LICENSE)
