# 03 — Visualisasi Alur & Logika

Diagram di halaman ini diturunkan dari pembacaan jalur eksekusi sebenarnya, dan
setiap simpul keputusan menunjuk baris kode yang menentukannya.

---

## 1. Data Flow Diagram — tingkat konteks

Yang penting dipahami lebih dulu: **`localStorage` adalah sistem pencatatan
utama aplikasi kasir**, dan PostgreSQL adalah salinan hilir untuk pelaporan.
Arah alirannya satu arah — tidak ada jalur yang menarik transaksi dari server
kembali ke browser.

```mermaid
graph LR
    KASIR(("Kasir"))
    LS[("localStorage<br/><i>sistem pencatatan</i><br/>±20 slot per unit usaha")]
    Q[("Antrian sinkronisasi<br/>newhope_sync_queue_*")]
    P1["Proses Penjualan"]
    P2["Sinkronisasi"]
    P3["AI Copilot"]
    PG[("PostgreSQL<br/><i>salinan hilir</i>")]
    ADMIN(("Staf internal"))
    LLM(("DeepSeek"))

    KASIR -->|"item, bayar"| P1
    P1 -->|"Order"| LS
    P1 -->|"payload transaksi"| Q
    Q --> P2
    P2 -->|"POST /sync/transactions"| PG
    PG -->|"contract.merchant_revenue"| P3
    LS -->|"agregat klien"| P3
    P3 -->|"prompt (agregat saja)"| LLM
    LLM -->|"markdown"| P3
    P3 -->|"jawaban"| KASIR
    PG -.->|"seharusnya lewat /api/admin/*"| ADMIN

    style LS fill:#dcfce7,stroke:#16a34a
    style PG fill:#dbeafe,stroke:#2563eb
    style ADMIN stroke-dasharray: 5 5
```

Garis putus-putus ke staf internal **tidak terhubung dalam kode**: konsol admin
membaca fiktur, bukan PostgreSQL (T-01).

**Data yang menyeberang ke LLM** dibatasi secara eksplisit di
`services/ai/index.ts:265-271`: hanya agregat dan ringkasan insight (maksimal 6).
Baris transaksi mentah, nomor telepon pelanggan, dan data staf tidak pernah
keluar.

---

## 2. Flowchart — proses penjualan (`processPayment`)

Sumber: `src/context/POSContext.tsx:1284-1516`.

```mermaid
flowchart TD
    A["Kasir tekan Bayar"] --> B{"cart.length == 0?"}
    B -->|ya| Z["return null"]
    B -->|tidak| C["subtotal = Σ item.totalPrice"]
    C --> D{"settings.enableTax?"}
    D -->|ya| E["taxTotal = round(subtotal × taxRate/100)"]
    D -->|tidak| F["taxTotal = 0"]
    E --> G{"settings.enableService?"}
    F --> G
    G -->|ya| H["serviceCharge = round(subtotal × serviceRate/100)"]
    G -->|tidak| I["serviceCharge = 0"]
    H --> J["grandTotal = subtotal + tax + service"]
    I --> J
    J --> K{"paymentMethod == CASH<br/>&& cashReceived?"}
    K -->|ya| L["change = max(0, cashReceived − grandTotal)"]
    K -->|tidak| M["change = 0"]
    L --> N["Bentuk Order<br/>id = generateInvoiceNumber()"]
    M --> N

    N --> O["1. Kurangi stok produk<br/>2. Catat InventoryLog<br/>3. Catat CashMovement<br/>4. Perbarui agregat shift<br/>5. setOrders([baru, ...lama])"]
    O --> P["<b>6. enqueueSync()</b><br/>tulis localStorage SINKRON"]
    P --> Q["void runSync() — tidak di-await"]
    Q --> R["clearCart() · return Order"]

    style P fill:#dcfce7,stroke:#16a34a,stroke-width:2px
    style Q fill:#fef3c7,stroke:#d97706
```

**Keputusan desain yang menentukan.** Langkah 6 menulis ke disk **sebelum**
apa pun dikirim, lalu pengirimannya sengaja tidak di-`await`
(`POSContext.tsx:1503-1510`). Kasir tidak pernah menunggu jaringan; kalau tab
ditutup tepat setelah baris itu, transaksinya tetap terkirim saat aplikasi
dibuka lagi.

