import {isNative,assertNativeFinancialReady} from '../platform/runtime/platform';
import {apiTarget} from '../platform/runtime/apiPolicy';
import {isAuthConfigured,authRuntime} from './authRuntime';

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
    // Auth has its own exact-origin client and CSRF boundary. It must not recurse into session restoration.
    if(url.pathname.startsWith('/api/auth/'))return nativeFetch(input instanceof Request?new Request(url,input):url,{...init,redirect:'error',...(isNative()?{credentials:'omit' as const}:{})});
    if(isNative()&&!['GET','HEAD','OPTIONS'].includes(method))assertNativeFinancialReady();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (isAuthConfigured && !headers.has('authorization')) {
      const {data,error}=await authRuntime.auth.getSession();if(error)throw Error(error.code||'AUTH_UNAVAILABLE');
      if(data.session?.offlineRecovery)throw Error('OFFLINE_UI_ONLY');
      if (data.session?.access_token) headers.set('authorization', `Bearer ${data.session.access_token}`);
    }
    const request=input instanceof Request?new Request(url,input):url;
    return nativeFetch(request, { ...init, headers, redirect:'error', ...(isNative()?{credentials:'omit' as const}:{}) });
  };
}
