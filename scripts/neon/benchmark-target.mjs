import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {parse} from 'dotenv';
import pg from 'pg';

// Read-only warm-path measurements. Never suspend/reset a branch to simulate
// cold starts while another rehearsal is running.
const file='.env.neon-runtime-roles.local';
assert.equal(fs.statSync(file).mode&0o077,0);
const env=parse(fs.readFileSync(file));
const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
assert.equal(env.NEON_BRANCH_ID,target.branchId);
const url=new URL(env.DATABASE_URL);
assert.equal(url.hostname.replace('-pooler',''),target.host);
assert.equal(decodeURIComponent(url.username),'newhope_runtime_login');
assert.equal(url.pathname,'/neondb');
for(const key of url.searchParams.keys())assert(['sslmode','channel_binding','application_name'].includes(key));
for(const key of ['sslmode','channel_binding'])url.searchParams.delete(key);
const client=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});
const started=performance.now();await client.connect();const connectionMs=performance.now()-started;
try{
  assert(client.connection.stream.authorized&&client.connection.stream.encrypted);
  await client.query('BEGIN READ ONLY');
  const size=(await client.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes;
  const timings=[];
  for(let i=0;i<10;i++){
    const at=performance.now();
    await client.query('SELECT count(*) FROM pos.transactions');
    timings.push(performance.now()-at);
  }
  await client.query('ROLLBACK');timings.sort((a,b)=>a-b);
  const evidence={status:'PASS',scope:'Read-only actual runtime LOGIN; warm pooled connection, not a cold-start/load test',
    measuredAt:new Date().toISOString(),branchId:target.branchId,role:'newhope_runtime_login',tlsVerified:true,
    databaseBytes:Number(size),connectionMs:Math.round(connectionMs),warmQuery:{samples:timings.length,
      medianMs:Math.round(timings[Math.floor(timings.length/2)]),maxMs:Math.round(timings.at(-1))},
    untested:['cold-start latency','multi-device peak concurrency','provider latency','sustained production workload']};
  fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/target-capacity-evidence.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}finally{await client.end();}