> **Catatan ketepatan:** `grandTotal` **tidak** mengurangi `discountTotal`.
> Diskon sudah terpotong di `item.totalPrice` saat masuk keranjang, jadi
> `subtotal` sudah bersih. `discountTotal` yang disimpan di `Order` bersifat
> informasional. Server memakai rumus berbeda sebagai *fallback* —
> `subtotal - discount + tax + serviceCharge` (`sync.ts:307`) — tapi hanya jika
> `totalAmount` tidak dikirim, dan klien selalu mengirimnya.

---

## 3. Flowchart — jalur idempotensi sinkronisasi

Ini jalur tulis paling kritis di seluruh sistem. Sumber:
`services/pos/sync.ts:108-548`.

```mermaid
flowchart TD
    A["POST /api/v1/sync/transactions"] --> B{"trustedPrincipal?"}
    B -->|tidak| B1["401 UNAUTHENTICATED"]
    B -->|ya| C["ownerRef = principal.subject<br/><i>body.ownerRef DIABAIKAN</i>"]
    C --> D{"businessId & sector valid?"}
    D -->|tidak| D1["400 BAD_REQUEST"]
    D -->|ya| E{"txns.length > 500?"}
    E -->|ya| E1["413 BATCH_TOO_LARGE"]
    E -->|tidak| F["BEGIN TRANSACTION"]

    F --> G{"assertBusinessCanBeClaimed<br/>owner_user_ref cocok?"}
    G -->|tidak| G1["403 FORBIDDEN · ROLLBACK"]
    G -->|ya| H{"<b>Lapis 1</b><br/>sync_receipts[idemKey] ada?"}
    H -->|ya| H1["Kembalikan hasil lama<br/>replayed: true"]
    H -->|tidak| I["UPSERT tenant → merchant → outlet"]

    I --> J["Untuk tiap transaksi:"]
    J --> K["<b>Lapis 2</b><br/>INSERT … ON CONFLICT<br/>(tenant_id, client_txn_id)<br/>DO NOTHING"]
    K --> L{"RETURNING kosong?"}

    L -->|tidak, baris baru| M["INSERT payments<br/>INSERT transaction_items"]
    M --> N{"isVoid?"}
    N -->|tidak| O["INSERT inventory_transactions<br/>delta = −qty · SALE_DEDUCT"]
    N -->|ya| P["lewati potong stok"]
    O --> Q["accepted++"]
    P --> Q

    L -->|ya, duplikat| R{"paymentStatus == CANCELLED?"}
    R -->|tidak| S["duplicates++ · lanjut"]
    R -->|ya| T["<b>Lapis 3</b><br/>UPDATE … SET VOIDED<br/>WHERE order_status <> 'VOIDED'"]
    T --> U{"RETURNING kosong?"}
    U -->|ya| S
    U -->|tidak| V["payments → REFUNDED<br/>INSERT inventory_transactions<br/>delta = +qty · VOID_RESTORE<br/>writeActivity TRANSACTION_VOID"]
    V --> W["voided++"]

    Q --> X["INSERT sync_receipts<br/>ON CONFLICT DO NOTHING"]
    S --> X
    W --> X
    X --> Y["COMMIT · 200 {accepted, duplicates, voided}"]

    style H fill:#fef3c7,stroke:#d97706
    style K fill:#fef3c7,stroke:#d97706
    style T fill:#fef3c7,stroke:#d97706
```

### Tiga lapis pertahanan penggandaan

| Lapis | Mekanisme | Menangkap |
|---|---|---|
| 1 | `pos.sync_receipts.idempotency_key` | Batch identik terkirim ulang seluruhnya |
| 2 | `UNIQUE (tenant_id, client_txn_id)` | Transaksi tunggal terkirim ulang di batch berbeda |
| 3 | `UPDATE … WHERE order_status <> 'VOIDED'` | Pembatalan ganda |

Lapis 3 adalah yang paling halus dan paling mudah salah dirancang. Void selalu
tiba sebagai kiriman **kedua** untuk `clientTxnId` yang sama — kalau
diperlakukan sebagai duplikat biasa, pembatalannya hilang dan panel terus
menghitung uang yang sudah dikembalikan ke pelanggan. Arah sebaliknya
(menghidupkan lagi transaksi batal) sengaja tidak dilayani.

Pengembalian stok saat void idempoten karena bergantung pada `RETURNING` dari
`UPDATE` bersyarat itu: kiriman ketiga tidak menghasilkan baris, jadi blok
pengembalian stok tidak dimasuki sama sekali (`sync.ts:389-423`).

---

## 4. Flowchart — perutean AI Copilot tiga lapis

