# 06 — Perbaikan dan Verifikasinya

Catatan pelaksanaan atas [register temuan](05-audit-temuan.md). Setiap baris di
sini menyebut **cara memverifikasinya**, bukan hanya menyatakan sudah selesai.

Semua perbaikan diuji terhadap PostgreSQL sungguhan (PGlite lokal) dan, untuk
jalur tulis dan konsol, dengan **menjalankan service-nya lalu memanggil
endpointnya**. Itu keputusan yang menentukan hasil audit ini: enam temuan
berikutnya — T-16 sampai T-21 — tidak terlihat dari pembacaan kode mana pun.

---

## 1. Ringkasan

| Status | Jumlah |
|---|---:|
| Diperbaiki dan diverifikasi | 20 |
| Diperbaiki sebagian | 1 (T-17) |
| Sengaja ditunda, dengan alasan | 1 (T-06) |
| **Temuan baru yang muncul saat verifikasi** | **6** (T-16 … T-21) |

Lima migrasi baru: `0037`–`0041`. Dua pemeriksa higiene baru. Satu workflow CI.

---

## 2. Apa yang berubah, dan buktinya

### Integritas data

| # | Temuan | Perbaikan | Bukti |
|---|---|---|---|
| **T-09** | Split-brain FK `pos.tenants` | Migrasi `0037` memindahkan **23** FK ke `internal.tenants`, membuang constraint kembar, menghapus tabel lama | `pos.products`, `pos.transactions`, `pos.sync_receipts`, `ai.merchant_ai_credits` yang tadinya `23503` kini berhasil ditulis; 49 FK menunjuk `internal.tenants` |
| **T-18** | Split-brain FK `pos.users` | Migrasi `0039`, pola sama; `contract.transaction_log` dibangun ulang terhadap `internal.users` | `POST /sync/transactions` yang tadinya 500 kini 200 |
| **T-03** | Kasir baru tiap batch | Satu kunci alamat, di-scope ke tenant, `ON CONFLICT` | 3 kasir × 3 batch → **3 baris**, bukan 9; ID stabil |
| **T-19** | Kolom `movement_type` tidak ada | Diganti `reference_type` di kedua tempat, plus cast eksplisit dan guard `EXISTS` | Batch dengan produk ber-inventori kini lolos |
| **T-21** | FK jejak audit salah granularitas | Migrasi `0041` → `internal.merchants` | Akses berhasil kini **tercatat**; sebelumnya hanya penolakan yang selamat |

### Keamanan

| # | Temuan | Perbaikan | Bukti |
|---|---|---|---|
| **T-04** | Tanda tangan webhook bersyarat `NODE_ENV` | Fail-closed tanpa syarat; kelonggaran lokal lewat `DOKU_WEBHOOK_INSECURE`; ditambah jendela stempel waktu 5 menit | Pembacaan kode; tidak diuji terhadap DOKU sungguhan |
| **T-10** | Token gateway bocor ke log | Penyuntingan dipasang di logger bersama, rekursif | Uji langsung: `signature`, `authorization`, `x-newhope-gateway-token`, `password` bersarang → `[disunting]`; data diagnostik utuh |
| **T-07** | Flag bypass otorisasi | Proses menolak menyala bila `NODE_ENV=production`; peringatan selama aktif | Diuji tiga mode: ditolak / jalan+peringatan / jalan diam |
| **T-02** | Isolasi peran tidak aktif | `db.ts` memilih `DATABASE_URL_<SKEMA>` lebih dulu; `scripts/db/setup-service-roles.mjs` mengaktifkan dan **membuktikan** | 11 batas ditegakkan, 4 akses wajib tetap utuh |
| **T-20** | Empat view kontrak hilang | Migrasi `0040` memulihkan, disesuaikan dengan skema sekarang | 25 → **29** view; `/api/admin/overview` dan `/products` yang tadinya 500 kini 200 |

### Kebenaran fungsional

| # | Temuan | Perbaikan | Bukti |
|---|---|---|---|
| **T-01** | Konsol berjalan di atas fikstur | `src/admin/api.ts` 1.664 → 418 baris, klien HTTP sungguhan; `installAuthenticatedFetch` dipasang; dua rute backend baru | Lihat §3 |
| **T-08** | `/api/ai/generate-promo` menggantung | Diimplementasikan dengan disiplin kredit yang sama; jawaban model divalidasi | Type-check; belum diuji terhadap penyedia LLM sungguhan |

### Jaring pengaman dan kebersihan

