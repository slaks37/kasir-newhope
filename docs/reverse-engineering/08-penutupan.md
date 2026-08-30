# 08 — Penutupan: apa yang diperbaiki, dan bagaimana ia dibuktikan

Dokumen ini melengkapi [`07-kesiapan-produksi.md`](07-kesiapan-produksi.md),
yang sengaja dibiarkan sebagai catatan temuan apa adanya.

Aturan yang dipakai di seluruh perbaikan berikut: **cacat harus bisa
diperlihatkan lebih dulu.** Setiap uji di bawah pernah dijalankan terhadap kode
LAMA dan gagal di sana. Uji yang tidak pernah dibuat gagal tidak diketahui bisa
gagal, dan uji semacam itu hanya memberi rasa aman.

```bash
rm -rf .pgdata
npx tsx services/db-server/index.ts &          # tunggu sampai siap
npm run db:migrate                              # 46 migrasi dari nol
npm run db:reseed
AUTH_ALLOW_LOCAL_DEVELOPMENT=1 npx tsx services/pos/index.ts &

npm run lint          # higiene + tsc
npm run smoke         # 47 intent AI Copilot
npm run audit:prod    # 8 probe kesiapan produksi
npm run e2e           # 3 uji peramban
```

---

## Bagian I — Cacat yang ditemukan oleh uji yang baru ditulis

Empat cacat berikut TIDAK terlihat dari membaca kode. Semuanya muncul ketika
alat ujinya dijalankan — dan tiga di antaranya lebih parah daripada apa pun
yang dicari oleh uji yang menemukannya.

### 1. Setiap muat ulang halaman menghapus riwayat penjualan lokal

**Ditemukan oleh:** uji E2E jalur kasir, pada jam pertama ia berjalan.

Setiap efek penyimpanan di `POSContext` menulis ke kunci yang diturunkan dari
`currentUser.id`, dan id itu ada di daftar dependensinya. Ketika id berubah,
efeknya berjalan lagi — menulis state milik pengguna LAMA ke kunci pengguna
BARU. Terekam dari peramban:

```
t+0ms    render pertama, currentUser = 'usr-owner' (bawaan)
         -> useState memuat orders dari kunci usr-owner  = []
t+74ms   sesi selesai dimuat, currentUser.id jadi id asli
         -> efek menulis [] ke kunci pengguna sungguhan
```

Yang menyelamatkan uang merchant selama ini hanya antrian sinkronisasi, yang
menulis ke berkas lain. Yang hilang adalah riwayat lokal: layar "Transaksi
Terakhir" kosong, struk tidak bisa dicetak ulang, dan laporan "Hari Ini"
menampilkan nol setelah kasir menyegarkan halaman. Berlaku untuk SELURUH
koleksi ber-scope: katalog, pelanggan, stok, riwayat shift, absensi.

**Ditutup** dengan mencatat satu hal — kunci mana yang sedang diwakili state di
memori. Kunci berbeda berarti state ini bukan milik kunci itu: muat ulang,
jangan timpa. Dipasang di `useLayoutEffect` supaya berjalan SEBELUM efek
penyimpanan pada pass yang sama.

### 2. Satu kueri gagal mematikan seluruh pos-service

**Ditemukan oleh:** uji beban, bagian baca+tulis bersamaan.

Express 4 tidak meneruskan rejection dari handler `async` ke middleware
penangkap error. Ia menjadi unhandled rejection, dan kebijakan service ini
mematikan proses ketika itu terjadi. Middleware penangkapnya sudah ada — ia
tidak pernah bisa dicapai, karena seluruh rute di service ini async.

Satu galat basis data pada SATU pembacaan laporan menjatuhkan pos-service, dan
39 checkout yang sedang berjalan ikut gagal dengan `fetch failed`.

**Ditutup** di `services/shared/service.ts`: setiap handler yang mengembalikan
Promise disambungkan ke `next(err)`. Sesudahnya, bagian uji yang sama berjalan
60/60 tulis dan 20/20 baca tanpa satu pun galat — kegagalan yang tampak
terungkap ternyata AKIBAT matinya service, bukan sebabnya.

### 3. Bawaan kebijakan stok hanya berlaku untuk baris yang sudah ada

**Ditemukan oleh:** `npm run db:reseed`, bukan oleh uji.