Urutan operasinya **adalah** strategi kendali biayanya. Sumber:
`services/ai/index.ts:86-370`.

```mermaid
flowchart TD
    A["POST /api/v1/assistant/query"] --> B["Bentuk ctx dari storeContext<br/>businessId, sektor, peran"]
    B --> C{"canAccessBusiness?"}
    C -->|tidak| C1["403 FORBIDDEN"]
    C -->|ya| D["ambilDompet(merchantId, businessId)<br/><i>SESUDAH ctx — kredit milik unit usaha</i>"]

    D --> E{"body.intent quick-chip?"}
    E -->|ya| F["confidence = 1<br/><i>lewati parser NL</i>"]
    E -->|tidak| G["parseIntent(queryText)<br/>22 intent · normalisasi ejaan"]

    F --> H["Baca contract.merchant_revenue"]
    G --> H
    H --> I{"database terbaca?"}
    I -->|ya| J["dataSource = DATABASE<br/>merge dengan agregat klien"]
    I -->|tidak| K["dataSource = CLIENT<br/><i>degradasi, bukan penolakan</i>"]

    J --> L{"intent ≠ UNKNOWN<br/>&& confidence ≥ 0.45?"}
    K --> L
    L -->|ya| M["resolveIntentFromAggregates()"]
    M --> N{"dapat jawaban?"}
    N -->|ya| O["<b>Layer 2 · Rp 0</b>"]

    N -->|tidak| P{"allowLlm === false?"}
    L -->|tidak| P
    P -->|ya| Q["Rule engine 'belum paham' · Rp 0"]
    P -->|tidak| R{"wallet.balance <= 0?"}
    R -->|ya| S["<b>PAYWALL</b> · Rp 0<br/>tidak memanggil model"]
    R -->|tidak| T{"getLlmConfig() ada?"}
    T -->|tidak| U["'AI belum aktif' · Rp 0<br/><i>tidak menagih panggilan<br/>yang tak bisa dilakukan</i>"]
    T -->|ya| V["<b>pakaiKredit()</b><br/>UPDATE … WHERE balance > 0<br/>RETURNING — atomik"]
    V --> W{"berhasil?"}
    W -->|tidak| S
    W -->|ya| X["callLlm() · timeout 30 s"]
    X --> Y{"sukses?"}
    Y -->|ya| Z["<b>Layer 3 · −1 kredit</b>"]
    Y -->|tidak| AA["kembalikanKredit()<br/><b>Layer 3 gagal · Rp 0</b>"]

    style O fill:#dcfce7,stroke:#16a34a
    style S fill:#fef3c7,stroke:#d97706
    style Z fill:#fee2e2,stroke:#dc2626
    style AA fill:#dcfce7,stroke:#16a34a
```

**Enam gerbang berbeda mengembalikan Rp 0 sebelum satu kredit pun terpotong.**
Kredit hanya dipotong setelah dipastikan: intent tidak terpecahkan secara
deterministik, saldo ada, dan penyedia LLM benar-benar terkonfigurasi. Kalau
panggilan gagal setelah itu, kreditnya dikembalikan
(`services/ai/index.ts:356`).

Pengurangan saldo memakai `UPDATE … WHERE balance > 0 RETURNING` dalam satu
pernyataan (`services/ai/wallet.ts`), sehingga dua request bersamaan pada saldo
terakhir menghasilkan satu TRUE dan satu FALSE. Membaca-lalu-menulis dari
aplikasi akan meloloskan keduanya.

---

## 5. Sequence — aktivasi langganan lewat webhook DOKU

Sumber: `services/billing/index.ts:428-483`.

```mermaid
sequenceDiagram
    participant M as Merchant
    participant UI as SubscriptionBillingTab
    participant G as gateway
    participant B as billing-service
    participant D as DOKU
    participant DB as PostgreSQL

    M->>UI: pilih paket
    UI->>G: POST /api/v1/subscription/checkout
    G->>B: + x-auth-sub
    B->>DB: buatFaktur(nomor, tenantId, amount)
    B->>D: createDokuCheckout()
    D-->>B: paymentUrl
    B-->>M: redirect ke halaman bayar

    M->>D: bayar
    D->>G: POST /api/v1/webhooks/doku
    Note over G: PUBLIC_API_PATHS —<br/>tanpa Bearer, body TIDAK diurai gateway
    G->>B: teruskan aliran mentah

    B->>B: verifyDokuWebhookSignature(headers, rawBody, target)
    Note over B: HMAC-SHA256 + timingSafeEqual ✅<br/>tapi ditegakkan HANYA bila<br/>NODE_ENV === 'production' ⚠️ (T-04)

    B->>DB: catatWebhookBaru(eventId) — idempotensi
    alt event sudah pernah
        B-->>D: 200 { replayed: true }
    else event baru & status SUCCESS
        B->>DB: tandaiFakturLunas(invoiceNumber)
        B->>DB: ubahStatusLangganan(ACTIVE, +30 hari)
        B-->>D: 200 { status: SUCCESS }
    end
```

