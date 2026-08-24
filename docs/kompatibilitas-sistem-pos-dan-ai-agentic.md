# Analisis Kompatibilitas: SISTEM POS & AI Agentic Core

Pemeriksaan dua dokumen yang diajukan terhadap arsitektur New Hope POS yang
berjalan sekarang: apakah fiturnya relevan, di mana ia akan bertabrakan, dan
bagian mana yang sudah dikerjakan.

| Dokumen | Relevansi | Putusan |
|---|---|---|
| `SISTEM_POS.pdf` | **Tinggi** — domain yang sama (POS restoran) | Sebagian besar layak diserap. Empat titik tabrakan nyata; dua sudah ditutup di migrasi 0037. |
| `AI_Agentic_Core.pdf` (DEWI) | **Rendah** — domain berbeda | **Jangan digabung.** Produk terpisah. Tiga polanya layak dipinjam. |

---

## Bagian 1 — `SISTEM_POS.pdf`

Dokumen ini manual POS layar sentuh untuk restoran hotel: Bill Rack, Segment,
Split/Join Bill, Move Table, Petty Cash, House Use, dan seterusnya. Domainnya
sama persis dengan modul F&B New Hope POS, jadi hampir semuanya nyambung.

### 1.1 Peta fitur terhadap kondisi sekarang

**Sudah ada, tidak perlu apa-apa**

| Fitur dokumen | Padanan di sistem |
|---|---|
| Login | `LoginPage.tsx` + sesi Supabase |
| Reset (tutup kasir per shift) | `endShift()`, `pos.shifts`, rekonsiliasi selisih kas |
| **Petty Cash / housebank** | `CashMovement` + kategori `MODAL_AWAL`, `setInitialCash()` |
| Trace (lihat transaksi tersettle) | `RecentTransactionsModal.tsx` |
| Layout (setup Group Item & Master Item) | Kategori + katalog produk |
| Order Entry, Qty, Modifier, Cancel | `CartPanel`, `VariantModal`, modifier BOM (0019/0029) |
| Void | `voidOrder()` + step-up PIN + compensating ledger (0033) |
| Change Quantity | `updateCartQuantity()` |
| Discount per item | `applyCartItemDiscount()` + `PromoCode` |
| Password change | `UserManagementTab.tsx` |

**Sudah ditambahkan pada pekerjaan ini**

| Fitur dokumen | Yang dikerjakan |
|---|---|
| **Segment: Event** | `OrderType` kini punya `'EVENT'`; tab segmen jadi lima |
| **Covers (jumlah tamu)** | `Order.guestCount` + stepper di keranjang + ditulis ke `pos.order_context_fnb.guest_count` |
| **House Use / Compliment** | `revenue_impact` di transaksi, PIN Manager di checkout, dikeluarkan dari omzet dan kas shift |
| **Voucher / Deposit / Member** | `pos.tender_types` + buku besar liabilitas `pos.customer_deposits` |
| **Jejak Split/Join/Move/Change Price** | `pos.bill_operations` (append-only, step-up ditegakkan database) |

**Belum ada — fondasi skema sudah disiapkan, UI-nya belum**

| Fitur dokumen | Catatan |
|---|---|
| Split Bill / Join Bill | Silsilah (`split_from_…`, `merged_into_…`) + status `MERGED` sudah ada dan sudah teruji. Layar pemilihan itemnya belum dibuat. |
| Move Item / Move Table | Jenis operasinya sudah terdaftar di `bill_operations`; alur UI belum. |
| Copy Bill (tagihan sementara vs struk final) | `REPRINT_BILL` sudah terdaftar. Sekarang sistem hanya punya satu bentuk cetakan. |
| Bill Rack per meja | Ada `heldOrders` (hold order), tapi belum diindeks per meja seperti Bill Rack. |
| Reservation | `TableStatus` punya `RESERVED`, entitas reservasinya belum ada. |
| Drawer (buka laci manual) | Belum ada; butuh integrasi perangkat. |
| KDS / cetak dapur | `pos.kds_stations` + `kds_status` ada di database, layarnya belum. |

**Sengaja tidak diambil**

