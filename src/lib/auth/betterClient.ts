import {createAuthClient} from 'better-auth/react';
import {twoFactorClient} from 'better-auth/client/plugins';
import {AuthError,type GoTrueClient,type Session,type AuthChangeEvent} from '@supabase/auth-js';
import {betterBearerToken} from './authenticatedTransport';

const canonicalOrigin=import.meta.env.VITE_BETTER_AUTH_URL as string|undefined;
const allowedOrigins=[canonicalOrigin,...String(import.meta.env.VITE_BETTER_AUTH_ALLOWED_ORIGINS||'').split(',')].filter((value):value is string=>Boolean(value)).map(value=>{
  const parsed=new URL(value);
  if(parsed.origin!==value||parsed.username||parsed.password)throw Error('BETTER_AUTH_INVALID_ALLOWED_ORIGIN');
  return parsed.origin;
});
if(import.meta.env.VITE_AUTH_PROVIDER==='better-auth'&&(!canonicalOrigin||!allowedOrigins.includes(window.location.origin)))throw Error('BETTER_AUTH_SAME_ORIGIN_REQUIRED');
// Both approved POS/admin hosts call their own auth endpoint. Canonical auth
// issuer and migration bindings remain server-owned; no arbitrary-host redirect.
const origin=canonicalOrigin?window.location.origin:undefined;
const key='nh-better-auth:'+origin;
const token=()=>betterBearerToken(localStorage,String(origin));
export const betterClient=createAuthClient({baseURL:origin,plugins:[twoFactorClient()],fetchOptions:{
  auth:{type:'Bearer',token},
  onSuccess:async context=>{const signed=context.response.headers.get('set-auth-token');if(signed)localStorage.setItem(key+':token',signed);},
}});
const listeners=new Set<(event:AuthChangeEvent,session:Session|null)=>void|Promise<void>>();
const emit=(event:AuthChangeEvent,session:Session|null)=>{for(const fn of listeners)queueMicrotask(()=>void fn(event,session));};
const error=(message:string)=>new AuthError(message);
let display:Session|null=null;
let reading:Promise<Session|null>|undefined;
function session():Promise<Session|null> {
  return reading??=(readSession().finally(()=>{reading=undefined;}));
}
async function readSession():Promise<Session|null> {
  if(navigator.onLine===false){
    try{const snapshot=JSON.parse(localStorage.getItem(key+':offline')||'null');
      if(snapshot&&Date.now()-snapshot.savedAt<86400000)return {...snapshot.session,access_token:'offline-better-auth-session',refresh_token:''};
    }catch{/* Device display hints confer no server authority. */}
    return null;
  }
  const current=await betterClient.getSession({query:{disableCookieCache:true}});
  if(current.error)throw error('Sesi belum dapat diperiksa. Coba lagi.');
  if(!current.data){display=null;localStorage.removeItem(key+':token');localStorage.removeItem(key+':offline');return null;}
  if(!current.data.user.emailVerified)throw error('Verifikasi email terlebih dahulu.');
  if(!token())throw error('Masuk kembali untuk memperoleh sesi yang ditandatangani.');
  const headers={authorization:'Bearer '+token()};
  const identity=await fetch('/api/v1/sync/identity',{headers});
  if(!identity.ok)throw error('Identitas akun perlu ditinjau.');
  const id=await identity.json();
  let metadata={};try{const saved=JSON.parse(localStorage.getItem(key+':pending')||'null');if(saved?.email===current.data.user.email)metadata=saved.data;}catch{/* display only */}
  // Imported admin/staff/owners retain existing scope. Only the authenticated
  // server can identify a genuinely new account eligible for owner onboarding.
  if(id.needsOnboarding===true) {
    const provision=await fetch('/api/v1/sync/neon-onboarding',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(metadata)});
    if(!provision.ok)throw error('Penyiapan akun memerlukan pemeriksaan migrasi.');
  }
  localStorage.removeItem(key+':pending');
  const mapped={access_token:token(),refresh_token:'',token_type:'bearer',expires_in:3600,
    expires_at:Math.floor(new Date(current.data.session.expiresAt).getTime()/1000),
    user:{id:id.subject,email:current.data.user.email,aud:'authenticated',created_at:new Date(current.data.user.createdAt).toISOString(),
      app_metadata:{},user_metadata:{full_name:current.data.user.name}}} as Session;
  display=mapped;
  localStorage.setItem(key+':offline',JSON.stringify({savedAt:Date.now(),session:{...mapped,access_token:'offline-better-auth-session'}}));
  return mapped;
}
export async function completeBetterTotp(code:string){
  const result=await betterClient.twoFactor.verifyTotp({code,trustDevice:false});
  if(result.error)throw error(result.error.message||'Kode autentikator tidak valid.');
  const mapped=await session();emit('SIGNED_IN',mapped);return mapped;
}
export async function completeBetterBackupCode(code:string){
  const result=await betterClient.twoFactor.verifyBackupCode({code,trustDevice:false});
  if(result.error)throw error('Kode pemulihan tidak valid atau sudah digunakan.');
  const mapped=await session();emit('SIGNED_IN',mapped);return mapped;
}
/** Compatibility at the UI boundary only. Server authority always comes from
 * live Better Auth sessions and the canonical identity registry in Neon. */
