import type {AuthPrincipal} from './auth';
import {getBetterAuthRuntime} from './betterAuth';
import {connectDb,type Db} from './db';
import {bindNeonIdentity} from './neonAuth';
import {betterAuthPilotConfig} from './betterAuthPilot';

export class BetterAuthUnavailableError extends Error {}
let opening:Promise<Db>|undefined;
export async function authenticateBetterBearer(token:string):Promise<AuthPrincipal|null> {
  try {
    const config=betterAuthPilotConfig(),{auth,pool}=getBetterAuthRuntime();
    const session=await auth.api.getSession({headers:new Headers({authorization:'Bearer '+token}),query:{disableCookieCache:true}});
    if(!session?.user.emailVerified || !session.user.isActive)return null;
    opening??=connectDb({schema:'internal',max:2}).catch(e=>{opening=undefined;throw e;});
    const p=await bindNeonIdentity(await opening,{subject:session.user.id,email:session.user.email,isEmailVerified:true,aal:'aal1'},config.baseUrl,'better-auth');
    if(!p)return null;
    if(session.user.twoFactorEnabled){
      const proof=(await pool.query('SELECT verified_at FROM newhope_auth.mfa_session_proofs WHERE session_id=$1 AND user_id=$2',[session.session.id,session.user.id])).rows[0];
      if(proof){p.aal='aal2';p.mfaVerifiedAt=new Date(proof.verified_at).getTime()/1000;}
    }
    return p;
  }catch(e){
    if((e as {status?:string})?.status==='UNAUTHORIZED')return null;
    throw new BetterAuthUnavailableError('BETTER_AUTH_UNAVAILABLE');
  }
}
export async function reauthenticateBetterOwner(token:string,password:string,canonicalSubject:string) {
  const {auth}=getBetterAuthRuntime();
  const headers=new Headers({authorization:'Bearer '+token});
  const principal=await authenticateBetterBearer(token);
  if(principal?.subject!==canonicalSubject)return false;
  try{return (await auth.api.verifyPassword({headers,body:{password}})).status===true;}
  catch(e){if(['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN'].includes((e as any)?.status))return false;throw new BetterAuthUnavailableError('BETTER_AUTH_REAUTH_UNAVAILABLE');}
}
