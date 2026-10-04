# Runbook rilis: stabilisasi Oktober 2026

Berlaku untuk dua PR bertumpuk. Topologi produksi: **Vercel + Supabase**.

| PR | Branch | Isi |
|---|---|---|
| 1 | `cto/stabilization` | pembayaran, sinkronisasi per-penjualan, stok, performa laporan, keamanan boundary, CI |
| 2 | `cto/stabilization-2` | snapshot state berversi + berhalaman, Overview satu panggilan, service worker (refresh offline), toast pengganti `alert()`, bundle auth, PIN override, koreksi klaim QRIS/blog |

PR 2 dibangun di atas PR 1. Keduanya boleh dirilis bersamaan atau berurutan, tetapi **jangan PR 2 tanpa PR 1**.

> **Urutan yang disarankan: database dulu, baru kode.** Kode tetap aman bila ter-deploy lebih dulu (`services/shared/schemaFeatures.ts`, diuji `test-deploy-order`), dan memakai migrasi begitu diterapkan (paling lambat 1 menit, tanpa redeploy):
> - Tanpa kolom `pos.sync_receipts.outcomes` (0054): sinkron per-penjualan tetap jalan. Batch yang punya penjualan ditolak tidak disimpan sebagai receipt, sehingga kiriman ulang dieksekusi ulang dan penolakannya tetap dilaporkan.
> - Tanpa tabel `pos.shared_state_versions` (0055): polling state memakai hash seluruh record seperti versi lama. Hasilnya benar, tetapi lebih berat di database.
>
> Migrasi tetap harus diterapkan. Mode fallback hanya jaring pengaman.

---

## 1. Sebelum deploy

### 1.1 Index laporan, tanpa mengunci tulis
Jalankan di Supabase SQL Editor (di luar transaksi, karena `CONCURRENTLY` tidak bisa di dalam blok transaksi):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_items_transaction
  ON pos.transaction_items (transaction_id);
```

Pastikan hasilnya valid. Kueri berikut harus mengembalikan `true`:
```sql
SELECT indisvalid FROM pg_index WHERE indexrelid = 'pos.idx_transaction_items_transaction'::regclass;
```
Bila `false` (build terputus), `DROP INDEX CONCURRENTLY` lalu ulangi.

Untuk PR 2, lakukan hal yang sama pada index riwayat state (dipakai jendela riwayat snapshot):
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shared_state_history
  ON pos.shared_state_records (tenant_id, kind, updated_at DESC);
SELECT indisvalid FROM pg_index WHERE indexrelid = 'pos.idx_shared_state_history'::regclass;
```

### 1.2 Terapkan migrasi Supabase (berurutan)
| File | Isi | Sifat |
|---|---|---|
| `20261004090000_report_index_and_statement_timeout.sql` | index (no-op bila 1.1 sudah), `statement_timeout` 8 dtk untuk peran `svc_*` | aditif |
| `20261004090100_signup_outlet_names.sql` | fungsi trigger signup memakai nama outlet dari form registrasi | ganti fungsi |
| `20261004090200_sync_receipt_outcomes.sql` | kolom `outcomes` di `pos.sync_receipts` | aditif, ada default |
| `20261004090300_shared_state_versions.sql` (PR 2) | tabel versi + trigger pada `pos.shared_state_records`, index riwayat (no-op bila sudah dibuat di 1.1) | aditif; trigger menambah satu upsert kecil per tulis state |
| `20261004090400_blog_seed_corrections.sql` (PR 2) | koreksi artikel seed blog: klaim QRIS dinamis dan video placeholder | data; hanya baris yang masih berisi teks seed asli, aman diulang |

Untuk instalasi non-Supabase (`npm run db:migrate`), padanannya adalah `migrations/0053`–`0056` (diterapkan otomatis).

