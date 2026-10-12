import type {Express} from 'express';
import type {Db} from '../../services/shared/db';
const STATES=new Set(['IDENTITY_CHECK','LEGAL_HOLD_REVIEW','IN_PROGRESS','COMPLETED','DECLINED']);
export function registerPrivacySupport(app:Express,getDb:()=>Promise<Db>,guard:any){
 app.get('/api/admin/privacy-requests',guard('MANAGE_SUPPORT'),async(req:any,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const data=await (await getDb()).tx(async c=>{
   const offset=Math.max(0,Math.min(100000,Number(req.query.offset)||0));
   await c.query("INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,request_id) VALUES(uuidv7(),$1,$2,'VIEW_PRIVACY_REQUESTS','/api/admin/privacy-requests',$3)",[req.internal.id,req.internal.role,req.auditRequestId]);
   return (await c.query('SELECT id,tenant_id,request_type,message,status,created_at FROM internal.privacy_requests WHERE ($2::uuid IS NULL OR tenant_id IN(SELECT tenant_id FROM internal.merchants WHERE id=$2::uuid)) ORDER BY created_at DESC LIMIT 50 OFFSET $1',[Math.floor(offset),req.query.merchantId||null])).rows;
  });res.json({ok:true,requests:data});}catch{res.status(503).json({ok:false,error:'PRIVACY_SUPPORT_UNAVAILABLE'});}
 });
 app.put('/api/admin/privacy-requests/:id',guard('MANAGE_SUPPORT'),async(req:any,res)=>{
  res.setHeader('Cache-Control','no-store');
  const {status,reason}=req.body||{};
  if(!/^[0-9a-f-]{36}$/i.test(req.params.id)||!STATES.has(status)||typeof reason!=='string'||reason.trim().length<10||reason.length>1000)return res.status(400).json({ok:false,error:'INVALID_PRIVACY_REVIEW'});
  try{const data=await (await getDb()).tx(async c=>{
   const row=(await c.query('SELECT * FROM internal.privacy_requests WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id IN(SELECT tenant_id FROM internal.merchants WHERE id=$2::uuid)) FOR UPDATE',[req.params.id,req.query.merchantId||null])).rows[0];
   if(!row)return null;
   await c.query('UPDATE internal.privacy_requests SET status=$2,updated_at=now() WHERE id=$1',[row.id,status]);
   await c.query('INSERT INTO internal.privacy_request_events(request_id,tenant_id,actor_ref,event,reason) VALUES($1,$2,$3,$4,$5)',[row.id,row.tenant_id,req.adminPrincipal.subject,status,reason.trim()]);
   await c.query("INSERT INTO internal.internal_access_log(id,internal_user_id,internal_role,action,resource,request_id) VALUES(uuidv7(),$1,$2,'REVIEW_PRIVACY_REQUEST',$3,$4)",[req.internal.id,req.internal.role,'privacy-request:'+row.id,req.auditRequestId]);
   return {id:row.id,status};
  });if(!data)return res.status(404).json({ok:false,error:'REQUEST_NOT_FOUND'});res.json({ok:true,request:data});}catch{res.status(503).json({ok:false,error:'PRIVACY_SUPPORT_UNAVAILABLE'});}
 });
}
