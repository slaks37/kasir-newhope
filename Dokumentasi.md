# 📖 Dokumentasi Arsitektur Resmi — New Hope POS

Dokumentasi komprehensif arsitektur sistem, domain data model, aliran data (end-to-end data flow), dan tata kelola keamanan New Hope POS.

---

## 1. Prinsip Arsitektur Utama

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
│   • Multi-Tenant RBAC: internal.memberships (Peran & PIN Toko)         │
│   • Resolve Actor & Merchant Identity (merchant_id = tenant_id)        │
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
│  [internal] (Identity)  [pos] (Operations)  [billing]       [ai]       │
│  • users                • tenants           • plans         • credits  │
│  • memberships          • products          • subscriptions • insights │
│  • access_log           • ingredients       • invoices      • targets  │
│  • health_logs          • recipes           • webhooks      • query_log│
│  • feature_usage        • transactions                                 │
│                         • trans_items                                  │
│                         • inventory_logs                               │
│                                                                        │
│  ────────────────────────────────────────────────────────────────────  │
│  [contract] (Single Source of Truth Cross-Domain Read Surface)         │
│  • merchant_directory   • merchant_revenue     • catalog               │
│  • merchant_staff       • stock_status         • inventory_movements   │
│  • transaction_log      • subscription_status  • sector_summary        │
│                                                                        │
│  ────────────────────────────────────────────────────────────────────  │
│  [PostgreSQL RLS Enforcement] (Database-Level Authorization Filter)    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Canonical Domain Model: Identitas Global & Multi-Tenant Membership

### User Bukan Milik Domain POS
Pengguna sistem New Hope POS adalah entitas identitas global di bawah skema `internal`. Seorang pengguna dapat berinteraksi dengan modul POS, Billing, AI, maupun Backoffice.

- **`internal.users`**: Identitas tunggal manusia (Email, Nama, Avatar, Hak Platform).
- **`internal.memberships`**: Hubungan multi-tenant (1 User dapat menjadi **Owner** di Toko A, **Manager** di Toko B, dan **Cashier** di Toko C tanpa duplikasi akun).
- **Kiosk PIN**: PIN kasir terikat pada `membership` per toko untuk *fast terminal login* tanpa membocorkan kredensial global.

### Hierarki Relasi Domain (ERD)

```mermaid
erDiagram
    USERS ||--o{ MEMBERSHIPS : "memiliki akses toko"
    TENANTS ||--o{ MEMBERSHIPS : "memiliki anggota staf"
    TENANTS ||--o{ PRODUCTS : "memiliki katalog"
    TENANTS ||--o{ INGREDIENTS : "memiliki stok bahan"
    TENANTS ||--o{ PRODUCT_RECIPES : "memiliki formulasi BOM"
    TENANTS ||--o{ TRANSACTIONS : "memiliki transaksi"
    TENANTS ||--o{ INVENTORY_LOGS : "memiliki riwayat mutasi"
    TENANTS ||--o{ MERCHANT_ACTIVITY_LOG : "memiliki jejak aktivitas"
    TENANTS ||--|| SUBSCRIPTIONS : "memiliki langganan aktif"
    TENANTS ||--|| MERCHANT_AI_CREDITS : "memiliki kuota AI"

    PRODUCTS ||--o{ PRODUCT_RECIPES : "diuraikan menjadi"
    INGREDIENTS ||--o{ PRODUCT_RECIPES : "bahan baku untuk"
    TRANSACTIONS ||--o{ TRANSACTION_ITEMS : "memuat item penjualan"
    PRODUCTS ||--o{ TRANSACTION_ITEMS : "item tercatat dari"
    INGREDIENTS ||--o{ INVENTORY_LOGS : "mutasi kuantitas"
    TRANSACTIONS ||--o{ INVENTORY_LOGS : "dipicu oleh transaksi"
    PLANS ||--o{ SUBSCRIPTIONS : "paket yang dipilih"
    SUBSCRIPTIONS ||--o{ INVOICES : "tagihan berkala"
```

---

## 3. Batas Domain Skema (Multi-Schema Isolation)

| Skema | Service Pemilik | Hak Akses Tulis (Write) | Hak Akses Baca (Read) | Deskripsi |
|---|---|---|---|---|
| `internal` | `backoffice-service` | `svc_internal` | `svc_internal` | Identitas global pengguna (`users`), keanggotaan tenant (`memberships`), audit log operator, dan metrik kesehatan merchant. |
| `pos` | `pos-service` | `svc_pos` | `svc_pos` | Inti transaksi POS, katalog, resep BOM, dan mutasi stok fisik. |
| `billing` | `billing-service` | `svc_billing` | `svc_billing` | Paket langganan SaaS, status tagihan, faktur, dan log webhook. |
| `ai` | `ai-service` | `svc_ai` | `svc_ai` | Dompet kuota kredit AI, agregasi insight bisnis harian, log kueri LLM. |
| `contract` | *Shared Contract* | Tidak ada (Hanya View) | Semua Service (`svc_*`, `bi_readonly`) | **Satu-satunya antarmuka baca lintas-layanan**. Menjamin angka omzet, staf, dan stok selalu konsisten. |
| `public` | *Platform Public* | `schema_migrations` | `anon`, `authenticated` | Hanya memuat view tersanitasi yang merujuk ke `contract.*` (tanpa kolom sensitif seperti hash PIN). |

