// Isolated HTTP + PostgreSQL regressions. No production Auth, emails or data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerAdminRoutes} from '../../src/server/adminRoutes';
import {createClientSupportProvider,supportStepUpError,type ClientSupportProvider} from '../../src/server/clientSupport';
import {guardedPath} from '../../src/lib/navigation/routes';
import {acknowledgeReset,pendingResetKey} from '../../src/admin/resetIntent';
import type {Db} from '../../services/shared/db';
import type {AuthPrincipal} from '../../services/shared/auth';

const pg=new PGlite();
let failAudit='',configured=true,rejectProvider=false,unverified=false;
const sent:string[]=[],lookup:string[]=[];
const wrap=(runner:any):Db=>({query:async(sql,params)=>{
  if(failAudit&&sql.includes('INSERT INTO internal.support_actions')&&params?.includes(failAudit))throw new Error('AUDIT_UNAVAILABLE');
  const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};
},exec:async sql=>{await runner.exec(sql);},tx:fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
const db=wrap(pg),now=Math.floor(Date.now()/1000);
const subjects={admin:randomUUID(),support:randomUUID(),growth:randomUUID(),merchant:randomUUID()};
const owner=randomUUID(),client=randomUUID(),synthetic=randomUUID(),other=randomUUID();
const verifiedOwners=new Set([owner]);
const provider:ClientSupportProvider={get configured(){return configured;},async ownerEmail(subject){lookup.push(subject);return unverified?null:verifiedOwners.has(subject)?'verified-owner@test.invalid':null;},async sendReset(email){if(rejectProvider)throw new Error('PRIVATE_PROVIDER_DETAIL');sent.push(email);}};
const principals:Record<string,AuthPrincipal>={
  admin:{subject:subjects.admin,aal:'aal2',mfaVerifiedAt:now},
  support:{subject:subjects.support,aal:'aal2',mfaVerifiedAt:now},
  growth:{subject:subjects.growth,aal:'aal2',mfaVerifiedAt:now},
  merchant:{subject:subjects.merchant,aal:'aal2',mfaVerifiedAt:now},
  noMfa:{subject:subjects.admin,aal:'aal1'},
  stale:{subject:subjects.admin,aal:'aal2',mfaVerifiedAt:now-601},
  future:{subject:subjects.admin,aal:'aal2',mfaVerifiedAt:now+120},
};
async function main(){
  await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
  const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
  for(const f of files)await pg.exec(fs.readFileSync(f,'utf8'));
  for(const [role,subject] of [['ROLE_SUPERADMIN',subjects.admin],['ROLE_INTERNAL_SUPPORT',subjects.support],['ROLE_INTERNAL_GROWTH',subjects.growth]])await db.query('INSERT INTO internal.internal_users(id,email,full_name,role,sso_subject) VALUES($1,$2,$3,$4,$5)',[randomUUID(),role+'@test.invalid',role,role,subject]);
  await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Client A',$2),($3,'Synthetic','usr-1'),($4,'Unverified',$5)",[client,owner,synthetic,other,randomUUID()]);
  const business=randomUUID(),outlet=randomUUID();
  await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Preserved business','LAUNDRY')",[business,client]);
  await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Preserved outlet')",[outlet,client,business]);
  await db.query("INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,command) VALUES($1,$2,$3,'financial-fixture','CASH_IN',28000,$4::jsonb)",[client,business,outlet,JSON.stringify({eventId:'financial-fixture',amount:28000})]);
  await db.query("INSERT INTO pos.shared_state_records(tenant_id,merchant_id,scope,kind,record_id,value,deleted,recovery_value,quarantine_reason) VALUES($1,$2,'LAUNDRY','products','prod-ld-12',null,true,$3::jsonb,'RECOVERY_FIXTURE')",[client,business,JSON.stringify({id:'prod-ld-12',name:'Preserved recovery',sector:'LAUNDRY'})]);
  const before=await financialSnapshot();
  const app=express();app.use(express.json());registerAdminRoutes(app,async()=>db,async req=>principals[String(req.headers.authorization||'').replace('Bearer ','')]||null,provider);
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(500).json({ok:false,error:'BOUNDARY_FAILURE'}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+(server.address() as any).port;
  const call=async(path:string,token='admin',body?:any)=>{
    const r=await fetch(base+'/api/admin/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-aal':'aal2'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
  };
  const detail='clients/'+client+'?justification=Investigate%20owner%20ticket';
  const action=(a:string,extra:any={})=>({action:a,reason:'Verified owner support ticket',...extra});
  const reset=(key=randomUUID())=>action('RESET_PASSWORD',{requestKey:key,email:'attacker@test.invalid',password:'not-used',redirectTo:'https://attacker.invalid'});
  try{
    assert.equal((await call('clients','unknown')).status,401);
    assert.equal((await call('clients','merchant')).status,403);
    assert.equal((await call('clients','growth')).status,403);
    const list=await call('clients');assert.equal(list.status,200);assert.equal(list.body.total,2);assert.equal(list.body.rows.some((r:any)=>r.id===synthetic),false);assert.equal('owner_user_ref' in list.body.rows[0],false);
    assert.equal((await call('clients/'+client,'support')).status,400);
    assert.equal((await call('clients/'+client)).status,400);
    assert.equal((await call(detail,'growth')).status,403);
    assert.equal((await call('clients/not-a-uuid?justification=Owner%20help%20ticket')).status,400);
    assert.equal((await call('clients/'+randomUUID()+'?justification=Owner%20help%20ticket')).status,404);
    const d=await call(detail,'support');assert.equal(d.status,200);assert.equal(d.body.client.ownerEmail,'verified-owner@test.invalid');assert.equal(d.body.canEditProfile,false);
    assert.equal((await call('clients/'+client+'/actions','support',action('UPDATE_CLIENT_PROFILE',{name:'Denied'}))).status,403);
    assert.equal((await call('clients/'+client+'/actions','admin',action('UPDATE_CLIENT_PROFILE',{name:'x'.repeat(101)}))).status,400);
    assert.equal((await call('clients/'+client+'/actions','support',action('NOTE'))).status,200);
    failAudit='UPDATE_CLIENT_PROFILE';assert.equal((await call('clients/'+client+'/actions','admin',action('UPDATE_CLIENT_PROFILE',{name:'Must rollback'}))).status,500);failAudit='';
    assert.equal((await db.query('SELECT name FROM internal.tenants WHERE id=$1',[client])).rows[0].name,'Client A');
    assert.equal((await call('clients/'+client+'/actions','admin',action('UPDATE_CLIENT_PROFILE',{name:'Updated account'}))).status,200);
    for(const token of ['noMfa','stale','future'])assert.equal((await call('clients/'+client+'/actions',token,reset())).status,403);
    assert.equal(sent.length,0);
    const key=randomUUID(),first=await call('clients/'+client+'/actions','support',reset(key));assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.status,'SENT');assert.deepEqual(sent,['verified-owner@test.invalid']);
    const retry=await call('clients/'+client+'/actions','support',reset(key));assert.equal(retry.body.replayed,true);assert.equal(retry.body.status,'SENT');assert.equal(sent.length,1);
    assert.equal((await call('clients/'+client+'/actions','admin',reset())).status,429);
    assert.equal((await call('clients/'+synthetic+'/actions','admin',reset())).status,409);
    unverified=true;assert.equal((await call('clients/'+other+'/actions','admin',reset())).body.error,'OWNER_EMAIL_NOT_VERIFIED');unverified=false;
    configured=false;assert.equal((await call(detail)).body.resetAvailable,false);assert.equal((await call('clients/'+client+'/actions','admin',reset())).status,503);configured=true;
    // Unconfirmed owner has an audited confirmation path, never a password
    // override or an automatic verification bypass. Retry cannot resend.
    const confirmationClient=randomUUID(),confirmationOwner=randomUUID(),confirmationSent:string[]=[];
    await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Needs confirmation',$2)",[confirmationClient,confirmationOwner]);
    provider.ownerIdentity=async subject=>subject===confirmationOwner?{email:'unconfirmed-owner@test.invalid',verified:false}:null;
    provider.sendConfirmation=async email=>{confirmationSent.push(email);};
    const confirmationDetail=await call('clients/'+confirmationClient+'?justification=Owner%20confirmation%20ticket');
    assert.equal(confirmationDetail.body.client.authStatus,'EMAIL_UNCONFIRMED');assert.equal(confirmationDetail.body.resetAvailable,false);assert.equal(confirmationDetail.body.confirmationAvailable,true);
    const confirmIntent=randomUUID(),confirmAction=action('RESEND_CONFIRMATION',{requestKey:confirmIntent,email:'attacker@test.invalid',password:'ignored'});
    assert.equal((await call('clients/'+confirmationClient+'/actions','noMfa',confirmAction)).status,403);
    assert.equal((await call('clients/'+confirmationClient+'/actions','admin',confirmAction)).body.status,'SENT');
    assert.deepEqual(confirmationSent,['unconfirmed-owner@test.invalid']);
    assert.equal((await call('clients/'+confirmationClient+'/actions','admin',confirmAction)).body.replayed,true);assert.equal(confirmationSent.length,1);
    assert.equal((await call('clients/'+confirmationClient+'/actions','admin',reset())).status,429);
    delete provider.ownerIdentity;delete provider.sendConfirmation;
    // Separate fixture clients make cooldown tests independent without mutating
    // immutable logs. Their owner mapping uses the same verified provider.
    const pending=randomUUID(),failed=randomUUID(),pendingOwner=randomUUID(),failedOwner=randomUUID();verifiedOwners.add(pendingOwner);verifiedOwners.add(failedOwner);
    await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Pending',$3),($2,'Failed',$4)",[pending,failed,pendingOwner,failedOwner]);
    const pendingKey=randomUUID();failAudit='PASSWORD_RESET_SENT';assert.equal((await call('clients/'+pending+'/actions','admin',reset(pendingKey))).body.error,'PASSWORD_RESET_STATUS_UNKNOWN');failAudit='';
    assert.equal(sent.length,2);const pendingReplay=await call('clients/'+pending+'/actions','admin',reset(pendingKey));assert.equal(pendingReplay.status,202);assert.equal(pendingReplay.body.status,'PENDING');assert.equal(sent.length,2);
    rejectProvider=true;const failedKey=randomUUID();const rejected=await call('clients/'+failed+'/actions','admin',reset(failedKey));assert.equal(rejected.status,502);assert.equal(JSON.stringify(rejected).includes('PRIVATE_PROVIDER_DETAIL'),false);rejectProvider=false;
    const failedReplay=await call('clients/'+failed+'/actions','admin',reset(failedKey));assert.equal(failedReplay.body.status,'FAILED');assert.equal(sent.length,2);
    assert.ok(lookup.every(x=>x!==subjects.admin));
    assert.equal((await db.query('SELECT count(*)::int n FROM billing.subscriptions')).rows[0].n,0,'Support must not initialize trials');
    assert.deepEqual(await financialSnapshot(),before);
    assert.equal(supportStepUpError(principals.noMfa),'MFA_REQUIRED');assert.equal(supportStepUpError(principals.admin),null);
    assert.equal(guardedPath('/reset-password',false),'/reset-password');assert.equal(guardedPath('/reset-password',true),'/reset-password');
    const cache=new Map<string,string>(),storage={getItem:(k:string)=>cache.get(k)||null,setItem:(k:string,v:string)=>{cache.set(k,v);},removeItem:(k:string)=>{cache.delete(k);}};
    const intent=pendingResetKey(storage,client);assert.equal(pendingResetKey(storage,client),intent,'Reload/lost ACK keeps intent');assert.notEqual(pendingResetKey(storage,other),intent);
    acknowledgeReset(storage,client);assert.notEqual(pendingResetKey(storage,client),intent);assert.ok([...cache.values()].every(v=>v.length===36));
    for(const role of ['anon','authenticated'])await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);await c.query('SELECT * FROM internal.support_actions');}),/permission denied/);
    await db.exec('SET ROLE svc_internal');
    try{
      const scoped=await call('clients');assert.equal(scoped.status,200,JSON.stringify(scoped));
      const scopedDetail=await call(detail,'support');assert.equal(scopedDetail.status,200,JSON.stringify(scopedDetail));
      assert.equal((await call('clients/'+client+'/actions','support',action('NOTE'))).status,200);
    }finally{await db.exec('RESET ROLE');}
    console.log('PASS: real UUID MFA, role/reason guards, private owner lookup, immutable audit, atomic profile rollback, reset cooldown, lost ACK/reload, failed/unknown outcomes, no duplicate emails, no ledger/trial writes; existing svc_internal grants suffice');
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  await providerContract();
}
async function providerContract(){
  const saved=Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','APP_URL'].map(k=>[k,process.env[k]])),original=globalThis.fetch;
  let user:any={id:owner,email:'auth-owner@test.invalid',email_confirmed_at:new Date().toISOString()},resetStatus=200;
  const calls:Array<{url:string;body:any}>=[];
  try{
    process.env.SUPABASE_URL='https://auth-fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only-not-a-secret';process.env.APP_URL='https://pos-fixture.invalid';
    globalThis.fetch=async(input,init)=>{
      const url=String(input);assert.ok(url.startsWith('https://auth-fixture.invalid/auth/v1/'));
      if(url.includes('/admin/users/'))return new Response(JSON.stringify(user),{status:200,headers:{'content-type':'application/json'}});
      calls.push({url,body:JSON.parse(String(init?.body||'{}'))});return new Response(JSON.stringify(resetStatus===200?{}:{msg:'test rate limit'}),{status:resetStatus,headers:{'content-type':'application/json'}});
    };
    const actual=createClientSupportProvider();assert.equal(await actual.ownerEmail(owner),'auth-owner@test.invalid');
    user={...user,email_confirmed_at:null};assert.equal(await actual.ownerEmail(owner),null);
    assert.deepEqual(await actual.ownerIdentity!(owner),{email:'auth-owner@test.invalid',verified:false});
    user={...user,email_confirmed_at:new Date().toISOString(),banned_until:'2099-01-01T00:00:00Z'};assert.equal(await actual.ownerEmail(owner),null);
    user={...user,banned_until:null,id:randomUUID()};assert.equal(await actual.ownerEmail(owner),null);
    await actual.sendReset('auth-owner@test.invalid');assert.equal(calls.length,1);assert.equal(calls[0].body.email,'auth-owner@test.invalid');assert.equal(new URL(calls[0].url).searchParams.get('redirect_to'),'https://pos-fixture.invalid/reset-password');assert.equal('password' in calls[0].body,false);
    resetStatus=429;await assert.rejects(()=>actual.sendReset('auth-owner@test.invalid'),/PASSWORD_RESET_PROVIDER_REJECTED/);
    process.env.APP_URL='http://unsafe-fixture.invalid';await assert.rejects(()=>actual.sendReset('auth-owner@test.invalid'),/SUPPORT_REDIRECT_NOT_CONFIGURED/);assert.equal(calls.length,2);
    process.env.APP_URL='https://pos-fixture.invalid';resetStatus=200;
    await actual.sendConfirmation!('auth-owner@test.invalid');const confirmationCall=calls[2];
    assert.equal(new URL(confirmationCall.url).pathname,'/auth/v1/resend');assert.equal(confirmationCall.body.type,'signup');
    assert.equal(confirmationCall.body.email,'auth-owner@test.invalid');assert.equal(new URL(confirmationCall.url).searchParams.get('redirect_to'),'https://pos-fixture.invalid/login');
    assert.equal('password' in confirmationCall.body,false);
    console.log('PASS: actual Supabase SDK provider contract, verified/unbanned exact Auth subject, fixed HTTPS recovery redirect, provider failure redaction; all network responses simulated');
  }finally{globalThis.fetch=original;for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
async function financialSnapshot(){const result:any={};for(const table of ['pos.transactions','pos.cash_ledger','pos.transaction_refunds','pos.shared_state_records','billing.invoices','billing.subscriptions','billing.payment_events'])result[table]=(await db.query('SELECT * FROM '+table)).rows;return result;}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pg.close());
