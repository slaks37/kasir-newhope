# Tiga keputusan produk yang menahan perbaikan berikutnya

Status: **menunggu keputusan pemilik produk**. Ditulis 2026-10-04 setelah stabilisasi (`cto/stabilization`, `cto/stabilization-2`).

Ketiga item ini tidak bisa diselesaikan hanya dengan memperbaiki kode, karena masing-masing mengubah aturan bisnis, kontrak dengan pihak ketiga, atau perilaku kasir saat offline. Setiap bagian berisi kondisi sekarang (diverifikasi dari kode), risikonya, rekomendasi, dan pertanyaan yang perlu dijawab.

| # | Topik | Risiko sekarang | Rekomendasi | Perkiraan kerja setelah diputuskan |
|---|---|---|---|---|
| 1 | Stok sebagai ledger server | Stok hilang/terhitung ganda saat 2 perangkat menjual produk yang sama; outlet berbagi satu angka stok | Menghidupkan ledger stok per outlet yang **sudah ada** di server untuk semua produk | 1,5–2 minggu + jendela migrasi |
| 2 | Persetujuan supervisor (PIN) | PIN manajer bisa dibongkar dari perangkat mana pun; server tidak tahu siapa yang menyetujui void | Grant persetujuan dari server; hash PIN tidak lagi dikirim ke perangkat | 1,5 minggu |
| 3 | QRIS dinamis | Bukti bayar palsu, salah ketik nominal, rekonsiliasi manual | QRIS dinamis lewat payment gateway, dana langsung ke rekening merchant | 2–3 minggu setelah kontrak PG |

---

## 1. Stok sebagai ledger server

### Kondisi sekarang
- Stok adalah field `stock` di record `products` (dan `stock_items` untuk bahan baku) di `pos.shared_state_records`. Perangkat mengurangi angka itu sendiri setelah penjualan, lalu mengirim **seluruh record** dengan nomor revisi.
- Server sebenarnya **sudah punya ledger stok per outlet**: `pos.inventory_items`, `pos.inventory_transactions` (delta append-only), dan `pos.inventory_balances` (saldo per outlet/lokasi, dipelihara trigger, migrasi 0023/0024/0027). `sync/transactions` sudah menulis delta penjualan, void, dan retur ke ledger ini, **tetapi hanya untuk produk dengan `pos.products.inventory_item_id`**.
- Kolom itu hanya diisi sekali oleh migrasi 0027 untuk data lama. Produk yang dibuat dari kasir diproyeksikan ke `pos.products` tanpa `inventory_item_id`, sehingga untuk produk baru ledger itu praktis tidak aktif dan angka yang dipakai kasir adalah field `stock` di state.
- Record di-scope per merchant (`SECTOR_KINDS` di `services/pos/sharedState.ts`). Semua outlet dalam satu merchant **berbagi satu angka stok**.
- Bila dua perangkat menjual produk yang sama sebelum saling sinkron, perangkat kedua mendapat `STATE_CONFLICT`. Kedua pilihan resolusi di Sync Center ("pakai server" / "pakai lokal") **membuang pengurangan salah satu perangkat**.
- Stabilisasi sudah menghapus clamp ke 0 (stok boleh minus dengan peringatan) dan memperbaiki void-setelah-refund. Masalah konkurensinya tetap ada.

### Rekomendasi
1. Pakai ledger yang sudah ada, bukan tabel baru. Proyeksi `products` dan `stock_items` di `services/pos/sharedState.ts` membuat atau menautkan `pos.inventory_items` secara otomatis, sehingga **setiap** produk punya `inventory_item_id`. Resep bahan baku (`linkedStockItemId` × `recipeQty`) ikut menjadi delta bahan baku.
2. Delta penjualan (`SALE_DEDUCT`), void, dan retur sudah ditulis per item di transaksi DB yang sama dengan `sync/transactions`. Kiriman ulang sudah idempoten, karena penjualan duplikat berhenti di `ON CONFLICT (client_txn_id)` sebelum loop item. Yang perlu ditambah hanyalah tautan `inventory_item_id` (langkah 1) dan delta bahan baku resep.
3. `pos.inventory_balances` dikirim ke perangkat lewat state sebagai stok per outlet. Perangkat hanya menampilkan pengurangan optimistis sampai saldo server berikutnya tiba, dan **tidak pernah lagi menulis angka stok**.
4. Stok opname mengirim *hitungan fisik*. Server menghitung selisihnya menjadi `ADJUST`, sehingga opname tidak menimpa penjualan yang belum tersinkron.
5. Cutover: angka `stock` saat ini menjadi saldo awal (`reference_type = 'OPENING'`) per outlet. Field lama dibiarkan hanya-baca selama satu rilis.

### Perlu diputuskan
- **Stok per outlet atau per merchant?** Rekomendasi: per outlet, dengan mutasi antar-outlet sebagai `TRANSFER_*`.
- **Stok minus**: tetap diizinkan dengan peringatan (rekomendasi, karena kasir offline tidak bisa diblokir secara andal) atau penjualan diblokir saat online dan stok server 0?
- **Saat cutover**, angka per outlet diambil dari mana bila sekarang hanya ada satu angka per merchant? Opsi: semua ke outlet utama, atau opname wajib di hari cutover.

---

