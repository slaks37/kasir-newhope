# 07 — Pemeriksaan Kesiapan Produksi

> **Dokumen ini adalah CATATAN TEMUAN, bukan keadaan sekarang.**
>
> Isinya sengaja dibiarkan seperti saat pemeriksaan dilakukan. Menghapus temuan
> yang sudah diperbaiki akan menghapus satu-satunya catatan tentang APA yang
> pernah salah dan bagaimana ia terbukti salah — dan itu justru bagian yang
> paling berguna ketika cacat serupa muncul lagi.
>
> Apa yang sudah ditutup, dengan buktinya, ada di
> [`08-penutupan.md`](08-penutupan.md). Kolom **Sekarang** di tabel ringkasan
> di bawah menunjuk ke sana.

Pemeriksaan 15 area kesiapan operasional POS. Yang bisa diuji, **diuji dengan
menjalankannya** — bukan dengan membaca kode. Probe-nya ikut di-commit dan bisa
dijalankan ulang:

```bash
rm -rf .pgdata
npx tsx services/db-server/index.ts &
npx tsx services/db-server/migrate.ts
npm run audit:prod
```

---

## Ringkasan

| Area | Saat diperiksa | Diuji? | Sekarang |
|---|---|---|---|
| Idempotency Verification | ✅ **Kuat** | ya, end-to-end | ✅ diperluas — kunci kini per-(tenant, unit usaha) |
| Database ACID & Rollback | ✅ **Lulus** | ya | ✅ ditambah kontrol positif |
| Tenant Isolation & Data Leak | ✅ **Kuat** | ya | ✅ tetap |
| Race Condition & Overselling | 🔴 **Gagal** | ya — stok jadi −1 | ✅ ditutup (0044) |
| Financial & Calculation Precision | 🔴 **Cacat** | ya — kembalian pecahan | ✅ ditutup (`src/lib/money.ts`) |
| RBAC (void / refund) | 🔴 **Lemah** | ya — server tidak menegakkan | ✅ ditutup (0042 + `services/pos/staff.ts`) |
| Offline-First & Conflict Resolution | 🟡 Sebagian | ya (transaksi), tidak (katalog) | ✅ katalog kini berevisi (0045) |
| Memory Leak Profiling | 🟡 Sebagian | statis | ✅ diukur: 4,9 KB/transaksi |
| Regression Testing | 🟡 Sebagian | ya | ✅ 8 probe + 3 E2E di CI |
| Peripheral Integration (ESC/POS, laci, scanner) | ⚫ **Tidak ada** | — | ✅ ESC/POS + laci, diuji per byte |
| Print Spooling & Timeout Handling | ⚫ **Tidak ada** | — | ✅ antrian dengan batas waktu & ulang |
| SDK & Dokumentasinya | ⚫ **Tidak ada** | — | ✅ OpenAPI 3.1 + pemeriksa anti-meleset |
| Peak Load & Stress Testing | ⚫ **Tidak ada** | — | ✅ ada, dan menemukan cacat mematikan |
| E2E Smoke (jalur kasir) | ⚫ **Tidak ada** | — | ✅ ada, dan menemukan penghapus data |
| Canary / Phased Rollout | ⚫ **Tidak ada** | — | ✅ bendera fitur (0046) |

Rinciannya, dengan bukti dan angka, ada di [`08-penutupan.md`](08-penutupan.md).

---

# A. Integritas Data & Transaksi

## ✅ Idempotency Verification — kuat

**Pertanyaan:** kasir menekan bayar berkali-kali karena jaringan lambat, apakah
transaksinya dobel?

**Tidak.** Ada empat lapis, dan sudah diuji end-to-end lewat service sungguhan:

| Lapis | Mekanisme | Menangkap |
|---|---|---|
| Klien | `enqueue()` mencocokkan `clientTxnId` sebelum menyimpan | Tekan bayar dua kali di perangkat yang sama |
| Server 1 | `pos.sync_receipts.idempotency_key` | Seluruh batch terkirim ulang |
| Server 2 | `UNIQUE (tenant_id, client_txn_id)` | Satu transaksi terkirim ulang di batch berbeda |
| Server 3 | `UPDATE … WHERE order_status <> 'VOIDED'` | Pembatalan ganda |

```
batch A (baru)  -> accepted 2
batch A (ulang) -> replayed true      # lapis 1
batch B         -> accepted 1
batch C (void)  -> duplicates 1, voided 1   # lapis 2 + 3
```

