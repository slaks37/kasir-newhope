import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {stagingTarget,projectId,branchId} from './target.mjs';
const {env,...transport}=stagingTarget();
Object.assign(process.env,env,{DATABASE_URL:transport.connectionString});
const {verifyNeonToken,bindNeonIdentity}=await import('../../services/shared/neonAuth.ts');
const {neonPilotConfig}=await import('../../services/shared/neonPilot.ts');
const {createSyncHandler}=await import('../../src/server/syncHandler.ts');
const {adminSecurityError}=await import('../../src/server/adminSecurity.ts');
const {pastikanPaket}=await import('../../services/billing/store.ts');
const {SAAS_PLANS}=await import('../../src/config/saasPlans.ts');
const config=neonPilotConfig(),pool=new pg.Pool({...transport,max:2});
const wrap=runner=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rowCount};},exec:async sql=>{await runner.query(sql);},
  tx:async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(wrap(c));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()});
const db=wrap(pool),evidence={scope:'Synthetic accounts only, isolated Neon child branch',projectId,branchId,startedAt:new Date().toISOString(),checks:{},status:'RUNNING'};
let server;
const auth=async(path,cookie='',body)=>{
  const r=await fetch(config.authUrl+path,{method:body?'POST':'GET',headers:{origin:'http://localhost:5173',cookie,'content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
  const data=await r.json();
  assert(r.ok,'Neon Auth request failed: '+path+':'+r.status+':'+(data?.code||data?.message||'unknown'));
  return {data,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),jwt:r.headers.get('set-auth-jwt')};
};
async function newOwner(index){
  const email='neon-rehearsal-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
  const signup=await auth('/sign-up/email','',{email,password,name:'Synthetic owner '+index});
  const first=await auth('/token',signup.cookie);
  const unverifiedToken=first.data.token||first.jwt;
  assert.equal(await verifyNeonToken(unverifiedToken,config),null,'Unverified live Neon identity denied');
  // Test-fixture verification ONLY. This deliberately does not claim SMTP or
  // real email ownership was tested. Only this newly created .invalid user.
  const changed=await db.query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1 AND email=$2 AND email LIKE $3 RETURNING id',
    [signup.data.user.id,email,'neon-rehearsal-%@example.invalid']);
  assert.equal(changed.rowCount,1);
  await auth('/sign-out',signup.cookie,{});
  const signin=await auth('/sign-in/email','',{email,password});
  const token=(await auth('/token',signin.cookie)).data.token;
  const p=await verifyNeonToken(token,config);assert(p,'Real signed Neon JWT verified');
  const principal=await bindNeonIdentity(db,p,config.issuer);assert(principal);
  assert.equal(adminSecurityError(principal,'GET'),'MFA_REQUIRED');
  assert.equal(await verifyNeonToken(token.slice(0,-5)+'abcde',config),null,'Tampered token denied');
  const restored=await auth('/get-session',signin.cookie);assert.equal(restored.data.user.id,signup.data.user.id);
  return {email,password,token,principal,cookie:signin.cookie};
}
try {
  const probe=await pool.connect();
  const socket=probe.connection.stream;
  assert.equal(socket.encrypted,true);assert.equal(socket.authorized,true);
  evidence.checks.transport={encrypted:true,certificateAuthorized:true,note:'Client-to-Neon proxy TLS; pg_stat_ssl reports the separate proxy-to-compute connection'};
  probe.release();
  await pastikanPaket(db,SAAS_PLANS);
  const owners=[await newOwner('A'),await newOwner('B')];
  evidence.checks.auth='PASS: signup, unverified denial, verified-fixture login, JWKS signature, tamper denial, cookie session restore; email delivery NOT tested';
  const app=express();app.use(express.json());
  app.use(createSyncHandler(async req=>{
    const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];if(!token)return null;
    const p=await verifyNeonToken(token,config);return p?bindNeonIdentity(db,p,config.issuer):null;
  },async()=>db));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
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
  evidence.checks.scopeAndPin='PASS: two tenants, own directory, foreign outlet denied, metadata cannot assign role/tenant, idempotent onboarding, random legacy PIN, weak PIN/wrong owner denied, Neon password proof, short grant, missing grant denied';
  const q=v=>'"'+v.replaceAll('"','""')+'"';
  const relations=(await db.query("SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','pos','internal','billing','ai','contract') AND c.relkind IN('r','p','v','m','S')")).rows;
  let denials=0;
  for(const role of ['anon','authenticated'])for(const row of relations){
    const c=await pool.connect();try{
      await c.query('BEGIN');
      const owner=(await c.query('SELECT current_user AS owner')).rows[0].owner;
      // PG18 role creators get ADMIN, not SET membership. The temporary SET
      // grant exists only inside this rollback-only negative probe.
      await c.query('GRANT '+q(role)+' TO '+q(owner)+' WITH INHERIT FALSE, SET TRUE');
      await c.query('SET LOCAL ROLE '+q(role));
      const probe=row.relkind==='S'?"SELECT nextval('"+q(row.nspname)+'.'+q(row.relname)+"')":'SELECT * FROM '+q(row.nspname)+'.'+q(row.relname)+' LIMIT 0';
      await assert.rejects(()=>c.query(probe),e=>e.code==='42501');denials++;
    }finally{await c.query('ROLLBACK');c.release();}
  }
  evidence.checks.browserRoles={status:'PASS',actualDeniedStatements:denials};
  for(const owner of owners){
    await auth('/sign-out',owner.cookie,{});
    const after=await auth('/get-session',owner.cookie);assert(!after.data?.user,'Signed-out session cookie rejected');
  }
  evidence.checks.logout='PASS: session cookies invalid after logout; already minted JWTs retain their documented 15-minute lifetime';
  evidence.status='PASS';console.log('PASS: real Neon Auth + isolated DB + HTTP negative authorization + PIN + TLS + browser-role denials');
}catch(e){evidence.status='FAIL';evidence.failure=e.message;throw e;}
finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
  evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/rehearsal.json',JSON.stringify(evidence,null,2)+'\n');
}
