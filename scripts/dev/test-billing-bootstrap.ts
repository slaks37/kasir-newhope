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
const db=wrap(pg),owner=randomUUID(),staff=randomUUID();
assert.equal((await db.query('SELECT id FROM billing.plans WHERE id=$1',[TRIAL_PLAN_ID])).rows.length,0,'No test helper preloads the missing canonical trial plan');
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Bootstrap owner')",[owner,owner+'@fixture.invalid']);
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Independent staff')",[staff,staff+'@fixture.invalid']);
await db.query("INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,product_limit,features) VALUES('historical-plan','Historical',1,'MONTHLY',12345,25,'[]')");
const historical=await db.query("SELECT row_to_json(p) AS value FROM billing.plans p WHERE id='historical-plan'");
const app=express();let connections=0;const auth=async(req:any)=>req.headers.authorization==='Bearer verified-fixture'?{subject:owner,isEmailVerified:true}:req.headers.authorization==='Bearer independent-staff'?{subject:staff,isEmailVerified:true}:null;
const attach=()=>createBillingHandler(auth,async()=>{connections++;return db;});app.use(attach());
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base='http://127.0.0.1:'+(server.address() as any).port,headers={authorization:'Bearer verified-fixture'};
try{
 assert.equal((await fetch(base+'/api/v1/subscription/status')).status,401);assert.equal(connections,0,'Anonymous requests never seed or connect');
 const first=await fetch(base+'/api/v1/subscription/status',{headers});assert.equal(first.status,200);const status=await first.json();assert.equal(status.ok,true);assert.equal(status.subscription.planId,TRIAL_PLAN_ID);assert.equal(status.subscription.status,'TRIAL');
 assert.equal((await fetch(base+'/api/v1/subscription/status',{headers})).status,200);assert.equal(connections,1,'Warm runtime shares initialization');
 const tenantId=(await db.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1',[owner])).rows[0].id;
 await db.query("INSERT INTO internal.memberships(user_id,tenant_id,role,scope_type) VALUES($1,$2,'CASHIER','TENANT')",[staff,tenantId]);
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
 // The billing runtime sees only a boolean, never membership rows or PINs.
 const asRole=(role:string,fn:(c:Db)=>Promise<unknown>)=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);return fn(c);});
 assert.equal((await asRole('svc_billing',c=>c.query('SELECT internal.has_active_staff_assignment($1) AS assigned',[staff])) as any).rows[0].assigned,true);
 assert.equal((await asRole('svc_billing',c=>c.query('SELECT internal.has_active_staff_assignment($1) AS assigned',[randomUUID()])) as any).rows[0].assigned,false);
 for(const role of ['svc_billing','svc_membership_probe']){
  await assert.rejects(()=>asRole(role,c=>c.query('SELECT pin FROM internal.memberships')),/permission denied/);
  await assert.rejects(()=>asRole(role,c=>c.query('UPDATE internal.memberships SET is_active=false')),/permission denied/);
 }
 for(const role of ['svc_auth','svc_pos'])await assert.rejects(()=>asRole(role,c=>c.query('SELECT internal.has_active_staff_assignment($1)',[staff])),/permission denied/);
 const probe=(await db.query("SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolcanlogin,p.prosecdef,pg_has_role('svc_billing',r.oid,'MEMBER') AS runtime_member FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='internal.has_active_staff_assignment(text)'::regprocedure")).rows[0];
 assert.equal(probe.rolname,'svc_membership_probe');assert(probe.prosecdef);assert(!probe.rolsuper&&!probe.rolbypassrls&&!probe.rolcanlogin&&!probe.runtime_member);
 await db.exec(fs.readFileSync('migrations/0071_staff_billing_enrollment_guard.sql','utf8'));
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
 console.log('PASS serverless billing bootstrap: cold catalog/replay preserved; ten staff roles denied implicit owner enrollment and billing, narrow NOLOGIN boolean probe with no PIN/write authority, replay preserves data, actual owner path retained; no financial ledger writes');
}finally{await new Promise<void>(r=>server.close(()=>r()));await pg.close();}
