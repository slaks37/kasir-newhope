import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAuthProviderOperations,AuthOperationError,type AuthOperationsDependencies} from '../../services/shared/authProviderOperations';

const canonical=randomUUID(),other=randomUUID(),providerSubject='different-provider-user-id';
let mapped:string|null=canonical,active=true,verified=true,expired=false,passwordValid=true,legacyLoads=0,providerFailure=false,providerCalls=0;
let hasPassword=true,googleAccount=false,totp=true,proofFresh=true,proofMethod='totp';
let userId=providerSubject,lastHeaders=new Headers();
const mail:Array<{kind:string;body:any}>=[];
const pool={query:async(sql:string,params?:any[])=>{
 if(sql.includes('AS has_password'))return {rows:[{has_password:hasPassword,google_account:googleAccount}],rowCount:1};
 if(sql.includes('mfa_session_proofs')){assert(sql.includes("method='totp'"));assert(sql.includes("interval '5 minutes'"));assert(sql.includes("interval '30 seconds'"));assert.deepEqual(params,['live-fixture-session',providerSubject]);return {rows:proofFresh&&proofMethod==='totp'?[{fresh:1}]:[],rowCount:proofFresh?1:0};}
 return {rows:active?[{id:providerSubject,email:'fixture-owner@test.invalid',emailVerified:verified,isActive:true}]:[],rowCount:active?1:0};
}} as any;
const deps:AuthOperationsDependencies={provider:'neon',config:()=>({baseUrl:'https://auth.staging.invalid'}),
 reverse:async(_db,issuer,subject)=>{assert.equal(issuer,'https://auth.staging.invalid');return subject===canonical?providerSubject:null;},
 resolve:async(_db,issuer,subject,email)=>{assert.equal(issuer,'https://auth.staging.invalid');assert.equal(email,'fixture-owner@test.invalid');return subject===providerSubject?mapped:null;},
 legacy:async()=>{legacyLoads++;throw Error('LEGACY_MUST_NOT_LOAD');},
 runtime:async()=>{if(providerFailure)throw Error('PRIVATE_DATABASE_OR_PROVIDER_DETAIL');return {pool,auth:{api:{
  getSession:async({headers,query}:any)=>{providerCalls++;lastHeaders=headers;assert.equal(query.disableCookieCache,true);return expired?null:{session:{id:'live-fixture-session'},user:{id:userId,email:'fixture-owner@test.invalid',emailVerified:verified,isActive:active,twoFactorEnabled:totp}};},
  verifyPassword:async({headers,body}:any)=>{assert.equal(headers.get('authorization'),'Bearer signed-fixture-token');return {status:passwordValid&&body.password==='correct-fixture-password'};},
  requestPasswordReset:async({body}:any)=>{mail.push({kind:'reset',body});return {status:true};},
  sendVerificationEmail:async({body}:any)=>{mail.push({kind:'confirmation',body});return {status:true};},
 }}};},
};
const ops=createAuthProviderOperations(deps);assert.equal(ops.provider,'neon');assert.equal(ops.configured,true);
assert.deepEqual(await ops.ownerIdentity(canonical),{email:'fixture-owner@test.invalid',verified:true});
assert.equal(await ops.ownerIdentity(other),null);assert.equal(await ops.ownerIdentity('not-a-canonical-uuid'),null);
verified=false;assert.deepEqual(await ops.ownerIdentity(canonical),{email:'fixture-owner@test.invalid',verified:false});verified=true;
active=false;assert.equal(await ops.ownerIdentity(canonical),null);active=true;
const request={headers:{authorization:'Bearer signed-fixture-token',cookie:'private-session=fixture','x-auth-sub':other,'x-auth-email':'attacker@test.invalid'}};
assert.equal(await ops.reauthenticate(request,canonical,'correct-fixture-password'),true);assert.equal(lastHeaders.get('x-auth-sub'),null);assert.equal(lastHeaders.get('x-auth-email'),null);
passwordValid=false;assert.equal(await ops.reauthenticate(request,canonical,'correct-fixture-password'),false);passwordValid=true;
mapped=other;assert.equal(await ops.reauthenticate(request,canonical,'correct-fixture-password'),false);mapped=canonical;
userId='another-provider-user';assert.equal(await ops.reauthenticate(request,canonical,'correct-fixture-password'),false);userId=providerSubject;
expired=true;assert.equal(await ops.reauthenticate(request,canonical,'correct-fixture-password'),false);expired=false;
active=false;assert.equal(await ops.reauthenticate(request,canonical,'correct-fixture-password'),false);active=true;
verified=false;assert.equal(await ops.reauthenticate(request,canonical,'correct-fixture-password'),false);verified=true;
hasPassword=false;googleAccount=true;assert.equal(await ops.reauthenticate(request,canonical,undefined),true,'Google-only owner can reauthenticate using session-bound recent TOTP');
proofFresh=false;assert.equal(await ops.reauthenticate(request,canonical,undefined),false);proofFresh=true;
proofMethod='recovery';assert.equal(await ops.reauthenticate(request,canonical,undefined),false);proofMethod='totp';
totp=false;assert.equal(await ops.reauthenticate(request,canonical,undefined),false);totp=true;
googleAccount=false;assert.equal(await ops.reauthenticate(request,canonical,undefined),false);googleAccount=true;
hasPassword=true;assert.equal(await ops.reauthenticate(request,canonical,undefined),false,'A password account never downgrades to passwordless reauthentication');
await ops.sendReset('fixture-owner@test.invalid');await ops.sendConfirmation('fixture-owner@test.invalid');assert.deepEqual(mail,[{kind:'reset',body:{email:'fixture-owner@test.invalid',redirectTo:'https://auth.staging.invalid/reset-password'}},{kind:'confirmation',body:{email:'fixture-owner@test.invalid',callbackURL:'https://auth.staging.invalid/login'}}]);
providerFailure=true;
for(const operation of [()=>ops.ownerIdentity(canonical),()=>ops.sendReset('fixture-owner@test.invalid'),()=>ops.sendConfirmation('fixture-owner@test.invalid'),()=>ops.reauthenticate(request,canonical,'correct-fixture-password')])await assert.rejects(operation,(error:unknown)=>error instanceof AuthOperationError&&!error.message.includes('PRIVATE_'));
assert.equal(legacyLoads,0,'Neon failure never loads or calls the legacy provider');assert(providerCalls>0);
const unavailable=createAuthProviderOperations({...deps,config:()=>{throw Error('NOT_CONFIGURED');}});assert.equal(unavailable.configured,false);assert.equal(legacyLoads,0);
console.log('PASS: provider-neutral support/reminders/owner reauth, explicit reverse mapping, live active verified sessions, canonical subject match, private errors, fixed recovery destinations, no Neon-to-legacy fallback. HTTP/provider responses simulated.');

