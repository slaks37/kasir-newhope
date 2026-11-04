import {isNative,assertNativeFinancialReady} from '../platform/runtime/platform';
import {apiTarget} from '../platform/runtime/apiPolicy';
import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Tambahkan access token hanya ke API milik origin ini. Satu tempat ini
 * mencegah endpoint baru terlupa membawa Authorization header.
 */
export function installAuthenticatedFetch(): void {
  if (typeof window === 'undefined') return;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url=apiTarget(rawUrl,window.location.href,isNative(),import.meta.env.VITE_NATIVE_API_ORIGIN||'');
    if(!url)return nativeFetch(input,init);
    const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(isNative()&&!['GET','HEAD','OPTIONS'].includes(method))assertNativeFinancialReady();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (isSupabaseConfigured && !headers.has('authorization')) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers.set('authorization', `Bearer ${data.session.access_token}`);
    }
    const request=input instanceof Request?new Request(url,input):url;
    return nativeFetch(request, { ...init, headers, redirect:'error', ...(isNative()?{credentials:'omit' as const}:{}) });
  };
}
