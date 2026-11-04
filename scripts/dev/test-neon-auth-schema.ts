import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {Db} from '../../services/shared/db';
import {resolveAuthIdentity,reverseAuthIdentity,authIdentityBusinessFingerprint,planAuthIdentityMigration,applyAuthIdentityMigration,type IdentityMigrationManifest} from '../../services/shared/authIdentity';

const pg=new PGlite();
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows||r.rows.length};},exec:async sql=>{await runner.exec(sql);},tx:async fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
const db=wrap(pg),issuer='https://auth.fixture.invalid';
await db.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
for(const file of files)await db.exec(fs.readFileSync(file,'utf8'));
for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
await db.exec(fs.readFileSync('scripts/db/verification-fixture.sql','utf8'));
await db.exec('CREATE ROLE svc_backoffice NOLOGIN;');
// Replaying both additive migrations retains the narrow enrollment owner.
for(const file of ['migrations/0069_neon_auth_identity.sql','migrations/0070_neon_auth_runtime.sql'])await db.exec(fs.readFileSync(file,'utf8'));
const role=(name:string,fn:(c:Db)=>Promise<any>)=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+name);return fn(c);});
const authUser=async(id:string,email:string,verified=true,active=true,intent=true)=>role('svc_auth',async c=>{
 await c.query('INSERT INTO newhope_auth."user"(id,name,email,"emailVerified","isActive") VALUES($1,$2,$3,$4,$5)',[id,'Synthetic account',email,verified,active]);
 if(intent)await c.query('INSERT INTO newhope_auth.registration_intents(user_id) VALUES($1)',[id]);
});
const enroll=(id:string,source=issuer)=>role('svc_auth',async c=>(await c.query('SELECT newhope_auth.enroll_new_identity($1,$2) AS id',[id,source])).rows[0].id as string|null);
const owner=(await db.query(`SELECT r.rolname,r.rolsuper,r.rolbypassrls,p.prosecdef FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='newhope_auth.enroll_new_identity(text,text)'::regprocedure`)).rows[0];
assert.equal(owner.rolname,'svc_auth_enrollment');assert.equal(owner.rolsuper,false);assert.equal(owner.rolbypassrls,false);assert.equal(owner.prosecdef,true);
assert.equal((await db.query("SELECT pg_has_role('svc_auth','svc_auth_enrollment','MEMBER') AS member")).rows[0].member,false,'Runtime cannot assume the definer role');
assert.equal((await db.query("SELECT has_schema_privilege('svc_auth_enrollment','newhope_auth','CREATE') AS allowed")).rows[0].allowed,false);
const rls=(await db.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='newhope_auth' AND c.relkind='r'`)).rows;
assert(rls.length>=10);assert(rls.every(r=>r.relrowsecurity&&r.relforcerowsecurity),'Auth tables must force RLS even for a non-superuser owner');
const tenantCount=async()=>(await db.query('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n;
const membershipCount=async()=>(await db.query('SELECT count(*)::int AS n FROM internal.memberships')).rows[0].n;
const usersBefore=(await db.query('SELECT count(*)::int AS n FROM internal.users')).rows[0].n,tenantsBefore=await tenantCount(),membersBefore=await membershipCount();
for(const [id,verified,active,intent] of [['unverified',false,true,true],['inactive',true,false,true],['without-intent',true,true,false]] as const){await authUser(id,id+'@fixture.invalid',verified,active,intent);assert.equal(await enroll(id),null);}
assert.equal(await enroll('missing-user'),null);
await authUser('fresh-opaque-provider-id','fresh@fixture.invalid');
assert.equal(await enroll('fresh-opaque-provider-id','http://auth.fixture.invalid'),null);
assert.equal(await enroll('fresh-opaque-provider-id','https://user@auth.fixture.invalid'),null);
const fresh=await enroll('fresh-opaque-provider-id');assert.match(fresh!,/^[a-f0-9-]{36}$/);assert.notEqual(fresh,'fresh-opaque-provider-id');
assert.equal(await enroll('fresh-opaque-provider-id'),null,'Consumed intent cannot enroll again');
assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.users')).rows[0].n,usersBefore+1);assert.equal(await tenantCount(),tenantsBefore);assert.equal(await membershipCount(),membersBefore);
const input={provider:'better-auth' as const,issuer,subject:'fresh-opaque-provider-id',email:'fresh@fixture.invalid',isEmailVerified:true};
await role('svc_auth',async c=>{assert.equal(await resolveAuthIdentity(c,input),fresh);assert.equal(await reverseAuthIdentity(c,{provider:'better-auth',issuer,canonicalSubject:fresh!}),input.subject);});
assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.auth_identity_enrollment_events WHERE canonical_user_id=$1',[fresh])).rows[0].n,1);
const canonical=(await db.query("SELECT id FROM pos.users WHERE username LIKE 'verify-%' ORDER BY username LIMIT 1")).rows[0].id as string;
await db.query('INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,$3)',[canonical,'historical-staff@fixture.invalid','Historical cashier']);
await authUser('provider-id-different-from-history','HISTORICAL-STAFF@fixture.invalid');assert.equal(await enroll('provider-id-different-from-history'),null,'Email collision cannot create or claim a historical identity');
const manifest:IdentityMigrationManifest={version:1,provider:'better-auth',issuer,sourceSnapshotDigest:'e'.repeat(64),reviewerRef:'fixture-reviewed-staff-migration',freezeRef:'fixture-business-writers-frozen',mappings:[{providerSubject:'provider-id-different-from-history',canonicalSubject:canonical,evidenceRef:'fixture-explicit-owner-proof'}]};
const before=await authIdentityBusinessFingerprint(db),plan=await planAuthIdentityMigration(db,manifest);await applyAuthIdentityMigration(db,manifest,plan);assert.equal(await authIdentityBusinessFingerprint(db),before);
await role('svc_auth',async c=>{assert.equal(await resolveAuthIdentity(c,{...input,subject:'provider-id-different-from-history',email:'HISTORICAL-STAFF@fixture.invalid'}),canonical);});
assert((await db.query('SELECT count(*)::int AS n FROM pos.transactions WHERE cashier_user_id=$1',[canonical])).rows[0].n>0,'Historical ledger cashier is the same canonical UUID');
for(const name of ['svc_auth','svc_internal']){
 await assert.rejects(()=>role(name,c=>c.query("UPDATE internal.auth_identity_bindings SET canonical_user_id=$1 WHERE provider_subject='provider-id-different-from-history'",[fresh])),/permission denied/);
 await assert.rejects(()=>role(name,c=>c.query("INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,verification_ref,manifest_digest) VALUES('better-auth',$1,'forged',$2,'forged-owner-proof',$3)",[issuer,fresh,'a'.repeat(64)])),/permission denied/);
}
for(const name of ['anon','authenticated','service_role','svc_internal','svc_pos','svc_billing','svc_ai','svc_backoffice'])for(const table of ['user','account','session','twoFactor','registration_intents','native_handoffs'])await assert.rejects(()=>role(name,c=>c.query('SELECT * FROM newhope_auth."'+table+'"')),/permission denied/);
await assert.rejects(()=>role('svc_internal',c=>c.query('SELECT newhope_auth.enroll_new_identity($1,$2)',['fresh-opaque-provider-id',issuer])),/permission denied/);
for(const table of ['account','session','twoFactor'])await assert.rejects(()=>role('svc_auth_enrollment',c=>c.query('SELECT * FROM newhope_auth."'+table+'"')),/permission denied/);
await assert.rejects(()=>role('svc_auth',c=>c.query('SELECT * FROM pos.transactions')),/permission denied/);
// Replaying provisioning refuses a pre-existing unsafe runtime role.
await db.exec('ALTER ROLE svc_auth BYPASSRLS');await assert.rejects(()=>db.exec(fs.readFileSync('migrations/0070_neon_auth_runtime.sql','utf8')),/UNSAFE_AUTH_RUNTIME_ROLE/);await db.exec('ALTER ROLE svc_auth NOBYPASSRLS');
await db.close();
console.log('PASS Neon auth schema: all migrations and replay, forced RLS with restricted non-superuser enrollment definer, verified active intent only, canonical historical cashier continuity, no tenant/membership auto-create, immutable mappings and auth-secret/service denials');
