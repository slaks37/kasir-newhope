import type {AppAuthClient,AuthEvent,Session} from './auth/types';
import {createNeonAuthClient} from './auth/neonClient';
import {isNative} from '../platform/runtime/platform';
export {setNativeBearer,getNativeBearer,clearNativeBearer,NATIVE_PKCE_KEY} from './auth/neonClient';
const env=import.meta.env||{};
/** Production keeps its existing provider until explicitly selected for cutover. */
export const authProvider=env.VITE_AUTH_PROVIDER||'supabase';
export const isNeonAuth=authProvider!=='supabase';
const authURL=String(env.VITE_NEWHOPE_AUTH_URL||'');
export const isAuthConfigured=authProvider==='neon'?Boolean(authURL):authProvider==='supabase'&&Boolean(env.VITE_SUPABASE_URL&&env.VITE_SUPABASE_ANON_KEY&&!env.VITE_SUPABASE_URL.includes('placeholder'));
const rawFetch=(...args:Parameters<typeof fetch>)=>capturedFetch(...args);
const capturedFetch=globalThis.fetch?.bind(globalThis);
let client:Promise<AppAuthClient>|undefined;
function selected():Promise<AppAuthClient>{
 return client??=Promise.resolve().then(async()=>{
  if(authProvider==='neon')return createNeonAuthClient({baseURL:authURL,appOrigin:window.location.origin,native:isNative(),fetch:rawFetch});
  if(authProvider==='supabase')return (await import('./supabase')).supabase.auth as unknown as AppAuthClient;
  throw Error('AUTH_PROVIDER_NOT_SUPPORTED');
 });
}
const invoke=<K extends keyof AppAuthClient>(key:K,...args:any[])=>selected().then(c=>(c[key] as any)(...args));
const auth:AppAuthClient={
 getSession:()=>invoke('getSession'),getUser:()=>invoke('getUser'),signInWithPassword:(v)=>invoke('signInWithPassword',v),signUp:(v)=>invoke('signUp',v),signInWithOAuth:(v)=>invoke('signInWithOAuth',v),signOut:(v)=>invoke('signOut',v),resetPasswordForEmail:(email,v)=>invoke('resetPasswordForEmail',email,v),updateUser:(v)=>invoke('updateUser',v),exchangeCodeForSession:(v)=>invoke('exchangeCodeForSession',v),
 onAuthStateChange(callback:(event:AuthEvent,session:Session|null)=>void){let active=true,unsubscribe:(()=>void)|undefined;void selected().then(c=>{if(active)unsubscribe=c.onAuthStateChange(callback).data.subscription.unsubscribe;}).catch(()=>{});return {data:{subscription:{unsubscribe(){active=false;unsubscribe?.();}}}};},
 startAutoRefresh(){void selected().then(c=>c.startAutoRefresh()).catch(()=>{});},stopAutoRefresh(){void selected().then(c=>c.stopAutoRefresh()).catch(()=>{});},
 mfa:{listFactors:()=>selected().then(c=>c.mfa.listFactors()),enroll:(v)=>selected().then(c=>c.mfa.enroll(v)),challengeAndVerify:(v)=>selected().then(c=>c.mfa.challengeAndVerify(v))},
};
export const authRuntime={auth};
/** Cookies authenticate web sessions; only native sessions need a Bearer header. */
export const authHeaders=(session:Session):Record<string,string>=>session.access_token?{Authorization:'Bearer '+session.access_token}:{};
export const authSessionKey=(session:Session)=>JSON.stringify([session.user.id,session.sessionId||session.access_token,session.aal,session.mfaVerifiedAt]);
