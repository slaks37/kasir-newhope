import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import express from 'express';
import {randomUUID,randomBytes} from 'node:crypto';
import {stagingTarget,projectId,branchId} from './better-target.mjs';
import {planIdentityImport,applyIdentityImport,revokeIdentityImport} from './identity-core.mjs';

const {env,...transport}=stagingTarget();Object.assign(process.env,env,{DATABASE_URL:transport.connectionString});
const {createBetterAuthRuntime}=await import('../../services/shared/betterAuth.ts');
const {authenticateBetterBearer}=await import('../../services/shared/betterAuthPrincipal.ts');
const {createSyncHandler}=await import('../../src/server/syncHandler.ts');
const mails=[],runtime=createBetterAuthRuntime(undefined,async mail=>mails.push(mail));
const c=new pg.Client(transport),origin=env.BETTER_AUTH_URL;
const evidence={projectId,branchId,scope:'Synthetic reviewed credential-free identity import on isolated branch; NOT customer restore or real-email delivery',startedAt:new Date().toISOString(),checks:{},status:'RUNNING'};
const headers=new Headers({origin});
let server,base;
async function app(path,token,body) {
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  return {status:response.status,data:await response.json()};
}
async function native(method,body,token) {
  const response=await runtime.auth.api[method]({body,headers:token?new Headers({origin,authorization:'Bearer '+token}):headers,asResponse:true});
  return {status:response.status,data:await response.json().catch(()=>null),token:response.headers.get('set-auth-token')};
}
async function reset(email) {
  const result=await native('requestPasswordReset',{email,redirectTo:origin+'/reset-password'});assert.equal(result.status,200);
  const mail=mails.filter(m=>m.email===email&&m.kind==='RESET').at(-1);assert(mail);
  return new URL(mail.url).pathname.split('/').at(-1);
}
try {
  await c.connect();assert(c.connection.stream.authorized&&c.connection.stream.encrypted);
  if(!(await c.query("SELECT to_regclass('newhope_auth.identity_import_batches') AS table")).rows[0].table) {
    await c.query('BEGIN');await c.query(fs.readFileSync('neon/migrations/0006_identity_import_audit.sql','utf8'));await c.query('COMMIT');
  }
  if(!(await c.query("SELECT to_regclass('newhope_auth.identity_import_canonical_creates') AS table")).rows[0].table) {
    await c.query('BEGIN');await c.query(fs.readFileSync('neon/migrations/0007_identity_canonical_create_evidence.sql','utf8'));await c.query('COMMIT');
  }
  const owner=randomUUID(),platform=randomUUID(),staff=randomUUID(),tenant=randomUUID(),outlet=randomUUID();
  const users=[owner,platform,staff].map((id,i)=>({id,email:'import-'+id+'@example.invalid',name:['Synthetic restored owner','Synthetic platform support','Synthetic staff'][i],emailVerified:true,isActive:true}));
  await c.query('BEGIN');
  for(const u of users)await c.query('INSERT INTO internal.users(id,email,full_name,is_active,is_platform_user,platform_role) VALUES($1,$2,$3,true,$4,$5)',[u.id,u.email,u.name,u.id===platform,u.id===platform?'ROLE_INTERNAL_SUPPORT':null]);
  await c.query("INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref,owner_user_id) VALUES($1,'Synthetic imported paid tenant','FNB',$2::text,$2::uuid)",[tenant,owner]);
  await c.query("INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref) VALUES($1,'Synthetic imported paid tenant','FNB',$2)",[tenant,owner]);
  await c.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$1,'Synthetic imported business','FNB',$2)",[tenant,owner+'_FNB']);
  await c.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$2,'Synthetic branch')",[outlet,tenant]);
  for(const [id,role] of [[owner,'OWNER'],[staff,'CASHIER']])await c.query('INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,role,pin) VALUES($1,$2,$3,$3,$4,$5)',[randomUUID(),id,tenant,role,randomBytes(32).toString('hex')]);
  await c.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,has_used_trial) VALUES($1,$2,'plan-pro-monthly','ACTIVE',now(),now()+interval '27 days',true)",[randomUUID(),tenant]);
  await c.query("INSERT INTO ai.merchant_ai_credits(merchant_id,tenant_id,balance,monthly_grant,used_this_month,period_reset_at) VALUES($1,$1,137,90,23,date_trunc('month',now())+interval '1 month')",[tenant]);
  await c.query('COMMIT');
  const manifest={version:1,sourceProject:'fqxrhumsgigcgjtlbfuo',backupRef:'SYNTHETIC-ENCRYPTED-BACKUP-'+randomUUID(),reviewerRef:'SYNTHETIC-REVIEW-'+randomUUID(),users};
  const plan=await planIdentityImport(c,manifest,origin);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM newhope_auth."user" WHERE id=ANY($1::text[])',[users.map(u=>u.id)])).rows[0].n,0,'Plan performs no identity writes');
  await assert.rejects(()=>applyIdentityImport(c,manifest,{...plan,targetDigest:'0'.repeat(64)}),/IDENTITY_REVIEW_TARGET_CHANGED/);
  const applied=await applyIdentityImport(c,manifest,plan);assert.equal(applied.status,'APPLIED');
  assert.equal(applied.credentialsImported,false);assert.equal(applied.businessDigest,plan.businessDigest);
  assert.equal((await applyIdentityImport(c,manifest,plan)).status,'UNCHANGED');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM newhope_auth.account WHERE "userId"=ANY($1::text[])',[users.map(u=>u.id)])).rows[0].n,0,'Import creates no reusable credential');
  evidence.checks.reviewedImport={status:'PASS',users:3,sameCanonicalUUID:true,noCredentialsSessionsMfaTransferred:true,planReadOnly:true,targetDriftRejected:true,idempotent:true,businessDigest:applied.businessDigest};
  const ownerUser=users[0],password=randomBytes(24).toString('base64url');
  assert.equal((await native('signInEmail',{email:ownerUser.email,password})).status,401,'No pre-reset login');
  const resetToken=await reset(ownerUser.email);assert.equal((await native('resetPassword',{token:resetToken,newPassword:password})).status,200);
  assert.equal((await native('resetPassword',{token:resetToken,newPassword:password})).status,400,'Spent reset denied');
  const login=await native('signInEmail',{email:ownerUser.email,password});assert.equal(login.status,200);assert(login.token);
  const p=await authenticateBetterBearer(login.token);assert.equal(p.subject,owner);assert.equal(p.aal,'aal1');
  const api=express();api.use(createSyncHandler());server=api.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
  const ownerIdentity=await app('/api/v1/sync/identity',login.token);assert.equal(ownerIdentity.status,200);assert.equal(ownerIdentity.data.needsOnboarding,false);
  const ownerDirectory=await app('/api/v1/sync/business',login.token);assert.equal(ownerDirectory.status,200);assert.equal(ownerDirectory.data.businesses[0].legacyAlias,owner+'_FNB');assert.equal(ownerDirectory.data.businesses[0].outlets[0].outletId,outlet);
  for(const user of users.slice(1)) {
    const privatePassword=randomBytes(24).toString('base64url'),claim=await reset(user.email);
    assert.equal((await native('resetPassword',{token:claim,newPassword:privatePassword})).status,200);
    const signed=await native('signInEmail',{email:user.email,password:privatePassword});assert.equal(signed.status,200);assert(signed.token);
    const identity=await app('/api/v1/sync/identity',signed.token);assert.equal(identity.status,200);assert.equal(identity.data.subject,user.id);assert.equal(identity.data.needsOnboarding,false);
    const directory=await app('/api/v1/sync/business',signed.token);assert.equal(directory.status,200);assert.deepEqual(directory.data.businesses,[],'Current owner-only directory must not widen staff/platform merchant authority');
    assert.equal((await app('/api/v1/sync/neon-onboarding',signed.token,{business_sector:'RETAIL',role:'SUPERADMIN'})).status,409);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM internal.tenants WHERE owner_user_ref=$1',[user.id])).rows[0].n,0,'Imported platform/staff login must not create a tenant');
  }
  const newcomerEmail='new-import-test-'+randomUUID()+'@example.invalid',newcomerPassword=randomBytes(24).toString('base64url');
  assert.equal((await native('signUpEmail',{email:newcomerEmail,password:newcomerPassword,name:'Synthetic new owner',callbackURL:origin+'/login'})).status,200);
  const verification=mails.find(m=>m.email===newcomerEmail&&m.kind==='VERIFY');assert(verification);
  const verified=await runtime.auth.api.verifyEmail({query:{token:new URL(verification.url).searchParams.get('token'),callbackURL:origin+'/login'},headers,asResponse:true});assert.equal(verified.status,302);
  const newcomer=await native('signInEmail',{email:newcomerEmail,password:newcomerPassword});assert.equal(newcomer.status,200);assert(newcomer.token);
  assert.equal((await app('/api/v1/sync/identity',newcomer.token)).data.needsOnboarding,true);
  assert.equal((await app('/api/v1/sync/neon-onboarding',newcomer.token,{business_sector:'RETAIL'})).data.created,true);
  assert.equal((await app('/api/v1/sync/identity',newcomer.token)).data.needsOnboarding,false);
  evidence.checks.signinScope={status:'PASS',existingOwnerUUIDAliasOutletsPreserved:true,importedPlatformStaffNoOnboarding:true,staffScopeNotWidened:true,newVerifiedOwnerStillOnboards:true};
  assert.equal(await authenticateBetterBearer('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvbGQtc3VwYWJhc2Utc2Vzc2lvbiJ9.invalid-signature'),null);
  const secondToken=await reset(ownerUser.email),newPassword=randomBytes(24).toString('base64url');
  assert.equal((await native('resetPassword',{token:secondToken,newPassword:newPassword})).status,200);
  assert.equal(await authenticateBetterBearer(login.token),null,'Password reset revokes existing native signed session');
  const current=await native('signInEmail',{email:ownerUser.email,password:newPassword});assert.equal(current.status,200);
  evidence.checks.nativeClaim={status:'PASS',mailSinkOnly:true,resetCreatesNativeCredential:true,oldPasswordDenied:true,resetSingleUse:true,oldSupabaseSessionDenied:true,nativeSessionRevokedByReset:true};
  const collisionId=randomUUID(),sameEmail=users[0].email;
  await c.query('INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,$2,$3,true)',[collisionId,'collision-'+collisionId+'@example.invalid','Synthetic collision']);
  const duplicate={...manifest,backupRef:'SYNTHETIC-COLLISION-'+randomUUID(),users:[{...users[0],id:collisionId,email:sameEmail}]};
  await assert.rejects(()=>planIdentityImport(c,duplicate,origin),/IDENTITY_CANONICAL_RESTORE_MISMATCH/);
  const differentEmail='collision-native-'+randomUUID()+'@example.invalid';
  const canonicalCollision=randomUUID();await c.query('INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,$2,$3,true)',[canonicalCollision,differentEmail,'Synthetic native collision']);
  await c.query('INSERT INTO newhope_auth."user"(id,email,name,"emailVerified","isActive") VALUES($1,$2,$3,true,true)',[randomUUID(),differentEmail,'Unrelated native account']);
  await assert.rejects(()=>planIdentityImport(c,{...manifest,users:[{...users[0],id:canonicalCollision,email:differentEmail}]},origin),/IDENTITY_TARGET_ACCOUNT_COLLISION/);
  await assert.rejects(()=>c.query("UPDATE newhope_auth.identity_import_batches SET reviewer_ref='forged' WHERE id=$1",[applied.batchId]),e=>e.code==='42501');
  evidence.checks.collisions={status:'PASS',matchingEmailDifferentUUIDDenied:true,unrelatedNativeAccountDenied:true,auditMutationDenied:true};
  const revoked=await revokeIdentityImport(c,applied.batchId,'SYNTHETIC-ROLLBACK-REVIEW','Synthetic rehearsal rollback; preserve business rows');assert.equal(revoked.status,'REVOKED');
  assert.equal(revoked.businessDigest,applied.businessDigest);assert.equal(await authenticateBetterBearer(current.token),null);
  assert.equal((await revokeIdentityImport(c,applied.batchId,'SYNTHETIC-ROLLBACK-REVIEW','Synthetic retry')).status,'UNCHANGED');
  await assert.rejects(()=>applyIdentityImport(c,manifest,plan),/IDENTITY_REVOKED_BATCH_REAPPLY_DENIED/);
  evidence.checks.rollback={status:'PASS',nativeSessionDenied:true,businessDigestUnchanged:true,repeatSafe:true,revokedBatchCannotReapply:true};
  const sourceOnly=randomUUID(),sourceTenant=randomUUID(),sourceEmail='source-only-'+sourceOnly+'@example.invalid';
  await c.query("INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref) VALUES($1,'Synthetic legacy source UUID owner','RETAIL',$2)",[sourceTenant,sourceOnly]);
  await c.query("INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref) VALUES($1,'Synthetic legacy source UUID owner','RETAIL',$2)",[sourceTenant,sourceOnly]);
  const creation={...manifest,backupRef:'SYNTHETIC-CREATE-'+randomUUID(),users:[{id:sourceOnly,email:sourceEmail,emailVerified:true,isActive:true,name:'Synthetic source UUID profile'}],canonicalCreateIds:[sourceOnly]};
  const creationPlan=await planIdentityImport(c,creation,origin),created=await applyIdentityImport(c,creation,creationPlan);
  assert.equal(created.status,'APPLIED');assert.deepEqual(creationPlan.canonicalCreates,[sourceOnly]);
  const profile=(await c.query('SELECT id,is_platform_user,platform_role FROM internal.users WHERE id=$1',[sourceOnly])).rows[0];assert.equal(profile.id,sourceOnly);assert.equal(profile.is_platform_user,false);assert.equal(profile.platform_role,null);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM internal.memberships WHERE user_id=$1',[sourceOnly])).rows[0].n,0);
  assert.equal((await revokeIdentityImport(c,created.batchId,'SYNTHETIC-CREATE-ROLLBACK','Synthetic explicit source UUID profile revoke')).businessDigest,created.businessDigest);
  const noEvidence=randomUUID();
  await assert.rejects(()=>planIdentityImport(c,{...creation,users:[{...creation.users[0],id:noEvidence,email:'no-evidence-'+noEvidence+'@example.invalid'}],canonicalCreateIds:[noEvidence]},origin),/IDENTITY_CANONICAL_UUID_EVIDENCE_MISSING/);
  const emailCollision=randomUUID();
  await assert.rejects(()=>planIdentityImport(c,{...creation,users:[{...creation.users[0],id:emailCollision,email:users[0].email}],canonicalCreateIds:[emailCollision]},origin),/IDENTITY_CANONICAL_EMAIL_COLLISION/);
  evidence.checks.explicitCanonicalCreation={status:'PASS',sameSourceUUIDOwnerRefRequired:true,noEmailLink:true,noPlatformRoleMembershipTenantTrialCreated:true,businessPreservedByRollback:true,noUUIDEvidenceDenied:true,differentUUIDEmailCollisionDenied:true};
  evidence.status='PASS';console.log('PASS: reviewed UUID-preserving import, native reset claim/revocation, no auto email links, atomic collision refusal and reversible batch revoke; synthetic data only');
}catch(e){evidence.status='FAIL';evidence.failure=e.message;throw e;}
finally {if(server)await new Promise(resolve=>server.close(resolve));await c.end();await runtime.close();evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/identity-import-rehearsal.json',JSON.stringify(evidence,null,2)+'\n');}
