# ERD — New Hope POS

**25 tabel dan 14 view kontrak, dalam 5 domain.** Diturunkan langsung dari file
migrasi, lalu diverifikasi dengan menjalankannya di PostgreSQL — jadi diagram ini
menunjukkan apa yang benar-benar dibuat Postgres, bukan yang diniatkan.

Semua primary key `UUID` (v7) setelah `0005_uuid_keys.sql`, kecuali `plans.id`
yang tetap kode terbaca dan `feature_usage_events.id` yang `BIGSERIAL`.

Menjalankan ulang dari nol:

```bash
npm run db:reset
```

---

## 1. Domain OPERASIONAL (inti POS)

```mermaid
erDiagram
    tenants ||--o{ users            : "punya staf"
    tenants ||--o{ products         : ""
    tenants ||--o{ ingredients      : ""
    tenants ||--o{ product_recipes  : ""
    tenants ||--o{ transactions     : ""
    tenants ||--o{ customers        : "member toko"

    products      ||--o{ product_recipes   : "resep"
    ingredients   ||--o{ product_recipes   : "dipakai di"
    users         |o--o{ transactions      : "kasir (SET NULL)"
    customers     |o--o{ transactions      : "member (SET NULL)"
    transactions  ||--o{ transaction_items : "baris struk"
    products      |o--o{ transaction_items : "katalog (SET NULL)"
    ingredients   |o--o{ inventory_logs    : "mutasi stok"
    transactions  |o--o{ inventory_logs    : "pemicu (nullable)"

    tenants {
        uuid id PK
        varchar name
        varchar business_sector "FNB / LAUNDRY / RETAIL / CARWASH / BARBERSHOP"
        varchar external_ref UK "business_id dari klien: userId_sector"
        varchar owner_user_ref "akun pemilik"
        boolean is_active
    }
    users {
        uuid id PK
        uuid tenant_id FK
        varchar username
        varchar pin
        varchar role "OWNER / MANAGER / CASHIER"
        varchar external_ref "id sisi klien"
    }
    products {
        uuid id PK
        uuid tenant_id FK
        varchar sku
        numeric price
        numeric cost_price "HPP — dikunci RBAC"
        varchar business_sector "katalog terpisah per sektor"
        varchar business_id
        varchar category_name
        boolean is_available
    }
    ingredients {
        uuid id PK
        uuid tenant_id FK
        numeric current_stock
        numeric min_stock_alert
        varchar unit
        numeric cost_price
    }
    product_recipes {
        uuid id PK
        uuid tenant_id FK
        uuid product_id FK
        uuid ingredient_id FK
        numeric quantity_required
    }
    customers {
        uuid id PK
        uuid tenant_id FK
        varchar external_ref "id sisi klien — kunci pencocokan sinkron"
        varchar name
        varchar phone "TIDAK unik — satu nomor bisa dipakai sekeluarga"
        int points
        numeric total_spent
        int visit_count
        varchar tier "BRONZE / SILVER / GOLD / PLATINUM"
        timestamptz last_visit_at
    }
    transactions {
        uuid id PK
        uuid tenant_id FK
        uuid cashier_user_id FK "nullable — riwayat tetap ada"
        uuid customer_id FK "nullable — SET NULL saat member dihapus"
        varchar business_sector "SUMBU KLASIFIKASI UTAMA"
        varchar business_id "partition key unit usaha"
        varchar app_module "POS / TABLES / INVENTORY / ..."
        varchar order_type
        varchar invoice_number "UNIQUE per tenant"
        varchar client_txn_id "UNIQUE per tenant — kunci idempotensi"
        numeric subtotal
        numeric discount_amount
        numeric tax_amount
        numeric total_amount
        varchar payment_method
        timestamptz created_at
    }
    transaction_items {
        uuid id PK
        uuid transaction_id FK
        uuid product_id FK "nullable"
        varchar business_sector "disalin agar tidak perlu join"
        varchar product_name "snapshot"
        varchar category_name "snapshot"
        numeric unit_price "snapshot harga saat transaksi"
        numeric unit_cost "snapshot HPP"
        int quantity
    }
    inventory_logs {
        uuid id PK
        uuid ingredient_id FK
        uuid transaction_id FK "NULL = penyesuaian manual"
        numeric quantity_changed
        numeric previous_stock
        numeric new_stock
        varchar reason
    }
```

**Snapshot, bukan join.** `product_name`, `unit_price`, `unit_cost`, dan
`category_name` disalin ke baris struk. Kalau di-join ke `products`, menaikkan
harga akan menulis ulang seluruh riwayat penjualan — dan laba kotor tahun lalu
ikut berubah setiap kali katalog disunting.

