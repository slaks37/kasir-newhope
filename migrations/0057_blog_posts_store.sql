-- Blog store for the server-rendered blog and the automation API.
-- 0042 created the table only on databases migrated with `npm run db:migrate`;
-- Supabase production never received it (public blog API answered 500).
-- Idempotent: creates what is missing, never touches existing rows.
CREATE TABLE IF NOT EXISTS public.blog_posts (
    id                   TEXT PRIMARY KEY,
    slug                 TEXT UNIQUE NOT NULL,
    title                TEXT NOT NULL,
    excerpt              TEXT,
    content              TEXT NOT NULL,
    category             TEXT NOT NULL,
    cover_image          TEXT,
    author_name          TEXT NOT NULL DEFAULT 'Tim Editorial New Hope POS',
    author_role          TEXT NOT NULL DEFAULT 'Business Consultant',
    author_avatar        TEXT,
    reading_time_minutes INTEGER NOT NULL DEFAULT 5,
    tags                 TEXT[] NOT NULL DEFAULT '{}',
    media_embeds         JSONB NOT NULL DEFAULT '[]'::jsonb,
    seo                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_published         BOOLEAN NOT NULL DEFAULT true,
    is_featured          BOOLEAN NOT NULL DEFAULT false,
    view_count           INTEGER NOT NULL DEFAULT 0,
    likes_count          INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON public.blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON public.blog_posts(is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_title_lower ON public.blog_posts(lower(title));

-- public.* is exposed by Supabase's REST API: browsers must not read or write it directly.
-- The server (table owner / service roles) is the only path, through the API in src/server/blogRoutes.ts.
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.blog_posts FROM %I', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['svc_internal','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_posts TO %I', r);
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'blog_posts' AND policyname = 'blog_posts_server_' || r) THEN
        EXECUTE format('CREATE POLICY %I ON public.blog_posts FOR ALL TO %I USING (true) WITH CHECK (true)', 'blog_posts_server_' || r, r);
      END IF;
    END IF;
  END LOOP;
END $$;
