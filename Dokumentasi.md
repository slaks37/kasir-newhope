# 📖 Dokumentasi Arsitektur Resmi — New Hope POS

Dokumentasi arsitektur sistem, hirarki multi-tenant (Model B), otentikasi & step-up otorisasi, tata kelola keamanan berlapis (*Defense-in-Depth*), dan aturan emas integritas data (*Golden Rule*).

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
│  │ • tenants (Holding/Corp)│  │ • products              │              │
│  │ • merchants (Brand/Unit)│  │ • ingredients           │              │
│  │ • outlets (Store Branch)│  │ • product_recipes (BOM) │              │
│  │ • users (Global ID 1:1) │  │ • transactions          │              │
│  │ • memberships (RBAC/PIN)│  │ • transaction_items     │              │
│  │ • audit_logs (Platform) │  │ • inventory_logs        │              │
│  │ • business_targets      │  │ • sync_receipts         │              │
│  │ • feature_usage (Telem.)│  └────────────┬────────────┘              │
│  │ • access_log (Operator) │               │                           │
│  │ • health_logs           │               │                           │
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

## 3. Otentikasi vs Step-Up Otorisasi (Manager PIN)

```
Skenario Kasir Melakukan Tindakan Berisiko Tinggi (mis. VOID Transaksi / Diskon Khusus):

Kasir Login (Supabase Session)
        │
        ▼
Kasir Memilih "Batalkan Transaksi (VOID)"
        │
        ▼
Service Permission Check (Peran: CASHIER tidak memiliki hak VOID langsung)
        │
        ▼
Require Manager Step-Up Authorization
        │
        ▼
Manager Memasukkan PIN Toko (Short-Lived Authorization Grant: 60 Detik)
        │
        ▼
Eksekusi VOID ➔ Catat ke internal.audit_logs dengan Actor Kasir + ApprovedBy Manager
```

---

## 4. Keamanan Berlapis (*Defense-in-Depth Chain*)

Batas domain tidak hanya bergantung pada izin database, melainkan ditegakkan pada setiap lapisan:

```
1. USER                    : Permintaan masuk dari browser kasir / admin
    ↓
2. AUTHENTICATION          : Verifikasi JWT / Sesi Supabase Auth yang valid
    ↓
3. CONTEXT RESOLUTION      : Penentuan Tenant ID, Merchant ID, dan Outlet ID aktif
    ↓
4. SERVICE AUTHORIZATION   : Pengecekan RBAC aplikasi (Apakah peran diizinkan?)
    ↓
5. STEP-UP AUTHORIZATION   : PIN Manager untuk aksi berisiko tinggi (VOID, Refund)
    ↓
6. DB ROLE ISOLATION       : svc_pos, svc_billing, svc_ai, svc_internal
    ↓
7. SCHEMA PERMISSION       : Hanya skema milik domain yang dapat ditulis
    ↓
8. TENANT ISOLATION (RLS)  : Enforce WHERE tenant_id = current_tenant di PostgreSQL
```

---

## 5. Perbedaan Eksplisit: `internal.access_log` vs `ai.query_logs`

| Kategori | Tabel | Isi Data | Tujuan |
|---|---|---|---|
| **Operator Access Log** | `internal.access_log` | **WHO accessed WHAT**<br>(`internal_user_id`, `merchant_id`, `resource`, `action`, `timestamp`) | Audit kepatuhan operator backoffice/support saat mengakses data privat merchant. |
| **AI LLM Query Log** | `ai.query_logs` | **WHAT AI request happened**<br>(`merchant_id`, `intent`, `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `credit_consumed`) | Audit teknis performa model AI, konsumsi kuota kredit, dan diagnostik latensi. |
| **Platform Audit Log** | `internal.audit_logs` | **BUSINESS EVENT AUDIT**<br>(`domain`, `event_type`, `severity`, `amount_idr`, `summary`, `detail`) | Jejak audit bisnis (VOID transaksi, ganti harga, ubah paket langganan). |
| **Product Telemetry** | `internal.feature_usage_events` | **FEATURE ADOPTION METRICS**<br>(`feature_name`, `ui_component`, `event_count`) | Analisis produk dan adopsi fitur (tidak dipakai untuk penagihan invoice). |

---

## 6. Aliran Data Transaksi Kasir (End-to-End Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Kasir (Terminal Outlet)
    participant Local as LocalStorage / Queue
    participant GW as API Gateway
    participant POS as pos-service
    participant DB as PostgreSQL (pos, internal, contract)
    actor Admin as Backoffice (Konsumer)

    Note over Cashier, Local: Operasional Kasir (Offline-First di Outlet)
    Cashier->>Local: Buat Pesanan & Bayar (Cash / QRIS)
    Local->>Local: Simpan ke antrean sinkronisasi lokal

    Note over Local, POS: Siklus Sinkronisasi Terproteksi (Idempotent)
    Local->>GW: POST /api/v1/sync/transactions (batch + IdempotencyKey)
    GW->>POS: Validasi Token & Scope (tenantId, merchantId, outletId)
    
    rect rgb(240, 248, 255)
        Note over POS, DB: Transaksi Database Terisolasi (db.tx)
        POS->>DB: Cek pos.sync_receipts (Idempotency Guard)
        POS->>DB: INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id)
        POS->>DB: INSERT INTO pos.transaction_items
        POS->>DB: INSERT INTO pos.inventory_logs (Deduction BOM per Outlet)
        POS->>DB: UPDATE pos.ingredients (Kuantitas Stok Outlet)
        POS->>DB: INSERT INTO internal.audit_logs (SYNC_BATCH)
        POS->>DB: Catat pos.sync_receipts
    end

    POS-->>GW: { ok: true, accepted: N, duplicates: 0 }
    GW-->>Local: Konfirmasi Sukses Sinkronisasi
    Local->>Local: Tandai antrean lokal sebagai tersinkron

    Note over DB, Admin: Konsumsi Realtime Tanpa Dual-Write
    Admin->>DB: SELECT * FROM contract.merchant_revenue / transaction_log / outlet_directory
    DB-->>Admin: Laporan omzet per Holding, Brand, dan Cabang secara konsisten
```