| Fitur dokumen | Alasan |
|---|---|
| **In House / House Folio / posting ke kamar** | Ini fungsi PMS hotel, bukan POS. Menariknya masuk berarti New Hope POS harus mengelola tamu menginap, folio kamar, dan night audit. Di luar produk. |
| **Meal Period (tutup hari)** | Lihat tabrakan #4 di bawah. |

### 1.2 Empat titik tabrakan

#### Tabrakan #1 — House Use menggelembungkan omzet · **SUDAH DITUTUP**

`contract.merchant_revenue` menyaring berdasarkan `order_status`, bukan jenis
tender. Kalau House Use dibuat sebagai metode pembayaran saja, bill-nya tetap
`COMPLETED` dan tetap dihitung sebagai penjualan — di admin panel, di AI
Copilot, dan di `internal.business_targets` sekaligus.

Penutupnya: kolom `pos.transactions.revenue_impact`, dan `merchant_revenue`
menambah syarat `revenue_impact = 'SALE'`. Bill non-pendapatan pindah ke
`contract.non_revenue_log` — tetap terlihat, tetap memotong stok, tidak pernah
jadi omzet. Sisi klien ikut disamakan lewat `isSaleOrder()` di `insights.ts`,
supaya angka di layar kasir tidak berbeda dari angka di database.

#### Tabrakan #2 — Split & Join melawan immutabilitas · **SUDAH DITUTUP**

Migrasi 0035 memblokir DELETE pada `pos.transactions`, `transaction_items`, dan
`payments`. Split Bill versi POS klasik memindahkan baris item antar bill —
implementasi naif akan langsung ditolak trigger, atau lebih buruk, mendorong
orang melonggarkan trigger-nya.

Penutupnya: Split membuat transaksi baru yang menunjuk induknya lewat
`split_from_transaction_id`; Join mengubah bill sumber jadi `order_status =
'MERGED'` dengan `merged_into_transaction_id`. Karena `merchant_revenue` hanya
menghitung `COMPLETED`, bill yang sudah digabung otomatis tidak pernah dihitung
dua kali. Sudah dibuktikan: Rp 60rb + Rp 40rb digabung jadi Rp 100rb terbaca
Rp 100rb, bukan Rp 200rb.

#### Tabrakan #3 — Voucher & Deposit merusak rekonsiliasi kas

`expectedCash = initialCash + cashSales`. Voucher, deposit, dan member charge
bukan uang di laci. Kalau ketiganya masuk sebagai pembayaran biasa, kasir yang
jujur akan terlihat kurang setor tiap tutup shift — dan `SHIFT_PERFORMANCE`
milik AI Copilot akan menandainya sebagai indikasi kebocoran kas.

Sudah disiapkan: `pos.tender_types` dengan flag `affects_cash_drawer` dan
`counts_as_revenue`, plus view `contract.tender_settlement`. Deposit dan
voucher berdiri sebagai liabilitas di `pos.customer_deposits`, bukan pendapatan
— uang muka yang diterima hari ini bukan omzet hari ini.

**Sisanya:** `PaymentMethod` di klien belum memuat `VOUCHER` / `DEPOSIT` /
`MEMBER_CHARGE`, dan `endShift()` belum membaca `tender_settlement`. Selama
tender itu belum muncul di UI, tidak ada yang rusak.

#### Tabrakan #4 — "Meal Period" bertabrakan dengan shift · **BELUM DIPUTUSKAN**

Dokumen punya dua penutupan berbeda: **Reset** (tutup kasir per shift) dan
**Meal** (tutup meal period + ganti hari). New Hope POS hanya punya satu:
`pos.shifts` per kasir, plus `business_date` per transaksi.

Menambahkan meal period berarti dua penanda periode yang bisa saling
bertentangan — satu transaksi bisa masuk shift pagi tapi meal period siang, dan
laporan mana yang benar jadi pertanyaan terbuka. Ini **tidak** dikerjakan di
sini karena butuh keputusan produk lebih dulu:

> Apakah "hari usaha" ditentukan oleh tutup kasir, atau oleh jam operasional
> outlet yang independen dari siapa yang jaga kasir?