export function createBetterPilotClient():GoTrueClient {
  const methods={
    getSession:async()=>{try{return {data:{session:await session()},error:null};}catch(e){return {data:{session:null},error:e};}},
    getUser:async()=>{try{return {data:{user:(await session())?.user||null},error:null};}catch(e){return {data:{user:null},error:e};}},
    onAuthStateChange:(fn:(event:AuthChangeEvent,s:Session|null)=>void|Promise<void>)=>{
      listeners.add(fn);
      // Publish only the validated restored session. An immediate null event
      // would supersede the still-running restoration and log users out on reload.
      void session().then(s=>{if(listeners.has(fn))return fn('INITIAL_SESSION',s);}).catch(()=>{});
      return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
    signInWithPassword:async({email,password}:{email:string;password:string})=>{
      const result=await betterClient.signIn.email({email,password});
      if(result.error)return {data:{user:null,session:null},error:error(result.error.message||'Login gagal.')};
      if('twoFactorRedirect' in result.data && result.data.twoFactorRedirect){localStorage.removeItem(key+':token');return {data:{user:null,session:null},error:error('Masukkan kode autentikator pada panel MFA di bawah.')};}
      try{const s=await session();emit('SIGNED_IN',s);return {data:{user:s?.user||null,session:s},error:null};}
      catch(e){return {data:{user:null,session:null},error:e};}
    },
    signUp:async({email,password,options}:{email:string;password:string;options?:{data?:Record<string,string>}})=>{
      localStorage.setItem(key+':pending',JSON.stringify({email,data:options?.data||{}}));
      const r=await betterClient.signUp.email({email,password,name:options?.data?.full_name||email.split('@')[0],callbackURL:window.location.origin+'/login'});
      return {data:{user:null,session:null},error:r.error?error(r.error.message||'Registrasi gagal.'):null};
    },
    signOut:async()=>{
      if(navigator.onLine===false)return {error:error('Sambungkan internet untuk mencabut sesi server.')};
      const r=await betterClient.signOut();if(r.error)return {error:error('Logout belum berhasil. Coba lagi.')};
      display=null;for(const suffix of [':token',':offline',':pending'])localStorage.removeItem(key+suffix);emit('SIGNED_OUT',null);return {error:null};
    },
    resetPasswordForEmail:async(email:string)=>{const r=await betterClient.requestPasswordReset({email,redirectTo:window.location.origin+'/reset-password'});return {data:{},error:r.error?error('Permintaan reset belum berhasil.'):null};},
    signInWithOAuth:async()=>({data:{provider:'google',url:null},error:error('Login sosial belum diaktifkan pada lingkungan migrasi ini. Gunakan email dan password.')}),
    updateUser:async()=>({data:{user:null},error:error('Gunakan tautan reset password yang sah.')}),
  };
  return methods as unknown as GoTrueClient;
}
