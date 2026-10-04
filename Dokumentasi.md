# 📖 Dokumentasi Arsitektur Resmi — New Hope POS

Dokumentasi arsitektur sistem, hirarki multi-tenant (Model B), otentikasi & step-up otorisasi, tata kelola keamanan berlapis (*Defense-in-Depth*), dan aturan emas integritas data (*Golden Rule*).

> **Cara membaca dokumen ini.** Setiap bagian ditandai **[Berjalan]** bila sudah diterapkan di kode, atau **[Rencana]** bila masih arah desain. Revisi 2026-10-04 meluruskan bagian yang sebelumnya menggambarkan rencana seolah sudah berjalan: alur QRIS, step-up PIN, dan alur sinkronisasi.

---

## 🌟 Aturan Emas Arsitektur New Hope POS (*The Golden Rule*)

> ### *"A service may consume another domain's data, but it never becomes the owner of that domain's entity."*
>
> 1. **AI membaca data Transaksi** ➔ AI **TIDAK** memiliki entitas Transaksi.
> 2. **Backoffice membaca data Langganan** ➔ Backoffice **TIDAK** memiliki entitas Langganan.
> 3. **Billing mengetahui entitas Tenant** ➔ Billing **TIDAK** memiliki entitas Tenant.
> 4. **POS menggunakan akun Kasir/Staf** ➔ POS **TIDAK** memiliki entitas Pengguna/User.
> 5. **Backoffice adalah Konsumer/Orkestrator UI** ➔ Backoffice **TIDAK** memiliki skema database tersendiri.

---

## 1. Prinsip Arsitektur: Clean Multi-Schema & Multi-Tier Isolation

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                               │
│        Web POS Terminal (React)  │  Admin Backoffice (React)           │
│        Offline-first Cache       │  Analytics Dashboard (berkala)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY TIER                              │
│   Reverse Proxy │ SSL Termination │ Rate Limiting │ Request Routing    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│           AUTHENTICATION, CONTEXT & STEP-UP AUTHORIZATION              │
│   1. AUTHENTICATION     : Supabase Session Token & Actor Identity      │
│   2. CONTEXT RESOLUTION : User ➔ Tenant ➔ Merchant ➔ Outlet ➔ Role     │
│   3. STEP-UP AUTH (PIN) : Manager PIN for High-Risk (VOID/Refund)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         BUSINESS SERVICE LAYER                         │
│   ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐ │
│   │ pos-service  │  │billing-serv. │  │ ai-service  │  │ Backoffice  │ │
│   │(Catalog,Order│  │(Subscription │  │ (Credits &  │  │(Consumer &  │ │
│   │Txn & Invent.)│  │ & Invoices)  │  │  Insights)  │  │Orchestrator)│ │
│   └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘ │
└──────────┼─────────────────┼─────────────────┼────────────────┼────────┘
           │                 │                 │                │
           ▼                 ▼                 ▼                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL DATABASE TIER                        │
│                                                                        │
│  ┌─────────────────────────┐  ┌─────────────────────────┐              │
│  │ [internal]              │  │ [pos]                   │              │
│  │ (Platform Plane)        │  │ (Store Operations)      │              │
│  ├─────────────────────────┤  ├─────────────────────────┤              │
│  │ • tenants (Holding/Corp)│  │ • products (Master Data)│              │
│  │ • merchants (Brand/Unit)│  │ • ingredients (Master)  │              │
│  │ • outlets (Store Branch)│  │ • product_recipes (BOM) │              │
│  │ • users (Global ID 1:1) │  │ • inventory_locations   │              │
│  │ • memberships (RBAC/PIN)│  │ • inventory_balances    │              │
│  │ • audit_logs (Platform) │  │ • inventory_logs (Audit)│              │
│  │ • business_targets      │  │ • transactions          │              │
│  │ • feature_usage (Telem.)│  │ • transaction_items     │              │
│  │ • access_log (Operator) │  │ • sync_receipts         │              │
│  │ • health_logs           │  └────────────┬────────────┘              │
│  └────────────┬────────────┘               │                           │
│               │                            │                           │
│               ├────────────────────────────┤                           │
│               ▼                            ▼                           │
│  ┌─────────────────────────┐  ┌─────────────────────────┐              │
│  │ [billing]               │  │ [ai]                    │              │
│  │ (SaaS Monetization)     │  │ (Intelligence)          │              │
│  ├─────────────────────────┤  ├─────────────────────────┤              │
│  │ • plans                 │  │ • merchant_ai_credits   │              │
│  │ • subscriptions         │  │ • daily_merchant_insight│              │
│  │ • invoices              │  │ • query_logs            │              │
│  │ • webhook_logs          │  └─────────────────────────┘              │
│  └─────────────────────────┘                                           │
│                                                                        │
│  ────────────────────────────────────────────────────────────────────  │
│  [contract] (Single Source of Truth Cross-Domain Read Surface)         │
│  • tenant_directory     • merchant_directory   • outlet_directory      │
│  • merchant_revenue     • merchant_staff       • catalog               │
│  • stock_status         • inventory_movements  • transaction_log       │
│  • subscription_status  • sector_summary       • business_targets      │
│  • activity_log (Platform Audit Stream)                                │
│                                                                        │
│  ────────────────────────────────────────────────────────────────────  │
│  [PostgreSQL RLS Enforcement] (Database-Level Authorization Filter)    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Model B: Enterprise Multi-Tier Hierarchy (Tenant ➔ Merchant ➔ Outlet)

