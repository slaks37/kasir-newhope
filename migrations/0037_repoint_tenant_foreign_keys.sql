-- =============================================================================
-- 0037_repoint_tenant_foreign_keys.sql
--
-- Menyatukan kembali identitas tenant yang terbelah sejak 0014.
--
-- MASALAH YANG DIPERBAIKI, dan kenapa ia tidak pernah terlihat.
--
-- 0014 memindahkan tenant dari `pos.tenants` ke `internal.tenants` dengan
-- MENYALIN datanya satu kali. Tabel lamanya tidak dihapus, dan — ini bagian
-- yang menentukan — foreign key yang menunjuknya tidak ikut dipindahkan.
-- Sejak itu `services/pos/sync.ts` hanya menulis ke `internal.tenants`,
-- sementara 23 foreign key masih menuntut barisnya ada di `pos.tenants`.
--
-- Pada database yang sudah berisi data lama, keduanya kebetulan sinkron karena
-- salinan 0014, sehingga tidak ada yang gagal. Pada database BARU,
-- `pos.tenants` kosong selamanya dan SELURUH jalur tulis berhenti:
--
--   INSERT pos.products        -> 23503 products_tenant_id_fkey
--   INSERT pos.transactions    -> 23503 transactions_tenant_id_fkey
--   INSERT pos.sync_receipts   -> 23503 sync_receipts_tenant_id_fkey
--   INSERT ai.merchant_ai_credits -> 23503 fk_merchant_ai_credits_merchant_id
--
-- Itu sebabnya `services/ai/wallet.ts` menangkap 23503 lalu mengembalikan
-- dompet kosong, dan `services/billing/store.ts` mengembalikan null yang
-- menjadi peringatan MERCHANT_BELUM_SINKRON. Keduanya menangani gejala dengan
-- benar; keduanya tidak pernah menyentuh sebabnya.
--
-- YANG DILAKUKAN MIGRASI INI
--
--   1. Menyalin sisa baris `pos.tenants` yang belum ada di `internal.tenants`.
--   2. Memindahkan SETIAP foreign key yang menunjuk `pos.tenants` agar
--      menunjuk `internal.tenants`, dengan mempertahankan nama constraint,
--      kolom, serta aksi ON DELETE/ON UPDATE aslinya.
--   3. Membuang constraint kembar yang menjaga kolom sama dua kali.
--   4. Menghapus `pos.tenants`, supaya tidak ada kemungkinan salah tunjuk lagi.
--
-- Ditulis dinamis, bukan sebagai daftar tetap: jumlah dan nama constraint
-- berbeda antara database yang dimigrasi bertahap dan yang dibangun dari nol.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0037_repoint_tenant_foreign_keys.sql
--
-- Idempoten. Setelah berhasil sekali, jalan berikutnya tidak melakukan apa pun
-- karena `pos.tenants` sudah tidak ada.
-- =============================================================================


-- 1. SISA DATA -----------------------------------------------------------------
--
-- 0014 menyalin isi pos.tenants saat itu. Baris yang masuk SETELAHNYA — lewat
-- skrip lama atau seed yang belum diperbarui — belum pernah ikut. Disalin dulu
-- sebelum tabelnya dilepas, supaya tidak ada tenant yang hilang diam-diam.

DO $$
BEGIN
    IF to_regclass('pos.tenants') IS NULL THEN
        RAISE NOTICE '0037: pos.tenants sudah tidak ada — tidak ada yang perlu dikerjakan.';
        RETURN;
    END IF;

    INSERT INTO internal.tenants (id, name, business_sector, external_ref, owner_user_ref, is_active, created_at)
    SELECT
        p.id,
        p.name,
        COALESCE(p.business_sector, 'FNB'),
        p.external_ref,
        p.owner_user_ref,
        COALESCE(p.is_active, TRUE),
        COALESCE(p.created_at, CURRENT_TIMESTAMP)
      FROM pos.tenants p
     WHERE NOT EXISTS (SELECT 1 FROM internal.tenants i WHERE i.id = p.id)
    ON CONFLICT (id) DO NOTHING;
END $$;


-- 2. PEMINDAHAN FOREIGN KEY ----------------------------------------------------
--
-- Aksi referensial aslinya DIPERTAHANKAN. Itu bukan detail: log audit sengaja
-- memakai SET NULL supaya jejaknya tetap ada setelah merchant pergi (0006),
-- sedangkan data operasional memakai CASCADE. Menyeragamkannya di sini akan
-- diam-diam membuang riwayat yang justru paling dibutuhkan saat merchant pergi.
--
-- Baris yatim dibereskan lebih dulu — mengikuti aksi yang sama dengan
-- constraint-nya — karena ADD CONSTRAINT menolak tabel yang sudah melanggar.

DO $$
DECLARE
    fk        RECORD;
    tabel     TEXT;
    kolom     TEXT;
    aksi_del  TEXT;
    aksi_upd  TEXT;
    yatim     BIGINT;
    dipindah  INT := 0;
