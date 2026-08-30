-- =============================================================================
-- 0039_repoint_user_foreign_keys.sql
--
-- Split-brain kedua, dengan sebab yang sama persis dengan 0037 — kali ini untuk
-- IDENTITAS ORANG, bukan identitas merchant.
--
-- 0013 memperkenalkan `internal.users` sebagai bidang identitas baru, dan sejak
-- Model B seluruh jalur tulis memakainya: `services/pos/sync.ts` membuat baris
-- kasir di sana. Tapi `pos.users` yang lama tidak pernah dihapus, dan EMPAT
-- foreign key masih menuntut barisnya ada di tabel lama itu:
--
--   pos.transactions.cashier_user_id       -> pos.users
--   pos.inventory_transactions.performed_by-> pos.users
--   pos.merchant_activity_log.actor_user_id-> pos.users
--   pos.merchant_audit_logs.actor_id       -> pos.users
--
-- Akibatnya persis seperti 0037: pada database yang datanya lama, keduanya
-- kebetulan sinkron; pada database baru, seluruh sinkronisasi transaksi gagal.
-- Ditemukan dengan menjalankan endpointnya, bukan dengan membaca kode:
--
--   POST /api/v1/sync/transactions -> 500 SYNC_FAILED
--   [sync] gagal: insert or update on table "transactions" violates
--          foreign key constraint "fk_transactions_cashier_user_id_hist"
--
-- MIGRASI DATA. Baris `pos.users` dipindahkan ke `internal.users` DENGAN ID
-- YANG SAMA — itu yang membuat keempat foreign key tetap menunjuk baris yang
-- benar tanpa perlu memetakan ulang nilainya satu per satu.
--
-- Kolom `pin` sengaja TIDAK ikut. PIN adalah kredensial perangkat kasir yang
-- diverifikasi di sisi klien (`src/lib/auth/pinSecurity.ts`); `internal.users`
-- adalah bidang identitas lintas-service dan bukan tempat menyimpan kredensial
-- operasional. Membawanya ikut berarti menyebarkan rahasia ke tabel yang dibaca
-- empat service.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0039_repoint_user_foreign_keys.sql
--
-- Idempoten. Setelah berhasil sekali, `pos.users` sudah tidak ada.
-- =============================================================================


-- 1. PEMINDAHAN DATA -----------------------------------------------------------
--
-- Email disintesis karena `pos.users` tidak punya kolomnya, sementara
-- `internal.users.email` NOT NULL UNIQUE. Bentuknya sama dengan yang dipakai
-- resolveCashier() di jalur sinkronisasi — `<username>@<tenant>.pos.local` —
-- sehingga kasir yang sama tidak berujung menjadi dua baris berbeda.

DO $$
DECLARE
    dipindah INT := 0;
BEGIN
    IF to_regclass('pos.users') IS NULL THEN
        RAISE NOTICE '0039: pos.users sudah tidak ada — tidak ada yang perlu dikerjakan.';
        RETURN;
    END IF;

    INSERT INTO internal.users (id, email, full_name, is_platform_user, is_active, created_at)
    SELECT
        u.id,
        lower(regexp_replace(COALESCE(NULLIF(u.username, ''), 'kasir'), '[^a-zA-Z0-9._-]+', '-', 'g'))
            || '@' || u.tenant_id || '.pos.local',
        COALESCE(NULLIF(u.name, ''), 'Kasir'),
        FALSE,
        TRUE,
        COALESCE(u.created_at, CURRENT_TIMESTAMP)
      FROM pos.users u
     WHERE NOT EXISTS (SELECT 1 FROM internal.users i WHERE i.id = u.id)
    ON CONFLICT (email) DO NOTHING;

    GET DIAGNOSTICS dipindah = ROW_COUNT;
    RAISE NOTICE '0039: % baris pos.users dipindahkan ke internal.users', dipindah;
END $$;


-- 2. PEMINDAHAN FOREIGN KEY ----------------------------------------------------
--
-- Sama seperti 0037: dinamis, mempertahankan aksi referensial asli, dan
-- membereskan baris yatim lebih dulu karena ADD CONSTRAINT menolak tabel yang
-- sudah melanggar.
--
-- Untuk kolom pelaku (`actor`, `performed_by`, `cashier_user_id`) yatim
-- di-NULL-kan, bukan dihapus, kalau kolomnya mengizinkan: kehilangan SATU nama
-- kasir jauh lebih ringan daripada kehilangan transaksinya.

DO $$
DECLARE
    fk        RECORD;
    tabel     TEXT;
    kolom     TEXT;
    aksi_del  TEXT;
    nullable  BOOLEAN;
    yatim     BIGINT;
    dipindah  INT := 0;