Struktur data New Hope POS dirancang untuk mendukung ekspansi bisnis dari 1 toko hingga holding multi-brand dan multi-cabang:

```
┌────────────────────────────────────────────────────────────────────────┐
│                TINGKAT 1: TENANT (internal.tenants)                    │
│      Holding Company / Enterprise Account / Pelanggan SaaS Billing     │
│      Contoh: "PT Boga Maju Bersama"                                    │
│      • Memiliki Paket Langganan SaaS (billing.subscriptions)           │
│      • Memiliki Faktur Tagihan (billing.invoices)                      │
│      • Memiliki Kuota AI Platform (ai.merchant_ai_credits)             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 1 : N
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               TINGKAT 2: MERCHANT (internal.merchants)                 │
│         Brand / Business Unit / Lini Bisnis per Sektor Usaha           │
│         Contoh: "Kopi Senja (F&B)"  &  "Laundry Bersih (Laundry)"      │
│         • Memiliki Katalog Produk & Resep BOM                          │
│         • Memiliki Target Omzet Bulanan (internal.business_targets)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 1 : N
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                TINGKAT 3: OUTLET (internal.outlets)                    │
│             Cabang Toko Fisik / Terminal Kasir Geofenced               │
│             Contoh: "Cabang Senayan"  &  "Cabang Sudirman"             │
│             • Memiliki Kasir & Terminal POS Aktif                      │
│             • Memiliki Gudang Stok & Mutasi Bahan Baku Fisik           │
│             • Menghasilkan Transaksi Penjualan & Struk                 │
└────────────────────────────────────────────────────────────────────────┘
```

### Relasi Multi-Tenant RBAC & Keanggotaan Staf (`internal.memberships`)

- **`internal.users`**: 1 Manusia = 1 User ID global (Email, Nama, Avatar).
- **`internal.memberships`**:
  - User A dapat menjadi **Owner** di tingkat Tenant (mengakses semua merchant dan outlet).
  - User B dapat menjadi **Manager** di Merchant "Kopi Senja" (mengakses cabang Senayan & Sudirman).
  - User C dapat menjadi **Cashier** di Outlet "Cabang Senayan" dengan PIN Kios `1234`.

---

### 📦 2.1 Domain Inventory Multi-Location (Branch-Aware Inventory)

Sistem membedakan secara tegas antara **Master Data Katalog** dengan **Fisik Saldo Stok Per Cabang**:

```
[MASTER DATA BRAND (Merchant-Scoped)]
pos.products          : Definisi produk, SKU, kategori, harga jual, harga pokok
pos.ingredients       : Definisi bahan baku mentah (biji kopi, susu, deterjen)
pos.product_recipes   : Bill of Materials (BOM) per porsi produk
        │
        ▼ (Diturunkan ke masing-masing cabang)
[PHYSICAL INVENTORY (Outlet-Scoped)]
pos.inventory_locations : Titik gudang per cabang (Gudang Utama, Dapur, Rak Display)
pos.inventory_balances  : Saldo stok riil per (outlet_id, location_id, item_id)
pos.inventory_logs      : Audit mutasi riil per (outlet_id, transaction_id, type)
```

- **Contoh Kasus**: Kopi Susu Gula Aren memiliki stok di **Cabang Senayan = 20 cup** dan **Cabang Sudirman = 50 cup**.
- Data saldo fisik tersimpan terisolasi di `pos.inventory_balances`, bukan di tabel global `pos.products.stock`.
- Konsumen lintas domain membaca kondisi stok melalui view `contract.stock_status`.

