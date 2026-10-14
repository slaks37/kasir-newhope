import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {createOTP} from '@better-auth/utils/otp';
import {base32} from '@better-auth/utils/base32';

const roleEnv=parse(fs.readFileSync('.env.neon-runtime-roles.local'));
const ownerEnv=parse(fs.readFileSync('.env.neon-data-restore.local'));
const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
assert.equal(roleEnv.NEON_PROJECT_ID,target.projectId);assert.equal(roleEnv.NEON_BRANCH_ID,target.branchId);assert.equal(target.default,false);
Object.assign(process.env,roleEnv,{AUTH_PROVIDER:'better-auth',BETTER_AUTH_MIGRATION_PILOT:'1',NODE_ENV:'test',APP_ENV:'staging',VERCEL_ENV:'preview',
  BETTER_AUTH_URL:'http://127.0.0.1:49287',BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),STORAGE_PROVIDER:'neon',AUTH_EMAIL_ENABLED:'0'});
const {connectDb}=await import('../../services/shared/db');
const {createBetterAuthRuntime,getBetterAuthRuntime}=await import('../../services/shared/betterAuth');
const {authenticateBetterBearer}=await import('../../services/shared/betterAuthPrincipal');
const {betterOwnerIdentity}=await import('../../services/shared/betterAuthOwner');
const {createBetterAuthHandler}=await import('../../src/server/betterAuthHandler');
const {createSyncHandler}=await import('../../src/server/syncHandler');
const {adminSecurityError}=await import('../../src/server/adminSecurity');
const {databaseTransport}=await import('../../services/shared/databaseTls');
const {betterAuthPilotConfig}=await import('../../services/shared/betterAuthPilot');
const mails:any[]=[];
const runtime=createBetterAuthRuntime(betterAuthPilotConfig(),async m=>{mails.push(m);});
const appDb=await connectDb({schema:'pos',max:2});
const ownerUrl=new URL(ownerEnv.NEON_RESTORE_DATABASE_URL||'');assert.equal(ownerUrl.hostname.replace('-pooler',''),target.host);ownerUrl.hostname=ownerUrl.hostname.replace('-pooler','');
const probe=new pg.Pool({...databaseTransport(ownerUrl.href),max:1});
const sourceRelations=['internal.tenants','internal.merchants','internal.outlets','billing.plans','billing.subscriptions','billing.invoices','ai.merchant_ai_credits','pos.transactions','pos.cash_ledger'];
const before=new Map<string,Map<string,string>>();
for(const relation of sourceRelations){const key=relation==='ai.merchant_ai_credits'?'merchant_id':'id';const rows=(await probe.query(`SELECT ${key}::text AS id,md5(to_jsonb(t)::text) AS fingerprint FROM ${relation} t`)).rows;before.set(relation,new Map(rows.map(r=>[r.id,r.fingerprint])));}
const evidence:any={scope:'Actual native HTTP auth/POS against restored Neon child with dedicated LOGINs; synthetic example.invalid accounts only; no external mail',branchId:target.branchId,startedAt:new Date().toISOString(),checks:{},status:'RUNNING'};
let server:any,base='';
const auth=async(path:string,cookie='',body?:any,expected=200,bearer='',retry=0):Promise<any>=>{
  const r=await fetch(base+'/api/auth'+path,{method:body?'POST':'GET',headers:{origin:process.env.BETTER_AUTH_URL!,cookie,'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  const data=await r.json().catch(()=>null);
  if(r.status===429&&expected!==429&&retry<3) {
    evidence.checks.rateLimitObserved=(evidence.checks.rateLimitObserved||0)+1;
    const seconds=Math.min(60,Math.max(1,Number(r.headers.get('retry-after')||60)));
    console.log('Native auth rate limit observed; respecting retry-after before continuing synthetic batch.');
    await new Promise(resolve=>setTimeout(resolve,(seconds+1)*1000));return auth(path,cookie,body,expected,bearer,retry+1);
  }
  assert.equal(r.status,expected,'Native auth:'+path+':'+(data?.code||data?.message||''));
  return {data,token:r.headers.get('set-auth-token')||'',cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
};
const call=async(path:string,body:any,owner?:any)=>{
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(owner?{authorization:'Bearer '+owner.token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  return {status:r.status,data:await r.json()};
};
try {
  assert.equal((await appDb.query('SELECT current_user AS role')).rows[0].role,'newhope_runtime_login');
  assert.equal((await runtime.pool.query('SELECT current_user AS role')).rows[0].role,'newhope_auth_runtime_login');
  assert((await appDb.query("SELECT 1 FROM billing.plans WHERE id='plan-free'")).rowCount,'Preserved trial catalog must exist; do not reseed source plans');
  const app=express();app.use((req,res,next)=>req.path.startsWith('/api/auth/')?void createBetterAuthHandler(()=>runtime)(req,res):next());
  app.use(express.json());app.use(createSyncHandler(undefined,async()=>appDb));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
  assert.equal((await call('/api/v1/sync/business',null)).status,401);
  const owners:any[]=[];
  for(const sector of ['FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP']) {
    const email='restricted-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
    await auth('/sign-up/email','',{email,password,name:'Synthetic restricted '+sector,callbackURL:process.env.BETTER_AUTH_URL+'/login'});
    if(owners.length===0)await auth('/sign-in/email','',{email,password},403);
    const verify=new URL(mails.find(m=>m.kind==='VERIFY'&&m.email===email).url);
    await auth(verify.pathname.replace('/api/auth','')+verify.search,'',undefined,302);
    const session=await auth('/sign-in/email','',{email,password});assert(session.token);
    const principal=await authenticateBetterBearer(session.token);assert(principal);assert.equal(adminSecurityError(principal,'POST'),'MFA_REQUIRED');
    assert.equal(await authenticateBetterBearer(session.token.slice(0,-4)+'abcd'),null);
    const owner:any={email,password,token:session.token,cookie:session.cookie,principal,sector,userId:session.data.user.id};owners.push(owner);
    const onboard=await call('/api/v1/sync/neon-onboarding',{store_name:'Synthetic restricted '+sector,full_name:'Synthetic owner',business_sector:sector,first_outlet_name:'Main',second_outlet_name:'Second',role:'SUPERADMIN',tenantId:randomUUID()},owner);
    assert.equal(onboard.status,200,'Onboarding:'+sector+':'+onboard.data.error);assert(onboard.data.created);
    const replay=await call('/api/v1/sync/neon-onboarding',{business_sector:sector},owner);assert.equal(replay.status,200);assert.equal(replay.data.created,false);
    const directory=await call('/api/v1/sync/business',null,owner);assert.equal(directory.status,200);assert.equal(directory.data.businesses.length,1);assert.equal(directory.data.businesses[0].outlets.length,2);owner.business=directory.data.businesses[0];
    assert.equal((await appDb.query('SELECT role FROM internal.memberships WHERE user_id=$1',[principal.subject])).rows[0].role,'OWNER');
    const identity=await betterOwnerIdentity(principal.subject);assert.equal(identity?.email,email);assert.equal(identity?.verified,true);
  }
  evidence.checks.fiveSectors={status:'PASS',sectors:owners.map(o=>o.sector),outletsEach:2,idempotentOnboarding:true,metadataRoleIgnored:true,nativeOwnerLookup:true};
  const a=owners[0],b=owners[1],outlet=a.business.outlets[0].outletId;
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'529681',ownerPassword:a.password},b)).status,403);
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'1234',ownerPassword:a.password},a)).status,400);
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'529681',ownerPassword:b.password},a)).status,403);
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'529681',ownerPassword:a.password},a)).status,200);
  const cash={sector:'FNB',outletId:outlet,type:'CASH_OUT',amount:1000,clientEventId:'restricted-cash-'+randomUUID(),description:'Synthetic only',category:'OPERASIONAL',occurredAt:new Date().toISOString()};
  const grant=await call('/api/v1/finance/approve',{sector:'FNB',outletId:outlet,action:'CASH_OUT',reference:cash.clientEventId,reason:'Synthetic test',command:cash,pin:'529681'},a);
  assert.equal(grant.status,200);assert.equal(grant.data.expiresInSeconds,90);
  assert.equal((await call('/api/v1/finance/cash',cash,a)).status,403);
  assert.equal((await call('/api/v1/finance/cash',{...cash,amount:9999,approvalGrant:grant.data.approvalGrant},a)).status,403);
  const paid={...cash,approvalGrant:grant.data.approvalGrant};assert.equal((await call('/api/v1/finance/cash',paid,a)).status,200);assert.equal((await call('/api/v1/finance/cash',paid,a)).data.replayed,true);
  evidence.checks.financial={status:'PASS',foreignOutletDenied:true,defaultPinDenied:true,wrongPasswordDenied:true,missingApprovalDenied:true,changedAmountDenied:true,idempotentCash:true};
  const enabled=await auth('/two-factor/enable',a.cookie,{password:a.password,method:'totp'},200,a.token);
  const uri=new URL(enabled.data.totpURI),secret=new TextDecoder().decode(base32.decode(uri.searchParams.get('secret')!)),otp=createOTP(secret,{period:30,digits:6});
  const wrong=String((Number(await otp.totp())+123456)%1000000).padStart(6,'0');
  await auth('/two-factor/verify-totp',enabled.cookie||a.cookie,{code:wrong,trustDevice:true},401,a.token);
  const verified=await auth('/two-factor/verify-totp',enabled.cookie||a.cookie,{code:await otp.totp(),trustDevice:true},200,a.token);
  a.token=verified.token||a.token;a.cookie=verified.cookie||a.cookie;const verifiedPrincipal=await authenticateBetterBearer(a.token);assert(verifiedPrincipal);assert.equal(adminSecurityError(verifiedPrincipal,'POST'),null);
  assert(!verified.cookie.includes('trust_device'));
  await auth('/sign-out',a.cookie,{},200,a.token);assert.equal(await authenticateBetterBearer(a.token),null);
  const pending=await auth('/sign-in/email','',{email:a.email,password:a.password});assert.equal(pending.data.twoFactorRedirect,true);assert.equal(pending.token,'');
  await auth('/two-factor/verify-totp',pending.cookie,{code:await otp.hotp(Math.floor(Date.now()/30000)-10)},401);
  const login=await auth('/two-factor/verify-totp',pending.cookie,{code:await otp.totp()},200);assert(login.token);
  await auth('/two-factor/verify-totp',pending.cookie,{code:await otp.totp()},401);
  evidence.checks.mfa={status:'PASS',wrongAndExpiredDenied:true,challengeReplayDenied:true,nativeProofRecorded:true,passwordAloneNoSession:true,rememberedDeviceDisabled:true};
  await auth('/request-password-reset','',{email:a.email,redirectTo:process.env.BETTER_AUTH_URL+'/reset-password'});
  const reset=new URL([...mails].reverse().find((m:any)=>m.kind==='RESET'&&m.email===a.email).url),resetToken=reset.pathname.split('/').at(-1),newPassword=randomBytes(24).toString('base64url');
  await auth('/reset-password','',{token:resetToken,newPassword});assert.equal(await authenticateBetterBearer(login.token),null);
  await auth('/reset-password','',{token:resetToken,newPassword},400);
  for(const owner of owners.slice(1))await auth('/sign-out',owner.cookie,{},200,owner.token);
  evidence.checks.recovery={status:'PASS',resetLinkCaptured:true,oneTimeToken:true,oldSessionRevoked:true,externalMailSent:false};
  evidence.checks.sourceExistingRows={};
  for(const [relation,fingerprints] of before) {
    const key=relation==='ai.merchant_ai_credits'?'merchant_id':'id';
    const current=new Map((await probe.query(`SELECT ${key}::text AS id,md5(to_jsonb(t)::text) AS fingerprint FROM ${relation} t WHERE ${key}::text=ANY($1::text[])`,[[...fingerprints.keys()]])).rows.map(r=>[r.id,r.fingerprint]));
    assert.deepEqual(current,fingerprints,'Existing source rows changed:'+relation);
    evidence.checks.sourceExistingRows[relation]={status:'UNCHANGED',rows:fingerprints.size};
  }
  evidence.status='PASS';console.log(JSON.stringify({status:'PASS',branchId:target.branchId,checks:evidence.checks}));
}catch(e){evidence.status='FAIL';evidence.failure=e instanceof Error?e.message:'Restricted HTTP failed';throw e;}
finally {
  if(server)await new Promise(resolve=>server.close(resolve));await appDb.close();await runtime.close();await getBetterAuthRuntime().close();await probe.end();
  evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/restricted-runtime-evidence.json',JSON.stringify(evidence,null,2)+'\n');
}
