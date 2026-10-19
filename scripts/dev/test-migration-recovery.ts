import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {migrationConnection,assertMigrationBaseline} from '../../services/db-server/migrationSafety';
import {runMigrations,type Db} from '../../src/server/db';
import {assertLocalSeedTargets} from '../../services/shared/localSeedTarget';
import {databasePoolLimits} from '../../services/shared/poolConfig';
import {databaseTransport} from '../../services/shared/databaseTls';
import {restoreTarget} from '../neon/backup-common.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const direct='postgresql://fixture:never-connect@ep-plain-dream-azghoyf7.c-3.ap-southeast-1.aws.neon.tech/neondb';
const env={APP_ENV:'staging',NEON_MIGRATION_CONFIRM:'REVIEWED_STAGING_MIGRATIONS',NEON_PROJECT_ID:'steep-sea-66546931',NEON_BRANCH_ID:'br-curly-truth-aze21ktf',DATABASE_URL_UNPOOLED:direct};
assert.equal(migrationConnection({}), 'postgres://postgres@127.0.0.1:5432/postgres');
assert.equal(migrationConnection(env),direct);
for(const extra of [{VERCEL_ENV:'production'},{APP_ENV:'production'},{NEON_MIGRATION_CONFIRM:''},
  {DATABASE_URL_UNPOOLED:'',DATABASE_URL:direct},{NEON_BRANCH_ID:'br-falling-butterfly-az989m86'},
  {DATABASE_URL_UNPOOLED:direct.replace('ep-plain-dream','ep-plain-dream-pooler')},
  {DATABASE_URL_UNPOOLED:direct.replace('/neondb','/postgres')},
  {DATABASE_URL_UNPOOLED:direct+'?host=foreign.invalid'},
  {DATABASE_URL_UNPOOLED:direct+'?sslrootcert=/unexpected/file'},
  {DATABASE_URL_UNPOOLED:direct+'#fragment'}]) assert.throws(()=>migrationConnection({...env,...extra}));
assert.throws(()=>migrationConnection({DATABASE_URL:'postgres://fixture@db.fqxrhumsgigcgjtlbfuo.supabase.co/postgres'}));
assert.equal(databaseTransport(migrationConnection({...env,DATABASE_URL_UNPOOLED:direct+'?sslmode=disable'})).ssl?.rejectUnauthorized,true);
const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql','migrations/later.sql'];
assert.doesNotThrow(()=>assertMigrationBaseline(files,new Set(),false));
assert.doesNotThrow(()=>assertMigrationBaseline(files,new Set(files),true));
assert.throws(()=>assertMigrationBaseline(files,new Set(files.slice(0,3)),true),/BASELINE_REVIEW_REQUIRED/);
assert.doesNotThrow(()=>assertMigrationBaseline(files,new Set(files.slice(0,3)),true,true));
assert.throws(()=>assertMigrationBaseline(files,new Set(['schema.sql']),true),/BASELINE_REVIEW_REQUIRED/);
let ddlCalls=0;
await assert.rejects(runMigrations({driver:'pg',query:async()=>{ddlCalls++;return {rows:[],rowCount:0};}} as unknown as Db),/REMOTE_RUNTIME_MIGRATIONS_DISABLED/);
assert.equal(ddlCalls,0,'Reject remote runtime DDL before touching a registry');
for(const raw of [NaN,Infinity,-1,0,1.5]) {
  assert.equal(databasePoolLimits(raw,'1').max,2);
  assert.equal(databasePoolLimits(raw,'0').max,4);
}
assert.equal(databasePoolLimits(10000,'0').max,20);
for (const query of ['host=foreign.invalid','user=owner','port=6543','database=foreign','options=-csearch_path=evil'])
  assert.throws(()=>databaseTransport(direct+'?'+query),/DATABASE_CONNECTION_OVERRIDE_REJECTED/);
assert.throws(()=>migrationConnection({VERCEL_ENV:'production'}),/PRODUCTION_TARGET_BLOCKED/);

// The clean restore has a separate fixed manifest; env declarations cannot
// approve another host, root branch or pg query-parameter redirect.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'newhope-target-'));
const saved=process.env.NEON_RESTORE_TARGET;
try {
  process.env.NEON_RESTORE_TARGET='clean-rehearsal';
  const file=path.join(temp,'target.env');
  const url='postgresql://fixture:fixture@ep-shiny-haze-azx1s0m2.c-3.ap-southeast-1.aws.neon.tech/neondb';
  const write=(connection=url,branch='br-mute-hat-azuw3aag')=>fs.writeFileSync(file,
    `NEON_PROJECT_ID=steep-sea-66546931\nNEON_BRANCH_ID=${branch}\nNEON_RESTORE_HOST=ep-shiny-haze-azx1s0m2.c-3.ap-southeast-1.aws.neon.tech\nNEON_RESTORE_DATABASE_URL=${connection}\n`,{mode:0o600});
  write();assert.equal(restoreTarget(file).manifest.branchId,'br-mute-hat-azuw3aag');
  write(url+'?host=foreign.invalid');assert.throws(()=>restoreTarget(file),/ENDPOINT_MISMATCH/);
  write(url,'br-falling-butterfly-az989m86');assert.throws(()=>restoreTarget(file),/BRANCH_MISMATCH/);
  write();fs.chmodSync(file,0o644);assert.throws(()=>restoreTarget(file),/PRIVATE_FILE_PERMISSIONS_REQUIRED/);
  process.env.NEON_RESTORE_TARGET='arbitrary';assert.throws(()=>restoreTarget(file),/TARGET_NOT_REVIEWED/);
} finally {
  if(saved===undefined)delete process.env.NEON_RESTORE_TARGET;else process.env.NEON_RESTORE_TARGET=saved;
  fs.rmSync(temp,{recursive:true,force:true});
}
assert.doesNotThrow(()=>assertLocalSeedTargets({}));
for(const config of [{NODE_ENV:'production'},{VERCEL:'1'},{VERCEL_ENV:'preview'},
  {SEED_API_URL:'https://kasir.newhope.space'},{SUPABASE_URL:'https://source.supabase.co'},
  {SEED_API_URL:'http://localhost.evil.invalid'},{SEED_API_URL:'http://localhost/?host=foreign.invalid'},
  {DATABASE_URL:'postgres://fixture@remote.invalid/db'},{DATABASE_URL:'postgres://fixture@localhost/db?host=remote.invalid'}])
  assert.throws(()=>assertLocalSeedTargets(config));
const result=spawnSync(process.execPath,['--import','tsx','scripts/db/bootstrap.mjs','--live'],{
  encoding:'utf8',env:{...process.env,DATABASE_URL:direct},timeout:10000});
assert.equal(result.status,1);assert.match(result.stderr,/DEMO_BOOTSTRAP_REMOTE_DISABLED/);
assert(!result.stdout.includes('SEEDING'));assert(!result.stderr.includes('never-connect'));
const missing=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',
  "import {getDb} from './src/server/db.ts'; await getDb();"],{
  encoding:'utf8',env:{...process.env,DATABASE_URL:'',NODE_ENV:'production'},timeout:10000});
assert.equal(missing.status,1);assert.match(missing.stderr,/DATABASE_URL_NOT_CONFIGURED/);
console.log('PASS migration recovery: remote fixture/DDL denial, approved direct staging target, imported baseline guard, verified TLS, bounded invalid pool values and missing production URL rejection');
