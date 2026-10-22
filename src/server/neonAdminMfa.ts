import {randomBytes,createCipheriv,createDecipheriv,createHash,timingSafeEqual} from 'node:crypto';
import {TOTP,Secret} from 'otpauth';
import QRCode from 'qrcode';
import type {Db} from '../../services/shared/db';
import type {AuthPrincipal} from '../../services/shared/auth';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function key(){const k=Buffer.from(process.env.ADMIN_MFA_ENCRYPTION_KEY||'','base64');if(k.length!==32)throw Error('ADMIN_MFA_KEY_REQUIRED');return k;}
function encrypt(s:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);const body=Buffer.concat([c.update(s,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');}
function decrypt(s:string){const b=Buffer.from(s,'base64'),c=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');}
function otp(secret:string,email:string){return new TOTP({issuer:'New Hope Admin',label:email,algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(secret)});}
export async function withNeonAdminStepUp(db:Db,p:AuthPrincipal,req:any){
 const proof=req.headers['x-newhope-admin-mfa'];if(typeof proof!=='string'||!/^[a-f0-9]{64}$/.test(proof))return p;
 const bearer=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||''))?.[1];if(!bearer)return p;
 const row=(await db.query(`SELECT s.verified_at FROM internal.admin_mfa_sessions s
 JOIN internal.admin_mfa_factors f ON f.subject=s.subject AND f.verified_at IS NOT NULL
 WHERE s.token_hash=$1 AND s.subject=$2 AND s.bearer_hash=$3 AND s.expires_at>clock_timestamp()`,[hash(proof),p.subject,hash(bearer)])).rows[0];
 return row?{...p,aal:'aal2' as const,mfaVerifiedAt:new Date(row.verified_at).getTime()/1000}:p;
}
export function registerNeonAdminMfa(app:any,getDb:()=>Promise<Db>,guard:any){
 if(process.env.AUTH_PROVIDER!=='neon')return;
 const route=(path:string,fn:(db:Db,req:any)=>Promise<any>)=>app.post('/api/admin/mfa/'+path,guard('VIEW_MERCHANT_HEALTH',true),async(req:any,res:any)=>{
  res.setHeader('Cache-Control','no-store');
  const previewOrigin=process.env.FULL_NEON_TARGET==='staging'&&process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_URL?'https://'+process.env.VERCEL_URL:undefined;
  if(req.headers.origin && req.headers.origin!==process.env.APP_URL && req.headers.origin!==process.env.PUBLIC_APP_URL && req.headers.origin!==previewOrigin)return res.status(403).json({ok:false,error:'INVALID_ORIGIN'});
  try{res.json({ok:true,...await fn(await getDb(),req)});}catch(e){const status=(e as any).status||503;res.status(status).json({ok:false,error:status===503?'ADMIN_MFA_UNAVAILABLE':(e as Error).message});}
 });
 route('status',async(db,req)=>{const f=(await db.query('SELECT verified_at FROM internal.admin_mfa_factors WHERE subject=$1',[req.adminPrincipal.subject])).rows[0];return{enrolled:!!f?.verified_at};});
 route('enroll',async(db,req)=>db.tx(async c=>{
  const p=req.adminPrincipal;await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['admin-mfa:'+p.subject]);
  const f=(await c.query('SELECT verified_at FROM internal.admin_mfa_factors WHERE subject=$1 FOR UPDATE',[p.subject])).rows[0];
  if(f?.verified_at)throw Object.assign(Error('MFA_ALREADY_ENROLLED'),{status:409});
  // An unverified factor may be resumed; it never grants privileges.
  let secret:string;const existing=(await c.query('SELECT secret_cipher FROM internal.admin_mfa_factors WHERE subject=$1',[p.subject])).rows[0];
  if(existing)secret=decrypt(existing.secret_cipher);else{secret=new Secret({size:20}).base32;await c.query('INSERT INTO internal.admin_mfa_factors(subject,secret_cipher) VALUES($1,$2)',[p.subject,encrypt(secret)]);}
  return {secret,qr:await QRCode.toDataURL(otp(secret,p.email).toString())};
 }));
 route('verify',async(db,req)=>{
  const result=await db.tx(async c=>{
   const p=req.adminPrincipal,bearer=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||''))?.[1];if(!bearer)throw Object.assign(Error('AUTHENTICATION_REQUIRED'),{status:401});
   const f=(await c.query('SELECT * FROM internal.admin_mfa_factors WHERE subject=$1 FOR UPDATE',[p.subject])).rows[0];
   if(!f)throw Object.assign(Error('MFA_ENROLLMENT_REQUIRED'),{status:409});
   const now=new Date((await c.query('SELECT clock_timestamp() t')).rows[0].t).getTime();
   if(f.blocked_until && new Date(f.blocked_until).getTime()>now)return {error:'MFA_RATE_LIMITED',status:429};
   const code=String(req.body?.code||''),recovery=String(req.body?.recoveryCode||'');let valid=false,counter=Number(f.last_counter),hashes=f.recovery_hashes as string[];let method='TOTP';
   if(recovery && f.verified_at){const h=hash(recovery),at=hashes.findIndex(s=>s.length===h.length&&timingSafeEqual(Buffer.from(s),Buffer.from(h)));if(at>=0){valid=true;hashes=hashes.filter((_,i)=>i!==at);method='RECOVERY';}}
   else if(/^\d{6}$/.test(code)){const delta=otp(decrypt(f.secret_cipher),p.email).validate({token:code,timestamp:now,window:1});if(delta!==null){const n=Math.floor(now/30000)+delta;if(n>counter){valid=true;counter=n;}}}
   if(!valid){await c.query("UPDATE internal.admin_mfa_factors SET failures=failures+1,blocked_until=CASE WHEN failures+1>=5 THEN clock_timestamp()+interval '15 minutes' ELSE blocked_until END WHERE subject=$1",[p.subject]);return {error:'MFA_CODE_INVALID',status:403};}
   const recoveryCodes=!f.verified_at?Array.from({length:8},()=>randomBytes(16).toString('hex')):undefined;
   if(recoveryCodes)hashes=recoveryCodes.map(hash);
   await c.query('UPDATE internal.admin_mfa_factors SET verified_at=coalesce(verified_at,clock_timestamp()),last_counter=$2,recovery_hashes=$3::jsonb,failures=0,blocked_until=NULL,updated_at=clock_timestamp() WHERE subject=$1',[p.subject,counter,JSON.stringify(hashes)]);
   const token=randomBytes(32).toString('hex');
   await c.query("INSERT INTO internal.admin_mfa_sessions(token_hash,subject,bearer_hash,verified_at,expires_at,method) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '10 minutes',$4)",[hash(token),p.subject,hash(bearer),method]);
   await c.query(`INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,justification,request_id)
    VALUES(gen_random_uuid(),$1,$2,'ADMIN_MFA_VERIFIED','admin/mfa',$3,$4)`,[req.internal.id,req.internal.role,'Verified managed Neon step-up: '+method,req.auditRequestId]);
   return {token,recoveryCodes};
  });
  if('error' in result)throw Object.assign(Error(result.error),{status:result.status});return result;
 });
}
