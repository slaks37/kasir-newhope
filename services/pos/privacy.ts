import type {Express,Request} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {LEGAL_NOTICE_VERSION} from '../../src/config/legalNotices';
const TYPES=new Set(['ACCESS','CORRECTION','DELETION','EXPORT','CONSENT_WITHDRAWAL']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class PrivacyError extends Error{constructor(readonly status:number,message:string){super(message);}}
async function ownerScope(db:Db,req:Request){
 const p=trustedPrincipal(req);
 if(!p||p.subject==='local-development')throw new PrivacyError(401,'UNAUTHENTICATED');
 const t=(await db.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1 AND is_active AND merged_into IS NULL ORDER BY created_at,id LIMIT 1',[p.subject])).rows[0];
 if(!t)throw new PrivacyError(403,'OWNER_REQUIRED');
 await db.query("SELECT set_config('app.tenant_id',$1,true)",[t.id]);
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['privacy:'+t.id]);
 return {tenantId:t.id,actor:p.subject};
}
export function registerPrivacyRoutes(app:Express,db:Db){
 const route=(method:'get'|'post',path:string,run:(c:Db,s:{tenantId:string;actor:string},req:Request)=>Promise<any>)=>app[method](path,async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const data=await db.tx(async c=>run(c,await ownerScope(c,req),req));res.json({ok:true,...data});}
  catch(e){res.status(e instanceof PrivacyError?e.status:503).json({ok:false,error:e instanceof PrivacyError?e.message:'PRIVACY_WORKFLOW_UNAVAILABLE'});}
 });
 route('get','/api/v1/privacy/requests',async(c,s)=>({requests:(await c.query('SELECT id,client_request_id,request_type,message,status,created_at,updated_at FROM internal.privacy_requests WHERE tenant_id=$1 AND actor_ref=$2 ORDER BY created_at DESC LIMIT 50',[s.tenantId,s.actor])).rows}));
 route('post','/api/v1/privacy/requests',async(c,s,req)=>{
  const {clientRequestId,type,message}=req.body||{};
  if(!UUID.test(clientRequestId||'')||!TYPES.has(type)||typeof message!=='string'||!message.trim()||message.length>1000)throw new PrivacyError(400,'INVALID_PRIVACY_REQUEST');
  const previous=(await c.query('SELECT id,status,request_type,message FROM internal.privacy_requests WHERE tenant_id=$1 AND actor_ref=$2 AND client_request_id=$3',[s.tenantId,s.actor,clientRequestId])).rows[0];
  if(previous){if(previous.request_type!==type||previous.message!==message.trim())throw new PrivacyError(409,'PRIVACY_REQUEST_ID_CONFLICT');return {requestId:previous.id,status:previous.status,replayed:true};}
  const count=(await c.query("SELECT count(*)::int n FROM internal.privacy_requests WHERE tenant_id=$1 AND created_at>now()-interval '24 hours'",[s.tenantId])).rows[0].n;
  if(count>=10)throw new PrivacyError(429,'PRIVACY_REQUEST_RATE_LIMITED');
  const record=(await c.query('INSERT INTO internal.privacy_requests(tenant_id,actor_ref,client_request_id,request_type,message) VALUES($1,$2,$3,$4,$5) RETURNING id,status',[s.tenantId,s.actor,clientRequestId,type,message.trim()])).rows[0];
  await c.query("INSERT INTO internal.privacy_request_events(request_id,tenant_id,actor_ref,event,reason) VALUES($1,$2,$3,'RECEIVED','Owner submitted request; identity and retention review required')",[record.id,s.tenantId,s.actor]);
  // Intake never exports, mutates or deletes operational/customer/financial rows.
  return {requestId:record.id,status:record.status};
 });
 route('post','/api/v1/privacy/notices',async(c,s,req)=>{
  if(req.body?.termsVersion!==LEGAL_NOTICE_VERSION||req.body?.privacyVersion!==LEGAL_NOTICE_VERSION)throw new PrivacyError(400,'NOTICE_VERSION_REQUIRED');
  await c.query('INSERT INTO internal.legal_notice_acknowledgements(tenant_id,actor_ref,terms_version,privacy_version) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING',[s.tenantId,s.actor,LEGAL_NOTICE_VERSION]);
  return {version:LEGAL_NOTICE_VERSION};
 });
}