---

### 🧬 2.2 Multi-Level Recursive Bill of Materials (BOM) & Semi-Finished Items

Sistem mendukung struktur pohon resep bertingkat (*Recursive Multi-Level BOM*) untuk mengelola bahan mentah, olahan antara (*prep/semi-finished*), dan produk jadi:

```
[Level 1: FINISHED GOOD]
Es Kopi Latte (1 porsi)
 ├── 60 ml Espresso Base Shot (SEMI_FINISHED) ──────────────┐
 ├── 150 ml Susu Segar (RAW_MATERIAL)                       │
 ├── 20 ml Simple Syrup Gula Aren (SEMI_FINISHED) ──┐       │
 └── 1 pcs Paper Cup 12oz (PACKAGING)               │       │
                                                    │       ▼
                                                    │ [Level 2: SEMI_FINISHED]
                                                    │ Batch Espresso 1000 ml
                                                    │  ├── 250 gr Roasted Coffee Beans (SEMI_FINISHED) ──┐
                                                    │  └── 1200 ml Air RO Terfiltrasi (RAW_MATERIAL)     │
                                                    ▼                                                    │
                                  [Level 2: SEMI_FINISHED]                                               │
                                  Batch Simple Syrup 5000 ml                                             ▼
                                   ├── 3 kg Gula Aren Batok (RAW_MATERIAL)             [Level 3: RAW MATERIAL]
                                   └── 3000 ml Air Panas (RAW_MATERIAL)                Roasted Coffee Beans 1000 gr
                                                                                        ├── 600 gr Green Bean Arabica
                                                                                        └── 400 gr Green Bean Robusta
```

- **`pos.recipes`**: Menyimpan formula header untuk *Finished Goods* maupun *Semi-Finished Preps*.
- **`pos.recipe_items`**: Menghubungkan input item (bahan mentah maupun olahan setengah jadi) secara rekursif.
- **`contract.bom_explosion`**: PostgreSQL Recursive CTE yang otomatis mengurai kebutuhan bahan baku riil dari level teratas hingga bahan mentah dasar.

---

### ☕ 2.3 Varian Produk, Modifier BOM, & Snapshot Transaksi Historis

Sistem menjamin integritas finansial dan pemotongan stok bahan baku melalui snapshot data pesanan:

```
[TRANSAKSI PENJUALAN]
Item: Latte (Variant: Large, Rp 32.000)
 ├── Base Product Snapshot   : product_name = "Latte", unit_price = 28000, unit_cost = 6500
 ├── Variant Snapshot        : variant_name = "Large", price_adj = +4000, cost_adj = +1200
 └── Selected Modifiers BOM  :
      ├── Extra Shot (+Rp 5.000, HPP: Rp 1.500) ➔ Potong 8g Biji Kopi di pos.inventory_balances
      └── Oat Milk Swap (+Rp 6.000, HPP: Rp 2.200) ➔ Potong 150ml Susu Oat di pos.inventory_balances
```

- **Modifier BOM (`pos.modifier_recipes`)**: Menghubungkan setiap add-on/opsi ke bahan baku mentah terkait, sehingga saat *Extra Shot* terjual, stok biji kopi otomatis terpotong.
- **Immutable Price & Cost Snapshots (`pos.transaction_items`)**:
  - Menyimpan permanen `product_name_snapshot`, `variant_name_snapshot`, `unit_price`, `unit_cost`, dan `modifier_snapshot`.
  - Jika harga menu dinaikkan di masa depan, laporan keuangan transaksi lampau tetap akurat dan tidak berubah.
- **Kontrak Detail Transaksi (`contract.transaction_items_detailed`)**:
  - Menyediakan single source of truth untuk analisis laba kotor riil per varian dan modifier.

---

### 💳 2.4 Pemisahan Daur Hidup Pesanan (Order) vs Pembayaran (Payment) — [Berjalan]

Pesanan dan pembayaran adalah dua daur hidup terpisah, sehingga *split payment*, *multi-tender*, dan pembayaran sebagian bisa dicatat tanpa mengubah pesanannya.

```
┌────────────────────────────────────────────────────────┐
│             ORDER LIFECYCLE (pos.transactions)         │
│   OPEN ➔ PENDING_PAYMENT ➔ COMPLETED                   │
│   (Batal: CANCELLED / VOIDED; refund = baris terpisah) │
└───────────────────────────┬────────────────────────────┘
                            │ 1 : N
                            ▼
┌────────────────────────────────────────────────────────┐
│             PAYMENT LIFECYCLE (pos.payments)           │
│   PENDING ➔ PAID / SETTLED                             │
│   (REFUNDED saat void)                                 │
└────────────────────────────────────────────────────────┘
```

