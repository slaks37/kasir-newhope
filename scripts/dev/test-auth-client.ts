// The auth-only browser client must read and write the same session as supabase-js createClient.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createAuthClient } from '../../src/lib/authClient';

const config = (auth: any) => ({
  url: auth.url,
  storageKey: auth.storageKey,
  apikey: auth.headers.apikey,
  authorization: auth.headers.Authorization,
  persistSession: auth.persistSession,
  autoRefreshToken: auth.autoRefreshToken,
  detectSessionInUrl: auth.detectSessionInUrl,
  flowType: auth.flowType,
});

for (const url of ['https://abcdefghijkl.supabase.co', 'https://abcdefghijkl.supabase.co/', 'http://127.0.0.1:54321', 'https://auth.kasir.example']) {
  const key = 'anon-key-' + url.length;
  const reference = config((createClient(url, key) as any).auth);
  assert.deepEqual(config(createAuthClient(url, key)), reference, url);
}

// A session saved by the old client is visible to the new one (same storage, same key).
const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: 'access', refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: { id: 'u1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const legacy = (createClient('https://abcdefghijkl.supabase.co', 'k', { auth: { storage, autoRefreshToken: false } }) as any).auth;
store.set(legacy.storageKey, JSON.stringify(session));
const current = createAuthClient('https://abcdefghijkl.supabase.co', 'k') as any;
current.storage = storage;
const { data } = await current.getSession();
assert.equal(data.session?.access_token, 'access', 'Existing logins survive the client switch');
console.log('PASS: auth-only client matches supabase-js storage key, endpoint, headers and options; existing sessions stay signed in');