Gateway sengaja **tidak mengurai body** pada jalur ini
(`services/gateway/index.ts:82-84`): mengurai lalu menyusun ulang JSON mengubah
byte-nya dan merusak verifikasi tanda tangan. Keputusan itu benar — dan justru
karena itu handler Vercel di `api/v1/webhooks/doku.ts:12` yang melakukan
`JSON.stringify(req.body)` tidak akan pernah menghasilkan tanda tangan yang
cocok.

---

## 6. State machine — status transaksi

Direkonstruksi dari `sync.ts:311-313` dan `POSContext.tsx:1517-1560`.

```mermaid
stateDiagram-v2
    [*] --> PENDING_PAYMENT: paymentStatus = PENDING
    [*] --> COMPLETED: paymentStatus = PAID
    [*] --> VOIDED: paymentStatus = CANCELLED (kiriman pertama)

    PENDING_PAYMENT --> COMPLETED: pelunasan
    COMPLETED --> VOIDED: kiriman kedua<br/>status CANCELLED

    VOIDED --> VOIDED: kiriman berikutnya diabaikan<br/>(WHERE order_status <> 'VOIDED')

    note right of VOIDED
        Efek samping sekali jalan:
        · payments → REFUNDED
        · inventory +qty (VOID_RESTORE)
        · activity TRANSACTION_VOID
    end note

    note left of COMPLETED
        Hanya COMPLETED yang masuk
        contract.merchant_revenue
    end note
```

Transisi `VOIDED → COMPLETED` **tidak ada dan disengaja**: menghidupkan kembali
transaksi yang sudah dibatalkan harus menjadi transaksi baru dengan struk baru.

---

## 7. State machine — circuit breaker

Sumber: `services/shared/breaker.ts`.

```mermaid
stateDiagram-v2
    [*] --> TERTUTUP
    TERTUTUP --> TERBUKA: gagalBerturut >= 5
    TERBUKA --> SETENGAH: Date.now() >= terbukaSampai<br/>(10 detik)
    SETENGAH --> TERTUTUP: catatSukses()
    SETENGAH --> TERBUKA: catatGagal()

    note right of SETENGAH
        Hanya SATU permintaan dilepas.
        Tanpa penjaga percobaanBerjalan,
        seluruh trafik tertahan menyerbu
        service yang baru bangun dan
        menjatuhkannya lagi.
    end note
```

---

## 8. Call graph — jalur tulis pos-service

```mermaid
graph TD
    R["POST /api/v1/sync/transactions"] --> TP["trustedPrincipal()<br/><i>shared/auth</i>"]
    R --> TX["db.tx()<br/><i>shared/db</i>"]
    TX --> ABC["assertBusinessCanBeClaimed()"]
    TX --> PLT["productLimitForTenant()<br/>→ contract.merchant_product_entitlement"]
    TX --> RC["resolveCashier()<br/>⚠️ T-03"]
    TX --> RP["resolveProduct()"]
    RP --> PLE["ProductLimitError → 409"]
    TX --> WA["writeActivity()<br/><i>pos/activity</i>"]

    RC --> IU[("internal.users")]
    RP --> PP[("pos.products")]
    TX --> PT[("pos.transactions")]
    TX --> PPAY[("pos.payments")]
    TX --> PTI[("pos.transaction_items")]
    TX --> PIT[("pos.inventory_transactions")]
    TX --> PSR[("pos.sync_receipts")]

    PIT -.->|"trigger<br/>trg_apply_inventory_transaction"| PIB[("pos.inventory_balances")]

    style RC fill:#fee2e2,stroke:#dc2626
    style PIT fill:#dbeafe
```

Perhatikan `pos.inventory_transactions → pos.inventory_balances`: pengurangan
stok dilakukan **trigger database**, bukan aplikasi. Tidak ada *read-then-write*
di sisi aplikasi, sehingga dua penjualan bersamaan atas produk yang sama tidak
bisa saling menimpa.
