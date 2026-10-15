# Keputusan rilis PR #21 — NO-GO

Kelanjutan dari `ee7e6fc2fe45091053765286ae56ebe6a4726d4c`.
Bukti staging yang sudah PASS digunakan kembali, tanpa mengulang tujuh mapping,
restore baseline, email, audit atau pengujian aplikasi lama. Tidak ada perubahan
aplikasi/database/environment produksi. Tidak ada email, pembayaran, penghapusan
customer atau aktivasi tiga akun. Perubahan pada paket ini adalah tooling operator,
pengujian guard baru dan bukti checkpoint read-only.

## Hasil terbaru

Checkpoint konsisten sumber **15 Oktober 2026 18:59:53 WIB** membaca fingerprint
125 tabel tanpa mengembalikan record pelanggan. Dibanding capture 17:16:16 WIB,
123 tabel tidak berubah; `billing.plans` berubah isi (tetap enam baris) dan audit
blog naik 42 → 43. Ini membuktikan kandidat belum memuat delta akhir. Sumber masih
aktif; checkpoint ini **bukan** snapshot cutover yang dibekukan atau backup baru.
[Checkpoint](evidence/release-source-checkpoint-2026-10-15.json) dan
[delta](evidence/release-source-delta-2026-10-15.json).

Delapan transaksi dan delapan pembayaran tetap Rp747.000; cash ledger 11 baris
Rp653.000; refund nol; subscription sepuluh. Duplikasi key transaksi
`(tenant_id,client_txn_id)` dan pembayaran `(transaction_id,client_payment_id)` nol.
Tabel webhook billing, event billing dan reconciliation POS masing-masing nol;
ini hanya isi database, bukan bukti antrean/retry DOKU eksternal kosong.

## Recovery dan escrow yang siap dijalankan

Arsip terenkripsi Drive dan checksum readback sebelumnya tetap dipakai. Tidak
ada arsip pelanggan baru. Paket private key ber-passphrase telah dibuat lokal;
fingerprint cocok dan salah passphrase ditolak. **Paket lokal bukan escrow
independen.** File paket/key/password/MFA tidak masuk GitHub.

Owner belum punya password manager. Di folder `outputs` lokal tersedia
`PR21-private-escrow-key.asc` dan `PR21-private-escrow-passphrase.txt` (mode 600).
Simpan key terenkripsi pada media/password manager terpisah dari Drive backup;
simpan passphrase pada penyimpanan terpisah dari paket key. Jangan unggah keduanya
ke folder backup yang sama. Setelah mengimpor, ekspor key kembali dari tempat
custody itu ke file privat di luar checkout, lalu jalankan:

```sh
node scripts/neon/escrow-key.mjs verify --recovered-key /absolute/private/recovered-key.asc --custody-ref owner-vault-item-reference
```

Passphrase diminta tersembunyi pada terminal. Script memeriksa fingerprint dan
mendekripsi arsip Drive dalam RAM. Tidak menulis plaintext, tidak mencetak key,
dan tidak menganggap acceptance independen selesai hanya karena dekripsi lulus.
Jangan menguji dengan menyalin paket lokal lalu menyebutnya escrow independen.
Pembuatan ulang paket menolak overwrite. `prepare --passphrase-file` hanya untuk
input privat mode 600, bukan passphrase dalam argument command line.

Konfigurasi service lokal telah disiapkan di
`build/neon/private-supabase-recovery/compose.json`: Postgres 17, GoTrue,
port 54322/59999 hanya 127.0.0.1, jaringan internal, PGDATA tmpfs, tanpa kredensial
SMTP eksternal, signup umum dan telepon mati. Konfigurasi diturunkan dari commit
Supabase resmi `564eab8ad7840b13324f68b1bfac074ef8d51c21`, image Postgres
`17.6.1.136` dan GoTrue `v2.196.0`; sumber PG `17.6.1.155`. Kesamaan major PG
bukan bukti kompatibilitas schema Auth: wajib bandingkan sebelum restore.
Service/config ini belum berhasil dijalankan karena Docker belum ada.
Ini runtime recovery DB/Auth minimal, bukan stack Storage/Realtime/Edge lengkap.

