import {createHash,randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import type {Express,Request} from 'express';
import type {Db} from '../shared/db';
import type {FinancialScope} from './finance';
import {trustedPrincipal} from '../shared/auth';
const scrypt=(pin:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>derive(pin,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
const ACTIONS=new Set(['VOID','REFUND','CASH_OUT','CASH_REVERSE']);
export class FinancialApprovalError extends Error {
  constructor(readonly status:number,code:string){super(code);}
}
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
  ?Object.fromEntries(Object.keys(v).filter(k=>k!=='approvalGrant'&&v[k]!==undefined).sort().map(k=>[k,canonical(v[k])])):v;
export const commandHash=(command:unknown)=>createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex');
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export function validFinancialPin(pin:unknown):pin is string {
  return typeof pin==='string'&&/^\d{4,8}$/.test(pin)&&!/^([0-9])\1+$/.test(pin)&&
    !['1234','4321','123456','654321','12345678','87654321'].includes(pin);
}
export async function hashFinancialPin(pin:string){
  if(!validFinancialPin(pin))throw new FinancialApprovalError(400,'WEAK_FINANCIAL_PIN');
  const salt=randomBytes(16).toString('hex');
  const value=await scrypt(pin,salt) as Buffer;
  return 'scrypt-v1$'+salt+'$'+value.toString('hex');
}
export async function verifyFinancialPin(pin:unknown,encoded:string){
  if(!validFinancialPin(pin))return false;
  const parts=encoded.split('$');
  if(parts.length!==3||parts[0]!=='scrypt-v1'||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;
  const result=await scrypt(pin,parts[1]) as Buffer;
  return timingSafeEqual(result,Buffer.from(parts[2],'hex'));
}
async function rateWindow(c:Db,s:FinancialScope){
  await c.query('INSERT INTO pos.financial_pin_attempts(tenant_id,actor_ref) VALUES($1,$2) ON CONFLICT DO NOTHING',[s.tenantId,s.actorRef]);
  await c.query(`UPDATE pos.financial_pin_attempts SET failures=0,attempts=0,window_started_at=now()
    WHERE tenant_id=$1 AND actor_ref=$2 AND window_started_at<now()-interval '15 minutes'`,[s.tenantId,s.actorRef]);
  const row=(await c.query('SELECT * FROM pos.financial_pin_attempts WHERE tenant_id=$1 AND actor_ref=$2 FOR UPDATE',[s.tenantId,s.actorRef])).rows[0];
  if(row.failures>=5||row.attempts>=60)return false;
  await c.query('UPDATE pos.financial_pin_attempts SET attempts=attempts+1 WHERE tenant_id=$1 AND actor_ref=$2',[s.tenantId,s.actorRef]);
  return true;
}
async function credential(c:Db,s:FinancialScope){
  return (await c.query('SELECT pin_hash FROM pos.financial_pin_credentials WHERE tenant_id=$1 AND approver_ref=$2',[s.tenantId,s.actorRef])).rows[0];
}
async function failure(c:Db,s:FinancialScope){
  await c.query('UPDATE pos.financial_pin_attempts SET failures=failures+1 WHERE tenant_id=$1 AND actor_ref=$2',[s.tenantId,s.actorRef]);
  return {status:403,error:'INVALID_FINANCIAL_PIN'};
}
/** Fresh password proof is required even for the first enrollment. Never trust
 * a client-supplied email/subject or persist the password/upstream auth tokens.
 */
async function reauthenticateOwner(req:Request,subject:string){
  const principal=trustedPrincipal(req),password=req.body?.ownerPassword;
  if(!principal?.email||typeof password!=='string'||!password||password.length>1024)return false;
  const url=(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  if(!url.startsWith('https://')||!key)throw new FinancialApprovalError(503,'OWNER_REAUTHENTICATION_UNAVAILABLE');
  let response:Response;
  try{response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify({email:principal.email,password}),redirect:'error',signal:AbortSignal.timeout(5000)});}
  catch{throw new FinancialApprovalError(503,'OWNER_REAUTHENTICATION_UNAVAILABLE');}
  if(response.status>=500||response.status===429)throw new FinancialApprovalError(503,'OWNER_REAUTHENTICATION_UNAVAILABLE');
  if(!response.ok)return false;
  const data=await response.json();
  return data.user?.id===subject&&Boolean(data.user?.email_confirmed_at||data.user?.confirmed_at);
}
/** Verified cloud owner only. Local role/name/PIN profiles confer no authority.
 * Failed attempts RETURN normally so their DB transaction commits the counter.
 */
export function registerFinancialApprovalRoutes(app:Express,db:Db,scopeFor:(c:Db,r:Request)=>Promise<FinancialScope>){
  const route=(path:string,run:(c:Db,s:FinancialScope,req:Request)=>Promise<any>)=>app.post(path,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
      const result=await db.tx(async c=>run(c,await scopeFor(c,req),req));
      if(result.error){if(result.status===429)res.setHeader('Retry-After','900');return res.status(result.status).json({ok:false,error:result.error});}
      return res.json({ok:true,...result});
    }catch(e){
      const error=e as Error&{status?:number};
      return res.status(error.status||503).json({ok:false,error:error.status?error.message:'FINANCIAL_AUTHORIZATION_UNAVAILABLE'});
    }
  });
  route('/api/v1/finance/pin',async(c,s,req)=>{
    if(!await rateWindow(c,s))return {status:429,error:'FINANCIAL_PIN_RATE_LIMITED'};
    if(!validFinancialPin(req.body?.newPin))throw new FinancialApprovalError(400,'WEAK_FINANCIAL_PIN');
    if(!await reauthenticateOwner(req,s.actorRef)){
      await failure(c,s);return {status:403,error:'OWNER_REAUTHENTICATION_REQUIRED'};
    }
    const old=await credential(c,s);
    if(old&&!await verifyFinancialPin(req.body?.currentPin,old.pin_hash))return failure(c,s);
    const pinHash=await hashFinancialPin(req.body?.newPin);
    await c.query(`INSERT INTO pos.financial_pin_credentials(tenant_id,approver_ref,pin_hash)
      VALUES($1,$2,$3) ON CONFLICT(tenant_id,approver_ref) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,updated_at=now()`,[s.tenantId,s.actorRef,pinHash]);
    // Changing PIN revokes even previously consumed retry grants.
    await c.query('DELETE FROM pos.financial_approval_grants WHERE tenant_id=$1 AND approver_ref=$2',[s.tenantId,s.actorRef]);
    await c.query(`INSERT INTO pos.financial_authorization_audit(tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,grant_hash) VALUES($1,$2,$3,$4,$4,$5,$4,'Owner financial PIN setup/change',$6,$7)`,[s.tenantId,s.merchantId,s.outletId,s.actorRef,old?'PIN_ROTATED':'PIN_ENROLLED',commandHash({operation:'pin-setup'}),digest(randomBytes(32).toString('hex'))]);
    return {enrolled:true};
  });
  route('/api/v1/finance/approve',async(c,s,req)=>{
    const {action,reference,reason,command,pin}=req.body||{};
    if(!ACTIONS.has(action)||typeof reference!=='string'||!reference||reference.length>128||
      typeof reason!=='string'||!reason.trim()||reason.length>500||!command||typeof command!=='object'||JSON.stringify(command).length>100000)
      throw new FinancialApprovalError(400,'INVALID_APPROVAL_REQUEST');
    if(!await rateWindow(c,s))return {status:429,error:'FINANCIAL_PIN_RATE_LIMITED'};
    const row=await credential(c,s);
    if(!row)return {status:409,error:'FINANCIAL_PIN_SETUP_REQUIRED'};
    if(!await verifyFinancialPin(pin,row.pin_hash))return failure(c,s);
    const token=randomBytes(32).toString('base64url');
    await c.query(`INSERT INTO pos.financial_approval_grants
      (token_hash,tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,expires_at${s.moduleId?',module_id':''})
      VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,now()+interval '90 seconds'${s.moduleId?',$10':''})`,
      [digest(token),s.tenantId,s.merchantId,s.outletId,s.actorRef,action,reference,reason.trim(),commandHash(command),...(s.moduleId?[s.moduleId]:[])]);
    return {approvalGrant:token,expiresInSeconds:90,approverRef:s.actorRef};
  });
}
/** Call inside the SAME transaction/savepoint as the authorized ledger mutation.
 * A consumed grant allows only exact idempotent retries; changed commands fail.
 */
export async function consumeFinancialApproval(c:Db,s:FinancialScope,action:string,reference:string,command:unknown,token:unknown){
  if(s.moduleId&&!['OWNER','ADMIN','MANAGER'].includes(s.role||''))throw new FinancialApprovalError(403,'WORKSPACE_ROLE_FORBIDDEN');
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FinancialApprovalError(403,'FINANCIAL_APPROVAL_REQUIRED');
  const row=(await c.query(`SELECT * FROM pos.financial_approval_grants WHERE token_hash=$1
    AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 AND actor_ref=$5
    AND action=$6 AND reference=$7 AND command_hash=$8 FOR UPDATE`,
    [digest(token),s.tenantId,s.merchantId,s.outletId,s.actorRef,action,reference,commandHash(command)])).rows[0];
  if(!row||s.moduleId&&row.module_id!==s.moduleId||(!row.consumed_at&&Date.parse(row.expires_at)<=Date.now()))throw new FinancialApprovalError(403,'FINANCIAL_APPROVAL_INVALID_OR_EXPIRED');
  if(row.consumed_at)return;
  await c.query('UPDATE pos.financial_approval_grants SET consumed_at=now() WHERE token_hash=$1',[row.token_hash]);
  await c.query(`INSERT INTO pos.financial_authorization_audit
    (tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,grant_hash${s.moduleId?',module_id':''})
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10${s.moduleId?',$11':''})`,[s.tenantId,s.merchantId,s.outletId,s.actorRef,row.approver_ref,action,reference,row.reason,row.command_hash,row.token_hash,...(s.moduleId?[s.moduleId]:[])]);
}