Lapis 3 adalah yang paling mudah salah dirancang: void selalu tiba sebagai
kiriman **kedua** untuk `clientTxnId` yang sama. Kalau diperlakukan duplikat
biasa, pembatalannya hilang dan panel terus menghitung uang yang sudah
dikembalikan ke pelanggan.

---

## 🔴 Race Condition & Concurrency — GAGAL, overselling terjadi

**Pertanyaan:** dua kasir menjual unit terakhir yang sama di detik yang sama,
apakah stok bisa minus?

**Bisa. Terbukti.** `scripts/dev/audit/t-concurrency.mjs`:

```
stok awal : 1.000
kasir-A: BERHASIL menjual
kasir-B: BERHASIL menjual
stok akhir: -1.000

>>> OVERSELLING: stok jadi -1.000
CHECK constraint di inventory_balances: TIDAK ADA
```

**Kenapa lolos.** Trigger `fn_apply_inventory_transaction` melakukan
`current_stock = current_stock + EXCLUDED.current_stock` di dalam
`ON CONFLICT DO UPDATE`. Itu **atomik** — tidak ada *lost update*, kedua
pengurangan benar-benar tercatat. Tapi atomik ≠ dijaga: fungsi itu tidak pernah
**memeriksa** apakah hasilnya negatif.