**`SET NULL`, bukan `CASCADE`, pada `product_id` dan `cashier_user_id`.** Ini
bukan detail: dengan `NO ACTION` (bentuk aslinya) satu merchant **tidak bisa
dihapus sama sekali** — `DELETE tenants` merambat ke `products` lalu ditolak
oleh `transaction_items`. Permintaan penghapusan data tidak akan bisa dipenuhi.
`SET NULL` aman justru karena snapshot di atas: riwayat tetap terbaca utuh
setelah katalognya hilang.

**`business_sector` ada di tiga tabel sekaligus** — `transactions`,
`transaction_items`, `products` — dan itu disengaja. Merchant yang pindah dari
laundry ke kafe tidak mengubah kenyataan bahwa transaksi tahun lalu adalah
transaksi laundry.

---

## 2. Domain BILLING (langganan SaaS)

```mermaid
erDiagram
    plans         ||--o{ subscriptions : ""
    subscriptions ||--o{ invoices      : "ON DELETE CASCADE"

    plans {
        varchar id PK "tetap kode terbaca: 'basic', 'pro'"
        varchar name
        int tier_level
        enum billing_cycle "MONTHLY / YEARLY"
        numeric price_idr
        jsonb features
        boolean is_active
    }
    subscriptions {
        varchar id PK
        varchar tenant_id "TIDAK ada FK ke tenants"
        varchar plan_id FK
        enum status "TRIAL/ACTIVE/PAST_DUE/EXPIRED/CANCELED"
        timestamptz current_period_start
        timestamptz current_period_end
        timestamptz grace_period_end
        boolean cancel_at_period_end
    }
    invoices {
        varchar id PK
        varchar subscription_id FK
        varchar tenant_id "TIDAK ada FK"
        numeric amount
        enum payment_status "PENDING/PAID/FAILED"
        varchar payment_gateway_ref
        timestamptz due_date
    }
    webhook_logs {
        varchar id PK
        varchar event_id UK "kunci idempotensi"
        varchar event_type
        jsonb payload
    }
```

`webhook_logs` sengaja berdiri sendiri. `event_id UNIQUE` adalah yang mencegah
payment gateway men-*deliver* event yang sama dua kali dan meng-upgrade paket
merchant dua kali.

---

## 3. Domain SMART ASSISTANT (0003)

```mermaid
erDiagram
    daily_merchant_insights {
        varchar id PK
        varchar merchant_id "TIDAK ada FK"
        varchar tenant_id
        date insight_date
        varchar category "9 nilai, CHECK bukan ENUM"
        smallint priority "1..3"
        varchar title
        text summary
        jsonb payload "bentuk beda per kategori"
        jsonb actions
        varchar status "ACTIVE / DISMISSED / STALE"
    }
    merchant_targets {
        varchar merchant_id PK
        varchar tenant_id
        numeric monthly_revenue_target
    }
    merchant_ai_credits {
        varchar merchant_id PK
        varchar tenant_id
        int balance "CHECK >= 0 — pencegah double-spend"
        int monthly_grant
        int used_this_month
        timestamptz period_reset_at
    }
    ai_query_logs {
        varchar id PK
        varchar merchant_id
        varchar tenant_id
        text query_text
        varchar resolved_intent
        varchar source "RULE / BATCH / LLM / PAYWALL"
        int credits_charged
        int latency_ms
        varchar model
        int prompt_tokens
        int completion_tokens
    }
    batch_job_runs {
        varchar id PK
        varchar job_name
        varchar merchant_id "NULL = seluruh platform"
        enum status "SUCCESS / FAILED / SKIPPED"
        int insights_written
        int duration_ms
        text error_text
    }
```

Tidak ada relasi antar tabel di domain ini — memang begitu desainnya. Keempatnya
dikunci oleh `merchant_id`, dan `UNIQUE (merchant_id, insight_date, category)`
di `daily_merchant_insights` yang menjamin batch job idempoten: dijalankan dua
kali dalam semalam tidak menggandakan insight.

`ai_query_logs.source` adalah metrik biaya. Target arsitekturnya ≥90% baris
bernilai `RULE` atau `BATCH` (Rp 0). Kalau `LLM` naik melewati itu, ada intent
yang bocor ke jalur berbayar.

---

## 4. Domain BACK-OFFICE INTERNAL (0004)