| # | Temuan | Perbaikan | Bukti |
|---|---|---|---|
| **T-16** | Migrasi gagal pada database bersih | Deduplikasi daftar + `done` dipelihara | **37 migrasi lolos** dari nol; sebelumnya berhenti di migrasi ke-12 |
| **T-05** | `npm run smoke` crash | Fikstur milik suite sendiri di `scripts/dev/fixtures/` | **47/47 intent, 6/6 fall-through, 0 salah, 0 problem** |
| **T-12** | Tidak ada CI verifikasi | `.github/workflows/verify.yml` | `npm run lint` + `npm run smoke` pada setiap push |
| **T-11** | Katalog harga 4 salinan | Satu sumber `src/data/saasPlans.ts` + pemeriksa higiene | `Price catalog: OK` |
| **T-15** | Drift dokumentasi | README dikoreksi; pemeriksa jumlah view baru | `Contract views: OK (README dan migrasi sama-sama 29)` |
| **T-13** | Kode mati | `CategoryFilter.tsx` dihapus | Lihat koreksi di §4 |
| **T-14** | Komentar kerja tertinggal | Diganti penjelasan keputusan final | — |

---

## 3. Bukti end-to-end untuk T-01

Dijalankan melalui service sungguhan, bukan mock. Data dibuat lewat API
sinkronisasi, lalu dibaca lewat API konsol.

```
POST /api/v1/sync/transactions  (2 transaksi)  -> accepted 2
POST /api/v1/sync/transactions  (batch sama)   -> replayed true      # idempotensi lapis 1
POST /api/v1/sync/transactions  (kasir sama)   -> accepted 1
POST /api/v1/sync/transactions  (CANCELLED)    -> duplicates 1, voided 1   # lapis 3

GET  /api/admin/overview      -> omzet 90.000, 2 transaksi
GET  /api/admin/products      -> "Kopi Susu x5"
GET  /api/admin/transactions  -> 5 baris, kasir "Budi"
```

Angkanya konsisten dan bisa ditelusuri: 36.000 + 54.000 = 90.000, dan transaksi
25.000 yang dibatalkan **benar-benar dikecualikan** dari omzet maupun laporan
produk. Kuantitas 2 + 3 = 5 untuk Kopi Susu.

RBAC dan jejak audit, dengan dua identitas berbeda:

```
SUPERADMIN  /api/admin/me                    -> 13 kapabilitas
SUPPORT     /api/admin/me                    ->  5 kapabilitas
SUPPORT     /api/admin/access-audit          -> 403 CAPABILITY_DENIED
SUPPORT     /api/admin/merchants/:id         -> 400 JUSTIFICATION_REQUIRED
SUPPORT     /api/admin/merchants/:id?alasan  -> 200
ASING       /api/admin/overview              -> 404 NOT_FOUND

Jejak akses:
  ROLE_INTERNAL_SUPPORT  DENIED_VIEW_ACCESS_AUDIT  —          —
  ROLE_SUPERADMIN        VIEW_MERCHANT_DETAIL      Kopi Demo  —
  ROLE_INTERNAL_SUPPORT  VIEW_MERCHANT_DETAIL      Kopi Demo  Investigasi keluhan kasir
```

Sebelum perbaikan, ketiga baris terakhir tidak akan pernah ada: `api.me()`
mengembalikan seluruh kapabilitas kepada siapa pun, dan tidak ada satu pun
permintaan yang menyentuh server.

---

## 4. Koreksi atas audit ini sendiri

Dua hal yang saya nyatakan salah, dan bagaimana ketahuannya.

### `churn.ts` bukan kode mati (T-13)

Saya menghapusnya karena graf impor menunjukkan **nol pengimpor**. Itu keliru:
`scripts/dev/check-source-hygiene.mjs` membacanya **lewat path**, bukan lewat
`import`, sebagai ekspresi kanonik model churn dalam TypeScript — lalu
membandingkannya dengan rumus SQL di migrasi 0004 dan cron di
`scripts/batch/merchant-health.mjs`.

Menghapusnya **tidak menimbulkan error apa pun**. Pemeriksa paritas hanya
berhenti diam-diam (`if (!sql || !ts || !job) return;`), dan tiga salinan model
itu bebas menyimpang tanpa ada yang tahu. Ketahuan hanya karena baris
`Churn model parity: OK` hilang dari keluaran lint.

**Pelajarannya untuk analisis statis:** graf impor tidak melihat berkas yang
dirujuk lewat path oleh skrip. "Nol pengimpor" bukan sinonim "tidak terpakai".

### T-09 jauh lebih parah dari yang saya laporkan

