import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import type {Db} from '../../services/shared/db';
import type {AuthPrincipal} from '../../services/shared/auth';
import {acceptStaffInvitation,createStaffInvitation,changeStaffAccess,staffDirectory,staffAssignments,registerStaffAccountRoutes} from '../../services/pos/staffAccounts';
import {resolveModuleAccess} from '../../services/pos/modules';
import {resolveWorkspaceScope} from '../../services/pos/workspaceScope';
import {resetSchemaFeatureCache} from '../../services/shared/schemaFeatures';
import {authEmailPayload,type AuthEmail} from '../../services/shared/betterAuthEmail';
import {createServerlessBoundary} from '../../src/server/serverlessBoundary';
import express from 'express';
export async function staffAcceptance(admin:Db,staffDb:Db,pos:Db,peerStaffDb:Db=staffDb){
 const id=()=>randomUUID(),owner=id(),foreignOwner=id(),staff=id(),delegate=id(),other=id(),tenant=id(),foreignTenant=id(),merchant=id(),foreignMerchant=id(),outlet=id(),outlet2=id(),foreignOutlet=id();
 const user=(subject:string):AuthPrincipal=>({subject,email:subject+'@fixture.invalid',isEmailVerified:true,aal:'aal2',mfaVerifiedAt:Date.now()/1000});
 for(const uid of [owner,foreignOwner,staff,delegate,other])await admin.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Staff acceptance fixture')",[uid,uid+'@fixture.invalid']);
 await admin.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Staff tenant',$2),($3,'Foreign tenant',$4)",[tenant,owner,foreignTenant,foreignOwner]);
 await admin.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Mixed merchant','RETAIL'),($3,$4,'Foreign merchant','RETAIL')",[merchant,tenant,foreignMerchant,foreignTenant]);
 await admin.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'A1'),($4,$2,$3,'A2'),($5,$6,$7,'B1')",[outlet,tenant,merchant,outlet2,foreignOutlet,foreignTenant,foreignMerchant]);
 for(const [tid,mid] of [[tenant,merchant],[foreignTenant,foreignMerchant]])for(const module of ['retail','barber']){
  await admin.query('INSERT INTO internal.merchant_modules(tenant_id,merchant_id,module_id,enabled,guard_legacy_apis,workspace_version) VALUES($1,$2,$3,true,true,2)',[tid,mid,module]);
  await admin.query("INSERT INTO billing.module_entitlements(tenant_id,merchant_id,module_id,enabled,features,expires_at,grant_reference) VALUES($1,$2,$3,true,ARRAY['overview','pos','tables','inventory','reports','customers','settings'],now()+interval '2 days','synthetic-staff-acceptance')",[tid,mid,module]);
 }
 const plan='staff-acceptance-'+id();await admin.query("INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,features) VALUES($1,'Fixture',3,'MONTHLY',299000,'[]')",[plan]);
 await admin.query("INSERT INTO billing.subscriptions(tenant_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$3,'ACTIVE',now(),now()+interval '30 days'),($2,$3,'ACTIVE',now(),now()+interval '30 days')",[tenant,foreignTenant,plan]);
 const protectedBefore=(await admin.query('SELECT row_to_json(t) AS value FROM internal.tenants t WHERE id=ANY($1) ORDER BY id',[[tenant,foreignTenant]])).rows;
 const ledgerBefore=(await admin.query('SELECT count(*)::int AS n FROM pos.transactions')).rows[0].n;
 const mail:AuthEmail[]=[],send=async(value:AuthEmail)=>{mail.push(value);};const base='https://auth.fixture.invalid';
 const grant={merchantId:merchant,outletId:outlet,moduleId:'retail',role:'CASHIER'},barber={merchantId:merchant,outletId:outlet2,moduleId:'barber',role:'KAPSTER'};
 const input={tenantId:tenant,email:user(staff).email,requestKey:id(),assignments:[grant,barber],canManageStaff:false};
 await assert.rejects(()=>createStaffInvitation(staffDb,{...user(owner),aal:'aal1'},input,send,base),/STAFF_RECENT_TOTP_REQUIRED/);
 await assert.rejects(()=>createStaffInvitation(staffDb,{...user(owner),mfaVerifiedAt:Date.now()/1000+60},input,send,base),/STAFF_RECENT_TOTP_REQUIRED/);
 await assert.rejects(()=>createStaffInvitation(staffDb,user(foreignOwner),input,send,base),/STAFF_MANAGEMENT_FORBIDDEN/);
 const invitation=await createStaffInvitation(staffDb,user(owner),input,send,base);assert.equal(invitation.status,'SENT');assert.equal(mail.length,1);assert(!JSON.stringify(invitation).includes('token'));
 assert.equal((await createStaffInvitation(staffDb,user(owner),input,send,base)).id,invitation.id);assert.equal(mail.length,1,'Idempotent retry sends no second invitation');
 await assert.rejects(()=>createStaffInvitation(staffDb,user(owner),{...input,assignments:[grant]},send,base),/STAFF_REQUEST_KEY_CONFLICT/);
 const token=new URL(mail[0].url).hash.slice(7);assert.equal(token.length,43);
 const stored=(await admin.query('SELECT token_hash FROM internal.staff_invitations WHERE id=$1',[invitation.id])).rows[0];assert.equal(stored.token_hash,createHash('sha256').update(token).digest('hex'));assert.notEqual(stored.token_hash,token);
 const email=authEmailPayload(mail[0],{AUTH_EMAIL_ENABLED:'1',RESEND_API_KEY:'synthetic-no-network',AUTH_EMAIL_FROM:'New Hope <auth@fixture.invalid>',AUTH_EMAIL_VERIFIED_DOMAIN:'fixture.invalid',APP_ENV:'staging',AUTH_EMAIL_ALLOWED_RECIPIENTS:user(staff).email} as any);assert.match(email.payload.text,/24 jam/);
 assert.throws(()=>authEmailPayload({...mail[0],url:'https://evil.fixture.invalid/staff-invite#token='+token},{} as any),/AUTH_EMAIL_URL_REJECTED/);
 await assert.rejects(()=>acceptStaffInvitation(staffDb,{...user(staff),isEmailVerified:false},token),/STAFF_VERIFIED_EMAIL_REQUIRED/);
 await assert.rejects(()=>acceptStaffInvitation(staffDb,user(other),token),/STAFF_INVITE_EMAIL_MISMATCH/);
 const accepted=await acceptStaffInvitation(staffDb,user(staff),token);assert.equal(accepted.tenantId,tenant);
 await assert.rejects(()=>acceptStaffInvitation(staffDb,user(staff),token),/STAFF_INVITE_UNAVAILABLE/);
 await assert.rejects(()=>staffDirectory(staffDb,user(staff),tenant),/STAFF_MANAGEMENT_FORBIDDEN/);
 let directory=await staffDirectory(staffDb,user(owner),tenant) as any;assert(!JSON.stringify(directory).includes(stored.token_hash));assert(!JSON.stringify(directory).includes(token));assert.equal(directory.members.find((m:any)=>m.userId===staff).assignments.length,2);
 const oldFlag=process.env.NEW_HOPE_MODULE_WORKSPACES;process.env.NEW_HOPE_MODULE_WORKSPACES='1';resetSchemaFeatureCache();
 try{
  const access=await pos.tx(c=>resolveModuleAccess(c,staff,merchant,outlet));assert.deepEqual(access.modules.map(m=>m.id),['retail']);assert(access.modules[0].permissions.includes('pos'));assert(!access.modules[0].permissions.includes('reports'));
  const sc=await pos.tx(c=>resolveWorkspaceScope(c,staff,{businessId:merchant,outletId:outlet2,moduleId:'barber'},['tables']));assert.equal(sc.role,'KAPSTER');assert.equal(sc.membershipScope,'OUTLET');
  await assert.rejects(()=>pos.tx(c=>resolveWorkspaceScope(c,staff,{businessId:merchant,outletId:outlet,moduleId:'barber'})),/ISOLATED_WORKSPACE_REQUIRED/);
  await assert.rejects(()=>pos.tx(c=>resolveModuleAccess(c,staff,foreignMerchant,foreignOutlet)),/MODULE_SCOPE_FORBIDDEN/);
  for(const role of ['CASHIER','MANAGER','ADMIN','OWNER','ACCOUNTANT','STAFF','KAPSTER']){
   const roleGrant={...grant,role,moduleId:role==='KAPSTER'?'barber':'retail'};
   const m=(await admin.query('SELECT staff_access_version FROM internal.memberships WHERE id=$1',[accepted.membershipId])).rows[0];
   await changeStaffAccess(staffDb,user(owner),{tenantId:tenant,membershipId:accepted.membershipId,version:m.staff_access_version,active:true,canManageStaff:false,assignments:[roleGrant]});
   const scope=await pos.tx(c=>resolveWorkspaceScope(c,staff,{businessId:merchant,outletId:outlet,moduleId:roleGrant.moduleId}));assert.equal(scope.role,role);
   if(role==='ACCOUNTANT'){assert(scope.permissions.includes('reports'));assert(!scope.permissions.includes('pos'));}
   assert.equal((await pos.tx(c=>resolveModuleAccess(c,staff,merchant,outlet))).modules[0].tenantOwner,false,'OWNER membership never becomes canonical tenant owner');
  }
  for(const role of ['BARISTA','CHEF','WASHER'])assert.throws(()=>staffAssignments([{...grant,role}]),/STAFF_ROLE_MODULE_MISMATCH/,'Unaccepted module workflow cannot be enabled by invitation');
  const version=(await admin.query('SELECT staff_access_version FROM internal.memberships WHERE id=$1',[accepted.membershipId])).rows[0].staff_access_version;
  await changeStaffAccess(staffDb,user(owner),{tenantId:tenant,membershipId:accepted.membershipId,version,active:false,canManageStaff:false,assignments:[grant]});
  await assert.rejects(()=>pos.tx(c=>resolveModuleAccess(c,staff,merchant,outlet)),/MODULE_SCOPE_FORBIDDEN/);
  assert.equal((await admin.query('SELECT internal.has_active_staff_assignment($1) AS assigned',[staff])).rows[0].assigned,true,'Revocation must never turn a staff identity into automatic owner signup');
  await assert.rejects(()=>changeStaffAccess(staffDb,user(owner),{tenantId:tenant,membershipId:accepted.membershipId,version,active:true,canManageStaff:false,assignments:[grant]}),/STAFF_ACCESS_VERSION_CONFLICT/);
  const v=version+1;const attempts=await Promise.allSettled([staffDb,peerStaffDb].map(connection=>changeStaffAccess(connection,user(owner),{tenantId:tenant,membershipId:accepted.membershipId,version:v,active:true,canManageStaff:false,assignments:[grant]})));assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1,'Concurrent CAS permits only one access mutation');
 }finally{if(oldFlag===undefined)delete process.env.NEW_HOPE_MODULE_WORKSPACES;else process.env.NEW_HOPE_MODULE_WORKSPACES=oldFlag;resetSchemaFeatureCache();}
 const adminInvite=await createStaffInvitation(staffDb,user(owner),{tenantId:tenant,email:user(delegate).email,requestKey:id(),assignments:[{...grant,role:'ADMIN'}],canManageStaff:true},send,base);
 const adminAccept=await acceptStaffInvitation(staffDb,user(delegate),new URL(mail.at(-1)!.url).hash.slice(7));assert(adminAccept.membershipId);
 directory=await staffDirectory(staffDb,user(delegate),tenant) as any;assert.equal(directory.options.length,1);assert.equal(directory.options[0].moduleId,'retail');assert.equal(directory.options[0].outletId,outlet);
 await assert.rejects(()=>createStaffInvitation(staffDb,user(delegate),{...input,email:user(other).email,requestKey:id(),assignments:[barber]},send,base),/STAFF_ADMIN_SCOPE_FORBIDDEN/);
 await assert.rejects(()=>createStaffInvitation(staffDb,user(delegate),{...input,email:user(other).email,requestKey:id(),assignments:[{...grant,role:'ADMIN'}]},send,base),/STAFF_ADMIN_GRANT_OWNER_REQUIRED/);
 await assert.rejects(()=>changeStaffAccess(staffDb,user(delegate),{tenantId:tenant,membershipId:adminAccept.membershipId,version:0,active:false,canManageStaff:true,assignments:[{...grant,role:'ADMIN'}]}),/STAFF_SELF_CHANGE_FORBIDDEN/);
 const failedInput={...input,email:user(other).email,requestKey:id(),assignments:[grant]};await assert.rejects(()=>createStaffInvitation(staffDb,user(owner),failedInput,async()=>{throw Error('Synthetic transport failure');},base),/STAFF_INVITE_DELIVERY_FAILED/);
 assert.equal((await admin.query('SELECT status FROM internal.staff_invitations WHERE request_key=$1',[failedInput.requestKey])).rows[0].status,'DELIVERY_FAILED');
 const staleInvite=await createStaffInvitation(staffDb,user(delegate),{...failedInput,requestKey:id()},send,base);assert.equal(staleInvite.status,'SENT');
 const staleToken=new URL(mail.at(-1)!.url).hash.slice(7);
 await changeStaffAccess(staffDb,user(owner),{tenantId:tenant,membershipId:adminAccept.membershipId,version:0,active:false,canManageStaff:false,assignments:[{...grant,role:'ADMIN'}]});
 await assert.rejects(()=>acceptStaffInvitation(staffDb,user(other),staleToken),/STAFF_MANAGEMENT_FORBIDDEN/,'Revoked inviter cannot leave usable delegated invitations');
 await admin.query("UPDATE internal.staff_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",[staleInvite.id]);
 await assert.rejects(()=>acceptStaffInvitation(staffDb,user(other),staleToken),/STAFF_INVITE_UNAVAILABLE/);
 const dualOwnerInvite=await createStaffInvitation(staffDb,user(owner),{...input,email:user(foreignOwner).email,requestKey:id(),assignments:[grant]},send,base);assert.equal(dualOwnerInvite.status,'SENT');
 await acceptStaffInvitation(staffDb,user(foreignOwner),new URL(mail.at(-1)!.url).hash.slice(7));
 assert.equal((await admin.query('SELECT owner_user_ref FROM internal.tenants WHERE id=$1',[foreignTenant])).rows[0].owner_user_ref,foreignOwner,'Staff in A preserves existing explicit ownership of B');
 // HTTP boundary verifies identity before the staff role/DB or invitation logic.
 const env={AUTH_PROVIDER:process.env.AUTH_PROVIDER,NEWHOPE_AUTH_URL:process.env.NEWHOPE_AUTH_URL,NEWHOPE_NEON_AUTH_STAGING:process.env.NEWHOPE_NEON_AUTH_STAGING,BETTER_AUTH_SECRET:process.env.BETTER_AUTH_SECRET,BETTER_AUTH_DATABASE_URL:process.env.BETTER_AUTH_DATABASE_URL,DATABASE_URL:process.env.DATABASE_URL,NODE_ENV:process.env.NODE_ENV};
 Object.assign(process.env,{AUTH_PROVIDER:'neon',NEWHOPE_AUTH_URL:base,NEWHOPE_NEON_AUTH_STAGING:'1',BETTER_AUTH_SECRET:'synthetic-staff-acceptance-secret-'.repeat(3),BETTER_AUTH_DATABASE_URL:'postgresql://fixture@localhost/fixture',DATABASE_URL:'postgresql://fixture@localhost/fixture',NODE_ENV:'test'});
 const app=express();let calls=0;app.use(createServerlessBoundary({name:'staff-test',routes:{'/api/v1/sync/staff':['GET'],'/api/v1/sync/staff/accept':['POST']},bodyLimit:'32kb',unavailableError:'UNAVAILABLE',invalidRequestError:'INVALID',register:(a,d)=>registerStaffAccountRoutes(a,d,send)},async req=>req.headers.authorization==='Bearer synthetic-verified-owner'?user(owner):null,async()=>{calls++;return staffDb;}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const url='http://127.0.0.1:'+(server.address() as any).port+'/api/v1/sync/staff';assert.equal((await fetch(url+'?tenantId='+tenant,{headers:{'x-auth-sub':owner,'x-auth-aal':'aal2'}})).status,401);assert.equal(calls,0);assert.equal((await fetch(url+'?tenantId='+tenant,{headers:{authorization:'Bearer synthetic-verified-owner'}})).status,200);}finally{await new Promise<void>(r=>server.close(()=>r()));for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 assert.deepEqual((await admin.query('SELECT row_to_json(t) AS value FROM internal.tenants t WHERE id=ANY($1) ORDER BY id',[[tenant,foreignTenant]])).rows,protectedBefore);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM pos.transactions')).rows[0].n,ledgerBefore);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM internal.staff_access_events WHERE tenant_id=$1',[tenant])).rows[0].n>0,true);
 return {syntheticIdentity:true,emailCaptured:true,hashOnlyToken:true,oneUse:true,verifiedRecipient:true,roleOutletModuleIsolation:true,delegatedAdminBounded:true,revocationNoOwner:true,cas:true,canonicalOwnersAndLedgersUnchanged:true};
}
