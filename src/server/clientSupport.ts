import {createClient} from '@supabase/supabase-js';
import type {Express} from 'express';
import type {Db} from '../../services/shared/db';
import type {AuthPrincipal} from '../../services/shared/auth';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ClientSupportProvider {
  configured:boolean;
  ownerEmail(subject:string):Promise<string|null>;
  sendReset(email:string):Promise<void>;
}
class SupportError extends Error {constructor(readonly status:number,code:string){super(code);}}

export function createClientSupportProvider():ClientSupportProvider {
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Server-only Auth client. No sessions, passwords or recovery links are
  // returned to an operator or recorded in support history.
  const auth=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}}):null;
  return {configured:!!auth,
    async ownerEmail(subject){
      if(!auth)throw new SupportError(503,'SUPPORT_AUTH_NOT_CONFIGURED');
      if(!uuid.test(subject))return null;
      const {data,error}=await auth.auth.admin.getUserById(subject);
      if(error){if(error.status===404)return null;throw new SupportError(502,'OWNER_LOOKUP_FAILED');}
      const u=data.user;
      return u?.id===subject&&!u.deleted_at&&(!u.banned_until||Date.parse(u.banned_until)<=Date.now())&&u.email_confirmed_at&&u.email?u.email:null;
    },
    async sendReset(email){
      if(!auth)throw new SupportError(503,'SUPPORT_AUTH_NOT_CONFIGURED');
      const destination=new URL('/reset-password',process.env.APP_URL||'https://kasir.newhope.space');
      if(destination.protocol!=='https:')throw new SupportError(503,'SUPPORT_REDIRECT_NOT_CONFIGURED');
      const {error}=await auth.auth.resetPasswordForEmail(email,{redirectTo:destination.href});
      if(error)throw new SupportError(error.status===429?429:502,'PASSWORD_RESET_PROVIDER_REJECTED');
    }};
}

export function supportStepUpError(principal:AuthPrincipal|undefined,now=Date.now()) {
  if(principal?.aal!=='aal2')return 'MFA_REQUIRED';
  if(!principal.mfaVerifiedAt||now/1000-principal.mfaVerifiedAt>=600||principal.mfaVerifiedAt>now/1000+30)return 'REAUTH_REQUIRED';
  return null;
}

async function tenant(c:Db,id:string,lock=false){
  const row=(await c.query(`SELECT id,name,owner_user_ref,is_active,created_at FROM internal.tenants WHERE id=$1 AND merged_into IS NULL${lock?' FOR UPDATE':''}`,[id])).rows[0];
  if(!row)throw new SupportError(404,'CLIENT_NOT_FOUND');return row;
}
async function audit(c:Db,req:any,action:string,reason:string,before:any,after:any){
  await c.query(`INSERT INTO internal.support_actions(tenant_id,internal_user_id,action,reason,before_state,after_state,request_id,ip_address,user_agent)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`,[req.params.tenantId,req.internal.id,action,reason,
    JSON.stringify(before),JSON.stringify(after),req.auditRequestId,req.ip||null,String(req.headers['user-agent']||'').slice(0,512)]);
}

