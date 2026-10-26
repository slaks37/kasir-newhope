import {workspaceAcceptance} from './workspace-acceptance';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {rehearsalTarget} from './rehearsal-target.mjs';
import type {Db} from '../../services/shared/db';
import {resolveModuleAccess} from '../../services/pos/modules';
import {resetSchemaFeatureCache} from '../../services/shared/schemaFeatures';
import {loadMerchantSnapshot} from '../../services/ai/snapshotData';
const target=rehearsalTarget(process.env),admin=new pg.Client({connectionString:target,ssl:false});
const evidence:any={revision:process.env.GITHUB_SHA||'local',status:'RUNNING',scope:'Disposable PostgreSQL17, actual NOBYPASSRLS service logins, synthetic fixture only',checks:{}};
const connections:pg.Client[]=[];
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wrap=(client:pg.Client):Db=>({query:async(sql,params)=>{const r=await client.query(sql,params as any[]);return {rows:r.rows,rowCount:r.rowCount??0};},exec:async sql=>{await client.query(sql);},tx:async fn=>{await client.query('BEGIN');try{const value=await fn(wrap(client));await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}},close:()=>client.end()});
const apply=async(file:string)=>{await admin.query('BEGIN');try{await admin.query(fs.readFileSync(file,'utf8'));await admin.query('COMMIT');}catch(e){await admin.query('ROLLBACK');throw e;}};
const asService=async(role:string)=>{await admin.query(`ALTER ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'module-rehearsal-only'`);const url=new URL(target);url.username=role;url.password='module-rehearsal-only';const client=new pg.Client({connectionString:url.toString(),ssl:false});await client.connect();connections.push(client);const identity=(await client.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(identity.name,role);assert(!identity.rolsuper&&!identity.rolbypassrls);return wrap(client);};
await admin.connect();
try{
 assert.equal(Math.floor(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num)/10000),17,'Actual PostgreSQL17 is required');
 assert.equal((await admin.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN('r','p','v','m','S')")).rows[0].n,0,'Refuse populated targets');
 await admin.query('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN');
 const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_/.test(f)&&f!=='0001_compat.sql'&&Number(f.slice(0,4))<=62).sort().map(f=>'migrations/'+f)];
 for(const file of files)await apply(file);
 const owner=randomUUID(),staff=randomUUID(),tenant=randomUUID(),merchant=randomUUID(),outlet=randomUUID(),otherTenant=randomUUID(),otherMerchant=randomUUID(),otherOutlet=randomUUID();
 await admin.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Owner'),($3,$4,'Cashier')",[owner,owner+'@fixture.invalid',staff,staff+'@fixture.invalid']);
 await admin.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Module fixture',$2),($3,'Other fixture','other-owner')",[tenant,owner,otherTenant]);
 await admin.query("INSERT INTO pos.tenants(id,name) VALUES($1,'Legacy identity mirror')",[tenant]);
 await admin.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Brand','FNB',$3),($4,$5,'Other','FNB','other-alias')",[merchant,tenant,owner+'_FNB',otherMerchant,otherTenant]);
 await admin.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Main'),($4,$5,$6,'Other')",[outlet,tenant,merchant,otherOutlet,otherTenant,otherMerchant]);
 await admin.query("INSERT INTO internal.memberships(user_id,tenant_id,merchant_id,outlet_id,scope_type,role) VALUES($1,$2,$3,$4,'OUTLET','CASHIER')",[staff,tenant,merchant,outlet]);
 const fingerprint=async()=>digest((await admin.query("SELECT id,user_id,tenant_id,merchant_id,outlet_id,scope_type,role FROM internal.memberships ORDER BY id")).rows);
 const before=await fingerprint();
 for(let replay=0;replay<2;replay++)for(const file of ['0063_module_assignments.sql','0064_membership_tenant_reference.sql','0065_platform_health_identity.sql','0066_module_identity_read_grants.sql','0067_workspace_isolation.sql'])await apply('migrations/'+file);
 assert.equal(await fingerprint(),before,'Replay preserves membership IDs and scope');
 assert.equal((await admin.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='internal.memberships'::regclass AND confrelid='pos.tenants'::regclass")).rows[0].n,0);
 await apply('docs/security/free-plan-selection.sql');
 await admin.query("INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,features) VALUES('plan-pro-monthly','Fixture',3,'MONTHLY',299000,'[]')");
 await admin.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,'plan-pro-monthly','ACTIVE',now(),now()+interval '30 days')",[randomUUID(),tenant]);
 const internal=await asService('svc_internal'),billing=await asService('svc_billing'),pos=await asService('svc_pos'),ai=await asService('svc_ai');
 for(const service of [internal,billing,pos,ai])assert.match((await service.query('SELECT uuidv7()::text id')).rows[0].id,/^[a-f0-9]{8}-[a-f0-9]{4}-7/);
 await assert.rejects(()=>ai.query('SELECT * FROM internal.merchant_modules'),(e:any)=>e.code==='42501','AI receives only the narrow scope guard');
 assert.equal((await pos.query("SELECT has_sequence_privilege(current_user,'public.uuidv7_counter','USAGE') AS usage,has_sequence_privilege(current_user,'public.uuidv7_counter','UPDATE') AS reset")).rows[0].reset,false,'POS cannot reset the UUID counter');
 const context=async(db:Db,tid:string,mid:string,fn:(c:Db)=>Promise<void>)=>db.tx(async c=>{await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",[tid,mid]);await fn(c);});
 for(const [tid,mid]of[[tenant,merchant],[otherTenant,otherMerchant]])await context(internal,tid,mid,async c=>{await c.query("INSERT INTO internal.merchant_modules(tenant_id,merchant_id,module_id,enabled,guard_legacy_apis) VALUES($1,$2,'fnb',true,true)",[tid,mid]);});
 await context(billing,tenant,merchant,async c=>{await c.query("INSERT INTO billing.module_entitlements(tenant_id,merchant_id,module_id,enabled,features,expires_at,grant_reference) VALUES($1,$2,'fnb',true,ARRAY['overview','pos','tables','reports'],now()+interval '1 day','approved-synthetic-rehearsal')",[tenant,merchant]);});
 assert.equal((await pos.query('SELECT * FROM internal.merchant_modules')).rows.length,0,'No context means no rows');
 await context(pos,tenant,merchant,async c=>{assert.equal((await c.query('SELECT * FROM internal.merchant_modules')).rows.length,1);assert.equal((await c.query('SELECT * FROM billing.module_entitlements')).rows.length,1);});
 await context(pos,tenant,otherMerchant,async c=>{assert.equal((await c.query('SELECT * FROM internal.merchant_modules')).rows.length,0,'Cross-tenant merchant context cannot read');});
 await assert.rejects(()=>pos.query('UPDATE internal.merchant_modules SET enabled=false'),(e:any)=>e.code==='42501');
 await assert.rejects(()=>pos.query('SELECT pin FROM internal.memberships'),(e:any)=>e.code==='42501');
 process.env.NEW_HOPE_MODULE_WORKSPACES='1';resetSchemaFeatureCache();
 const access=await pos.tx(c=>resolveModuleAccess(c,staff,merchant,outlet));assert.equal(access.modules[0].id,'fnb');assert(!access.modules[0].permissions.includes('reports'));
 await assert.rejects(()=>pos.tx(c=>resolveModuleAccess(c,staff,otherMerchant,otherOutlet)),/MODULE_SCOPE_FORBIDDEN/);
 for(const role of ['anon','authenticated']){await admin.query('SET ROLE '+role);for(const table of ['internal.merchant_modules','internal.outlet_modules','billing.module_entitlements'])await assert.rejects(()=>admin.query('SELECT * FROM '+table),(e:any)=>e.code==='42501');await admin.query('RESET ROLE');}
 // Run the repaired db:verify data path on the same real server; replay is idempotent.
 for(let replay=0;replay<2;replay++){await admin.query(fs.readFileSync('scripts/db/verification-fixture.sql','utf8'));await admin.query(fs.readFileSync('scripts/db/verification-health.sql','utf8'));}
 assert.equal((await admin.query("SELECT count(*)::int n FROM contract.merchant_revenue WHERE business_id LIKE 'verify:merchant:%'")).rows[0].n,312);
 const cards=fs.readFileSync('scripts/db/metabase-cards.sql','utf8').split(';').map(s=>s.replace(/^\s*--.*$/gm,'').trim()).filter(s=>/^select/i.test(s));assert.equal(cards.length,8);for(const sql of cards)await admin.query(sql);
 const workflows=await workspaceAcceptance(wrap(admin),pos);
 const isolatedMerchant=(await admin.query('SELECT m.id,t.owner_user_ref FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id WHERE EXISTS(SELECT 1 FROM internal.merchant_modules mm WHERE mm.merchant_id=m.id AND mm.workspace_version=2) LIMIT 1')).rows[0];
 await assert.rejects(()=>loadMerchantSnapshot(ai,{subject:isolatedMerchant.owner_user_ref},isolatedMerchant.id),/EXPLICIT_WORKSPACE_REQUIRED/,'Actual AI service cannot use legacy snapshots for mixed modules');
 evidence.workspaceWorkflows=workflows;
 evidence.checks={postgres17:'PASS',migrationReplay:'PASS',membershipPreservation:'PASS',actualServiceLogins:'PASS',rls:'PASS',noPinPrivilege:'PASS',independentCashierRole:'PASS',crossScopeDenied:'PASS',canonicalFixtureReplay312:'PASS',biCards8:'PASS'};evidence.status='PASS';console.log('PASS: PostgreSQL17 0063/0064 replay, identity FK preservation, real service-role logins/RLS, independent cashier grant, canonical fixture replay and all 8 BI cards');
}catch(e:any){evidence.status='FAIL';evidence.failure={message:e.message,code:e.code};throw e;}
finally{delete process.env.NEW_HOPE_MODULE_WORKSPACES;fs.mkdirSync('build/module-rehearsal',{recursive:true});fs.writeFileSync('build/module-rehearsal/postgres17.json',JSON.stringify(evidence,null,2)+'\n');await Promise.all(connections.map(c=>c.end()));await admin.end();}
