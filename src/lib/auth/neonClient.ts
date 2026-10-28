import type {AppAuthClient,AuthError,AuthEvent,AuthResult,Session,User} from './types';
import {secureSessionStorage} from '../../platform/runtime/secureSession';
export const NATIVE_BEARER_KEY='newhope-neon-auth-bearer-v1';
const NATIVE_STATE_KEY='newhope-neon-auth-pending-v1';
export const NATIVE_PKCE_KEY='newhope-auth-pkce-v1';
type Storage={getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void>};
export const setNativeBearer=(token:string)=>{if(!token||token.length>8192||/[\r\n]/.test(token))throw Error('INVALID_NATIVE_AUTH_TOKEN');return secureSessionStorage.setItem(NATIVE_BEARER_KEY,token);};
export const getNativeBearer=()=>secureSessionStorage.getItem(NATIVE_BEARER_KEY);
export const clearNativeBearer=()=>secureSessionStorage.removeItem(NATIVE_BEARER_KEY);
export interface NeonClientOptions {baseURL:string;appOrigin:string;native?:boolean;fetch:typeof fetch;storage?:Storage;redirect?:(url:string)=>void;now?:()=>number}
const failure=(code:string,status=503):AuthError=>({code,status,message:({AUTH_UNAVAILABLE:'Layanan autentikasi belum tersedia. Coba kembali.',AUTH_NOT_CONFIGURED:'Autentikasi belum dikonfigurasi.',MFA_REQUIRED:'Masukkan kode autentikator atau kode pemulihan.',AUTH_SESSION_REQUIRED:'Masuk kembali untuk melanjutkan.',IDENTITY_MAPPING_REQUIRED:'Identitas akun belum terhubung. Hubungi administrator.',INVALID_AUTH_RESPONSE:'Sesi belum dapat diverifikasi.',PASSWORD_REQUIRED:'Masukkan password akun untuk mengaktifkan autentikator.'} as Record<string,string>)[code]||'Autentikasi belum berhasil. Periksa data dan coba kembali.'});
function baseURL(options:NeonClientOptions){
 const url=new URL(options.baseURL),app=new URL(options.appOrigin);
 const local=url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.origin===app.origin;
 if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='/api/auth'||!options.native&&url.origin!==app.origin)throw Error('UNTRUSTED_AUTH_ORIGIN');
 return url.href.replace(/\/$/,'');
}
/** No provider SDK, no browser token storage, and no legacy-provider fallback. */
export function createNeonAuthClient(options:NeonClientOptions):AppAuthClient{
 const base=baseURL(options),storage=options.storage||secureSessionStorage,now=options.now||Date.now;
 let current:Session|null=null,timer:ReturnType<typeof setInterval>|undefined;
 const callbacks=new Set<(event:AuthEvent,session:Session|null)=>void>();
 const emit=(event:AuthEvent)=>{for(const fn of callbacks)fn(event,current);};
 const rawFetch=options.fetch;
 async function request(path:string,body?:unknown):Promise<{data:any;error:AuthError|null}>{
  if(!/^\/[a-z0-9/-]+(?:\?[a-zA-Z0-9=&%-]+)?$/.test(path))return {data:null,error:failure('INVALID_AUTH_RESPONSE')};
  const headers=new Headers({'Content-Type':'application/json'});
  try{
   if(options.native){const token=await storage.getItem(NATIVE_BEARER_KEY),pending=await storage.getItem(NATIVE_STATE_KEY);if(token)headers.set('Authorization','Bearer '+token);if(pending)headers.set('X-Newhope-Auth-State',pending);}
   const response=await rawFetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),credentials:options.native?'omit':'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(options.native){const pending=response.headers.get('x-newhope-auth-state');if(pending){if(pending.length>16384||/[\r\n]/.test(pending))throw Error('INVALID_NATIVE_AUTH_STATE');await storage.setItem(NATIVE_STATE_KEY,pending);}const token=response.headers.get('set-auth-token');if(token){if(token.length>8192||/[\r\n]/.test(token))throw Error('INVALID_NATIVE_AUTH_TOKEN');await storage.setItem(NATIVE_BEARER_KEY,token);}}
   const data=await response.json().catch(()=>null);
   if(!response.ok){const code=response.status>=500||response.status===429?'AUTH_UNAVAILABLE':typeof data?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(data.code)?data.code:typeof data?.error==='string'&&/^[A-Z0-9_]{1,80}$/.test(data.error)?data.error:response.status===401?'AUTH_SESSION_REQUIRED':'AUTH_REJECTED';return {data:null,error:failure(code,response.status)};}
   if(data===null)return {data:null,error:failure('INVALID_AUTH_RESPONSE')};
   return {data,error:null};
  }catch{return {data:null,error:failure('AUTH_UNAVAILABLE')};}
 }
 const result=(error:AuthError|null=null):AuthResult=>({data:{session:error?null:current,user:error?null:current?.user||null},error});
 async function restore(){
  const response=await request('/identity');
  if(response.error){if(response.error.code==='MFA_REQUIRED'){current=null;emit('MFA_REQUIRED');return {data:{session:null},error:response.error};}if(response.error.status===401){current=null;if(options.native){await storage.removeItem(NATIVE_BEARER_KEY);}emit('SIGNED_OUT');return {data:{session:null},error:null};}return {data:{session:null},error:response.error};}
  const value=response.data,expires=Date.parse(value?.session?.expiresAt);
  if(typeof value?.user?.id!=='string'||!value.user.id||!Number.isFinite(expires)||expires<=now()||!['aal1','aal2'].includes(value.session.aal))return {data:{session:null},error:failure('INVALID_AUTH_RESPONSE')};
  const user:User={id:value.user.id,email:typeof value.user.email==='string'?value.user.email:undefined,user_metadata:value.user.user_metadata&&typeof value.user.user_metadata==='object'?value.user.user_metadata:{},app_metadata:{provider:'neon'},twoFactorEnabled:value.user.twoFactorEnabled===true,passwordCredential:typeof value.user.passwordCredential==='boolean'?value.user.passwordCredential:undefined,providers:Array.isArray(value.user.providers)?value.user.providers.filter((v:unknown)=>typeof v==='string'):[],...(value.user.emailVerified?{email_confirmed_at:'verified',confirmed_at:'verified'}:{})};
  current={user,access_token:options.native?await storage.getItem(NATIVE_BEARER_KEY)||'':'',expires_at:Math.floor(expires/1000),expires_in:Math.max(0,Math.floor((expires-now())/1000)),token_type:options.native?'bearer':'cookie',aal:value.session.aal,mfaVerifiedAt:typeof value.session.mfaVerifiedAt==='number'?value.session.mfaVerifiedAt:undefined,sessionId:typeof value.session.id==='string'?value.session.id:undefined};
  if(options.native)await storage.removeItem(NATIVE_STATE_KEY);
  return {data:{session:current},error:null};
 }
 async function signIn(input:{email:string;password:string}){
  const response=await request('/sign-in/email',{...input,rememberMe:true});if(response.error)return result(response.error);
  if(response.data?.twoFactorRedirect)return result(failure('MFA_REQUIRED',401));
  const restored=await restore();if(restored.error)return result(restored.error);if(!restored.data.session)return result(failure('AUTH_SESSION_REQUIRED',401));emit('SIGNED_IN');return result();
 }
 const client:AppAuthClient={
  getSession:restore,
  async getUser(){const {data,error}=await restore();return {data:{user:data.session?.user||null},error};},
  signInWithPassword:signIn,
  async signUp(input){const response=await request('/sign-up/email',{email:input.email,password:input.password,name:String(input.options?.data?.full_name||input.email.split('@')[0]),callbackURL:input.options?.emailRedirectTo,onboarding:input.options?.data});if(response.error)return result(response.error);const restored=await restore();if(restored.error)return result(restored.error);if(restored.data.session)emit('SIGNED_IN');return result();},
  async signInWithOAuth(input){const response=await request('/sign-in/social',{provider:input.provider,callbackURL:input.options?.redirectTo,disableRedirect:true});if(response.error)return {data:{},error:response.error};try{const url=new URL(response.data?.url);if(url.protocol!=='https:'||url.username||url.password||url.hostname!=='accounts.google.com')throw Error('UNTRUSTED_OAUTH_URL');if(!input.options?.skipBrowserRedirect)(options.redirect||((target)=>window.location.assign(target)))(url.href);return {data:{url:url.href},error:null};}catch{return {data:{},error:failure('INVALID_AUTH_RESPONSE')};}},
  async signOut(input){const scope=input?.scope||'local',route=scope==='global'?'/revoke-sessions':scope==='others'?'/revoke-other-sessions':'/sign-out';const response=await request(route,{});if(response.error)return {error:response.error};if(scope==='others')return {error:null};if(options.native){await storage.removeItem(NATIVE_BEARER_KEY);await storage.removeItem(NATIVE_STATE_KEY);}current=null;emit('SIGNED_OUT');return {error:null};},
  async resetPasswordForEmail(email,opts){const {error}=await request('/request-password-reset',{email,redirectTo:opts?.redirectTo});return {error};},
  async updateUser(input){const token=typeof window!=='undefined'?new URL(window.location.href).searchParams.get('token'):null;if(!token)return {error:failure('INVALID_RECOVERY_TOKEN',400)};const {error}=await request('/reset-password',{newPassword:input.password,token});if(!error){current=null;if(options.native)await storage.removeItem(NATIVE_BEARER_KEY);emit('SIGNED_OUT');}return {error};},
  async exchangeCodeForSession(code){const verifier=await storage.getItem(NATIVE_PKCE_KEY);if(!options.native||!verifier)return {error:failure('INVALID_NATIVE_CALLBACK',400)};const response=await request('/native/exchange',{code,verifier});if(response.error)return {error:response.error};await storage.removeItem(NATIVE_PKCE_KEY);const restored=await restore();if(!restored.error&&restored.data.session)emit('SIGNED_IN');return {error:restored.error||(!restored.data.session?failure('AUTH_SESSION_REQUIRED',401):null)};},
  onAuthStateChange(callback){callbacks.add(callback);return {data:{subscription:{unsubscribe(){callbacks.delete(callback);}}}};},
  startAutoRefresh(){if(timer)return;timer=setInterval(()=>{if(typeof document!=='undefined'&&document.hidden)return;void restore().then(({error,data})=>{if(!error&&data.session)emit('TOKEN_REFRESHED');});},60000);(timer as any).unref?.();},
  stopAutoRefresh(){if(timer){clearInterval(timer);timer=undefined;}},
  mfa:{
   async listFactors(){const {data,error}=await restore();return {data:{totp:data.session?.user.twoFactorEnabled?[{id:'neon-totp',friendly_name:'New Hope',status:'verified'}]:[]},error};},
   async enroll(input){const empty={id:'',totp:{qr_code:'',secret:''}};if(!input.password&&current?.user.passwordCredential!==false)return {data:empty,error:failure('PASSWORD_REQUIRED',400)};const response=await request('/two-factor/enable',{password:input.password,issuer:'New Hope'});if(response.error)return {data:empty,error:response.error};try{const uri=new URL(response.data.totpURI);if(uri.protocol!=='otpauth:'||!uri.searchParams.get('secret'))throw Error();return {data:{id:'neon-totp',totp:{qr_code:'',secret:uri.searchParams.get('secret')!},backupCodes:Array.isArray(response.data.backupCodes)?response.data.backupCodes:[]},error:null};}catch{return {data:empty,error:failure('INVALID_AUTH_RESPONSE')};}},
   async challengeAndVerify(input){const response=await request(input.recovery?'/two-factor/verify-backup-code':'/two-factor/verify-totp',{code:input.code,trustDevice:false});if(response.error)return {error:response.error};const restored=await restore();if(restored.error)return {error:restored.error};if(!restored.data.session)return {error:failure('AUTH_SESSION_REQUIRED',401)};emit('SIGNED_IN');return {error:null};},
  },
 };
 return client;
}
