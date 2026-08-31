# Reverse Engineering — New Hope POS

Dokumentasi ini **diturunkan dari kode**, bukan dari niat desain. Setiap klaim
di dalamnya ditelusuri ke `berkas:baris` yang bisa diperiksa ulang, dan setiap
angka dihasilkan oleh skrip yang disertakan — bukan diketik manual.

Dibuat dengan empat teknik yang saling melengkapi:

| Teknik | Yang dihasilkan | Dokumen |
|---|---|---|
| **Reverse Engineering** (code-to-doc) | Spesifikasi sistem yang direkonstruksi dari implementasi | [01](01-arsitektur.md), [04](04-model-data.md) |
| **Static Code Analysis** | Peta modul, graf dependensi, metrik, kode mati | [02](02-analisis-statis.md) |
| **Automated Code Visualization** | Call graph, DFD, flowchart, state machine | [03](03-alur-proses.md) |
| **Codebase Auditing & Architecture Discovery** | Pola desain, celah keamanan, drift dokumentasi | [05](05-audit-temuan.md) |
| **Pelaksanaan perbaikan** | Apa yang diperbaiki, buktinya, dan apa yang sengaja ditunda | [06](06-perbaikan.md) |
| **Kesiapan produksi** | 15 area operasional POS — idempotensi, konkurensi, ACID, RBAC, peripheral, beban | [07](07-kesiapan-produksi.md) |
| **Penutupan** | Apa yang diperbaiki, dengan buktinya — termasuk empat cacat yang baru ketahuan saat alat ujinya dijalankan | [08](08-penutupan.md) |

---

## Ringkasan eksekutif

New Hope POS adalah **POS multi-sektor SaaS** (F&B, Laundry, Ritel, Carwash,
Barbershop) berbasis **lima microservice Node/Express** di atas satu PostgreSQL
dengan skema terpisah per domain, ditambah **SPA React 19** yang bersifat
*offline-first*.

**57.332 baris** kode sumber (di luar `node_modules` dan `supabase-setup.sql`),
tersebar di 162 berkas TypeScript/JavaScript dan 35 migrasi SQL saat analisis ditulis
(kini 45 — perbaikan menambahkan sepuluh migrasi, 0037 sampai 0046).

### Yang ditemukan sehat

- Batas transaksional pada jalur sinkronisasi dirancang berlapis dan benar:
  idempotensi tingkat batch (`sync_receipts`), tingkat baris
  (`UNIQUE (tenant_id, client_txn_id)`), dan pengurangan stok atomik lewat
  trigger — bukan *read-then-write* di aplikasi.
- Tidak ada interpolasi string ke SQL di jalur produksi, tidak ada
  `dangerouslySetInnerHTML`, tidak ada `eval`, tidak ada kunci API ter-hardcode.
- `tsc --noEmit` bersih (0 error) dan gerbang higiene sumber repo lolos penuh.
- Circuit breaker, correlation ID, pemisahan liveness/readiness, dan graceful
  shutdown diterapkan konsisten di kerangka service bersama.

### Yang perlu perhatian

> **Status: sudah diperbaiki.** 20 dari 21 temuan selesai dan diverifikasi;
> satu ditunda dengan alasan. Enam temuan tambahan (T-16…T-21) baru muncul
> ketika perbaikannya diuji dengan menjalankan sistemnya — tidak satu pun
> terlihat dari pembacaan kode. Lihat [06-perbaikan.md](06-perbaikan.md).
>
> Pemeriksaan kesiapan produksi ([07](07-kesiapan-produksi.md)) menambahkan
> lapisan berikutnya, dan **empat cacat terparah di seluruh pekerjaan ini baru
> muncul ketika alat ujinya sendiri dijalankan** — di antaranya riwayat
> penjualan yang terhapus pada setiap muat ulang halaman, dan satu kueri gagal
> yang mematikan seluruh pos-service beserta setiap kasir yang tersambung.
> Rinciannya dengan bukti ada di [08-penutupan.md](08-penutupan.md).
>
> Tabel di bawah menggambarkan keadaan **sebelum** perbaikan, dan sengaja
> dipertahankan apa adanya sebagai catatan temuan.

Enam temuan berdampak tertinggi dari **15 yang tercatat saat itu**, diurutkan
menurut dampak — register lengkapnya di [05-audit-temuan.md](05-audit-temuan.md):

