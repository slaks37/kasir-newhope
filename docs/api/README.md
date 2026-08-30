# API New Hope POS

`openapi.yaml` — spesifikasi OpenAPI 3.1 untuk seluruh API publik.

## Membacanya

```bash
# Peramban, tanpa memasang apa pun
npx @redocly/cli preview-docs docs/api/openapi.yaml

# Atau hasilkan HTML statis
npx @redocly/cli build-docs docs/api/openapi.yaml -o docs/api/index.html
```

## Menghasilkan klien

```bash
# TypeScript
npx openapi-typescript docs/api/openapi.yaml -o src/lib/api-types.ts

# Bahasa lain
npx @openapitools/openapi-generator-cli generate \
  -i docs/api/openapi.yaml -g dart -o ./sdk-dart
```

## Kenapa spesifikasi ini tidak bisa meleset diam-diam

Dokumentasi API yang ditulis tangan selalu benar pada hari ia ditulis, lalu
meleset tanpa ada yang tahu. Yang berbahaya bukan ketiadaan dokumentasi —
melainkan dokumentasi yang SALAH, karena integrator membangun di atasnya dan
kesalahannya baru terlihat di produksi milik orang lain.

`npm run hygiene` karena itu membandingkan spesifikasi ini dengan rute yang
sungguh terdaftar di `services/`, dan menolak keduanya:

- rute yang ada di kode tapi tidak terdokumentasi;
- rute yang terdokumentasi tapi sudah tidak ada di kode.

Pemeriksaan itu berjalan di CI pada setiap push. Yang TIDAK diperiksa adalah
bentuk muatannya — itu menuntut server yang berjalan, dan pemeriksaan yang
mengaku lebih daripada yang ia lakukan lebih buruk daripada tidak ada.

## Empat hal yang paling sering salah dipahami

**1. Urutan kedatangan bukan urutan kejadian.** Aplikasi kasir offline-first.
Transaksi bertanggal kemarin bisa tiba sesudah transaksi hari ini. Pakai
`createdAt` dari muatan, jangan waktu penerimaan.

**2. Kiriman ganda itu normal.** Jaringan buruk membuat aplikasi mengulang
kiriman yang sebenarnya berhasil. Jawaban `replayed: true` bukan kesalahan;
jangan tampilkan sebagai kegagalan ke pengguna.

**3. `baseRevision` pada sinkronisasi katalog wajib disimpan dan dikirim
kembali.** Klien yang selalu mengirim `0` tidak akan pernah bisa memensiunkan
produk — itu memang disengaja, karena perangkat yang tidak tahu isi server
tidak boleh menyimpulkan bahwa yang tidak ia kirim berarti sudah dihapus.

**4. Peran yang dinyatakan klien tidak dipakai untuk otorisasi.** Di terminal
kasir bersama, seluruh staf memakai satu sesi. Pembatalan transaksi karena itu
menuntut PIN manajer, atau bukti `sha256(<pin_hash>:<clientTxnId>)` untuk
pembatalan yang terjadi saat offline.

## Nilai uang

Seluruh nilai uang dalam permintaan adalah **bilangan bulat rupiah**. Rupiah
tidak punya pecahan, dan pecahan mengambang hanya menghasilkan selisih yang
tidak bisa direkonsiliasi.

Dalam jawaban, kolom yang berasal dari `NUMERIC` PostgreSQL dikirim sebagai
**string** — itu perilaku driver `pg`, dan mengubahnya ke `Number()` tanpa
berpikir adalah cara paling umum kehilangan presisi. Bulatkan, jangan
biarkan mengambang.