Omzet yang diakui (`contract.merchant_revenue`) hanya menghitung pesanan COMPLETED/SETTLED yang **tertutup penuh** oleh pembayaran PAID/SETTLED, dikurangi refund append-only. Void dan cancel tidak dihitung.

#### Pembayaran di kasir — [Berjalan]
Tunai, **QRIS statis toko**, kartu (EDC), dan transfer **dicatat oleh kasir**. Belum ada integrasi payment gateway untuk transaksi kasir:
1. Kasir memilih metode, lalu menerima pembayaran dari pelanggan (scan QR toko / EDC / tunai).
2. Kasir menekan **Konfirmasi Pembayaran**. Penjualan disimpan dulu di antrean perangkat (offline-first), lalu struk tampil.
3. Antrean dikirim ke `POST /api/v1/sync/transactions`. Server membuat `pos.transactions`, `pos.payments`, dan entri `pos.cash_ledger` (untuk tunai) dalam satu transaksi database.

Artinya status lunas untuk QRIS/EDC **adalah konfirmasi kasir**. Nomor referensi (RRN) bisa diisi manual sebagai bukti.

#### QRIS dinamis + webhook — [Rencana]
Alur di mana backend membuat QRIS dinamis dan status PAID ditentukan oleh webhook payment gateway (kasir tidak bisa menandai lunas sendiri) **belum dibangun**. Bila dibangun, pola yang wajib dipakai sama dengan webhook DOKU langganan: verifikasi tanda tangan dari byte asli, idempotensi per event, dan rekonsiliasi ke ledger.

#### Langganan SaaS (DOKU Checkout) — [Berjalan]
1. `POST /api/v1/subscription/checkout`: invoice disimpan **sebelum** memanggil DOKU (kunci idempotensi `requestKey`), lalu pengguna diarahkan ke halaman DOKU.
2. DOKU mengirim `POST /api/v1/webhooks/doku`. Tanda tangan diverifikasi dari **byte asli** request, lalu channel dicocokkan dengan `DOKU_ALLOWED_CHANNELS`, nominal dengan invoice, dan revisi langganan dengan quote. Hasilnya `APPLIED` atau `REVIEW` (ditinjau support).
3. `GET /api/v1/subscription/verify` hanya melaporkan lunas bila ledger benar-benar `APPLIED`.

Di Vercel seluruh rute ini dilayani `src/server/billingHandler.ts` → `services/billing`. Tidak ada endpoint simulasi pembayaran.

- **VOID vs status pembayaran**: VOID adalah peristiwa daur hidup pesanan, bukan status pembayaran. VOID memindahkan pesanan ke VOIDED, membalik kas dengan entri `VOID` (bukan menghapus), dan menandai pembayaran REFUNDED.

---

## 3. Otentikasi vs Step-Up Otorisasi (PIN Supervisor)

**[Berjalan] Di perangkat kasir:**
```
Pengguna login (Supabase Auth: owner; PIN: staf di perangkat)
        │
        ▼
Aksi berisiko (VOID / refund / diskon khusus)
        │
        ▼
Cek izin peran di klien (mis. 'void_order')
        │ tidak punya izin
        ▼
PIN supervisor dimasukkan di perangkat (hash sha256 + salt; kunci bertahap 30 dtk → 5 mnt setelah 3 kali gagal)
        │
        ▼
Aksi dijalankan; percobaan gagal dicatat di log perangkat
```

**Batasan saat ini:** override PIN ditegakkan **di klien**. Server menerima VOID dari principal pemilik akun tanpa bukti persetujuan supervisor, dan jejak persetujuan belum dikirim ke `internal.audit_logs`.

**[Rencana]** Persetujuan supervisor sebagai *grant* berumur pendek yang diverifikasi server, dicatat di `internal.audit_logs` dengan aktor kasir + approver.

---

## 4. Keamanan Berlapis (*Defense-in-Depth Chain*)

