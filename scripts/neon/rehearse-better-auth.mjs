import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {stagingTarget,projectId,branchId} from './better-target.mjs';
const {env,...transport}=stagingTarget();
Object.assign(process.env,env,{DATABASE_URL:transport.connectionString});
const {authenticateBetterBearer}=await import('../../services/shared/betterAuthPrincipal.ts');
const {createBetterAuthRuntime}=await import('../../services/shared/betterAuth.ts');
const {createBetterAuthHandler}=await import('../../src/server/betterAuthHandler.ts');
const {betterAuthPilotConfig}=await import('../../services/shared/betterAuthPilot.ts');
const {createOTP}=await import('@better-auth/utils/otp');
const {base32}=await import('@better-auth/utils/base32');
const mails=[];
const runtime=createBetterAuthRuntime(betterAuthPilotConfig(),async mail=>{mails.push(mail);});
const {createSyncHandler}=await import('../../src/server/syncHandler.ts');
const {adminSecurityError}=await import('../../src/server/adminSecurity.ts');
const {pastikanPaket}=await import('../../services/billing/store.ts');
const {SAAS_PLANS}=await import('../../src/config/saasPlans.ts');
const config=betterAuthPilotConfig(),pool=new pg.Pool({...transport,max:2});
const wrap=runner=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rowCount};},exec:async sql=>{await runner.query(sql);},
  tx:async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(wrap(c));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()});