## 2. Persetujuan supervisor (PIN) diverifikasi server

### Kondisi sekarang
- Record `users` bersifat GLOBAL (`GLOBAL_KINDS`) dan berisi hash PIN setiap pengguna. Record ini **dikirim ke setiap perangkat** dan disimpan di `localStorage`.
- PIN 4 digit di-hash SHA-256 dengan salt (`src/lib/auth/pinSecurity.ts`). Dengan hanya 10.000 kemungkinan, siapa pun yang membuka DevTools di perangkat kasir bisa menemukan PIN manajer dalam waktu kurang dari satu detik. Penghitung lockout juga ada di `localStorage` dan bisa dihapus.
- Void dikirim ke server sebagai `CANCELLED` **tanpa alasan dan tanpa penyetuju**. Server menerima perpindahan ke CANCELLED dari perangkat mana pun dan mencatat `actorRole` dari klaim klien.
- Sudah diperbaiki di stabilisasi: override PIN di modul terkunci kini benar-benar membuka modul, dan nama penyetuju void tercatat di catatan order serta log stok perangkat (belum di server).

### Rekomendasi
1. `POST /api/v1/approvals { action, subjectRef, approverUserId, pin }`. Server memverifikasi PIN terhadap hash yang **hanya ada di server** (scrypt/argon2), dengan rate limit per tenant dan perangkat, lalu mengembalikan grant bertanda tangan HMAC: `{action, subjectRef, approver, exp: 5 menit}`.
2. Payload void/refund menyertakan grant. `sync/transactions` menolak per-penjualan (masuk karantina, bukan menahan antrean) perpindahan ke CANCELLED atau refund tanpa grant valid bila pelaku tidak punya izin `void_order`/`refund`. Penyetuju dan alasan disimpan di `pos.transactions` dan `internal.audit_logs`.
3. Hash PIN berhenti dikirim ke perangkat. Ganti user di kasir memakai endpoint yang sama (`action: SWITCH_USER`). PIN dinaikkan ke 6 digit.

### Perlu diputuskan
- **Aksi mana yang butuh persetujuan?** Kandidat: void, refund, diskon di atas X%, ubah harga, buka laci kas tanpa transaksi.
- **Kebijakan offline**: (a) void/refund wajib online (rekomendasi, paling aman), atau (b) boleh offline tetapi ditandai `UNVERIFIED_APPROVAL` dan wajib ditinjau owner di laporan.
- **Ganti user saat offline**: apakah kasir boleh berganti user tanpa internet? Bila ya, perlu PIN lokal terpisah yang tidak bisa menyetujui aksi sensitif.

---

## 3. QRIS dinamis untuk transaksi kasir

### Kondisi sekarang
- Kasir meminta pelanggan memindai **QRIS fisik toko** (akrilik/stiker). Pelanggan mengetik nominal sendiri, lalu kasir menandai lunas dan boleh mengisi RRN (`CheckoutModal.tsx`).
- Status lunas sepenuhnya konfirmasi kasir. Ada risiko bukti bayar palsu, salah nominal, dan rekonsiliasi manual ke mutasi rekening.
- Landing page, halaman trial, dan blog sebelumnya mengklaim QRIS dinamis dengan deteksi lunas otomatis dan pencairan H+1. Klaim itu **sudah dikoreksi** di `cto/stabilization-2` (termasuk migrasi 0056 untuk artikel seed).

### Rekomendasi
1. `pos.payment_intents (id, tenant, outlet, client_txn_id, amount, provider, provider_ref, qr_string, status PENDING|PAID|EXPIRED|FAILED, paid_at)`.
2. Checkout QRIS dinamis memanggil `POST /api/v1/payments/qris`. Server membuat intent dan meminta QR ke payment gateway, lalu perangkat menampilkan QR berisi nominal pas.
3. Webhook PG bertanda tangan (pola yang sama dengan webhook DOKU langganan: raw body, verifikasi signature, idempoten) menandai intent `PAID`. Perangkat menerima status lewat polling singkat.
4. `sync/transactions` hanya menerima `QRIS_DYNAMIC` berstatus COMPLETED bila intent-nya `PAID` dengan nominal yang sama. Saat offline, QRIS dinamis tidak tersedia dan kasir kembali ke QRIS statis.

### Perlu diputuskan
- **Model dana** (keputusan terbesar):
  - (a) Setiap merchant punya akun/sub-akun PG sendiri, sehingga dana langsung ke rekening merchant dan New Hope tidak memegang uang. **Rekomendasi.**
  - (b) New Hope sebagai agregator yang menerima dana lalu meneruskannya. Model ini membawa kewajiban perizinan dan rekonsiliasi pembayaran yang jauh lebih berat.
- **Payment gateway**: DOKU (sudah dipakai untuk langganan) atau penyedia lain dengan fitur sub-akun. Perlu kontrak, biaya MDR, dan proses onboarding merchant (KYC).
- **Paket**: apakah QRIS dinamis fitur berbayar (Plus/Pro) atau semua paket?

---

## Setelah keputusan
Balas per nomor (misalnya "1: per outlet, minus boleh, cutover opname; 2: opsi a; 3: tunda"). Setiap item akan dikerjakan sebagai branch dan PR terpisah, dengan migrasi aditif dan runbook rilis seperti stabilisasi ini.