BEGIN
    IF to_regclass('pos.users') IS NULL THEN RETURN; END IF;

    FOR fk IN
        SELECT c.conname,
               c.conrelid::regclass::text AS anak,
               a.attname                  AS kol,
               a.attnotnull               AS wajib,
               c.confdeltype
          FROM pg_constraint c
          JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.confrelid = 'pos.users'::regclass
           AND c.contype = 'f'
           AND array_length(c.conkey, 1) = 1
         ORDER BY 2, 1
    LOOP
        tabel := fk.anak;
        kolom := fk.kol;
        nullable := NOT fk.wajib;

        aksi_del := CASE fk.confdeltype
                        WHEN 'c' THEN 'CASCADE'
                        WHEN 'n' THEN 'SET NULL'
                        WHEN 'r' THEN 'RESTRICT'
                        WHEN 'd' THEN 'SET DEFAULT'
                        ELSE 'NO ACTION'
                    END;

        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tabel, fk.conname);

        EXECUTE format(
            'SELECT count(*) FROM %s x WHERE x.%I IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM internal.users u WHERE u.id = x.%I)',
            tabel, kolom, kolom
        ) INTO yatim;

        IF yatim > 0 THEN
            IF nullable THEN
                EXECUTE format(
                    'UPDATE %s x SET %I = NULL WHERE x.%I IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM internal.users u WHERE u.id = x.%I)',
                    tabel, kolom, kolom, kolom
                );
                RAISE NOTICE '0039: %.% — % pelaku yatim di-NULL-kan (barisnya dipertahankan)', tabel, kolom, yatim;
            ELSE
                EXECUTE format(
                    'DELETE FROM %s x WHERE x.%I IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM internal.users u WHERE u.id = x.%I)',
                    tabel, kolom, kolom
                );
                RAISE NOTICE '0039: %.% — % baris yatim dihapus', tabel, kolom, yatim;
            END IF;
        END IF;

        -- ON DELETE SET NULL untuk kolom pelaku yang boleh kosong: menghapus
        -- seorang staf tidak boleh ikut menghapus transaksi yang pernah ia
        -- layani. Riwayat penjualan bertahan lebih lama daripada masa kerja.
        EXECUTE format(
            'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I)
                 REFERENCES internal.users(id) ON DELETE %s',
            tabel, fk.conname, kolom,
            CASE WHEN nullable THEN 'SET NULL' ELSE aksi_del END
        );

        dipindah := dipindah + 1;
    END LOOP;

    RAISE NOTICE '0039: % foreign key dipindahkan ke internal.users', dipindah;
END $$;


-- 3. VIEW KONTRAK YANG IKUT MENUNJUK TABEL LAMA --------------------------------
--
-- `contract.transaction_log` menjoin `users` untuk mengambil nama kasir. Selama
-- view itu ada, `pos.users` tidak bisa dilepas — dan itu memang yang diinginkan:
-- RESTRICT di bawah menolak menghapus tabel yang masih dipakai, bukan menyeret
-- view-nya ikut terhapus lewat CASCADE dan meninggalkan konsol tanpa data.
--
-- Dibangun ulang di sini terhadap `internal.users`. Perhatikan pergantian nama
-- kolom: `pos.users.name` menjadi `internal.users.full_name`.

DO $$
BEGIN
    IF to_regclass('pos.users') IS NULL THEN RETURN; END IF;

    DROP VIEW IF EXISTS contract.transaction_log CASCADE;

    CREATE VIEW contract.transaction_log AS
    SELECT x.id,
           x.tenant_id,
           x.merchant_id,
           m.name                                        AS merchant_name,
           x.outlet_id,
           o.name                                        AS outlet_name,
           x.invoice_number,
           x.business_sector,
           x.business_id,
           x.app_module,
           x.order_type,
           x.order_status,
           COALESCE(p.payment_method, x.payment_method)  AS payment_method,
           COALESCE(p.payment_status, x.payment_status)  AS payment_status,
           x.subtotal,
           x.discount_amount,
           x.tax_amount,
           x.service_charge_amount,
           x.total_amount,
           x.business_date,
           x.completed_at,
           x.cancelled_at,
           x.voided_at,
           x.shift_id,
           x.created_at,
           COALESCE(u.full_name, 'Kasir')                AS cashier_name,
           COALESCE(ti.item_count, 0)                    AS item_count
      FROM pos.transactions x
      JOIN internal.merchants m ON m.id = x.merchant_id
      LEFT JOIN internal.outlets o ON o.id = x.outlet_id
      LEFT JOIN internal.users u  ON u.id = x.cashier_user_id
      LEFT JOIN LATERAL (
          SELECT pay.payment_method, pay.payment_status
            FROM pos.payments pay
           WHERE pay.transaction_id = x.id
           ORDER BY pay.created_at DESC
           LIMIT 1
      ) p ON TRUE
      LEFT JOIN (
          SELECT ti2.transaction_id, COUNT(*)::int AS item_count
            FROM pos.transaction_items ti2
           GROUP BY ti2.transaction_id
      ) ti ON ti.transaction_id = x.id;

    COMMENT ON VIEW contract.transaction_log IS
        'Seluruh riwayat pesanan termasuk VOID/CANCELLED. Nama kasir dari internal.users (0039).';
END $$;

-- Hak baca dipulihkan: view yang dibuat ulang kehilangan grant lamanya, dan
-- konsol internal akan menjawab "permission denied" tanpa petunjuk sebab.
DO $$
DECLARE
    svc TEXT;
BEGIN
    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_billing', 'svc_ai', 'svc_internal', 'bi_readonly'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.transaction_log TO %I', svc);
        END IF;
    END LOOP;
END $$;


-- 4. MELEPAS TABEL LAMA --------------------------------------------------------

DO $$
DECLARE
    sisa INT;
BEGIN
    IF to_regclass('pos.users') IS NULL THEN RETURN; END IF;

    SELECT count(*)::int INTO sisa
      FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'pos.users'::regclass;

    IF sisa > 0 THEN
        RAISE EXCEPTION '0039: masih ada % foreign key menunjuk pos.users; dibatalkan.', sisa;
    END IF;

    EXECUTE 'DROP TABLE pos.users RESTRICT';
    RAISE NOTICE '0039: pos.users dihapus.';
END $$;


-- 5. PEMERIKSAAN AKHIR ---------------------------------------------------------

DO $$
DECLARE
    n INT;
BEGIN
    IF to_regclass('pos.users') IS NOT NULL THEN
        RAISE EXCEPTION '0039: pos.users masih ada setelah migrasi.';
    END IF;

    SELECT count(*)::int INTO n
      FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'internal.users'::regclass;

    RAISE NOTICE '0039: selesai — % foreign key kini menunjuk internal.users.', n;
END $$;
