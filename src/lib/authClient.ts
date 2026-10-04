import { AuthClient } from '@supabase/auth-js';

/**
 * Klien Auth Supabase tanpa storage/postgrest/realtime/functions.
 *
 * Konfigurasinya harus identik dengan `createClient(url, key).auth` dari
 * supabase-js: storage key yang berbeda berarti sesi tersimpan tidak terbaca
 * dan semua pengguna ter-logout. `scripts/dev/test-auth-client.ts` menjaganya.
 */
export function createAuthClient(url: string, key: string) {
  const baseUrl = new URL(url.endsWith('/') ? url : `${url}/`);
  return new AuthClient({
    url: new URL('auth/v1', baseUrl).href,
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    storageKey: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`,
    // Persist session di localStorage — user tidak perlu login ulang setiap buka tab baru.
    persistSession: true,
    // Auto-refresh token sebelum kedaluwarsa.
    autoRefreshToken: true,
    // Deteksi session dari URL fragment setelah OAuth redirect / tautan reset.
    detectSessionInUrl: true,
    flowType: 'implicit',
  });
}
