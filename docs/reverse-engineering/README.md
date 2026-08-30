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

---

## Ringkasan eksekutif

New Hope POS adalah **POS multi-sektor SaaS** (F&B, Laundry, Ritel, Carwash,
Barbershop) berbasis **lima microservice Node/Express** di atas satu PostgreSQL
dengan skema terpisah per domain, ditambah **SPA React 19** yang bersifat
*offline-first*.

**57.332 baris** kode sumber (di luar `node_modules` dan `supabase-setup.sql`),
tersebar di 162 berkas TypeScript/JavaScript dan 35 migrasi SQL.

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
```

Diagram ditulis dalam Mermaid dan dirender langsung oleh GitHub.

---

## Batas analisis

Yang **tidak** dicakup, dan alasannya:

- **Tidak ada eksekusi runtime.** Analisis bersifat statis; perilaku yang hanya
  muncul di bawah beban nyata (deadlock, race pada koneksi pool) tidak diuji.
- **Migrasi tidak dijalankan.** Bentuk skema direkonstruksi dari DDL di
  `migrations/`, bukan dari `information_schema` basis data hidup.
- **`supabase-setup.sql` (340 KB) tidak dianalisis baris demi baris** — berkas
  itu adalah dump gabungan, bukan sumber kebenaran migrasi.
- Kualitas UI/UX, aksesibilitas, dan performa render React di luar cakupan.
