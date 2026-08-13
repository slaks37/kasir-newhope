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

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL atau VITE_SUPABASE_ANON_KEY belum diisi. ' +
    'OAuth tidak akan berfungsi. Isi kedua nilai itu di .env lalu restart dev server.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      // Persist session di localStorage — user tidak perlu login ulang setiap
      // buka tab baru.
      persistSession: true,
      // Auto-refresh token sebelum kedaluwarsa.
      autoRefreshToken: true,
      // Deteksi session dari URL fragment setelah OAuth redirect.
      detectSessionInUrl: true,
    },
  }
);

/** True kalau konfigurasi Supabase sudah terisi (bukan placeholder). */
export const isSupabaseConfigured =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('placeholder');
