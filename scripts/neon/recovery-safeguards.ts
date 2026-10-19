import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import pg from 'pg';
import {databaseTransport} from '../../services/shared/databaseTls';
import {databasePoolLimits,serverlessConnectionString} from '../../services/shared/poolConfig';
import {migrationConnection,assertMigrationBaseline} from '../../services/db-server/migrationSafety';
import {restoreTarget} from './backup-common.mjs';
import {execFile} from 'node:child_process';

const env=parse(fs.readFileSync('.env.neon-runtime-roles.local'));
const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
const url=new URL(env.DATABASE_URL);
assert.equal(env.NEON_PROJECT_ID,target.projectId);assert.equal(env.NEON_BRANCH_ID,target.branchId);
assert.equal(url.hostname,target.host.replace('.c-','-pooler.c-'));
assert.equal(url.pathname,'/neondb');assert.equal(decodeURIComponent(url.username),'newhope_runtime_login');
const pool=new pg.Pool({...databaseTransport(serverlessConnectionString(url.href,'1')),...databasePoolLimits(100,'1')});
const evidence:any={status:'RUNNING',checkedAt:new Date().toISOString(),branchId:target.branchId,
  scope:'Actual restricted pooled LOGIN; read-only transactions, no identity or business writes',checks:{}};
try {
  let maxClients=0;
  await Promise.all(Array.from({length:6},async(_,i)=>{
    const c=await pool.connect();maxClients=Math.max(maxClients,pool.totalCount);
    try {
      assert((c as any).connection.stream.authorized&&(c as any).connection.stream.encrypted);
      await c.query('BEGIN READ ONLY');
      // Neon transaction pooling may ignore startup/session timeout settings.
      // Financial db.tx uses this same awaited transaction-local bound.
      await c.query('SET LOCAL statement_timeout = 8000');
      assert.equal((await c.query("SELECT current_setting('statement_timeout') AS value")).rows[0].value,'8s');
      assert.equal((await c.query('SELECT current_user AS role')).rows[0].role,'newhope_runtime_login');
      await c.query("SELECT set_config('app.migration_recovery_probe',$1,true)",['fixture-'+i]);
      assert.equal((await c.query("SELECT current_setting('app.migration_recovery_probe',true) AS value")).rows[0].value,'fixture-'+i);
      await c.query('SELECT count(*) FROM pos.transactions');
      await c.query('COMMIT');
      await c.query('BEGIN READ ONLY');
      assert(!((await c.query("SELECT current_setting('app.migration_recovery_probe',true) AS value")).rows[0].value));
      await c.query('COMMIT');
    } finally {await c.query('ROLLBACK').catch(()=>{});c.release();}
  }));
  assert(maxClients<=2);
  evidence.checks.pool={concurrentRequests:6,maxClients,limit:2,tlsVerified:true,transactionLocalStateCleared:true,transactionStatementTimeoutMs:8000,sessionStartupTimeoutNotAssumed:true};
  const c=await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    // The runtime correctly has no access to the migration registry.
    await assert.rejects(c.query('SELECT filename FROM public.schema_migrations'),(e:any)=>e.code==='42501');
    await c.query('ROLLBACK');await c.query('BEGIN READ ONLY');
    const counts=(await c.query(`SELECT
      (SELECT count(*)::int FROM pos.transactions) AS transactions,
      (SELECT count(*)::int FROM pos.payments) AS payments`)).rows[0];
    evidence.checks.runtimeRegistryAccessDenied=true;
    evidence.checks.financialCounts=counts;
    await c.query('ROLLBACK');
  } finally {c.release();}
  const {env:ownerEnv,manifest,...config}=restoreTarget();
  assert.equal(ownerEnv.NEON_BRANCH_ID,target.branchId);
  const owner=new pg.Client(config);await owner.connect();
  try {
    await owner.query('BEGIN READ ONLY');
    const done=new Set<string>((await owner.query('SELECT filename FROM public.schema_migrations')).rows.map(r=>r.filename));
    const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',
      ...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
    assert.throws(()=>assertMigrationBaseline(files,done,true),/BASELINE_REVIEW_REQUIRED/);
    evidence.checks.importedBaseline={replayBlocked:true,migrationMarkers:done.size,probe:'owner read-only session; no history writes'};
    const cli=await new Promise<{error:any;stdout:string;stderr:string}>(resolve=>execFile(process.execPath,
      ['--import','tsx','services/db-server/migrate.ts'],{timeout:20000,env:{...process.env,...ownerEnv,
        DATABASE_URL_UNPOOLED:config.connectionString,APP_ENV:'staging',NODE_ENV:'test',VERCEL_ENV:'preview',
        NEON_MIGRATION_CONFIRM:'REVIEWED_STAGING_MIGRATIONS'}},
      (error,stdout,stderr)=>resolve({error,stdout,stderr})));
    assert.equal(cli.error?.code,1);assert.match(cli.stderr,/MIGRATION_BASELINE_REVIEW_REQUIRED/);
    assert(!cli.stdout.includes(' OK '));
    evidence.checks.actualMigrator={exitCode:1,expectedError:'MIGRATION_BASELINE_REVIEW_REQUIRED',noMigrationApplied:true};
  } finally {await owner.query('ROLLBACK').catch(()=>{});await owner.end();}
  assert.throws(()=>migrationConnection({DATABASE_URL:env.DATABASE_URL,VERCEL_ENV:'production'}),/PRODUCTION_TARGET_BLOCKED/);
  evidence.checks.productionMigratorBlocked=true;
  evidence.status='PASS';console.log(JSON.stringify(evidence));
} catch(error:any) {evidence.status='FAIL';evidence.failure=error.code||error.message;throw error;}
finally {await pool.end();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/recovery-safeguards-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