BEGIN
    IF to_regclass('pos.tenants') IS NULL THEN RETURN; END IF;

    FOR fk IN
        SELECT c.conname,
               c.conrelid::regclass::text                      AS anak,
               a.attname                                       AS kol,
               c.confdeltype,
               c.confupdtype
          FROM pg_constraint c
          JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.confrelid = 'pos.tenants'::regclass
           AND c.contype = 'f'
           AND array_length(c.conkey, 1) = 1     -- semua FK tenant berkolom tunggal
         ORDER BY 2, 1
    LOOP
        tabel := fk.anak;
        kolom := fk.kol;

        aksi_del := CASE fk.confdeltype
                        WHEN 'c' THEN 'CASCADE'
                        WHEN 'n' THEN 'SET NULL'
                        WHEN 'r' THEN 'RESTRICT'
                        WHEN 'd' THEN 'SET DEFAULT'
                        ELSE 'NO ACTION'
                    END;
        aksi_upd := CASE fk.confupdtype
                        WHEN 'c' THEN 'CASCADE'
                        WHEN 'n' THEN 'SET NULL'
                        WHEN 'r' THEN 'RESTRICT'
                        WHEN 'd' THEN 'SET DEFAULT'
                        ELSE 'NO ACTION'
                    END;

        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tabel, fk.conname);

        -- Yatim terhadap TUJUAN BARU, bukan tujuan lama.
        EXECUTE format(
            'SELECT count(*) FROM %s x WHERE x.%I IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM internal.tenants t WHERE t.id = x.%I)',
            tabel, kolom, kolom
        ) INTO yatim;

        IF yatim > 0 THEN
            IF aksi_del = 'SET NULL' THEN
                EXECUTE format(
                    'UPDATE %s x SET %I = NULL WHERE x.%I IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM internal.tenants t WHERE t.id = x.%I)',
                    tabel, kolom, kolom, kolom
                );
                RAISE NOTICE '0037: %.% — % baris yatim di-NULL-kan', tabel, kolom, yatim;
            ELSE
                EXECUTE format(
                    'DELETE FROM %s x WHERE x.%I IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM internal.tenants t WHERE t.id = x.%I)',
                    tabel, kolom, kolom
                );
                RAISE NOTICE '0037: %.% — % baris yatim dihapus', tabel, kolom, yatim;
            END IF;
        END IF;

        EXECUTE format(
            'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I)
                 REFERENCES internal.tenants(id) ON DELETE %s ON UPDATE %s',
            tabel, fk.conname, kolom, aksi_del, aksi_upd
        );

        dipindah := dipindah + 1;
    END LOOP;

    RAISE NOTICE '0037: % foreign key dipindahkan ke internal.tenants', dipindah;
END $$;


-- 3. CONSTRAINT KEMBAR ---------------------------------------------------------
--
-- 0006 memasang fk_<tabel>_<kolom> lewat loop, lalu 0011 memasang
-- fk_subscriptions_tenant dan fk_invoices_tenant untuk kolom yang SAMA. Dua
-- constraint identik pada satu kolom berarti dua kali pemeriksaan pada setiap
-- penulisan, dan dua tempat berbeda yang harus diingat saat mengubahnya nanti.
-- Yang tersisa satu; nama mana yang menang tidak penting selama konsisten.

DO $$
DECLARE
    d RECORD;
    dibuang INT := 0;
BEGIN
    FOR d IN
        SELECT c.conname, c.conrelid::regclass::text AS anak
          FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.confrelid = 'internal.tenants'::regclass
           AND EXISTS (
               SELECT 1 FROM pg_constraint c2
                WHERE c2.contype = 'f'
                  AND c2.conrelid  = c.conrelid
                  AND c2.confrelid = c.confrelid
                  AND c2.conkey    = c.conkey
                  AND c2.oid       < c.oid          -- pertahankan yang paling tua
           )
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', d.anak, d.conname);
        RAISE NOTICE '0037: constraint kembar dibuang — %.%', d.anak, d.conname;
        dibuang := dibuang + 1;
    END LOOP;

    IF dibuang = 0 THEN
        RAISE NOTICE '0037: tidak ada constraint kembar.';
    END IF;
END $$;


-- 4. MELEPAS TABEL LAMA --------------------------------------------------------
--
-- Setelah tidak ada lagi yang menunjuknya, `pos.tenants` hanya bisa menjadi
-- sumber kebingungan: dua tabel bernama sama untuk hal yang sama, satu di
-- antaranya diam-diam kosong. Dihapus, bukan ditinggalkan.
--
-- RESTRICT dengan sengaja: kalau ternyata masih ada yang bergantung padanya,
-- migrasi ini harus BERHENTI dan memberi tahu — bukan menyeret objek lain ikut
-- terhapus lewat CASCADE.

DO $$
DECLARE
    sisa INT;
BEGIN
    IF to_regclass('pos.tenants') IS NULL THEN RETURN; END IF;

    SELECT count(*)::int INTO sisa
      FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'pos.tenants'::regclass;

    IF sisa > 0 THEN
        RAISE EXCEPTION '0037: masih ada % foreign key menunjuk pos.tenants; dibatalkan.', sisa;
    END IF;

    EXECUTE 'DROP TABLE pos.tenants RESTRICT';
    RAISE NOTICE '0037: pos.tenants dihapus.';
END $$;


-- 5. PEMERIKSAAN AKHIR ---------------------------------------------------------
--
-- Migrasi yang "berhasil" tapi meninggalkan keadaan setengah jadi lebih buruk
-- daripada migrasi yang gagal terang-terangan.

DO $$
DECLARE
    n_internal INT;
BEGIN
    IF to_regclass('pos.tenants') IS NOT NULL THEN
        RAISE EXCEPTION '0037: pos.tenants masih ada setelah migrasi.';
    END IF;

    SELECT count(*)::int INTO n_internal
      FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'internal.tenants'::regclass;

    RAISE NOTICE '0037: selesai — % foreign key kini menunjuk internal.tenants.', n_internal;
END $$;