**Langkah Mac yang wajib dan paling singkat:**

1. Mac ini Apple silicon (`arm64`). Instal [Docker Desktop resmi](https://docs.docker.com/desktop/setup/install/mac-install/),
   pindahkan ke Applications, buka dan selesaikan persetujuan vendor sendiri;
   tunggu Running. Tidak ada resource cloud berbayar yang dibuat.
2. Template `.env.supabase-source.local` sudah dibuat mode 600. Dari project sumber
   Supabase → **Connect** → direct atau **Session pooler**, masukkan credential
   native yang sudah sah ke file tersebut secara lokal. Jangan gunakan pooler
   transaksi, menempel secret di chat, atau mereset password DB produksi.
   Placeholder sengaja tidak dihitung sebagai akses yang tersedia.
3. Jalankan `node scripts/neon/recovery-preflight.mjs`. Setelah Docker tersedia,
   `node scripts/neon/recovery-runtime.mjs validate`, kemudian `start` dan `health`.
   Runner memvalidasi isolasi sebelum start. Health bukan bukti restore.

Setelah runtime/native access tersedia, operator melanjutkan
[prosedur recovery penuh](independent-backup-recovery.md): bandingkan auth schema,
role/extension/constraint, restore secara transaksional pada target terisolasi,
rekonsiliasi seluruh data, lalu uji service dengan **canary recovery**, tanpa
memakai password customer atau mengirim email. Jika arsip logis tidak cukup
untuk role/domain/partition/encryption keys, native export kompatibel Supabase
menjadi kebutuhan baru yang beralasan; jangan mengulang backup yang ada tanpa
mencatat gap tersebut. Ikuti [restore resmi](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
jangan membuang kolom/COPY/customer row agar error hilang. Vault/MFA encryption
roots, provider settings, object bytes dan acceptance operator tetap gate terpisah.

## Tiga akun: jalur pemilik yang dapat dipakai

Paket privat `build/neon/private-identity-recovery/owner-packet.json` berisi
source UUID, konflik destination UUID, dan hubungan tenant/merchant/outlet dari
bukti yang sudah diperiksa. Public key API sumber sudah disiapkan pada file privat
`.env.identity-recovery.local`; bukan service key. Tidak ada tujuh mapping diulang.

Saat pemilik akun hadir, operator menjalankan (ganti N dengan 1, 2 atau 3):

```sh
node scripts/neon/identity-recovery.mjs issue N
node scripts/neon/identity-recovery.mjs claim N
```

Pemilik mengetik email/password sumber sendiri di terminal lokal; password tidak
terlihat atau disimpan. Bila ada faktor TOTP sumber, pemilik memasukkan kode dari
perangkatnya sendiri. Tidak ada email/SMS dikirim. Hanya login/logout sesi sumber
milik claimant yang terjadi, tanpa perubahan business/permission. Sesi sementara
dicabut lokal setelah pemeriksaan. OAuth/phone-only atau password tidak diketahui
harus memakai proses recovery sumber yang sudah sah; jangan membuat password
baru atau memicu email tanpa izin.

Alternatif untuk sesi dari proses sumber yang sah:
`verify N /absolute/private/session.json`, mode 600, hanya field `nonce` challenge
dan `access_token`. Jangan kirim token lewat chat. Challenge berlaku 15 menit,
sekali pakai, terikat hash report, dengan lock lokal untuk menolak penggunaan
bersamaan. Token harus diterima endpoint `/auth/v1/user` sumber yang dipin;
issuer, UUID, expiry, waktu sign-in dan AMR diperiksa. Refresh token lama dan
email sama tidak cukup. MFA sumber wajib dipenuhi bila terpasang.

Hasil PASS hanya membuktikan penguasaan akun sumber. Operator tetap harus
membaca ulang kewenangan tenant/membership terkini. Pada collision, bukti pemilik
canonical UUID yang berbeda wajib terpisah, dengan keputusan scope dan impact
manifest. Tool tidak mempunyai operasi merge, pemindahan ownership atau aktivasi.
Tidak ada claimant nyata yang telah memberikan proof baru pada tahap ini.

**Boleh melanjutkan staging dengan tiga hold. Produksi belum otomatis aman.**
Dua kasus tidak punya hubungan bisnis yang terbukti pada snapshot; mereka tetap
kehilangan login native sampai recovery sah selesai. Kasus collision terkait
satu tenant, empat merchant dan enam outlet: pemilik yang ditahan bisa kehilangan
akses operasional/otorisasi/refund atau bantuan akun. Data/ledger tetap disimpan;
canonical owner sah tidak direassign. Keberadaan staf lain yang dapat beroperasi
belum membuktikan cakupan pengganti memadai. Pengecualian produksi memerlukan
verifikasi seluruh outlet memiliki operator sah alternatif, pemilik menerima
risiko/durasi/support recovery, dan persetujuan exception eksplisit. Tidak ada
waiver tersebut saat ini. Jangan mengganti keputusan ini dengan sekadar “hold”.

## Email dan MFA perangkat owner

Bukti yang sudah ada: DKIM/SPF outbound terverifikasi, feedback MX terverifikasi,
tracking off, DMARC `p=none` ada pada subdomain pengirim. Inbound MX gagal adalah
status penerimaan Resend, bukan bukti DKIM/SPF outbound gagal. Public Preview mail
flag tetap 0. Tepat dua pesan: verifikasi spam, reset inbox; keduanya delivered.
`delivered` tidak menjamin inbox. Penyebab spam belum terbukti tanpa header asli;
jangan mengubah DMARC/DNS, menambah warming mail, atau mengirim ulang sebagai tes.

Pencarian terarah pada Gmail terhubung tidak menemukan dua pesan itu. Owner dapat
mengunduh **Show original/Download original** masing-masing pesan yang sudah ada
ke file `.eml` privat mode 600. `mail-header-review.mjs verification FILE` atau
`reset FILE` mengekstrak hanya hasil SPF/DKIM/DMARC tanpa body/token. Keaslian header
receiver dan alignment perlu ditinjau; parser sendiri bukan attestation provider.

`outputs/PR21-private-owner-mfa.html` adalah halaman lokal tanpa network/script
untuk scan QR dan menyimpan recovery code pada perangkat owner. Kredensial akun
uji ada pada file privat `PR21-private-staging-test-login.txt`. Ini mengimpor
faktor **akun uji staging yang sudah diuji backend**, tanpa memberi izin bisnis,
bukan enrollment produksi baru atau custody independen. Owner scan dengan aplikasi
sendiri, simpan recovery codes terenkripsi, lalu login staging dan masukkan TOTP;
logout/login ulang. Jangan tekan tombol kirim email. Jangan bagikan screenshot QR.
Faktor/kode yang pernah ditangani operator ini tidak boleh dipromosikan sebagai
faktor produksi: enrollment produksi wajib baru pada perangkat pemilik sah.
Custody dan tes perangkat owner masih menunggu tindakan owner, bukan PASS otomatis.

## Cutover dan rollback final

Sebelum window: operator produksi harus menjalankan diagnostic read-only
`production-endpoint-diagnostic.mjs` **dalam environment deployment aktif**, atau
memberikan attested private runtime env. Command memakai TLS terverifikasi,
read-only transaction dan mencetak boolean saja. Copy lokal tidak membuktikan
provenance production. Vercel write-only secret dan health HTTP bukan bukti endpoint.
Kandidat sekarang tetap di luar allowlist cutover. Izin runtime/storage/issuer
produksi dan manifest clean-final baru harus sesuai checkpoint yang disetujui.

Pada window yang kelak disetujui, urutannya:

1. Rekam build SHA, acceptance backup/key, bukti identities/exception, source
   deployment/env rollback, provider config dan inventory semua device/browser.
2. Drain lewat operasi normal yang disetujui; rekam local financial/operational
   queue, quarantine, legacy holds, unsaved checkout dan request in-flight setiap
   profil/perangkat/outlet. Helper read-only `device-checkpoint.mjs` tidak membaca
   token, mengirim, menghapus atau mereplay transaksi. Receipt kosong satu device
   bukan bukti seluruh fleet. Cocokkan key/ACK server sebelum melanjutkan.
3. Rekam export DOKU resmi berisi event ID, payment/invoice reference, nominal,
   currency, timestamp, signature/processing status dan pending retry. Simpan
   privat; cocokkan ke billing/payment/reconciliation tanpa charge atau replay.
   Table DB nol tidak cukup. Siapkan durable callback retention, bukan drop+ACK.
4. Setelah freeze writer eksplisit disetujui: hentikan penulis bisnis/signup/
   scheduler/editorial pada batas yang diketahui, ambil snapshot konsisten/delta
   final dan checkpoint provider. Terapkan delta pada clean-final, bukan fixture;
   tinjau pricing dan audit baru, ownership, finance, ledger, subscription,
   AI wallet, integrasi dan aset. Jangan menghitung pending outbox sebagai omzet.
5. Verifikasi fingerprint sumber/target, kunci idempotency, callback retention,
   issuer dan least privilege. Native customer credentials/MFA tidak dipindah;
   akses recovery pelanggan dan tiga exception harus sudah diterima.
6. Owner menyetujui deployment/window konkret; switch DB/auth/storage serentak,
   verifikasi kedua host dan sektor, kemudian buka tepat satu writer dan replay
   event yang sudah direkonsiliasi sekali. Tidak ada langkah ini dijalankan sekarang.

Sebelum write bisnis Neon pertama: pertahankan freeze, kembalikan deployment/env
Supabase yang direkam, verifikasi auth/data, lalu buka satu writer.

**Setelah write Neon baru:** freeze kedua sisi; pertahankan seluruh Neon delta,
ACK POS, DOKU callbacks, payment/refund/credit/audit dan storage baru. Rekonsiliasi
berdasarkan immutable client/provider ID dan payload hash; konflik nominal,
identity atau invoice wajib ditahan. Replay hanya event yang terbukti belum ada
pada DB authoritative yang dipilih, dengan tenant scope dan idempotency asli;
rekonsiliasi saldo, subscription dan settlement sebelum reopen. Koreksi finansial
menggunakan compensation ledger, bukan overwrite balance atau hapus audit.
Jangan ganti DATABASE_URL saja. Post-write reverse replay belum direhearsal dan
karena itu tetap gate rilis; lihat [rollback](data-rollback.md).

## Downtime: batas bukti pengukuran

Gunakan [receipt waktu](evidence/release-timing-2026-10-15.json), bukan tebakan:
restore business 6,822 dtk; reconcile 7,551; corrective upgrade 7,614; native schema
8,333; restricted LOGIN 2,930; copy 65 aset 16,411; offline auth table drill 1,279.
Checkpoint source roundtrip terbaru 3,664 dtk dan pembanding delta lokal 1,205 dtk.
Ini fase berbeda dengan volume/keadaan berbeda, bukan pengukuran end-to-end.
Drain fleet, provider queue, freeze/delta final, promotion dan rollback sesudah
write belum diukur. **Estimasi downtime produksi belum dapat diberikan secara
bertanggung jawab; tidak ada SLA 5/10/15 menit yang terbukti.** Ukur satu rehearsal
window lengkap setelah dependency terbuka, dari write terakhir sumber yang di-ACK
sampai write pertama target dan verifikasi rekonsiliasi selesai.

Rekomendasi tunggal: **NO-GO produksi**. Paket siap untuk review keputusan rilis,
staging tetap terverifikasi, tetapi mandatory gates di atas belum ditutup.