Kalau jawabannya yang kedua, `pos.branch_settings.operating_hours` sudah ada dan
bisa jadi tempatnya — tanpa perlu entitas meal period tersendiri.

### 1.3 Temuan sampingan: `pos.tenants` vs `internal.tenants`

Bukan bagian dari dokumen, tapi ketemu saat verifikasi dan akan menggigit siapa
pun yang menambah fitur berikutnya:

```
pos.transactions.tenant_id       -> pos.tenants(id)        (tabel warisan)
pos.transactions.cashier_user_id -> pos.users(id)          (tabel warisan)
pos.staff_commissions.tenant_id  -> internal.tenants(id)   (bidang identitas baru)
pos.bill_operations.tenant_id    -> internal.tenants(id)   (bidang identitas baru)
```

Migrasi 0014 menyamakan id-nya lewat backfill **sekali jalan**, tanpa trigger
yang menjaganya tetap sinkron. Artinya tenant yang dibuat belakangan lewat
`pos.tenants` saja tidak akan punya pasangan di `internal.tenants`, dan setiap
tabel baru yang ber-FK ke `internal.*` akan menolak transaksinya.

Jalur sinkronisasi produksi (`services/pos/sync.ts`) menulis ke
`internal.tenants`, jadi ini belum jadi masalah hari ini. Tetap layak
diselesaikan dengan satu migrasi yang memindahkan FK `pos.transactions` ke
`internal.*` sebelum tabel-tabel berikutnya menumpuk di atas dua sumber
kebenaran.

---

## Bagian 2 — `AI_Agentic_Core.pdf` (DEWI)

### 2.1 Kesimpulan: bukan fitur New Hope POS

DEWI adalah asisten WhatsApp untuk **tim support internal vendor software
hotel**: 21 fungsi untuk mengelola tugas engineer, proyek implementasi di
hotel pelanggan, timeboxing harian, tiket komplain, token Careline, dan OKR tim.
Datanya (`tasks_knowledge.jsonl`, `projects_complete.json`) berisi hotel, CNC
ID, PIC engineer, dan aplikasi seperti PowerFO / MyPOS / PowerTENANT.

New Hope POS menjual perangkat lunak kasir ke UMKM. Keduanya menyentuh kata
"POS", tapi pengguna, entitas, dan model bisnisnya berbeda total:

| | New Hope POS | DEWI |
|---|---|---|
| Pengguna | Pemilik & kasir UMKM | Engineer support vendor |
| "Pelanggan" | Merchant yang berlangganan SaaS | Hotel yang dipasangi software |
| Entitas inti | Transaksi, produk, stok, shift | Task, proyek, solusi, reminder |
| Kanal | Web POS + admin console | WhatsApp |
| AI-nya | Baca-saja, deterministik, berkredit | Menulis, agentik, human-in-the-loop |

### 2.2 Kalau tetap dipaksa masuk, ini yang akan nabrak

**a. Melanggar Aturan Emas.** Dokumentasi arsitektur menyatakan *"AI membaca
data Transaksi ➔ AI TIDAK memiliki entitas Transaksi."* 21 fungsi DEWI
sebagian besar **menulis**: buat task, ubah status, jadwalkan reminder. Kalau
ditaruh di skema `ai`, ai-service jadi pemilik domain operasional — persis yang
dilarang. Task dan proyek adalah domain baru, jadi butuh skema dan service
sendiri, bukan menumpang `ai.*`.

**b. Dua sistem OKR.** Fungsi #18 DEWI ("Goal Year Target & quarterly target")
menabrak `internal.business_targets` yang sudah ada dan sudah punya view
kontrak. Dua sistem target di satu database berarti dua jawaban untuk satu
pertanyaan.

**c. Router intent akan pecah.** `IntentName` sekarang seluruhnya `GET_*` —
baca-saja, deterministik, Rp 0. DEWI butuh `CREATE_TASK`, `UPDATE_TASK`,
`SCHEDULE_REMINDER`. Menambahkan intent yang menulis ke router yang sama
menghancurkan invarian yang menyangga model kreditnya: *jawaban deterministik
tidak pernah mengubah data*.

