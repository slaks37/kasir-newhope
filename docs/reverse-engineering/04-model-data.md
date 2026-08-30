# 04 — Model Data (hasil rekonstruksi dari DDL)

Direkonstruksi dari **35 berkas migrasi (7.321 baris DDL)** di `migrations/`.
Migrasi tidak dijalankan; bentuk skema di sini adalah hasil pembacaan DDL secara
berurutan, termasuk `ALTER TABLE … SET SCHEMA` yang memindahkan tabel antar
skema.

> Dokumen `docs/erd.md` yang ada menyebut *"24 tabel dan 8 view"*. Angka itu
> benar untuk migrasi 0001–0006; sejak 0009 dan seterusnya jumlahnya menjadi
> **±58 tabel dan 29 view kontrak**. Lihat T-12.

---

## 1. Peta skema

```mermaid
graph TB
    subgraph POS["skema <b>pos</b> — pemilik: pos-service"]
        direction TB
        P1["<b>Inti transaksi</b><br/>transactions · transaction_items<br/>payments · transaction_adjustments<br/>sync_receipts"]
        P2["<b>Katalog</b><br/>products · product_variants<br/>modifiers · modifier_recipes<br/>recipes · recipe_items"]
        P3["<b>Inventori</b><br/>inventory_items · inventory_balances<br/>inventory_transactions · inventory_locations"]
        P4["<b>Konteks per sektor</b><br/>order_context_fnb / laundry /<br/>retail / carwash / barber"]
        P5["<b>Operasional</b><br/>shifts · staff_assignments<br/>staff_commissions · operational_jobs<br/>tables · bays · chairs · vehicles"]
    end

    subgraph INT["skema <b>internal</b> — pemilik: backoffice-service"]
        I1["tenants · merchants · outlets<br/>users · memberships<br/>internal_users · internal_access_log<br/>audit_logs · merchant_health_logs"]
    end

    subgraph BIL["skema <b>billing</b>"]
        B1["plans · subscriptions · invoices<br/>webhook_logs · device_fingerprints"]
    end

    subgraph AI["skema <b>ai</b>"]
        A1["merchant_ai_credits · credit_ledger<br/>ai_query_logs · daily_merchant_insights<br/>merchant_targets · batch_job_runs"]
    end

    CON["<b>skema contract</b> — 29 view<br/>satu-satunya permukaan lintas service"]

    POS --> CON
    INT --> CON
    BIL --> CON
    AI  --> CON

    style CON fill:#fef3c7,stroke:#d97706,stroke-width:2px
```

---

## 2. Skema `contract` — bahasa terpublikasi

29 view. Inilah satu-satunya hal yang boleh dibaca lintas service, dan view di
PostgreSQL berjalan dengan hak **pembuatnya** — sehingga konsumen tidak perlu
(dan tidak diberi) hak akses ke tabel dasarnya.

| Kelompok | View |
|---|---|
| **Uang** | `merchant_revenue` · `transaction_log` · `transaction_items` · `transaction_items_detailed` · `payments_log` · `daily_sector_revenue` |
| **Direktori** | `merchant_directory` · `tenant_directory` · `outlet_directory` · `merchant_staff` |
| **Katalog & stok** | `catalog` · `modifier_directory` · `product_sales` · `stock_status` · `inventory_movements` · `bom_explosion` |
| **Antrean langsung** | `live_fnb_orders` · `live_laundry_orders` · `live_barber_queue` · `live_carwash_queue` · `workshop_jobs_board` |
| **Aktivitas** | `activity_log` · `activity_by_sector` |
| **Komersial** | `subscription_status` · `merchant_product_entitlement` · `merchant_health_latest` · `business_targets` · `staff_commission_ledger` · `sector_summary` |

### Definisi omzet tunggal

`contract.merchant_revenue` (`migrations/0020_separate_orders_and_payments.sql:112`)
adalah satu-satunya definisi omzet di platform:

```sql
WHERE x.order_status = 'COMPLETED'
  AND (x.payment_status <> 'CANCELLED' OR x.payment_status IS NULL)
```