const db=wrap(pool),evidence={scope:'Synthetic accounts only, isolated Neon child branch',projectId,branchId,startedAt:new Date().toISOString(),checks:{},status:'RUNNING'};
let server,base;
const auth=async(path,cookie='',body,expected=200,bearer='')=>{
  const r=await fetch(base+'/api/auth'+path,{method:body?'POST':'GET',headers:{origin:config.baseUrl,cookie,'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  const data=await r.json().catch(()=>null);
  assert.equal(r.status,expected,'Better Auth request failed: '+path+':'+r.status+':'+(data?.code||data?.message||'unknown'));
  return {data,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),token:r.headers.get('set-auth-token'),location:r.headers.get('location')};
};
async function newOwner(index){
  const email='better-rehearsal-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
  await auth('/sign-up/email','',{email,password,name:'Synthetic owner '+index,callbackURL:config.baseUrl+'/login'});
  await auth('/sign-in/email','',{email,password},403);
  const mail=mails.find(m=>m.email===email&&m.kind==='VERIFY');assert(mail,'Verification email captured, no external delivery');
  const verifyUrl=new URL(mail.url);await auth(verifyUrl.pathname.replace('/api/auth','')+verifyUrl.search,'',null,302);
  const signin=await auth('/sign-in/email','',{email,password});assert(signin.token,'Signed bearer issued');
  const principal=await authenticateBetterBearer(signin.token);assert(principal,'Verified live Better Auth session');
  assert.equal(adminSecurityError(principal,'POST'),'MFA_REQUIRED');
  assert.equal(await authenticateBetterBearer(signin.token.slice(0,-5)+'abcde'),null,'Tampered token denied');
  assert.equal(await authenticateBetterBearer(signin.data.token),null,'Unsigned session token denied');
  return {email,password,token:signin.token,principal,cookie:signin.cookie,userId:signin.data.user.id};
}
try {
  const probe=await pool.connect();
  const socket=probe.connection.stream;
  assert.equal(socket.encrypted,true);assert.equal(socket.authorized,true);
  evidence.checks.transport={encrypted:true,certificateAuthorized:true,note:'Client-to-Neon proxy TLS; pg_stat_ssl reports the separate proxy-to-compute connection'};
  probe.release();
  await pastikanPaket(db,SAAS_PLANS);
  console.log('Testing native email-link login, tenant/PIN isolation and MFA on synthetic accounts…');
  const app=express();
  app.use((req,res,next)=>req.path.startsWith('/api/auth/')?void createBetterAuthHandler(()=>runtime)(req,res):next());
  app.use(express.json());app.use(createSyncHandler(undefined,async()=>db));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  base='http://127.0.0.1:'+server.address().port;
  const owners=[await newOwner('A'),await newOwner('B')];
  evidence.checks.auth='PASS: email-link verification with local mail capture, unsigned/tampered token denial, live session authentication';
  const call=async(path,body,owner=owners[0])=>{
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(owner?{authorization:'Bearer '+owner.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json()};
  };
  assert.equal((await call('/api/v1/sync/business',null,null)).status,401);
  for(const [i,o] of owners.entries()){
    const data={store_name:'Synthetic '+i,full_name:'Synthetic owner '+i,business_sector:i?'LAUNDRY':'FNB',first_outlet_name:'Main',second_outlet_name:'Second',tenantId:owners[0].principal.subject,role:'SUPERADMIN'};
    const onboard=await call('/api/v1/sync/neon-onboarding',data,o);assert.equal(onboard.status,200,JSON.stringify(onboard));
    const retry=await call('/api/v1/sync/neon-onboarding',data,o);assert.equal(retry.data.tenantId,onboard.data.tenantId);assert.equal(retry.data.created,false);
    const directory=await call('/api/v1/sync/business',null,o);assert.equal(directory.status,200);assert.equal(directory.data.businesses.length,1);assert.equal(directory.data.businesses[0].outlets.length,2);
    o.directory=directory.data.businesses[0];o.sector=i?'LAUNDRY':'FNB';
    assert.notEqual(onboard.data.tenantId,owners[0].principal.subject,'Client tenant IDs ignored');
    const membership=(await db.query('SELECT role,pin FROM internal.memberships WHERE user_id=$1',[o.principal.subject])).rows[0];
    assert.equal(membership.role,'OWNER');assert.notEqual(membership.pin,'1234');
  }
  const a=owners[0],b=owners[1],outlet=a.directory.outlets[0].outletId;
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'529681',ownerPassword:a.password},b)).status,403,'Foreign outlet denied');
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'1234',ownerPassword:a.password})).status,400);
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'529681',ownerPassword:b.password})).status,403,'Wrong owner password denied');
  assert.equal((await call('/api/v1/finance/pin',{sector:'FNB',outletId:outlet,newPin:'529681',ownerPassword:a.password})).status,200,'Neon fresh owner proof');
  const cash={sector:'FNB',outletId:outlet,type:'CASH_OUT',amount:1000,clientEventId:'synthetic-cash-'+randomUUID(),description:'test',category:'OPERASIONAL',occurredAt:new Date().toISOString()};
  const approval=await call('/api/v1/finance/approve',{sector:'FNB',outletId:outlet,action:'CASH_OUT',reference:cash.clientEventId,reason:'test',command:cash,pin:'529681'});
  assert.equal(approval.status,200);assert.equal(approval.data.expiresInSeconds,90);
  assert.equal((await call('/api/v1/finance/cash',cash)).status,403,'Financial write without approval denied');
  assert.equal((await call('/api/v1/finance/cash',{...cash,amount:9999,approvalGrant:approval.data.approvalGrant})).status,403,'Changed amount denied');
  const authorized={...cash,approvalGrant:approval.data.approvalGrant};
  assert.equal((await call('/api/v1/finance/cash',authorized)).status,200);
  assert.equal((await call('/api/v1/finance/cash',authorized)).data.replayed,true,'Exact command retries do not double debit');
  evidence.checks.scopeAndPin='PASS: two tenants, own directory, foreign outlet denied, metadata cannot assign role/tenant, idempotent onboarding, random legacy PIN, weak PIN/wrong owner denied, native Better Auth password proof, short grant, missing grant denied';
  console.log('PASS: tenant/outlet negatives and server PIN approvals');
  const owner=owners[0];
  const enrolled=await auth('/two-factor/enable',owner.cookie,{password:owner.password,method:'totp'},200,owner.token);
  const uri=new URL(enrolled.data.totpURI);
  const secret=new TextDecoder().decode(base32.decode(uri.searchParams.get('secret')));
  const otp=createOTP(secret,{period:30,digits:6});
  const wrong=(String(Number(await otp.totp())+123456).slice(-6)).padStart(6,'0');
  await auth('/two-factor/verify-totp',enrolled.cookie||owner.cookie,{code:wrong,trustDevice:true},401,owner.token);
  assert.equal(adminSecurityError(await authenticateBetterBearer(owner.token),'POST'),'MFA_REQUIRED');
  const verified=await auth('/two-factor/verify-totp',enrolled.cookie||owner.cookie,{code:await otp.totp(),trustDevice:true},200,owner.token);
  owner.token=verified.token||owner.token;owner.cookie=verified.cookie||owner.cookie;
  assert.equal(adminSecurityError(await authenticateBetterBearer(owner.token),'POST'),null,'Official TOTP recorded as fresh server proof');
  await db.query("UPDATE newhope_auth.mfa_session_proofs SET verified_at=now()-interval '11 minutes' WHERE user_id=$1",[owner.userId]);
  assert.equal(adminSecurityError(await authenticateBetterBearer(owner.token),'POST'),'REAUTH_REQUIRED');
  await auth('/two-factor/disable',owner.cookie,{password:owner.password},403,owner.token);
  assert(!verified.cookie.includes('trust_device'),'Trusted-device bypass disabled');
  await auth('/sign-out',owner.cookie,{},200,owner.token);
  assert.equal(await authenticateBetterBearer(owner.token),null,'Logout revokes bearer immediately');
  const pending=await auth('/sign-in/email','',{email:owner.email,password:owner.password});
  assert.equal(pending.data.twoFactorRedirect,true);assert.equal(pending.token,null,'Password alone gives no authenticated session');
  const expired=await otp.hotp(Math.floor(Date.now()/30000)-10);
  await auth('/two-factor/verify-totp',pending.cookie,{code:expired},401);
  const mfaLogin=await auth('/two-factor/verify-totp',pending.cookie,{code:await otp.totp()},200);
  assert(mfaLogin.token);assert.equal(adminSecurityError(await authenticateBetterBearer(mfaLogin.token),'POST'),null);
  await auth('/two-factor/verify-totp',pending.cookie,{code:await otp.totp()},401);
  evidence.checks.mfa='PASS: encrypted enrollment, wrong/expired TOTP denied, mandatory login challenge, challenge replay denied, server proof and 10-minute step-up';
  owner.token=mfaLogin.token;owner.cookie=mfaLogin.cookie;
  await auth('/request-password-reset','',{email:owner.email,redirectTo:config.baseUrl+'/reset-password'});
  const reset=new URL(mails.findLast(m=>m.email===owner.email&&m.kind==='RESET').url);
  const resetToken=reset.pathname.split('/').at(-1);
  const nextPassword=randomBytes(24).toString('base64url');
  await auth('/reset-password','',{token:resetToken,newPassword:nextPassword});
  assert.equal(await authenticateBetterBearer(owner.token),null,'Password reset revokes old sessions');
  await auth('/reset-password','',{token:resetToken,newPassword:nextPassword},400);
  await auth('/sign-out',owners[1].cookie,{},200,owners[1].token);
  evidence.checks.recovery='PASS: captured email-link password reset, token consumed once, prior sessions revoked; external email delivery NOT tested';
  evidence.checks.logout='PASS: signed bearer immediately rejected after logout and password reset';
  const foreign=await fetch(base+'/api/auth/send-verification-email',{method:'POST',headers:{'content-type':'application/json',origin:'https://foreign.invalid'},body:JSON.stringify({email:owners[1].email,callbackURL:config.baseUrl+'/login'})});
  assert.equal(foreign.status,403,'Foreign Origin rejected');
  let throttled=false;
  for(let i=0;i<6;i++) {
    const response=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.baseUrl,'content-type':'application/json','x-forwarded-for':'forged-'+i},body:JSON.stringify({email:owners[1].email,password:'wrong-synthetic-password'})});
    assert([401,429].includes(response.status));if(response.status===429)throttled=true;
  }
  assert(throttled,'Persistent HTTP sign-in throttle cannot be evaded with forged IP header');
  assert((await db.query('SELECT 1 FROM newhope_auth."rateLimit" LIMIT 1')).rowCount);
  evidence.checks.throttling='PASS: persisted sign-in throttle, forged x-forwarded-for cannot evade limit, foreign Origin rejected';

  const q=v=>'"'+v.replaceAll('"','""')+'"';
  const relations=(await db.query("SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','pos','internal','billing','ai','contract','newhope_auth') AND c.relkind IN('r','p','v','m','S')")).rows;
  let denials=0;
  for(const role of ['anon','authenticated']) {
    const c=await pool.connect();try {
      await c.query('BEGIN');
      const owner=(await c.query('SELECT current_user AS owner')).rows[0].owner;
      await c.query('GRANT '+q(role)+' TO '+q(owner)+' WITH INHERIT FALSE, SET TRUE');
      await c.query('SET LOCAL ROLE '+q(role));
      // Every SELECT/nextval is actually executed as the browser role. The
      // exception subtransaction keeps one denial from aborting later probes.
      await c.query(`DO $probe$ DECLARE r record; denied integer:=0; BEGIN
        FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN('public','pos','internal','billing','ai','contract','newhope_auth') AND c.relkind IN('r','p','v','m','S') LOOP
          BEGIN
            IF r.relkind='S' THEN EXECUTE format('SELECT nextval(%L)',format('%I.%I',r.nspname,r.relname));
            ELSE EXECUTE format('SELECT * FROM %I.%I LIMIT 0',r.nspname,r.relname); END IF;
            RAISE EXCEPTION 'Unexpected browser access: %.%',r.nspname,r.relname;
          EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1; END;
        END LOOP;
        PERFORM set_config('newhope.denied_count',denied::text,true);
      END $probe$`);
      const count=Number((await c.query("SELECT current_setting('newhope.denied_count') AS denied")).rows[0].denied);
      assert.equal(count,relations.length);denials+=count;
    }finally{await c.query('ROLLBACK');c.release();}
  }
  evidence.checks.browserRoles={status:'PASS',actualDeniedStatements:denials};
  evidence.status='PASS';console.log('PASS: real Better Auth MFA + isolated DB + HTTP negative authorization + PIN + TLS + browser-role denials');
}catch(e){evidence.status='FAIL';evidence.failure=e.message;throw e;}
finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();await runtime.close();
  evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/rehearsal-better-auth.json',JSON.stringify(evidence,null,2)+'\n');
}
