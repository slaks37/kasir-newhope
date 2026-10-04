/**
 * Klien Supabase — satu instance untuk seluruh frontend.
 *
 * KEDUA kunci ini WAJIB diawali `VITE_` agar Vite mengirimnya ke browser.
 * Tanpa prefiks itu, `import.meta.env.VITE_*` selalu `undefined` dan Supabase
 * gagal terhubung tanpa pesan error yang berguna.
 *
 * Nilai diambil dari `.env` (atau `.env.local`):
 *   VITE_SUPABASE_URL=https://xxxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJhbGci...
 */

import { createAuthClient } from './authClient';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL atau VITE_SUPABASE_ANON_KEY belum diisi. ' +
    'OAuth tidak akan berfungsi. Isi kedua nilai itu di .env lalu restart dev server.'
  );
}

/**
 * Frontend hanya memakai `supabase.auth`. Klien dibuat dari @supabase/auth-js
 * supaya storage/postgrest/realtime/functions tidak ikut ke bundle setiap halaman.
 */
export const supabase = {
  auth: createAuthClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-key'),
};

/** True kalau konfigurasi Supabase sudah terisi (bukan placeholder). */
export const isSupabaseConfigured =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('placeholder');
