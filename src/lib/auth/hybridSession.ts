import type {Session} from '@supabase/auth-js';
/** Preserve the exact source session/UUID. Metadata supplies display labels only. */
export async function prepareHybridSession(session:Session|null){
 if(import.meta.env.VITE_NEON_DB_PHASE1!=='1'||!session||navigator.onLine===false)return session;
 const response=await fetch('/api/v1/sync/hybrid-onboarding',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(session.user.user_metadata||{}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('HYBRID_ACCOUNT_SETUP_UNAVAILABLE');
 return session;
}