---

## 4. Aliran Data Transaksi & Mutasi Stok (End-to-End Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Kasir (Terminal POS)
    participant Local as LocalStorage / Queue
    participant GW as API Gateway
    participant POS as pos-service
    participant DB as PostgreSQL (pos, internal, contract)
    actor Admin as Admin Backoffice / AI

    Note over Cashier, Local: Operasional Kasir (Offline-First)
    Cashier->>Local: Buat Pesanan & Bayar (Cash / QRIS)
    Local->>Local: Simpan ke antrean sinkronisasi lokal

    Note over Local, POS: Siklus Sinkronisasi Terproteksi (Idempotent)
    Local->>GW: POST /api/v1/sync/transactions (batch + IdempotencyKey)
    GW->>POS: Validasi Header & Format Body
    
    rect rgb(240, 248, 255)
        Note over POS, DB: Transaksi Database Terisolasi (db.tx)
        POS->>DB: Cek pos.sync_receipts (Idempotency Guard)
        POS->>DB: Upsert pos.tenants & validasi internal.memberships
        POS->>DB: INSERT INTO pos.transactions ON CONFLICT DO NOTHING
        POS->>DB: INSERT INTO pos.transaction_items
        POS->>DB: INSERT INTO pos.inventory_logs (Deduction BOM)
        POS->>DB: UPDATE pos.ingredients (Kuantitas Stok)
        POS->>DB: Catat pos.merchant_activity_log
        POS->>DB: Catat pos.sync_receipts
    end

    POS-->>GW: { ok: true, accepted: N, duplicates: 0 }
    GW-->>Local: Konfirmasi Sukses Sinkronisasi
    Local->>Local: Tandai antrean lokal sebagai tersinkron

    Note over DB, Admin: Konsumsi Realtime Tanpa Dual-Write
    Admin->>DB: SELECT * FROM contract.merchant_revenue / transaction_log / merchant_staff
    DB-->>Admin: Angka omzet & audit trail yang identik dan konsisten
```

---

## 5. Aliran Otorisasi & Eksekusi AI Financial Copilot

```mermaid
sequenceDiagram
    autonumber
    actor Owner as Pemilik Toko (Merchant)
    participant FE as Frontend Client
    participant AI as ai-service
    participant DB as PostgreSQL (ai & contract)
    participant LLM as Google Gemini / Model Provider

    Owner->>FE: Ajukan Pertanyaan Finansial / Tren Penjualan
    FE->>AI: POST /api/v1/ai/query (merchantId, prompt)
    
    rect rgb(255, 245, 245)
        Note over AI, DB: Verifikasi Saldo Kredit Atomik
        AI->>DB: SELECT consume_ai_credit(merchantId)
        DB-->>AI: TRUE (Kredit Tersedia & Terpotong)
    end

    AI->>DB: SELECT * FROM contract.merchant_revenue, stock_status, merchant_staff
    DB-->>AI: Agregat Finansial, Status Stok, dan Performa Staf
    
    AI->>LLM: Eksekusi Prompt dengan Konteks Finansial Akurat
    LLM-->>AI: Respon Analisis & Rekomendasi Bisnis
    
    AI->>DB: Catat ai.ai_query_logs
    AI-->>FE: Tampilkan Jawaban Analisis Finansial ke Pemilik Toko
```

---

## 6. Perlindungan Keamanan & Sanitasi Skema

1. **Anti-Leakage Kredensial**:
   - Kolom `pin` di `internal.memberships` tidak pernah diekspos ke skema `contract` atau skema `public`.
   - View `contract.merchant_staff` hanya mengekspos profil publik (`user_id`, `staff_name`, `email`, `role`, `is_active`).
2. **PostgreSQL RLS (Row Level Security)**:
   - RLS diterapkan pada semua tabel domain (`pos.*`, `billing.*`, `ai.*`, `internal.*`) sebagai lapisan pertahanan database (*defense-in-depth*).
   - Layanan aplikasi beroperasi dengan peran tersendiri (`svc_pos`, `svc_billing`, `svc_ai`, `svc_internal`).
3. **No Dual-Write Guarantee**:
   - Seluruh transaksi hanya ditulis satu kali ke `pos.transactions`.
   - Modul pelaporan, analitik backoffice, dan AI Copilot membaca data yang sama melalui view di skema `contract`.