Saya melaporkan **8 foreign key** berdasarkan pembacaan migrasi. Kenyataannya
**23**, termasuk `pos.transactions`, `pos.products`, dan `pos.sync_receipts` —
sehingga bukan hanya langganan dan kredit AI yang terdampak, melainkan
**seluruh jalur tulis inti**. Pada database bersih sistem ini tidak bisa
menulis satu baris pun.

Selisihnya karena beberapa FK dipasang oleh loop dinamis di migrasi 0006 yang
menyebut nama tabel dari sebuah array, bukan sebagai `REFERENCES` literal yang
bisa di-grep.

---

## 5. Yang sengaja tidak dikerjakan

### T-06 — pemecahan `POSContext`

`src/context/POSContext.tsx` tetap 2.109 baris dengan fan-in 26.

**Alasannya bukan kehabisan waktu, melainkan urutan yang benar.** Saya
memeriksa slice yang paling menjanjikan — status sinkronisasi — dan menemukan
ia tidak bisa dipisahkan bersih:

- `syncTarget` bergantung pada `currentUser`, `activeSector`, dan `settings`.
- `enqueueSync()` dipanggil dari **dalam** `processPayment` (baris 1508) dan
  `voidOrder` (baris 1546) — jalur pesanan itu sendiri.
- `pushCatalog()` dipanggil dari penyimpanan produk (baris 774).
- Hanya **2 dari ±70** anggota (`syncStatus`, `forceSync`) yang benar-benar
  hanya dibaca, dan hanya oleh satu komponen (`Header.tsx`).

Jadi yang bisa diekstrak bersih hanyalah tampilan statusnya — kosmetik, bukan
pemecahan yang dimaksud T-06. Sisanya terikat ke jalur pesanan justru **karena
itulah** ia menjadi God Object.

Melakukannya utuh berarti menyentuh 26 berkas pada kode yang **tidak punya satu
pun uji otomatis**, untuk memperbaiki masalah rancangan — bukan cacat yang
sedang merusak data. Aplikasi kasir adalah bagian sistem ini yang terbukti
bekerja; mempertaruhkannya tanpa jaring pengaman adalah pertukaran yang salah.

**Urutan yang benar:** uji dulu, pecah kemudian. Batasnya sendiri sudah terbaca
dari kodenya — `CatalogContext` (produk/kategori/bundel), `OrderContext`
(keranjang/pesanan/pembayaran/sinkronisasi — ketiganya satu paket, seperti
terlihat di atas), `StaffContext` (pengguna/shift/absensi/izin).

### T-17 — `seed.ts` baru sebagian

`wipe()` sudah diperbaiki: nama tabel disebut lengkap dengan skemanya dan
disaring terhadap apa yang benar-benar ada, sehingga `npm run db:reseed` tidak
lagi berhenti sebelum menghapus apa pun.

Pernyataan `INSERT`-nya masih mendahului Model B (0015): ia menulis `products`
dan `transactions` tanpa `merchant_id` dan `outlet_id` yang kini wajib, dan
memakai kolom `stock` yang pindah ke domain inventori di 0027. Menyelaraskannya
adalah penulisan ulang skrip 500 baris terhadap tiga puluh migrasi — pekerjaan
tersendiri, bukan perbaikan temuan.

Sampai itu dikerjakan, data contoh dibuat lewat API sinkronisasi (cara yang
dipakai di §3), yang justru lebih setia karena melewati jalur tulis yang
sebenarnya.

---

## 6. Menjalankan ulang seluruh verifikasi

```bash
# 1. Database bersih + seluruh migrasi (membuktikan T-16, T-09, T-18, T-20)
rm -rf .pgdata
npx tsx services/db-server/index.ts &          # biarkan berjalan
npx tsx services/db-server/migrate.ts
#    -> 41 migrasi lolos, "view kontrak: 29"

# 2. Batas peran database (membuktikan T-02)
node scripts/db/setup-service-roles.mjs
#    -> 11 batas ditegakkan, 4 akses wajib utuh

# 3. Gerbang higiene + type-check (membuktikan T-11, T-15)
npm run lint
#    -> 6 pemeriksaan, semuanya OK

# 4. Regresi AI Copilot (membuktikan T-05)
npm run smoke
#    -> 47/47 intent, All checks passed

# 5. Jalur tulis dan konsol (membuktikan T-01, T-03, T-19, T-21)
AUTH_ALLOW_LOCAL_DEVELOPMENT=1 npx tsx services/pos/index.ts &
AUTH_ALLOW_LOCAL_DEVELOPMENT=1 npx tsx services/backoffice/index.ts &
#    lalu POST /api/v1/sync/transactions dan GET /api/admin/* seperti di §3
```

Langkah 3 dan 4 juga berjalan otomatis di CI pada setiap push.