```mermaid
erDiagram
    internal_users ||--o{ internal_access_log : "menghasilkan jejak audit"

    internal_users {
        varchar id PK
        varchar email UK
        varchar full_name
        enum role "SUPERADMIN / GROWTH / SUPPORT"
        varchar sso_subject UK
        boolean is_active
    }
    internal_access_log {
        varchar id PK
        varchar internal_user_id FK
        enum internal_role
        varchar merchant_id "NULL untuk tampilan agregat"
        varchar action
        varchar resource
        text justification "wajib untuk deep-read SUPPORT"
        varchar ip_address
        timestamptz accessed_at
    }
    feature_usage_events {
        bigserial id PK
        varchar merchant_id
        varchar tenant_id
        varchar business_id "partition key: userId_sector"
        varchar user_role
        varchar feature_key
        jsonb metadata "non-PII saja"
    }
    merchant_health_logs {
        varchar id PK
        varchar merchant_id
        varchar tenant_id
        date log_date
        numeric daily_revenue
        int daily_transaction_count
        int active_cashiers_count
        boolean login_status
        int days_since_last_txn
        int active_days_last_7
        numeric revenue_trend_pct "7h vs 23h sebelumnya"
        jsonb feature_usage_payload
        int distinct_features_used
        int support_tickets_count
        varchar subscription_status
        numeric mrr_idr "yang benar-benar tertagih"
        numeric contract_mrr_idr "nilai kontrak — ini yang berisiko hilang"
        numeric churn_risk_score "0.00 .. 1.00"
        jsonb churn_risk_reasons
    }
```

`internal_users` **sengaja terpisah** dari `users`. Kalau SUPERADMIN cuma satu
nilai lagi di kolom `users.role`, maka satu bug mass-assignment di form
pengaturan merchant menjadi jalan ke seluruh data semua tenant. Tidak ada satu
pun jalur kode sisi merchant yang bisa menulis ke tabel ini.

`mrr_idr` vs `contract_mrr_idr` bukan duplikasi: merchant yang berhenti bayar
punya `mrr_idr = 0` justru ketika dia paling berisiko. Kolom kontrak yang
menjawab "berapa rupiah yang akan hilang kalau dia churn".

---

## 5. Domain ADMIN PANEL & SINKRONISASI (0006)

```mermaid
erDiagram
    tenants ||--o{ merchant_activity_log : "menghasilkan kejadian"
    tenants ||--o{ sync_receipts         : ""
    transactions |o--o{ merchant_activity_log : "kalau kejadiannya penjualan"
    users        |o--o{ merchant_activity_log : "pelaku"

    merchant_activity_log {
        uuid id PK
        uuid merchant_id FK
        varchar business_sector "SUMBU KLASIFIKASI UTAMA"
        varchar business_id "unit usaha"
        varchar app_module "POS / INVENTORY / AUTH / SYNC / ..."
        varchar event_type "SALE / STOCK_ADJUST / LOGIN_FAILED / ..."
        varchar severity "INFO / NOTICE / WARNING / CRITICAL"
        uuid actor_user_id FK "nullable"
        varchar actor_name "snapshot — staf bisa dihapus"
        varchar actor_role
        uuid transaction_id FK "nullable"
        numeric amount_idr
        varchar summary
        jsonb detail
        timestamptz occurred_at
    }
    sync_receipts {
        varchar idempotency_key PK
        uuid tenant_id FK
        varchar business_id
        int rows_accepted
        int rows_duplicate
        timestamptz received_at
    }
```

`merchant_activity_log` menjawab "log transaksi seluruhnya" secara harfiah —
termasuk yang bukan penjualan. Penyesuaian stok, perubahan harga, PIN salah tiga
kali, diskon manual di atas 25%, shift dibuka, laporan diekspor. Kalau isinya
hanya penjualan, tabel ini cuma salinan `transactions` yang lebih lambat.

`sync_receipts` adalah lapisan pertahanan terluar terhadap penggandaan omzet.
Lapisan keduanya `UNIQUE (tenant_id, client_txn_id)` di `transactions`.
Berlebihan memang, dan disengaja: omzet yang terhitung dua kali tidak bisa
diperbaiki dari layar mana pun.

### View yang dibaca panel

| View | Isi |
|---|---|
| `v_sector_summary` | Ringkasan lima sektor — sumber angka tunggal kartu ringkasan |
| `v_merchant_directory` | Satu baris per merchant; LEFT JOIN agar yang belum pernah bertransaksi tetap muncul |
| `v_product_sales_by_sector` | Produk apa saja yang terjual, per sektor per merchant |
| `v_activity_by_sector` | Rekap kejadian per sektor × modul × tingkat |
| `v_daily_sector_revenue` | Omzet harian per sektor, dikonversi ke WIB |
| `v_merchant_health_latest` | Skor churn terbaru per merchant |
| `v_platform_mrr` | MRR tertagih vs nilai kontrak |
| `v_feature_adoption_30d` | Adopsi fitur 30 hari |