| # | Temuan | Dampak |
|---|---|---|
| **T-01** | Konsol back-office berjalan **100% di atas data fiktif**; API `/api/admin/*` yang lengkap dan ber-RBAC tidak pernah dipanggil | 🔴 Kritis |
| **T-09** | **Split-brain foreign key**: FK langganan, faktur, keanggotaan, dan kredit AI masih menunjuk `pos.tenants` yang ditinggalkan, sementara tenant baru hanya dibuat di `internal.tenants` | 🔴 Kritis |
| **T-02** | Isolasi peran database (`svc_pos`, `svc_ai`, …) **dibuat tapi tidak pernah dipakai** — kelima service login dengan kredensial yang sama | 🟠 Tinggi |
| **T-03** | `resolveCashier()` membuat baris `internal.users` baru pada **setiap** batch sinkronisasi | 🟠 Tinggi |
| **T-04** | Verifikasi tanda tangan webhook DOKU hanya ditegakkan bila `NODE_ENV === 'production'` | 🟠 Tinggi |
| **T-05** | `npm run smoke` — regresi 47 intent yang diiklankan README — **crash** sebelum menjalankan satu pun intent | 🟡 Sedang |

T-09 dan T-03 layak didahulukan: keduanya merusak data secara **akumulatif**,
sementara sisanya adalah keadaan statis yang tidak memburuk sambil menunggu.

---

## Cara memverifikasi ulang

Analisis ini tidak menuntut kepercayaan. Setiap angka bisa dihitung ulang:

```bash
# Graf dependensi antar-modul, fan-in/fan-out, kandidat kode mati
node docs/reverse-engineering/tools/depgraph.mjs

# Rekonsiliasi endpoint: panggilan frontend vs handler backend
node docs/reverse-engineering/tools/endpoint-map.mjs

# Gerbang higiene + type-check yang dipakai repo sendiri
npm run lint

# Regresi 47 intent AI Copilot
npm run smoke

# Sebelas probe kesiapan produksi (butuh database + pos-service menyala)
npm run audit:prod

# Probe menerima DATABASE_URL, jadi ia bisa diarahkan ke PostgreSQL SUNGGUHAN —
# bukan hanya PGlite pengembangan. Itu jalur yang dipakai job CI `postgres`,
# dan angkanya jauh berbeda: 174 permintaan/detik dengan p95 140 ms, dibanding
# 91/detik dan p95 234 ms di PGlite.
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run audit:prod

# Tiga uji peramban: jalur kasir, ketahanan muat ulang, profil memori
npm run e2e
```

Diagram ditulis dalam Mermaid dan dirender langsung oleh GitHub.

---

## Batas analisis

> **Dua dari tiga batas di bawah sudah TIDAK berlaku lagi.** Dipertahankan
> dengan koreksinya, bukan dihapus: batas yang pernah berlaku menjelaskan
> kenapa sebagian temuan baru muncul belakangan, dan menghapusnya membuat
> dokumen ini terbaca seolah semuanya terlihat sejak awal.

- ~~**Tidak ada eksekusi runtime.**~~ **Sudah tidak berlaku.** Sistemnya
  dijalankan, dan justru di situ empat cacat paling parah ditemukan — termasuk
  satu yang menghapus riwayat penjualan pada setiap muat ulang halaman, dan
  satu yang membuat satu kueri gagal mematikan seluruh pos-service. Tidak satu
  pun terlihat dari pembacaan kode. Lihat [08-penutupan.md](08-penutupan.md).
- ~~**Migrasi tidak dijalankan.**~~ **Sudah tidak berlaku.** Seluruh migrasi
  dijalankan dari database kosong, dan bentuk skema kini diperiksa terhadap
  `information_schema` yang hidup. Menjalankannya sendiri sudah menemukan dua
  cacat: entri duplikat yang membuat migrasi gagal dari nol, dan bawaan
  kebijakan stok yang tidak berlaku untuk merchant baru.
- **`supabase-setup.sql` (340 KB) tetap tidak dianalisis baris demi baris** —
  berkas itu dump gabungan, bukan sumber kebenaran migrasi. Batas ini masih
  berlaku.
- Kualitas UI/UX, aksesibilitas, dan performa render React di luar cakupan.
