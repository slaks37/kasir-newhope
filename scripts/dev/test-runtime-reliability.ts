import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {waitForDatabase} from '../../services/shared/databaseStartup';
import {applyAtomicMigration,migrationBody} from '../../services/db-server/atomicMigration';
import {withRequestDeadline,RequestDeadlineError} from '../../src/lib/requestDeadline';
import {restoreAuthSession} from '../../src/lib/auth/sessionLifecycle';

let probes=0;const delays:number[]=[];const unavailable=new Error('fixture unavailable');
await assert.rejects(waitForDatabase(async()=>{probes++;throw unavailable;},'1',async ms=>{delays.push(ms);}),
  (error:any)=>error.cause===unavailable);
assert.equal(probes,1);assert.equal(delays.length,0,'Serverless must not wait through local startup backoff');
probes=0;
await waitForDatabase(async()=>{if(++probes<3)throw unavailable;},'0',async ms=>{delays.push(ms);});
assert.deepEqual(delays,[250,500]);
probes=0;delays.length=0;
await assert.rejects(waitForDatabase(async()=>{probes++;throw unavailable;},'0',async ms=>{delays.push(ms);}));
assert.equal(probes,15);assert.equal(delays.length,14,'No extra sleep after final failure');

let calls=0,aborted=false;
await assert.rejects(withRequestDeadline(async signal=>{
  calls++;signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});
},5),RequestDeadlineError);
assert.equal(calls,1,'Timed-out mutations must never be automatically repeated');assert(aborted);
assert.equal(await withRequestDeadline(async()=>42,100),42);
let lateResolve:(value:string)=>void=()=>{};
await assert.rejects(withRequestDeadline(()=>new Promise<string>(resolve=>{lateResolve=resolve;}),5),RequestDeadlineError);
lateResolve('late ACK'); // Cannot turn an already failed response into success.
let receive:(value:string)=>void=()=>{},finish:(value:string)=>void=()=>{},authErrors=0;
const sessions:string[]=[];
const stop=restoreAuthSession(new Promise<string>(resolve=>{finish=resolve;}),callback=>{receive=callback;return()=>{};},
  value=>sessions.push(value),()=>{authErrors++;},5);
await new Promise(resolve=>setTimeout(resolve,15));assert.equal(authErrors,1);
receive('new-owner');finish('old-owner');await Promise.resolve();
assert.deepEqual(sessions,['new-owner'],'Timeout cannot let stale initial restoration replace a live auth event');stop();

const pg=new PGlite();
// PGlite exec handles full SQL scripts; parameters still go through query.
const client={query:(sql:string,params?:string[])=>params?pg.query(sql,params):pg.exec(sql)};
try{
  await pg.exec('CREATE TABLE public.schema_migrations(filename text PRIMARY KEY)');
  await applyAtomicMigration(client,'first','-- maintenance\nBEGIN;\nCREATE TABLE kept(id int);\nCOMMIT;\n');
  await assert.rejects(applyAtomicMigration(client,'failed','BEGIN;\nCREATE TABLE rolled_back(id int);\nSELECT nonexistent_column;\nCOMMIT;'));
  assert.equal((await pg.query<{name:string|null}>("SELECT to_regclass('rolled_back')::text AS name")).rows[0].name,null);
  // Marker failure AFTER schema SQL must roll back schema too, including an
  // artifact that already carried its own standalone BEGIN/COMMIT wrapper.
  await assert.rejects(applyAtomicMigration(client,'first','BEGIN;\nCREATE TABLE marker_rollback(id int);\nCOMMIT;'));
  assert.equal((await pg.query<{name:string|null}>("SELECT to_regclass('marker_rollback')::text AS name")).rows[0].name,null);
  assert.equal((await pg.query('SELECT * FROM public.schema_migrations')).rows.length,1);
  assert.throws(()=>migrationBody('BEGIN;\nCOMMIT;\nBEGIN;\nCOMMIT;'),/FORMAT_UNSUPPORTED/);
  for(const file of fs.readdirSync('migrations').filter(name=>name.endsWith('.sql')))
    migrationBody(fs.readFileSync('migrations/'+file,'utf8'));
  for(const file of ['free-plan-selection','free-plan-ai-credit-access','restrict-browser-rls-policies','intelligence-cache','intelligence-wallet'])
    migrationBody(fs.readFileSync(`docs/security/${file}.sql`,'utf8'));
}finally{await pg.close();}
const workflow=fs.readFileSync('.github/workflows/nightly-batch-jobs.yml','utf8');
assert(!/^\s+schedule:/m.test(workflow),'GitHub must not duplicate Vercel scheduling');
assert(!workflow.includes('RESEND_API_KEY'));assert(!workflow.includes('--send'));
assert(workflow.includes('batch:insights:dry'));assert(workflow.includes('batch:health:dry'));
console.log('PASS runtime: bounded DB startup, full-request deadlines, no write replay, auth race, atomic migration rollback, one scheduler');
