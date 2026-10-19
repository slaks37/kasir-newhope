import { isSupabaseConfigured, supabase, usesBetterAuth } from './supabase';
import {authenticatedTransport,betterBearerToken} from './auth/authenticatedTransport';

/**
 * Tambahkan access token hanya ke API milik origin ini. Satu tempat ini
 * mencegah endpoint baru terlupa membawa Authorization header.
 */
export function installAuthenticatedFetch(): void {
  if (typeof window === 'undefined' || !isSupabaseConfigured) return;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = authenticatedTransport(nativeFetch,window.location.origin,async()=>{
    // Native getSession performs remote auth + identity resolution. Repeating
    // that chain before EACH business read consumes its 15s AbortSignal budget
    // before the actual API request starts on a cold Preview. Attach the signed
    // native token directly; API middleware still verifies the live session.
    if(usesBetterAuth)return betterBearerToken(localStorage,window.location.origin);
    const {data}=await supabase.auth.getSession();
    return data.session?.access_token||'';
  });
}
