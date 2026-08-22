# 📖 Dokumentasi Arsitektur Resmi — New Hope POS

Dokumentasi komprehensif arsitektur sistem, model data domain hirarkis (Model B), aliran data (end-to-end data flow), dan tata kelola keamanan New Hope POS.

---

## 1. Prinsip Arsitektur Utama: Clean Multi-Schema Isolation

Sistem New Hope POS menerapkan **Clean Multi-Schema Architecture** di atas PostgreSQL (Supabase) dengan batas domain yang ditegakkan secara struktural oleh hak akses database.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                               │
│        Web POS Terminal (React)  │  Admin Backoffice (React)           │
│        Offline-first Cache       │  Realtime Analytics Dashboard       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / WSS
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY TIER                              │
│   Reverse Proxy │ SSL Termination │ Rate Limiting │ Request Routing    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  GLOBAL IDENTITY & AUTHENTICATION                      │
│   • Supabase Auth / Session Token Resolution                           │
│   • Global User Plane: internal.users (1 Manusia = 1 User)             │
│   • Multi-Tenant RBAC: internal.memberships (Peran & PIN Kios Toko)    │
│   • Resolve Scope: Tenant ID ➔ Merchant ID ➔ Outlet ID                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         BUSINESS SERVICE LAYER                         │
│   ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐ │
│   │ pos-service  │  │billing-serv. │  │ ai-service  │  │ backoffice  │ │
│   │ (Sync/Catalog│  │(Subscription │  │ (Credits &  │  │(Audit & Org │ │
│   │  & Inventory)│  │ & Invoices)  │  │  Insights)  │  │  Monitoring)│ │
│   └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘ │
└──────────┼─────────────────┼─────────────────┼────────────────┼────────┘
           │                 │                 │                │
           ▼                 ▼                 ▼                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL DATABASE TIER                        │
│                                                                        │
│  [internal] (Platform Plane)  [pos] (Operations)  [billing]  [ai]      │
│  • tenants (Holding / Corp)   • products          • plans    • credits │
│  • merchants (Brand / Unit)   • ingredients       • subs     • insight │
│  • outlets (Physical Branch)  • recipes           • invoices • query   │
│  • users (Global Identity)    • transactions      • webhooks           │
│  • memberships (Tenant RBAC)  • trans_items                            │
│  • audit_logs (Cross-Cutting) • inventory_logs                         │
│  • business_targets                                                    │
│  • feature_usage (Telemetry)                                           │
│  • health_logs                                                         │
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

## 2. Canonical Domain Model: Model B (Multi-Tier Enterprise Hierarchy)

Platform New Hope POS mengadopsi **Model B (Tenant ≠ Merchant ≠ Outlet)** untuk mendukung pertumbuhan bisnis merchant dari single-store hingga enterprise holding company dengan banyak brand dan cabang.

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
│         • Memiliki Target Omzet Bulanan                                │
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

### Diagram Relasi Entitas (ERD Model B)

```mermaid
erDiagram
    TENANTS ||--o{ MERCHANTS : "memiliki brand/unit usaha"
    MERCHANTS ||--o{ OUTLETS : "memiliki cabang fisik"
    TENANTS ||--o{ MEMBERSHIPS : "hak akses akun"
    USERS ||--o{ MEMBERSHIPS : "identitas akun staf"
    TENANTS ||--|| SUBSCRIPTIONS : "memiliki paket SaaS"
    TENANTS ||--|| MERCHANT_AI_CREDITS : "memiliki kuota AI"

    MERCHANTS ||--o{ PRODUCTS : "memiliki katalog produk"
    MERCHANTS ||--o{ INGREDIENTS : "memiliki bahan baku"
    PRODUCTS ||--o{ PRODUCT_RECIPES : "diformulasikan dari"
    INGREDIENTS ||--o{ PRODUCT_RECIPES : "komposisi resep"

    OUTLETS ||--o{ TRANSACTIONS : "lokasi penjualan"
    TRANSACTIONS ||--o{ TRANSACTION_ITEMS : "memuat baris item"
    OUTLETS ||--o{ INVENTORY_LOGS : "mutasi stok fisik"
    TRANSACTIONS ||--o{ INVENTORY_LOGS : "pemicu pengurangan stok"
```

---

## 3. Batas Domain Skema (Multi-Schema Isolation)

| Skema | Service Pemilik | Hak Akses Tulis (Write) | Hak Akses Baca (Read) | Deskripsi |
|---|---|---|---|---|
| `internal` | `backoffice-service` | `svc_internal`, `svc_pos` (sync) | `svc_internal`, Semua Service | **Platform Organization & Identity**: Organisasi Holding (`tenants`), Brand (`merchants`), Cabang (`outlets`), Pengguna (`users`), Hak Akses (`memberships`), dan audit log operator. |
| `pos` | `pos-service` | `svc_pos` | `svc_pos` | **Store Operations**: Inti operasional kasir (katalog produk, resep BOM, transaksi penjualan, dan mutasi stok fisik). Mereferensikan `tenant_id`, `merchant_id`, dan `outlet_id`. |
| `billing` | `billing-service` | `svc_billing` | `svc_billing` | **SaaS Monetization**: Paket langganan SaaS, status tagihan, faktur, dan log webhook. Mereferensikan `tenant_id`. |
| `ai` | `ai-service` | `svc_ai` | `svc_ai` | **AI Intelligence**: Dompet kuota kredit AI, agregasi insight bisnis harian, log kueri LLM. Mereferensikan `tenant_id` dan `merchant_id`. |
| `contract` | *Shared Contract* | Tidak ada (Hanya View) | Semua Service (`svc_*`, `bi_readonly`) | **Satu-satunya antarmuka baca lintas-layanan**. Menjamin angka omzet, staf, dan stok selalu konsisten. |
| `public` | *Platform Public* | `schema_migrations` | `anon`, `authenticated` | Hanya memuat view tersanitasi yang merujuk ke `contract.*` (tanpa kolom sensitif seperti hash PIN). |