Migrasi 0044 versi pertama memakai backfill sekali jalan
(`UPDATE ... WHERE business_sector='RETAIL'`). Merchant RETAIL yang mendaftar
SESUDAHNYA mendapat `WARN` dari bawaan kolom, dan boleh menjual barang berstok
nol. Uji konkurensi tidak menangkapnya karena ia menyetel kebijakan secara
eksplisit — sehingga lulus bahkan ketika bawaannya rusak.

**Ditutup** dengan menurunkan bawaan dari sektor setiap kali dibaca
(`internal.fn_stock_policy`), bukan membekukannya saat INSERT. Uji konkurensi
kini punya bagian C yang membuat merchant BARU tanpa penyetelan apa pun.

### 4. Uji ACID menumpang fixture uji lain, dan mengukur hal yang salah

Ia membaca sisa data `t-concurrency` — dan mati begitu uji itu memakai awalan
per-jalan. Kriteria lulusnya menghitung SELURUH database, yang hanya benar pada
database kosong; setelah `db:reseed` ia akan selalu gagal.

**Ditutup** dengan fixture sendiri dan selisih pada tenantnya sendiri. Ditambah
**kontrol positif**: checkout yang SAH harus tercatat lengkap, karena rollback
sempurna gampang dipalsukan oleh jalur tulis yang memang tidak menulis apa-apa.
Kontrol itu langsung menemukan bahwa `'SUCCESS'` bukan status yang sah menurut
`chk_payment_lifecycle_status`.

---

## Bagian II — Area yang sebelumnya tidak ada sama sekali

### Peripheral: ESC/POS, laci kasir, antrian cetak

Sebelumnya seluruh "cetak struk" adalah `window.print()` — dialog cetak
peramban. Tidak memotong kertas, tidak membuka laci, dan hasilnya tidak pernah
diperiksa: printer mati, kasir tetap melihat "Pembayaran Sukses".

| Berkas | Isi |
|---|---|
| `src/lib/peripheral/escpos.ts` | Perintah ESC/POS sungguhan. Murni fungsi — masuknya struk, keluarnya byte. |
| `src/lib/peripheral/spooler.ts` | Antrian dengan batas waktu, percobaan ulang bertahap, dan keadaan gagal yang terlihat. Bertahan di disk. |
| `src/lib/peripheral/transport.ts` | Bluetooth (BLE), USB (WebUSB), LAN (lewat jembatan), dan dialog peramban sebagai cadangan. |

Batas waktunya bukan hiasan: printer Bluetooth yang terputus tidak
mengembalikan kesalahan, ia hanya diam, dan `await kirim()` menggantung
selamanya — bersama layar kasir.

**31 pemeriksaan** di `scripts/dev/audit/t-peripheral.ts`: byte perintah,
urutan laci-sebelum-potong, teks non-ASCII, nama produk yang dipotong (bukan
angkanya), printer yang menggantung, gagal-lalu-menyerah, pulih setelah kertas
diganti, antrian yang selamat dari muat ulang, dan dua penjalan bersamaan yang
tidak mencetak dobel.

**Yang TIDAK dibuktikan**, dan dikatakan di dalam ujinya sendiri: bahwa printer
merek tertentu sungguh mencetak. Itu menuntut perangkat keras.

Klaim pemasaran ikut dikoreksi. Web Bluetooth dan WebUSB tidak ada di Safari,
jadi janji "iPad + printer termal Bluetooth" salah; "Plug & Play" juga salah
karena peramban mewajibkan pengguna memilih perangkatnya lewat dialog. Layar
Pengaturan kini melaporkan kemampuan PERAMBAN INI, bukan daftar merek.

### E2E jalur kasir

`e2e/kasir.spec.ts` — buka shift → pilih produk → bayar → struk → tutup shift,
di peramban sungguhan atas build produksi. Uji kedua menjual sesuatu lalu
MEMUAT ULANG halaman dua kali, karena struk yang muncul hanya membuktikan
transaksinya diproses di memori.

Dua temuan sampingan dari menulisnya:

- tidak satu pun modal menanggapi Escape. Kasir hanya punya tombol X kecil di
  pojok, dicari dengan mata sementara antrean menunggu;
- kartu produk adalah `<div onClick>` — tidak bisa dijangkau Tab, tidak
  bereaksi pada Enter/Spasi. Di jam sibuk papan ketik jauh lebih cepat daripada
  kursor.

Keduanya diperbaiki.

### Uji beban puncak

`scripts/dev/audit/t-beban.mjs` mengukur tiga hal, dan sengaja bukan "berapa
permintaan per detik":

- **latensi ekor** (p95/p99), bukan rata-rata — kasir tidak merasakan
  rata-rata, ia merasakan transaksi yang menggantung;
