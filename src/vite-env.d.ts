/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER?: 'supabase'|'better-auth'|'neon';
  readonly VITE_BETTER_AUTH_URL?:string;
  readonly VITE_NEON_AUTH_URL?:string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
