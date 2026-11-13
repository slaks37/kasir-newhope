import type {AuthPrincipal} from './auth';
import {getBetterAuthRuntime} from './betterAuth';
import {getAuthConfig} from './betterAuthConfig';
import {resolveAuthIdentity} from './authIdentity';
import type {Db} from './db';
export class NeonIdentityError extends Error{constructor(readonly code:'MFA_REQUIRED'|'IDENTITY_MAPPING_REQUIRED'){super(code);}}
export async function neonSession(headers:Headers,runtime=getBetterAuthRuntime(),capture?:(headers:Headers)=>void){
 await runtime.ready;
 // A supplied bearer must stand on its own; never downgrade to another cookie session.
 const checked=new Headers(headers);if(checked.has('authorization'))checked.delete('cookie');
 const result=await runtime.auth.api.getSession({headers:checked,query:{disableCookieCache:true},returnHeaders:true});capture?.(result.headers);return result.response;
}
export async function resolveNeonSession(headers:Headers,options:{enroll?:boolean;requireMfa?:boolean}={},runtime=getBetterAuthRuntime()){
 let refreshHeaders=new Headers();const config=getAuthConfig(),session=await neonSession(headers,runtime,h=>{refreshHeaders=h;});
 if(!session?.user.emailVerified||!session.user.isActive)return null;
 const db=runtime.pool as unknown as Pick<Db,'query'>;
 let subject=await resolveAuthIdentity(db,{provider:'better-auth',issuer:config.baseUrl,subject:session.user.id,email:session.user.email,isEmailVerified:true});
 if(!subject&&options.enroll){await db.query('SELECT newhope_auth.enroll_new_identity($1,$2)',[session.user.id,config.baseUrl]);subject=await resolveAuthIdentity(db,{provider:'better-auth',issuer:config.baseUrl,subject:session.user.id,email:session.user.email,isEmailVerified:true});}
 if(!subject)throw new NeonIdentityError('IDENTITY_MAPPING_REQUIRED');
 const proof=(await db.query(`SELECT method,verified_at FROM newhope_auth.mfa_session_proofs WHERE session_id=$1 AND user_id=$2 AND method IN ('totp','recovery') AND verified_at<=now()+interval '30 seconds'`,[session.session.id,session.user.id])).rows[0];
 if(session.user.twoFactorEnabled&&!proof&&options.requireMfa!==false)throw new NeonIdentityError('MFA_REQUIRED');
 const principal:AuthPrincipal={subject,email:session.user.email,isEmailVerified:true,aal:proof?.method==='totp'?'aal2':'aal1',...(proof?.method==='totp'?{mfaVerifiedAt:new Date(proof.verified_at).getTime()/1000}:{})};
 return {session,principal,refreshHeaders};
}
export async function authenticateNeonRequest(req:{headers:Record<string,any>;method?:string}):Promise<AuthPrincipal|null>{
 const config=getAuthConfig(),headers=new Headers();
 for(const name of ['authorization','cookie'])if(typeof req.headers[name]==='string')headers.set(name,req.headers[name]);
 if(!headers.has('authorization')&&!headers.has('cookie'))return null;
 if(!headers.has('authorization')&&!['GET','HEAD','OPTIONS'].includes(req.method||'GET')&&!config.allowedOrigins.includes(String(req.headers.origin||'')))return null;
 try{return (await resolveNeonSession(headers))?.principal||null;}catch(error){if(error instanceof NeonIdentityError)return null;throw error;}
}
