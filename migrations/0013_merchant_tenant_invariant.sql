-- =============================================================================
-- 0013_merchant_tenant_invariant.sql
--
-- Mengunci kenyataan bahwa `merchant_id` dan `tenant_id` adalah SINONIM.
--
-- INI BUKAN PERBAIKAN AKHIRNYA. Perbaikan akhirnya adalah membuang salah satu
-- kolom, dan itu menuntut satu keputusan produk yang belum diambil:
--
--   Apakah satu akun boleh memiliki BEBERAPA merchant?
--
--   - Tidak  -> keduanya memang sinonim selamanya. Buang `merchant_id`,
--               sisakan `tenant_id`, dan seluruh domain 0003/0004 ikut ringkas.
--   - Ya     -> `merchants` harus menjadi tabel tersendiri SEKARANG, sebelum
--               ada data produksi. `business_id` (`userId_sector`) sudah
--               menyiratkan arah ini.
--
-- Sampai keputusan itu diambil, yang berbahaya bukan duplikasinya — melainkan
-- tidak adanya yang mencegah keduanya MENYIMPANG. Dua kolom yang seharusnya
-- sama tapi diam-diam berbeda menghasilkan merchant yang punya dua identitas:
-- transaksinya di satu id, kreditnya di id lain, dan tidak ada satu pun error
-- yang muncul. Kerusakan seperti itu baru ketahuan berbulan-bulan kemudian,
-- saat angkanya sudah tidak bisa direkonsiliasi.
--
-- Ditinjau saat migrasi ini ditulis: SETIAP penulisan di seluruh repo mengisi
-- keduanya dari satu parameter yang sama (`VALUES ($1, $1, ...)`) — wallet.ts,
-- ai_query_logs, activity.ts, seed, dan ketiga batch job. Jadi batasan ini
-- hanya menuliskan apa yang sudah benar hari ini.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0013_merchant_tenant_invariant.sql
--
-- Idempoten, aman diulang.
-- =============================================================================


-- NOT VALID, pola yang sama seperti foreign key di 0011.
--
-- Baris lama yang terlanjur menyimpang TIDAK menghalangi migrasi ini — kalau
-- ada, justru itu temuan yang perlu ditangani sendiri, bukan alasan menunda
-- penjagaan untuk penulisan baru. Semua INSERT dan UPDATE setelah ini langsung
-- diperiksa.
--
-- Untuk memvalidasi baris lama nanti (akan gagal bila ada yang menyimpang):
--   ALTER TABLE ai.merchant_ai_credits VALIDATE CONSTRAINT ck_credits_merchant_is_tenant;

DO $$
DECLARE
    -- skema, tabel, nama batasan
    specs TEXT[][] := ARRAY[
        ['ai',       'daily_merchant_insights', 'ck_insights_merchant_is_tenant'],
        ['ai',       'merchant_targets',        'ck_targets_merchant_is_tenant'],
        ['ai',       'merchant_ai_credits',     'ck_credits_merchant_is_tenant'],
        ['ai',       'ai_query_logs',           'ck_query_logs_merchant_is_tenant'],
        ['internal', 'feature_usage_events',    'ck_feature_events_merchant_is_tenant'],
        ['internal', 'merchant_health_logs',    'ck_health_merchant_is_tenant'],
        ['pos',      'merchant_activity_log',   'ck_activity_merchant_is_tenant']
    ];
    s   TEXT[];
    sch TEXT;
    tbl TEXT;
    con TEXT;
BEGIN
    FOREACH s SLICE 1 IN ARRAY specs LOOP
        sch := s[1]; tbl := s[2]; con := s[3];

        CONTINUE WHEN to_regclass(sch || '.' || tbl) IS NULL;
        CONTINUE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = con);

        -- Kolomnya nullable di beberapa tabel (log audit sengaja SET NULL saat
        -- merchantnya dihapus), jadi NULL harus lolos. `IS NOT DISTINCT FROM`
        -- memperlakukan NULL = NULL sebagai benar; `=` biasa menghasilkan NULL
        -- dan batasan CHECK meloloskan NULL — kebetulan hasilnya sama, tapi
        -- yang pertama menyatakan maksudnya.
        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I '
            'CHECK (merchant_id IS NOT DISTINCT FROM tenant_id) NOT VALID',
            sch, tbl, con
        );
        RAISE NOTICE '0013: %.% dijaga oleh %', sch, tbl, con;
    END LOOP;
END $$;


COMMENT ON COLUMN ai.merchant_ai_credits.tenant_id IS
    'Selalu sama dengan merchant_id — dijaga ck_credits_merchant_is_tenant sejak 0013. Salah satunya harus dibuang begitu diputuskan apakah satu akun boleh punya banyak merchant.';
