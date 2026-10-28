import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {trustedPrincipal,type AuthPrincipal} from '../shared/auth';
import type {Db} from '../shared/db';
import {authProvider,getAuthConfig} from '../shared/betterAuthConfig';
import {sendBetterAuthEmail,type AuthEmail} from '../shared/betterAuthEmail';
import {hasSchemaFeature} from '../shared/schemaFeatures';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const STAFF_ROLES=['OWNER','ADMIN','MANAGER','CASHIER','BARISTA','CHEF','WASHER','KAPSTER','ACCOUNTANT','STAFF'] as const;
export type StaffAssignment={merchantId:string;outletId:string;moduleId:string;role:string};
export class StaffAccessError extends Error{constructor(readonly status:number,code:string){super(code);}}
const deny=(code='STAFF_MANAGEMENT_FORBIDDEN'):never=>{throw new StaffAccessError(403,code);};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function staffAssignments(value:unknown):StaffAssignment[]{
 if(!Array.isArray(value)||!value.length||value.length>32)throw new StaffAccessError(400,'STAFF_ASSIGNMENTS_REQUIRED');
 const seen=new Set<string>();return value.map(row=>{
  if(!row||Object.keys(row).sort().join(',')!=='merchantId,moduleId,outletId,role'||!UUID.test(row.merchantId)||!UUID.test(row.outletId)||!['retail','barber'].includes(row.moduleId)||!STAFF_ROLES.includes(row.role))throw new StaffAccessError(400,'STAFF_ASSIGNMENT_INVALID');
  // Unaccepted FNB/carwash/laundry v2 workflows cannot be enabled by invitations.
  const operational:Record<string,string>={BARISTA:'fnb',CHEF:'fnb',WASHER:'carwash',KAPSTER:'barber'};
  if(operational[row.role]&&operational[row.role]!==row.moduleId)throw new StaffAccessError(400,'STAFF_ROLE_MODULE_MISMATCH');
  const key=[row.merchantId,row.outletId,row.moduleId].join(':');if(seen.has(key))throw new StaffAccessError(400,'STAFF_ASSIGNMENT_DUPLICATE');seen.add(key);
  return {merchantId:row.merchantId,outletId:row.outletId,moduleId:row.moduleId,role:row.role};
 }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function requireFreshMfa(principal:AuthPrincipal){const now=Date.now()/1000,t=principal.mfaVerifiedAt;if(principal.aal!=='aal2'||!Number.isFinite(t)||t!>now+30||now-t!>300)deny('STAFF_RECENT_TOTP_REQUIRED');}
const context=async(c:Db,tenant:string)=>{await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);};
async function actor(c:Db,p:AuthPrincipal,tenant:string,mutate=false){
 if(!UUID.test(tenant))throw new StaffAccessError(400,'STAFF_TENANT_REQUIRED');
 await context(c,tenant);
 const t=(await c.query(`SELECT t.id,t.name,t.owner_user_ref FROM internal.tenants t JOIN internal.users u ON u.id::text=$2 AND u.is_active WHERE t.id=$1 AND t.is_active AND t.merged_into IS NULL`,[tenant,p.subject])).rows[0];
 if(!t)deny();const owner=t.owner_user_ref===p.subject;
 if(!owner&&!(await c.query(`SELECT 1 FROM internal.memberships WHERE tenant_id=$1 AND user_id::text=$2 AND is_active AND auth_managed AND can_manage_staff`,[tenant,p.subject])).rows.length)deny();
 if(mutate)requireFreshMfa(p);return {owner,tenant:t};
}
async function validateScopes(c:Db,p:AuthPrincipal,tenant:string,assignments:StaffAssignment[],owner:boolean,manage=false){
 if(manage&&(!owner||assignments.some(a=>a.role!=='ADMIN')))deny('STAFF_DELEGATION_OWNER_REQUIRED');
 for(const a of assignments){
  const allowed=await c.query(`SELECT 1 FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id JOIN internal.merchant_modules mm ON mm.merchant_id=m.id AND mm.tenant_id=m.tenant_id AND mm.module_id=$4 WHERE o.tenant_id=$1 AND m.id=$2 AND o.id=$3 AND o.is_active AND m.is_active AND mm.enabled AND mm.workspace_version=2`,[tenant,a.merchantId,a.outletId,a.moduleId]);
  if(!allowed.rows.length)deny('STAFF_ASSIGNMENT_SCOPE_FORBIDDEN');
  if(!owner){
   if(['OWNER','ADMIN'].includes(a.role))deny('STAFF_ADMIN_GRANT_OWNER_REQUIRED');
   const delegated=await c.query(`SELECT 1 FROM internal.staff_workspace_assignments a JOIN internal.memberships ms ON ms.id=a.membership_id AND ms.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND ms.user_id::text=$2 AND ms.auth_managed AND ms.is_active AND ms.can_manage_staff AND a.merchant_id=$3 AND a.outlet_id=$4 AND a.module_id=$5 AND a.role='ADMIN'`,[tenant,p.subject,a.merchantId,a.outletId,a.moduleId]);
   if(!delegated.rows.length)deny('STAFF_ADMIN_SCOPE_FORBIDDEN');
  }
 }
}
async function audit(c:Db,p:AuthPrincipal,tenant:string,action:string,subject:string|null,invitation:string|null,details:unknown={}){
 await c.query('INSERT INTO internal.staff_access_events(tenant_id,actor_id,subject_id,invitation_id,action,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[tenant,p.subject,subject,invitation,action,JSON.stringify(details)]);
}
const readAssignments=async(c:Db,id:string)=>(await c.query('SELECT merchant_id AS "merchantId",outlet_id AS "outletId",module_id AS "moduleId",role FROM internal.staff_workspace_assignments WHERE membership_id=$1 ORDER BY merchant_id,outlet_id,module_id',[id])).rows as StaffAssignment[];
/** Every operation assumes only the dedicated service role, even on the legacy
 * combined app LOGIN. A missing role grant fails closed, without mail dispatch. */
export const staffTransaction=<T>(db:Db,fn:(c:Db)=>Promise<T>)=>db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_staff');return fn(c);});
export async function createStaffInvitation(db:Db,p:AuthPrincipal,input:any,send:(mail:AuthEmail)=>Promise<void>=sendBetterAuthEmail,baseUrl=getAuthConfig().baseUrl){
 const assignments=staffAssignments(input.assignments),email=String(input.email||'').trim().toLowerCase();
 if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)||email.length>160||!UUID.test(input.requestKey)||typeof input.canManageStaff!=='boolean')throw new StaffAccessError(400,'STAFF_INVITE_INVALID');
 const token=randomBytes(32).toString('base64url'),id=randomUUID();
 const saved=await staffTransaction(db,async c=>{
  const {owner}=await actor(c,p,input.tenantId,true);await validateScopes(c,p,input.tenantId,assignments,owner,input.canManageStaff);
  const existing=(await c.query('SELECT id,status,email,assignments,can_manage_staff FROM internal.staff_invitations WHERE tenant_id=$1 AND request_key=$2',[input.tenantId,input.requestKey])).rows[0];
  if(existing){if(existing.email!==email||JSON.stringify(staffAssignments(existing.assignments))!==JSON.stringify(assignments)||existing.can_manage_staff!==input.canManageStaff)throw new StaffAccessError(409,'STAFF_REQUEST_KEY_CONFLICT');return {id:existing.id,status:existing.status,replay:true};}
  // Bound spam/abandoned attempts; never rate-limit by a client-supplied actor.
  if(Number((await c.query("SELECT count(*) AS n FROM internal.staff_invitations WHERE invited_by=$1 AND created_at>now()-interval '1 hour'",[p.subject])).rows[0].n)>=20)throw new StaffAccessError(429,'STAFF_INVITE_RATE_LIMIT');
  if((await c.query("SELECT 1 FROM internal.staff_invitations WHERE tenant_id=$1 AND email=$2 AND status IN('PENDING','SENT')",[input.tenantId,email])).rows.length)throw new StaffAccessError(409,'STAFF_INVITE_EXISTS');
  await c.query(`INSERT INTO internal.staff_invitations(id,tenant_id,request_key,invited_by,email,token_hash,assignments,can_manage_staff,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now()+interval '24 hours')`,[id,input.tenantId,input.requestKey,p.subject,email,digest(token),JSON.stringify(assignments),input.canManageStaff]);
  await audit(c,p,input.tenantId,'INVITE_CREATED',null,id,{assignments,canManageStaff:input.canManageStaff});return {id,status:'PENDING',replay:false};
 });
 if(saved.replay)return {ok:true,...saved};
 try{await send({kind:'STAFF_INVITE',email,url:baseUrl+'/staff-invite#token='+token,baseUrl});}
 catch{await staffTransaction(db,async c=>{await context(c,input.tenantId);await c.query("UPDATE internal.staff_invitations SET status='DELIVERY_FAILED' WHERE id=$1 AND status='PENDING'",[id]);await audit(c,p,input.tenantId,'INVITE_DELIVERY_FAILED',null,id);});throw new StaffAccessError(503,'STAFF_INVITE_DELIVERY_FAILED');}
 await staffTransaction(db,async c=>{await context(c,input.tenantId);await c.query("UPDATE internal.staff_invitations SET status='SENT' WHERE id=$1 AND status='PENDING'",[id]);});
 return {ok:true,id,status:'SENT'}; // Raw token never returns to the inviter/UI.
}
export async function acceptStaffInvitation(db:Db,p:AuthPrincipal,token:unknown){
 if(p.isEmailVerified!==true||!p.email)deny('STAFF_VERIFIED_EMAIL_REQUIRED');
 if(typeof token!=='string'||!/^[-\w]{43}$/.test(token))throw new StaffAccessError(400,'STAFF_INVITE_INVALID');
 return staffTransaction(db,async c=>{
  await c.query("SELECT set_config('app.staff_invite_hash',$1,true)",[digest(token)]);
  const target=(await c.query('SELECT tenant_id FROM internal.staff_invitations WHERE token_hash=$1',[digest(token)])).rows[0];
  if(!target)throw new StaffAccessError(410,'STAFF_INVITE_UNAVAILABLE');await context(c,target.tenant_id);
  const i=(await c.query('SELECT * FROM internal.staff_invitations WHERE token_hash=$1 FOR UPDATE',[digest(token)])).rows[0];
  if(!i||i.status!=='SENT'||new Date(i.expires_at).getTime()<=Date.now())throw new StaffAccessError(410,'STAFF_INVITE_UNAVAILABLE');
  if(i.email!==p.email!.trim().toLowerCase())deny('STAFF_INVITE_EMAIL_MISMATCH');await context(c,i.tenant_id);
  const active=(await c.query('SELECT 1 FROM internal.users WHERE id::text=$1 AND is_active',[p.subject])).rows.length;
  const tenant=(await c.query('SELECT owner_user_ref FROM internal.tenants WHERE id=$1 AND is_active AND merged_into IS NULL',[i.tenant_id])).rows[0];
  if(!active||!tenant)deny('STAFF_IDENTITY_INACTIVE');if(tenant.owner_user_ref===p.subject)throw new StaffAccessError(409,'STAFF_OWNER_ALREADY_ASSIGNED');
  if((await c.query('SELECT id FROM internal.memberships WHERE tenant_id=$1 AND user_id::text=$2',[i.tenant_id,p.subject])).rows.length)throw new StaffAccessError(409,'STAFF_EXISTING_MEMBERSHIP_REVIEW_REQUIRED');
  const grants=staffAssignments(i.assignments);
  // The inviter must still possess current authority at acceptance time.
  const inviter:AuthPrincipal={subject:i.invited_by};const {owner}=await actor(c,inviter,i.tenant_id);await validateScopes(c,inviter,i.tenant_id,grants,owner,i.can_manage_staff);
  const member=(await c.query("INSERT INTO internal.memberships(user_id,tenant_id,scope_type,role,auth_managed,can_manage_staff) VALUES($1,$2,'TENANT','STAFF',true,$3) RETURNING id",[p.subject,i.tenant_id,i.can_manage_staff])).rows[0];
  for(const a of grants)await c.query('INSERT INTO internal.staff_workspace_assignments(membership_id,tenant_id,merchant_id,outlet_id,module_id,role) VALUES($1,$2,$3,$4,$5,$6)',[member.id,i.tenant_id,a.merchantId,a.outletId,a.moduleId,a.role]);
  await c.query("UPDATE internal.staff_invitations SET status='ACCEPTED',accepted_by=$2,accepted_at=now() WHERE id=$1",[i.id,p.subject]);await audit(c,p,i.tenant_id,'INVITE_ACCEPTED',p.subject,i.id,{assignments:grants});
  return {ok:true,tenantId:i.tenant_id,membershipId:member.id,assignments:grants};
 });
}
export async function changeStaffAccess(db:Db,p:AuthPrincipal,input:any){
 const assignments=staffAssignments(input.assignments);
 if(!UUID.test(input.membershipId)||!Number.isSafeInteger(input.version)||typeof input.active!=='boolean'||typeof input.canManageStaff!=='boolean')throw new StaffAccessError(400,'STAFF_ACCESS_INVALID');
 return staffTransaction(db,async c=>{
  const {owner}=await actor(c,p,input.tenantId,true);
  const member=(await c.query('SELECT id,user_id,is_active,auth_managed,staff_access_version FROM internal.memberships WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[input.membershipId,input.tenantId])).rows[0];
  if(!member)deny();if(member.user_id===p.subject)deny('STAFF_SELF_CHANGE_FORBIDDEN');if(!member.auth_managed)throw new StaffAccessError(409,'STAFF_LEGACY_MEMBERSHIP_REVIEW_REQUIRED');
  if(member.staff_access_version!==input.version)throw new StaffAccessError(409,'STAFF_ACCESS_VERSION_CONFLICT');
  if(!owner)await validateScopes(c,p,input.tenantId,await readAssignments(c,member.id),false);
  await validateScopes(c,p,input.tenantId,assignments,owner,input.canManageStaff);
  await c.query('DELETE FROM internal.staff_workspace_assignments WHERE membership_id=$1',[member.id]);
  for(const a of assignments)await c.query('INSERT INTO internal.staff_workspace_assignments(membership_id,tenant_id,merchant_id,outlet_id,module_id,role) VALUES($1,$2,$3,$4,$5,$6)',[member.id,input.tenantId,a.merchantId,a.outletId,a.moduleId,a.role]);
  await c.query('UPDATE internal.memberships SET is_active=$2,can_manage_staff=$3,staff_access_version=staff_access_version+1 WHERE id=$1',[member.id,input.active,input.canManageStaff]);
  await audit(c,p,input.tenantId,input.active?'ACCESS_UPDATED':'ACCESS_REVOKED',member.user_id,null,{assignments,version:input.version+1,canManageStaff:input.canManageStaff});
  return {ok:true,version:input.version+1};
 });
}
export async function staffDirectory(db:Db,p:AuthPrincipal,tenantId:unknown){
 return staffTransaction(db,async c=>{
  const tenants=(await c.query(`SELECT DISTINCT t.id,t.name FROM internal.tenants t JOIN internal.users u ON u.id::text=$1 AND u.is_active WHERE t.is_active AND t.merged_into IS NULL AND(t.owner_user_ref=$1 OR EXISTS(SELECT 1 FROM internal.memberships m WHERE m.tenant_id=t.id AND m.user_id=u.id AND m.is_active AND m.auth_managed AND m.can_manage_staff)) ORDER BY t.id`,[p.subject])).rows;
  if(!tenantId)return {ok:true,tenants,tenantId:null};const {owner}=await actor(c,p,String(tenantId));
  const options=(await c.query(`SELECT m.id AS "merchantId",m.name AS "merchantName",o.id AS "outletId",o.name AS "outletName",mm.module_id AS "moduleId" FROM internal.merchants m JOIN internal.outlets o ON o.merchant_id=m.id AND o.tenant_id=m.tenant_id JOIN internal.merchant_modules mm ON mm.merchant_id=m.id AND mm.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.is_active AND o.is_active AND mm.enabled AND mm.workspace_version=2 AND mm.module_id IN('barber','retail') ORDER BY m.id,o.id,mm.module_id`,[tenantId])).rows;
  const members=(await c.query(`SELECT ms.id,ms.user_id AS "userId",u.email,u.full_name AS name,ms.is_active AS active,ms.auth_managed AS managed,ms.staff_access_version AS version,ms.can_manage_staff AS "canManageStaff" FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id WHERE ms.tenant_id=$1 ORDER BY ms.id LIMIT 200`,[tenantId])).rows;
  const visible=[];for(const m of members){const assignments=await readAssignments(c,m.id);if(!owner){try{if(!assignments.length)continue;await validateScopes(c,p,String(tenantId),assignments,false);}catch{continue;}}visible.push({...m,assignments});}
  const invites=(await c.query('SELECT id,email,status,expires_at AS "expiresAt",assignments,can_manage_staff AS "canManageStaff" FROM internal.staff_invitations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[tenantId])).rows;
  const visibleOptions=owner?options:await filterOptions(c,p,String(tenantId),options);
  return {ok:true,tenants,tenantId,owner,options:visibleOptions,members:visible,invitations:owner?invites:invites.filter(i=>i.assignments.every((a:StaffAssignment)=>!['OWNER','ADMIN'].includes(a.role)&&visibleOptions.some(o=>o.merchantId===a.merchantId&&o.outletId===a.outletId&&o.moduleId===a.moduleId)))};
 });
}
async function filterOptions(c:Db,p:AuthPrincipal,tenant:string,options:any[]){const result=[];for(const o of options){try{await validateScopes(c,p,tenant,[{merchantId:o.merchantId,outletId:o.outletId,moduleId:o.moduleId,role:'STAFF'}],false);result.push(o);}catch{/* Inaccessible scope excluded */}}return result;}
export function registerStaffAccountRoutes(app:Express,db:Db,send=sendBetterAuthEmail){
 const run=(fn:(p:AuthPrincipal,req:any)=>Promise<unknown>)=>async(req:any,res:any)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{const p=trustedPrincipal(req);if(!p||p.isEmailVerified!==true)throw new StaffAccessError(401,'AUTHENTICATION_REQUIRED');if(authProvider()!=='neon'||!await hasSchemaFeature(db,'staffAccounts'))throw new StaffAccessError(503,'STAFF_AUTH_NOT_READY');return res.json(await fn(p,req));}
  catch(e){return res.status(e instanceof StaffAccessError?e.status:503).json({ok:false,error:e instanceof StaffAccessError?e.message:'STAFF_ACCESS_UNAVAILABLE'});}
 };
 app.get('/api/v1/sync/staff',run((p,req)=>staffDirectory(db,p,req.query.tenantId)));
 app.post('/api/v1/sync/staff/invite',run((p,req)=>createStaffInvitation(db,p,req.body,send)));
 app.post('/api/v1/sync/staff/accept',run((p,req)=>acceptStaffInvitation(db,p,req.body?.token)));
 app.post('/api/v1/sync/staff/access',run((p,req)=>changeStaffAccess(db,p,req.body)));
 app.post('/api/v1/sync/staff/revoke-invite',run((p,req)=>staffTransaction(db,async c=>{
  const {owner}=await actor(c,p,req.body?.tenantId,true);const i=(await c.query('SELECT id,status,assignments FROM internal.staff_invitations WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[req.body?.invitationId,req.body?.tenantId])).rows[0];if(!i)deny();if(!owner)await validateScopes(c,p,req.body.tenantId,staffAssignments(i.assignments),false);
  if(['ACCEPTED','REVOKED'].includes(i.status))throw new StaffAccessError(409,'STAFF_INVITE_UNAVAILABLE');await c.query("UPDATE internal.staff_invitations SET status='REVOKED' WHERE id=$1",[i.id]);await audit(c,p,req.body.tenantId,'INVITE_REVOKED',null,i.id);return {ok:true};
 })));
}