```
1. USER                    : Permintaan dari browser kasir / konsol admin
    ↓
2. AUTHENTICATION          : Token Supabase diverifikasi ke Auth API (GET /auth/v1/user), bukan payload JWT
    ↓
3. BOUNDARY                : Allowlist path+method; header identitas dari browser dibuang;
                             request anonim ditolak sebelum koneksi database dibuka
    ↓
4. CONTEXT RESOLUTION      : Tenant/merchant/outlet diturunkan di SQL dari kepemilikan principal
                             (ID dari browser tidak dipercaya)
    ↓
5. SERVICE AUTHORIZATION   : Admin: keanggotaan internal_users + kapabilitas peran + MFA (aal2)
                             untuk aksi sensitif. Merchant: hak paket (Free/Trial/berbayar)
    ↓
6. DB ROLE ISOLATION       : svc_pos, svc_billing, svc_ai, svc_internal (lintas domain hanya lewat contract.*)
    ↓
7. TENANT CONTEXT (RLS)    : app.tenant_id / app.merchant_id di-set per transaksi pada jalur state,
                             laporan dan sync; browser tidak punya akses SQL langsung
    ↓
8. BATAS WAKTU             : statement_timeout per transaksi & per peran (8 dtk)
```

Step-up PIN supervisor ada di lapisan klien. Lihat batasannya di bagian 3.

---

## 5. Perbedaan Eksplisit Log Audit

| Kategori | Tabel | Isi Data | Tujuan |
|---|---|---|---|
| **Operator Access Log** | `internal.internal_access_log` | **WHO accessed WHAT** (`internal_user_id`, `internal_role`, `target_id`, `action`, `resource`, `justification`, `request_id`) | Audit kepatuhan operator backoffice/support saat mengakses data merchant. |
| **AI LLM Query Log** | `ai.ai_query_logs` | **WHAT AI request happened** (intent, model, token, latensi, kredit) | Audit teknis model AI dan konsumsi kredit. |
| **Business Event Audit** | `internal.audit_logs` | Peristiwa bisnis (`SYNC_BATCH`, `TRANSACTION_VOID`, perubahan paket, dll.) | Jejak audit bisnis yang dibaca admin. |
| **Product Telemetry** | `feature_usage_events` | Metrik adopsi fitur | Analisis produk (bukan dasar penagihan). |

---

## 6. Aliran Data Transaksi Kasir (End-to-End Flow) — [Berjalan]

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Kasir (Terminal Outlet)
    participant Local as Antrean perangkat (localStorage)
    participant API as Boundary API (gateway / Vercel)
    participant POS as pos-service
    participant DB as PostgreSQL (pos, internal, contract)
    actor Admin as Laporan / Admin / AI

    Cashier->>Local: Konfirmasi pembayaran (tersimpan dulu di perangkat)
    Local->>API: POST /api/v1/sync/transactions (≤200 penjualan + idempotencyKey)
    API->>API: Verifikasi token, buang header palsu
    API->>POS: Principal terverifikasi

    rect rgb(240, 248, 255)
        Note over POS, DB: Satu transaksi database; SAVEPOINT per penjualan
        POS->>DB: Replay? baca pos.sync_receipts (hasil per penjualan disimpan)
        loop setiap penjualan
            POS->>DB: INSERT pos.transactions (ON CONFLICT client_txn_id = duplikat aman)
            POS->>DB: INSERT pos.payments, pos.cash_ledger, pos.transaction_items
            POS->>DB: Potong stok server hanya untuk produk yang terhubung inventory item
            Note right of POS: Gagal deterministik → rejected[] (penjualan lain tetap masuk).<br/>Nomor struk bentrok → renumbered[]
        end
        POS->>DB: INSERT internal.audit_logs (SYNC_BATCH), pos.sync_receipts
    end

    POS-->>Local: { accepted, duplicates, rejected[], renumbered[] }
    Local->>Local: Hapus yang terkirim; pindahkan rejected ke karantina (Sync Center)

    Admin->>DB: contract.merchant_revenue (satu definisi omzet untuk laporan, admin, AI)
```

**Stok produk di kasir** saat ini adalah *state operasional* (`/api/v1/sync/state`, revisi per produk), bukan ledger delta di server. Konsekuensinya:
- Stok boleh minus (penjualan tidak diblokir; kasir diberi peringatan) agar selisih fisik terlihat dan bisa direkonsiliasi.
- Void mengembalikan hanya qty yang belum di-refund.
- Dua perangkat yang menjual produk yang sama bersamaan bisa memicu konflik revisi yang diselesaikan di Sync Center.

**[Rencana]** Stok sebagai ledger delta di server (`pos.inventory_transactions` sudah ada untuk produk yang terhubung inventory item) untuk semua produk.
