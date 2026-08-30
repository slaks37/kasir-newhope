# New Hope POS

Sistem kasir multi-sektor untuk **Kafe/Resto, Laundry, Ritel, Carwash, dan Barbershop**, dengan AI Copilot dan konsol internal untuk penyedia SaaS.

Dibangun sebagai **lima microservice** di atas satu PostgreSQL dengan skema terpisah per domain.

---

## Menjalankan

```bash
npm install
npm run dev
```

Buka `http://localhost:3000` (kasir) dan `http://localhost:3000/admin` (konsol internal).

Satu perintah itu menyalakan database, menjalankan migrasi sampai selesai, lalu kelima service. Tidak perlu Docker — database pengembangan memakai PGlite yang menyajikan protokol wire PostgreSQL, jadi setiap service terhubung lewat driver `pg` biasa persis seperti menghadapi Postgres sungguhan.

Mengisi data contoh (6 merchant, ±3.600 transaksi di kelima sektor):

```bash
npm run db:reseed
```

---

## Arsitektur

```
gateway :3000  ──┬─ pos        :3101  skema pos       transaksi, katalog, sinkronisasi
  SPA + routing  ├─ ai         :3102  skema ai        copilot, LLM, kredit
                 ├─ billing    :3103  skema billing   langganan, faktur, webhook
                 └─ backoffice :3104  skema internal  konsol penyedia
                        ↓
                 contract.*  ← 29 view, satu-satunya permukaan lintas service
```

### Batas antar service ditegakkan database, bukan kesepakatan

Setiap service login sebagai perannya sendiri. Menyentuh tabel milik service lain ditolak PostgreSQL:

```
svc_ai  → ai.merchant_ai_credits     BOLEH
svc_ai  → contract.merchant_revenue  BOLEH
svc_ai  → pos.transactions           DITOLAK: permission denied for table transactions
```

**Peran itu harus diaktifkan lebih dulu.** Migrasi 0009 membuat keempat peran
sebagai `NOLOGIN`, jadi selama `DATABASE_URL` dipakai bersama, kelima service
berjalan sebagai satu identitas berhak penuh dan batas di atas TIDAK berlaku:

```bash
node scripts/db/setup-service-roles.mjs --live   # aktifkan
node scripts/db/setup-service-roles.mjs          # buktikan batasnya
```

Perintah kedua menguji setiap batas dan setiap akses yang harus tetap ada, lalu
keluar dengan kode bukan-nol bila salah satunya meleset.

Yang dibagikan hanya view di skema `contract`. Pemilik boleh mengubah bentuk tabelnya kapan saja selama view-nya utuh, dan perubahan yang merusak ketahuan saat migrasi — bukan saat service lain error di produksi.

### Angka yang sama di semua tempat

AI Copilot dan admin panel melaporkan omzet yang identik karena keduanya **wajib** membaca `contract.merchant_revenue`. ai-service bahkan tidak punya hak baca ke `pos.transactions`. Kesamaan itu bersifat struktural, bukan hasil disiplin menjaga dua potongan SQL tetap sama.

---

## Perintah

| Perintah | Kegunaan |
|---|---|
| `npm run dev` | Jalankan seluruh sistem (database + migrasi + 5 service) |
| `npm run db:migrate` | Terapkan migrasi saja |
| `npm run db:reseed` | Isi ulang data contoh |
| `npm run db:reset` | Hapus database lokal lalu isi ulang dari nol |
| `npm run lint` | Type-check + pemeriksa higiene sumber |
| `npm run smoke` | Regresi 47 intent AI Copilot |
| `npm run build` | Bangun SPA dan kelima service |

---

## Menyambung ke PostgreSQL sungguhan (Supabase, RDS, Neon)

Isi `DATABASE_URL` di `.env`, lalu:

```bash
npm run db:migrate
npm run dev
```

Kode service tidak berubah sama sekali. Yang berubah hanya satu variabel — itu memang tujuan lapisan `services/shared/db.ts`.

### Supabase

Ambil connection string dari **Dashboard → Project Settings → Database**, pilih **Session pooler** (port 5432).

Jangan pakai Transaction pooler (6543): ia tidak mempertahankan state sesi, sehingga `SET ROLE` dan migrasi bertransaksi panjang gagal dengan cara yang sulit ditelusuri. Direct connection juga bisa, tapi Supabase kini menyediakannya lewat IPv6 saja — banyak jaringan rumah dan CI belum bisa menjangkaunya.

**Satu hal yang harus ada:** `migrations/0001_compat.sql`. Fungsi `uuidv7()` yang dipakai migrasi 0005 dan 0006 adalah **bawaan PostgreSQL 18**, sedangkan Supabase masih di 15–17. Tanpa penambal itu, seluruh migrasi berhenti di tengah jalan dan database tertinggal setengah jadi. Penambalnya otomatis dilewati bila `uuidv7()` bawaan sudah ada.

---

## Produksi (Docker)

```bash
docker compose up --build
```

Di sini database-nya PostgreSQL 18 sungguhan, bukan PGlite.

> **Belum diuji.** `docker-compose.yml` dan `Dockerfile` ditulis lengkap dengan healthcheck dan `depends_on: service_healthy`, tapi belum pernah dijalankan. Yang terbukti bekerja adalah `npm run dev`.

### Sebelum menyalakan di domain sungguhan

**Konsol internal belum punya autentikasi.** Identitas dikirim lewat header `x-internal-user` tanpa kata sandi. Aman selama hanya di localhost — **wajib diganti SSO** sebelum `admin.domainanda.com` menyala. Kolom `internal_users.sso_subject` sudah disiapkan untuk menampung subject claim-nya.

**Jalur simulasi pembayaran harus tertutup.** `/api/v1/subscription/simulate-payment` otomatis menolak saat `NODE_ENV=production`; jangan pernah mengaktifkan `ALLOW_SIMULATED_PAYMENT`.

---

## Konfigurasi

Salin `.env.example` menjadi `.env` dan isi seperlunya.

`DEEPSEEK_API_KEY` bersifat opsional. Tanpa kunci itu, jalur deterministik AI Copilot tetap berjalan penuh dan gratis; hanya pertanyaan strategis terbuka yang nonaktif.

---

## Dokumentasi

- [`docs/erd.md`](docs/erd.md) — ERD 24 tabel dalam 5 domain
- [`docs/smart-assistant-architecture.md`](docs/smart-assistant-architecture.md) — arsitektur AI Copilot tiga lapis

---

## Lisensi

[Apache License 2.0](LICENSE) — bebas dipakai, diubah, dan didistribusikan, termasuk untuk keperluan komersial, selama pemberitahuan hak cipta dan lisensi dipertahankan. Termasuk pemberian lisensi paten eksplisit dari kontributor.
