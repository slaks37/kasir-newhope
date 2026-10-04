# Runbook rilis: stabilisasi Oktober 2026

Berlaku untuk branch `cto/stabilization` (pembayaran, sinkronisasi, stok, performa laporan). Topologi produksi: **Vercel + Supabase**.

> ⚠️ **Urutan wajib: database dulu, baru kode.** Kode sync baru membaca kolom `pos.sync_receipts.outcomes`. Bila kode di-deploy sebelum migrasi, setiap sinkronisasi transaksi akan gagal 500.

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

### 1.2 Terapkan migrasi Supabase (berurutan)
| File | Isi | Sifat |
|---|---|---|
| `20261004090000_report_index_and_statement_timeout.sql` | index (no-op bila 1.1 sudah), `statement_timeout` 8 dtk untuk peran `svc_*` | aditif |
| `20261004090100_signup_outlet_names.sql` | fungsi trigger signup memakai nama outlet dari form registrasi | ganti fungsi |
| `20261004090200_sync_receipt_outcomes.sql` | kolom `outcomes` di `pos.sync_receipts` | aditif, ada default |

Untuk instalasi non-Supabase (`npm run db:migrate`), padanannya adalah `migrations/0053` dan `0054` (diterapkan otomatis).

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

---

## 4. Rollback
- **Kode**: revert merge commit aman. Migrasi bersifat aditif (index, kolom berdefault, penggantian fungsi).
- **Fungsi trigger signup**: terapkan ulang versi sebelumnya dari riwayat git `docs/security/supabase-auth-signup.sql`.
- Jangan menghapus kolom `outcomes` saat rollback. Kode lama mengabaikannya.

---

## 5. Belum termasuk rilis ini (tindak lanjut)
| Item | Alasan ditunda |
|---|---|
| Stok sebagai ledger delta di server untuk semua produk | Perubahan model data besar; saat ini stok = state per produk (tanpa clamp, dengan peringatan) |
| Persetujuan supervisor (PIN) diverifikasi server | Perlu desain grant + audit; saat ini ditegakkan di klien |
| QRIS dinamis + webhook untuk transaksi kasir | Fitur baru (butuh kontrak payment gateway) |
| Retensi/arsip `inventory_logs`, `kds_tickets`, `order_operations` di shared state | Snapshot kini memprioritaskan katalog; data riwayat masih tumbuh tanpa batas |
| Versi snapshot state inkremental (bukan md5 seluruh baris tiap polling) | Optimasi; bukan blocker pada volume saat ini |
| Service worker / PWA untuk app shell | Refresh saat offline masih gagal memuat aplikasi |
| Mengganti 62 `alert()` native dengan toast/dialog | UX; `alert` memblokir tab |
| Overview: satu panggilan summary alih-alih dua | Perlu kontrak API "hari ini + tren" |
| Load test ulang di Postgres staging (bukan PGlite) | Angka QA berbasis PGlite adalah batas bawah |
