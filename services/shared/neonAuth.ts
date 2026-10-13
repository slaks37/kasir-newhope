import {createRemoteJWKSet,jwtVerify,errors,type JWTVerifyGetKey} from 'jose';
import type {AuthPrincipal} from './auth';
import type {Db} from './db';
import {connectDb} from './db';
import {neonPilotConfig} from './neonPilot';

export class NeonAuthUnavailableError extends Error {}
let verifier: {url:string;key:JWTVerifyGetKey}|undefined;
let opening:Promise<Db>|undefined;
export async function verifyNeonToken(token:string,config=neonPilotConfig(),key?:JWTVerifyGetKey):Promise<AuthPrincipal|null> {
  if (!key) {
    if (verifier?.url!==config.jwksUrl) verifier={url:config.jwksUrl,key:createRemoteJWKSet(new URL(config.jwksUrl),{timeoutDuration:5000,cooldownDuration:30000})};
    key=verifier.key;
  }
  try {
    const {payload:p}=await jwtVerify(token,key,{issuer:config.issuer,audience:config.issuer,
      algorithms:['EdDSA'],requiredClaims:['sub','exp','iat'],maxTokenAge:'15m',clockTolerance:5});
    if (!p.sub || p.id!==p.sub || typeof p.email!=='string' || p.emailVerified!==true || p.banned===true) return null;
    // Managed Neon Auth has no MFA. Never derive admin authority from role,
    // user metadata, or alleged aal/amr claims, even on an otherwise valid JWT.
    return {subject:p.sub,email:p.email,isEmailVerified:true,aal:'aal1'};
  } catch(e) {
    if (e instanceof errors.JOSEError && !(e instanceof errors.JWKSTimeout)) return null;
    throw new NeonAuthUnavailableError('NEON_AUTH_UNAVAILABLE');
  }
}

/** A new verified identity receives an isolated UUID. Imported owners require
 * a reviewed issuer+subject binding. Matching email never claims an old tenant. */
export async function bindNeonIdentity(db:Db,p:AuthPrincipal,issuer:string):Promise<AuthPrincipal|null> {
  if (!p.isEmailVerified || !p.email) return null;
  const email=p.email;
  return db.tx(async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[issuer+':'+p.subject]);
    const live=(await c.query('SELECT id,email,"emailVerified",banned FROM neon_auth."user" WHERE id::text=$1',[p.subject])).rows[0];
    if(!live || !live.emailVerified || live.banned || live.email.toLowerCase()!==email.toLowerCase())return null;
    const binding=(await c.query(`SELECT b.canonical_user_id,b.is_active,u.is_active AS canonical_active
      FROM internal.auth_identity_bindings b JOIN internal.users u ON u.id=b.canonical_user_id
      WHERE b.provider='neon' AND b.issuer=$1 AND b.provider_subject=$2`,[issuer,p.subject])).rows[0];
    if(binding) return binding.is_active&&binding.canonical_active?{...p,subject:binding.canonical_user_id}:null;
    // Refuse both UUID and email collisions with restored Supabase users.
    const exists=(await c.query('SELECT 1 FROM internal.users WHERE id::text=$1 OR lower(email)=lower($2)',[p.subject,p.email])).rows.length;
    if(exists) return null;
    await c.query(`INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,$2,'Pemilik Toko',true)`,[p.subject,email.toLowerCase()]);
    await c.query(`INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,verification_ref)
      VALUES('neon',$1,$2::text,$2::uuid,'NEW_VERIFIED_ACCOUNT')`,[issuer,p.subject]);
    return p;
  });
}

export async function authenticateNeonBearer(token:string) {
  let config:ReturnType<typeof neonPilotConfig>;
  try {config=neonPilotConfig();}catch{throw new NeonAuthUnavailableError('NEON_CONFIG_UNAVAILABLE');}
  const p=await verifyNeonToken(token,config);
  if(!p)return null;
  try {
    opening??=connectDb({schema:'internal',max:2}).catch(e=>{opening=undefined;throw e;});
    return await bindNeonIdentity(await opening,p,config.issuer);
  } catch {throw new NeonAuthUnavailableError('NEON_IDENTITY_UNAVAILABLE');}
}

/** No password or upstream token is stored; upstream sessions are revoked.
 * Email is only the login input, not proof of ownership. */
export async function reauthenticateNeonOwner(db:Db,email:string,password:string,canonicalSubject:string) {
  const config=neonPilotConfig();
  let response:Response;
  try {response=await fetch(config.authUrl+'/sign-in/email',{method:'POST',headers:{'content-type':'application/json',origin:config.issuer},
    body:JSON.stringify({email,password}),redirect:'error',signal:AbortSignal.timeout(5000)});}
  catch {throw new NeonAuthUnavailableError('NEON_REAUTH_UNAVAILABLE');}
  if(response.status>=500 || response.status===429)throw new NeonAuthUnavailableError('NEON_REAUTH_UNAVAILABLE');
  if(!response.ok)return false;
  const data=await response.json();
  const cookies=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  try {
    if(data.user?.emailVerified!==true || typeof data.user?.id!=='string')return false;
    const binding=(await db.query(`SELECT canonical_user_id FROM internal.auth_identity_bindings
      WHERE provider='neon' AND issuer=$1 AND provider_subject=$2 AND is_active`,[config.issuer,data.user.id])).rows[0];
    return binding?.canonical_user_id===canonicalSubject;
  } finally {
    if(cookies)await fetch(config.authUrl+'/sign-out',{method:'POST',headers:{cookie:cookies,origin:config.issuer},
      redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
}