### 1.3 Variabel lingkungan Vercel
| Variabel | Pemeriksaan |
|---|---|
| `DOKU_API_URL` | **Persis** `https://api.doku.com` (produksi) atau `https://api-sandbox.doku.com`. Nilai lain sekarang ditolak. |
| `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY` | Wajib terisi. `DOKU_SANDBOX_*` **tidak lagi** menjadi cadangan untuk checkout. |
| `DOKU_ALLOWED_CHANNELS` | Daftar `channel.id` yang dikonfirmasi DOKU. Kosong = checkout/webhook menolak (fail-closed). |
| `PUBLIC_APP_URL` | URL `https://` aplikasi (tujuan kembali dari DOKU). |
| `CRON_SECRET`, `CRON_ENABLED_JOBS` | Vercel Cron kini satu-satunya penjadwal. Workflow GitHub hanya manual. |
| `DB_STATEMENT_TIMEOUT_MS` | Opsional, bawaan 8000. |

### 1.4 DOKU dashboard
URL notifikasi: `https://<domain>/api/v1/webhooks/doku`. Sebelum rilis ini, rute ini di Vercel **tidak memproses pembayaran sama sekali** (selalu menjawab 200 tanpa rekonsiliasi).

---

## 2. Deploy
Merge PR, lalu biarkan Vercel membangun. Bundle `api/_*_bundle.js` sudah ikut di-commit (CI memastikan sesuai source).

---

## 3. Setelah deploy

### 3.1 Uji asap (staging dulu bila ada)
1. Login owner, buka Overview dan Laporan 7/30 hari. Keduanya harus tampil tanpa 503.
2. Buat satu penjualan tunai. Sync Center harus menunjukkan 0 menunggu.
3. Checkout langganan sandbox. Setelah bayar, status langganan harus aktif tanpa intervensi manual (webhook).
4. `GET /api/v1/blog` harus mengembalikan artikel dari database.
5. (PR 2) Buka kasir sekali saat online, matikan jaringan di DevTools, lalu refresh. Aplikasi harus tetap terbuka dan penjualan tunai tetap bisa dicatat. Nyalakan jaringan, dan Sync Center harus kembali 0 menunggu.
6. (PR 2) Di DevTools → Application → Service Workers, `sw.js` aktif untuk `/`. Buka `/admin` dan pastikan halaman itu **tidak** dikendalikan service worker.
7. (PR 2) Login tetap bertahan setelah deploy. Pengguna yang sedang login tidak boleh diminta login ulang.

### 3.2 Pembayaran langganan yang masuk selama webhook masih stub
Selama periode itu, checkout di Vercel memakai handler lama: invoice **tidak tersimpan** dan webhook tidak mengaktifkan langganan. Langkah:
1. Ekspor transaksi **SUCCESS** dari DOKU dashboard sejak peluncuran.
2. Cocokkan dengan `billing.invoices`. Invoice lama berformat `NH-` + 8 digit dan **tidak akan ada** di tabel.
3. Untuk setiap pembayaran yang valid, aktifkan lewat **Konsol Admin → Support → manual plan grant** (teraudit dan butuh MFA). Jangan memakai `UPDATE` langsung.

### 3.3 Akun yang terkunci EXPIRED oleh bug status
Sebelum rilis ini, `GET /subscription/status` bisa menulis `EXPIRED` permanen dari satu kegagalan lookup. Tinjau kandidatnya (jangan diubah otomatis, karena admin mungkin sengaja menyetel EXPIRED):
```sql
SELECT t.id, t.name, s.status, s.plan_id, s.current_period_end, s.grace_period_end, s.updated_at
FROM billing.subscriptions s JOIN internal.tenants t ON t.id = s.tenant_id
WHERE s.status = 'EXPIRED' AND t.is_active AND t.merged_into IS NULL
  AND COALESCE(s.grace_period_end, s.current_period_end + interval '14 days') > now()
ORDER BY s.updated_at DESC;
```
Pulihkan yang memang salah lewat alat support di konsol admin.

### 3.4 Akses browser ke data bisnis
Skrip yang memberi `anon`/`authenticated` akses penuh sudah dihapus dari repo, tetapi efeknya di database (bila pernah dijalankan) tetap ada. Periksa:
```sql
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee IN ('anon','authenticated') AND table_schema IN ('pos','billing','ai','internal','contract');

SELECT schemaname, tablename, policyname, roles
FROM pg_policies
WHERE roles && ARRAY['anon','authenticated']::name[] AND schemaname IN ('pos','billing','ai','internal','contract');
```
Bila ada hasil, jalankan ulang `docs/security/restrict-browser-rls-policies.sql` dan cabut grant yang tersisa.

