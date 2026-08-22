-- =============================================================================
-- 0031_blog_publik.sql
--
-- BLOG PINDAH DARI localStorage KE DATABASE.
--
-- Panel CMS blog menyimpan artikelnya di localStorage peramban. Tiga akibatnya,
-- dan yang ketiga paling mengejutkan:
--
--   1. MANAGE_PUBLIC_CONTENT tidak bisa ditegakkan. Tidak ada permintaan ke
--      server, jadi tidak ada tempat memeriksanya selain menyembunyikan menu —
--      penjagaan yang dilewati siapa pun yang menyunting bundel JavaScript.
--   2. Tidak ada yang bisa diaudit. Siapa menerbitkan apa, kapan, tidak
--      terekam di mana pun.
--   3. ARTIKELNYA TIDAK PERNAH SAMPAI KE PENGUNJUNG. Halaman blog publik
--      memuat konstanta bawaan, bukan yang ditulis admin. Menulis artikel di
--      panel terasa berhasil dan tidak menerbitkan apa pun; membersihkan data
--      peramban menghilangkan seluruh tulisan.
--
-- Blog adalah permukaan PUBLIK — yang dibaca calon pelanggan sebelum
-- memutuskan berlangganan — jadi ia tinggal di `internal`, milik backoffice,
-- bukan di `pos` yang per-merchant. Tidak ada business_id: artikel bukan milik
-- merchant mana pun.
--
--   psql "$DATABASE_URL" --single-transaction -f migrations/0031_blog_publik.sql
--
-- Idempoten, aman diulang.
-- =============================================================================

CREATE TABLE IF NOT EXISTS internal.blog_posts (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    slug                VARCHAR(160) NOT NULL UNIQUE,
    title               VARCHAR(240) NOT NULL,
    excerpt             TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL DEFAULT '',
    category            VARCHAR(60) NOT NULL,
    cover_image         TEXT,
    author              JSONB NOT NULL DEFAULT '{}'::jsonb,
    reading_time_minutes INT NOT NULL DEFAULT 1,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    media_embeds        JSONB NOT NULL DEFAULT '[]'::jsonb,
    seo                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_published        BOOLEAN NOT NULL DEFAULT FALSE,
    is_featured         BOOLEAN NOT NULL DEFAULT FALSE,
    view_count          INT NOT NULL DEFAULT 0,
    likes_count         INT NOT NULL DEFAULT 0,
    -- SIAPA yang terakhir menyentuhnya. Bukan pengganti internal_access_log —
    -- itu tetap jejak lengkapnya — melainkan supaya daftar artikel bisa
    -- menunjukkan penanggung jawabnya tanpa menggabungkan tabel audit.
    published_by        UUID REFERENCES internal.internal_users(id) ON DELETE SET NULL,
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_terbit
    ON internal.blog_posts (is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_kategori
    ON internal.blog_posts (category) WHERE is_published;

COMMENT ON TABLE internal.blog_posts IS
    'Artikel blog publik. Di skema internal karena pemiliknya backoffice dan isinya bukan milik merchant mana pun.';

-- Pengunjung hanya boleh melihat yang TERBIT. View ini yang dibaca halaman
-- publik, jadi draf tidak bisa bocor lewat endpoint yang lupa menyaring.
DROP VIEW IF EXISTS contract.blog_published CASCADE;
CREATE VIEW contract.blog_published AS
SELECT id, slug, title, excerpt, content, category, cover_image, author,
       reading_time_minutes, tags, media_embeds, seo, is_featured,
       view_count, likes_count, published_at, updated_at
  FROM internal.blog_posts
 WHERE is_published;

COMMENT ON VIEW contract.blog_published IS
    'Artikel yang BENAR-BENAR terbit. Halaman publik membaca dari sini supaya draf tidak bisa bocor lewat endpoint yang lupa menyaring is_published.';

DO $$
DECLARE
    svc TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_backoffice') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON internal.blog_posts TO svc_backoffice;
    END IF;
    -- Service lain hanya boleh melihat yang terbit, dan hanya lewat view.
    FOREACH svc IN ARRAY ARRAY['svc_pos','svc_ai','svc_billing'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.blog_published TO %I', svc);
        END IF;
    END LOOP;
END $$;
