import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {cleanSchemaFiles,cleanSchemaBody} from '../full-neon/schema.mjs';
import {createMerchantHealthHandler} from '../../src/server/merchantHealthHandler';
import type {Db} from '../../services/shared/db';

const pg=new PGlite(),files=cleanSchemaFiles();
let failHealth=false,skipLock=false;
const wrap=(c:any):Db=>({query:async(s,p)=>{
 if(failHealth&&s.includes('INSERT INTO internal.merchant_health_logs'))throw Error('sensitive fixture SQL must not leak');
 if(skipLock&&s.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:false}] as any,rowCount:1};
 const r=await c.query(s,p);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};
},exec:s=>c.exec(s),tx:fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
const db=wrap(pg);
try{
 // Late failure must undo even artifacts originally carrying BEGIN/COMMIT.
 await assert.rejects(pg.transaction(async c=>{
  for(const file of files)await c.exec(cleanSchemaBody(file));
  await c.exec('SELECT deliberately_missing_release_function()');
 }));
 assert.equal((await pg.query<any>("SELECT to_regclass('internal.tenants') t")).rows[0].t,null);
 await pg.transaction(async c=>{for(const file of files)await c.exec(cleanSchemaBody(file));});
 await pg.exec(cleanSchemaBody('docs/full-neon/clean-runtime-schema.sql'));
 for(const name of ['internal.tenants','internal.internal_users','blog_posts','pos.transactions'])assert.equal((await pg.query<any>(`SELECT count(*)::int n FROM ${name}`)).rows[0].n,0,'No dummy seed: '+name);
 for(const name of ['ai.business_intelligence_cache','ai.merchant_ai_credits'])assert((await pg.query<any>('SELECT to_regclass($1) t',[name])).rows[0].t,'Complete clean schema: '+name);
 assert((await pg.query<any>("SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='shared_state_business_namespace'")).rows[0].def.includes('BUSINESS:'));
 const tenant=randomUUID(),merchant=randomUUID();
 await db.query("INSERT INTO internal.tenants(id,name) VALUES($1,'Synthetic only')",[tenant]);
 await db.query("INSERT INTO internal.merchants(id,tenant_id,name) VALUES($1,$2,'Synthetic only')",[merchant,tenant]);
 await assert.rejects(pg.transaction(c=>c.query("INSERT INTO internal.feature_usage_events(tenant_id,merchant_id,feature_key) VALUES($1,$2,'POS')",[randomUUID(),merchant])),(e:any)=>e.code==='23503');
 process.env.CRON_SECRET='synthetic-cron-secret';process.env.CRON_ENABLED_JOBS='merchant-health';
 const handler=createMerchantHealthHandler(async()=>db);
 const run=async()=>{let status=200,body:any;const res:any={status(n:number){status=n;return res;},json(v:any){body=v;return res;}};await handler({method:'GET',headers:{authorization:'Bearer synthetic-cron-secret'}},res);return {status,body};};
 for(let i=0;i<2;i++){const r=await run();assert.equal(r.status,200);assert.equal(r.body.merchantsEvaluated,1);}
 const rows=(await db.query('SELECT * FROM internal.merchant_health_logs')).rows;
 assert.equal(rows.length,1,'Daily replay updates the same snapshot');assert.equal(rows[0].tenant_id,tenant);assert.equal(rows[0].merchant_id,merchant);assert.equal(Number(rows[0].mrr_idr),0,'No invented paid revenue');
 assert.equal((await db.query("SELECT count(*)::int n FROM ai.batch_job_runs WHERE status='SUCCESS'")).rows[0].n,2);
 const prior=JSON.stringify(rows);failHealth=true;
 const failed=await run();assert.equal(failed.status,503);assert(!JSON.stringify(failed).includes('sensitive fixture'));
 assert.equal(JSON.stringify((await db.query('SELECT * FROM internal.merchant_health_logs')).rows),prior,'Failed job rolls back');
 assert.equal((await db.query("SELECT error_text FROM ai.batch_job_runs WHERE status='FAILED'")).rows[0].error_text,'MERCHANT_HEALTH_FAILED');
 failHealth=false;skipLock=true;assert.equal((await run()).body.reason,'ALREADY_RUNNING');
 assert.equal((await db.query('SELECT count(*)::int n FROM ai.batch_job_runs')).rows[0].n,3,'Overlap does no duplicate work');
 console.log('PASS: complete clean schema, no dummy seeds, atomic late-failure rollback; merchant cron canonical UUIDs/tenant, replay, overlap, sanitized failure, no fabricated MRR');
}finally{await pg.close();}