// Execute the TOTP evidence predicate against PostgreSQL semantics rather than
// replacing freshness, proof method or session binding with a boolean mock.
const {PGlite}=await import('@electric-sql/pglite');const pg=new PGlite();
try{
 await pg.exec(`CREATE SCHEMA internal;CREATE SCHEMA newhope_auth;
  CREATE TABLE internal.users(id uuid PRIMARY KEY,email text,is_active boolean);
  CREATE TABLE internal.auth_identity_bindings(provider text,issuer text,provider_subject text,canonical_user_id uuid,is_active boolean);
  CREATE TABLE newhope_auth."user"(id text PRIMARY KEY,email text,"emailVerified" boolean,"isActive" boolean);
  CREATE TABLE newhope_auth.account(id text,"userId" text,"providerId" text,password text);
  CREATE TABLE newhope_auth.mfa_session_proofs(session_id text,user_id text,method text,verified_at timestamptz);`);
 await pg.query('INSERT INTO internal.users VALUES($1,$2,true)',[canonical,'fixture-owner@test.invalid']);
 await pg.query("INSERT INTO internal.auth_identity_bindings VALUES('better-auth',$1,$2,$3,true)",['https://auth.staging.invalid',providerSubject,canonical]);
 await pg.query('INSERT INTO newhope_auth."user" VALUES($1,$2,true,true)',[providerSubject,'fixture-owner@test.invalid']);
 await pg.query("INSERT INTO newhope_auth.account VALUES('google-account',$1,'google',null)",[providerSubject]);
 const actualPool={query:async(sql:string,params?:unknown[])=>{const r=await pg.query(sql,params);return {rows:r.rows,rowCount:r.rows.length};}} as any;
 const liveApi={getSession:async()=>({session:{id:'live-fixture-session'},user:{id:providerSubject,email:'fixture-owner@test.invalid',emailVerified:true,isActive:true,twoFactorEnabled:true}}),verifyPassword:async()=>({status:true}),requestPasswordReset:async()=>({status:true}),sendVerificationEmail:async()=>({status:true})};
 const sqlOps=createAuthProviderOperations({provider:'neon',config:deps.config,runtime:async()=>({pool:actualPool,auth:{api:liveApi}})});
 assert.deepEqual(await sqlOps.ownerIdentity(canonical),{email:'fixture-owner@test.invalid',verified:true});
 for(const row of [
  {method:'totp',seconds:-30,session:'live-fixture-session',user:providerSubject,accepted:true},
  {method:'totp',seconds:-301,session:'live-fixture-session',user:providerSubject,accepted:false},
  {method:'totp',seconds:90,session:'live-fixture-session',user:providerSubject,accepted:false},
  {method:'recovery',seconds:-30,session:'live-fixture-session',user:providerSubject,accepted:false},
  {method:'totp',seconds:-30,session:'other-session',user:providerSubject,accepted:false},
  {method:'totp',seconds:-30,session:'live-fixture-session',user:'other-provider',accepted:false},
 ]){
  await pg.exec('DELETE FROM newhope_auth.mfa_session_proofs');
  await pg.query("INSERT INTO newhope_auth.mfa_session_proofs VALUES($1,$2,$3,now()+$4*interval '1 second')",[row.session,row.user,row.method,row.seconds]);
  assert.equal(await sqlOps.reauthenticate(request,canonical,undefined),row.accepted,JSON.stringify(row));
 }
 await pg.query('UPDATE internal.auth_identity_bindings SET is_active=false WHERE canonical_user_id=$1',[canonical]);assert.equal(await sqlOps.ownerIdentity(canonical),null);assert.equal(await sqlOps.reauthenticate(request,canonical,undefined),false);
 console.log('PASS PostgreSQL: Google-only reauthentication requires matching active canonical mapping and exact live-session recent TOTP; stale/future/recovery/wrong-session/wrong-user evidence denied.');
}finally{await pg.close();}
