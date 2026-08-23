import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Tambahkan access token hanya ke API milik origin ini. Satu tempat ini
 * mencegah endpoint baru terlupa membawa Authorization header.
 */
export function installAuthenticatedFetch(): void {
  if (typeof window === 'undefined' || !isSupabaseConfigured) return;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    if (!headers.has('authorization')) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers.set('authorization', `Bearer ${data.session.access_token}`);
    }
    return nativeFetch(input, { ...init, headers });
  };
}