### 3.5 Antrean perangkat yang sebelumnya macet
Perangkat yang antreannya tertahan oleh satu penjualan bermasalah akan **mengirim semua penjualan tertunda** begitu versi baru dimuat. Konsekuensinya:
- Laporan tanggal-tanggal lampau bisa **bertambah** (penjualan tercatat dengan waktu aslinya). Informasikan ke merchant.
- Penjualan yang benar-benar ditolak tampil di **Sync Center → Keuangan** dengan alasannya dan tombol *Kirim ulang*.
- Nomor struk yang bentrok disimpan dengan akhiran (mis. `INV-20261004-1A2B-9F3C0D1E`). Nomor barunya ada di `pos.transactions.invoice_number` dan di `pos.sync_receipts.outcomes`; jumlahnya tercatat di detail `SYNC_BATCH` pada `internal.audit_logs`.

### 3.6 Service worker (PR 2)
- Versi baru aktif setelah semua tab kasir lama ditutup (tanpa `skipWaiting`), supaya satu tab tidak memuat campuran file dari dua build. Tab yang dibiarkan terbuka tetap memakai versi lama sampai di-refresh.
- Service worker hanya menyimpan file statis (`index.html` dan `/assets/*`). API, `/admin`, request non-GET, dan domain lain (Supabase) tidak pernah melewatinya.
- `vercel.json` menyajikan `sw.js` tanpa cache dan `/assets/*` sebagai immutable.

### 3.7 Konten blog (PR 2)
Migrasi koreksi hanya mengubah artikel yang masih berisi teks seed asli. Bila artikel QRIS sudah diedit lewat konsol admin, periksa manual bahwa artikel itu tidak lagi menjanjikan deteksi lunas otomatis, pencairan H+1, atau video demo yang tidak ada.

---

## 4. Rollback
- **Kode**: revert merge commit aman. Migrasi bersifat aditif (index, kolom berdefault, penggantian fungsi).
- **Fungsi trigger signup**: terapkan ulang versi sebelumnya dari riwayat git `docs/security/supabase-auth-signup.sql`.
- Jangan menghapus kolom `outcomes` saat rollback. Kode lama mengabaikannya.
- Tabel `pos.shared_state_versions` dan trigger-nya boleh dibiarkan. Kode lama mengabaikannya.
- **Service worker (PR 2)**: revert kode tidak menghapus service worker dari browser pengguna. Aplikasi tetap berfungsi, karena navigasi selalu mencoba jaringan dulu dan file baru diambil dari jaringan, tetapi cache lama tidak pernah dibersihkan. Untuk membersihkannya, salin [`sw-kill-switch.js`](sw-kill-switch.js) ke `public/sw.js` di commit revert.

---

## 5. Belum termasuk rilis ini (tindak lanjut)
| Item | Status |
|---|---|
| Stok sebagai ledger server | Menunggu keputusan: [desain §1](../design/2026-10-keputusan-produk.md#1-stok-sebagai-ledger-server) |
| Persetujuan supervisor (PIN) diverifikasi server | Menunggu keputusan: [desain §2](../design/2026-10-keputusan-produk.md#2-persetujuan-supervisor-pin-diverifikasi-server). PR 2 sudah memperbaiki override modul dan mencatat penyetuju void di perangkat |
| QRIS dinamis + webhook untuk transaksi kasir | Menunggu keputusan dan kontrak PG: [desain §3](../design/2026-10-keputusan-produk.md#3-qris-dinamis-untuk-transaksi-kasir) |
| Arsip riwayat lama (`inventory_logs`, `kds_tickets`, `order_operations`) di database | Snapshot perangkat sudah dibatasi jendela (PR 2); baris lama tetap di database untuk audit. Arsip/partisi bila ukuran tabel mulai berpengaruh |
| Mengganti 13 `confirm()` dan 1 `prompt()` native dengan dialog | UX; semua `alert()` sudah diganti toast di PR 2 |
| Load test ulang di Postgres staging (bukan PGlite) | Angka QA berbasis PGlite adalah batas bawah |

Selesai di PR 2 (sebelumnya ada di daftar ini): versi snapshot state inkremental, jendela riwayat snapshot, service worker untuk refresh offline, penggantian `alert()`, dan Overview satu panggilan.
