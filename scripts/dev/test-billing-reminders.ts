// Isolated PostgreSQL and injected providers: no .env or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../services/shared/db';
import { pastikanPaket } from '../../services/billing/store';
import { ensureSubscription } from '../../services/billing/engine';
import { SAAS_PLANS, DAY_MS } from '../../src/config/saasPlans';
import { runBillingReminders, type ReminderDependencies } from '../../services/billing/reminders';
import cron from '../../api/cron/billing-reminders';
import { createReminderProvider } from '../../services/billing/reminderProvider';

async function main() {
  const pg = new PGlite();
  const wrap = (runner:any):Db => ({
    query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rows.length || r.affectedRows || 0};},
    exec:async(sql)=>{await runner.exec(sql);},tx:async(fn)=>pg.transaction(t=>fn(wrap(t))),close:()=>pg.close(),
  });
  const db=wrap(pg),now=new Date('2026-09-11T02:00:00Z');
  try {
    await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;');
    const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
    for (const file of files) await pg.exec(fs.readFileSync(file,'utf8'));
    await pastikanPaket(db,SAAS_PLANS);
    async function fixture(owner:string,days:number,status='TRIAL',active=true) {
      const id=randomUUID();
      await db.query('INSERT INTO internal.tenants(id,name,owner_user_ref,is_active) VALUES($1,$2,$3,$4)',[id,'Merchant <script>test</script>',owner,active]);
      const sub=await ensureSubscription(db,id);
      await db.query('UPDATE billing.subscriptions SET current_period_end=$2,status=$3 WHERE id=$1',[sub.id,new Date(now.getTime()+days*DAY_MS).toISOString(),status]);
      return sub.id;
    }
    await fixture('owner-h3',3);await fixture('owner-h1',1,'ACTIVE');
    await fixture('owner-h2',2);await fixture('expired',0);await fixture('canceled',3,'EXPIRED');
    await fixture('inactive',3,'TRIAL',false);await fixture('unverified',3);
    let sends=0,lookups=0;
    const delivered=new Map<string,unknown>();
    let rejectNext=false;
    const deps:ReminderDependencies={
      verifiedOwnerEmail:async owner=>{lookups++;return owner==='unverified'?null:owner+'@test.invalid';},
      send:async(mail,key)=>{sends++;if(rejectNext){rejectNext=false;throw new Error('Test provider failure');}assert.ok(!('html' in mail));assert.ok(mail.text.includes('bukan bukti pembayaran'));delivered.set(key,mail);return 'provider-'+key;},
    };
    const options={dryRun:false,now,from:'billing@test.invalid',appUrl:'https://test.invalid'};
    const dry=await runBillingReminders(db,deps,{now});
    assert.equal(dry.candidates,3);assert.equal(sends,0);assert.equal(lookups,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.reminder_deliveries')).rows[0].n,0);
    const first=await runBillingReminders(db,deps,options);assert.equal(first.accepted,2);assert.equal(first.skipped,1);
    const second=await runBillingReminders(db,deps,options);assert.equal(second.accepted,0);assert.equal(sends,2);
    assert.equal(delivered.size,2);
    console.log('PASS: H3/H1 boundaries, inactive/expired exclusion, verified owners, read-only dry-run, durable duplicate prevention');

    const retry=await fixture('retry-owner',3);rejectNext=true;
    const failure=await runBillingReminders(db,deps,options);assert.equal(failure.failed,1);
    const original=(await db.query('SELECT * FROM billing.reminder_deliveries WHERE subscription_id=$1',[retry])).rows[0];assert.equal(original.state,'FAILED');
    const retryResult=await runBillingReminders(db,deps,{...options,from:'changed@test.invalid'});assert.equal(retryResult.accepted,1);
    assert.deepEqual(delivered.get('billing-reminder/'+original.id),original.payload);

    const changed=await fixture('changed-owner',3);rejectNext=true;
    await runBillingReminders(db,deps,options);
    const changedResult=await runBillingReminders(db,{...deps,verifiedOwnerEmail:async owner=>owner==='changed-owner'?'new@test.invalid':deps.verifiedOwnerEmail(owner)},options);
    assert.equal(changedResult.review,1);
    assert.equal((await db.query('SELECT state FROM billing.reminder_deliveries WHERE subscription_id=$1',[changed])).rows[0].state,'REVIEW');

    const old=await fixture('old-attempt',3);rejectNext=true;await runBillingReminders(db,deps,options);
    await db.query('UPDATE billing.reminder_deliveries SET first_attempt_at=$2 WHERE subscription_id=$1',[old,new Date(now.getTime()-23*60*60_000).toISOString()]);
    const oldResult=await runBillingReminders(db,deps,options);assert.ok(oldResult.review>=1);
    assert.equal((await db.query('SELECT state FROM billing.reminder_deliveries WHERE subscription_id=$1',[old])).rows[0].state,'REVIEW');
    console.log('PASS: provider failures recorded, stable retry payload/key, changed recipient and expired retry window require review');

    await fixture('concurrent-owner',3);
    let release!:()=>void,started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const sending=new Promise<void>(resolve=>{started=resolve;});
    let concurrentCalls=0;
    const concurrentDeps={...deps,send:async()=>{concurrentCalls++;started();await gate;return 'concurrent-provider';}};
    const running=runBillingReminders(db,concurrentDeps,options);
    await sending;
    try { const parallel=await runBillingReminders(db,concurrentDeps,options);assert.equal(parallel.accepted,0); }
    finally { release(); }
    assert.equal((await running).accepted,1);assert.equal(concurrentCalls,1);
    console.log('PASS: overlapping cron invocations claim only one delivery');

    const originalFetch=globalThis.fetch;
    const envKeys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY'];
    const saved=envKeys.map(key=>process.env[key]);
    try {
      process.env.SUPABASE_URL='https://auth.test.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';process.env.RESEND_API_KEY='test-resend-key';
      const subject=randomUUID();
      let user:any={id:subject,email:'verified@test.invalid',email_confirmed_at:now.toISOString()};
      globalThis.fetch=async(input)=>{
        const url=String(input);
        if(url.startsWith('https://auth.test.invalid/auth/v1/admin/users/')) return new Response(JSON.stringify(user),{status:200,headers:{'content-type':'application/json'}});
        if(url.startsWith('https://api.resend.com/')) return new Response(JSON.stringify({name:'validation_error',message:'test rejection'}),{status:422,headers:{'content-type':'application/json'}});
        throw new Error('UNEXPECTED_NETWORK_TARGET');
      };
      const provider=createReminderProvider();
      assert.equal(await provider.verifiedOwnerEmail(subject),'verified@test.invalid');
      user={...user,deleted_at:now.toISOString()};assert.equal(await provider.verifiedOwnerEmail(subject),null);
      delete user.deleted_at;
      user={...user,email_confirmed_at:null};assert.equal(await provider.verifiedOwnerEmail(subject),null);
      user={...user,id:randomUUID(),email_confirmed_at:now.toISOString()};assert.equal(await provider.verifiedOwnerEmail(subject),null);
      assert.equal(await provider.verifiedOwnerEmail('not-a-subject'),null);
      await assert.rejects(()=>provider.send({from:'sender@test.invalid',to:'recipient@test.invalid',subject:'test',text:'test'},'test-only'),/EMAIL_PROVIDER_REJECTED/);
    } finally {
      globalThis.fetch=originalFetch;
      envKeys.forEach((key,index)=>{if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];});
    }
    console.log('PASS: real provider adapter rejects unverified/mismatched owners and SDK error responses (network mocked)');

    await pg.exec('GRANT USAGE ON SCHEMA billing TO anon,authenticated;');
    for(const role of ['anon','authenticated']) await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE '+role);await c.query('SELECT * FROM billing.reminder_deliveries');}),/permission denied/);
    await db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_billing');assert.ok((await c.query('SELECT * FROM billing.reminder_deliveries')).rowCount);});
    await db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_internal');assert.ok((await c.query('SELECT * FROM billing.reminder_deliveries')).rowCount);});
    let status=0;
    const response={status:(code:number)=>{status=code;return response;},json:(_:unknown)=>response};
    delete process.env.CRON_SECRET;
    await cron({method:'GET',headers:{}},response);assert.equal(status,401);
    process.env.CRON_SECRET='test-only-secret';
    await cron({method:'GET',headers:{authorization:'Bearer wrong'}},response);assert.equal(status,401);
    await cron({method:'POST',headers:{authorization:'Bearer test-only-secret'}},response);assert.equal(status,405);
    delete process.env.DATABASE_URL;
    await cron({method:'GET',headers:{authorization:'Bearer test-only-secret'}},response);assert.equal(status,503);
    console.log('PASS: new ledger denies public access, service roles allowed, cron auth/method/config fail closed');
  } finally { await pg.close(); }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
