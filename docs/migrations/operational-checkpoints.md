# Diagnostik operasional read-only — PR #21

**Status: PENDING bukti fleet/provider; produksi NO-GO.** Ini melanjutkan [Phase 1 hybrid](hybrid-phase1.md). Tidak ada perubahan produksi, pembayaran, pengiriman ulang webhook, sync paksa, penghapusan antrean, atau migrasi Auth.

## Yang sudah dapat diverifikasi

Read-only source checkpoint 2026-10-16 03:16:50 WIB dan Neon staging berikutnya mencocokkan referensi transaksi asli, client keys, UUID tenant/merchant/outlet, nominal/status pembayaran dan receipt idempotensi: 13 merchant, 11 outlet, delapan transaksi/delapan pembayaran, lima batch receipt, dan sebelas cash-ledger rows; seluruh baris sumber yang diperiksa cocok. Sumber tidak dibekukan. Data tambahan staging ditandai `stagingOnly` dan tidak diasumsikan sebagai transaksi sumber baru. [Ringkasan tanpa identifier](evidence/hybrid-operational-checkpoint-2026-10-16.json).

`billing.device_fingerprints` sumber nol dan bukan registry seluruh kasir aktif. Invoice/event billing/webhook/provider POS sumber nol. Ini **tidak** membuktikan semua perangkat/queue provider kosong. Log runtime DOKU 30 menit terakhir tidak menghasilkan kelompok log; permintaan 24 jam ditolak karena retensi paket Vercel. Tidak upgrade paket atau membeli resource. Sambungan Chrome dipulihkan, tetapi DOKU menampilkan **Waktu Sesi Habis** dan meminta login ulang. Halaman login disiapkan untuk owner; tidak ada perubahan credential atau retry. UI diagnostik lokal/dialog/read/download sudah diuji di Chrome; halaman Preview dan checksum bookmark yang ditampilkan cocok dengan build. Tidak ada tab POS produksi yang sudah terbuka pada browser tersambung; aplikasi produksi tidak dimuat hanya untuk diagnostik.

## Fitur dan batas keselamatan

`/diagnostics/index.html` adalah halaman statis mandiri; link tersedia di Pengaturan toko pada Preview. Tidak mengimpor AuthProvider, POSContext, migrasi antrean, authenticated fetch atau service worker. CSP menolak koneksi jaringan. Tidak membaca key session/token, tidak memuat aplikasi kasir, tidak memakai API atau mengirim transaksi.

Collector membaca allowlist key localStorage penjualan, kas, karantina, operational conflict, legacy hold/retired financial, cart draft, cached orders, metadata dan local ACK. Ia hanya mengekspor scope/ref transaksi/invoice/outlet, nominal/status, client-payment/event/refund key dan timestamp ACK lokal. Nama pelanggan/kasir, produk, detail keranjang, alasan refund, fingerprint payload ACK asli dan secret tidak diekspor. File JSON tetap privat karena mengandung identifier finansial. Hash byte storage untuk konsistensi bukan bukti penerimaan server.

Read sebelum/sesudah mendeteksi key/payload berubah selama capture. Queue rusak/oversize, limit referensi, draft belum dibayar, konflik dan unknown in-flight selalu konservatif/PENDING. Cached orders bukan sumber revenue/ACK. Timestamp `lastSyncedAt` hanya observasi lokal. Tidak menebak batch idempotency key dari kumpulan queue saat ini; hanya mencocokkan key yang benar-benar ada. Data kosong tidak pernah memberikan izin cutover.

Preview mempunyai origin berbeda dan **tidak dapat membaca storage produksi**. Bookmark portabel berisi kode collector mandiri yang sama dengan checksum build. Ia dapat dipanggil pada tab produksi yang sudah terbuka tanpa deploy produksi dan tidak mengubah app/transaction storage. Background sync yang sudah berjalan di tab lain tidak dihentikan atau dipaksa; snapshot yang berubah diberi PENDING. Jika bookmark diblokir browser/CSP, jangan bypass proteksi atau menganggap pemeriksaan selesai. Browser/profile/device lain, IndexedDB yang tidak dipakai antrean saat ini, memory-only request, data legacy tak dikenal dan perangkat hilang tetap perlu inventory operator.

## Dua tindakan owner