**d. Dua model konfirmasi.** New Hope POS memakai step-up PIN Manager dengan
grant 60 detik. DEWI memakai konfirmasi balasan teks (`YA` / `GAS` / `OKE`)
dengan parameter `confirmed=true`. Membalas "YA" di WhatsApp **tidak boleh**
pernah setara dengan PIN Manager untuk aksi seperti VOID — nomor WhatsApp bukan
faktor autentikasi.

**e. Dua penjadwal.** Reminder engine DEWI (fungsi 10–15) menabrak
`api/cron/*` + `scripts/batch/*` yang sudah jalan. Bisa disatukan, tapi harus
disengaja, bukan ditumpuk.

**f. RAG belum ada fondasinya.** Fungsi 8–9 butuh vector store. Tidak ada
pgvector, tidak ada tabel embedding. Ini penambahan infrastruktur, bukan fitur.

### 2.3 Tiga pola yang layak dipinjam

1. **Safety Gate (human-in-the-loop).** Pola "ringkas aksi ➔ tunggu konfirmasi
   ➔ eksekusi dengan `confirmed=true`" bagus untuk AI Copilot kalau nanti
   diberi kemampuan menulis (buat promo, sesuaikan stok). Konfirmasinya tetap
   harus lewat PIN untuk aksi berisiko, bukan lewat balasan teks.

2. **`action_solution` sebagai basis pengetahuan.** DEWI mencatat langkah
   perbaikan tiap task, lalu memakainya menjawab pertanyaan berikutnya.
   `internal.audit_logs` New Hope POS menyimpan kejadian tapi tidak menyimpan
   penyelesaiannya. Menambahkan catatan resolusi pada peristiwa audit membuat
   riwayat itu bisa dipakai ulang.

3. **Reminder terjadwal yang bisa dibatalkan.** Fungsi 10–14 (jadwalkan, deteksi
   jatuh tempo, tandai terkirim, batalkan, daftar aktif) adalah bentuk yang
   matang. Fitur pengingat WhatsApp laundry di New Hope POS
   (`sendLaundryWaNotification`) sekarang sekali tembak tanpa penjadwalan;
   struktur DEWI adalah cetakan yang tepat untuk membuatnya terjadwal.

### 2.4 Kalau DEWI memang mau dibangun

Bangun sebagai produk terpisah dengan database sendiri. Kalau suatu saat perlu
berbagi infrastruktur dengan New Hope POS, pola yang sudah terbukti di repo ini
tetap berlaku: skema sendiri (`ops.*`), service sendiri (`svc_ops`), dan
permukaan baca lintas domain lewat `contract.*`. Yang tidak boleh adalah
menaruh task dan proyek hotel ke dalam `internal.merchants` — hotel adalah
pelanggan DEWI, bukan merchant yang berlangganan New Hope POS, dan
menyatukannya akan merusak Model B beserta seluruh tagihan langganan yang
bergantung padanya.

---

## Ringkasan perubahan

| Berkas | Isi |
|---|---|
| `migrations/0037_bill_operations_and_non_revenue_tenders.sql` | `revenue_impact`, silsilah bill, `pos.bill_operations`, `pos.tender_types`, buku besar deposit, 5 view kontrak |
| `scripts/db/test-bill-operations.mjs` | 20 pemeriksaan, jalan di PGlite tanpa server (`npm run db:test:bills`) |
| `src/types.ts` | `OrderType.EVENT`, `RevenueImpact`, `Order.guestCount`, `Order.revenueImpact` |
| `src/lib/assistant/insights.ts` | `isSaleOrder()` — angka klien disamakan dengan `contract.merchant_revenue` |
| `src/context/POSContext.tsx` | State covers & klasifikasi bill; bill non-omzet tidak menambah kas shift |
| `src/components/pos/CartPanel.tsx` | Tab segmen Event, stepper jumlah tamu |
| `src/components/pos/CheckoutModal.tsx` | Pemilih klasifikasi bill dengan step-up PIN Manager |
| `src/lib/sync/queue.ts`, `services/pos/sync.ts` | `revenueImpact` & `guestCount` sampai ke database |