export function registerClientSupportRoutes(app:Express,getDb:()=>Promise<Db>,guard:any,provider=createClientSupportProvider()) {
  const run=(fn:(req:any,res:any,db:Db)=>Promise<any>)=>async(req:any,res:any)=>{
    try{await fn(req,res,await getDb());}catch(e){res.status(e instanceof SupportError?e.status:500).json({ok:false,error:e instanceof SupportError?e.message:'CLIENT_SUPPORT_FAILED'});}
  };
  app.get('/api/admin/clients',guard('VIEW_MERCHANT_HEALTH'),run(async(req,res,db)=>{
    const allowed=['ROLE_SUPERADMIN','ROLE_INTERNAL_SUPPORT'].includes(req.internal.role);
    await db.query(`INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,request_id)
      VALUES(gen_random_uuid(),$1,$2,$3,'/api/admin/clients',$4)`,[req.internal.id,req.internal.role,allowed?'VIEW_CLIENT_DIRECTORY':'DENIED_VIEW_CLIENT_DIRECTORY',req.auditRequestId]);
    if(!allowed)throw new SupportError(403,'CAPABILITY_DENIED');
    const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,120):'';
    const offset=Math.max(0,Math.floor(Number(req.query.offset)||0)),limit=Math.max(1,Math.min(50,Math.floor(Number(req.query.limit)||20)));
    // Directory discovery exposes account names, not owner email/passwords.
    const filter="t.merged_into IS NULL AND t.owner_user_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND ($1='' OR strpos(lower(t.name),lower($1))>0 OR t.id::text=$1)";
    const total=(await db.query(`SELECT count(*)::int n FROM internal.tenants t WHERE ${filter}`,[search])).rows[0].n;
    const rows=(await db.query(`SELECT t.id,t.name,t.is_active,t.created_at,
      (SELECT count(*)::int FROM internal.merchants m WHERE m.tenant_id=t.id) business_count,
      (SELECT count(*)::int FROM internal.outlets o WHERE o.tenant_id=t.id AND o.is_active) active_outlet_count
      FROM internal.tenants t WHERE ${filter} ORDER BY t.created_at DESC,t.id LIMIT $2 OFFSET $3`,[search,limit,offset])).rows;
    res.json({ok:true,rows,total,limit,offset});
  }));
  app.get('/api/admin/clients/:tenantId',guard('MANAGE_SUPPORT'),run(async(req,res,db)=>{
    const reason=typeof req.query.justification==='string'?req.query.justification.trim():'';
    if(reason.length<10||reason.length>2000)throw new SupportError(400,'REASON_MINIMUM_10_CHARACTERS');
    const client=await tenant(db,req.params.tenantId);
    let email:string|null=null,authStatus='NOT_CONFIGURED';
    if(provider.configured){try{email=await provider.ownerEmail(client.owner_user_ref);authStatus=email?'VERIFIED':'OWNER_NOT_VERIFIED';}catch{authStatus='UNAVAILABLE';}}
    const [businesses,outlets,diagnostics,history]=await Promise.all([
      db.query('SELECT id,name,business_sector,is_active FROM internal.merchants WHERE tenant_id=$1 ORDER BY name,id LIMIT 201',[client.id]),
      db.query('SELECT id,merchant_id,name,is_active FROM internal.outlets WHERE tenant_id=$1 ORDER BY name,id LIMIT 201',[client.id]),
      // Read the existing cross-service contract, never widen internal service
      // permissions to raw POS ledgers or operational recovery payloads.
      db.query(`SELECT count(*)::int ledger_records,max(created_at) last_transaction_at
        FROM contract.transaction_log WHERE tenant_id=$1`,[client.id]),
      db.query(`SELECT a.id,a.action,a.reason,a.created_at,a.after_state,u.email operator_email FROM internal.support_actions a
        JOIN internal.internal_users u ON u.id=a.internal_user_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,[client.id])]);
    res.json({ok:true,client:{...client,ownerEmail:email,authStatus},canEditProfile:req.internal.role==='ROLE_SUPERADMIN',
      resetAvailable:!!email,diagnostics:diagnostics.rows[0],businesses:businesses.rows.slice(0,200),outlets:outlets.rows.slice(0,200),history:history.rows.slice(0,50),
      truncated:{businesses:businesses.rows.length>200,outlets:outlets.rows.length>200,history:history.rows.length>50}});
  }));
  app.post('/api/admin/clients/:tenantId/actions',guard('MANAGE_SUPPORT'),run(async(req,res,db)=>{
    const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
    if(reason.length<10||reason.length>2000)throw new SupportError(400,'REASON_MINIMUM_10_CHARACTERS');
    const action=req.body?.action;
    if(!['NOTE','UPDATE_CLIENT_PROFILE','RESET_PASSWORD'].includes(action))throw new SupportError(400,'INVALID_SUPPORT_ACTION');
    if(action==='UPDATE_CLIENT_PROFILE'&&req.internal.role!=='ROLE_SUPERADMIN')throw new SupportError(403,'CAPABILITY_DENIED');
    if(action!=='RESET_PASSWORD'){
      const name=typeof req.body.name==='string'?req.body.name.trim():'';
      if(action==='UPDATE_CLIENT_PROFILE'&&(name.length<2||name.length>100))throw new SupportError(400,'INVALID_CLIENT_NAME');
      await db.tx(async c=>{const before=await tenant(c,req.params.tenantId,true);
        if(action==='UPDATE_CLIENT_PROFILE')await c.query('UPDATE internal.tenants SET name=$2,updated_at=now() WHERE id=$1',[before.id,name]);
        await audit(c,req,action,reason,{name:before.name},{name:action==='UPDATE_CLIENT_PROFILE'?name:before.name});});
      return res.json({ok:true,message:action==='NOTE'?'Catatan support tersimpan.':'Nama akun diperbarui; transaksi dan nama outlet tidak diubah.'});
    }
    const stepUp=supportStepUpError(req.adminPrincipal);
    if(stepUp)throw new SupportError(403,stepUp);
    if(!provider.configured)throw new SupportError(503,'SUPPORT_AUTH_NOT_CONFIGURED');
    const requestKey=req.body.requestKey;
    if(typeof requestKey!=='string'||!uuid.test(requestKey))throw new SupportError(400,'INVALID_REQUEST_KEY');
    // Persist intent before contacting Auth. Retries never resend a recovery
    // email after a lost ACK/crash. Financial tables and queues are untouched.
    const prepared=await db.tx(async c=>{
      const client=await tenant(c,req.params.tenantId,true);
      if(!uuid.test(client.owner_user_ref||''))throw new SupportError(409,'OWNER_AUTH_NOT_LINKED');
      const old=(await c.query(`SELECT action FROM internal.support_actions WHERE tenant_id=$1
        AND action IN ('PASSWORD_RESET_REQUESTED','PASSWORD_RESET_SENT','PASSWORD_RESET_FAILED') AND after_state->>'requestKey'=$2 ORDER BY created_at DESC,id DESC`,[client.id,requestKey])).rows;
      if(old.length)return {client,replay:true,status:old.some(r=>r.action==='PASSWORD_RESET_SENT')?'SENT':old.some(r=>r.action==='PASSWORD_RESET_FAILED')?'FAILED':'PENDING'};
      const recent=(await c.query("SELECT 1 FROM internal.support_actions WHERE tenant_id=$1 AND action='PASSWORD_RESET_REQUESTED' AND created_at>now()-interval '2 minutes' LIMIT 1",[client.id])).rows;
      if(recent.length)throw new SupportError(429,'PASSWORD_RESET_COOLDOWN');
      await audit(c,req,'PASSWORD_RESET_REQUESTED',reason,null,{requestKey,status:'PENDING'});
      return {client,replay:false,status:'PENDING'};
    });
    if(prepared.replay)return res.status(prepared.status==='PENDING'?202:200).json({ok:true,replayed:true,status:prepared.status,message:'Permintaan ini sudah tercatat; tidak ada email tambahan yang dikirim. Periksa riwayat support.'});
    let accepted=false;
    try{
      const email=await provider.ownerEmail(prepared.client.owner_user_ref);
      if(!email)throw new SupportError(409,'OWNER_EMAIL_NOT_VERIFIED');
      // Email/redirect/password from the browser are deliberately ignored.
      await provider.sendReset(email);accepted=true;
      await db.tx(c=>audit(c,req,'PASSWORD_RESET_SENT',reason,null,{requestKey,status:'SENT'}));
    }catch(e){
      if(accepted)throw new SupportError(503,'PASSWORD_RESET_STATUS_UNKNOWN');
      await db.tx(c=>audit(c,req,'PASSWORD_RESET_FAILED',reason,null,{requestKey,status:'FAILED'}));
      throw e instanceof SupportError?e:new SupportError(502,'PASSWORD_RESET_PROVIDER_REJECTED');
    }
    res.json({ok:true,status:'SENT',message:'Permintaan email reset diterima oleh layanan Auth. Owner perlu memeriksa inbox/spam dan memilih kata sandi sendiri.'});
  }));
}
