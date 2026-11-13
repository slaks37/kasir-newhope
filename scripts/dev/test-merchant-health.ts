// Synthetic isolated database. Also run against disposable PG17 in CI after
// the security rehearsal has applied the actual migration chain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import type { Db } from '../../services/shared/db';
import { runMerchantHealth,recordHealthOutcome } from '../../services/backoffice/merchantHealth';
import { createMerchantHealthHandler } from '../../src/server/merchantHealthHandler';
import { rehearsalPostgresMajor, rehearsalTarget } from './rehearsal-target.mjs';

const native = process.argv.includes('--postgres17');
let db: Db;
if (native) {
  const pool=new pg.Pool({connectionString:rehearsalTarget(process.env)});
  const wrap=(runner:any):Db=>({query:(sql,params)=>runner.query(sql,params),exec:async sql=>{await runner.query(sql);},
    tx:async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(wrap(c));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()});
  db=wrap(pool);
  assert.equal(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)/10000), rehearsalPostgresMajor());
} else {
  const engine=new PGlite();
  const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rows.length};},exec:sql=>runner.exec(sql),tx:fn=>engine.transaction(tx=>fn(wrap(tx))),close:()=>engine.close()});
  db=wrap(engine);
  await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
  for(const file of ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)])await db.exec(fs.readFileSync(file,'utf8'));
}
try {
  await db.exec(fs.readFileSync('migrations/0074_merchant_health_identity.sql','utf8'));
  await db.exec(fs.readFileSync('migrations/0074_merchant_health_identity.sql','utf8'));
  const tenant=randomUUID(), other=randomUUID(), merchant=randomUUID(), second=randomUUID();
  await db.query("INSERT INTO internal.tenants(id,name) VALUES($1,'Synthetic health A'),($2,'Synthetic health B')",[tenant,other]);
  await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Synthetic A','FNB'),($3,$4,'Synthetic B','RETAIL')",[merchant,tenant,second,other]);
  const now=new Date();
  const result=await runMerchantHealth(db,{now});
  assert.ok(result.written>=2);
  const log=(await db.query('SELECT * FROM ai.batch_job_runs WHERE id=$1',[result.runId])).rows[0];
  assert.equal(log.status,'SUCCESS');assert.ok(log.finished_at);assert.equal(log.insights_written,result.written);
  await runMerchantHealth(db,{now});
  assert.equal(Number((await db.query('SELECT count(*) n FROM internal.merchant_health_logs WHERE merchant_id IN ($1,$2)',[merchant,second])).rows[0].n),2,'rerun retains one row per canonical merchant/day');
  const health=(await db.query('SELECT * FROM internal.merchant_health_logs WHERE merchant_id=$1',[merchant])).rows[0];
  assert.equal(health.tenant_id,tenant);assert.equal(Number(health.daily_revenue),0);assert.equal(Number(health.active_days_last_7),0);
  await assert.rejects(()=>recordHealthOutcome(db,randomUUID(),now,'RUNNING' as any),/INVALID_BATCH_OUTCOME/);
  await assert.rejects(()=>recordHealthOutcome(db,randomUUID(),now,'FAILED',2),/INVALID_BATCH_COUNT/);
  await assert.rejects(()=>recordHealthOutcome(db,result.runId,now,'FAILED'),(e:any)=>e.code==='23505');
  const before=JSON.stringify((await db.query('SELECT * FROM internal.merchant_health_logs ORDER BY id')).rows);
  let writes=0;
  const fail:Db={...db,tx:fn=>db.tx(tx=>fn({...tx,query:async(sql,params)=>{
    if(sql.includes('INSERT INTO internal.merchant_health_logs') && ++writes===2)throw Object.assign(new Error('synthetic failure'),{code:'23514'});
    return tx.query(sql,params);
  }}))};
  await assert.rejects(()=>runMerchantHealth(fail),/synthetic failure/);
  assert.equal(JSON.stringify((await db.query('SELECT * FROM internal.merchant_health_logs ORDER BY id')).rows),before,'all partial health updates roll back');
  assert.ok((await db.query("SELECT * FROM ai.batch_job_runs WHERE status='FAILED' AND error_text='23514'")).rows.length);
  const count=Number((await db.query('SELECT count(*) n FROM ai.batch_job_runs')).rows[0].n);
  await runMerchantHealth(db,{dryRun:true});
  assert.equal(Number((await db.query('SELECT count(*) n FROM ai.batch_job_runs')).rows[0].n),count);
  let connections=0;
  const handler=createMerchantHealthHandler(async()=>{connections++;return db;});
  process.env.CRON_SECRET='synthetic-health-only';process.env.CRON_ENABLED_JOBS='merchant-health';
  let code=0,body:any;const res={status:(n:number)=>{code=n;return res;},json:(v:any)=>{body=v;return res;}};
  await handler({method:'GET',headers:{}},res);assert.equal(code,401);assert.equal(connections,0);
  await handler({method:'POST',headers:{authorization:'Bearer synthetic-health-only'}},res);assert.equal(code,405);assert.equal(connections,0);
  await handler({method:'GET',headers:{authorization:'Bearer synthetic-health-only'}},res);assert.equal(code,200);assert.equal(body.ok,true);
  if(native){
    const c=new pg.Client({connectionString:rehearsalTarget(process.env)});await c.connect();
    try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(18441,731)');
      const overlap=await runMerchantHealth(db);assert.equal(overlap.skipped,true);
      assert.equal((await db.query('SELECT status FROM ai.batch_job_runs WHERE id=$1',[overlap.runId])).rows[0].status,'SKIPPED');
    }finally{await c.query('ROLLBACK');await c.end();}
  }
  console.log(`PASS merchant-health ${native?`PostgreSQL ${rehearsalPostgresMajor()}`:'PGlite'}: actual migrations, canonical UUID/scope, terminal outcomes, replay, rollback, history, dry-run, HTTP authorization${native?', concurrent-worker lock':''}`);
} finally {await db.close();}
