import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {stagingTarget,projectId,branchId} from './better-target.mjs';

// Retain synthetic fixtures and audit evidence. Never connect to a source DB,
// auto-link matching emails, import customer credentials, or reset a branch.
const {env,...transport}=stagingTarget();
Object.assign(process.env,env,{DATABASE_URL:transport.connectionString});
const {createBetterAuthRuntime}=await import('../../services/shared/betterAuth.ts');
const {createBetterAuthHandler}=await import('../../src/server/betterAuthHandler.ts');
const {authenticateBetterBearer}=await import('../../services/shared/betterAuthPrincipal.ts');
const {createSyncHandler}=await import('../../src/server/syncHandler.ts');
const {adminSecurityError}=await import('../../src/server/adminSecurity.ts');
const {createOTP}=await import('@better-auth/utils/otp');
const {base32}=await import('@better-auth/utils/base32');
const mails=[],runtime=createBetterAuthRuntime(undefined,async mail=>mails.push(mail));
const pool=new pg.Pool({...transport,max:2});
const origin=env.BETTER_AUTH_URL;
const evidence={projectId,branchId,scope:'Synthetic continuity fixtures only; NOT a source database restore or an automated identity migration',startedAt:new Date().toISOString(),checks:{},status:'RUNNING'};
let server,base;
async function auth(path,body,cookie='',token='',expected=200,retried=false){
  const r=await fetch(base+'/api/auth'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',cookie,...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>null);
  if(r.status===429&&expected!==429&&!retried){
    const delay=Number(r.headers.get('retry-after')||60);
    assert(Number.isFinite(delay)&&delay>=0&&delay<=65,'Refuse an unbounded rate-limit wait');
    evidence.checks.rateLimitRespected=true;
    console.log('Respecting native authentication Retry-After before one retry');
    await new Promise(resolve=>setTimeout(resolve,(delay+1)*1000));
    return auth(path,body,cookie,token,expected,true);
  }
  assert.equal(r.status,expected,path+':'+r.status+':'+(data?.code||'unknown'));
  return {data,token:r.headers.get('set-auth-token'),cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
}
async function account(){
  const email='continuity-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
  const signup=await auth('/sign-up/email',{email,password,name:'Synthetic continuity',callbackURL:origin+'/login'});
  const mail=mails.find(m=>m.email===email&&m.kind==='VERIFY');assert(mail);
  const link=new URL(mail.url);await auth(link.pathname.replace('/api/auth','')+link.search,null,'','',302);
  const login=await auth('/sign-in/email',{email,password});assert(login.token);
  return {...login,email,password,userId:signup.data.user.id};
}
async function app(path,token,body){
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  return {status:r.status,data:await r.json()};
}
const q=(sql,values)=>pool.query(sql,values);
async function fingerprint(tenantId){
  const r=await q(`SELECT jsonb_build_object(
    'tenant',(SELECT to_jsonb(t) FROM internal.tenants t WHERE id=$1),
    'merchants',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM internal.merchants m WHERE tenant_id=$1),
    'outlets',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM internal.outlets o WHERE tenant_id=$1),
    'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM internal.memberships m WHERE tenant_id=$1),
    'subscriptions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM billing.subscriptions s WHERE tenant_id=$1),
    'wallet',(SELECT jsonb_agg(to_jsonb(w) ORDER BY merchant_id) FROM ai.merchant_ai_credits w WHERE tenant_id=$1)
  ) AS data`,[tenantId]);
  return createHash('sha256').update(JSON.stringify(r.rows[0].data)).digest('hex');
}
try{
  const probe=await pool.connect();assert(probe.connection.stream.authorized&&probe.connection.stream.encrypted);probe.release();
  const api=express();api.use((req,res,next)=>req.path.startsWith('/api/auth/')?void createBetterAuthHandler(()=>runtime)(req,res):next());
  api.use(createSyncHandler());server=api.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
  const sectors=[];
  for(const sector of ['RETAIL','CARWASH','BARBERSHOP']){
    const owner=await account();
    const onboard=await app('/api/v1/sync/neon-onboarding',owner.token,{business_sector:sector,store_name:'Synthetic '+sector,first_outlet_name:'Main',second_outlet_name:'Branch',role:'SUPERADMIN',tenantId:randomUUID()});
    assert.equal(onboard.status,200);assert.equal(onboard.data.created,true);
    const directory=await app('/api/v1/sync/business',owner.token);assert.equal(directory.status,200);assert.equal(directory.data.businesses[0].sector,sector);assert.equal(directory.data.businesses[0].outlets.length,2);
    assert.equal((await app('/api/v1/sync/neon-onboarding',owner.token,{business_sector:'FNB'})).data.created,false);
    const forged=await app('/api/v1/finance/pin',owner.token,{sector,outletId:randomUUID(),newPin:'529681',ownerPassword:owner.password});assert.equal(forged.status,403);
    sectors.push(sector);await auth('/sign-out',{},owner.cookie,owner.token);
  }
  evidence.checks.remainingSectors={status:'PASS',sectors,twoOutlets:true,foreignOutletDenied:true,retryDoesNotChangeSector:true};
  console.log('PASS: Retail, Carwash and Barbershop onboarding, outlet scope and retries');

  // Seed a previously restored canonical owner before application identity is
  // first resolved. The native account alone must not claim its matching email.
  const candidate=await account(),canonicalId=randomUUID(),tenantId=randomUUID(),outletId=randomUUID();
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query("INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,$2,'Synthetic restored owner',true)",[canonicalId,candidate.email]);
    await c.query("INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref,owner_user_id) VALUES($1,'Synthetic restored paid tenant','FNB',$2::text,$2::uuid)",[tenantId,canonicalId]);
    await c.query("INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref) VALUES($1,'Synthetic restored paid tenant','FNB',$2)",[tenantId,canonicalId]);
    await c.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$1,'Synthetic existing merchant','FNB',$2)",[tenantId,canonicalId+'_FNB']);
    await c.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$2,'Restored outlet')",[outletId,tenantId]);
    await c.query("INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,role,pin) VALUES($1,$2,$3,$3,'OWNER',$4)",[randomUUID(),canonicalId,tenantId,randomBytes(32).toString('hex')]);
    await c.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,has_used_trial) VALUES($1,$2,'plan-pro-monthly','ACTIVE',now(),now()+interval '27 days',true)",[randomUUID(),tenantId]);
    await c.query("INSERT INTO ai.merchant_ai_credits(merchant_id,tenant_id,balance,monthly_grant,used_this_month,period_reset_at) VALUES($1,$1,137,90,23,date_trunc('month',now())+interval '1 month')",[tenantId]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  assert.equal(await authenticateBetterBearer(candidate.token),null,'Matching email alone grants no imported authority');
  assert.equal((await app('/api/v1/sync/business',candidate.token)).status,401);
  const before=await fingerprint(tenantId);
  // Direct fixture setup stands in for an independently reviewed dual-proof
  // binding. This is NOT a publicly callable account-linking implementation.
  await q("INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,verification_ref) VALUES('better-auth',$1,$2,$3,'SYNTHETIC_REVIEWED_DUAL_PROOF')",[origin,candidate.userId,canonicalId]);
  assert.equal((await authenticateBetterBearer(candidate.token)).subject,canonicalId);
  const onboard=await app('/api/v1/sync/neon-onboarding',candidate.token,{role:'SUPERADMIN',business_sector:'RETAIL'});
  assert.equal(onboard.status,200);assert.equal(onboard.data.created,false);assert.equal(onboard.data.tenantId,tenantId);
  const directory=await app('/api/v1/sync/business',candidate.token);assert.equal(directory.data.businesses.length,1);assert.equal(directory.data.businesses[0].legacyAlias,canonicalId+'_FNB');assert.equal(directory.data.businesses[0].outlets[0].outletId,outletId);
  const after=await fingerprint(tenantId);assert.equal(after,before,'Paid terms, wallet, membership, tenant/merchant/outlet IDs remain unchanged');
  evidence.checks.canonicalContinuity={status:'PASS',emailCollisionDenied:true,reviewedFixtureBinding:true,metadataRoleIgnored:true,legacyOfflineAliasPreserved:true,paidBusinessFingerprintBefore:before,paidBusinessFingerprintAfter:after,note:'Synthetic restoration fixture; no customer import and no dual-proof enrollment endpoint claimed'};
  console.log('PASS: matching email denied; reviewed canonical binding preserves paid tenant, wallet and offline alias');

  const enrollment=await auth('/two-factor/enable',{password:candidate.password,method:'totp'},candidate.cookie,candidate.token);
  const uri=new URL(enrollment.data.totpURI),secret=new TextDecoder().decode(base32.decode(uri.searchParams.get('secret'))),otp=createOTP(secret,{period:30,digits:6});
  const activated=await auth('/two-factor/verify-totp',{code:await otp.totp()},enrollment.cookie||candidate.cookie,candidate.token);
  assert.equal(adminSecurityError(await authenticateBetterBearer(activated.token),'POST'),null);
  await auth('/sign-out',{},activated.cookie,activated.token);
  const challenge=await auth('/sign-in/email',{email:candidate.email,password:candidate.password});assert(challenge.data.twoFactorRedirect);assert.equal(challenge.token,null);
  const recovery=await auth('/two-factor/verify-backup-code',{code:enrollment.data.backupCodes[0],trustDevice:true},challenge.cookie);assert(recovery.token);
  const recovered=await authenticateBetterBearer(recovery.token);assert.equal(recovered.subject,canonicalId);assert.equal(recovered.aal,'aal1');assert.equal(adminSecurityError(recovered,'POST'),'MFA_REQUIRED');
  await auth('/two-factor/verify-backup-code',{code:enrollment.data.backupCodes[0]},recovery.cookie,recovery.token,401);
  await auth('/two-factor/disable',{password:candidate.password},recovery.cookie,recovery.token,403);
  assert(!recovery.cookie.includes('trust_device'));
  evidence.checks.backupRecovery={status:'PASS',singleUse:true,adminFreshProofNotGranted:true,mfaDisableWithoutFreshTotpDenied:true,trustedDeviceDenied:true};
  await auth('/sign-out',{},recovery.cookie,recovery.token);assert.equal(await authenticateBetterBearer(recovery.token),null);
  console.log('PASS: backup code single use, no admin step-up or MFA-disable bypass, logout revocation');
  evidence.status='PASS';
}catch(e){evidence.status='FAIL';evidence.failure=e.message;throw e;}
finally{
  if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await runtime.close();
  evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/rehearsal-better-continuity.json',JSON.stringify(evidence,null,2)+'\n');
}