- **kebenaran di bawah beban** — setiap transaksi yang dijawab "diterima"
  dihitung ulang di database. 200 checkout, 20 kasir bersamaan: 200 tercatat;
- **idempotensi di bawah beban** — kunci yang sama dikirim 30 kali berbarengan:
  satu yang tercatat.

`PGPOOL_MAX=4` akhirnya terukur, bukan ditebak: 100 permintaan bersamaan atas 4
koneksi ANTRE dengan tertib, tidak ada yang ditolak, harganya p99 ~1 detik.

Angkanya berlaku untuk PGlite di satu mesin pengembangan dan tidak boleh
dikutip sebagai kinerja produksi — dikatakan di dalam ujinya sendiri.

### SDK / OpenAPI

`docs/api/openapi.yaml` — 24 rute publik, OpenAPI 3.1, dengan skema muatan,
kode kesalahan, dan contoh.

Yang membuatnya bukan sekadar berkas YAML: `npm run hygiene` membandingkannya
dengan rute yang sungguh terdaftar di `services/`, dan menolak dua arah — rute
yang ada di kode tapi tidak terdokumentasi, DAN rute yang terdokumentasi tapi
sudah tidak ada. Keduanya diuji dengan merusak spec dengan sengaja lebih dulu.

Isinya menjelaskan hal yang tidak bisa ditebak dari bentuk endpoint: urutan
kedatangan bukan urutan kejadian, kiriman ganda itu normal, `baseRevision`
wajib disimpan dan dikirim balik, dan peran yang dinyatakan klien tidak dipakai
untuk otorisasi.

### Canary / peluncuran bertahap

Migrasi 0046 + `services/shared/flags.ts` + `GET /api/v1/flags`.

Sasaran dipilih di beberapa sumbu: persentase, sektor, tier paket, daftar
putih, daftar hitam. Tiga sifat yang diuji, dan yang paling sering dilanggar
oleh implementasi bendera fitur:

- **stabil** — merchant yang sama selalu mendapat jawaban yang sama. Fitur yang
  berkedip antar permintaan lebih buruk daripada fitur yang mati. Diuji: 30
  merchant × 4 penilaian, nol perubahan.
- **berbeda per bendera** — kunci bendera ikut di-hash. Tanpa itu, merchant di
  ember 1–5 menjadi kelinci percobaan untuk SETIAP canary selamanya. Itu bukan
  peluncuran bertahap, itu memilih korban tetap.
- **gagal-mati** — bendera tidak dikenal, dan kegagalan apa pun, berarti MATI.
  Salah ketik nama bendera tidak boleh menyalakan.

Daftar hitam mengalahkan segalanya, termasuk daftar putih dan peluncuran 100%.
Tanpa urutan itu, "jangan pernah nyalakan untuk merchant ini" hanya akan
menjadi saran.

### Profil memori

`e2e/memori.spec.ts` — 50 penjualan lewat antarmuka sungguhan.

```
garis dasar (sesudah 10 penjualan)   5,6 MB
sesudah 40 penjualan lagi            5,8 MB
pertumbuhan                          4,9 KB per transaksi
proyeksi 500 transaksi (shift ramai) 2,4 MB
```

Pertumbuhannya sebanding dengan data yang memang disimpan. Yang diukur adalah
heap SESUDAH GC dipaksa — heap yang naik antar pengukuran hanya sampah yang
belum dipungut.

Penting di sini dan tidak di aplikasi web biasa: tablet kasir tidak dimuat
ulang. Ia dinyalakan pagi hari dan baru dimatikan saat toko tutup.

---

## Bagian III — Cacat data yang ditutup

### Katalog: perangkat basi menghapus pekerjaan perangkat lain

`POST /api/v1/sync/catalog` memperlakukan kiriman satu perangkat sebagai
kebenaran mutlak. Benar untuk satu perangkat — dan sistem ini menjual paket 2
dan 4 outlet dengan aplikasi offline-first.

Terbukti: tablet yang seharian offline mengembalikan harga 22.000 ke 18.000 dan
memensiunkan kedua produk yang dibuat hari itu, tanpa satu pun pesan.

Penjaganya nomor revisi milik SERVER, bukan cap waktu klien — jam tablet kasir
tidak bisa dipakai mengurutkan kejadian antar perangkat. `baseRevision` 0
mematikan pemensiunan sepenuhnya.

### Laporan merchant menampilkan 8% dari omzet sebenarnya

