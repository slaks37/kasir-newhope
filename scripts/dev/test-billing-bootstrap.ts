// Real HTTP + SQL: the serverless entry must initialize the same catalog as the
// long-running billing service before a first verified account requests status.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {migrationFiles} from '../db/migration-files.mjs';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import type {Db} from '../../services/shared/db';
import {createBillingHandler} from '../../src/server/billingHandler';
import {SAAS_PLANS,TRIAL_PLAN_ID} from '../../src/config/saasPlans';
const pg=new PGlite();
for(const file of migrationFiles())await pg.exec(fs.readFileSync(file.path,'utf8'));
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};},exec:async sql=>{await runner.exec(sql);},tx:fn=>pg.transaction(c=>fn(wrap(c))),close:async()=>{}});
const db=wrap(pg),owner=randomUUID(),staff=randomUUID(),pendingStaff=randomUUID(),workspaceOwner=randomUUID(),inactiveOwner=randomUUID();
assert.equal((await db.query('SELECT id FROM billing.plans WHERE id=$1',[TRIAL_PLAN_ID])).rows.length,0,'No test helper preloads the missing canonical trial plan');
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Bootstrap owner')",[owner,owner+'@fixture.invalid']);
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Independent staff')",[staff,staff+'@fixture.invalid']);
await db.query("INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,product_limit,features) VALUES('historical-plan','Historical',1,'MONTHLY',12345,25,'[]')");
const historical=await db.query("SELECT row_to_json(p) AS value FROM billing.plans p WHERE id='historical-plan'");
const auth=async(req:any)=>{
 switch(req.headers.authorization){
  case 'Bearer verified-fixture':return {subject:owner,isEmailVerified:true};
  case 'Bearer independent-staff':return {subject:staff,isEmailVerified:true};
  case 'Bearer pending-staff':return {subject:pendingStaff,isEmailVerified:true};
  case 'Bearer workspace-owner':return {subject:workspaceOwner,isEmailVerified:true};
  case 'Bearer unverified-owner':return {subject:workspaceOwner,isEmailVerified:false};
  case 'Bearer inactive-owner':return {subject:inactiveOwner,isEmailVerified:true};
  default:return null;
 }
};
const app=express();let connections=0;
const billingDb:Db={...db,tx:fn=>db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_billing');return fn(c);})};
const attach=()=>createBillingHandler(auth,async()=>{connections++;return billingDb;});app.use(attach());
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base='http://127.0.0.1:'+(server.address() as any).port,headers={authorization:'Bearer verified-fixture'};
try{
 assert.equal((await fetch(base+'/api/v1/subscription/status')).status,401);assert.equal(connections,0,'Anonymous requests never seed or connect');
 const first=await fetch(base+'/api/v1/subscription/status',{headers});assert.equal(first.status,200);const status=await first.json();assert.equal(status.ok,true);assert.equal(status.subscription.planId,TRIAL_PLAN_ID);assert.equal(status.subscription.status,'TRIAL');
 assert.equal((await fetch(base+'/api/v1/subscription/status',{headers})).status,200);assert.equal(connections,1,'Warm runtime shares initialization');
 const tenantId=(await db.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1',[owner])).rows[0].id;
 await db.query("INSERT INTO internal.memberships(user_id,tenant_id,role,scope_type) VALUES($1,$2,'CASHIER','TENANT')",[staff,tenantId]);
 await db.query("INSERT INTO internal.users(id,email,full_name,auth_staff_only) VALUES($1,$2,'Personal staff intent',true)",[pendingStaff,pendingStaff+'@fixture.invalid']);
 for(const owned of [false,true]) {
  if(owned)await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,is_active) VALUES($1,'Synthetic prior bootstrap bug',$2,true)",[randomUUID(),pendingStaff]);
  for(const [path,method]of [['status','GET'],['outlets','GET'],['start-trial','POST']]as const) {
   const r=await fetch(base+'/api/v1/subscription/'+path,{method,headers:{authorization:'Bearer pending-staff'}});
   assert.equal(r.status,403,'Staff intent before membership, even with erroneous prior tenant, must not bootstrap');
   assert.equal((await r.json()).error,'STAFF_WORKSPACE_SELECTION_REQUIRED');
  }
 }
 const beforeStaff=(await db.query('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n;
 for(const role of ['CASHIER','MANAGER','ADMIN','OWNER','STAFF','ACCOUNTANT','BARISTA','CHEF','WASHER','KAPSTER']){
  await db.query('UPDATE internal.memberships SET role=$2 WHERE user_id=$1',[staff,role]);
  for(const [path,method] of [['status','GET'],['outlets','GET'],['start-trial','POST']] as const){
   const denied=await fetch(base+'/api/v1/subscription/'+path,{method,headers:{authorization:'Bearer independent-staff'}});
   assert.equal(denied.status,403,'Membership '+role+' must not silently create an owner tenant');
   assert.equal((await denied.json()).error,'STAFF_WORKSPACE_SELECTION_REQUIRED');
  }
 }
 assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n,beforeStaff);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscriptions')).rows[0].n,1);
 // The enrollment probes expose only booleans; they add no PIN or membership mutation access.
 const asRole=(role:string,fn:(c:Db)=>Promise<unknown>)=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);return fn(c);});
 for(const role of ['svc_billing','svc_pos']){
  assert.equal((await asRole(role,c=>c.query('SELECT internal.has_active_staff_assignment($1) AS assigned',[staff])) as any).rows[0].assigned,true);
  assert.equal((await asRole(role,c=>c.query('SELECT internal.has_active_staff_assignment($1) AS assigned',[randomUUID()])) as any).rows[0].assigned,false);
  assert.equal((await asRole(role,c=>c.query('SELECT internal.is_staff_only_identity($1) AS staff_only',[pendingStaff])) as any).rows[0].staff_only,true);
  assert.equal((await asRole(role,c=>c.query('SELECT internal.is_staff_only_identity($1) AS staff_only',[owner])) as any).rows[0].staff_only,false);
 }
 for(const role of ['svc_billing','svc_pos','svc_membership_probe']){
  await assert.rejects(()=>asRole(role,c=>c.query('SELECT pin FROM internal.memberships')),/permission denied/);
  await assert.rejects(()=>asRole(role,c=>c.query('UPDATE internal.memberships SET is_active=false')),/permission denied/);
 }
 await assert.rejects(()=>asRole('svc_auth',c=>c.query('SELECT internal.has_active_staff_assignment($1)',[staff])),/permission denied/);
 await assert.rejects(()=>asRole('svc_auth',c=>c.query('SELECT internal.is_staff_only_identity($1)',[pendingStaff])),/permission denied/);
 const probe=(await db.query("SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolcanlogin,p.prosecdef,pg_has_role('svc_billing',r.oid,'MEMBER') AS billing_member,pg_has_role('svc_pos',r.oid,'MEMBER') AS pos_member FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='internal.has_active_staff_assignment(text)'::regprocedure")).rows[0];
 assert.equal(probe.rolname,'svc_membership_probe');assert(probe.prosecdef);assert(!probe.rolsuper&&!probe.rolbypassrls&&!probe.rolcanlogin&&!probe.billing_member&&!probe.pos_member);
 await db.exec(fs.readFileSync('migrations/0071_staff_billing_enrollment_guard.sql','utf8'));
 await db.exec(fs.readFileSync('migrations/0080_pos_owner_onboarding_guard.sql','utf8'));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n,beforeStaff,'Migration replay creates no tenant');
 // Ownership of A plus membership of B keeps A's existing legacy subscription.
 const otherTenant=randomUUID();
 await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,is_active) VALUES($1,'Other owner business',$2,true)",[otherTenant,randomUUID()]);
 await db.query("INSERT INTO internal.memberships(user_id,tenant_id,role,scope_type) VALUES($1,$2,'CASHIER','TENANT')",[owner,otherTenant]);
 const ownerStatus=await fetch(base+'/api/v1/subscription/status',{headers});assert.equal(ownerStatus.status,200);
 assert.deepEqual((await ownerStatus.json()).subscription,status.subscription,'Foreign staff assignment never selects its billing tenant');
 const cold=express();cold.use(attach());const retryServer=cold.listen(0,'127.0.0.1');await new Promise<void>(r=>retryServer.once('listening',r));
 try{assert.equal((await fetch('http://127.0.0.1:'+(retryServer.address() as any).port+'/api/v1/subscription/status',{headers})).status,200);}finally{await new Promise<void>(r=>retryServer.close(()=>r()));}
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscriptions')).rows[0].n,1,'Cold-start replay preserves the existing subscription');
 assert.deepEqual((await db.query("SELECT row_to_json(p) AS value FROM billing.plans p WHERE id='historical-plan'")).rows,historical.rows,'Historical catalog rows are preserved');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM pos.transactions')).rows[0].n,0);
 for(const plan of SAAS_PLANS)assert.equal((await db.query('SELECT id FROM billing.plans WHERE id=$1',[plan.id])).rows.length,1);

 const workspaceTenant=randomUUID(),inactiveTenant=randomUUID(),mergedTenant=randomUUID(),merchant=randomUUID();
 const trialStart=new Date(Date.now()-86_400_000).toISOString();
 const initialize=(tenantId:unknown,authorization='Bearer workspace-owner')=>fetch(base+'/api/v1/subscription/start-trial',{
  method:'POST',headers:{'Content-Type':'application/json',authorization},body:JSON.stringify({intent:'initialize',tenantId}),
 });
 const assertDenied=async(tenantId:unknown,code:number,error:string,authorization?:string)=>{
  const response=await initialize(tenantId,authorization);
  assert.equal(response.status,code);
  assert.deepEqual(await response.json(),{ok:false,error});
 };
 const beforeWorkspace=(await db.query('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n;
 await assertDenied(workspaceTenant,403,'TENANT_OWNERSHIP_REQUIRED');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n,beforeWorkspace);
 await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Workspace owner')",[workspaceOwner,workspaceOwner+'@fixture.invalid']);
 await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,is_active,created_at) VALUES($1,'Workspace business',$2,true,$3),($4,'Inactive business',$5,false,$3)",[workspaceTenant,workspaceOwner,trialStart,inactiveTenant,inactiveOwner]);
 await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,is_active,merged_into,created_at) VALUES($1,'Merged business',$2,true,$3,$4)",[mergedTenant,workspaceOwner,workspaceTenant,trialStart]);
 await assertDenied(workspaceTenant,403,'TENANT_OWNERSHIP_REQUIRED');
 await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,is_active) VALUES($1,$2,'Workspace merchant','FNB',false)",[merchant,workspaceTenant]);
 await assertDenied(workspaceTenant,403,'TENANT_OWNERSHIP_REQUIRED');
 await db.query('UPDATE internal.merchants SET is_active=true WHERE id=$1',[merchant]);
 await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Foreign merchant','FNB'),($3,$4,'Archived merchant','FNB')",[randomUUID(),otherTenant,randomUUID(),mergedTenant]);
 await db.query('UPDATE internal.tenants SET external_ref=$2 WHERE id=$1',[otherTenant,workspaceOwner]);
 await db.query("INSERT INTO internal.memberships(user_id,tenant_id,role,scope_type) VALUES($1,$2,'OWNER','TENANT'),($3,$4,'CASHIER','TENANT')",[staff,workspaceTenant,workspaceOwner,otherTenant]);
 const staffTenant=(await db.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1',[pendingStaff])).rows[0].id;
 await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Erroneous staff merchant','FNB')",[randomUUID(),staffTenant]);
 await assertDenied('invalid',400,'INVALID_TENANT_ID');
 await assertDenied(workspaceTenant,401,'AUTHENTICATION_REQUIRED','Bearer anonymous');
 await assertDenied(workspaceTenant,403,'EMAIL_VERIFICATION_REQUIRED','Bearer unverified-owner');
 await assertDenied(workspaceTenant,403,'TENANT_OWNERSHIP_REQUIRED','Bearer independent-staff');
 await assertDenied(staffTenant,403,'STAFF_WORKSPACE_SELECTION_REQUIRED','Bearer pending-staff');
 await assertDenied(otherTenant,403,'TENANT_OWNERSHIP_REQUIRED');
 await assertDenied(mergedTenant,403,'TENANT_OWNERSHIP_REQUIRED');
 await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Inactive organization merchant','FNB')",[randomUUID(),inactiveTenant]);
 await assertDenied(inactiveTenant,403,'TENANT_OWNERSHIP_REQUIRED','Bearer inactive-owner');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscriptions')).rows[0].n,1,'Denied scopes create no subscription');

 const responses=await Promise.all([initialize(workspaceTenant),initialize(workspaceTenant)]);
 for(const response of responses)assert.equal(response.status,200);
 const [initialized,replay]=await Promise.all(responses.map(response=>response.json()));
 assert.deepEqual(replay,initialized);
 assert.equal(initialized.ok,true);
 assert.equal(initialized.subscription.tenantId,workspaceTenant);
 assert.equal(initialized.subscription.planId,TRIAL_PLAN_ID);
 assert.equal(initialized.subscription.status,'TRIAL');
 assert.equal(initialized.subscription.hasUsedTrial,true);
 assert.equal(initialized.subscription.trialStartedAt,trialStart);
 assert.equal(Date.parse(initialized.subscription.trialEndsAt)-Date.parse(trialStart),45*86_400_000);
 assert.equal(Date.parse(initialized.subscription.gracePeriodEnd)-Date.parse(trialStart),59*86_400_000);
 await db.query("UPDATE billing.subscriptions SET status='SUSPENDED',has_used_trial=false WHERE tenant_id=$1",[workspaceTenant]);
 const beforeReplay=(await db.query('SELECT row_to_json(s) AS value FROM billing.subscriptions s WHERE tenant_id=$1',[workspaceTenant])).rows;
 const suspended=await initialize(workspaceTenant);
 assert.equal(suspended.status,200);
 assert.equal((await suspended.json()).subscription.status,'SUSPENDED');
 assert.deepEqual((await db.query('SELECT row_to_json(s) AS value FROM billing.subscriptions s WHERE tenant_id=$1',[workspaceTenant])).rows,beforeReplay,'Initialization never reactivates or edits an existing subscription');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscriptions')).rows[0].n,2);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.outlets')).rows[0].n,0);
 console.log('PASS billing bootstrap: legacy cold catalog preserved; explicit trial requires a verified owner of an active tenant and business; staff and foreign scopes denied; concurrent replay preserves dates, existing status, and outlet limits');
}finally{await new Promise<void>(r=>server.close(()=>r()));await pg.close();}