Panel tidak pernah menulis SQL agregat sendiri. Kalau definisi "omzet" di panel
berbeda dari yang dipakai batch job, akan ada dua angka resmi yang saling
bertentangan dan tidak ada cara memutuskan mana yang benar.

`v_daily_sector_revenue` mengonversi ke `Asia/Jakarta` sebelum memotong tanggal.
Tanpa itu, penjualan setelah pukul 17.00 WIB jatuh ke tanggal berikutnya menurut
UTC — dan laporan harian merchant tidak akan pernah cocok dengan kasnya.

---

## Yang sudah diperbaiki, dan yang belum

### Sudah (0006)

**FK yang hilang sudah dipasang.** 12 kolom `merchant_id`/`tenant_id` di
`daily_merchant_insights`, `merchant_targets`, `merchant_ai_credits`,
`merchant_health_logs`, `feature_usage_events`, `subscriptions`, `invoices`
sekarang benar-benar menunjuk `tenants(id)`. Total foreign key naik dari 11
menjadi **34**.

Log audit dan log biaya (`ai_query_logs`, `internal_access_log`) sengaja
`SET NULL`, bukan `CASCADE` — jejak akses harus tetap ada setelah merchantnya
pergi, justru saat itulah biasanya dibutuhkan.

**Merchant sekarang bisa dihapus.** Diuji: menghapus satu tenant membuang 169
transaksi, 310 baris item, 43 kejadian, dan menyisakan **nol baris yatim**.

**`merchant_targets` dan `batch_job_runs` ikut jadi UUID.** Keduanya terlewat
dari daftar 0005; ketahuan hanya karena 0006 mencoba memasang FK-nya dan
Postgres menolak `uuid = character varying`.

### Sudah (0012)

**Pelanggan pindah ke database.** `pos.customers` menyimpan poin, tier, total
belanja, dan jumlah kunjungan; `transactions.customer_id` menautkannya ke struk.
Keduanya ikut terkirim lewat jalur sinkronisasi yang sama dengan transaksi, jadi
member tidak lagi hilang saat browser dibersihkan.

`ON DELETE SET NULL`, dan di sini alasannya lebih kuat daripada di `product_id`:
pelanggan berhak meminta datanya dihapus. Dengan `CASCADE`, memenuhi permintaan
itu ikut menghapus struk penjualannya — omzet berkurang surut dan laporan pajak
yang sudah dikirim menjadi salah. Karena itu pula nama pembeli **tidak** ikut
di-snapshot ke baris transaksi: itu satu-satunya hal yang memang harus hilang.

**Analisis RFM sekarang bisa dijalankan.** `contract.customer_rfm` menyajikan
recency, frequency, dan monetary per member — lewat view kontrak, bukan dengan
memberi ai-service dan backoffice-service akses ke skema `pos`.

### Sudah (0013)

**`merchant_id` = `tenant_id` sekarang dijaga database.** Tujuh tabel mendapat
`CHECK (merchant_id IS NOT DISTINCT FROM tenant_id) NOT VALID`. Ditinjau lebih
dulu: setiap penulisan di repo mengisi keduanya dari satu parameter yang sama
(`VALUES ($1, $1, ...)`), jadi batasan ini hanya menuliskan apa yang sudah benar.

### Belum

**Salah satu dari `merchant_id`/`tenant_id` tetap harus dibuang.** 0013 baru
mencegah keduanya menyimpang, bukan menghapus duplikasinya — dan itu menunggu
satu keputusan produk: apakah satu akun boleh punya beberapa merchant? Kalau
tidak, buang `merchant_id`. Kalau ya, `merchants` harus jadi tabel tersendiri
**sekarang**, sebelum ada data produksi; `business_id` (`userId_sector`) sudah
menyiratkan arah itu.

**Poin belum bisa ditukar.** `settings.loyaltyRedeemRate` dirender di layar
member tapi tidak pernah dipakai menghitung apa pun — poin hanya bertambah.
Tier pun belum memberi diskon atau akses apa pun, hanya warna badge.

**Member yang belum pernah belanja belum tersinkron.** Baris `pos.customers`
lahir dari transaksi pertama. Pendaftaran member yang belum pernah bertransaksi
masih berhenti di localStorage sampai ada endpoint sinkronisasi tersendiri.

**Replikasi belum pernah diuji.** Konfigurasi di `docker-compose.analytics.yml`
sudah ada, tapi belum pernah dinyalakan.