`ReportsDashboard` tidak punya satu pun pemanggilan `fetch`; ia hanya membaca
state. Sesudah muat ulang halaman, filter "Bulan Ini" menjumlahkan paling
banyak 50 transaksi lalu menampilkannya sebagai omzet sebulan.

Terukur pada data contoh, merchant retail 30 hari terakhir:

```
omzet sebenarnya   Rp 92.668.527
yang terlihat      Rp  7.525.191
HILANG             Rp 85.143.336   (91,9%)
```

`GET /api/v1/reports/orders` menutupnya, dibaca lewat `contract.transaction_log`.
Layar Laporan menggabungkan server dengan state lokal — bukan menggantinya,
karena transaksi yang baru dibayar masih mengantri dan belum ada di server.

Kalau server tidak terjangkau, layar tetap menampilkan data lokal DAN
mengatakan bahwa angkanya bisa lebih kecil dari kenyataan.

Batas riwayat lokal juga dinaikkan 50 → 500. Alasan adanya batas tetap benar;
angkanya yang salah — kafe ramai melewati 50 sebelum makan siang.

### Permukaan serverless menjawab "berhasil" tanpa menulis apa pun

Cacat paling parah di seluruh pekerjaan ini, dan ia berada di jalur CADANGAN —
tempat yang paling jarang dilihat orang.

`api/_gateway.ts` menjawab `{ ok: true, synced: true }` untuk setiap
`/api/v1/sync/*` tanpa menulis ke mana pun. Rantai lengkapnya:

```
1. kasir menyinkronkan antrian transaksinya
2. permukaan itu menjawab ok: true
3. klien melihat ok, lalu MENGHAPUS transaksi itu dari antriannya
4. transaksinya hilang dari kedua sisi
```

Blok itu adalah cadangan ketika gateway sungguhan tidak terjangkau. Artinya
penjualan mulai lenyap **persis ketika backend sedang bermasalah** — tanpa satu
pun pesan kesalahan, karena semua pihak mengira semuanya baik-baik saja.

Ditutup di dua tempat, karena satu saja tidak cukup:

- permukaan itu kini menjawab `503 SYNC_UNAVAILABLE`, dan jalur yang tidak
  dikenal menjawab `404` — bukan `200 ok: true`;
- klien kini menuntut PENGAKUAN sebelum memangkas antrian. `ok: true` saja
  tidak cukup; server yang jujur selalu melaporkan berapa yang diterima,
  diputar ulang, atau dilewati.

Perbaikan kedua yang lebih penting: yang salah bukan hanya satu permukaan itu,
melainkan menganggap `ok: true` sebagai bukti. Pemangkasan antrian adalah
satu-satunya tempat di seluruh aplikasi yang menghapus catatan penjualan.

`scripts/dev/audit/t-jujur.ts` menguji enam keadaan, dan diperiksa gagal lebih
dulu dengan penjaganya dimatikan: pada perilaku lama, antrian 2 transaksi
menjadi 0 setelah jawaban yang bohong.

> **Kegagalan yang jujur menyimpan datanya; keberhasilan yang bohong
> menghapusnya.**

### Seed mendahului Model B

`scripts/db/seed.ts` tidak membuat `merchants`/`outlets`/`memberships`, dan
blok langganannya bergantung pada billing-service pernah dijalankan lebih dulu
— kalau belum, `billing.plans` kosong dan seluruh alur billing tidak pernah
tersentuh data demo. Paket kini di-seed dari katalog harga yang SAMA dengan
yang dipakai service, dan tiernya beragam supaya batas paket ikut teruji.

---

## Yang masih terbuka

**`POSContext.tsx` masih 2.100+ baris dengan fan-in 26.** Pemecahannya
sempat dicoba dan ditunda dengan alasan yang masih berlaku: irisan sinkronisasi
tidak bisa dipisahkan begitu saja karena `enqueueSync` dipanggil dari DALAM
`processPayment` dan `voidOrder`. Memecahnya menuntut membalik arah
ketergantungan itu lebih dulu, dan itu perubahan perilaku — bukan penataan
ulang. Dilakukan sebagai pekerjaan tersendiri, dengan uji E2E yang sekarang
sudah ada sebagai jaring pengaman.

**Integrasi peripheral belum diuji dengan perangkat keras.** Byte-nya benar
menurut spesifikasi; bahwa printer merek tertentu menerimanya adalah hal lain,
dan hanya bisa dibuktikan dengan printer sungguhan.
