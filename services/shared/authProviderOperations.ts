import type {Request} from 'express';
import type {Db} from './db';
import {authProvider,getAuthConfig} from './betterAuthConfig';
import {resolveProviderIdentity,resolveAuthIdentity} from './authIdentity';

export interface OwnerIdentity {email:string;verified:boolean}
export interface AuthProviderOperations {
 provider:'supabase'|'neon';configured:boolean;
 ownerIdentity(canonicalSubject:string):Promise<OwnerIdentity|null>;
 sendConfirmation(email:string):Promise<void>;
 sendReset(email:string):Promise<void>;
 reauthenticate(req:Pick<Request,'headers'>,canonicalSubject:string,password:string|undefined,verifiedEmail?:string):Promise<boolean>;
}
export class AuthOperationError extends Error {constructor(readonly status:number,code:string){super(code);}}
type Runtime={auth:{api:{getSession(options:any):Promise<any>;verifyPassword(options:any):Promise<any>;requestPasswordReset(options:any):Promise<any>;sendVerificationEmail(options:any):Promise<any>}};pool:Pick<Db,'query'>};
export interface AuthOperationsDependencies {
 provider?:'supabase'|'neon';
 config?:()=>{baseUrl:string};
 runtime?:()=>Promise<Runtime>;
 reverse?:(db:Pick<Db,'query'>,issuer:string,canonical:string)=>Promise<string|null>;
 resolve?:(db:Pick<Db,'query'>,issuer:string,providerSubject:string,email:string)=>Promise<string|null>;
 legacy?:()=>Promise<AuthProviderOperations>;
 configured?:boolean;
}
const canonicalUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(error:unknown,code:string)=>{const e=error as {status?:number|string;statusCode?:number};return new AuthOperationError(e?.status===429||e?.statusCode===429||e?.status==='TOO_MANY_REQUESTS'?429:502,code);};
const headersFor=(req:Pick<Request,'headers'>)=>{
 const headers=new Headers();for(const key of ['authorization','cookie']){const value=req.headers[key];if(typeof value==='string')headers.set(key,value);}return headers;
};

/** Provider selection is explicit. A Neon outage never retries against legacy Auth. */
export function createAuthProviderOperations(deps:AuthOperationsDependencies={}):AuthProviderOperations {
 const provider=deps.provider||authProvider();
 if(provider==='supabase'){
  let operation:Promise<AuthProviderOperations>|undefined;
  const legacy=()=>operation??=(deps.legacy?deps.legacy():import('./legacyAuthOperations').then(m=>m.createLegacyAuthOperations()));
  return {provider,configured:deps.configured??!!((process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL)&&process.env.SUPABASE_SERVICE_ROLE_KEY),
   ownerIdentity:async s=>(await legacy()).ownerIdentity(s),sendConfirmation:async e=>(await legacy()).sendConfirmation(e),sendReset:async e=>(await legacy()).sendReset(e),reauthenticate:async(...args)=>(await legacy()).reauthenticate(...args)};
 }
 const config=deps.config||getAuthConfig;
 const runtime:()=>Promise<Runtime>=deps.runtime||(async()=>{const m=await import('./betterAuth'),runtime=m.getBetterAuthRuntime();await runtime.ready;return runtime as unknown as Runtime;});
 const reverse=deps.reverse||((db,issuer,canonical)=>resolveProviderIdentity(db,{provider:'better-auth',issuer,canonicalSubject:canonical}));
 const resolve=deps.resolve||((db,issuer,subject,email)=>resolveAuthIdentity(db,{provider:'better-auth',issuer,subject,email,isEmailVerified:true}));
 let configured=false;try{configured=!!config().baseUrl;}catch{/* Explicit unavailable state; never legacy fallback. */}
 return {provider,configured:deps.configured??configured,
  async ownerIdentity(canonical){
   if(!canonicalUuid.test(canonical))return null;
   try{const {pool}=await runtime(),subject=await reverse(pool,config().baseUrl,canonical);if(!subject)return null;
    const row=(await pool.query('SELECT id,email,"emailVerified","isActive" FROM newhope_auth."user" WHERE id=$1',[subject])).rows[0];
    return row?.id===subject&&row.isActive===true&&typeof row.email==='string'?{email:row.email,verified:row.emailVerified===true}:null;
   }catch{throw new AuthOperationError(502,'OWNER_LOOKUP_FAILED');}
  },
  async sendConfirmation(email){
   try{const {auth}=await runtime();await auth.api.sendVerificationEmail({body:{email,callbackURL:new URL('/login',config().baseUrl).href}});}
   catch(error){throw failure(error,'EMAIL_CONFIRMATION_PROVIDER_REJECTED');}
  },
  async sendReset(email){
   try{const {auth}=await runtime();await auth.api.requestPasswordReset({body:{email,redirectTo:new URL('/reset-password',config().baseUrl).href}});}
   catch(error){throw failure(error,'PASSWORD_RESET_PROVIDER_REJECTED');}
  },
  async reauthenticate(req,canonical,password){
   if(!canonicalUuid.test(canonical)||password!==undefined&&(typeof password!=='string'||password.length>1024))return false;
   try{const {auth,pool}=await runtime(),headers=headersFor(req),session=await auth.api.getSession({headers,query:{disableCookieCache:true}});
    if(!session?.user?.id||session.user.emailVerified!==true||session.user.isActive!==true)return false;
    const mapped=await resolve(pool,config().baseUrl,session.user.id,session.user.email);if(mapped!==canonical)return false;
    const account=(await pool.query(`SELECT
      EXISTS(SELECT 1 FROM newhope_auth.account WHERE "userId"=$1 AND "providerId"='credential' AND password IS NOT NULL AND length(password)>0) AS has_password,
      EXISTS(SELECT 1 FROM newhope_auth.account WHERE "userId"=$1 AND "providerId"='google') AS google_account`,[session.user.id])).rows[0];
    if(account?.has_password===true){if(!password)return false;return (await auth.api.verifyPassword({headers,body:{password}}))?.status===true;}
    // Google-only owners cannot provide a password that does not exist. A
    // live account plus fresh official TOTP proof is the alternate reauth;
    // recovery codes, stale sessions and client-supplied aal never qualify.
    if(account?.google_account!==true||session.user.twoFactorEnabled!==true||!session.session?.id)return false;
    return (await pool.query(`SELECT 1 AS fresh FROM newhope_auth.mfa_session_proofs
      WHERE session_id=$1 AND user_id=$2 AND method='totp'
        AND verified_at>now()-interval '5 minutes' AND verified_at<=now()+interval '30 seconds'`,[session.session.id,session.user.id])).rows.length===1;
   }catch(error){if(['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN'].includes((error as {status?:string})?.status||''))return false;throw new AuthOperationError(503,'OWNER_REAUTHENTICATION_UNAVAILABLE');}
  },
 };
}