---

## 4. Aliran Data Transaksi & Mutasi Stok (End-to-End Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Kasir (Terminal POS Outlet)
    participant Local as LocalStorage / Queue
    participant GW as API Gateway
    participant POS as pos-service
    participant DB as PostgreSQL (pos, internal, contract)
    actor Admin as Admin Backoffice / AI

    Note over Cashier, Local: Operasional Kasir (Offline-First di Cabang)
    Cashier->>Local: Buat Pesanan & Bayar (Cash / QRIS)
    Local->>Local: Simpan ke antrean sinkronisasi lokal

    Note over Local, POS: Siklus Sinkronisasi Terproteksi (Idempotent)
    Local->>GW: POST /api/v1/sync/transactions (batch + IdempotencyKey)
    GW->>POS: Validasi Header & Format Body (tenantId, merchantId, outletId)
    
    rect rgb(240, 248, 255)
        Note over POS, DB: Transaksi Database Terisolasi (db.tx)
        POS->>DB: Cek pos.sync_receipts (Idempotency Guard)
        POS->>DB: Upsert internal.tenants, internal.merchants, internal.outlets
        POS->>DB: INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id)
        POS->>DB: INSERT INTO pos.transaction_items
        POS->>DB: INSERT INTO pos.inventory_logs (Deduction BOM per Outlet)
        POS->>DB: UPDATE pos.ingredients (Kuantitas Stok Outlet)
        POS->>DB: Catat pos.merchant_activity_log
        POS->>DB: Catat pos.sync_receipts
    end

    POS-->>GW: { ok: true, accepted: N, duplicates: 0 }
    GW-->>Local: Konfirmasi Sukses Sinkronisasi
    Local->>Local: Tandai antrean lokal sebagai tersinkron

    Note over DB, Admin: Konsumsi Realtime Tanpa Dual-Write
    Admin->>DB: SELECT * FROM contract.merchant_revenue / transaction_log / outlet_directory
    DB-->>Admin: Laporan omzet per Holding, per Brand, dan per Cabang secara realtime
```

---

## 5. Aliran Otorisasi & Eksekusi AI Financial Copilot

```mermaid
sequenceDiagram
    autonumber
    actor Owner as Pemilik Usaha (Tenant/Merchant)
    participant FE as Frontend Client
    participant AI as ai-service
    participant DB as PostgreSQL (ai, internal, contract)
    participant LLM as Google Gemini / Model Provider

    Owner->>FE: Ajukan Pertanyaan Finansial / Performa Lintas Cabang
    FE->>AI: POST /api/v1/ai/query (tenantId, merchantId, prompt)
    
    rect rgb(255, 245, 245)
        Note over AI, DB: Verifikasi Saldo Kredit Atomik Tenant
        AI->>DB: SELECT consume_ai_credit(tenantId)
        DB-->>AI: TRUE (Kredit Tersedia & Terpotong)
    end

    AI->>DB: SELECT * FROM contract.merchant_revenue, stock_status, outlet_directory
    DB-->>AI: Agregat Finansial, Status Stok Cabang, dan Performa Penjualan
    
    AI->>LLM: Eksekusi Prompt dengan Konteks Multi-Cabang Akurat
    LLM-->>AI: Respon Analisis & Rekomendasi Bisnis
    
    AI->>DB: Catat ai.ai_query_logs
    AI-->>FE: Tampilkan Jawaban Analisis Finansial ke Pemilik Usaha
```

---

## 6. Perlindungan Keamanan & Sanitasi Skema

1. **Anti-Leakage Kredensial**:
   - Kolom `pin` di `internal.memberships` tidak pernah diekspos ke skema `contract` atau skema `public`.
   - View `contract.merchant_staff` hanya mengekspos profil publik staf beserta relasi Tenant, Merchant, dan Outlet.
2. **PostgreSQL RLS (Row Level Security)**:
   - RLS diterapkan pada semua tabel domain (`pos.*`, `billing.*`, `ai.*`, `internal.*`) sebagai lapisan pertahanan database (*defense-in-depth*).
   - Layanan aplikasi beroperasi dengan peran tersendiri (`svc_pos`, `svc_billing`, `svc_ai`, `svc_internal`).
3. **No Dual-Write Guarantee**:
   - Seluruh transaksi hanya ditulis satu kali ke `pos.transactions`.
   - Laporan konsolidasi holding, analitik brand, dan audit cabang membaca data yang sama melalui view di skema `contract`.