Jadi sifat yang selama ini dibanggakan komentar kode ("aman terhadap concurrent
updates") memang benar, dan memang **bukan** yang mencegah overselling. Keduanya
hal berbeda.

**Pilihan perbaikan** — ini keputusan bisnis, bukan teknis:

| Pendekatan | Cocok untuk | Konsekuensi |
|---|---|---|
| `CHECK (current_stock >= 0)` | Ritel, apotek — stok fisik mutlak | Penjualan **ditolak**; kasir tidak bisa melayani meski barangnya ada di rak (stok sistem meleset) |
| `RAISE EXCEPTION` di trigger bila hasil < 0 | Sama, tapi pesan errornya bisa dibuat ramah | Sama |
| Izinkan negatif, tandai untuk rekonsiliasi | F&B, laundry, jasa — stok resep sering meleset | Penjualan tidak pernah gagal; butuh laporan "stok minus" |
| Reservasi stok saat masuk keranjang | Antrean panjang, stok langka | Paling rumit; butuh kedaluwarsa reservasi |

Untuk sistem lima sektor ini, satu aturan seragam kemungkinan salah: menolak
penjualan kopi karena stok susu tercatat minus jauh lebih merugikan daripada
menolak penjualan HP terakhir di toko ritel.

---

## ✅ Database ACID & Rollback — lulus

**Pertanyaan:** transaksi gagal di tengah jalan, apakah mutasi stok dan jurnal
ikut dibatalkan?

**Ya.** `scripts/dev/audit/t-acid.mjs` menyisipkan transaksi → item → mutasi
stok, lalu sengaja menggagalkan langkah pembayaran:

```
sebelum : {"trx":0,"item":0,"mutasi":3}
gagal di langkah pembayaran: [23514] chk_payment_lifecycle_status -> ROLLBACK
sesudah : {"trx":0,"item":0,"mutasi":3}

>>> ROLLBACK UTUH
```

Jalur sinkronisasi membungkus seluruh batch dalam satu `db.tx()`
(`services/shared/db.ts`), jadi kegagalan pada transaksi ke-40 membatalkan
ke-39 sebelumnya juga. Itu benar untuk konsistensi, dan berarti **satu baris
rusak menggagalkan seluruh batch** — perilaku yang perlu diketahui saat
mendiagnosis sinkronisasi yang macet.

---

# B. Jaringan & Operasional Toko

## 🟡 Offline-First & Conflict Resolution — kuat untuk transaksi, lemah untuk katalog

### Transaksi: kuat

`src/lib/sync/queue.ts` menulis ke `localStorage` **sebelum** apa pun dikirim,
dan pengirimannya tidak di-`await` — kasir tidak pernah menunggu jaringan.
Antrian hanya dipangkas setelah server mengonfirmasi, dan dibaca ulang saat
memangkas supaya transaksi yang masuk **selama** pengiriman tidak ikut terbuang.
Backoff 5d → 15d → 45d → 2m → 5m. Satu pengiriman per unit usaha.

Biasnya sengaja ke arah kirim-ulang, bukan buang: menggandakan omzet tidak bisa
diperbaiki dari layar mana pun; kehilangan satu struk masih bisa dimasukkan
ulang manual.

### Katalog: last-write-wins

`POST /api/v1/sync/catalog` mengirim **seluruh** katalog, dan produk yang tidak
ada di kiriman ditandai `is_available = FALSE` (`services/pos/sync.ts:748`).

Skenario bentrok yang nyata:

1. Tablet A offline sejak kemarin, punya 20 produk.
2. Tablet B menambah 5 produk hari ini, tersinkron.
3. Tablet A online, mengirim 20 produknya.
4. **5 produk dari B ditandai tidak tersedia.**

Tidak ada *vector clock*, *timestamp per baris*, atau penggabungan. Penulis
terakhir menang untuk seluruh katalog. Produk tidak dihapus (baris struk lama
tetap utuh), tapi hilang dari layar kasir sampai seseorang menyadarinya.

Ini dapat diterima untuk satu perangkat per unit usaha, dan **tidak** untuk
toko dengan beberapa terminal — yang justru pasar yang dituju paket Tier Pro
(hingga 4 outlet).

---

## ⚫ Peripheral Integration — tidak ada implementasinya

**Diperiksa:** ESC/POS, cash drawer, barcode scanner, Bluetooth/USB/LAN.

**Yang ada di kode:** `window.print()`. Itu saja.

```
src/components/pos/ReceiptModal.tsx:25   window.print();
src/utils/reportExporter.ts:819          window.print();
```

Tidak ditemukan satu pun: `navigator.usb`, `navigator.bluetooth`, Web Serial
API, pembangkitan byte ESC/POS, perintah *kick* laci kasir, atau integrasi
scanner.

**Yang menyebut peripheral hanyalah teks pemasaran dan label pengaturan:**

| Lokasi | Isi |
|---|---|
| `HomePage.tsx:491, 585, 1401` | "membuka laci kasir (cash drawer)", "printer termal Bluetooth", "Sunmi/iMin" |
| `SettingsManager.tsx:641, 668` | "Printer Bluetooth / Portabel", "Kompatibel: USB, Bluetooth, LAN, Sunmi, iMin" |
| `Header.tsx:96` | placeholder "atau scan barcode" — sebuah kotak pencarian teks biasa |
| `InventoryManager.tsx:156` | barcode dibuat dengan `Math.random()` |

Pengaturan ukuran kertas 58mm/80mm hanya mengubah lebar CSS struk yang dicetak
browser; tidak ada perintah yang dikirim ke perangkat mana pun.

> **Penting untuk diluruskan:** ini bukan berarti mencetak tidak bisa. Di mesin
> Android POS (Sunmi/iMin), dialog cetak sistem sering sudah terhubung ke
> printer bawaannya, sehingga `window.print()` **memang menghasilkan struk**.
> Yang tidak ada adalah kendali langsung: potong kertas, buka laci, deteksi
> kertas habis, dan pemilihan printer dari aplikasi.

---

## ⚫ Print Spooling & Timeout Handling — tidak ada, tapi bukan risiko crash

`window.print()` menyerahkan seluruh urusan ke browser. Konsekuensinya
berpasangan:

- Aplikasi **tidak bisa crash atau freeze** karena kertas habis, macet, atau
  printer terputus — browser yang menanganinya, bukan kode ini.
- Aplikasi juga **tidak bisa tahu** ketiganya terjadi. Tidak ada antrean cetak,
  tidak ada percobaan ulang, tidak ada penanda "struk ini belum tercetak".

Risikonya karena itu bukan aplikasi mati, melainkan **struk yang diam-diam tidak
keluar** sementara transaksinya sudah tercatat lunas. Untuk sektor yang strukya
menjadi bukti pengambilan barang — laundry, servis — itu berarti sengketa dengan
pelanggan tanpa jejak apa pun di sistem.

---

## ⚫ SDK & Dokumentasinya — tidak ada

Tidak ditemukan paket SDK, spesifikasi OpenAPI/Swagger, koleksi Postman, atau
dokumentasi API publik. Yang ada adalah dokumentasi arsitektur internal
(`docs/`), yang menjelaskan cara sistem bekerja — bukan cara pihak ketiga
mengintegrasikannya.

Bahan mentahnya sebenarnya sudah ada dan rapi: 27 rute Express dengan bentuk
request/response yang konsisten dan sudah terpetakan di
[`02-analisis-statis.md`](02-analisis-statis.md#4-rekonsiliasi-endpoint).
Menurunkannya menjadi OpenAPI adalah pekerjaan yang jelas, bukan penemuan.

---

## ✅ Tenant Isolation & Data Leak — kuat

**Pertanyaan:** bisakah data Toko A terbaca Toko B?

**Tidak.** `scripts/dev/audit/t-isolasi.mjs` menguji kedua penjaga dengan query
yang disalin persis dari kode:

```
canAccessBusiness (baca AI & admin):
   owner-A  -> owner-A_FNB   BOLEH
   owner-A  -> owner-B_FNB   ditolak
   owner-B  -> owner-A_FNB   ditolak
   penyusup -> owner-A_FNB   ditolak

assertBusinessCanBeClaimed (tulis sync):
   owner-A  -> owner-B_FNB   ditolak
   penyusup -> owner-A_FNB   ditolak
```

Isolasinya berlapis:

1. **Klien** — kunci `localStorage` diprefiks `businessId` (`${userId}_${sector}`),
   jadi kafe dan laundry milik pemilik yang sama pun terpisah, termasuk
   antrian sinkronisasinya.
2. **Gateway** — token diverifikasi ke Supabase Auth; `ownerRef` dari body
   **diabaikan**, principal gateway yang dipakai.
3. **Service** — `canAccessBusiness` memverifikasi kepemilikan ke tabel, bukan
   mempercayai id yang dikirim.
4. **AI Copilot** — prompt menyatakan batas tenant secara eksplisit, dan
   `resolveTenant()` menolak menebak bila satu pemilik punya lebih dari satu
   unit usaha.

Satu-satunya jalan tembus adalah `AUTH_ALLOW_LOCAL_DEVELOPMENT=1`, yang sejak
perbaikan T‑07 **menolak proses menyala** bila `NODE_ENV=production`.

---

## 🔴 RBAC — PIN manajer hanya ada di UI

**Pertanyaan:** apakah void dan refund benar-benar butuh otorisasi manajer?

**Tidak di server.** `scripts/dev/audit/t-rbac-tenant.mjs`, terhadap pos-service
yang berjalan:

```
buat transaksi (ADMIN)   : 200 accepted=1
VOID mengaku CASHIER     : 200 voided=1
>>> DITERIMA. Server tidak memeriksa peran.
```

`services/pos/sync.ts` menerima `cashierRole` dari body dan memakainya
**hanya sebagai label audit** (`actorRole`, baris 455) — tidak pernah sebagai
pemeriksaan otorisasi. Modal PIN di `RecentTransactionsModal.tsx:584` adalah
gerbang di sisi klien; siapa pun yang bisa memanggil API bisa melewatinya.

Dua masalah pendamping:

**MANAGER identik dengan ADMIN.** Keduanya punya **13 dari 13 izin yang sama**
(`src/data/rolePermissions.ts`), termasuk `user_management` dan
`billing_subscription`. Jadi seorang manajer bisa menambah pengguna dan
mengubah paket langganan. Kalau pembedaannya memang tidak diinginkan, satu dari
kedua peran itu sebaiknya dihapus; kalau diinginkan, daftarnya perlu dibedakan.

**Tidak ada konsep refund tersendiri.** Yang ada hanya void, yang menandai
pembayaran `REFUNDED` dan mengembalikan stok. Tidak ada refund sebagian, tidak
ada catatan alasan terstruktur, tidak ada batas waktu.

**Perbaikan yang tepat** bukan memindahkan PIN ke server — PIN adalah kredensial
perangkat, bukan identitas. Yang benar: peran pemanggil diambil dari sesi
terverifikasi (principal gateway), lalu jalur void memeriksanya di server
sebelum menerima. PIN tetap berguna sebagai konfirmasi fisik di terminal
bersama, tapi bukan sebagai satu-satunya penjaga.

---

## ⚫ Peak Load & Stress Testing — tidak ada

Tidak ada k6, Artillery, autocannon, atau skrip beban apa pun.

Dua hal yang perlu diukur sebelum ratusan cabang serentak, keduanya sudah
terbaca dari konfigurasi:

- **`PGPOOL_MAX=4` per service.** Lima service × 4 = 20 koneksi. Cukup untuk
  pengembangan; batas paket gratis Supabase sekitar 60 total. Berapa transaksi
  per detik yang muat di 4 koneksi belum pernah diukur.
- **Satu transaksi database per batch sinkronisasi.** Batch 500 transaksi
  memegang satu koneksi selama seluruh proses. Sepuluh cabang menyinkron
  bersamaan pada jam tutup toko sudah cukup untuk menghabiskan pool.

Circuit breaker di gateway (`services/shared/breaker.ts`) melindungi dari
service yang mati, **bukan** dari database yang kehabisan koneksi — kegagalan
itu muncul sebagai lambat, bukan sebagai error yang memicu breaker.

---

## ⚫ E2E Smoke Testing (jalur kasir) — tidak ada

`npm run smoke` yang ada **hanya menguji AI Copilot** — 47 intent, 6
fall-through. Tidak satu pun menyentuh:

```
buka kasir -> input order -> bayar -> cetak struk -> tutup shift
```

Tidak ada Playwright, Cypress, atau uji integrasi HTTP untuk jalur transaksi.
Ironisnya, Playwright **sudah terpasang** di lingkungan ini (Chromium ada di
`/opt/pw-browsers`), jadi hambatannya bukan perkakas.

Alur yang paling berharga untuk ditulis lebih dulu, karena keduanya menyentuh
uang: `processPayment` (perhitungan sampai antrian) dan `closeShift`
(rekonsiliasi kas — `expectedCash` vs `actualCash`).

---

## 🟡 Memory Leak Profiling — tidak ada kebocoran listener, tapi array tumbuh terus

**Yang bersih.** Pemindaian seluruh `src/` menemukan setiap `setInterval` dan
`addEventListener` punya pembersihan berpasangan di `useEffect`. Satu-satunya
`addEventListener` tanpa pasangan ada di `reportExporter.ts:817`, dan itu
dipasang di **jendela cetak terpisah** yang ditutup setelahnya — bukan di
aplikasi utama.

**Yang tumbuh.** State React tidak dibatasi:

```js
setOrders((prevOrders) => [newOrder, ...prevOrders]);   // POSContext.tsx:1499
```

`localStorage` **dibatasi** — 50 order, 50 log inventori, 30 shift — dan itu
disengaja serta didokumentasikan. Tapi array di memori tidak. Terminal yang
menyala nonstop tiga hari dengan 300 transaksi/hari memegang 900 objek order
lengkap dengan seluruh item dan pelanggannya, dan setiap penambahan
me-render ulang **26 konsumen** `POSContext` sekaligus (lihat T‑06).

Gejalanya bukan crash, melainkan pelan yang menumpuk — persis yang dimaksud
"masih ringan setelah menyala berhari-hari".

**Efek samping yang lebih penting dari kebocorannya sendiri:** karena
`localStorage` dibatasi 50 order dan `ReportsDashboard` membaca **hanya** dari
state lokal (**nol** panggilan `fetch`), maka setelah browser dimuat ulang
laporan merchant hanya mencakup 50 transaksi terakhir. Datanya aman di server —
tidak ada jalur baca untuk mengambilnya kembali.

---

## 🟡 Regression Testing — ada, tapi hanya untuk AI

Sejak perbaikan T‑05 dan T‑12, CI menjalankan pada setiap push:

- `npm run lint` — 6 pemeriksaan higiene + `tsc --noEmit`
- `npm run smoke` — 47 intent AI Copilot

Yang **tidak** tercakup: seluruh jalur transaksi, perhitungan uang, manajemen
stok, shift, dan sinkronisasi. Probe di `scripts/dev/audit/` bisa dijadikan
titik awal, tapi butuh database sehingga tidak masuk CI yang sekarang.

---

## ⚫ Canary / Phased Rollout — tidak ada

Tidak ada *feature flag*, segmentasi merchant, atau konfigurasi rilis bertahap.
`docker-compose.yml` punya `healthcheck` di kelima service — cukup untuk
*rolling restart*, tidak cukup untuk memaparkan versi baru ke 5% merchant lebih
dulu.

Bahan yang sudah ada dan bisa dipakai: `plans.tierLevel` dan
`internal.merchants.business_sector` keduanya bisa menjadi sumbu segmentasi
tanpa skema baru.

---

# Yang paling mendesak

Diurutkan menurut biaya bila dibiarkan, bukan menurut kesulitan.

1. **Presisi finansial** — sedang terjadi pada setiap transaksi berdiskon.
   Kembalian `Rp 10.825,300000000003` adalah uang yang benar-benar diserahkan.
2. **RBAC void di server** — celah otorisasi, bukan sekadar rancangan. Siapa pun
   yang punya sesi merchant bisa membatalkan transaksi apa pun.
3. **Aturan overselling** — butuh keputusan bisnis per sektor lebih dulu.
4. **E2E jalur kasir** — tanpa ini, ketiga perbaikan di atas tidak punya jaring
   pengaman.
5. **Konflik katalog multi-terminal** — baru menggigit saat merchant Tier Pro
   memakai lebih dari satu terminal.

Empat area yang tidak ada sama sekali — peripheral, SDK, uji beban, canary —
adalah **pekerjaan yang belum dimulai**, bukan cacat. Yang perlu diluruskan
hanyalah teks pemasaran di `HomePage.tsx` yang menjanjikan kendali laci kasir
dan printer ESC/POS hari ini.