1. **POS:** buka halaman diagnostik Preview; seret bookmark **Diagnostik POS read-only** ke bookmarks. Pada tab New Hope produksi yang biasa dipakai setiap perangkat/profil POS, jalankan bookmark → **Periksa perangkat** → **Unduh JSON privat**, dengan label kasir/outlet. Catat seluruh perangkat/profil yang aktif atau belum terjangkau. Jangan klik sync/retry/requeue atau menghapus data. Simpan ekspor di folder privat lokal operator, bukan GitHub/chat. File portable lokal tersedia di paket outputs; browser yang tidak mendukung bookmark tetap PENDING.
2. **DOKU:** login pada [DOKU Dashboard](https://dashboard.doku.com/bo/login), buka **Settings → Notifications → HTTP Notifications** (UI Back Office lama: **Integration → HTTP Notification**). Filter endpoint produksi yang terkonfigurasi dan rentang transaksi relevan sampai waktu checkpoint; periksa semua halaman/channel serta entri failed/pending. Klik **ikon mata** untuk **Order Summary / Notification History / Notification Details**. Gunakan Export/Download bila tersedia; bila tidak, simpan tampilan/history sebagai PDF privat dan catat request ID, invoice, gateway reference, amount/currency, status pembayaran, HTTP response, riwayat attempt dan retry berikutnya. **Jangan klik ikon pesawat/Retry/Resend.** Tidak perlu password/API key/raw customer payload untuk laporan ini. Tunjukkan batas retensi bila seluruh rentang tidak tersedia; kekurangannya tetap PENDING.

Petunjuk menu/history berasal dari [DOKU Manage Operations](https://docs.doku.com/get-started/manage-business/manage-operations) dan [Back Office Retry Notification](https://developers.doku.com/get-started-with-doku-api/notification/retry-notification). Keduanya menyebut kebijakan retry yang berbeda; gunakan history aktual produk/channel, jangan mengasumsikan tiga/enam attempt atau periode retensi cukup. Dokumentasi dashboard menyebut tampilan delapan hari; jangan menyimpulkan coverage lebih lama tanpa export/bukti tambahan. Template normalisasi privat disediakan; template kosong bukan bukti provider.

## Rekonsiliasi operator setelah file tersedia

Simpan copy input di `build/neon/private-*` dengan mode 600. Tidak ada customer export di repo. Collector menghasilkan format `newhope-device-checkpoint-v2`; normalisasi export DOKU ke `newhope-doku-provider-checkpoint-v1` dengan window, endpoint, pagination/channel coverage serta event/payment fields sesuai bukti asli. `paymentStatus` mengikuti status invoice aplikasi (misalnya DOKU SUCCESS yang terbukti diproses menjadi PAID); pertahankan status asli provider pada arsip privat. Jangan mengarang nilai yang tidak ditampilkan.

```sh
# Source SQL hanya SELECT via akses sumber yang sah, hasil disimpan privat.
# scripts/neon/operational-checkpoint.sql
node scripts/neon/capture-operational-staging.mjs
node scripts/neon/reconcile-operational-checkpoints.mjs build/neon/private-operational-source.json build/neon/private-operational-staging.json /absolute/private/device.json /absolute/private/provider.json
```

Capture staging meminjam restricted LOGIN terpin dan membuka transaksi `READ ONLY` dengan certificate verification. Pembanding tidak memiliki operasi write/replay. Source baseline dibanding per primary/idempotency key; extras staging dipisahkan. Ref device dicocokkan ke business/merchant/outlet, ID/client ID, amount/status dan client payment IDs; local ACK tanpa payload proof tidak dinaikkan menjadi full match. Provider dicocokkan request ID + invoice + amount/currency/status/reference + outcome + HTTP/delivery/retry. Konflik/missing scope/field/ACK tetap PENDING/review; tidak mereassign/menggabungkan akun.

Detail beridentifier disimpan hanya `build/neon/private-operational-reconciliation.json` (600); ringkasan publik hanya jumlah. Hasil komparator sengaja tidak dapat mengesahkan fleet lengkap, antrean provider final, source freeze atau cutover. Evidence snapshot final dan acceptance operator tetap gate terpisah. Jangan menggunakan file hasil edit manual sebagai attestation provider atau owner acceptance otomatis.