Karena AI Copilot (`services/ai/merchantData.ts`) dan konsol admin
(`src/server/repo.ts`) sama-sama **wajib** membacanya, angka yang mereka
laporkan identik secara struktural — bukan hasil disiplin menjaga dua potongan
SQL tetap sama.

Metode pembayaran diambil lewat `LEFT JOIN LATERAL … ORDER BY created_at DESC
LIMIT 1` ke `pos.payments`, dengan `COALESCE` ke kolom lama pada
`pos.transactions` — pola kompatibilitas maju yang membuat migrasi 0020 bisa
berjalan tanpa menulis ulang jalur sinkronisasi.

---

## 3. Resolusi identitas merchant

Klien mengenal merchant lewat string bebas (`usr-budi`, `usr-budi_FNB`);
database memakai UUIDv7 sejak 0005. Penerjemahannya **terpusat** di
`services/shared/identity.ts`.

```mermaid
flowchart TD
    A["resolveTenant({ merchantId, businessId })"] --> B{"merchantId cocok UUID_RE?"}
    B -->|ya| B1["lewat: UUID<br/>terdaftar: true"]
    B -->|tidak| C{"businessId diisi?"}
    C -->|ya| D["contract.merchant_directory<br/>WHERE business_id = $1"]
    D --> E{"ketemu?"}
    E -->|ya| E1["lewat: BUSINESS_ID<br/>terdaftar: true"]
    E -->|tidak| F
    C -->|tidak| F{"merchantId diisi?"}
    F -->|ya| G["… WHERE owner_user_ref = $1<br/><b>LIMIT 2</b>"]
    G --> H{"tepat 1 baris?"}
    H -->|ya| H1["lewat: OWNER_REF<br/>terdaftar: true"]
    H -->|"tidak (0 atau ≥2)"| I
    F -->|tidak| I["legacy_uuid(kunci)<br/><b>lewat: SINTETIS</b><br/>terdaftar: false"]

    I --> J["UUID deterministik yang tidak menunjuk<br/>tenant mana pun → penulisan ditolak FK"]

    style H fill:#fef3c7,stroke:#d97706
    style I fill:#fee2e2,stroke:#dc2626
```

**`LIMIT 2` adalah inti keputusannya.** Pemilik dengan kafe *dan* laundry
sengaja **tidak** diselesaikan tanpa `businessId`. Menebak salah satunya berarti
kredit AI kafe terpotong untuk pertanyaan tentang laundry — dan tidak akan ada
error apa pun yang menunjukkannya (`identity.ts:88-96`).

Langkah SINTETIS juga disengaja gagal: UUID-nya deterministik tapi tidak
menunjuk baris mana pun, jadi setiap penulisan ditolak foreign key. Lebih baik
ditolak daripada menempel pada merchant yang salah.

---

## 4. ⚠️ Split-brain tabel tenant

Temuan struktural yang muncul dari membaca migrasi secara berurutan.

```mermaid
graph TB
    subgraph "Sebelum 0014"
        PT[("<b>pos.tenants</b>")]
    end
    subgraph "Sejak 0014 / 0015"
        IT[("<b>internal.tenants</b><br/>+ merchants + outlets")]
    end

    PT -->|"0014: SALIN SEKALI<br/>saat migrasi, tanpa trigger"| IT

    SYNC["services/pos/sync.ts:159<br/><b>satu-satunya jalur pembuatan tenant</b>"] -->|"INSERT"| IT
    SYNC -.->|"tidak pernah menulis"| PT

    SUB[("billing.subscriptions")] -->|"FK 0011"| PT
    INV[("billing.invoices")] -->|"FK 0011"| PT
    MEM[("internal.memberships")] -->|"FK 0013"| PT
    AIC[("ai.merchant_ai_credits")] -->|"FK 0006"| PT

    NEW[("28 tabel dari 0018 ke atas")] -->|"FK"| IT

    style PT fill:#fee2e2,stroke:#dc2626,stroke-width:2px
    style IT fill:#dcfce7,stroke:#16a34a
```

