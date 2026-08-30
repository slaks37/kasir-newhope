-- =============================================================================
-- 0043_scope_idempotency_to_tenant.sql
--
-- Kunci idempotensi sinkronisasi bersifat GLOBAL, bukan per merchant.
--
--   pos.sync_receipts  PRIMARY KEY (idempotency_key)
--
-- Artinya dua merchant yang kebetulan menghasilkan kunci yang sama akan saling
-- menabrak: batch merchant kedua ditelan diam-diam sebagai "replay" milik
-- merchant pertama. Bukan error — jawabannya 200, `replayed: true`, dan
-- transaksinya TIDAK PERNAH MASUK. Antrian di perangkat dianggap terkirim lalu
-- dipangkas, jadi kehilangannya permanen.
--
-- Ditemukan saat menguji otorisasi void: batch dengan `businessId` berbeda
-- dijawab sebagai replay hanya karena kunci batch-nya sama dengan pengujian
-- sebelumnya.
--
--   idempotency_key | business_id
--   ----------------+-----------------
--   rb-f            | own-rbac3_FNB     <- tenant lain
--   rb-g            | own-rbac4_FNB
--
-- SEBERAPA MUNGKIN TERJADI? Klien yang ada menyertakan `businessId` di dalam
-- kunci (`batchKey()` di src/lib/sync/queue.ts), jadi tabrakan tidak akan
-- terjadi selama semua klien memakai pembangkit itu. Tapi batasnya harus
-- ditegakkan oleh SKEMA, bukan oleh kesepakatan tentang cara klien menyusun
-- string — integrasi pihak ketiga, klien yang ditulis ulang, atau satu perangkat
-- yang jam sistemnya sama sudah cukup untuk menembusnya.
--
-- CAKUPANNYA UNIT USAHA, BUKAN TENANT. Satu pemilik bisa punya kafe DAN laundry
-- di bawah satu `tenant_id`, dan masing-masing punya antrian sinkronisasinya
-- sendiri (`newhope_sync_queue_<businessId>` di localStorage). Men-scope ke
-- tenant saja masih membiarkan antrian kafe menelan batch laundry. Kunci yang
-- benar adalah (tenant_id, business_id, idempotency_key) — persis sepadan
-- dengan satu antrian di satu perangkat.
--
-- Efek sampingnya juga bocor: jalur replay mengembalikan `rows_accepted` dan
-- `rows_duplicate` MILIK MERCHANT LAIN.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0043_scope_idempotency_to_tenant.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('pos.sync_receipts') IS NULL THEN
        RAISE NOTICE '0043: pos.sync_receipts tidak ada, dilewati.';
        RETURN;
    END IF;

    -- Sudah ter-scope? Tidak ada yang perlu dikerjakan.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'pos.sync_receipts'::regclass
           AND contype = 'p'
           AND array_length(conkey, 1) = 3
    ) THEN
        RAISE NOTICE '0043: kunci sudah mencakup tenant_id dan business_id.';
        RETURN;
    END IF;

    /*
     * Baris yatim dibuang lebih dulu.
     *
     * `tenant_id` boleh NULL pada skema lama, dan primary key gabungan tidak
     * menerimanya. Tanda terima tanpa tenant tidak bisa dipakai siapa pun untuk
     * apa pun — ia hanya menandai batch yang tidak diketahui miliknya siapa.
     */
    DELETE FROM pos.sync_receipts WHERE tenant_id IS NULL OR business_id IS NULL;
    ALTER TABLE pos.sync_receipts ALTER COLUMN tenant_id SET NOT NULL;
    ALTER TABLE pos.sync_receipts ALTER COLUMN business_id SET NOT NULL;

    ALTER TABLE pos.sync_receipts DROP CONSTRAINT sync_receipts_pkey;
    ALTER TABLE pos.sync_receipts
        ADD CONSTRAINT sync_receipts_pkey PRIMARY KEY (tenant_id, business_id, idempotency_key);

    RAISE NOTICE '0043: kunci idempotensi kini per unit usaha.';
END $$;

COMMENT ON COLUMN pos.sync_receipts.idempotency_key IS
    'Kunci batch dari perangkat kasir. Unik PER UNIT USAHA (tenant_id, business_id), '
    'bukan global — dua antrian berbeda boleh memakai kunci yang sama tanpa saling '
    'menelan batch (0043).';
