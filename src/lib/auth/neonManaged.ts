import {signUpManagedEmail} from './managedSignup';
import {saveManagedOfflineProfile,clearManagedOfflineProfile} from './neonOffline';
import {createAuthClient} from '@neondatabase/auth';
import {SupabaseAuthAdapter,BetterAuthVanillaAdapter} from '@neondatabase/auth/vanilla/adapters';
import type {GoTrueClient,Session} from '@supabase/auth-js';
const url=import.meta.env.VITE_NEON_AUTH_URL as string|undefined;
if(import.meta.env.VITE_AUTH_PROVIDER==='neon'&&(!url||!/^https:\/\/ep-(twilight-moon-azqj69l8|flat-recipe-azti3hh0)\.neonauth\.c-3\.ap-southeast-1\.aws\.neon\.tech\/neondb\/auth$/.test(url)))throw Error('NEON_MANAGED_FRONTEND_TARGET_REQUIRED');
// API-shape compatibility only: every operation goes to managed Neon, never
// Supabase or an application-hosted Better Auth server.
export const managedAuth=url?createAuthClient(url,{adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include'}})}):null;
export function createManagedNeonClient(){
 if(!url)throw Error('NEON_MANAGED_URL_REQUIRED');
 // Normalize the SDK's nested compatibility types at this boundary.
 const sdk=createAuthClient(url,{adapter:SupabaseAuthAdapter({fetchOptions:{credentials:'include'}})}) as unknown as GoTrueClient;
 sdk.signUp=async credentials=>{
  const info='options' in credentials?credentials.options?.data:undefined;
  localStorage.setItem('nh-neon-pending-onboarding',JSON.stringify(info||{}));
  if(!('email' in credentials) || !credentials.email || !credentials.password)return {data:{user:null,session:null},error:{message:'Email dan password wajib diisi.'} as import('@supabase/auth-js').AuthError};
  return signUpManagedEmail(input=>managedAuth!.signUp.email(input),()=>sdk.getSession(),credentials);
 };
 return sdk;
}
export async function prepareManagedSession(session:Session|null){
 if(!session || navigator.onLine===false)return session;
 const r=await fetch('/api/v1/sync/neon-onboarding',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:localStorage.getItem('nh-neon-pending-onboarding')||'{}',signal:AbortSignal.timeout(20000)});
 if(!r.ok){if([401,403].includes(r.status))clearManagedOfflineProfile();throw Error('NEON_ACCOUNT_SETUP_UNAVAILABLE');}
 localStorage.removeItem('nh-neon-pending-onboarding');saveManagedOfflineProfile(session.user);return session;
}