| Aspek | Rincian |
|---|---|
| **`pos.tenants`** | Dibuat 0009 (dari `public.tenants`). **Tidak pernah di-DROP.** Tidak pernah ditulis lagi setelah 0014. |
| **`internal.tenants`** | Dibuat 0014, disempurnakan 0015. Satu-satunya tabel yang ditulis `sync.ts`. |
| **Menunjuk `pos.tenants`** | `billing.subscriptions` · `billing.invoices` (0011:45,53) · `internal.memberships` (0013:38) · `ai.merchant_ai_credits`, `daily_merchant_insights`, `merchant_targets`, `merchant_health_logs`, `feature_usage_events` (0006:34-46, lewat `REFERENCES tenants(id)` tanpa prefiks) |
| **Menunjuk `internal.tenants`** | ±28 tabel dari 0018 sampai 0034 |
| **Yang menjembatani** | Hanya penyalinan satu kali di `0014:41-56`. Tidak ada trigger, tidak ada view, tidak ada penulisan ganda. |

Konsekuensinya bisa dilacak sampai ke kode yang menanganinya:

- `services/ai/wallet.ts:86-92` menangkap kode error `23503` (pelanggaran FK)
  dan mengembalikan **dompet kosong** alih-alih melempar.
- `services/billing/store.ts:113` mengembalikan `null` bila tenant tidak
  `terdaftar`, yang di handler webhook menjadi peringatan
  `MERCHANT_BELUM_SINKRON` (`billing/index.ts:520`).

Kedua penanganan itu benar sebagai perlindungan, tapi keduanya menangani
**gejala**. Akar masalahnya adalah FK yang masih menunjuk tabel yang sudah
ditinggalkan. Lihat **T-09**.

---

## 5. Peran database & hak akses

Dibuat di `migrations/0009_service_schemas.sql:339-378`.

| Peran | Skema sendiri | `contract` | Tambahan |
|---|---|---|---|
| `svc_pos` | `pos` — ALL | SELECT | `EXECUTE legacy_uuid()` |
| `svc_billing` | `billing` — ALL | SELECT | `USAGE ON pos` + `SELECT, REFERENCES ON pos.tenants` (0011) |
| `svc_ai` | `ai` — ALL | SELECT | idem (0011) |
| `svc_internal` | `internal` — ALL | SELECT | — |
| `bi_readonly` | — | SELECT | Untuk Metabase/BI; tidak pernah tabel mentah |

Semua dibuat `NOLOGIN` (`0009:347`). **Tidak ada satu pun `SET ROLE` di seluruh
basis kode**, dan `services/shared/db.ts:67` memakai satu `DATABASE_URL` untuk
kelima service. Isolasi ini ada di DDL tapi tidak aktif saat dijalankan — lihat
**T-02**.

> Catatan ketepatan untuk README: sejak 0011, `svc_ai` **memang** punya
> `USAGE ON SCHEMA pos`. Pesan penolakan yang dicontohkan README
> (`permission denied for schema pos`) kini akan berbunyi
> `permission denied for table transactions`. Isolasi atas `pos.transactions`
> tetap berlaku; hanya pesannya yang berubah.

---

## 6. Integritas yang ditegakkan database

Hal-hal yang **tidak** dititipkan ke aplikasi:

| Mekanisme | Lokasi | Yang dicegah |
|---|---|---|
| `UNIQUE (tenant_id, client_txn_id)` | `pos.transactions` | Omzet berlipat dari kiriman ulang |
| `UNIQUE (idempotency_key)` | `pos.sync_receipts` | Batch identik diproses dua kali |
| `trg_apply_inventory_transaction` | 0024 | Race pada stok — tidak ada read-then-write di aplikasi |
| `consume_ai_credit()` | 0003/0010 | Dua request bersamaan menghabiskan kredit terakhir yang sama |
| Immutabilitas catatan finansial | 0035 | Perubahan retroaktif pada pembukuan |
| Ledger kompensasi | 0033 | Pembalikan pembayaran yang menghapus jejak |
| `ON DELETE SET NULL` pada log | 0006:49-50 | Jejak audit ikut hilang saat merchant pergi |

Pilihan `SET NULL` untuk `ai_query_logs` dan `internal_access_log` — bukan
`CASCADE` — adalah keputusan yang tepat: riwayat biaya dan jejak akses justru
paling dibutuhkan **setelah** merchant pergi.
